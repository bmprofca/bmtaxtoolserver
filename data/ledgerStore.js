import { query } from '../db/connection.js'
import { getSetting } from '../db/init.js'

const LEDGER_COLUMNS = `id, name, note_group, sign, sort_order, is_deleted, deleted_at, created_at`

let globalLedgers = []

const NOTE_GROUP_KEYS = [
  'capitalAccount',
  'longTermBorrowings',
  'otherLongTermLiabilities',
  'longTermProvisions',
  'shortTermBorrowings',
  'tradePayables',
  'otherCurrentLiabilities',
  'shortTermProvision',
  'depreciationAmortization',
  'nonCurrentInvestments',
  'longTermLoansAdvances',
  'otherNonCurrentAssets',
  'currentInvestments',
  'inventoriesTradeReceivables',
  'balancesRevenueAuthority',
  'shortTermLoansAdvances',
  'cashAtBank',
  'cashInHand',
  'revenueFromOperations',
  'otherIncome',
  'costOfGoodsSold',
  'employeeBenefitExpenses',
  'otherAdministrativeExpenses',
  'financeCost',
]

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function buildActor(user) {
  if (!user?.id) {
    return { userId: null, username: null, name: null }
  }

  return {
    userId: user.id,
    username: user.username || null,
    name: user.name || user.username || null,
  }
}

export function normalizeLedger(raw = {}) {
  const group = NOTE_GROUP_KEYS.includes(raw.group) ? raw.group : 'otherAdministrativeExpenses'
  const name = String(raw.name ?? '').trim()
  const sign = raw.sign === 'less' ? 'less' : 'add'

  return {
    id: String(raw.id || generateId()).trim(),
    name,
    group,
    sign,
  }
}

function rowToLedger(row) {
  const group = NOTE_GROUP_KEYS.includes(row.note_group)
    ? row.note_group
    : 'otherAdministrativeExpenses'

  return {
    id: row.id,
    name: row.name || '',
    group,
    sign: row.sign === 'less' ? 'less' : 'add',
    sortOrder: Number(row.sort_order) || 0,
    isDeleted: row.is_deleted === 1 || row.is_deleted === true,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

function serializeLedger(ledger) {
  return {
    id: ledger.id,
    name: ledger.name,
    group: ledger.group,
    sign: ledger.sign,
  }
}

async function fetchLedgerRows(whereClause = '', params = []) {
  return query(
    `SELECT ${LEDGER_COLUMNS}
     FROM ledgers
     ${whereClause}
     ORDER BY sort_order ASC, name ASC`,
    params,
  )
}

async function reloadActiveLedgers() {
  const rows = await fetchLedgerRows('WHERE is_deleted = 0')
  globalLedgers = rows.map((row) => serializeLedger(rowToLedger(row)))
  return globalLedgers
}

async function insertLedgerRow(ledger, sortOrder, actor) {
  const { userId, username, name } = buildActor(actor)

  await query(
    `INSERT INTO ledgers (
       id, name, note_group, sign, sort_order,
       is_deleted, deleted_at,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
    [ledger.id, ledger.name, ledger.group, ledger.sign, sortOrder, userId, username, name],
  )
}

async function updateLedgerRow(ledger, sortOrder, actor) {
  const { userId, username, name } = buildActor(actor)

  await query(
    `UPDATE ledgers
     SET name = ?,
         note_group = ?,
         sign = ?,
         sort_order = ?,
         updated_by_user_id = ?,
         updated_by_username = ?,
         updated_by_name = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND is_deleted = 0`,
    [ledger.name, ledger.group, ledger.sign, sortOrder, userId, username, name, ledger.id],
  )
}

export async function migrateLedgersFromSettings() {
  const existing = await query('SELECT id FROM ledgers LIMIT 1')
  if (existing.length) {
    return
  }

  const stored = await getSetting('ledgers')
  if (!Array.isArray(stored) || !stored.length) {
    return
  }

  for (let index = 0; index < stored.length; index += 1) {
    const ledger = normalizeLedger(stored[index])
    if (!ledger.name) {
      continue
    }

    await insertLedgerRow(ledger, index, null)
  }
}

export async function loadLedgers() {
  await reloadActiveLedgers()
}

export function getLedgers() {
  return globalLedgers
}

export async function saveLedgers(ledgers, actor) {
  const normalized = (ledgers || [])
    .map(normalizeLedger)
    .filter((item) => item.name.length > 0)

  const incomingIds = new Set(normalized.map((item) => item.id))
  const existingRows = await fetchLedgerRows('WHERE is_deleted = 0')
  const existingIds = new Set(existingRows.map((row) => row.id))

  for (const row of existingRows) {
    if (!incomingIds.has(row.id)) {
      await query('DELETE FROM ledgers WHERE id = ?', [row.id])
    }
  }

  for (let index = 0; index < normalized.length; index += 1) {
    const ledger = normalized[index]
    if (existingIds.has(ledger.id)) {
      await updateLedgerRow(ledger, index, actor)
    } else {
      await insertLedgerRow(ledger, index, actor)
    }
  }

  return reloadActiveLedgers()
}

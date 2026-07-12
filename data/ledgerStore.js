import { query } from '../db/connection.js'
import { getSetting, parseJson } from '../db/init.js'

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

function serializeLedger(ledger, hasEntries = false) {
  return {
    id: ledger.id,
    name: ledger.name,
    group: ledger.group,
    sign: ledger.sign,
    hasEntries: Boolean(hasEntries),
  }
}

const ADMIN_EXPENSE_LEGACY_LABELS = {
  rent: 'rent',
  'electricity-water': 'electricity water',
  'telephone-internet': 'telephone internet',
  'printing-stationery': 'printing stationery',
  'travelling-conveyance': 'travelling conveyance',
  'legal-professional': 'legal professional fees',
  'audit-fees': 'audit fees',
  insurance: 'insurance',
  'repairs-maintenance': 'repairs maintenance',
  advertisement: 'advertisement publicity',
  'office-expenses': 'office expenses',
  commission: 'commission',
  'bank-charges': 'bank charges',
  'rates-taxes': 'rates taxes',
  donations: 'donations',
  miscellaneous: 'miscellaneous expenses',
  others: 'others',
}

function normalizeLedgerMatchName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function ledgerNamesMatch(left, right) {
  const a = normalizeLedgerMatchName(left)
  const b = normalizeLedgerMatchName(right)
  if (!a || !b) {
    return false
  }
  if (a === b) {
    return true
  }
  if (a === b.replace(/s$/, '') || b === a.replace(/s$/, '')) {
    return true
  }
  return a.includes(b) || b.includes(a)
}

function ledgerMatchesReference(ledger, referenceId) {
  const ref = String(referenceId ?? '').trim()
  if (!ref) {
    return false
  }
  if (ref === ledger.id) {
    return true
  }
  if (ledgerNamesMatch(ref, ledger.name)) {
    return true
  }
  const legacyLabel = ADMIN_EXPENSE_LEGACY_LABELS[ref]
  if (legacyLabel && ledger.group === 'otherAdministrativeExpenses') {
    return ledgerNamesMatch(legacyLabel, ledger.name)
  }
  return false
}

function amountHasValue(amount) {
  return Math.abs(Number(amount?.current) || 0) > 0 || Math.abs(Number(amount?.previous) || 0) > 0
}

function collectUsedReferencesFromPayload(payload, usedReferences) {
  if (!payload || typeof payload !== 'object') {
    return
  }

  const pushReference = (referenceId) => {
    const ref = String(referenceId ?? '').trim()
    if (ref) {
      usedReferences.add(ref)
    }
  }

  const adminLines = payload.administrativeExpenseLines || []
  const adminSubs = payload.noteSubAmounts?.otherAdministrativeExpenses || {}
  for (const line of adminLines) {
    const subId = `admin-line-${line.id}`
    if (amountHasValue(adminSubs[subId])) {
      pushReference(line.categoryId)
    }
  }

  const dynamicLineCollections = [
    {
      lines: payload.otherShortTermBorrowingLines || [],
      prefix: 'manual-st-',
      subs: payload.noteSubAmounts?.shortTermBorrowings || {},
      refKey: 'typeId',
    },
    {
      lines: payload.manualNoteLines || [],
      prefix: 'manual-nl-',
      subs: {},
      refKey: 'typeId',
      subResolver: (line) => payload.noteSubAmounts?.[line.noteKey]?.[`manual-nl-${line.id}`],
    },
    {
      lines: payload.capitalAccountLines || [],
      prefix: 'capital-line-',
      subs: payload.noteSubAmounts?.capitalAccount || {},
      refKey: 'typeId',
    },
    {
      lines: payload.cogsExtraLines || [],
      prefix: 'cogs-line-',
      subs: payload.noteSubAmounts?.costOfGoodsSold || {},
      refKey: 'typeId',
    },
    {
      lines: payload.plAppropriationLines || [],
      prefix: 'pl-appr-',
      subs: payload.plAppropriationAmounts || {},
      refKey: 'categoryId',
    },
  ]

  for (const collection of dynamicLineCollections) {
    for (const line of collection.lines) {
      const subId = `${collection.prefix}${line.id}`
      const amount =
        typeof collection.subResolver === 'function'
          ? collection.subResolver(line)
          : collection.subs[subId]
      if (amountHasValue(amount)) {
        pushReference(line[collection.refKey])
      }
    }
  }

  for (const subs of Object.values(payload.noteSubAmounts || {})) {
    if (!subs || typeof subs !== 'object') {
      continue
    }
    for (const [subId, amount] of Object.entries(subs)) {
      if (!amountHasValue(amount) || !subId.startsWith('ledger-')) {
        continue
      }
      pushReference(subId.slice('ledger-'.length))
    }
  }

  for (const row of payload.depreciationSchedule || []) {
    pushReference(row.ledgerId)
  }
}

async function collectUsedLedgerReferences() {
  const usedReferences = new Set()

  const ledgerSubRows = await query(
    `SELECT DISTINCT SUBSTRING(sub_id, 8) AS ledger_id
     FROM note_sub_amount_rows
     WHERE sub_id LIKE 'ledger-%'
       AND (current_amount != 0 OR previous_amount != 0)`,
  )
  for (const row of ledgerSubRows) {
    if (row.ledger_id) {
      usedReferences.add(row.ledger_id)
    }
  }

  const lineRefRows = await query(
    `SELECT DISTINCT l.reference_id
     FROM note_line_rows l
     INNER JOIN note_sub_amount_rows s
       ON s.client_id = l.client_id
      AND s.fy_id = l.fy_id
      AND s.business_id = l.business_id
     WHERE l.reference_id != ''
       AND (s.current_amount != 0 OR s.previous_amount != 0)
       AND (
         (l.line_kind = 'admin_expense' AND s.sub_id = CONCAT('admin-line-', l.id))
         OR (l.line_kind = 'short_term_borrowing' AND s.sub_id = CONCAT('manual-st-', l.id))
         OR (l.line_kind = 'manual_note' AND s.sub_id = CONCAT('manual-nl-', l.id))
         OR (l.line_kind = 'capital_account' AND s.sub_id = CONCAT('capital-line-', l.id))
         OR (l.line_kind = 'cogs_extra' AND s.sub_id = CONCAT('cogs-line-', l.id))
         OR (l.line_kind = 'pl_appropriation' AND s.sub_id = CONCAT('pl-appr-', l.id))
       )`,
  )
  for (const row of lineRefRows) {
    usedReferences.add(row.reference_id)
  }

  const directLineRefs = await query(
    `SELECT DISTINCT l.reference_id
     FROM note_line_rows l
     WHERE l.reference_id != ''
       AND EXISTS (
         SELECT 1
         FROM note_sub_amount_rows s
         WHERE s.client_id = l.client_id
           AND s.fy_id = l.fy_id
           AND s.business_id = l.business_id
           AND (s.current_amount != 0 OR s.previous_amount != 0)
           AND (
             (l.line_kind = 'admin_expense' AND s.note_key = 'otherAdministrativeExpenses' AND s.sub_id = CONCAT('admin-line-', l.id))
             OR (l.line_kind = 'short_term_borrowing' AND s.note_key = 'shortTermBorrowings' AND s.sub_id = CONCAT('manual-st-', l.id))
             OR (l.line_kind = 'manual_note' AND s.note_key = l.note_key AND s.sub_id = CONCAT('manual-nl-', l.id))
             OR (l.line_kind = 'capital_account' AND s.note_key = 'capitalAccount' AND s.sub_id = CONCAT('capital-line-', l.id))
             OR (l.line_kind = 'cogs_extra' AND s.note_key = 'costOfGoodsSold' AND s.sub_id = CONCAT('cogs-line-', l.id))
             OR (l.line_kind = 'pl_appropriation' AND s.note_key = '__plAppropriation' AND s.sub_id = CONCAT('pl-appr-', l.id))
           )
       )`,
  )
  for (const row of directLineRefs) {
    usedReferences.add(row.reference_id)
  }

  const depSchedule = await query(
    `SELECT DISTINCT ledger_id
     FROM depreciation_schedule_rows
     WHERE ledger_id IS NOT NULL AND ledger_id != ''`,
  )
  const depHistory = await query(
    `SELECT DISTINCT ledger_id
     FROM asset_depreciation_history
     WHERE ledger_id IS NOT NULL AND ledger_id != ''`,
  )
  for (const row of [...depSchedule, ...depHistory]) {
    if (row.ledger_id) {
      usedReferences.add(row.ledger_id)
    }
  }

  const fsRows = await query('SELECT payload FROM fs_data')
  for (const row of fsRows) {
    collectUsedReferencesFromPayload(parseJson(row.payload), usedReferences)
  }

  return usedReferences
}

export async function buildLedgerUsageFlags(ledgers) {
  const usedReferences = await collectUsedLedgerReferences()
  const flags = {}

  for (const ledger of ledgers) {
    flags[ledger.id] = [...usedReferences].some((referenceId) =>
      ledgerMatchesReference(ledger, referenceId),
    )
  }

  return flags
}

export async function getLedgersWithUsage() {
  await reloadActiveLedgers()
  const ledgers = getLedgers()
  const usageFlags = await buildLedgerUsageFlags(ledgers)
  return ledgers.map((ledger) => serializeLedger(ledger, Boolean(usageFlags[ledger.id])))
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

function ledgerDuplicateKey(ledger) {
  return `${ledger.group}|${String(ledger.name ?? '').trim().toLowerCase()}`
}

function findDuplicateLedgerInList(ledgers, candidate) {
  const name = String(candidate.name ?? '').trim()
  if (!name) {
    return null
  }

  const key = ledgerDuplicateKey({ ...candidate, name })
  return (
    ledgers.find(
      (ledger) => ledger.id !== candidate.id && ledgerDuplicateKey(ledger) === key,
    ) ?? null
  )
}

function assertNoDuplicateLedgers(ledgers) {
  for (const ledger of ledgers) {
    const duplicate = findDuplicateLedgerInList(ledgers, ledger)
    if (duplicate) {
      throw new Error(
        `Duplicate ledger name "${ledger.name}" is not allowed in the same note group.`,
      )
    }
  }
}

export async function createLedger(payload, actor) {
  const ledger = normalizeLedger(payload)
  if (!ledger.name) {
    throw new Error('Ledger name is required')
  }

  await reloadActiveLedgers()
  const existing = getLedgers()
  const duplicate = findDuplicateLedgerInList(existing, ledger)
  if (duplicate) {
    const usageFlags = await buildLedgerUsageFlags(existing)
    return {
      ledger: serializeLedger(duplicate, Boolean(usageFlags[duplicate.id])),
      created: false,
    }
  }

  const sortOrder = existing.length
  await insertLedgerRow(ledger, sortOrder, actor)
  await reloadActiveLedgers()

  const saved = getLedgers().find((item) => item.id === ledger.id) || ledger
  const usageFlags = await buildLedgerUsageFlags(getLedgers())
  return {
    ledger: serializeLedger(saved, Boolean(usageFlags[saved.id])),
    created: true,
  }
}

export async function ensureRoundOffAdjustmentLedger(actor) {
  const ROUND_OFF_LEDGER_ID = 'round-off-adjustment'
  const ROUND_OFF_LEDGER_NAME = 'Round Off Adjustment'

  await reloadActiveLedgers()

  const activeById = getLedgers().find((ledger) => ledger.id === ROUND_OFF_LEDGER_ID)
  if (activeById) {
    return activeById
  }

  const activeByName = getLedgers().find(
    (ledger) =>
      ledger.group === 'otherAdministrativeExpenses' &&
      ledgerNamesMatch(ledger.name, ROUND_OFF_LEDGER_NAME),
  )
  if (activeByName) {
    return activeByName
  }

  const existingRows = await query(
    `SELECT ${LEDGER_COLUMNS} FROM ledgers WHERE id = ? LIMIT 1`,
    [ROUND_OFF_LEDGER_ID],
  )
  if (existingRows.length) {
    const row = existingRows[0]
    if (row.is_deleted === 1 || row.is_deleted === true) {
      const { userId, username, name } = buildActor(actor)
      await query(
        `UPDATE ledgers
         SET name = ?,
             note_group = ?,
             sign = ?,
             is_deleted = 0,
             deleted_at = NULL,
             updated_by_user_id = ?,
             updated_by_username = ?,
             updated_by_name = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          ROUND_OFF_LEDGER_NAME,
          'otherAdministrativeExpenses',
          'add',
          userId,
          username,
          name,
          ROUND_OFF_LEDGER_ID,
        ],
      )
    }
    await reloadActiveLedgers()
    const restored = getLedgers().find((item) => item.id === ROUND_OFF_LEDGER_ID)
    if (restored) {
      return restored
    }
    return serializeLedger(rowToLedger(row))
  }

  const ledger = normalizeLedger({
    id: ROUND_OFF_LEDGER_ID,
    name: ROUND_OFF_LEDGER_NAME,
    group: 'otherAdministrativeExpenses',
  })

  try {
    const sortOrder = getLedgers().length
    await insertLedgerRow(ledger, sortOrder, actor)
  } catch (err) {
    const message = String(err?.message || '')
    if (err?.code !== 'ER_DUP_ENTRY' && !message.includes('Duplicate entry')) {
      throw err
    }
    await reloadActiveLedgers()
    const fallback =
      getLedgers().find((item) => item.id === ROUND_OFF_LEDGER_ID) ||
      getLedgers().find(
        (item) =>
          item.group === 'otherAdministrativeExpenses' &&
          ledgerNamesMatch(item.name, ROUND_OFF_LEDGER_NAME),
      )
    if (fallback) {
      return fallback
    }
    throw err
  }

  await reloadActiveLedgers()
  return getLedgers().find((item) => item.id === ledger.id) || ledger
}

export async function saveLedgers(ledgers, actor) {
  const normalized = (ledgers || [])
    .map(normalizeLedger)
    .filter((item) => item.name.length > 0)

  assertNoDuplicateLedgers(normalized)

  const incomingIds = new Set(normalized.map((item) => item.id))
  const existingRows = await fetchLedgerRows('WHERE is_deleted = 0')
  const existingIds = new Set(existingRows.map((row) => row.id))
  const existingLedgers = existingRows.map((row) => serializeLedger(rowToLedger(row)))
  const usageFlags = await buildLedgerUsageFlags(existingLedgers)

  for (const row of existingRows) {
    if (!incomingIds.has(row.id)) {
      const ledger = rowToLedger(row)
      if (usageFlags[ledger.id]) {
        throw new Error(
          `Cannot delete "${ledger.name}" because transaction entries exist in current or past years.`,
        )
      }
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

  await reloadActiveLedgers()
  return getLedgersWithUsage()
}

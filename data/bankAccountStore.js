import { query } from '../db/connection.js'
import { parseJson } from '../db/init.js'
import { ensureUniqueRecordIds, generateId } from '../utils/recordIds.js'

const BANK_ACCOUNT_COLUMNS = `id, client_id, fy_id, business_id, bank_name, account_number, account_type,
  status, closed_in_fy_id, opening_balance, debit, credit, bank_charge, interest, closing_balance, sort_order,
  created_at, updated_at`

const BANK_ACCOUNT_TYPES = new Set(['savings', 'current', 'od', 'cc', 'fd', 'others'])

function n(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
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

function legacyCalcClosing(account) {
  return (
    n(account.openingBalance ?? account.opening_balance) +
    n(account.credit) -
    n(account.debit) -
    n(account.bankCharge ?? account.bank_charge) +
    n(account.interest)
  )
}

export function normalizeBankAccountTypeId(typeId) {
  const normalized = String(typeId || '').trim()
  return BANK_ACCOUNT_TYPES.has(normalized) ? normalized : 'current'
}

const BANK_ACCOUNT_STATUSES = new Set(['active', 'closed'])

function normalizeBankAccountStatus(status) {
  const normalized = String(status || '').trim()
  return BANK_ACCOUNT_STATUSES.has(normalized) ? normalized : 'active'
}

export function normalizeBankAccount(raw = {}) {
  const hasStoredClosing =
    (raw.closingBalance !== undefined && raw.closingBalance !== null) ||
    (raw.closing_balance !== undefined && raw.closing_balance !== null)

  const status = normalizeBankAccountStatus(raw.status)
  const closedInFyId = String(raw.closedInFyId ?? raw.closed_in_fy_id ?? '').trim()

  return {
    id: String(raw.id || generateId()).trim(),
    bankName: String(raw.bankName ?? raw.bank_name ?? '').trim(),
    accountNumber: String(raw.accountNumber ?? raw.account_number ?? '').trim(),
    accountType: normalizeBankAccountTypeId(raw.accountType ?? raw.account_type),
    status,
    closedInFyId: status === 'closed' && closedInFyId ? closedInFyId : undefined,
    openingBalance: n(raw.openingBalance ?? raw.opening_balance),
    debit: n(raw.debit),
    credit: n(raw.credit),
    bankCharge: n(raw.bankCharge ?? raw.bank_charge),
    interest: n(raw.interest),
    closingBalance: hasStoredClosing
      ? n(raw.closingBalance ?? raw.closing_balance)
      : legacyCalcClosing(raw),
  }
}

export function normalizeBankAccounts(accounts = []) {
  return (accounts || []).map((row) => normalizeBankAccount(row))
}

function isMeaningfulBankAccount(row) {
  const normalized = normalizeBankAccount(row)
  return Boolean(
    normalized.bankName ||
      normalized.accountNumber ||
      normalized.openingBalance ||
      normalized.debit ||
      normalized.credit ||
      normalized.bankCharge ||
      normalized.interest ||
      normalized.closingBalance,
  )
}

function serializeBankAccountRow(row) {
  return normalizeBankAccount({
    id: row.id,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    accountType: row.account_type,
    status: row.status,
    closedInFyId: row.closed_in_fy_id,
    openingBalance: row.opening_balance,
    debit: row.debit,
    credit: row.credit,
    bankCharge: row.bank_charge,
    interest: row.interest,
    closingBalance: row.closing_balance,
  })
}

async function fetchBankAccountRows(clientId, fyId, businessId) {
  return query(
    `SELECT ${BANK_ACCOUNT_COLUMNS}
     FROM bank_account_rows
     WHERE client_id = ? AND fy_id = ? AND business_id = ?
     ORDER BY sort_order ASC, created_at ASC`,
    [clientId, fyId, businessId],
  )
}

async function insertBankAccountRow(clientId, fyId, businessId, account, sortOrder, actor) {
  const normalized = normalizeBankAccount(account)
  const { userId, username, name } = buildActor(actor)

  await query(
    `INSERT INTO bank_account_rows (
       id, client_id, fy_id, business_id, bank_name, account_number, account_type,
       status, closed_in_fy_id, opening_balance, debit, credit, bank_charge, interest, closing_balance, sort_order,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalized.id,
      clientId,
      fyId,
      businessId,
      normalized.bankName,
      normalized.accountNumber,
      normalized.accountType,
      normalized.status,
      normalized.closedInFyId || null,
      normalized.openingBalance,
      normalized.debit,
      normalized.credit,
      normalized.bankCharge,
      normalized.interest,
      normalized.closingBalance,
      sortOrder,
      userId,
      username,
      name,
    ],
  )
}

async function updateBankAccountRow(clientId, fyId, businessId, account, sortOrder, actor) {
  const normalized = normalizeBankAccount(account)
  const { userId, username, name } = buildActor(actor)

  await query(
    `UPDATE bank_account_rows
     SET bank_name = ?,
         account_number = ?,
         account_type = ?,
         status = ?,
         closed_in_fy_id = ?,
         opening_balance = ?,
         debit = ?,
         credit = ?,
         bank_charge = ?,
         interest = ?,
         closing_balance = ?,
         sort_order = ?,
         updated_by_user_id = ?,
         updated_by_username = ?,
         updated_by_name = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND client_id = ? AND fy_id = ? AND business_id = ?`,
    [
      normalized.bankName,
      normalized.accountNumber,
      normalized.accountType,
      normalized.status,
      normalized.closedInFyId || null,
      normalized.openingBalance,
      normalized.debit,
      normalized.credit,
      normalized.bankCharge,
      normalized.interest,
      normalized.closingBalance,
      sortOrder,
      userId,
      username,
      name,
      normalized.id,
      clientId,
      fyId,
      businessId,
    ],
  )
}

async function getFyMeta(fyId) {
  const rows = await query(
    'SELECT label, start_year, end_year FROM financial_years WHERE id = ? LIMIT 1',
    [fyId],
  )

  if (!rows.length) {
    return { label: '', startYear: 0, endYear: 0 }
  }

  return {
    label: rows[0].label || '',
    startYear: Number(rows[0].start_year) || 0,
    endYear: Number(rows[0].end_year) || 0,
  }
}

async function upsertBankAccountHistory(clientId, businessId, fyId, fyMeta, account, actor) {
  const normalized = normalizeBankAccount(account)
  if (!isMeaningfulBankAccount(normalized)) {
    return
  }

  const { userId, username, name } = buildActor(actor)
  const historyId = `bankhist_${normalized.id}_${fyId}`

  await query(
    `INSERT INTO bank_account_history (
       id, client_id, business_id, fy_id, fy_label, fy_start_year,
       bank_account_id, bank_name, account_number, account_type,
       status, closed_in_fy_id,
       opening_balance, debit, credit, bank_charge, interest, closing_balance,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       fy_label = VALUES(fy_label),
       fy_start_year = VALUES(fy_start_year),
       bank_name = VALUES(bank_name),
       account_number = VALUES(account_number),
       account_type = VALUES(account_type),
       status = VALUES(status),
       closed_in_fy_id = VALUES(closed_in_fy_id),
       opening_balance = VALUES(opening_balance),
       debit = VALUES(debit),
       credit = VALUES(credit),
       bank_charge = VALUES(bank_charge),
       interest = VALUES(interest),
       closing_balance = VALUES(closing_balance),
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_by_username = VALUES(updated_by_username),
       updated_by_name = VALUES(updated_by_name),
       updated_at = CURRENT_TIMESTAMP`,
    [
      historyId,
      clientId,
      businessId,
      fyId,
      fyMeta.label,
      fyMeta.startYear,
      normalized.id,
      normalized.bankName,
      normalized.accountNumber,
      normalized.accountType,
      normalized.status,
      normalized.closedInFyId || null,
      normalized.openingBalance,
      normalized.debit,
      normalized.credit,
      normalized.bankCharge,
      normalized.interest,
      normalized.closingBalance,
      userId,
      username,
      name,
    ],
  )
}

async function syncBankAccountHistory(clientId, businessId, fyId, fyMeta, accounts, actor) {
  await query(
    'DELETE FROM bank_account_history WHERE client_id = ? AND business_id = ? AND fy_id = ?',
    [clientId, businessId, fyId],
  )

  for (const account of accounts) {
    await upsertBankAccountHistory(clientId, businessId, fyId, fyMeta, account, actor)
  }
}

function serializeHistoryRow(row) {
  return {
    id: row.id,
    fyId: row.fy_id,
    fyLabel: row.fy_label || '',
    fyStartYear: Number(row.fy_start_year) || 0,
    bankAccountId: row.bank_account_id || '',
    bankName: row.bank_name || '',
    accountNumber: row.account_number || '',
    accountType: normalizeBankAccountTypeId(row.account_type),
    status: normalizeBankAccountStatus(row.status),
    closedInFyId: row.closed_in_fy_id || undefined,
    openingBalance: n(row.opening_balance),
    debit: n(row.debit),
    credit: n(row.credit),
    bankCharge: n(row.bank_charge),
    interest: n(row.interest),
    closingBalance: n(row.closing_balance),
  }
}

export async function getBankAccountsForFs(clientId, fyId, businessId, legacyPayload = undefined) {
  const rows = await fetchBankAccountRows(clientId, fyId, businessId)
  if (rows.length) {
    return rows.map((row) => serializeBankAccountRow(row))
  }

  let payload = legacyPayload
  if (payload === undefined) {
    const fsRows = await query(
      'SELECT payload FROM fs_data WHERE client_id = ? AND fy_id = ? AND business_id = ? LIMIT 1',
      [clientId, fyId, businessId],
    )

    if (!fsRows.length) {
      return []
    }

    payload = parseJson(fsRows[0].payload)
  }

  if (!payload) {
    return []
  }

  const bankAccounts = payload?.bankAccounts
  if (!Array.isArray(bankAccounts) || bankAccounts.length === 0) {
    return []
  }

  return saveBankAccountsForFs(clientId, fyId, businessId, bankAccounts, null)
}

export async function saveBankAccountsForFs(clientId, fyId, businessId, bankAccounts, actor) {
  const normalizedAccounts = ensureUniqueRecordIds(
    normalizeBankAccounts(bankAccounts).filter(isMeaningfulBankAccount),
    (account) => account.id,
    (account, id) => ({ ...account, id }),
  )
  const incomingIds = new Set(normalizedAccounts.map((row) => row.id))
  const existingRows = await fetchBankAccountRows(clientId, fyId, businessId)
  const existingIds = new Set(existingRows.map((row) => row.id))

  for (const row of existingRows) {
    if (!incomingIds.has(row.id)) {
      await query(
        'DELETE FROM bank_account_rows WHERE id = ? AND client_id = ? AND fy_id = ? AND business_id = ?',
        [row.id, clientId, fyId, businessId],
      )
    }
  }

  for (let index = 0; index < normalizedAccounts.length; index += 1) {
    const account = normalizedAccounts[index]
    if (existingIds.has(account.id)) {
      await updateBankAccountRow(clientId, fyId, businessId, account, index, actor)
    } else {
      await insertBankAccountRow(clientId, fyId, businessId, account, index, actor)
      existingIds.add(account.id)
    }
  }

  const fyMeta = await getFyMeta(fyId)
  await syncBankAccountHistory(clientId, businessId, fyId, fyMeta, normalizedAccounts, actor)

  return getBankAccountsForFs(clientId, fyId, businessId)
}

export async function getBankAccountHistory(clientId, businessId, bankAccountId = null) {
  const params = [clientId, businessId]
  let sql = `SELECT id, client_id, business_id, fy_id, fy_label, fy_start_year,
                    bank_account_id, bank_name, account_number, account_type,
                    opening_balance, debit, credit, bank_charge, interest, closing_balance,
                    created_at, updated_at
             FROM bank_account_history
             WHERE client_id = ? AND business_id = ?`

  if (bankAccountId) {
    sql += ' AND bank_account_id = ?'
    params.push(bankAccountId)
  }

  sql += ' ORDER BY fy_start_year DESC, bank_name ASC, account_number ASC'

  const rows = await query(sql, params)
  return rows.map(serializeHistoryRow)
}

export async function deleteBankAccountsForFs(clientId, fyId, businessId) {
  await Promise.all([
    query('DELETE FROM bank_account_rows WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
      clientId,
      fyId,
      businessId,
    ]),
    query('DELETE FROM bank_account_history WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
      clientId,
      fyId,
      businessId,
    ]),
  ])
}

export async function deleteBankAccountsForBusiness(clientId, businessId) {
  await Promise.all([
    query('DELETE FROM bank_account_rows WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
    query('DELETE FROM bank_account_history WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
  ])
}

export async function deleteBankAccountsForFy(clientId, fyId) {
  await Promise.all([
    query('DELETE FROM bank_account_rows WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
    query('DELETE FROM bank_account_history WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
  ])
}

export async function deleteBankAccountsForFyAllClients(fyId) {
  await Promise.all([
    query('DELETE FROM bank_account_rows WHERE fy_id = ?', [fyId]),
    query('DELETE FROM bank_account_history WHERE fy_id = ?', [fyId]),
  ])
}

export async function migrateBankAccountsFromFsData() {
  const existing = await query('SELECT id FROM bank_account_rows LIMIT 1')
  if (existing.length) {
    return
  }

  const rows = await query('SELECT client_id, fy_id, business_id, payload FROM fs_data')
  for (const row of rows) {
    const payload = parseJson(row.payload)
    const bankAccounts = payload?.bankAccounts
    if (!Array.isArray(bankAccounts) || bankAccounts.length === 0) {
      continue
    }

    await saveBankAccountsForFs(row.client_id, row.fy_id, row.business_id, bankAccounts, null)
  }
}

import { query } from '../db/connection.js'
import { parseJson } from '../db/init.js'
import { ensureUniqueRecordIds, generateId } from '../utils/recordIds.js'

const BANK_ACCOUNT_TYPES = new Set(['savings', 'current', 'od', 'cc', 'fd', 'others'])
const BANK_ACCOUNT_STATUSES = new Set(['active', 'closed'])

const MASTER_COLUMNS = `id, client_id, business_id, bank_name, account_number, account_type,
  status, closed_in_fy_id, started_in_fy_id, sort_order, created_at, updated_at`

const FY_FIGURE_COLUMNS = `bank_account_id, client_id, business_id, fy_id,
  opening_balance, debit, credit, bank_charge, interest, closing_balance, sort_order,
  created_at, updated_at`

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
  const startedInFyId = String(raw.startedInFyId ?? raw.started_in_fy_id ?? '').trim()

  return {
    id: String(raw.id || generateId()).trim(),
    bankName: String(raw.bankName ?? raw.bank_name ?? '').trim(),
    accountNumber: String(raw.accountNumber ?? raw.account_number ?? '').trim(),
    accountType: normalizeBankAccountTypeId(raw.accountType ?? raw.account_type),
    status,
    closedInFyId: status === 'closed' && closedInFyId ? closedInFyId : undefined,
    startedInFyId: startedInFyId || undefined,
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

export function bankAccountHasEntries(account) {
  const normalized = normalizeBankAccount(account)
  return Boolean(
    normalized.openingBalance ||
      normalized.debit ||
      normalized.credit ||
      normalized.bankCharge ||
      normalized.interest ||
      normalized.closingBalance,
  )
}

function isBankAccountActive(account) {
  return normalizeBankAccountStatus(account?.status) === 'active'
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

function normalizeAccountNumberKey(accountNumber) {
  return String(accountNumber ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function assertNoDuplicateBankAccountNumbers(incomingAccounts, existingMasterRows) {
  for (const account of incomingAccounts) {
    const key = normalizeAccountNumberKey(account.accountNumber)
    if (!key) {
      continue
    }

    const duplicateIncoming = incomingAccounts.find(
      (other) =>
        other.id !== account.id && normalizeAccountNumberKey(other.accountNumber) === key,
    )
    if (duplicateIncoming) {
      throw new Error(formatBankAccountDuplicateError(account.accountNumber, duplicateIncoming))
    }

    const duplicateMaster = existingMasterRows.find(
      (master) =>
        master.id !== account.id && normalizeAccountNumberKey(master.account_number) === key,
    )
    if (duplicateMaster) {
      throw new Error(formatBankAccountDuplicateError(account.accountNumber, duplicateMaster))
    }
  }
}

function figureRowHasValues(row) {
  return Boolean(
    n(row.opening_balance ?? row.openingBalance) ||
      n(row.debit) ||
      n(row.credit) ||
      n(row.bank_charge ?? row.bankCharge) ||
      n(row.interest) ||
      n(row.closing_balance ?? row.closingBalance),
  )
}

function pickKeeperMasterRow(rows, fyStartYearById) {
  return [...rows].sort((left, right) => {
    const leftClosed = normalizeBankAccountStatus(left.status) === 'closed' ? 0 : 1
    const rightClosed = normalizeBankAccountStatus(right.status) === 'closed' ? 0 : 1
    if (leftClosed !== rightClosed) {
      return leftClosed - rightClosed
    }
    const startLeft = fyStartYearById.get(left.started_in_fy_id) ?? 9_999_999
    const startRight = fyStartYearById.get(right.started_in_fy_id) ?? 9_999_999
    if (startLeft !== startRight) {
      return startLeft - startRight
    }
    return String(left.created_at ?? '').localeCompare(String(right.created_at ?? ''))
  })[0]
}

function deduplicateIncomingBankAccounts(accounts) {
  const byKey = new Map()

  for (const account of accounts) {
    const key = normalizeAccountNumberKey(account.accountNumber)
    const mapKey = key || account.id
    const existing = byKey.get(mapKey)
    if (!existing) {
      byKey.set(mapKey, account)
      continue
    }

    const merged = normalizeBankAccount({
      ...existing,
      bankName: existing.bankName || account.bankName,
      accountType: existing.accountType || account.accountType,
      startedInFyId: existing.startedInFyId || account.startedInFyId,
      openingBalance: existing.openingBalance || account.openingBalance,
      debit: existing.debit || account.debit,
      credit: existing.credit || account.credit,
      bankCharge: existing.bankCharge || account.bankCharge,
      interest: existing.interest || account.interest,
      closingBalance: existing.closingBalance || account.closingBalance,
    })
    byKey.set(mapKey, { ...merged, id: existing.id })
  }

  return Array.from(byKey.values())
}

async function mergeDuplicateMasterIntoKeeper(clientId, businessId, keeperId, duplicateId) {
  if (keeperId === duplicateId) {
    return
  }

  const duplicateFigures = await query(
    `SELECT fy_id, opening_balance, debit, credit, bank_charge, interest, closing_balance
     FROM bank_account_fy_figures
     WHERE client_id = ? AND business_id = ? AND bank_account_id = ?`,
    [clientId, businessId, duplicateId],
  )

  for (const row of duplicateFigures) {
    const keeperRows = await query(
      `SELECT opening_balance, debit, credit, bank_charge, interest, closing_balance
       FROM bank_account_fy_figures
       WHERE client_id = ? AND business_id = ? AND bank_account_id = ? AND fy_id = ?`,
      [clientId, businessId, keeperId, row.fy_id],
    )

    if (!keeperRows.length) {
      await query(
        `UPDATE bank_account_fy_figures
         SET bank_account_id = ?
         WHERE client_id = ? AND business_id = ? AND bank_account_id = ? AND fy_id = ?`,
        [keeperId, clientId, businessId, duplicateId, row.fy_id],
      )
      continue
    }

    const keeperRow = keeperRows[0]
    if (!figureRowHasValues(keeperRow) && figureRowHasValues(row)) {
      await query(
        `UPDATE bank_account_fy_figures
         SET opening_balance = ?, debit = ?, credit = ?, bank_charge = ?, interest = ?, closing_balance = ?
         WHERE client_id = ? AND business_id = ? AND bank_account_id = ? AND fy_id = ?`,
        [
          row.opening_balance,
          row.debit,
          row.credit,
          row.bank_charge,
          row.interest,
          row.closing_balance,
          clientId,
          businessId,
          keeperId,
          row.fy_id,
        ],
      )
    }

    await query(
      `DELETE FROM bank_account_fy_figures
       WHERE client_id = ? AND business_id = ? AND bank_account_id = ? AND fy_id = ?`,
      [clientId, businessId, duplicateId, row.fy_id],
    )
  }

  await query(
    `UPDATE bank_account_history
     SET bank_account_id = ?
     WHERE client_id = ? AND business_id = ? AND bank_account_id = ?`,
    [keeperId, clientId, businessId, duplicateId],
  )

  await query('DELETE FROM bank_accounts WHERE id = ? AND client_id = ? AND business_id = ?', [
    duplicateId,
    clientId,
    businessId,
  ])
}

async function consolidateDuplicateBankMasters(clientId, businessId) {
  const fyStartYearById = await buildFyStartYearMap()
  const masters = await fetchMasterAccounts(clientId, businessId)
  const groups = new Map()

  for (const row of masters) {
    const key = normalizeAccountNumberKey(row.account_number)
    const groupKey = key || `id:${row.id}`
    const group = groups.get(groupKey) ?? []
    group.push(row)
    groups.set(groupKey, group)
  }

  for (const group of groups.values()) {
    if (group.length <= 1) {
      continue
    }
    const keeper = pickKeeperMasterRow(group, fyStartYearById)
    const closedRow = group.find(
      (row) => normalizeBankAccountStatus(row.status) === 'closed' && row.closed_in_fy_id,
    )
    if (closedRow && closedRow.id !== keeper.id) {
      await query(
        `UPDATE bank_accounts
         SET status = 'closed', closed_in_fy_id = ?
         WHERE id = ? AND client_id = ? AND business_id = ?`,
        [closedRow.closed_in_fy_id, keeper.id, clientId, businessId],
      )
    }
    for (const duplicate of group) {
      if (duplicate.id === keeper.id) {
        continue
      }
      await mergeDuplicateMasterIntoKeeper(clientId, businessId, keeper.id, duplicate.id)
    }
  }
}

function emptyFigures() {
  return {
    openingBalance: 0,
    debit: 0,
    credit: 0,
    bankCharge: 0,
    interest: 0,
    closingBalance: 0,
  }
}

function serializeMasterRow(row) {
  return normalizeBankAccount({
    id: row.id,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    accountType: row.account_type,
    status: row.status,
    closedInFyId: row.closed_in_fy_id,
    startedInFyId: row.started_in_fy_id,
    openingBalance: 0,
    debit: 0,
    credit: 0,
    bankCharge: 0,
    interest: 0,
    closingBalance: 0,
  })
}

function mergeMasterAndFigures(master, figures) {
  return normalizeBankAccount({
    ...master,
    openingBalance: figures.openingBalance,
    debit: figures.debit,
    credit: figures.credit,
    bankCharge: figures.bankCharge,
    interest: figures.interest,
    closingBalance: figures.closingBalance,
  })
}

function accountHasMovement(account) {
  const normalized = normalizeBankAccount(account)
  return Boolean(
    normalized.debit || normalized.credit || normalized.bankCharge || normalized.interest,
  )
}

function buildClosedYearByAccountNumberFromMasters(masters, fyStartYearById) {
  const map = new Map()

  for (const row of masters) {
    if (normalizeBankAccountStatus(row.status) !== 'closed' || !row.closed_in_fy_id) {
      continue
    }
    const key = normalizeAccountNumberKey(row.account_number)
    if (!key) {
      continue
    }
    const closedYear = fyStartYearById.get(row.closed_in_fy_id)
    if (closedYear === undefined) {
      continue
    }
    const existing = map.get(key)
    if (existing === undefined || closedYear < existing) {
      map.set(key, closedYear)
    }
  }

  return map
}

function isAccountVisibleInFy(
  account,
  currentFyMeta,
  startedFyId,
  fyStartYearById,
  closedYearByAccountNumber = new Map(),
) {
  const startedYear = startedFyId ? fyStartYearById.get(startedFyId) : 0
  if (startedYear !== undefined && startedYear > 0 && currentFyMeta.startYear < startedYear) {
    return false
  }

  const accountNumberKey = normalizeAccountNumberKey(account.accountNumber)
  if (accountNumberKey && closedYearByAccountNumber.has(accountNumberKey)) {
    const closedYear = closedYearByAccountNumber.get(accountNumberKey)
    if (currentFyMeta.startYear > closedYear) {
      return false
    }
  }

  if (isBankAccountActive(account)) {
    return true
  }

  if (account.closedInFyId) {
    const closedYear = fyStartYearById.get(account.closedInFyId)
    if (closedYear !== undefined && currentFyMeta.startYear > closedYear) {
      return false
    }
  }

  return true
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

async function buildFyStartYearMap() {
  const rows = await query('SELECT id, start_year FROM financial_years')
  return new Map(rows.map((row) => [row.id, Number(row.start_year) || 0]))
}

async function fetchMasterAccounts(clientId, businessId) {
  return query(
    `SELECT ${MASTER_COLUMNS}
     FROM bank_accounts
     WHERE client_id = ? AND business_id = ?
     ORDER BY sort_order ASC, created_at ASC`,
    [clientId, businessId],
  )
}

async function fetchFyFigureRows(clientId, businessId, fyId) {
  return query(
    `SELECT ${FY_FIGURE_COLUMNS}
     FROM bank_account_fy_figures
     WHERE client_id = ? AND business_id = ? AND fy_id = ?`,
    [clientId, businessId, fyId],
  )
}

async function fetchPriorFyClosingMap(clientId, businessId, priorStartYear) {
  if (priorStartYear <= 0) {
    return new Map()
  }

  const rows = await query(
    `SELECT f.bank_account_id, f.closing_balance, a.status, fy.start_year
     FROM bank_account_fy_figures f
     INNER JOIN bank_accounts a
       ON a.id = f.bank_account_id
      AND a.client_id = f.client_id
      AND a.business_id = f.business_id
     INNER JOIN financial_years fy ON fy.id = f.fy_id
     WHERE f.client_id = ? AND f.business_id = ? AND fy.start_year = ?`,
    [clientId, businessId, priorStartYear],
  )

  const map = new Map()
  for (const row of rows) {
    if (normalizeBankAccountStatus(row.status) === 'active') {
      map.set(row.bank_account_id, n(row.closing_balance))
    }
  }
  return map
}

async function getAccountIdsWithGlobalEntries(clientId, businessId) {
  const rows = await query(
    `SELECT DISTINCT bank_account_id AS account_id
     FROM bank_account_fy_figures
     WHERE client_id = ? AND business_id = ?
       AND (
         opening_balance <> 0 OR debit <> 0 OR credit <> 0
         OR bank_charge <> 0 OR interest <> 0 OR closing_balance <> 0
       )
     UNION
     SELECT DISTINCT bank_account_id AS account_id
     FROM bank_account_history
     WHERE client_id = ? AND business_id = ?
       AND (
         opening_balance <> 0 OR debit <> 0 OR credit <> 0
         OR bank_charge <> 0 OR interest <> 0 OR closing_balance <> 0
       )
     UNION
     SELECT DISTINCT id AS account_id
     FROM bank_account_rows
     WHERE client_id = ? AND business_id = ?
       AND (
         opening_balance <> 0 OR debit <> 0 OR credit <> 0
         OR bank_charge <> 0 OR interest <> 0 OR closing_balance <> 0
       )`,
    [clientId, businessId, clientId, businessId, clientId, businessId],
  )
  return new Set(rows.map((row) => row.account_id).filter(Boolean))
}

async function upsertMasterAccount(clientId, businessId, account, sortOrder, actor) {
  const normalized = normalizeBankAccount(account)
  const { userId, username, name } = buildActor(actor)

  await query(
    `INSERT INTO bank_accounts (
       id, client_id, business_id, bank_name, account_number, account_type,
       status, closed_in_fy_id, started_in_fy_id, sort_order,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       bank_name = VALUES(bank_name),
       account_number = VALUES(account_number),
       account_type = VALUES(account_type),
       status = VALUES(status),
       closed_in_fy_id = VALUES(closed_in_fy_id),
       started_in_fy_id = VALUES(started_in_fy_id),
       sort_order = VALUES(sort_order),
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_by_username = VALUES(updated_by_username),
       updated_by_name = VALUES(updated_by_name),
       updated_at = CURRENT_TIMESTAMP`,
    [
      normalized.id,
      clientId,
      businessId,
      normalized.bankName,
      normalized.accountNumber,
      normalized.accountType,
      normalized.status,
      normalized.closedInFyId || null,
      normalized.startedInFyId || null,
      sortOrder,
      userId,
      username,
      name,
    ],
  )
}

async function upsertFyFigures(clientId, businessId, fyId, account, sortOrder, actor) {
  const normalized = normalizeBankAccount(account)
  const { userId, username, name } = buildActor(actor)

  await query(
    `INSERT INTO bank_account_fy_figures (
       bank_account_id, client_id, business_id, fy_id,
       opening_balance, debit, credit, bank_charge, interest, closing_balance, sort_order,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       opening_balance = VALUES(opening_balance),
       debit = VALUES(debit),
       credit = VALUES(credit),
       bank_charge = VALUES(bank_charge),
       interest = VALUES(interest),
       closing_balance = VALUES(closing_balance),
       sort_order = VALUES(sort_order),
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_by_username = VALUES(updated_by_username),
       updated_by_name = VALUES(updated_by_name),
       updated_at = CURRENT_TIMESTAMP`,
    [
      normalized.id,
      clientId,
      businessId,
      fyId,
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

async function deleteBankAccountGlobally(clientId, businessId, bankAccountId) {
  await Promise.all([
    query(
      'DELETE FROM bank_accounts WHERE id = ? AND client_id = ? AND business_id = ?',
      [bankAccountId, clientId, businessId],
    ),
    query(
      'DELETE FROM bank_account_fy_figures WHERE bank_account_id = ? AND client_id = ? AND business_id = ?',
      [bankAccountId, clientId, businessId],
    ),
    query(
      'DELETE FROM bank_account_history WHERE bank_account_id = ? AND client_id = ? AND business_id = ?',
      [bankAccountId, clientId, businessId],
    ),
    query(
      'DELETE FROM bank_account_rows WHERE id = ? AND client_id = ? AND business_id = ?',
      [bankAccountId, clientId, businessId],
    ),
    query(
      'DELETE FROM bank_account_exclusions WHERE bank_account_id = ? AND client_id = ? AND business_id = ?',
      [bankAccountId, clientId, businessId],
    ),
  ])
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
       status, closed_in_fy_id, started_in_fy_id,
       opening_balance, debit, credit, bank_charge, interest, closing_balance,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       fy_label = VALUES(fy_label),
       fy_start_year = VALUES(fy_start_year),
       bank_name = VALUES(bank_name),
       account_number = VALUES(account_number),
       account_type = VALUES(account_type),
       status = VALUES(status),
       closed_in_fy_id = VALUES(closed_in_fy_id),
       started_in_fy_id = VALUES(started_in_fy_id),
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
      normalized.startedInFyId || null,
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
    startedInFyId: row.started_in_fy_id || undefined,
    openingBalance: n(row.opening_balance),
    debit: n(row.debit),
    credit: n(row.credit),
    bankCharge: n(row.bank_charge),
    interest: n(row.interest),
    closingBalance: n(row.closing_balance),
  }
}

async function buildAccountsForFy(clientId, fyId, businessId) {
  const fyMeta = await getFyMeta(fyId)
  const fyStartYearById = await buildFyStartYearMap()
  const masters = await fetchMasterAccounts(clientId, businessId)
  const figureRows = await fetchFyFigureRows(clientId, businessId, fyId)
  const figuresById = new Map(
    figureRows.map((row) => [
      row.bank_account_id,
      {
        openingBalance: n(row.opening_balance),
        debit: n(row.debit),
        credit: n(row.credit),
        bankCharge: n(row.bank_charge),
        interest: n(row.interest),
        closingBalance: n(row.closing_balance),
      },
    ]),
  )
  const globalEntryIds = await getAccountIdsWithGlobalEntries(clientId, businessId)
  const priorClosingById = await fetchPriorFyClosingMap(
    clientId,
    businessId,
    fyMeta.startYear - 1,
  )
  const closedYearByAccountNumber = buildClosedYearByAccountNumberFromMasters(
    masters,
    fyStartYearById,
  )

  const accounts = []
  for (const masterRow of masters) {
    const master = serializeMasterRow(masterRow)
    const startedFyId = master.startedInFyId || fyId
    if (
      !isAccountVisibleInFy(
        master,
        fyMeta,
        startedFyId,
        fyStartYearById,
        closedYearByAccountNumber,
      )
    ) {
      continue
    }

    const figures = figuresById.get(master.id) || emptyFigures()
    let account = mergeMasterAndFigures({ ...master, startedInFyId: startedFyId }, figures)

    const priorClosing = priorClosingById.get(master.id)
    if (
      priorClosing !== undefined &&
      isBankAccountActive(account) &&
      !accountHasMovement(account) &&
      account.openingBalance === 0 &&
      account.closingBalance === 0
    ) {
      account = {
        ...account,
        openingBalance: priorClosing,
        closingBalance: priorClosing,
      }
    }

    accounts.push({
      ...account,
      hasEntries: globalEntryIds.has(account.id),
    })
  }

  return accounts.sort((left, right) => {
    const nameCompare = left.bankName.localeCompare(right.bankName)
    if (nameCompare !== 0) {
      return nameCompare
    }
    return left.accountNumber.localeCompare(right.accountNumber)
  })
}

export async function migrateBankAccountsToGlobalModel() {
  const existing = await query('SELECT id FROM bank_accounts LIMIT 1')
  if (existing.length) {
    return
  }

  const legacyRows = await query(
    `SELECT r.*, fy.start_year AS fy_start_year
     FROM bank_account_rows r
     LEFT JOIN financial_years fy ON fy.id = r.fy_id
     ORDER BY fy.start_year ASC, r.sort_order ASC, r.created_at ASC`,
  )
  if (!legacyRows.length) {
    return
  }

  const exclusions = await query('SELECT client_id, business_id, bank_account_id FROM bank_account_exclusions')
  const excludedKeys = new Set(
    exclusions.map((row) => `${row.client_id}|${row.business_id}|${row.bank_account_id}`),
  )

  const masterByKey = new Map()
  for (const row of legacyRows) {
    const key = `${row.client_id}|${row.business_id}|${row.id}`
    if (excludedKeys.has(key)) {
      continue
    }
    if (!masterByKey.has(key)) {
      masterByKey.set(key, row)
    }
  }

  for (const row of masterByKey.values()) {
    await query(
      `INSERT INTO bank_accounts (
         id, client_id, business_id, bank_name, account_number, account_type,
         status, closed_in_fy_id, started_in_fy_id, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         bank_name = VALUES(bank_name),
         account_number = VALUES(account_number),
         account_type = VALUES(account_type),
         status = VALUES(status),
         closed_in_fy_id = VALUES(closed_in_fy_id),
         started_in_fy_id = VALUES(started_in_fy_id)`,
      [
        row.id,
        row.client_id,
        row.business_id,
        row.bank_name,
        row.account_number,
        row.account_type,
        row.status,
        row.closed_in_fy_id,
        row.started_in_fy_id || row.fy_id,
        row.sort_order,
      ],
    )
  }

  for (const row of legacyRows) {
    const key = `${row.client_id}|${row.business_id}|${row.id}`
    if (excludedKeys.has(key) || !masterByKey.has(key)) {
      continue
    }

    await query(
      `INSERT INTO bank_account_fy_figures (
         bank_account_id, client_id, business_id, fy_id,
         opening_balance, debit, credit, bank_charge, interest, closing_balance, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         opening_balance = VALUES(opening_balance),
         debit = VALUES(debit),
         credit = VALUES(credit),
         bank_charge = VALUES(bank_charge),
         interest = VALUES(interest),
         closing_balance = VALUES(closing_balance),
         sort_order = VALUES(sort_order)`,
      [
        row.id,
        row.client_id,
        row.business_id,
        row.fy_id,
        row.opening_balance,
        row.debit,
        row.credit,
        row.bank_charge,
        row.interest,
        row.closing_balance,
        row.sort_order,
      ],
    )
  }
}

export async function getBankAccountsForFs(clientId, fyId, businessId, legacyPayload = undefined) {
  await migrateBankAccountsToGlobalModel()

  const masters = await fetchMasterAccounts(clientId, businessId)
  if (!masters.length) {
    let payload = legacyPayload
    if (payload === undefined) {
      const fsRows = await query(
        'SELECT payload FROM fs_data WHERE client_id = ? AND fy_id = ? AND business_id = ? LIMIT 1',
        [clientId, fyId, businessId],
      )
      payload = fsRows.length ? parseJson(fsRows[0].payload) : null
    }

    const bankAccounts = payload?.bankAccounts
    if (Array.isArray(bankAccounts) && bankAccounts.length > 0) {
      return saveBankAccountsForFs(clientId, fyId, businessId, bankAccounts, null)
    }
  }

  await consolidateDuplicateBankMasters(clientId, businessId)
  return buildAccountsForFy(clientId, fyId, businessId)
}

export async function saveBankAccountsForFs(clientId, fyId, businessId, bankAccounts, actor) {
  await migrateBankAccountsToGlobalModel()
  await consolidateDuplicateBankMasters(clientId, businessId)

  const normalizedAccounts = ensureUniqueRecordIds(
    deduplicateIncomingBankAccounts(
      normalizeBankAccounts(bankAccounts)
        .map((account) => ({
          ...account,
          startedInFyId: account.startedInFyId || fyId,
        }))
        .filter(isMeaningfulBankAccount),
    ),
    (account) => account.id,
    (account, id) => ({ ...account, id }),
  )
  const incomingIds = new Set(normalizedAccounts.map((row) => row.id))
  const existingMasters = await fetchMasterAccounts(clientId, businessId)
  const existingFyFigureIds = new Set(
    (await fetchFyFigureRows(clientId, businessId, fyId)).map((row) => row.bank_account_id),
  )
  const globalEntryIds = await getAccountIdsWithGlobalEntries(clientId, businessId)

  assertNoDuplicateBankAccountNumbers(normalizedAccounts, existingMasters)

  for (const master of existingMasters) {
    if (incomingIds.has(master.id)) {
      continue
    }

    // Only remove when explicitly dropped from this FY's bank list.
    if (!existingFyFigureIds.has(master.id)) {
      continue
    }

    if (globalEntryIds.has(master.id)) {
      const label = master.bank_name || 'bank account'
      throw new Error(
        `Cannot delete ${label} — figures exist in one or more financial years.`,
      )
    }

    await deleteBankAccountGlobally(clientId, businessId, master.id)
  }

  for (let index = 0; index < normalizedAccounts.length; index += 1) {
    const account = normalizedAccounts[index]
    await upsertMasterAccount(clientId, businessId, account, index, actor)
    await upsertFyFigures(clientId, businessId, fyId, account, index, actor)
  }

  const fyMeta = await getFyMeta(fyId)
  await syncBankAccountHistory(clientId, businessId, fyId, fyMeta, normalizedAccounts, actor)

  return buildAccountsForFy(clientId, fyId, businessId)
}

export async function getBankAccountHistory(clientId, businessId, bankAccountId = null) {
  const params = [clientId, businessId]
  let sql = `SELECT id, client_id, business_id, fy_id, fy_label, fy_start_year,
                    bank_account_id, bank_name, account_number, account_type,
                    status, closed_in_fy_id, started_in_fy_id,
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
    query(
      'DELETE FROM bank_account_fy_figures WHERE client_id = ? AND fy_id = ? AND business_id = ?',
      [clientId, fyId, businessId],
    ),
    query(
      'DELETE FROM bank_account_history WHERE client_id = ? AND fy_id = ? AND business_id = ?',
      [clientId, fyId, businessId],
    ),
    query(
      'DELETE FROM bank_account_rows WHERE client_id = ? AND fy_id = ? AND business_id = ?',
      [clientId, fyId, businessId],
    ),
  ])
}

export async function deleteBankAccountsForBusiness(clientId, businessId) {
  await Promise.all([
    query('DELETE FROM bank_accounts WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
    query('DELETE FROM bank_account_fy_figures WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
    query('DELETE FROM bank_account_history WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
    query('DELETE FROM bank_account_rows WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
    query('DELETE FROM bank_account_exclusions WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
  ])
}

export async function deleteBankAccountsForFy(clientId, fyId) {
  await Promise.all([
    query('DELETE FROM bank_account_fy_figures WHERE client_id = ? AND fy_id = ?', [
      clientId,
      fyId,
    ]),
    query('DELETE FROM bank_account_history WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
    query('DELETE FROM bank_account_rows WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
  ])
}

export async function deleteBankAccountsForFyAllClients(fyId) {
  await Promise.all([
    query('DELETE FROM bank_account_fy_figures WHERE fy_id = ?', [fyId]),
    query('DELETE FROM bank_account_history WHERE fy_id = ?', [fyId]),
    query('DELETE FROM bank_account_rows WHERE fy_id = ?', [fyId]),
  ])
}

export async function migrateBankAccountsFromFsData() {
  await migrateBankAccountsToGlobalModel()

  const existing = await query('SELECT id FROM bank_accounts LIMIT 1')
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

export async function backfillBankAccountStartedInFyFromHistory() {
  const historyRows = await query(
    `SELECT client_id, business_id, bank_account_id, fy_id, fy_start_year, started_in_fy_id
     FROM bank_account_history
     ORDER BY fy_start_year ASC, fy_id ASC`,
  )

  const earliestByAccount = new Map()
  for (const row of historyRows) {
    const key = `${row.client_id}|${row.business_id}|${row.bank_account_id}`
    if (!earliestByAccount.has(key)) {
      earliestByAccount.set(key, row.started_in_fy_id || row.fy_id)
    }
  }

  const accountRows = await query(
    `SELECT id, client_id, business_id, started_in_fy_id FROM bank_accounts`,
  )

  for (const row of accountRows) {
    if (row.started_in_fy_id) {
      continue
    }

    const key = `${row.client_id}|${row.business_id}|${row.id}`
    const started = earliestByAccount.get(key)
    if (!started) {
      continue
    }

    await query(
      `UPDATE bank_accounts
       SET started_in_fy_id = ?
       WHERE id = ? AND client_id = ? AND business_id = ?`,
      [started, row.id, row.client_id, row.business_id],
    )
  }

  for (const row of historyRows) {
    if (row.started_in_fy_id) {
      continue
    }

    const key = `${row.client_id}|${row.business_id}|${row.bank_account_id}`
    const started = earliestByAccount.get(key) || row.fy_id
    await query(
      `UPDATE bank_account_history
       SET started_in_fy_id = ?
       WHERE client_id = ? AND business_id = ? AND bank_account_id = ? AND fy_id = ?`,
      [started, row.client_id, row.business_id, row.bank_account_id, row.fy_id],
    )
  }
}

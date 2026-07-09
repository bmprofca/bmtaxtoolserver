import { query } from '../db/connection.js'
import { parseJson } from '../db/init.js'
import { ensureUniqueRecordIds, generateId } from '../utils/recordIds.js'
import {
  computeLoanForFinancialYear,
  isLoanFullyRepaid,
  mergeCashFlowByYear,
  migrateRepaymentSchedule,
  summarizeLoans,
} from '../utils/loanCalculator.js'

const LOAN_COLUMNS = `id, client_id, fy_id, business_id, lender, loan_type,
  opening_balance, disbursement, disbursement_date, interest_rate, tenure_months,
  emi_start_date, prepayment_amount, prepayment_date, is_closed, sort_order, created_at, updated_at`

const LOAN_TYPES = new Set(['long-term', 'short-term'])

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

function normalizeLoanMonthField(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) {
    return ''
  }

  const match = trimmed.match(/^(\d{4})-(\d{2})/)
  if (!match) {
    return ''
  }

  return `${match[1]}-${match[2]}-01`
}

function toDateString(value) {
  if (!value) {
    return ''
  }

  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  return normalizeLoanMonthField(value) || String(value).trim().slice(0, 10)
}

function normalizeLoanType(value) {
  const normalized = String(value || '').trim()
  return LOAN_TYPES.has(normalized) ? normalized : 'long-term'
}

export function normalizeLoanRecord(raw = {}) {
  return {
    id: String(raw.id || generateId()).trim(),
    lender: String(raw.lender ?? '').trim(),
    loanType: normalizeLoanType(raw.loanType ?? raw.loan_type),
    openingBalance: n(raw.openingBalance ?? raw.opening_balance),
    disbursement: n(raw.disbursement),
    disbursementDate: toDateString(raw.disbursementDate ?? raw.disbursement_date),
    interestRate: n(raw.interestRate ?? raw.interest_rate),
    tenureMonths: Math.max(0, Math.floor(n(raw.tenureMonths ?? raw.tenure_months))),
    emiStartDate: toDateString(raw.emiStartDate ?? raw.emi_start_date),
    prepaymentAmount: n(raw.prepaymentAmount ?? raw.prepayment_amount),
    prepaymentDate: toDateString(raw.prepaymentDate ?? raw.prepayment_date),
  }
}

export function normalizeLoanRecords(loans = []) {
  return (loans || []).map((loan) => normalizeLoanRecord(loan))
}

function isMeaningfulLoan(row) {
  const normalized = normalizeLoanRecord(row)
  return Boolean(
    normalized.lender ||
      normalized.openingBalance ||
      normalized.disbursement ||
      normalized.interestRate ||
      normalized.prepaymentAmount,
  )
}

function serializeLoanRow(row) {
  return normalizeLoanRecord({
    id: row.id,
    lender: row.lender,
    loanType: row.loan_type,
    openingBalance: row.opening_balance,
    disbursement: row.disbursement,
    disbursementDate: row.disbursement_date,
    interestRate: row.interest_rate,
    tenureMonths: row.tenure_months,
    emiStartDate: row.emi_start_date,
    prepaymentAmount: row.prepayment_amount,
    prepaymentDate: row.prepayment_date,
  })
}

async function fetchLoanRows(clientId, fyId, businessId) {
  return query(
    `SELECT ${LOAN_COLUMNS}
     FROM loan_records
     WHERE client_id = ? AND fy_id = ? AND business_id = ?
     ORDER BY sort_order ASC, created_at ASC`,
    [clientId, fyId, businessId],
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

async function insertLoanRow(clientId, fyId, businessId, loan, sortOrder, isClosed, actor) {
  const normalized = normalizeLoanRecord(loan)
  const { userId, username, name } = buildActor(actor)

  await query(
    `INSERT INTO loan_records (
       id, client_id, fy_id, business_id, lender, loan_type,
       opening_balance, disbursement, disbursement_date, interest_rate, tenure_months,
       emi_start_date, prepayment_amount, prepayment_date, is_closed, sort_order,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalized.id,
      clientId,
      fyId,
      businessId,
      normalized.lender,
      normalized.loanType,
      normalized.openingBalance,
      normalized.disbursement,
      toDateString(normalized.disbursementDate) || null,
      normalized.interestRate,
      normalized.tenureMonths,
      toDateString(normalized.emiStartDate) || null,
      normalized.prepaymentAmount,
      toDateString(normalized.prepaymentDate) || null,
      isClosed ? 1 : 0,
      sortOrder,
      userId,
      username,
      name,
    ],
  )
}

async function updateLoanRow(clientId, fyId, businessId, loan, sortOrder, isClosed, actor) {
  const normalized = normalizeLoanRecord(loan)
  const { userId, username, name } = buildActor(actor)

  await query(
    `UPDATE loan_records
     SET lender = ?,
         loan_type = ?,
         opening_balance = ?,
         disbursement = ?,
         disbursement_date = ?,
         interest_rate = ?,
         tenure_months = ?,
         emi_start_date = ?,
         prepayment_amount = ?,
         prepayment_date = ?,
         is_closed = ?,
         sort_order = ?,
         updated_by_user_id = ?,
         updated_by_username = ?,
         updated_by_name = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND client_id = ? AND fy_id = ? AND business_id = ?`,
    [
      normalized.lender,
      normalized.loanType,
      normalized.openingBalance,
      normalized.disbursement,
      toDateString(normalized.disbursementDate) || null,
      normalized.interestRate,
      normalized.tenureMonths,
      toDateString(normalized.emiStartDate) || null,
      normalized.prepaymentAmount,
      toDateString(normalized.prepaymentDate) || null,
      isClosed ? 1 : 0,
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

async function syncScheduleRows(clientId, businessId, fyId, loanId, historyId, schedule) {
  await query(
    'DELETE FROM loan_schedule_rows WHERE client_id = ? AND business_id = ? AND fy_id = ? AND loan_id = ?',
    [clientId, businessId, fyId, loanId],
  )

  for (let index = 0; index < (schedule || []).length; index += 1) {
    const row = schedule[index]
    const rowId = `loansched_${loanId}_${fyId}_${index + 1}`

    await query(
      `INSERT INTO loan_schedule_rows (
         id, client_id, business_id, fy_id, loan_id, loan_history_id,
         serial_no, month, month_label, year, emi, principal, interest, balance,
         is_prepayment, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rowId,
        clientId,
        businessId,
        fyId,
        loanId,
        historyId,
        Math.max(0, Math.floor(n(row.serialNo))),
        Math.max(0, Math.floor(n(row.month))),
        String(row.monthLabel || '').slice(0, 10),
        Math.max(0, Math.floor(n(row.year))),
        n(row.emi),
        n(row.principal),
        n(row.interest),
        n(row.balance),
        row.isPrepayment ? 1 : 0,
        index,
      ],
    )
  }
}

async function fetchScheduleRows(clientId, businessId, fyId, loanId) {
  return query(
    `SELECT serial_no, month, month_label, year, emi, principal, interest, balance, is_prepayment
     FROM loan_schedule_rows
     WHERE client_id = ? AND business_id = ? AND fy_id = ? AND loan_id = ?
     ORDER BY sort_order ASC, serial_no ASC`,
    [clientId, businessId, fyId, loanId],
  )
}

function serializeScheduleRow(row) {
  return {
    serialNo: Number(row.serial_no) || 0,
    month: Number(row.month) || 0,
    monthLabel: row.month_label || '',
    year: Number(row.year) || 0,
    emi: n(row.emi),
    principal: n(row.principal),
    interest: n(row.interest),
    balance: n(row.balance),
    ...(row.is_prepayment ? { isPrepayment: true } : {}),
  }
}

async function loadMonthlySchedule(clientId, businessId, fyId, loanId, fallbackJson) {
  const rows = await fetchScheduleRows(clientId, businessId, fyId, loanId)
  if (rows.length) {
    return rows.map(serializeScheduleRow)
  }

  return parseJson(fallbackJson) || []
}

async function syncLoanFySummary(clientId, businessId, fyId, fyMeta, computedLoans, actor) {
  const summary = summarizeLoans(computedLoans)
  const consolidatedCashFlow = mergeCashFlowByYear(computedLoans)
  const { userId, username, name } = buildActor(actor)
  const summaryId = `loansum_${clientId}_${businessId}_${fyId}`

  await query(
    `INSERT INTO loan_fy_summary (
       id, client_id, fy_id, business_id, fy_label, fy_start_year,
       long_term_closing, short_term_closing, total_interest, total_principal_repaid,
       consolidated_cash_flow,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       fy_label = VALUES(fy_label),
       fy_start_year = VALUES(fy_start_year),
       long_term_closing = VALUES(long_term_closing),
       short_term_closing = VALUES(short_term_closing),
       total_interest = VALUES(total_interest),
       total_principal_repaid = VALUES(total_principal_repaid),
       consolidated_cash_flow = VALUES(consolidated_cash_flow),
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_by_username = VALUES(updated_by_username),
       updated_by_name = VALUES(updated_by_name),
       updated_at = CURRENT_TIMESTAMP`,
    [
      summaryId,
      clientId,
      fyId,
      businessId,
      fyMeta.label,
      fyMeta.startYear,
      summary.longTermClosing,
      summary.shortTermClosing,
      summary.totalInterest,
      summary.totalPrincipalRepaid,
      JSON.stringify(consolidatedCashFlow),
      userId,
      username,
      name,
    ],
  )

  return {
    fyId,
    fyLabel: fyMeta.label,
    fyStartYear: fyMeta.startYear,
    longTermClosing: summary.longTermClosing,
    shortTermClosing: summary.shortTermClosing,
    totalInterest: summary.totalInterest,
    totalPrincipalRepaid: summary.totalPrincipalRepaid,
    consolidatedCashFlow,
  }
}

async function upsertLoanHistory(
  clientId,
  businessId,
  fyId,
  fyMeta,
  loan,
  computed,
  actor,
) {
  const normalized = normalizeLoanRecord(loan)
  const { userId, username, name } = buildActor(actor)
  const historyId = `loanhist_${normalized.id}_${fyId}`

  await query(
    `INSERT INTO loan_history (
       id, client_id, business_id, fy_id, fy_label, fy_start_year, loan_id,
       lender, loan_type, opening_balance, disbursement, disbursement_date,
       interest_rate, tenure_months, emi_start_date, prepayment_amount, prepayment_date,
       emi_amount, interest_for_year, principal_repaid, closing_balance, monthly_schedule,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       fy_label = VALUES(fy_label),
       fy_start_year = VALUES(fy_start_year),
       lender = VALUES(lender),
       loan_type = VALUES(loan_type),
       opening_balance = VALUES(opening_balance),
       disbursement = VALUES(disbursement),
       disbursement_date = VALUES(disbursement_date),
       interest_rate = VALUES(interest_rate),
       tenure_months = VALUES(tenure_months),
       emi_start_date = VALUES(emi_start_date),
       prepayment_amount = VALUES(prepayment_amount),
       prepayment_date = VALUES(prepayment_date),
       emi_amount = VALUES(emi_amount),
       interest_for_year = VALUES(interest_for_year),
       principal_repaid = VALUES(principal_repaid),
       closing_balance = VALUES(closing_balance),
       monthly_schedule = VALUES(monthly_schedule),
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
      normalized.lender,
      normalized.loanType,
      normalized.openingBalance,
      normalized.disbursement,
      toDateString(normalized.disbursementDate) || null,
      normalized.interestRate,
      normalized.tenureMonths,
      toDateString(normalized.emiStartDate) || null,
      normalized.prepaymentAmount,
      toDateString(normalized.prepaymentDate) || null,
      computed.emiAmount,
      computed.interestForYear,
      computed.principalRepaid,
      computed.closingBalance,
      JSON.stringify([]),
      userId,
      username,
      name,
    ],
  )

  await syncScheduleRows(
    clientId,
    businessId,
    fyId,
    normalized.id,
    historyId,
    computed.monthlySchedule || [],
  )
}

async function syncLoanHistory(clientId, businessId, fyId, fyMeta, loans, actor) {
  await query('DELETE FROM loan_schedule_rows WHERE client_id = ? AND business_id = ? AND fy_id = ?', [
    clientId,
    businessId,
    fyId,
  ])
  await query('DELETE FROM loan_history WHERE client_id = ? AND business_id = ? AND fy_id = ?', [
    clientId,
    businessId,
    fyId,
  ])

  const computedLoans = []

  for (const loan of loans) {
    const computed = computeLoanForFinancialYear(loan, fyMeta.startYear, fyMeta.endYear)
    computedLoans.push(computed)
    await upsertLoanHistory(clientId, businessId, fyId, fyMeta, loan, computed, actor)
  }

  if (fyMeta.startYear && fyMeta.endYear) {
    await syncLoanFySummary(clientId, businessId, fyId, fyMeta, computedLoans, actor)
  } else if (!loans.length) {
    await query(
      'DELETE FROM loan_fy_summary WHERE client_id = ? AND fy_id = ? AND business_id = ?',
      [clientId, fyId, businessId],
    )
  }

  return computedLoans
}

function serializeHistoryRow(row, monthlySchedule) {
  const loanRecord = normalizeLoanRecord({
    id: row.loan_id,
    lender: row.lender,
    loanType: row.loan_type,
    openingBalance: row.opening_balance,
    disbursement: row.disbursement,
    disbursementDate: row.disbursement_date,
    interestRate: row.interest_rate,
    tenureMonths: row.tenure_months,
    emiStartDate: row.emi_start_date,
    prepaymentAmount: row.prepayment_amount,
    prepaymentDate: row.prepayment_date,
  })

  return {
    id: row.id,
    fyId: row.fy_id,
    fyLabel: row.fy_label || '',
    fyStartYear: Number(row.fy_start_year) || 0,
    loanId: row.loan_id,
    loan: loanRecord,
    emiAmount: n(row.emi_amount),
    interestForYear: n(row.interest_for_year),
    principalRepaid: n(row.principal_repaid),
    closingBalance: n(row.closing_balance),
    monthlySchedule: monthlySchedule || [],
  }
}

export async function getLoansForFs(clientId, fyId, businessId) {
  const rows = await fetchLoanRows(clientId, fyId, businessId)
  if (rows.length) {
    return rows.map((row) => serializeLoanRow(row))
  }

  const fsRows = await query(
    'SELECT payload FROM fs_data WHERE client_id = ? AND fy_id = ? AND business_id = ? LIMIT 1',
    [clientId, fyId, businessId],
  )

  if (!fsRows.length) {
    return []
  }

  const payload = parseJson(fsRows[0].payload)
  const legacyLoans = await migrateLegacyRepaymentFromPayload(payload, fyId)
  if (!legacyLoans.length) {
    return []
  }

  return saveLoansForFs(clientId, fyId, businessId, legacyLoans, null)
}

export async function saveLoansForFs(clientId, fyId, businessId, loans, actor) {
  const normalizedLoans = ensureUniqueRecordIds(
    normalizeLoanRecords(loans).filter(isMeaningfulLoan),
    (loan) => loan.id,
    (loan, id) => ({ ...loan, id }),
  )
  const incomingIds = new Set(normalizedLoans.map((row) => row.id))
  const existingRows = await fetchLoanRows(clientId, fyId, businessId)
  const existingIds = new Set(existingRows.map((row) => row.id))

  for (const row of existingRows) {
    if (!incomingIds.has(row.id)) {
      await query(
        'DELETE FROM loan_records WHERE id = ? AND client_id = ? AND fy_id = ? AND business_id = ?',
        [row.id, clientId, fyId, businessId],
      )
    }
  }

  const fyMeta = await getFyMeta(fyId)

  for (let index = 0; index < normalizedLoans.length; index += 1) {
    const loan = normalizedLoans[index]
    const computed =
      fyMeta.startYear && fyMeta.endYear
        ? computeLoanForFinancialYear(loan, fyMeta.startYear, fyMeta.endYear)
        : null
    const isClosed = computed ? isLoanFullyRepaid(computed) : false

    if (existingIds.has(loan.id)) {
      await updateLoanRow(clientId, fyId, businessId, loan, index, isClosed, actor)
    } else {
      await insertLoanRow(clientId, fyId, businessId, loan, index, isClosed, actor)
      existingIds.add(loan.id)
    }
  }

  if (fyMeta.startYear && fyMeta.endYear) {
    await syncLoanHistory(clientId, businessId, fyId, fyMeta, normalizedLoans, actor)
  } else if (!normalizedLoans.length) {
    await Promise.all([
      query('DELETE FROM loan_schedule_rows WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
        clientId,
        fyId,
        businessId,
      ]),
      query('DELETE FROM loan_history WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
        clientId,
        fyId,
        businessId,
      ]),
      query('DELETE FROM loan_fy_summary WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
        clientId,
        fyId,
        businessId,
      ]),
    ])
  }

  return getLoansForFs(clientId, fyId, businessId)
}

export async function getLoanHistory(clientId, businessId, loanId = null) {
  const params = [clientId, businessId]
  let sql = `SELECT id, client_id, business_id, fy_id, fy_label, fy_start_year, loan_id,
                    lender, loan_type, opening_balance, disbursement, disbursement_date,
                    interest_rate, tenure_months, emi_start_date, prepayment_amount, prepayment_date,
                    emi_amount, interest_for_year, principal_repaid, closing_balance, monthly_schedule,
                    created_at, updated_at
             FROM loan_history
             WHERE client_id = ? AND business_id = ?`

  if (loanId) {
    sql += ' AND loan_id = ?'
    params.push(loanId)
  }

  sql += ' ORDER BY fy_start_year DESC, lender ASC'

  const rows = await query(sql, params)
  const history = []

  for (const row of rows) {
    const monthlySchedule = await loadMonthlySchedule(
      clientId,
      businessId,
      row.fy_id,
      row.loan_id,
      row.monthly_schedule,
    )
    history.push(serializeHistoryRow(row, monthlySchedule))
  }

  return history
}

export async function getLoanFySummary(clientId, fyId, businessId) {
  const rows = await query(
    `SELECT id, client_id, fy_id, business_id, fy_label, fy_start_year,
            long_term_closing, short_term_closing, total_interest, total_principal_repaid,
            consolidated_cash_flow, created_at, updated_at
     FROM loan_fy_summary
     WHERE client_id = ? AND fy_id = ? AND business_id = ?
     LIMIT 1`,
    [clientId, fyId, businessId],
  )

  if (!rows.length) {
    return null
  }

  const row = rows[0]
  return {
    fyId: row.fy_id,
    fyLabel: row.fy_label || '',
    fyStartYear: Number(row.fy_start_year) || 0,
    longTermClosing: n(row.long_term_closing),
    shortTermClosing: n(row.short_term_closing),
    totalInterest: n(row.total_interest),
    totalPrincipalRepaid: n(row.total_principal_repaid),
    consolidatedCashFlow: parseJson(row.consolidated_cash_flow) || [],
  }
}

export async function deleteLoansForFs(clientId, fyId, businessId) {
  await Promise.all([
    query('DELETE FROM loan_records WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
      clientId,
      fyId,
      businessId,
    ]),
    query('DELETE FROM loan_schedule_rows WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
      clientId,
      fyId,
      businessId,
    ]),
    query('DELETE FROM loan_history WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
      clientId,
      fyId,
      businessId,
    ]),
    query('DELETE FROM loan_fy_summary WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
      clientId,
      fyId,
      businessId,
    ]),
  ])
}

export async function deleteLoansForBusiness(clientId, businessId) {
  await Promise.all([
    query('DELETE FROM loan_records WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
    query('DELETE FROM loan_schedule_rows WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
    query('DELETE FROM loan_history WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
    query('DELETE FROM loan_fy_summary WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
  ])
}

export async function deleteLoansForFy(clientId, fyId) {
  await Promise.all([
    query('DELETE FROM loan_records WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
    query('DELETE FROM loan_schedule_rows WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
    query('DELETE FROM loan_history WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
    query('DELETE FROM loan_fy_summary WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
  ])
}

export async function deleteLoansForFyAllClients(fyId) {
  await Promise.all([
    query('DELETE FROM loan_records WHERE fy_id = ?', [fyId]),
    query('DELETE FROM loan_schedule_rows WHERE fy_id = ?', [fyId]),
    query('DELETE FROM loan_history WHERE fy_id = ?', [fyId]),
    query('DELETE FROM loan_fy_summary WHERE fy_id = ?', [fyId]),
  ])
}

async function migrateLegacyRepaymentFromPayload(payload, fyId) {
  const fyMeta = await getFyMeta(fyId)
  if (!fyMeta.startYear || !fyMeta.endYear) {
    return []
  }

  if (Array.isArray(payload.loans) && payload.loans.length > 0) {
    return normalizeLoanRecords(payload.loans).filter(isMeaningfulLoan)
  }

  if (Array.isArray(payload.repaymentSchedule) && payload.repaymentSchedule.length > 0) {
    return migrateRepaymentSchedule(
      payload.repaymentSchedule,
      fyMeta.startYear,
      fyMeta.endYear,
    )
  }

  return []
}

export async function migrateLoansFromFsData() {
  const existing = await query('SELECT id FROM loan_records LIMIT 1')
  if (existing.length) {
    await migrateLoanScheduleRowsFromHistory()
    return
  }

  const rows = await query('SELECT client_id, fy_id, business_id, payload FROM fs_data')
  for (const row of rows) {
    const payload = parseJson(row.payload)
    const loans = await migrateLegacyRepaymentFromPayload(payload, row.fy_id)
    if (!loans.length) {
      continue
    }

    await saveLoansForFs(row.client_id, row.fy_id, row.business_id, loans, null)
  }

  await migrateLoanScheduleRowsFromHistory()
}

export async function migrateLoanScheduleRowsFromHistory() {
  const existing = await query('SELECT id FROM loan_schedule_rows LIMIT 1')
  if (existing.length) {
    return
  }

  const rows = await query(
    `SELECT id, client_id, business_id, fy_id, loan_id, monthly_schedule
     FROM loan_history
     WHERE monthly_schedule IS NOT NULL`,
  )

  for (const row of rows) {
    const schedule = parseJson(row.monthly_schedule) || []
    if (!schedule.length) {
      continue
    }

    await syncScheduleRows(
      row.client_id,
      row.business_id,
      row.fy_id,
      row.loan_id,
      row.id,
      schedule,
    )
  }
}

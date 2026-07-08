import { query } from '../db/connection.js'
import { parseJson } from '../db/init.js'

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

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

function serializeStatementLine(row) {
  return {
    label: row.label || '',
    current: n(row.current_amount),
    previous: n(row.previous_amount),
    isTotal: Boolean(row.is_total),
    isHeader: Boolean(row.is_header),
    isGrandTotal: Boolean(row.is_grand_total),
    isSubHeader: Boolean(row.is_sub_header),
    isSubLine: Boolean(row.is_sub_line),
    indent: Number(row.indent) || 0,
    noteNo: row.note_no || undefined,
    noteKey: row.note_key || undefined,
    noteSubId: row.note_sub_id || undefined,
    blankAmounts: Boolean(row.blank_amounts),
    isSpacer: Boolean(row.is_spacer),
    rowId: row.row_id || undefined,
  }
}

function normalizeSummary(raw = {}) {
  return {
    sourcesTotalCurrent: n(raw.sourcesTotalCurrent ?? raw.sources_total_current),
    sourcesTotalPrevious: n(raw.sourcesTotalPrevious ?? raw.sources_total_previous),
    applicationTotalCurrent: n(raw.applicationTotalCurrent ?? raw.application_total_current),
    applicationTotalPrevious: n(raw.applicationTotalPrevious ?? raw.application_total_previous),
    netProfitCurrent: n(raw.netProfitCurrent ?? raw.net_profit_current),
    netProfitPrevious: n(raw.netProfitPrevious ?? raw.net_profit_previous),
    grossProfitCurrent: n(raw.grossProfitCurrent ?? raw.gross_profit_current),
    grossProfitPrevious: n(raw.grossProfitPrevious ?? raw.gross_profit_previous),
    totalIncomeCurrent: n(raw.totalIncomeCurrent ?? raw.total_income_current),
    totalIncomePrevious: n(raw.totalIncomePrevious ?? raw.total_income_previous),
    totalExpensesCurrent: n(raw.totalExpensesCurrent ?? raw.total_expenses_current),
    totalExpensesPrevious: n(raw.totalExpensesPrevious ?? raw.total_expenses_previous),
    cashAdjustmentCurrent: n(raw.cashAdjustmentCurrent ?? raw.cash_adjustment_current),
    cashAdjustmentPrevious: n(raw.cashAdjustmentPrevious ?? raw.cash_adjustment_previous),
    sourcesApplicationDiffCurrent: n(
      raw.sourcesApplicationDiffCurrent ?? raw.sources_application_diff_current,
    ),
    sourcesApplicationDiffPrevious: n(
      raw.sourcesApplicationDiffPrevious ?? raw.sources_application_diff_previous,
    ),
  }
}

async function fetchStatementRows(tableName, clientId, fyId, businessId) {
  return query(
    `SELECT row_id, label, current_amount, previous_amount, note_no, note_key, note_sub_id,
            is_header, is_sub_header, is_total, is_grand_total, is_sub_line, indent,
            blank_amounts, is_spacer, sort_order
     FROM ${tableName}
     WHERE client_id = ? AND fy_id = ? AND business_id = ?
     ORDER BY sort_order ASC`,
    [clientId, fyId, businessId],
  )
}

async function fetchStatementSummary(clientId, fyId, businessId) {
  const rows = await query(
    `SELECT sources_total_current, sources_total_previous,
            application_total_current, application_total_previous,
            net_profit_current, net_profit_previous,
            gross_profit_current, gross_profit_previous,
            total_income_current, total_income_previous,
            total_expenses_current, total_expenses_previous,
            cash_adjustment_current, cash_adjustment_previous,
            sources_application_diff_current, sources_application_diff_previous
     FROM statement_fy_summary
     WHERE client_id = ? AND fy_id = ? AND business_id = ?
     LIMIT 1`,
    [clientId, fyId, businessId],
  )

  if (!rows.length) {
    return null
  }

  return normalizeSummary(rows[0])
}

function lineRowValues(line, sortOrder) {
  return {
    rowId: line.rowId ? String(line.rowId).slice(0, 120) : null,
    label: String(line.label || '').slice(0, 500),
    current: n(line.current),
    previous: n(line.previous),
    noteNo: line.noteNo ? String(line.noteNo).slice(0, 20) : null,
    noteKey: line.noteKey ? String(line.noteKey).slice(0, 60) : null,
    noteSubId: line.noteSubId ? String(line.noteSubId).slice(0, 120) : null,
    isHeader: line.isHeader ? 1 : 0,
    isSubHeader: line.isSubHeader ? 1 : 0,
    isTotal: line.isTotal ? 1 : 0,
    isGrandTotal: line.isGrandTotal ? 1 : 0,
    isSubLine: line.isSubLine ? 1 : 0,
    indent: Number(line.indent) || 0,
    blankAmounts: line.blankAmounts ? 1 : 0,
    isSpacer: line.isSpacer ? 1 : 0,
    sortOrder,
  }
}

async function upsertStatementRow(tableName, clientId, fyId, businessId, line, sortOrder, actor) {
  const rowId = `stmt_${tableName === 'bs_statement_rows' ? 'bs' : 'pl'}_${clientId}_${businessId}_${fyId}_${sortOrder}`.slice(
    0,
    50,
  )
  const values = lineRowValues(line, sortOrder)
  const { userId, username, name } = buildActor(actor)

  await query(
    `INSERT INTO ${tableName} (
       id, client_id, fy_id, business_id, row_id, label, current_amount, previous_amount,
       note_no, note_key, note_sub_id, is_header, is_sub_header, is_total, is_grand_total,
       is_sub_line, indent, blank_amounts, is_spacer, sort_order,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       row_id = VALUES(row_id),
       label = VALUES(label),
       current_amount = VALUES(current_amount),
       previous_amount = VALUES(previous_amount),
       note_no = VALUES(note_no),
       note_key = VALUES(note_key),
       note_sub_id = VALUES(note_sub_id),
       is_header = VALUES(is_header),
       is_sub_header = VALUES(is_sub_header),
       is_total = VALUES(is_total),
       is_grand_total = VALUES(is_grand_total),
       is_sub_line = VALUES(is_sub_line),
       indent = VALUES(indent),
       blank_amounts = VALUES(blank_amounts),
       is_spacer = VALUES(is_spacer),
       sort_order = VALUES(sort_order),
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_by_username = VALUES(updated_by_username),
       updated_by_name = VALUES(updated_by_name),
       updated_at = CURRENT_TIMESTAMP`,
    [
      rowId,
      clientId,
      fyId,
      businessId,
      values.rowId,
      values.label,
      values.current,
      values.previous,
      values.noteNo,
      values.noteKey,
      values.noteSubId,
      values.isHeader,
      values.isSubHeader,
      values.isTotal,
      values.isGrandTotal,
      values.isSubLine,
      values.indent,
      values.blankAmounts,
      values.isSpacer,
      values.sortOrder,
      userId,
      username,
      name,
    ],
  )
}

async function syncStatementRows(tableName, clientId, fyId, businessId, lines, actor) {
  const normalizedLines = Array.isArray(lines) ? lines : []
  const keepSortOrders = new Set(normalizedLines.map((_, index) => index))

  const existing = await query(
    `SELECT id, sort_order FROM ${tableName}
     WHERE client_id = ? AND fy_id = ? AND business_id = ?`,
    [clientId, fyId, businessId],
  )

  for (const row of existing) {
    if (!keepSortOrders.has(Number(row.sort_order))) {
      await query(`DELETE FROM ${tableName} WHERE id = ?`, [row.id])
    }
  }

  for (let index = 0; index < normalizedLines.length; index += 1) {
    await upsertStatementRow(tableName, clientId, fyId, businessId, normalizedLines[index], index, actor)
  }
}

async function upsertStatementSummary(clientId, fyId, businessId, summary, fyMeta, actor) {
  const rowId = `stmtsum_${clientId}_${businessId}_${fyId}`.slice(0, 50)
  const normalized = normalizeSummary(summary)
  const { userId, username, name } = buildActor(actor)

  await query(
    `INSERT INTO statement_fy_summary (
       id, client_id, fy_id, business_id, fy_label, fy_start_year,
       sources_total_current, sources_total_previous,
       application_total_current, application_total_previous,
       net_profit_current, net_profit_previous,
       gross_profit_current, gross_profit_previous,
       total_income_current, total_income_previous,
       total_expenses_current, total_expenses_previous,
       cash_adjustment_current, cash_adjustment_previous,
       sources_application_diff_current, sources_application_diff_previous,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       fy_label = VALUES(fy_label),
       fy_start_year = VALUES(fy_start_year),
       sources_total_current = VALUES(sources_total_current),
       sources_total_previous = VALUES(sources_total_previous),
       application_total_current = VALUES(application_total_current),
       application_total_previous = VALUES(application_total_previous),
       net_profit_current = VALUES(net_profit_current),
       net_profit_previous = VALUES(net_profit_previous),
       gross_profit_current = VALUES(gross_profit_current),
       gross_profit_previous = VALUES(gross_profit_previous),
       total_income_current = VALUES(total_income_current),
       total_income_previous = VALUES(total_income_previous),
       total_expenses_current = VALUES(total_expenses_current),
       total_expenses_previous = VALUES(total_expenses_previous),
       cash_adjustment_current = VALUES(cash_adjustment_current),
       cash_adjustment_previous = VALUES(cash_adjustment_previous),
       sources_application_diff_current = VALUES(sources_application_diff_current),
       sources_application_diff_previous = VALUES(sources_application_diff_previous),
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_by_username = VALUES(updated_by_username),
       updated_by_name = VALUES(updated_by_name),
       updated_at = CURRENT_TIMESTAMP`,
    [
      rowId,
      clientId,
      fyId,
      businessId,
      fyMeta.label,
      fyMeta.startYear,
      normalized.sourcesTotalCurrent,
      normalized.sourcesTotalPrevious,
      normalized.applicationTotalCurrent,
      normalized.applicationTotalPrevious,
      normalized.netProfitCurrent,
      normalized.netProfitPrevious,
      normalized.grossProfitCurrent,
      normalized.grossProfitPrevious,
      normalized.totalIncomeCurrent,
      normalized.totalIncomePrevious,
      normalized.totalExpensesCurrent,
      normalized.totalExpensesPrevious,
      normalized.cashAdjustmentCurrent,
      normalized.cashAdjustmentPrevious,
      normalized.sourcesApplicationDiffCurrent,
      normalized.sourcesApplicationDiffPrevious,
      userId,
      username,
      name,
    ],
  )
}

async function syncStatementHistory(clientId, businessId, fyId, fyMeta, snapshot, actor) {
  const historyId = `stmthist_${clientId}_${businessId}_${fyId}`.slice(0, 50)
  const { userId, username, name } = buildActor(actor)

  await query(
    `INSERT INTO statement_history (
       id, client_id, business_id, fy_id, fy_label, fy_start_year, payload,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       fy_label = VALUES(fy_label),
       fy_start_year = VALUES(fy_start_year),
       payload = VALUES(payload),
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
      JSON.stringify(snapshot),
      userId,
      username,
      name,
    ],
  )
}

export async function getStatementForFs(clientId, fyId, businessId) {
  const [bsRows, plRows, summary] = await Promise.all([
    fetchStatementRows('bs_statement_rows', clientId, fyId, businessId),
    fetchStatementRows('pl_statement_rows', clientId, fyId, businessId),
    fetchStatementSummary(clientId, fyId, businessId),
  ])

  return {
    balanceSheetLines: bsRows.map(serializeStatementLine),
    profitAndLossLines: plRows.map(serializeStatementLine),
    summary: summary || normalizeSummary({}),
  }
}

export async function saveStatementForFs(clientId, fyId, businessId, data, actor) {
  const snapshot = data || {}
  const fyMeta = await getFyMeta(fyId)

  await Promise.all([
    syncStatementRows('bs_statement_rows', clientId, fyId, businessId, snapshot.balanceSheetLines, actor),
    syncStatementRows('pl_statement_rows', clientId, fyId, businessId, snapshot.profitAndLossLines, actor),
  ])

  if (snapshot.summary) {
    await upsertStatementSummary(clientId, fyId, businessId, snapshot.summary, fyMeta, actor)
  }

  if (fyMeta.startYear) {
    const saved = await getStatementForFs(clientId, fyId, businessId)
    await syncStatementHistory(clientId, businessId, fyId, fyMeta, saved, actor)
  }

  return getStatementForFs(clientId, fyId, businessId)
}

function serializeHistoryRow(row) {
  return {
    id: row.id,
    fyId: row.fy_id,
    fyLabel: row.fy_label || '',
    fyStartYear: Number(row.fy_start_year) || 0,
    snapshot: parseJson(row.payload) || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function getStatementHistory(clientId, businessId, fyId = null) {
  const params = [clientId, businessId]
  let sql = `SELECT id, client_id, business_id, fy_id, fy_label, fy_start_year, payload, created_at, updated_at
             FROM statement_history
             WHERE client_id = ? AND business_id = ?`

  if (fyId) {
    sql += ' AND fy_id = ?'
    params.push(fyId)
  }

  sql += ' ORDER BY fy_start_year DESC'

  const rows = await query(sql, params)
  return rows.map(serializeHistoryRow)
}

async function deleteStatementTablesForFs(clientId, fyId, businessId) {
  await Promise.all([
    query('DELETE FROM bs_statement_rows WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
      clientId,
      fyId,
      businessId,
    ]),
    query('DELETE FROM pl_statement_rows WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
      clientId,
      fyId,
      businessId,
    ]),
    query('DELETE FROM statement_fy_summary WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
      clientId,
      fyId,
      businessId,
    ]),
    query('DELETE FROM statement_history WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
      clientId,
      fyId,
      businessId,
    ]),
  ])
}

export async function deleteStatementForBusiness(clientId, businessId) {
  await Promise.all([
    query('DELETE FROM bs_statement_rows WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
    query('DELETE FROM pl_statement_rows WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
    query('DELETE FROM statement_fy_summary WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
    query('DELETE FROM statement_history WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
  ])
}

export async function deleteStatementForFy(clientId, fyId) {
  await Promise.all([
    query('DELETE FROM bs_statement_rows WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
    query('DELETE FROM pl_statement_rows WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
    query('DELETE FROM statement_fy_summary WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
    query('DELETE FROM statement_history WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
  ])
}

export async function deleteStatementForFyAllClients(fyId) {
  await Promise.all([
    query('DELETE FROM bs_statement_rows WHERE fy_id = ?', [fyId]),
    query('DELETE FROM pl_statement_rows WHERE fy_id = ?', [fyId]),
    query('DELETE FROM statement_fy_summary WHERE fy_id = ?', [fyId]),
    query('DELETE FROM statement_history WHERE fy_id = ?', [fyId]),
  ])
}

export { deleteStatementTablesForFs as deleteStatementForFs }

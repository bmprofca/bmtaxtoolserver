import { query } from '../db/connection.js'
import { parseJson } from '../db/init.js'
import { ensureUniqueRecordIds, generateId } from '../utils/recordIds.js'

const SCHEDULE_COLUMNS = `id, client_id, fy_id, business_id, ledger_id, asset_name, purchase_date, rate,
  opening_wdv, addition_before_oct3, addition_on_after_oct3, asset_deletion,
  depreciation, closing_wdv, sort_order, created_at, updated_at`

const HISTORY_COLUMNS = `id, client_id, business_id, fy_id, fy_label, fy_start_year, ledger_id,
  asset_name, purchase_date, rate, opening_wdv, addition_before_oct3, addition_on_after_oct3,
  asset_deletion, depreciation_charged, closing_wdv, schedule_row_id, created_at, updated_at`

const PREVIOUS_YEAR_COLUMNS = `id, client_id, fy_id, business_id, opening_wdv,
  addition_before_oct3, addition_on_after_oct3, asset_deletion, depreciation,
  closing_wdv, created_at, updated_at`

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

export function recalcDepreciationRow(row = {}) {
  const openingWdv = n(row.openingWdv ?? row.opening_wdv)
  const additionBeforeOct3 = n(row.additionBeforeOct3 ?? row.addition_before_oct3 ?? row.addition)
  const additionOnAfterOct3 = n(row.additionOnAfterOct3 ?? row.addition_on_after_oct3)
  const assetDeletion = n(row.assetDeletion ?? row.asset_deletion)
  const rate = n(row.rate)

  const openingBase = Math.max(0, openingWdv - assetDeletion)
  const depOnOpening = (openingBase * rate) / 100
  const depOnBeforeOct3 = (additionBeforeOct3 * rate) / 100
  const depOnAfterOct3 = ((additionOnAfterOct3 * rate) / 100) * 0.5

  const depreciation = Math.round(depOnOpening + depOnBeforeOct3 + depOnAfterOct3)
  const closingWdv = Math.max(
    0,
    openingWdv + additionBeforeOct3 + additionOnAfterOct3 - assetDeletion - depreciation,
  )

  return {
    id: String(row.id || generateId()).trim(),
    ledgerId: String(row.ledgerId ?? row.ledger_id ?? '').trim(),
    assetName: String(row.assetName ?? row.asset_name ?? '').trim(),
    purchaseDate: toDateString(row.purchaseDate ?? row.purchase_date),
    rate,
    openingWdv,
    additionBeforeOct3,
    additionOnAfterOct3,
    assetDeletion,
    depreciation,
    closingWdv,
  }
}

function toDateString(value) {
  if (!value) {
    return ''
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }

  const trimmed = String(value).trim()
  if (!trimmed) {
    return ''
  }

  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return trimmed.slice(0, 10)
}

function isMeaningfulScheduleRow(row) {
  const normalized = recalcDepreciationRow(row)
  return Boolean(
    normalized.ledgerId ||
      normalized.assetName ||
      normalized.rate ||
      normalized.openingWdv ||
      normalized.additionBeforeOct3 ||
      normalized.additionOnAfterOct3 ||
      normalized.assetDeletion ||
      normalized.purchaseDate,
  )
}

export function normalizeDepreciationSchedule(schedule = []) {
  const normalized = (schedule || [])
    .map((row) => recalcDepreciationRow(row))
    .filter(isMeaningfulScheduleRow)

  return normalized
}

export function normalizePreviousYearDepreciation(value = {}) {
  if (typeof value === 'number') {
    return {
      openingWdv: 0,
      additionBeforeOct3: 0,
      additionOnAfterOct3: 0,
      assetDeletion: 0,
      depreciation: n(value),
      closingWdv: 0,
    }
  }

  return {
    openingWdv: n(value.openingWdv ?? value.opening_wdv),
    additionBeforeOct3: n(value.additionBeforeOct3 ?? value.addition_before_oct3),
    additionOnAfterOct3: n(value.additionOnAfterOct3 ?? value.addition_on_after_oct3),
    assetDeletion: n(value.assetDeletion ?? value.asset_deletion),
    depreciation: n(value.depreciation),
    closingWdv: n(value.closingWdv ?? value.closing_wdv),
  }
}

export function createEmptyDepreciationRow() {
  return recalcDepreciationRow({
    id: generateId(),
    assetName: '',
    rate: 0,
    openingWdv: 0,
    additionBeforeOct3: 0,
    additionOnAfterOct3: 0,
    assetDeletion: 0,
  })
}

export function createEmptyPreviousYearDepreciation() {
  return normalizePreviousYearDepreciation()
}

function serializeScheduleRow(row) {
  return recalcDepreciationRow({
    id: row.id,
    ledgerId: row.ledger_id,
    assetName: row.asset_name,
    purchaseDate: row.purchase_date,
    rate: row.rate,
    openingWdv: row.opening_wdv,
    additionBeforeOct3: row.addition_before_oct3,
    additionOnAfterOct3: row.addition_on_after_oct3,
    assetDeletion: row.asset_deletion,
    depreciation: row.depreciation,
    closingWdv: row.closing_wdv,
  })
}

function serializePreviousYearRow(row) {
  return normalizePreviousYearDepreciation({
    openingWdv: row.opening_wdv,
    additionBeforeOct3: row.addition_before_oct3,
    additionOnAfterOct3: row.addition_on_after_oct3,
    assetDeletion: row.asset_deletion,
    depreciation: row.depreciation,
    closingWdv: row.closing_wdv,
  })
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

function serializeHistoryRow(row) {
  return {
    id: row.id,
    fyId: row.fy_id,
    fyLabel: row.fy_label || '',
    fyStartYear: Number(row.fy_start_year) || 0,
    ledgerId: row.ledger_id || '',
    assetName: row.asset_name || '',
    purchaseDate: toDateString(row.purchase_date),
    rate: n(row.rate),
    openingWdv: n(row.opening_wdv),
    additionBeforeOct3: n(row.addition_before_oct3),
    additionOnAfterOct3: n(row.addition_on_after_oct3),
    assetDeletion: n(row.asset_deletion),
    depreciationCharged: n(row.depreciation_charged),
    closingWdv: n(row.closing_wdv),
  }
}

async function upsertAssetDepreciationHistory(
  clientId,
  businessId,
  fyId,
  fyMeta,
  row,
  actor,
) {
  const normalized = recalcDepreciationRow(row)
  if (!normalized.ledgerId) {
    return
  }

  const { userId, username, name } = buildActor(actor)
  const existing = await query(
    `SELECT id FROM asset_depreciation_history
     WHERE client_id = ? AND business_id = ? AND fy_id = ? AND ledger_id = ?
     LIMIT 1`,
    [clientId, businessId, fyId, normalized.ledgerId],
  )

  if (!existing.length) {
    await query(
      `INSERT INTO asset_depreciation_history (
         id, client_id, business_id, fy_id, fy_label, fy_start_year, ledger_id,
         asset_name, purchase_date, rate, opening_wdv, addition_before_oct3,
         addition_on_after_oct3, asset_deletion, depreciation_charged, closing_wdv,
         schedule_row_id, created_by_user_id, created_by_username, created_by_name
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `dephist_${generateId()}`,
        clientId,
        businessId,
        fyId,
        fyMeta.label,
        fyMeta.startYear,
        normalized.ledgerId,
        normalized.assetName,
        toDateString(normalized.purchaseDate) || null,
        normalized.rate,
        normalized.openingWdv,
        normalized.additionBeforeOct3,
        normalized.additionOnAfterOct3,
        normalized.assetDeletion,
        normalized.depreciation,
        normalized.closingWdv,
        normalized.id,
        userId,
        username,
        name,
      ],
    )
    return
  }

  await query(
    `UPDATE asset_depreciation_history
     SET fy_label = ?,
         fy_start_year = ?,
         asset_name = ?,
         purchase_date = ?,
         rate = ?,
         opening_wdv = ?,
         addition_before_oct3 = ?,
         addition_on_after_oct3 = ?,
         asset_deletion = ?,
         depreciation_charged = ?,
         closing_wdv = ?,
         schedule_row_id = ?,
         updated_by_user_id = ?,
         updated_by_username = ?,
         updated_by_name = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      fyMeta.label,
      fyMeta.startYear,
      normalized.assetName,
      toDateString(normalized.purchaseDate) || null,
      normalized.rate,
      normalized.openingWdv,
      normalized.additionBeforeOct3,
      normalized.additionOnAfterOct3,
      normalized.assetDeletion,
      normalized.depreciation,
      normalized.closingWdv,
      normalized.id,
      userId,
      username,
      name,
      existing[0].id,
    ],
  )
}

async function syncAssetDepreciationHistory(
  clientId,
  businessId,
  fyId,
  fyMeta,
  schedule,
  actor,
) {
  const normalizedSchedule = normalizeDepreciationSchedule(schedule)
  const ledgerIds = normalizedSchedule.map((row) => row.ledgerId).filter(Boolean)

  if (ledgerIds.length) {
    const placeholders = ledgerIds.map(() => '?').join(', ')
    await query(
      `DELETE FROM asset_depreciation_history
       WHERE client_id = ? AND business_id = ? AND fy_id = ?
         AND ledger_id NOT IN (${placeholders})`,
      [clientId, businessId, fyId, ...ledgerIds],
    )
  } else {
    await query(
      'DELETE FROM asset_depreciation_history WHERE client_id = ? AND business_id = ? AND fy_id = ?',
      [clientId, businessId, fyId],
    )
  }

  for (const row of normalizedSchedule) {
    await upsertAssetDepreciationHistory(clientId, businessId, fyId, fyMeta, row, actor)
  }
}

export async function getAssetDepreciationHistory(clientId, businessId, ledgerId = null) {
  const params = [clientId, businessId]
  let sql = `SELECT ${HISTORY_COLUMNS}
             FROM asset_depreciation_history
             WHERE client_id = ? AND business_id = ?`

  if (ledgerId) {
    sql += ' AND ledger_id = ?'
    params.push(ledgerId)
  }

  sql += ' ORDER BY fy_start_year DESC, asset_name ASC'

  const rows = await query(sql, params)
  return rows.map(serializeHistoryRow)
}

export async function getLatestAssetPurchaseDate(clientId, businessId, ledgerId) {
  const rows = await query(
    `SELECT purchase_date
     FROM asset_depreciation_history
     WHERE client_id = ? AND business_id = ? AND ledger_id = ? AND purchase_date IS NOT NULL
     ORDER BY fy_start_year DESC
     LIMIT 1`,
    [clientId, businessId, ledgerId],
  )

  return rows[0]?.purchase_date ? toDateString(rows[0].purchase_date) : ''
}

async function fetchScheduleRows(clientId, fyId, businessId) {
  return query(
    `SELECT ${SCHEDULE_COLUMNS}
     FROM depreciation_schedule_rows
     WHERE client_id = ? AND fy_id = ? AND business_id = ?
     ORDER BY sort_order ASC, created_at ASC`,
    [clientId, fyId, businessId],
  )
}

async function fetchPreviousYearRow(clientId, fyId, businessId) {
  const rows = await query(
    `SELECT ${PREVIOUS_YEAR_COLUMNS}
     FROM depreciation_previous_year
     WHERE client_id = ? AND fy_id = ? AND business_id = ?
     LIMIT 1`,
    [clientId, fyId, businessId],
  )

  return rows[0] || null
}

async function insertScheduleRow(clientId, fyId, businessId, row, sortOrder, actor) {
  const normalized = recalcDepreciationRow(row)
  const { userId, username, name } = buildActor(actor)

  await query(
    `INSERT INTO depreciation_schedule_rows (
       id, client_id, fy_id, business_id, ledger_id, asset_name, purchase_date, rate,
       opening_wdv, addition_before_oct3, addition_on_after_oct3, asset_deletion,
       depreciation, closing_wdv, sort_order,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalized.id,
      clientId,
      fyId,
      businessId,
      normalized.ledgerId || null,
      normalized.assetName,
      toDateString(normalized.purchaseDate) || null,
      normalized.rate,
      normalized.openingWdv,
      normalized.additionBeforeOct3,
      normalized.additionOnAfterOct3,
      normalized.assetDeletion,
      normalized.depreciation,
      normalized.closingWdv,
      sortOrder,
      userId,
      username,
      name,
    ],
  )
}

async function updateScheduleRow(clientId, fyId, businessId, row, sortOrder, actor) {
  const normalized = recalcDepreciationRow(row)
  const { userId, username, name } = buildActor(actor)

  await query(
    `UPDATE depreciation_schedule_rows
     SET ledger_id = ?,
         asset_name = ?,
         purchase_date = ?,
         rate = ?,
         opening_wdv = ?,
         addition_before_oct3 = ?,
         addition_on_after_oct3 = ?,
         asset_deletion = ?,
         depreciation = ?,
         closing_wdv = ?,
         sort_order = ?,
         updated_by_user_id = ?,
         updated_by_username = ?,
         updated_by_name = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND client_id = ? AND fy_id = ? AND business_id = ?`,
    [
      normalized.ledgerId || null,
      normalized.assetName,
      toDateString(normalized.purchaseDate) || null,
      normalized.rate,
      normalized.openingWdv,
      normalized.additionBeforeOct3,
      normalized.additionOnAfterOct3,
      normalized.assetDeletion,
      normalized.depreciation,
      normalized.closingWdv,
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

async function upsertPreviousYearRow(clientId, fyId, businessId, summary, actor) {
  const normalized = normalizePreviousYearDepreciation(summary)
  const existing = await fetchPreviousYearRow(clientId, fyId, businessId)
  const { userId, username, name } = buildActor(actor)

  if (!existing) {
    await query(
      `INSERT INTO depreciation_previous_year (
         id, client_id, fy_id, business_id, opening_wdv,
         addition_before_oct3, addition_on_after_oct3, asset_deletion,
         depreciation, closing_wdv,
         created_by_user_id, created_by_username, created_by_name
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `depprev_${generateId()}`,
        clientId,
        fyId,
        businessId,
        normalized.openingWdv,
        normalized.additionBeforeOct3,
        normalized.additionOnAfterOct3,
        normalized.assetDeletion,
        normalized.depreciation,
        normalized.closingWdv,
        userId,
        username,
        name,
      ],
    )
    return
  }

  await query(
    `UPDATE depreciation_previous_year
     SET opening_wdv = ?,
         addition_before_oct3 = ?,
         addition_on_after_oct3 = ?,
         asset_deletion = ?,
         depreciation = ?,
         closing_wdv = ?,
         updated_by_user_id = ?,
         updated_by_username = ?,
         updated_by_name = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE client_id = ? AND fy_id = ? AND business_id = ?`,
    [
      normalized.openingWdv,
      normalized.additionBeforeOct3,
      normalized.additionOnAfterOct3,
      normalized.assetDeletion,
      normalized.depreciation,
      normalized.closingWdv,
      userId,
      username,
      name,
      clientId,
      fyId,
      businessId,
    ],
  )
}

export async function getDepreciationForFs(clientId, fyId, businessId) {
  const scheduleRows = await fetchScheduleRows(clientId, fyId, businessId)
  const previousYearRow = await fetchPreviousYearRow(clientId, fyId, businessId)

  return {
    depreciationSchedule: scheduleRows.map((row) => serializeScheduleRow(row)),
    previousYearDepreciation: previousYearRow
      ? serializePreviousYearRow(previousYearRow)
      : createEmptyPreviousYearDepreciation(),
  }
}

export async function saveDepreciationForFs(
  clientId,
  fyId,
  businessId,
  { depreciationSchedule, previousYearDepreciation },
  actor,
) {
  const normalizedSchedule = ensureUniqueRecordIds(
    normalizeDepreciationSchedule(depreciationSchedule),
    (row) => row.id,
    (row, id) => recalcDepreciationRow({ ...row, id }),
  )
  const incomingIds = new Set(normalizedSchedule.map((row) => row.id))
  const existingRows = await fetchScheduleRows(clientId, fyId, businessId)
  const existingIds = new Set(existingRows.map((row) => row.id))

  for (const row of existingRows) {
    if (!incomingIds.has(row.id)) {
      await query(
        'DELETE FROM depreciation_schedule_rows WHERE id = ? AND client_id = ? AND fy_id = ? AND business_id = ?',
        [row.id, clientId, fyId, businessId],
      )
    }
  }

  for (let index = 0; index < normalizedSchedule.length; index += 1) {
    const row = normalizedSchedule[index]
    if (existingIds.has(row.id)) {
      await updateScheduleRow(clientId, fyId, businessId, row, index, actor)
    } else {
      await insertScheduleRow(clientId, fyId, businessId, row, index, actor)
      existingIds.add(row.id)
    }
  }

  await upsertPreviousYearRow(clientId, fyId, businessId, previousYearDepreciation, actor)

  const fyMeta = await getFyMeta(fyId)
  await syncAssetDepreciationHistory(
    clientId,
    businessId,
    fyId,
    fyMeta,
    normalizedSchedule,
    actor,
  )

  return getDepreciationForFs(clientId, fyId, businessId)
}

export async function deleteDepreciationForBusiness(clientId, businessId) {
  await query('DELETE FROM asset_depreciation_history WHERE client_id = ? AND business_id = ?', [
    clientId,
    businessId,
  ])
  await query('DELETE FROM depreciation_schedule_rows WHERE client_id = ? AND business_id = ?', [
    clientId,
    businessId,
  ])
  await query('DELETE FROM depreciation_previous_year WHERE client_id = ? AND business_id = ?', [
    clientId,
    businessId,
  ])
}

export async function deleteDepreciationForFy(clientId, fyId) {
  await query('DELETE FROM asset_depreciation_history WHERE client_id = ? AND fy_id = ?', [
    clientId,
    fyId,
  ])
  await query('DELETE FROM depreciation_schedule_rows WHERE client_id = ? AND fy_id = ?', [
    clientId,
    fyId,
  ])
  await query('DELETE FROM depreciation_previous_year WHERE client_id = ? AND fy_id = ?', [
    clientId,
    fyId,
  ])
}

export async function deleteDepreciationForFyAllClients(fyId) {
  await query('DELETE FROM asset_depreciation_history WHERE fy_id = ?', [fyId])
  await query('DELETE FROM depreciation_schedule_rows WHERE fy_id = ?', [fyId])
  await query('DELETE FROM depreciation_previous_year WHERE fy_id = ?', [fyId])
}

export async function migrateDepreciationFromFsData() {
  const existing = await query('SELECT id FROM depreciation_schedule_rows LIMIT 1')
  if (existing.length) {
    return
  }

  const rows = await query('SELECT client_id, fy_id, business_id, payload FROM fs_data')
  for (const row of rows) {
    const payload = parseJson(row.payload)
    if (!payload) {
      continue
    }

    const hasSchedule = Array.isArray(payload.depreciationSchedule) && payload.depreciationSchedule.length
    const hasPreviousYear =
      payload.previousYearDepreciation &&
      Object.values(payload.previousYearDepreciation).some((value) => Number(value) !== 0)

    if (!hasSchedule && !hasPreviousYear) {
      continue
    }

    await saveDepreciationForFs(
      row.client_id,
      row.fy_id,
      row.business_id,
      {
        depreciationSchedule: payload.depreciationSchedule || [createEmptyDepreciationRow()],
        previousYearDepreciation:
          payload.previousYearDepreciation || createEmptyPreviousYearDepreciation(),
      },
      null,
    )
  }
}

import { query } from '../db/connection.js'
import { getSetting } from '../db/init.js'

const FY_COLUMNS = `id, label, start_year, end_year, statement_type, status,
  is_deleted, deleted_at, created_at`

function normalizeFyStatus(value) {
  return value === 'inactive' ? 'inactive' : 'active'
}

let globalFinancialYears = []

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

function normalizeFinancialYear(raw) {
  const startYear = Number(raw.startYear ?? raw.start_year)
  const endYear = Number(raw.endYear ?? raw.end_year)

  if (!startYear || !endYear || endYear !== startYear + 1) {
    return null
  }

  const label =
    String(raw.label ?? '').trim() ||
    `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`

  return {
    id: raw.id || generateId(),
    label,
    startYear,
    endYear,
    statementType: String(raw.statementType ?? raw.statement_type ?? 'Actual').trim() || 'Actual',
    status: normalizeFyStatus(raw.status),
    createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
  }
}

function rowToFinancialYear(row) {
  return {
    id: row.id,
    label: row.label || '',
    startYear: Number(row.start_year),
    endYear: Number(row.end_year),
    statementType: row.statement_type || 'Actual',
    status: normalizeFyStatus(row.status),
    isDeleted: row.is_deleted === 1 || row.is_deleted === true,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

function serializeFinancialYear(fy) {
  return {
    id: fy.id,
    label: fy.label,
    startYear: fy.startYear,
    endYear: fy.endYear,
    statementType: fy.statementType || 'Actual',
    status: normalizeFyStatus(fy.status),
    createdAt: fy.createdAt,
  }
}

function validateSequentialYears(financialYears) {
  const normalized = (financialYears || [])
    .map(normalizeFinancialYear)
    .filter((item) => item !== null)

  if (normalized.length !== (financialYears || []).length) {
    return 'Invalid financial year data'
  }

  const sorted = [...normalized].sort((a, b) => a.startYear - b.startYear)
  const seen = new Set()

  for (const fy of sorted) {
    if (seen.has(fy.startYear)) {
      return 'Each financial year can only be added once'
    }
    seen.add(fy.startYear)
  }

  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].startYear !== sorted[index - 1].startYear + 1) {
      return 'Financial years must be consecutive with no gaps'
    }
  }

  return null
}

async function fetchFinancialYearRows(whereClause = '', params = []) {
  return query(
    `SELECT ${FY_COLUMNS}
     FROM financial_years
     ${whereClause}
     ORDER BY start_year ASC`,
    params,
  )
}

async function reloadActiveFinancialYears() {
  const rows = await fetchFinancialYearRows('WHERE is_deleted = 0')
  globalFinancialYears = rows.map((row) => serializeFinancialYear(rowToFinancialYear(row)))
  return globalFinancialYears
}

async function assertStartYearAvailable(startYear, excludeId = null) {
  const params = [startYear]
  let sql = 'SELECT id FROM financial_years WHERE start_year = ? AND is_deleted = 0'

  if (excludeId) {
    sql += ' AND id != ?'
    params.push(excludeId)
  }

  const rows = await query(`${sql} LIMIT 1`, params)
  if (rows.length) {
    throw new Error('This financial year already exists')
  }
}

async function insertFinancialYear(fy, actor) {
  const createdBy = buildActor(actor)
  await assertStartYearAvailable(fy.startYear)

  await query(
    `INSERT INTO financial_years (
       id, label, start_year, end_year, statement_type, status,
       is_deleted, deleted_at, created_at,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?)`,
    [
      fy.id,
      fy.label,
      fy.startYear,
      fy.endYear,
      fy.statementType,
      normalizeFyStatus(fy.status),
      fy.createdAt ? new Date(fy.createdAt) : null,
      createdBy.userId,
      createdBy.username,
      createdBy.name,
    ],
  )
}

async function updateFinancialYearRow(fy, actor) {
  const updatedBy = buildActor(actor)
  await assertStartYearAvailable(fy.startYear, fy.id)

  await query(
    `UPDATE financial_years SET
       label = ?,
       start_year = ?,
       end_year = ?,
       statement_type = ?,
       status = ?,
       updated_by_user_id = ?,
       updated_by_username = ?,
       updated_by_name = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND is_deleted = 0`,
    [
      fy.label,
      fy.startYear,
      fy.endYear,
      fy.statementType,
      normalizeFyStatus(fy.status),
      updatedBy.userId,
      updatedBy.username,
      updatedBy.name,
      fy.id,
    ],
  )
}

async function markFinancialYearDeleted(fyId, actor) {
  const deletedBy = buildActor(actor)

  await query(
    `UPDATE financial_years SET
       is_deleted = 1,
       deleted_at = CURRENT_TIMESTAMP,
       deleted_by_user_id = ?,
       deleted_by_username = ?,
       deleted_by_name = ?
     WHERE id = ? AND is_deleted = 0`,
    [deletedBy.userId, deletedBy.username, deletedBy.name, fyId],
  )
}

async function markFinancialYearRestored(fyId, actor) {
  const updatedBy = buildActor(actor)

  await query(
    `UPDATE financial_years SET
       is_deleted = 0,
       deleted_at = NULL,
       deleted_by_user_id = NULL,
       deleted_by_username = NULL,
       deleted_by_name = NULL,
       updated_by_user_id = ?,
       updated_by_username = ?,
       updated_by_name = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND is_deleted = 1`,
    [updatedBy.userId, updatedBy.username, updatedBy.name, fyId],
  )
}

export async function migrateFinancialYearsFromSettings() {
  const existing = await query('SELECT id FROM financial_years LIMIT 1')
  if (existing.length) {
    return
  }

  const stored = await getSetting('financial_years')
  if (!Array.isArray(stored) || !stored.length) {
    return
  }

  for (const item of stored) {
    const fy = normalizeFinancialYear(item)
    if (!fy) {
      continue
    }

    await query(
      `INSERT INTO financial_years (
         id, label, start_year, end_year, statement_type, status,
         is_deleted, deleted_at, created_at
       ) VALUES (?, ?, ?, ?, ?, 'active', 0, NULL, COALESCE(?, CURRENT_TIMESTAMP))`,
      [
        fy.id,
        fy.label,
        fy.startYear,
        fy.endYear,
        fy.statementType,
        fy.createdAt ? new Date(fy.createdAt) : null,
      ],
    )
  }
}

export async function loadFinancialYears() {
  await reloadActiveFinancialYears()
}

export function getFinancialYears() {
  return globalFinancialYears
}

export function getFinancialYearById(fyId) {
  return globalFinancialYears.find((item) => item.id === fyId) || null
}

export function canDeleteFinancialYear(fyId) {
  const sorted = [...globalFinancialYears].sort((a, b) => a.startYear - b.startYear)
  return sorted[sorted.length - 1]?.id === fyId
}

export async function getDeletedFinancialYears() {
  const rows = await fetchFinancialYearRows('WHERE is_deleted = 1')
  return rows.map((row) => {
    const fy = rowToFinancialYear(row)
    return {
      ...serializeFinancialYear(fy),
      isDeleted: true,
      deletedAt: fy.deletedAt,
    }
  })
}

export async function saveFinancialYears(financialYears, actor) {
  const sequenceError = validateSequentialYears(financialYears)
  if (sequenceError) {
    throw new Error(sequenceError)
  }

  const normalized = (financialYears || [])
    .map(normalizeFinancialYear)
    .filter((item) => item !== null)
    .sort((a, b) => a.startYear - b.startYear)

  const existingRows = await fetchFinancialYearRows('WHERE is_deleted = 0')
  const existingById = new Map(existingRows.map((row) => [row.id, rowToFinancialYear(row)]))

  for (const fy of normalized) {
    const existing = existingById.get(fy.id)
    if (existing) {
      await updateFinancialYearRow({ ...existing, ...fy, status: existing.status }, actor)
    } else {
      await insertFinancialYear({ ...fy, status: 'active' }, actor)
    }
  }

  return reloadActiveFinancialYears()
}

export async function softDeleteFinancialYear(fyId, actor) {
  if (!canDeleteFinancialYear(fyId)) {
    throw new Error('Delete the latest financial year first to keep years in sequence')
  }

  const rows = await fetchFinancialYearRows('WHERE id = ? AND is_deleted = 0', [fyId])
  if (!rows.length) {
    throw new Error('Financial year not found')
  }

  await markFinancialYearDeleted(fyId, actor)
  return reloadActiveFinancialYears()
}

export async function updateFinancialYearStatementType(fyId, statementType, actor) {
  const existing = getFinancialYearById(fyId)

  if (!existing) {
    return null
  }

  const normalized = String(statementType || 'Actual').trim() || 'Actual'

  if (normalized === existing.statementType) {
    return existing
  }

  await updateFinancialYearRow({ ...existing, statementType: normalized }, actor)
  await reloadActiveFinancialYears()
  return getFinancialYearById(fyId)
}

export async function updateFinancialYearStatus(fyId, status, actor) {
  const existing = getFinancialYearById(fyId)

  if (!existing) {
    return null
  }

  const normalizedStatus = normalizeFyStatus(status)

  if (normalizeFyStatus(existing.status) === normalizedStatus) {
    return existing
  }

  await updateFinancialYearRow({ ...existing, status: normalizedStatus }, actor)
  await reloadActiveFinancialYears()
  return getFinancialYearById(fyId)
}

export async function restoreFinancialYear(fyId, actor) {
  const rows = await fetchFinancialYearRows('WHERE id = ? AND is_deleted = 1', [fyId])
  if (!rows.length) {
    return { success: false, error: 'Deleted financial year not found' }
  }

  const restored = serializeFinancialYear(rowToFinancialYear(rows[0]))
  const merged = [...globalFinancialYears, restored].sort((a, b) => a.startYear - b.startYear)
  const sequenceError = validateSequentialYears(merged)
  if (sequenceError) {
    return { success: false, error: `Cannot restore: ${sequenceError}` }
  }

  const activeWithSameStart = await query(
    'SELECT id FROM financial_years WHERE start_year = ? AND is_deleted = 0 LIMIT 1',
    [restored.startYear],
  )
  if (activeWithSameStart.length) {
    return { success: false, error: 'An active financial year already uses this period' }
  }

  await markFinancialYearRestored(fyId, actor)
  await reloadActiveFinancialYears()
  return { success: true, financialYear: restored }
}

import { query } from '../db/connection.js'
import { parseJson } from '../db/init.js'

const UDIN_COLUMNS = `id, client_id, fy_id, business_id, ca_profile_id,
  ca_partner_name, ca_firm_name, udin_number, issue_date, enabled,
  created_at, updated_at`

function generateId() {
  return `udin_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
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

export function normalizeUdinDetails(raw = {}) {
  return {
    enabled: Boolean(raw.enabled),
    caProfileId: String(raw.caProfileId || raw.ca_profile_id || '').trim(),
    udinNumber: String(raw.udinNumber || raw.udin_number || '').trim(),
    udinDate: String(raw.udinDate || raw.issue_date || '').trim(),
    caPartnerName: String(raw.caPartnerName || raw.ca_partner_name || '').trim(),
    caFirmName: String(raw.caFirmName || raw.ca_firm_name || '').trim(),
  }
}

function serializeUdinDetails(row) {
  if (!row) {
    return normalizeUdinDetails()
  }

  const issueDate = row.issue_date
    ? new Date(row.issue_date).toISOString().slice(0, 10)
    : ''

  return {
    enabled: row.enabled === 1 || row.enabled === true,
    caProfileId: row.ca_profile_id || '',
    udinNumber: row.udin_number || '',
    udinDate: issueDate,
    caPartnerName: row.ca_partner_name || '',
    caFirmName: row.ca_firm_name || '',
  }
}

function toIssueDate(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) {
    return null
  }

  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return trimmed.slice(0, 10)
}

async function fetchCaProfileNames(caProfileId) {
  if (!caProfileId) {
    return { partnerName: '', firmName: '' }
  }

  const rows = await query(
    `SELECT partner_name, firm_name
     FROM ca_profiles
     WHERE id = ? AND is_deleted = 0
     LIMIT 1`,
    [caProfileId],
  )

  if (!rows.length) {
    return { partnerName: '', firmName: '' }
  }

  return {
    partnerName: rows[0].partner_name || '',
    firmName: rows[0].firm_name || '',
  }
}

async function fetchUdinRow(clientId, fyId, businessId) {
  const rows = await query(
    `SELECT ${UDIN_COLUMNS}
     FROM udin_records
     WHERE client_id = ? AND fy_id = ? AND business_id = ?
     LIMIT 1`,
    [clientId, fyId, businessId],
  )

  return rows[0] || null
}

export async function getUdinForFs(clientId, fyId, businessId) {
  const row = await fetchUdinRow(clientId, fyId, businessId)
  return serializeUdinDetails(row)
}

export async function saveUdinForFs(clientId, fyId, businessId, udinDetails, actor) {
  const normalized = normalizeUdinDetails(udinDetails)
  const existing = await fetchUdinRow(clientId, fyId, businessId)
  const { userId, username, name } = buildActor(actor)

  let caPartnerName = normalized.caPartnerName
  let caFirmName = normalized.caFirmName
  if (normalized.caProfileId && (!caPartnerName || !caFirmName)) {
    const caNames = await fetchCaProfileNames(normalized.caProfileId)
    caPartnerName = caPartnerName || caNames.partnerName
    caFirmName = caFirmName || caNames.firmName
  }

  const issueDate = toIssueDate(normalized.udinDate)
  const enabled = normalized.enabled ? 1 : 0

  if (!existing) {
    if (
      !enabled &&
      !normalized.caProfileId &&
      !normalized.udinNumber &&
      !issueDate
    ) {
      return normalizeUdinDetails()
    }

    const id = generateId()
    await query(
      `INSERT INTO udin_records (
         id, client_id, fy_id, business_id, ca_profile_id,
         ca_partner_name, ca_firm_name, udin_number, issue_date, enabled,
         created_by_user_id, created_by_username, created_by_name
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        clientId,
        fyId,
        businessId,
        normalized.caProfileId,
        caPartnerName,
        caFirmName,
        normalized.udinNumber,
        issueDate,
        enabled,
        userId,
        username,
        name,
      ],
    )
  } else {
    await query(
      `UPDATE udin_records
       SET ca_profile_id = ?,
           ca_partner_name = ?,
           ca_firm_name = ?,
           udin_number = ?,
           issue_date = ?,
           enabled = ?,
           updated_by_user_id = ?,
           updated_by_username = ?,
           updated_by_name = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE client_id = ? AND fy_id = ? AND business_id = ?`,
      [
        normalized.caProfileId,
        caPartnerName,
        caFirmName,
        normalized.udinNumber,
        issueDate,
        enabled,
        userId,
        username,
        name,
        clientId,
        fyId,
        businessId,
      ],
    )
  }

  return getUdinForFs(clientId, fyId, businessId)
}

export async function deleteUdinForFs(clientId, fyId, businessId) {
  await query('DELETE FROM udin_records WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
    clientId,
    fyId,
    businessId,
  ])
}

export async function deleteUdinForBusiness(clientId, businessId) {
  await query('DELETE FROM udin_records WHERE client_id = ? AND business_id = ?', [
    clientId,
    businessId,
  ])
}

export async function deleteUdinForFy(clientId, fyId) {
  await query('DELETE FROM udin_records WHERE client_id = ? AND fy_id = ?', [clientId, fyId])
}

export async function deleteUdinForFyAllClients(fyId) {
  await query('DELETE FROM udin_records WHERE fy_id = ?', [fyId])
}

export async function migrateUdinFromFsData() {
  const existing = await query('SELECT id FROM udin_records LIMIT 1')
  if (existing.length) {
    return
  }

  const rows = await query('SELECT client_id, fy_id, business_id, payload FROM fs_data')
  for (const row of rows) {
    const payload = parseJson(row.payload)
    const udinDetails = payload?.udinDetails
    if (!udinDetails) {
      continue
    }

    const normalized = normalizeUdinDetails(udinDetails)
    if (
      !normalized.enabled &&
      !normalized.caProfileId &&
      !normalized.udinNumber &&
      !normalized.udinDate
    ) {
      continue
    }

    await saveUdinForFs(row.client_id, row.fy_id, row.business_id, normalized, null)
  }
}

export async function getCaUdinAssignmentCount(caProfileId) {
  if (!caProfileId) {
    return 0
  }

  const rows = await query(
    'SELECT COUNT(*) AS total FROM udin_records WHERE ca_profile_id = ?',
    [caProfileId],
  )

  return Number(rows[0]?.total || 0)
}

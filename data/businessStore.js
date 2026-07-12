import { query } from '../db/connection.js'
import { parseJson } from '../db/init.js'
import { getPanValidationMessage, normalizePan } from './clientValidation.js'

const BUSINESS_ACTION_PASSWORD = '123456'

const BUSINESS_COLUMNS = `id, client_id, name, type, pan, address, starting_fy, starting_year,
  gst_number, status, is_deleted, deleted_at, created_at`

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function normalizeBusinessStatus(value) {
  return value === 'inactive' ? 'inactive' : 'active'
}

export function isProprietorshipType(type) {
  return String(type || '')
    .trim()
    .toLowerCase() === 'proprietorship'
}

export function isSelfBusinessType(type) {
  return String(type || '')
    .trim()
    .toLowerCase() === 'self'
}

export function usesClientPanFallback(type) {
  return isProprietorshipType(type) || isSelfBusinessType(type)
}

function rowToBusiness(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name || '',
    type: row.type || '',
    pan: row.pan || '',
    address: row.address || '',
    startingFy: row.starting_fy || '',
    startingYear: Number(row.starting_year),
    gstNumber: row.gst_number || '',
    status: normalizeBusinessStatus(row.status),
    isDeleted: row.is_deleted === 1 || row.is_deleted === true,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

export function serializeBusiness(business) {
  return {
    id: business.id,
    name: business.name,
    type: business.type,
    pan: business.pan,
    address: business.address,
    startingFy: business.startingFy,
    startingYear: business.startingYear,
    gstNumber: business.gstNumber || '',
    status: normalizeBusinessStatus(business.status),
    isDeleted: Boolean(business.isDeleted),
    deletedAt: business.deletedAt || null,
    createdAt: business.createdAt,
  }
}

function resolveBusinessPan({ type, pan, clientPan }) {
  const resolved = usesClientPanFallback(type) ? pan || clientPan : pan
  return normalizePan(resolved)
}

function validateBusinessPayload(
  { name, type, pan, address, startingFy, startingYear, gstNumber, status },
  clientPan,
) {
  if (!name?.trim()) {
    return { valid: false, error: 'Business name is required' }
  }

  if (!type?.trim()) {
    return { valid: false, error: 'Business type is required' }
  }

  if (!startingFy?.trim() || !startingYear) {
    return { valid: false, error: 'Starting financial year is required' }
  }

  const normalizedPan = resolveBusinessPan({ type, pan, clientPan })
  const panError = getPanValidationMessage(normalizedPan)
  if (panError) {
    return { valid: false, error: panError }
  }

  return {
    valid: true,
    data: {
      name: name.trim(),
      type: type.trim(),
      pan: normalizedPan,
      address: address?.trim() || '',
      startingFy: startingFy.trim(),
      startingYear: Number(startingYear),
      gstNumber: gstNumber?.trim() || '',
      status: normalizeBusinessStatus(status),
    },
  }
}

async function fetchBusinessRows(whereClause = '', params = []) {
  return query(
    `SELECT ${BUSINESS_COLUMNS}
     FROM businesses
     ${whereClause}
     ORDER BY created_at ASC, name ASC`,
    params,
  )
}

export async function getBusinessesForClient(clientId, { includeDeleted = false } = {}) {
  const conditions = ['client_id = ?']
  const params = [clientId]

  if (!includeDeleted) {
    conditions.push('is_deleted = 0')
  }

  const rows = await fetchBusinessRows(`WHERE ${conditions.join(' AND ')}`, params)
  return rows.map((row) => serializeBusiness(rowToBusiness(row)))
}

export async function getDeletedBusinessesForClient(clientId) {
  const rows = await fetchBusinessRows('WHERE client_id = ? AND is_deleted = 1', [clientId])
  return rows.map((row) => serializeBusiness(rowToBusiness(row)))
}

export async function getBusinessesMapForClients(clientIds) {
  const map = new Map()
  if (!clientIds.length) {
    return map
  }

  const placeholders = clientIds.map(() => '?').join(', ')
  const rows = await fetchBusinessRows(
    `WHERE client_id IN (${placeholders}) AND is_deleted = 0`,
    clientIds,
  )

  for (const row of rows) {
    const business = serializeBusiness(rowToBusiness(row))
    const list = map.get(row.client_id) || []
    list.push(business)
    map.set(row.client_id, list)
  }

  return map
}

async function getClientPan(clientId) {
  const profile = await getClientBusinessProfile(clientId)
  return profile?.pan || ''
}

async function getClientBusinessProfile(clientId) {
  const rows = await query(
    'SELECT name, pan, address, pin FROM clients WHERE id = ? AND is_deleted = 0 LIMIT 1',
    [clientId],
  )

  if (!rows.length) {
    return null
  }

  const row = rows[0]
  const address = String(row.address || '').trim()
  const pin = String(row.pin || '').trim()
  const addressParts = [address, pin ? `PIN ${pin}` : ''].filter(Boolean)

  return {
    name: String(row.name || '').trim(),
    pan: String(row.pan || '').trim(),
    address: addressParts.join(', '),
  }
}

function applySelfBusinessDefaults(payload, clientProfile) {
  if (!isSelfBusinessType(payload.type) || !clientProfile) {
    return payload
  }

  return {
    ...payload,
    name: payload.name?.trim() || clientProfile.name,
    pan: payload.pan?.trim() || clientProfile.pan,
    address: payload.address?.trim() || clientProfile.address,
  }
}

function buildActor(user) {
  if (!user?.id) {
    return {
      userId: null,
      username: null,
      name: null,
    }
  }

  return {
    userId: user.id,
    username: user.username || null,
    name: user.name || user.username || null,
  }
}

async function insertBusiness(business, actor) {
  const createdBy = buildActor(actor)

  await query(
    `INSERT INTO businesses (
       id, client_id, name, type, pan, address, starting_fy, starting_year,
       gst_number, status, is_deleted, deleted_at,
       created_at, created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?)`,
    [
      business.id,
      business.clientId,
      business.name,
      business.type,
      business.pan,
      business.address || '',
      business.startingFy,
      business.startingYear,
      business.gstNumber || null,
      normalizeBusinessStatus(business.status),
      business.createdAt ? new Date(business.createdAt) : null,
      createdBy.userId,
      createdBy.username,
      createdBy.name,
    ],
  )
}

async function updateBusinessRow(business, actor) {
  const updatedBy = buildActor(actor)

  await query(
    `UPDATE businesses SET
       name = ?,
       type = ?,
       pan = ?,
       address = ?,
       starting_fy = ?,
       starting_year = ?,
       gst_number = ?,
       status = ?,
       updated_by_user_id = ?,
       updated_by_username = ?,
       updated_by_name = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND client_id = ?`,
    [
      business.name,
      business.type,
      business.pan,
      business.address || '',
      business.startingFy,
      business.startingYear,
      business.gstNumber || null,
      normalizeBusinessStatus(business.status),
      updatedBy.userId,
      updatedBy.username,
      updatedBy.name,
      business.id,
      business.clientId,
    ],
  )
}

async function markBusinessDeleted(businessId, clientId, actor) {
  const deletedBy = buildActor(actor)

  await query(
    `UPDATE businesses SET
       is_deleted = 1,
       deleted_at = CURRENT_TIMESTAMP,
       deleted_by_user_id = ?,
       deleted_by_username = ?,
       deleted_by_name = ?
     WHERE id = ? AND client_id = ?`,
    [
      deletedBy.userId,
      deletedBy.username,
      deletedBy.name,
      businessId,
      clientId,
    ],
  )
}

async function markBusinessRestored(businessId, clientId, actor) {
  const updatedBy = buildActor(actor)

  await query(
    `UPDATE businesses SET
       is_deleted = 0,
       deleted_at = NULL,
       deleted_by_user_id = NULL,
       deleted_by_username = NULL,
       deleted_by_name = NULL,
       updated_by_user_id = ?,
       updated_by_username = ?,
       updated_by_name = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND client_id = ?`,
    [
      updatedBy.userId,
      updatedBy.username,
      updatedBy.name,
      businessId,
      clientId,
    ],
  )
}

async function persistBusinessLegacy(business) {
  await query(
    `INSERT INTO businesses (
       id, client_id, name, type, pan, address, starting_fy, starting_year,
       gst_number, status, is_deleted, deleted_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       type = VALUES(type),
       pan = VALUES(pan),
       address = VALUES(address),
       starting_fy = VALUES(starting_fy),
       starting_year = VALUES(starting_year),
       gst_number = VALUES(gst_number),
       status = VALUES(status),
       is_deleted = VALUES(is_deleted),
       deleted_at = VALUES(deleted_at)`,
    [
      business.id,
      business.clientId,
      business.name,
      business.type,
      business.pan,
      business.address || '',
      business.startingFy,
      business.startingYear,
      business.gstNumber || null,
      normalizeBusinessStatus(business.status),
      business.isDeleted ? 1 : 0,
      business.deletedAt ? new Date(business.deletedAt) : null,
      business.createdAt ? new Date(business.createdAt) : null,
    ],
  )
}

export async function addBusiness(clientId, payload, actor) {
  const clientProfile = await getClientBusinessProfile(clientId)
  const clientPan = clientProfile?.pan || ''
  const normalizedPayload = applySelfBusinessDefaults(payload, clientProfile)

  if (!clientPan && usesClientPanFallback(normalizedPayload.type)) {
    return {
      success: false,
      error: 'Client PAN is required for self and proprietorship businesses',
    }
  }

  const validation = validateBusinessPayload(normalizedPayload, clientPan)
  if (!validation.valid) {
    return { success: false, error: validation.error }
  }

  const business = {
    id: generateId(),
    clientId,
    ...validation.data,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date().toISOString(),
  }

  await insertBusiness(business, actor)
  return { success: true, business: serializeBusiness(business) }
}

export async function updateBusiness(clientId, businessId, payload, password, actor) {
  if (password !== BUSINESS_ACTION_PASSWORD) {
    return { success: false, error: 'Invalid password' }
  }

  const rows = await fetchBusinessRows(
    'WHERE id = ? AND client_id = ? AND is_deleted = 0',
    [businessId, clientId],
  )
  if (!rows.length) {
    return { success: false, error: 'Business not found' }
  }

  const existing = rowToBusiness(rows[0])
  const clientPan = await getClientPan(clientId)
  const validation = validateBusinessPayload(payload, clientPan)
  if (!validation.valid) {
    return { success: false, error: validation.error }
  }

  const business = {
    ...existing,
    ...validation.data,
  }

  await updateBusinessRow(business, actor)
  return { success: true, business: serializeBusiness(business) }
}

export async function deleteBusiness(clientId, businessId, password, actor) {
  if (password !== BUSINESS_ACTION_PASSWORD) {
    return { success: false, error: 'Invalid password' }
  }

  const rows = await fetchBusinessRows(
    'WHERE id = ? AND client_id = ? AND is_deleted = 0',
    [businessId, clientId],
  )
  if (!rows.length) {
    return { success: false, error: 'Business not found' }
  }

  await markBusinessDeleted(businessId, clientId, actor)
  return { success: true }
}

export async function restoreBusiness(clientId, businessId, actor) {
  const rows = await fetchBusinessRows(
    'WHERE id = ? AND client_id = ? AND is_deleted = 1',
    [businessId, clientId],
  )
  if (!rows.length) {
    return { success: false, error: 'Deleted business not found' }
  }

  await markBusinessRestored(businessId, clientId, actor)

  const restoredRows = await fetchBusinessRows(
    'WHERE id = ? AND client_id = ? AND is_deleted = 0',
    [businessId, clientId],
  )
  if (!restoredRows.length) {
    return { success: false, error: 'Deleted business not found' }
  }

  return { success: true, business: serializeBusiness(rowToBusiness(restoredRows[0])) }
}

export async function migrateBusinessesFromClientJson() {
  const clients = await query('SELECT id, pan, businesses FROM clients')
  for (const client of clients) {
    const legacyBusinesses = parseJson(client.businesses) || []
    for (const item of legacyBusinesses) {
      if (!item?.id) {
        continue
      }

      const existing = await query('SELECT id FROM businesses WHERE id = ? LIMIT 1', [item.id])
      if (existing.length) {
        continue
      }

      const type = (item.type || 'General').trim()
      const pan = normalizePan(
        isProprietorshipType(type)
          ? client.pan || item.pan || ''
          : item.pan || client.pan || '',
      )

      if (!pan || getPanValidationMessage(pan)) {
        continue
      }

      await persistBusinessLegacy({
        id: item.id,
        clientId: client.id,
        name: item.name || '',
        type,
        pan,
        address: item.address || '',
        startingFy: item.startingFy || '',
        startingYear: Number(item.startingYear) || new Date().getFullYear(),
        gstNumber: item.gstNumber || '',
        status: normalizeBusinessStatus(item.status),
        isDeleted: false,
        deletedAt: null,
        createdAt: item.createdAt || new Date().toISOString(),
      })
    }
  }
}

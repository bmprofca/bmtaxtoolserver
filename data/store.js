import { query } from '../db/connection.js'
import { parseJson } from '../db/init.js'
import { getFinancialYears, updateFinancialYearStatementType } from './fySettingsStore.js'
import { getPanValidationMessage, normalizeClientStatus, normalizePan } from './clientValidation.js'
import {
  addBusiness as createBusinessRecord,
  deleteBusiness as softDeleteBusinessRecord,
  getBusinessesForClient,
  getBusinessesMapForClients,
  getDeletedBusinessesForClient,
  restoreBusiness as restoreBusinessRecord,
  updateBusiness as updateBusinessRecord,
} from './businessStore.js'

const DELETE_PASSWORD = '123456'

const CLIENT_COLUMNS = `id, name, mobile, email, address, pin, pan,
  businesses, fy_closed_overrides, fy_statement_type_overrides,
  is_deleted, deleted_at, status, created_at`

let clients = []

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function rowToClient(row) {
  if (row.payload) {
    const legacy = parseJson(row.payload)
    if (legacy) {
      return {
        ...legacy,
        pan: legacy.pan || '',
        isDeleted: Boolean(legacy.isDeleted),
        deletedAt: legacy.deletedAt || null,
      }
    }
  }

  return {
    id: row.id,
    name: row.name || '',
    mobile: row.mobile || '',
    email: row.email || '',
    address: row.address || '',
    pin: row.pin || '',
    pan: row.pan || '',
    businesses: parseJson(row.businesses) || [],
    fyClosedOverrides: parseJson(row.fy_closed_overrides) || {},
    fyStatementTypeOverrides: parseJson(row.fy_statement_type_overrides) || {},
    isDeleted: row.is_deleted === 1 || row.is_deleted === true,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    status: normalizeClientStatus(row.status),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

async function findClientByPan(pan, excludeClientId = null) {
  const normalized = normalizePan(pan)
  if (!normalized) {
    return null
  }

  const params = excludeClientId ? [normalized, excludeClientId] : [normalized]
  const rows = await query(
    `SELECT id, name, is_deleted
     FROM clients
     WHERE pan = ?${excludeClientId ? ' AND id != ?' : ''}
     LIMIT 1`,
    params,
  )

  return rows[0] || null
}

async function persistClient(client) {
  await query(
    `INSERT INTO clients (
       id, name, mobile, email, address, pin, pan,
       businesses, fy_closed_overrides, fy_statement_type_overrides,
       is_deleted, deleted_at, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       mobile = VALUES(mobile),
       email = VALUES(email),
       address = VALUES(address),
       pin = VALUES(pin),
       pan = VALUES(pan),
       businesses = VALUES(businesses),
       fy_closed_overrides = VALUES(fy_closed_overrides),
       fy_statement_type_overrides = VALUES(fy_statement_type_overrides),
       is_deleted = VALUES(is_deleted),
       deleted_at = VALUES(deleted_at),
       status = VALUES(status)`,
    [
      client.id,
      client.name,
      client.mobile || '',
      client.email || '',
      client.address || '',
      client.pin || '',
      client.pan || null,
      JSON.stringify(client.businesses || []),
      JSON.stringify(client.fyClosedOverrides || {}),
      JSON.stringify(client.fyStatementTypeOverrides || {}),
      client.isDeleted ? 1 : 0,
      client.deletedAt ? new Date(client.deletedAt) : null,
      normalizeClientStatus(client.status),
      client.createdAt ? new Date(client.createdAt) : null,
    ],
  )
}

function buildClientFinancialYears(client) {
  const overrides = client.fyClosedOverrides || {}
  const typeOverrides = client.fyStatementTypeOverrides || {}

  return getFinancialYears().map((fy) => ({
    ...fy,
    statementType: fy.statementType || typeOverrides[fy.id] || 'Actual',
    closedBusinessIds: overrides[fy.id] || [],
  }))
}

function serializeClient(client) {
  return {
    id: client.id,
    name: client.name,
    mobile: client.mobile,
    email: client.email,
    address: client.address,
    pin: client.pin,
    pan: client.pan || '',
    businesses: client.businesses || [],
    fyClosedOverrides: client.fyClosedOverrides || {},
    fyStatementTypeOverrides: client.fyStatementTypeOverrides || {},
    isDeleted: Boolean(client.isDeleted),
    deletedAt: client.deletedAt || null,
    status: normalizeClientStatus(client.status),
    createdAt: client.createdAt,
    financialYears: buildClientFinancialYears(client),
  }
}

async function fetchClientRows(whereClause = '', params = []) {
  return query(
    `SELECT ${CLIENT_COLUMNS}
     FROM clients
     ${whereClause}
     ORDER BY created_at ASC, name ASC`,
    params,
  )
}

export async function loadClients({ includeDeleted = false, status, search } = {}) {
  const conditions = []
  const params = []

  if (!includeDeleted) {
    conditions.push('is_deleted = 0')
  }

  if (status === 'active' || status === 'inactive') {
    conditions.push('status = ?')
    params.push(status)
  }

  const term = String(search || '').trim()
  if (term) {
    const like = `%${term}%`
    conditions.push(
      `(name LIKE ? OR pan LIKE ? OR mobile LIKE ? OR email LIKE ? OR address LIKE ? OR pin LIKE ?)`,
    )
    params.push(like, like, like, like, like, like)
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = await fetchClientRows(whereClause, params)
  clients = rows.map((row) => rowToClient(row)).filter(Boolean)

  const businessesMap = await getBusinessesMapForClients(clients.map((client) => client.id))
  clients = clients.map((client) => ({
    ...client,
    businesses: businessesMap.get(client.id) || [],
  }))
}

export async function getClients({ status = 'active', search = '' } = {}) {
  await loadClients({ includeDeleted: false, status, search })
  return clients.map(serializeClient)
}

export async function getDeletedClients() {
  const rows = await fetchClientRows('WHERE is_deleted = 1')
  return rows.map((row) => serializeClient(rowToClient(row)))
}

export async function getClientById(clientId, { allowDeleted = false } = {}) {
  const rows = await fetchClientRows('WHERE id = ?', [clientId])
  if (!rows.length) {
    return null
  }

  const client = rowToClient(rows[0])
  if (client.isDeleted && !allowDeleted) {
    return null
  }

  client.businesses = await getBusinessesForClient(clientId)
  return serializeClient(client)
}

async function validatePanForSave(pan, excludeClientId = null) {
  const normalized = normalizePan(pan)
  const panError = getPanValidationMessage(normalized)

  if (panError) {
    return { valid: false, error: panError }
  }

  const existing = await findClientByPan(normalized, excludeClientId)
  if (existing) {
    if (existing.is_deleted) {
      return {
        valid: false,
        error: 'This PAN belongs to a deleted client. Restore it from Deleted Clients.',
      }
    }
    return { valid: false, error: 'A client with this PAN already exists' }
  }

  return { valid: true, pan: normalized }
}

export async function addClient({ name, mobile, email, address, pin, pan }) {
  const panCheck = await validatePanForSave(pan)
  if (!panCheck.valid) {
    return { success: false, error: panCheck.error }
  }

  const client = {
    id: generateId(),
    name: name.trim(),
    mobile: mobile?.trim() || '',
    email: email?.trim() || '',
    address: address?.trim() || '',
    pin: pin?.trim() || '',
    pan: panCheck.pan,
    businesses: [],
    fyClosedOverrides: {},
    fyStatementTypeOverrides: {},
    isDeleted: false,
    deletedAt: null,
    status: 'active',
    createdAt: new Date().toISOString(),
  }

  await persistClient(client)
  return { success: true, client: serializeClient(client) }
}

export async function updateClient(clientId, { name, mobile, email, address, pin, pan, status }) {
  const rows = await fetchClientRows('WHERE id = ? AND is_deleted = 0', [clientId])
  if (!rows.length) {
    return { success: false, error: 'Client not found' }
  }

  const client = rowToClient(rows[0])
  const panCheck = await validatePanForSave(pan, clientId)
  if (!panCheck.valid) {
    return { success: false, error: panCheck.error }
  }

  client.name = name.trim()
  client.mobile = mobile?.trim() || ''
  client.email = email?.trim() || ''
  client.address = address?.trim() || ''
  client.pin = pin?.trim() || ''
  client.pan = panCheck.pan
  if (status !== undefined) {
    client.status = normalizeClientStatus(status)
  }

  await persistClient(client)
  return { success: true, client: serializeClient(client) }
}

async function getActiveClient(clientId) {
  const rows = await fetchClientRows(
    'WHERE id = ? AND is_deleted = 0 AND status = ?',
    [clientId, 'active'],
  )
  if (!rows.length) {
    return null
  }
  return rowToClient(rows[0])
}

export async function addBusiness(clientId, payload, actor) {
  const client = await getActiveClient(clientId)

  if (!client) {
    return null
  }

  const result = await createBusinessRecord(clientId, payload, actor)
  if (!result.success) {
    return { error: result.error }
  }

  return result.business
}

export async function updateBusiness(clientId, businessId, payload, password, actor) {
  const client = await getActiveClient(clientId)

  if (!client) {
    return { success: false, error: 'Client not found' }
  }

  return updateBusinessRecord(clientId, businessId, payload, password, actor)
}

export async function deleteBusiness(clientId, businessId, password, actor) {
  const client = await getActiveClient(clientId)

  if (!client) {
    return { success: false, error: 'Client not found' }
  }

  const result = await softDeleteBusinessRecord(clientId, businessId, password, actor)
  if (!result.success) {
    return result
  }

  if (client.fyClosedOverrides) {
    Object.keys(client.fyClosedOverrides).forEach((fyId) => {
      client.fyClosedOverrides[fyId] = client.fyClosedOverrides[fyId].filter(
        (id) => id !== businessId,
      )
    })
    await persistClient(client)
  }

  return { success: true }
}

export async function getDeletedBusinesses(clientId) {
  const rows = await fetchClientRows('WHERE id = ? AND is_deleted = 0', [clientId])
  if (!rows.length) {
    return null
  }

  return getDeletedBusinessesForClient(clientId)
}

export async function restoreBusiness(clientId, businessId, actor) {
  const rows = await fetchClientRows('WHERE id = ? AND is_deleted = 0', [clientId])
  if (!rows.length) {
    return { success: false, error: 'Client not found' }
  }

  return restoreBusinessRecord(clientId, businessId, actor)
}

export async function updateFyClosedBusinesses(clientId, fyId, closedBusinessIds) {
  const client = await getActiveClient(clientId)

  if (!client) {
    return null
  }

  const globalFy = getFinancialYears().find((item) => item.id === fyId)

  if (!globalFy) {
    return null
  }

  if (!client.fyClosedOverrides) {
    client.fyClosedOverrides = {}
  }

  client.fyClosedOverrides[fyId] = closedBusinessIds || []
  await persistClient(client)

  return buildClientFinancialYears(client).find((item) => item.id === fyId) || null
}

export async function updateFyStatementType(clientId, fyId, statementType, actor) {
  const client = await getActiveClient(clientId)

  if (!client) {
    return null
  }

  const globalFy = getFinancialYears().find((item) => item.id === fyId)

  if (!globalFy) {
    return null
  }

  const updated = await updateFinancialYearStatementType(fyId, statementType, actor)
  if (!updated) {
    return null
  }

  return buildClientFinancialYears(client).find((item) => item.id === fyId) || null
}

export async function updateFinancialYear(clientId, fyId, { closedBusinessIds, statementType }, actor) {
  if (closedBusinessIds !== undefined) {
    const result = await updateFyClosedBusinesses(clientId, fyId, closedBusinessIds)
    if (!result) {
      return null
    }
  }

  if (statementType !== undefined) {
    const result = await updateFyStatementType(clientId, fyId, statementType, actor)
    if (!result) {
      return null
    }
  }

  const client = await getActiveClient(clientId)
  if (!client) {
    return null
  }

  return buildClientFinancialYears(client).find((item) => item.id === fyId) || null
}

export async function deleteClient(clientId, password) {
  if (password !== DELETE_PASSWORD) {
    return { success: false, error: 'Invalid password' }
  }

  const rows = await fetchClientRows('WHERE id = ? AND is_deleted = 0', [clientId])
  if (!rows.length) {
    return { success: false, error: 'Client not found' }
  }

  const client = rowToClient(rows[0])
  client.isDeleted = true
  client.deletedAt = new Date().toISOString()

  await persistClient(client)
  await loadClients({ includeDeleted: false })
  return { success: true }
}

export async function restoreClient(clientId) {
  const rows = await fetchClientRows('WHERE id = ? AND is_deleted = 1', [clientId])
  if (!rows.length) {
    return { success: false, error: 'Deleted client not found' }
  }

  const client = rowToClient(rows[0])

  if (client.pan) {
    const activeWithPan = await findClientByPan(client.pan)
    if (activeWithPan && activeWithPan.id !== clientId) {
      return { success: false, error: 'Another active client already uses this PAN' }
    }
  }

  client.isDeleted = false
  client.deletedAt = null
  client.status = 'active'

  await persistClient(client)
  await loadClients({ includeDeleted: false })
  return { success: true, client: serializeClient(client) }
}

import { query } from '../db/connection.js'
import { getSetting, setSetting } from '../db/init.js'
import { getCaUdinAssignmentCount } from './udinStore.js'

const DELETE_CONFIRMATION_CODE = '123456'
const SELECTED_CA_KEY = 'ca_selected_profile_id'

const CA_COLUMNS = `id, firm_name, partner_name, firm_type, frn_number, membership_number, udin,
  seal_signature_name, seal_signature_data_url, address, city, pin, place, status,
  is_deleted, deleted_at, created_at`

let caProfiles = []
let selectedCaProfileId = ''

function generateId() {
  return `ca_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
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

function normalizeCaStatus(value) {
  return String(value || '').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active'
}

function emptyCaProfile() {
  return {
    id: '',
    status: 'active',
    firmName: '',
    partnerName: '',
    firmType: '',
    frnNumber: '',
    membershipNumber: '',
    udin: '',
    sealSignatureName: '',
    sealSignatureDataUrl: '',
    address: '',
    city: '',
    pin: '',
    place: '',
  }
}

function normalizeCaProfile(raw = {}) {
  return {
    id: String(raw.id || generateId()).trim(),
    status: normalizeCaStatus(raw.status),
    firmName: String(raw.firmName || raw.firm_name || '').trim(),
    partnerName: String(raw.partnerName || raw.partner_name || '').trim(),
    firmType: String(raw.firmType || raw.firm_type || '').trim(),
    frnNumber: String(raw.frnNumber || raw.frn_number || '').trim(),
    membershipNumber: String(raw.membershipNumber || raw.membership_number || '').trim(),
    udin: String(raw.udin || '').trim(),
    sealSignatureName: String(raw.sealSignatureName || raw.seal_signature_name || '').trim(),
    sealSignatureDataUrl: String(
      raw.sealSignatureDataUrl || raw.seal_signature_data_url || '',
    ).trim(),
    address: String(raw.address || '').trim(),
    city: String(raw.city || '').trim(),
    pin: String(raw.pin || '').trim(),
    place: String(raw.place || '').trim(),
  }
}

function rowToCaProfile(row) {
  return {
    id: row.id,
    status: normalizeCaStatus(row.status),
    firmName: row.firm_name || '',
    partnerName: row.partner_name || '',
    firmType: row.firm_type || '',
    frnNumber: row.frn_number || '',
    membershipNumber: row.membership_number || '',
    udin: row.udin || '',
    sealSignatureName: row.seal_signature_name || '',
    sealSignatureDataUrl: row.seal_signature_data_url || '',
    address: row.address || '',
    city: row.city || '',
    pin: row.pin || '',
    place: row.place || '',
    isDeleted: row.is_deleted === 1 || row.is_deleted === true,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

function serializeCaProfile(profile) {
  return {
    id: profile.id,
    status: normalizeCaStatus(profile.status),
    firmName: profile.firmName,
    partnerName: profile.partnerName,
    firmType: profile.firmType,
    frnNumber: profile.frnNumber,
    membershipNumber: profile.membershipNumber,
    udin: profile.udin,
    sealSignatureName: profile.sealSignatureName,
    sealSignatureDataUrl: profile.sealSignatureDataUrl,
    address: profile.address,
    city: profile.city,
    pin: profile.pin,
    place: profile.place,
  }
}

async function fetchCaRows(whereClause = '', params = []) {
  return query(
    `SELECT ${CA_COLUMNS}
     FROM ca_profiles
     ${whereClause}
     ORDER BY created_at ASC, partner_name ASC`,
    params,
  )
}

async function loadSelectedCaProfileId() {
  const direct = await getSetting(SELECTED_CA_KEY)
  if (typeof direct === 'string' && direct.trim()) {
    selectedCaProfileId = direct.trim()
    return
  }

  const legacy = (await getSetting('ca_settings')) || {}
  selectedCaProfileId = String(legacy.selectedCaProfileId || '').trim()
  if (selectedCaProfileId) {
    await setSetting(SELECTED_CA_KEY, selectedCaProfileId)
  }
}

async function persistSelectedCaProfileId(nextId) {
  selectedCaProfileId = String(nextId || '').trim()
  await setSetting(SELECTED_CA_KEY, selectedCaProfileId)
}

async function reloadActiveCaProfiles() {
  const rows = await fetchCaRows('WHERE is_deleted = 0')
  caProfiles = rows.map((row) => serializeCaProfile(rowToCaProfile(row)))
  return caProfiles
}

async function insertCaProfile(profile, actor) {
  const createdBy = buildActor(actor)

  await query(
    `INSERT INTO ca_profiles (
       id, firm_name, partner_name, firm_type, frn_number, membership_number, udin,
       seal_signature_name, seal_signature_data_url, address, city, pin, place, status,
       is_deleted, deleted_at, created_at,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, CURRENT_TIMESTAMP, ?, ?, ?)`,
    [
      profile.id,
      profile.firmName,
      profile.partnerName,
      profile.firmType,
      profile.frnNumber,
      profile.membershipNumber,
      profile.udin,
      profile.sealSignatureName,
      profile.sealSignatureDataUrl || null,
      profile.address,
      profile.city,
      profile.pin,
      profile.place,
      normalizeCaStatus(profile.status),
      createdBy.userId,
      createdBy.username,
      createdBy.name,
    ],
  )
}

async function updateCaProfileRow(profile, actor) {
  const updatedBy = buildActor(actor)

  await query(
    `UPDATE ca_profiles SET
       firm_name = ?,
       partner_name = ?,
       firm_type = ?,
       frn_number = ?,
       membership_number = ?,
       udin = ?,
       seal_signature_name = ?,
       seal_signature_data_url = ?,
       address = ?,
       city = ?,
       pin = ?,
       place = ?,
       status = ?,
       updated_by_user_id = ?,
       updated_by_username = ?,
       updated_by_name = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND is_deleted = 0`,
    [
      profile.firmName,
      profile.partnerName,
      profile.firmType,
      profile.frnNumber,
      profile.membershipNumber,
      profile.udin,
      profile.sealSignatureName,
      profile.sealSignatureDataUrl || null,
      profile.address,
      profile.city,
      profile.pin,
      profile.place,
      normalizeCaStatus(profile.status),
      updatedBy.userId,
      updatedBy.username,
      updatedBy.name,
      profile.id,
    ],
  )
}

async function markCaProfileDeleted(profileId, actor) {
  const deletedBy = buildActor(actor)

  await query(
    `UPDATE ca_profiles SET
       is_deleted = 1,
       deleted_at = CURRENT_TIMESTAMP,
       deleted_by_user_id = ?,
       deleted_by_username = ?,
       deleted_by_name = ?
     WHERE id = ? AND is_deleted = 0`,
    [deletedBy.userId, deletedBy.username, deletedBy.name, profileId],
  )
}

async function markCaProfileRestored(profileId, actor) {
  const updatedBy = buildActor(actor)

  await query(
    `UPDATE ca_profiles SET
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
    [updatedBy.userId, updatedBy.username, updatedBy.name, profileId],
  )
}

export async function migrateCaProfilesFromSettings() {
  const existing = await query('SELECT id FROM ca_profiles LIMIT 1')
  if (existing.length) {
    return
  }

  const stored = (await getSetting('ca_settings')) || {}
  const legacyProfiles = Array.isArray(stored.caProfiles) ? stored.caProfiles : []

  for (const item of legacyProfiles) {
    const profile = normalizeCaProfile(item)
    if (!profile.partnerName && !profile.firmName) {
      continue
    }

    await query(
      `INSERT INTO ca_profiles (
         id, firm_name, partner_name, firm_type, frn_number, membership_number, udin,
         seal_signature_name, seal_signature_data_url, address, city, pin, place,
         is_deleted, deleted_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, CURRENT_TIMESTAMP)`,
      [
        profile.id,
        profile.firmName,
        profile.partnerName,
        profile.firmType,
        profile.frnNumber,
        profile.membershipNumber,
        profile.udin,
        profile.sealSignatureName,
        profile.sealSignatureDataUrl || null,
        profile.address,
        profile.city,
        profile.pin,
        profile.place,
      ],
    )
  }

  if (stored.selectedCaProfileId) {
    await setSetting(SELECTED_CA_KEY, String(stored.selectedCaProfileId).trim())
  }
}

export async function loadCaSettings() {
  await loadSelectedCaProfileId()
  await reloadActiveCaProfiles()
}

export function getCaProfile() {
  const active = caProfiles.find((profile) => normalizeCaStatus(profile.status) === 'active')
  if (!active) {
    return { ...emptyCaProfile() }
  }
  return { ...active }
}

export function getCaSettings() {
  return {
    caProfiles: caProfiles.map((profile) => ({ ...profile })),
  }
}

export async function saveCaProfile(next, actor) {
  const normalized = normalizeCaProfile(next)
  const existing = await fetchCaRows('WHERE id = ? AND is_deleted = 0', [normalized.id])

  if (existing.length) {
    await updateCaProfileRow(normalized, actor)
  } else {
    await insertCaProfile(normalized, actor)
  }

  await reloadActiveCaProfiles()
  return getCaProfile()
}

export async function saveCaSettings(next = {}, actor) {
  const nextProfiles = Array.isArray(next.caProfiles) ? next.caProfiles.map(normalizeCaProfile) : []

  const existingRows = await fetchCaRows('WHERE is_deleted = 0')
  const existingIds = new Set(existingRows.map((row) => row.id))

  for (const profile of nextProfiles) {
    if (existingIds.has(profile.id)) {
      await updateCaProfileRow(profile, actor)
    } else {
      await insertCaProfile(profile, actor)
    }
  }

  await reloadActiveCaProfiles()
  return getCaSettings()
}

export async function updateCaProfileStatus(profileId, status, actor) {
  const rows = await fetchCaRows('WHERE id = ? AND is_deleted = 0', [profileId])
  if (!rows.length) {
    return null
  }

  const profile = rowToCaProfile(rows[0])
  const normalizedStatus = normalizeCaStatus(status)

  if (normalizeCaStatus(profile.status) === normalizedStatus) {
    return serializeCaProfile(profile)
  }

  await updateCaProfileRow({ ...profile, status: normalizedStatus }, actor)
  await reloadActiveCaProfiles()
  return getCaSettings().caProfiles.find((item) => item.id === profileId) || null
}

export async function getDeletedCaProfiles() {
  const rows = await fetchCaRows('WHERE is_deleted = 1')
  return rows.map((row) => {
    const profile = rowToCaProfile(row)
    return {
      ...serializeCaProfile(profile),
      isDeleted: true,
      deletedAt: profile.deletedAt,
    }
  })
}

export async function softDeleteCaProfile(profileId, confirmationCode, actor) {
  if (confirmationCode !== DELETE_CONFIRMATION_CODE) {
    return { success: false, error: 'Invalid confirmation code' }
  }

  const rows = await fetchCaRows('WHERE id = ? AND is_deleted = 0', [profileId])
  if (!rows.length) {
    return { success: false, error: 'CA profile not found' }
  }

  const udinUsage = await getCaUdinAssignmentCount(profileId)
  if (udinUsage > 0) {
    return {
      success: false,
      error:
        'This CA is assigned to financial statement UDIN records. Delete is not allowed.',
    }
  }

  await markCaProfileDeleted(profileId, actor)
  await reloadActiveCaProfiles()
  return { success: true }
}

export async function restoreCaProfile(profileId, actor) {
  const rows = await fetchCaRows('WHERE id = ? AND is_deleted = 1', [profileId])
  if (!rows.length) {
    return { success: false, error: 'Deleted CA profile not found' }
  }

  await markCaProfileRestored(profileId, actor)
  await reloadActiveCaProfiles()

  const restored = rowToCaProfile(rows[0])
  return {
    success: true,
    caProfile: serializeCaProfile(restored),
  }
}

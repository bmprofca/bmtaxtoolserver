import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { query } from '../db/connection.js'

const BCRYPT_ROUNDS = 12

function generateId() {
  return `usr_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`
}

export function generateUserToken() {
  return crypto.randomBytes(32).toString('base64url')
}

export function generateSessionToken() {
  return crypto.randomBytes(48).toString('base64url')
}

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

export async function verifyPassword(password, passwordHash) {
  if (!passwordHash) {
    return false
  }
  if (passwordHash.startsWith('$2')) {
    return bcrypt.compare(password, passwordHash)
  }
  return password === passwordHash
}

import { normalizeUserType } from './userPermissions.js'

function serializeUser(row, { includeToken = false } = {}) {
  const user = {
    id: row.id,
    username: row.username,
    mobile: row.mobile || '',
    name: row.name || row.username,
    userType: normalizeUserType(row.user_type),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    isActive: row.is_active === undefined ? true : Boolean(row.is_active),
  }

  if (includeToken && row.user_token) {
    user.userToken = row.user_token
  }

  return user
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase()
}

function normalizeMobile(mobile) {
  return String(mobile || '').trim().replace(/\s+/g, '')
}

export async function getUsers() {
  const rows = await query(
    `SELECT id, username, mobile, name, user_type, user_token, created_at, is_active
     FROM users
     WHERE is_active = 1
     ORDER BY created_at ASC, username ASC`,
  )
  return rows.map((row) => serializeUser(row))
}

export async function getDeletedUsers() {
  const rows = await query(
    `SELECT id, username, mobile, name, user_type, user_token, created_at, is_active
     FROM users
     WHERE is_active = 0
     ORDER BY created_at DESC, username ASC`,
  )
  return rows.map((row) => serializeUser(row))
}

export async function getUserById(userId) {
  const rows = await query(
    `SELECT id, username, mobile, name, user_type, password_hash, user_token, created_at, is_active
     FROM users
     WHERE id = ?`,
    [userId],
  )
  return rows[0] || null
}

export async function getUserByUsername(username) {
  const normalized = normalizeUsername(username)
  const rows = await query(
    `SELECT id, username, mobile, name, user_type, password_hash, user_token, created_at, is_active
     FROM users
     WHERE username = ?`,
    [normalized],
  )
  return rows[0] || null
}

export async function getUserByToken(userToken) {
  if (!userToken?.trim()) {
    return null
  }

  const rows = await query(
    `SELECT id, username, mobile, name, user_type, password_hash, user_token, created_at, is_active
     FROM users
     WHERE user_token = ? AND is_active = 1`,
    [userToken.trim()],
  )
  return rows[0] || null
}

export async function createUser({ username, mobile, password, name, userType }) {
  const normalizedUsername = normalizeUsername(username)
  const normalizedMobile = normalizeMobile(mobile)
  const plainPassword = String(password || '')
  const normalizedUserType = normalizeUserType(userType)

  if (!normalizedUsername) {
    return { success: false, error: 'Username is required' }
  }

  if (!normalizedMobile) {
    return { success: false, error: 'Mobile number is required' }
  }

  if (plainPassword.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters' }
  }

  const existing = await getUserByUsername(normalizedUsername)
  if (existing) {
    return { success: false, error: 'Username already exists' }
  }

  const id = generateId()
  const passwordHash = await hashPassword(plainPassword)
  const userToken = generateUserToken()
  const displayName = String(name || username).trim() || normalizedUsername

  await query(
    `INSERT INTO users (id, username, mobile, password_hash, user_token, name, user_type, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [id, normalizedUsername, normalizedMobile, passwordHash, userToken, displayName, normalizedUserType],
  )

  const user = serializeUser(
    {
      id,
      username: normalizedUsername,
      mobile: normalizedMobile,
      name: displayName,
      user_type: normalizedUserType,
      user_token: userToken,
      created_at: new Date(),
      is_active: 1,
    },
    { includeToken: true },
  )

  return { success: true, user }
}

export async function regenerateUserToken(userId) {
  const user = await getUserById(userId)
  if (!user) {
    return { success: false, error: 'User not found' }
  }

  const userToken = generateUserToken()
  await query('UPDATE users SET user_token = ? WHERE id = ?', [userToken, userId])

  return {
    success: true,
    user: serializeUser({ ...user, user_token: userToken }, { includeToken: true }),
  }
}

export async function updateUserProfile(userId, { name, mobile }) {
  const user = await getUserById(userId)
  if (!user) {
    return { success: false, error: 'User not found' }
  }

  const displayName = String(name || '').trim()
  const normalizedMobile = normalizeMobile(mobile)

  if (!displayName) {
    return { success: false, error: 'Name is required' }
  }

  if (!normalizedMobile) {
    return { success: false, error: 'Mobile number is required' }
  }

  await query('UPDATE users SET name = ?, mobile = ? WHERE id = ?', [
    displayName,
    normalizedMobile,
    userId,
  ])

  const updated = await getUserById(userId)
  return { success: true, user: serializeUser(updated) }
}

export async function updateAppUser(userId, { name, mobile, userType, password }) {
  const user = await getUserById(userId)
  if (!user || user.is_active === 0) {
    return { success: false, error: 'User not found' }
  }

  const displayName = String(name || '').trim()
  const normalizedMobile = normalizeMobile(mobile)
  const normalizedUserType = normalizeUserType(userType)

  if (!displayName) {
    return { success: false, error: 'Name is required' }
  }

  if (!normalizedMobile) {
    return { success: false, error: 'Mobile number is required' }
  }

  const updates = ['name = ?', 'mobile = ?', 'user_type = ?']
  const params = [displayName, normalizedMobile, normalizedUserType]

  const plainPassword = String(password || '')
  if (plainPassword) {
    if (plainPassword.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters' }
    }
    updates.push('password_hash = ?')
    params.push(await hashPassword(plainPassword))
  }

  params.push(userId)
  await query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params)

  const updated = await getUserById(userId)
  return { success: true, user: serializeUser(updated) }
}

export async function deactivateUser(userId, requesterId) {
  const user = await getUserById(userId)
  if (!user || user.is_active === 0) {
    return { success: false, error: 'User not found' }
  }

  if (requesterId && userId === requesterId) {
    return { success: false, error: 'You cannot delete your own account' }
  }

  await query('UPDATE users SET is_active = 0 WHERE id = ?', [userId])
  return { success: true }
}

export async function restoreUser(userId) {
  const user = await getUserById(userId)
  if (!user) {
    return { success: false, error: 'User not found' }
  }

  if (user.is_active !== 0) {
    return { success: false, error: 'User is already active' }
  }

  await query('UPDATE users SET is_active = 1 WHERE id = ?', [userId])
  const updated = await getUserById(userId)
  return { success: true, user: serializeUser(updated) }
}

export async function changeUserPassword(userId, currentPassword, newPassword) {
  const user = await getUserById(userId)
  if (!user) {
    return { success: false, error: 'User not found' }
  }

  const valid = await verifyPassword(currentPassword, user.password_hash)
  if (!valid) {
    return { success: false, error: 'Current password is incorrect' }
  }

  const plainPassword = String(newPassword || '')
  if (plainPassword.length < 6) {
    return { success: false, error: 'New password must be at least 6 characters' }
  }

  const passwordHash = await hashPassword(plainPassword)
  await query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId])

  return { success: true }
}

export async function migrateLegacyUsers() {
  const rows = await query('SELECT id, username, password_hash, user_token, user_type FROM users')

  for (const row of rows) {
    const updates = []
    const params = []

    if (row.username === 'admin' || row.id === '1') {
      if (row.user_type !== 'admin') {
        updates.push('user_type = ?')
        params.push('admin')
      }
    } else if (!row.user_type) {
      updates.push('user_type = ?')
      params.push('staff')
    }

    if (row.password_hash && !row.password_hash.startsWith('$2')) {
      updates.push('password_hash = ?')
      params.push(await hashPassword(row.password_hash))
    }

    if (!row.user_token) {
      updates.push('user_token = ?')
      params.push(generateUserToken())
    }

    if (updates.length) {
      params.push(row.id)
      await query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params)
    }
  }
}

import { query } from '../db/connection.js'
import {
  generateSessionToken,
  getUserByToken,
  getUserByUsername,
  verifyPassword,
} from './userStore.js'
import { normalizeUserType } from './userPermissions.js'

export async function loadAuth() {
  // Sessions are loaded on demand from the database.
}

function serializeAuthUser(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.name || row.username,
    mobile: row.mobile || '',
    userType: normalizeUserType(row.user_type),
  }
}

export async function authenticate(username, password) {
  const user = await getUserByUsername(username)

  if (!user || user.is_active === 0) {
    return null
  }

  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) {
    return null
  }

  const token = generateSessionToken()
  await query('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [token, user.id])

  return { token, user: serializeAuthUser(user) }
}

export async function authenticateByUserToken(userToken) {
  const user = await getUserByToken(userToken)
  if (!user) {
    return null
  }
  return serializeAuthUser(user)
}

export async function getSession(token) {
  if (!token?.trim()) {
    return null
  }

  const sessionRows = await query(
    `SELECT s.token, u.id, u.username, u.name, u.mobile, u.user_type
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND u.is_active = 1`,
    [token.trim()],
  )

  if (sessionRows.length) {
    const row = sessionRows[0]
    return {
      id: row.id,
      username: row.username,
      name: row.name || row.username,
      mobile: row.mobile || '',
      userType: normalizeUserType(row.user_type),
    }
  }

  const user = await getUserByToken(token.trim())
  return user ? serializeAuthUser(user) : null
}

export async function removeSession(token) {
  await query('DELETE FROM sessions WHERE token = ?', [token])
}

import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadEnv } from '../utils/loadEnv.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
loadEnv()
// Keep legacy path for tools that import connection before loadEnv existed.
dotenv.config({ path: path.join(__dirname, '../.env'), override: false })

function isHostingerAppRuntime() {
  const cwd = process.cwd()
  return (
    cwd.includes('domains/toolserver') ||
    cwd.includes('toolserver.bmtaxopc.com') ||
    process.env.HOSTINGER_DEPLOY === '1'
  )
}

/** On Hostinger Node, MySQL is local — avoid remote host (counts against hourly connection cap). */
function resolveDbHost() {
  const configured = (process.env.DB_HOST || 'localhost').trim()
  if (process.env.DB_FORCE_REMOTE_HOST === '1') {
    return configured
  }
  if (
    isHostingerAppRuntime() &&
    configured !== 'localhost' &&
    configured !== '127.0.0.1'
  ) {
    return 'localhost'
  }
  return configured
}

const CONNECT_TIMEOUT_MS = Number(process.env.DB_CONNECT_TIMEOUT_MS || 5_000)
const QUERY_MAX_ATTEMPTS = Number(process.env.DB_QUERY_MAX_ATTEMPTS || 2)

const pool = mysql.createPool({
  host: resolveDbHost(),
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_LIMIT || 3),
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
  connectTimeout: CONNECT_TIMEOUT_MS,
  maxIdle: 60_000,
  idleTimeout: 60_000,
})

const TRANSIENT_DB_ERROR_CODES = new Set([
  'ECONNRESET',
  'PROTOCOL_CONNECTION_LOST',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EPIPE',
])

function isRateLimitDbError(err) {
  return (
    err?.code === 'ER_USER_LIMIT_REACHED' ||
    String(err?.message || '').includes('ER_USER_LIMIT_REACHED') ||
    String(err?.message || '').includes('hourly connection limit')
  )
}

function isTransientDbError(err) {
  return TRANSIENT_DB_ERROR_CODES.has(err?.code)
}

function retryDelayMs(attempt) {
  return attempt * 500
}

function formatDbConfigError(err) {
  const host = resolveDbHost()
  const missing = []
  if (!process.env.DB_USER) missing.push('DB_USER')
  if (!process.env.DB_NAME) missing.push('DB_NAME')
  const isLocalHost = host === 'localhost' || host === '127.0.0.1'
  if (!isLocalHost && !process.env.DB_PASSWORD) missing.push('DB_PASSWORD')
  if (missing.length) {
    return `Missing environment variables: ${missing.join(', ')}. Check server/.env`
  }

  if (err?.code === 'ER_USER_LIMIT_REACHED') {
    return (
      'MySQL hourly connection limit reached (Hostinger caps connections per hour). ' +
      'Wait 30–60 minutes without retrying, then restart the API. ' +
      'On the live server use DB_HOST=localhost in nodejs/.env (not the remote IP).'
    )
  }

  if (err?.code === 'ER_ACCESS_DENIED_ERROR') {
    const hostMatch = String(err.message || '').match(/@'([^']+)'/)
    const clientIp = hostMatch?.[1]
    const ipHint =
      clientIp && clientIp !== 'localhost'
        ? ` Add IP ${clientIp} under Hostinger → Databases → Remote MySQL.`
        : ' Add your IP under Hostinger → Databases → Remote MySQL.'
    return (
      `MySQL access denied for ${process.env.DB_USER || 'DB_USER'}.${ipHint} ` +
      'Also verify DB_PASSWORD in server/.env matches hPanel.'
    )
  }

  if (host === 'localhost' || host === '127.0.0.1') {
    return (
      'Cannot reach MySQL at localhost. On Hostinger use localhost only when Node runs on the server. ' +
      'For local development, enable Remote MySQL in hPanel and set DB_HOST to the remote hostname shown there.'
    )
  }
  return `Cannot reach MySQL at ${host}:3306. Enable Remote MySQL in Hostinger hPanel and allow your IP.`
}

export { isRateLimitDbError, resolveDbHost }

export function getPool() {
  return pool
}

export async function query(sql, params = [], attempt = 1) {
  const maxAttempts = QUERY_MAX_ATTEMPTS
  try {
    const [rows] = await pool.query(sql, params)
    return rows
  } catch (err) {
    if (attempt < maxAttempts && isTransientDbError(err)) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)))
      return query(sql, params, attempt + 1)
    }
    throw err
  }
}

function withTimeout(promise, timeoutMs, label = 'Database operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    }),
  ])
}

export async function testConnection(timeoutMs = CONNECT_TIMEOUT_MS) {
  try {
    const [rows] = await withTimeout(pool.query('SELECT 1 AS ok'), timeoutMs, 'Database ping')
    return rows[0]?.ok === 1
  } catch {
    return false
  }
}

export async function verifyConnection() {
  const host = resolveDbHost()
  const isLocalHost = host === 'localhost' || host === '127.0.0.1'
  const missing = []
  if (!process.env.DB_USER) missing.push('DB_USER')
  if (!process.env.DB_NAME) missing.push('DB_NAME')
  if (!isLocalHost && !process.env.DB_PASSWORD) missing.push('DB_PASSWORD')
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}. Check server/.env`)
  }

  try {
    const [rows] = await withTimeout(
      pool.query('SELECT 1 AS ok'),
      CONNECT_TIMEOUT_MS,
      'Database connection',
    )
    if (rows[0]?.ok !== 1) {
      throw new Error('Database ping failed')
    }
  } catch (err) {
    if (err.message && !err.code) {
      throw err
    }
    throw new Error(`${formatDbConfigError(err)} (${err.code || err.message})`)
  }
}

export async function closePool() {
  await pool.end()
}

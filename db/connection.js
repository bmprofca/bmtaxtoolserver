import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../.env') })

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
  connectTimeout: 20_000,
  maxIdle: 120_000,
  idleTimeout: 120_000,
})

const TRANSIENT_DB_ERROR_CODES = new Set([
  'ECONNRESET',
  'PROTOCOL_CONNECTION_LOST',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EPIPE',
])

function isTransientDbError(err) {
  return TRANSIENT_DB_ERROR_CODES.has(err?.code)
}

function retryDelayMs(attempt) {
  return attempt * 500
}

function formatDbConfigError(err) {
  const host = process.env.DB_HOST || 'localhost'
  const missing = []
  if (!process.env.DB_USER) missing.push('DB_USER')
  if (!process.env.DB_PASSWORD) missing.push('DB_PASSWORD')
  if (!process.env.DB_NAME) missing.push('DB_NAME')
  if (missing.length) {
    return `Missing environment variables: ${missing.join(', ')}. Check server/.env`
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

export function getPool() {
  return pool
}

export async function query(sql, params = [], attempt = 1) {
  const maxAttempts = 4
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

export async function testConnection() {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok')
    return rows[0]?.ok === 1
  } catch {
    return false
  }
}

export async function verifyConnection() {
  if (!process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) {
    throw new Error(formatDbConfigError())
  }

  try {
    const [rows] = await pool.query('SELECT 1 AS ok')
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

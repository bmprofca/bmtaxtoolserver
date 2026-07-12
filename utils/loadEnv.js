import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.join(moduleDir, '..')

function hasDatabaseEnv() {
  if (!process.env.DB_USER || !process.env.DB_NAME) {
    return false
  }
  const host = (process.env.DB_HOST || 'localhost').trim()
  const isLocalHost = host === 'localhost' || host === '127.0.0.1'
  if (isLocalHost) {
    return true
  }
  return Boolean(process.env.DB_PASSWORD)
}

/** Load DB env from .env when not already provided (e.g. Hostinger runtime injects vars). */
export function loadEnv() {
  if (hasDatabaseEnv()) {
    return { loadedFrom: null, ok: true }
  }

  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(serverRoot, '.env'),
    path.join(serverRoot, '..', '.env'),
  ]

  let loadedFrom = null

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) {
      continue
    }

    dotenv.config({ path: envPath, override: false })
    loadedFrom = envPath

    if (hasDatabaseEnv()) {
      break
    }
  }

  // Local overrides: server/.env.local (gitignored) — e.g. DB_HOST=127.0.0.1 for local MySQL
  const localCandidates = [
    path.join(process.cwd(), '.env.local'),
    path.join(serverRoot, '.env.local'),
  ]

  for (const envPath of localCandidates) {
    if (!fs.existsSync(envPath)) {
      continue
    }

    dotenv.config({ path: envPath, override: true })
    loadedFrom = envPath
  }

  return { loadedFrom, ok: hasDatabaseEnv() }
}

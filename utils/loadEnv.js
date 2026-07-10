import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.join(moduleDir, '..')

function hasDatabaseEnv() {
  return Boolean(process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME)
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

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) {
      continue
    }

    dotenv.config({ path: envPath, override: false })

    if (hasDatabaseEnv()) {
      return { loadedFrom: envPath, ok: true }
    }
  }

  return { loadedFrom: null, ok: hasDatabaseEnv() }
}

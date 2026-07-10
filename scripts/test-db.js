import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadEnv } from '../utils/loadEnv.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envStatus = loadEnv()
dotenv.config({ path: path.join(__dirname, '../.env'), override: false })

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectTimeout: 15000,
}

function printConfig() {
  console.log('Database configuration:')
  console.log(`  DB_HOST=${config.host}`)
  console.log(`  DB_PORT=${config.port}`)
  console.log(`  DB_NAME=${config.database || '(missing)'}`)
  console.log(`  DB_USER=${config.user || '(missing)'}`)
  console.log(`  DB_PASSWORD=${config.password ? '***set***' : '(missing)'}`)
  console.log('')
}

async function getPublicIp() {
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) })
    const data = await res.json()
    return data.ip
  } catch {
    return null
  }
}

async function main() {
  printConfig()

  if (!config.user || !config.password || !config.database) {
    console.error('FAIL: Missing DB_USER, DB_PASSWORD, or DB_NAME in server/.env')
    process.exit(1)
  }

  if (config.host === 'localhost' || config.host === '127.0.0.1') {
    console.log('Note: DB_HOST is localhost.')
    console.log('  - Works when Node.js runs ON Hostinger (same server as MySQL).')
    console.log('  - Does NOT work from your Mac unless MySQL is installed locally.')
    console.log('')
  }

  try {
    const connection = await mysql.createConnection(config)
    await connection.query('SELECT 1 AS ok')
    const [tables] = await connection.query('SHOW TABLES')
    console.log('SUCCESS: Database connected.')
    console.log(`Tables found: ${tables.length}`)
    await connection.end()
    process.exit(0)
  } catch (err) {
    console.error('FAIL: Could not connect to database.')
    console.error(`  Error: ${err.code || ''} ${err.message || err}`)

    if (err.code === 'ECONNREFUSED' && (config.host === 'localhost' || config.host === '127.0.0.1')) {
      console.error('')
      console.error('Fix for local development:')
      console.error('  1. Hostinger hPanel → Databases → Remote MySQL')
      console.error('  2. Enable "Any Host" (or add your public IP)')
      console.error('  3. Copy the MySQL hostname shown at the top of that page')
      console.error('  4. Set DB_HOST=that_hostname in server/.env')
    }

    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
      console.error('')
      console.error('Fix: Remote MySQL is likely blocked.')
      console.error('  1. Hostinger hPanel → Databases → Remote MySQL')
      console.error('  2. Add your IP or enable "Any Host" for database u278432002_tool')
      const ip = await getPublicIp()
      if (ip) {
        console.error(`  3. Your current public IP: ${ip}`)
      }
      console.error('  4. Use the remote MySQL hostname from hPanel (not localhost)')
    }

    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('')
      const hostMatch = String(err.message || '').match(/@'([^']+)'/)
      const clientIp = hostMatch?.[1]
      console.error('Fix: Hostinger rejected this login from your current network.')
      console.error('  1. Hostinger hPanel → Databases → Remote MySQL')
      if (clientIp && clientIp !== 'localhost') {
        console.error(`  2. Add this IP to allowed hosts: ${clientIp}`)
        console.error('     (or enable "Any Host" / % while developing)')
      } else {
        console.error('  2. Add your public IP to allowed hosts (or enable "Any Host")')
      }
      console.error('  3. Confirm DB_USER and DB_PASSWORD in server/.env match hPanel → Databases')
      console.error('  4. Use the remote MySQL hostname from hPanel for DB_HOST (e.g. srv1946.hstgr.io)')
    }

    if (err.code === 'ER_BAD_DB_ERROR') {
      console.error('')
      console.error('Fix: Database name is wrong. Expected: u278432002_tool')
    }

    process.exit(1)
  }
}

main()

import { ensureGstRecoSchema } from '../db/init.js'
import { query, closePool } from '../db/connection.js'
import { loadEnv } from '../utils/loadEnv.js'

async function main() {
  const envStatus = loadEnv()
  if (!envStatus.ok) {
    console.error(
      'FAIL: Missing DB_USER, DB_PASSWORD, or DB_NAME. Create nodejs/.env on the server or sync it during deploy.',
    )
    process.exit(1)
  }

  if (envStatus.loadedFrom) {
    console.log(`Using database env from ${envStatus.loadedFrom}`)
  } else {
    console.log('Using database env from process environment')
  }

  console.log('Ensuring GST Reco database tables...')
  await ensureGstRecoSchema()

  const tables = ['gst_reco_records', 'gst_reco_input_tax_rows', 'gst_reco_history']
  for (const tableName of tables) {
    const rows = await query(`SELECT COUNT(*) AS total FROM ${tableName}`)
    console.log(`  ${tableName}: OK (${rows[0]?.total ?? 0} rows)`)
  }

  console.log('GST Reco schema is ready.')
  await closePool()
}

main().catch((err) => {
  console.error('FAIL:', err.message || err)
  process.exit(1)
})

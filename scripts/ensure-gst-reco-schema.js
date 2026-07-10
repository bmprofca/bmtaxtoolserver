import { ensureGstRecoSchema } from '../db/init.js'
import { query } from '../db/connection.js'

async function main() {
  console.log('Ensuring GST Reco database tables...')
  await ensureGstRecoSchema()

  const tables = ['gst_reco_records', 'gst_reco_input_tax_rows', 'gst_reco_history']
  for (const tableName of tables) {
    const rows = await query(`SELECT COUNT(*) AS total FROM ${tableName}`)
    console.log(`  ${tableName}: OK (${rows[0]?.total ?? 0} rows)`)
  }

  console.log('GST Reco schema is ready.')
}

main().catch((err) => {
  console.error('FAIL:', err.message || err)
  process.exit(1)
})

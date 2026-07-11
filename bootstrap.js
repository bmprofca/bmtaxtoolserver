import { initDatabase } from './db/init.js'
import { verifyConnection } from './db/connection.js'
import { loadClients } from './data/store.js'
import { loadFinancialYears } from './data/fySettingsStore.js'
import { loadCaSettings } from './data/caSettingsStore.js'
import { loadLedgers } from './data/ledgerStore.js'

let schemaInitialized = false

export async function bootstrapDataStores() {
  await verifyConnection()
  if (!schemaInitialized) {
    await initDatabase()
    schemaInitialized = true
  }
  await Promise.all([loadFinancialYears(), loadCaSettings(), loadLedgers(), loadClients()])
}

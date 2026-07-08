import { initDatabase } from './db/init.js'
import { verifyConnection } from './db/connection.js'
import { loadClients } from './data/store.js'
import { loadFinancialYears } from './data/fySettingsStore.js'
import { loadCaSettings } from './data/caSettingsStore.js'
import { loadLedgers } from './data/ledgerStore.js'

export async function bootstrapDataStores() {
  await verifyConnection()
  await initDatabase()
  await Promise.all([loadFinancialYears(), loadCaSettings(), loadLedgers(), loadClients()])
}

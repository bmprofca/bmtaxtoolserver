import { loadEnv } from '../utils/loadEnv.js'

loadEnv()

async function getPublicIps() {
  const ips = []
  try {
    const v4 = await fetch('https://api4.ipify.org?format=json', { signal: AbortSignal.timeout(5000) })
    const data = await v4.json()
    if (data.ip) ips.push({ version: 'IPv4', ip: data.ip })
  } catch {
    /* ignore */
  }
  try {
    const v6 = await fetch('https://api64.ipify.org?format=json', { signal: AbortSignal.timeout(5000) })
    const data = await v6.json()
    if (data.ip && data.ip.includes(':')) ips.push({ version: 'IPv6', ip: data.ip })
  } catch {
    /* ignore */
  }
  return ips
}

const host = process.env.DB_HOST || 'localhost'
const ips = await getPublicIps()

console.log('')
console.log('Hostinger Remote MySQL — add these in hPanel → Databases → Remote MySQL:')
console.log('')
for (const entry of ips) {
  console.log(`  ${entry.version}: ${entry.ip}`)
}
console.log('')
console.log('Or enable "Any Host" (%) while developing.')
console.log('')
console.log(`Use hostname DB_HOST=srv1946.hstgr.io (not a raw IP). Current: ${host}`)
console.log('')
console.log('Local alternative (no Hostinger needed):')
console.log('  cd server && npm run db:local')
console.log('  cd .. && npm run dev')
console.log('')

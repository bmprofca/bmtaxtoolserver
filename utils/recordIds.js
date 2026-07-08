import crypto from 'crypto'

export function generateId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`
}

export function ensureUniqueRecordIds(records, getId = (record) => record.id, assignId) {
  const seen = new Set()

  return records.map((record) => {
    let id = String(getId(record) || '').trim()
    if (!id || seen.has(id)) {
      id = generateId()
      return assignId ? assignId(record, id) : { ...record, id }
    }

    seen.add(id)
    return record
  })
}

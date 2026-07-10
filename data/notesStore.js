import { query } from '../db/connection.js'
import { parseJson } from '../db/init.js'
import { ensureUniqueRecordIds, generateId } from '../utils/recordIds.js'
import { NOTE_FIELD_KEYS, NOTE_LINE_KINDS, PL_APPROPRIATION_NOTE_KEY } from '../utils/noteFields.js'

function n(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

function emptyNote() {
  return { current: 0, previous: 0 }
}

function buildActor(user) {
  if (!user?.id) {
    return { userId: null, username: null, name: null }
  }

  return {
    userId: user.id,
    username: user.username || null,
    name: user.name || user.username || null,
  }
}

export function createEmptyNotes() {
  const notes = {}
  for (const key of NOTE_FIELD_KEYS) {
    notes[key] = emptyNote()
  }
  return notes
}

function createEmptyCashAdjustment() {
  return { current: 0, previous: 0 }
}

function normalizeLineKind(value) {
  const kind = String(value || '').trim()
  return NOTE_LINE_KINDS.has(kind) ? kind : 'manual_note'
}

function normalizeSign(value) {
  return String(value || '').trim() === 'less' ? 'less' : 'add'
}

function serializeSubAmountRow(row) {
  return {
    current: n(row.current_amount),
    previous: n(row.previous_amount),
  }
}

function serializeLineRow(row) {
  const base = {
    id: row.id,
  }

  switch (row.line_kind) {
    case 'admin_expense':
      return { ...base, categoryId: row.reference_id || 'others' }
    case 'short_term_borrowing':
      return { ...base, typeId: row.reference_id || 'cash-credit' }
    case 'manual_note':
      return { ...base, noteKey: row.note_key || '', typeId: row.reference_id || 'others' }
    case 'capital_account':
      return {
        ...base,
        sign: normalizeSign(row.line_sign),
        typeId: row.reference_id || 'capital-introduced',
      }
    case 'cogs_extra':
      return {
        ...base,
        sign: normalizeSign(row.line_sign),
        typeId: row.reference_id || 'direct-expenses',
      }
    case 'pl_appropriation':
      return { ...base, categoryId: row.reference_id || 'general-reserve' }
    default:
      return base
  }
}

async function getFyMeta(fyId) {
  const rows = await query(
    'SELECT label, start_year, end_year FROM financial_years WHERE id = ? LIMIT 1',
    [fyId],
  )

  if (!rows.length) {
    return { label: '', startYear: 0, endYear: 0 }
  }

  return {
    label: rows[0].label || '',
    startYear: Number(rows[0].start_year) || 0,
    endYear: Number(rows[0].end_year) || 0,
  }
}

async function fetchSubAmountRows(clientId, fyId, businessId) {
  return query(
    `SELECT id, note_key, sub_id, current_amount, previous_amount, sort_order
     FROM note_sub_amount_rows
     WHERE client_id = ? AND fy_id = ? AND business_id = ?
     ORDER BY note_key ASC, sort_order ASC, sub_id ASC`,
    [clientId, fyId, businessId],
  )
}

async function fetchLineRows(clientId, fyId, businessId) {
  return query(
    `SELECT id, line_kind, note_key, reference_id, line_sign, sort_order
     FROM note_line_rows
     WHERE client_id = ? AND fy_id = ? AND business_id = ?
     ORDER BY line_kind ASC, sort_order ASC, created_at ASC`,
    [clientId, fyId, businessId],
  )
}

async function fetchTotalRows(clientId, fyId, businessId) {
  return query(
    `SELECT note_key, current_amount, previous_amount
     FROM note_total_rows
     WHERE client_id = ? AND fy_id = ? AND business_id = ?`,
    [clientId, fyId, businessId],
  )
}

async function fetchCashAdjustment(clientId, fyId, businessId) {
  const rows = await query(
    `SELECT current_amount, previous_amount
     FROM note_cash_adjustment
     WHERE client_id = ? AND fy_id = ? AND business_id = ?
     LIMIT 1`,
    [clientId, fyId, businessId],
  )

  if (!rows.length) {
    return createEmptyCashAdjustment()
  }

  return {
    current: n(rows[0].current_amount),
    previous: n(rows[0].previous_amount),
  }
}

function buildNoteSubAmounts(subRows) {
  const result = {}

  for (const row of subRows) {
    if (row.note_key === PL_APPROPRIATION_NOTE_KEY) {
      continue
    }

    if (!result[row.note_key]) {
      result[row.note_key] = {}
    }

    result[row.note_key][row.sub_id] = serializeSubAmountRow(row)
  }

  return result
}

function buildPlAppropriationAmounts(subRows) {
  const result = {}

  for (const row of subRows) {
    if (row.note_key !== PL_APPROPRIATION_NOTE_KEY) {
      continue
    }

    result[row.sub_id] = serializeSubAmountRow(row)
  }

  return result
}

function buildLineCollections(lineRows) {
  const administrativeExpenseLines = []
  const otherShortTermBorrowingLines = []
  const manualNoteLines = []
  const capitalAccountLines = []
  const cogsExtraLines = []
  const plAppropriationLines = []

  for (const row of lineRows) {
    const line = serializeLineRow(row)

    switch (row.line_kind) {
      case 'admin_expense':
        administrativeExpenseLines.push(line)
        break
      case 'short_term_borrowing':
        otherShortTermBorrowingLines.push(line)
        break
      case 'manual_note':
        manualNoteLines.push(line)
        break
      case 'capital_account':
        capitalAccountLines.push(line)
        break
      case 'cogs_extra':
        cogsExtraLines.push(line)
        break
      case 'pl_appropriation':
        plAppropriationLines.push(line)
        break
      default:
        break
    }
  }

  return {
    administrativeExpenseLines,
    otherShortTermBorrowingLines,
    manualNoteLines,
    capitalAccountLines,
    cogsExtraLines,
    plAppropriationLines,
  }
}

function buildNotes(totalRows) {
  const notes = createEmptyNotes()

  for (const row of totalRows) {
    if (!NOTE_FIELD_KEYS.includes(row.note_key)) {
      continue
    }

    notes[row.note_key] = {
      current: n(row.current_amount),
      previous: n(row.previous_amount),
    }
  }

  return notes
}

export async function getNotesForFs(clientId, fyId, businessId) {
  const [subRows, lineRows, totalRows, cashAdjustment] = await Promise.all([
    fetchSubAmountRows(clientId, fyId, businessId),
    fetchLineRows(clientId, fyId, businessId),
    fetchTotalRows(clientId, fyId, businessId),
    fetchCashAdjustment(clientId, fyId, businessId),
  ])

  const lines = buildLineCollections(lineRows)

  return {
    notes: buildNotes(totalRows),
    noteSubAmounts: buildNoteSubAmounts(subRows),
    noteBreakdowns: {},
    ...lines,
    plAppropriationAmounts: buildPlAppropriationAmounts(subRows),
    cashAdjustment,
  }
}

async function upsertSubAmountRow(
  clientId,
  fyId,
  businessId,
  noteKey,
  subId,
  amount,
  sortOrder,
  actor,
) {
  const existing = await query(
    `SELECT id FROM note_sub_amount_rows
     WHERE client_id = ? AND fy_id = ? AND business_id = ? AND note_key = ? AND sub_id = ?
     LIMIT 1`,
    [clientId, fyId, businessId, noteKey, subId],
  )
  const rowId = existing[0]?.id || generateId()
  const { userId, username, name } = buildActor(actor)

  await query(
    `INSERT INTO note_sub_amount_rows (
       id, client_id, fy_id, business_id, note_key, sub_id,
       current_amount, previous_amount, sort_order,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       current_amount = VALUES(current_amount),
       previous_amount = VALUES(previous_amount),
       sort_order = VALUES(sort_order),
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_by_username = VALUES(updated_by_username),
       updated_by_name = VALUES(updated_by_name),
       updated_at = CURRENT_TIMESTAMP`,
    [
      rowId,
      clientId,
      fyId,
      businessId,
      noteKey,
      subId,
      n(amount?.current),
      n(amount?.previous),
      sortOrder,
      userId,
      username,
      name,
    ],
  )
}

async function upsertLineRow(clientId, fyId, businessId, line, kind, sortOrder, actor) {
  const { userId, username, name } = buildActor(actor)
  let noteKey = null
  let referenceId = ''
  let lineSign = null

  switch (kind) {
    case 'admin_expense':
      referenceId = String(line.categoryId || 'others')
      break
    case 'short_term_borrowing':
      referenceId = String(line.typeId || 'cash-credit')
      break
    case 'manual_note':
      noteKey = String(line.noteKey || '')
      referenceId = String(line.typeId || 'others')
      break
    case 'capital_account':
      referenceId = String(line.typeId || 'capital-introduced')
      lineSign = normalizeSign(line.sign)
      break
    case 'cogs_extra':
      referenceId = String(line.typeId || 'direct-expenses')
      lineSign = normalizeSign(line.sign)
      break
    case 'pl_appropriation':
      referenceId = String(line.categoryId || 'general-reserve')
      break
    default:
      break
  }

  await query(
    `INSERT INTO note_line_rows (
       id, client_id, fy_id, business_id, line_kind, note_key, reference_id, line_sign, sort_order,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       line_kind = VALUES(line_kind),
       note_key = VALUES(note_key),
       reference_id = VALUES(reference_id),
       line_sign = VALUES(line_sign),
       sort_order = VALUES(sort_order),
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_by_username = VALUES(updated_by_username),
       updated_by_name = VALUES(updated_by_name),
       updated_at = CURRENT_TIMESTAMP`,
    [
      String(line.id || generateId()),
      clientId,
      fyId,
      businessId,
      kind,
      noteKey,
      referenceId,
      lineSign,
      sortOrder,
      userId,
      username,
      name,
    ],
  )
}

async function upsertNoteTotal(clientId, fyId, businessId, noteKey, amount, actor) {
  const rowId = `notetotal_${noteKey}_${fyId}`.slice(0, 50)
  const { userId, username, name } = buildActor(actor)

  await query(
    `INSERT INTO note_total_rows (
       id, client_id, fy_id, business_id, note_key, current_amount, previous_amount,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       current_amount = VALUES(current_amount),
       previous_amount = VALUES(previous_amount),
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_by_username = VALUES(updated_by_username),
       updated_by_name = VALUES(updated_by_name),
       updated_at = CURRENT_TIMESTAMP`,
    [
      rowId,
      clientId,
      fyId,
      businessId,
      noteKey,
      n(amount?.current),
      n(amount?.previous),
      userId,
      username,
      name,
    ],
  )
}

async function upsertCashAdjustment(clientId, fyId, businessId, cashAdjustment, actor) {
  const rowId = `notecash_${clientId}_${businessId}_${fyId}`.slice(0, 50)
  const { userId, username, name } = buildActor(actor)

  await query(
    `INSERT INTO note_cash_adjustment (
       id, client_id, fy_id, business_id, current_amount, previous_amount,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       current_amount = VALUES(current_amount),
       previous_amount = VALUES(previous_amount),
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_by_username = VALUES(updated_by_username),
       updated_by_name = VALUES(updated_by_name),
       updated_at = CURRENT_TIMESTAMP`,
    [
      rowId,
      clientId,
      fyId,
      businessId,
      n(cashAdjustment?.current),
      n(cashAdjustment?.previous),
      userId,
      username,
      name,
    ],
  )
}

async function syncNoteHistory(clientId, businessId, fyId, fyMeta, snapshot, actor) {
  const historyId = `notehist_${clientId}_${businessId}_${fyId}`.slice(0, 50)
  const { userId, username, name } = buildActor(actor)

  await query(
    `INSERT INTO note_history (
       id, client_id, business_id, fy_id, fy_label, fy_start_year, payload,
       created_by_user_id, created_by_username, created_by_name
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       fy_label = VALUES(fy_label),
       fy_start_year = VALUES(fy_start_year),
       payload = VALUES(payload),
       updated_by_user_id = VALUES(updated_by_user_id),
       updated_by_username = VALUES(updated_by_username),
       updated_by_name = VALUES(updated_by_name),
       updated_at = CURRENT_TIMESTAMP`,
    [
      historyId,
      clientId,
      businessId,
      fyId,
      fyMeta.label,
      fyMeta.startYear,
      JSON.stringify(snapshot),
      userId,
      username,
      name,
    ],
  )
}

function collectIncomingSubRows(noteSubAmounts = {}, plAppropriationAmounts = {}) {
  const rows = []

  for (const [noteKey, subs] of Object.entries(noteSubAmounts || {})) {
    if (!subs || typeof subs !== 'object') {
      continue
    }

    let sortOrder = 0
    for (const [subId, amount] of Object.entries(subs)) {
      rows.push({ noteKey, subId, amount, sortOrder })
      sortOrder += 1
    }
  }

  let plSort = 0
  for (const [subId, amount] of Object.entries(plAppropriationAmounts || {})) {
    rows.push({
      noteKey: PL_APPROPRIATION_NOTE_KEY,
      subId,
      amount,
      sortOrder: plSort,
    })
    plSort += 1
  }

  return rows
}

export async function saveNotesForFs(clientId, fyId, businessId, data, actor) {
  const incomingSubRows = collectIncomingSubRows(data.noteSubAmounts, data.plAppropriationAmounts)
  const incomingSubKeys = new Set(incomingSubRows.map((row) => `${row.noteKey}::${row.subId}`))

  const existingSubRows = await fetchSubAmountRows(clientId, fyId, businessId)
  for (const row of existingSubRows) {
    const key = `${row.note_key}::${row.sub_id}`
    if (!incomingSubKeys.has(key)) {
      await query(
        'DELETE FROM note_sub_amount_rows WHERE id = ? AND client_id = ? AND fy_id = ? AND business_id = ?',
        [row.id, clientId, fyId, businessId],
      )
    }
  }

  for (const row of incomingSubRows) {
    await upsertSubAmountRow(
      clientId,
      fyId,
      businessId,
      row.noteKey,
      row.subId,
      row.amount,
      row.sortOrder,
      actor,
    )
  }

  const lineGroups = [
    ['admin_expense', data.administrativeExpenseLines || []],
    ['short_term_borrowing', data.otherShortTermBorrowingLines || []],
    ['manual_note', data.manualNoteLines || []],
    ['capital_account', data.capitalAccountLines || []],
    ['cogs_extra', data.cogsExtraLines || []],
    ['pl_appropriation', data.plAppropriationLines || []],
  ]

  const incomingLineIds = new Set(
    lineGroups.flatMap(([, lines]) => (lines || []).map((line) => String(line.id))),
  )

  const existingLineRows = await fetchLineRows(clientId, fyId, businessId)
  for (const row of existingLineRows) {
    if (!incomingLineIds.has(row.id)) {
      await query(
        'DELETE FROM note_line_rows WHERE id = ? AND client_id = ? AND fy_id = ? AND business_id = ?',
        [row.id, clientId, fyId, businessId],
      )
    }
  }

  for (const [kind, lines] of lineGroups) {
    const uniqueLines = ensureUniqueRecordIds(
      lines || [],
      (line) => line.id,
      (line, id) => ({ ...line, id }),
    )
    for (let index = 0; index < uniqueLines.length; index += 1) {
      await upsertLineRow(clientId, fyId, businessId, uniqueLines[index], kind, index, actor)
    }
  }

  const notes = data.notes || createEmptyNotes()
  for (const noteKey of NOTE_FIELD_KEYS) {
    await upsertNoteTotal(clientId, fyId, businessId, noteKey, notes[noteKey] || emptyNote(), actor)
  }

  await upsertCashAdjustment(clientId, fyId, businessId, data.cashAdjustment, actor)

  const saved = await getNotesForFs(clientId, fyId, businessId)
  const fyMeta = await getFyMeta(fyId)

  if (fyMeta.startYear) {
    await syncNoteHistory(clientId, businessId, fyId, fyMeta, saved, actor)
  }

  return saved
}

function serializeHistoryRow(row) {
  return {
    id: row.id,
    fyId: row.fy_id,
    fyLabel: row.fy_label || '',
    fyStartYear: Number(row.fy_start_year) || 0,
    snapshot: parseJson(row.payload) || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function getNoteHistory(clientId, businessId, fyId = null) {
  const params = [clientId, businessId]
  let sql = `SELECT id, client_id, business_id, fy_id, fy_label, fy_start_year, payload, created_at, updated_at
             FROM note_history
             WHERE client_id = ? AND business_id = ?`

  if (fyId) {
    sql += ' AND fy_id = ?'
    params.push(fyId)
  }

  sql += ' ORDER BY fy_start_year DESC'

  const rows = await query(sql, params)
  return rows.map(serializeHistoryRow)
}

export async function deleteNotesForFs(clientId, fyId, businessId) {
  await Promise.all([
    query('DELETE FROM note_sub_amount_rows WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
      clientId,
      fyId,
      businessId,
    ]),
    query('DELETE FROM note_line_rows WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
      clientId,
      fyId,
      businessId,
    ]),
    query('DELETE FROM note_total_rows WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
      clientId,
      fyId,
      businessId,
    ]),
    query('DELETE FROM note_cash_adjustment WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
      clientId,
      fyId,
      businessId,
    ]),
    query('DELETE FROM note_history WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
      clientId,
      fyId,
      businessId,
    ]),
  ])
}

export async function deleteNotesForBusiness(clientId, businessId) {
  await Promise.all([
    query('DELETE FROM note_sub_amount_rows WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
    query('DELETE FROM note_line_rows WHERE client_id = ? AND business_id = ?', [clientId, businessId]),
    query('DELETE FROM note_total_rows WHERE client_id = ? AND business_id = ?', [clientId, businessId]),
    query('DELETE FROM note_cash_adjustment WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
    query('DELETE FROM note_history WHERE client_id = ? AND business_id = ?', [clientId, businessId]),
  ])
}

export async function deleteNotesForFy(clientId, fyId) {
  await Promise.all([
    query('DELETE FROM note_sub_amount_rows WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
    query('DELETE FROM note_line_rows WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
    query('DELETE FROM note_total_rows WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
    query('DELETE FROM note_cash_adjustment WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
    query('DELETE FROM note_history WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
  ])
}

export async function deleteNotesForFyAllClients(fyId) {
  await Promise.all([
    query('DELETE FROM note_sub_amount_rows WHERE fy_id = ?', [fyId]),
    query('DELETE FROM note_line_rows WHERE fy_id = ?', [fyId]),
    query('DELETE FROM note_total_rows WHERE fy_id = ?', [fyId]),
    query('DELETE FROM note_cash_adjustment WHERE fy_id = ?', [fyId]),
    query('DELETE FROM note_history WHERE fy_id = ?', [fyId]),
  ])
}

export async function migrateNotesFromFsData() {
  const existing = await query('SELECT id FROM note_total_rows LIMIT 1')
  if (existing.length) {
    return
  }

  const rows = await query('SELECT client_id, fy_id, business_id, payload FROM fs_data')
  for (const row of rows) {
    const payload = parseJson(row.payload)
    if (!payload) {
      continue
    }

    const hasNotesData =
      payload.notes ||
      payload.noteSubAmounts ||
      payload.administrativeExpenseLines?.length ||
      payload.otherShortTermBorrowingLines?.length ||
      payload.manualNoteLines?.length ||
      payload.capitalAccountLines?.length ||
      payload.cogsExtraLines?.length ||
      payload.plAppropriationLines?.length ||
      payload.cashAdjustment

    if (!hasNotesData) {
      continue
    }

    await saveNotesForFs(
      row.client_id,
      row.fy_id,
      row.business_id,
      {
        notes: payload.notes || createEmptyNotes(),
        noteSubAmounts: payload.noteSubAmounts || {},
        administrativeExpenseLines: payload.administrativeExpenseLines || [],
        otherShortTermBorrowingLines: payload.otherShortTermBorrowingLines || [],
        manualNoteLines: payload.manualNoteLines || [],
        capitalAccountLines: payload.capitalAccountLines || [],
        cogsExtraLines: payload.cogsExtraLines || [],
        plAppropriationLines: payload.plAppropriationLines || [],
        plAppropriationAmounts: payload.plAppropriationAmounts || {},
        cashAdjustment: payload.cashAdjustment || createEmptyCashAdjustment(),
      },
      null,
    )
  }
}

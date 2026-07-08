import { query } from '../db/connection.js'
import { parseJson } from '../db/init.js'

const INPUT_TAX_ROW_TEMPLATES = [
  { type: 'opening', particular: 'Opening ITC', sortOrder: 0 },
  { type: 'purchases', particular: 'ITC from purchases during the year', sortOrder: 1 },
  { type: 'expenses', particular: 'ITC from expenses during the year', sortOrder: 2 },
  { type: 'rcm', particular: 'ITC from RCM', sortOrder: 3 },
  { type: 'capital-goods', particular: 'ITC from capital goods', sortOrder: 4 },
  {
    type: 'reversed-fixed-assets',
    particular: 'Less: ITC reversed (fixed assets)',
    sortOrder: 5,
  },
  {
    type: 'itc-year-sl1-to-6',
    particular: 'ITC of this year (consider adjustments for S.No 1 to 6)',
    sortOrder: 6,
  },
  {
    type: 'used-for-liability',
    particular: 'Less: ITC used for paying tax liability (linked from Sec. 2)',
    sortOrder: 7,
  },
  { type: 'manual-adjustment', particular: 'Manual adjustment (optional)', sortOrder: 8 },
  { type: 'closing', particular: 'Closing ITC', sortOrder: 9 },
]

const INPUT_TAX_ROW_TYPES = new Set(INPUT_TAX_ROW_TEMPLATES.map((row) => row.type))

function generateId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

function n(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
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

function emptyTaxTriple() {
  return { igst: 0, cgst: 0, sgst: 0 }
}

function normalizeTaxTriple(raw = {}) {
  return {
    igst: n(raw.igst),
    cgst: n(raw.cgst),
    sgst: n(raw.sgst),
  }
}

function createEmptyOutwardTaxPaid() {
  return {
    igstCreditToIgst: 0,
    igstCreditToCgst: 0,
    igstCreditToSgst: 0,
    cgstCreditToIgst: 0,
    cgstCreditToCgst: 0,
    sgstCreditToIgst: 0,
    sgstCreditToSgst: 0,
    cashIgst: 0,
    cashCgst: 0,
    cashSgst: 0,
  }
}

function migrateOutwardTaxPaid(value) {
  const empty = createEmptyOutwardTaxPaid()
  if (!value) {
    return empty
  }

  if ('igstCreditToIgst' in value) {
    return { ...empty, ...value }
  }

  return {
    ...empty,
    igstCreditToIgst: n(value.paidUsingIgst),
    cgstCreditToCgst: n(value.paidUsingCgst),
    sgstCreditToSgst: n(value.paidUsingSgst),
    cashIgst: n(value.cashIgst),
    cashCgst: n(value.cashCgst),
    cashSgst: n(value.cashSgst),
  }
}

function migrateSimpleReco(value) {
  const empty = {
    itcClaimedIn3bThisFy: emptyTaxTriple(),
    itcPrevYearClaimedThisYear: emptyTaxTriple(),
    itcAsPer2b: emptyTaxTriple(),
  }

  if (!value || typeof value !== 'object') {
    return empty
  }

  if ('itcClaimedIn3bThisFy' in value) {
    return {
      itcClaimedIn3bThisFy: normalizeTaxTriple(value.itcClaimedIn3bThisFy),
      itcPrevYearClaimedThisYear: normalizeTaxTriple(value.itcPrevYearClaimedThisYear),
      itcAsPer2b: normalizeTaxTriple(value.itcAsPer2b),
    }
  }

  return {
    itcClaimedIn3bThisFy: normalizeTaxTriple(value.itcClaimedAsPer3b),
    itcPrevYearClaimedThisYear: normalizeTaxTriple(
      value.itcClaimedFromPrevYears || value.prevYearItcClaimedThisYear,
    ),
    itcAsPer2b: normalizeTaxTriple(value.itcAsPer2b),
  }
}

function createInputTaxRows() {
  return INPUT_TAX_ROW_TEMPLATES.map((template) => ({
    id: generateId('gstrow_'),
    type: template.type,
    particular: template.particular,
    igst: 0,
    cgst: 0,
    sgst: 0,
  }))
}

function normalizeInputTaxRow(raw = {}, template) {
  const type = INPUT_TAX_ROW_TYPES.has(raw.type) ? raw.type : template?.type
  return {
    id: String(raw.id || generateId('gstrow_')).trim(),
    type,
    particular: String(raw.particular || template?.particular || '').trim(),
    igst: n(raw.igst),
    cgst: n(raw.cgst),
    sgst: n(raw.sgst),
  }
}

export function createEmptyGstReco() {
  return {
    sales: {
      sales: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      amendedSales: 0,
      amendedIgst: 0,
      amendedCgst: 0,
      amendedSgst: 0,
    },
    outwardTaxPaid: createEmptyOutwardTaxPaid(),
    inputTax: {
      rows: createInputTaxRows(),
      linkClosingToNotes: false,
      closingFromNotes: emptyTaxTriple(),
    },
    simpleReco: {
      itcClaimedIn3bThisFy: emptyTaxTriple(),
      itcPrevYearClaimedThisYear: emptyTaxTriple(),
      itcAsPer2b: emptyTaxTriple(),
    },
    linkSalesToRevenueNote: false,
  }
}

function isLegacyGstReco(value) {
  return Boolean(value && typeof value === 'object' && 'sections' in value && !('sales' in value))
}

export function normalizeGstReco(value) {
  const empty = createEmptyGstReco()

  if (!value || isLegacyGstReco(value)) {
    return empty
  }

  const templateRows = createInputTaxRows()

  return {
    sales: { ...empty.sales, ...(value.sales || {}) },
    outwardTaxPaid: migrateOutwardTaxPaid(value.outwardTaxPaid),
    inputTax: {
      linkClosingToNotes: Boolean(value.inputTax?.linkClosingToNotes),
      closingFromNotes: normalizeTaxTriple(value.inputTax?.closingFromNotes),
      rows: templateRows.map((template) => {
        const existing = (value.inputTax?.rows || []).find((row) => row.type === template.type)
        return existing ? normalizeInputTaxRow(existing, template) : template
      }),
    },
    simpleReco: migrateSimpleReco(value.simpleReco),
    linkSalesToRevenueNote: Boolean(value.linkSalesToRevenueNote),
  }
}

function isMeaningfulGstReco(gstReco) {
  const normalized = normalizeGstReco(gstReco)

  if (normalized.linkSalesToRevenueNote || normalized.inputTax.linkClosingToNotes) {
    return true
  }

  const salesValues = Object.values(normalized.sales)
  if (salesValues.some((value) => n(value) !== 0)) {
    return true
  }

  const outwardValues = Object.values(normalized.outwardTaxPaid)
  if (outwardValues.some((value) => n(value) !== 0)) {
    return true
  }

  const closingNotes = Object.values(normalized.inputTax.closingFromNotes)
  if (closingNotes.some((value) => n(value) !== 0)) {
    return true
  }

  for (const row of normalized.inputTax.rows) {
    if (n(row.igst) || n(row.cgst) || n(row.sgst)) {
      return true
    }
  }

  for (const triple of Object.values(normalized.simpleReco)) {
    if (n(triple.igst) || n(triple.cgst) || n(triple.sgst)) {
      return true
    }
  }

  return false
}

function serializeInputTaxRow(row) {
  return normalizeInputTaxRow(row)
}

function serializeGstReco(recordRow, inputRows) {
  return normalizeGstReco({
    sales: {
      sales: recordRow.sales_amount,
      igst: recordRow.sales_igst,
      cgst: recordRow.sales_cgst,
      sgst: recordRow.sales_sgst,
      amendedSales: recordRow.amended_sales,
      amendedIgst: recordRow.amended_igst,
      amendedCgst: recordRow.amended_cgst,
      amendedSgst: recordRow.amended_sgst,
    },
    outwardTaxPaid: {
      igstCreditToIgst: recordRow.ot_igst_to_igst,
      igstCreditToCgst: recordRow.ot_igst_to_cgst,
      igstCreditToSgst: recordRow.ot_igst_to_sgst,
      cgstCreditToIgst: recordRow.ot_cgst_to_igst,
      cgstCreditToCgst: recordRow.ot_cgst_to_cgst,
      sgstCreditToIgst: recordRow.ot_sgst_to_igst,
      sgstCreditToSgst: recordRow.ot_sgst_to_sgst,
      cashIgst: recordRow.ot_cash_igst,
      cashCgst: recordRow.ot_cash_cgst,
      cashSgst: recordRow.ot_cash_sgst,
    },
    inputTax: {
      linkClosingToNotes: recordRow.link_closing_to_notes === 1,
      closingFromNotes: {
        igst: recordRow.closing_from_notes_igst,
        cgst: recordRow.closing_from_notes_cgst,
        sgst: recordRow.closing_from_notes_sgst,
      },
      rows:
        inputRows.length > 0
          ? inputRows.map((row) =>
              serializeInputTaxRow({
                id: row.id,
                type: row.row_type,
                particular: row.particular,
                igst: row.igst,
                cgst: row.cgst,
                sgst: row.sgst,
              }),
            )
          : createInputTaxRows(),
    },
    simpleReco: {
      itcClaimedIn3bThisFy: {
        igst: recordRow.sr_3b_igst,
        cgst: recordRow.sr_3b_cgst,
        sgst: recordRow.sr_3b_sgst,
      },
      itcPrevYearClaimedThisYear: {
        igst: recordRow.sr_prev_igst,
        cgst: recordRow.sr_prev_cgst,
        sgst: recordRow.sr_prev_sgst,
      },
      itcAsPer2b: {
        igst: recordRow.sr_2b_igst,
        cgst: recordRow.sr_2b_cgst,
        sgst: recordRow.sr_2b_sgst,
      },
    },
    linkSalesToRevenueNote: recordRow.link_sales_to_revenue_note === 1,
  })
}

async function fetchGstRecoRecord(clientId, fyId, businessId) {
  const rows = await query(
    `SELECT *
     FROM gst_reco_records
     WHERE client_id = ? AND fy_id = ? AND business_id = ?
     LIMIT 1`,
    [clientId, fyId, businessId],
  )

  return rows[0] || null
}

async function fetchInputTaxRows(clientId, fyId, businessId) {
  return query(
    `SELECT id, client_id, fy_id, business_id, row_type, particular, igst, cgst, sgst, sort_order
     FROM gst_reco_input_tax_rows
     WHERE client_id = ? AND fy_id = ? AND business_id = ?
     ORDER BY sort_order ASC, created_at ASC`,
    [clientId, fyId, businessId],
  )
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

async function upsertGstRecoRecord(clientId, fyId, businessId, gstReco, actor) {
  const normalized = normalizeGstReco(gstReco)
  const existing = await fetchGstRecoRecord(clientId, fyId, businessId)
  const { userId, username, name } = buildActor(actor)

  const values = [
    normalized.linkSalesToRevenueNote ? 1 : 0,
    normalized.inputTax.linkClosingToNotes ? 1 : 0,
    normalized.inputTax.closingFromNotes.igst,
    normalized.inputTax.closingFromNotes.cgst,
    normalized.inputTax.closingFromNotes.sgst,
    normalized.sales.sales,
    normalized.sales.igst,
    normalized.sales.cgst,
    normalized.sales.sgst,
    normalized.sales.amendedSales,
    normalized.sales.amendedIgst,
    normalized.sales.amendedCgst,
    normalized.sales.amendedSgst,
    normalized.outwardTaxPaid.igstCreditToIgst,
    normalized.outwardTaxPaid.igstCreditToCgst,
    normalized.outwardTaxPaid.igstCreditToSgst,
    normalized.outwardTaxPaid.cgstCreditToIgst,
    normalized.outwardTaxPaid.cgstCreditToCgst,
    normalized.outwardTaxPaid.sgstCreditToIgst,
    normalized.outwardTaxPaid.sgstCreditToSgst,
    normalized.outwardTaxPaid.cashIgst,
    normalized.outwardTaxPaid.cashCgst,
    normalized.outwardTaxPaid.cashSgst,
    normalized.simpleReco.itcClaimedIn3bThisFy.igst,
    normalized.simpleReco.itcClaimedIn3bThisFy.cgst,
    normalized.simpleReco.itcClaimedIn3bThisFy.sgst,
    normalized.simpleReco.itcPrevYearClaimedThisYear.igst,
    normalized.simpleReco.itcPrevYearClaimedThisYear.cgst,
    normalized.simpleReco.itcPrevYearClaimedThisYear.sgst,
    normalized.simpleReco.itcAsPer2b.igst,
    normalized.simpleReco.itcAsPer2b.cgst,
    normalized.simpleReco.itcAsPer2b.sgst,
    userId,
    username,
    name,
  ]

  if (!existing) {
    await query(
      `INSERT INTO gst_reco_records (
         id, client_id, fy_id, business_id,
         link_sales_to_revenue_note, link_closing_to_notes,
         closing_from_notes_igst, closing_from_notes_cgst, closing_from_notes_sgst,
         sales_amount, sales_igst, sales_cgst, sales_sgst,
         amended_sales, amended_igst, amended_cgst, amended_sgst,
         ot_igst_to_igst, ot_igst_to_cgst, ot_igst_to_sgst,
         ot_cgst_to_igst, ot_cgst_to_cgst, ot_sgst_to_igst, ot_sgst_to_sgst,
         ot_cash_igst, ot_cash_cgst, ot_cash_sgst,
         sr_3b_igst, sr_3b_cgst, sr_3b_sgst,
         sr_prev_igst, sr_prev_cgst, sr_prev_sgst,
         sr_2b_igst, sr_2b_cgst, sr_2b_sgst,
         created_by_user_id, created_by_username, created_by_name
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`gstreco_${generateId()}`, clientId, fyId, businessId, ...values],
    )
    return
  }

  await query(
    `UPDATE gst_reco_records
     SET link_sales_to_revenue_note = ?,
         link_closing_to_notes = ?,
         closing_from_notes_igst = ?,
         closing_from_notes_cgst = ?,
         closing_from_notes_sgst = ?,
         sales_amount = ?,
         sales_igst = ?,
         sales_cgst = ?,
         sales_sgst = ?,
         amended_sales = ?,
         amended_igst = ?,
         amended_cgst = ?,
         amended_sgst = ?,
         ot_igst_to_igst = ?,
         ot_igst_to_cgst = ?,
         ot_igst_to_sgst = ?,
         ot_cgst_to_igst = ?,
         ot_cgst_to_cgst = ?,
         ot_sgst_to_igst = ?,
         ot_sgst_to_sgst = ?,
         ot_cash_igst = ?,
         ot_cash_cgst = ?,
         ot_cash_sgst = ?,
         sr_3b_igst = ?,
         sr_3b_cgst = ?,
         sr_3b_sgst = ?,
         sr_prev_igst = ?,
         sr_prev_cgst = ?,
         sr_prev_sgst = ?,
         sr_2b_igst = ?,
         sr_2b_cgst = ?,
         sr_2b_sgst = ?,
         updated_by_user_id = ?,
         updated_by_username = ?,
         updated_by_name = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE client_id = ? AND fy_id = ? AND business_id = ?`,
    [...values, clientId, fyId, businessId],
  )
}

async function saveInputTaxRows(clientId, fyId, businessId, rows, actor) {
  const normalizedRows = normalizeGstReco({ inputTax: { rows } }).inputTax.rows
  const incomingTypes = new Set(normalizedRows.map((row) => row.type))
  const existingRows = await fetchInputTaxRows(clientId, fyId, businessId)
  const { userId, username, name } = buildActor(actor)

  for (const row of existingRows) {
    if (!incomingTypes.has(row.row_type)) {
      await query(
        'DELETE FROM gst_reco_input_tax_rows WHERE id = ? AND client_id = ? AND fy_id = ? AND business_id = ?',
        [row.id, clientId, fyId, businessId],
      )
    }
  }

  const existingByType = new Map(existingRows.map((row) => [row.row_type, row]))

  for (const template of INPUT_TAX_ROW_TEMPLATES) {
    const row = normalizedRows.find((item) => item.type === template.type)
    if (!row) {
      continue
    }

    const existing = existingByType.get(template.type)
    if (existing) {
      await query(
        `UPDATE gst_reco_input_tax_rows
         SET particular = ?,
             igst = ?,
             cgst = ?,
             sgst = ?,
             sort_order = ?,
             updated_by_user_id = ?,
             updated_by_username = ?,
             updated_by_name = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND client_id = ? AND fy_id = ? AND business_id = ?`,
        [
          row.particular || template.particular,
          row.igst,
          row.cgst,
          row.sgst,
          template.sortOrder,
          userId,
          username,
          name,
          existing.id,
          clientId,
          fyId,
          businessId,
        ],
      )
      continue
    }

    await query(
      `INSERT INTO gst_reco_input_tax_rows (
         id, client_id, fy_id, business_id, row_type, particular, igst, cgst, sgst, sort_order,
         created_by_user_id, created_by_username, created_by_name
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id || generateId('gstrow_'),
        clientId,
        fyId,
        businessId,
        template.type,
        row.particular || template.particular,
        row.igst,
        row.cgst,
        row.sgst,
        template.sortOrder,
        userId,
        username,
        name,
      ],
    )
  }
}

async function syncGstRecoHistory(clientId, businessId, fyId, fyMeta, gstReco, actor) {
  const normalized = normalizeGstReco(gstReco)
  const { userId, username, name } = buildActor(actor)
  const historyId = `gsthist_${clientId}_${businessId}_${fyId}`

  await query(
    `INSERT INTO gst_reco_history (
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
      JSON.stringify(normalized),
      userId,
      username,
      name,
    ],
  )
}

export async function getGstRecoForFs(clientId, fyId, businessId) {
  const [recordRow, inputRows] = await Promise.all([
    fetchGstRecoRecord(clientId, fyId, businessId),
    fetchInputTaxRows(clientId, fyId, businessId),
  ])

  if (!recordRow && inputRows.length === 0) {
    return createEmptyGstReco()
  }

  if (!recordRow) {
    return createEmptyGstReco()
  }

  return serializeGstReco(recordRow, inputRows)
}

export async function saveGstRecoForFs(clientId, fyId, businessId, gstReco, actor) {
  const normalized = normalizeGstReco(gstReco)

  if (!isMeaningfulGstReco(normalized)) {
    await deleteGstRecoForFs(clientId, fyId, businessId)
    return createEmptyGstReco()
  }

  await upsertGstRecoRecord(clientId, fyId, businessId, normalized, actor)
  await saveInputTaxRows(clientId, fyId, businessId, normalized.inputTax.rows, actor)

  const fyMeta = await getFyMeta(fyId)
  await syncGstRecoHistory(clientId, businessId, fyId, fyMeta, normalized, actor)

  return getGstRecoForFs(clientId, fyId, businessId)
}

export async function getGstRecoHistory(clientId, businessId, fyId = null) {
  const params = [clientId, businessId]
  let sql = `SELECT id, client_id, business_id, fy_id, fy_label, fy_start_year, payload, created_at, updated_at
             FROM gst_reco_history
             WHERE client_id = ? AND business_id = ?`

  if (fyId) {
    sql += ' AND fy_id = ?'
    params.push(fyId)
  }

  sql += ' ORDER BY fy_start_year DESC'

  const rows = await query(sql, params)
  return rows.map((row) => ({
    id: row.id,
    fyId: row.fy_id,
    fyLabel: row.fy_label || '',
    fyStartYear: Number(row.fy_start_year) || 0,
    gstReco: normalizeGstReco(parseJson(row.payload)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export async function deleteGstRecoForFs(clientId, fyId, businessId) {
  await Promise.all([
    query('DELETE FROM gst_reco_records WHERE client_id = ? AND fy_id = ? AND business_id = ?', [
      clientId,
      fyId,
      businessId,
    ]),
    query(
      'DELETE FROM gst_reco_input_tax_rows WHERE client_id = ? AND fy_id = ? AND business_id = ?',
      [clientId, fyId, businessId],
    ),
    query(
      'DELETE FROM gst_reco_history WHERE client_id = ? AND fy_id = ? AND business_id = ?',
      [clientId, fyId, businessId],
    ),
  ])
}

export async function deleteGstRecoForBusiness(clientId, businessId) {
  await Promise.all([
    query('DELETE FROM gst_reco_records WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
    query('DELETE FROM gst_reco_input_tax_rows WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
    query('DELETE FROM gst_reco_history WHERE client_id = ? AND business_id = ?', [
      clientId,
      businessId,
    ]),
  ])
}

export async function deleteGstRecoForFy(clientId, fyId) {
  await Promise.all([
    query('DELETE FROM gst_reco_records WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
    query('DELETE FROM gst_reco_input_tax_rows WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
    query('DELETE FROM gst_reco_history WHERE client_id = ? AND fy_id = ?', [clientId, fyId]),
  ])
}

export async function deleteGstRecoForFyAllClients(fyId) {
  await Promise.all([
    query('DELETE FROM gst_reco_records WHERE fy_id = ?', [fyId]),
    query('DELETE FROM gst_reco_input_tax_rows WHERE fy_id = ?', [fyId]),
    query('DELETE FROM gst_reco_history WHERE fy_id = ?', [fyId]),
  ])
}

export async function migrateGstRecoFromFsData() {
  const existing = await query('SELECT id FROM gst_reco_records LIMIT 1')
  if (existing.length) {
    return
  }

  const rows = await query('SELECT client_id, fy_id, business_id, payload FROM fs_data')
  for (const row of rows) {
    const payload = parseJson(row.payload)
    const gstReco = payload?.gstReco
    if (!gstReco || !isMeaningfulGstReco(gstReco)) {
      continue
    }

    await saveGstRecoForFs(row.client_id, row.fy_id, row.business_id, gstReco, null)
  }
}

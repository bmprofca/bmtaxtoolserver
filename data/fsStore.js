import { query } from '../db/connection.js'
import { parseJson } from '../db/init.js'
import {
  deleteUdinForBusiness,
  deleteUdinForFy,
  deleteUdinForFyAllClients,
  getUdinForFs,
  normalizeUdinDetails,
  saveUdinForFs,
} from './udinStore.js'
import {
  createEmptyDepreciationRow,
  createEmptyPreviousYearDepreciation,
  deleteDepreciationForBusiness,
  deleteDepreciationForFy,
  deleteDepreciationForFyAllClients,
  getDepreciationForFs,
  saveDepreciationForFs,
} from './depreciationStore.js'
import {
  deleteBankAccountsForBusiness,
  deleteBankAccountsForFy,
  deleteBankAccountsForFyAllClients,
  getBankAccountsForFs,
  saveBankAccountsForFs,
} from './bankAccountStore.js'
import {
  createEmptyGstReco,
  deleteGstRecoForBusiness,
  deleteGstRecoForFy,
  deleteGstRecoForFyAllClients,
  getGstRecoForFs,
  saveGstRecoForFs,
} from './gstRecoStore.js'
import {
  deleteLoansForBusiness,
  deleteLoansForFy,
  deleteLoansForFyAllClients,
  getLoansForFs,
  saveLoansForFs,
} from './loanStore.js'
import {
  createEmptyNotes,
  deleteNotesForBusiness,
  deleteNotesForFy,
  deleteNotesForFyAllClients,
  getNotesForFs,
  saveNotesForFs,
} from './notesStore.js'
import {
  deleteStatementForBusiness,
  deleteStatementForFy,
  deleteStatementForFyAllClients,
  getStatementForFs,
  saveStatementForFs,
} from './statementStore.js'

const FS_UNLOCK_CONFIRMATION_CODE = '123456'

function generateLockToken() {
  return `LCK-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

function normalizeFinalizationInfo(value = {}) {
  return {
    isFinalized: Boolean(value?.isFinalized),
    isUnlocked: Boolean(value?.isUnlocked),
    finalizedAt: String(value?.finalizedAt || ''),
    unlockedAt: String(value?.unlockedAt || ''),
    lockToken: String(value?.lockToken || '').trim(),
  }
}

function createEmptyFsRecord(clientId, fyId, businessId) {
  return {
    clientId,
    fyId,
    businessId,
    notes: createEmptyNotes(),
    noteBreakdowns: {},
    noteSubAmounts: {},
    administrativeExpenseLines: [],
    otherShortTermBorrowingLines: [],
    manualNoteLines: [],
    capitalAccountLines: [],
    cogsExtraLines: [],
    plAppropriationLines: [],
    plAppropriationAmounts: {},
    depreciationSchedule: [
      createEmptyDepreciationRow(),
    ],
    previousYearDepreciation: createEmptyPreviousYearDepreciation(),
    loans: [],
    bankAccounts: [],
    gstReco: createEmptyGstReco(),
    cashAdjustment: {
      current: 0,
      previous: 0,
    },
    udinDetails: {
      enabled: false,
      caProfileId: '',
      udinNumber: '',
      udinDate: '',
    },
    finalizationInfo: {
      isFinalized: false,
      isUnlocked: false,
      finalizedAt: '',
      unlockedAt: '',
      lockToken: '',
    },
    savedAt: null,
    updatedAt: new Date().toISOString(),
  }
}

function mergeNotesData(record, notesData) {
  const legacyBreakdowns = record.noteBreakdowns || {}
  Object.assign(record, notesData)
  if (
    (!notesData.noteBreakdowns || Object.keys(notesData.noteBreakdowns).length === 0) &&
    legacyBreakdowns &&
    Object.keys(legacyBreakdowns).length > 0
  ) {
    record.noteBreakdowns = legacyBreakdowns
  }
}

export async function getFsData(clientId, fyId, businessId) {
  const rows = await query(
    'SELECT payload FROM fs_data WHERE client_id = ? AND fy_id = ? AND business_id = ?',
    [clientId, fyId, businessId],
  )

  const legacyPayload = rows.length ? parseJson(rows[0].payload) : null
  const record = legacyPayload || createEmptyFsRecord(clientId, fyId, businessId)

  const [udinDetails, depreciation, bankAccounts, gstReco, loans, notesData] =
    await Promise.all([
      getUdinForFs(clientId, fyId, businessId),
      getDepreciationForFs(clientId, fyId, businessId),
      getBankAccountsForFs(clientId, fyId, businessId, legacyPayload),
      getGstRecoForFs(clientId, fyId, businessId),
      getLoansForFs(clientId, fyId, businessId, legacyPayload),
      getNotesForFs(clientId, fyId, businessId),
    ])
  record.udinDetails = udinDetails
  record.depreciationSchedule = depreciation.depreciationSchedule
  record.previousYearDepreciation = depreciation.previousYearDepreciation
  record.bankAccounts = bankAccounts
  record.gstReco = gstReco
  record.loans = loans
  mergeNotesData(record, notesData)
  record.finalizationInfo = normalizeFinalizationInfo(record.finalizationInfo)
  record.savedAt = record.savedAt || record.updatedAt || new Date().toISOString()
  return record
}

export async function saveFsData(clientId, fyId, businessId, data, actor) {
  const rows = await query(
    'SELECT payload FROM fs_data WHERE client_id = ? AND fy_id = ? AND business_id = ?',
    [clientId, fyId, businessId],
  )
  const existing = rows.length
    ? parseJson(rows[0].payload) || createEmptyFsRecord(clientId, fyId, businessId)
    : createEmptyFsRecord(clientId, fyId, businessId)
  const existingFinalization = normalizeFinalizationInfo(existing.finalizationInfo)
  let nextFinalization = normalizeFinalizationInfo(data?.finalizationInfo)
  const unlockCode = String(data?.unlockConfirmationCode || '').trim()

  if (nextFinalization.isFinalized && !nextFinalization.lockToken && !nextFinalization.isUnlocked) {
    nextFinalization.lockToken = generateLockToken()
  }

  if (existingFinalization.lockToken && !nextFinalization.lockToken) {
    if (unlockCode !== FS_UNLOCK_CONFIRMATION_CODE) {
      throw new Error('Invalid confirmation code. Enter 123456 to unlock this finalized statement.')
    }
    nextFinalization.isFinalized = true
    nextFinalization.isUnlocked = true
    nextFinalization.unlockedAt = nextFinalization.unlockedAt || new Date().toISOString()
  }

  if (nextFinalization.lockToken) {
    nextFinalization.isFinalized = true
    nextFinalization.isUnlocked = false
    nextFinalization.finalizedAt = nextFinalization.finalizedAt || new Date().toISOString()
  }

  if (!nextFinalization.isFinalized) {
    nextFinalization = normalizeFinalizationInfo()
  }

  const [udinDetails, depreciation, bankAccounts, gstReco, loans, notesData, statementSnapshot] =
    await Promise.all([
      saveUdinForFs(clientId, fyId, businessId, data.udinDetails, actor),
      saveDepreciationForFs(
        clientId,
        fyId,
        businessId,
        {
          depreciationSchedule: data.depreciationSchedule,
          previousYearDepreciation: data.previousYearDepreciation,
        },
        actor,
      ),
      saveBankAccountsForFs(clientId, fyId, businessId, data.bankAccounts, actor),
      saveGstRecoForFs(clientId, fyId, businessId, data.gstReco, actor),
      saveLoansForFs(clientId, fyId, businessId, data.loans, actor),
      saveNotesForFs(
        clientId,
        fyId,
        businessId,
        {
          notes: data.notes,
          noteSubAmounts: data.noteSubAmounts,
          administrativeExpenseLines: data.administrativeExpenseLines,
          otherShortTermBorrowingLines: data.otherShortTermBorrowingLines,
          manualNoteLines: data.manualNoteLines,
          capitalAccountLines: data.capitalAccountLines,
          cogsExtraLines: data.cogsExtraLines,
          plAppropriationLines: data.plAppropriationLines,
          plAppropriationAmounts: data.plAppropriationAmounts,
          cashAdjustment: data.cashAdjustment,
        },
        actor,
      ),
      data.statementSnapshot
        ? saveStatementForFs(clientId, fyId, businessId, data.statementSnapshot, actor)
        : getStatementForFs(clientId, fyId, businessId),
    ])

  const record = {
    clientId,
    fyId,
    businessId,
    notes: createEmptyNotes(),
    noteBreakdowns: {},
    noteSubAmounts: {},
    administrativeExpenseLines: [],
    otherShortTermBorrowingLines: [],
    manualNoteLines: [],
    capitalAccountLines: [],
    cogsExtraLines: [],
    plAppropriationLines: [],
    plAppropriationAmounts: {},
    depreciationSchedule: depreciation.depreciationSchedule,
    previousYearDepreciation: depreciation.previousYearDepreciation,
    loans: [],
    bankAccounts,
    gstReco,
    cashAdjustment: { current: 0, previous: 0 },
    udinDetails: normalizeUdinDetails(udinDetails),
    finalizationInfo: nextFinalization,
    savedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  await query(
    `INSERT INTO fs_data (client_id, fy_id, business_id, payload)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
    [clientId, fyId, businessId, JSON.stringify(record)],
  )

  return {
    ...record,
    ...notesData,
    loans,
    depreciationSchedule: depreciation.depreciationSchedule,
    previousYearDepreciation: depreciation.previousYearDepreciation,
    bankAccounts,
    gstReco,
    udinDetails: normalizeUdinDetails(udinDetails),
    finalizationInfo: record.finalizationInfo,
    statementSnapshot,
  }
}

export async function deleteFsDataForBusiness(clientId, businessId) {
  await Promise.all([
    deleteUdinForBusiness(clientId, businessId),
    deleteDepreciationForBusiness(clientId, businessId),
    deleteBankAccountsForBusiness(clientId, businessId),
    deleteGstRecoForBusiness(clientId, businessId),
    deleteLoansForBusiness(clientId, businessId),
    deleteNotesForBusiness(clientId, businessId),
    deleteStatementForBusiness(clientId, businessId),
  ])
  await query('DELETE FROM fs_data WHERE client_id = ? AND business_id = ?', [
    clientId,
    businessId,
  ])
}

export async function deleteFsDataForFy(clientId, fyId) {
  await Promise.all([
    deleteUdinForFy(clientId, fyId),
    deleteDepreciationForFy(clientId, fyId),
    deleteBankAccountsForFy(clientId, fyId),
    deleteGstRecoForFy(clientId, fyId),
    deleteLoansForFy(clientId, fyId),
    deleteNotesForFy(clientId, fyId),
    deleteStatementForFy(clientId, fyId),
  ])
  await query('DELETE FROM fs_data WHERE client_id = ? AND fy_id = ?', [clientId, fyId])
}

export async function deleteFsDataForFyAllClients(fyId) {
  await Promise.all([
    deleteUdinForFyAllClients(fyId),
    deleteDepreciationForFyAllClients(fyId),
    deleteBankAccountsForFyAllClients(fyId),
    deleteGstRecoForFyAllClients(fyId),
    deleteLoansForFyAllClients(fyId),
    deleteNotesForFyAllClients(fyId),
    deleteStatementForFyAllClients(fyId),
  ])
  await query('DELETE FROM fs_data WHERE fy_id = ?', [fyId])
}

export async function getFsBusinessUsageCount() {
  const rows = await query(
    'SELECT COUNT(DISTINCT CONCAT(client_id, ":", business_id)) AS total FROM fs_data',
  )
  return Number(rows[0]?.total || 0)
}

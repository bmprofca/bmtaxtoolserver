import express from 'express'
import cors from 'cors'
import { authenticate, getSession, removeSession } from './data/auth.js'
import {
  addClient,
  addBusiness,
  deleteBusiness,
  deleteClient,
  getClients,
  getClientById,
  getDeletedClients,
  getDeletedBusinesses,
  restoreClient,
  restoreBusiness,
  updateClient,
  updateBusiness,
  updateFinancialYear,
} from './data/store.js'
import {
  getFsBusinessUsageCount,
  getFsData,
  saveFsData,
} from './data/fsStore.js'
import { getUdinForFs, saveUdinForFs } from './data/udinStore.js'
import { getDepreciationForFs, saveDepreciationForFs, getAssetDepreciationHistory, getLatestAssetPurchaseDate } from './data/depreciationStore.js'
import {
  getBankAccountsForFs,
  saveBankAccountsForFs,
  getBankAccountHistory,
} from './data/bankAccountStore.js'
import {
  getGstRecoForFs,
  saveGstRecoForFs,
  getGstRecoHistory,
} from './data/gstRecoStore.js'
import {
  getLoansForFs,
  saveLoansForFs,
  getLoanHistory,
  getLoanFySummary,
} from './data/loanStore.js'
import {
  getNotesForFs,
  saveNotesForFs,
  getNoteHistory,
} from './data/notesStore.js'
import {
  getStatementForFs,
  getStatementHistory,
} from './data/statementStore.js'
import { getLedgersWithUsage, saveLedgers, createLedger } from './data/ledgerStore.js'
import {
  getDeletedFinancialYears,
  getFinancialYears,
  restoreFinancialYear,
  saveFinancialYears,
  softDeleteFinancialYear,
  updateFinancialYearStatementType,
  updateFinancialYearStatus,
} from './data/fySettingsStore.js'
import {
  getCaProfile,
  getCaSettings,
  getDeletedCaProfiles,
  restoreCaProfile,
  saveCaProfile,
  saveCaSettings,
  softDeleteCaProfile,
  updateCaProfileStatus,
} from './data/caSettingsStore.js'
import { createUser, deactivateUser, getDeletedUsers, getUsers, regenerateUserToken, changeUserPassword, restoreUser, updateAppUser, updateUserProfile } from './data/userStore.js'
import { hasPermission } from './data/userPermissions.js'
import { bootstrapDataStores } from './bootstrap.js'
import { isRateLimitDbError, testConnection } from './db/connection.js'

const app = express()
const PORT = process.env.PORT || 3001
app.locals.bootstrapError = null
app.locals.dbReady = false
let lastBootstrapRetryAt = 0
const BOOTSTRAP_RETRY_MS = 5 * 60 * 1000

app.set('trust proxy', 1)
app.use(cors())
app.use(express.json({ limit: '25mb' }))
app.use((_req, res, next) => {
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Keep-Alive', 'timeout=120')
  next()
})

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization

  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  const user = await getSession(header.slice(7))

  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired session' })
  }

  req.user = user
  next()
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({ error: 'You do not have permission for this action' })
    }
    next()
  }
}

app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    const dbConnected = await testConnection()
    res.json({
      message: 'Server is running',
      bootstrapped: app.locals.dbReady && !app.locals.bootstrapError,
      bootstrapError: app.locals.bootstrapError,
      database: dbConnected ? 'connected' : 'disconnected',
    })
  }),
)

app.use('/api', async (req, res, next) => {
  if (req.path === '/health') {
    return next()
  }

  if (!app.locals.dbReady) {
    if (app.locals.bootstrapError) {
      return res.status(503).json({
        error: `Database is unavailable: ${app.locals.bootstrapError}`,
      })
    }
    return res.status(503).json({
      error: 'Server is starting — database connection in progress. Retry in a few seconds.',
    })
  }

  if (!app.locals.bootstrapError) {
    return next()
  }

  const now = Date.now()
  if (now - lastBootstrapRetryAt < BOOTSTRAP_RETRY_MS) {
    return res.status(503).json({
      error: `Database is unavailable: ${app.locals.bootstrapError}`,
    })
  }
  lastBootstrapRetryAt = now

  try {
    await bootstrapDataStores()
    app.locals.bootstrapError = null
    app.locals.dbReady = true
    return next()
  } catch (err) {
    app.locals.bootstrapError = err.message || app.locals.bootstrapError
    return res.status(503).json({
      error: `Database is unavailable: ${app.locals.bootstrapError}`,
    })
  }
})

app.post(
  '/api/auth/login',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body

    if (!username?.trim() || !password) {
      return res.status(400).json({ error: 'Username and password are required' })
    }

    const result = await authenticate(username, password)

    if (!result) {
      return res.status(401).json({ error: 'Invalid username or password' })
    }

    res.json(result)
  }),
)

app.post(
  '/api/auth/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const header = req.headers.authorization
    await removeSession(header.slice(7))
    res.status(204).send()
  }),
)

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.user)
})

app.patch(
  '/api/auth/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, mobile } = req.body
    const result = await updateUserProfile(req.user.id, { name, mobile })

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    res.json(result.user)
  }),
)

app.post(
  '/api/auth/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' })
    }

    const result = await changeUserPassword(req.user.id, currentPassword, newPassword)

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    res.status(204).send()
  }),
)

app.get(
  '/api/users',
  requireAuth,
  requirePermission('manageUsers'),
  asyncHandler(async (_req, res) => {
    res.json({ users: await getUsers() })
  }),
)

app.post(
  '/api/users',
  requireAuth,
  requirePermission('manageUsers'),
  asyncHandler(async (req, res) => {
    const { username, mobile, password, name, userType } = req.body
    const result = await createUser({ username, mobile, password, name, userType })

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    res.status(201).json(result)
  }),
)

app.get(
  '/api/users/deleted',
  requireAuth,
  requirePermission('manageUsers'),
  asyncHandler(async (_req, res) => {
    res.json({ users: await getDeletedUsers() })
  }),
)

app.post(
  '/api/users/:userId/regenerate-token',
  requireAuth,
  requirePermission('manageUsers'),
  asyncHandler(async (req, res) => {
    const result = await regenerateUserToken(req.params.userId)

    if (!result.success) {
      return res.status(404).json({ error: result.error })
    }

    res.json(result)
  }),
)

app.put(
  '/api/users/:userId',
  requireAuth,
  requirePermission('manageUsers'),
  asyncHandler(async (req, res) => {
    const { name, mobile, userType, password } = req.body
    const result = await updateAppUser(req.params.userId, { name, mobile, userType, password })

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    res.json(result)
  }),
)

app.delete(
  '/api/users/:userId',
  requireAuth,
  requirePermission('manageUsers'),
  asyncHandler(async (req, res) => {
    const result = await deactivateUser(req.params.userId, req.user.id)

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    res.status(204).send()
  }),
)

app.post(
  '/api/users/:userId/restore',
  requireAuth,
  requirePermission('manageUsers'),
  asyncHandler(async (req, res) => {
    const result = await restoreUser(req.params.userId)

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    res.json(result)
  }),
)

app.get(
  '/api/clients/deleted',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(await getDeletedClients())
  }),
)

app.get(
  '/api/clients',
  requireAuth,
  asyncHandler(async (req, res) => {
    const status = req.query.status === 'inactive' || req.query.status === 'all'
      ? req.query.status
      : 'active'
    const search = String(req.query.search || '').trim()
    res.json(await getClients({ status, search }))
  }),
)

app.get(
  '/api/clients/:clientId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const client = await getClientById(req.params.clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    res.json(client)
  }),
)

app.post(
  '/api/clients',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, mobile, email, address, pin, pan } = req.body

    if (!name?.trim()) {
      return res.status(400).json({ error: 'Client name is required' })
    }

    const result = await addClient({
      name,
      mobile: mobile || '',
      email: email || '',
      address: address || '',
      pin: pin || '',
      pan: pan || '',
    })

    if (!result.success) {
      return res.status(409).json({ error: result.error })
    }

    res.status(201).json(result.client)
  }),
)

app.put(
  '/api/clients/:clientId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId } = req.params
    const { name, mobile, email, address, pin, pan, status } = req.body

    if (!name?.trim()) {
      return res.status(400).json({ error: 'Client name is required' })
    }

    const result = await updateClient(clientId, {
      name,
      mobile: mobile || '',
      email: email || '',
      address: address || '',
      pin: pin || '',
      pan: pan || '',
      status,
    })

    if (!result.success) {
      const status = result.error === 'Client not found' ? 404 : 409
      return res.status(status).json({ error: result.error })
    }

    res.json(result.client)
  }),
)

app.post(
  '/api/clients/:clientId/restore',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await restoreClient(req.params.clientId)

    if (!result.success) {
      const status = result.error === 'Deleted client not found' ? 404 : 409
      return res.status(status).json({ error: result.error })
    }

    res.json(result.client)
  }),
)

app.post(
  '/api/clients/:clientId/businesses',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId } = req.params
    const {
      name,
      type,
      pan,
      address,
      startingFy,
      startingYear,
      gstNumber,
      status,
    } = req.body

    const business = await addBusiness(clientId, {
      name,
      type,
      pan,
      address,
      startingFy,
      startingYear,
      gstNumber,
      status,
    }, req.user)

    if (!business) {
      return res.status(404).json({ error: 'Client not found' })
    }

    if (business.error) {
      return res.status(400).json({ error: business.error })
    }

    res.status(201).json(business)
  }),
)

app.get(
  '/api/clients/:clientId/businesses/deleted',
  requireAuth,
  asyncHandler(async (req, res) => {
    const deleted = await getDeletedBusinesses(req.params.clientId)

    if (deleted === null) {
      return res.status(404).json({ error: 'Client not found' })
    }

    res.json(deleted)
  }),
)

app.post(
  '/api/clients/:clientId/businesses/:businessId/restore',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, businessId } = req.params
    const result = await restoreBusiness(clientId, businessId, req.user)

    if (!result.success) {
      const status = result.error === 'Deleted business not found' ? 404 : 409
      return res.status(status).json({ error: result.error })
    }

    res.json(result.business)
  }),
)

app.put(
  '/api/clients/:clientId/businesses/:businessId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, businessId } = req.params
    const {
      name,
      type,
      pan,
      address,
      startingFy,
      startingYear,
      gstNumber,
      status,
      password,
    } = req.body

    if (!password) {
      return res.status(400).json({ error: 'Password is required' })
    }

    const result = await updateBusiness(
      clientId,
      businessId,
      {
        name,
        type,
        pan,
        address,
        startingFy,
        startingYear,
        gstNumber,
        status,
      },
      password,
      req.user,
    )

    if (!result.success) {
      const statusCode =
        result.error === 'Invalid password'
          ? 403
          : result.error === 'Business not found' || result.error === 'Client not found'
            ? 404
            : 400
      return res.status(statusCode).json({ error: result.error })
    }

    res.json(result.business)
  }),
)

app.post('/api/clients/:clientId/financial-years', requireAuth, (_req, res) => {
  res.status(400).json({
    error: 'Add financial years from Settings. Use the client page to mark closed businesses.',
  })
})

app.put(
  '/api/clients/:clientId/financial-years/:fyId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId } = req.params
    const { closedBusinessIds, statementType } = req.body

    const financialYear = await updateFinancialYear(
      clientId,
      fyId,
      {
        ...(closedBusinessIds !== undefined ? { closedBusinessIds: closedBusinessIds || [] } : {}),
        ...(statementType !== undefined ? { statementType } : {}),
      },
      req.user,
    )

    if (!financialYear) {
      return res.status(404).json({ error: 'Financial year not found' })
    }

    res.json(financialYear)
  }),
)

app.delete('/api/clients/:clientId/financial-years/:fyId', requireAuth, (_req, res) => {
  res.status(400).json({
    error: 'Delete financial years from Settings.',
  })
})

app.get('/api/settings/financial-years', requireAuth, (_req, res) => {
  res.json({ financialYears: getFinancialYears() })
})

app.get(
  '/api/settings/financial-years/deleted',
  requireAuth,
  requirePermission('manageSettings'),
  asyncHandler(async (_req, res) => {
    const deleted = await getDeletedFinancialYears()
    res.json({ financialYears: deleted })
  }),
)

app.patch(
  '/api/settings/financial-years/:fyId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { fyId } = req.params
    const { statementType, status } = req.body

    if (status !== undefined) {
      if (!hasPermission(req.user, 'manageSettings')) {
        return res.status(403).json({ error: 'You do not have permission for this action' })
      }

      if (status !== 'active' && status !== 'inactive') {
        return res.status(400).json({ error: 'status must be active or inactive' })
      }

      const financialYear = await updateFinancialYearStatus(fyId, status, req.user)

      if (!financialYear) {
        return res.status(404).json({ error: 'Financial year not found' })
      }

      return res.json({ financialYear })
    }

    if (statementType === undefined) {
      return res.status(400).json({ error: 'statementType or status is required' })
    }

    const financialYear = await updateFinancialYearStatementType(fyId, statementType, req.user)

    if (!financialYear) {
      return res.status(404).json({ error: 'Financial year not found' })
    }

    res.json({ financialYear })
  }),
)

app.patch(
  '/api/settings/financial-years/:fyId/status',
  requireAuth,
  requirePermission('manageSettings'),
  asyncHandler(async (req, res) => {
    const { status } = req.body

    if (status !== 'active' && status !== 'inactive') {
      return res.status(400).json({ error: 'status must be active or inactive' })
    }

    const financialYear = await updateFinancialYearStatus(req.params.fyId, status, req.user)

    if (!financialYear) {
      return res.status(404).json({ error: 'Financial year not found' })
    }

    res.json({ financialYear })
  }),
)

app.put(
  '/api/settings/financial-years',
  requireAuth,
  requirePermission('manageSettings'),
  asyncHandler(async (req, res) => {
    try {
      const saved = await saveFinancialYears(req.body.financialYears, req.user)
      res.json({ financialYears: saved })
    } catch (err) {
      res.status(400).json({ error: err.message || 'Invalid financial years' })
    }
  }),
)

app.post(
  '/api/settings/financial-years/:fyId/restore',
  requireAuth,
  requirePermission('manageSettings'),
  asyncHandler(async (req, res) => {
    const result = await restoreFinancialYear(req.params.fyId, req.user)

    if (!result.success) {
      const status = result.error === 'Deleted financial year not found' ? 404 : 409
      return res.status(status).json({ error: result.error })
    }

    res.json({ financialYear: result.financialYear })
  }),
)

app.delete(
  '/api/settings/financial-years/:fyId',
  requireAuth,
  requirePermission('manageSettings'),
  asyncHandler(async (req, res) => {
    const { fyId } = req.params

    try {
      await softDeleteFinancialYear(fyId, req.user)
      res.status(204).send()
    } catch (err) {
      const status = err.message === 'Financial year not found' ? 404 : 400
      res.status(status).json({ error: err.message || 'Failed to delete financial year' })
    }
  }),
)

app.get('/api/settings/ca-profile', requireAuth, (_req, res) => {
  res.json({ caProfile: getCaProfile() })
})

app.put(
  '/api/settings/ca-profile',
  requireAuth,
  requirePermission('manageCa'),
  asyncHandler(async (req, res) => {
    const saved = await saveCaProfile(req.body.caProfile || {}, req.user)
    res.json({ caProfile: saved })
  }),
)

app.get('/api/settings/ca-profiles', requireAuth, (_req, res) => {
  res.json(getCaSettings())
})

app.get(
  '/api/settings/ca-profiles/deleted',
  requireAuth,
  requirePermission('manageCa'),
  asyncHandler(async (_req, res) => {
    const deleted = await getDeletedCaProfiles()
    res.json({ caProfiles: deleted })
  }),
)

app.put(
  '/api/settings/ca-profiles',
  requireAuth,
  requirePermission('manageCa'),
  asyncHandler(async (req, res) => {
    const saved = await saveCaSettings(req.body || {}, req.user)
    res.json(saved)
  }),
)

app.patch(
  '/api/settings/ca-profiles/:profileId/status',
  requireAuth,
  requirePermission('manageCa'),
  asyncHandler(async (req, res) => {
    const { profileId } = req.params
    const { status } = req.body

    if (!status) {
      return res.status(400).json({ error: 'status is required' })
    }

    const caProfile = await updateCaProfileStatus(profileId, status, req.user)

    if (!caProfile) {
      return res.status(404).json({ error: 'CA profile not found' })
    }

    res.json({ caProfile })
  }),
)

app.post(
  '/api/settings/ca-profiles/:profileId/restore',
  requireAuth,
  requirePermission('manageCa'),
  asyncHandler(async (req, res) => {
    const result = await restoreCaProfile(req.params.profileId, req.user)

    if (!result.success) {
      const status = result.error === 'Deleted CA profile not found' ? 404 : 409
      return res.status(status).json({ error: result.error })
    }

    res.json({ caProfile: result.caProfile })
  }),
)

app.delete(
  '/api/settings/ca-profiles/:profileId',
  requireAuth,
  requirePermission('manageCa'),
  asyncHandler(async (req, res) => {
    const { profileId } = req.params
    const { confirmationCode } = req.body
    const result = await softDeleteCaProfile(profileId, confirmationCode, req.user)

    if (!result.success) {
      const status =
        result.error === 'Invalid confirmation code'
          ? 403
          : result.error === 'CA profile not found'
            ? 404
            : 400
      return res.status(status).json({ error: result.error })
    }

    res.status(204).send()
  }),
)

app.get(
  '/api/settings/ca-usage-summary',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ businessUsageCount: await getFsBusinessUsageCount() })
  }),
)

app.get(
  '/api/clients/:clientId/fs/:fyId/businesses/:businessId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId, businessId } = req.params
    res.json(await getFsData(clientId, fyId, businessId))
  }),
)

app.put(
  '/api/clients/:clientId/fs/:fyId/businesses/:businessId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const saved = await saveFsData(clientId, fyId, businessId, req.body, req.user)
    res.json(saved)
  }),
)

app.get(
  '/api/clients/:clientId/fs/:fyId/businesses/:businessId/udin',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    res.json({ udinDetails: await getUdinForFs(clientId, fyId, businessId) })
  }),
)

app.put(
  '/api/clients/:clientId/fs/:fyId/businesses/:businessId/udin',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const saved = await saveUdinForFs(
      clientId,
      fyId,
      businessId,
      req.body.udinDetails || req.body,
      req.user,
    )
    res.json({ udinDetails: saved })
  }),
)

app.get(
  '/api/clients/:clientId/fs/:fyId/businesses/:businessId/depreciation',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    res.json(await getDepreciationForFs(clientId, fyId, businessId))
  }),
)

app.put(
  '/api/clients/:clientId/fs/:fyId/businesses/:businessId/depreciation',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const saved = await saveDepreciationForFs(
      clientId,
      fyId,
      businessId,
      {
        depreciationSchedule: req.body.depreciationSchedule,
        previousYearDepreciation: req.body.previousYearDepreciation,
      },
      req.user,
    )
    res.json(saved)
  }),
)

app.get(
  '/api/clients/:clientId/businesses/:businessId/depreciation-history',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const ledgerId = req.query.ledgerId ? String(req.query.ledgerId) : null
    const history = await getAssetDepreciationHistory(clientId, businessId, ledgerId)
    res.json({ history })
  }),
)

app.get(
  '/api/clients/:clientId/businesses/:businessId/depreciation-history/purchase-date/:ledgerId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, businessId, ledgerId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const purchaseDate = await getLatestAssetPurchaseDate(clientId, businessId, ledgerId)
    res.json({ purchaseDate })
  }),
)

app.get(
  '/api/clients/:clientId/fs/:fyId/businesses/:businessId/bank-accounts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const bankAccounts = await getBankAccountsForFs(clientId, fyId, businessId)
    res.json({ bankAccounts })
  }),
)

app.put(
  '/api/clients/:clientId/fs/:fyId/businesses/:businessId/bank-accounts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const bankAccounts = await saveBankAccountsForFs(
      clientId,
      fyId,
      businessId,
      req.body.bankAccounts,
      req.user,
    )
    res.json({ bankAccounts })
  }),
)

app.get(
  '/api/clients/:clientId/businesses/:businessId/bank-account-history',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const bankAccountId = req.query.bankAccountId ? String(req.query.bankAccountId) : null
    const history = await getBankAccountHistory(clientId, businessId, bankAccountId)
    res.json({ history })
  }),
)

app.get(
  '/api/clients/:clientId/fs/:fyId/businesses/:businessId/gst-reco',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const gstReco = await getGstRecoForFs(clientId, fyId, businessId)
    res.json({ gstReco })
  }),
)

app.put(
  '/api/clients/:clientId/fs/:fyId/businesses/:businessId/gst-reco',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const gstReco = await saveGstRecoForFs(
      clientId,
      fyId,
      businessId,
      req.body.gstReco,
      req.user,
    )
    res.json({ gstReco })
  }),
)

app.get(
  '/api/clients/:clientId/businesses/:businessId/gst-reco-history',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const fyId = req.query.fyId ? String(req.query.fyId) : null
    const history = await getGstRecoHistory(clientId, businessId, fyId)
    res.json({ history })
  }),
)

app.get(
  '/api/clients/:clientId/fs/:fyId/businesses/:businessId/loans',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const loans = await getLoansForFs(clientId, fyId, businessId)
    res.json({ loans })
  }),
)

app.put(
  '/api/clients/:clientId/fs/:fyId/businesses/:businessId/loans',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const loans = await saveLoansForFs(
      clientId,
      fyId,
      businessId,
      req.body.loans,
      req.user,
    )
    res.json({ loans })
  }),
)

app.get(
  '/api/clients/:clientId/businesses/:businessId/loan-history',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const loanId = req.query.loanId ? String(req.query.loanId) : null
    const history = await getLoanHistory(clientId, businessId, loanId)
    res.json({ history })
  }),
)

app.get(
  '/api/clients/:clientId/fs/:fyId/businesses/:businessId/loan-summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const summary = await getLoanFySummary(clientId, fyId, businessId)
    res.json({ summary })
  }),
)

app.get(
  '/api/clients/:clientId/fs/:fyId/businesses/:businessId/notes',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const notesData = await getNotesForFs(clientId, fyId, businessId)
    res.json({ notesData })
  }),
)

app.put(
  '/api/clients/:clientId/fs/:fyId/businesses/:businessId/notes',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const notesData = await saveNotesForFs(
      clientId,
      fyId,
      businessId,
      req.body.notesData,
      req.user,
    )
    res.json({ notesData })
  }),
)

app.get(
  '/api/clients/:clientId/businesses/:businessId/note-history',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const fyId = req.query.fyId ? String(req.query.fyId) : null
    const history = await getNoteHistory(clientId, businessId, fyId)
    res.json({ history })
  }),
)

app.get(
  '/api/clients/:clientId/fs/:fyId/businesses/:businessId/balance-sheet',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const statement = await getStatementForFs(clientId, fyId, businessId)
    res.json({ statement })
  }),
)

app.get(
  '/api/clients/:clientId/fs/:fyId/businesses/:businessId/profit-loss',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, fyId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const statement = await getStatementForFs(clientId, fyId, businessId)
    res.json({ statement })
  }),
)

app.get(
  '/api/clients/:clientId/businesses/:businessId/statement-history',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, businessId } = req.params
    const client = await getClientById(clientId)

    if (!client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    const fyId = req.query.fyId ? String(req.query.fyId) : null
    const history = await getStatementHistory(clientId, businessId, fyId)
    res.json({ history })
  }),
)

app.get(
  '/api/ledgers',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const ledgers = await getLedgersWithUsage()
    res.json({ ledgers })
  }),
)

app.post(
  '/api/ledgers',
  requireAuth,
  requirePermission('manageFs'),
  asyncHandler(async (req, res) => {
    const result = await createLedger(req.body, req.user)
    res.status(result.created ? 201 : 200).json(result)
  }),
)

app.put(
  '/api/ledgers',
  requireAuth,
  requirePermission('manageLedger'),
  asyncHandler(async (req, res) => {
    const saved = await saveLedgers(req.body.ledgers, req.user)
    res.json({ ledgers: saved })
  }),
)

app.delete(
  '/api/clients/:clientId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { password } = req.body
    const result = await deleteClient(req.params.clientId, password)

    if (!result.success) {
      const status = result.error === 'Invalid password' ? 403 : 404
      return res.status(status).json({ error: result.error })
    }

    res.status(204).send()
  }),
)

app.delete(
  '/api/clients/:clientId/businesses/:businessId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { clientId, businessId } = req.params
    const { password } = req.body
    const result = await deleteBusiness(clientId, businessId, password, req.user)

    if (!result.success) {
      const status = result.error === 'Invalid password' ? 403 : 404
      return res.status(status).json({ error: result.error })
    }

    res.status(204).send()
  }),
)

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'Internal server error' })
})

async function startServer() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`)
    console.log(`Database: ${process.env.DB_NAME || 'not configured'}`)
    console.log(`DB connect timeout: ${process.env.DB_CONNECT_TIMEOUT_MS || 5000}ms`)
  })

  try {
    await bootstrapDataStores()
    app.locals.dbReady = true
    app.locals.bootstrapError = null
    console.log('Database connected and data stores loaded.')
  } catch (err) {
    app.locals.bootstrapError = err.message || 'Unknown bootstrap error'
    if (isRateLimitDbError(err)) {
      console.error('Server started in degraded mode (MySQL rate limit):', app.locals.bootstrapError)
    } else {
      console.error('Server started in degraded mode:', app.locals.bootstrapError)
    }
    console.log('API will return 503 responses until database connectivity is restored.')
  }
}

startServer()

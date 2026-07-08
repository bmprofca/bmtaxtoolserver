export const USER_TYPES = ['admin', 'staff']

export const PERMISSIONS = {
  manageUsers: ['admin'],
  manageSettings: ['admin'],
  manageCa: ['admin'],
  manageLedger: ['admin'],
  manageClients: ['admin', 'staff'],
  manageFs: ['admin', 'staff'],
}

export function normalizeUserType(value) {
  return value === 'admin' ? 'admin' : 'staff'
}

export function isAdmin(user) {
  return normalizeUserType(user?.userType) === 'admin'
}

export function hasPermission(user, permission) {
  const allowed = PERMISSIONS[permission] || []
  return allowed.includes(normalizeUserType(user?.userType))
}

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  TRAINER: 'trainer',
  MEMBER: 'member'
});

export const ROUTE_PERMISSIONS = Object.freeze({
  dashboard: {
    label: 'Dashboard',
    roles: [ROLES.ADMIN, ROLES.TRAINER, ROLES.MEMBER]
  },
  attendance: {
    label: 'Attendance',
    roles: [ROLES.ADMIN, ROLES.TRAINER, ROLES.MEMBER]
  },
  members: {
    label: 'Users',
    roles: [ROLES.ADMIN, ROLES.TRAINER]
  },
  workouts: {
    label: 'Workouts',
    roles: [ROLES.ADMIN, ROLES.TRAINER, ROLES.MEMBER]
  },
  settings: {
    label: 'Settings',
    roles: [ROLES.ADMIN]
  }
});

const ROLE_CAPABILITIES = Object.freeze({
  [ROLES.ADMIN]: [
    'dashboard:view_all',
    'attendance:view_all',
    'attendance:manage_tokens',
    'members:view_all',
    'members:manage',
    'workouts:view_all',
    'workouts:manage',
    'settings:manage'
  ],
  [ROLES.TRAINER]: [
    'dashboard:view_assigned',
    'attendance:view_assigned',
    'members:view_assigned',
    'workouts:view_assigned',
    'workouts:assign'
  ],
  [ROLES.MEMBER]: [
    'dashboard:view_own',
    'attendance:view_own',
    'attendance:scan',
    'workouts:view_own'
  ]
});

export function normalizeRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return Object.values(ROLES).includes(normalized) ? normalized : null;
}

export function hasRole(role, allowedRoles = []) {
  const normalizedRole = normalizeRole(role);

  if (!allowedRoles.length) {
    return Boolean(normalizedRole);
  }

  return Boolean(normalizedRole && allowedRoles.includes(normalizedRole));
}

export function canAccessRoute(role, routeName) {
  const route = ROUTE_PERMISSIONS[routeName];
  return Boolean(route && hasRole(role, route.roles));
}

export function getDefaultRouteForRole(role) {
  return canAccessRoute(role, 'dashboard') ? 'dashboard' : null;
}

export function getVisibleRoutes(role) {
  return Object.entries(ROUTE_PERMISSIONS)
    .filter(([routeName]) => canAccessRoute(role, routeName))
    .map(([routeName, route]) => ({
      name: routeName,
      label: route.label
    }));
}

export function hasCapability(role, capability) {
  const normalizedRole = normalizeRole(role);
  return Boolean(normalizedRole && ROLE_CAPABILITIES[normalizedRole]?.includes(capability));
}

export function getRoleCapabilities(role) {
  const normalizedRole = normalizeRole(role);
  return normalizedRole ? [...(ROLE_CAPABILITIES[normalizedRole] || [])] : [];
}

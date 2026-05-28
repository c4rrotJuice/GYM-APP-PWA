export const ROLES = Object.freeze({
  ADMIN: 'admin',
  TRAINER: 'trainer',
  MEMBER: 'member'
});

export const ROUTE_PERMISSIONS = Object.freeze({
  dashboard: {
    label: 'Dashboard',
    roles: [ROLES.ADMIN, ROLES.TRAINER, ROLES.MEMBER],
    capability: 'dashboard:view'
  },
  attendance: {
    label: 'Attendance',
    roles: [ROLES.ADMIN, ROLES.TRAINER, ROLES.MEMBER],
    capability: 'attendance:view'
  },
  members: {
    label: 'Users',
    roles: [ROLES.ADMIN, ROLES.TRAINER],
    capability: 'members:view'
  },
  memberships: {
    label: 'Memberships',
    roles: [ROLES.ADMIN, ROLES.TRAINER, ROLES.MEMBER],
    capability: 'memberships:view'
  },
  workouts: {
    label: 'Workouts',
    roles: [ROLES.ADMIN, ROLES.TRAINER, ROLES.MEMBER],
    capability: 'workouts:view'
  },
  settings: {
    label: 'Settings',
    roles: [ROLES.ADMIN],
    capability: 'settings:manage'
  }
});

const ROLE_CAPABILITIES = Object.freeze({
  [ROLES.ADMIN]: [
    'dashboard:view',
    'dashboard:view_all',
    'attendance:view',
    'attendance:view_all',
    'attendance:manage_tokens',
    'members:view',
    'members:view_all',
    'members:manage',
    'members:assign_trainer',
    'members:disable',
    'memberships:view_all',
    'memberships:view',
    'membership_plans:view',
    'membership_plans:manage',
    'memberships:assign_plan',
    'memberships:suspend',
    'workouts:view',
    'workouts:view_all',
    'workouts:manage',
    'settings:manage'
  ],
  [ROLES.TRAINER]: [
    'dashboard:view',
    'dashboard:view_assigned',
    'attendance:view',
    'attendance:view_assigned',
    'members:view',
    'members:view_assigned',
    'memberships:view',
    'memberships:view_assigned',
    'workouts:view',
    'workouts:view_assigned',
    'workouts:assign'
  ],
  [ROLES.MEMBER]: [
    'dashboard:view',
    'dashboard:view_own',
    'attendance:view',
    'attendance:view_own',
    'attendance:scan',
    'memberships:view',
    'memberships:view_own',
    'workouts:view',
    'workouts:view_own'
  ]
});

export const ACTION_PERMISSIONS = Object.freeze({
  'users:create': ['members:manage'],
  'users:list': ['members:view_all', 'members:view_assigned'],
  'users:update': ['members:manage'],
  'users:change_role': ['members:manage'],
  'users:assign_trainer': ['members:assign_trainer'],
  'users:set_status': ['members:disable'],
  'users:disable': ['members:disable'],
  'memberships:count_active': ['memberships:view_all'],
  'memberships:list': ['memberships:view_all', 'memberships:view_assigned', 'memberships:view_own'],
  'memberships:assign_plan': ['memberships:assign_plan'],
  'membership_plans:list': ['membership_plans:view', 'membership_plans:manage'],
  'membership_plans:create': ['membership_plans:manage'],
  'membership_plans:update': ['membership_plans:manage'],
  'settings:update': ['settings:manage']
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
  return Boolean(
    route &&
    hasRole(getRoleFromSource(role), route.roles) &&
    (!route.capability || hasCapability(role, route.capability))
  );
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
  const normalizedRole = getRoleFromSource(role);
  return Boolean(normalizedRole && ROLE_CAPABILITIES[normalizedRole]?.includes(capability));
}

export function getRoleCapabilities(role) {
  const normalizedRole = getRoleFromSource(role);
  return normalizedRole ? [...(ROLE_CAPABILITIES[normalizedRole] || [])] : [];
}

export function canPerformAction(role, actionName) {
  const requiredCapabilities = ACTION_PERMISSIONS[actionName] || [];

  if (!requiredCapabilities.length) {
    return false;
  }

  return requiredCapabilities.some((capability) => hasCapability(role, capability));
}

export function requireAction(role, actionName) {
  if (!canPerformAction(role, actionName)) {
    throw new Error('Your account is not allowed to perform this action.');
  }
}

export function getRoutePermission(routeName) {
  return ROUTE_PERMISSIONS[routeName] || null;
}

export function getRolePermissions(role) {
  const normalizedRole = getRoleFromSource(role);
  const capabilities = getRoleCapabilities(normalizedRole);

  return {
    routes: getVisibleRoutes(normalizedRole).map((route) => route.name),
    actions: Object.entries(ACTION_PERMISSIONS)
      .filter(([, requiredCapabilities]) => (
        requiredCapabilities.some((capability) => capabilities.includes(capability))
      ))
      .map(([actionName]) => actionName),
    capabilities
  };
}

export function getRoleFromSource(source) {
  return normalizeRole(
    typeof source === 'string'
      ? source
      : source?.role || source?.profile?.role || source?.user?.profile?.role
  );
}

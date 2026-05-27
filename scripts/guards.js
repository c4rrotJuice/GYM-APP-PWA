import {
  getCurrentUserRole,
  invalidateCurrentUserRoleCache,
  restoreSession,
  watchAuthState
} from './session.js';
import { canAccessRoute, getDefaultRouteForRole, hasRole } from './permissions.js';

const DEFAULT_AUTH_ROUTE = '/app.html#dashboard';
const DEFAULT_PUBLIC_ROUTE = '/index.html';
const DEFAULT_UNAUTHORIZED_ROUTE = '/unauthorized';

export async function bootstrapPublicRoute() {
  const session = await restoreSession();

  if (session) {
    redirectToDashboard();
    return { session, allowed: false };
  }

  watchAuthState((event, nextSession) => {
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && nextSession) {
      redirectToDashboard();
    }
  });

  return { session: null, allowed: true };
}

export async function bootstrapAuthenticatedRoute({ routeName = 'dashboard' } = {}) {
  const session = await restoreSession({ verify: true });

  if (!session) {
    redirectToPublic();
    return { session: null, allowed: false, role: null };
  }

  const role = await getCurrentUserRole({ session, forceRefresh: true });
  const defaultRoute = getDefaultRouteForRole(role);

  if (!defaultRoute) {
    redirectToPublic();
    return { session, allowed: false, role };
  }

  if (!canAccessRoute(role, routeName)) {
    window.location.hash = defaultRoute;
    return { session, allowed: true, role, routeName: defaultRoute };
  }

  let activeSession = session;
  const refreshRouteAccess = async ({ forceRefresh = true } = {}) => {
    const nextRoute = window.location.hash.replace('#', '').trim().toLowerCase() || 'dashboard';
    const nextRole = await getCurrentUserRole({ session: activeSession, forceRefresh });
    const nextDefaultRoute = getDefaultRouteForRole(nextRole);

    if (!nextDefaultRoute) {
      redirectToPublic();
      return;
    }

    if (!canAccessRoute(nextRole, nextRoute)) {
      window.location.replace(`/app.html#${nextDefaultRoute}`);
    }
  };

  window.addEventListener('hashchange', () => {
    invalidateCurrentUserRoleCache();
    refreshRouteAccess();
  });

  watchAuthState(async (event, nextSession) => {
    if (event === 'SIGNED_OUT' || !nextSession) {
      activeSession = null;
      redirectToPublic();
      return;
    }

    activeSession = nextSession;

    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      refreshRouteAccess();
    }
  });

  return { session, allowed: true, role, routeName };
}

export async function requireRole(requiredRole, { session = null, redirect = true } = {}) {
  const activeSession = session || await restoreSession({ verify: true });

  if (!activeSession) {
    if (redirect) {
      redirectToPublic();
    }

    return { session: null, allowed: false, role: null };
  }

  const role = await getCurrentUserRole({ session: activeSession, forceRefresh: true });
  const allowed = hasRole(role, Array.isArray(requiredRole) ? requiredRole : [requiredRole]);

  if (!allowed && redirect) {
    redirectToUnauthorized();
  }

  return { session: activeSession, allowed, role };
}

export function redirectToDashboard() {
  const destination = window.matchMedia('(display-mode: standalone)').matches
    ? DEFAULT_AUTH_ROUTE
    : '/app.html';

  window.location.replace(destination);
}

export function redirectToPublic() {
  if (location.pathname.endsWith('/index.html') || location.pathname === '/') {
    return;
  }

  window.location.replace(DEFAULT_PUBLIC_ROUTE);
}

export function redirectToUnauthorized() {
  if (location.pathname === DEFAULT_UNAUTHORIZED_ROUTE) {
    return;
  }

  window.location.replace(DEFAULT_UNAUTHORIZED_ROUTE);
}

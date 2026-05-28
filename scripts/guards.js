import {
  clearAppContext,
  hydrateAppContext,
  refreshAppContext,
  setAppContextFromSession
} from './app-context.js';
import {
  invalidateCurrentUserRoleCache,
  watchAuthState
} from './session.js';
import { canAccessRoute, getDefaultRouteForRole, hasRole } from './permissions.js';

const DEFAULT_PUBLIC_ROUTE = '/index.html';
const DEFAULT_UNAUTHORIZED_ROUTE = '/unauthorized';
const INTENDED_ROUTE_KEY = 'gym-pwa-intended-route';

export async function bootstrapPublicRoute() {
  const appContext = await hydrateAppContext();

  if (appContext.isAuthenticated) {
    redirectToDashboard(appContext);
    return { appContext, session: appContext.session, allowed: false };
  }

  watchAuthState(async (event, nextSession) => {
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && nextSession) {
      const nextContext = await setAppContextFromSession(nextSession);
      redirectToDashboard(nextContext);
    }
  });

  return { appContext, session: null, allowed: true };
}

export async function bootstrapAuthenticatedRoute({ routeName = 'dashboard' } = {}) {
  const appContext = await hydrateAppContext({ verify: true, force: true });

  if (!appContext.isAuthenticated) {
    rememberIntendedRoute();
    redirectToPublic();
    return { appContext, session: null, allowed: false, role: null };
  }

  const defaultRoute = getDefaultRouteForRole(appContext);

  if (!defaultRoute) {
    redirectToPublic();
    return { appContext, session: appContext.session, allowed: false, role: appContext.role };
  }

  if (!canAccessRoute(appContext, routeName)) {
    window.location.replace(`/app.html#${defaultRoute}`);
    return {
      appContext,
      session: appContext.session,
      allowed: true,
      role: appContext.role,
      routeName: defaultRoute
    };
  }

  const refreshRouteAccess = async ({ forceRefresh = true } = {}) => {
    const nextRoute = window.location.hash.replace('#', '').trim().toLowerCase() || 'dashboard';
    const nextContext = await refreshAppContext({ verify: forceRefresh });
    const nextDefaultRoute = getDefaultRouteForRole(nextContext);

    if (!nextContext.isAuthenticated || !nextDefaultRoute) {
      rememberIntendedRoute();
      redirectToPublic();
      return;
    }

    if (!canAccessRoute(nextContext, nextRoute)) {
      window.location.replace(`/app.html#${nextDefaultRoute}`);
    }
  };

  window.addEventListener('hashchange', () => {
    invalidateCurrentUserRoleCache();
    refreshRouteAccess();
  });

  watchAuthState(async (event, nextSession) => {
    if (event === 'SIGNED_OUT' || !nextSession) {
      clearAppContext();
      rememberIntendedRoute();
      redirectToPublic();
      return;
    }

    await setAppContextFromSession(nextSession);

    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      refreshRouteAccess();
    }
  });

  return {
    appContext,
    session: appContext.session,
    allowed: true,
    role: appContext.role,
    routeName
  };
}

export async function requireRole(requiredRole, { appContext = null, redirect = true } = {}) {
  const activeContext = appContext || await hydrateAppContext({ verify: true });

  if (!activeContext.isAuthenticated) {
    if (redirect) {
      rememberIntendedRoute();
      redirectToPublic();
    }

    return { appContext: activeContext, session: null, allowed: false, role: null };
  }

  const allowed = hasRole(activeContext.role, Array.isArray(requiredRole) ? requiredRole : [requiredRole]);

  if (!allowed && redirect) {
    redirectToUnauthorized();
  }

  return { appContext: activeContext, session: activeContext.session, allowed, role: activeContext.role };
}

export function redirectToDashboard(appContext = null) {
  const intendedRoute = consumeIntendedRoute();
  const defaultRoute = getDefaultRouteForRole(appContext) || 'dashboard';
  const route = intendedRoute && canAccessRoute(appContext, intendedRoute)
    ? intendedRoute
    : defaultRoute;
  window.location.replace(`/app.html#${route}`);
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

export function consumeIntendedRoute() {
  if (!hasSessionStorage()) {
    return '';
  }

  const route = sessionStorage.getItem(INTENDED_ROUTE_KEY) || '';
  sessionStorage.removeItem(INTENDED_ROUTE_KEY);
  return route;
}

function rememberIntendedRoute() {
  if (!hasSessionStorage() || !location.pathname.endsWith('/app.html')) {
    return;
  }

  const route = window.location.hash.replace('#', '').trim().toLowerCase();
  if (route) {
    sessionStorage.setItem(INTENDED_ROUTE_KEY, route);
  }
}

function hasSessionStorage() {
  return typeof sessionStorage !== 'undefined';
}

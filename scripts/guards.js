import { getUserRole, restoreSession, watchAuthState } from './session.js';
import { canAccessRoute, getDefaultRouteForRole } from './permissions.js';

const DEFAULT_AUTH_ROUTE = '/app.html#dashboard';
const DEFAULT_PUBLIC_ROUTE = '/index.html';

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

  const role = getUserRole(session);
  const defaultRoute = getDefaultRouteForRole(role);

  if (!defaultRoute) {
    redirectToPublic();
    return { session, allowed: false, role };
  }

  if (!canAccessRoute(role, routeName)) {
    window.location.hash = defaultRoute;
    return { session, allowed: true, role, routeName: defaultRoute };
  }

  watchAuthState((event, nextSession) => {
    if (event === 'SIGNED_OUT' || !nextSession) {
      redirectToPublic();
      return;
    }

    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      const nextRole = getUserRole(nextSession);
      const nextRoute = window.location.hash.replace('#', '').trim().toLowerCase() || 'dashboard';
      const nextDefaultRoute = getDefaultRouteForRole(nextRole);

      if (!nextDefaultRoute) {
        redirectToPublic();
        return;
      }

      if (!canAccessRoute(nextRole, nextRoute)) {
        window.location.replace(`/app.html#${nextDefaultRoute}`);
      }
    }
  });

  return { session, allowed: true, role, routeName };
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

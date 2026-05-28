const DASHBOARD_ROUTE_KEY = 'gym-pwa-dashboard-route';

export function rememberNavigationState({ role, routeName } = {}) {
  if (!hasSessionStorage() || !role || !routeName) {
    return;
  }

  sessionStorage.setItem(getRouteKey(role), routeName);
}

export function getRememberedRoute(role) {
  if (!hasSessionStorage() || !role) {
    return '';
  }

  return sessionStorage.getItem(getRouteKey(role)) || '';
}

function getRouteKey(role) {
  return `${DASHBOARD_ROUTE_KEY}:${role}`;
}

function hasSessionStorage() {
  return typeof sessionStorage !== 'undefined';
}

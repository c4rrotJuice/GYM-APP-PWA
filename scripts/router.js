import { canAccessRoute, getDefaultRouteForRole } from './permissions.js';
import { getAppContext } from './app-context.js';
import { getRememberedRoute, rememberNavigationState } from './dashboard-state.js';
import { ROUTE_DEFINITIONS, createTopSubNavigation, renderBottomNavigation } from './navigation.js';
import { createAdminDashboardView, initAdminDashboardPage } from '../pages/admin/dashboard.js';
import { createUsersView, initUsersPage } from '../pages/admin/users.js';
import { createTrainerDashboardView, initTrainerDashboardPage } from '../pages/trainer/dashboard.js';
import { createMemberDashboardView, initMemberDashboardPage } from '../pages/member/dashboard.js';
import { createModulePlaceholderView, initModulePlaceholderPage } from '../pages/common/module-placeholder.js';

const DASHBOARD_PAGES = Object.freeze({
  admin: {
    render: createAdminDashboardView,
    init: initAdminDashboardPage
  },
  trainer: {
    render: createTrainerDashboardView,
    init: initTrainerDashboardPage
  },
  member: {
    render: createMemberDashboardView,
    init: initMemberDashboardPage
  }
});

const PAGE_REGISTRY = Object.freeze({
  members: {
    render: createUsersView,
    init: initUsersPage
  },
  attendance: {
    render: createModulePlaceholderView,
    init: initModulePlaceholderPage
  },
  workouts: {
    render: createModulePlaceholderView,
    init: initModulePlaceholderPage
  },
  settings: {
    render: createModulePlaceholderView,
    init: initModulePlaceholderPage
  }
});

export function initRouter({ target, navItems, appContext, supabaseReady }) {
  if (!target) {
    return;
  }

  let renderRequestId = 0;

  const renderRoute = async () => {
    const requestId = ++renderRequestId;
    const routeName = normalizeRoute(window.location.hash);
    const context = getActiveContext(appContext);
    const role = context?.role || null;
    const route = ROUTE_DEFINITIONS[routeName];

    if (requestId !== renderRequestId) {
      return;
    }

    renderBottomNavigation(navItems, role);

    if (!route) {
      redirectToFallbackRoute(role);
      return;
    }

    if (!canAccessRoute(context, routeName)) {
      renderBlockedRoute({ target, route, routeName, role, context });
      return;
    }

    rememberNavigationState({ role, routeName });
    document.title = `${route.title} | Gym PWA`;
    target.setAttribute('aria-busy', 'true');
    target.innerHTML = createPageView(routeName, {
      appContext: context,
      role,
      routeName,
      route,
      supabaseReady
    });
    target.focus({ preventScroll: true });

    await initializeRoute(target, routeName, {
      appContext: context,
      role,
      routeName,
      route,
      supabaseReady
    });

    target.setAttribute('aria-busy', 'false');
    syncActiveNavigation(navItems, routeName);
  };

  window.addEventListener('hashchange', renderRoute);

  if (!window.location.hash) {
    const rememberedRoute = getRememberedRoute(appContext?.role);
    const route = rememberedRoute && canAccessRoute(appContext, rememberedRoute)
      ? rememberedRoute
      : getDefaultRouteForRole(appContext) || 'dashboard';
    window.location.hash = `#${route}`;
    return;
  }

  renderRoute();
}

function createPageView(routeName, state) {
  const page = resolvePage(routeName, state.role);

  if (!page) {
    return createBlockedView(state.route, state.role);
  }

  return `
    ${createTopSubNavigation({ role: state.role, activeRoute: routeName })}
    ${page.render(state)}
  `;
}

async function initializeRoute(target, routeName, state) {
  const page = resolvePage(routeName, state.role);
  await page?.init?.({ target, ...state });
}

function resolvePage(routeName, role) {
  if (routeName === 'dashboard') {
    return DASHBOARD_PAGES[role] || null;
  }

  return PAGE_REGISTRY[routeName] || null;
}

function normalizeRoute(hash) {
  const route = hash.replace('#', '').trim().toLowerCase() || 'dashboard';
  return route === 'users' ? 'members' : route;
}

function getActiveContext(initialContext) {
  const hydratedContext = getAppContext();
  return hydratedContext.isAuthenticated ? hydratedContext : initialContext;
}

function renderBlockedRoute({ target, route, routeName, role, context }) {
  const fallbackRoute = getDefaultRouteForRole(context);
  target.innerHTML = createBlockedView(route, role);

  if (fallbackRoute && fallbackRoute !== routeName) {
    window.location.replace(`/app.html#${fallbackRoute}`);
  }
}

function createBlockedView(route, role) {
  return `
    <section class="view-header" aria-labelledby="view-title">
      <p class="eyebrow">Access restricted</p>
      <h1 id="view-title">${route?.title || 'Restricted'}</h1>
      <p>Your current role${role ? ` (${role})` : ''} is not allowed to view this section.</p>
    </section>
  `;
}

function syncActiveNavigation(navItems, routeName) {
  navItems.forEach((item) => {
    const active = item.dataset.route === routeName;
    item.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

function redirectToFallbackRoute(role) {
  const fallbackRoute = getDefaultRouteForRole(role) || 'dashboard';
  window.location.replace(`/app.html#${fallbackRoute}`);
}

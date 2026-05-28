import { canAccessRoute, getDefaultRouteForRole, getVisibleRoutes, hasCapability } from './permissions.js';
import { getCurrentUserRole } from './session.js';
import { createAdminDashboardView, initAdminDashboardPage } from '../pages/admin/dashboard.js';
import { createUsersView, initUsersPage } from '../pages/admin/users.js';

const ROUTES = {
  dashboard: {
    title: 'Dashboard',
    description: 'Operational overview for attendance, memberships, and gym activity.'
  },
  members: {
    title: 'Users',
    description: 'Admin tools for profile review, role filters, trainer assignment, and account status.',
    metrics: [
      ['User records', 'Live'],
      ['Trainer assignment', 'Ready'],
      ['RLS policies', 'Supabase']
    ],
    items: [
      ['List all public user profiles', 'Admin'],
      ['Disable inactive accounts', 'Ready'],
      ['Review assigned trainer access', 'Ready']
    ]
  },
  attendance: {
    title: 'Attendance',
    description: 'Shell for future dynamic QR generation, scanning, validation, and logs.',
    metrics: [
      ['QR validity', '7/14/30d'],
      ['Scan queue', 'Future'],
      ['Logs table', 'Ready']
    ],
    items: [
      ['Generate attendance token', 'Admin'],
      ['Scan token from installed PWA', 'Member'],
      ['Validate membership and expiry', 'Supabase']
    ]
  },
  workouts: {
    title: 'Workouts',
    description: 'Trainer and member area for assigned programs and progress tracking.',
    metrics: [
      ['Programs', 'Ready'],
      ['Progress logs', 'Ready'],
      ['Photos', 'Future']
    ],
    items: [
      ['Assign workout plans', 'Trainer'],
      ['Track completion', 'Member'],
      ['Record measurements and notes', 'Future']
    ]
  },
  settings: {
    title: 'Settings',
    description: 'Configuration area for Supabase, tenant settings, roles, and PWA preferences.',
    metrics: [
      ['Supabase client', 'Pending'],
      ['Install mode', 'Enabled'],
      ['Push', 'Future']
    ],
    items: [
      ['Add Supabase URL and anon key', 'Config'],
      ['Enable role-based access control', 'RLS'],
      ['Prepare gym tenant branding', 'SaaS']
    ]
  }
};

export function initRouter({ target, navItems, session, supabaseReady }) {
  if (!target) {
    return;
  }

  let renderRequestId = 0;

  const renderRoute = async () => {
    const requestId = ++renderRequestId;
    const routeName = normalizeRoute(window.location.hash);
    const route = ROUTES[routeName] || ROUTES.dashboard;
    const role = await getCurrentUserRole({ session, forceRefresh: true });

    if (requestId !== renderRequestId) {
      return;
    }

    renderNavigation(navItems, role);

    if (!canAccessRoute(role, routeName)) {
      const fallbackRoute = getDefaultRouteForRole(role);
      target.innerHTML = createBlockedView(route, role);

      if (fallbackRoute && fallbackRoute !== routeName) {
        window.location.replace(`/app.html#${fallbackRoute}`);
      }

      return;
    }

    document.title = `${route.title} | Gym PWA`;
    target.innerHTML = createView(routeName, route, { session, role, supabaseReady });
    target.focus({ preventScroll: true });
    initializeRoute(target, routeName, { session, role });

    navItems.forEach((item) => {
      const active = item.dataset.route === routeName;
      item.setAttribute('aria-current', active ? 'page' : 'false');
    });
  };

  window.addEventListener('hashchange', renderRoute);

  if (!window.location.hash) {
    window.location.hash = '#dashboard';
    return;
  }

  renderRoute();
}

function normalizeRoute(hash) {
  return hash.replace('#', '').trim().toLowerCase() || 'dashboard';
}

function renderNavigation(navItems, role) {
  const visibleRoutes = getVisibleRoutes(role).map((route) => route.name);

  navItems.forEach((item) => {
    const visible = visibleRoutes.includes(item.dataset.route);
    item.hidden = !visible;
  });

  const nav = navItems[0]?.parentElement;
  if (nav) {
    nav.style.setProperty('--nav-count', String(Math.max(visibleRoutes.length, 1)));
  }
}

function createView(routeName, route, state) {
  if (routeName === 'dashboard' && state.role === 'admin') {
    return createAdminDashboardView(state);
  }

  if (routeName === 'members') {
    return createUsersView(state);
  }

  const view = routeName === 'dashboard'
    ? getDashboardView(state.role)
    : route;

  const metrics = view.metrics.map(([label, value]) => `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `).join('');

  const items = view.items.map(([label, status]) => `
    <li>
      <span>${label}</span>
      <span class="status-pill">${status}</span>
    </li>
  `).join('');

  const authStatus = state.session
    ? `Supabase session found${state.role ? ` for ${state.role}` : ''}`
    : 'No Supabase session yet';

  const supabaseStatus = state.supabaseReady
    ? 'Supabase client available'
    : 'Supabase config pending';

  const scope = getScopeDescription(state.role);
  const tokenReadiness = hasCapability(state.role, 'settings:manage')
    ? 'Tenant settings foundation ready'
    : 'Tenant scope supplied by Supabase metadata';

  return `
    <section class="view-header" aria-labelledby="view-title">
      <p class="eyebrow">${supabaseStatus}</p>
      <h1 id="view-title">${view.title}</h1>
      <p>${view.description}</p>
    </section>

    <section class="metrics-grid" aria-label="${view.title} metrics">
      ${metrics}
    </section>

    <section class="panel" aria-labelledby="next-title">
      <div>
        <h2 id="next-title">Module readiness</h2>
        <p>${authStatus}. ${scope}. ${tokenReadiness}.</p>
      </div>
      <ul class="list">
        ${items}
      </ul>
    </section>
  `;
}

function initializeRoute(target, routeName, state) {
  if (routeName === 'dashboard') {
    initAdminDashboardPage({ target, role: state.role, session: state.session });
  }

  if (routeName === 'members') {
    initUsersPage({ target, session: state.session, role: state.role });
  }
}

function createBlockedView(route, role) {
  return `
    <section class="view-header" aria-labelledby="view-title">
      <p class="eyebrow">Access restricted</p>
      <h1 id="view-title">${route.title}</h1>
      <p>Your current role${role ? ` (${role})` : ''} is not allowed to view this section. Role mapping is ready for Supabase policy expansion.</p>
    </section>
  `;
}

function getDashboardView(role) {
  const dashboards = {
    trainer: {
      title: 'Trainer Dashboard',
      description: 'Assigned-member workspace for attendance follow-up, workout assignment, and progress review.',
      metrics: [
        ['Access scope', 'Assigned'],
        ['Member visibility', 'Assigned'],
        ['Settings', 'Restricted']
      ],
      items: [
        ['View assigned member list only', 'Trainer'],
        ['Monitor assigned attendance and workouts', 'Trainer'],
        ['Record progress notes in future phases', 'Trainer']
      ]
    },
    member: {
      title: 'Member Dashboard',
      description: 'Personal gym workspace for membership status, QR attendance scanning, workouts, and progress.',
      metrics: [
        ['Access scope', 'Own'],
        ['Profile visibility', 'Own'],
        ['Settings', 'Restricted']
      ],
      items: [
        ['Scan active gym attendance QR', 'Member'],
        ['View assigned workouts', 'Member'],
        ['Track personal progress in future phases', 'Member']
      ]
    }
  };

  return dashboards[role] || {
    title: 'Dashboard',
    description: 'Your account does not have an assigned role yet. Contact your gym administrator.',
    metrics: [
      ['Role', 'Missing'],
      ['Access', 'Blocked'],
      ['Action', 'Contact admin']
    ],
    items: [
      ['Assign Admin, Trainer, or Member role in Supabase metadata', 'Required']
    ]
  };
}

function getScopeDescription(role) {
  if (role === 'admin') {
    return 'Admin access is designed for full tenant operations';
  }

  if (role === 'trainer') {
    return 'Trainer access is designed for assigned members only';
  }

  if (role === 'member') {
    return 'Member access is designed for the signed-in profile only';
  }

  return 'No role scope has been assigned';
}

import { canAccessRoute, getVisibleRoutes } from './permissions.js';

export const ROUTE_DEFINITIONS = Object.freeze({
  dashboard: {
    title: 'Dashboard',
    description: 'Operational overview for the active gym workspace.'
  },
  members: {
    title: 'Users',
    description: 'Profiles, trainer assignment, and account access for permitted roles.'
  },
  attendance: {
    title: 'Attendance',
    description: 'Attendance workspace prepared for Phase 3 QR scan workflows.'
  },
  workouts: {
    title: 'Workouts',
    description: 'Workout and program workspace prepared for Phase 3 assignments.'
  },
  settings: {
    title: 'Settings',
    description: 'Tenant and platform settings for administrators.'
  }
});

const TOP_NAVIGATION = Object.freeze({
  admin: [
    { label: 'Overview', route: 'dashboard' },
    { label: 'Users', route: 'members' },
    { label: 'Trainers', route: 'members' },
    { label: 'Reports', route: 'dashboard', disabled: true, badge: 'Future' }
  ],
  trainer: [
    { label: 'Dashboard', route: 'dashboard' },
    { label: 'Assigned Members', route: 'members' },
    { label: 'Programs', route: 'workouts' }
  ],
  member: [
    { label: 'Dashboard', route: 'dashboard' },
    { label: 'Attendance', route: 'attendance' },
    { label: 'Workouts', route: 'workouts' },
    { label: 'Progress', route: 'workouts', disabled: true, badge: 'Future' }
  ]
});

export function renderBottomNavigation(navItems, role) {
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

export function createTopSubNavigation({ role, activeRoute }) {
  const items = (TOP_NAVIGATION[role] || [])
    .filter((item) => item.disabled || canAccessRoute(role, item.route));
  let activeAssigned = false;

  if (!items.length) {
    return '';
  }

  return `
    <nav class="top-subnav" aria-label="Dashboard sections">
      ${items.map((item) => {
        const active = item.route === activeRoute && !item.disabled && !activeAssigned;
        activeAssigned = activeAssigned || active;
        const href = item.disabled ? '#' : `#${item.route}`;
        return `
          <a href="${href}"${active ? ' aria-current="page"' : ''}${item.disabled ? ' aria-disabled="true" tabindex="-1"' : ''}>
            <span>${item.label}</span>
            ${item.badge ? `<small>${item.badge}</small>` : ''}
          </a>
        `;
      }).join('')}
    </nav>
  `;
}

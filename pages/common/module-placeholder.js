import {
  createActionList,
  createDashboardSection,
  createDashboardShell,
  createMetricGrid
} from '../../scripts/dashboard-layout.js';

const MODULES = Object.freeze({
  attendance: {
    title: 'Attendance',
    eyebrow: 'Phase 3 scaffold',
    description: 'Attendance navigation, loading, and scoped shell are ready. QR generation and scan validation are intentionally deferred.',
    metrics: [
      { label: 'QR tokens', value: 'Future', detail: 'Admin generation in Phase 3' },
      { label: 'Scan logs', value: 'Future', detail: 'Member scan history in Phase 3' },
      { label: 'Validation', value: 'RLS', detail: 'Database authority remains enforced' }
    ],
    actions: [
      { label: 'Return to dashboard', description: 'Go back to role overview.', href: '#dashboard', badge: 'Open' },
      { label: 'QR attendance', description: 'Token generation and scanning are out of scope for Phase 2.', href: '#attendance', badge: 'Future', state: 'future', disabled: true }
    ]
  },
  workouts: {
    title: 'Workouts',
    eyebrow: 'Program scaffold',
    description: 'Workout navigation and scoped workspace are ready for future trainer programs and member assignments.',
    metrics: [
      { label: 'Programs', value: 'Ready', detail: 'Schema and RLS prepared' },
      { label: 'Assignments', value: 'Future', detail: 'Phase 3 workflow' },
      { label: 'Progress', value: 'Future', detail: 'Member tracking placeholder' }
    ],
    actions: [
      { label: 'Return to dashboard', description: 'Go back to role overview.', href: '#dashboard', badge: 'Open' },
      { label: 'Program builder', description: 'Program creation remains staged for a later phase.', href: '#workouts', badge: 'Future', state: 'future', disabled: true }
    ]
  },
  settings: {
    title: 'Settings',
    eyebrow: 'Admin configuration',
    description: 'Tenant settings shell for deployment, gym configuration, and future platform controls.',
    metrics: [
      { label: 'Tenant context', value: 'Active', detail: 'Loaded from app context' },
      { label: 'RBAC', value: 'Ready', detail: 'Route and action permissions enforced' },
      { label: 'PWA', value: 'Enabled', detail: 'Install and offline shell active' }
    ],
    actions: [
      { label: 'Open users', description: 'Manage roles and account status.', href: '#members', badge: 'Admin' },
      { label: 'Reports', description: 'Operational reports are staged for a later phase.', href: '#settings', badge: 'Future', state: 'future', disabled: true }
    ]
  }
});

export function createModulePlaceholderView({ routeName, supabaseReady }) {
  const module = MODULES[routeName] || MODULES.attendance;

  return createDashboardShell({
    eyebrow: module.eyebrow,
    title: module.title,
    description: module.description,
    status: { text: supabaseReady ? 'Scoped shell loaded.' : 'Supabase configuration pending.', tone: supabaseReady ? 'success' : '' },
    body: `
      ${createMetricGrid(module.metrics, { label: `${module.title} readiness` })}
      ${createDashboardSection({
        title: 'Module Readiness',
        description: 'Navigation and layout are operational while business workflows stay deferred.',
        body: createActionList(module.actions)
      })}
    `
  });
}

export function initModulePlaceholderPage() {}

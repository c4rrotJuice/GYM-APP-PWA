import { loadDashboardBootstrap } from '../../scripts/dashboard-bootstrap.js';
import {
  createDashboardSection,
  createDashboardShell,
  createMetricGrid
} from '../../scripts/dashboard-layout.js';
import {
  createFutureModuleSlots,
  createMemberFutureActions,
  createMemberProfileSurface
} from '../../scripts/role-components.js';

export function createMemberDashboardView({ supabaseReady }) {
  return createDashboardShell({
    eyebrow: supabaseReady ? 'Personal scope' : 'Offline shell',
    title: 'Member Dashboard',
    description: 'Personal profile, membership readiness, attendance status, workouts, and progress placeholders.',
    status: { text: 'Loading member workspace...', busy: true },
    body: `
      <div data-dashboard-root="member" aria-busy="true">
        ${createMetricGrid([
          { label: 'Membership records', value: '...' },
          { label: 'Attendance logs', value: '...' },
          { label: 'Workouts', value: '...' }
        ], { label: 'Member dashboard metrics' })}
      </div>
    `
  });
}

export async function initMemberDashboardPage({ target, appContext }) {
  const root = target?.querySelector('[data-dashboard-root="member"]');
  const status = target?.querySelector('.dashboard-status');

  if (!root) {
    return;
  }

  const { data, error } = await loadDashboardBootstrap({ appContext });

  if (error || !data) {
    setStatus(status, error?.message || 'Unable to load member dashboard.', 'error');
    root.setAttribute('aria-busy', 'false');
    return;
  }

  root.innerHTML = renderMemberDashboard(data);
  root.setAttribute('aria-busy', 'false');
  setStatus(status, 'Member workspace is current.', 'success');
}

function renderMemberDashboard(data) {
  const profile = data.profile || null;

  return `
    ${createMetricGrid([
      { label: 'Membership records', value: data.totals.memberships, detail: 'Status card prepared for Phase 3' },
      { label: 'Attendance logs', value: data.totals.attendanceLogs, detail: 'QR attendance attaches in Phase 3' },
      { label: 'Assigned workouts', value: data.totals.workouts, detail: 'Workout plans will appear here' },
      { label: 'Progress logs', value: data.totals.progressLogs, detail: 'Progress tracking scaffold' }
    ], { label: 'Member dashboard metrics' })}

    <div class="dashboard-grid dashboard-grid-wide">
      ${createDashboardSection({
        title: 'Operational Profile',
        description: 'Profile, account status, trainer assignment, and session-safe member identity.',
        body: createMemberProfileSurface({
          profile,
          trainerAssignment: data.trainerAssignment
        })
      })}
      ${createDashboardSection({
        title: 'Member Operations',
        description: 'Action slots are wired to the current navigation while business logic stays deferred.',
        body: createMemberFutureActions()
      })}
    </div>

    ${createDashboardSection({
      title: 'Future Module Slots',
      description: 'Stable insertion points for memberships, attendance, workouts, progress, and notifications.',
      body: createFutureModuleSlots()
    })}
  `;
}

function setStatus(target, text, tone) {
  if (!target) {
    return;
  }

  target.textContent = text;
  target.setAttribute('aria-busy', 'false');
  target.dataset.tone = tone;
}

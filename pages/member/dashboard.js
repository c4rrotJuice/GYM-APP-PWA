import { loadDashboardBootstrap } from '../../scripts/dashboard-bootstrap.js';
import {
  createActionList,
  createDashboardSection,
  createDashboardShell,
  createKeyValueList,
  createMetricGrid,
  formatDate
} from '../../scripts/dashboard-layout.js';

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
  const profile = data.profile || {};

  return `
    ${createMetricGrid([
      { label: 'Membership records', value: data.totals.memberships, detail: 'Status card prepared for Phase 3' },
      { label: 'Attendance logs', value: data.totals.attendanceLogs, detail: 'QR attendance attaches in Phase 3' },
      { label: 'Assigned workouts', value: data.totals.workouts, detail: 'Workout plans will appear here' },
      { label: 'Progress logs', value: data.totals.progressLogs, detail: 'Progress tracking scaffold' }
    ], { label: 'Member dashboard metrics' })}

    <div class="dashboard-grid dashboard-grid-wide">
      ${createDashboardSection({
        title: 'Profile Overview',
        description: 'Profile data from the authenticated app context.',
        body: createKeyValueList([
          ['Name', profile.fullname || 'Not set'],
          ['Email', profile.email || 'Not set'],
          ['Phone', profile.phone || 'Not set'],
          ['Account status', profile.account_status || 'Not set'],
          ['Joined', formatDate(profile.created_at)]
        ])
      })}
      ${createDashboardSection({
        title: 'Membership Placeholder',
        description: 'Membership state, type, expiry, and payment checks are intentionally deferred.',
        body: createActionList([
          { label: 'Membership status', description: 'Current plan and expiry badge will appear here.', href: '#dashboard', badge: 'Phase 3', state: 'future', disabled: true },
          { label: 'Payment state', description: 'Payment and renewal workflows are not implemented in Phase 2.', href: '#dashboard', badge: 'Future', state: 'future', disabled: true }
        ])
      })}
    </div>

    <div class="dashboard-grid">
      ${createDashboardSection({
        title: 'Attendance Status',
        description: 'QR scan state and latest attendance outcome are reserved for Phase 3.',
        body: createActionList([
          { label: 'Open attendance', description: 'Attendance shell is available now.', href: '#attendance', badge: 'Open' }
        ])
      })}
      ${createDashboardSection({
        title: 'Workout Placeholder',
        description: 'Assigned programs and completion status will load from the workouts module.',
        body: createActionList([
          { label: 'Open workouts', description: 'Workout shell is available now.', href: '#workouts', badge: 'Open' }
        ])
      })}
      ${createDashboardSection({
        title: 'Progress Placeholder',
        description: 'Measurements, notes, and progress events are staged for a later phase.',
        body: createActionList([
          { label: 'Progress timeline', description: 'Progress records will attach here.', href: '#workouts', badge: 'Future', state: 'future', disabled: true }
        ])
      })}
    </div>
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

import { loadDashboardBootstrap } from '../../scripts/dashboard-bootstrap.js';
import {
  createActionList,
  createCompactList,
  createDashboardSection,
  createDashboardShell,
  createEmptyState,
  createKeyValueList,
  createMetricGrid,
  formatDate
} from '../../scripts/dashboard-layout.js';

export function createAdminDashboardView({ supabaseReady }) {
  return createDashboardShell({
    eyebrow: supabaseReady ? 'Supabase live' : 'Supabase unavailable',
    title: 'Admin Dashboard',
    description: 'Tenant operations, people, membership readiness, and gym-level health in one workspace.',
    status: { text: 'Loading dashboard overview...', busy: true },
    body: `
      <div data-dashboard-root="admin" aria-busy="true">
        ${createMetricGrid(getLoadingMetrics(), { label: 'Admin dashboard metrics' })}
        <div class="dashboard-grid dashboard-grid-wide">
          ${createDashboardSection({
            title: 'Quick Actions',
            description: 'Common operational entry points for this gym.',
            body: createActionList([
              { label: 'Create user', description: 'Add an admin, trainer, or member profile.', href: '#members', badge: 'Admin' },
              { label: 'Assign trainers', description: 'Review member trainer assignment.', href: '#members', badge: 'Ready' },
              { label: 'Membership workflow', description: 'Assign, renew, suspend, reactivate, and review history.', href: '#memberships', badge: 'Live' }
            ])
          })}
          ${createDashboardSection({
            title: 'Gym Snapshot',
            description: 'Tenant and profile state for the active session.',
            body: createEmptyState('Snapshot loading', 'Gym status will appear after the dashboard bootstrap finishes.')
          })}
        </div>
      </div>
    `
  });
}

export async function initAdminDashboardPage({ target, appContext }) {
  const root = target?.querySelector('[data-dashboard-root="admin"]');
  const status = target?.querySelector('.dashboard-status');

  if (!root) {
    return;
  }

  const { data, error } = await loadDashboardBootstrap({ appContext });

  if (error || !data) {
    setStatus(status, error?.message || 'Unable to load the admin dashboard.', 'error');
    root.setAttribute('aria-busy', 'false');
    return;
  }

  root.innerHTML = renderAdminDashboard(data);
  root.setAttribute('aria-busy', 'false');
  setStatus(status, 'Dashboard overview is current.', 'success');
}

function renderAdminDashboard(data) {
  const users = data.users || [];
  const recentUsers = users.slice(0, 5).map((user) => ({
    title: user.fullname || user.email || 'Unnamed user',
    description: `${roleLabel(user.role)} - ${user.email || 'No email'} - updated ${formatDate(user.updated_at)}`,
    badge: statusLabel(user.account_status),
    state: user.account_status === 'active' ? 'active' : 'inactive'
  }));

  return `
    ${createMetricGrid([
      { label: 'Total users', value: data.totals.totalUsers, detail: 'Profiles in this gym' },
      { label: 'Members', value: data.totals.totalMembers, detail: 'Member accounts' },
      { label: 'Trainers', value: data.totals.totalTrainers, detail: 'Trainer accounts' },
      { label: 'Active memberships', value: data.totals.activeMemberships, detail: 'Currently active records' },
      { label: 'Expiring soon', value: data.totals.expiringSoon, detail: 'Ending within 7 days' }
    ], { label: 'Admin dashboard metrics' })}

    <div class="dashboard-grid dashboard-grid-wide">
      ${createDashboardSection({
        title: 'Quick Actions',
        description: 'Common operational entry points for this gym.',
        body: createActionList([
          { label: 'Create user', description: 'Add an admin, trainer, or member profile.', href: '#members', badge: 'Admin' },
          { label: 'Manage member access', description: 'Update status, role, and trainer assignment.', href: '#members', badge: 'Ready' },
          { label: 'Manage memberships', description: 'Assign plans, renew members, and control suspension state.', href: '#memberships', badge: 'Live' }
        ])
      })}
      ${createDashboardSection({
        title: 'Gym Snapshot',
        description: 'Active tenant state from the canonical app context.',
        body: createKeyValueList([
          ['Gym ID', data.gym.gymId || 'Not assigned'],
          ['Active users', String(data.gym.activeUsers)],
          ['Inactive users', String(data.gym.inactiveUsers)],
          ['Signed in as', data.gym.currentUser]
        ])
      })}
    </div>

    ${createDashboardSection({
      title: 'Membership Expiry Watch',
      description: 'Active memberships ending within the next 7 days.',
      body: createCompactList((data.memberships?.expiringSoon || []).slice(0, 5).map((membership) => ({
        title: membership.type || 'Membership',
        description: `Ends ${formatDate(membership.end_date)} - ${membership.days_remaining} days remaining`,
        badge: 'Expiring',
        state: 'future'
      })), {
        emptyTitle: 'No urgent expiries',
        emptyDescription: 'No active memberships are inside the 7-day expiry window.'
      })
    })}

    ${createDashboardSection({
      title: 'Recent User Statistics',
      description: users.length ? 'Newest visible profile activity from the user directory.' : 'No visible users are available yet.',
      body: createCompactList(recentUsers, {
        emptyTitle: 'No users found',
        emptyDescription: 'Create profiles from the Users section to populate this view.'
      })
    })}
  `;
}

function getLoadingMetrics() {
  return [
    { label: 'Total users', value: '...' },
    { label: 'Members', value: '...' },
    { label: 'Trainers', value: '...' },
    { label: 'Active memberships', value: '...' },
    { label: 'Expiring soon', value: '...' }
  ];
}

function setStatus(target, text, tone) {
  if (!target) {
    return;
  }

  target.textContent = text;
  target.setAttribute('aria-busy', 'false');
  target.dataset.tone = tone;
}

function roleLabel(role) {
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Unassigned';
}

function statusLabel(status) {
  return status === 'active' ? 'Active' : 'Needs review';
}

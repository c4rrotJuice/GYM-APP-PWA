import { loadDashboardBootstrap } from '../../scripts/dashboard-bootstrap.js';
import {
  getActiveMembersMetric,
  getAttendanceSnapshot,
  getInactiveMembersMetric,
  getRevenueSnapshot
} from '../../services/analytics.js';
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
        ${createAdminAnalyticsWidgets('loading')}
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

  const analyticsPromise = loadAdminAnalyticsMetrics({ appContext });
  const { data, error } = await loadDashboardBootstrap({ appContext });

  if (error || !data) {
    const analyticsResult = await analyticsPromise;

    root.innerHTML = createAdminAnalyticsWidgets(analyticsResult);
    setStatus(status, error?.message || 'Unable to load the admin dashboard.', 'error');
    root.setAttribute('aria-busy', 'false');
    return;
  }

  root.innerHTML = renderAdminDashboard(data);
  root.setAttribute('aria-busy', 'false');
  setStatus(status, 'Dashboard overview is current.', 'success');
  renderAdminAnalyticsWidgets(root, await analyticsPromise);
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
    ${createAdminAnalyticsWidgets('loading')}

    ${createMetricGrid([
      { label: 'Total users', value: data.totals.totalUsers, detail: 'Profiles in this gym' },
      { label: 'Members', value: data.totals.totalMembers, detail: 'Member accounts' },
      { label: 'Trainers', value: data.totals.totalTrainers, detail: 'Trainer accounts' },
      { label: 'Active memberships', value: data.totals.activeMemberships, detail: 'Recalculated server state', state: 'active' },
      { label: 'Attendance ready', value: data.totals.attendanceReady, detail: 'Eligible to check in today', state: 'active' },
      { label: 'Total revenue', value: formatMoney(data.totals.totalRevenue), detail: 'Completed payments' },
      { label: 'Monthly revenue', value: formatMoney(data.totals.monthlyRevenue), detail: 'Completed this month' },
      { label: 'Pending balances', value: formatMoney(data.totals.pendingBalances), detail: 'Outstanding or pending records', state: data.totals.pendingBalances > 0 ? 'warning' : 'active' },
      { label: 'Expiring soon', value: data.totals.expiringSoon, detail: 'Ending within 7 days', state: data.totals.expiringSoon > 0 ? 'warning' : 'active' },
      { label: 'Expired', value: data.totals.expiredMemberships, detail: 'Historical access blocked', state: data.totals.expiredMemberships > 0 ? 'inactive' : 'active' },
      { label: 'Notification hooks', value: data.totals.notificationTriggersPrepared, detail: 'Prepared, not delivered', state: data.totals.notificationTriggersPrepared > 0 ? 'future' : '' }
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
      title: 'Recent Transactions',
      description: 'Latest tenant payment records for audit review.',
      body: createCompactList((data.financial?.recentTransactions || []).slice(0, 5).map((payment) => ({
        title: formatMoney(payment.amount),
        description: `${payment.member?.fullname || payment.member?.email || 'Member'} - ${payment.method || 'cash'} - ${formatDate(payment.created_at)}`,
        badge: payment.status,
        state: payment.status === 'completed' ? 'active' : payment.status === 'pending' ? 'future' : 'inactive'
      })), {
        emptyTitle: 'No payments recorded',
        emptyDescription: 'Use Memberships to record the first payment.'
      })
    })}

    ${createDashboardSection({
      title: 'Membership Expiry Watch',
      description: 'Server-recalculated membership access, renewal prompts, and notification hook readiness.',
      body: createCompactList((data.memberships?.expiringSoon || []).slice(0, 5).map((membership) => ({
        title: membership.type || 'Membership',
        description: `Renew before ${formatDate(membership.end_date)} - ${membership.days_remaining} days remaining`,
        badge: membership.days_remaining <= 1 ? 'Renew now' : 'Expiring',
        state: membership.days_remaining <= 1 ? 'warning' : 'future'
      })), {
        emptyTitle: 'No urgent expiries',
        emptyDescription: 'No active memberships are inside the 7-day expiry window.'
      })
    })}

    ${createDashboardSection({
      title: 'Expiry Operations',
      description: 'Operational authority used by attendance validation and future reminders.',
      body: createKeyValueList([
        ['Active after recalculation', data.totals.activeMemberships],
        ['Attendance-ready members', data.totals.attendanceReady],
        ['Suspended excluded', data.totals.suspendedMemberships],
        ['Prepared notification triggers', data.totals.notificationTriggersPrepared]
      ])
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

async function loadAdminAnalyticsMetrics({ appContext } = {}) {
  const definitions = [
    {
      key: 'activeMembers',
      label: 'Active Members',
      state: 'active',
      previousLabel: 'Yesterday',
      load: () => getActiveMembersMetric({ appContext })
    },
    {
      key: 'revenue',
      label: 'Revenue Snapshot',
      state: '',
      previousLabel: 'Yesterday',
      format: formatMoney,
      load: () => getRevenueSnapshot({ appContext })
    },
    {
      key: 'attendance',
      label: 'Attendance Count',
      state: 'active',
      previousLabel: 'Yesterday',
      load: () => getAttendanceSnapshot({ appContext })
    },
    {
      key: 'inactiveMembers',
      label: 'Inactive Members',
      state: 'inactive',
      previousLabel: 'Yesterday',
      load: () => getInactiveMembersMetric({ appContext })
    }
  ];

  const results = await Promise.allSettled(definitions.map((definition) => definition.load()));
  const metrics = definitions.map((definition, index) => {
    const result = results[index];

    if (result.status === 'rejected') {
      return {
        label: definition.label,
        value: 'Error',
        detail: result.reason?.message || 'Unable to load this metric.',
        state: 'warning'
      };
    }

    return createAnalyticsMetricCard(definition, result.value);
  });

  return {
    metrics,
    hasError: results.some((result) => result.status === 'rejected')
  };
}

function renderAdminAnalyticsWidgets(root, analyticsResult) {
  const target = root?.querySelector('[data-admin-analytics-widgets]');

  if (!target) {
    return;
  }

  target.outerHTML = createAdminAnalyticsWidgets(analyticsResult);
}

function createAdminAnalyticsWidgets(result = 'loading') {
  if (result === 'loading') {
    return `
      <div data-admin-analytics-widgets aria-busy="true">
        ${createMetricGrid([
          { label: 'Active Members', value: '...', detail: 'Loading analytics' },
          { label: 'Revenue Snapshot', value: '...', detail: 'Loading analytics' },
          { label: 'Attendance Count', value: '...', detail: 'Loading analytics' },
          { label: 'Inactive Members', value: '...', detail: 'Loading analytics' }
        ], { label: 'Admin analytics metrics' })}
      </div>
    `;
  }

  if (!result?.metrics?.length) {
    return `
      <div data-admin-analytics-widgets aria-busy="false">
        ${createDashboardSection({
          title: 'Analytics Metrics',
          description: 'Dashboard analytics service output.',
          empty: true,
          body: createEmptyState('No analytics available', 'Daily statistics will appear after analytics data is available.')
        })}
      </div>
    `;
  }

  return `
    <div data-admin-analytics-widgets aria-busy="false">
      ${createMetricGrid(result.metrics, { label: result.hasError ? 'Admin analytics metrics with errors' : 'Admin analytics metrics' })}
    </div>
  `;
}

function createAnalyticsMetricCard(definition, metric = {}) {
  const value = Number(metric.value || 0);
  const previousValue = Number(metric.previousValue || 0);
  const trend = Number(metric.trend || 0);
  const formatter = definition.format || formatPlainNumber;

  return {
    label: definition.label,
    value: formatter(value),
    detail: `${formatTrend(trend, formatter)} - ${definition.previousLabel}: ${formatter(previousValue)}`,
    state: getMetricState(definition.state, trend)
  };
}

function getMetricState(defaultState, trend) {
  if (trend > 0) {
    return defaultState || 'active';
  }

  if (trend < 0) {
    return 'warning';
  }

  return defaultState || '';
}

function formatTrend(value, formatter = formatPlainNumber) {
  if (value > 0) {
    return `Up ${formatter(value)}`;
  }

  if (value < 0) {
    return `Down ${formatter(Math.abs(value))}`;
  }

  return 'No change';
}

function getLoadingMetrics() {
  return [
    { label: 'Total users', value: '...' },
    { label: 'Members', value: '...' },
    { label: 'Trainers', value: '...' },
    { label: 'Active memberships', value: '...' },
    { label: 'Attendance ready', value: '...' },
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

function formatMoney(value) {
  if (value === null || value === undefined) {
    return '...';
  }

  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function formatPlainNumber(value) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2
  });
}

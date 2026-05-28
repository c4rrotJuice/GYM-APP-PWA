import { countActiveMemberships } from '../../scripts/memberships.js';
import { listUsers } from '../../scripts/profiles.js';

const METRICS = [
  ['totalUsers', 'Total users'],
  ['totalMembers', 'Total members'],
  ['totalTrainers', 'Total trainers'],
  ['activeMemberships', 'Active memberships']
];

export function createAdminDashboardView({ role, supabaseReady }) {
  if (role !== 'admin') {
    return null;
  }

  const cards = METRICS.map(([key, label]) => `
    <article class="metric-card" data-dashboard-card="${key}">
      <span>${label}</span>
      <strong data-dashboard-metric="${key}">...</strong>
    </article>
  `).join('');

  return `
    <section class="view-header" aria-labelledby="dashboard-title">
      <p class="eyebrow">${supabaseReady ? 'Supabase live' : 'Supabase unavailable'}</p>
      <h1 id="dashboard-title">Admin Dashboard</h1>
      <p>Live user and membership totals from the gym database.</p>
    </section>

    <section class="metrics-grid" aria-label="Admin dashboard metrics" data-admin-dashboard>
      ${cards}
    </section>

    <section class="panel" aria-labelledby="dashboard-status-title">
      <div>
        <h2 id="dashboard-status-title">Dashboard status</h2>
        <p data-dashboard-message role="status" aria-live="polite">Loading dashboard metrics...</p>
      </div>
    </section>
  `;
}

export async function initAdminDashboardPage({ target, role, session }) {
  const root = target?.querySelector('[data-admin-dashboard]');
  if (!root || role !== 'admin') {
    return;
  }

  const message = target.querySelector('[data-dashboard-message]');
  setDashboardMessage(message, 'Loading dashboard metrics...', '');

  const [usersResult, membershipsResult] = await Promise.all([
    listUsers({ session }),
    countActiveMemberships({ session })
  ]);

  if (usersResult.error || membershipsResult.error) {
    renderDashboardMetrics(root, {
      totalUsers: null,
      totalMembers: null,
      totalTrainers: null,
      activeMemberships: null
    });

    setDashboardMessage(
      message,
      usersResult.error?.message || membershipsResult.error?.message || 'Unable to load dashboard metrics.',
      'error'
    );
    return;
  }

  const users = usersResult.users || [];
  renderDashboardMetrics(root, {
    totalUsers: users.length,
    totalMembers: users.filter((user) => user.role === 'member').length,
    totalTrainers: users.filter((user) => user.role === 'trainer').length,
    activeMemberships: membershipsResult.count
  });

  setDashboardMessage(message, 'Dashboard metrics are current.', 'success');
}

function renderDashboardMetrics(root, metrics) {
  Object.entries(metrics).forEach(([key, value]) => {
    const target = root.querySelector(`[data-dashboard-metric="${key}"]`);
    if (target) {
      target.textContent = Number.isFinite(value) ? String(value) : '--';
    }
  });
}

function setDashboardMessage(target, text, tone) {
  if (!target) {
    return;
  }

  target.textContent = text;
  if (tone) {
    target.dataset.tone = tone;
  } else {
    delete target.dataset.tone;
  }
}

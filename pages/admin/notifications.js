import {
  listFailedNotifications,
  listQueuedNotifications
} from '../../services/notificationService.js';
import {
  createDashboardShell,
  formatDate
} from '../../scripts/dashboard-layout.js';

export function createAdminNotificationsView({ supabaseReady }) {
  return createDashboardShell({
    eyebrow: supabaseReady ? 'Supabase live' : 'Supabase unavailable',
    title: 'Notifications',
    description: 'Queued and failed notification dispatch records.',
    status: { text: 'Loading notifications...', busy: true },
    body: `
      <section class="panel user-admin-panel" data-admin-notifications aria-busy="true">
        <div class="user-admin-toolbar">
          <div>
            <h2>Notification Queue</h2>
            <p>Pending dispatch and failed notification attempts.</p>
          </div>
          <button class="button button-secondary" type="button" data-refresh-notifications>Refresh</button>
        </div>
        <div class="auth-message" data-notifications-message role="status" aria-live="polite">Loading notification queue...</div>
        <div data-notification-queue></div>
        <div data-notification-failures></div>
      </section>
    `
  });
}

export async function initAdminNotificationsPage({ target }) {
  const root = target?.querySelector('[data-admin-notifications]');
  const status = target?.querySelector('.dashboard-status');

  if (!root) {
    return;
  }

  root.addEventListener('click', async (event) => {
    if (event.target.closest('[data-refresh-notifications]')) {
      await renderNotifications(root, status);
    }
  });

  await renderNotifications(root, status);
}

async function renderNotifications(root, status) {
  const message = root.querySelector('[data-notifications-message]');
  const queue = root.querySelector('[data-notification-queue]');
  const failures = root.querySelector('[data-notification-failures]');

  root.setAttribute('aria-busy', 'true');
  setMessage(message, 'Loading notification queue...', '');
  setStatus(status, 'Loading notifications...', '');

  const [queuedResult, failedResult] = await Promise.all([
    listQueuedNotifications({ limit: 50 }),
    listFailedNotifications({ limit: 50 })
  ]);

  queue.innerHTML = renderNotificationTable('Queued Notifications', queuedResult.notifications, {
    empty: 'No queued notifications.'
  });
  failures.innerHTML = renderNotificationTable('Failed Notifications', failedResult.notifications, {
    empty: 'No failed notifications.',
    showError: true
  });

  const error = queuedResult.error || failedResult.error;
  if (error) {
    setMessage(message, error.message || 'Unable to load notifications.', 'error');
    setStatus(status, 'Notification visibility failed.', 'error');
  } else {
    setMessage(message, `${queuedResult.notifications.length} queued, ${failedResult.notifications.length} failed.`, 'success');
    setStatus(status, 'Notifications loaded.', 'success');
  }

  root.setAttribute('aria-busy', 'false');
}

function renderNotificationTable(title, notifications = [], { empty, showError = false } = {}) {
  return `
    <div class="notification-queue-section">
      <h2>${escapeHtml(title)}</h2>
      ${notifications.length ? `
        <div class="user-table-wrap">
          <table class="user-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Created</th>
                <th>${showError ? 'Last Error' : 'Recipient'}</th>
              </tr>
            </thead>
            <tbody>
              ${notifications.map((notification) => `
                <tr>
                  <td>${escapeHtml(notification.type)}</td>
                  <td><span class="status-pill" data-state="${notification.status === 'failed' ? 'inactive' : 'future'}">${escapeHtml(notification.status)}</span></td>
                  <td>${escapeHtml(notification.attempt_count)}</td>
                  <td>${escapeHtml(formatDate(notification.created_at))}</td>
                  <td>${escapeHtml(showError ? notification.last_error || 'No error recorded' : notification.recipient_user_id)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `<p>${escapeHtml(empty)}</p>`}
    </div>
  `;
}

function setMessage(element, text, tone) {
  if (!element) {
    return;
  }

  element.textContent = text;
  element.dataset.tone = tone;
}

function setStatus(element, text, tone) {
  if (!element) {
    return;
  }

  element.textContent = text;
  element.dataset.tone = tone;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

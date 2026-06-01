import { getAttendanceHistorySummary } from '../../scripts/attendance-service.js';
import {
  createDashboardShell,
  createEmptyState,
  escapeHtml,
  formatDate
} from '../../scripts/dashboard-layout.js';

const SEARCH_DEBOUNCE_MS = 260;

export function createAttendanceHistoryView({ supabaseReady, role }) {
  const title = role === 'member' ? 'Attendance History' : role === 'trainer' ? 'Assigned Attendance' : 'Attendance History';
  const description = role === 'member'
    ? 'Today status, recent check-ins, and current streak.'
    : role === 'trainer'
      ? 'Read-only attendance history for assigned members.'
      : 'Read-only attendance history for gym members.';

  return createDashboardShell({
    eyebrow: supabaseReady ? getEyebrow(role) : 'Supabase unavailable',
    title,
    description,
    status: { text: 'Loading attendance history...', busy: true },
    body: `
      <section class="panel attendance-history-panel" data-attendance-history aria-busy="true">
        ${role === 'member' ? '' : `
          <form class="directory-search" data-attendance-history-search-form role="search">
            <div class="field-group">
              <label for="attendance-history-search">Search members</label>
              <input id="attendance-history-search" name="search" type="search" autocomplete="off" placeholder="Name, email, or phone" data-attendance-history-search>
            </div>
          </form>
        `}

        <div class="auth-message" data-attendance-history-message role="status" aria-live="polite">Loading attendance history...</div>
        <div data-attendance-history-body>
          ${renderSkeleton()}
        </div>
      </section>
    `
  });
}

export async function initAttendanceHistoryPage({ target, appContext }) {
  const root = target?.querySelector('[data-attendance-history]');

  if (!root) {
    return;
  }

  const state = {
    appContext,
    search: '',
    searchTimer: null
  };

  root.addEventListener('submit', (event) => event.preventDefault());
  root.addEventListener('input', (event) => {
    const search = event.target.closest('[data-attendance-history-search]');

    if (!search) {
      return;
    }

    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      state.search = search.value.trim();
      void loadAttendanceHistory(root, state);
    }, SEARCH_DEBOUNCE_MS);
  });

  await loadAttendanceHistory(root, state);
}

async function loadAttendanceHistory(root, state) {
  const body = root.querySelector('[data-attendance-history-body]');
  const status = getScopedStatus(root);
  setBusy(root, true);
  setMessage(root, 'Loading attendance history...', '');

  const { summary, members, logs, error } = await getAttendanceHistorySummary({
    appContext: state.appContext,
    search: state.search
  });

  if (error) {
    body.innerHTML = createEmptyState('Attendance unavailable', error.message || 'Unable to load attendance history.');
    setMessage(root, error.message || 'Unable to load attendance history.', 'error');
    setStatus(status, 'Attendance history unavailable.', 'error');
    setBusy(root, false);
    return;
  }

  if (state.appContext?.role === 'member') {
    body.innerHTML = renderMemberHistory(summary, logs);
    setMessage(root, 'Attendance history loaded.', 'success');
    setStatus(status, 'Attendance history is current.', 'success');
  } else {
    body.innerHTML = renderStaffHistory(members, logs, state.appContext?.role);
    setMessage(root, `${logs.length} recent attendance ${logs.length === 1 ? 'record' : 'records'} shown.`, 'success');
    setStatus(status, 'Attendance history is current.', 'success');
  }

  setBusy(root, false);
}

function renderMemberHistory(summary, logs) {
  const safeSummary = summary || {
    todayStatus: 'absent',
    lastLog: null,
    recentLogs: [],
    currentStreak: 0
  };

  return `
    <div class="attendance-history-metrics">
      ${renderMetric('Today', safeSummary.todayStatus === 'present' ? 'Present' : 'Not marked', safeSummary.todayLog ? formatDate(safeSummary.todayLog.attended_at || safeSummary.todayLog.attendance_date) : 'No attendance today', safeSummary.todayStatus === 'present' ? 'active' : 'warning')}
      ${renderMetric('Last Attendance', safeSummary.lastLog ? formatDate(safeSummary.lastLog.attended_at || safeSummary.lastLog.attendance_date) : 'None', safeSummary.lastLog ? formatSource(safeSummary.lastLog.source) : 'No attendance recorded', safeSummary.lastLog ? 'active' : 'inactive')}
      ${renderMetric('Current Streak', String(safeSummary.currentStreak), safeSummary.currentStreak === 1 ? 'day' : 'days', safeSummary.currentStreak > 0 ? 'active' : 'inactive')}
    </div>
    ${renderRecentLogs(logs, { showMember: false })}
  `;
}

function renderStaffHistory(members, logs, role) {
  return `
    <div class="attendance-history-members">
      ${(members || []).length ? members.map(renderMemberSummary).join('') : createEmptyState(
        role === 'trainer' ? 'No assigned member attendance' : 'No member attendance',
        'Attendance records will appear here after members check in.'
      )}
    </div>
    ${renderRecentLogs(logs, { showMember: true })}
  `;
}

function renderMemberSummary(summary) {
  const member = summary.member || {};
  const attendedToday = summary.todayStatus === 'present';

  return `
    <article class="attendance-member-summary">
      <div>
        <strong>${escapeHtml(member.fullname || 'Unnamed member')}</strong>
        <span>${escapeHtml([member.email, member.phone].filter(Boolean).join(' | ') || 'No contact recorded')}</span>
      </div>
      <div class="attendance-member-stats">
        <span class="status-pill" data-state="${attendedToday ? 'active' : 'warning'}">${attendedToday ? 'Today: present' : 'Today: not marked'}</span>
        <span>${escapeHtml(summary.lastLog ? formatDate(summary.lastLog.attended_at || summary.lastLog.attendance_date) : 'No attendance')}</span>
        <span>${escapeHtml(String(summary.currentStreak))} day streak</span>
      </div>
    </article>
  `;
}

function renderRecentLogs(logs, { showMember }) {
  const records = logs || [];

  if (!records.length) {
    return createEmptyState('No recent attendance', 'Attendance records will appear here after check-ins are recorded.');
  }

  return `
    <div class="attendance-history-list">
      <h2>Recent Attendance</h2>
      <ul>
        ${records.map((log) => `
          <li>
            <span>
              <strong>${escapeHtml(showMember ? log.member?.fullname || 'Member' : formatDate(log.attended_at || log.attendance_date))}</strong>
              <small>${escapeHtml(showMember ? formatDate(log.attended_at || log.attendance_date) : formatSource(log.source))}</small>
            </span>
            <span class="status-pill" data-state="active">${escapeHtml(formatSource(log.source))}</span>
          </li>
        `).join('')}
      </ul>
    </div>
  `;
}

function renderMetric(label, value, detail, state) {
  return `
    <article class="metric-card" data-state="${escapeHtml(state || '')}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

function renderSkeleton() {
  return `
    <div class="attendance-history-members" aria-hidden="true">
      ${Array.from({ length: 3 }, () => `
        <article class="attendance-member-summary user-card-loading">
          <div>
            <div class="skeleton-line skeleton-line-wide"></div>
            <div class="skeleton-line"></div>
          </div>
          <div class="skeleton-line skeleton-line-short"></div>
        </article>
      `).join('')}
    </div>
  `;
}

function getEyebrow(role) {
  if (role === 'member') {
    return 'Member attendance';
  }

  if (role === 'trainer') {
    return 'Trainer attendance';
  }

  return 'Admin attendance';
}

function formatSource(source) {
  const labels = {
    qr: 'QR scan',
    qr_scan: 'QR scan',
    admin_manual: 'Admin manual',
    trainer_manual: 'Trainer manual'
  };

  return labels[source] || 'Attendance';
}

function getScopedStatus(root) {
  return root.closest('.dashboard-shell')?.querySelector('.dashboard-status') || null;
}

function setBusy(root, busy) {
  root.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function setStatus(target, text, tone) {
  if (!target) {
    return;
  }

  target.textContent = text;
  target.setAttribute('aria-busy', 'false');
  target.dataset.tone = tone || '';
}

function setMessage(root, text, tone) {
  const message = root.querySelector('[data-attendance-history-message]');

  if (!message) {
    return;
  }

  message.textContent = text;
  if (tone) {
    message.dataset.tone = tone;
  } else {
    delete message.dataset.tone;
  }
}

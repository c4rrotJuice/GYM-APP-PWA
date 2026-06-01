import {
  recordManualAttendance,
  searchManualAttendanceMembers
} from '../../scripts/attendance-service.js';
import { createDashboardShell, createEmptyState, escapeHtml, formatDate } from '../../scripts/dashboard-layout.js';

const SEARCH_DEBOUNCE_MS = 260;

export function createManualAttendanceView({ supabaseReady, role }) {
  const isTrainer = role === 'trainer';

  return createDashboardShell({
    eyebrow: supabaseReady ? (isTrainer ? 'Trainer attendance' : 'Admin attendance') : 'Supabase unavailable',
    title: 'Manual Attendance',
    description: isTrainer
      ? 'Search assigned members and record today attendance.'
      : 'Search gym members and record today attendance.',
    status: { text: 'Loading members...', busy: true },
    body: `
      <section class="panel manual-attendance-panel" data-manual-attendance aria-busy="true">
        <div class="user-admin-toolbar">
          <div>
            <h2>Member Search</h2>
            <p data-manual-attendance-summary>Loading attendance status...</p>
          </div>
        </div>

        <form class="directory-search" data-manual-attendance-search-form role="search">
          <div class="field-group">
            <label for="manual-attendance-search">Search members</label>
            <input id="manual-attendance-search" name="search" type="search" autocomplete="off" placeholder="Name, email, or phone" data-manual-attendance-search>
          </div>
        </form>

        <div class="auth-message" data-manual-attendance-message role="status" aria-live="polite">Loading members...</div>
        <div class="manual-attendance-list" data-manual-attendance-list aria-busy="true">
          ${renderSkeletonRows()}
        </div>
      </section>
    `
  });
}

export async function initManualAttendancePage({ target, appContext }) {
  const root = target?.querySelector('[data-manual-attendance]');

  if (!root) {
    return;
  }

  const status = root.closest('.dashboard-shell')?.querySelector('.dashboard-status') || null;

  const state = {
    appContext,
    search: '',
    searchTimer: null,
    pendingMemberId: null
  };

  root.addEventListener('submit', (event) => event.preventDefault());
  root.addEventListener('input', (event) => {
    const search = event.target.closest('[data-manual-attendance-search]');

    if (!search) {
      return;
    }

    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      state.search = search.value.trim();
      void loadManualAttendanceMembers(root, status, state);
    }, SEARCH_DEBOUNCE_MS);
  });

  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-manual-attendance-action="log"]');

    if (!button || button.disabled) {
      return;
    }

    await logManualAttendance(root, status, state, button.dataset.memberId);
  });

  await loadManualAttendanceMembers(root, status, state);
}

async function loadManualAttendanceMembers(root, status, state) {
  const list = root.querySelector('[data-manual-attendance-list]');
  setBusy(root, true);
  setMessage(root, 'Loading members...', '');

  const { members, error } = await searchManualAttendanceMembers({
    appContext: state.appContext,
    search: state.search
  });

  if (error) {
    list.innerHTML = createEmptyState('Members unavailable', error.message || 'Unable to load members.');
    setMessage(root, error.message || 'Unable to load members.', 'error');
    setStatus(status, 'Manual attendance unavailable.', 'error');
    setBusy(root, false);
    return;
  }

  renderMembers(root, members, state);
  setMessage(root, `${members.length} ${members.length === 1 ? 'member' : 'members'} shown.`, 'success');
  setStatus(status, 'Manual attendance is ready.', 'success');
  setBusy(root, false);
}

async function logManualAttendance(root, status, state, memberId) {
  state.pendingMemberId = memberId;
  renderPendingState(root, memberId);
  setMessage(root, 'Recording attendance...', '');
  setStatus(status, 'Recording manual attendance...', '');

  const result = await recordManualAttendance(memberId, { appContext: state.appContext });

  state.pendingMemberId = null;

  if (!result.success) {
    setMessage(root, result.message || 'Unable to record attendance.', 'error');
    setStatus(status, 'Manual attendance failed.', 'error');
    await loadManualAttendanceMembers(root, status, state);
    return;
  }

  setMessage(root, result.message || 'Attendance recorded.', 'success');
  setStatus(status, 'Attendance recorded for today.', 'success');
  await loadManualAttendanceMembers(root, status, state);
}

function renderMembers(root, members, state) {
  const list = root.querySelector('[data-manual-attendance-list]');
  const summary = root.querySelector('[data-manual-attendance-summary]');

  if (summary) {
    summary.textContent = 'Today indicator prevents duplicate manual entries.';
  }

  if (!members.length) {
    list.innerHTML = createEmptyState(
      state.search ? 'No matching members' : 'No members found',
      state.search ? 'Try a different name, email, or phone search.' : 'Active members will appear here.'
    );
    return;
  }

  list.innerHTML = members.map((member) => renderMemberRow(member, state)).join('');
}

function renderMemberRow(member, state) {
  const attendance = member.attendanceToday;
  const attended = Boolean(attendance);
  const pending = state.pendingMemberId === member.id;

  return `
    <article class="manual-attendance-row">
      <div class="manual-attendance-member">
        <strong>${escapeHtml(member.fullname || 'Unnamed member')}</strong>
        <span>${escapeHtml([member.email, member.phone].filter(Boolean).join(' | ') || 'No contact recorded')}</span>
      </div>
      <div class="manual-attendance-state">
        <span class="status-pill" data-state="${attended ? 'active' : 'warning'}">
          ${attended ? `Today: ${escapeHtml(formatDate(attendance.attended_at || attendance.attendance_date))}` : 'Not marked today'}
        </span>
        <button
          class="button button-primary"
          type="button"
          data-manual-attendance-action="log"
          data-member-id="${escapeHtml(member.id)}"
          ${attended || pending ? 'disabled' : ''}
        >${pending ? 'Recording...' : 'Manual attendance'}</button>
      </div>
    </article>
  `;
}

function renderPendingState(root, memberId) {
  const button = root.querySelector(`[data-member-id="${CSS.escape(memberId)}"]`);

  if (!button) {
    return;
  }

  button.disabled = true;
  button.textContent = 'Recording...';
}

function renderSkeletonRows() {
  return Array.from({ length: 4 }, () => `
    <article class="manual-attendance-row user-card-loading" aria-hidden="true">
      <div class="manual-attendance-member">
        <div class="skeleton-line skeleton-line-wide"></div>
        <div class="skeleton-line"></div>
      </div>
      <div class="skeleton-line skeleton-line-short"></div>
    </article>
  `).join('');
}

function setBusy(root, busy) {
  root.setAttribute('aria-busy', busy ? 'true' : 'false');
  root.querySelector('[data-manual-attendance-list]')?.setAttribute('aria-busy', busy ? 'true' : 'false');
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
  const message = root.querySelector('[data-manual-attendance-message]');

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

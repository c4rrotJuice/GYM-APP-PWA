import { getActiveAttendanceToken } from '../../scripts/attendance-service.js';
import { escapeHtml, formatDate } from '../../scripts/dashboard-layout.js';

const REFRESH_INTERVAL_MS = 60 * 1000;
const COUNTDOWN_INTERVAL_MS = 1000;

let displayTimers = {
  refresh: null,
  countdown: null
};
let routeCleanupAttached = false;

export function createAttendanceDisplayView() {
  return `
    <section class="attendance-display" data-attendance-display aria-live="polite" aria-busy="true">
      <div class="attendance-display-status" data-display-status>Loading attendance QR...</div>
      <div class="attendance-display-stage" data-display-stage>
        ${createStateView('loading')}
      </div>
    </section>
  `;
}

export async function initAttendanceDisplayPage({ target, appContext }) {
  clearDisplayTimers();
  attachRouteCleanup();

  const root = target?.querySelector('[data-attendance-display]');
  const stage = target?.querySelector('[data-display-stage]');
  const status = target?.querySelector('[data-display-status]');

  if (!root || !stage) {
    return;
  }

  const state = {
    appContext,
    tokenRecord: null
  };

  const refresh = async () => {
    await refreshDisplayToken({ root, stage, status, state });
  };

  await refresh();

  displayTimers.refresh = window.setInterval(refresh, REFRESH_INTERVAL_MS);
  displayTimers.countdown = window.setInterval(() => {
    updateCountdown({ root, stage, status, state });
  }, COUNTDOWN_INTERVAL_MS);
}

function attachRouteCleanup() {
  if (routeCleanupAttached) {
    return;
  }

  window.addEventListener('hashchange', () => {
    if (window.location.hash.replace('#', '') !== 'attendance-display') {
      clearDisplayTimers();
    }
  });

  routeCleanupAttached = true;
}

async function refreshDisplayToken({ root, stage, status, state }) {
  root.setAttribute('aria-busy', 'true');

  if (!state.tokenRecord) {
    stage.innerHTML = createStateView('loading');
    setStatus(status, 'Loading attendance QR...');
  }

  const { tokenRecord, error } = await getActiveAttendanceToken({ appContext: state.appContext });

  if (error) {
    state.tokenRecord = null;
    stage.innerHTML = createStateView('no-active', {
      title: 'Unable to load QR',
      detail: error.message || 'The active attendance token could not be loaded.'
    });
    setStatus(status, 'No active display token');
    root.setAttribute('aria-busy', 'false');
    return;
  }

  const tokenChanged = tokenRecord?.id !== state.tokenRecord?.id ||
    tokenRecord?.token !== state.tokenRecord?.token;

  if (!tokenRecord && state.tokenRecord && isExpired(state.tokenRecord)) {
    stage.innerHTML = createStateView('expired', {
      expiry: formatDate(state.tokenRecord.expires_at)
    });
    setStatus(status, 'Token expired');
  } else if (!tokenRecord) {
    state.tokenRecord = null;
    stage.innerHTML = createStateView('no-active');
    setStatus(status, 'No active token');
  } else if (tokenChanged) {
    state.tokenRecord = tokenRecord;
    renderActiveToken(stage, state.tokenRecord);
    updateCountdown({ root, stage, status, state });
  } else {
    state.tokenRecord = tokenRecord;
  }

  root.setAttribute('aria-busy', 'false');
}

function updateCountdown({ root, stage, status, state }) {
  if (!state.tokenRecord) {
    return;
  }

  const remainingMs = new Date(state.tokenRecord.expires_at).getTime() - Date.now();

  if (remainingMs <= 0) {
    stage.innerHTML = createStateView('expired', {
      expiry: formatDate(state.tokenRecord.expires_at)
    });
    setStatus(status, 'Token expired');
    root.setAttribute('data-display-state', 'expired');
    return;
  }

  const countdown = stage.querySelector('[data-countdown]');
  const expiry = stage.querySelector('[data-expiry]');

  if (countdown) {
    countdown.textContent = formatCountdown(remainingMs);
  }

  if (expiry) {
    expiry.textContent = `Expires ${formatDate(state.tokenRecord.expires_at)}`;
  }

  setStatus(status, 'Active token');
  root.setAttribute('data-display-state', 'active');
}

function renderActiveToken(stage, tokenRecord) {
  stage.innerHTML = `
    <article class="attendance-display-card">
      <img class="attendance-display-qr" src="${createQrImageUrl(tokenRecord.token)}" alt="Attendance QR code">
      <div class="attendance-display-meta">
        <span class="attendance-display-label">Time remaining</span>
        <strong data-countdown>--:--:--</strong>
        <span data-expiry>Expires ${escapeHtml(formatDate(tokenRecord.expires_at))}</span>
      </div>
    </article>
  `;
}

function createStateView(state, options = {}) {
  const states = {
    loading: {
      title: 'Loading QR',
      detail: 'Preparing the reception attendance display.'
    },
    'no-active': {
      title: options.title || 'No Active QR',
      detail: options.detail || 'Generate an attendance token from the admin QR page.'
    },
    expired: {
      title: 'QR Expired',
      detail: `This QR expired${options.expiry ? ` on ${options.expiry}` : ''}. Generate a new token to resume display.`
    }
  };
  const content = states[state] || states.loading;

  return `
    <article class="attendance-display-empty" data-display-empty="${escapeHtml(state)}">
      <strong>${escapeHtml(content.title)}</strong>
      <span>${escapeHtml(content.detail)}</span>
    </article>
  `;
}

function createQrImageUrl(token) {
  const params = new URLSearchParams({
    size: '720x720',
    margin: '24',
    data: token
  });

  return `https://api.qrserver.com/v1/create-qr-code/?${params.toString()}`;
}

function formatCountdown(remainingMs) {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

function isExpired(tokenRecord) {
  return new Date(tokenRecord.expires_at).getTime() <= Date.now();
}

function setStatus(target, text) {
  if (target) {
    target.textContent = text;
  }
}

function clearDisplayTimers() {
  if (displayTimers.refresh) {
    window.clearInterval(displayTimers.refresh);
  }

  if (displayTimers.countdown) {
    window.clearInterval(displayTimers.countdown);
  }

  displayTimers = {
    refresh: null,
    countdown: null
  };
}

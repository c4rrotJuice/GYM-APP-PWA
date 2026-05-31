import {
  generateAttendanceToken,
  getActiveAttendanceToken,
  revokeAttendanceToken
} from '../../scripts/attendance-service.js';
import { createDashboardShell, escapeHtml, formatDate } from '../../scripts/dashboard-layout.js';
import { getSupabaseClientReady } from '../../scripts/supabase.js';

const VALIDITY_LABELS = Object.freeze({
  weekly: 'Weekly',
  fortnight: 'Fortnight',
  monthly: 'Monthly'
});

export function createAdminAttendanceView({ supabaseReady }) {
  return createDashboardShell({
    eyebrow: supabaseReady ? 'Admin QR' : 'Supabase unavailable',
    title: 'Attendance QR',
    description: 'Generate, rotate, revoke, and print the active attendance QR token.',
    status: { text: 'Loading attendance token...', busy: true },
    body: `
      <section class="panel qr-admin-panel" data-qr-admin aria-busy="true">
        <div class="user-admin-toolbar">
          <div>
            <h2>Current Active Token</h2>
            <p data-qr-summary>Loading QR token status...</p>
          </div>
          <div class="qr-admin-actions">
            <label class="field-group qr-validity-field" for="qr-validity">
              <span>Validity</span>
              <select id="qr-validity" data-qr-validity>
                <option value="weekly">Weekly</option>
                <option value="fortnight">Fortnight</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <button class="button button-primary" type="button" data-generate-qr>Generate</button>
            <button class="button button-secondary" type="button" data-regenerate-qr disabled>Regenerate</button>
            <a class="button button-secondary" href="#attendance-display">Display mode</a>
          </div>
        </div>

        <div class="auth-message" data-qr-message role="status" aria-live="polite"></div>

        <div class="qr-token-card" data-token-card>
          <div class="qr-token-empty">
            <strong>No active token</strong>
            <span>Choose a validity window and generate an attendance QR token.</span>
          </div>
        </div>
      </section>
    `
  });
}

export async function initAdminAttendancePage({ target, appContext }) {
  const root = target?.querySelector('[data-qr-admin]');
  const status = target?.querySelector('.dashboard-status');

  if (!root) {
    return;
  }

  const state = {
    appContext,
    tokenRecord: null,
    gymName: await loadGymName(appContext)
  };

  bindQrAdminEvents(root, status, state);
  await refreshActiveToken(root, status, state);
}

function bindQrAdminEvents(root, status, state) {
  root.querySelector('[data-generate-qr]')?.addEventListener('click', async () => {
    await generateTokenFromSelection(root, status, state);
  });

  root.querySelector('[data-regenerate-qr]')?.addEventListener('click', async () => {
    await generateTokenFromSelection(root, status, state);
  });

  root.addEventListener('click', async (event) => {
    const action = event.target?.dataset?.qrAction;

    if (action === 'revoke') {
      await revokeCurrentToken(root, status, state);
    }

    if (action === 'print') {
      document.body.classList.add('qr-print-mode');
      window.print();
    }
  });

  window.addEventListener('afterprint', () => {
    document.body.classList.remove('qr-print-mode');
  });
}

async function refreshActiveToken(root, status, state) {
  setBusy(root, true);
  const { tokenRecord, error } = await getActiveAttendanceToken({ appContext: state.appContext });

  if (error) {
    setMessage(root, error.message || 'Unable to load active attendance token.', 'error');
    setStatus(status, 'Unable to load attendance token.', 'error');
  } else {
    state.tokenRecord = tokenRecord;
    renderTokenCard(root, state);
    setStatus(status, tokenRecord ? 'Active attendance token loaded.' : 'No active attendance token.', tokenRecord ? 'success' : '');
  }

  setBusy(root, false);
}

async function generateTokenFromSelection(root, status, state) {
  const validityType = root.querySelector('[data-qr-validity]')?.value || 'weekly';

  setBusy(root, true);
  setMessage(root, 'Generating attendance token...', '');

  const { tokenRecord, error } = await generateAttendanceToken(validityType, { appContext: state.appContext });

  if (error) {
    setMessage(root, error.message || 'Unable to generate attendance token.', 'error');
    setStatus(status, 'Attendance token generation failed.', 'error');
  } else {
    state.tokenRecord = tokenRecord;
    renderTokenCard(root, state);
    setMessage(root, 'Attendance token generated.', 'success');
    setStatus(status, 'Active attendance token is current.', 'success');
  }

  setBusy(root, false);
}

async function revokeCurrentToken(root, status, state) {
  if (!state.tokenRecord?.id) {
    return;
  }

  setBusy(root, true);
  setMessage(root, 'Revoking attendance token...', '');

  const { error } = await revokeAttendanceToken(state.tokenRecord.id, { appContext: state.appContext });

  if (error) {
    setMessage(root, error.message || 'Unable to revoke attendance token.', 'error');
    setStatus(status, 'Attendance token revocation failed.', 'error');
  } else {
    state.tokenRecord = null;
    renderTokenCard(root, state);
    setMessage(root, 'Attendance token revoked.', 'success');
    setStatus(status, 'No active attendance token.', '');
  }

  setBusy(root, false);
}

function renderTokenCard(root, state) {
  const card = root.querySelector('[data-token-card]');
  const summary = root.querySelector('[data-qr-summary]');
  const regenerateButton = root.querySelector('[data-regenerate-qr]');

  if (!card) {
    return;
  }

  if (!state.tokenRecord) {
    card.innerHTML = `
      <div class="qr-token-empty">
        <strong>No active token</strong>
        <span>Choose a validity window and generate an attendance QR token.</span>
      </div>
    `;
    if (summary) {
      summary.textContent = 'No active QR token.';
    }
    if (regenerateButton) {
      regenerateButton.disabled = true;
    }
    return;
  }

  const token = state.tokenRecord;
  const gymName = state.gymName || getGymName(state.appContext);
  const status = getTokenStatus(token);

  card.innerHTML = `
    <article class="qr-token-active">
      <div class="qr-token-details">
        <div class="membership-badge-row">
          <span class="status-pill" data-state="${status.state}">${escapeHtml(status.label)}</span>
          <span class="expiry-badge">${escapeHtml(VALIDITY_LABELS[token.validity_type] || token.validity_type)}</span>
        </div>
        <dl class="dashboard-key-values">
          <div>
            <dt>Generated</dt>
            <dd>${escapeHtml(formatDate(token.issued_at))}</dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>${escapeHtml(formatDate(token.expires_at))}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>${escapeHtml(status.label)}</dd>
          </div>
        </dl>
        <div class="qr-token-value" title="${escapeHtml(token.token)}">${escapeHtml(token.token)}</div>
        <div class="qr-card-actions">
          <button class="button button-secondary" type="button" data-qr-action="print">Print QR</button>
          <button class="button button-secondary" type="button" data-qr-action="revoke">Revoke</button>
        </div>
      </div>

      <div class="qr-print-card" data-print-card>
        <h2>${escapeHtml(gymName)}</h2>
        <img src="${createQrImageUrl(token.token)}" width="280" height="280" alt="Attendance QR code">
        <p>Attendance QR</p>
        <small>Expires ${escapeHtml(formatDate(token.expires_at))}</small>
      </div>
    </article>
  `;

  if (summary) {
    summary.textContent = `Generated ${formatDate(token.issued_at)} - expires ${formatDate(token.expires_at)}.`;
  }
  if (regenerateButton) {
    regenerateButton.disabled = false;
  }
}

function createQrImageUrl(token) {
  const params = new URLSearchParams({
    size: '320x320',
    margin: '16',
    data: token
  });

  return `https://api.qrserver.com/v1/create-qr-code/?${params.toString()}`;
}

function getTokenStatus(token) {
  if (!token.active) {
    return { label: 'Inactive', state: 'inactive' };
  }

  if (token.revoked_at) {
    return { label: 'Revoked', state: 'inactive' };
  }

  if (new Date(token.expires_at).getTime() <= Date.now()) {
    return { label: 'Expired', state: 'warning' };
  }

  return { label: 'Active', state: 'active' };
}

function getGymName(appContext) {
  return appContext?.gym?.name ||
    appContext?.profile?.gym_name ||
    appContext?.session?.gym?.name ||
    'Gym PWA';
}

async function loadGymName(appContext) {
  const gymId = appContext?.gymId || appContext?.tenantId;

  if (!gymId) {
    return getGymName(appContext);
  }

  try {
    const supabase = await getSupabaseClientReady();
    const { data, error } = await supabase
      .from('gyms')
      .select('name')
      .eq('id', gymId)
      .single();

    return error ? getGymName(appContext) : data?.name || getGymName(appContext);
  } catch (error) {
    return getGymName(appContext);
  }
}

function setBusy(root, busy) {
  root.setAttribute('aria-busy', busy ? 'true' : 'false');
  root.querySelectorAll('button, select').forEach((control) => {
    if (control.dataset.qrValidity !== undefined) {
      control.disabled = busy;
      return;
    }

    if (control.dataset.regenerateQr !== undefined) {
      control.disabled = busy || !root.querySelector('[data-print-card]');
      return;
    }

    control.disabled = busy;
  });
}

function setMessage(root, text, tone) {
  const message = root.querySelector('[data-qr-message]');

  if (!message) {
    return;
  }

  message.textContent = text;
  message.dataset.tone = tone || '';
}

function setStatus(target, text, tone) {
  if (!target) {
    return;
  }

  target.textContent = text;
  target.setAttribute('aria-busy', 'false');
  target.dataset.tone = tone || '';
}

import { recordMemberAttendance } from '../../scripts/attendance-service.js';
import { createDashboardShell } from '../../scripts/dashboard-layout.js';

const HTML5_QRCODE_SRC = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
const SCANNER_ELEMENT_ID = 'member-attendance-reader';

let activeCleanup = null;
let html5QrcodeLoad = null;

export function createMemberAttendanceScannerView({ supabaseReady }) {
  return createDashboardShell({
    eyebrow: supabaseReady ? 'Member QR scan' : 'Supabase unavailable',
    title: 'Attendance Scanner',
    description: 'Open your camera and scan the gym attendance QR code.',
    status: { text: 'Camera permission required.', busy: false },
    body: `
      <section class="panel member-scanner-panel" data-member-scanner data-scanner-state="permission" aria-busy="false">
        <div class="member-scanner-stage">
          <div id="${SCANNER_ELEMENT_ID}" class="member-scanner-reader" data-scanner-reader></div>
          <div class="member-scanner-overlay" data-scanner-overlay>
            <strong data-scanner-state-title>Camera permission required</strong>
            <span data-scanner-state-detail>Use the camera to scan the attendance QR code. File and gallery scans are disabled.</span>
          </div>
        </div>

        <div class="member-scanner-actions">
          <button class="button button-primary" type="button" data-open-camera>Open camera</button>
        </div>

        <div class="auth-message" data-scanner-message role="status" aria-live="polite"></div>
      </section>
    `
  });
}

export async function initMemberAttendanceScannerPage({ target, appContext }) {
  activeCleanup?.();

  const root = target?.querySelector('[data-member-scanner]');
  const status = target?.querySelector('.dashboard-status');

  if (!root) {
    return;
  }

  const state = {
    appContext,
    scanner: null,
    started: false,
    scanned: false,
    disposed: false
  };

  const cleanup = () => {
    state.disposed = true;
    window.removeEventListener('hashchange', cleanup);
    window.removeEventListener('beforeunload', cleanup);
    if (activeCleanup === cleanup) {
      activeCleanup = null;
    }
    void destroyScanner(state);
  };

  activeCleanup = cleanup;
  window.addEventListener('hashchange', cleanup, { once: true });
  window.addEventListener('beforeunload', cleanup, { once: true });

  root.querySelector('[data-open-camera]')?.addEventListener('click', async () => {
    await openCamera(root, status, state);
  });

  setScannerState(root, status, 'permission');
}

async function openCamera(root, status, state) {
  if (state.started || state.disposed) {
    return;
  }

  state.scanned = false;
  setScannerState(root, status, 'scanning');

  try {
    const Html5Qrcode = await loadHtml5Qrcode();
    state.scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
      verbose: false
    });

    await startCamera(state.scanner, async (decodedText) => {
      await handleScan(decodedText, root, status, state);
    });

    state.started = true;
    setScannerState(root, status, 'scanning');
  } catch (error) {
    await destroyScanner(state);
    setScannerState(root, status, 'failure', error?.message || 'Camera permission is required to scan attendance.');
  }
}

async function startCamera(scanner, onSuccess) {
  const config = {
    fps: 8,
    qrbox: calculateQrBox,
    aspectRatio: 1,
    disableFlip: true
  };

  try {
    await scanner.start({ facingMode: { exact: 'environment' } }, config, onSuccess);
  } catch {
    await scanner.start({ facingMode: 'environment' }, config, onSuccess);
  }
}

async function handleScan(decodedText, root, status, state) {
  if (state.scanned || state.disposed) {
    return;
  }

  state.scanned = true;
  const token = extractAttendanceToken(decodedText);

  setScannerState(root, status, 'validating');
  await destroyScanner(state);

  const { attendanceLog, reason } = await recordMemberAttendance(token, { appContext: state.appContext });

  if (attendanceLog) {
    setScannerState(root, status, 'success');
    return;
  }

  setScannerState(root, status, 'failure', reason || 'Attendance validation failed.');
}

async function destroyScanner(state) {
  const scanner = state.scanner;
  state.scanner = null;
  state.started = false;

  if (!scanner) {
    return;
  }

  try {
    if (scanner.isScanning) {
      await scanner.stop();
    }
  } catch {
    // The scanner can fail stop() while startup is still settling; clear below still releases the instance.
  }

  try {
    await scanner.clear();
  } catch {
    // clear() is best-effort cleanup after the camera stream has been stopped.
  }
}

function extractAttendanceToken(value) {
  const rawValue = String(value || '').trim();

  if (!rawValue) {
    return '';
  }

  try {
    const url = new URL(rawValue);
    const token = url.searchParams.get('token') ||
      url.searchParams.get('attendance_token') ||
      url.searchParams.get('qr_token') ||
      url.searchParams.get('code');

    return (token || url.hash.replace(/^#/, '') || url.pathname.split('/').filter(Boolean).at(-1) || rawValue).trim();
  } catch {
    return rawValue;
  }
}

function setScannerState(root, status, state, detail = '') {
  const labels = {
    permission: {
      title: 'Camera permission required',
      detail: 'Use the camera to scan the attendance QR code. File and gallery scans are disabled.',
      status: 'Camera permission required.',
      tone: ''
    },
    scanning: {
      title: 'Scanning',
      detail: 'Point your camera at the gym attendance QR code.',
      status: 'Scanning.',
      tone: ''
    },
    validating: {
      title: 'Validating',
      detail: 'Camera stopped. Sending token for validation.',
      status: 'Validating attendance token.',
      tone: ''
    },
    success: {
      title: 'Attendance recorded.',
      detail: 'Attendance recorded.',
      status: 'Attendance recorded.',
      tone: 'success'
    },
    failure: {
      title: 'Attendance failed',
      detail: detail || 'Attendance validation failed.',
      status: detail || 'Attendance validation failed.',
      tone: 'error'
    }
  };
  const label = labels[state] || labels.permission;
  const openCameraButton = root.querySelector('[data-open-camera]');

  root.dataset.scannerState = state;
  root.setAttribute('aria-busy', state === 'scanning' || state === 'validating' ? 'true' : 'false');
  root.querySelector('[data-scanner-state-title]').textContent = label.title;
  root.querySelector('[data-scanner-state-detail]').textContent = label.detail;
  setMessage(root, state === 'failure' || state === 'success' ? label.detail : '', label.tone);

  if (openCameraButton) {
    openCameraButton.disabled = state === 'scanning' || state === 'validating' || state === 'success';
    openCameraButton.textContent = state === 'failure' ? 'Try again' : 'Open camera';
  }

  if (status) {
    status.textContent = label.status;
    status.setAttribute('aria-busy', state === 'scanning' || state === 'validating' ? 'true' : 'false');
    status.dataset.tone = label.tone;
  }
}

function setMessage(root, text, tone) {
  const message = root.querySelector('[data-scanner-message]');

  if (!message) {
    return;
  }

  message.textContent = text;
  message.dataset.tone = tone || '';
}

function calculateQrBox(viewfinderWidth, viewfinderHeight) {
  const shortestSide = Math.min(viewfinderWidth, viewfinderHeight);
  const size = Math.min(Math.floor(shortestSide * 0.72), shortestSide);
  return {
    width: Math.max(size, Math.min(shortestSide, 180)),
    height: Math.max(size, Math.min(shortestSide, 180))
  };
}

function loadHtml5Qrcode() {
  if (window.Html5Qrcode) {
    return Promise.resolve(window.Html5Qrcode);
  }

  if (html5QrcodeLoad) {
    return html5QrcodeLoad;
  }

  html5QrcodeLoad = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = HTML5_QRCODE_SRC;
    script.async = true;
    script.onload = () => {
      if (window.Html5Qrcode) {
        resolve(window.Html5Qrcode);
      } else {
        reject(new Error('QR scanner library did not load.'));
      }
    };
    script.onerror = () => reject(new Error('QR scanner library failed to load.'));
    document.head.append(script);
  });

  return html5QrcodeLoad;
}

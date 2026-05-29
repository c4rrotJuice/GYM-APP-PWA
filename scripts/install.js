let deferredInstallPrompt = null;
const INSTALL_DISMISSED_KEY = 'gym-pwa-install-dismissed';
let serviceWorkerRefreshing = false;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        registration.update();

        if (registration.waiting && navigator.serviceWorker.controller) {
          showInstallStatus('Updating app...');
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) {
            return;
          }

          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              showInstallStatus('Updating app...');
              worker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch((error) => {
        console.error('Service worker registration failed:', error);
      });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (serviceWorkerRefreshing) {
      return;
    }

    serviceWorkerRefreshing = true;
    window.location.reload();
  });
}

export function initInstallPrompt() {
  const installButtons = document.querySelectorAll('[data-install-button]');
  const dismissButtons = document.querySelectorAll('[data-install-dismiss]');
  const banners = document.querySelectorAll('[data-install-banner]');

  syncStandaloneState();
  watchDisplayMode();

  if (isStandalone()) {
    hideInstallUi();
    showInstallStatus('Installed app mode');
    return;
  }

  if (isInstallDismissed()) {
    hideInstallUi();
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showInstallUi('Install this app for faster access and offline shell support.');
  });

  installButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      if (!deferredInstallPrompt) {
        showInstallStatus('Use your browser menu to install this app when available.');
        return;
      }

      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;

      if (choice.outcome === 'accepted') {
        clearInstallDismissed();
        hideInstallUi();
        showInstallStatus('Installing...');
        return;
      }

      rememberInstallDismissed();
      hideInstallUi();
    });
  });

  dismissButtons.forEach((button) => {
    button.addEventListener('click', () => {
      rememberInstallDismissed();
      hideInstallUi();
    });
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    clearInstallDismissed();
    hideInstallUi();
    syncStandaloneState();
  });

  function showInstallUi(message) {
    if (isStandalone() || isInstallDismissed()) {
      return;
    }

    banners.forEach((banner) => {
      banner.hidden = false;
    });

    installButtons.forEach((button) => {
      button.hidden = false;
    });

    showInstallStatus(message);
  }
}

export function syncStandaloneState() {
  const standalone = isStandalone();
  const shell = document.querySelector('.app-shell');

  document.documentElement.dataset.displayMode = standalone ? 'standalone' : 'browser';
  document.body?.classList.toggle('is-standalone', standalone);
  syncThemeColor(standalone);

  if (shell) {
    shell.dataset.standalone = String(standalone);
  }
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function hideInstallUi() {
  document.querySelectorAll('[data-install-banner]').forEach((banner) => {
    banner.hidden = true;
  });

  document.querySelectorAll('[data-install-button]').forEach((button) => {
    button.hidden = true;
  });
}

function showInstallStatus(message) {
  document.querySelectorAll('[data-install-status]').forEach((status) => {
    status.textContent = message;
  });
}

function rememberInstallDismissed() {
  try {
    sessionStorage.setItem(INSTALL_DISMISSED_KEY, 'true');
  } catch (error) {
    console.warn('Unable to store install prompt state:', error);
  }
}

function clearInstallDismissed() {
  try {
    sessionStorage.removeItem(INSTALL_DISMISSED_KEY);
  } catch (error) {
    console.warn('Unable to clear install prompt state:', error);
  }
}

function isInstallDismissed() {
  try {
    return sessionStorage.getItem(INSTALL_DISMISSED_KEY) === 'true';
  } catch (error) {
    return false;
  }
}

function watchDisplayMode() {
  const query = window.matchMedia('(display-mode: standalone)');

  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', syncStandaloneState);
    return;
  }

  if (typeof query.addListener === 'function') {
    query.addListener(syncStandaloneState);
  }
}

function syncThemeColor(standalone) {
  const theme = document.querySelector('meta[name="theme-color"]');
  if (!theme) {
    return;
  }

  theme.setAttribute('content', standalone ? '#0f172a' : '#0f172a');
}

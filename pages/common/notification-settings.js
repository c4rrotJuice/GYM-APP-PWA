import { createDashboardShell } from '../../scripts/dashboard-layout.js';
import { runtimeEnv } from '../../scripts/env.js';
import {
  getActiveSubscriptions,
  getUserSubscriptions,
  removeSubscription,
  saveSubscription
} from '../../services/notificationService.js';

export function createNotificationSettingsView() {
  return createDashboardShell({
    eyebrow: 'Account settings',
    title: 'Notification Settings',
    description: 'Control browser push notifications for this account.',
    status: { text: 'Checking notification status...', busy: true },
    body: `
      <section class="panel notification-settings-panel" data-notification-settings aria-busy="true">
        <div class="notification-status-grid" aria-label="Notification status">
          <article>
            <span>Permission</span>
            <strong data-notification-permission>Checking</strong>
          </article>
          <article>
            <span>Subscription</span>
            <strong data-notification-subscription>Checking</strong>
          </article>
        </div>

        <div class="notification-settings-actions">
          <button class="button button-primary button-full" type="button" data-enable-notifications>
            Enable notifications
          </button>
          <button class="button button-secondary button-full" type="button" data-disable-notifications>
            Disable notifications
          </button>
        </div>

        <p class="notification-settings-message" data-notification-message role="status" aria-live="polite"></p>
      </section>
    `
  });
}

export async function initNotificationSettingsPage({ target }) {
  const root = target?.querySelector('[data-notification-settings]');
  const status = target?.querySelector('.dashboard-status');

  if (!root) {
    return;
  }

  const controls = {
    permission: root.querySelector('[data-notification-permission]'),
    subscription: root.querySelector('[data-notification-subscription]'),
    enable: root.querySelector('[data-enable-notifications]'),
    disable: root.querySelector('[data-disable-notifications]'),
    message: root.querySelector('[data-notification-message]')
  };

  controls.enable?.addEventListener('click', () => enableNotifications({ root, status, controls }));
  controls.disable?.addEventListener('click', () => disableNotifications({ root, status, controls }));

  await renderNotificationState({ root, status, controls });
}

async function enableNotifications({ root, status, controls }) {
  setBusy({ root, status, controls }, 'Requesting notification permission...');

  try {
    const supportError = getSupportError();
    if (supportError) {
      throw new Error(supportError);
    }

    if (!runtimeEnv.VAPID_PUBLIC_KEY) {
      throw new Error('Push notifications are not configured for this deployment.');
    }

    const permission = await requestNotificationPermission();
    if (permission !== 'granted') {
      await renderNotificationState({
        root,
        status,
        controls,
        message: getPermissionMessage(permission),
        tone: 'error'
      });
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const existingSubscription = await registration.pushManager.getSubscription();
    const pushSubscription = existingSubscription || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(runtimeEnv.VAPID_PUBLIC_KEY)
    });

    const result = await saveSubscription(pushSubscription);
    if (result.error) {
      throw result.error;
    }

    await renderNotificationState({
      root,
      status,
      controls,
      message: 'Notifications are enabled.',
      tone: 'success'
    });
  } catch (error) {
    await renderNotificationState({
      root,
      status,
      controls,
      message: error?.message || 'Unable to enable notifications.',
      tone: 'error'
    });
  }
}

async function disableNotifications({ root, status, controls }) {
  setBusy({ root, status, controls }, 'Disabling notifications...');

  try {
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.ready : null;
    const browserSubscription = registration ? await registration.pushManager.getSubscription() : null;
    const activeResult = await getActiveSubscriptions();

    if (browserSubscription) {
      await browserSubscription.unsubscribe();
      await removeSubscription(browserSubscription);
    }

    if (activeResult.error) {
      throw activeResult.error;
    }

    await Promise.all((activeResult.subscriptions || [])
      .filter((subscription) => subscription?.endpoint !== browserSubscription?.endpoint)
      .map((subscription) => removeSubscription(subscription.endpoint)));

    await renderNotificationState({
      root,
      status,
      controls,
      message: 'Notifications are disabled.',
      tone: 'success'
    });
  } catch (error) {
    await renderNotificationState({
      root,
      status,
      controls,
      message: error?.message || 'Unable to disable notifications.',
      tone: 'error'
    });
  }
}

async function renderNotificationState({ root, status, controls, message = '', tone = '' }) {
  const supportError = getSupportError();
  const permission = getNotificationPermission();
  const browserSubscription = await getBrowserSubscription();
  const savedResult = await getUserSubscriptions();
  const activeSavedCount = (savedResult.subscriptions || []).filter((subscription) => subscription.active).length;
  const enabled = Boolean(browserSubscription && permission === 'granted');

  root.setAttribute('aria-busy', 'false');
  setText(controls.permission, formatPermission(permission, supportError));
  setText(controls.subscription, enabled ? 'Enabled' : activeSavedCount > 0 ? 'Saved' : 'Disabled');
  setText(controls.message, message || getDefaultMessage({ supportError, permission, enabled, activeSavedCount }));
  setStatus(status, message || getDefaultStatus({ supportError, permission, enabled }), tone || getDefaultTone({ supportError, permission, enabled }));

  if (controls.enable) {
    controls.enable.disabled = Boolean(supportError || permission === 'denied' || enabled);
  }

  if (controls.disable) {
    controls.disable.disabled = !enabled && activeSavedCount === 0;
  }
}

function setBusy({ root, status, controls }, message) {
  root.setAttribute('aria-busy', 'true');
  setStatus(status, message, '');
  setText(controls.message, message);

  if (controls.enable) {
    controls.enable.disabled = true;
  }

  if (controls.disable) {
    controls.disable.disabled = true;
  }
}

function getSupportError() {
  if (!('Notification' in window)) {
    return 'This browser does not support notifications.';
  }

  if (!('serviceWorker' in navigator)) {
    return 'This browser does not support service workers.';
  }

  if (!('PushManager' in window)) {
    return 'This browser does not support push notifications.';
  }

  return '';
}

function getNotificationPermission() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

async function requestNotificationPermission() {
  if (typeof Notification.requestPermission !== 'function') {
    return Notification.permission;
  }

  return Notification.requestPermission();
}

async function getBrowserSubscription() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return null;
    }

    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
  } catch (error) {
    return null;
  }
}

function formatPermission(permission, supportError) {
  if (supportError) {
    return 'Unsupported';
  }

  const labels = {
    granted: 'Granted',
    denied: 'Denied',
    default: 'Not asked'
  };

  return labels[permission] || 'Unknown';
}

function getPermissionMessage(permission) {
  if (permission === 'denied') {
    return 'Notifications were denied in browser settings.';
  }

  return 'Notification permission was not granted.';
}

function getDefaultStatus({ supportError, permission, enabled }) {
  if (supportError) {
    return supportError;
  }

  if (permission === 'denied') {
    return 'Notifications are blocked by browser permission.';
  }

  return enabled ? 'Notifications are enabled.' : 'Notifications are disabled.';
}

function getDefaultMessage({ supportError, permission, enabled, activeSavedCount }) {
  if (supportError) {
    return supportError;
  }

  if (permission === 'denied') {
    return 'Open browser settings to allow notifications for this site.';
  }

  if (enabled) {
    return 'This browser is subscribed.';
  }

  if (activeSavedCount > 0) {
    return 'Saved subscriptions exist for this account.';
  }

  return 'Notifications are off for this browser.';
}

function getDefaultTone({ supportError, permission, enabled }) {
  if (supportError || permission === 'denied') {
    return 'error';
  }

  return enabled ? 'success' : '';
}

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

function setStatus(target, text, tone) {
  if (!target) {
    return;
  }

  target.textContent = text;
  target.setAttribute('aria-busy', 'false');

  if (tone) {
    target.dataset.tone = tone;
    return;
  }

  delete target.dataset.tone;
}

function setText(target, text) {
  if (target) {
    target.textContent = text;
  }
}

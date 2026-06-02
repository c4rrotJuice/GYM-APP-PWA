const CACHE_VERSION = 'gym-pwa-shell';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const APP_SHELL = [
  '/',
  '/index.html',
  '/app.html',
  '/manifest.json',
  '/pwa/offline.html',
  '/assets/icon.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/styles/main.css',
  '/styles/base.css',
  '/styles/layout.css',
  '/styles/components.css',
  '/styles/app.css',
  '/scripts/main.js',
  '/scripts/app.js',
  '/scripts/app-context.js',
  '/scripts/auth.js',
  '/scripts/admin/users.js',
  '/scripts/attendance-service.js',
  '/scripts/dashboard-bootstrap.js',
  '/scripts/dashboard-layout.js',
  '/scripts/dashboard-queries.js',
  '/scripts/dashboard-state.js',
  '/scripts/env.js',
  '/scripts/guards.js',
  '/scripts/install.js',
  '/scripts/memberships.js',
  '/scripts/membership-logic.js',
  '/scripts/permissions.js',
  '/scripts/payment-logic.js',
  '/scripts/payments.js',
  '/scripts/profiles.js',
  '/scripts/role-components.js',
  '/scripts/role-queries.js',
  '/scripts/navigation.js',
  '/scripts/notification-service.js',
  '/scripts/router.js',
  '/scripts/session.js',
  '/scripts/supabase.js',
  '/scripts/tenant-queries.js',
  '/services/notificationService.js',
  '/pages/admin/dashboard.js',
  '/pages/admin/attendance.js',
  '/pages/admin/attendance-display.js',
  '/pages/admin/members.js',
  '/pages/admin/memberships.js',
  '/pages/admin/users.js',
  '/pages/common/module-placeholder.js',
  '/pages/common/notification-settings.js',
  '/pages/member/attendance-scanner.js',
  '/pages/member/dashboard.js',
  '/pages/trainer/dashboard.js',
  '/pages/trainer/members.js'
];
const STATIC_EXTENSIONS = [
  '.css',
  '.js',
  '.svg',
  '.png',
  '.webp',
  '.jpg',
  '.jpeg',
  '.ico',
  '.json'
];
const DYNAMIC_PATH_PREFIXES = ['/api/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('gym-pwa-shell') && ![STATIC_CACHE, RUNTIME_CACHE, DYNAMIC_CACHE].includes(key))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    return;
  }

  if (isSupabaseRequest(url)) {
    event.respondWith(fetch(request).catch(() => offlineJsonResponse()));
    return;
  }

  if (url.origin === self.location.origin && url.pathname === '/scripts/env.runtime.js') {
    event.respondWith(fetch(request).catch(() => new Response(
      'globalThis.__GYM_PWA_ENV__ = globalThis.__GYM_PWA_ENV__ || { SUPABASE_URL: "", SUPABASE_ANON_KEY: "", VAPID_PUBLIC_KEY: "" };',
      {
        headers: {
          'Content-Type': 'text/javascript',
          'Cache-Control': 'no-store'
        }
      }
    )));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isDynamicPlaceholder(url)) {
    event.respondWith(networkFirstNoStore(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

self.addEventListener('push', (event) => {
  event.waitUntil(showPushNotification(event));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(focusAppClient(event.notification.data?.url || '/app.html#settings'));
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return (await caches.match(request)) ||
      (await caches.match('/app.html')) ||
      (await caches.match('/index.html')) ||
      (await caches.match('/pwa/offline.html'));
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return fallbackFor(request);
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return (await caches.match(request)) || fallbackFor(request);
  }
}

async function networkFirstNoStore(request) {
  try {
    return await fetch(request);
  } catch (error) {
    return offlineJsonResponse();
  }
}

async function fallbackFor(request) {
  const url = new URL(request.url);

  if (request.destination === 'document') {
    return caches.match('/pwa/offline.html');
  }

  if (url.pathname.endsWith('.svg')) {
    return caches.match('/assets/icon.svg');
  }

  return new Response('', {
    status: 503,
    statusText: 'Offline'
  });
}

function isStaticAsset(url) {
  if (url.origin !== self.location.origin && !url.hostname.includes('cdn.jsdelivr.net')) {
    return false;
  }

  return STATIC_EXTENSIONS.some((extension) => url.pathname.endsWith(extension));
}

function isDynamicPlaceholder(url) {
  return url.origin === self.location.origin &&
    DYNAMIC_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function isSupabaseRequest(url) {
  return url.hostname.endsWith('.supabase.co') ||
    url.pathname.includes('/auth/v1/') ||
    url.pathname.includes('/rest/v1/') ||
    url.pathname.includes('/storage/v1/');
}

function isCacheable(response) {
  return Boolean(response && response.status === 200 && ['basic', 'cors'].includes(response.type));
}

function offlineJsonResponse() {
  return new Response(JSON.stringify({ error: 'offline' }), {
    status: 503,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

async function showPushNotification(event) {
  const payload = parsePushPayload(event);
  const title = payload.title || 'Gym PWA';
  const options = {
    body: payload.body || 'You have a new gym notification.',
    icon: payload.icon || '/assets/icon-192.png',
    badge: payload.badge || '/assets/icon-192.png',
    data: {
      url: normalizeNotificationUrl(payload.url)
    }
  };

  await self.registration.showNotification(title, options);
}

function parsePushPayload(event) {
  try {
    return event.data?.json?.() || {};
  } catch (error) {
    return {
      body: event.data?.text?.() || ''
    };
  }
}

function normalizeNotificationUrl(url) {
  if (!url) {
    return '/app.html#settings';
  }

  try {
    const parsedUrl = new URL(url, self.location.origin);
    return parsedUrl.origin === self.location.origin
      ? `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`
      : '/app.html#settings';
  } catch (error) {
    return '/app.html#settings';
  }
}

async function focusAppClient(url) {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const appClient = clientList.find((client) => new URL(client.url).origin === self.location.origin);

  if (appClient) {
    await appClient.focus();
    return appClient.navigate(url);
  }

  return self.clients.openWindow(url);
}

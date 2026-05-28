const CACHE_VERSION = 'gym-pwa-shell-v17';
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
  '/scripts/auth.js',
  '/scripts/admin/users.js',
  '/scripts/dashboard-bootstrap.js',
  '/scripts/dashboard-layout.js',
  '/scripts/dashboard-queries.js',
  '/scripts/dashboard-state.js',
  '/scripts/env.js',
  '/scripts/guards.js',
  '/scripts/install.js',
  '/scripts/memberships.js',
  '/scripts/permissions.js',
  '/scripts/profiles.js',
  '/scripts/role-components.js',
  '/scripts/role-queries.js',
  '/scripts/navigation.js',
  '/scripts/router.js',
  '/scripts/session.js',
  '/scripts/supabase.js',
  '/pages/admin/dashboard.js',
  '/pages/admin/members.js',
  '/pages/admin/users.js',
  '/pages/common/module-placeholder.js',
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
        .filter((key) => ![STATIC_CACHE, RUNTIME_CACHE, DYNAMIC_CACHE].includes(key))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
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
      'globalThis.__GYM_PWA_ENV__ = globalThis.__GYM_PWA_ENV__ || { SUPABASE_URL: "", SUPABASE_ANON_KEY: "" };',
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
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  event.respondWith(networkFirst(request, RUNTIME_CACHE));
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

const https = require('node:https');
const { createPushRequest } = require('./send-test-notification.js');

const DEFAULT_VAPID_SUBJECT = 'mailto:notifications@gym-pwa.local';
const MAX_QUEUE_LIMIT = 100;
const QUEUE_COLUMNS = [
  'id',
  'type',
  'recipient_user_id',
  'payload',
  'status',
  'attempt_count',
  'created_at',
  'processed_at'
].join(',');
const USER_COLUMNS = 'id,gym_id,role,account_status';
const PUSH_SUBSCRIPTION_COLUMNS = 'id,endpoint,p256dh,auth';

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed.' });
    }

    const env = getEnvironment();
    if (!env.ok) {
      return jsonResponse(500, { error: env.error });
    }

    const accessToken = readBearerToken(event.headers || {});
    if (!accessToken) {
      return jsonResponse(401, { error: 'Missing access token.' });
    }

    const currentUser = await getAuthenticatedUser(env.value, accessToken);
    if (currentUser.error || !currentUser.user?.id) {
      return jsonResponse(401, { error: currentUser.error || 'Unable to verify session.' });
    }

    const adminProfile = await getUserProfile(env.value, currentUser.user.id);
    if (adminProfile.error) {
      return jsonResponse(500, { error: adminProfile.error });
    }

    if (!isActiveAdmin(adminProfile.profile)) {
      return jsonResponse(403, { error: 'Only active admins can process notifications.' });
    }

    const body = parseJson(event.body || '{}') || {};
    const limit = normalizeLimit(body.limit);
    const eligibleRecipients = await getEligibleRecipientIds(env.value, adminProfile.profile.gym_id);
    if (eligibleRecipients.error) {
      return jsonResponse(500, { error: eligibleRecipients.error });
    }

    if (!eligibleRecipients.ids.length) {
      return jsonResponse(200, summarizeResults([]));
    }

    const pending = await getPendingNotifications(env.value, limit, eligibleRecipients.ids);
    if (pending.error) {
      return jsonResponse(500, { error: pending.error });
    }

    const results = [];
    for (const notification of pending.items) {
      results.push(await processNotification(env.value, notification, adminProfile.profile));
    }

    return jsonResponse(200, summarizeResults(results));
  } catch (error) {
    console.error('Notification queue processing failed:', error);
    return jsonResponse(500, {
      error: error?.message || 'Unable to process notification queue.'
    });
  }
};

async function processNotification(env, notification, adminProfile) {
  const recipient = await getUserProfile(env, notification.recipient_user_id);
  if (recipient.error) {
    await markNotification(env, notification, 'failed');
    return { id: notification.id, status: 'failed', error: recipient.error };
  }

  if (!isEligibleRecipient(recipient.profile, adminProfile.gym_id)) {
    await markNotification(env, notification, 'failed');
    return { id: notification.id, status: 'failed', error: 'Recipient is not eligible.' };
  }

  const subscriptions = await getActiveSubscriptions(env, notification.recipient_user_id);
  if (subscriptions.error) {
    await markNotification(env, notification, 'failed');
    return { id: notification.id, status: 'failed', error: subscriptions.error };
  }

  if (!subscriptions.items.length) {
    await markNotification(env, notification, 'failed');
    return { id: notification.id, status: 'failed', error: 'Recipient has no active push subscription.' };
  }

  const pushResults = await Promise.all(subscriptions.items.map((subscription) => (
    sendQueuedNotification(env, notification, subscription)
      .then((result) => ({ subscription, result }))
      .catch((error) => ({ subscription, result: { ok: false, status: 0, error: error.message } }))
  )));
  const expiredSubscriptions = pushResults.filter(({ result }) => [404, 410].includes(result.status));

  await Promise.all(expiredSubscriptions.map(({ subscription }) => (
    deactivateSubscription(env, notification.recipient_user_id, subscription.endpoint)
  )));

  const sentCount = pushResults.filter(({ result }) => result.ok).length;
  const nextStatus = sentCount > 0 ? 'sent' : 'failed';

  await markNotification(env, notification, nextStatus);

  return {
    id: notification.id,
    status: nextStatus,
    sent: sentCount,
    attempted: pushResults.length,
    expired: expiredSubscriptions.length
  };
}

function sendQueuedNotification(env, notification, subscription) {
  return new Promise((resolve, reject) => {
    const endpointUrl = new URL(subscription.endpoint);
    const pushRequest = createPushRequest({
      audience: endpointUrl.origin,
      endpoint: subscription.endpoint,
      subscription,
      payload: createNotificationPayload(notification),
      vapidPublicKey: env.vapidPublicKey,
      vapidPrivateKey: env.vapidPrivateKey,
      vapidSubject: env.vapidSubject
    });
    const request = https.request({
      protocol: endpointUrl.protocol,
      hostname: endpointUrl.hostname,
      port: endpointUrl.port || 443,
      path: `${endpointUrl.pathname}${endpointUrl.search}`,
      method: 'POST',
      headers: pushRequest.headers,
      timeout: 12000
    }, (response) => {
      let bodyText = '';

      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        bodyText += chunk;
      });
      response.on('end', () => {
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          bodyText
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error(`Request timed out calling ${endpointUrl.hostname}`));
    });
    request.on('error', reject);
    request.end(pushRequest.body);
  });
}

function createNotificationPayload(notification) {
  const payload = notification.payload && typeof notification.payload === 'object'
    ? notification.payload
    : {};

  return {
    title: payload.title || 'Gym PWA',
    body: payload.body || 'You have a new gym notification.',
    url: payload.url || '/app.html#settings',
    type: notification.type,
    notificationId: notification.id
  };
}

async function getAuthenticatedUser(env, accessToken) {
  const response = await requestJson(`${env.url}/auth/v1/user`, {
    headers: {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    return {
      user: null,
      error: response.body?.msg || response.body?.error_description || response.body?.message || 'Unable to verify session.'
    };
  }

  return { user: response.body, error: null };
}

async function getUserProfile(env, userId) {
  const query = [
    `select=${encodeURIComponent(USER_COLUMNS)}`,
    `id=eq.${encodeURIComponent(userId)}`,
    'limit=1'
  ].join('&');
  const response = await requestJson(`${env.url}/rest/v1/users?${query}`, {
    headers: serviceHeaders(env)
  });

  if (!response.ok) {
    return { profile: null, error: response.body?.message || 'Unable to load user profile.' };
  }

  return { profile: Array.isArray(response.body) ? response.body[0] : null, error: null };
}

async function getEligibleRecipientIds(env, gymId) {
  const query = [
    'select=id',
    `gym_id=eq.${encodeURIComponent(gymId)}`,
    'account_status=eq.active'
  ].join('&');
  const response = await requestJson(`${env.url}/rest/v1/users?${query}`, {
    headers: serviceHeaders(env)
  });

  if (!response.ok) {
    return { ids: [], error: response.body?.message || 'Unable to load eligible notification recipients.' };
  }

  return {
    ids: (Array.isArray(response.body) ? response.body : [])
      .map((user) => String(user?.id || '').trim())
      .filter(Boolean),
    error: null
  };
}

async function getPendingNotifications(env, limit, recipientIds) {
  const query = [
    `select=${encodeURIComponent(QUEUE_COLUMNS)}`,
    'status=eq.pending',
    `recipient_user_id=in.(${recipientIds.map(encodeURIComponent).join(',')})`,
    'order=created_at.asc',
    `limit=${encodeURIComponent(limit)}`
  ].join('&');
  const response = await requestJson(`${env.url}/rest/v1/notification_queue?${query}`, {
    headers: serviceHeaders(env)
  });

  if (!response.ok) {
    return { items: [], error: response.body?.message || 'Unable to load pending notifications.' };
  }

  return { items: Array.isArray(response.body) ? response.body : [], error: null };
}

async function getActiveSubscriptions(env, userId) {
  const query = [
    `select=${encodeURIComponent(PUSH_SUBSCRIPTION_COLUMNS)}`,
    `user_id=eq.${encodeURIComponent(userId)}`,
    'active=eq.true'
  ].join('&');
  const response = await requestJson(`${env.url}/rest/v1/push_subscriptions?${query}`, {
    headers: serviceHeaders(env)
  });

  if (!response.ok) {
    return { items: [], error: response.body?.message || 'Unable to load push subscriptions.' };
  }

  return { items: Array.isArray(response.body) ? response.body : [], error: null };
}

async function deactivateSubscription(env, userId, endpoint) {
  const query = [
    `user_id=eq.${encodeURIComponent(userId)}`,
    `endpoint=eq.${encodeURIComponent(endpoint)}`
  ].join('&');

  await requestJson(`${env.url}/rest/v1/push_subscriptions?${query}`, {
    method: 'PATCH',
    headers: {
      ...serviceHeaders(env),
      'Content-Type': 'application/json'
    },
    body: {
      active: false
    }
  });
}

async function markNotification(env, notification, status) {
  await requestJson(`${env.url}/rest/v1/notification_queue?id=eq.${encodeURIComponent(notification.id)}`, {
    method: 'PATCH',
    headers: {
      ...serviceHeaders(env),
      'Content-Type': 'application/json'
    },
    body: {
      status,
      attempt_count: Number(notification.attempt_count || 0) + 1,
      processed_at: new Date().toISOString()
    }
  });
}

function getEnvironment() {
  const url = process.env.SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
  const vapidSubject = process.env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT;

  if (!url || !serviceRoleKey) {
    return { ok: false, error: 'Supabase admin environment is not configured.' };
  }

  if (!vapidPublicKey || !vapidPrivateKey) {
    return { ok: false, error: 'VAPID environment is not configured.' };
  }

  return {
    ok: true,
    value: {
      url: url.replace(/\/$/, ''),
      serviceRoleKey,
      vapidPublicKey,
      vapidPrivateKey,
      vapidSubject
    }
  };
}

function isActiveAdmin(profile) {
  return profile?.role === 'admin' && profile?.account_status === 'active' && Boolean(profile?.gym_id);
}

function isEligibleRecipient(profile, gymId) {
  return Boolean(profile?.id && profile.gym_id === gymId && profile.account_status === 'active');
}

function normalizeLimit(value) {
  const limit = Number.parseInt(value, 10);

  if (!Number.isFinite(limit)) {
    return 25;
  }

  return Math.min(Math.max(limit, 1), MAX_QUEUE_LIMIT);
}

function summarizeResults(results) {
  return {
    processed: results.length,
    sent: results.filter((result) => result.status === 'sent').length,
    failed: results.filter((result) => result.status === 'failed').length,
    results
  };
}

function serviceHeaders(env) {
  return {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`
  };
}

function readBearerToken(headers) {
  const authorization = headers.authorization || headers.Authorization || '';
  if (!authorization.startsWith('Bearer ')) {
    return '';
  }

  return authorization.slice('Bearer '.length).trim();
}

function requestJson(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const requestBody = body ? JSON.stringify(body) : null;
    const requestUrl = new URL(url);
    const request = https.request({
      protocol: requestUrl.protocol,
      hostname: requestUrl.hostname,
      port: requestUrl.port || 443,
      path: `${requestUrl.pathname}${requestUrl.search}`,
      method,
      headers: {
        Accept: 'application/json',
        ...headers,
        ...(requestBody ? { 'Content-Length': Buffer.byteLength(requestBody) } : {})
      },
      timeout: 12000
    }, (response) => {
      let bodyText = '';

      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        bodyText += chunk;
      });
      response.on('end', () => {
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          body: parseJson(bodyText),
          bodyText
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error(`Request timed out calling ${requestUrl.hostname}`));
    });
    request.on('error', reject);

    if (requestBody) {
      request.write(requestBody);
    }

    request.end();
  });
}

function parseJson(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

exports.__test = {
  createNotificationPayload,
  isActiveAdmin,
  isEligibleRecipient,
  normalizeLimit,
  summarizeResults
};

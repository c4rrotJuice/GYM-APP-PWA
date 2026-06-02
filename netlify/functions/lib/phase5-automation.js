const https = require('node:https');

const DEFAULT_INACTIVE_THRESHOLD_DAYS = 30;

function getEnvironment() {
  const url = process.env.SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const automationSecret = process.env.PHASE5_AUTOMATION_SECRET || process.env.AUTOMATION_SECRET || '';

  if (!url || !serviceRoleKey) {
    return { ok: false, error: 'Supabase automation environment is not configured.' };
  }

  return {
    ok: true,
    value: {
      url: url.replace(/\/$/, ''),
      serviceRoleKey,
      automationSecret
    }
  };
}

function isAuthorizedAutomationEvent(event, env) {
  const headers = event.headers || {};
  const scheduled = String(headers['x-netlify-scheduled'] || headers['X-Netlify-Scheduled'] || '').toLowerCase() === 'true';
  const providedSecret = headers['x-automation-secret'] || headers['X-Automation-Secret'] || '';

  return scheduled || Boolean(env.automationSecret && providedSecret === env.automationSecret);
}

async function runRpc(env, functionName, body = {}) {
  return requestJson(`${env.url}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      ...serviceHeaders(env),
      'Content-Type': 'application/json'
    },
    body
  });
}

async function listGyms(env) {
  const response = await requestJson(`${env.url}/rest/v1/gyms?select=id&order=created_at.asc`, {
    headers: serviceHeaders(env)
  });

  if (!response.ok) {
    throw new Error(response.body?.message || 'Unable to load gyms for automation.');
  }

  return Array.isArray(response.body) ? response.body.filter((gym) => gym?.id) : [];
}

async function logAutomationFailure(env, { jobName, gymId = null, error, context = {} }) {
  const message = error?.message || String(error || 'Unknown automation failure.');
  console.error(`[${jobName}]`, message, context);

  await requestJson(`${env.url}/rest/v1/automation_failures`, {
    method: 'POST',
    headers: {
      ...serviceHeaders(env),
      'Content-Type': 'application/json'
    },
    body: {
      job_name: jobName,
      gym_id: gymId,
      error_message: message,
      error_context: context
    }
  }).catch(() => null);
}

async function enqueueRowsIdempotently(env, rows = []) {
  const validRows = rows.filter((row) => row?.recipient_user_id && row?.type);
  if (!validRows.length) {
    return [];
  }

  const dedupeKeys = validRows
    .map((row) => row?.payload?.dedupeKey)
    .filter(Boolean);
  const existingKeys = await getExistingDedupeKeys(env, dedupeKeys);
  const insertableRows = validRows.filter((row) => !existingKeys.has(row?.payload?.dedupeKey));

  if (!insertableRows.length) {
    return [];
  }

  const response = await requestJson(`${env.url}/rest/v1/notification_queue`, {
    method: 'POST',
    headers: {
      ...serviceHeaders(env),
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: insertableRows
  });

  if (!response.ok) {
    throw new Error(response.body?.message || 'Unable to enqueue automation notifications.');
  }

  return Array.isArray(response.body) ? response.body : [];
}

async function getExistingDedupeKeys(env, dedupeKeys = []) {
  if (!dedupeKeys.length) {
    return new Set();
  }

  const query = [
    'select=payload',
    `payload->>dedupeKey=in.(${dedupeKeys.map(encodeURIComponent).join(',')})`
  ].join('&');
  const response = await requestJson(`${env.url}/rest/v1/notification_queue?${query}`, {
    headers: serviceHeaders(env)
  });

  if (!response.ok) {
    throw new Error(response.body?.message || 'Unable to check existing notification dedupe keys.');
  }

  return new Set((Array.isArray(response.body) ? response.body : [])
    .map((row) => row?.payload?.dedupeKey)
    .filter(Boolean));
}

function createNotificationRow({ type, recipientUserId, payload }) {
  return {
    type,
    recipient_user_id: recipientUserId,
    payload: payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {},
    status: 'pending',
    attempt_count: 0
  };
}

function normalizeLimit(value, fallback = 100, max = 500) {
  const limit = Number.parseInt(value, 10);
  return Number.isFinite(limit) ? Math.min(Math.max(limit, 1), max) : fallback;
}

function normalizeDate(value = new Date()) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return new Date().toISOString().slice(0, 10);
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function addDays(value, days) {
  const date = new Date(`${normalizeDate(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return normalizeDate(date);
}

function daysBetween(startDate, endDate) {
  return Math.floor((new Date(`${normalizeDate(endDate)}T00:00:00Z`) - new Date(`${normalizeDate(startDate)}T00:00:00Z`)) / 86400000);
}

function createDedupeKey(type, recipientUserId, scope) {
  return [type, recipientUserId, scope]
    .map((part) => String(part || '').trim())
    .join(':');
}

function serviceHeaders(env) {
  return {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`
  };
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
      timeout: 15000
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

module.exports = {
  DEFAULT_INACTIVE_THRESHOLD_DAYS,
  addDays,
  createDedupeKey,
  createNotificationRow,
  daysBetween,
  enqueueRowsIdempotently,
  getEnvironment,
  isAuthorizedAutomationEvent,
  jsonResponse,
  listGyms,
  logAutomationFailure,
  normalizeDate,
  normalizeLimit,
  requestJson,
  runRpc,
  serviceHeaders
};

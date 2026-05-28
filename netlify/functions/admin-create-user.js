const https = require('node:https');

const ALLOWED_CREATE_ROLES = new Set(['member', 'trainer', 'admin']);
const ALLOWED_ACCOUNT_STATUSES = new Set(['active', 'suspended', 'disabled']);
const USER_PROFILE_COLUMNS = 'id, gym_id, fullname, email, phone, role, assigned_trainer, account_status, created_at, updated_at';

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
    if (currentUser.error || !currentUser.user) {
      return jsonResponse(401, { error: currentUser.error || 'Unable to verify session.' });
    }

    const currentProfile = await getAdminProfile(env.value, currentUser.user.id);
    if (currentProfile.error || !currentProfile.profile) {
      return jsonResponse(403, { error: currentProfile.error || 'Admin profile not found.' });
    }

    if (
      currentProfile.profile.role !== 'admin' ||
      normalizeStatus(currentProfile.profile.account_status) !== 'active' ||
      !currentProfile.profile.gym_id
    ) {
      return jsonResponse(403, { error: 'Only active admins can create users.' });
    }

    const payload = parsePayload(event.body);
    if (payload.error) {
      return jsonResponse(400, { error: payload.error });
    }

    if (payload.value.assigned_trainer) {
      const trainerCheck = await validateAssignedTrainer(
        env.value,
        payload.value.assigned_trainer,
        currentProfile.profile.gym_id
      );
      if (trainerCheck.error) {
        return jsonResponse(400, { error: trainerCheck.error });
      }
    }

    payload.value.gym_id = currentProfile.profile.gym_id;

    const temporaryPassword = createDefaultPassword(payload.value.role);
    const authCreation = await createAuthUser(env.value, payload.value, temporaryPassword);
    if (authCreation.error || !authCreation.user) {
      return jsonResponse(400, { error: authCreation.error || 'Unable to create auth user.' });
    }

    const profileCreation = await createProfile(env.value, authCreation.user.id, payload.value);
    if (profileCreation.error || !profileCreation.profile) {
      await deleteAuthUser(env.value, authCreation.user.id);
      return jsonResponse(400, { error: profileCreation.error || 'Unable to create user profile.' });
    }

    return jsonResponse(200, {
      auth_id: authCreation.user.id,
      profile: profileCreation.profile,
      temp_password: temporaryPassword
    });
  } catch (error) {
    console.error('Admin user creation failed:', error);
    return jsonResponse(500, {
      error: error?.message || 'Unable to create user right now.'
    });
  }
};

function getEnvironment() {
  const url = process.env.SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !serviceRoleKey) {
    return { ok: false, error: 'Supabase admin environment is not configured.' };
  }

  return {
    ok: true,
    value: { url: url.replace(/\/$/, ''), serviceRoleKey }
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

async function getAdminProfile(env, userId) {
  const query = `select=${encodeURIComponent(USER_PROFILE_COLUMNS)}&id=eq.${encodeURIComponent(userId)}`;
  const response = await requestJson(`${env.url}/rest/v1/users?${query}`, {
    headers: serviceHeaders(env)
  });

  if (!response.ok) {
    return { profile: null, error: response.body?.message || 'Unable to load admin profile.' };
  }

  return { profile: Array.isArray(response.body) ? response.body[0] || null : null, error: null };
}

async function validateAssignedTrainer(env, trainerId, gymId) {
  const query = [
    'select=id',
    `id=eq.${encodeURIComponent(trainerId)}`,
    `gym_id=eq.${encodeURIComponent(gymId)}`,
    'role=eq.trainer',
    'account_status=eq.active'
  ].join('&');
  const response = await requestJson(`${env.url}/rest/v1/users?${query}`, {
    headers: serviceHeaders(env)
  });

  if (!response.ok) {
    return { error: response.body?.message || 'Unable to validate assigned trainer.' };
  }

  if (!Array.isArray(response.body) || !response.body.length) {
    return { error: 'Assigned trainer is not valid.' };
  }

  return { error: null };
}

async function createAuthUser(env, payload, temporaryPassword) {
  const response = await requestJson(`${env.url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      ...serviceHeaders(env),
      'Content-Type': 'application/json'
    },
    body: {
      email: payload.email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        fullname: payload.fullname,
        full_name: payload.fullname,
        phone: payload.phone || null,
        role: payload.role,
        account_status: payload.account_status,
        assigned_trainer: payload.assigned_trainer,
        gym_id: payload.gym_id
      }
    }
  });

  if (!response.ok) {
    return {
      user: null,
      error: response.body?.msg || response.body?.message || response.body?.error_description || 'Unable to create auth user.'
    };
  }

  return { user: response.body?.user || response.body, error: null };
}

async function createProfile(env, authId, payload) {
  const response = await requestJson(`${env.url}/rest/v1/users?on_conflict=id`, {
    method: 'POST',
    headers: {
      ...serviceHeaders(env),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: {
      id: authId,
      gym_id: payload.gym_id,
      fullname: payload.fullname,
      email: payload.email,
      phone: payload.phone,
      role: payload.role,
      account_status: payload.account_status,
      assigned_trainer: payload.assigned_trainer,
      created_at: new Date().toISOString()
    }
  });

  if (!response.ok) {
    return { profile: null, error: response.body?.message || response.bodyText || 'Unable to create user profile.' };
  }

  return { profile: Array.isArray(response.body) ? response.body[0] || null : null, error: null };
}

async function deleteAuthUser(env, authId) {
  try {
    await requestJson(`${env.url}/auth/v1/admin/users/${authId}`, {
      method: 'DELETE',
      headers: serviceHeaders(env)
    });
  } catch (error) {
    return null;
  }

  return null;
}

function parsePayload(body) {
  let parsed = null;

  try {
    parsed = JSON.parse(body || '{}');
  } catch (error) {
    return { error: 'Request body must be valid JSON.' };
  }

  const fullname = String(parsed?.fullname || '').trim();
  const email = String(parsed?.email || '').trim().toLowerCase();
  const phone = normalizeNullableText(parsed?.phone);
  const role = String(parsed?.role || '').trim().toLowerCase();
  const accountStatus = String(parsed?.account_status || 'active').trim().toLowerCase();
  const assignedTrainer = normalizeNullableText(parsed?.assigned_trainer);

  if (!fullname) {
    return { error: 'Full name is required.' };
  }

  if (!email || !email.includes('@')) {
    return { error: 'A valid email address is required.' };
  }

  if (!ALLOWED_CREATE_ROLES.has(role)) {
    return { error: 'Role must be member, trainer, or admin.' };
  }

  if (!ALLOWED_ACCOUNT_STATUSES.has(accountStatus)) {
    return { error: 'Status must be active, suspended, or disabled.' };
  }

  return {
    value: {
      fullname,
      email,
      phone,
      role,
      account_status: accountStatus,
      assigned_trainer: role === 'member' ? assignedTrainer : null
    }
  };
}

function createDefaultPassword(role, date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);

  return `${role}${month}${year}`;
}

function serviceHeaders(env) {
  return {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`
  };
}

function normalizeNullableText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
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

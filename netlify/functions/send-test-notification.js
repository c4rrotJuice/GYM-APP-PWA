const crypto = require('node:crypto');
const https = require('node:https');

const PUSH_SUBSCRIPTION_COLUMNS = 'id, endpoint, p256dh, auth';
const TEST_NOTIFICATION_PAYLOAD = {
  title: 'Gym PWA',
  body: 'Test notification delivered.',
  url: '/app.html#settings'
};
const DEFAULT_VAPID_SUBJECT = 'mailto:notifications@gym-pwa.local';
const PUSH_RECORD_SIZE = 4096;

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

    const subscriptions = await getActiveSubscriptions(env.value, currentUser.user.id);
    if (subscriptions.error) {
      return jsonResponse(500, { error: subscriptions.error });
    }

    if (!subscriptions.items.length) {
      return jsonResponse(404, { error: 'No active push subscription found for this account.' });
    }

    const results = await Promise.all(subscriptions.items.map((subscription) => (
      sendPushPing(env.value, subscription)
        .then((result) => ({ subscription, result }))
        .catch((error) => ({ subscription, result: { ok: false, status: 0, error: error.message } }))
    )));
    const expiredSubscriptions = results.filter(({ result }) => [404, 410].includes(result.status));

    await Promise.all(expiredSubscriptions.map(({ subscription }) => (
      deactivateSubscription(env.value, currentUser.user.id, subscription.endpoint)
    )));

    const sentCount = results.filter(({ result }) => result.ok).length;
    if (!sentCount) {
      return jsonResponse(502, {
        error: 'No push service accepted the test notification.',
        attempted: results.length,
        expired: expiredSubscriptions.length
      });
    }

    return jsonResponse(200, {
      sent: sentCount,
      attempted: results.length,
      expired: expiredSubscriptions.length
    });
  } catch (error) {
    console.error('Test notification failed:', error);
    return jsonResponse(500, {
      error: error?.message || 'Unable to send test notification.'
    });
  }
};

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

function sendPushPing(env, subscription) {
  return new Promise((resolve, reject) => {
    const endpoint = subscription.endpoint;
    const endpointUrl = new URL(endpoint);
    const pushRequest = createPushRequest({
      audience: endpointUrl.origin,
      endpoint,
      subscription,
      payload: TEST_NOTIFICATION_PAYLOAD,
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

function createPushRequest({
  audience,
  endpoint,
  subscription,
  payload,
  vapidPublicKey,
  vapidPrivateKey,
  vapidSubject
}) {
  const body = encryptPushPayload({
    payload,
    userPublicKey: subscription.p256dh,
    userAuthSecret: subscription.auth
  });

  return {
    endpoint,
    headers: {
      Authorization: createVapidAuthorizationHeader({
        audience,
        subject: vapidSubject,
        publicKey: vapidPublicKey,
        privateKey: vapidPrivateKey
      }),
      TTL: '60',
      Urgency: 'normal',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': body.length
    },
    body
  };
}

function encryptPushPayload({ payload, userPublicKey, userAuthSecret }) {
  const userPublicKeyBytes = base64UrlDecode(userPublicKey);
  const userAuthSecretBytes = base64UrlDecode(userAuthSecret);

  if (userPublicKeyBytes.length !== 65 || userPublicKeyBytes[0] !== 4) {
    throw new Error('Push subscription public key is not valid.');
  }

  if (!userAuthSecretBytes.length) {
    throw new Error('Push subscription auth secret is not valid.');
  }

  const salt = crypto.randomBytes(16);
  const serverKey = crypto.createECDH('prime256v1');
  serverKey.generateKeys();
  const serverPublicKey = serverKey.getPublicKey();
  const sharedSecret = serverKey.computeSecret(userPublicKeyBytes);
  const content = Buffer.from(JSON.stringify(payload), 'utf8');
  const plaintext = Buffer.concat([content, Buffer.from([0x02])]);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'),
    userPublicKeyBytes,
    serverPublicKey
  ]);
  const ikm = hkdf({
    key: sharedSecret,
    salt: userAuthSecretBytes,
    info: keyInfo,
    length: 32
  });
  const contentEncryptionKey = hkdf({
    key: ikm,
    salt,
    info: Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'),
    length: 16
  });
  const nonce = hkdf({
    key: ikm,
    salt,
    info: Buffer.from('Content-Encoding: nonce\0', 'utf8'),
    length: 12
  });
  const cipher = crypto.createCipheriv('aes-128-gcm', contentEncryptionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);

  salt.copy(header, 0);
  header.writeUInt32BE(PUSH_RECORD_SIZE, 16);
  header.writeUInt8(serverPublicKey.length, 20);

  return Buffer.concat([header, serverPublicKey, ciphertext]);
}

function hkdf({ key, salt, info, length }) {
  const pseudorandomKey = crypto.createHmac('sha256', salt).update(key).digest();
  const chunks = [];
  let previous = Buffer.alloc(0);
  let counter = 1;

  while (Buffer.concat(chunks).length < length) {
    previous = crypto
      .createHmac('sha256', pseudorandomKey)
      .update(Buffer.concat([previous, info, Buffer.from([counter])]))
      .digest();
    chunks.push(previous);
    counter += 1;
  }

  return Buffer.concat(chunks).subarray(0, length);
}

function createVapidAuthorizationHeader({ audience, subject, publicKey, privateKey }) {
  const jwt = createVapidJwt({ audience, subject, publicKey, privateKey });
  return `vapid t=${jwt}, k=${publicKey}`;
}

function createVapidJwt({ audience, subject, publicKey, privateKey }) {
  const header = base64UrlJson({ typ: 'JWT', alg: 'ES256' });
  const payload = base64UrlJson({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject
  });
  const signingInput = `${header}.${payload}`;
  const signer = crypto.createSign('SHA256');

  signer.update(signingInput);
  signer.end();

  const signature = signer.sign({
    key: createPrivateKeyFromVapid(privateKey, publicKey),
    format: 'jwk',
    dsaEncoding: 'ieee-p1363'
  });

  return `${signingInput}.${base64Url(signature)}`;
}

function createPrivateKeyFromVapid(privateKey, publicKey) {
  const privateBytes = base64UrlDecode(privateKey);
  const publicBytes = base64UrlDecode(publicKey);

  if (privateBytes.length !== 32 || publicBytes.length !== 65 || publicBytes[0] !== 4) {
    throw new Error('VAPID keypair is not valid.');
  }

  return {
    kty: 'EC',
    crv: 'P-256',
    d: privateKey,
    x: base64Url(publicBytes.subarray(1, 33)),
    y: base64Url(publicBytes.subarray(33, 65))
  };
}

function base64UrlJson(value) {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
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
  createPushRequest,
  createPrivateKeyFromVapid,
  createVapidAuthorizationHeader,
  createVapidJwt,
  encryptPushPayload
};

exports.createPushRequest = createPushRequest;

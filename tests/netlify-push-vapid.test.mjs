import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { __test } = require('../netlify/functions/send-test-notification.js');

const keypair = createVapidKeypair();
const jwt = __test.createVapidJwt({
  audience: 'https://push.example',
  subject: 'mailto:test@example.com',
  publicKey: keypair.publicKey,
  privateKey: keypair.privateKey
});
const [header, payload, signature] = jwt.split('.');

assert.equal(JSON.parse(base64UrlDecode(header).toString('utf8')).alg, 'ES256', 'VAPID JWT uses ES256');
assert.equal(JSON.parse(base64UrlDecode(payload).toString('utf8')).aud, 'https://push.example', 'VAPID JWT scopes the push service origin');
assert.ok(signature, 'VAPID JWT includes a signature');

const authorization = __test.createVapidAuthorizationHeader({
  audience: 'https://push.example',
  subject: 'mailto:test@example.com',
  publicKey: keypair.publicKey,
  privateKey: keypair.privateKey
});

assert.match(authorization, /^vapid t=.+, k=.+$/, 'VAPID authorization header matches the Web Push format');
assert.ok(authorization.endsWith(`k=${keypair.publicKey}`), 'VAPID authorization header includes the public key');

const browserKeys = createVapidKeypair();
const pushRequest = __test.createPushRequest({
  audience: 'https://push.example',
  endpoint: 'https://push.example/subscription-1',
  subscription: {
    endpoint: 'https://push.example/subscription-1',
    p256dh: browserKeys.publicKey,
    auth: base64Url(crypto.randomBytes(16))
  },
  payload: {
    title: 'Gym PWA',
    body: 'Test notification delivered.',
    url: '/app.html#settings'
  },
  vapidPublicKey: keypair.publicKey,
  vapidPrivateKey: keypair.privateKey,
  vapidSubject: 'mailto:test@example.com'
});

assert.equal(pushRequest.endpoint, 'https://push.example/subscription-1', 'push request keeps the target endpoint');
assert.equal(pushRequest.headers['Content-Encoding'], 'aes128gcm', 'push request uses encrypted Web Push encoding');
assert.equal(pushRequest.headers['Content-Type'], 'application/octet-stream', 'push request sends binary encrypted content');
assert.equal(pushRequest.headers.TTL, '60', 'push request sets a short TTL for test notifications');
assert.equal(pushRequest.headers['Content-Length'], pushRequest.body.length, 'push request content length matches encrypted body');
assert.equal(pushRequest.body.subarray(16, 20).readUInt32BE(), 4096, 'encrypted payload includes the expected record size');
assert.equal(pushRequest.body.readUInt8(20), 65, 'encrypted payload includes the server public key length');
assert.ok(pushRequest.body.length > 86, 'encrypted payload includes header, server key, ciphertext, and auth tag');

console.log('PASS - Netlify VAPID signing tests');

function createVapidKeypair() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();

  return {
    publicKey: base64Url(ecdh.getPublicKey()),
    privateKey: base64Url(ecdh.getPrivateKey())
  };
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

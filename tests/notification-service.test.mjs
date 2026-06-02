import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = await mkdtemp(join(tmpdir(), 'gym-notification-tests-'));
const moduleDir = join(tempDir, 'scripts');
const modulePath = join(moduleDir, 'notification-service.mjs');

await writeFile(join(tempDir, 'package.json'), '{"type":"module"}\n');
await mkdir(moduleDir, { recursive: true });
await copyFile(new URL('../scripts/notification-service.js', import.meta.url), modulePath);
await writeFile(join(moduleDir, 'supabase.js'), `
export async function getSupabaseClientReady() {
  return globalThis.__notificationTestClient || null;
}
`);

const {
  getActiveSubscriptions,
  getUserSubscriptions,
  removeSubscription,
  saveSubscription
} = await import(modulePath);

const operations = [];
globalThis.__notificationTestClient = createSupabaseClient(operations);

const pushSubscription = {
  endpoint: ' https://push.example/subscription-1 ',
  toJSON() {
    return {
      keys: {
        p256dh: 'p256dh-key',
        auth: 'auth-key'
      }
    };
  }
};

const saveResult = await saveSubscription(pushSubscription);

assert.equal(saveResult.error, null, 'saving a subscription succeeds');
assert.equal(saveResult.subscription.active, true, 'saved subscriptions are normalized as active booleans');
assert.deepEqual(
  operations.at(-1),
  {
    table: 'push_subscriptions',
    filters: [],
    type: 'upsert',
    values: {
      user_id: 'user-1',
      endpoint: 'https://push.example/subscription-1',
      p256dh: 'p256dh-key',
      auth: 'auth-key',
      active: true
    },
    options: { onConflict: 'user_id,endpoint' },
    select: 'id, user_id, endpoint, p256dh, auth, created_at, active'
  },
  'saveSubscription upserts the normalized Push API payload'
);

const removeResult = await removeSubscription('https://push.example/subscription-1');

assert.equal(removeResult.error, null, 'removing a subscription succeeds');
assert.equal(removeResult.subscription.active, false, 'removed subscriptions are normalized as inactive');
assert.deepEqual(
  operations.at(-1).filters,
  [
    ['user_id', 'user-1'],
    ['endpoint', 'https://push.example/subscription-1']
  ],
  'removeSubscription scopes the update to the current user and endpoint'
);

const userSubscriptionsResult = await getUserSubscriptions();

assert.equal(userSubscriptionsResult.error, null, 'listing user subscriptions succeeds');
assert.deepEqual(
  operations.at(-1).filters,
  [['user_id', 'user-1']],
  'getUserSubscriptions filters by the authenticated user'
);
assert.equal(userSubscriptionsResult.subscriptions[0].active, false, 'listed subscriptions normalize active state');

const activeSubscriptionsResult = await getActiveSubscriptions('user-2');

assert.equal(activeSubscriptionsResult.error, null, 'listing active subscriptions succeeds');
assert.deepEqual(
  operations.at(-1).filters,
  [
    ['active', true],
    ['user_id', 'user-2']
  ],
  'getActiveSubscriptions filters by active state and optional user'
);

console.log('PASS - notification subscription service tests');

function createSupabaseClient(operationLog) {
  const row = {
    id: 'sub-1',
    user_id: 'user-1',
    endpoint: 'https://push.example/subscription-1',
    p256dh: 'p256dh-key',
    auth: 'auth-key',
    created_at: '2026-06-03T00:00:00Z',
    active: false
  };

  return {
    auth: {
      async getUser() {
        return {
          data: {
            user: {
              id: 'user-1'
            }
          },
          error: null
        };
      }
    },
    from(table) {
      const operation = {
        table,
        filters: []
      };
      operationLog.push(operation);

      return createQueryBuilder(operation, row);
    }
  };
}

function createQueryBuilder(operation, row) {
  const builder = {
    data: [row],
    error: null,
    select(columns) {
      operation.select = columns;
      return this;
    },
    upsert(values, options) {
      operation.type = 'upsert';
      operation.values = values;
      operation.options = options;
      this.data = {
        id: 'sub-1',
        created_at: '2026-06-03T00:00:00Z',
        ...values
      };
      return this;
    },
    update(values) {
      operation.type = 'update';
      operation.values = values;
      this.data = {
        ...row,
        ...values
      };
      return this;
    },
    eq(column, value) {
      operation.filters.push([column, value]);
      return this;
    },
    order(column, options) {
      operation.order = [column, options];
      return this;
    },
    single() {
      return Promise.resolve({
        data: this.data,
        error: this.error
      });
    },
    maybeSingle() {
      return Promise.resolve({
        data: this.data,
        error: this.error
      });
    },
    then(resolve, reject) {
      return Promise.resolve({
        data: Array.isArray(this.data) ? this.data : [this.data],
        error: this.error
      }).then(resolve, reject);
    }
  };

  return builder;
}

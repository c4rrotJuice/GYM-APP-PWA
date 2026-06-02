import assert from 'node:assert/strict';
import { mkdtemp, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = await mkdtemp(join(tmpdir(), 'gym-analytics-tests-'));
const analyticsModulePath = join(tempDir, 'analytics-logic.mjs');

await copyFile(new URL('../scripts/analytics-logic.js', import.meta.url), analyticsModulePath);
await writeFile(join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }));
await Promise.all([
  copyFile(new URL('../scripts/analytics.js', import.meta.url), join(tempDir, 'analytics.js')),
  copyFile(new URL('../scripts/analytics-logic.js', import.meta.url), join(tempDir, 'analytics-logic.js')),
  copyFile(new URL('../scripts/tenant-queries.js', import.meta.url), join(tempDir, 'tenant-queries.js')),
  copyFile(new URL('../scripts/supabase.js', import.meta.url), join(tempDir, 'supabase.js')),
  copyFile(new URL('../scripts/permissions.js', import.meta.url), join(tempDir, 'permissions.js')),
  copyFile(new URL('../scripts/env.js', import.meta.url), join(tempDir, 'env.js'))
]);

const {
  normalizeDailyStats,
  normalizeStatDate
} = await import(analyticsModulePath);

assert.equal(
  normalizeStatDate('2026-06-02T15:30:00Z'),
  '2026-06-02',
  'date strings normalize to date-only values'
);

assert.equal(
  normalizeStatDate(new Date('2026-06-02T15:30:00Z')),
  '2026-06-02',
  'Date instances normalize to UTC date-only values'
);

assert.throws(
  () => normalizeStatDate('2026-02-31'),
  /valid statistics date/,
  'invalid calendar dates are rejected'
);

assert.deepEqual(
  normalizeDailyStats({
    id: 'stats-id',
    gym_id: 'gym-id',
    stat_date: '2026-06-02',
    active_members: '7',
    attendance_count: '4',
    revenue_amount: '1250.456',
    inactive_members: null,
    created_at: '2026-06-02T00:00:00Z'
  }),
  {
    id: 'stats-id',
    gym_id: 'gym-id',
    stat_date: '2026-06-02',
    active_members: 7,
    attendance_count: 4,
    revenue_amount: 1250.46,
    inactive_members: 0,
    created_at: '2026-06-02T00:00:00Z'
  },
  'daily statistics rows are normalized for service consumers'
);

globalThis.__GYM_PWA_ENV__ = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key'
};

const rpcCalls = [];
const storedDailyStats = new Map();
let attendanceRows = [];
let userRows = [];
const tableCalls = [];
globalThis.supabase = {
  createClient() {
    return {
      from(table) {
        const filters = {};
        const rangeFilters = [];
        const orders = [];
        tableCalls.push({ table, filters });

        return {
          select(columns) {
            tableCalls[tableCalls.length - 1].columns = columns;
            return this;
          },
          eq(column, value) {
            filters[column] = value;
            return this;
          },
          gte(column, value) {
            rangeFilters.push({ type: 'gte', column, value });
            return this;
          },
          lte(column, value) {
            rangeFilters.push({ type: 'lte', column, value });
            return this;
          },
          order(column, options = {}) {
            orders.push({ column, options });
            tableCalls[tableCalls.length - 1].orders = [...orders];
            return Promise.resolve({
              data: applyTableQuery(table, filters, rangeFilters, orders),
              error: null
            });
          },
          maybeSingle() {
            const key = `${filters.gym_id}:${filters.stat_date}`;
            return Promise.resolve({
              data: storedDailyStats.get(key) || null,
              error: null
            });
          }
        };
      },
      rpc(functionName, params) {
        rpcCalls.push({ functionName, params });

        if (functionName === 'calculate_daily_stats') {
          return Promise.resolve({
            data: [{
              gym_id: 'gym-id',
              stat_date: params.stat_on,
              active_members: '3',
              attendance_count: '2',
              revenue_amount: '99.999',
              inactive_members: '1'
            }],
            error: null
          });
        }

        if (functionName === 'upsert_daily_stats') {
          return Promise.resolve({
            data: {
              id: 'stats-id',
              gym_id: 'gym-id',
              stat_date: params.stat_on,
              active_members: 3,
              attendance_count: 2,
              revenue_amount: '100',
              inactive_members: 1,
              created_at: '2026-06-02T00:00:00Z'
            },
            error: null
          });
        }

        return Promise.resolve({ data: null, error: new Error('Unexpected RPC') });
      }
    };
  }
};

const {
  calculateDailyStats,
  getActiveMembersMetric,
  getAttendanceSnapshot,
  getInactiveMembers,
  getInactiveMembersMetric,
  getLastSeenData,
  getMemberAttendanceFrequency,
  getPeakAttendanceHours,
  getRevenueSnapshot,
  upsertDailyStats
} = await import(join(tempDir, 'analytics.js'));

const appContext = {
  role: 'admin',
  gymId: 'gym-id',
  user: { id: 'admin-id' }
};

assert.deepEqual(
  await calculateDailyStats('2026-06-02T15:30:00Z', { appContext }),
  {
    stats: {
      id: null,
      gym_id: 'gym-id',
      stat_date: '2026-06-02',
      active_members: 3,
      attendance_count: 2,
      revenue_amount: 100,
      inactive_members: 1,
      created_at: null
    },
    error: null
  },
  'calculateDailyStats calls the statistics RPC and normalizes aggregate rows'
);

assert.deepEqual(
  await upsertDailyStats(new Date('2026-06-02T15:30:00Z'), { appContext }),
  {
    stats: {
      id: 'stats-id',
      gym_id: 'gym-id',
      stat_date: '2026-06-02',
      active_members: 3,
      attendance_count: 2,
      revenue_amount: 100,
      inactive_members: 1,
      created_at: '2026-06-02T00:00:00Z'
    },
    error: null
  },
  'upsertDailyStats calls the upsert RPC and normalizes the stored row'
);

assert.deepEqual(
  rpcCalls,
  [
    { functionName: 'calculate_daily_stats', params: { stat_on: '2026-06-02' } },
    { functionName: 'upsert_daily_stats', params: { stat_on: '2026-06-02' } }
  ],
  'analytics service functions pass normalized dates to the expected RPCs'
);

rpcCalls.length = 0;
tableCalls.length = 0;
storedDailyStats.clear();
storedDailyStats.set('gym-id:2026-06-02', {
  gym_id: 'gym-id',
  stat_date: '2026-06-02',
  active_members: '10',
  attendance_count: '8',
  revenue_amount: '250.25',
  inactive_members: '2'
});
storedDailyStats.set('gym-id:2026-06-01', {
  gym_id: 'gym-id',
  stat_date: '2026-06-01',
  active_members: '7',
  attendance_count: '3',
  revenue_amount: '125',
  inactive_members: '4'
});

assert.deepEqual(
  await getActiveMembersMetric({ appContext, date: '2026-06-02' }),
  {
    value: 10,
    trend: 3,
    previousValue: 7
  },
  'active member metric prefers stored daily statistics and returns a typed metric object'
);

assert.deepEqual(
  await getRevenueSnapshot({ appContext, date: '2026-06-02' }),
  {
    value: 250.25,
    trend: 125.25,
    previousValue: 125
  },
  'revenue snapshot returns current value, trend, and previous value'
);

assert.equal(rpcCalls.length, 0, 'stored daily statistics avoid live calculation calls');

storedDailyStats.clear();
rpcCalls.length = 0;

assert.deepEqual(
  await getAttendanceSnapshot({ appContext, date: '2026-06-02' }),
  {
    value: 2,
    trend: 0,
    previousValue: 2
  },
  'attendance snapshot falls back to live daily statistics calculations'
);

assert.deepEqual(
  rpcCalls,
  [
    { functionName: 'calculate_daily_stats', params: { stat_on: '2026-06-02' } },
    { functionName: 'calculate_daily_stats', params: { stat_on: '2026-06-01' } }
  ],
  'live fallback calculates both current and previous daily statistics'
);

const cacheCalls = [];
const cache = {
  get(key) {
    cacheCalls.push({ type: 'get', key });
    return {
      value: '9',
      trend: '4',
      previousValue: '5'
    };
  },
  set(key, value) {
    cacheCalls.push({ type: 'set', key, value });
  }
};

rpcCalls.length = 0;
tableCalls.length = 0;

assert.deepEqual(
  await getInactiveMembersMetric({ appContext, date: '2026-06-02', cache }),
  {
    value: 9,
    trend: 4,
    previousValue: 5
  },
  'inactive member metric can be served from an injected cache hook'
);

assert.equal(rpcCalls.length, 0, 'cache hit avoids live calculation calls');
assert.equal(tableCalls.length, 0, 'cache hit avoids stored statistics reads');
assert.deepEqual(
  cacheCalls,
  [{
    type: 'get',
    key: 'analytics:dashboard:gym-id:inactive_members:2026-06-02'
  }],
  'cache hook receives a stable tenant-scoped metric key'
);

attendanceRows = [
  {
    id: 'log-1',
    gym_id: 'gym-id',
    user_id: 'member-1',
    attendance_date: '2026-06-01',
    attended_at: '2026-06-01T06:15:00.000Z',
    source: 'qr_scan'
  },
  {
    id: 'log-2',
    gym_id: 'gym-id',
    user_id: 'member-2',
    attendance_date: '2026-06-01',
    attended_at: '2026-06-01T06:45:00.000Z',
    source: 'admin_manual'
  },
  {
    id: 'log-3',
    gym_id: 'gym-id',
    user_id: 'member-1',
    attendance_date: '2026-06-03',
    attended_at: '2026-06-03T17:05:00.000Z',
    source: 'qr_scan'
  },
  {
    id: 'log-4',
    gym_id: 'gym-id',
    user_id: 'member-1',
    attendance_date: '2026-06-08',
    attended_at: '2026-06-08T17:15:00.000Z',
    source: 'trainer_manual'
  },
  {
    id: 'other-gym-log',
    gym_id: 'other-gym',
    user_id: 'member-1',
    attendance_date: '2026-06-01',
    attended_at: '2026-06-01T06:00:00.000Z',
    source: 'qr_scan'
  }
];
userRows = [
  {
    id: 'member-1',
    gym_id: 'gym-id',
    fullname: 'Active Recent',
    email: 'recent@example.com',
    role: 'member',
    account_status: 'active'
  },
  {
    id: 'member-2',
    gym_id: 'gym-id',
    fullname: 'Inactive Old',
    email: 'old@example.com',
    role: 'member',
    account_status: 'active'
  },
  {
    id: 'member-3',
    gym_id: 'gym-id',
    fullname: 'Never Seen',
    email: 'never@example.com',
    role: 'member',
    account_status: 'active'
  },
  {
    id: 'trainer-1',
    gym_id: 'gym-id',
    fullname: 'Trainer',
    email: 'trainer@example.com',
    role: 'trainer',
    account_status: 'active'
  }
];
tableCalls.length = 0;

assert.deepEqual(
  await getPeakAttendanceHours({ appContext }),
  {
    peakHour: 6,
    peakHourLabel: '06:00',
    totalVisits: 4,
    hours: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: hour === 6 ? 2 : hour === 17 ? 2 : 0
    }))
  },
  'peak attendance groups tenant attendance logs by hour'
);

assert.deepEqual(
  await getMemberAttendanceFrequency('member-1', { appContext }),
  {
    memberId: 'member-1',
    totalVisits: 3,
    weekCount: 2,
    visitsPerWeek: 1.5,
    weeks: [
      { weekStart: '2026-06-01', visits: 2 },
      { weekStart: '2026-06-08', visits: 1 }
    ]
  },
  'member attendance frequency returns visits per week'
);

assert.deepEqual(
  await getLastSeenData('member-1', { appContext }),
  {
    memberId: 'member-1',
    lastSeenAt: '2026-06-08T17:15:00.000Z',
    lastAttendanceDate: '2026-06-08',
    source: 'trainer_manual',
    attendanceLogId: 'log-4'
  },
  'last seen data returns the most recent attendance record for a member'
);

assert.deepEqual(
  await getInactiveMembers(2, { appContext, referenceDate: '2026-06-10T00:00:00.000Z' }),
  [
    {
      memberId: 'member-3',
      fullname: 'Never Seen',
      email: 'never@example.com',
      lastSeenAt: null,
      lastAttendanceDate: null,
      daysInactive: null
    },
    {
      memberId: 'member-2',
      fullname: 'Inactive Old',
      email: 'old@example.com',
      lastSeenAt: '2026-06-01T06:45:00.000Z',
      lastAttendanceDate: '2026-06-01',
      daysInactive: 8
    }
  ],
  'inactive members are active members whose last attendance is older than the threshold'
);

console.log('PASS - analytics date and statistics normalization tests');

function applyTableQuery(table, filters, rangeFilters = [], orders = []) {
  const source = table === 'attendance_logs' ? attendanceRows : table === 'users' ? userRows : [];
  let rows = source.filter((row) => Object.entries(filters).every(([column, value]) => row[column] === value));

  rows = rows.filter((row) => rangeFilters.every((filter) => {
    if (filter.type === 'gte') {
      return row[filter.column] >= filter.value;
    }

    if (filter.type === 'lte') {
      return row[filter.column] <= filter.value;
    }

    return true;
  }));

  orders.slice().reverse().forEach(({ column, options }) => {
    rows = [...rows].sort((left, right) => {
      const leftValue = left[column] || '';
      const rightValue = right[column] || '';
      const direction = options?.ascending === false ? -1 : 1;

      return leftValue.localeCompare(rightValue) * direction;
    });
  });

  return rows;
}

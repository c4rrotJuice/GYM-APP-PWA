import assert from 'node:assert/strict';
import { mkdtemp, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = await mkdtemp(join(tmpdir(), 'gym-analytics-tests-'));
const analyticsModulePath = join(tempDir, 'analytics-logic.mjs');

await copyFile(new URL('../scripts/analytics-logic.js', import.meta.url), analyticsModulePath);

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

console.log('PASS - analytics date and statistics normalization tests');

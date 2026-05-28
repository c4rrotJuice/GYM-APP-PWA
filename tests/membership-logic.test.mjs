import assert from 'node:assert/strict';
import { mkdtemp, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = await mkdtemp(join(tmpdir(), 'gym-membership-tests-'));
const modulePath = join(tempDir, 'membership-logic.mjs');
await copyFile(new URL('../scripts/membership-logic.js', import.meta.url), modulePath);

const {
  calculateMembershipEndDate,
  calculateRenewalWindow,
  normalizeDurationDays,
  resolveMembershipStatus
} = await import(modulePath);

assert.equal(normalizeDurationDays('weekly'), 7, 'weekly duration resolves to 7 days');
assert.equal(normalizeDurationDays('monthly'), 30, 'monthly duration resolves to 30 days');
assert.equal(normalizeDurationDays('custom', 45), 45, 'custom duration uses provided days');
assert.equal(calculateMembershipEndDate('2026-05-29', 'weekly'), '2026-06-05', 'weekly expiry is deterministic');
assert.equal(calculateMembershipEndDate('2026-05-29', 'monthly'), '2026-06-28', 'monthly expiry is deterministic');

assert.equal(
  resolveMembershipStatus({ status: 'active', start_date: '2026-05-01', end_date: '2026-05-28' }, { asOf: '2026-05-29' }),
  'expired',
  'expired active rows resolve as expired'
);
assert.equal(
  resolveMembershipStatus({ status: 'suspended', start_date: '2026-05-01', end_date: '2026-06-01' }, { asOf: '2026-05-29' }),
  'suspended',
  'suspended memberships remain suspended'
);
assert.equal(
  resolveMembershipStatus({ status: 'active', start_date: '2026-06-01', end_date: '2026-07-01' }, { asOf: '2026-05-29' }),
  'pending',
  'future memberships resolve as pending'
);

assert.deepEqual(
  calculateRenewalWindow([
    { id: 'current', status: 'active', start_date: '2026-05-01', end_date: '2026-05-31' }
  ], { duration_type: 'weekly', duration_days: 7 }, { asOf: '2026-05-29' }),
  {
    mode: 'extend',
    renewedMembershipId: 'current',
    startDate: '2026-06-01',
    endDate: '2026-06-08'
  },
  'renewing before expiry extends from the current expiry'
);

assert.deepEqual(
  calculateRenewalWindow([
    { id: 'expired', status: 'active', start_date: '2026-04-01', end_date: '2026-04-30' }
  ], { duration_type: 'weekly', duration_days: 7 }, { asOf: '2026-05-29' }),
  {
    mode: 'new',
    renewedMembershipId: null,
    startDate: '2026-05-29',
    endDate: '2026-06-05'
  },
  'renewing after expiry starts today'
);

console.log('PASS - membership duration, expiry, renewal, and status tests');

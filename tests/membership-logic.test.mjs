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
  canAttendGym,
  getDaysUntilExpiry,
  isMembershipExpiringSoon,
  listExpiringSoonMemberships,
  normalizeDurationDays,
  recalculateMembershipStates,
  resolveActiveMembership,
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
assert.equal(
  resolveMembershipStatus({ status: 'pending', start_date: '2026-05-01', end_date: '2026-06-01' }, { asOf: '2026-05-29' }),
  'active',
  'pending memberships become active once started'
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
    { id: 'current', status: 'active', start_date: '2026-05-01', end_date: '2026-05-31' },
    { id: 'pending', status: 'pending', start_date: '2026-06-01', end_date: '2026-06-08' }
  ], { duration_type: 'weekly', duration_days: 7 }, { asOf: '2026-05-29' }),
  {
    mode: 'extend',
    renewedMembershipId: 'pending',
    startDate: '2026-06-09',
    endDate: '2026-06-16'
  },
  'repeat renewal appends after the latest active or pending window'
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

assert.equal(
  resolveActiveMembership([
    { id: 'expired', status: 'active', start_date: '2026-04-01', end_date: '2026-04-30' },
    { id: 'current', status: 'active', start_date: '2026-05-01', end_date: '2026-05-31' },
    { id: 'future', status: 'pending', start_date: '2026-06-01', end_date: '2026-06-08' }
  ], { asOf: '2026-05-29' }).id,
  'current',
  'active membership resolver ignores expired and future records'
);

assert.equal(
  getDaysUntilExpiry({ end_date: '2026-06-02' }, { asOf: '2026-05-29' }),
  4,
  'expiry utility calculates days remaining'
);

assert.equal(
  isMembershipExpiringSoon({ status: 'active', start_date: '2026-05-01', end_date: '2026-06-02' }, { asOf: '2026-05-29', windowDays: 7 }),
  true,
  'expiry warning utility flags active records inside the warning window'
);

assert.equal(
  canAttendGym({ status: 'active', start_date: '2026-05-01', end_date: '2026-06-02' }, { asOf: '2026-05-29' }),
  true,
  'attendance eligibility allows active in-window memberships'
);

assert.equal(
  canAttendGym({ status: 'suspended', start_date: '2026-05-01', end_date: '2026-06-02' }, { asOf: '2026-05-29' }),
  false,
  'attendance eligibility excludes suspended memberships'
);

assert.equal(
  canAttendGym({ status: 'active', start_date: '2026-05-01', end_date: '2026-05-28' }, { asOf: '2026-05-29' }),
  false,
  'attendance eligibility excludes expired memberships even when stored status is stale'
);

assert.deepEqual(
  listExpiringSoonMemberships([
    { id: 'later', status: 'active', start_date: '2026-05-01', end_date: '2026-06-03' },
    { id: 'outside', status: 'active', start_date: '2026-05-01', end_date: '2026-06-20' },
    { id: 'sooner', status: 'active', start_date: '2026-05-01', end_date: '2026-05-31' }
  ], { asOf: '2026-05-29', windowDays: 7 }).map((membership) => membership.id),
  ['sooner', 'later'],
  'expiring soon helper returns active records inside the window ordered by expiry'
);

assert.deepEqual(
  recalculateMembershipStates([
    { id: 'stale-expired', user_id: 'member-1', status: 'active', start_date: '2026-05-01', end_date: '2026-05-28' },
    { id: 'ready', user_id: 'member-2', status: 'pending', start_date: '2026-05-01', end_date: '2026-06-02' },
    { id: 'blocked', user_id: 'member-3', status: 'suspended', start_date: '2026-05-01', end_date: '2026-06-02' }
  ], { asOf: '2026-05-29', windowDays: 7 }).summary,
  {
    total: 3,
    active: 1,
    expired: 1,
    suspended: 1,
    pending: 0,
    cancelled: 0,
    expiringSoon: 1,
    attendanceReady: 1
  },
  'status recalculation summarizes expired, active, suspended, expiring, and attendance-ready states'
);

console.log('PASS - membership duration, expiry, renewal, and status tests');

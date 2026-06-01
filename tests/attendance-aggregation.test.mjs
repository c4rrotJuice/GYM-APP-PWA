import assert from 'node:assert/strict';
import { mkdtemp, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = await mkdtemp(join(tmpdir(), 'gym-attendance-tests-'));
const modulePath = join(tempDir, 'attendance-aggregation.mjs');
await copyFile(new URL('../scripts/attendance-aggregation.js', import.meta.url), modulePath);

const {
  buildAttendanceSummary,
  calculateCurrentAttendanceStreak,
  normalizeAttendanceLog
} = await import(modulePath);

const today = new Date('2026-06-01T12:00:00.000Z');

assert.equal(
  calculateCurrentAttendanceStreak(['2026-06-01', '2026-05-31', '2026-05-30'], { today }),
  3,
  'streak can end today'
);

assert.equal(
  calculateCurrentAttendanceStreak(['2026-05-31', '2026-05-30'], { today }),
  2,
  'streak can end yesterday'
);

assert.equal(
  calculateCurrentAttendanceStreak(['2026-05-30', '2026-05-29'], { today }),
  0,
  'streak is zero when latest attendance is before yesterday'
);

assert.deepEqual(
  normalizeAttendanceLog({ attendance_date: '2026-06-01', source: 'admin_manual' }),
  {
    attendance_date: '2026-06-01',
    attended_at: null,
    source: 'admin_manual'
  },
  'attendance log normalization preserves date-only records'
);

const summary = buildAttendanceSummary([
  { attendance_date: '2026-05-30', attended_at: '2026-05-30T08:00:00.000Z', source: 'qr_scan' },
  { attendance_date: '2026-06-01', attended_at: '2026-06-01T08:00:00.000Z', source: 'trainer_manual' },
  { attendance_date: '2026-05-31', attended_at: '2026-05-31T08:00:00.000Z', source: 'admin_manual' }
], { today });

assert.equal(summary.todayStatus, 'present', 'summary reports today present');
assert.equal(summary.lastLog.attendance_date, '2026-06-01', 'summary exposes latest attendance');
assert.equal(summary.currentStreak, 3, 'summary calculates current streak');
assert.equal(summary.recentLogs.length, 3, 'summary returns recent logs');

console.log('PASS - attendance aggregation tests');

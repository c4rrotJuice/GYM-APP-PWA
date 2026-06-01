const ATTENDANCE_RECENT_LIMIT = 12;

export function calculateCurrentAttendanceStreak(attendanceDates, { today = new Date() } = {}) {
  const dates = new Set(
    (attendanceDates || [])
      .map((value) => normalizeDateKey(value))
      .filter(Boolean)
  );
  const todayKey = toDateKey(today);
  const yesterdayKey = offsetDateKey(todayKey, -1);
  let cursor = dates.has(todayKey) ? todayKey : dates.has(yesterdayKey) ? yesterdayKey : null;
  let streak = 0;

  while (cursor && dates.has(cursor)) {
    streak += 1;
    cursor = offsetDateKey(cursor, -1);
  }

  return streak;
}

export function buildAttendanceSummary(logs, { today = new Date() } = {}) {
  const normalizedLogs = (logs || [])
    .map(normalizeAttendanceLog)
    .filter((log) => log.attendance_date)
    .sort(compareAttendanceLogsDesc);
  const todayKey = toDateKey(today);
  const todayLog = normalizedLogs.find((log) => log.attendance_date === todayKey) || null;
  const lastLog = normalizedLogs[0] || null;
  const attendanceDates = [...new Set(normalizedLogs.map((log) => log.attendance_date))];

  return {
    todayStatus: todayLog ? 'present' : 'absent',
    todayLog,
    lastLog,
    recentLogs: normalizedLogs.slice(0, ATTENDANCE_RECENT_LIMIT),
    currentStreak: calculateCurrentAttendanceStreak(attendanceDates, { today })
  };
}

export function normalizeAttendanceLog(log = {}) {
  return {
    ...log,
    attendance_date: normalizeDateKey(log.attendance_date || log.attended_at),
    attended_at: log.attended_at || null,
    source: log.source || 'unknown'
  };
}

function compareAttendanceLogsDesc(left, right) {
  return getLogTime(right) - getLogTime(left);
}

function getLogTime(log) {
  return new Date(log.attended_at || log.attendance_date || 0).getTime() || 0;
}

function normalizeDateKey(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return value;
  }

  return toDateKey(new Date(value));
}

function toDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toISOString().slice(0, 10);
}

function offsetDateKey(dateKey, offsetDays) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return toDateKey(date);
}

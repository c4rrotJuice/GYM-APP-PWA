import { createQueryContext } from './tenant-queries.js';
import { normalizeDailyStats, normalizeStatDate } from './analytics-logic.js';

export {
  normalizeDailyStats,
  normalizeStatDate
};

const METRIC_FIELDS = {
  activeMembers: 'active_members',
  revenue: 'revenue_amount',
  attendance: 'attendance_count',
  inactiveMembers: 'inactive_members'
};

const ATTENDANCE_INTELLIGENCE_COLUMNS = 'id,gym_id,user_id,attendance_date,attended_at,source';
const MEMBER_INTELLIGENCE_COLUMNS = 'id,gym_id,fullname,email,role,account_status';

export async function calculateDailyStats(date = new Date(), { appContext } = {}) {
  try {
    const queryContext = await createQueryContext(appContext, { action: 'analytics:calculate_daily_stats' });
    const { data, error } = await queryContext.supabase.rpc('calculate_daily_stats', {
      stat_on: normalizeStatDate(date)
    });
    const stats = Array.isArray(data) ? data[0] : data;

    return {
      stats: error ? null : normalizeDailyStats(stats),
      error
    };
  } catch (error) {
    return { stats: null, error };
  }
}

export async function upsertDailyStats(date = new Date(), { appContext } = {}) {
  try {
    const queryContext = await createQueryContext(appContext, { action: 'analytics:upsert_daily_stats' });
    const { data, error } = await queryContext.supabase.rpc('upsert_daily_stats', {
      stat_on: normalizeStatDate(date)
    });

    return {
      stats: error ? null : normalizeDailyStats(data),
      error
    };
  } catch (error) {
    return { stats: null, error };
  }
}

/**
 * @typedef {Object} DashboardMetric
 * @property {number} value
 * @property {number} trend
 * @property {number} previousValue
 */

export async function getActiveMembersMetric(options = {}) {
  return getDashboardMetric(METRIC_FIELDS.activeMembers, options);
}

export async function getRevenueSnapshot(options = {}) {
  return getDashboardMetric(METRIC_FIELDS.revenue, options);
}

export async function getAttendanceSnapshot(options = {}) {
  return getDashboardMetric(METRIC_FIELDS.attendance, options);
}

export async function getInactiveMembersMetric(options = {}) {
  return getDashboardMetric(METRIC_FIELDS.inactiveMembers, options);
}

export async function getPeakAttendanceHours({ appContext, startDate, endDate } = {}) {
  const queryContext = await createQueryContext(appContext, { action: 'analytics:calculate_daily_stats' });
  const logs = await fetchAttendanceLogs(queryContext, { startDate, endDate });
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));

  logs.forEach((log) => {
    const attendedAt = parseAttendanceDateTime(log);

    if (!attendedAt) {
      return;
    }

    hours[attendedAt.getUTCHours()].count += 1;
  });

  const peak = hours.reduce((selected, current) => (
    current.count > selected.count ? current : selected
  ), hours[0]);

  return {
    peakHour: peak.count > 0 ? peak.hour : null,
    peakHourLabel: peak.count > 0 ? formatHourLabel(peak.hour) : null,
    totalVisits: logs.length,
    hours
  };
}

export async function getMemberAttendanceFrequency(memberId, { appContext, startDate, endDate } = {}) {
  const normalizedMemberId = normalizeMemberId(memberId);
  const queryContext = await createQueryContext(appContext, { action: 'analytics:calculate_daily_stats' });
  const logs = await fetchAttendanceLogs(queryContext, { memberId: normalizedMemberId, startDate, endDate });
  const weeksByStart = new Map();

  logs.forEach((log) => {
    const attendedAt = parseAttendanceDateTime(log);

    if (!attendedAt) {
      return;
    }

    const weekStart = getWeekStartKey(attendedAt);
    weeksByStart.set(weekStart, (weeksByStart.get(weekStart) || 0) + 1);
  });

  const weeks = [...weeksByStart.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([weekStart, visits]) => ({ weekStart, visits }));
  const totalVisits = weeks.reduce((total, week) => total + week.visits, 0);

  return {
    memberId: normalizedMemberId,
    totalVisits,
    weekCount: weeks.length,
    visitsPerWeek: weeks.length ? roundNumber(totalVisits / weeks.length) : 0,
    weeks
  };
}

export async function getInactiveMembers(daysThreshold = 30, { appContext, referenceDate = new Date() } = {}) {
  const threshold = normalizeDaysThreshold(daysThreshold);
  const reference = normalizeReferenceDate(referenceDate);
  const cutoffTime = reference.getTime() - threshold * 24 * 60 * 60 * 1000;
  const queryContext = await createQueryContext(appContext, { action: 'analytics:calculate_daily_stats' });
  const [members, logs] = await Promise.all([
    fetchActiveMembers(queryContext),
    fetchAttendanceLogs(queryContext)
  ]);
  const lastSeenByMember = buildLastSeenMap(logs);

  return members
    .map((member) => {
      const lastLog = lastSeenByMember.get(member.id) || null;
      const lastSeenAt = lastLog ? parseAttendanceDateTime(lastLog) : null;

      return {
        memberId: member.id,
        fullname: member.fullname || null,
        email: member.email || null,
        lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
        lastAttendanceDate: lastLog?.attendance_date || null,
        daysInactive: lastSeenAt ? Math.max(0, Math.floor((reference.getTime() - lastSeenAt.getTime()) / (24 * 60 * 60 * 1000))) : null
      };
    })
    .filter((member) => !member.lastSeenAt || new Date(member.lastSeenAt).getTime() < cutoffTime)
    .sort((left, right) => {
      if (!left.lastSeenAt && !right.lastSeenAt) {
        return (left.fullname || left.email || '').localeCompare(right.fullname || right.email || '');
      }

      if (!left.lastSeenAt) {
        return -1;
      }

      if (!right.lastSeenAt) {
        return 1;
      }

      return new Date(left.lastSeenAt).getTime() - new Date(right.lastSeenAt).getTime();
    });
}

export async function getLastSeenData(memberId, { appContext } = {}) {
  const normalizedMemberId = normalizeMemberId(memberId);
  const queryContext = await createQueryContext(appContext, { action: 'analytics:calculate_daily_stats' });
  const logs = await fetchAttendanceLogs(queryContext, { memberId: normalizedMemberId });
  const lastLog = getLatestAttendanceLog(logs);
  const lastSeenAt = lastLog ? parseAttendanceDateTime(lastLog) : null;

  return {
    memberId: normalizedMemberId,
    lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
    lastAttendanceDate: lastLog?.attendance_date || null,
    source: lastLog?.source || null,
    attendanceLogId: lastLog?.id || null
  };
}

async function getDashboardMetric(field, { appContext, date = new Date(), cache } = {}) {
  const queryContext = await createQueryContext(appContext, { action: 'analytics:calculate_daily_stats' });
  const statDate = normalizeStatDate(date);
  const previousDate = getPreviousStatDate(statDate);
  const cacheKey = createMetricCacheKey(queryContext.gymId, field, statDate);
  const cached = await readMetricCache(cache, cacheKey);

  if (cached) {
    return normalizeMetric(cached);
  }

  const [currentStats, previousStats] = await Promise.all([
    getDailyStatsForDate(queryContext, statDate),
    getDailyStatsForDate(queryContext, previousDate)
  ]);

  const metric = normalizeMetric({
    value: currentStats[field],
    previousValue: previousStats[field]
  });

  await writeMetricCache(cache, cacheKey, metric);

  return metric;
}

async function getDailyStatsForDate(queryContext, statDate) {
  const storedStats = await getStoredDailyStats(queryContext, statDate);

  if (storedStats) {
    return storedStats;
  }

  const { data, error } = await queryContext.supabase.rpc('calculate_daily_stats', {
    stat_on: statDate
  });

  if (error) {
    throw error;
  }

  return normalizeDailyStats(Array.isArray(data) ? data[0] : data);
}

async function getStoredDailyStats({ supabase, gymId }, statDate) {
  const { data, error } = await supabase
    .from('daily_statistics')
    .select('id,gym_id,stat_date,active_members,attendance_count,revenue_amount,inactive_members,created_at')
    .eq('gym_id', gymId)
    .eq('stat_date', statDate)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? normalizeDailyStats(data) : null;
}

async function fetchAttendanceLogs({ supabase, gymId }, { memberId, startDate, endDate } = {}) {
  let query = supabase
    .from('attendance_logs')
    .select(ATTENDANCE_INTELLIGENCE_COLUMNS)
    .eq('gym_id', gymId);

  if (memberId) {
    query = query.eq('user_id', memberId);
  }

  if (startDate) {
    query = query.gte('attendance_date', normalizeStatDate(startDate));
  }

  if (endDate) {
    query = query.lte('attendance_date', normalizeStatDate(endDate));
  }

  const { data, error } = await query.order('attended_at', { ascending: false });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
}

async function fetchActiveMembers({ supabase, gymId }) {
  const { data, error } = await supabase
    .from('users')
    .select(MEMBER_INTELLIGENCE_COLUMNS)
    .eq('gym_id', gymId)
    .eq('role', 'member')
    .eq('account_status', 'active')
    .order('fullname', { ascending: true });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
}

function buildLastSeenMap(logs = []) {
  return logs.reduce((lastSeenByMember, log) => {
    if (!log?.user_id) {
      return lastSeenByMember;
    }

    const current = lastSeenByMember.get(log.user_id);

    if (!current || compareAttendanceLogs(log, current) > 0) {
      lastSeenByMember.set(log.user_id, log);
    }

    return lastSeenByMember;
  }, new Map());
}

function getLatestAttendanceLog(logs = []) {
  return logs.reduce((latest, log) => (
    !latest || compareAttendanceLogs(log, latest) > 0 ? log : latest
  ), null);
}

function compareAttendanceLogs(left, right) {
  return getAttendanceTime(left) - getAttendanceTime(right);
}

function parseAttendanceDateTime(log) {
  const value = log?.attended_at || log?.attendance_date;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function getAttendanceTime(log) {
  return parseAttendanceDateTime(log)?.getTime() || 0;
}

function getWeekStartKey(date) {
  const weekStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = weekStart.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  weekStart.setUTCDate(weekStart.getUTCDate() + offset);
  return weekStart.toISOString().slice(0, 10);
}

function formatHourLabel(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function normalizeMemberId(memberId) {
  const normalizedMemberId = String(memberId || '').trim();

  if (!normalizedMemberId) {
    throw new Error('A member ID is required for attendance analytics.');
  }

  return normalizedMemberId;
}

function normalizeDaysThreshold(daysThreshold) {
  const threshold = Number.parseInt(daysThreshold, 10);

  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error('Inactive member threshold must be zero or more days.');
  }

  return threshold;
}

function normalizeReferenceDate(referenceDate) {
  const reference = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);

  if (Number.isNaN(reference.getTime())) {
    throw new Error('A valid reference date is required for inactive member analytics.');
  }

  return reference;
}

function normalizeMetric({ value = 0, previousValue = 0 } = {}) {
  const normalizedValue = normalizeMetricNumber(value);
  const normalizedPreviousValue = normalizeMetricNumber(previousValue);

  return {
    value: normalizedValue,
    trend: Math.round((normalizedValue - normalizedPreviousValue) * 100) / 100,
    previousValue: normalizedPreviousValue
  };
}

function normalizeMetricNumber(value) {
  const number = Number(value || 0);
  return roundNumber(number);
}

function roundNumber(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function getPreviousStatDate(statDate) {
  const date = new Date(`${statDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function createMetricCacheKey(gymId, field, statDate) {
  return `analytics:dashboard:${gymId}:${field}:${statDate}`;
}

async function readMetricCache(cache, key) {
  if (!cache?.get) {
    return null;
  }

  return cache.get(key);
}

async function writeMetricCache(cache, key, value) {
  if (!cache?.set) {
    return;
  }

  await cache.set(key, value);
}

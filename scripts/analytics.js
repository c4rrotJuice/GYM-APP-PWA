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
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
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

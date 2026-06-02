import { createQueryContext } from './tenant-queries.js';
import { normalizeDailyStats, normalizeStatDate } from './analytics-logic.js';

export {
  normalizeDailyStats,
  normalizeStatDate
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

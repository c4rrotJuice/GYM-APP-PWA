export function normalizeDailyStats(stats = {}) {
  return {
    id: stats?.id || null,
    gym_id: stats?.gym_id || null,
    stat_date: stats?.stat_date || null,
    active_members: normalizeCount(stats?.active_members),
    attendance_count: normalizeCount(stats?.attendance_count),
    revenue_amount: normalizeMoney(stats?.revenue_amount),
    inactive_members: normalizeCount(stats?.inactive_members),
    created_at: stats?.created_at || null
  };
}

export function normalizeStatDate(value = new Date()) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('A valid statistics date is required.');
    }

    return value.toISOString().slice(0, 10);
  }

  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) {
    throw new Error('A valid statistics date is required.');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('A valid statistics date is required.');
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizeCount(value) {
  const count = Number.parseInt(value, 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function normalizeMoney(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

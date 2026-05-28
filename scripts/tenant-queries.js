import { getSupabaseClientReady } from './supabase.js';

const TENANT_SCOPED_TABLES = new Set([
  'users',
  'memberships',
  'attendance_qr_tokens',
  'attendance_logs',
  'payments',
  'workout_programs',
  'user_workouts',
  'progress_logs'
]);

export function getGymIdFromSession(session) {
  return session?.user?.profile?.gym_id || null;
}

export function requireGymId(source) {
  const gymId = typeof source === 'string' ? source : getGymIdFromSession(source);

  if (!gymId) {
    throw new Error('Missing gym context for tenant-scoped query.');
  }

  return gymId;
}

export async function getTenantScopedClient() {
  const supabase = await getSupabaseClientReady();

  if (!supabase) {
    throw new Error('Supabase is not configured for this deployment.');
  }

  return supabase;
}

export function scopedSelect(supabase, table, columns, { gymId, options } = {}) {
  let query = supabase.from(table).select(columns, options);

  if (TENANT_SCOPED_TABLES.has(table)) {
    query = query.eq('gym_id', requireGymId(gymId));
  }

  return query;
}

export function scopedUpdate(supabase, table, values, { gymId } = {}) {
  let query = supabase.from(table).update(values);

  if (TENANT_SCOPED_TABLES.has(table)) {
    query = query.eq('gym_id', requireGymId(gymId));
  }

  return query;
}

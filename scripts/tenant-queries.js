import { getSupabaseClientReady } from './supabase.js';
import { canPerformAction, hasCapability, normalizeRole, requireAction } from './permissions.js';

const TENANT_SCOPED_TABLES = new Set([
  'users',
  'membership_plans',
  'memberships',
  'attendance_qr_tokens',
  'attendance_logs',
  'payments',
  'workout_programs',
  'user_workouts',
  'progress_logs'
]);

export function getGymIdFromSession(session) {
  return session?.gymId || session?.tenantId || session?.profile?.gym_id || session?.user?.profile?.gym_id || null;
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

export async function createQueryContext(source, { action } = {}) {
  const supabase = await getTenantScopedClient();
  const role = normalizeRole(source?.role || source?.profile?.role || source?.user?.profile?.role);
  const user = source?.user || source?.session?.user || null;
  const session = source?.session || source || null;
  const gymId = requireGymId(source?.gymId || source?.tenantId || session);

  if (action) {
    requireAction(role, action);
  }

  return {
    supabase,
    source,
    session,
    user,
    userId: user?.id || session?.user?.id || null,
    role,
    gymId,
    can: (capability) => hasCapability(role, capability),
    canPerform: (actionName) => canPerformAction(role, actionName)
  };
}

export function scopedSelect(supabase, table, columns, { gymId, options } = {}) {
  let query = supabase.from(table).select(columns, options);

  if (TENANT_SCOPED_TABLES.has(table)) {
    query = query.eq('gym_id', requireGymId(gymId));
  }

  return query;
}

export function withTenantScope(table, values, { gymId } = {}) {
  if (!TENANT_SCOPED_TABLES.has(table)) {
    return values;
  }

  const scopedGymId = requireGymId(gymId);

  if (Array.isArray(values)) {
    return values.map((value) => applyTenantScopeToValue(value, scopedGymId));
  }

  return applyTenantScopeToValue(values, scopedGymId);
}

function applyTenantScopeToValue(value, gymId) {
  if (value?.gym_id && value.gym_id !== gymId) {
    throw new Error('Tenant-scoped writes cannot override the active gym context.');
  }

  return {
    ...value,
    gym_id: gymId
  };
}

export function scopedInsert(supabase, table, values, { gymId } = {}) {
  return supabase.from(table).insert(withTenantScope(table, values, { gymId }));
}

export function scopedUpdate(supabase, table, values, { gymId } = {}) {
  const updateValues = { ...values };

  if (TENANT_SCOPED_TABLES.has(table)) {
    const scopedGymId = requireGymId(gymId);

    if (updateValues.gym_id && updateValues.gym_id !== scopedGymId) {
      throw new Error('Tenant-scoped updates cannot override the active gym context.');
    }

    delete updateValues.gym_id;
    return supabase.from(table).update(updateValues).eq('gym_id', scopedGymId);
  }

  return supabase.from(table).update(updateValues);
}

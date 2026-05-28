import { canPerformAction } from './permissions.js';
import { createQueryContext, requireGymId, scopedSelect } from './tenant-queries.js';

const PROFILE_COLUMNS = [
  'id',
  'gym_id',
  'fullname',
  'email',
  'phone',
  'role',
  'assigned_trainer',
  'account_status',
  'created_at',
  'updated_at'
].join(', ');

export async function getTrainerAssignedMembers({ appContext, search = '' } = {}) {
  let queryContext = null;

  try {
    queryContext = await createQueryContext(appContext, { action: 'users:list' });
  } catch (error) {
    return { members: [], error };
  }

  if (!queryContext.userId || !canPerformAction(queryContext.role, 'users:list')) {
    return { members: [], error: new Error('Your account is not allowed to list assigned members.') };
  }

  const gymId = requireGymId(queryContext.gymId);
  let query = scopedSelect(queryContext.supabase, 'users', PROFILE_COLUMNS, { gymId })
    .eq('role', 'member')
    .eq('assigned_trainer', queryContext.userId)
    .order('fullname', { ascending: true });

  const normalizedSearch = String(search || '').trim();
  if (normalizedSearch) {
    const pattern = `%${escapeSearchPattern(normalizedSearch)}%`;
    query = query.or(`fullname.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`);
  }

  const { data, error } = await query;

  if (error) {
    return { members: [], error };
  }

  return { members: (data || []).map(normalizeProfile), error: null };
}

export async function getMemberOperationalProfile({ appContext } = {}) {
  if (!appContext?.profile || !appContext?.user?.id) {
    return { profile: null, error: new Error('No member profile is available for this session.') };
  }

  return {
    profile: normalizeProfile(appContext.profile),
    trainerAssignment: {
      assigned: Boolean(appContext.profile.assigned_trainer),
      trainerId: appContext.profile.assigned_trainer || null
    },
    error: null
  };
}

export async function countScopedRows(table, { appContext, filters = [] } = {}) {
  try {
    const queryContext = await createQueryContext(appContext);
    const gymId = requireGymId(queryContext.gymId);
    let query = scopedSelect(queryContext.supabase, table, 'id', {
      gymId,
      options: { count: 'exact', head: true }
    });

    filters
      .filter((filter) => typeof filter.value !== 'undefined' && filter.value !== null && filter.value !== '')
      .forEach((filter) => {
        query = applyFilter(query, filter);
      });

    const { count, error } = await query;
    return { count: error ? 0 : count || 0, error };
  } catch (error) {
    return { count: 0, error };
  }
}

function applyFilter(query, filter) {
  const operator = filter.operator || 'eq';

  if (operator === 'gte') {
    return query.gte(filter.column, filter.value);
  }

  if (operator === 'lte') {
    return query.lte(filter.column, filter.value);
  }

  if (operator === 'lt') {
    return query.lt(filter.column, filter.value);
  }

  if (operator === 'gt') {
    return query.gt(filter.column, filter.value);
  }

  return query.eq(filter.column, filter.value);
}

function normalizeProfile(profile) {
  return {
    ...profile,
    gym_id: profile.gym_id || null,
    account_status: String(profile.account_status || '').toLowerCase()
  };
}

function escapeSearchPattern(value) {
  return String(value || '')
    .replaceAll(',', ' ')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

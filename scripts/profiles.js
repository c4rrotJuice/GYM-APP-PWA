import { getSupabaseClientReady } from './supabase.js';
import { getRoleCapabilities, normalizeRole } from './permissions.js';
import { createQueryContext, requireGymId, scopedInsert, scopedSelect, scopedUpdate } from './tenant-queries.js';

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

const INACTIVE_ACCOUNT_VALUES = ['suspended', 'disabled', 'inactive'];
const MANAGEABLE_ROLES = new Set(['admin', 'trainer', 'member']);
const DEFAULT_PROFILE_ROLE = 'member';
const DEFAULT_FULLNAME = 'New Member';
const DEFAULT_GYM_SLUG = 'default-gym';

export async function ensureUserProfile(user) {
  const supabase = await getSupabaseClientReady();

  if (!supabase || !user?.id) {
    return { profile: null, error: new Error('Missing authenticated user context.') };
  }

  const existing = await fetchUserProfile(supabase, user.id, { allowMissing: true });
  if (existing.profile || existing.error) {
    return existing;
  }

  const gymId = await getDefaultGymId(supabase);
  if (!gymId) {
    return { profile: null, error: new Error('No active gym is available for profile creation.') };
  }

  const { data, error } = await scopedInsert(
    supabase,
    'users',
    {
      id: user.id,
      fullname: getFullnameFromUser(user),
      email: user.email || '',
      role: DEFAULT_PROFILE_ROLE,
      created_at: new Date().toISOString()
    },
    { gymId }
  )
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    if (isDuplicateProfileError(error)) {
      return fetchUserProfile(supabase, user.id);
    }

    return { profile: null, error };
  }

  return { profile: normalizeProfile(data), error: null };
}

export async function getUserProfile(userId) {
  const supabase = await getSupabaseClientReady();

  if (!supabase || !userId) {
    return { profile: null, error: new Error('Missing authenticated user context.') };
  }

  return fetchUserProfile(supabase, userId);
}

export async function getCurrentUserProfile(supabase, userId) {
  if (!supabase || !userId) {
    return { profile: null, error: new Error('Missing authenticated user context.') };
  }

  return fetchUserProfile(supabase, userId);
}

export async function listUsers({ role, session, appContext, gymId } = {}) {
  let queryContext = null;

  try {
    queryContext = await createQueryContext(appContext || session || { role, gymId }, { action: 'users:list' });
    gymId = requireGymId(gymId || queryContext.gymId);
  } catch (error) {
    return { users: [], error };
  }

  const normalizedRole = normalizeRole(role);
  let query = scopedSelect(queryContext.supabase, 'users', PROFILE_COLUMNS, { gymId })
    .order('fullname', { ascending: true });

  if (!queryContext.can('members:view_all')) {
    if (!queryContext.userId || !queryContext.can('members:view_assigned')) {
      return { users: [], error: new Error('Your account is not allowed to list users.') };
    }

    query = query.eq('assigned_trainer', queryContext.userId).eq('role', 'member');
  }

  if (normalizedRole) {
    query = query.eq('role', normalizedRole);
  }

  const { data, error } = await query;

  if (error) {
    return { users: [], error };
  }

  return { users: (data || []).map(normalizeProfile), error: null };
}

export async function updateUserAssignedTrainer(userId, trainerId, { session, appContext, gymId } = {}) {
  let queryContext = null;

  try {
    queryContext = await createQueryContext(appContext || session, { action: 'users:assign_trainer' });
    gymId = requireGymId(gymId || queryContext.gymId);
  } catch (error) {
    return { profile: null, error };
  }

  if (!userId) {
    return { profile: null, error: new Error('Missing user context for trainer assignment.') };
  }

  const existing = await fetchUserProfile(queryContext.supabase, userId);
  if (existing.error) {
    return existing;
  }

  if (existing.profile.role !== 'member') {
    return {
      profile: null,
      error: new Error('Trainer assignment is only available for member profiles.')
    };
  }

  const assignedTrainer = String(trainerId || '').trim() || null;
  if (assignedTrainer) {
    const trainer = await fetchUserProfile(queryContext.supabase, assignedTrainer);
    if (trainer.error) {
      return { profile: null, error: trainer.error };
    }

    if (
      trainer.profile.role !== 'trainer' ||
      trainer.profile.gym_id !== gymId ||
      isInactiveProfile(trainer.profile)
    ) {
      return {
        profile: null,
        error: new Error('Assigned trainer must be an active trainer profile in this gym.')
      };
    }
  }

  const { data, error } = await scopedUpdate(queryContext.supabase, 'users', {
      assigned_trainer: assignedTrainer,
      updated_at: new Date().toISOString()
    }, { gymId })
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    return { profile: null, error };
  }

  return { profile: normalizeProfile(data), error: null };
}

export async function deactivateUserProfile(userId, { session, appContext, gymId } = {}) {
  let queryContext = null;

  try {
    queryContext = await createQueryContext(appContext || session, { action: 'users:disable' });
    gymId = requireGymId(gymId || queryContext.gymId);
  } catch (error) {
    return { profile: null, error };
  }

  if (!userId) {
    return { profile: null, error: new Error('Missing user context for deactivation.') };
  }

  const existing = await fetchUserProfile(queryContext.supabase, userId);
  if (existing.error) {
    return existing;
  }

  if (!MANAGEABLE_ROLES.has(existing.profile.role)) {
    return { profile: null, error: new Error('This user profile does not have a manageable role.') };
  }

  const { data, error } = await scopedUpdate(queryContext.supabase, 'users', {
      account_status: 'disabled',
      updated_at: new Date().toISOString()
    }, { gymId })
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    return { profile: null, error };
  }

  return { profile: normalizeProfile(data), error: null };
}

async function fetchUserProfile(supabase, userId, { allowMissing = false } = {}) {
  const { data, error } = await supabase
    .from('users')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) {
    if (!error && allowMissing) {
      return { profile: null, error: null };
    }

    return {
      profile: null,
      error: error || new Error('No profile was found for this account.')
    };
  }

  return { profile: normalizeProfile(data), error: null };
}

export function attachProfileToSession(session, profile) {
  if (!session?.user || !profile) {
    return session;
  }

  const normalizedProfile = normalizeProfile(profile);
  const role = normalizedProfile.role;

  return {
    ...session,
    user: attachProfileToUser(session.user, normalizedProfile),
    profile: normalizedProfile,
    role,
    gymId: normalizedProfile.gym_id,
    tenantId: normalizedProfile.gym_id,
    status: normalizedProfile.account_status,
    capabilities: getRoleCapabilities(role)
  };
}

export function attachProfileToUser(user, profile) {
  if (!user || !profile) {
    return user;
  }

  return {
    ...user,
    profile
  };
}

export function getProfileRole(source) {
  return normalizeRole(source?.profile?.role || source?.user?.profile?.role);
}

export function isInactiveProfile(profile) {
  const status = String(profile?.account_status || '').toLowerCase();
  return INACTIVE_ACCOUNT_VALUES.includes(status);
}

function normalizeProfile(profile) {
  return {
    ...profile,
    gym_id: profile.gym_id || null,
    role: normalizeRole(profile.role),
    account_status: String(profile.account_status || '').toLowerCase()
  };
}

async function getDefaultGymId(supabase) {
  const { data, error } = await supabase
    .from('gyms')
    .select('id')
    .eq('slug', DEFAULT_GYM_SLUG)
    .eq('active', true)
    .maybeSingle();

  if (error || !data?.id) {
    return null;
  }

  return data.id;
}

function getFullnameFromUser(user) {
  const metadata = {
    ...(user.user_metadata || {}),
    ...(user.app_metadata || {})
  };

  const directName = metadata.fullname || metadata.full_name || metadata.name || metadata.display_name;
  if (hasText(directName)) {
    return String(directName).trim();
  }

  const combinedName = [metadata.first_name, metadata.last_name]
    .filter(hasText)
    .map((value) => String(value).trim())
    .join(' ');

  return combinedName || DEFAULT_FULLNAME;
}

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function isDuplicateProfileError(error) {
  return error?.code === '23505' || String(error?.message || '').toLowerCase().includes('duplicate');
}

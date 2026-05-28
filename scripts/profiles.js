import { getSupabaseClientReady } from './supabase.js';
import { getRoleCapabilities, normalizeRole } from './permissions.js';
import { createQueryContext, requireGymId, scopedInsert, scopedSelect, scopedUpdate } from './tenant-queries.js';
import { USER_ROLES, USER_STATUSES, normalizeUpdatePayload, normalizeUserStatus } from './admin/users.js';

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
const MANAGEABLE_ROLES = new Set(USER_ROLES);
const MANAGEABLE_STATUSES = new Set(USER_STATUSES);
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

export async function listUsers({ role, status, trainerId, search, session, appContext, gymId } = {}) {
  let queryContext = null;

  try {
    queryContext = await createQueryContext(appContext || session || { role, gymId }, { action: 'users:list' });
    gymId = requireGymId(gymId || queryContext.gymId);
  } catch (error) {
    return { users: [], error };
  }

  const normalizedRole = normalizeRole(role);
  const normalizedStatusResult = nullSafe(() => (
    status && status !== 'all' ? normalizeUserStatus(status) : null
  ));

  if (normalizedStatusResult.error) {
    return { users: [], error: normalizedStatusResult.error };
  }

  const normalizedStatus = normalizedStatusResult.value;
  const normalizedTrainerId = String(trainerId || '').trim();
  const normalizedSearch = String(search || '').trim();
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

  if (normalizedStatus) {
    query = query.eq('account_status', normalizedStatus);
  }

  if (normalizedTrainerId === 'unassigned') {
    query = query.is('assigned_trainer', null);
  } else if (normalizedTrainerId) {
    query = query.eq('assigned_trainer', normalizedTrainerId);
  }

  if (normalizedSearch) {
    const pattern = `%${escapeSearchPattern(normalizedSearch)}%`;
    query = query.or(`fullname.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`);
  }

  const { data, error } = await query;

  if (error) {
    return { users: [], error };
  }

  return { users: (data || []).map(normalizeProfile), error: null };
}

export async function updateUserProfile(userId, payload, { session, appContext, gymId } = {}) {
  let queryContext = null;

  try {
    queryContext = await createQueryContext(appContext || session, { action: 'users:update' });
    gymId = requireGymId(gymId || queryContext.gymId);
  } catch (error) {
    return { profile: null, error };
  }

  if (!userId) {
    return { profile: null, error: new Error('Missing user context for update.') };
  }

  const values = nullSafe(() => normalizeUpdatePayload(payload));
  if (values.error) {
    return { profile: null, error: values.error };
  }

  const existing = await fetchUserProfile(queryContext.supabase, userId);
  if (existing.error) {
    return existing;
  }

  if (existing.profile.gym_id !== gymId) {
    return { profile: null, error: new Error('This profile is outside the active gym.') };
  }

  if (!MANAGEABLE_ROLES.has(existing.profile.role) || !MANAGEABLE_ROLES.has(values.value.role)) {
    return { profile: null, error: new Error('This user profile does not have a manageable role.') };
  }

  if (queryContext.userId === userId) {
    if (values.value.role !== existing.profile.role) {
      return { profile: null, error: new Error('Admins cannot change their own role from this screen.') };
    }

    if (isInactiveProfile(values.value)) {
      return { profile: null, error: new Error('Admins cannot disable their own account from this screen.') };
    }
  }

  if (!MANAGEABLE_STATUSES.has(values.value.account_status)) {
    return { profile: null, error: new Error('This user status is not manageable.') };
  }

  if (values.value.assigned_trainer) {
    const trainerValidation = await validateTrainerAssignment(
      queryContext.supabase,
      values.value.assigned_trainer,
      gymId
    );

    if (trainerValidation.error) {
      return { profile: null, error: trainerValidation.error };
    }
  }

  const updateValues = {
    fullname: values.value.fullname,
    phone: values.value.phone,
    role: values.value.role,
    account_status: values.value.account_status,
    assigned_trainer: values.value.assigned_trainer,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await scopedUpdate(queryContext.supabase, 'users', updateValues, { gymId })
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    return { profile: null, error };
  }

  return { profile: normalizeProfile(data), error: null };
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
    const trainerValidation = await validateTrainerAssignment(queryContext.supabase, assignedTrainer, gymId);
    if (trainerValidation.error) {
      return { profile: null, error: trainerValidation.error };
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
  return setUserAccountStatus(userId, 'disabled', { session, appContext, gymId });
}

export async function setUserAccountStatus(userId, status, { session, appContext, gymId } = {}) {
  let queryContext = null;

  try {
    queryContext = await createQueryContext(appContext || session, { action: 'users:set_status' });
    gymId = requireGymId(gymId || queryContext.gymId);
  } catch (error) {
    return { profile: null, error };
  }

  if (!userId) {
    return { profile: null, error: new Error('Missing user context for status update.') };
  }

  const accountStatus = nullSafe(() => normalizeUserStatus(status));
  if (accountStatus.error) {
    return { profile: null, error: accountStatus.error };
  }

  const existing = await fetchUserProfile(queryContext.supabase, userId);
  if (existing.error) {
    return existing;
  }

  if (existing.profile.gym_id !== gymId) {
    return { profile: null, error: new Error('This profile is outside the active gym.') };
  }

  if (!MANAGEABLE_ROLES.has(existing.profile.role)) {
    return { profile: null, error: new Error('This user profile does not have a manageable role.') };
  }

  if (queryContext.userId === userId && isInactiveProfile({ account_status: accountStatus.value })) {
    return { profile: null, error: new Error('Admins cannot disable their own account from this screen.') };
  }

  const { data, error } = await scopedUpdate(queryContext.supabase, 'users', {
      account_status: accountStatus.value,
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

async function validateTrainerAssignment(supabase, trainerId, gymId) {
  const trainer = await fetchUserProfile(supabase, trainerId);
  if (trainer.error) {
    return { error: trainer.error };
  }

  if (
    trainer.profile.role !== 'trainer' ||
    trainer.profile.gym_id !== gymId ||
    isInactiveProfile(trainer.profile)
  ) {
    return {
      error: new Error('Assigned trainer must be an active trainer profile in this gym.')
    };
  }

  return { error: null };
}

function nullSafe(callback) {
  try {
    return { value: callback(), error: null };
  } catch (error) {
    return { value: null, error };
  }
}

function escapeSearchPattern(value) {
  return String(value || '')
    .replaceAll(',', ' ')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

async function getDefaultGymId(supabase) {
  const { data, error } = await supabase.rpc('default_gym_id');

  if (error || !data) {
    return null;
  }

  return data;
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

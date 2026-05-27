import { getSupabaseClientReady } from './supabase.js';
import { normalizeRole } from './permissions.js';

const PROFILE_COLUMNS = [
  'id',
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

export async function ensureUserProfile(user) {
  const supabase = await getSupabaseClientReady();

  if (!supabase || !user?.id) {
    return { profile: null, error: new Error('Missing authenticated user context.') };
  }

  const existing = await fetchUserProfile(supabase, user.id, { allowMissing: true });
  if (existing.profile || existing.error) {
    return existing;
  }

  const { data, error } = await supabase
    .from('users')
    .insert({
      id: user.id,
      fullname: getFullnameFromUser(user),
      email: user.email || '',
      role: DEFAULT_PROFILE_ROLE,
      created_at: new Date().toISOString()
    })
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

export async function listUsers({ role } = {}) {
  const supabase = await getSupabaseClientReady();

  if (!supabase) {
    return { users: [], error: new Error('Supabase is not configured for this deployment.') };
  }

  const normalizedRole = normalizeRole(role);
  let query = supabase
    .from('users')
    .select(PROFILE_COLUMNS)
    .order('fullname', { ascending: true });

  if (normalizedRole) {
    query = query.eq('role', normalizedRole);
  }

  const { data, error } = await query;

  if (error) {
    return { users: [], error };
  }

  return { users: (data || []).map(normalizeProfile), error: null };
}

export async function updateUserAssignedTrainer(userId, trainerId) {
  const supabase = await getSupabaseClientReady();

  if (!supabase || !userId) {
    return { profile: null, error: new Error('Missing user context for trainer assignment.') };
  }

  const existing = await fetchUserProfile(supabase, userId);
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
    const trainer = await fetchUserProfile(supabase, assignedTrainer);
    if (trainer.error) {
      return { profile: null, error: trainer.error };
    }

    if (trainer.profile.role !== 'trainer' || isInactiveProfile(trainer.profile)) {
      return {
        profile: null,
        error: new Error('Assigned trainer must be an active trainer profile.')
      };
    }
  }

  const { data, error } = await supabase
    .from('users')
    .update({
      assigned_trainer: assignedTrainer,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    return { profile: null, error };
  }

  return { profile: normalizeProfile(data), error: null };
}

export async function deactivateUserProfile(userId) {
  const supabase = await getSupabaseClientReady();

  if (!supabase || !userId) {
    return { profile: null, error: new Error('Missing user context for deactivation.') };
  }

  const existing = await fetchUserProfile(supabase, userId);
  if (existing.error) {
    return existing;
  }

  if (!MANAGEABLE_ROLES.has(existing.profile.role)) {
    return { profile: null, error: new Error('This user profile does not have a manageable role.') };
  }

  const { data, error } = await supabase
    .from('users')
    .update({
      account_status: 'disabled',
      updated_at: new Date().toISOString()
    })
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

  return {
    ...session,
    user: attachProfileToUser(session.user, profile)
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
    role: normalizeRole(profile.role),
    account_status: String(profile.account_status || '').toLowerCase()
  };
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

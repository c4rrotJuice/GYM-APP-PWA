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

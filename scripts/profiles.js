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

export async function getCurrentUserProfile(supabase, userId) {
  if (!supabase || !userId) {
    return { profile: null, error: new Error('Missing authenticated user context.') };
  }

  const { data, error } = await supabase
    .from('users')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .single();

  if (error || !data) {
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

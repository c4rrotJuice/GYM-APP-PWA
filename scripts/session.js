import { getSupabaseClientReady } from './supabase.js';
import { getRoleCapabilities, normalizeRole } from './permissions.js';
import { attachProfileToSession, getCurrentUserProfile, isInactiveProfile } from './profiles.js';

const ROLE_CACHE_TTL_MS = 60 * 1000;
const AUTH_NOTICE_KEY = 'gym-pwa-auth-notice';
const INACTIVE_ACCOUNT_MESSAGE = 'This account is not active. Contact your gym administrator.';

let authSubscription = null;
let currentUserRoleCache = null;

export async function getCurrentSession() {
  return restoreSession();
}

export async function restoreSession({ verify = false } = {}) {
  try {
    const supabase = await getSupabaseClientReady();

    if (!supabase) {
      return null;
    }

    const { data, error } = await supabase.auth.getSession();

    if (error || !data?.session) {
      await clearSupabaseSession(supabase);
      return null;
    }

    let session = data.session;

    if (isExpired(session)) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error || !refreshed.data?.session) {
        await clearSupabaseSession(supabase);
        return null;
      }

      session = refreshed.data.session;
    }

    if (verify && isOnline()) {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        await clearSupabaseSession(supabase);
        return null;
      }

      session = {
        ...session,
        user: userData.user
      };
    }

    const { profile, error: profileError } = await getCurrentUserProfile(supabase, session.user.id);
    if (profileError || !profile) {
      await clearSupabaseSession(supabase, {
        notice: 'This account profile is missing. Contact your gym administrator.'
      });
      return null;
    }

    if (isInactiveProfile(profile)) {
      await clearSupabaseSession(supabase, {
        scope: 'global',
        notice: INACTIVE_ACCOUNT_MESSAGE
      });
      return null;
    }

    if (!profile.gym_id) {
      await clearSupabaseSession(supabase, {
        notice: 'This account is not assigned to a gym. Contact your gym administrator.'
      });
      return null;
    }

    session = attachProfileToSession(session, profile);

    return session;
  } catch (error) {
    console.warn('Unable to restore Supabase session:', error);
    return null;
  }
}

export async function watchAuthState(callback) {
  let supabase = null;

  try {
    supabase = await getSupabaseClientReady();
  } catch (error) {
    console.warn('Unable to start Supabase auth listener:', error);
    return null;
  }

  if (!supabase || authSubscription) {
    return authSubscription;
  }

  const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
    invalidateCurrentUserRoleCache();

    if (!session?.user) {
      callback(event, session);
      return;
    }

    const { profile, error } = await getCurrentUserProfile(supabase, session.user.id);
    if (error || !profile) {
      await clearSupabaseSession(supabase, {
        notice: 'This account profile is missing. Contact your gym administrator.'
      });
      callback(event, null);
      return;
    }

    if (isInactiveProfile(profile)) {
      await clearSupabaseSession(supabase, {
        scope: 'global',
        notice: INACTIVE_ACCOUNT_MESSAGE
      });
      callback(event, null);
      return;
    }

    if (!profile.gym_id) {
      await clearSupabaseSession(supabase, {
        notice: 'This account is not assigned to a gym. Contact your gym administrator.'
      });
      callback(event, null);
      return;
    }

    callback(event, attachProfileToSession(session, profile));
  });

  authSubscription = data.subscription;
  return authSubscription;
}

export async function getCurrentUserRole({ forceRefresh = false, session = null, supabase = null } = {}) {
  const client = supabase || await getSupabaseClientReady();

  if (!client) {
    return null;
  }

  const userId = await getAuthenticatedUserId(client, session);

  if (!userId) {
    invalidateCurrentUserRoleCache();
    return null;
  }

  if (!forceRefresh && isRoleCacheFresh(userId)) {
    return currentUserRoleCache.role;
  }

  const { profile, error } = await getCurrentUserProfile(client, userId);

  if (error || !profile || isInactiveProfile(profile) || !profile.gym_id) {
    invalidateCurrentUserRoleCache();
    return null;
  }

  const role = normalizeRole(profile.role);
  currentUserRoleCache = {
    userId,
    role,
    expiresAt: Date.now() + ROLE_CACHE_TTL_MS
  };

  return role;
}

export function invalidateCurrentUserRoleCache() {
  currentUserRoleCache = null;
}

export function getTenantId(session) {
  return session?.gymId || session?.tenantId || session?.profile?.gym_id || session?.user?.profile?.gym_id || null;
}

export async function getSessionContext(session) {
  const profile = session?.profile || session?.user?.profile || null;
  const role = normalizeRole(session?.role || profile?.role) || await getCurrentUserRole({ session });
  const gymId = getTenantId(session);

  return {
    session,
    user: session?.user || null,
    profile,
    role,
    gymId,
    tenantId: gymId,
    status: profile?.account_status || null,
    capabilities: getRoleCapabilities(role),
    permissions: null,
    isAuthenticated: Boolean(session?.user && profile && role && gymId)
  };
}

export function consumeAuthNotice() {
  if (!hasSessionStorage()) {
    return '';
  }

  const notice = sessionStorage.getItem(AUTH_NOTICE_KEY) || '';
  sessionStorage.removeItem(AUTH_NOTICE_KEY);
  return notice;
}

export function watchConnectionStatus() {
  const status = document.querySelector('[data-connection-status]');
  if (!status) {
    return;
  }

  const update = () => {
    const offline = !navigator.onLine;
    status.textContent = offline ? 'Offline' : 'Online';
    status.dataset.offline = String(offline);
  };

  update();
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
}

async function clearSupabaseSession(supabase, { scope = 'local', notice = '' } = {}) {
  storeAuthNotice(notice);

  try {
    await supabase.auth.signOut({ scope });
  } catch (error) {
    console.warn('Unable to clear invalid Supabase session:', error);
  }
}

function storeAuthNotice(notice) {
  if (!notice || !hasSessionStorage()) {
    return;
  }

  sessionStorage.setItem(AUTH_NOTICE_KEY, notice);
}

function hasSessionStorage() {
  return typeof sessionStorage !== 'undefined';
}

function isExpired(session) {
  if (!session?.expires_at) {
    return false;
  }

  return session.expires_at * 1000 <= Date.now();
}

function isOnline() {
  return globalThis.navigator?.onLine !== false;
}

async function getAuthenticatedUserId(supabase, session) {
  if (session?.user?.id) {
    return session.user.id;
  }

  const { data, error } = await supabase.auth.getSession();

  if (error || !data?.session?.user?.id) {
    return null;
  }

  let currentSession = data.session;

  if (isExpired(currentSession)) {
    const refreshed = await supabase.auth.refreshSession();

    if (refreshed.error || !refreshed.data?.session?.user?.id) {
      return null;
    }

    currentSession = refreshed.data.session;
  }

  return currentSession.user.id;
}

function isRoleCacheFresh(userId) {
  return Boolean(
    currentUserRoleCache?.userId === userId &&
    currentUserRoleCache.expiresAt > Date.now()
  );
}

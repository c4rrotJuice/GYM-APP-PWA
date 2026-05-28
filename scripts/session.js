import { getSupabaseClientReady } from './supabase.js';
import { getRoleCapabilities, normalizeRole } from './permissions.js';
import { attachProfileToSession, getCurrentUserProfile, isInactiveProfile } from './profiles.js';

const ROLE_CACHE_TTL_MS = 60 * 1000;

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
      await clearLocalSupabaseSession(supabase);
      return null;
    }

    let session = data.session;

    if (isExpired(session)) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error || !refreshed.data?.session) {
        await clearLocalSupabaseSession(supabase);
        return null;
      }

      session = refreshed.data.session;
    }

    if (verify && isOnline()) {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        await clearLocalSupabaseSession(supabase);
        return null;
      }

      session = {
        ...session,
        user: userData.user
      };
    }

    const { profile, error: profileError } = await getCurrentUserProfile(supabase, session.user.id);
    if (profileError || !profile || isInactiveProfile(profile) || !profile.gym_id) {
      await clearLocalSupabaseSession(supabase);
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
    callback(
      event,
      error || !profile || isInactiveProfile(profile) || !profile.gym_id
        ? null
        : attachProfileToSession(session, profile)
    );
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
  return session?.user?.profile?.gym_id || null;
}

export async function getSessionContext(session) {
  const profile = session?.user?.profile || null;
  const role = normalizeRole(profile?.role) || await getCurrentUserRole({ session });
  const gymId = getTenantId(session);

  return {
    session,
    user: session?.user || null,
    profile,
    role,
    gymId,
    tenantId: gymId,
    status: profile?.account_status || null,
    capabilities: getRoleCapabilities(role)
  };
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

async function clearLocalSupabaseSession(supabase) {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch (error) {
    console.warn('Unable to clear invalid Supabase session:', error);
  }
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

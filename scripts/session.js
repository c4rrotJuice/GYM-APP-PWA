import { getSupabaseClientReady } from './supabase.js';
import { getRoleCapabilities, normalizeRole } from './permissions.js';
import { attachProfileToSession, getCurrentUserProfile, getProfileRole } from './profiles.js';

let authSubscription = null;

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
    if (profileError || !profile) {
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
    if (!session?.user) {
      callback(event, session);
      return;
    }

    const { profile, error } = await getCurrentUserProfile(supabase, session.user.id);
    callback(event, error || !profile ? null : attachProfileToSession(session, profile));
  });

  authSubscription = data.subscription;
  return authSubscription;
}

export function getUserRole(session) {
  return getProfileRole(session) || normalizeRole(
    session?.user?.app_metadata?.role ||
    session?.user?.user_metadata?.role
  );
}

export function getTenantId(session) {
  return (
    session?.user?.profile?.tenant_id ||
    session?.user?.profile?.gym_id ||
    session?.user?.app_metadata?.tenant_id ||
    session?.user?.app_metadata?.gym_id ||
    session?.user?.user_metadata?.tenant_id ||
    session?.user?.user_metadata?.gym_id ||
    null
  );
}

export function getSessionContext(session) {
  const role = getUserRole(session);

  return {
    session,
    user: session?.user || null,
    role,
    tenantId: getTenantId(session),
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

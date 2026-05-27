import { getSupabaseClientReady } from './supabase.js';
import {
  attachProfileToSession,
  attachProfileToUser,
  ensureUserProfile,
  getProfileRole,
  isInactiveProfile
} from './profiles.js';

export async function getAuthenticatedUser() {
  const supabase = await getSupabaseClientReady();

  if (!supabase) {
    return { user: null, error: null, ready: false };
  }

  const { data, error } = await supabase.auth.getUser();
  return { user: data?.user ?? null, error, ready: true };
}

export async function signInWithEmailPassword({ email, password }) {
  const supabase = await getSupabaseClientReady();

  if (!supabase) {
    return {
      session: null,
      user: null,
      error: new Error('Supabase is not configured for this deployment.'),
      ready: false
    };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error || !data?.session || !data?.user) {
    return {
      session: null,
      user: null,
      error: error || new Error('Unable to sign in with these credentials.'),
      ready: true
    };
  }

  const { profile, error: profileError } = await ensureUserProfile(data.user);

  if (profileError || !profile) {
    await supabase.auth.signOut({ scope: 'local' });
    return {
      session: null,
      user: null,
      error: profileError || new Error('No profile was found for this account.'),
      ready: true
    };
  }

  if (isInactiveProfile(profile)) {
    await supabase.auth.signOut({ scope: 'local' });
    return {
      session: null,
      user: null,
      error: new Error('This account is not active. Contact your gym administrator.'),
      ready: true
    };
  }

  if (!profile.role) {
    await supabase.auth.signOut({ scope: 'local' });
    return {
      session: null,
      user: null,
      error: new Error('This account has no assigned role. Contact your gym administrator.'),
      ready: true
    };
  }

  const session = attachProfileToSession(data.session, profile);
  const user = attachProfileToUser(data.user, profile);

  return {
    session,
    user,
    error: null,
    ready: true
  };
}

export async function signOut() {
  const supabase = await getSupabaseClientReady();

  if (!supabase) {
    return { error: null, ready: false };
  }

  const { error } = await supabase.auth.signOut();
  return { error, ready: true };
}

export function initLoginForm() {
  const form = document.querySelector('[data-login-form]');
  const submitButton = document.querySelector('[data-login-submit]');
  const message = document.querySelector('[data-auth-message]');

  if (!form || !submitButton || !message) {
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(message);

    const credentials = getCredentials(form);
    const validationError = validateCredentials(credentials);

    if (validationError) {
      showMessage(message, validationError, 'error');
      return;
    }

    setFormBusy(form, submitButton, true);

    try {
      const result = await signInWithEmailPassword(credentials);

      if (result.error) {
        showMessage(message, toAuthMessage(result.error, result.ready), 'error');
        return;
      }

      showMessage(message, 'Signed in. Opening dashboard...', 'success');
      window.location.replace('/app.html#dashboard');
    } catch (error) {
      showMessage(message, toAuthMessage(error, true), 'error');
    } finally {
      setFormBusy(form, submitButton, false);
    }
  });
}

export function initLogoutButton({ redirectTo = '/index.html' } = {}) {
  const button = document.querySelector('[data-logout-button]');

  if (!button) {
    return;
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Signing out...';

    const { error } = await signOut();

    if (error) {
      console.warn('Supabase sign out failed:', error);
    }

    window.location.replace(redirectTo);
  });
}

export function renderAccountNavigation(session) {
  const pill = document.querySelector('[data-account-pill]');

  if (!pill || !session?.user) {
    return;
  }

  const role = getRoleFromUser(session.user);
  pill.textContent = `${role || 'unassigned'} · ${session.user.email || 'Signed in'}`;
  pill.hidden = false;
}

function getCredentials(form) {
  const data = new FormData(form);

  return {
    email: String(data.get('email') || '').trim(),
    password: String(data.get('password') || '')
  };
}

function validateCredentials({ email, password }) {
  if (!email) {
    return 'Enter your email address.';
  }

  if (!email.includes('@')) {
    return 'Enter a valid email address.';
  }

  if (!password) {
    return 'Enter your password.';
  }

  if (password.length < 6) {
    return 'Password must be at least 6 characters.';
  }

  return '';
}

function setFormBusy(form, button, busy) {
  form.setAttribute('aria-busy', String(busy));
  button.disabled = busy;
  button.textContent = busy ? 'Signing in...' : 'Sign in';
}

function showMessage(target, text, tone) {
  target.textContent = text;
  target.dataset.tone = tone;
}

function clearMessage(target) {
  target.textContent = '';
  delete target.dataset.tone;
}

function toAuthMessage(error, ready) {
  if (!ready) {
    return 'Authentication is not configured yet.';
  }

  const message = String(error?.message || '').toLowerCase();

  if (message.includes('invalid login credentials') || message.includes('invalid credentials')) {
    return 'Invalid email or password.';
  }

  if (message.includes('failed to fetch') || message.includes('network') || !navigator.onLine) {
    return 'Network error. Check your connection and try again.';
  }

  if (message.includes('email not confirmed')) {
    return 'This account is not ready yet. Contact your gym administrator.';
  }

  if (message.includes('no rows') || message.includes('profile')) {
    return 'This account profile is missing. Contact your gym administrator.';
  }

  return error?.message || 'Unable to sign in right now.';
}

function getRoleFromUser(user) {
  return getProfileRole(user);
}

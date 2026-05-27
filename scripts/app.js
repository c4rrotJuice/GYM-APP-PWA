import { initLogoutButton, renderAccountNavigation } from './auth.js';
import { initInstallPrompt, registerServiceWorker, syncStandaloneState } from './install.js';
import { bootstrapAuthenticatedRoute } from './guards.js';
import { initRouter } from './router.js';
import { watchConnectionStatus } from './session.js';
import { getSupabaseClient } from './supabase.js';

registerServiceWorker();
initInstallPrompt();
syncStandaloneState();
watchConnectionStatus();

const routeName = window.location.hash.replace('#', '').trim().toLowerCase() || 'dashboard';
const authState = await bootstrapAuthenticatedRoute({ routeName });

if (!authState.allowed) {
  document.querySelector('#app-view')?.setAttribute('aria-busy', 'true');
} else {
  const supabase = getSupabaseClient();
  renderAccountNavigation(authState.session);
  initLogoutButton();

  initRouter({
    target: document.querySelector('#app-view'),
    navItems: document.querySelectorAll('[data-route]'),
    session: authState.session,
    supabaseReady: Boolean(supabase)
  });
}

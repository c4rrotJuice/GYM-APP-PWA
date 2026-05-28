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
const appView = document.querySelector('#app-view');

if (!authState.allowed) {
  appView?.setAttribute('aria-busy', 'true');
} else {
  const supabase = getSupabaseClient();
  renderAccountNavigation(authState.appContext);
  initLogoutButton();

  initRouter({
    target: appView,
    navItems: document.querySelectorAll('[data-route]'),
    appContext: authState.appContext,
    supabaseReady: Boolean(supabase)
  });
}

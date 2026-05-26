import { initInstallPrompt, registerServiceWorker, syncStandaloneState } from './install.js';
import { bootstrapPublicRoute } from './guards.js';
import { initLoginForm } from './auth.js';

registerServiceWorker();
initInstallPrompt();
syncStandaloneState();

const authState = await bootstrapPublicRoute();

if (authState.allowed) {
  initLoginForm();
}

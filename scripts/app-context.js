import { getRolePermissions } from './permissions.js';
import { getSessionContext, restoreSession } from './session.js';

let currentAppContext = createAnonymousContext();
let hydratePromise = null;

export async function hydrateAppContext({ verify = false, force = false } = {}) {
  if (hydratePromise && !force) {
    return hydratePromise;
  }

  hydratePromise = (async () => {
    try {
      const session = await restoreSession({ verify });
      currentAppContext = session
        ? await createAppContextFromSession(session)
        : createAnonymousContext();

      return currentAppContext;
    } catch (error) {
      console.warn('Unable to hydrate app context:', error);
      currentAppContext = createAnonymousContext();
      return currentAppContext;
    } finally {
      hydratePromise = null;
    }
  })();

  return hydratePromise;
}

export async function refreshAppContext(options = {}) {
  return hydrateAppContext({ ...options, force: true });
}

export async function setAppContextFromSession(session) {
  currentAppContext = session
    ? await createAppContextFromSession(session)
    : createAnonymousContext();

  return currentAppContext;
}

export function getAppContext() {
  return currentAppContext;
}

export function clearAppContext() {
  currentAppContext = createAnonymousContext();
  hydratePromise = null;
  return currentAppContext;
}

export async function createAppContextFromSession(session) {
  const context = await getSessionContext(session);
  const permissions = getRolePermissions(context.role);

  return {
    session,
    user: context.user,
    profile: context.profile,
    role: context.role,
    gymId: context.gymId,
    tenantId: context.gymId,
    status: context.status,
    capabilities: permissions.capabilities,
    permissions,
    isAuthenticated: Boolean(context.user && context.profile && context.role && context.gymId)
  };
}

function createAnonymousContext() {
  return {
    session: null,
    user: null,
    profile: null,
    role: null,
    gymId: null,
    tenantId: null,
    status: null,
    capabilities: [],
    permissions: {
      routes: [],
      actions: [],
      capabilities: []
    },
    isAuthenticated: false
  };
}

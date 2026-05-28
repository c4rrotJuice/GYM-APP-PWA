import { getAdminDashboardData, getMemberDashboardData, getTrainerDashboardData } from './dashboard-queries.js';

const dashboardCache = new Map();

const LOADERS = Object.freeze({
  admin: getAdminDashboardData,
  trainer: getTrainerDashboardData,
  member: getMemberDashboardData
});

export async function loadDashboardBootstrap({ appContext, force = false } = {}) {
  const role = appContext?.role;
  const loader = LOADERS[role];

  if (!loader) {
    return { data: null, error: new Error('No dashboard loader is registered for this role.') };
  }

  const cacheKey = getCacheKey(appContext);
  const cached = dashboardCache.get(cacheKey);

  if (!force && cached?.promise) {
    return cached.promise;
  }

  if (!force && cached?.data) {
    return cached.data;
  }

  const promise = loader({ appContext })
    .then((result) => {
      dashboardCache.set(cacheKey, { data: result, promise: null });
      return result;
    })
    .catch((error) => {
      const result = { data: null, error };
      dashboardCache.set(cacheKey, { data: result, promise: null });
      return result;
    });

  dashboardCache.set(cacheKey, { data: null, promise });
  return promise;
}

export function clearDashboardBootstrapCache(appContext = null) {
  if (!appContext) {
    dashboardCache.clear();
    return;
  }

  dashboardCache.delete(getCacheKey(appContext));
}

function getCacheKey(appContext) {
  return [
    appContext?.tenantId || appContext?.gymId || 'no-tenant',
    appContext?.user?.id || 'no-user',
    appContext?.role || 'no-role'
  ].join(':');
}

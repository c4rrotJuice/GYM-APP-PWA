import { createQueryContext, requireGymId, scopedSelect } from './tenant-queries.js';

export async function countActiveMemberships({ session, appContext, gymId } = {}) {
  let queryContext = null;

  try {
    queryContext = await createQueryContext(appContext || session, { action: 'memberships:count_active' });
    gymId = requireGymId(gymId || queryContext.gymId);
  } catch (error) {
    return { count: 0, error };
  }

  const { count, error } = await scopedSelect(queryContext.supabase, 'memberships', 'id', {
    gymId,
    options: { count: 'exact', head: true }
  })
    .eq('status', 'active');

  if (error) {
    return { count: 0, error };
  }

  return { count: count || 0, error: null };
}

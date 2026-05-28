import { getSupabaseClientReady } from './supabase.js';
import { requireGymId, scopedSelect } from './tenant-queries.js';

export async function countActiveMemberships({ session, gymId } = {}) {
  const supabase = await getSupabaseClientReady();

  if (!supabase) {
    return { count: 0, error: new Error('Supabase is not configured for this deployment.') };
  }

  try {
    gymId = requireGymId(gymId || session);
  } catch (error) {
    return { count: 0, error };
  }

  const { count, error } = await scopedSelect(supabase, 'memberships', 'id', {
    gymId,
    options: { count: 'exact', head: true }
  })
    .eq('status', 'active');

  if (error) {
    return { count: 0, error };
  }

  return { count: count || 0, error: null };
}

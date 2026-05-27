import { getSupabaseClientReady } from './supabase.js';

export async function countActiveMemberships() {
  const supabase = await getSupabaseClientReady();

  if (!supabase) {
    return { count: 0, error: new Error('Supabase is not configured for this deployment.') };
  }

  const { count, error } = await supabase
    .from('memberships')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');

  if (error) {
    return { count: 0, error };
  }

  return { count: count || 0, error: null };
}

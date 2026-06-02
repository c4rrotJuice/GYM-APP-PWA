import { getSupabaseClientReady } from './supabase.js';

const PUSH_SUBSCRIPTION_COLUMNS = [
  'id',
  'user_id',
  'endpoint',
  'p256dh',
  'auth',
  'created_at',
  'active'
].join(', ');

export async function saveSubscription(subscription, { userId } = {}) {
  try {
    const supabase = await getNotificationClient();
    const resolvedUserId = userId || await getCurrentUserId(supabase);
    const values = normalizeSubscriptionPayload(subscription, resolvedUserId);

    const { data, error } = await supabase
      .from('push_subscriptions')
      .upsert(values, { onConflict: 'user_id,endpoint' })
      .select(PUSH_SUBSCRIPTION_COLUMNS)
      .single();

    return { subscription: error ? null : normalizeSubscription(data), error };
  } catch (error) {
    return { subscription: null, error };
  }
}

export async function removeSubscription(subscriptionOrEndpoint, { userId } = {}) {
  try {
    const supabase = await getNotificationClient();
    const resolvedUserId = userId || await getCurrentUserId(supabase);
    const endpoint = normalizeEndpoint(subscriptionOrEndpoint);

    if (!endpoint) {
      throw new Error('A push subscription endpoint is required.');
    }

    const { data, error } = await supabase
      .from('push_subscriptions')
      .update({ active: false })
      .eq('user_id', resolvedUserId)
      .eq('endpoint', endpoint)
      .select(PUSH_SUBSCRIPTION_COLUMNS)
      .maybeSingle();

    return { subscription: error ? null : normalizeSubscription(data), error };
  } catch (error) {
    return { subscription: null, error };
  }
}

export async function getUserSubscriptions(userId = null) {
  try {
    const supabase = await getNotificationClient();
    const resolvedUserId = userId || await getCurrentUserId(supabase);
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select(PUSH_SUBSCRIPTION_COLUMNS)
      .eq('user_id', resolvedUserId)
      .order('created_at', { ascending: false });

    return { subscriptions: error ? [] : (data || []).map(normalizeSubscription), error };
  } catch (error) {
    return { subscriptions: [], error };
  }
}

export async function getActiveSubscriptions(userId = null) {
  try {
    const supabase = await getNotificationClient();
    let query = supabase
      .from('push_subscriptions')
      .select(PUSH_SUBSCRIPTION_COLUMNS)
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    return { subscriptions: error ? [] : (data || []).map(normalizeSubscription), error };
  } catch (error) {
    return { subscriptions: [], error };
  }
}

async function getNotificationClient() {
  const supabase = await getSupabaseClientReady();

  if (!supabase) {
    throw new Error('Supabase is not configured for this deployment.');
  }

  return supabase;
}

async function getCurrentUserId(supabase) {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!data?.user?.id) {
    throw new Error('An authenticated user is required for push subscriptions.');
  }

  return data.user.id;
}

function normalizeSubscriptionPayload(subscription, userId) {
  const endpoint = normalizeEndpoint(subscription);
  const keys = subscription?.keys || subscription?.toJSON?.()?.keys || {};
  const p256dh = String(subscription?.p256dh || keys.p256dh || '').trim();
  const auth = String(subscription?.auth || keys.auth || '').trim();

  if (!userId) {
    throw new Error('A user ID is required for push subscriptions.');
  }

  if (!endpoint) {
    throw new Error('A push subscription endpoint is required.');
  }

  if (!p256dh || !auth) {
    throw new Error('Push subscription keys are required.');
  }

  return {
    user_id: userId,
    endpoint,
    p256dh,
    auth,
    active: true
  };
}

function normalizeEndpoint(subscriptionOrEndpoint) {
  if (typeof subscriptionOrEndpoint === 'string') {
    return subscriptionOrEndpoint.trim();
  }

  return String(subscriptionOrEndpoint?.endpoint || '').trim();
}

function normalizeSubscription(subscription) {
  if (!subscription) {
    return null;
  }

  return {
    ...subscription,
    active: Boolean(subscription.active)
  };
}

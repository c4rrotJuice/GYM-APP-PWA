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

const NOTIFICATION_QUEUE_COLUMNS = [
  'id',
  'type',
  'recipient_user_id',
  'payload',
  'status',
  'attempt_count',
  'created_at',
  'processed_at'
].join(', ');

const BROADCAST_USER_COLUMNS = 'id, role, account_status';
const DEFAULT_QUEUE_STATUS = 'pending';

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

export async function enqueueNotification(notification) {
  try {
    const supabase = await getNotificationClient();
    const values = normalizeNotificationPayload(notification);

    const { data, error } = await supabase
      .from('notification_queue')
      .insert(values)
      .select(NOTIFICATION_QUEUE_COLUMNS)
      .single();

    return { notification: error ? null : normalizeQueuedNotification(data), error };
  } catch (error) {
    return { notification: null, error };
  }
}

export async function createBroadcast(broadcast = {}) {
  try {
    const supabase = await getNotificationClient();
    const values = normalizeBroadcastPayload(broadcast);
    let query = supabase
      .from('users')
      .select(BROADCAST_USER_COLUMNS)
      .eq('account_status', 'active')
      .order('created_at', { ascending: true });

    if (values.roles.length) {
      query = query.in('role', values.roles);
    }

    const { data: users, error: usersError } = await query;
    if (usersError) {
      throw usersError;
    }

    const eligibleUsers = (users || []).filter((user) => user?.id);
    if (!eligibleUsers.length) {
      return { notifications: [], count: 0, error: null };
    }

    const rows = eligibleUsers.map((user) => normalizeNotificationPayload({
      type: values.type,
      recipientUserId: user.id,
      payload: values.payload
    }));

    const { data, error } = await supabase
      .from('notification_queue')
      .insert(rows)
      .select(NOTIFICATION_QUEUE_COLUMNS);

    return {
      notifications: error ? [] : (data || []).map(normalizeQueuedNotification),
      count: error ? 0 : (data || []).length,
      error
    };
  } catch (error) {
    return { notifications: [], count: 0, error };
  }
}

export async function processNotificationQueue({ limit = 25 } = {}) {
  try {
    const supabase = await getNotificationClient();
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      throw error;
    }

    const accessToken = data?.session?.access_token;
    if (!accessToken) {
      throw new Error('An authenticated admin session is required to process notifications.');
    }

    const response = await fetch('/.netlify/functions/process-notification-queue', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ limit: normalizeQueueLimit(limit) })
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body?.error || 'Unable to process notification queue.');
    }

    return { result: body, error: null };
  } catch (error) {
    return { result: null, error };
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

export async function sendTestNotification() {
  try {
    const supabase = await getNotificationClient();
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      throw error;
    }

    const accessToken = data?.session?.access_token;
    if (!accessToken) {
      throw new Error('An authenticated session is required to send a test notification.');
    }

    const response = await fetch('/.netlify/functions/send-test-notification', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body?.error || 'Unable to send a test notification.');
    }

    return { result: body, error: null };
  } catch (error) {
    return { result: null, error };
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

function normalizeNotificationPayload(notification = {}) {
  const type = String(notification.type || '').trim();
  const recipientUserId = String(notification.recipientUserId || notification.recipient_user_id || '').trim();
  const payload = normalizeJsonPayload(notification.payload);

  if (!type) {
    throw new Error('Notification type is required.');
  }

  if (!recipientUserId) {
    throw new Error('A notification recipient user ID is required.');
  }

  return {
    type,
    recipient_user_id: recipientUserId,
    payload,
    status: DEFAULT_QUEUE_STATUS,
    attempt_count: 0
  };
}

function normalizeBroadcastPayload(broadcast = {}) {
  const type = String(broadcast.type || '').trim();
  const payload = normalizeJsonPayload(broadcast.payload);
  const roles = normalizeRoleList(broadcast.roles || broadcast.role);

  if (!type) {
    throw new Error('Broadcast type is required.');
  }

  return { type, payload, roles };
}

function normalizeJsonPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }

  return {
    ...payload
  };
}

function normalizeRoleList(value) {
  const roles = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(roles
    .map((role) => String(role || '').trim().toLowerCase())
    .filter(Boolean))];
}

function normalizeQueueLimit(value) {
  const limit = Number.parseInt(value, 10);

  if (!Number.isFinite(limit)) {
    return 25;
  }

  return Math.min(Math.max(limit, 1), 100);
}

function normalizeQueuedNotification(notification) {
  if (!notification) {
    return null;
  }

  return {
    ...notification,
    attempt_count: Number(notification.attempt_count || 0),
    payload: normalizeJsonPayload(notification.payload)
  };
}

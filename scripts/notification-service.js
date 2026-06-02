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
  'processed_at',
  'last_error',
  'last_attempt_at'
].join(', ');

const BROADCAST_USER_COLUMNS = 'id, role, account_status';
const EXPIRING_MEMBERSHIP_COLUMNS = 'id, user_id, type, status, start_date, end_date';
const INACTIVE_MEMBER_COLUMNS = 'id, fullname, email, role, account_status';
const INACTIVE_ATTENDANCE_COLUMNS = 'id, user_id, attendance_date, attended_at';
const DEFAULT_QUEUE_STATUS = 'pending';
const EXPIRY_REMINDER_DAYS = 7;
const DEFAULT_INACTIVE_THRESHOLD_DAYS = 14;

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

export async function checkExpiringMemberships({ asOf = new Date() } = {}) {
  try {
    const supabase = await getNotificationClient();
    const triggerDate = toDateOnly(asOf);
    const reminderDate = addDays(triggerDate, EXPIRY_REMINDER_DAYS);
    const { data: memberships, error: membershipsError } = await supabase
      .from('memberships')
      .select(EXPIRING_MEMBERSHIP_COLUMNS)
      .eq('status', 'active')
      .eq('end_date', reminderDate);

    if (membershipsError) {
      throw membershipsError;
    }

    const rows = (memberships || [])
      .filter((membership) => membership?.user_id)
      .map((membership) => normalizeNotificationPayload({
        type: 'membership_expiry_reminder',
        recipientUserId: membership.user_id,
        payload: {
          title: 'Membership expiring soon',
          body: 'Your gym membership expires in 7 days.',
          url: '/app.html#memberships',
          membershipId: membership.id || null,
          membershipType: membership.type || null,
          endDate: membership.end_date,
          daysUntilExpiry: EXPIRY_REMINDER_DAYS,
          triggerDate,
          dedupeKey: createDedupeKey('membership_expiry_reminder', membership.user_id, reminderDate),
          trigger: 'checkExpiringMemberships'
        }
      }));

    return await insertNotificationRows(supabase, rows);
  } catch (error) {
    return { notifications: [], count: 0, error };
  }
}

export async function checkInactiveMembers({ asOf = new Date(), thresholdDays = DEFAULT_INACTIVE_THRESHOLD_DAYS } = {}) {
  try {
    const supabase = await getNotificationClient();
    const normalizedThreshold = normalizePositiveInteger(thresholdDays, DEFAULT_INACTIVE_THRESHOLD_DAYS);
    const triggerDate = toDateOnly(asOf);
    const cutoffDate = addDays(triggerDate, -normalizedThreshold);

    const { data: members, error: membersError } = await supabase
      .from('users')
      .select(INACTIVE_MEMBER_COLUMNS)
      .eq('role', 'member')
      .eq('account_status', 'active');

    if (membersError) {
      throw membersError;
    }

    const memberIds = (members || []).map((member) => member?.id).filter(Boolean);
    if (!memberIds.length) {
      return { notifications: [], count: 0, error: null };
    }

    const { data: logs, error: logsError } = await supabase
      .from('attendance_logs')
      .select(INACTIVE_ATTENDANCE_COLUMNS)
      .in('user_id', memberIds)
      .order('attendance_date', { ascending: false });

    if (logsError) {
      throw logsError;
    }

    const lastAttendanceByUser = mapLastAttendanceByUser(logs || []);
    const rows = (members || [])
      .filter((member) => {
        const lastAttendanceDate = lastAttendanceByUser.get(member.id);
        return !lastAttendanceDate || lastAttendanceDate < cutoffDate;
      })
      .map((member) => {
        const lastAttendanceDate = lastAttendanceByUser.get(member.id) || null;
        return normalizeNotificationPayload({
          type: 'inactive_member',
          recipientUserId: member.id,
          payload: {
            title: 'We miss you at the gym',
            body: `You have not checked in for more than ${normalizedThreshold} days.`,
            url: '/app.html#attendance-history',
            thresholdDays: normalizedThreshold,
            cutoffDate,
            triggerDate,
            lastAttendanceDate,
            daysInactive: lastAttendanceDate ? daysBetween(lastAttendanceDate, triggerDate) : null,
            dedupeKey: createDedupeKey('inactive_member', member.id, `${triggerDate}:${normalizedThreshold}`),
            trigger: 'checkInactiveMembers'
          }
        });
      });

    return await insertNotificationRows(supabase, rows);
  } catch (error) {
    return { notifications: [], count: 0, error };
  }
}

export async function createAnnouncementNotifications(announcement = {}) {
  const normalized = normalizeAnnouncementPayload(announcement);
  return createBroadcast({
    type: 'announcement',
    roles: normalized.roles,
    payload: {
      title: normalized.title,
      body: normalized.body,
      url: normalized.url,
      announcementId: normalized.announcementId,
      trigger: 'createAnnouncementNotifications'
    }
  });
}

export async function listQueuedNotifications({ limit = 50 } = {}) {
  return listNotificationsByStatus('pending', { limit });
}

export async function listFailedNotifications({ limit = 50 } = {}) {
  return listNotificationsByStatus('failed', { limit });
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

function normalizeAnnouncementPayload(announcement = {}) {
  const title = String(announcement.title || '').trim();
  const body = String(announcement.body || announcement.message || '').trim();
  const url = String(announcement.url || '/app.html#dashboard').trim();
  const roles = normalizeRoleList(announcement.roles || announcement.role);
  const announcementId = announcement.announcementId || announcement.announcement_id || null;

  if (!title) {
    throw new Error('Announcement title is required.');
  }

  if (!body) {
    throw new Error('Announcement body is required.');
  }

  return { title, body, url, roles, announcementId };
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

async function insertNotificationRows(supabase, rows) {
  const insertableRows = await filterExistingNotificationRows(supabase, rows);

  if (!insertableRows.length) {
    return { notifications: [], count: 0, error: null };
  }

  const { data, error } = await supabase
    .from('notification_queue')
    .insert(insertableRows)
    .select(NOTIFICATION_QUEUE_COLUMNS);

  return {
    notifications: error ? [] : (data || []).map(normalizeQueuedNotification),
    count: error ? 0 : (data || []).length,
    error
  };
}

async function listNotificationsByStatus(status, { limit = 50 } = {}) {
  try {
    const supabase = await getNotificationClient();
    const { data, error } = await supabase
      .from('notification_queue')
      .select(NOTIFICATION_QUEUE_COLUMNS)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(normalizeQueueLimit(limit));

    return {
      notifications: error ? [] : (data || []).map(normalizeQueuedNotification),
      error
    };
  } catch (error) {
    return { notifications: [], error };
  }
}

async function filterExistingNotificationRows(supabase, rows = []) {
  const dedupeKeys = rows
    .map((row) => row?.payload?.dedupeKey)
    .filter(Boolean);

  if (!dedupeKeys.length) {
    return rows;
  }

  const { data, error } = await supabase
    .from('notification_queue')
    .select('id, payload')
    .in('payload->>dedupeKey', dedupeKeys);

  if (error) {
    throw error;
  }

  const existingKeys = new Set((data || [])
    .map((row) => row?.payload?.dedupeKey)
    .filter(Boolean));

  return rows.filter((row) => !existingKeys.has(row?.payload?.dedupeKey));
}

function normalizePositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function mapLastAttendanceByUser(logs = []) {
  return logs.reduce((map, log) => {
    const userId = log?.user_id;
    const date = normalizeDateOnly(log?.attendance_date || log?.attended_at);

    if (!userId || !date) {
      return map;
    }

    const current = map.get(userId);
    if (!current || date > current) {
      map.set(userId, date);
    }

    return map;
  }, new Map());
}

function addDays(value, days) {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnly(date);
}

function daysBetween(startDate, endDate) {
  return Math.floor((parseDateOnly(endDate) - parseDateOnly(startDate)) / 86400000);
}

function toDateOnly(value) {
  return parseDateOnly(value).toISOString().slice(0, 10);
}

function normalizeDateOnly(value) {
  try {
    return value ? toDateOnly(value) : null;
  } catch (error) {
    return null;
  }
}

function parseDateOnly(value) {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    throw new Error('A valid date is required.');
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function createDedupeKey(type, recipientUserId, scope) {
  return [type, recipientUserId, scope]
    .map((part) => String(part || '').trim())
    .join(':');
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

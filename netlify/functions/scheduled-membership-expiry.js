const {
  addDays,
  createDedupeKey,
  createNotificationRow,
  enqueueRowsIdempotently,
  getEnvironment,
  isAuthorizedAutomationEvent,
  jsonResponse,
  listGyms,
  logAutomationFailure,
  normalizeDate,
  requestJson,
  runRpc,
  serviceHeaders
} = require('./lib/phase5-automation.js');

const EXPIRY_REMINDER_DAYS = 7;

exports.config = {
  schedule: '30 0 * * *'
};

exports.handler = async function handler(event) {
  const env = getEnvironment();
  if (!env.ok) {
    return jsonResponse(500, { error: env.error });
  }

  if (!isAuthorizedAutomationEvent(event, env.value)) {
    return jsonResponse(403, { error: 'Automation request is not authorized.' });
  }

  const asOf = normalizeDate(new Date());
  const summary = {
    job: 'membership_expiry_checks',
    asOf,
    expiryResults: [],
    reminderCount: 0,
    failures: 0
  };

  try {
    const expiryResponse = await runRpc(env.value, 'run_membership_expiry_automation', {
      as_of: asOf,
      expiry_window_days: EXPIRY_REMINDER_DAYS
    });

    if (!expiryResponse.ok) {
      throw new Error(expiryResponse.body?.message || 'Membership expiry automation failed.');
    }

    summary.expiryResults = Array.isArray(expiryResponse.body) ? expiryResponse.body : [];
  } catch (error) {
    summary.failures += 1;
    await logAutomationFailure(env.value, {
      jobName: 'membership_expiry_checks',
      error,
      context: { asOf }
    });
  }

  try {
    const gyms = await listGyms(env.value);
    for (const gym of gyms) {
      try {
        const rows = await buildExpiryReminderRows(env.value, gym.id, asOf);
        const inserted = await enqueueRowsIdempotently(env.value, rows);
        summary.reminderCount += inserted.length;
      } catch (error) {
        summary.failures += 1;
        await logAutomationFailure(env.value, {
          jobName: 'membership_expiry_reminders',
          gymId: gym.id,
          error,
          context: { asOf }
        });
      }
    }
  } catch (error) {
    summary.failures += 1;
    await logAutomationFailure(env.value, {
      jobName: 'membership_expiry_reminders',
      error,
      context: { asOf }
    });
  }

  return jsonResponse(summary.failures ? 207 : 200, summary);
};

async function buildExpiryReminderRows(env, gymId, asOf) {
  const reminderDate = addDays(asOf, EXPIRY_REMINDER_DAYS);
  const query = [
    'select=id,user_id,type,status,start_date,end_date',
    `gym_id=eq.${encodeURIComponent(gymId)}`,
    'status=eq.active',
    `end_date=eq.${encodeURIComponent(reminderDate)}`
  ].join('&');
  const response = await requestJson(`${env.url}/rest/v1/memberships?${query}`, {
    headers: serviceHeaders(env)
  });

  if (!response.ok) {
    throw new Error(response.body?.message || 'Unable to load expiring memberships.');
  }

  return (Array.isArray(response.body) ? response.body : [])
    .filter((membership) => membership?.user_id)
    .map((membership) => createNotificationRow({
      type: 'membership_expiry_reminder',
      recipientUserId: membership.user_id,
      payload: {
        title: 'Membership expiring soon',
        body: 'Your gym membership expires in 7 days.',
        url: '/app.html#memberships',
        membershipId: membership.id,
        membershipType: membership.type || null,
        endDate: membership.end_date,
        daysUntilExpiry: EXPIRY_REMINDER_DAYS,
        triggerDate: asOf,
        dedupeKey: createDedupeKey('membership_expiry_reminder', membership.user_id, reminderDate),
        trigger: 'scheduled-membership-expiry'
      }
    }));
}

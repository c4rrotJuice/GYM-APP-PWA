const {
  DEFAULT_INACTIVE_THRESHOLD_DAYS,
  addDays,
  createDedupeKey,
  createNotificationRow,
  daysBetween,
  enqueueRowsIdempotently,
  getEnvironment,
  isAuthorizedAutomationEvent,
  jsonResponse,
  listGyms,
  logAutomationFailure,
  normalizeDate,
  normalizeLimit,
  requestJson,
  serviceHeaders
} = require('./lib/phase5-automation.js');

exports.config = {
  schedule: '45 0 * * *'
};

exports.handler = async function handler(event) {
  const env = getEnvironment();
  if (!env.ok) {
    return jsonResponse(500, { error: env.error });
  }

  if (!isAuthorizedAutomationEvent(event, env.value)) {
    return jsonResponse(403, { error: 'Automation request is not authorized.' });
  }

  const thresholdDays = normalizeLimit(process.env.INACTIVE_MEMBER_THRESHOLD_DAYS, DEFAULT_INACTIVE_THRESHOLD_DAYS, 365);
  const asOf = normalizeDate(new Date());
  const summary = {
    job: 'inactive_member_checks',
    asOf,
    thresholdDays,
    queued: 0,
    gyms: 0,
    failures: 0
  };

  try {
    const gyms = await listGyms(env.value);
    summary.gyms = gyms.length;

    for (const gym of gyms) {
      try {
        const rows = await buildInactiveMemberRows(env.value, gym.id, { asOf, thresholdDays });
        const inserted = await enqueueRowsIdempotently(env.value, rows);
        summary.queued += inserted.length;
      } catch (error) {
        summary.failures += 1;
        await logAutomationFailure(env.value, {
          jobName: 'inactive_member_checks',
          gymId: gym.id,
          error,
          context: { asOf, thresholdDays }
        });
      }
    }

    return jsonResponse(summary.failures ? 207 : 200, summary);
  } catch (error) {
    await logAutomationFailure(env.value, {
      jobName: 'inactive_member_checks',
      error,
      context: { asOf, thresholdDays }
    });

    return jsonResponse(500, { error: error.message || 'Inactive member automation failed.' });
  }
};

async function buildInactiveMemberRows(env, gymId, { asOf, thresholdDays }) {
  const cutoffDate = addDays(asOf, -thresholdDays);
  const members = await getActiveMembers(env, gymId);
  const memberIds = members.map((member) => member.id).filter(Boolean);

  if (!memberIds.length) {
    return [];
  }

  const lastAttendanceByUser = await getLastAttendanceByUser(env, gymId, memberIds);

  return members
    .filter((member) => {
      const lastAttendanceDate = lastAttendanceByUser.get(member.id);
      return !lastAttendanceDate || lastAttendanceDate < cutoffDate;
    })
    .map((member) => {
      const lastAttendanceDate = lastAttendanceByUser.get(member.id) || null;
      return createNotificationRow({
        type: 'inactive_member',
        recipientUserId: member.id,
        payload: {
          title: 'We miss you at the gym',
          body: `You have not checked in for more than ${thresholdDays} days.`,
          url: '/app.html#attendance-history',
          thresholdDays,
          cutoffDate,
          triggerDate: asOf,
          lastAttendanceDate,
          daysInactive: lastAttendanceDate ? daysBetween(lastAttendanceDate, asOf) : null,
          dedupeKey: createDedupeKey('inactive_member', member.id, `${asOf}:${thresholdDays}`),
          trigger: 'scheduled-inactive-members'
        }
      });
    });
}

async function getActiveMembers(env, gymId) {
  const query = [
    'select=id,fullname,email',
    `gym_id=eq.${encodeURIComponent(gymId)}`,
    'role=eq.member',
    'account_status=eq.active'
  ].join('&');
  const response = await requestJson(`${env.url}/rest/v1/users?${query}`, {
    headers: serviceHeaders(env)
  });

  if (!response.ok) {
    throw new Error(response.body?.message || 'Unable to load active members.');
  }

  return Array.isArray(response.body) ? response.body : [];
}

async function getLastAttendanceByUser(env, gymId, memberIds) {
  const query = [
    'select=user_id,attendance_date,attended_at',
    `gym_id=eq.${encodeURIComponent(gymId)}`,
    `user_id=in.(${memberIds.map(encodeURIComponent).join(',')})`,
    'order=attendance_date.desc'
  ].join('&');
  const response = await requestJson(`${env.url}/rest/v1/attendance_logs?${query}`, {
    headers: serviceHeaders(env)
  });

  if (!response.ok) {
    throw new Error(response.body?.message || 'Unable to load attendance logs.');
  }

  return (Array.isArray(response.body) ? response.body : []).reduce((map, log) => {
    const userId = log?.user_id;
    const attendanceDate = normalizeDate(log?.attendance_date || log?.attended_at);

    if (userId && (!map.has(userId) || attendanceDate > map.get(userId))) {
      map.set(userId, attendanceDate);
    }

    return map;
  }, new Map());
}

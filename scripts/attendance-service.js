import { createQueryContext, requireGymId, scopedInsert, scopedSelect, scopedUpdate } from './tenant-queries.js';
import { listUsers } from './profiles.js';
import { buildAttendanceSummary, normalizeAttendanceLog } from './attendance-aggregation.js';

const ATTENDANCE_TOKEN_COLUMNS = [
  'id',
  'gym_id',
  'token',
  'validity_type',
  'issued_at',
  'expires_at',
  'generated_by',
  'active',
  'revoked_at',
  'created_at'
].join(', ');

const VALIDITY_DAYS = Object.freeze({
  weekly: 7,
  fortnight: 14,
  monthly: 30
});

const ATTENDANCE_LOG_COLUMNS = [
  'id',
  'gym_id',
  'user_id',
  'qr_token_id',
  'attendance_date',
  'attended_at',
  'created_by',
  'source',
  'notes'
].join(', ');

const ATTENDANCE_SUMMARY_LOG_COLUMNS = [
  'id',
  'gym_id',
  'user_id',
  'attendance_date',
  'attended_at',
  'source'
].join(', ');

const ATTENDANCE_HISTORY_LIMIT = 80;

export async function generateAttendanceToken(validityType, { appContext } = {}) {
  try {
    const normalizedValidityType = normalizeValidityType(validityType);
    const queryContext = await createQueryContext(appContext);
    const gymId = requireGymId(queryContext.gymId);

    if (!queryContext.userId) {
      throw new Error('Missing authenticated user for attendance token generation.');
    }

    const issuedAt = new Date();
    const expiresAt = calculateExpiry(issuedAt, normalizedValidityType);

    const deactivateResult = await scopedUpdate(queryContext.supabase, 'attendance_qr_tokens', {
      active: false
    }, { gymId })
      .eq('active', true);

    if (deactivateResult.error) {
      return { tokenRecord: null, error: deactivateResult.error };
    }

    const { data, error } = await scopedInsert(queryContext.supabase, 'attendance_qr_tokens', {
      token: generateSecureToken(),
      validity_type: normalizedValidityType,
      issued_at: issuedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      generated_by: queryContext.userId,
      active: true,
      revoked_at: null
    }, { gymId })
      .select(ATTENDANCE_TOKEN_COLUMNS)
      .single();

    return { tokenRecord: error ? null : data, error };
  } catch (error) {
    return { tokenRecord: null, error };
  }
}

export async function revokeAttendanceToken(tokenId, { appContext } = {}) {
  try {
    const queryContext = await createQueryContext(appContext);
    const gymId = requireGymId(queryContext.gymId);

    if (!tokenId) {
      throw new Error('Choose an attendance token to revoke.');
    }

    const { data, error } = await scopedUpdate(queryContext.supabase, 'attendance_qr_tokens', {
      active: false,
      revoked_at: new Date().toISOString()
    }, { gymId })
      .eq('id', tokenId)
      .select(ATTENDANCE_TOKEN_COLUMNS)
      .single();

    return { tokenRecord: error ? null : data, error };
  } catch (error) {
    return { tokenRecord: null, error };
  }
}

export async function getActiveAttendanceToken({ appContext } = {}) {
  try {
    const queryContext = await createQueryContext(appContext);
    const gymId = requireGymId(queryContext.gymId);
    const { data, error } = await scopedSelect(
      queryContext.supabase,
      'attendance_qr_tokens',
      ATTENDANCE_TOKEN_COLUMNS,
      { gymId }
    )
      .eq('active', true)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('issued_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return { tokenRecord: error ? null : data || null, error };
  } catch (error) {
    return { tokenRecord: null, error };
  }
}

export async function validateAttendanceToken(token, { appContext } = {}) {
  try {
    const queryContext = await createQueryContext(appContext);
    const gymId = requireGymId(queryContext.gymId);
    const normalizedToken = String(token || '').trim();

    if (!normalizedToken) {
      return buildValidationResult(false, 'missing_token', null);
    }

    const { data, error } = await scopedSelect(
      queryContext.supabase,
      'attendance_qr_tokens',
      ATTENDANCE_TOKEN_COLUMNS,
      { gymId }
    )
      .eq('token', normalizedToken)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return buildValidationResult(false, 'not_found', null);
    }

    if (!data.active) {
      return buildValidationResult(false, 'inactive', data);
    }

    if (data.revoked_at) {
      return buildValidationResult(false, 'revoked', data);
    }

    if (new Date(data.expires_at).getTime() <= Date.now()) {
      return buildValidationResult(false, 'expired', data);
    }

    return buildValidationResult(true, null, data);
  } catch (error) {
    return buildValidationResult(false, error.message || 'validation_error', null, error);
  }
}

export async function recordAttendanceFromScan(token, { appContext } = {}) {
  try {
    const queryContext = await createQueryContext(appContext);
    const { data, error } = await queryContext.supabase.rpc('record_attendance_from_scan', {
      scan_token: String(token || '').trim()
    });
    const result = Array.isArray(data) ? data[0] : data;

    if (error) {
      throw error;
    }

    return normalizeAttendanceScanResult(result);
  } catch (error) {
    return {
      success: false,
      message: error.message || 'Unable to record attendance.'
    };
  }
}

export async function recordMemberAttendance(token, { appContext } = {}) {
  const result = await recordAttendanceFromScan(token, { appContext });

  return {
    attendanceLog: result.success ? { source: 'qr_scan' } : null,
    error: null,
    reason: result.message
  };
}

export async function searchManualAttendanceMembers({ appContext, search = '' } = {}) {
  try {
    const queryContext = await createQueryContext(appContext, { action: 'attendance:manual_log' });
    const gymId = requireGymId(queryContext.gymId);
    const { users, error } = await listUsers({
      role: 'member',
      status: 'active',
      search,
      appContext,
      gymId
    });

    if (error) {
      throw error;
    }

    const members = users || [];
    const attendanceByMember = await getTodaysAttendanceByMember(queryContext, members.map((member) => member.id), gymId);

    return {
      members: members.map((member) => ({
        ...member,
        attendanceToday: attendanceByMember.get(member.id) || null
      })),
      error: null
    };
  } catch (error) {
    return { members: [], error };
  }
}

export async function recordManualAttendance(memberId, { appContext } = {}) {
  try {
    const queryContext = await createQueryContext(appContext, { action: 'attendance:manual_log' });
    const normalizedMemberId = String(memberId || '').trim();

    if (!normalizedMemberId) {
      throw new Error('Choose a member before logging attendance.');
    }

    const { data, error } = await queryContext.supabase.rpc('record_manual_attendance', {
      member_id: normalizedMemberId
    });
    const result = Array.isArray(data) ? data[0] : data;

    if (error) {
      throw error;
    }

    return normalizeManualAttendanceResult(result);
  } catch (error) {
    return {
      success: false,
      attendanceLog: null,
      message: error.message || 'Unable to record manual attendance.'
    };
  }
}

export async function getAttendanceHistorySummary({ appContext, search = '', limit = ATTENDANCE_HISTORY_LIMIT } = {}) {
  try {
    const queryContext = await createQueryContext(appContext);
    const gymId = requireGymId(queryContext.gymId);
    const normalizedLimit = normalizeLimit(limit, ATTENDANCE_HISTORY_LIMIT);
    const normalizedSearch = String(search || '').trim();

    if (queryContext.role === 'member') {
      return await getMemberAttendanceHistory(queryContext, gymId, normalizedLimit);
    }

    if (queryContext.role !== 'admin' && queryContext.role !== 'trainer') {
      throw new Error('Your account is not allowed to view attendance history.');
    }

    const { users, error: usersError } = await listUsers({
      role: 'member',
      search: normalizedSearch,
      appContext,
      gymId
    });

    if (usersError) {
      throw usersError;
    }

    const members = users || [];
    const memberIds = members.map((member) => member.id);
    const [logs, summaryLogs] = await Promise.all([
      getRecentAttendanceLogsForMembers(queryContext, gymId, memberIds, normalizedLimit),
      getAttendanceSummaryLogsForMembers(queryContext, gymId, memberIds)
    ]);

    return {
      summary: null,
      members: buildMemberAttendanceSummaries(members, summaryLogs),
      logs: attachMembersToLogs(logs, members),
      error: null
    };
  } catch (error) {
    return { summary: null, members: [], logs: [], error };
  }
}

async function getMemberAttendanceHistory(queryContext, gymId, limit) {
  if (!queryContext.userId) {
    throw new Error('Missing member context for attendance history.');
  }

  const [logs, summaryLogs] = await Promise.all([
    getRecentAttendanceLogsForMembers(queryContext, gymId, [queryContext.userId], limit),
    getAttendanceSummaryLogsForMembers(queryContext, gymId, [queryContext.userId])
  ]);
  const member = normalizeAttendanceMember(queryContext.source?.profile || {
    id: queryContext.userId,
    fullname: 'Member'
  });

  return {
    summary: buildAttendanceSummary(summaryLogs),
    members: [buildMemberAttendanceSummary(member, summaryLogs)],
    logs: attachMembersToLogs(logs, [member]),
    error: null
  };
}

async function getRecentAttendanceLogsForMembers(queryContext, gymId, memberIds, limit) {
  return getAttendanceLogsForMembers(queryContext, gymId, memberIds, {
    columns: ATTENDANCE_LOG_COLUMNS,
    limit
  });
}

async function getAttendanceSummaryLogsForMembers(queryContext, gymId, memberIds) {
  return getAttendanceLogsForMembers(queryContext, gymId, memberIds, {
    columns: ATTENDANCE_SUMMARY_LOG_COLUMNS
  });
}

async function getAttendanceLogsForMembers(queryContext, gymId, memberIds, { columns, limit } = {}) {
  if (!memberIds.length) {
    return [];
  }

  let query = scopedSelect(
    queryContext.supabase,
    'attendance_logs',
    columns || ATTENDANCE_LOG_COLUMNS,
    { gymId }
  )
    .in('user_id', memberIds)
    .order('attendance_date', { ascending: false })
    .order('attended_at', { ascending: false });

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data || []).map(normalizeAttendanceLog);
}

function buildMemberAttendanceSummaries(members, logs) {
  const logsByMember = groupLogsByMember(logs);

  return (members || []).map((member) => (
    buildMemberAttendanceSummary(member, logsByMember.get(member.id) || [])
  ));
}

function buildMemberAttendanceSummary(member, logs) {
  return {
    member: normalizeAttendanceMember(member),
    ...buildAttendanceSummary(logs)
  };
}

function attachMembersToLogs(logs, members) {
  const memberById = new Map((members || []).map((member) => [member.id, normalizeAttendanceMember(member)]));

  return (logs || []).map((log) => ({
    ...log,
    member: memberById.get(log.user_id) || null
  }));
}

function groupLogsByMember(logs) {
  return (logs || []).reduce((grouped, log) => {
    if (!grouped.has(log.user_id)) {
      grouped.set(log.user_id, []);
    }

    grouped.get(log.user_id).push(log);
    return grouped;
  }, new Map());
}

async function getTodaysAttendanceByMember(queryContext, memberIds, gymId) {
  if (!memberIds.length) {
    return new Map();
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await scopedSelect(
    queryContext.supabase,
    'attendance_logs',
    ATTENDANCE_LOG_COLUMNS,
    { gymId }
  )
    .in('user_id', memberIds)
    .eq('attendance_date', today);

  if (error) {
    throw error;
  }

  return new Map((data || []).map((log) => [log.user_id, log]));
}

function normalizeAttendanceMember(member = {}) {
  return {
    id: member.id || null,
    fullname: member.fullname || 'Unnamed member',
    email: member.email || '',
    phone: member.phone || '',
    account_status: member.account_status || '',
    assigned_trainer: member.assigned_trainer || null
  };
}

function normalizeLimit(limit, fallback) {
  const value = Number.parseInt(limit, 10);

  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.min(value, 200);
}

function normalizeValidityType(validityType) {
  const normalized = String(validityType || '').trim().toLowerCase();

  if (!Object.prototype.hasOwnProperty.call(VALIDITY_DAYS, normalized)) {
    throw new Error('Attendance token validity must be weekly, fortnight, or monthly.');
  }

  return normalized;
}

function calculateExpiry(issuedAt, validityType) {
  const expiresAt = new Date(issuedAt);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + VALIDITY_DAYS[validityType]);
  return expiresAt;
}

function generateSecureToken() {
  const cryptoApi = globalThis.crypto;

  if (!cryptoApi?.getRandomValues) {
    throw new Error('Secure random token generation is unavailable in this environment.');
  }

  const bytes = new Uint8Array(32);
  cryptoApi.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
}

function buildValidationResult(valid, reason, tokenRecord) {
  return {
    valid,
    reason,
    tokenRecord
  };
}

function normalizeAttendanceScanResult(result = {}) {
  return {
    success: Boolean(result?.success),
    message: result?.message || 'Unable to record attendance.'
  };
}

function normalizeManualAttendanceResult(result = {}) {
  const success = Boolean(result?.success);

  return {
    success,
    attendanceLog: success ? {
      id: result.attendance_log_id || null,
      source: result.source || null,
      attendance_date: result.attendance_date || null,
      attended_at: result.attended_at || null
    } : null,
    message: result?.message || 'Unable to record manual attendance.'
  };
}

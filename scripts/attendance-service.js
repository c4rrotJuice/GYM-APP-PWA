import { createQueryContext, requireGymId, scopedInsert, scopedSelect, scopedUpdate } from './tenant-queries.js';

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

export async function recordMemberAttendance(token, { appContext } = {}) {
  try {
    const queryContext = await createQueryContext(appContext, { action: 'attendance:scan' });
    const gymId = requireGymId(queryContext.gymId);
    const validation = await validateAttendanceToken(token, { appContext });

    if (!validation.valid) {
      return {
        attendanceLog: null,
        error: null,
        reason: formatValidationReason(validation.reason)
      };
    }

    if (!queryContext.userId) {
      throw new Error('Missing authenticated member for attendance scan.');
    }

    const eligibility = await getMemberAttendanceEligibility(queryContext);

    if (eligibility.error) {
      throw eligibility.error;
    }

    if (!eligibility.canAttend) {
      return {
        attendanceLog: null,
        error: null,
        reason: formatEligibilityReason(eligibility.reason)
      };
    }

    const now = new Date();
    const { data, error } = await scopedInsert(queryContext.supabase, 'attendance_logs', {
      user_id: queryContext.userId,
      qr_token_id: validation.tokenRecord.id,
      attendance_date: formatLocalDate(now),
      attended_at: now.toISOString(),
      created_by: queryContext.userId,
      source: 'qr'
    }, { gymId })
      .select('id, gym_id, user_id, qr_token_id, attendance_date, attended_at, source')
      .single();

    if (error) {
      return {
        attendanceLog: null,
        error,
        reason: formatAttendanceError(error)
      };
    }

    return {
      attendanceLog: data,
      error: null,
      reason: null
    };
  } catch (error) {
    return {
      attendanceLog: null,
      error,
      reason: error.message || 'Unable to record attendance.'
    };
  }
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

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatValidationReason(reason) {
  const reasons = {
    missing_token: 'QR token is missing.',
    not_found: 'QR token was not found.',
    inactive: 'QR token is inactive.',
    revoked: 'QR token has been revoked.',
    expired: 'QR token has expired.',
    validation_error: 'QR token validation failed.'
  };

  return reasons[reason] || reason || 'QR token validation failed.';
}

function formatAttendanceError(error) {
  if (error?.code === '23505') {
    return 'Attendance already recorded for today.';
  }

  return error?.message || error?.details || 'Unable to record attendance.';
}

async function getMemberAttendanceEligibility(queryContext) {
  const { data, error } = await queryContext.supabase.rpc('can_attend_gym', {
    target_user_id: queryContext.userId,
    as_of: formatLocalDate(new Date())
  });
  const row = Array.isArray(data) ? data[0] : data;

  return {
    canAttend: Boolean(row?.can_attend),
    reason: row?.reason || 'unknown',
    error
  };
}

function formatEligibilityReason(reason) {
  const reasons = {
    active_membership: 'Active membership.',
    member_not_active: 'Member account is not active.',
    no_membership: 'No active membership.',
    membership_suspended: 'Membership is suspended.',
    membership_expired: 'Membership has expired.',
    membership_not_started: 'Membership has not started.',
    membership_cancelled: 'Membership has been cancelled.',
    membership_not_eligible: 'Membership is not eligible for attendance.'
  };

  return reasons[reason] || reason || 'Member is not eligible for attendance.';
}

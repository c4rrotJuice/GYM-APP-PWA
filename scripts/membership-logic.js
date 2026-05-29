export const MEMBERSHIP_DURATION_TYPES = Object.freeze({
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  CUSTOM: 'custom'
});

export const MEMBERSHIP_STATUSES = Object.freeze({
  ACTIVE: 'active',
  EXPIRED: 'expired',
  SUSPENDED: 'suspended',
  PENDING: 'pending',
  CANCELLED: 'cancelled'
});

export const DEFAULT_EXPIRY_WARNING_DAYS = 7;

const FIXED_DURATIONS = Object.freeze({
  [MEMBERSHIP_DURATION_TYPES.WEEKLY]: 7,
  [MEMBERSHIP_DURATION_TYPES.MONTHLY]: 30
});

export function normalizeDurationType(durationType) {
  const normalized = String(durationType || '').trim().toLowerCase();
  return Object.values(MEMBERSHIP_DURATION_TYPES).includes(normalized) ? normalized : null;
}

export function normalizeDurationDays(durationType, durationDays) {
  const normalizedType = normalizeDurationType(durationType);
  const fixedDuration = FIXED_DURATIONS[normalizedType];

  if (fixedDuration) {
    return fixedDuration;
  }

  const days = Number.parseInt(durationDays, 10);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('Custom membership duration must be a positive number of days.');
  }

  return days;
}

export function calculateMembershipEndDate(startDate, durationType, durationDays) {
  const start = parseDateOnly(startDate);
  const days = normalizeDurationDays(durationType, durationDays);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + days);
  return toDateOnly(end);
}

export function resolveMembershipStatus(membership, { asOf = new Date() } = {}) {
  const storedStatus = String(membership?.status || '').trim().toLowerCase();

  if (storedStatus === MEMBERSHIP_STATUSES.CANCELLED || storedStatus === MEMBERSHIP_STATUSES.SUSPENDED) {
    return storedStatus;
  }

  const startDate = membership?.start_date ? parseDateOnly(membership.start_date) : null;
  const endDate = membership?.end_date ? parseDateOnly(membership.end_date) : null;
  const comparisonDate = parseDateOnly(asOf);

  if (!startDate || !endDate) {
    return storedStatus || MEMBERSHIP_STATUSES.PENDING;
  }

  if (endDate < comparisonDate) {
    return MEMBERSHIP_STATUSES.EXPIRED;
  }

  if (startDate > comparisonDate) {
    return MEMBERSHIP_STATUSES.PENDING;
  }

  return MEMBERSHIP_STATUSES.ACTIVE;
}

export function buildMembershipOperationalState(membership, { asOf = new Date(), windowDays = DEFAULT_EXPIRY_WARNING_DAYS } = {}) {
  const status = resolveMembershipStatus(membership, { asOf });
  const daysRemaining = getDaysUntilExpiry(membership, { asOf });

  return {
    status,
    daysRemaining,
    expiringSoon: status === MEMBERSHIP_STATUSES.ACTIVE &&
      daysRemaining !== null &&
      daysRemaining >= 0 &&
      daysRemaining <= windowDays,
    canAttend: status === MEMBERSHIP_STATUSES.ACTIVE &&
      daysRemaining !== null &&
      daysRemaining >= 0
  };
}

export function recalculateMembershipStates(memberships = [], { asOf = new Date(), windowDays = DEFAULT_EXPIRY_WARNING_DAYS } = {}) {
  const recalculated = memberships.map((membership) => {
    const state = buildMembershipOperationalState(membership, { asOf, windowDays });
    return {
      ...membership,
      status: state.status,
      days_remaining: state.daysRemaining,
      expiring_soon: state.expiringSoon,
      can_attend: state.canAttend
    };
  });

  return {
    memberships: recalculated,
    summary: summarizeMembershipStates(recalculated),
    notificationTriggers: prepareExpiryNotificationTriggers(recalculated, { asOf, windowDays })
  };
}

export function calculateRenewalWindow(existingMemberships = [], plan, { asOf = new Date() } = {}) {
  const today = toDateOnly(parseDateOnly(asOf));
  const current = findCurrentRenewableMembership(existingMemberships, { asOf: today });
  const startDate = current
    ? addDays(current.end_date, 1)
    : today;

  return {
    mode: current ? 'extend' : 'new',
    renewedMembershipId: current?.id || null,
    startDate,
    endDate: calculateMembershipEndDate(startDate, plan.duration_type, plan.duration_days)
  };
}

export function findCurrentRenewableMembership(memberships = [], { asOf = new Date() } = {}) {
  const today = parseDateOnly(asOf);

  return memberships
    .filter((membership) => (
      [MEMBERSHIP_STATUSES.ACTIVE, MEMBERSHIP_STATUSES.PENDING].includes(resolveMembershipStatus(membership, { asOf: today })) &&
      parseDateOnly(membership.end_date) >= today
    ))
    .sort((left, right) => parseDateOnly(right.end_date) - parseDateOnly(left.end_date))[0] || null;
}

export function resolveActiveMembership(memberships = [], { asOf = new Date() } = {}) {
  const today = parseDateOnly(asOf);

  return memberships
    .filter((membership) => (
      resolveMembershipStatus(membership, { asOf: today }) === MEMBERSHIP_STATUSES.ACTIVE
    ))
    .sort((left, right) => parseDateOnly(right.end_date) - parseDateOnly(left.end_date))[0] || null;
}

export function canAttendGym(membershipOrMemberships, { asOf = new Date() } = {}) {
  const membership = Array.isArray(membershipOrMemberships)
    ? resolveActiveMembership(membershipOrMemberships, { asOf })
    : membershipOrMemberships;
  return buildMembershipOperationalState(membership, { asOf }).canAttend;
}

export function getDaysUntilExpiry(membership, { asOf = new Date() } = {}) {
  if (!membership?.end_date) {
    return null;
  }

  const today = parseDateOnly(asOf);
  const endDate = parseDateOnly(membership.end_date);
  return Math.ceil((endDate - today) / 86400000);
}

export function isMembershipExpiringSoon(membership, { asOf = new Date(), windowDays = 7 } = {}) {
  return buildMembershipOperationalState(membership, { asOf, windowDays }).expiringSoon;
}

export function listExpiringSoonMemberships(memberships = [], { asOf = new Date(), windowDays = DEFAULT_EXPIRY_WARNING_DAYS } = {}) {
  return memberships
    .filter((membership) => isMembershipExpiringSoon(membership, { asOf, windowDays }))
    .sort((left, right) => parseDateOnly(left.end_date) - parseDateOnly(right.end_date));
}

export function toDateOnly(value) {
  return parseDateOnly(value).toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnly(date);
}

function summarizeMembershipStates(memberships = []) {
  return memberships.reduce((summary, membership) => {
    const status = String(membership?.status || MEMBERSHIP_STATUSES.PENDING).toLowerCase();
    summary.total += 1;
    summary[status] = (summary[status] || 0) + 1;

    if (membership?.can_attend) {
      summary.attendanceReady += 1;
    }

    if (membership?.expiring_soon) {
      summary.expiringSoon += 1;
    }

    return summary;
  }, {
    total: 0,
    active: 0,
    expired: 0,
    suspended: 0,
    pending: 0,
    cancelled: 0,
    expiringSoon: 0,
    attendanceReady: 0
  });
}

function prepareExpiryNotificationTriggers(memberships = [], { asOf = new Date(), windowDays = DEFAULT_EXPIRY_WARNING_DAYS } = {}) {
  const asOfDate = toDateOnly(asOf);

  return memberships.flatMap((membership) => {
    const state = buildMembershipOperationalState(membership, { asOf, windowDays });

    if (state.expiringSoon) {
      return [{
        type: 'membership_expiring_soon',
        membershipId: membership.id || null,
        userId: membership.user_id || null,
        asOf: asOfDate,
        daysRemaining: state.daysRemaining
      }];
    }

    if (state.status === MEMBERSHIP_STATUSES.EXPIRED) {
      return [{
        type: 'membership_expired',
        membershipId: membership.id || null,
        userId: membership.user_id || null,
        asOf: asOfDate,
        daysRemaining: state.daysRemaining
      }];
    }

    return [];
  });
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

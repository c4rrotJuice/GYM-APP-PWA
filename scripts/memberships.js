import { createQueryContext, requireGymId, scopedInsert, scopedSelect, scopedUpdate } from './tenant-queries.js';
import {
  MEMBERSHIP_DURATION_TYPES,
  MEMBERSHIP_STATUSES,
  calculateMembershipEndDate,
  calculateRenewalWindow,
  normalizeDurationDays,
  normalizeDurationType,
  resolveMembershipStatus
} from './membership-logic.js';

const PLAN_COLUMNS = [
  'id',
  'gym_id',
  'name',
  'description',
  'duration_type',
  'duration_days',
  'price',
  'active',
  'created_at',
  'updated_at'
].join(', ');

const MEMBERSHIP_COLUMNS = [
  'id',
  'gym_id',
  'user_id',
  'membership_plan_id',
  'payment_id',
  'type',
  'start_date',
  'end_date',
  'status',
  'renewal_count',
  'renewed_from_membership_id',
  'suspended_at',
  'resumed_at',
  'cancelled_at',
  'expired_at',
  'last_renewed_at',
  'created_at',
  'updated_at',
  'membership_plans(name, duration_type, duration_days, price)'
].join(', ');

export {
  MEMBERSHIP_DURATION_TYPES,
  MEMBERSHIP_STATUSES,
  calculateMembershipEndDate,
  calculateRenewalWindow,
  normalizeDurationDays,
  resolveMembershipStatus
};

export async function countActiveMemberships({ session, appContext, gymId } = {}) {
  let queryContext = null;

  try {
    queryContext = await createQueryContext(appContext || session, { action: 'memberships:count_active' });
    gymId = requireGymId(gymId || queryContext.gymId);
  } catch (error) {
    return { count: 0, error };
  }

  const { count, error } = await scopedSelect(queryContext.supabase, 'memberships', 'id', {
    gymId,
    options: { count: 'exact', head: true }
  })
    .eq('status', 'active');

  if (error) {
    return { count: 0, error };
  }

  return { count: count || 0, error: null };
}

export async function listMembershipPlans({ appContext, includeInactive = true } = {}) {
  try {
    const queryContext = await createQueryContext(appContext, { action: 'membership_plans:list' });
    const gymId = requireGymId(queryContext.gymId);
    let query = scopedSelect(queryContext.supabase, 'membership_plans', PLAN_COLUMNS, { gymId })
      .order('active', { ascending: false })
      .order('name', { ascending: true });

    if (!includeInactive) {
      query = query.eq('active', true);
    }

    const { data, error } = await query;
    return { plans: error ? [] : (data || []).map(normalizePlan), error };
  } catch (error) {
    return { plans: [], error };
  }
}

export async function saveMembershipPlan(payload, { appContext } = {}) {
  try {
    const queryContext = await createQueryContext(appContext, {
      action: payload?.id ? 'membership_plans:update' : 'membership_plans:create'
    });
    const gymId = requireGymId(queryContext.gymId);
    const values = normalizePlanPayload(payload);
    const query = payload?.id
      ? scopedUpdate(queryContext.supabase, 'membership_plans', values, { gymId }).eq('id', payload.id)
      : scopedInsert(queryContext.supabase, 'membership_plans', values, { gymId });

    const { data, error } = await query.select(PLAN_COLUMNS).single();
    return { plan: error ? null : normalizePlan(data), error };
  } catch (error) {
    return { plan: null, error };
  }
}

export async function deactivateMembershipPlan(planId, { appContext } = {}) {
  try {
    const queryContext = await createQueryContext(appContext, { action: 'membership_plans:update' });
    const gymId = requireGymId(queryContext.gymId);
    const { data, error } = await scopedUpdate(queryContext.supabase, 'membership_plans', {
      active: false
    }, { gymId })
      .eq('id', planId)
      .select(PLAN_COLUMNS)
      .single();

    return { plan: error ? null : normalizePlan(data), error };
  } catch (error) {
    return { plan: null, error };
  }
}

export async function listUserMemberships(userId, { appContext } = {}) {
  try {
    const queryContext = await createQueryContext(appContext, { action: 'memberships:list' });
    const gymId = requireGymId(queryContext.gymId);
    let query = scopedSelect(queryContext.supabase, 'memberships', MEMBERSHIP_COLUMNS, { gymId })
      .order('end_date', { ascending: false });

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    return { memberships: error ? [] : (data || []).map(normalizeMembership), error };
  } catch (error) {
    return { memberships: [], error };
  }
}

export async function assignMembershipPlanToUser({ userId, planId, appContext } = {}) {
  try {
    const queryContext = await createQueryContext(appContext, { action: 'memberships:assign_plan' });
    const gymId = requireGymId(queryContext.gymId);

    if (!userId || !planId) {
      throw new Error('Choose a member and membership plan.');
    }

    const { data, error } = await queryContext.supabase.rpc('renew_membership_from_plan', {
      target_user_id: userId,
      target_plan_id: planId,
      target_payment_id: null
    });

    if (error) {
      return { membership: null, error };
    }

    const { data: membership, error: fetchError } = await scopedSelect(
      queryContext.supabase,
      'memberships',
      MEMBERSHIP_COLUMNS,
      { gymId }
    )
      .eq('id', data.id)
      .single();

    return {
      membership: normalizeMembership(membership || data),
      error: fetchError
    };
  } catch (error) {
    return { membership: null, error };
  }
}

export function getCurrentMembership(memberships = []) {
  return memberships
    .filter((membership) => resolveMembershipStatus(membership) === MEMBERSHIP_STATUSES.ACTIVE)
    .sort((left, right) => new Date(right.end_date) - new Date(left.end_date))[0] || null;
}

function normalizePlanPayload(payload) {
  const name = String(payload?.name || '').trim();
  const durationType = normalizeDurationType(payload?.duration_type);
  const durationDays = normalizeDurationDays(durationType, payload?.duration_days);
  const price = Number(payload?.price || 0);

  if (!name) {
    throw new Error('Plan name is required.');
  }

  if (!durationType) {
    throw new Error('Choose weekly, monthly, or custom duration.');
  }

  if (!Number.isFinite(price) || price < 0) {
    throw new Error('Plan price cannot be negative.');
  }

  return {
    name,
    description: String(payload?.description || '').trim() || null,
    duration_type: durationType,
    duration_days: durationDays,
    price,
    active: payload?.active === false ? false : true
  };
}

function normalizePlan(plan) {
  return {
    ...plan,
    duration_type: normalizeDurationType(plan?.duration_type),
    duration_days: Number(plan?.duration_days || 0),
    price: Number(plan?.price || 0),
    active: Boolean(plan?.active)
  };
}

function normalizeMembership(membership) {
  return {
    ...membership,
    status: resolveMembershipStatus(membership),
    renewal_count: Number(membership?.renewal_count || 0),
    plan: membership?.membership_plans || null
  };
}

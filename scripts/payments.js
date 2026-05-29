import { createQueryContext, requireGymId, scopedSelect } from './tenant-queries.js';
import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  calculateOutstandingBalance,
  normalizeMoney,
  normalizePaymentMethod,
  normalizePaymentStatus,
  summarizeRevenue
} from './payment-logic.js';

const PAYMENT_COLUMNS = [
  'id',
  'gym_id',
  'user_id',
  'membership_id',
  'amount',
  'method',
  'reference',
  'status',
  'notes',
  'paid_at',
  'created_by',
  'created_at',
  'external_provider',
  'external_transaction_id',
  'provider_payload',
  'member:users!payments_user_id_fkey(fullname, email)',
  'membership:memberships!payments_membership_id_fkey(id, type, start_date, end_date, status, membership_plan_id, membership_plans(name, price))'
].join(', ');

export {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  calculateOutstandingBalance,
  normalizePaymentMethod,
  normalizePaymentStatus,
  summarizeRevenue
};

export async function listPayments(userId = null, { appContext, limit = 50 } = {}) {
  try {
    const queryContext = await createQueryContext(appContext, { action: 'payments:list' });
    const gymId = requireGymId(queryContext.gymId);
    let query = scopedSelect(queryContext.supabase, 'payments', PAYMENT_COLUMNS, { gymId })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    return { payments: error ? [] : (data || []).map(normalizePayment), error };
  } catch (error) {
    return { payments: [], error };
  }
}

export async function recordMembershipPayment(payload, { appContext } = {}) {
  try {
    const queryContext = await createQueryContext(appContext, { action: 'payments:record' });
    const values = normalizePaymentPayload(payload);
    const { data, error } = await queryContext.supabase.rpc('record_membership_payment', {
      target_user_id: values.user_id,
      target_plan_id: values.plan_id,
      payment_amount: values.amount,
      payment_method: values.method,
      payment_reference: values.reference,
      payment_status: values.status,
      payment_notes: values.notes,
      payment_paid_at: values.paid_at,
      payment_external_provider: values.external_provider,
      payment_external_transaction_id: values.external_transaction_id,
      payment_provider_payload: values.provider_payload,
      as_of: values.as_of
    });

    return { payment: error ? null : normalizePayment(data), error };
  } catch (error) {
    return { payment: null, error };
  }
}

export async function getFinancialSummary({ appContext } = {}) {
  try {
    const queryContext = await createQueryContext(appContext, { action: 'payments:summary' });
    const { data, error } = await queryContext.supabase.rpc('financial_summary');
    const summary = Array.isArray(data) ? data[0] : data;

    return {
      summary: error ? getEmptySummary() : normalizeSummary(summary),
      error
    };
  } catch (error) {
    return { summary: getEmptySummary(), error };
  }
}

export async function listOutstandingBalances({ appContext } = {}) {
  try {
    const queryContext = await createQueryContext(appContext, { action: 'payments:summary' });
    const { data, error } = await queryContext.supabase.rpc('outstanding_membership_balances');

    return {
      balances: error ? [] : (data || []).map((item) => ({
        ...item,
        plan_price: normalizeMoney(item.plan_price),
        paid_amount: normalizeMoney(item.paid_amount),
        pending_amount: normalizeMoney(item.pending_amount),
        outstanding_amount: normalizeMoney(item.outstanding_amount)
      })),
      error
    };
  } catch (error) {
    return { balances: [], error };
  }
}

function normalizePaymentPayload(payload) {
  const amount = normalizeMoney(payload?.amount);
  const status = normalizePaymentStatus(payload?.status);

  if (!payload?.user_id) {
    throw new Error('Choose a member for this payment.');
  }

  if (!payload?.plan_id) {
    throw new Error('Choose a membership plan for this payment.');
  }

  if (amount <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }

  return {
    user_id: String(payload.user_id),
    plan_id: String(payload.plan_id),
    amount,
    method: normalizePaymentMethod(payload?.method),
    reference: String(payload?.reference || '').trim() || null,
    status,
    notes: String(payload?.notes || '').trim() || null,
    paid_at: status === PAYMENT_STATUSES.COMPLETED
      ? (payload?.paid_at || new Date().toISOString())
      : (payload?.paid_at || null),
    external_provider: String(payload?.external_provider || '').trim() || null,
    external_transaction_id: String(payload?.external_transaction_id || '').trim() || null,
    provider_payload: payload?.provider_payload || {},
    as_of: payload?.as_of || new Date().toISOString().slice(0, 10)
  };
}

function normalizePayment(payment) {
  return {
    ...payment,
    amount: normalizeMoney(payment?.amount),
    method: normalizePaymentMethod(payment?.method),
    status: normalizePaymentStatus(payment?.status),
    member: payment?.member || null,
    membership: payment?.membership || null
  };
}

function normalizeSummary(summary) {
  return {
    totalRevenue: normalizeMoney(summary?.total_revenue),
    monthlyRevenue: normalizeMoney(summary?.monthly_revenue),
    pendingBalances: normalizeMoney(summary?.pending_balances),
    recentTransactions: Array.isArray(summary?.recent_transactions)
      ? summary.recent_transactions
      : []
  };
}

function getEmptySummary() {
  return {
    totalRevenue: 0,
    monthlyRevenue: 0,
    pendingBalances: 0,
    recentTransactions: []
  };
}

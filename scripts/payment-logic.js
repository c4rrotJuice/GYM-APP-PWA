export const PAYMENT_METHODS = Object.freeze({
  CASH: 'cash',
  CARD: 'card',
  MOBILE_MONEY: 'mobile_money',
  BANK_TRANSFER: 'bank_transfer',
  OTHER: 'other'
});

export const PAYMENT_STATUSES = Object.freeze({
  COMPLETED: 'completed',
  PENDING: 'pending',
  FAILED: 'failed',
  REFUNDED: 'refunded'
});

export function normalizePaymentMethod(method) {
  const normalized = String(method || PAYMENT_METHODS.CASH).trim().toLowerCase();
  return Object.values(PAYMENT_METHODS).includes(normalized) ? normalized : PAYMENT_METHODS.CASH;
}

export function normalizePaymentStatus(status) {
  const normalized = String(status || PAYMENT_STATUSES.COMPLETED).trim().toLowerCase();
  return Object.values(PAYMENT_STATUSES).includes(normalized) ? normalized : PAYMENT_STATUSES.COMPLETED;
}

export function calculateOutstandingBalance({ planPrice = 0, completedPayments = 0 } = {}) {
  const price = normalizeMoney(planPrice);
  const paid = normalizeMoney(completedPayments);
  return Math.max(price - paid, 0);
}

export function summarizeRevenue(payments = [], { asOf = new Date() } = {}) {
  const monthKey = toMonthKey(asOf);

  return payments.reduce((summary, payment) => {
    const amount = normalizeMoney(payment?.amount);
    const status = normalizePaymentStatus(payment?.status);

    if (status === PAYMENT_STATUSES.PENDING) {
      summary.pendingBalances += amount;
    }

    if (status !== PAYMENT_STATUSES.COMPLETED) {
      return summary;
    }

    summary.totalRevenue += amount;

    if (toMonthKey(payment?.paid_at || payment?.created_at) === monthKey) {
      summary.monthlyRevenue += amount;
    }

    return summary;
  }, {
    totalRevenue: 0,
    monthlyRevenue: 0,
    pendingBalances: 0
  });
}

export function normalizeMoney(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function toMonthKey(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

import assert from 'node:assert/strict';
import { mkdtemp, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = await mkdtemp(join(tmpdir(), 'gym-payment-tests-'));
const modulePath = join(tempDir, 'payment-logic.mjs');
await copyFile(new URL('../scripts/payment-logic.js', import.meta.url), modulePath);

const {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  calculateOutstandingBalance,
  normalizePaymentMethod,
  normalizePaymentStatus,
  summarizeRevenue
} = await import(modulePath);

assert.equal(normalizePaymentMethod(''), PAYMENT_METHODS.CASH, 'blank payment method defaults to cash');
assert.equal(normalizePaymentMethod('mobile_money'), PAYMENT_METHODS.MOBILE_MONEY, 'mobile money method is supported');
assert.equal(normalizePaymentStatus('pending'), PAYMENT_STATUSES.PENDING, 'pending status is supported');
assert.equal(normalizePaymentStatus('unknown'), PAYMENT_STATUSES.COMPLETED, 'unknown status defaults to completed');

assert.equal(
  calculateOutstandingBalance({ planPrice: 100, completedPayments: 60 }),
  40,
  'outstanding balance subtracts completed payments from plan price'
);
assert.equal(
  calculateOutstandingBalance({ planPrice: 100, completedPayments: 120 }),
  0,
  'overpayment does not create negative outstanding balance'
);

assert.deepEqual(
  summarizeRevenue([
    { amount: 100, status: 'completed', paid_at: '2026-05-10T08:00:00Z' },
    { amount: 50, status: 'pending', created_at: '2026-05-11T08:00:00Z' },
    { amount: 25, status: 'failed', created_at: '2026-05-12T08:00:00Z' },
    { amount: 75, status: 'completed', paid_at: '2026-04-10T08:00:00Z' }
  ], { asOf: '2026-05-29T00:00:00Z' }),
  {
    totalRevenue: 175,
    monthlyRevenue: 100,
    pendingBalances: 50
  },
  'revenue summaries include completed revenue and pending balances only'
);

console.log('PASS - payment defaults, revenue, and balance tests');

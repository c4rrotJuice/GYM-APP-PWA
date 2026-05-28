import { ROLES, canPerformAction, normalizeRole } from '../permissions.js';
import { createQueryContext, requireGymId, scopedSelect } from '../tenant-queries.js';

export const USER_ROLES = Object.freeze([
  ROLES.MEMBER,
  ROLES.TRAINER,
  ROLES.ADMIN
]);

export const USER_STATUSES = Object.freeze([
  'active',
  'suspended',
  'disabled'
]);

export const USER_STATUS_LABELS = Object.freeze({
  active: 'Active',
  suspended: 'Suspended',
  disabled: 'Disabled'
});

const ALLOWED_CREATE_ROLES = new Set(USER_ROLES);
const ALLOWED_STATUSES = new Set(USER_STATUSES);

export async function createUserAsAdmin(payload, { session, role } = {}) {
  if (!canPerformAction(role, 'users:create')) {
    throw new Error('Only admins can create users.');
  }

  if (!session?.access_token) {
    throw new Error('Missing authenticated admin session.');
  }

  const body = normalizeCreatePayload(payload);
  const response = await fetch('/.netlify/functions/admin-create-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify(body)
  });

  const result = await readJson(response);
  if (!response.ok) {
    throw new Error(result?.error || 'Unable to create user right now.');
  }

  return result;
}

export async function listTrainerOptions({ role, session, gymId } = {}) {
  if (!canPerformAction(role, 'users:assign_trainer')) {
    return [];
  }

  const queryContext = await createQueryContext(session, { action: 'users:assign_trainer' });
  gymId = requireGymId(gymId || queryContext.gymId);

  const { data, error } = await scopedSelect(queryContext.supabase, 'users', 'id, fullname, email', { gymId })
    .eq('role', 'trainer')
    .eq('account_status', 'active')
    .order('fullname', { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

export function normalizeCreatePayload(payload) {
  const role = normalizeRole(payload?.role);

  if (!ALLOWED_CREATE_ROLES.has(role)) {
    throw new Error('Role must be member, trainer, or admin.');
  }

  const fullname = String(payload?.fullname || '').trim();
  const email = String(payload?.email || '').trim().toLowerCase();
  const phone = String(payload?.phone || '').trim();
  const assignedTrainer = String(payload?.assigned_trainer || '').trim();
  const accountStatus = normalizeUserStatus(payload?.account_status || 'active');

  if (!fullname) {
    throw new Error('Full name is required.');
  }

  if (!email || !email.includes('@')) {
    throw new Error('A valid email address is required.');
  }

  return {
    fullname,
    email,
    phone: phone || null,
    role,
    account_status: accountStatus,
    assigned_trainer: role === ROLES.MEMBER && assignedTrainer ? assignedTrainer : null
  };
}

export function normalizeUpdatePayload(payload) {
  const role = normalizeRole(payload?.role);

  if (!ALLOWED_CREATE_ROLES.has(role)) {
    throw new Error('Role must be member, trainer, or admin.');
  }

  const fullname = String(payload?.fullname || '').trim();
  const phone = String(payload?.phone || '').trim();
  const assignedTrainer = String(payload?.assigned_trainer || '').trim();
  const accountStatus = normalizeUserStatus(payload?.account_status || 'active');

  if (!fullname) {
    throw new Error('Full name is required.');
  }

  return {
    fullname,
    phone: phone || null,
    role,
    account_status: accountStatus,
    assigned_trainer: role === ROLES.MEMBER && assignedTrainer ? assignedTrainer : null
  };
}

export function normalizeUserStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();

  if (!ALLOWED_STATUSES.has(normalized)) {
    throw new Error('Status must be active, suspended, or disabled.');
  }

  return normalized;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

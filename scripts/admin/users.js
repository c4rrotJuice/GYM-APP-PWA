import { getSupabaseClientReady } from '../supabase.js';
import { normalizeRole } from '../permissions.js';
import { requireGymId, scopedSelect } from '../tenant-queries.js';

const ALLOWED_CREATE_ROLES = new Set(['member', 'trainer']);

export async function createUserAsAdmin(payload, { session, role } = {}) {
  if (normalizeRole(role) !== 'admin') {
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
  if (normalizeRole(role) !== 'admin') {
    return [];
  }

  const supabase = await getSupabaseClientReady();
  if (!supabase) {
    throw new Error('Supabase is not configured for this deployment.');
  }

  gymId = requireGymId(gymId || session);

  const { data, error } = await scopedSelect(supabase, 'users', 'id, fullname, email', { gymId })
    .eq('role', 'trainer')
    .eq('account_status', 'active')
    .order('fullname', { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

function normalizeCreatePayload(payload) {
  const role = normalizeRole(payload?.role);

  if (!ALLOWED_CREATE_ROLES.has(role)) {
    throw new Error('Role must be member or trainer.');
  }

  const fullname = String(payload?.fullname || '').trim();
  const email = String(payload?.email || '').trim().toLowerCase();
  const phone = String(payload?.phone || '').trim();
  const assignedTrainer = String(payload?.assigned_trainer || '').trim();

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
    assigned_trainer: role === 'member' && assignedTrainer ? assignedTrainer : null
  };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

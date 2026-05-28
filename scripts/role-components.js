import { createActionList, createEmptyState, escapeHtml, formatDate } from './dashboard-layout.js';

export const FUTURE_MODULE_SLOTS = Object.freeze([
  {
    key: 'membership',
    title: 'Membership',
    description: 'Plan, expiry, renewal, and payment state attach here in Phase 3.',
    badge: 'Future'
  },
  {
    key: 'attendance',
    title: 'Attendance',
    description: 'QR status, latest check-in, and attendance history attach here in Phase 3.',
    badge: 'Future'
  },
  {
    key: 'workouts',
    title: 'Workouts',
    description: 'Assigned programs and completion state attach here in Phase 3.',
    badge: 'Future'
  },
  {
    key: 'progress',
    title: 'Progress',
    description: 'Measurements, notes, and progress events attach here in Phase 3.',
    badge: 'Future'
  },
  {
    key: 'notifications',
    title: 'Notifications',
    description: 'Account and operational alerts attach here after notification support lands.',
    badge: 'Future'
  }
]);

export function createAssignedMemberCard(member) {
  const status = normalizeStatus(member.account_status);
  const active = status === 'active';

  return `
    <article class="role-card member-card" data-member-id="${escapeHtml(member.id)}">
      <div class="role-card-main">
        <div>
          <h3>${escapeHtml(member.fullname || 'Unnamed member')}</h3>
          <p>${escapeHtml(member.email || 'No email on file')}</p>
        </div>
        <span class="status-pill" data-state="${active ? 'active' : 'inactive'}">${escapeHtml(statusLabel(status))}</span>
      </div>

      <div class="role-card-meta">
        <span><strong>Role</strong>${escapeHtml(roleLabel(member.role || 'member'))}</span>
        <span><strong>Phone</strong>${escapeHtml(member.phone || 'Not set')}</span>
        <span><strong>Updated</strong>${escapeHtml(formatDate(member.updated_at))}</span>
      </div>

      <div class="role-module-strip">
        ${createFutureBadge('Membership')}
        ${createFutureBadge('Attendance')}
      </div>

      <div class="role-card-actions">
        <a class="button button-secondary button-compact" href="#members" aria-label="View member in assigned member directory">
          Quick access
        </a>
        <a class="button button-secondary button-compact" href="#workouts">
          Program slot
        </a>
      </div>
    </article>
  `;
}

export function createFutureModuleSlots(slots = FUTURE_MODULE_SLOTS) {
  return `
    <div class="future-slot-grid">
      ${slots.map((slot) => `
        <article class="future-slot" data-future-slot="${escapeHtml(slot.key)}">
          <div>
            <h3>${escapeHtml(slot.title)}</h3>
            <p>${escapeHtml(slot.description)}</p>
          </div>
          <span class="status-pill" data-state="future">${escapeHtml(slot.badge || 'Future')}</span>
        </article>
      `).join('')}
    </div>
  `;
}

export function createMemberProfileSurface({ profile, trainerAssignment }) {
  if (!profile) {
    return createEmptyState('No profile data', 'Refresh the session or contact your gym administrator.');
  }

  const inactive = normalizeStatus(profile.account_status) !== 'active';

  return `
    ${inactive ? `
      <article class="operational-alert" data-tone="warn">
        <strong>Account needs review</strong>
        <span>Your account status is ${escapeHtml(statusLabel(profile.account_status))}. Contact your gym administrator if this looks wrong.</span>
      </article>
    ` : ''}

    <div class="profile-surface">
      <article class="profile-summary-card">
        <div>
          <p class="eyebrow">Profile</p>
          <h2>${escapeHtml(profile.fullname || 'Member profile')}</h2>
          <p>${escapeHtml(profile.email || 'No email on file')}</p>
        </div>
        <span class="status-pill" data-state="${inactive ? 'inactive' : 'active'}">${escapeHtml(statusLabel(profile.account_status))}</span>
      </article>

      <dl class="dashboard-key-values">
        <div>
          <dt>Phone</dt>
          <dd>${escapeHtml(profile.phone || 'Not set')}</dd>
        </div>
        <div>
          <dt>Trainer assignment</dt>
          <dd>${escapeHtml(formatTrainerAssignment(trainerAssignment))}</dd>
        </div>
        <div>
          <dt>Joined</dt>
          <dd>${escapeHtml(formatDate(profile.created_at))}</dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>${escapeHtml(formatDate(profile.updated_at))}</dd>
        </div>
      </dl>
    </div>
  `;
}

export function createOperationalEmptyState(type) {
  const states = {
    assignedMembers: ['No assigned members', 'Members assigned to this trainer will appear here with future membership and attendance slots.'],
    profile: ['No profile data', 'Your profile could not be loaded from the current app context.'],
    future: ['Module not available yet', 'This surface is intentionally reserved for a later phase.']
  };
  const [title, description] = states[type] || states.future;
  return createEmptyState(title, description);
}

export function createMemberFutureActions() {
  return createActionList([
    { label: 'Membership section', description: 'Plan, expiry, renewal, and payment state slot.', href: '#dashboard', badge: 'Future', state: 'future', disabled: true },
    { label: 'Attendance section', description: 'QR check-in and attendance history slot.', href: '#attendance', badge: 'Future', state: 'future' },
    { label: 'Workout section', description: 'Assigned program and completion slot.', href: '#workouts', badge: 'Future', state: 'future' },
    { label: 'Progress section', description: 'Measurements and progress notes slot.', href: '#workouts', badge: 'Future', state: 'future', disabled: true },
    { label: 'Notification section', description: 'Operational alert slot for later notification support.', href: '#dashboard', badge: 'Future', state: 'future', disabled: true }
  ]);
}

function createFutureBadge(label) {
  return `
    <span>
      <strong>${escapeHtml(label)}</strong>
      <small>Future slot</small>
    </span>
  `;
}

function formatTrainerAssignment(assignment) {
  if (!assignment?.assigned) {
    return 'No trainer assigned';
  }

  return assignment.trainerId ? 'Assigned trainer on file' : 'Assigned';
}

function normalizeStatus(status) {
  return String(status || 'active').toLowerCase();
}

function statusLabel(status) {
  const normalized = normalizeStatus(status);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function roleLabel(role) {
  const normalized = String(role || '').toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

import {
  createUserAsAdmin,
  listTrainerOptions,
  USER_ROLES,
  USER_STATUSES,
  USER_STATUS_LABELS
} from '../../scripts/admin/users.js';
import {
  isInactiveProfile,
  listUsers,
  setUserAccountStatus,
  updateUserProfile
} from '../../scripts/profiles.js';

const ROLE_LABELS = Object.freeze({
  admin: 'Admin',
  trainer: 'Trainer',
  member: 'Member'
});

const SEARCH_DEBOUNCE_MS = 260;

export function createUsersView({ role }) {
  if (role !== 'admin') {
    return `
      <section class="panel" aria-labelledby="users-readonly-title">
        <div>
          <h2 id="users-readonly-title">User Directory</h2>
          <p>User management is restricted to administrators.</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="view-header" aria-labelledby="users-title">
      <p class="eyebrow">Admin</p>
      <h1 id="users-title">Users</h1>
      <p>Create accounts, update profiles, manage roles, assign trainers, and control account access inside this gym.</p>
    </section>

    <section class="panel user-admin-panel" aria-labelledby="user-list-title" data-user-admin>
      <div class="user-admin-toolbar">
        <div>
          <h2 id="user-list-title">User Management</h2>
          <p data-user-count>Loading users...</p>
        </div>
        <button class="button button-primary" type="button" data-open-create-user>Create user</button>
      </div>

      <form class="user-filter-form" data-user-filter-form role="search">
        <div class="field-group">
          <label for="user-search">Search</label>
          <input id="user-search" name="search" type="search" autocomplete="off" placeholder="Name, email, or phone" data-user-search>
        </div>
        <div class="field-group">
          <label for="user-role-filter">Role</label>
          <select id="user-role-filter" name="role" data-user-filter="role">
            <option value="all">All roles</option>
            ${renderRoleOptions('')}
          </select>
        </div>
        <div class="field-group">
          <label for="user-status-filter">Status</label>
          <select id="user-status-filter" name="status" data-user-filter="status">
            <option value="all">All statuses</option>
            ${renderStatusOptions('')}
          </select>
        </div>
        <div class="field-group">
          <label for="user-trainer-filter">Trainer</label>
          <select id="user-trainer-filter" name="trainer" data-user-filter="trainerId">
            <option value="all">Any trainer</option>
            <option value="unassigned">Unassigned members</option>
          </select>
        </div>
      </form>

      <div class="auth-message" data-user-message role="status" aria-live="polite"></div>
      <div class="user-card-grid" data-user-list aria-busy="true">
        ${renderSkeletonCards()}
      </div>
    </section>

    <div class="admin-modal-backdrop" data-user-modal hidden>
      <section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
        <div class="admin-modal-header">
          <div>
            <p class="eyebrow" data-user-modal-kicker>User profile</p>
            <h2 id="user-modal-title" data-user-modal-title>Create user</h2>
          </div>
          <button class="icon-button" type="button" data-close-user-modal aria-label="Close user form">x</button>
        </div>

        <form class="auth-form user-form" data-user-form novalidate>
          <input type="hidden" name="id" data-user-id>
          <div class="field-group">
            <label for="user-form-fullname">Full name</label>
            <input id="user-form-fullname" name="fullname" type="text" autocomplete="name" required>
          </div>
          <div class="field-group">
            <label for="user-form-email">Email</label>
            <input id="user-form-email" name="email" type="email" inputmode="email" autocomplete="email" required data-user-email>
          </div>
          <div class="field-group">
            <label for="user-form-phone">Phone</label>
            <input id="user-form-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel">
          </div>
          <div class="user-form-grid">
            <div class="field-group">
              <label for="user-form-role">Role</label>
              <select id="user-form-role" name="role" data-user-role required>
                ${renderRoleOptions('member')}
              </select>
            </div>
            <div class="field-group">
              <label for="user-form-status">Status</label>
              <select id="user-form-status" name="account_status" required>
                ${renderStatusOptions('active')}
              </select>
            </div>
          </div>
          <div class="field-group" data-trainer-field>
            <label for="user-form-trainer">Assigned trainer</label>
            <select id="user-form-trainer" name="assigned_trainer" data-user-trainer>
              <option value="">No trainer assigned</option>
            </select>
          </div>
          <div class="membership-placeholder" aria-label="Membership readiness">
            <span class="status-pill" data-state="future">Membership ready</span>
            <span>Membership state and expiry badges will attach here in Phase 3.</span>
          </div>
          <div class="auth-message" data-user-form-message role="status" aria-live="polite"></div>
          <button class="button button-primary" type="submit" data-user-form-submit>Create user</button>
        </form>
      </section>
    </div>
  `;
}

export async function initUsersPage({ target, role, appContext }) {
  const root = target?.querySelector('[data-user-admin]');
  const modal = target?.querySelector('[data-user-modal]');
  const form = target?.querySelector('[data-user-form]');

  if (!root || !modal || !form || role !== 'admin') {
    return;
  }

  const state = {
    appContext,
    users: [],
    trainers: [],
    filters: {
      role: 'all',
      status: 'all',
      trainerId: 'all',
      search: ''
    },
    modalMode: 'create',
    editingUserId: null,
    busyUserId: null,
    searchTimer: null
  };

  root.addEventListener('click', (event) => handleRootClick(event, root, modal, form, state));
  root.addEventListener('change', (event) => handleFilterChange(event, root, state));
  root.addEventListener('input', (event) => handleFilterInput(event, root, state));
  root.addEventListener('submit', (event) => event.preventDefault());
  modal.addEventListener('click', (event) => handleModalClick(event, modal));
  form.addEventListener('submit', (event) => handleFormSubmit(event, root, modal, form, state));
  form.querySelector('[data-user-role]')?.addEventListener('change', () => syncTrainerField(form));

  await loadUsers(root, state);
}

async function loadUsers(root, state, { keepMessage = false } = {}) {
  setListBusy(root, true);
  if (!keepMessage) {
    setMessage(root, 'Loading users...', '');
  }

  const [usersResult, trainersResult] = await Promise.all([
    listUsers({
      appContext: state.appContext,
      ...buildQueryFilters(state.filters)
    }),
    listTrainerOptions({
      role: state.appContext?.role,
      session: state.appContext
    }).then((trainers) => ({ trainers, error: null }))
      .catch((error) => ({ trainers: [], error }))
  ]);

  const { users, error } = usersResult;

  if (error || trainersResult.error) {
    state.users = [];
    state.trainers = [];
    renderUsers(root, state);
    setMessage(root, error?.message || trainersResult.error?.message || 'Unable to load users.', 'error');
    setListBusy(root, false);
    return;
  }

  state.users = users;
  state.trainers = trainersResult.trainers || [];
  renderTrainerFilters(root, state);
  renderUsers(root, state);
  if (!keepMessage) {
    clearMessage(root);
  }
  setListBusy(root, false);
}

function handleRootClick(event, root, modal, form, state) {
  const createButton = event.target.closest('[data-open-create-user]');
  if (createButton) {
    openUserModal(modal, form, state, { mode: 'create' });
    return;
  }

  const editButton = event.target.closest('[data-edit-user]');
  if (editButton) {
    const user = state.users.find((item) => item.id === editButton.dataset.editUser);
    if (user) {
      openUserModal(modal, form, state, { mode: 'edit', user });
    }
    return;
  }

  const statusButton = event.target.closest('[data-set-user-status]');
  if (statusButton) {
    void updateStatus(root, state, statusButton.dataset.setUserStatus, statusButton.dataset.status);
  }
}

function handleFilterChange(event, root, state) {
  const filter = event.target.closest('[data-user-filter]');
  if (!filter) {
    return;
  }

  state.filters[filter.dataset.userFilter] = filter.value;
  void loadUsers(root, state);
}

function handleFilterInput(event, root, state) {
  const search = event.target.closest('[data-user-search]');
  if (!search) {
    return;
  }

  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(() => {
    state.filters.search = search.value.trim();
    void loadUsers(root, state);
  }, SEARCH_DEBOUNCE_MS);
}

function handleModalClick(event, modal) {
  if (event.target.closest('[data-close-user-modal]') || event.target === modal) {
    closeUserModal(modal);
  }
}

async function handleFormSubmit(event, root, modal, form, state) {
  event.preventDefault();

  const submitButton = form.querySelector('[data-user-form-submit]');
  const message = form.querySelector('[data-user-form-message]');
  clearInlineMessage(message);

  const payload = getFormPayload(form);
  const validationError = validatePayload(payload, state);
  if (validationError) {
    showInlineMessage(message, validationError, 'error');
    return;
  }

  setFormBusy(form, submitButton, true, state.modalMode);

  try {
    if (state.modalMode === 'create') {
      const result = await createUserAsAdmin(payload, {
        session: state.appContext?.session,
        role: state.appContext?.role
      });
      showInlineMessage(message, `User created. Default password: ${result.temp_password}`, 'success');
      await loadUsers(root, state, { keepMessage: true });
      setMessage(root, 'User created.', 'success');
      setTimeout(() => closeUserModal(modal), 900);
      return;
    }

    const { profile, error } = await updateUserProfile(payload.id, payload, {
      appContext: state.appContext
    });

    if (error) {
      throw error;
    }

    upsertUser(state, profile);
    await loadUsers(root, state, { keepMessage: true });
    setMessage(root, 'User updated.', 'success');
    closeUserModal(modal);
  } catch (error) {
    showInlineMessage(message, error.message || 'Unable to save user.', 'error');
  } finally {
    setFormBusy(form, submitButton, false, state.modalMode);
  }
}

async function updateStatus(root, state, userId, status) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) {
    return;
  }

  if (state.appContext?.user?.id === userId && status !== 'active') {
    setMessage(root, 'You cannot disable your own admin account from this screen.', 'error');
    return;
  }

  state.busyUserId = userId;
  renderUsers(root, state);
  setMessage(root, status === 'active' ? 'Enabling user...' : 'Disabling user...', '');

  const { profile, error } = await setUserAccountStatus(userId, status, {
    appContext: state.appContext
  });

  state.busyUserId = null;

  if (error) {
    renderUsers(root, state);
    setMessage(root, error.message || 'Unable to update account status.', 'error');
    return;
  }

  upsertUser(state, profile);
  await loadUsers(root, state, { keepMessage: true });
  setMessage(root, status === 'active' ? 'User enabled.' : 'User disabled.', 'success');
}

function renderUsers(root, state) {
  const list = root.querySelector('[data-user-list]');
  const count = root.querySelector('[data-user-count]');
  const users = state.users;

  count.textContent = `${users.length} ${users.length === 1 ? 'user' : 'users'} shown`;

  if (!users.length) {
    list.innerHTML = `
      <article class="empty-state">
        <strong>No users found</strong>
        <span>Adjust the filters or create a new user for this gym.</span>
      </article>
    `;
    return;
  }

  list.innerHTML = users.map((user) => renderUserCard(user, state)).join('');
}

function renderUserCard(user, state) {
  const inactive = isInactiveProfile(user);
  const status = normalizeKnownStatus(user.account_status);
  const trainer = getTrainerLabel(user.assigned_trainer, state.users);
  const self = state.appContext?.user?.id === user.id;
  const busy = state.busyUserId === user.id;
  const canDisable = !inactive && !self;
  const canEnable = inactive;

  return `
    <article class="user-card" data-user-card="${escapeHtml(user.id)}">
      <div class="user-card-main">
        <div>
          <h3>${escapeHtml(user.fullname || 'Unnamed user')}</h3>
          <p>${escapeHtml(user.email || 'No email')}</p>
        </div>
        <span class="status-pill" data-state="${statusState(status)}">${escapeHtml(USER_STATUS_LABELS[status] || status)}</span>
      </div>

      <div class="user-card-meta">
        <span><strong>Role</strong>${escapeHtml(ROLE_LABELS[user.role] || user.role || 'Unassigned')}</span>
        <span><strong>Trainer</strong>${escapeHtml(user.role === 'member' ? trainer : 'Not applicable')}</span>
        <span><strong>Phone</strong>${escapeHtml(user.phone || 'Not set')}</span>
        <span><strong>Updated</strong>${escapeHtml(formatDate(user.updated_at))}</span>
      </div>

      <div class="membership-strip">
        <span class="status-pill" data-state="future">Membership pending</span>
        <span>Expiry badge ready for Phase 3</span>
      </div>

      <div class="user-actions">
        <button class="button button-secondary button-compact" type="button" data-edit-user="${escapeHtml(user.id)}"${busy ? ' disabled' : ''}>
          Edit
        </button>
        ${canEnable ? `
          <button class="button button-primary button-compact" type="button" data-set-user-status="${escapeHtml(user.id)}" data-status="active"${busy ? ' disabled' : ''}>
            ${busy ? 'Saving...' : 'Enable'}
          </button>
        ` : `
          <button class="button button-secondary button-compact" type="button" data-set-user-status="${escapeHtml(user.id)}" data-status="disabled"${!canDisable || busy ? ' disabled' : ''}>
            ${busy ? 'Saving...' : 'Disable'}
          </button>
        `}
      </div>
    </article>
  `;
}

function openUserModal(modal, form, state, { mode, user = null }) {
  state.modalMode = mode;
  state.editingUserId = user?.id || null;

  form.reset();
  clearInlineMessage(form.querySelector('[data-user-form-message]'));
  populateTrainerSelect(form.querySelector('[data-user-trainer]'), state.trainers, user?.assigned_trainer);

  modal.querySelector('[data-user-modal-title]').textContent = mode === 'create' ? 'Create user' : 'Edit user';
  modal.querySelector('[data-user-modal-kicker]').textContent = mode === 'create' ? 'Provision account' : 'Manage profile';
  form.querySelector('[data-user-form-submit]').textContent = mode === 'create' ? 'Create user' : 'Save changes';

  const emailInput = form.querySelector('[data-user-email]');
  emailInput.disabled = mode === 'edit';

  if (mode === 'edit' && user) {
    form.elements.id.value = user.id || '';
    form.elements.fullname.value = user.fullname || '';
    form.elements.email.value = user.email || '';
    form.elements.phone.value = user.phone || '';
    form.elements.role.value = user.role || 'member';
    form.elements.account_status.value = normalizeKnownStatus(user.account_status);
    form.elements.assigned_trainer.value = user.assigned_trainer || '';
  } else {
    form.elements.role.value = 'member';
    form.elements.account_status.value = 'active';
  }

  syncTrainerField(form);
  modal.hidden = false;
  form.elements.fullname.focus({ preventScroll: true });
}

function closeUserModal(modal) {
  modal.hidden = true;
}

function syncTrainerField(form) {
  const role = form.querySelector('[data-user-role]')?.value;
  const trainerField = form.querySelector('[data-trainer-field]');
  const trainerSelect = form.querySelector('[data-user-trainer]');
  const showTrainer = role === 'member';

  trainerField.hidden = !showTrainer;
  trainerSelect.disabled = !showTrainer;

  if (!showTrainer) {
    trainerSelect.value = '';
  }
}

function renderTrainerFilters(root, state) {
  const filter = root.querySelector('[data-user-filter="trainerId"]');
  const selected = state.filters.trainerId;
  const options = [
    '<option value="all">Any trainer</option>',
    '<option value="unassigned">Unassigned members</option>',
    ...state.trainers.map((trainer) => `
      <option value="${escapeHtml(trainer.id)}">${escapeHtml(trainer.fullname || trainer.email || 'Trainer')}</option>
    `)
  ];

  filter.innerHTML = options.join('');
  filter.value = selected;
}

function populateTrainerSelect(select, trainers, selectedTrainerId = '') {
  const options = ['<option value="">No trainer assigned</option>']
    .concat(trainers.map((trainer) => `
      <option value="${escapeHtml(trainer.id)}"${trainer.id === selectedTrainerId ? ' selected' : ''}>
        ${escapeHtml(trainer.fullname || trainer.email || 'Trainer')}
      </option>
    `));

  select.innerHTML = options.join('');
}

function getFormPayload(form) {
  const data = new FormData(form);

  return {
    id: String(data.get('id') || '').trim(),
    fullname: String(data.get('fullname') || '').trim(),
    email: String(data.get('email') || '').trim().toLowerCase(),
    phone: String(data.get('phone') || '').trim(),
    role: String(data.get('role') || '').trim(),
    account_status: String(data.get('account_status') || '').trim(),
    assigned_trainer: String(data.get('assigned_trainer') || '').trim()
  };
}

function validatePayload(payload, state) {
  if (!payload.fullname) {
    return 'Full name is required.';
  }

  if (state.modalMode === 'create' && (!payload.email || !payload.email.includes('@'))) {
    return 'A valid email address is required.';
  }

  if (!USER_ROLES.includes(payload.role)) {
    return 'Choose a valid role.';
  }

  if (!USER_STATUSES.includes(payload.account_status)) {
    return 'Choose a valid status.';
  }

  if (payload.role === 'member' && payload.assigned_trainer) {
    const trainer = state.trainers.find((item) => item.id === payload.assigned_trainer);
    if (!trainer) {
      return 'Assigned trainer must be an active trainer in this gym.';
    }
  }

  if (state.modalMode === 'edit' && state.appContext?.user?.id === payload.id) {
    const currentUser = state.users.find((user) => user.id === payload.id);

    if (payload.account_status !== 'active') {
      return 'You cannot disable your own admin account from this screen.';
    }

    if (currentUser?.role && payload.role !== currentUser.role) {
      return 'You cannot change your own admin role from this screen.';
    }
  }

  return '';
}

function buildQueryFilters(filters) {
  return {
    role: filters.role === 'all' ? null : filters.role,
    status: filters.status === 'all' ? null : filters.status,
    trainerId: filters.trainerId === 'all' ? null : filters.trainerId,
    search: filters.search
  };
}

function upsertUser(state, profile) {
  state.users = state.users.some((user) => user.id === profile.id)
    ? state.users.map((user) => user.id === profile.id ? profile : user)
    : [profile, ...state.users];
}

function renderRoleOptions(selected) {
  return USER_ROLES.map((role) => `
    <option value="${escapeHtml(role)}"${role === selected ? ' selected' : ''}>${escapeHtml(ROLE_LABELS[role] || role)}</option>
  `).join('');
}

function renderStatusOptions(selected) {
  return USER_STATUSES.map((status) => `
    <option value="${escapeHtml(status)}"${status === selected ? ' selected' : ''}>${escapeHtml(USER_STATUS_LABELS[status] || status)}</option>
  `).join('');
}

function renderSkeletonCards() {
  return Array.from({ length: 3 }, (_, index) => `
    <article class="user-card user-card-loading" aria-hidden="true">
      <div class="skeleton-line skeleton-line-wide"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line skeleton-line-short"></div>
    </article>
  `).join('');
}

function setFormBusy(form, button, busy, mode) {
  form.setAttribute('aria-busy', String(busy));
  button.disabled = busy;
  button.textContent = busy
    ? (mode === 'create' ? 'Creating user...' : 'Saving changes...')
    : (mode === 'create' ? 'Create user' : 'Save changes');
}

function setListBusy(root, busy) {
  root.querySelector('[data-user-list]')?.setAttribute('aria-busy', String(busy));
}

function setMessage(root, text, tone) {
  const message = root.querySelector('[data-user-message]');
  message.textContent = text;
  if (tone) {
    message.dataset.tone = tone;
  } else {
    delete message.dataset.tone;
  }
}

function clearMessage(root) {
  setMessage(root, '', '');
}

function showInlineMessage(target, text, tone) {
  target.textContent = text;
  target.dataset.tone = tone;
}

function clearInlineMessage(target) {
  target.textContent = '';
  delete target.dataset.tone;
}

function getTrainerLabel(trainerId, users) {
  if (!trainerId) {
    return 'Unassigned';
  }

  const trainer = users.find((user) => user.id === trainerId);
  return trainer?.fullname || trainer?.email || trainerId;
}

function normalizeKnownStatus(status) {
  return USER_STATUSES.includes(status) ? status : 'active';
}

function statusState(status) {
  if (status === 'active') {
    return 'active';
  }

  return 'inactive';
}

function formatDate(value) {
  if (!value) {
    return 'Not recorded';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

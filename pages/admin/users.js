import {
  deactivateUserProfile,
  getUserProfile,
  isInactiveProfile,
  listUsers,
  updateUserAssignedTrainer
} from '../../scripts/profiles.js';

const FILTERS = [
  ['all', 'All users'],
  ['member', 'Members only'],
  ['trainer', 'Trainers only']
];

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

  const filters = FILTERS.map(([value, label], index) => `
    <button class="filter-button" type="button" data-user-filter="${value}" aria-pressed="${index === 0 ? 'true' : 'false'}">
      ${label}
    </button>
  `).join('');

  return `
    <section class="view-header" aria-labelledby="users-title">
      <p class="eyebrow">Admin</p>
      <h1 id="users-title">Users</h1>
      <p>Review profiles, filter by role, assign trainers, and disable inactive accounts.</p>
    </section>

    <section class="panel user-admin-panel" aria-labelledby="user-list-title" data-user-admin>
      <div class="user-admin-toolbar">
        <div>
          <h2 id="user-list-title">User List</h2>
          <p data-user-count>Loading users...</p>
        </div>
        <div class="filter-group" aria-label="User filters">
          ${filters}
        </div>
      </div>

      <div class="auth-message" data-user-message role="status" aria-live="polite"></div>

      <div class="user-table-wrap">
        <table class="user-table">
          <thead>
            <tr>
              <th scope="col">Fullname</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Assigned trainer</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody data-user-list>
            <tr>
              <td colspan="6">Loading users...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export async function initUsersPage({ target, role, session }) {
  const root = target?.querySelector('[data-user-admin]');
  if (!root || role !== 'admin') {
    return;
  }

  const state = {
    filter: 'all',
    users: [],
    trainers: [],
    expandedUserId: null,
    session
  };

  root.addEventListener('click', (event) => handleUserClick(event, root, state));
  root.addEventListener('submit', (event) => event.preventDefault());
  root.addEventListener('change', (event) => {
    const select = event.target.closest('[data-trainer-select]');
    if (select) {
      select.dataset.dirty = 'true';
    }
  });

  await loadUsers(root, state);
}

async function loadUsers(root, state) {
  setMessage(root, 'Loading users...', '');

  const { users, error } = await listUsers({ session: state.session });
  if (error) {
    state.users = [];
    state.trainers = [];
    renderUsers(root, state);
    setMessage(root, error.message || 'Unable to load users.', 'error');
    return;
  }

  state.users = users;
  state.trainers = users.filter((user) => user.role === 'trainer' && !isInactiveProfile(user));
  renderUsers(root, state);
  clearMessage(root);
}

async function handleUserClick(event, root, state) {
  const filterButton = event.target.closest('[data-user-filter]');
  if (filterButton) {
    state.filter = filterButton.dataset.userFilter || 'all';
    syncFilterButtons(root, state.filter);
    renderUsers(root, state);
    return;
  }

  const detailsButton = event.target.closest('[data-view-user]');
  if (detailsButton) {
    await toggleUserDetails(root, state, detailsButton.dataset.viewUser);
    return;
  }

  const saveButton = event.target.closest('[data-save-trainer]');
  if (saveButton) {
    await saveTrainerAssignment(root, state, saveButton.dataset.saveTrainer);
    return;
  }

  const deactivateButton = event.target.closest('[data-deactivate-user]');
  if (deactivateButton) {
    await deactivateUser(root, state, deactivateButton.dataset.deactivateUser);
  }
}

function renderUsers(root, state) {
  const tbody = root.querySelector('[data-user-list]');
  const count = root.querySelector('[data-user-count]');
  const users = getFilteredUsers(state);

  count.textContent = `${users.length} ${users.length === 1 ? 'user' : 'users'} shown`;

  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6">No users match this filter.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map((user) => renderUserRows(user, state)).join('');
}

function renderUserRows(user, state) {
  const trainer = getTrainerLabel(user.assigned_trainer, state.users);
  const inactive = isInactiveProfile(user);
  const expanded = state.expandedUserId === user.id;
  const self = state.session?.user?.id === user.id;
  const trainerControl = renderTrainerControl(user, state.trainers);
  const deactivateDisabled = inactive || self ? ' disabled' : '';
  const deactivateLabel = inactive ? 'Inactive' : 'Deactivate';

  return `
    <tr>
      <td>${escapeHtml(user.fullname || 'Unnamed user')}</td>
      <td>${escapeHtml(user.email || 'No email')}</td>
      <td><span class="role-pill">${escapeHtml(user.role || 'unassigned')}</span></td>
      <td>${escapeHtml(trainer)}</td>
      <td><span class="status-pill" data-state="${inactive ? 'inactive' : 'active'}">${inactive ? 'Inactive' : 'Active'}</span></td>
      <td>
        <div class="user-actions">
          <button class="button button-secondary button-compact" type="button" data-view-user="${escapeHtml(user.id)}">
            ${expanded ? 'Hide' : 'View'}
          </button>
          <button class="button button-secondary button-compact" type="button" data-deactivate-user="${escapeHtml(user.id)}"${deactivateDisabled}>
            ${deactivateLabel}
          </button>
        </div>
      </td>
    </tr>
    <tr class="user-detail-row"${expanded ? '' : ' hidden'}>
      <td colspan="6">
        <div class="user-detail-grid">
          <div>
            <strong>Profile</strong>
            <span>ID: ${escapeHtml(user.id)}</span>
            <span>Phone: ${escapeHtml(user.phone || 'Not set')}</span>
            <span>Account status: ${escapeHtml(user.account_status || 'active')}</span>
            <span>Updated: ${escapeHtml(formatDate(user.updated_at))}</span>
          </div>
          <form class="trainer-assignment" data-assignment-form="${escapeHtml(user.id)}">
            <label for="trainer-${escapeHtml(user.id)}">Assigned trainer</label>
            ${trainerControl}
          </form>
        </div>
      </td>
    </tr>
  `;
}

function renderTrainerControl(user, trainers) {
  if (user.role !== 'member') {
    return '<span>Trainer assignment applies to members only.</span>';
  }

  const options = ['<option value="">No trainer assigned</option>']
    .concat(trainers.map((trainer) => `
      <option value="${escapeHtml(trainer.id)}"${trainer.id === user.assigned_trainer ? ' selected' : ''}>
        ${escapeHtml(trainer.fullname || trainer.email || 'Trainer')}
      </option>
    `))
    .join('');

  return `
    <div class="assignment-controls">
      <select id="trainer-${escapeHtml(user.id)}" data-trainer-select="${escapeHtml(user.id)}">
        ${options}
      </select>
      <button class="button button-primary button-compact" type="button" data-save-trainer="${escapeHtml(user.id)}">
        Save
      </button>
    </div>
  `;
}

async function toggleUserDetails(root, state, userId) {
  if (state.expandedUserId === userId) {
    state.expandedUserId = null;
    renderUsers(root, state);
    return;
  }

  setMessage(root, 'Loading user details...', '');
  const { profile, error } = await getUserProfile(userId);
  if (error) {
    setMessage(root, error.message || 'Unable to load user details.', 'error');
    return;
  }

  state.users = state.users.map((user) => user.id === userId ? profile : user);
  state.expandedUserId = userId;
  renderUsers(root, state);
  clearMessage(root);
}

async function saveTrainerAssignment(root, state, userId) {
  const select = root.querySelector(`[data-trainer-select="${cssEscape(userId)}"]`);
  if (!select) {
    return;
  }

  setMessage(root, 'Saving trainer assignment...', '');
  const { profile, error } = await updateUserAssignedTrainer(userId, select.value, {
    session: state.session
  });
  if (error) {
    setMessage(root, error.message || 'Unable to update trainer assignment.', 'error');
    return;
  }

  state.users = state.users.map((user) => user.id === userId ? profile : user);
  state.expandedUserId = userId;
  renderUsers(root, state);
  setMessage(root, 'Trainer assignment saved.', 'success');
}

async function deactivateUser(root, state, userId) {
  setMessage(root, 'Deactivating user...', '');
  const { profile, error } = await deactivateUserProfile(userId, {
    session: state.session
  });
  if (error) {
    setMessage(root, error.message || 'Unable to deactivate user.', 'error');
    return;
  }

  state.users = state.users.map((user) => user.id === userId ? profile : user);
  state.trainers = state.users.filter((user) => user.role === 'trainer' && !isInactiveProfile(user));
  renderUsers(root, state);
  setMessage(root, 'User deactivated.', 'success');
}

function getFilteredUsers(state) {
  if (state.filter === 'all') {
    return state.users;
  }

  return state.users.filter((user) => user.role === state.filter);
}

function syncFilterButtons(root, activeFilter) {
  root.querySelectorAll('[data-user-filter]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.userFilter === activeFilter));
  });
}

function getTrainerLabel(trainerId, users) {
  if (!trainerId) {
    return 'Unassigned';
  }

  const trainer = users.find((user) => user.id === trainerId);
  return trainer?.fullname || trainer?.email || trainerId;
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

function formatDate(value) {
  if (!value) {
    return 'Not recorded';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : String(value || '').replaceAll('"', '\\"');
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

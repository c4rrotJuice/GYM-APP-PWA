import { createUserAsAdmin, listTrainerOptions } from '../../scripts/admin/users.js';

export function createMembersView({ role }) {
  if (role !== 'admin') {
    return `
      <section class="panel" aria-labelledby="members-readonly-title">
        <div>
          <h2 id="members-readonly-title">Member Directory</h2>
          <p>Member creation is restricted to administrators. Trainer-facing directory tools will be added separately.</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="panel" aria-labelledby="member-create-title">
      <div>
        <h2 id="member-create-title">Create User</h2>
        <p>Provision a member or trainer in both authentication and profile storage.</p>
      </div>

      <form class="auth-form" data-admin-create-user-form novalidate>
        <div class="field-group">
          <label for="member-fullname">Full name</label>
          <input id="member-fullname" name="fullname" type="text" autocomplete="name" required>
        </div>

        <div class="field-group">
          <label for="member-email">Email</label>
          <input id="member-email" name="email" type="email" inputmode="email" autocomplete="email" required>
        </div>

        <div class="field-group">
          <label for="member-phone">Phone</label>
          <input id="member-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel">
        </div>

        <div class="field-group">
          <label for="member-role">Role</label>
          <select id="member-role" name="role" data-admin-role-select required>
            <option value="member">Member</option>
            <option value="trainer">Trainer</option>
          </select>
        </div>

        <div class="field-group" data-trainer-field>
          <label for="member-trainer">Assigned trainer</label>
          <select id="member-trainer" name="assigned_trainer" data-admin-trainer-select>
            <option value="">No trainer assigned</option>
          </select>
        </div>

        <div class="auth-message" data-admin-user-message role="status" aria-live="polite"></div>

        <button class="button button-primary" type="submit" data-admin-user-submit>Create user</button>
      </form>
    </section>
  `;
}

export async function initMembersPage({ target, session, appContext, role }) {
  const form = target?.querySelector('[data-admin-create-user-form]');
  if (!form || role !== 'admin') {
    return;
  }

  const roleSelect = form.querySelector('[data-admin-role-select]');
  const trainerField = form.querySelector('[data-trainer-field]');
  const trainerSelect = form.querySelector('[data-admin-trainer-select]');
  const message = form.querySelector('[data-admin-user-message]');
  const submitButton = form.querySelector('[data-admin-user-submit]');

  syncTrainerField(roleSelect, trainerField, trainerSelect);

  try {
    const trainers = await listTrainerOptions({ role, session: appContext || session });
    populateTrainerSelect(trainerSelect, trainers);
  } catch (error) {
    showMessage(message, error.message || 'Unable to load trainers.', 'error');
  }

  roleSelect.addEventListener('change', () => {
    syncTrainerField(roleSelect, trainerField, trainerSelect);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(message);
    setBusy(form, submitButton, true);

    try {
      const payload = getFormPayload(form);
      const result = await createUserAsAdmin(payload, { session: appContext?.session || session, role });
      form.reset();
      syncTrainerField(roleSelect, trainerField, trainerSelect);
      showMessage(
        message,
        `User created. Temporary password: ${result.temp_password}`,
        'success'
      );
    } catch (error) {
      showMessage(message, error.message || 'Unable to create user.', 'error');
    } finally {
      setBusy(form, submitButton, false);
    }
  });
}

function getFormPayload(form) {
  const data = new FormData(form);

  return {
    fullname: String(data.get('fullname') || '').trim(),
    email: String(data.get('email') || '').trim(),
    phone: String(data.get('phone') || '').trim(),
    role: String(data.get('role') || '').trim(),
    assigned_trainer: String(data.get('assigned_trainer') || '').trim()
  };
}

function populateTrainerSelect(select, trainers) {
  const options = ['<option value="">No trainer assigned</option>'];

  trainers.forEach((trainer) => {
    options.push(
      `<option value="${escapeHtml(trainer.id)}">${escapeHtml(trainer.fullname)}${trainer.email ? ` (${escapeHtml(trainer.email)})` : ''}</option>`
    );
  });

  select.innerHTML = options.join('');
}

function syncTrainerField(roleSelect, trainerField, trainerSelect) {
  const show = roleSelect.value === 'member';
  trainerField.hidden = !show;

  if (!show) {
    trainerSelect.value = '';
  }
}

function setBusy(form, button, busy) {
  form.setAttribute('aria-busy', String(busy));
  button.disabled = busy;
  button.textContent = busy ? 'Creating user...' : 'Create user';
}

function showMessage(target, text, tone) {
  target.textContent = text;
  target.dataset.tone = tone;
}

function clearMessage(target) {
  target.textContent = '';
  delete target.dataset.tone;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

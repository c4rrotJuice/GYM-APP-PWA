import {
  MEMBERSHIP_DURATION_TYPES,
  MEMBERSHIP_STATUSES,
  assignMembershipPlanToUser,
  calculateRenewalWindow,
  deactivateMembershipPlan,
  getDaysUntilExpiry,
  isMembershipExpiringSoon,
  listMembershipHistory,
  listMembershipPlans,
  listUserMemberships,
  reactivateMembership,
  saveMembershipPlan,
  suspendMembership
} from '../../scripts/memberships.js';
import { listUsers } from '../../scripts/profiles.js';
import { escapeHtml, formatDate } from '../../scripts/dashboard-layout.js';

const DURATION_LABELS = Object.freeze({
  weekly: 'Weekly',
  monthly: 'Monthly',
  custom: 'Custom'
});

export function createMembershipsView({ role }) {
  const adminControls = role === 'admin'
    ? `
      <section class="panel membership-admin-panel" data-plan-admin>
        <div class="user-admin-toolbar">
          <div>
            <h2>Membership Plans</h2>
            <p data-plan-count>Loading plans...</p>
          </div>
          <button class="button button-primary" type="button" data-open-plan-modal>Create plan</button>
        </div>
        <div class="auth-message" data-plan-message role="status" aria-live="polite"></div>
        <div class="membership-plan-grid" data-plan-list aria-busy="true"></div>
      </section>

      <section class="panel membership-admin-panel" data-membership-assign>
        <div>
          <h2>Assign Or Renew Membership</h2>
          <p>Select a member and an active plan. The system calculates dates, appends renewals, and protects active membership history.</p>
        </div>
        <form class="membership-assignment-form" data-assignment-form>
          <div class="field-group">
            <label for="membership-member">Member</label>
            <select id="membership-member" name="user_id" required data-assignment-member></select>
          </div>
          <div class="field-group">
            <label for="membership-plan">Plan</label>
            <select id="membership-plan" name="plan_id" required data-assignment-plan></select>
          </div>
          <button class="button button-primary" type="submit" data-assignment-submit>Assign or renew</button>
        </form>
        <div class="auth-message" data-assignment-message role="status" aria-live="polite"></div>
      </section>
    `
    : '';

  return `
    <section class="view-header" aria-labelledby="memberships-title">
      <p class="eyebrow">Memberships</p>
      <h1 id="memberships-title">Plans & Renewals</h1>
      <p>Centralized plan durations, deterministic expiry, and tenant-safe membership records.</p>
    </section>

    ${adminControls}

    <section class="panel membership-admin-panel" data-membership-records>
      <div class="user-admin-toolbar">
        <div>
          <h2>Membership Records</h2>
          <p data-membership-count>Loading memberships...</p>
        </div>
      </div>
      <div class="auth-message" data-membership-message role="status" aria-live="polite"></div>
      <div class="membership-record-grid" data-membership-list aria-busy="true"></div>
    </section>

    <div class="admin-modal-backdrop" data-renewal-modal hidden>
      <section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="renewal-modal-title">
        <div class="admin-modal-header">
          <div>
            <p class="eyebrow">Membership renewal</p>
            <h2 id="renewal-modal-title">Renew Membership</h2>
          </div>
          <button class="icon-button" type="button" data-close-renewal-modal aria-label="Close renewal form">x</button>
        </div>

        <form class="auth-form" data-renewal-form>
          <input type="hidden" name="user_id">
          <div class="membership-renewal-summary" data-renewal-summary></div>
          <div class="field-group">
            <label for="renewal-plan">Renewal plan</label>
            <select id="renewal-plan" name="plan_id" required data-renewal-plan></select>
          </div>
          <div class="auth-message" data-renewal-message role="status" aria-live="polite"></div>
          <button class="button button-primary" type="submit" data-renewal-submit>Renew membership</button>
        </form>
      </section>
    </div>

    <div class="admin-modal-backdrop" data-plan-modal hidden>
      <section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="plan-modal-title">
        <div class="admin-modal-header">
          <div>
            <p class="eyebrow" data-plan-modal-kicker>Membership plan</p>
            <h2 id="plan-modal-title" data-plan-modal-title>Create plan</h2>
          </div>
          <button class="icon-button" type="button" data-close-plan-modal aria-label="Close plan form">x</button>
        </div>

        <form class="auth-form" data-plan-form novalidate>
          <input type="hidden" name="id" data-plan-id>
          <div class="field-group">
            <label for="plan-name">Name</label>
            <input id="plan-name" name="name" type="text" required>
          </div>
          <div class="field-group">
            <label for="plan-description">Description</label>
            <input id="plan-description" name="description" type="text">
          </div>
          <div class="user-form-grid">
            <div class="field-group">
              <label for="plan-duration-type">Duration</label>
              <select id="plan-duration-type" name="duration_type" required data-plan-duration-type>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div class="field-group">
              <label for="plan-duration-days">Days</label>
              <input id="plan-duration-days" name="duration_days" type="number" min="1" step="1" required data-plan-duration-days>
            </div>
          </div>
          <div class="field-group">
            <label for="plan-price">Price</label>
            <input id="plan-price" name="price" type="number" min="0" step="0.01" inputmode="decimal" required>
          </div>
          <label class="checkbox-row">
            <input name="active" type="checkbox" checked>
            <span>Plan is active</span>
          </label>
          <div class="auth-message" data-plan-form-message role="status" aria-live="polite"></div>
          <button class="button button-primary" type="submit" data-plan-form-submit>Create plan</button>
        </form>
      </section>
    </div>
  `;
}

export async function initMembershipsPage({ target, role, appContext }) {
  const state = {
    appContext,
    role,
    plans: [],
    users: [],
    memberships: [],
    history: [],
    editingPlanId: null
  };

  const planRoot = target.querySelector('[data-plan-admin]');
  const recordsRoot = target.querySelector('[data-membership-records]');
  const assignmentRoot = target.querySelector('[data-membership-assign]');
  const modal = target.querySelector('[data-plan-modal]');
  const form = target.querySelector('[data-plan-form]');
  const renewalModal = target.querySelector('[data-renewal-modal]');
  const renewalForm = target.querySelector('[data-renewal-form]');

  if (planRoot && modal && form) {
    planRoot.addEventListener('click', (event) => handlePlanRootClick(event, modal, form, state));
    modal.addEventListener('click', (event) => handleModalClick(event, modal));
    form.addEventListener('submit', (event) => handlePlanSubmit(event, planRoot, modal, form, state));
    form.querySelector('[data-plan-duration-type]')?.addEventListener('change', () => syncDurationDays(form));
  }

  assignmentRoot?.querySelector('[data-assignment-form]')?.addEventListener('submit', (event) => (
    handleAssignmentSubmit(event, assignmentRoot, recordsRoot, state)
  ));
  recordsRoot?.addEventListener('click', (event) => handleMembershipAction(event, recordsRoot, renewalModal, renewalForm, state));
  renewalModal?.addEventListener('click', (event) => handleRenewalModalClick(event, renewalModal));
  renewalForm?.addEventListener('submit', (event) => handleRenewalSubmit(event, recordsRoot, renewalModal, renewalForm, state));

  await loadMembershipWorkspace({ planRoot, recordsRoot, assignmentRoot, state });
}

async function loadMembershipWorkspace({ planRoot, recordsRoot, assignmentRoot, state }) {
  setBusy(planRoot?.querySelector('[data-plan-list]'), true);
  setBusy(recordsRoot?.querySelector('[data-membership-list]'), true);

  const [plansResult, usersResult, membershipsResult, historyResult] = await Promise.all([
    state.role === 'admin' ? listMembershipPlans({ appContext: state.appContext }) : Promise.resolve({ plans: [], error: null }),
    state.role === 'admin' ? listUsers({ appContext: state.appContext, role: 'member' }) : Promise.resolve({ users: [], error: null }),
    listUserMemberships(state.role === 'member' ? state.appContext?.user?.id : null, { appContext: state.appContext }),
    listMembershipHistory(state.role === 'member' ? state.appContext?.user?.id : null, { appContext: state.appContext })
  ]);

  state.plans = plansResult.plans || [];
  state.users = usersResult.users || [];
  state.memberships = membershipsResult.memberships || [];
  state.history = historyResult.history || [];

  if (planRoot) {
    renderPlans(planRoot, state);
    setPanelMessage(planRoot, plansResult.error?.message || '', plansResult.error ? 'error' : '');
  }

  if (assignmentRoot) {
    renderAssignmentForm(assignmentRoot, state);
    setPanelMessage(assignmentRoot, usersResult.error?.message || '', usersResult.error ? 'error' : '');
  }

  renderMemberships(recordsRoot, state);
  setPanelMessage(recordsRoot, membershipsResult.error?.message || historyResult.error?.message || '', (membershipsResult.error || historyResult.error) ? 'error' : '');
  setBusy(planRoot?.querySelector('[data-plan-list]'), false);
  setBusy(recordsRoot?.querySelector('[data-membership-list]'), false);
}

function handleMembershipAction(event, recordsRoot, renewalModal, renewalForm, state) {
  const renewButton = event.target.closest('[data-renew-membership]');
  if (renewButton) {
    openRenewalModal(renewalModal, renewalForm, state, renewButton.dataset.renewMembership);
    return;
  }

  const suspendButton = event.target.closest('[data-suspend-membership]');
  if (suspendButton) {
    void updateSuspensionState(recordsRoot, state, suspendButton.dataset.suspendMembership, 'suspend');
    return;
  }

  const reactivateButton = event.target.closest('[data-reactivate-membership]');
  if (reactivateButton) {
    void updateSuspensionState(recordsRoot, state, reactivateButton.dataset.reactivateMembership, 'reactivate');
  }
}

function handleRenewalModalClick(event, modal) {
  if (event.target.closest('[data-close-renewal-modal]') || event.target === modal) {
    closeRenewalModal(modal);
  }
}

function handlePlanRootClick(event, modal, form, state) {
  const createButton = event.target.closest('[data-open-plan-modal]');
  if (createButton) {
    openPlanModal(modal, form, state);
    return;
  }

  const editButton = event.target.closest('[data-edit-plan]');
  if (editButton) {
    const plan = state.plans.find((item) => item.id === editButton.dataset.editPlan);
    if (plan) {
      openPlanModal(modal, form, state, plan);
    }
    return;
  }

  const deactivateButton = event.target.closest('[data-deactivate-plan]');
  if (deactivateButton) {
    void deactivatePlan(event.currentTarget, state, deactivateButton.dataset.deactivatePlan);
  }
}

function handleModalClick(event, modal) {
  if (event.target.closest('[data-close-plan-modal]') || event.target === modal) {
    closePlanModal(modal);
  }
}

async function handlePlanSubmit(event, root, modal, form, state) {
  event.preventDefault();
  const message = form.querySelector('[data-plan-form-message]');
  const submit = form.querySelector('[data-plan-form-submit]');
  setInlineMessage(message, '', '');
  setFormBusy(form, submit, true);

  try {
    const { plan, error } = await saveMembershipPlan(getPlanPayload(form), { appContext: state.appContext });
    if (error) {
      throw error;
    }

    state.plans = state.plans.some((item) => item.id === plan.id)
      ? state.plans.map((item) => item.id === plan.id ? plan : item)
      : [plan, ...state.plans];
    renderPlans(root, state);
    closePlanModal(modal);
    setPanelMessage(root, 'Plan saved.', 'success');
  } catch (error) {
    setInlineMessage(message, error.message || 'Unable to save plan.', 'error');
  } finally {
    setFormBusy(form, submit, false);
  }
}

async function deactivatePlan(root, state, planId) {
  setPanelMessage(root, 'Deactivating plan...', '');
  const { plan, error } = await deactivateMembershipPlan(planId, { appContext: state.appContext });

  if (error) {
    setPanelMessage(root, error.message || 'Unable to deactivate plan.', 'error');
    return;
  }

  state.plans = state.plans.map((item) => item.id === plan.id ? plan : item);
  renderPlans(root, state);
  setPanelMessage(root, 'Plan deactivated.', 'success');
}

async function handleAssignmentSubmit(event, assignmentRoot, recordsRoot, state) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[data-assignment-submit]');
  const message = assignmentRoot.querySelector('[data-assignment-message]');
  const data = new FormData(form);

  setInlineMessage(message, 'Assigning membership...', '');
  submit.disabled = true;

  const { membership, error } = await assignMembershipPlanToUser({
    userId: String(data.get('user_id') || ''),
    planId: String(data.get('plan_id') || ''),
    appContext: state.appContext
  });

  submit.disabled = false;

  if (error) {
    setInlineMessage(message, error.message || 'Unable to assign membership.', 'error');
    return;
  }

  state.memberships = state.memberships.some((item) => item.id === membership.id)
    ? state.memberships.map((item) => item.id === membership.id ? membership : item)
    : [membership, ...state.memberships];
  renderMemberships(recordsRoot, state);
  setInlineMessage(message, 'Membership assigned.', 'success');
}

async function handleRenewalSubmit(event, recordsRoot, modal, form, state) {
  event.preventDefault();
  const submit = form.querySelector('[data-renewal-submit]');
  const message = form.querySelector('[data-renewal-message]');
  const data = new FormData(form);

  setInlineMessage(message, 'Renewing membership...', '');
  submit.disabled = true;

  const { membership, error } = await assignMembershipPlanToUser({
    userId: String(data.get('user_id') || ''),
    planId: String(data.get('plan_id') || ''),
    appContext: state.appContext
  });

  submit.disabled = false;

  if (error) {
    setInlineMessage(message, error.message || 'Unable to renew membership.', 'error');
    return;
  }

  state.memberships = [membership, ...state.memberships.filter((item) => item.id !== membership.id)];
  await refreshHistory(state);
  renderMemberships(recordsRoot, state);
  closeRenewalModal(modal);
  setPanelMessage(recordsRoot, 'Membership renewed.', 'success');
}

async function updateSuspensionState(root, state, membershipId, action) {
  setPanelMessage(root, action === 'suspend' ? 'Suspending membership...' : 'Reactivating membership...', '');
  const result = action === 'suspend'
    ? await suspendMembership(membershipId, { appContext: state.appContext })
    : await reactivateMembership(membershipId, { appContext: state.appContext });

  if (result.error) {
    setPanelMessage(root, result.error.message || 'Unable to update membership.', 'error');
    return;
  }

  state.memberships = state.memberships.map((item) => item.id === result.membership.id ? result.membership : item);
  await refreshHistory(state);
  renderMemberships(root, state);
  setPanelMessage(root, action === 'suspend' ? 'Membership suspended.' : 'Membership reactivated.', 'success');
}

async function refreshHistory(state) {
  const { history } = await listMembershipHistory(state.role === 'member' ? state.appContext?.user?.id : null, { appContext: state.appContext });
  state.history = history || state.history;
}

function renderPlans(root, state) {
  const list = root.querySelector('[data-plan-list]');
  const count = root.querySelector('[data-plan-count]');
  count.textContent = `${state.plans.length} ${state.plans.length === 1 ? 'plan' : 'plans'} shown`;

  if (!state.plans.length) {
    list.innerHTML = renderEmpty('No membership plans', 'Create weekly, monthly, or custom plans for this gym.');
    return;
  }

  list.innerHTML = state.plans.map((plan) => `
    <article class="membership-plan-card">
      <div class="user-card-main">
        <div>
          <h3>${escapeHtml(plan.name)}</h3>
          <p>${escapeHtml(plan.description || 'No description')}</p>
        </div>
        <span class="status-pill" data-state="${plan.active ? 'active' : 'inactive'}">${plan.active ? 'Active' : 'Inactive'}</span>
      </div>
      <div class="user-card-meta">
        <span><strong>Duration</strong>${escapeHtml(DURATION_LABELS[plan.duration_type] || plan.duration_type)} · ${escapeHtml(plan.duration_days)} days</span>
        <span><strong>Price</strong>${escapeHtml(formatMoney(plan.price))}</span>
        <span><strong>Updated</strong>${escapeHtml(formatDate(plan.updated_at))}</span>
      </div>
      <div class="user-actions">
        <button class="button button-secondary button-compact" type="button" data-edit-plan="${escapeHtml(plan.id)}">Edit</button>
        <button class="button button-secondary button-compact" type="button" data-deactivate-plan="${escapeHtml(plan.id)}"${plan.active ? '' : ' disabled'}>Deactivate</button>
      </div>
    </article>
  `).join('');
}

function renderAssignmentForm(root, state) {
  const memberSelect = root.querySelector('[data-assignment-member]');
  const planSelect = root.querySelector('[data-assignment-plan]');
  const activePlans = state.plans.filter((plan) => plan.active);

  memberSelect.innerHTML = state.users.length
    ? state.users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.fullname || user.email)}</option>`).join('')
    : '<option value="">No members available</option>';

  planSelect.innerHTML = activePlans.length
    ? activePlans.map((plan) => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.name)} (${escapeHtml(plan.duration_days)} days)</option>`).join('')
    : '<option value="">No active plans available</option>';
}

function renderMemberships(root, state) {
  const list = root.querySelector('[data-membership-list]');
  const count = root.querySelector('[data-membership-count]');
  count.textContent = `${state.memberships.length} ${state.memberships.length === 1 ? 'membership' : 'memberships'} shown`;

  if (!state.memberships.length) {
    list.innerHTML = renderEmpty(
      state.role === 'admin' ? 'No memberships assigned yet' : 'No memberships found',
      state.role === 'admin'
        ? 'Use Assign Or Renew Membership above. After assignment, renewal, suspension, reactivation, expiry badges, and history controls appear here.'
        : 'Your active membership, expiry state, and history will appear here once assigned.'
    );
    return;
  }

  const currentByUser = new Map();
  state.memberships.forEach((membership) => {
    if (membership.status === MEMBERSHIP_STATUSES.ACTIVE && !currentByUser.has(membership.user_id)) {
      currentByUser.set(membership.user_id, membership.id);
    }
  });

  list.innerHTML = state.memberships.map((membership) => {
    const user = state.users.find((item) => item.id === membership.user_id);
    const plan = membership.plan || {};
    const window = plan.duration_type
      ? calculateRenewalWindow(state.memberships.filter((item) => item.user_id === membership.user_id), plan)
      : null;
    const daysRemaining = getDaysUntilExpiry(membership);
    const expiringSoon = isMembershipExpiringSoon(membership);
    const history = state.history.filter((item) => item.membership_id === membership.id).slice(0, 3);
    const showAdminActions = state.role === 'admin';
    const canSuspend = showAdminActions && [MEMBERSHIP_STATUSES.ACTIVE, MEMBERSHIP_STATUSES.PENDING].includes(membership.status);
    const canReactivate = showAdminActions && membership.status === MEMBERSHIP_STATUSES.SUSPENDED;
    const isCurrent = currentByUser.get(membership.user_id) === membership.id;

    return `
      <article class="membership-record-card">
        <div class="user-card-main">
          <div>
            <h3>${escapeHtml(user?.fullname || membership.type || 'Membership')}</h3>
            <p>${escapeHtml(plan.name || membership.type || 'Legacy membership')}</p>
          </div>
          <span class="status-pill" data-state="${statusState(membership.status)}">${escapeHtml(formatStatus(membership.status))}</span>
        </div>
        <div class="membership-badge-row">
          ${isCurrent ? '<span class="expiry-badge" data-state="active">Current active</span>' : ''}
          ${expiringSoon ? `<span class="expiry-badge" data-state="warning">Expires in ${escapeHtml(daysRemaining)} days</span>` : ''}
          ${membership.status === MEMBERSHIP_STATUSES.EXPIRED ? '<span class="expiry-badge" data-state="inactive">Historical</span>' : ''}
          ${membership.status === MEMBERSHIP_STATUSES.PENDING ? '<span class="expiry-badge" data-state="future">Upcoming renewal</span>' : ''}
        </div>
        <div class="user-card-meta">
          <span><strong>Start</strong>${escapeHtml(formatDate(membership.start_date))}</span>
          <span><strong>End</strong>${escapeHtml(formatDate(membership.end_date))}</span>
          <span><strong>Renewals</strong>${escapeHtml(membership.renewal_count || 0)}</span>
          <span><strong>Next renewal</strong>${escapeHtml(window ? `${window.startDate} to ${window.endDate}` : 'Plan required')}</span>
        </div>
        ${history.length ? `
          <div class="membership-history-list" aria-label="Recent membership history">
            ${history.map((item) => `
              <span><strong>${escapeHtml(formatHistoryAction(item.action))}</strong>${escapeHtml(formatDate(item.created_at))}</span>
            `).join('')}
          </div>
        ` : ''}
        ${showAdminActions ? `
          <div class="user-actions">
            <button class="button button-secondary button-compact" type="button" data-renew-membership="${escapeHtml(membership.id)}">Renew</button>
            <button class="button button-secondary button-compact" type="button" data-suspend-membership="${escapeHtml(membership.id)}"${canSuspend ? '' : ' disabled'}>Suspend</button>
            <button class="button button-secondary button-compact" type="button" data-reactivate-membership="${escapeHtml(membership.id)}"${canReactivate ? '' : ' disabled'}>Reactivate</button>
          </div>
        ` : ''}
      </article>
    `;
  }).join('');
}

function openRenewalModal(modal, form, state, membershipId) {
  const membership = state.memberships.find((item) => item.id === membershipId);
  if (!modal || !form || !membership) {
    return;
  }

  const user = state.users.find((item) => item.id === membership.user_id);
  const activePlans = state.plans.filter((plan) => plan.active);
  form.reset();
  form.elements.user_id.value = membership.user_id;
  form.querySelector('[data-renewal-summary]').innerHTML = `
    <strong>${escapeHtml(user?.fullname || membership.type || 'Member')}</strong>
    <span>${escapeHtml(formatDate(membership.start_date))} to ${escapeHtml(formatDate(membership.end_date))}</span>
  `;
  form.querySelector('[data-renewal-plan]').innerHTML = activePlans.length
    ? activePlans.map((plan) => `<option value="${escapeHtml(plan.id)}"${plan.id === membership.membership_plan_id ? ' selected' : ''}>${escapeHtml(plan.name)} (${escapeHtml(plan.duration_days)} days)</option>`).join('')
    : '<option value="">No active plans available</option>';
  setInlineMessage(form.querySelector('[data-renewal-message]'), '', '');
  modal.hidden = false;
  form.querySelector('[data-renewal-plan]')?.focus({ preventScroll: true });
}

function closeRenewalModal(modal) {
  modal.hidden = true;
}

function openPlanModal(modal, form, state, plan = null) {
  state.editingPlanId = plan?.id || null;
  form.reset();
  setInlineMessage(form.querySelector('[data-plan-form-message]'), '', '');

  modal.querySelector('[data-plan-modal-title]').textContent = plan ? 'Edit plan' : 'Create plan';
  modal.querySelector('[data-plan-modal-kicker]').textContent = plan ? 'Update duration' : 'New membership plan';
  form.querySelector('[data-plan-form-submit]').textContent = plan ? 'Save plan' : 'Create plan';
  form.elements.id.value = plan?.id || '';
  form.elements.name.value = plan?.name || '';
  form.elements.description.value = plan?.description || '';
  form.elements.duration_type.value = plan?.duration_type || MEMBERSHIP_DURATION_TYPES.MONTHLY;
  form.elements.duration_days.value = plan?.duration_days || 30;
  form.elements.price.value = plan?.price || 0;
  form.elements.active.checked = plan?.active !== false;
  syncDurationDays(form);
  modal.hidden = false;
  form.elements.name.focus({ preventScroll: true });
}

function closePlanModal(modal) {
  modal.hidden = true;
}

function syncDurationDays(form) {
  const type = form.querySelector('[data-plan-duration-type]')?.value;
  const days = form.querySelector('[data-plan-duration-days]');

  if (type === MEMBERSHIP_DURATION_TYPES.WEEKLY) {
    days.value = 7;
    days.readOnly = true;
  } else if (type === MEMBERSHIP_DURATION_TYPES.MONTHLY) {
    days.value = 30;
    days.readOnly = true;
  } else {
    days.readOnly = false;
  }
}

function getPlanPayload(form) {
  const data = new FormData(form);
  return {
    id: String(data.get('id') || '').trim(),
    name: String(data.get('name') || '').trim(),
    description: String(data.get('description') || '').trim(),
    duration_type: String(data.get('duration_type') || '').trim(),
    duration_days: String(data.get('duration_days') || '').trim(),
    price: String(data.get('price') || '0').trim(),
    active: data.get('active') === 'on'
  };
}

function setBusy(target, busy) {
  target?.setAttribute('aria-busy', String(busy));
}

function setPanelMessage(root, text, tone) {
  const message = root?.querySelector('.auth-message');
  if (!message) {
    return;
  }

  setInlineMessage(message, text, tone);
}

function setInlineMessage(target, text, tone) {
  target.textContent = text;
  if (tone) {
    target.dataset.tone = tone;
  } else {
    delete target.dataset.tone;
  }
}

function setFormBusy(form, button, busy) {
  form.setAttribute('aria-busy', String(busy));
  button.disabled = busy;
  button.textContent = busy ? 'Saving plan...' : (form.elements.id.value ? 'Save plan' : 'Create plan');
}

function renderEmpty(title, description) {
  return `
    <article class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(description)}</span>
    </article>
  `;
}

function statusState(status) {
  if (status === 'active') {
    return 'active';
  }

  if (status === 'expired' || status === 'cancelled' || status === 'suspended') {
    return 'inactive';
  }

  return 'future';
}

function formatStatus(status) {
  return String(status || '').replace(/_/g, ' ');
}

function formatHistoryAction(action) {
  return String(action || '').replace(/_/g, ' ');
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

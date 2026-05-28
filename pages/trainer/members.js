import { createDashboardSection, createDashboardShell, createEmptyState } from '../../scripts/dashboard-layout.js';
import { createAssignedMemberCard, createOperationalEmptyState } from '../../scripts/role-components.js';
import { getTrainerAssignedMembers } from '../../scripts/role-queries.js';

const SEARCH_DEBOUNCE_MS = 260;

export function createTrainerMembersView({ supabaseReady }) {
  return createDashboardShell({
    eyebrow: supabaseReady ? 'Trainer scope' : 'Offline shell',
    title: 'Assigned Members',
    description: 'Searchable member directory scoped to members assigned to your trainer account.',
    status: { text: 'Loading assigned members...', busy: true },
    body: `
      ${createDashboardSection({
        title: 'Member Directory',
        description: 'Each card exposes profile state plus future membership and attendance slots.',
        body: `
          <div class="trainer-member-directory" data-trainer-member-directory>
            <form class="directory-search" data-trainer-member-search-form role="search">
              <div class="field-group">
                <label for="trainer-member-search">Search assigned members</label>
                <input id="trainer-member-search" name="search" type="search" autocomplete="off" placeholder="Name, email, or phone" data-trainer-member-search>
              </div>
            </form>
            <p class="auth-message" data-trainer-member-message role="status" aria-live="polite">Loading assigned members...</p>
            <div class="role-card-grid" data-trainer-member-list aria-busy="true">
              ${renderSkeletonCards()}
            </div>
          </div>
        `
      })}
    `
  });
}

export async function initTrainerMembersPage({ target, appContext }) {
  const root = target?.querySelector('[data-trainer-member-directory]');
  const status = target?.querySelector('.dashboard-status');

  if (!root) {
    return;
  }

  const state = {
    appContext,
    search: '',
    searchTimer: null
  };

  root.addEventListener('input', (event) => {
    const search = event.target.closest('[data-trainer-member-search]');
    if (!search) {
      return;
    }

    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      state.search = search.value.trim();
      void loadMembers(root, status, state);
    }, SEARCH_DEBOUNCE_MS);
  });

  root.addEventListener('submit', (event) => event.preventDefault());
  await loadMembers(root, status, state);
}

async function loadMembers(root, status, state) {
  const list = root.querySelector('[data-trainer-member-list]');
  list.setAttribute('aria-busy', 'true');
  setMessage(root, 'Loading assigned members...', '');

  const { members, error } = await getTrainerAssignedMembers({
    appContext: state.appContext,
    search: state.search
  });

  if (error) {
    list.innerHTML = createOperationalEmptyState('assignedMembers');
    list.setAttribute('aria-busy', 'false');
    setMessage(root, error.message || 'Unable to load assigned members.', 'error');
    setStatus(status, 'Unable to load assigned members.', 'error');
    return;
  }

  renderMembers(root, members || [], state.search);
  list.setAttribute('aria-busy', 'false');
  setMessage(root, `${members.length} assigned ${members.length === 1 ? 'member' : 'members'} shown.`, 'success');
  setStatus(status, 'Assigned member directory is current.', 'success');
}

function renderMembers(root, members, search) {
  const list = root.querySelector('[data-trainer-member-list]');

  if (!members.length) {
    list.innerHTML = search
      ? createEmptyState('No matching assigned members', 'Try a different name, email, or phone search.')
      : createOperationalEmptyState('assignedMembers');
    return;
  }

  list.innerHTML = members.map((member) => createAssignedMemberCard(member)).join('');
}

function renderSkeletonCards() {
  return Array.from({ length: 3 }, () => `
    <article class="role-card user-card-loading" aria-hidden="true">
      <div class="skeleton-line skeleton-line-wide"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line skeleton-line-short"></div>
    </article>
  `).join('');
}

function setStatus(target, text, tone) {
  if (!target) {
    return;
  }

  target.textContent = text;
  target.setAttribute('aria-busy', 'false');
  target.dataset.tone = tone;
}

function setMessage(root, text, tone) {
  const message = root.querySelector('[data-trainer-member-message]');
  message.textContent = text;
  if (tone) {
    message.dataset.tone = tone;
  } else {
    delete message.dataset.tone;
  }
}

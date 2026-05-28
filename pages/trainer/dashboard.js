import { loadDashboardBootstrap } from '../../scripts/dashboard-bootstrap.js';
import {
  createActionList,
  createCompactList,
  createDashboardSection,
  createDashboardShell,
  createMetricGrid,
  formatDate
} from '../../scripts/dashboard-layout.js';

export function createTrainerDashboardView({ supabaseReady }) {
  return createDashboardShell({
    eyebrow: supabaseReady ? 'Assigned scope' : 'Offline shell',
    title: 'Trainer Dashboard',
    description: 'Assigned member overview, preparation tasks, and workout planning readiness.',
    status: { text: 'Loading assigned member workspace...', busy: true },
    body: `
      <div data-dashboard-root="trainer" aria-busy="true">
        ${createMetricGrid([
          { label: 'Assigned members', value: '...' },
          { label: 'Active members', value: '...' },
          { label: 'Recent attendance', value: '...' }
        ], { label: 'Trainer dashboard metrics' })}
      </div>
    `
  });
}

export async function initTrainerDashboardPage({ target, appContext }) {
  const root = target?.querySelector('[data-dashboard-root="trainer"]');
  const status = target?.querySelector('.dashboard-status');

  if (!root) {
    return;
  }

  const { data, error } = await loadDashboardBootstrap({ appContext });

  if (error || !data) {
    setStatus(status, error?.message || 'Unable to load trainer dashboard.', 'error');
    root.setAttribute('aria-busy', 'false');
    return;
  }

  root.innerHTML = renderTrainerDashboard(data);
  root.setAttribute('aria-busy', 'false');
  setStatus(status, 'Assigned member workspace is current.', 'success');
}

function renderTrainerDashboard(data) {
  const members = data.assignedMembers || [];

  return `
    ${createMetricGrid([
      { label: 'Assigned members', value: data.totals.assignedMembers, detail: 'Visible through trainer scope' },
      { label: 'Active members', value: data.totals.activeAssigned, detail: 'Ready for attendance and programs' },
      { label: 'Workout programs', value: data.totals.workoutPrograms, detail: 'Program builder scaffold' }
    ], { label: 'Trainer dashboard metrics' })}

    <div class="dashboard-grid dashboard-grid-wide">
      ${createDashboardSection({
        title: 'Assigned Member Quick Access',
        description: members.length ? 'Members currently assigned to this trainer.' : 'Assigned members will appear here after admin assignment.',
        body: createCompactList(members.slice(0, 6).map((member) => ({
          title: member.fullname || member.email || 'Unnamed member',
          description: `${member.email || 'No email'} - updated ${formatDate(member.updated_at)}`,
          badge: member.account_status === 'active' ? 'Active' : 'Review',
          state: member.account_status === 'active' ? 'active' : 'inactive'
        })), {
          emptyTitle: 'No assigned members',
          emptyDescription: 'Ask an admin to assign member profiles to your trainer account.'
        })
      })}
      ${createDashboardSection({
        title: 'Preparation Widgets',
        description: 'Scaffolded operations for attendance follow-up and program planning.',
        body: createActionList([
          { label: 'Review assigned members', description: 'Open the scoped member directory.', href: '#members', badge: 'Open' },
          { label: 'Prepare attendance follow-up', description: 'Attendance summaries attach in Phase 3.', href: '#attendance', badge: 'Future', state: 'future' },
          { label: 'Draft workout programs', description: 'Program creation is staged for the workouts module.', href: '#workouts', badge: 'Ready' }
        ])
      })}
    </div>

    ${createDashboardSection({
      title: 'Recent Member Activity',
      description: 'Activity cards are ready for attendance, workout, and progress events once Phase 3 data is enabled.',
      body: createCompactList([
        { title: 'Attendance feed', description: 'Recent check-ins will be scoped to assigned members.', badge: 'Future', state: 'future' },
        { title: 'Workout completion', description: 'Program completion updates will appear here.', badge: 'Future', state: 'future' },
        { title: 'Progress notes', description: 'Member progress updates will attach to this timeline.', badge: 'Future', state: 'future' }
      ])
    })}
  `;
}

function setStatus(target, text, tone) {
  if (!target) {
    return;
  }

  target.textContent = text;
  target.setAttribute('aria-busy', 'false');
  target.dataset.tone = tone;
}

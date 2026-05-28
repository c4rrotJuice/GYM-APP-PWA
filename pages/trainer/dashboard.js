import { loadDashboardBootstrap } from '../../scripts/dashboard-bootstrap.js';
import {
  createActionList,
  createDashboardSection,
  createDashboardShell,
  createMetricGrid,
  createEmptyState
} from '../../scripts/dashboard-layout.js';
import { createAssignedMemberCard, createFutureModuleSlots } from '../../scripts/role-components.js';

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
      { label: 'Recent attendance', value: data.totals.recentAttendance, detail: 'Assigned attendance scope' },
      { label: 'Workout programs', value: data.totals.workoutPrograms, detail: 'Program builder scaffold' }
    ], { label: 'Trainer dashboard metrics' })}

    <div class="dashboard-grid dashboard-grid-wide">
      ${createDashboardSection({
        title: 'Assigned Member Quick Access',
        description: members.length ? 'Members currently assigned to this trainer.' : 'Assigned members will appear here after admin assignment.',
        body: members.length
          ? `<div class="role-card-grid role-card-grid-compact">${members.slice(0, 4).map((member) => createAssignedMemberCard(member)).join('')}</div>`
          : createEmptyState('No assigned members', 'Ask an admin to assign member profiles to your trainer account.')
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
      title: 'Future Module Slots',
      description: 'Stable insertion points for attendance, workouts, progress, memberships, and notifications.',
      body: createFutureModuleSlots()
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

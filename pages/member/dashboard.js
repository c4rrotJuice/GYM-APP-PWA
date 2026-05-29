import { loadDashboardBootstrap } from '../../scripts/dashboard-bootstrap.js';
import {
  createActionList,
  createCompactList,
  createDashboardSection,
  createDashboardShell,
  createKeyValueList,
  createMetricGrid,
  formatDate
} from '../../scripts/dashboard-layout.js';
import {
  createFutureModuleSlots,
  createMemberProfileSurface
} from '../../scripts/role-components.js';

export function createMemberDashboardView({ supabaseReady }) {
  return createDashboardShell({
    eyebrow: supabaseReady ? 'Personal scope' : 'Offline shell',
    title: 'Member Dashboard',
    description: 'Personal profile, membership readiness, attendance status, workouts, and progress placeholders.',
    status: { text: 'Loading member workspace...', busy: true },
    body: `
      <div data-dashboard-root="member" aria-busy="true">
        ${createMetricGrid([
          { label: 'Membership records', value: '...' },
          { label: 'Attendance logs', value: '...' },
          { label: 'Workouts', value: '...' }
        ], { label: 'Member dashboard metrics' })}
      </div>
    `
  });
}

export async function initMemberDashboardPage({ target, appContext }) {
  const root = target?.querySelector('[data-dashboard-root="member"]');
  const status = target?.querySelector('.dashboard-status');

  if (!root) {
    return;
  }

  const { data, error } = await loadDashboardBootstrap({ appContext });

  if (error || !data) {
    setStatus(status, error?.message || 'Unable to load member dashboard.', 'error');
    root.setAttribute('aria-busy', 'false');
    return;
  }

  root.innerHTML = renderMemberDashboard(data);
  root.setAttribute('aria-busy', 'false');
  setStatus(status, 'Member workspace is current.', 'success');
}

function renderMemberDashboard(data) {
  const profile = data.profile || null;
  const currentMembership = data.membership?.current || null;
  const eligibility = data.membership?.eligibility || null;
  const membershipRecords = data.membership?.records || [];
  const daysRemaining = eligibility?.daysRemaining ?? currentMembership?.days_remaining ?? null;
  const statusLabel = eligibility?.membershipStatus || currentMembership?.status || 'No active membership';

  return `
    ${createMetricGrid([
      { label: 'Membership records', value: data.totals.memberships, detail: 'History visible in your tenant scope' },
      { label: 'Gym access', value: eligibility?.canAttend ? 'Ready' : 'Blocked', detail: formatEligibilityReason(eligibility?.reason), state: eligibility?.canAttend ? 'active' : 'inactive' },
      { label: 'Days remaining', value: daysRemaining ?? '--', detail: currentMembership ? 'Current membership window' : 'Renewal required', state: daysRemaining !== null && daysRemaining <= 7 ? 'warning' : '' },
      { label: 'Attendance logs', value: data.totals.attendanceLogs, detail: 'Eligibility now depends on membership state' },
      { label: 'Assigned workouts', value: data.totals.workouts, detail: 'Workout plans will appear here' },
      { label: 'Progress logs', value: data.totals.progressLogs, detail: 'Progress tracking scaffold' }
    ], { label: 'Member dashboard metrics' })}

    <div class="dashboard-grid dashboard-grid-wide">
      ${createDashboardSection({
        title: 'Operational Profile',
        description: 'Profile, account status, trainer assignment, and session-safe member identity.',
        body: createMemberProfileSurface({
          profile,
          trainerAssignment: data.trainerAssignment
        })
      })}
      ${createDashboardSection({
        title: 'Member Operations',
        description: eligibility?.canAttend
          ? 'Your membership is currently eligible for attendance validation.'
          : 'Renewal is required before attendance validation can pass.',
        body: createActionList([
          { label: 'View membership records', description: 'Open your plan history and renewal status.', href: '#memberships', badge: 'Open' },
          { label: 'Renew membership', description: 'Contact the desk or admin to renew access.', href: '#memberships', badge: eligibility?.canAttend ? 'Optional' : 'Required', state: eligibility?.canAttend ? 'future' : 'inactive' },
          { label: 'Attendance scan', description: 'Check-in only succeeds when Gym access is Ready.', href: '#attendance', badge: eligibility?.canAttend ? 'Ready' : 'Blocked', state: eligibility?.canAttend ? 'active' : 'inactive' }
        ])
      })}
    </div>

    ${createDashboardSection({
      title: 'Membership Status',
      description: currentMembership ? 'Current membership resolved with expiry-safe logic.' : 'No attendance-ready membership is currently resolved.',
      body: createKeyValueList([
        ['Status', statusLabel],
        ['Attendance eligibility', eligibility?.canAttend ? 'Can attend today' : 'Cannot attend today'],
        ['Renewal prompt', getRenewalPrompt({ currentMembership, eligibility })],
        ['Plan', currentMembership?.plan?.name || currentMembership?.type || 'Not assigned'],
        ['Start', currentMembership ? formatDate(currentMembership.start_date) : 'Not assigned'],
        ['End', currentMembership ? formatDate(currentMembership.end_date) : 'Not assigned'],
        ['Days remaining', daysRemaining === null ? 'Not available' : String(daysRemaining)]
      ])
    })}

    ${createDashboardSection({
      title: 'Membership Timeline',
      description: 'Latest visible membership records with expiry indicators.',
      body: createCompactList(membershipRecords.slice(0, 4).map((membership) => ({
        title: membership.plan?.name || membership.type || 'Membership',
        description: `${formatDate(membership.start_date)} to ${formatDate(membership.end_date)}`,
        badge: formatMembershipBadge(membership),
        state: membershipBadgeState(membership)
      })), {
        emptyTitle: 'No membership records',
        emptyDescription: 'Your membership status appears here after assignment.'
      })
    })}

    ${createDashboardSection({
      title: 'Future Module Slots',
      description: 'Stable insertion points for memberships, attendance, workouts, progress, and notifications.',
      body: createFutureModuleSlots()
    })}
  `;
}

function getRenewalPrompt({ currentMembership, eligibility }) {
  if (!currentMembership) {
    return 'Renewal required';
  }

  if (!eligibility?.canAttend) {
    return formatEligibilityReason(eligibility?.reason);
  }

  const daysRemaining = eligibility?.daysRemaining ?? currentMembership?.days_remaining;
  if (daysRemaining !== null && daysRemaining <= 7) {
    return `Renew soon - ${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} left`;
  }

  return 'No renewal action required today';
}

function formatMembershipBadge(membership) {
  if (membership.expiring_soon) {
    return `Expires in ${membership.days_remaining} days`;
  }

  return formatStatus(membership.status);
}

function membershipBadgeState(membership) {
  if (membership.expiring_soon) {
    return 'warning';
  }

  if (membership.status === 'active') {
    return 'active';
  }

  if (membership.status === 'expired' || membership.status === 'suspended' || membership.status === 'cancelled') {
    return 'inactive';
  }

  return 'future';
}

function formatEligibilityReason(reason) {
  const labels = {
    active_membership: 'Active membership',
    membership_expired: 'Membership expired',
    membership_suspended: 'Membership suspended',
    membership_not_started: 'Membership not started',
    membership_cancelled: 'Membership cancelled',
    no_membership: 'No membership',
    member_not_active: 'Member account inactive'
  };

  return labels[reason] || 'Membership review required';
}

function formatStatus(status) {
  return String(status || 'unknown').replace(/_/g, ' ');
}

function setStatus(target, text, tone) {
  if (!target) {
    return;
  }

  target.textContent = text;
  target.setAttribute('aria-busy', 'false');
  target.dataset.tone = tone;
}

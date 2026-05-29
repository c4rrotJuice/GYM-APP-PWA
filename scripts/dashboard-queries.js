import { listUsers } from './profiles.js';
import {
  getCurrentMembership,
  listExpiringMemberships,
  listUserMemberships
} from './memberships.js';
import {
  countScopedRows,
  getMemberOperationalProfile,
  getTrainerAssignedMembers
} from './role-queries.js';
import { getFinancialSummary, listPayments } from './payments.js';

export async function getAdminDashboardData({ appContext } = {}) {
  const [usersResult, membershipResult, expiringResult, attendanceResult, workoutResult, financialResult, paymentsResult] = await Promise.all([
    listUsers({ appContext }),
    countScopedRows('memberships', {
      appContext,
      filters: [
        { column: 'status', value: 'active' },
        { column: 'end_date', operator: 'gte', value: new Date().toISOString().slice(0, 10) }
      ]
    }),
    listExpiringMemberships({ appContext, windowDays: 7 }),
    countScopedRows('attendance_logs', { appContext }),
    countScopedRows('workout_programs', { appContext }),
    getFinancialSummary({ appContext }),
    listPayments(null, { appContext, limit: 8 })
  ]);

  const errors = [
    usersResult.error,
    membershipResult.error
  ].filter(Boolean);

  if (errors.length) {
    return { data: null, error: errors[0] };
  }

  const users = usersResult.users || [];
  return {
    data: {
      users,
      totals: {
        totalUsers: users.length,
        totalMembers: users.filter((user) => user.role === 'member').length,
        totalTrainers: users.filter((user) => user.role === 'trainer').length,
        activeMemberships: membershipResult.count,
        expiringSoon: expiringResult.error ? null : expiringResult.memberships.length,
        attendanceLogs: attendanceResult.error ? null : attendanceResult.count,
        workoutPrograms: workoutResult.error ? null : workoutResult.count,
        totalRevenue: financialResult.summary?.totalRevenue ?? null,
        monthlyRevenue: financialResult.summary?.monthlyRevenue ?? null,
        pendingBalances: financialResult.summary?.pendingBalances ?? null
      },
      financial: {
        summary: financialResult.summary,
        recentTransactions: paymentsResult.payments || []
      },
      memberships: {
        expiringSoon: expiringResult.memberships || []
      },
      gym: buildGymSnapshot(appContext, users)
    },
    error: null
  };
}

export async function getTrainerDashboardData({ appContext } = {}) {
  const [membersResult, attendanceResult, workoutResult] = await Promise.all([
    getTrainerAssignedMembers({ appContext }),
    countScopedRows('attendance_logs', { appContext }),
    countScopedRows('workout_programs', { appContext })
  ]);

  if (membersResult.error) {
    return { data: null, error: membersResult.error };
  }

  const assignedMembers = membersResult.members || [];
  return {
    data: {
      assignedMembers,
      totals: {
        assignedMembers: assignedMembers.length,
        activeAssigned: assignedMembers.filter((member) => member.account_status === 'active').length,
        recentAttendance: attendanceResult.error ? null : attendanceResult.count,
        workoutPrograms: workoutResult.error ? null : workoutResult.count
      }
    },
    error: null
  };
}

export async function getMemberDashboardData({ appContext } = {}) {
  const [profileResult, membershipResult, membershipsResult, attendanceResult, workoutResult, progressResult] = await Promise.all([
    getMemberOperationalProfile({ appContext }),
    countScopedRows('memberships', {
      appContext,
      filters: [{ column: 'user_id', value: appContext?.user?.id }]
    }),
    listUserMemberships(appContext?.user?.id, { appContext }),
    countScopedRows('attendance_logs', {
      appContext,
      filters: [{ column: 'user_id', value: appContext?.user?.id }]
    }),
    countScopedRows('user_workouts', {
      appContext,
      filters: [{ column: 'user_id', value: appContext?.user?.id }]
    }),
    countScopedRows('progress_logs', {
      appContext,
      filters: [{ column: 'user_id', value: appContext?.user?.id }]
    })
  ]);

  if (profileResult.error) {
    return { data: null, error: profileResult.error };
  }

  return {
    data: {
      profile: profileResult.profile,
      trainerAssignment: profileResult.trainerAssignment,
      totals: {
        memberships: membershipResult.error ? null : membershipResult.count,
        attendanceLogs: attendanceResult.error ? null : attendanceResult.count,
        workouts: workoutResult.error ? null : workoutResult.count,
        progressLogs: progressResult.error ? null : progressResult.count
      },
      membership: {
        current: getCurrentMembership(membershipsResult.memberships || []),
        records: membershipsResult.memberships || []
      }
    },
    error: null
  };
}

function buildGymSnapshot(appContext, users) {
  return {
    gymId: appContext?.gymId || null,
    activeUsers: users.filter((user) => user.account_status === 'active').length,
    inactiveUsers: users.filter((user) => user.account_status && user.account_status !== 'active').length,
    currentUser: appContext?.profile?.fullname || appContext?.user?.email || 'Admin'
  };
}

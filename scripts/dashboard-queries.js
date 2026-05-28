import { listUsers } from './profiles.js';
import { createQueryContext, requireGymId, scopedSelect } from './tenant-queries.js';

export async function getAdminDashboardData({ appContext } = {}) {
  const [usersResult, membershipResult, attendanceResult, workoutResult] = await Promise.all([
    listUsers({ appContext }),
    countRows('memberships', { appContext, filters: [{ column: 'status', value: 'active' }] }),
    countRows('attendance_logs', { appContext }),
    countRows('workout_programs', { appContext })
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
        attendanceLogs: attendanceResult.error ? null : attendanceResult.count,
        workoutPrograms: workoutResult.error ? null : workoutResult.count
      },
      gym: buildGymSnapshot(appContext, users)
    },
    error: null
  };
}

export async function getTrainerDashboardData({ appContext } = {}) {
  const [membersResult, attendanceResult, workoutResult] = await Promise.all([
    listUsers({ appContext, role: 'member' }),
    countRows('attendance_logs', { appContext }),
    countRows('workout_programs', { appContext })
  ]);

  if (membersResult.error) {
    return { data: null, error: membersResult.error };
  }

  const assignedMembers = membersResult.users || [];
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
  const [membershipResult, attendanceResult, workoutResult, progressResult] = await Promise.all([
    countRows('memberships', {
      appContext,
      filters: [{ column: 'user_id', value: appContext?.user?.id }]
    }),
    countRows('attendance_logs', {
      appContext,
      filters: [{ column: 'user_id', value: appContext?.user?.id }]
    }),
    countRows('user_workouts', {
      appContext,
      filters: [{ column: 'user_id', value: appContext?.user?.id }]
    }),
    countRows('progress_logs', {
      appContext,
      filters: [{ column: 'user_id', value: appContext?.user?.id }]
    })
  ]);

  return {
    data: {
      profile: appContext?.profile || null,
      totals: {
        memberships: membershipResult.error ? null : membershipResult.count,
        attendanceLogs: attendanceResult.error ? null : attendanceResult.count,
        workouts: workoutResult.error ? null : workoutResult.count,
        progressLogs: progressResult.error ? null : progressResult.count
      }
    },
    error: null
  };
}

async function countRows(table, { appContext, filters = [] } = {}) {
  try {
    const queryContext = await createQueryContext(appContext);
    const gymId = requireGymId(queryContext.gymId);
    let query = scopedSelect(queryContext.supabase, table, 'id', {
      gymId,
      options: { count: 'exact', head: true }
    });

    filters
      .filter((filter) => filter.value)
      .forEach((filter) => {
        query = query.eq(filter.column, filter.value);
      });

    const { count, error } = await query;
    return { count: error ? 0 : count || 0, error };
  } catch (error) {
    return { count: 0, error };
  }
}

function buildGymSnapshot(appContext, users) {
  return {
    gymId: appContext?.gymId || null,
    activeUsers: users.filter((user) => user.account_status === 'active').length,
    inactiveUsers: users.filter((user) => user.account_status && user.account_status !== 'active').length,
    currentUser: appContext?.profile?.fullname || appContext?.user?.email || 'Admin'
  };
}

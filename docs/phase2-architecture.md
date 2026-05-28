# Phase 2 Architecture Notes

## Session And App Context

Authentication starts in `scripts/session.js`. `restoreSession({ verify: true })` refreshes expired Supabase sessions, verifies the auth user when online, loads the canonical profile from `public.users`, and rejects missing, disabled, suspended, role-less, or gym-less profiles.

`scripts/app-context.js` converts the hydrated session into the canonical app context:

- `user`: Supabase auth user with attached profile.
- `profile`: normalized `public.users` profile.
- `role`: normalized RBAC role.
- `gymId` / `tenantId`: active tenant id from the profile.
- `permissions` / `capabilities`: derived only from `scripts/permissions.js`.

Routes and page modules should consume `appContext`. They should not derive authorization from auth metadata or URL state.

## Tenant Model

`public.gyms` is the tenant root. Every operational table carries a non-null `gym_id`:

- `users`
- `memberships`
- `attendance_qr_tokens`
- `attendance_logs`
- `payments`
- `workout_programs`
- `user_workouts`
- `progress_logs`

Tenant row integrity is enforced by RLS policies and trigger checks. Tenant ids are immutable after insert. Cross-gym foreign key relationships are rejected by `app.enforce_tenant_row_integrity()` and user trainer assignment checks.

## RBAC Flow

RBAC is centralized in `scripts/permissions.js`.

- Route access uses `canAccessRoute()`.
- Action access uses `canPerformAction()` / `requireAction()`.
- Role capabilities are static and normalized through `normalizeRole()`.

Client-side RBAC is a UX guard only. Database RLS remains the authoritative security boundary.

## Query Helper Architecture

Tenant-aware query construction is centralized in `scripts/tenant-queries.js`.

- `createQueryContext()` validates app context, role, action capability, and tenant id.
- `scopedSelect()` adds `gym_id` filtering for tenant-scoped tables.
- `scopedInsert()` injects the active `gym_id` and rejects mismatched tenant overrides.
- `scopedUpdate()` filters by active `gym_id` and rejects hidden `gym_id` mutation attempts.

Direct `.from()` usage should stay limited to profile hydration and low-level helper internals. Any new feature module should use the scoped helpers.

## RLS Strategy

RLS helpers live in the private `app` schema and use `SECURITY DEFINER` to avoid recursive policy reads while still deriving identity from `auth.uid()`.

Role boundaries:

- Members can read and write only their own permitted rows.
- Trainers can access assigned active members in the same gym only.
- Admins can manage unrestricted rows inside their own gym only.
- Disabled/suspended users can read only their own profile so the client can force logout; all tenant data remains blocked because `app.current_gym_id()` returns null.
- Anonymous users have no table grants.

The public `default_gym_id()` RPC exists only to support safe self-profile bootstrap without exposing gym table rows.

## Dashboard Architecture

Dashboard loading is role-specific in `scripts/dashboard-bootstrap.js` and `scripts/dashboard-queries.js`.

- Admin dashboard totals come from same-gym scoped user lists and RLS-filtered counts.
- Trainer dashboard totals rely on RLS-filtered assigned member access.
- Member dashboard totals add explicit `user_id` filters on top of tenant scope.

Dashboard cache keys include tenant id, user id, and role. Logout and auth state changes clear the cache.

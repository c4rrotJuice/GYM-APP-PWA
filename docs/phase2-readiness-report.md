# Phase 2 Readiness Report

## Completed Scope

- Added a reproducible SQL RLS verification suite at `supabase/tests/phase2_rls_verification.sql`.
- Added a local runner at `scripts/run-rls-verification.sh`.
- Hardened gym visibility so authenticated users can read only their active gym row.
- Preserved disabled-account restore handling by allowing users to read only their own profile while all tenant data remains blocked.
- Added privileged cross-gym trainer assignment protection on `users` inserts and updates.
- Removed default gym table-read dependency from profile bootstrap by adding a narrow `public.default_gym_id()` RPC.
- Hardened scoped update helpers to reject hidden `gym_id` override attempts.
- Cleared app context and dashboard cache immediately on logout.
- Replaced predictable admin-created temporary passwords with cryptographically random values.

## Security Observations

- RLS is the authoritative security boundary. Client RBAC only controls navigation and UI actions.
- Tenant scope is enforced both in query helpers and database policies.
- Admin access is same-gym only.
- Trainer access is assigned-member only and same-gym only.
- Disabled and suspended users lose tenant data access because role and tenant helper functions require active profiles.
- Service-role Netlify code still bypasses RLS by design, so it validates active admin status, active same-gym trainer assignment, and forced gym ownership before creating profiles.

## Validation Coverage

The SQL suite verifies:

- Members cannot read other members or other gyms.
- Members cannot escalate role privileges.
- Trainers cannot read unassigned or cross-gym members.
- Trainers cannot assign cross-gym workouts.
- Admins see same-gym data only.
- Admin dashboard-style counts do not include cross-gym rows.
- Privileged cross-gym trainer assignment writes are rejected.
- Disabled users can hydrate only their own profile and cannot read tenant data.
- Anonymous users cannot read protected tables.
- Tenant tables have RLS enabled.

## Known Limitations

- The RLS suite requires a local or staging Supabase database URL and `psql`.
- Browser route and hydration behavior are covered by code audit, not automated browser tests.
- The current app has no package-level test runner, so JS module checks are limited to static inspection and shell syntax validation.
- Attendance, workouts, and settings pages still contain intentional Phase 3 placeholders.

## Phase 3 Readiness

The app is ready for Phase 3 feature work if the SQL verification suite passes against the target Supabase environment after applying migrations. New Phase 3 modules should use `createQueryContext()`, `scopedSelect()`, `scopedInsert()`, and `scopedUpdate()` rather than direct Supabase table access.

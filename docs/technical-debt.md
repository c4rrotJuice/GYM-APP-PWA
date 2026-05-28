# Technical Debt

- Add automated browser tests for route protection, logout redirects, auth refresh, and disabled-account restore behavior.
- Add JS unit tests for `permissions.js`, `tenant-queries.js`, and session/app-context hydration.
- Replace Phase 3 placeholder pages for attendance, workouts, and settings as those modules are implemented.
- Consider adding CI that runs Supabase migrations and `supabase/tests/phase2_rls_verification.sql` against a disposable local database.
- Consider rotating admin-created temporary passwords through an invite/reset flow instead of returning a one-time password in the function response.

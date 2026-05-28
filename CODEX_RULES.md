# Database Operations Rules

Codex must NEVER directly modify the remote Supabase database.

All database work must go through:

./scripts/db-agent.sh

## Required workflow

### Before any database-aware feature work
Run:

./scripts/db-agent.sh plan

This synchronizes the local schema with the remote database.

---

### If schema changes are required
Run:

./scripts/db-agent.sh migrate <migration_name>

Then modify ONLY the generated migration SQL file.

Do not manually edit historical migrations unless explicitly instructed.

---

### Before applying changes
Run:

./scripts/db-agent.sh push

This:
- validates migrations
- blocks destructive operations
- synchronizes state
- pushes to Supabase

---

## Forbidden actions

- Direct dashboard schema edits
- Raw remote SQL execution
- Skipping migrations
- Editing production schema manually
- Deleting migration history
- Pushing without validation

---

## Validation expectations

Before finalizing DB work, Codex must verify:

- foreign keys are valid
- RLS policies still function
- seeded users still work
- no cross-gym data leakage exists
- migrations are idempotent where possible
- existing features are not broken

---

## If push fails

Codex must:
1. inspect error output
2. revise migration
3. retry validation
4. push again

Do not stop at first failure.

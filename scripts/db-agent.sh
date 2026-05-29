#!/bin/bash

set -euo pipefail

ACTION="${1:-help}"
NAME="${2:-}"
MAX_RETRIES="${MAX_RETRIES:-3}"
ATTEMPT=0
DRY_RUN=false
STRICT_SYNC=false
LOG_DIR="supabase/.temp/db-agent-logs"
LOG_FILE=""

if [ "$ACTION" != "help" ]; then
  shift || true
fi

for ARG in "$@"; do
  case "$ARG" in
    --dry-run)
      DRY_RUN=true
      ;;
    --strict-sync)
      STRICT_SYNC=true
      ;;
  esac
done

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/$(date +%Y%m%d-%H%M%S)-${ACTION}.log"

echo "🧠 CODEx DB AGENT ONLINE"
echo "🧾 Log: $LOG_FILE"

# ─────────────────────────────
# 0. SHARED HELPERS
# ─────────────────────────────
run_logged () {
  echo "+ $*" | tee -a "$LOG_FILE"
  "$@" 2>&1 | tee -a "$LOG_FILE"
  return "${PIPESTATUS[0]}"
}

ensure_tooling () {
  if ! npx supabase --version >/dev/null 2>&1; then
    echo "📦 Installing Supabase CLI locally..."
    run_logged npm install supabase --save-dev
  fi
}

latest_local_migration () {
  find supabase/migrations -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sort | tail -n 1
}

latest_local_version () {
  local latest
  latest="$(latest_local_migration)"
  echo "${latest%%_*}"
}

show_latest () {
  local latest
  latest="$(latest_local_migration)"

  if [ -z "$latest" ]; then
    echo "❌ No local migrations found"
    return 1
  fi

  echo "📌 Latest local migration: $latest"
}

remote_migration_list () {
  echo "🌐 Remote migration history:"
  run_logged npx supabase migration list
}

remote_has_latest () {
  local latest_version
  local migration_output
  local remote_version

  latest_version="$(latest_local_version)"
  migration_output="$1"
  remote_version="$(
    echo "$migration_output" | awk -F'|' -v version="$latest_version" '
      NF >= 2 {
        local_version = $1
        remote_column = $2
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", local_version)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", remote_column)

        if (local_version == version || remote_column == version) {
          print remote_column
          exit
        }
      }
    '
  )"

  if [ "$remote_version" = "$latest_version" ]; then
    echo "✅ Latest local migration appears in remote migration history: $latest_version"
    return 0
  fi

  if echo "$migration_output" | grep -Eq "(^|[^0-9])${latest_version}([^0-9]|$)"; then
    echo "⚠️ Latest migration appears locally, but not in the parsed Remote column: $latest_version"
    return 2
  fi

  if ! echo "$migration_output" | grep -Eq "(^|[^0-9])${latest_version}([^0-9]|$)"; then
    echo "❌ Latest local migration version is not present in migration list: $latest_version"
    return 1
  fi
}

check_remote_state () {
  local migration_output
  local list_result

  show_latest

  echo "🌐 Remote migration history:"
  echo "+ npx supabase migration list" | tee -a "$LOG_FILE"
  set +e
  migration_output="$(npx supabase migration list 2>&1)"
  list_result=$?
  set -e

  echo "$migration_output" | tee -a "$LOG_FILE"

  if [ "$list_result" -ne 0 ]; then
    echo "❌ Could not read remote migration history"
    return "$list_result"
  fi

  set +e
  remote_has_latest "$migration_output"
  local result=$?
  set -e

  if [ "$result" -eq 0 ]; then
    return 0
  fi

  if [ "$result" -eq 2 ]; then
    echo "⚠️ Remote state check completed with ambiguous CLI output"
    return 0
  fi

  return "$result"
}

print_usage () {
  cat <<'USAGE'
Usage:
  ./scripts/db-agent.sh check
  ./scripts/db-agent.sh latest
  ./scripts/db-agent.sh remote-list
  ./scripts/db-agent.sh plan [--strict-sync]
  ./scripts/db-agent.sh migrate <name> [--strict-sync]
  ./scripts/db-agent.sh push [--dry-run] [--strict-sync]
  ./scripts/db-agent.sh full-cycle <name> [--dry-run] [--strict-sync]
  ./scripts/db-agent.sh local-status
  ./scripts/db-agent.sh status

Actions:
  check         Show latest local migration and compare it with remote migration history.
  latest        Print the latest local migration file.
  remote-list   Print Supabase remote migration history without using the local Docker stack.
  plan          Pull remote schema for reasoning. Pull failures warn by default.
  migrate       Sync state, then create a new migration.
  push          Validate, check remote state, push, then check remote state again.
  full-cycle    Create a migration, validate, then push.
  local-status  Show local Supabase stack status.
  status        Alias for check. Use local-status for Docker/local-stack status.

Options:
  --dry-run      For push/full-cycle, ask Supabase CLI to show pending migrations without applying.
  --strict-sync  Fail if the pre-action db pull fails.
USAGE
}

# ─────────────────────────────
# 1. SYNC STATE
# ─────────────────────────────
sync_db () {
  echo "🔄 Syncing database state..."

  if run_logged npx supabase db pull; then
    echo "✅ Pull successful"
    return 0
  fi

  if [ "$STRICT_SYNC" = true ]; then
    echo "❌ Pull failed and --strict-sync is enabled"
    return 1
  fi

  echo "⚠️ Pull failed, continuing with cached schema"
}

# ─────────────────────────────
# 2. VALIDATION FUNCTION
# ─────────────────────────────
validate_db () {
  echo "🧪 Running validation checks..."

  if grep -R -n -E '\bDROP[[:space:]]+TABLE\b' supabase/migrations >/dev/null; then
    echo "❌ Validation failed: DROP TABLE detected"
    grep -R -n -E '\bDROP[[:space:]]+TABLE\b' supabase/migrations | tee -a "$LOG_FILE"
    return 1
  fi

  local warning_patterns
  warning_patterns='DELETE[[:space:]]+FROM|DROP[[:space:]]+COLUMN|TRUNCATE|ALTER[[:space:]]+TYPE.*DROP[[:space:]]+VALUE|DROP[[:space:]]+POLICY|DROP[[:space:]]+FUNCTION|DROP[[:space:]]+TRIGGER'

  if grep -R -n -E "$warning_patterns" supabase/migrations >/dev/null; then
    echo "⚠️ Destructive or security-sensitive SQL detected; review before production push:"
    grep -R -n -E "$warning_patterns" supabase/migrations | tee -a "$LOG_FILE"
  fi

  echo "✅ Validation passed"
  return 0
}

# ─────────────────────────────
# 3. PUSH FUNCTION WITH RETRY LOOP
# ─────────────────────────────
push_db () {
  local -a push_args
  push_args=(npx supabase db push)

  if [ "$DRY_RUN" = true ]; then
    push_args+=(--dry-run)
    echo "🧪 Dry run enabled; no remote changes should be applied"
  fi

  while [ "$ATTEMPT" -lt "$MAX_RETRIES" ]; do
    echo "🚀 Push attempt $((ATTEMPT+1))..."

    if run_logged "${push_args[@]}"; then
      echo "✅ Push successful"
      return 0
    fi

    echo "❌ Push failed. Attempting retry..."
    ATTEMPT=$((ATTEMPT+1))

    if [ "$ATTEMPT" -lt "$MAX_RETRIES" ]; then
      echo "🔄 Re-syncing before retry..."
      sync_db
    fi
  done

  echo "❌ Max retries reached. Aborting."
  return 1
}

# ─────────────────────────────
# 4. MIGRATION CREATION FLOW
# ─────────────────────────────
create_migration () {
  if [ -z "$NAME" ] || [ "$NAME" = "--dry-run" ] || [ "$NAME" = "--strict-sync" ]; then
    echo "❌ Migration name required"
    exit 1
  fi

  sync_db

  echo "📦 Creating migration: $NAME"
  run_logged npx supabase migration new "$NAME"

  echo "✏️ Codex must now edit SQL file before push"
}

# ─────────────────────────────
# 5. MAIN ROUTER
# ─────────────────────────────
case "$ACTION" in

  check|status)
    ensure_tooling
    check_remote_state
    ;;

  latest)
    show_latest
    ;;

  remote-list)
    ensure_tooling
    remote_migration_list
    ;;

  plan)
    ensure_tooling
    sync_db
    echo "📊 Schema ready for Codex reasoning phase"
    ;;

  migrate)
    ensure_tooling
    create_migration
    ;;

  push)
    ensure_tooling
    echo "🔎 Pre-push remote migration check..."
    check_remote_state || echo "⚠️ Remote appears behind or unreadable; push will attempt to reconcile"

    sync_db

    if ! validate_db; then
      echo "🧠 Fix required before push"
      exit 1
    fi

    push_db

    echo "🔎 Post-push remote migration check..."
    check_remote_state
    ;;

  full-cycle)
    ensure_tooling
    create_migration

    echo "⏳ Waiting for Codex edits..."
    sleep 2

    if ! validate_db; then
      echo "🔁 Fix loop triggered..."
      exit 1
    fi

    push_db

    echo "🔎 Post-push remote migration check..."
    check_remote_state
    ;;

  local-status)
    ensure_tooling
    run_logged npx supabase status
    ;;

  help|-h|--help)
    print_usage
    ;;

  *)
    print_usage
    exit 1
    ;;
esac

echo "🏁 CODEx DB AGENT COMPLETE"

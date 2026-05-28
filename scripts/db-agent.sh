#!/bin/bash

set -e

ACTION=$1
NAME=$2
MAX_RETRIES=3
ATTEMPT=0

echo "🧠 CODEx DB AGENT ONLINE"

# ─────────────────────────────
# 0. ENSURE TOOLING EXISTS
# ─────────────────────────────
if ! npx supabase --version >/dev/null 2>&1; then
  echo "📦 Installing Supabase CLI locally..."
  npm install supabase --save-dev
fi

# ─────────────────────────────
# 1. ALWAYS SYNC STATE FIRST
# ─────────────────────────────
sync_db () {
  echo "🔄 Syncing database state..."
  npx supabase db pull || {
    echo "⚠️ Pull failed, continuing with cached schema"
  }
}

# ─────────────────────────────
# 2. VALIDATION FUNCTION
# ─────────────────────────────
validate_db () {
  echo "🧪 Running validation checks..."

  # Basic safety checks
  if grep -R "DROP TABLE" supabase/migrations >/dev/null; then
    echo "❌ Validation failed: DROP TABLE detected"
    return 1
  fi

  if grep -R "DELETE FROM" supabase/migrations >/dev/null; then
    echo "⚠️ Warning: DELETE detected (review recommended)"
  fi

  echo "✅ Validation passed"
  return 0
}

# ─────────────────────────────
# 3. PUSH FUNCTION WITH RETRY LOOP
# ─────────────────────────────
push_db () {

  while [ $ATTEMPT -lt $MAX_RETRIES ]; do
    echo "🚀 Push attempt $((ATTEMPT+1))..."

    if npx supabase db push; then
      echo "✅ Push successful"
      return 0
    fi

    echo "❌ Push failed. Attempting retry..."
    ATTEMPT=$((ATTEMPT+1))

    echo "🔄 Re-syncing before retry..."
    sync_db
  done

  echo "❌ Max retries reached. Aborting."
  return 1
}

# ─────────────────────────────
# 4. MIGRATION CREATION FLOW
# ─────────────────────────────
create_migration () {
  if [ -z "$NAME" ]; then
    echo "❌ Migration name required"
    exit 1
  fi

  sync_db

  echo "📦 Creating migration: $NAME"
  npx supabase migration new "$NAME"

  echo "✏️ Codex must now edit SQL file before push"
}

# ─────────────────────────────
# 5. MAIN ROUTER
# ─────────────────────────────
case "$ACTION" in

  plan)
    sync_db
    echo "📊 Schema ready for Codex reasoning phase"
    ;;

  migrate)
    create_migration
    ;;

  push)
    sync_db

    if ! validate_db; then
      echo "🧠 Fix required before push"
      exit 1
    fi

    push_db
    ;;

  full-cycle)
    # Experimental autonomous loop
    create_migration

    echo "⏳ Waiting for Codex edits..."
    sleep 2

    if ! validate_db; then
      echo "🔁 Fix loop triggered..."
      exit 1
    fi

    push_db
    ;;

  status)
    npx supabase status
    ;;

  *)
    echo "Usage:"
    echo "  db-agent plan"
    echo "  db-agent migrate <name>"
    echo "  db-agent push"
    echo "  db-agent full-cycle <name>"
    echo "  db-agent status"
    exit 1
    ;;
esac

echo "🏁 CODEx DB AGENT COMPLETE"

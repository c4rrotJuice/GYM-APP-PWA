#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_FILE="$ROOT_DIR/supabase/tests/phase2_rls_verification.sql"

echo "Running Phase 2 RLS verification suite..."

if [[ -n "${DATABASE_URL:-}" ]]; then
  if ! command -v psql >/dev/null 2>&1; then
    echo "FAIL - psql is required when DATABASE_URL is provided."
    exit 1
  fi

  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$TEST_FILE"
elif command -v supabase >/dev/null 2>&1; then
  supabase db query --linked --file "$TEST_FILE"
else
  echo "FAIL - install psql and set DATABASE_URL, or install the Supabase CLI for linked project execution."
  exit 1
fi

echo "PASS - Phase 2 RLS verification suite completed."

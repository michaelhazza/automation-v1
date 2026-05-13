#!/usr/bin/env bash
# verify-capability-map-shape.sh — CI gate for personal-assistant-v2-operator spec §4.4 / §5.1.
#
# Asserts five invariants on the capability_map JSONB column in subaccount_agents:
#   1. All rows have a non-null `computedAt` field.
#   2. User-owned agents have `owner_user_id` set in the capability map and
#      the value matches agents.owner_user_id.
#   3. `integrations` is an array.
#   4. `read_capabilities` and `write_capabilities` are arrays.
#   5. When present, `owner_user_id` in the map is a valid UUID.
#
# Prerequisites:
#   - DATABASE_URL env var must be set (injected by CI).
#   - psql must be on PATH.
#
# SCAN_PATH env var is unused (psql-based scan; reserved for future ts-node variant).
#
# Exit codes (per gate convention):
#   0 — all checks pass
#   1 — one or more violations detected (blocking)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

FAIL=0

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[ERROR] verify-capability-map-shape: DATABASE_URL is not set"
  exit 1
fi

# ---------------------------------------------------------------------------
# Invariant 1 — All non-null capability_map rows have a computedAt field
# ---------------------------------------------------------------------------

INVARIANT_1=$(psql "$DATABASE_URL" --tuples-only --no-align -c "
  SELECT COUNT(*)
  FROM subaccount_agents
  WHERE capability_map IS NOT NULL
    AND (capability_map->>'computedAt') IS NULL;
" 2>&1)

if [ "$INVARIANT_1" != "0" ] && [ -n "$INVARIANT_1" ]; then
  echo "[FAIL] verify-capability-map-shape (invariant 1): ${INVARIANT_1} subaccount_agents row(s) have a capability_map with no 'computedAt' field"
  FAIL=1
else
  echo "[PASS] verify-capability-map-shape (invariant 1): all capability_map rows have computedAt"
fi

# ---------------------------------------------------------------------------
# Invariant 2 — User-owned agents have owner_user_id in capability_map and
#               value matches agents.owner_user_id
# ---------------------------------------------------------------------------

INVARIANT_2=$(psql "$DATABASE_URL" --tuples-only --no-align -c "
  SELECT COUNT(*)
  FROM subaccount_agents sa
  JOIN agents a ON sa.agent_id = a.id
  WHERE a.owner_user_id IS NOT NULL
    AND sa.capability_map IS NOT NULL
    AND (
      (sa.capability_map->>'owner_user_id') IS NULL
      OR (sa.capability_map->>'owner_user_id') != a.owner_user_id::text
    );
" 2>&1)

if [ "$INVARIANT_2" != "0" ] && [ -n "$INVARIANT_2" ]; then
  echo "[FAIL] verify-capability-map-shape (invariant 2): ${INVARIANT_2} user-owned subaccount_agents row(s) have a missing or mismatched owner_user_id in capability_map"
  FAIL=1
else
  echo "[PASS] verify-capability-map-shape (invariant 2): user-owned agents have consistent owner_user_id in capability_map"
fi

# ---------------------------------------------------------------------------
# Invariant 3 — integrations is an array
# ---------------------------------------------------------------------------

INVARIANT_3=$(psql "$DATABASE_URL" --tuples-only --no-align -c "
  SELECT COUNT(*)
  FROM subaccount_agents
  WHERE capability_map IS NOT NULL
    AND jsonb_typeof(capability_map->'integrations') != 'array';
" 2>&1)

if [ "$INVARIANT_3" != "0" ] && [ -n "$INVARIANT_3" ]; then
  echo "[FAIL] verify-capability-map-shape (invariant 3): ${INVARIANT_3} subaccount_agents row(s) have a non-array 'integrations' in capability_map"
  FAIL=1
else
  echo "[PASS] verify-capability-map-shape (invariant 3): all capability_map.integrations are arrays"
fi

# ---------------------------------------------------------------------------
# Invariant 4 — read_capabilities and write_capabilities are arrays
# ---------------------------------------------------------------------------

INVARIANT_4=$(psql "$DATABASE_URL" --tuples-only --no-align -c "
  SELECT COUNT(*)
  FROM subaccount_agents
  WHERE capability_map IS NOT NULL
    AND (
      jsonb_typeof(capability_map->'read_capabilities') != 'array'
      OR jsonb_typeof(capability_map->'write_capabilities') != 'array'
    );
" 2>&1)

if [ "$INVARIANT_4" != "0" ] && [ -n "$INVARIANT_4" ]; then
  echo "[FAIL] verify-capability-map-shape (invariant 4): ${INVARIANT_4} subaccount_agents row(s) have non-array read_capabilities or write_capabilities"
  FAIL=1
else
  echo "[PASS] verify-capability-map-shape (invariant 4): all capability_map.read_capabilities and write_capabilities are arrays"
fi

# ---------------------------------------------------------------------------
# Invariant 5 — owner_user_id when present is a valid UUID
# ---------------------------------------------------------------------------

INVARIANT_5=$(psql "$DATABASE_URL" --tuples-only --no-align -c "
  SELECT COUNT(*)
  FROM subaccount_agents
  WHERE capability_map IS NOT NULL
    AND (capability_map->>'owner_user_id') IS NOT NULL
    AND NOT (capability_map->>'owner_user_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
" 2>&1)

if [ "$INVARIANT_5" != "0" ] && [ -n "$INVARIANT_5" ]; then
  echo "[FAIL] verify-capability-map-shape (invariant 5): ${INVARIANT_5} capability_map row(s) have an invalid UUID in owner_user_id"
  FAIL=1
else
  echo "[PASS] verify-capability-map-shape (invariant 5): all capability_map.owner_user_id values are valid UUIDs"
fi

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------

if [ $FAIL -eq 0 ]; then
  echo "[PASS] verify-capability-map-shape: all 5 invariants satisfied"
  exit 0
else
  exit 1
fi

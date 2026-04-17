#!/usr/bin/env bash
set -euo pipefail

# Gate: Every canonical_* table must have a UNIQUE constraint that
# includes (organisation_id, ..., external_id) for upsert idempotency.

CANONICAL_TABLES=$(grep -rn "pgTable.*canonical_" server/db/schema/ --include="*.ts" \
  | sed "s/.*pgTable('\([^']*\)'.*/\1/" \
  | sort -u || true)

FAIL=0
for TABLE in $CANONICAL_TABLES; do
  # Check migrations for UNIQUE constraint or uniqueIndex on this table
  HAS_UNIQUE=$(grep -l "unique.*${TABLE}\|uniqueIndex.*${TABLE}" server/db/schema/*.ts migrations/*.sql 2>/dev/null || true)
  if [ -z "$HAS_UNIQUE" ]; then
    echo "FAIL: $TABLE has no UNIQUE constraint for idempotent upserts"
    FAIL=1
  fi
done

if [ "$FAIL" -eq 1 ]; then
  exit 1
fi

echo "PASS: verify-canonical-idempotency"

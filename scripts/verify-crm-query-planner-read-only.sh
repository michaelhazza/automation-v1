#!/usr/bin/env bash
set -euo pipefail

# Gate: CRM query planner executors must never import write helpers from ghlAdapter.
# The live executor is read-only by design (§13.3 / §16.6); this gate enforces it
# at CI time so an accidental write-method import is caught before runtime.
#
# Forbidden: any import of ghlAdapter write methods inside executors/
# Allowed:   ghlReadHelpers imports (read-only module)

EXECUTORS_DIR="server/services/crmQueryPlanner/executors"

# Write methods that must never appear in executor imports.
# Extend this list if new write methods are added to ghlAdapter.
FORBIDDEN_PATTERN="createContact\|updateContact\|deleteContact\|createTask\|updateTask\|sendEmail\|createOpportunity\|updateOpportunity\|createConversation\|sendMessage\|createNote\|deleteNote\|bulkUpdate\|bulkCreate\|bulkDelete"

VIOLATIONS=$(grep -rn "$FORBIDDEN_PATTERN" \
  "$EXECUTORS_DIR" \
  --include="*.ts" \
  | grep -v "__tests__" \
  | grep -v "// verify-crm-query-planner-read-only: allowed" \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "FAIL: Write helper imported inside CRM query planner executor layer:"
  echo "$VIOLATIONS"
  echo ""
  echo "The CRM query planner is read-only by design (spec §13.3 / §16.6)."
  echo "Use ghlReadHelpers for any new live-data access — never ghlAdapter write methods."
  echo "[GATE] crm-query-planner-read-only: violations=1"
  exit 1
fi

# Secondary check: no direct ghlAdapter import at all (only ghlReadHelpers is allowed)
ADAPTER_IMPORTS=$(grep -rn "from.*['\"].*ghlAdapter['\"]" \
  "$EXECUTORS_DIR" \
  --include="*.ts" \
  | grep -v "__tests__" \
  | grep -v "// verify-crm-query-planner-read-only: allowed" \
  || true)

if [ -n "$ADAPTER_IMPORTS" ]; then
  echo "FAIL: Direct ghlAdapter import found inside CRM query planner executor layer:"
  echo "$ADAPTER_IMPORTS"
  echo ""
  echo "Use ghlReadHelpers (read-only surface) — not ghlAdapter directly."
  echo "[GATE] crm-query-planner-read-only: violations=1"
  exit 1
fi

echo "PASS: verify-crm-query-planner-read-only"
echo "[GATE] crm-query-planner-read-only: violations=0"

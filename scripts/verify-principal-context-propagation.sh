#!/usr/bin/env bash
set -euo pipefail

# Gate: No callers of canonicalDataService pass a bare organisationId (string)
# as the first argument. Every call should use PrincipalContext after P3A.
#
# Strategy: grep for any file that imports canonicalDataService and does NOT
# also import from withPrincipalContext, principal/types, or fromOrgId (the
# migration shim is acceptable during P3A→P3B migration). Files in __tests__
# are exempt.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="principal-context-propagation"
GUARD_NAME="Principal Context Propagation"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=0

emit_header "$GUARD_NAME"

# Find all TS files that import canonicalDataService (excluding tests and the service itself)
while IFS= read -r file; do
  FILES_SCANNED=$((FILES_SCANNED + 1))

  # Check whether the file also imports a principal-context utility
  if grep -qE '(withPrincipalContext|principal/types|fromOrgId|PrincipalContext)' "$file"; then
    continue
  fi

  # File imports canonicalDataService but has no principal-context import
  lineno=$(grep -n 'canonicalDataService' "$file" | head -1 | cut -d: -f1)
  is_suppressed "$file" "$lineno" "$GUARD_ID" && continue

  emit_violation "$GUARD_ID" "error" "$file" "$lineno" \
    "Imports canonicalDataService without PrincipalContext / fromOrgId" \
    "Add PrincipalContext parameter or use fromOrgId() migration shim"
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(grep -rl 'canonicalDataService' "$ROOT_DIR/server/" --include="*.ts" \
  | grep -v "canonicalDataService.ts" \
  | grep -v "__tests__" \
  || true)

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"

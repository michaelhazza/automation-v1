#!/usr/bin/env bash
set -euo pipefail

# Gate: No callers of canonicalDataService pass a bare organisationId (string)
# as the first argument. Every call should use PrincipalContext after P3A.
#
# Looks for patterns like:
#   canonicalDataService.getAccounts(orgId
#   canonicalDataService.getContacts(organisationId
#   canonicalDataService.upsertAccount(orgId
#
# Excludes canonicalDataService.ts itself (the definition) and test files.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# Match: canonicalDataService.<method>(orgId or canonicalDataService.<method>(organisationId
# but not inside the service definition itself or tests.
VIOLATIONS=$(grep -rn 'canonicalDataService\.\(get\|upsert\|write\|append\|acknowledge\)[A-Za-z]*(org[Ii]' \
  server/services/ server/routes/ server/jobs/ \
  --include="*.ts" \
  | grep -v "canonicalDataService.ts" \
  | grep -v "__tests__" \
  | grep -v "// verify-principal-context-propagation: allowed" \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "FAIL: Callers of canonicalDataService still pass bare orgId as first argument:"
  echo "$VIOLATIONS"
  echo ""
  echo "Migrate these call-sites to use PrincipalContext (or add fromOrgId() shim)."
  exit 2
fi

echo "PASS: verify-principal-context-propagation"

#!/usr/bin/env bash
# Enforce the Phase 2 audit-stream split: auth.* and oauth.* events go through
# securityAuditService exclusively. auditService.log for those prefixes is forbidden.
# TODO: wire this into .github/workflows/ci.yml once the gate runner step is added.
set -euo pipefail

VIOLATIONS=$(grep -RnE "auditService\.log\([^)]*['\"]+(auth|oauth)\." server/ 2>/dev/null || true)
if [ -n "$VIOLATIONS" ]; then
  echo "Audit-stream split violation: auth.* / oauth.* events must use securityAuditService, not auditService.log"
  echo "$VIOLATIONS"
  exit 1
fi
echo "audit-stream split gate: clean"

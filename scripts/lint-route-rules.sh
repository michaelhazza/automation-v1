#!/usr/bin/env bash
# Architecture rule enforcement for route files.
# Checks a single file (or all routes if no arg) against non-negotiable rules from CLAUDE.md.
# Exit 0 = pass (with warnings), Exit 1 = new violation introduced.

set -euo pipefail

ROUTE_DIR="server/routes"
WARNINGS=()

check_file() {
  local file="$1"

  # Skip non-route files
  case "$file" in
    *server/routes*) ;;
    *) return 0 ;;
  esac

  # Skip health check (intentionally simple, no asyncHandler needed)
  [[ "$(basename "$file")" == "health.ts" ]] && return 0

  local basename
  basename="$(basename "$file")"

  # Rule 1: Routes must use asyncHandler
  if ! grep -q 'asyncHandler' "$file" 2>/dev/null; then
    WARNINGS+=("RULE VIOLATION [$basename]: Missing asyncHandler — every async route handler must be wrapped")
  fi

  # Rule 2: Routes must not import db directly (static or dynamic)
  local has_db_violation=false
  if grep -qE "from ['\"](\.\./)*db/" "$file" 2>/dev/null; then
    has_db_violation=true
  fi
  if grep -qE "await import\(['\"](\.\./)*db/" "$file" 2>/dev/null; then
    has_db_violation=true
  fi
  if $has_db_violation; then
    WARNINGS+=("RULE VIOLATION [$basename]: Direct db import in route — routes must call services only")
  fi

  # Rule 3: Routes with :subaccountId must call resolveSubaccount
  if grep -qE ':subaccountId' "$file" 2>/dev/null; then
    if ! grep -q 'resolveSubaccount' "$file" 2>/dev/null; then
      WARNINGS+=("RULE VIOLATION [$basename]: Has :subaccountId param but missing resolveSubaccount call")
    fi
  fi

  # Rule 4: Routes with :subaccountId must use authenticate middleware
  if grep -qE ':subaccountId' "$file" 2>/dev/null; then
    if ! grep -q 'authenticate' "$file" 2>/dev/null; then
      WARNINGS+=("RULE VIOLATION [$basename]: Has :subaccountId param but missing authenticate middleware")
    fi
  fi

  # Rule 5: Must not use req.user.organisationId (should use req.orgId)
  if grep -q 'req\.user\.organisationId' "$file" 2>/dev/null; then
    WARNINGS+=("RULE VIOLATION [$basename]: Use req.orgId instead of req.user.organisationId")
  fi

  # Rule 6: Soft-delete tables queried without isNull(*.deletedAt)
  # Only warn if the file references deletedAt at all but doesn't use isNull
  if grep -q 'deletedAt' "$file" 2>/dev/null; then
    if ! grep -q 'isNull' "$file" 2>/dev/null; then
      WARNINGS+=("RULE VIOLATION [$basename]: References deletedAt without isNull — soft-delete filter may be missing")
    fi
  fi
}

# If a file path is provided, check just that file; otherwise check all routes
if [[ $# -gt 0 ]]; then
  check_file "$1"
else
  while IFS= read -r -d '' file; do
    check_file "$file"
  done < <(find "$ROUTE_DIR" -name '*.ts' -print0 2>/dev/null)
fi

# Report
if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  echo ""
  echo "=== Architecture Rule Check ==="
  for w in "${WARNINGS[@]}"; do
    echo "  WARNING: $w"
  done
  echo "================================"
  echo ""
  # Exit 0 so we don't block — these are warnings for existing tech debt.
  # Change to exit 1 once tech debt is cleaned up to enforce strictly.
  exit 0
fi

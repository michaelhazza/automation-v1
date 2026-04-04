#!/usr/bin/env bash
set -euo pipefail

# Architecture guards — run relevant checks on changed files
# Triggered by Claude Code hook when server files are modified

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

CHANGED_FILES="$@"

HAS_ROUTE_CHANGES=false
HAS_SERVICE_CHANGES=false

for f in $CHANGED_FILES; do
  [[ "$f" == server/routes/* ]] && HAS_ROUTE_CHANGES=true
  [[ "$f" == server/services/* ]] && HAS_SERVICE_CHANGES=true
done

EXIT_CODE=0

if $HAS_ROUTE_CHANGES; then
  bash "$ROOT_DIR/scripts/verify-no-db-in-routes.sh" || [ $? -eq 2 ] || EXIT_CODE=1
  bash "$ROOT_DIR/scripts/verify-async-handler.sh" || EXIT_CODE=1
  bash "$ROOT_DIR/scripts/verify-subaccount-resolution.sh" || EXIT_CODE=1
  bash "$ROOT_DIR/scripts/verify-no-direct-role-checks.sh" || [ $? -eq 2 ] || EXIT_CODE=1
fi

if $HAS_SERVICE_CHANGES; then
  bash "$ROOT_DIR/scripts/verify-org-scoped-writes.sh" || EXIT_CODE=1
fi

exit $EXIT_CODE

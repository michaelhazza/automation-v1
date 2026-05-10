#!/usr/bin/env bash
# verify-action-registry-snapshot.sh
#
# Regression oracle: asserts ACTION_REGISTRY serialises to an exact byte match
# against the pre-refactor snapshot at scripts/snapshots/action-registry.snapshot.json.
#
# The snapshot is a REGRESSION ORACLE — it proves refactors don't silently change
# runtime field values. It is NOT a source of truth for querying the registry;
# import ACTION_REGISTRY from server/config/actionRegistry.ts for that.
#
# Requires: npm run build:server (loads from dist/).
# Exit codes mirror diff-action-registry.ts:
#   0 — match
#   1 — mismatch (blocking)
#   2 — snapshot missing (run snapshot-action-registry.ts to capture baseline)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"
npx tsx "$SCRIPT_DIR/diff-action-registry.ts"

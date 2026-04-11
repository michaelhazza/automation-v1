#!/usr/bin/env bash
# verify-handoff-shape-versioned.sh — Brain Tree OS adoption P1
#
# Asserts that the TypeScript type backing `agent_runs.handoff_json` ends in
# a version suffix (V1, V2, …). Catches the case where a future change
# renames the interface without bumping the version field, which would
# silently break consumers that read the JSONB payload.
#
# Spec: docs/brain-tree-os-adoption-spec.md §"Static gates added by this spec"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="handoff-shape-versioned"
GUARD_NAME="Handoff Shape Versioned"

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

SCHEMA_FILE="$ROOT_DIR/server/db/schema/agentRuns.ts"
VIOLATIONS=0

if [ ! -f "$SCHEMA_FILE" ]; then
  emit_violation "$GUARD_ID" "error" "$SCHEMA_FILE" "0" \
    "schema file missing" \
    "agentRuns schema file expected at server/db/schema/agentRuns.ts"
  VIOLATIONS=1
else
  # Find the handoff_json column declaration line.
  HANDOFF_LINE=$(grep -n "handoff_json" "$SCHEMA_FILE" || true)

  if [ -z "$HANDOFF_LINE" ]; then
    emit_violation "$GUARD_ID" "error" "$SCHEMA_FILE" "0" \
      "no handoff_json column found" \
      "Define handoff_json column on agent_runs (P1 spec)"
    VIOLATIONS=1
  else
    LINENO=$(echo "$HANDOFF_LINE" | head -1 | cut -d: -f1)
    LINE_CONTENT=$(echo "$HANDOFF_LINE" | head -1 | cut -d: -f2-)

    # Assert the $type<...> argument matches AgentRunHandoffV<digit>.
    if ! echo "$LINE_CONTENT" | grep -qE 'AgentRunHandoffV[0-9]+'; then
      emit_violation "$GUARD_ID" "error" "$SCHEMA_FILE" "$LINENO" \
        "$LINE_CONTENT" \
        "agent_runs.handoff_json must use AgentRunHandoffV<N> type — bump the version suffix when changing the shape"
      VIOLATIONS=1
    fi
  fi
fi

emit_summary "1" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"

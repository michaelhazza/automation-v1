#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-reflection-loop-wired.sh
#
# Introduced by Sprint 3 P2.2 of docs/improvements-roadmap-spec.md.
#
# Enforces that the deterministic reflection loop guardrail stays wired
# into the agent execution pipeline. The loop is a cross-cutting structural
# guard — if a future refactor removes it from the pipeline, there is no
# runtime signal because the behaviour degrades silently (write_patch
# without APPROVE simply starts working again). This gate is the only
# thing that catches that drift.
#
# What the gate enforces (three structural checks):
#
#   1. `server/services/middleware/index.ts` imports
#      `reflectionLoopMiddleware` from its sibling module.
#   2. `createDefaultPipeline()` in the same file registers
#      `reflectionLoopMiddleware` inside the `postTool` array.
#   3. `server/services/agentExecutionService.ts` handles the
#      `escalate_to_review` postTool action variant (i.e. at least one
#      literal reference to the string `escalate_to_review`).
#
# Structural parallel to `verify-job-idempotency-keys.sh` (Sprint 2): both
# assert a cross-cutting wiring contract the tests cannot cover alone.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="reflection-loop-wired"
GUARD_NAME="Reflection loop middleware wired into default pipeline"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=0

emit_header "$GUARD_NAME"

MIDDLEWARE_INDEX="$ROOT_DIR/server/services/middleware/index.ts"
EXECUTION_SERVICE="$ROOT_DIR/server/services/agentExecutionService.ts"
MIDDLEWARE_FILE="$ROOT_DIR/server/services/middleware/reflectionLoopMiddleware.ts"
PURE_FILE="$ROOT_DIR/server/services/middleware/reflectionLoopPure.ts"

# ── Check 0: the middleware + pure helper files exist ────────────────────
for required in "$MIDDLEWARE_FILE" "$PURE_FILE"; do
  FILES_SCANNED=$((FILES_SCANNED + 1))
  if [ ! -f "$required" ]; then
    rel="${required#$ROOT_DIR/}"
    emit_violation "$GUARD_ID" "error" "$rel" "0" \
      "Required file for reflection loop guardrail is missing" \
      "Create $rel per docs/improvements-roadmap-spec.md §P2.2."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

# ── Check 1: middleware/index.ts imports reflectionLoopMiddleware ────────
if [ -f "$MIDDLEWARE_INDEX" ]; then
  FILES_SCANNED=$((FILES_SCANNED + 1))
  if ! grep -qE "from ['\"]\./reflectionLoopMiddleware\.js['\"]" "$MIDDLEWARE_INDEX"; then
    emit_violation "$GUARD_ID" "error" "server/services/middleware/index.ts" "1" \
      "reflectionLoopMiddleware is not imported" \
      "Add: import { reflectionLoopMiddleware } from './reflectionLoopMiddleware.js';"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  # ── Check 2: createDefaultPipeline registers it in postTool ────────────
  # Walk the createDefaultPipeline function body and look for the
  # middleware inside a `postTool: [ ... ]` array. We bound the search to
  # the function body so stray references elsewhere in the file do not
  # mask a missing registration.
  postTool_entry=$(awk "
    /export function createDefaultPipeline/ { inside=1; next }
    inside && /^\}/ { inside=0 }
    inside && /postTool:/ { in_postTool=1 }
    in_postTool { print }
    in_postTool && /\]/ { in_postTool=0 }
  " "$MIDDLEWARE_INDEX")

  if ! echo "$postTool_entry" | grep -q "reflectionLoopMiddleware"; then
    emit_violation "$GUARD_ID" "error" "server/services/middleware/index.ts" "1" \
      "reflectionLoopMiddleware is not registered in createDefaultPipeline().postTool" \
      "Add reflectionLoopMiddleware to the postTool array in createDefaultPipeline(). See docs/improvements-roadmap-spec.md §P2.2."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
else
  emit_violation "$GUARD_ID" "error" "server/services/middleware/index.ts" "0" \
    "middleware/index.ts is missing" \
    "Restore the file and re-register the default pipeline."
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# ── Check 3: agentExecutionService handles escalate_to_review ────────────
if [ -f "$EXECUTION_SERVICE" ]; then
  FILES_SCANNED=$((FILES_SCANNED + 1))
  if ! grep -q "escalate_to_review" "$EXECUTION_SERVICE"; then
    emit_violation "$GUARD_ID" "error" "server/services/agentExecutionService.ts" "1" \
      "runAgenticLoop does not handle the 'escalate_to_review' postTool action" \
      "Add a case for 'escalate_to_review' in the postTool switch. See docs/improvements-roadmap-spec.md §P2.2."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
else
  emit_violation "$GUARD_ID" "error" "server/services/agentExecutionService.ts" "0" \
    "agentExecutionService.ts is missing" \
    "Restore the file and re-wire the postTool switch."
  VIOLATIONS=$((VIOLATIONS + 1))
fi

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"

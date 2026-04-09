#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-tool-intent-convention.sh
#
# Introduced by Sprint 3 P2.3 of docs/improvements-roadmap-spec.md.
#
# Enforces that the `tool_intent` convention snippet stays wired into
# every system prompt built by `llmService.buildSystemPrompt()`. Without
# this snippet, agents will not emit `<tool_intent>` blocks, which
# causes `extractToolIntentConfidence` to return null on every tool
# call — forcing every `auto` decision through human review (fail
# closed). The behaviour degrades silently: the platform still works,
# but the confidence gate ceases to provide any benefit and review
# queues balloon.
#
# What the gate enforces (three structural checks):
#
#   1. `server/services/llmService.ts` defines a snippet constant
#      containing the literal `<tool_intent>` tag (the contract the
#      parser looks for).
#   2. The snippet contains the words `confidence` and `fail-closed`
#      (the minimum content we want agents to see).
#   3. `buildSystemPrompt` in the same file appends the snippet to its
#      output — a literal reference to the constant name appears
#      inside `parts.push(...)`.
#
# Structural parallel to `verify-reflection-loop-wired.sh` — a
# cross-cutting wiring contract the unit tests cannot cover alone.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="tool-intent-convention"
GUARD_NAME="tool_intent convention wired into buildSystemPrompt"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=0

emit_header "$GUARD_NAME"

LLM_SERVICE="$ROOT_DIR/server/services/llmService.ts"
SNIPPET_CONST="TOOL_INTENT_CONVENTION_SNIPPET"

if [ ! -f "$LLM_SERVICE" ]; then
  emit_violation "$GUARD_ID" "error" "server/services/llmService.ts" "0" \
    "llmService.ts is missing" \
    "Restore the file and re-wire the tool_intent convention snippet."
  VIOLATIONS=$((VIOLATIONS + 1))
else
  FILES_SCANNED=$((FILES_SCANNED + 1))

  # ── Check 1: snippet constant defined ──────────────────────────────────
  if ! grep -qE "const\s+${SNIPPET_CONST}\s*=" "$LLM_SERVICE"; then
    emit_violation "$GUARD_ID" "error" "server/services/llmService.ts" "1" \
      "${SNIPPET_CONST} constant is not defined" \
      "Define the snippet constant per docs/improvements-roadmap-spec.md §P2.3."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  # ── Check 2: snippet references <tool_intent>, confidence, fail-closed ─
  if ! grep -q "<tool_intent>" "$LLM_SERVICE"; then
    emit_violation "$GUARD_ID" "error" "server/services/llmService.ts" "1" \
      "Snippet is missing the literal <tool_intent> tag" \
      "Include the tag so extractToolIntentConfidence can parse the block."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  if ! grep -qi "confidence" "$LLM_SERVICE"; then
    emit_violation "$GUARD_ID" "error" "server/services/llmService.ts" "1" \
      "Snippet does not mention the confidence field" \
      "Document the confidence scoring rubric in the snippet."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  if ! grep -qi "fail[- ]closed" "$LLM_SERVICE"; then
    emit_violation "$GUARD_ID" "error" "server/services/llmService.ts" "1" \
      "Snippet does not explain the fail-closed consequence" \
      "Tell the agent that omitting the block routes the call to review."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  # ── Check 3: buildSystemPrompt pushes the snippet constant ─────────────
  # Walk the function body and look for a parts.push(...) containing the
  # snippet constant name. Bound the search to the function body so a
  # stray reference elsewhere in the file does not mask a missing push.
  push_body=$(awk "
    /export function buildSystemPrompt/ { inside=1; next }
    inside && /^\}/ { inside=0 }
    inside { print }
  " "$LLM_SERVICE")

  if ! echo "$push_body" | grep -q "${SNIPPET_CONST}"; then
    emit_violation "$GUARD_ID" "error" "server/services/llmService.ts" "1" \
      "buildSystemPrompt does not append ${SNIPPET_CONST}" \
      "Add parts.push(${SNIPPET_CONST}); inside buildSystemPrompt. See docs/improvements-roadmap-spec.md §P2.3."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
fi

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"

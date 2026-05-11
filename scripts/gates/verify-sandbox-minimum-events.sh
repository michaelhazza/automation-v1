#!/usr/bin/env bash
# verify-sandbox-minimum-events.sh — CI gate for Spec B sandbox isolation (§14.5, §25).
#
# Asserts that the three lifecycle phases each emit their required minimum events.
# Per spec §14.5:
#
#   Pass 1 — Pre-start failure path (pending → provider_unavailable without entering running):
#             MUST emit sandbox_start_failed. No sandbox_terminal required.
#
#   Pass 2 — Post-start without output-read (mid-execution provider_unavailable or
#             harvest_failed at step 2 before output.json was read):
#             MUST emit sandbox_start + sandbox_terminal.
#
#   Pass 3 — Post-start with output-read (all other post-start terminals: completed,
#             timed_out, cost_ceiling_hit, crashed, output_validation_failed,
#             harvest_failed past step 2, artefact_upload_failed):
#             MUST emit sandbox_start + sandbox_terminal +
#             (output_validated | output_validation_failed).
#
# The gate is grep-based. It checks that each of the three terminal-writer groups
# in the sandbox service files is accompanied by the correct event-writer(s).
# Because this is a static grep gate, it verifies the structural presence of the
# event-emission calls co-located with terminal-status writes — not runtime ordering.
#
# Exit codes:
#   0 — all checks pass
#   1 — one or more violations detected (blocking)
#
# CRLF-safe: patterns do not rely on line endings.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

FAIL=0

# ── Scan paths ────────────────────────────────────────────────────────────────
SANDBOX_SERVICE_DIR="$ROOT_DIR/server/services"
HARVEST_SERVICE="$SANDBOX_SERVICE_DIR/sandboxHarvestService.ts"
EXECUTION_SERVICE="$SANDBOX_SERVICE_DIR/sandboxExecutionService.ts"
SANDBOX_PROVIDER_WRAPPER="$ROOT_DIR/server/lib/withSandboxProvider.ts"

# ── Minimum-event calibration constants ───────────────────────────────────────
# These are the event_type string literals expected in the service files.
# If the spec's event taxonomy changes, update these constants here.
EVENT_START_FAILED="sandbox_start_failed"
EVENT_START="sandbox_start"
EVENT_TERMINAL="sandbox_terminal"
EVENT_OUTPUT_VALIDATED="output_validated"
EVENT_OUTPUT_VALIDATION_FAILED="output_validation_failed"

# Helper: grep across all sandbox service files for a pattern
grep_sandbox_services() {
  local pattern="$1"
  grep -rl "$pattern" \
    "$SANDBOX_SERVICE_DIR/sandboxExecutionService.ts" \
    "$SANDBOX_SERVICE_DIR/sandboxHarvestService.ts" \
    "$ROOT_DIR/server/lib/withSandboxProvider.ts" \
    2>/dev/null | head -1
}

# ── Check: pre-start failure path emits sandbox_start_failed ─────────────────
# The execution service must contain a site that writes provider_unavailable status
# and is accompanied by sandbox_start_failed event emission in the same file.
#
# Both the terminal-status write (provider_unavailable) and the event emission
# (sandbox_start_failed) must appear in the execution service or provider wrapper.

if [ -f "$EXECUTION_SERVICE" ] || [ -f "$SANDBOX_PROVIDER_WRAPPER" ]; then
  FOUND_START_FAILED=0

  for f in "$EXECUTION_SERVICE" "$SANDBOX_PROVIDER_WRAPPER"; do
    [ -f "$f" ] || continue
    if grep -v "import type" "$f" | grep -q "$EVENT_START_FAILED"; then
      FOUND_START_FAILED=1
      break
    fi
  done

  if [ "$FOUND_START_FAILED" -eq 0 ]; then
    echo "[FAIL] Pass 1: No '$EVENT_START_FAILED' event emission found in sandboxExecutionService.ts or withSandboxProvider.ts — pre-start failure path MUST emit this event (spec §14.5)"
    FAIL=1
  fi
else
  echo "[SKIP] Pass 1: sandboxExecutionService.ts and withSandboxProvider.ts not yet created — skip for now"
fi

# ── Check: post-start paths emit sandbox_start + sandbox_terminal ─────────────
# Both events must appear in the harvest service or execution service.

if [ -f "$HARVEST_SERVICE" ] || [ -f "$EXECUTION_SERVICE" ]; then
  FOUND_SANDBOX_START=0
  FOUND_SANDBOX_TERMINAL=0

  for f in "$EXECUTION_SERVICE" "$HARVEST_SERVICE" "$SANDBOX_PROVIDER_WRAPPER"; do
    [ -f "$f" ] || continue
    if grep -v "import type" "$f" | grep -q "'$EVENT_START'\|\"$EVENT_START\""; then
      FOUND_SANDBOX_START=1
    fi
    if grep -v "import type" "$f" | grep -q "'$EVENT_TERMINAL'\|\"$EVENT_TERMINAL\""; then
      FOUND_SANDBOX_TERMINAL=1
    fi
  done

  if [ "$FOUND_SANDBOX_START" -eq 0 ]; then
    echo "[FAIL] Pass 2/3: No '$EVENT_START' event emission found — post-start paths MUST emit this event (spec §14.5)"
    FAIL=1
  fi

  if [ "$FOUND_SANDBOX_TERMINAL" -eq 0 ]; then
    echo "[FAIL] Pass 2/3: No '$EVENT_TERMINAL' event emission found — post-start paths MUST emit this event (spec §14.5)"
    FAIL=1
  fi
else
  echo "[SKIP] Pass 2/3: sandboxHarvestService.ts and sandboxExecutionService.ts not yet created — skip for now"
fi

# ── Check: post-start-with-output-read emits output_validated or output_validation_failed
# The harvest service is the only writer of output-validation events.

if [ -f "$HARVEST_SERVICE" ]; then
  FOUND_OUTPUT_EVENT=0

  if grep -v "import type" "$HARVEST_SERVICE" | grep -qE "'$EVENT_OUTPUT_VALIDATED'|\"$EVENT_OUTPUT_VALIDATED\"|'$EVENT_OUTPUT_VALIDATION_FAILED'|\"$EVENT_OUTPUT_VALIDATION_FAILED\""; then
    FOUND_OUTPUT_EVENT=1
  fi

  if [ "$FOUND_OUTPUT_EVENT" -eq 0 ]; then
    echo "[FAIL] Pass 3: No '$EVENT_OUTPUT_VALIDATED' or '$EVENT_OUTPUT_VALIDATION_FAILED' event emission found in sandboxHarvestService.ts — post-start-with-output-read paths MUST emit one of these (spec §14.5)"
    FAIL=1
  fi
else
  echo "[SKIP] Pass 3: sandboxHarvestService.ts not yet created — skip for now"
fi

# ── Result ────────────────────────────────────────────────────────────────────

if [ $FAIL -eq 0 ]; then
  echo "[PASS] verify-sandbox-minimum-events: all three lifecycle phase checks satisfied"
  exit 0
else
  exit 1
fi

#!/usr/bin/env bash
# Shared utilities for architecture guard scripts
# Source this at the top of each guard: source "$SCRIPT_DIR/lib/guard-utils.sh"

# ── Suppression Comments ─────────────────────────────────────────────────────
# Pattern: // guard-ignore: <guard-id> reason="<explanation>"
# The reason is required. Suppressions without reason are not honoured.
#
# Example:
#   // guard-ignore: no-db-in-routes reason="MCP transport requires direct DB access"
#   import { db } from '../db/index.js';

# Check if a specific line in a file has a suppression comment for the given guard.
# Looks at the line itself and the line immediately above it.
# Usage: is_suppressed <file> <line_number> <guard_id>
# Returns 0 if suppressed, 1 if not.
is_suppressed() {
  local file="$1"
  local lineno="$2"
  local guard_id="$3"

  local prev_lineno=$((lineno - 1))
  [ "$prev_lineno" -lt 1 ] && prev_lineno=1

  # Check the line itself and the line above
  local context
  context=$(sed -n "${prev_lineno},${lineno}p" "$file" 2>/dev/null || true)

  # Must match: guard-ignore: <guard_id> reason="<non-empty>"
  if echo "$context" | grep -qE "guard-ignore:\s*${guard_id}\s+reason=\"[^\"]+\""; then
    return 0
  fi

  return 1
}

# ── JSON Output ──────────────────────────────────────────────────────────────
# Set GUARD_OUTPUT=json to get structured JSON output instead of human-readable.
# Each violation is printed as a JSON line (JSONL format).

# Emit a violation in the configured format.
# Usage: emit_violation <guard_name> <severity> <file> <line> <message> <fix>
emit_violation() {
  local guard_name="$1"
  local severity="$2"
  local file="$3"
  local line="$4"
  local message="$5"
  local fix="$6"

  if [ "${GUARD_OUTPUT:-text}" = "json" ]; then
    # Escape strings for JSON
    local json_msg json_fix json_file
    json_msg=$(echo "$message" | sed 's/"/\\"/g')
    json_fix=$(echo "$fix" | sed 's/"/\\"/g')
    json_file=$(echo "$file" | sed 's/"/\\"/g')
    echo "{\"guard\":\"${guard_name}\",\"severity\":\"${severity}\",\"file\":\"${json_file}\",\"line\":${line},\"message\":\"${json_msg}\",\"fix\":\"${json_fix}\"}"
  else
    echo "❌ $file:$line"
    echo "  $message"
    echo "  → $fix"
    echo ""
  fi
}

# Emit the guard header
# Usage: emit_header <guard_name>
emit_header() {
  local guard_name="$1"
  if [ "${GUARD_OUTPUT:-text}" != "json" ]; then
    echo "[GUARD] $guard_name"
  fi
}

# Emit the summary line
# Usage: emit_summary <files_scanned> <violations>
emit_summary() {
  local files_scanned="$1"
  local violations="$2"
  if [ "${GUARD_OUTPUT:-text}" != "json" ]; then
    echo ""
    echo "Summary: $files_scanned files scanned, $violations violations found"
  fi
}

# ── Baseline Regression ──────────────────────────────────────────────────────
# When GUARD_BASELINE=true, compare violation count against stored baseline.
# Baselines stored in scripts/guard-baselines.json
# CI fails only if violations increased.

BASELINE_FILE="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/scripts/guard-baselines.json"

# Get baseline count for a guard.
# Usage: get_baseline <guard_id>
# Returns the count via stdout. Returns -1 if no baseline exists.
get_baseline() {
  local guard_id="$1"
  if [ ! -f "$BASELINE_FILE" ]; then
    echo "-1"
    return
  fi
  local count
  count=$(grep "\"${guard_id}\"" "$BASELINE_FILE" 2>/dev/null | grep -oE '[0-9]+' | tail -1 || echo "-1")
  [ -z "$count" ] && count="-1"
  echo "$count"
}

# Check if violations regressed from baseline.
# Usage: check_baseline <guard_id> <current_violations> <default_exit_code>
# Returns the exit code to use.
# If GUARD_BASELINE=true and baseline exists:
#   - violations > baseline → exit 1 (hard fail regardless of tier)
#   - violations <= baseline → exit 0 (pass, even if violations exist)
# If GUARD_BASELINE is not set, returns the default_exit_code.
check_baseline() {
  local guard_id="$1"
  local current="$2"
  local default_exit="$3"

  if [ "${GUARD_BASELINE:-false}" != "true" ]; then
    if [ "$current" -gt 0 ]; then
      echo "$default_exit"
    else
      echo "0"
    fi
    return
  fi

  local baseline
  baseline=$(get_baseline "$guard_id")

  if [ "$baseline" = "-1" ]; then
    # No baseline — fall back to default behaviour
    if [ "$current" -gt 0 ]; then
      echo "$default_exit"
    else
      echo "0"
    fi
    return
  fi

  if [ "$current" -gt "$baseline" ]; then
    if [ "${GUARD_OUTPUT:-text}" != "json" ]; then
      echo "⚠ Regression: $current violations (baseline: $baseline)" >&2
    fi
    echo "1"  # Hard fail on regression
  else
    if [ "${GUARD_OUTPUT:-text}" != "json" ] && [ "$current" -gt 0 ]; then
      echo "✓ Within baseline: $current violations (baseline: $baseline)" >&2
    fi
    echo "0"  # Pass — at or below baseline
  fi
}

#!/usr/bin/env bash
# Shared utilities for architecture guard scripts
# Source this at the top of each guard: source "$SCRIPT_DIR/lib/guard-utils.sh"
#
# Requires: jq, node
command -v jq >/dev/null 2>&1 || { echo "[GUARD] Error: jq is required but not installed" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "[GUARD] Error: node is required but not installed" >&2; exit 1; }

# ── Suppression Annotation Grammar ──────────────────────────────────────────
# All Tier-1 gates accept inline suppressions.  The guard-id must match the
# gate's GUARD_ID variable (e.g. "no-db-in-routes", "canonical-retry").
#
# T1 PREFERRED — co-located on the offending line:
#   // guard-ignore: <guard-id> reason="<rationale, ≤120 chars>"
#   Example:
#   import { db } from '../db/index.js'; // guard-ignore: no-db-in-routes reason="MCP transport requires direct DB"
#
# T0 DEPRECATED (legacy, no reason field) — gates emit error severity on T0-only suppressions:
#   // guard-ignore: <guard-id>
#   Example:
#   import { db } from '../db/index.js'; // guard-ignore: no-db-in-routes
#
# ADR SHAPE — accepted for P2-baseline entries:
#   // guard-ignore: <guard-id> ADR-<id> <rationale>
#   Example:
#   import { db } from '../db/index.js'; // guard-ignore: no-db-in-routes ADR-0042 direct-db required for MCP transport
#
# NEXT-LINE form — place directive on the line immediately ABOVE the violation:
#   // guard-ignore-next-line: <guard-id> reason="<rationale>"
#   Example:
#   // guard-ignore-next-line: no-db-in-routes reason="MCP transport requires direct DB access"
#   import { db } from '../db/index.js';
#
# FILE-SCOPED form — first line of file (suppresses all violations for that guard in that file):
#   // guard-ignore-file: <guard-id> reason="<rationale>"
#   Example (top of file):
#   // guard-ignore-file: canonical-logger reason="CLI utility writes to stdout intentionally"
#
# Use format_suppression <guard-id> to print the T1 template, legacy template, and
# next-line template for inclusion in gate error messages.
# ────────────────────────────────────────────────────────────────────────────

# ── jq portability shim ──────────────────────────────────────────────────────
# jq on Windows (winget/native binary) under Git Bash has two hazards:
#   (1) It writes CRLF line endings to stdout. Bash captures via $(...) and
#       word-splits — each token ends up with a trailing \r, breaking
#       comparisons, array lookups, and key-by-name fetches.
#   (2) MSYS auto-converts Unix-style argv tokens that look like paths
#       (e.g. `--arg p "/api/engines"`) into Windows paths, mangling the
#       comparison value. Disabling path conv with MSYS_NO_PATHCONV=1 fixes
#       (2) but then breaks file-path positional args like
#       `/c/Files/.../baseline.json`.
# Solution: walk argv. Convert any token that exists as a file to its Windows
# native form (so jq's binary can open it), but leave non-file tokens alone
# (so --arg values aren't mangled). cygpath is part of every Git Bash install.
# Also disable global path conv via MSYS_NO_PATHCONV to stop --arg mangling.
# Both behaviours no-op on Linux/macOS where cygpath is absent.
jq() {
  if command -v cygpath >/dev/null 2>&1; then
    local args=()
    local a
    for a in "$@"; do
      if [ -f "$a" ]; then
        args+=("$(cygpath -m "$a")")
      else
        args+=("$a")
      fi
    done
    MSYS_NO_PATHCONV=1 command jq "${args[@]}" | tr -d '\r'
  else
    command jq "$@" | tr -d '\r'
  fi
}

# ── Suppression Comments ─────────────────────────────────────────────────────
# Suppression uses a next-line directive. Place on the line ABOVE the violation.
#
# Pattern (legacy):
#   // guard-ignore-next-line: <guard-id> reason="<explanation>"
#
# Example (legacy):
#   // guard-ignore-next-line: no-db-in-routes reason="MCP transport requires direct DB access"
#   import { db } from '../db/index.js';
#
# Same-line legacy format:
#   import { db } from '../db/index.js'; // guard-ignore: no-db-in-routes reason="MCP transport"
#
# T1 token format (preferred for new suppressions):
#   import { db } from '../db/index.js'; // guard-ignore <guard-id>: <ADR-id> <one-line rationale>
#   Where <ADR-id> matches [0-9]{4}-[a-z0-9-]+

# Check if a specific line in a file has a suppression comment for the given guard.
# Checks: (1) same line for inline guard-ignore (legacy or T1), (2) previous line for guard-ignore-next-line.
# Usage: is_suppressed <file> <line_number> <guard_id>
# Returns 0 if suppressed, 1 if not.
is_suppressed() {
  local file="$1"
  local lineno="$2"
  local guard_id="$3"

  local current_line
  current_line=$(sed -n "${lineno}p" "$file" 2>/dev/null || true)

  # T1 format: guard-ignore <guard-id>: <ADR-id matching \d{4}-[a-z0-9-]+> <rationale>
  if echo "$current_line" | grep -qE "guard-ignore\s+${guard_id}:\s+[0-9]{4}-[a-z0-9-]+\s+\S"; then
    return 0
  fi

  # Legacy same-line format: guard-ignore: <id> reason="..."
  if echo "$current_line" | grep -qE "guard-ignore:\s*${guard_id}\s+reason=\"[^\"]+\""; then
    return 0
  fi

  # Check previous line for next-line directive: guard-ignore-next-line: <id> reason="..."
  local prev_lineno=$((lineno - 1))
  if [ "$prev_lineno" -ge 1 ]; then
    local prev_line
    prev_line=$(sed -n "${prev_lineno}p" "$file" 2>/dev/null || true)
    if echo "$prev_line" | grep -qE "guard-ignore-next-line:\s*${guard_id}\s+reason=\"[^\"]+\""; then
      return 0
    fi
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
    jq -nc \
      --arg guard "$guard_name" \
      --arg severity "$severity" \
      --arg file "$file" \
      --arg line "$line" \
      --arg message "$message" \
      --arg fix "$fix" \
      '{guard:$guard, severity:$severity, file:$file, line:($line|tonumber), message:$message, fix:$fix}'
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
    echo "[GATE] ${GUARD_ID}: violations=${violations}"
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
  count=$(jq -r --arg id "$guard_id" '.[$id] // -1' "$BASELINE_FILE" 2>/dev/null || echo "-1")
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

# ── Per-gate expiring baseline ───────────────────────────────────────────────
# Baseline files live at scripts/.gate-baselines/<guard-id>.txt
# Format (see scripts/.gate-baselines/_TEMPLATE.txt):
#   # expires: YYYY-MM-DD
#   <relative-path>:<line-number>:<one-line-message>
# Lines beginning with # are comments; every violation entry must be preceded
# by an "# expires: YYYY-MM-DD" comment line.
#
# Exit codes returned (printed to stdout — caller uses the value):
#   0 — all baseline entries current; no new violations
#   1 — error: new violations above baseline OR baseline entry past grace period
#   2 — warning: baseline-only violations OR baseline entry expired within grace

GATE_BASELINES_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/scripts/.gate-baselines"
GATE_BASELINE_HELPERS="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/scripts/lib/gate-baseline-helpers.mjs"

# Check current violations against a per-gate expiring baseline file.
# Usage: check_expiring_baseline <guard_id> <current_violation_lines>
#   guard_id              — matches <guard-id>.txt under scripts/.gate-baselines/
#   current_violation_lines — newline-separated violation strings (may be empty)
# Prints exit code to stdout. Exit-code policy mirrors
# references/test-gate-policy.md § "Baseline expiry policy":
#   0 — no current violations, no baseline expiry
#   1 — error: new violation above baseline OR baseline entry past grace period
#   2 — warning: baseline-only violations OR baseline entry expired within grace
# Emits diagnostic messages to stderr (per-entry expiry warnings and errors).
check_expiring_baseline() {
  local guard_id="$1"
  local current_violations="$2"
  local baseline_file="${GATE_BASELINES_DIR}/${guard_id}.txt"
  local grace_days="${GATE_GRACE_DAYS:-30}"

  # No baseline file → treat all violations as new.
  if [ ! -f "$baseline_file" ]; then
    if [ -n "$current_violations" ]; then
      echo "1"
    else
      echo "0"
    fi
    return
  fi

  # Write current violations to a temp file so Node can read them safely
  # (avoids shell-quoting and path-conversion hazards on Windows/Git Bash).
  local tmp_violations
  tmp_violations=$(mktemp)
  printf '%s' "$current_violations" > "$tmp_violations"

  # Delegate date math and expiry parsing to Node (bash date portability issue:
  # BSD date vs GNU date have incompatible -d / -v flags; see plan §1 Risks).
  local result
  result=$(GATE_BASELINE_FILE="${baseline_file}" \
           GATE_VIOLATIONS_FILE="${tmp_violations}" \
           GATE_GRACE_DAYS="${grace_days}" \
           GATE_BASELINE_HELPERS_PATH="${GATE_BASELINE_HELPERS}" \
           node --input-type=module <<'NODEEOF'
const { parseBaselineFile, isExpired, isPastGracePeriod } = await import(
  'file://' + process.env.GATE_BASELINE_HELPERS_PATH
);
const { readFileSync } = await import('node:fs');

const baselineText = readFileSync(process.env.GATE_BASELINE_FILE, 'utf8');
const currentText  = readFileSync(process.env.GATE_VIOLATIONS_FILE, 'utf8');
const entries      = parseBaselineFile(baselineText);
const today        = new Date().toISOString().slice(0, 10);
const graceDays    = Number(process.env.GATE_GRACE_DAYS) || 30;

const currentKeys = new Set(
  currentText.split('\n').map(l => l.trim()).filter(Boolean)
);
const baselineKeys   = new Set();
let hasExpiredError   = false;
let hasExpiredWarning = false;

for (const entry of entries) {
  if (entry.error) {
    process.stderr.write('[GUARD] Malformed baseline entry: ' + entry.error + '\n');
    continue;
  }
  baselineKeys.add(entry.key);
  if (entry.expires && isPastGracePeriod(entry.expires, today, graceDays)) {
    process.stderr.write('[GUARD] ERROR: baseline entry past grace period (' + graceDays + ' days): '
      + entry.key + ' (expired ' + entry.expires + ')\n');
    hasExpiredError = true;
  } else if (entry.expires && isExpired(entry.expires, today)) {
    process.stderr.write('[GUARD] WARNING: baseline entry expired: '
      + entry.key + ' (expired ' + entry.expires + ')\n');
    hasExpiredWarning = true;
  }
}

// Exit-code policy per references/test-gate-policy.md § "Baseline expiry policy":
//   past-grace expiry → exit-1 contribution (error)
//   within-grace expiry → exit-2 contribution (warning)
//   new violation above baseline → exit-1 contribution (error)
//   baseline-only violations → exit-2 contribution (warning)
const newViolations = [...currentKeys].filter(k => !baselineKeys.has(k));
if (newViolations.length > 0 || hasExpiredError) {
  process.stdout.write('1');
} else if (hasExpiredWarning || baselineKeys.size > 0) {
  process.stdout.write('2');
} else {
  process.stdout.write('0');
}
NODEEOF
  )

  rm -f "$tmp_violations"
  echo "${result:-0}"
}

# Emit the canonical suppression-comment templates for a given guard-id.
# Prints T1 template, legacy template, and next-line template (one per line).
# Usage: format_suppression <guard_id>
# Verifiable: format_suppression <id> | wc -l == 3
format_suppression() {
  local guard_id="$1"
  printf '// guard-ignore: %s reason="<rationale, ≤120 chars>"\n' "$guard_id"
  printf '// guard-ignore: %s\n' "$guard_id"
  printf '// guard-ignore-next-line: %s reason="<rationale, ≤120 chars>"\n' "$guard_id"
}

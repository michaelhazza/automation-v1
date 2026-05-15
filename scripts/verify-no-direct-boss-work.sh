#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-no-direct-boss-work.sh  (R1 from Track A3)
#
# Flags any `boss.work(...)` or `<bossInstance>.work(...)` call outside the
# canonical worker registration wrapper at server/lib/createWorker.ts.
#
# Why: every pg-boss queue handler should be registered via createWorker(...),
# which threads through the canonical withOrgTx prelude and tenant context.
# Bare boss.work(...) calls in service files, job files, and server/index.ts
# bypass that prelude — same family as Track A2 WF4 (workflow tick worker)
# and Track A3 SA4 (skill-analyzer worker).
#
# Detection pattern:
#   - Match `.work(` preceded by an identifier (boss, pgboss, this.boss, etc.)
#   - Limit to files under server/
#   - Exclude server/lib/createWorker.ts (the canonical wrapper itself)
#   - Exclude server/lib/__tests__/** and any *.test.ts (test fixtures)
#
# Suppression: add `// guard-ignore: no-direct-boss-work reason="<rationale>"`
# on the same line, or baseline the entry in
# scripts/.gate-baselines/no-direct-boss-work.txt.
#
# Baseline: seeded 2026-05-15 with the current direct-boss.work call sites
# pending migration to createWorker. Env B (SA4) drops the skill-analyzer
# entry; other entries follow per their owning track.
#
# Exit codes:
#   0 — no current violations outside baseline
#   1 — new violation above baseline OR baseline entry past grace period
#   2 — baseline-only violations or within-grace expiry warning
# ---------------------------------------------------------------------------

set -euo pipefail

if [ "${1:-}" = "--help" ]; then
  sed -n '2,/^# ---/p' "$0" | sed -n '1,/^# ---/p'
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="no-direct-boss-work"
GUARD_NAME="Direct boss.work() outside createWorker (R1)"

source "$SCRIPT_DIR/lib/guard-utils.sh"

if [ "${1:-}" = "--list-baseline" ]; then
  BASELINE_FILE="${ROOT_DIR}/scripts/.gate-baselines/${GUARD_ID}.txt"
  if [ -f "$BASELINE_FILE" ]; then
    cat "$BASELINE_FILE"
  else
    echo "(no baseline file at ${BASELINE_FILE})"
  fi
  exit 0
fi

emit_header "$GUARD_NAME"

CANONICAL_WRAPPER="server/lib/createWorker.ts"

VIOLATIONS=0
VIOLATION_KEYS=""
FILES_SCANNED=0

# Collect TS files under server/ (no tests, no node_modules).
while IFS= read -r src_file; do
  [ -z "$src_file" ] && continue
  rel_path=$(echo "$src_file" | sed "s|^${ROOT_DIR}/||" | sed 's|\\|/|g')

  # Skip the canonical wrapper itself and any test fixtures.
  case "$rel_path" in
    "$CANONICAL_WRAPPER") continue ;;
    server/lib/__tests__/*) continue ;;
    */__tests__/*) continue ;;
    *.test.ts) continue ;;
  esac

  FILES_SCANNED=$((FILES_SCANNED + 1))

  # Match `<identifier>.work(` patterns. The leading identifier must NOT be
  # part of a member chain that ultimately rooted at `createWorker` — but a
  # simple AST-free heuristic suffices: any `.work(` where the immediately
  # preceding identifier suggests a boss instance.
  while IFS= read -r match; do
    [ -z "$match" ] && continue
    lineno=$(echo "$match" | cut -d: -f1)
    line_text=$(echo "$match" | cut -d: -f2-)

    # Filter to actual pg-boss worker registrations: the identifier just
    # before `.work(` must be one of the four canonical boss-instance names
    # used in this codebase: `boss`, `pgboss`, `this.boss`, `this.pgboss`.
    # Skip lines that match unrelated `.work` symbols (e.g., `network.work`).
    if ! echo "$line_text" | grep -qE "\b(boss|pgboss)\.work\(|this\.(boss|pgboss)\.work\("; then
      continue
    fi

    # Skip if the line is a comment (starts with // or *).
    trimmed=$(echo "$line_text" | sed -E 's/^[[:space:]]+//')
    case "$trimmed" in
      "//"*|"*"*|"/*"*) continue ;;
    esac

    # Skip if the line (or the previous line) carries a suppression for this gate.
    is_suppressed "$src_file" "$lineno" "$GUARD_ID" && continue

    emit_violation "$GUARD_ID" "error" "$rel_path" "$lineno" \
      "Direct boss.work() registration bypasses createWorker — the canonical worker wrapper threads withOrgTx and tenant context" \
      "Wrap the registration in createWorker({ queue, boss, resolveOrgContext, handler }) from server/lib/createWorker.ts, or suppress with: // guard-ignore: ${GUARD_ID} reason=\"<rationale>\""

    VIOLATION_KEYS="${VIOLATION_KEYS}${rel_path}:${lineno}:Direct boss.work() registration bypasses createWorker — the canonical worker wrapper threads withOrgTx and tenant context
"
    VIOLATIONS=$((VIOLATIONS + 1))
  done < <(grep -nE "\.work\(" "$src_file" 2>/dev/null || true)
done < <(find "$ROOT_DIR/server" -type f -name '*.ts' \
           -not -name '*.test.ts' \
           -not -path '*/node_modules/*' \
           -not -path '*/__tests__/*' 2>/dev/null || true)

VIOLATION_KEYS="${VIOLATION_KEYS%$'\n'}"

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_expiring_baseline "$GUARD_ID" "$VIOLATION_KEYS")
exit "$exit_code"

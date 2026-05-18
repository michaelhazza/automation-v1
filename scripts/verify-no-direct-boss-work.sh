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

# Build the file list via Node-native glob (OS-portable — fixes POSIX path bug).
# Use a temp file to stage JSON output so the parse step avoids bash-interpolation
# of backslash-escaped Windows paths inside the heredoc (same pattern as
# verify-with-org-tx-or-scoped-db.sh — see Codex review 2026-05-14).
TMP_FILES_JSON=$(mktemp)
ROOT_DIR="$ROOT_DIR" \
GATE_ROOT="${GATE_ROOT:-$ROOT_DIR}" \
ENUMERATOR_PATH="${SCRIPT_DIR}/lib/gate-file-enumerator.mjs" \
node --input-type=module <<'NODEEOF' > "$TMP_FILES_JSON"
import { pathToFileURL } from 'node:url';
const { enumerateGateFiles } = await import(
  pathToFileURL(process.env.ENUMERATOR_PATH).href
);
const files = enumerateGateFiles({
  root: process.env.ROOT_DIR,
  includes: ['server/**/*.ts'],
  excludes: [
    '**/*.test.ts',
    '**/node_modules/**',
    '**/__tests__/**',
    'server/lib/createWorker.ts',
  ],
});
process.stdout.write(JSON.stringify(files));
NODEEOF

# Parse JSON array into bash array (reads from temp file, not bash variable).
readarray -t TS_FILES < <(FILES_JSON_FILE="$TMP_FILES_JSON" node --input-type=module <<'PARSEEOF'
import { readFileSync } from 'node:fs';
const files = JSON.parse(readFileSync(process.env.FILES_JSON_FILE, 'utf8') || '[]');
for (const f of files) process.stdout.write(f + '\n');
PARSEEOF
)
rm -f "$TMP_FILES_JSON"

FILES_SCANNED=${#TS_FILES[@]}

for src_file in "${TS_FILES[@]}"; do
  [ -z "$src_file" ] && continue
  rel_path=$(echo "$src_file" | sed "s|^${ROOT_DIR}/||" | sed 's|\\|/|g')

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
done

VIOLATION_KEYS="${VIOLATION_KEYS%$'\n'}"

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_expiring_baseline "$GUARD_ID" "$VIOLATION_KEYS")
exit "$exit_code"

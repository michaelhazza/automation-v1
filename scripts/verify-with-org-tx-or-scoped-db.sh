#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-with-org-tx-or-scoped-db.sh
#
# Verifies that every db.select() / db.insert() / db.update() / db.delete()
# call site outside server/db/ is reached through withOrgTx(...) or
# getOrgScopedDb(...).
#
# HEURISTIC LIMITATION: single-level caller walk via ts-morph.
#   Functions called indirectly (via queue handlers, event emitters, deep
#   call chains, setImmediate, etc.) are not traced. When the heuristic
#   over-flags, suppress with a per-line comment:
#     // guard-ignore: with-org-tx-or-scoped-db ADR-<id> <rationale>
#
# Implementation delegates AST analysis to scripts/lib/with-org-tx-analyser.mjs
# which uses ts-morph for call-expression analysis.
#
# Suppression (co-located on the violating line or the preceding line):
#   // guard-ignore: with-org-tx-or-scoped-db ADR-<id> <rationale>
#   // guard-ignore: with-org-tx-or-scoped-db reason="<rationale ≤120 chars>"
#   // guard-ignore-next-line: with-org-tx-or-scoped-db reason="<rationale>"
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="with-org-tx-or-scoped-db"
GUARD_NAME="With-Org-Tx or Scoped-DB scope"
ANALYSER="${SCRIPT_DIR}/lib/with-org-tx-analyser.mjs"

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

# Collect TypeScript files outside server/db/ that may contain db calls.
ANALYSE_DIRS=(
  "$ROOT_DIR/server/services"
  "$ROOT_DIR/server/jobs"
  "$ROOT_DIR/server/lib"
  "$ROOT_DIR/server/adapters"
)

# Build file list, excluding test files and node_modules.
FILE_LIST=""
for dir in "${ANALYSE_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    while IFS= read -r f; do
      FILE_LIST="${FILE_LIST}${f}
"
    done < <(find "$dir" -name '*.ts' -not -path '*/node_modules/*' \
               -not -name '*.test.ts' -not -name '*.integration.test.ts' \
               2>/dev/null || true)
  fi
done

# Write file list to a temp file (avoids shell path-conversion hazards on Windows).
TMP_FILES=$(mktemp)
printf '%s' "$FILE_LIST" > "$TMP_FILES"

# Run the ts-morph analyser and capture JSON output.
RESULT_JSON=$(
  ROOT_DIR="$ROOT_DIR" \
  FILE_LIST_PATH="$TMP_FILES" \
  ANALYSER_PATH="$ANALYSER" \
  node --input-type=module <<'NODEEOF'
const { analyseWithOrgTxScope } = await import(
  'file://' + process.env.ANALYSER_PATH
);
import { readFileSync } from 'node:fs';

const repoRoot = process.env.ROOT_DIR;
const fileListText = readFileSync(process.env.FILE_LIST_PATH, 'utf8');
const files = fileListText.split('\n').map(f => f.trim()).filter(Boolean);

const violations = analyseWithOrgTxScope(repoRoot, files);
process.stdout.write(JSON.stringify(violations));
NODEEOF
)
NODE_EXIT=$?
rm -f "$TMP_FILES"

if [ $NODE_EXIT -ne 0 ]; then
  echo "[GATE] ${GUARD_ID}: analyser failed (exit ${NODE_EXIT})" >&2
  exit 1
fi

VIOLATIONS=0
VIOLATION_KEYS=""
FILES_SCANNED=0

# Count source files scanned.
for dir in "${ANALYSE_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    count=$(find "$dir" -name '*.ts' -not -path '*/node_modules/*' \
              -not -name '*.test.ts' -not -name '*.integration.test.ts' \
              2>/dev/null | wc -l || echo 0)
    FILES_SCANNED=$((FILES_SCANNED + count))
  fi
done

# Stage the JSON payload to a temp file so the parser heredoc does not collide
# with the pipe stdin (a heredoc-backed `node --input-type=module` consumes its
# stdin from the heredoc, not from any piped predecessor — see Codex review
# 2026-05-14).
TMP_RESULT_JSON=$(mktemp)
printf '%s' "$RESULT_JSON" > "$TMP_RESULT_JSON"

PARSED_LINES=$(RESULT_JSON_FILE="$TMP_RESULT_JSON" node --input-type=module <<'PARSEEOF'
import { readFileSync } from 'node:fs';
const input = readFileSync(process.env.RESULT_JSON_FILE, 'utf8');
const violations = JSON.parse(input || '[]');
for (const v of violations) {
  process.stdout.write(`${v.file}:${v.line}:${v.message}\n`);
}
PARSEEOF
)
PARSE_EXIT=$?
rm -f "$TMP_RESULT_JSON"

if [ $PARSE_EXIT -ne 0 ]; then
  echo "[GATE] ${GUARD_ID}: failed to parse analyser output (exit ${PARSE_EXIT})" >&2
  exit 1
fi

# Emit each violation and collect baseline keys.
while IFS= read -r vline; do
  [ -z "$vline" ] && continue
  vfile=$(echo "$vline" | cut -d: -f1)
  vlineno=$(echo "$vline" | cut -d: -f2)
  vmsg=$(echo "$vline" | cut -d: -f3-)

  emit_violation "$GUARD_ID" "warning" "$vfile" "$vlineno" \
    "$vmsg" \
    "Wrap db calls via withOrgTx(...) or getOrgScopedDb(...), or suppress with: guard-ignore: ${GUARD_ID} ADR-<id> <rationale>"

  VIOLATION_KEYS="${VIOLATION_KEYS}${vfile}:${vlineno}:${vmsg}
"
  VIOLATIONS=$((VIOLATIONS + 1))
done <<< "$PARSED_LINES"

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

# Numeric baseline via scripts/guard-baselines.json (count = 0 — re-seeded
# 2026-05-17 once all Tier-1 callsites migrated to getOrgScopedDb / withAdminConnection
# or annotated with guard-ignore via Wave 5 wave-5-prevention-gates-and-rls).
# The per-file baseline at scripts/.gate-baselines/with-org-tx-or-scoped-db.txt
# is now header-only; any future violation must be explicitly suppressed via a
# guard-ignore directive (one of the three accepted forms) or it fails the gate.
# Warning-first rollout promoted to error 2026-05-15 (post-7-day soak from PR #307).
exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"

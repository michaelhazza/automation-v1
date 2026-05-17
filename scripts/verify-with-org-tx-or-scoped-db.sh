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

# Run the ts-morph analyser and capture JSON output.
# File enumeration uses Node-native glob (OS-portable) via gate-file-enumerator.mjs.
# Replaces the former bash find -> TMP_FILES -> FILE_LIST_PATH pipeline which emitted
# POSIX paths (/c/...) on Windows git-bash, causing Node to silently skip all files.
RESULT_JSON=$(
  ROOT_DIR="$ROOT_DIR" \
  GATE_ROOT="$ROOT_DIR" \
  ENUMERATOR_PATH="${SCRIPT_DIR}/lib/gate-file-enumerator.mjs" \
  ANALYSER_PATH="$ANALYSER" \
  node --input-type=module <<'NODEEOF'
import { pathToFileURL } from 'node:url';
const { enumerateGateFiles } = await import(
  pathToFileURL(process.env.ENUMERATOR_PATH).href
);
const { analyseWithOrgTxScope } = await import(
  pathToFileURL(process.env.ANALYSER_PATH).href
);

const repoRoot = process.env.ROOT_DIR;
const files = enumerateGateFiles({
  root: repoRoot,
  includes: [
    'server/services/**/*.ts',
    'server/jobs/**/*.ts',
    'server/lib/**/*.ts',
    'server/adapters/**/*.ts',
  ],
  excludes: ['**/__tests__/**'],
});

const violations = analyseWithOrgTxScope(repoRoot, files);
process.stdout.write(JSON.stringify(violations));
NODEEOF
)
NODE_EXIT=$?

if [ $NODE_EXIT -ne 0 ]; then
  echo "[GATE] ${GUARD_ID}: analyser failed (exit ${NODE_EXIT})" >&2
  exit 1
fi

VIOLATIONS=0
VIOLATION_KEYS=""
# FILES_SCANNED is cosmetic; the Node enumeration owns the actual file list.
# Accurate count comes from the analyser run above; 0 is a safe display default.
FILES_SCANNED=0

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

# Numeric baseline via scripts/guard-baselines.json (count = 1108 — re-seeded
# 2026-05-17 post-CI to honest Linux-measured count after Wave 5 PR #335
# migrated ~1045 callsites from raw db.X() to getOrgScopedDb / withAdminConnection.
# The earlier "count = 0" baseline was a Windows-only artefact: this gate's
# find-based file list returns POSIX paths (/c/...) that Node's existsSync
# rejects on Windows, so the local gate reported 0 violations regardless of
# actual callsite state. Linux CI surfaced the real residue. Remaining 1108
# violations are tracked as Wave 6 follow-up (Windows path fix + complete the
# migration). Per-file baseline scripts/.gate-baselines/with-org-tx-or-scoped-db.txt
# is header-only; any regression above 1108 fails the gate.
# Warning-first rollout promoted to error 2026-05-15 (post-7-day soak from PR #307).
exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"

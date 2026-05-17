#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-no-orphan-react-component.sh
#
# Detects React component files in client/src/pages/ and client/src/components/
# that have zero ingress — not referenced via React Router in App.tsx and not
# transitively imported by any routed page.
#
# Detection strategy:
#   1. Parse client/src/App.tsx by regex for lazy(() => import('./pages/X'))
#      patterns to collect the routed entry points.
#   2. Walk transitive imports from each routed file using ts-morph.
#   3. Flag any .tsx/.ts file under pages/ or components/ that is not
#      reachable from step 1 or 2.
#
# Allow-list at client/.orphan-allowlist.json:
#   Files listed there (relative paths from repo root) are exempt.
#   Shape: { "files": [{ "path": "...", "reason": "..." }] }
#
# Suppression: Add to client/.orphan-allowlist.json for file-level exemptions.
# There is no per-line suppression; the allow-list is the canonical override.
#
# Exit codes: 0=pass, 1=new orphans or past-grace baseline expiry, 2=within baseline or within-grace expiry warning.
# Warning-first rollout promoted to error 2026-05-15 (post-7-day soak from PR #307); exit-1 path was already in place via check_expiring_baseline.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="no-orphan-react-component"
GUARD_NAME="No Orphan React Component"
ANALYSER="${SCRIPT_DIR}/lib/orphan-component-analyser.mjs"
ENTRY_FILE="${ROOT_DIR}/client/src/App.tsx"
COMPONENT_ROOT="${ROOT_DIR}/client/src"
ALLOW_LIST_FILE="${ROOT_DIR}/client/.orphan-allowlist.json"

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

if [ ! -f "$ENTRY_FILE" ]; then
  echo "[GATE] ${GUARD_ID}: App.tsx not found at ${ENTRY_FILE}" >&2
  exit 1
fi

# Run the ts-morph analyser.
RESULT_JSON=$(
  ROOT_DIR="$ROOT_DIR" \
  ENTRY_FILE="$ENTRY_FILE" \
  COMPONENT_ROOT="$COMPONENT_ROOT" \
  ALLOW_LIST_FILE="$ALLOW_LIST_FILE" \
  ANALYSER_PATH="$ANALYSER" \
  node --input-type=module <<'NODEEOF'
const { findOrphanComponents } = await import(
  'file://' + process.env.ANALYSER_PATH
);

const violations = findOrphanComponents({
  entryFile: process.env.ENTRY_FILE,
  componentRoot: process.env.COMPONENT_ROOT,
  allowListFile: process.env.ALLOW_LIST_FILE,
  repoRoot: process.env.ROOT_DIR,
});
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
FILES_SCANNED=0

# Count component files scanned.
if [ -d "${COMPONENT_ROOT}/pages" ]; then
  count_pages=$(find "${COMPONENT_ROOT}/pages" -name '*.tsx' -o -name '*.ts' | \
    grep -v '\.test\.' | grep -v 'node_modules' | wc -l || echo 0)
  FILES_SCANNED=$((FILES_SCANNED + count_pages))
fi
if [ -d "${COMPONENT_ROOT}/components" ]; then
  count_components=$(find "${COMPONENT_ROOT}/components" -name '*.tsx' -o -name '*.ts' | \
    grep -v '\.test\.' | grep -v 'node_modules' | wc -l || echo 0)
  FILES_SCANNED=$((FILES_SCANNED + count_components))
fi

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
  process.stdout.write(`${v.file}:${v.message}\n`);
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
  vmsg=$(echo "$vline" | cut -d: -f2-)

  emit_violation "$GUARD_ID" "warning" "$vfile" "1" \
    "$vmsg" \
    "Add to client/.orphan-allowlist.json with a reason, or import this file from a routed page"

  VIOLATION_KEYS="${VIOLATION_KEYS}${vfile}:1:${vmsg}
"
  VIOLATIONS=$((VIOLATIONS + 1))
done <<< "$PARSED_LINES"

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_expiring_baseline "$GUARD_ID" "$VIOLATION_KEYS")
exit "$exit_code"

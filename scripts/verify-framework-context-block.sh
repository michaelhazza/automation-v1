#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-framework-context-block.sh  (P13)
#
# Parses the §2 AutomationOS context block table in docs/codebase-audit-framework.md
# and cross-references declared package versions against package.json.
#
# Facts with a package.json source of truth:
#   TypeScript, Express, React, Vite, Drizzle, postgres, pg-boss,
#   Socket.io, Zod, Playwright, MCP SDK, Langfuse, Vitest.
#
# Violation: a row where the backtick-quoted version in the table does not
# match the corresponding package.json entry.
#
# No per-finding suppression — fix the source (update the context block or
# bump the package version consistently).
#
# Exit codes:
#   0 — no drift
#   1 — new violation above baseline OR baseline entry past grace period
#   2 — baseline-only violations or within-grace expiry warning
#
# Warning-first rollout promoted to error 2026-05-15 (post-7-day soak from PR #307).
# New violations exit 1 via check_expiring_baseline; baseline-only entries exit 2 (within-grace warning).
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="framework-context-block"
GUARD_NAME="Framework Context Block Sync (P13)"

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

# Delegate to pure helper via Node
RESULT=$(REPO_ROOT="$ROOT_DIR" node --input-type=module <<'NODEEOF'
const { runFrameworkContextGate } = await import(
  'file://' + process.env.REPO_ROOT + '/scripts/lib/framework-context-pure.mjs'
);

const findings = runFrameworkContextGate(process.env.REPO_ROOT);
const violations = findings
  .filter(f => f.result === 'drift')
  .map(f => `docs/codebase-audit-framework.md:0:${f.fact} declared "${f.declaredValue.substring(0, 80)}" but package.json has "${f.actualVersion}"`);

process.stdout.write(JSON.stringify(violations));
NODEEOF
)

VIOLATIONS_JSON="$RESULT"

VIOLATION_LINES=$(VIOLATIONS_JSON="$VIOLATIONS_JSON" node --input-type=module <<'NODEEOF'
const list = JSON.parse(process.env.VIOLATIONS_JSON);
process.stdout.write(list.join('\n'));
NODEEOF
)

VIOLATION_COUNT=$(VIOLATIONS_JSON="$VIOLATIONS_JSON" node --input-type=module <<'NODEEOF'
const list = JSON.parse(process.env.VIOLATIONS_JSON);
process.stdout.write(String(list.length));
NODEEOF
)

if [ "$VIOLATION_COUNT" -gt 0 ]; then
  while IFS= read -r vline; do
    [ -z "$vline" ] && continue
    src=$(echo "$vline" | cut -d: -f1)
    lineno=$(echo "$vline" | cut -d: -f2)
    msg=$(echo "$vline" | cut -d: -f3-)
    emit_violation "$GUARD_ID" "warning" "$src" "$lineno" "$msg" \
      "Update the §2 context block table to match package.json, or bump package.json to match the declared version. No suppression — fix the source."
  done <<< "$VIOLATION_LINES"
fi

emit_summary "1" "$VIOLATION_COUNT"

exit_code=$(check_expiring_baseline "$GUARD_ID" "$VIOLATION_LINES")
exit "$exit_code"

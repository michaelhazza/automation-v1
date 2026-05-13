#!/usr/bin/env bash
# verify-no-checkpoint-logging.sh — CI gate for § 3.14 item 10 (checkpoint-payload security).
#
# Asserts that no TypeScript file in server/, client/, or shared/ contains a
# logger or console call that references the column name 'checkpoint_payload'.
# Such a call would leak sensitive task artefacts (page URLs, screenshots,
# conversation history) into application logs.
#
# The encryption helper (agentRunPayloadEncryptionService.ts) is explicitly
# allowed because its module docstring documents *what* it encrypts.
# The schema declaration (operatorRuns.ts) is allowed because it merely
# names the column in a schema object.
# Spec, brief, plan, and this gate script are allowed (non-source paths).
#
# Allow-list (paths whose occurrences are always permitted):
#   1. docs/superpowers/specs/2026-05-12-operator-backend-spec.md   — spec doc
#   2. tasks/builds/operator-backend/ (brief, plan, progress)       — plan/brief docs
#   3. server/db/schema/operatorRuns.ts                             — schema declaration
#   4. scripts/gates/verify-no-checkpoint-logging.sh                — this gate itself
#   5. server/services/agentRunPayloadEncryptionService.ts           — encryption helper docstring
#   6. Any path containing __tests__/ or .test.ts                   — test fixtures
#   7. Any path under docs/ or tasks/                               — documentation
#   8. .sh files (gate scripts themselves)                          — .sh: in grep output
#   9. .md files (documentation / runbooks)                         — .md: in grep output
#
# Exit codes (per gate convention):
#   0 — all checks pass
#   1 — one or more violations detected (blocking)
#
# CRLF-safe: grep patterns do not rely on line endings.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

FAIL=0

# Allow-list paths (as ERE patterns for grep -vE on the output lines):
ALLOWLIST_PATTERN="server/db/schema/operatorRuns\.ts|server/services/agentRunPayloadEncryptionService\.ts|scripts/gates/verify-no-checkpoint-logging\.sh|__tests__/|\.test\.ts|^docs/|^tasks/|scripts/__tests__/|\.sh:|\.md:"

# Scan all TypeScript files under server/, client/, shared/.
# Pattern: any logger.* or console.* call that mentions checkpoint_payload on the same line.
# Paths in the grep output are absolute; convert to relative for the allow-list filter.
hits=$(
  grep -rn --include='*.ts' \
    -E '(logger\.[a-z]+|console\.[a-z]+).*checkpoint_payload' \
    "$ROOT_DIR/server/" \
    "$ROOT_DIR/client/" \
    "$ROOT_DIR/shared/" \
    2>/dev/null \
  | sed "s|^$ROOT_DIR/||" \
  | grep -vE "$ALLOWLIST_PATTERN" \
  || true
)

if [ -n "$hits" ]; then
  echo "[FAIL] verify-no-checkpoint-logging: logger/console calls referencing 'checkpoint_payload' found outside the allow-list:"
  echo "$hits" | while IFS= read -r line; do
    echo "  $line"
  done
  echo ""
  echo "checkpoint_payload contents (page URLs, screenshots, conversation history) are"
  echo "sensitive task artefacts and MUST NOT appear in application logs at any log level."
  echo "(§ 3.14 item 10 of the operator-backend spec.)"
  echo ""
  echo "Allowed locations for checkpoint_payload references:"
  echo "  - server/db/schema/operatorRuns.ts (schema column declaration)"
  echo "  - server/services/agentRunPayloadEncryptionService.ts (encryption helper docstring)"
  echo "  - __tests__/ directories or *.test.ts files (test fixtures)"
  echo "  - docs/, tasks/, scripts/__tests__/ (documentation)"
  FAIL=1
fi

if [ $FAIL -eq 0 ]; then
  echo "[PASS] verify-no-checkpoint-logging: no logger/console calls reference 'checkpoint_payload'"
  exit 0
else
  exit 1
fi

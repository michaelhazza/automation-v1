#!/usr/bin/env bash
# verify-protected-block-names.sh
#
# Asserts that the PROTECTED_BLOCK_NAMES guard is correctly wired in both
# handler files that can delete or structurally mutate a memory block:
#
#   1. server/routes/memoryBlocks.ts  — create/patch/delete/detach guards
#   2. server/routes/knowledge.ts     — demote handler guard
#
# Also asserts that both error code constants used by the guards are present
# in the guarded files — catching the failure mode where the guard structure
# exists but the 409 payload uses the wrong constant or omits it entirely.
#
# Exit codes:
#   0 — all checks pass
#   1 — one or more checks fail (blocking gate)
#
# Spec: docs/config-agent-guidelines-spec.md §3.6, §4

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

FAIL=0

check() {
  local description="$1"
  local file="$2"
  local pattern="$3"

  if grep -qE "$pattern" "$ROOT_DIR/$file" 2>/dev/null; then
    echo "  [pass] $description"
  else
    echo "  [FAIL] $description"
    echo "         Expected pattern: $pattern"
    echo "         In file:          $file"
    FAIL=1
  fi
}

echo "--- verify-protected-block-names ---"
echo ""

# ── server/routes/memoryBlocks.ts ────────────────────────────────────────────

echo "memoryBlocks.ts:"

check \
  "imports PROTECTED_BLOCK_NAMES" \
  "server/routes/memoryBlocks.ts" \
  "PROTECTED_BLOCK_NAMES"

check \
  "guards POST create (name reservation)" \
  "server/routes/memoryBlocks.ts" \
  "PROTECTED_BLOCK_NAMES\.has\(name\)"

check \
  "guards DELETE block" \
  "server/routes/memoryBlocks.ts" \
  "PROTECTED_BLOCK_NAMES\.has\(blockName\)"

check \
  "returns PROTECTED_MEMORY_BLOCK error code" \
  "server/routes/memoryBlocks.ts" \
  "'PROTECTED_MEMORY_BLOCK'"

check \
  "returns PROTECTED_MEMORY_BLOCK_ATTACHMENT error code" \
  "server/routes/memoryBlocks.ts" \
  "PROTECTED_MEMORY_BLOCK_ATTACHMENT"

echo ""

# ── server/routes/knowledge.ts ───────────────────────────────────────────────

echo "knowledge.ts (demote handler):"

check \
  "imports PROTECTED_BLOCK_NAMES" \
  "server/routes/knowledge.ts" \
  "PROTECTED_BLOCK_NAMES"

check \
  "demote handler checks protected name before soft-delete" \
  "server/routes/knowledge.ts" \
  "PROTECTED_BLOCK_NAMES\.has\(blockName\)"

check \
  "demote handler returns PROTECTED_MEMORY_BLOCK error code" \
  "server/routes/knowledge.ts" \
  "PROTECTED_MEMORY_BLOCK"

echo ""

# ── server/lib/protectedBlocks.ts (single source of truth) ──────────────────

echo "protectedBlocks.ts (shared allowlist):"

check \
  "exports PROTECTED_BLOCK_NAMES" \
  "server/lib/protectedBlocks.ts" \
  "export const PROTECTED_BLOCK_NAMES"

check \
  "config-agent-guidelines is in the allowlist" \
  "server/lib/protectedBlocks.ts" \
  "config-agent-guidelines"

echo ""

if [ $FAIL -eq 1 ]; then
  echo "[BLOCKING FAIL] One or more protected-block-names checks failed."
  echo "  The guard must be present in both server/routes/memoryBlocks.ts"
  echo "  and the demote handler in server/routes/knowledge.ts, and must"
  echo "  use the shared allowlist from server/lib/protectedBlocks.ts."
  echo "[GATE] protected-block-names: violations=1"
  exit 1
fi

echo "[PASS] All protected-block-names checks passed."
echo "[GATE] protected-block-names: violations=0"
exit 0

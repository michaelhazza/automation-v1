#!/usr/bin/env bash
# verify-no-inline-sandbox-outside-test.sh — CI gate for Spec B sandbox isolation (§8.2.3, §25).
#
# Asserts that inlineSandbox import / construction does not appear outside test files.
#
# inlineSandbox is a test-only provider that runs sandbox tasks in-process with NO
# isolation. Its constructor is hard-guarded to throw outside NODE_ENV=test + the
# SANDBOX_ALLOW_INLINE=1 flag. The CI gate provides a second layer of protection by
# detecting any import or construction of inlineSandbox outside the approved test paths
# at build time, before the runtime guard can even fire.
#
# Approved paths (where inlineSandbox may appear):
#   - Files ending in .test.ts
#   - Files anywhere under a __tests__/ directory
#   - Files anywhere under an e2e/ directory (end-to-end test harnesses)
#
# Exit codes:
#   0 — no violations found
#   1 — one or more violations detected (blocking)
#
# CRLF-safe: grep -r handles mixed line endings transparently.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

FAIL=0

# ── Scan paths ────────────────────────────────────────────────────────────────
SCAN_DIRS=(
  "$ROOT_DIR/server"
  "$ROOT_DIR/shared"
  "$ROOT_DIR/client"
)

# ── Pattern ───────────────────────────────────────────────────────────────────
# Matches any import or construction reference to inlineSandbox.
PATTERN="inlineSandbox"

for dir in "${SCAN_DIRS[@]}"; do
  [ -d "$dir" ] || continue

  # Find all .ts files that reference inlineSandbox, then filter out approved paths.
  # Approved paths:
  #   - Files ending in .test.ts
  #   - Files under __tests__/ or e2e/
  #   - The inlineSandbox.ts implementation file itself
  #   - sandboxProviderResolver.ts — the ONE sanctioned production importer (guarded by
  #     NODE_ENV=test + SANDBOX_ALLOW_INLINE=1 check before constructing InlineSandbox;
  #     this is the resolver seam; no other production file may import inlineSandbox)
  matches=$(
    grep -rn "$PATTERN" "$dir" \
      --include="*.ts" \
      2>/dev/null \
      | grep -v "import type" \
      | grep -v "\.test\.ts:" \
      | grep -v "/__tests__/" \
      | grep -v "/e2e/" \
      | grep -v "/sandbox/inlineSandbox\.ts:" \
      | grep -v "/sandbox/sandboxProviderResolver\.ts:" \
      | grep -vE ":[[:space:]]*\*[[:space:]]" \
      | grep -vE ":[[:space:]]*//.*inlineSandbox" \
      || true
  )

  if [ -n "$matches" ]; then
    echo "[FAIL] inlineSandbox reference found outside approved paths — inlineSandbox is test-only (spec §8.2.3). Only sandboxProviderResolver.ts and test files may reference it. Found:"
    echo "$matches"
    FAIL=1
  fi
done

# ── Result ────────────────────────────────────────────────────────────────────

if [ $FAIL -eq 0 ]; then
  echo "[PASS] verify-no-inline-sandbox-outside-test: no inlineSandbox references found outside test paths"
  exit 0
else
  exit 1
fi

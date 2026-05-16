#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-handler-registry-fixture.sh
#
# Wave-4 MC7 — handler registry bidirectional set-equality gate.
#
# Asserts three-way set equality:
#   JOB_CONFIG (server/config/jobConfig.ts) ≡ HANDLER_REGISTRY
#   (server/lib/__tests__/handlerRegistryFixture.ts) ≡ handler-registry-inventory.md
#   (tasks/builds/wave-4-audit-absorber/handler-registry-inventory.md)
#
# Also enforces per-verdict required fields from spec §6.1:
#   handler_tested: comparesTables must be non-empty
#   external_consumer: consumer + idempotencyOwner required
#   send_only:   tracking + addedAt + lifecycleState required
#               transitional: reviewBy required
#               permanent: consumer required
#               experimental >90d: warning (exit 2)
#               transitional past reviewBy: error (exit 1)
#               permanent: passes
#   exempt: reason + owner + reviewBy required
#
# Exit codes:
#   0 — all checks pass
#   1 — blocking failure (missing entries, missing required fields, or
#       send_only transitional past reviewBy)
#   2 — warning only (experimental >90d, baseline violations)
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="handler-registry-fixture"
GUARD_NAME="Handler registry fixture bidirectional set-equality (MC7)"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
WARNINGS=0
FILES_SCANNED=0

emit_header "$GUARD_NAME"

CONFIG_FILE="$ROOT_DIR/server/config/jobConfig.ts"
FIXTURE_FILE="$ROOT_DIR/server/lib/__tests__/handlerRegistryFixture.ts"
INVENTORY_FILE="$ROOT_DIR/tasks/builds/wave-4-audit-absorber/handler-registry-inventory.md"

# ── File existence checks ─────────────────────────────────────────────────────

for f in "$CONFIG_FILE" "$FIXTURE_FILE" "$INVENTORY_FILE"; do
  if [ ! -f "$f" ]; then
    echo "[GUARD] $GUARD_NAME: required file not found: $f"
    emit_summary 0 1
    exit 1
  fi
done

FILES_SCANNED=3

# ── Extract JOB_CONFIG keys ───────────────────────────────────────────────────
# Match lines like: `  'agent-scheduled-run': {`
# inside the `export const JOB_CONFIG = {` block.

mapfile -t JOB_CONFIG_KEYS < <(awk "
  /^export const JOB_CONFIG/ { inside=1; next }
  inside && /^} as const;/ { inside=0 }
  inside && /^  '[a-z:._][a-zA-Z0-9:._-]*': \{/ {
    match(\$0, /'[a-z:._][a-zA-Z0-9:._-]*'/)
    key = substr(\$0, RSTART+1, RLENGTH-2)
    print key
  }
" "$CONFIG_FILE" | sort)

# ── Extract HANDLER_REGISTRY keys ────────────────────────────────────────────
# Match lines like: `  'agent-scheduled-run': {`
# inside the `export const HANDLER_REGISTRY:` block.

mapfile -t REGISTRY_KEYS < <(awk "
  /export const HANDLER_REGISTRY/ { inside=1; next }
  inside && /^} satisfies/ { inside=0 }
  inside && /^  '[a-z:._][a-zA-Z0-9:._-]*': \{/ {
    match(\$0, /'[a-z:._][a-zA-Z0-9:._-]*'/)
    key = substr(\$0, RSTART+1, RLENGTH-2)
    print key
  }
" "$FIXTURE_FILE" | sort)

# ── Extract inventory keys ────────────────────────────────────────────────────
# Match backtick-quoted queue names in the inventory markdown tables.
# Rows look like: | `agent-scheduled-run` | ...

mapfile -t INVENTORY_KEYS < <(grep -oE '\`[a-z:._][a-zA-Z0-9:._-]*\`' "$INVENTORY_FILE" \
  | tr -d '`' \
  | grep -v "^verdict$\|^handler$\|^external$\|^send_only$\|^exempt$\|^MISSING" \
  | sort \
  | uniq)

JOB_COUNT=${#JOB_CONFIG_KEYS[@]}
REGISTRY_COUNT=${#REGISTRY_KEYS[@]}

echo "  JOB_CONFIG entries:     $JOB_COUNT"
echo "  HANDLER_REGISTRY keys:  $REGISTRY_COUNT"
echo "  Inventory keys:         ${#INVENTORY_KEYS[@]}"

# ── Bidirectional check: JOB_CONFIG ≡ HANDLER_REGISTRY ───────────────────────

echo ""
echo "  JOB_CONFIG vs HANDLER_REGISTRY:"

MISSING_FROM_REGISTRY=()
for key in "${JOB_CONFIG_KEYS[@]}"; do
  found=0
  for rkey in "${REGISTRY_KEYS[@]}"; do
    if [ "$rkey" = "$key" ]; then
      found=1
      break
    fi
  done
  if [ "$found" -eq 0 ]; then
    MISSING_FROM_REGISTRY+=("$key")
  fi
done

MISSING_FROM_CONFIG=()
for key in "${REGISTRY_KEYS[@]}"; do
  found=0
  for ckey in "${JOB_CONFIG_KEYS[@]}"; do
    if [ "$ckey" = "$key" ]; then
      found=1
      break
    fi
  done
  if [ "$found" -eq 0 ]; then
    MISSING_FROM_CONFIG+=("$key")
  fi
done

if [ ${#MISSING_FROM_REGISTRY[@]} -gt 0 ]; then
  echo "  [FAIL] JOB_CONFIG keys absent from HANDLER_REGISTRY:"
  for k in "${MISSING_FROM_REGISTRY[@]}"; do
    echo "         - $k"
  done
  VIOLATIONS=$((VIOLATIONS + ${#MISSING_FROM_REGISTRY[@]}))
else
  echo "  [OK]   All JOB_CONFIG keys present in HANDLER_REGISTRY"
fi

if [ ${#MISSING_FROM_CONFIG[@]} -gt 0 ]; then
  echo "  [FAIL] HANDLER_REGISTRY keys absent from JOB_CONFIG:"
  for k in "${MISSING_FROM_CONFIG[@]}"; do
    echo "         - $k"
  done
  VIOLATIONS=$((VIOLATIONS + ${#MISSING_FROM_CONFIG[@]}))
else
  echo "  [OK]   All HANDLER_REGISTRY keys present in JOB_CONFIG"
fi

# ── Per-verdict required field checks ────────────────────────────────────────
# Parse idempotencyContract fields from JOB_CONFIG.

echo ""
echo "  Per-verdict required field checks:"

TODAY_EPOCH=$(node -e "process.stdout.write(String(Math.floor(Date.now()/86400000)))")

FIELD_VIOLATIONS=0
FIELD_WARNINGS=0

# We extract verdict + required fields per entry using node for reliable parsing.
# The Node logic lives in scripts/lib/check-handler-registry-verdicts.mjs so the
# CONFIG_FILE path is passed as a normal argv (no Windows-path expansion through
# a bash heredoc, W4AA-DEBT-19) and stderr capture is unambiguous (W4AA-DEBT-18).
VERDICT_STDERR="$(mktemp -t verdict-stderr.XXXXXX)"
# Capture the Node script's exit code without letting `set -e` abort the gate
# before the warning-propagation logic runs. Pr-reviewer 2026-05-16 blocker:
# bare `node ... ; rc=$?` under `set -e` short-circuits on non-zero exit, which
# would silently defeat the WARNINGS counter (W4AA-DEBT-18).
VERDICT_RESULT=0
node "$SCRIPT_DIR/lib/check-handler-registry-verdicts.mjs" "$CONFIG_FILE" 2> "$VERDICT_STDERR" || VERDICT_RESULT=$?

# Surface any errors or warnings the Node block printed to stderr.
if [ -s "$VERDICT_STDERR" ]; then
  cat "$VERDICT_STDERR"
fi

if [ "$VERDICT_RESULT" -ne 0 ]; then
  echo "  [FAIL] Per-verdict field check script exited with code $VERDICT_RESULT"
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# Propagate VERDICT_WARNINGS from the Node stderr into the shell WARNINGS counter
# (W4AA-DEBT-18). The .mjs emits one VERDICT_WARNINGS:... line per warning, so a
# raw line-count is the authoritative figure — robust against any delimiter
# characters that might appear in warning text.
#
# grep -c always prints its count to stdout (including 0) and exits non-zero
# when no matches are found. The earlier `|| echo 0` fallback then concatenated
# grep's "0" with echo's "0", producing a multi-line value that broke the
# subsequent `[ "$VAL" -gt 0 ]` integer test with "integer expression expected"
# and silently skipped the warning-propagation branch. Use `|| true` instead so
# the variable captures grep's count verbatim. (ChatGPT PR review F2,
# 2026-05-16.)
if [ -s "$VERDICT_STDERR" ]; then
  VERDICT_WARN_COUNT="$(grep -c '^VERDICT_WARNINGS:' "$VERDICT_STDERR" 2>/dev/null || true)"
  VERDICT_WARN_COUNT="${VERDICT_WARN_COUNT:-0}"
  if [ "$VERDICT_WARN_COUNT" -gt 0 ]; then
    WARNINGS=$((WARNINGS + VERDICT_WARN_COUNT))
  fi
fi

rm -f "$VERDICT_STDERR"

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

if [ "$WARNINGS" -gt 0 ] && [ "$VIOLATIONS" -eq 0 ]; then
  exit_code=$(check_baseline "$GUARD_ID" "$WARNINGS" 2)
  exit "$exit_code"
fi

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"

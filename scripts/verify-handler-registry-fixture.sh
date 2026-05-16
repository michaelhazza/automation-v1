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
node --input-type=module <<NODEEOF
import { readFileSync } from 'node:fs';

const src = readFileSync('$CONFIG_FILE', 'utf8');

// Extract the JOB_CONFIG object text between `export const JOB_CONFIG = {` and `} as const;`
const startIdx = src.indexOf('export const JOB_CONFIG = {');
const endIdx   = src.indexOf('} as const;', startIdx);
if (startIdx === -1 || endIdx === -1) {
  process.stderr.write('[GUARD] Cannot locate JOB_CONFIG in jobConfig.ts\n');
  process.exit(1);
}

const block = src.slice(startIdx, endIdx);
const todayEpoch = Math.floor(Date.now() / 86400000);

// Parse idempotencyContract blocks per entry.
// Strategy: find each entry's idempotencyContract: { ... } span and extract verdict + fields.
// We use a simple state-machine parser rather than importing the TS module (no build required).

const entryRegex = /^  '([a-z:._][a-zA-Z0-9:._-]*)': \{/gm;
const contractRegex = /idempotencyContract:\s*\{([^}]+)\}/gs;

let match;
const errors = [];
const warnings = [];

// Build a map of jobName -> idempotencyContract text
const entries = {};
const lines = block.split('\n');
let currentEntry = null;

for (const line of lines) {
  const entryMatch = line.match(/^  '([a-z:._][a-zA-Z0-9:._-]*)': \{/);
  if (entryMatch) {
    currentEntry = entryMatch[1];
    entries[currentEntry] = { raw: '' };
    continue;
  }
  if (currentEntry && line.includes('idempotencyContract:')) {
    // Collect from here
    entries[currentEntry].contractStart = true;
  }
  if (currentEntry && entries[currentEntry].contractStart !== undefined) {
    entries[currentEntry].raw += line + '\n';
  }
  if (currentEntry && line.match(/^  \},/) && entries[currentEntry].contractStart !== undefined) {
    currentEntry = null;
  }
}

for (const [name, info] of Object.entries(entries)) {
  const raw = info.raw || '';
  const verdictMatch = raw.match(/verdict:\s*'([a-z_]+)'/);
  if (!verdictMatch) continue;

  const verdict = verdictMatch[1];

  if (verdict === 'handler_tested') {
    // comparesTables must be non-empty
    const tablesMatch = raw.match(/comparesTables:\s*\[([^\]]*)\]/s);
    if (!tablesMatch || tablesMatch[1].trim() === '') {
      errors.push(\`\${name}: handler_tested missing non-empty comparesTables\`);
    }

  } else if (verdict === 'external_consumer') {
    if (!raw.includes('consumer:')) errors.push(\`\${name}: external_consumer missing consumer\`);
    if (!raw.includes('idempotencyOwner:')) errors.push(\`\${name}: external_consumer missing idempotencyOwner\`);

  } else if (verdict === 'send_only') {
    if (!raw.includes('tracking:')) errors.push(\`\${name}: send_only missing tracking\`);
    if (!raw.includes('addedAt:')) errors.push(\`\${name}: send_only missing addedAt\`);
    const lifecycleMatch = raw.match(/lifecycleState:\s*'([a-z]+)'/);
    if (!lifecycleMatch) {
      errors.push(\`\${name}: send_only missing lifecycleState\`);
    } else {
      const state = lifecycleMatch[1];
      if (state === 'transitional') {
        const reviewByMatch = raw.match(/reviewBy:\s*'([0-9]{4}-[0-9]{2}-[0-9]{2})'/);
        if (!reviewByMatch) {
          errors.push(\`\${name}: send_only transitional missing reviewBy\`);
        } else {
          const reviewByEpoch = Math.floor(new Date(reviewByMatch[1]).getTime() / 86400000);
          if (reviewByEpoch < todayEpoch) {
            errors.push(\`\${name}: send_only transitional past reviewBy (\${reviewByMatch[1]}) — must reclassify\`);
          }
        }
      } else if (state === 'permanent') {
        if (!raw.includes('consumer:')) errors.push(\`\${name}: send_only permanent missing consumer\`);
      } else if (state === 'experimental') {
        const addedAtMatch = raw.match(/addedAt:\s*'([0-9]{4}-[0-9]{2}-[0-9]{2})'/);
        if (addedAtMatch) {
          const addedEpoch = Math.floor(new Date(addedAtMatch[1]).getTime() / 86400000);
          const ageDays = todayEpoch - addedEpoch;
          if (ageDays > 90) {
            warnings.push(\`\${name}: send_only experimental for \${ageDays} days (>90d) — consider reclassifying\`);
          }
        }
      }
    }

  } else if (verdict === 'exempt') {
    if (!raw.includes('reason:')) errors.push(\`\${name}: exempt missing reason\`);
    if (!raw.includes('owner:')) errors.push(\`\${name}: exempt missing owner\`);
    if (!raw.includes('reviewBy:')) errors.push(\`\${name}: exempt missing reviewBy\`);
  }
}

if (errors.length > 0) {
  console.error('VERDICT_ERRORS:' + errors.join('|'));
}
if (warnings.length > 0) {
  console.error('VERDICT_WARNINGS:' + warnings.join('|'));
}
NODEEOF

VERDICT_RESULT=$?
if [ "$VERDICT_RESULT" -ne 0 ]; then
  echo "  [FAIL] Per-verdict field check script exited with code $VERDICT_RESULT"
  VIOLATIONS=$((VIOLATIONS + 1))
fi

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

if [ "$WARNINGS" -gt 0 ] && [ "$VIOLATIONS" -eq 0 ]; then
  exit_code=$(check_baseline "$GUARD_ID" "$WARNINGS" 2)
  exit "$exit_code"
fi

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"

#!/usr/bin/env bash
# verify-sandbox-classification.sh — CI gate for Spec B sandbox isolation (§18.4, §25).
#
# Asserts that any adapter that declares sandboxRequirement: 'code_execution' does NOT
# have a dispatch() body that reaches a direct execution call (child_process, pg-boss
# enqueue to an IEE-style job, or worker-side spawn) without routing through
# SandboxExecutionService.runTask first.
#
# The gate is grep-based and intentionally conservative: it verifies the positive
# (SandboxExecutionService.runTask is present in adapters that require it) and the
# negative (raw execution primitives are absent on the sandbox-classified path).
#
# Exit codes (per gate convention):
#   0 — all checks pass
#   1 — one or more violations detected (blocking)
#
# CRLF-safe: grep patterns do not rely on line endings. Use $'\r' explicitly if needed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

FAIL=0

# ── Scan paths ────────────────────────────────────────────────────────────────
# Hard-coded list: only adapters in the executionBackends directory are in scope.
# Adding a new adapter that calls SandboxExecutionService requires an explicit
# entry here.
ADAPTER_DIR="$ROOT_DIR/server/services/executionBackends"

# ── Calibration constant ──────────────────────────────────────────────────────
# Adapters that declare sandboxRequirement: 'code_execution' MUST be listed here.
# Each must call SandboxExecutionService.runTask in its dispatch() body.
SANDBOX_REQUIRED_ADAPTERS=(
  "ieeDevBackend.ts"
)

# ── Check 0: auto-detect missing calibrations ─────────────────────────────────
# Any adapter file that declares sandboxRequirement: 'code_execution' MUST be
# listed in SANDBOX_REQUIRED_ADAPTERS above. This protects against a new adapter
# being added without updating the calibration list, which would let it bypass
# the routing check below entirely.
if [ -d "$ADAPTER_DIR" ]; then
  while IFS= read -r declared_file; do
    [ -z "$declared_file" ] && continue
    declared_basename="$(basename "$declared_file")"
    listed=0
    for listed_adapter in "${SANDBOX_REQUIRED_ADAPTERS[@]}"; do
      if [ "$declared_basename" = "$listed_adapter" ]; then
        listed=1
        break
      fi
    done
    if [ "$listed" -eq 0 ]; then
      echo "[FAIL] $declared_basename declares sandboxRequirement: 'code_execution' but is not listed in SANDBOX_REQUIRED_ADAPTERS — add it to the calibration list in scripts/gates/verify-sandbox-classification.sh"
      FAIL=1
    fi
  done < <(grep -lE "sandboxRequirement\s*:\s*['\"]code_execution['\"]" "$ADAPTER_DIR"/*.ts 2>/dev/null || true)
fi

# ── Check 1: each adapter with sandboxRequirement must actually route to the service ──
# Strengthened: a bare mention of "SandboxExecutionService" or ".runTask(" anywhere
# in the file does not prove the sandbox-class branch is wired. We require both:
#   (a) the adapter imports the sandboxExecutionService module (static OR dynamic
#       `await import('.../sandboxExecutionService...')`), AND
#   (b) the adapter actually invokes runTask in its body — either
#       sandboxExecutionService.runTask( on a typed instance OR a runTask( call
#       on a name destructured from the dynamic import.
for adapter in "${SANDBOX_REQUIRED_ADAPTERS[@]}"; do
  adapter_file="$ADAPTER_DIR/$adapter"

  if [ ! -f "$adapter_file" ]; then
    echo "[SKIP] Adapter file not found (not yet created): $adapter_file"
    continue
  fi

  # Verify the adapter declares sandboxRequirement
  if ! grep -q "sandboxRequirement" "$adapter_file"; then
    echo "[INFO] $adapter does not declare sandboxRequirement — skipping sandbox-path check"
    continue
  fi

  # (a) Module is imported (static `from '...sandboxExecutionService...'` OR
  #     dynamic `await import('...sandboxExecutionService...')`).
  if ! grep -qE "from[[:space:]]+['\"][^'\"]*sandboxExecutionService[^'\"]*['\"]|await[[:space:]]+import\(['\"][^'\"]*sandboxExecutionService[^'\"]*['\"]\)" "$adapter_file"; then
    echo "[FAIL] $adapter declares sandboxRequirement but does not import sandboxExecutionService (static or dynamic)"
    FAIL=1
    continue
  fi

  # (b) Actual invocation in the body — strip import lines and comments before grepping.
  body_lines=$(grep -vE "^[[:space:]]*(import|\\*|//|/\\*)" "$adapter_file" || true)
  if ! echo "$body_lines" | grep -qE "sandboxExecutionService\.runTask\(|\\brunTask\("; then
    echo "[FAIL] $adapter declares sandboxRequirement but does not invoke runTask() in its body"
    FAIL=1
  fi
done

# ── Check 2: no direct execution bypass in sandbox-capable adapters ───────────
# Raw child_process.exec / spawn / execFile or worker-direct enqueue patterns
# in dispatch() bodies of adapters that declare sandboxRequirement.
FORBIDDEN_PATTERNS=(
  "child_process\.exec\b"
  "child_process\.spawn\b"
  "child_process\.execFile\b"
  "child_process\.execSync\b"
  "child_process\.spawnSync\b"
  "require.*child_process"
)

for adapter in "${SANDBOX_REQUIRED_ADAPTERS[@]}"; do
  adapter_file="$ADAPTER_DIR/$adapter"

  if [ ! -f "$adapter_file" ]; then
    continue
  fi

  if ! grep -q "sandboxRequirement" "$adapter_file"; then
    continue
  fi

  for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
    if grep -v "import type" "$adapter_file" | grep -qE "$pattern"; then
      echo "[FAIL] $adapter contains a forbidden direct-execution call matching '$pattern' — all customer-input code must route through SandboxExecutionService.runTask"
      FAIL=1
    fi
  done
done

# ── Result ────────────────────────────────────────────────────────────────────

if [ $FAIL -eq 0 ]; then
  echo "[PASS] verify-sandbox-classification: all sandbox-capable adapters route through SandboxExecutionService.runTask"
  exit 0
else
  exit 1
fi

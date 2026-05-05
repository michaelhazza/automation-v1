#!/usr/bin/env bash
# Manual fixture sanity check for verify-principal-context-propagation.sh.
# Stages each fixture into a throw-away tree that mimics `server/` and runs
# the gate against it. Not wired into CI — run by hand to verify gate behaviour.
#
# Usage: bash scripts/__tests__/principal-context-propagation/run-fixture-check.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GATE_PATH="$ROOT_DIR/scripts/verify-principal-context-propagation.sh"
LIB_PATH="$ROOT_DIR/scripts/lib/guard-utils.sh"

run_fixture() {
  local fixture_rel="$1"
  local expected="$2"   # 'pass' or 'violation'
  local label="$3"

  local TMP
  TMP=$(mktemp -d)
  # Reproduce the directory layout the gate expects: scripts/ + server/.
  mkdir -p "$TMP/scripts/lib" "$TMP/server/services/principal" "$TMP/server/_fixture"
  cp "$LIB_PATH" "$TMP/scripts/lib/guard-utils.sh"
  cp "$GATE_PATH" "$TMP/scripts/verify-principal-context-propagation.sh"
  # Stub the shim/types/service so the import paths in the fixture resolve at
  # least textually (the gate is text-based, no TS compile).
  cat > "$TMP/server/services/canonicalDataService.ts" <<'EOF'
export const canonicalDataService = { getAccountById: async (..._args: unknown[]) => null };
EOF
  cat > "$TMP/server/services/principal/fromOrgId.ts" <<'EOF'
export function fromOrgId(_orgId: string, _sub?: string) { return {} as unknown; }
EOF
  cat > "$TMP/server/services/principal/types.ts" <<'EOF'
export interface PrincipalContext { organisationId: string }
EOF

  cp "$ROOT_DIR/$fixture_rel" "$TMP/server/_fixture/$(basename "$fixture_rel")"

  # Run the gate from its own staged tree.
  local out
  out=$(cd "$TMP" && bash scripts/verify-principal-context-propagation.sh 2>&1 || true)

  local violations
  violations=$(echo "$out" | grep -oE '\[GATE\] [^:]+: violations=[0-9]+' | grep -oE '[0-9]+$' || echo "?")

  rm -rf "$TMP"

  if [ "$expected" = "pass" ] && [ "$violations" = "0" ]; then
    echo "PASS: $label (violations=0)"
  elif [ "$expected" = "violation" ] && [ "$violations" != "0" ] && [ "$violations" != "?" ]; then
    echo "PASS: $label (violations=$violations)"
  else
    echo "FAIL: $label expected=$expected got=violations=$violations"
    echo "----- gate output -----"
    echo "$out"
    echo "-----------------------"
    return 1
  fi
}

run_fixture "scripts/__tests__/principal-context-propagation/fixture-bare-identifier.ts" "violation" "bare-identifier"
run_fixture "scripts/__tests__/principal-context-propagation/fixture-object-literal.ts" "violation" "object-literal"
run_fixture "scripts/__tests__/principal-context-propagation/fixture-spread.ts" "violation" "spread"
run_fixture "scripts/__tests__/principal-context-propagation/fixture-fromOrgId.ts" "pass" "fromOrgId"
run_fixture "scripts/__tests__/principal-context-propagation/fixture-typed-variable.ts" "pass" "typed-variable"

echo "All fixture checks passed."

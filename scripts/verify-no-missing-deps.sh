#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-no-missing-deps.sh  (P1)
#
# Invariant: every package imported anywhere in the codebase must be declared
# in package.json (dependencies, devDependencies, or optionalDependencies).
#
# Tool: npx depcheck --json
# Suppression: declare the package in optionalDependencies (the established
#   pattern for dynamic-only imports — docx and mammoth set the precedent).
#   No per-line guard-ignore for this gate: depcheck reports package names,
#   not import-line locations, so there is no implementable per-line anchor.
#
# Baseline: scripts/.gate-baselines/no-missing-deps.txt
#   Format: one package name per entry, key shape <package-name>:0:<reason>
#   Suppression path: optionalDependencies declaration is strongly preferred
#   over baselining — baseline should remain empty.
#
# Exit codes: 0=pass, 1=new violations above baseline, 2=within baseline
# Warning-first rollout promoted to error 2026-05-15 (post-7-day soak from PR #307); exit-1 path was already in place via check_expiring_baseline.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="no-missing-deps"
GUARD_NAME="Missing Package Dependencies (P1)"
BASELINE_FILE="${ROOT_DIR}/scripts/.gate-baselines/no-missing-deps.txt"

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

# ── Run depcheck ──────────────────────────────────────────────────────────────
DEPCHECK_JSON=$(
  cd "$ROOT_DIR" && npx depcheck --skip-missing=false --json 2>/dev/null || true
)

if [ -z "$DEPCHECK_JSON" ]; then
  echo "[GATE] ${GUARD_ID}: depcheck produced no output — check that depcheck is installed" >&2
  exit 1
fi

# Extract missing packages (packages imported but not declared in package.json)
MISSING_PACKAGES=$(
  echo "$DEPCHECK_JSON" | jq -r '.missing | keys[]' 2>/dev/null || true
)

# ── Build violation list ──────────────────────────────────────────────────────
VIOLATIONS=0
VIOLATION_KEYS=""
FILES_SCANNED=1  # depcheck scans the whole project as a unit

while IFS= read -r pkg; do
  [ -z "$pkg" ] && continue
  # Violation key shape: <package-name>:0:<reason>
  key="${pkg}:0:imported but not declared in package.json"
  VIOLATION_KEYS="${VIOLATION_KEYS}${key}"$'\n'
  VIOLATIONS=$((VIOLATIONS + 1))
done <<< "$MISSING_PACKAGES"

# Remove trailing newline
VIOLATION_KEYS="${VIOLATION_KEYS%$'\n'}"

# ── Baseline check ────────────────────────────────────────────────────────────
BASELINE_EXIT=$(check_expiring_baseline "$GUARD_ID" "$VIOLATION_KEYS")

if [ "$VIOLATIONS" -gt 0 ]; then
  # Emit individual violations
  while IFS= read -r pkg; do
    [ -z "$pkg" ] && continue
    emit_violation "$GUARD_ID" "error" "$pkg" "0" \
      "Package '${pkg}' is imported but not declared in package.json" \
      "Declare in dependencies, devDependencies, or optionalDependencies (use optionalDependencies for dynamic-only imports)"
  done <<< "$MISSING_PACKAGES"
fi

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

if [ "$BASELINE_EXIT" = "1" ]; then
  exit 1
elif [ "$BASELINE_EXIT" = "2" ] || [ "$VIOLATIONS" -gt 0 ]; then
  exit 2
fi
exit 0

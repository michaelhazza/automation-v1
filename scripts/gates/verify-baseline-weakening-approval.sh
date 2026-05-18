#!/usr/bin/env bash
# verify-baseline-weakening-approval.sh
#
# Detects two baseline-weakening violation classes (spec §5.1 gate row, chunk 2):
#
#   (a) tolerance INCREASED or score DECREASED on an existing baseline file
#   (b) per-site mode field downgraded along: blocking > nightly > advisory > disabled
#
# Both classes require a Baseline-Weakening-Approved-By: <handle> trailer in any
# branch commit message (git log origin/main..HEAD --format=%B).
#
# Exit codes:
#   0 — no violations, or violations are approved by an allowlisted reviewer
#   1 — violation found without valid approval
#   2 — environment error (git history unavailable, detached HEAD, etc.)
#
# CI requirement: actions/checkout MUST use fetch-depth: 0 so that
# git log origin/main..HEAD has the full branch commit history available.
#
# V1 allowlist (expand by editing the ALLOWLIST array below).
# Adding a reviewer is a one-line edit; it is not itself a baseline-weakening
# event and does not require its own Baseline-Weakening-Approved-By trailer.

set -euo pipefail

# ---------------------------------------------------------------------------
# Allowlist
# ---------------------------------------------------------------------------

ALLOWLIST=("@michaelhazza" "michaelhazza")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BASELINES_DIR="$ROOT_DIR/server/tests/browser-detection-harness/baselines"
SITES_DIR="$ROOT_DIR/server/tests/browser-detection-harness/sites"

# ---------------------------------------------------------------------------
# Mode ordering (higher index = stronger mode)
# ---------------------------------------------------------------------------

mode_rank() {
  case "$1" in
    blocking) echo 3 ;;
    nightly)  echo 2 ;;
    advisory) echo 1 ;;
    disabled) echo 0 ;;
    *)        echo -1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Allowlist check
# ---------------------------------------------------------------------------

check_allowlist() {
  local handle="$1"
  for allowed in "${ALLOWLIST[@]}"; do
    if [[ "$handle" == "$allowed" ]]; then
      return 0
    fi
  done
  return 1
}

# ---------------------------------------------------------------------------
# Trailer scan: walk all branch commits vs origin/main
# ---------------------------------------------------------------------------

TRAILER_REGEX='^Baseline-Weakening-Approved-By:[[:space:]]+(@?[A-Za-z0-9-]+)[[:space:]]*$'
APPROVED_HANDLE=""

scan_trailer() {
  local commit_messages
  if ! commit_messages=$(git log origin/main..HEAD --format=%B 2>/dev/null); then
    echo "ERROR: Cannot walk git history. Ensure fetch-depth: 0 in actions/checkout." >&2
    exit 2
  fi

  while IFS= read -r line; do
    if [[ "$line" =~ $TRAILER_REGEX ]]; then
      APPROVED_HANDLE="${BASH_REMATCH[1]}"
      break
    fi
  done <<< "$commit_messages"
}

# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

run_self_tests() {
  local pass=0
  local fail=0
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT

  # Helper: assert exit code
  assert_exit() {
    local desc="$1"
    local expected="$2"
    local actual="$3"
    if [[ "$actual" -eq "$expected" ]]; then
      echo "[PASS] case: $desc"
      ((pass++)) || true
    else
      echo "[FAIL] case: $desc — expected exit $expected, got $actual"
      ((fail++)) || true
    fi
  }

  # Set up a temporary git repo for testing git-based cases
  local repo="$tmpdir/repo"
  mkdir -p "$repo"
  git -C "$repo" init -b main >/dev/null 2>&1 || git -C "$repo" init >/dev/null 2>&1
  git -C "$repo" config user.email "test@test.com" >/dev/null 2>&1
  git -C "$repo" config user.name "Test" >/dev/null 2>&1

  # Create directory structure
  mkdir -p "$repo/server/tests/browser-detection-harness/baselines"
  mkdir -p "$repo/server/tests/browser-detection-harness/sites"

  # Initial commit on main
  echo '{"score":0.85,"tolerance":0.10}' > "$repo/server/tests/browser-detection-harness/baselines/site1.baseline.json"
  printf 'export default { slug: "site1", mode: "blocking" as const, test: async () => 0 };\n' > "$repo/server/tests/browser-detection-harness/sites/site1.test.ts"
  git -C "$repo" add -A >/dev/null 2>&1
  git -C "$repo" commit -m "initial" >/dev/null 2>&1

  # Case (i): tolerance widening WITHOUT trailer → exit 1
  git -C "$repo" checkout -b case-i >/dev/null 2>&1
  echo '{"score":0.85,"tolerance":0.20}' > "$repo/server/tests/browser-detection-harness/baselines/site1.baseline.json"
  git -C "$repo" add -A >/dev/null 2>&1
  git -C "$repo" commit -m "widen tolerance" >/dev/null 2>&1
  result=0
  (cd "$repo" && git remote add origin . >/dev/null 2>&1 || true
   git fetch origin main >/dev/null 2>&1 || true
   BASELINES_DIR="$repo/server/tests/browser-detection-harness/baselines" \
   SITES_DIR="$repo/server/tests/browser-detection-harness/sites" \
   bash "$SCRIPT_DIR/verify-baseline-weakening-approval.sh" --check-only) || result=$?
  assert_exit "(i) tolerance widening without trailer" 1 $result

  # Case (ii): tolerance widening WITH valid trailer → exit 0
  git -C "$repo" commit --allow-empty -m "$(printf 'fix: update\n\nBaseline-Weakening-Approved-By: @michaelhazza')" >/dev/null 2>&1
  result=0
  (cd "$repo" && \
   BASELINES_DIR="$repo/server/tests/browser-detection-harness/baselines" \
   SITES_DIR="$repo/server/tests/browser-detection-harness/sites" \
   bash "$SCRIPT_DIR/verify-baseline-weakening-approval.sh" --check-only) || result=$?
  assert_exit "(ii) tolerance widening with valid trailer" 0 $result

  # Case (iii): mode downgrade blocking→nightly WITHOUT trailer → exit 1
  git -C "$repo" checkout main >/dev/null 2>&1
  git -C "$repo" checkout -b case-iii >/dev/null 2>&1
  printf 'export default { slug: "site1", mode: "nightly" as const, test: async () => 0 };\n' > "$repo/server/tests/browser-detection-harness/sites/site1.test.ts"
  git -C "$repo" add -A >/dev/null 2>&1
  git -C "$repo" commit -m "downgrade mode" >/dev/null 2>&1
  result=0
  (cd "$repo" && \
   BASELINES_DIR="$repo/server/tests/browser-detection-harness/baselines" \
   SITES_DIR="$repo/server/tests/browser-detection-harness/sites" \
   bash "$SCRIPT_DIR/verify-baseline-weakening-approval.sh" --check-only) || result=$?
  assert_exit "(iii) mode downgrade without trailer" 1 $result

  # Case (iv): new baseline file creation → exit 0 (establishment is not weakening)
  git -C "$repo" checkout main >/dev/null 2>&1
  git -C "$repo" checkout -b case-iv >/dev/null 2>&1
  echo '{"score":0.90,"tolerance":0.10}' > "$repo/server/tests/browser-detection-harness/baselines/new-site.baseline.json"
  git -C "$repo" add -A >/dev/null 2>&1
  git -C "$repo" commit -m "add new site baseline" >/dev/null 2>&1
  result=0
  (cd "$repo" && \
   BASELINES_DIR="$repo/server/tests/browser-detection-harness/baselines" \
   SITES_DIR="$repo/server/tests/browser-detection-harness/sites" \
   bash "$SCRIPT_DIR/verify-baseline-weakening-approval.sh" --check-only) || result=$?
  assert_exit "(iv) new baseline establishment" 0 $result

  # Case (v): tolerance TIGHTENING (decrease) → exit 0
  git -C "$repo" checkout main >/dev/null 2>&1
  git -C "$repo" checkout -b case-v >/dev/null 2>&1
  echo '{"score":0.85,"tolerance":0.05}' > "$repo/server/tests/browser-detection-harness/baselines/site1.baseline.json"
  git -C "$repo" add -A >/dev/null 2>&1
  git -C "$repo" commit -m "tighten tolerance" >/dev/null 2>&1
  result=0
  (cd "$repo" && \
   BASELINES_DIR="$repo/server/tests/browser-detection-harness/baselines" \
   SITES_DIR="$repo/server/tests/browser-detection-harness/sites" \
   bash "$SCRIPT_DIR/verify-baseline-weakening-approval.sh" --check-only) || result=$?
  assert_exit "(v) tolerance tightening" 0 $result

  # Case (vi): mode UPGRADE advisory→blocking → exit 0
  git -C "$repo" checkout main >/dev/null 2>&1
  printf 'export default { slug: "site2", mode: "advisory" as const, test: async () => 0 };\n' > "$repo/server/tests/browser-detection-harness/sites/site2.test.ts"
  git -C "$repo" add -A >/dev/null 2>&1
  git -C "$repo" commit -m "add advisory site" >/dev/null 2>&1
  git -C "$repo" checkout -b case-vi >/dev/null 2>&1
  printf 'export default { slug: "site2", mode: "blocking" as const, test: async () => 0 };\n' > "$repo/server/tests/browser-detection-harness/sites/site2.test.ts"
  git -C "$repo" add -A >/dev/null 2>&1
  git -C "$repo" commit -m "upgrade mode advisory→blocking" >/dev/null 2>&1
  result=0
  (cd "$repo" && \
   BASELINES_DIR="$repo/server/tests/browser-detection-harness/baselines" \
   SITES_DIR="$repo/server/tests/browser-detection-harness/sites" \
   bash "$SCRIPT_DIR/verify-baseline-weakening-approval.sh" --check-only) || result=$?
  assert_exit "(vi) mode upgrade" 0 $result

  # Case (vii): tolerance widening WITH trailer but handle not in allowlist → exit 1
  git -C "$repo" checkout main >/dev/null 2>&1
  git -C "$repo" checkout -b case-vii >/dev/null 2>&1
  echo '{"score":0.85,"tolerance":0.25}' > "$repo/server/tests/browser-detection-harness/baselines/site1.baseline.json"
  git -C "$repo" add -A >/dev/null 2>&1
  git -C "$repo" commit -m "$(printf 'widen\n\nBaseline-Weakening-Approved-By: @some-other-user')" >/dev/null 2>&1
  result=0
  (cd "$repo" && \
   BASELINES_DIR="$repo/server/tests/browser-detection-harness/baselines" \
   SITES_DIR="$repo/server/tests/browser-detection-harness/sites" \
   bash "$SCRIPT_DIR/verify-baseline-weakening-approval.sh" --check-only) || result=$?
  assert_exit "(vii) trailer with non-allowlisted handle" 1 $result

  # Case (viii): trailer present in a non-tip branch commit (not just tip) → exit 0
  git -C "$repo" checkout main >/dev/null 2>&1
  git -C "$repo" checkout -b case-viii >/dev/null 2>&1
  echo '{"score":0.85,"tolerance":0.25}' > "$repo/server/tests/browser-detection-harness/baselines/site1.baseline.json"
  git -C "$repo" add -A >/dev/null 2>&1
  git -C "$repo" commit -m "$(printf 'widen\n\nBaseline-Weakening-Approved-By: @michaelhazza')" >/dev/null 2>&1
  # Add a second commit on top (trailer is now in a non-tip commit)
  git -C "$repo" commit --allow-empty -m "followup commit without trailer" >/dev/null 2>&1
  result=0
  (cd "$repo" && \
   BASELINES_DIR="$repo/server/tests/browser-detection-harness/baselines" \
   SITES_DIR="$repo/server/tests/browser-detection-harness/sites" \
   bash "$SCRIPT_DIR/verify-baseline-weakening-approval.sh" --check-only) || result=$?
  assert_exit "(viii) trailer in non-tip branch commit" 0 $result

  echo ""
  echo "Self-test results: $pass passed, $fail failed"
  return $fail
}

# ---------------------------------------------------------------------------
# Check mode (used by self-test to avoid recursion)
# ---------------------------------------------------------------------------

if [[ "${1:-}" == "--self-test" ]]; then
  run_self_tests
  exit $?
fi

# The --check-only flag runs the checks against the current git repo and the
# BASELINES_DIR / SITES_DIR env vars (overridable for self-test).
# Without the flag, the same logic runs — --check-only is just a no-op marker.

# ---------------------------------------------------------------------------
# Scan for trailer in branch commits
# ---------------------------------------------------------------------------

scan_trailer

# ---------------------------------------------------------------------------
# Check baseline JSON files for weakening
# ---------------------------------------------------------------------------

VIOLATIONS=0

check_baseline_files() {
  if [[ ! -d "$BASELINES_DIR" ]]; then
    return 0
  fi

  # Get all changed baseline files on this branch vs origin/main
  local diff_output
  if ! diff_output=$(git diff origin/main..HEAD --name-only -- "${BASELINES_DIR}/*.baseline.json" 2>/dev/null); then
    diff_output=$(git diff origin/main..HEAD --name-only 2>/dev/null | grep '\.baseline\.json$' || true)
  fi

  # Also catch files added to baselines dir
  local changed_files
  changed_files=$(git diff origin/main..HEAD --name-only 2>/dev/null | grep '\.baseline\.json$' || true)

  while IFS= read -r rel_path; do
    [[ -z "$rel_path" ]] && continue

    # Skip if file is newly added (baseline establishment is not weakening)
    local status
    status=$(git diff origin/main..HEAD --name-status -- "$rel_path" 2>/dev/null | awk '{print $1}' | head -1)
    if [[ "$status" == "A" ]]; then
      continue
    fi

    # Get old and new tolerance + score
    local old_json new_json
    old_json=$(git show "origin/main:$rel_path" 2>/dev/null) || continue
    new_json=$(git show "HEAD:$rel_path" 2>/dev/null) || continue

    local old_tolerance new_tolerance old_score new_score
    old_tolerance=$(echo "$old_json" | grep '"tolerance"' | grep -o '[0-9.]\+' | head -1)
    new_tolerance=$(echo "$new_json" | grep '"tolerance"' | grep -o '[0-9.]\+' | head -1)
    old_score=$(echo "$old_json" | grep '"score"' | grep -o '[0-9.]\+' | head -1)
    new_score=$(echo "$new_json" | grep '"score"' | grep -o '[0-9.]\+' | head -1)

    # Compare using awk for floating-point arithmetic
    local tolerance_widened score_decreased
    tolerance_widened=$(awk "BEGIN { print ($new_tolerance > $old_tolerance) ? 1 : 0 }")
    score_decreased=$(awk "BEGIN { print ($new_score < $old_score) ? 1 : 0 }")

    if [[ "$tolerance_widened" == "1" ]]; then
      echo "VIOLATION: $rel_path — tolerance widened from $old_tolerance to $new_tolerance"
      ((VIOLATIONS++)) || true
    fi

    if [[ "$score_decreased" == "1" ]]; then
      echo "VIOLATION: $rel_path — baseline score decreased from $old_score to $new_score"
      ((VIOLATIONS++)) || true
    fi
  done <<< "$changed_files"
}

check_baseline_files

# ---------------------------------------------------------------------------
# Check site test files for mode downgrades
# ---------------------------------------------------------------------------

check_site_modes() {
  if [[ ! -d "$SITES_DIR" ]]; then
    return 0
  fi

  local changed_sites
  changed_sites=$(git diff origin/main..HEAD --name-only 2>/dev/null | grep '\.test\.ts$' | grep 'sites/' || true)

  while IFS= read -r rel_path; do
    [[ -z "$rel_path" ]] && continue

    # Skip newly added files (adding a site is not a downgrade)
    local status
    status=$(git diff origin/main..HEAD --name-status -- "$rel_path" 2>/dev/null | awk '{print $1}' | head -1)
    if [[ "$status" == "A" ]]; then
      continue
    fi

    # Extract old and new mode values using grep
    local old_mode new_mode
    old_mode=$(git show "origin/main:$rel_path" 2>/dev/null | grep -o "mode: '[a-z]*'" | grep -o "'[a-z]*'" | tr -d "'" | head -1)
    new_mode=$(git show "HEAD:$rel_path" 2>/dev/null | grep -o "mode: '[a-z]*'" | grep -o "'[a-z]*'" | tr -d "'" | head -1)

    [[ -z "$old_mode" || -z "$new_mode" ]] && continue

    local old_rank new_rank
    old_rank=$(mode_rank "$old_mode")
    new_rank=$(mode_rank "$new_mode")

    if [[ "$new_rank" -lt "$old_rank" ]]; then
      echo "VIOLATION: $rel_path — mode downgraded from '$old_mode' to '$new_mode'"
      ((VIOLATIONS++)) || true
    fi
  done <<< "$changed_sites"
}

check_site_modes

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------

if [[ "$VIOLATIONS" -eq 0 ]]; then
  echo "[PASS] verify-baseline-weakening-approval: no violations detected"
  exit 0
fi

if [[ -z "$APPROVED_HANDLE" ]]; then
  echo ""
  echo "ERROR: $VIOLATIONS baseline-weakening violation(s) detected without approval."
  echo "  Add a trailer to any commit on this branch:"
  echo "    Baseline-Weakening-Approved-By: @michaelhazza"
  exit 1
fi

if check_allowlist "$APPROVED_HANDLE"; then
  echo "[PASS] verify-baseline-weakening-approval: $VIOLATIONS violation(s) approved by $APPROVED_HANDLE"
  exit 0
else
  echo ""
  echo "ERROR: Baseline-Weakening-Approved-By handle '$APPROVED_HANDLE' is not in the allowlist."
  echo "  V1 allowlist: @michaelhazza"
  exit 1
fi

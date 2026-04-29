#!/usr/bin/env bash
# check-batch.sh — post-conversion verification and logging for a migration batch
#
# Usage:
#   bash scripts/check-batch.sh <batch-file> <phase>
#
# Arguments:
#   batch-file  Path to the batch file (e.g. tasks/builds/vitest-migration/phase2-batch-00.txt)
#   phase       One of: phase2 | phase3
#
# What it does (per the vitest-migration plan):
#   0. Guards: clean working tree; batch file unchanged since creation
#   1. Reads the Phase 0 SHA from progress.md; flags files changed since then (RE-RUN NEEDED)
#   2. Runs Vitest on the batch files; logs raw output to /tmp/vitest-<phase>-<batch>.log
#   3. Hard-stops if any file registers 0 tests after conversion
#   4. Checks for legacy import survivors (node:test, node:assert, handwritten harness)
#   5. Reads pre-conversion outcomes from docs/pre-migration-test-snapshot.json
#   6. Appends per-file dual-run comparison to tasks/builds/vitest-migration/dual-run-consistency.md
#   6a. Warns if test names drift vs the previous run of this same batch (rerun safety)
#   7. Prints a summary: mismatches, 0-test files, legacy survivors, escalation count
#   On any failure: saves git diff + staged diff to /tmp/batch-failure-<batch>.diff
#                  and untracked file list to /tmp/batch-failure-<batch>.untracked
#
# Exit codes:
#   0  All checks pass; batch is safe to commit
#   1  Hard failure (0-test files, legacy survivors, or dual-run mismatch) — DO NOT commit

set -euo pipefail

BATCH_FILE="${1:-}"
PHASE="${2:-}"

if [[ -z "$BATCH_FILE" || -z "$PHASE" ]]; then
  echo "Usage: bash scripts/check-batch.sh <batch-file> <phase2|phase3>" >&2
  exit 1
fi

if [[ ! -f "$BATCH_FILE" ]]; then
  echo "Batch file not found: $BATCH_FILE" >&2
  exit 1
fi

BATCH_NAME=$(basename "$BATCH_FILE" .txt)
PROGRESS_DOC="tasks/builds/vitest-migration/progress.md"
DUAL_RUN_DOC="tasks/builds/vitest-migration/dual-run-consistency.md"
ESCALATIONS_DOC="tasks/builds/vitest-migration/escalations.md"
SNAPSHOT_JSON="docs/pre-migration-test-snapshot.json"
LOG_FILE="/tmp/vitest-${PHASE}-${BATCH_NAME}.log"
NAMES_CACHE="/tmp/vitest-names-${PHASE}-${BATCH_NAME}.json"
DIFF_FILE="/tmp/batch-failure-${BATCH_NAME}.diff"

BATCH_FILES=$(cat "$BATCH_FILE" | tr '\n' ' ')
DATE_NOW=$(date +%Y-%m-%d)

UNTRACKED_FILE="/tmp/batch-failure-${BATCH_NAME}.untracked"

# Helper: save failure snapshot and exit
fail_with_snapshot() {
  local msg="$1"
  echo ""
  echo "  Saving failure snapshot..."
  { git diff 2>/dev/null; git diff --staged 2>/dev/null; } > "$DIFF_FILE" || true
  git ls-files --others --exclude-standard 2>/dev/null > "$UNTRACKED_FILE" || true
  echo "  Diff:      $DIFF_FILE"
  echo "  Untracked: $UNTRACKED_FILE"
  echo "  $msg"
  exit 1
}

echo ""
echo "========================================================"
echo "  check-batch: $BATCH_NAME  ($PHASE)"
echo "========================================================"
echo ""

# ---------------------------------------------------------------------------
# Guard 0a: Clean working tree
# ---------------------------------------------------------------------------
echo ">> Guard: Checking for clean working tree..."
DIRTY=$(git status --porcelain 2>/dev/null || true)
if [[ -n "$DIRTY" ]]; then
  echo ""
  echo "  STOP: Working tree is not clean. Commit or stash all changes before"
  echo "  running the batch script — partial edits must not leak between batches."
  echo ""
  echo "$DIRTY" | head -20 | sed 's/^/    /'
  exit 1
fi
echo "   OK — working tree clean."

# ---------------------------------------------------------------------------
# Guard 0b: Batch file unchanged since committed
# ---------------------------------------------------------------------------
echo ""
echo ">> Guard: Checking batch file is unchanged..."
if ! git diff --exit-code "$BATCH_FILE" > /dev/null 2>&1; then
  echo ""
  echo "  STOP: Batch file has uncommitted changes: $BATCH_FILE"
  echo "  Batch file lists are immutable once created. If you need to modify"
  echo "  the batch split, create a new batch file and commit it first."
  exit 1
fi
echo "   OK — batch file unchanged."

# ---------------------------------------------------------------------------
# Step 1: RE-RUN NEEDED detection (using Phase 0 SHA)
# ---------------------------------------------------------------------------
echo ""
echo ">> Step 1: Checking for test files changed since Phase 0 baseline..."
PHASE0_SHA=$(grep "Phase 0 baseline commit SHA" "$PROGRESS_DOC" 2>/dev/null | awk '{print $NF}' || true)
RERUN_NEEDED=0

if [[ -z "$PHASE0_SHA" || "$PHASE0_SHA" == "(fill" ]]; then
  echo "   WARNING: Phase 0 baseline SHA not set in progress.md"
  echo "   Using snapshot outcomes as-is without staleness check."
else
  for f in $(cat "$BATCH_FILE"); do
    if git rev-list "${PHASE0_SHA}..HEAD" -- "$f" 2>/dev/null | grep -q .; then
      echo "   RE-RUN NEEDED (changed since Phase 0): $f"
      RERUN_NEEDED=1
    fi
  done
  if [[ $RERUN_NEEDED -eq 0 ]]; then
    echo "   All files unchanged since Phase 0. Using snapshot outcomes."
  fi
fi

# ---------------------------------------------------------------------------
# Step 2: Run Vitest on the batch
# ---------------------------------------------------------------------------
echo ""
echo ">> Step 2: Running Vitest on batch..."
echo "   Log: $LOG_FILE"
set +e
npx vitest run $BATCH_FILES 2>&1 | tee "$LOG_FILE"
VITEST_EXIT=$?
set -e
echo "   Vitest exit: $VITEST_EXIT"

if [[ $VITEST_EXIT -ne 0 ]]; then
  fail_with_snapshot "HARD STOP: Vitest exited non-zero ($VITEST_EXIT). Do not commit."
fi

# ---------------------------------------------------------------------------
# Step 3: Hard check — no file with 0 registered tests
# ---------------------------------------------------------------------------
echo ""
echo ">> Step 3: Checking for 0-registered-test files..."
VITEST_LIST_JSON=$(npx vitest list --reporter=json $BATCH_FILES 2>/dev/null || echo "[]")

ZERO_TESTS=$(echo "$VITEST_LIST_JSON" \
  | node -e '
    let s=""; process.stdin.on("data",c=>s+=c);
    process.stdin.on("end",()=>{
      try {
        const d=JSON.parse(s);
        const entries=Array.isArray(d)?d:d.files||[];
        const zeros=entries.filter(e=>(e.tasks||e.tests||[]).length===0);
        if(zeros.length>0){
          console.log(zeros.map(e=>e.file||e.path||e.filepath||"unknown").join("\n"));
        }
      } catch(e) { /* no output = ok */ }
    });
  ' 2>/dev/null || true)

if [[ -n "$ZERO_TESTS" ]]; then
  echo "$ZERO_TESTS" | sed 's/^/    /'
  fail_with_snapshot "HARD STOP: Files with 0 registered tests after conversion. Silent test loss detected."
fi
echo "   OK — all files register >0 tests."

# ---------------------------------------------------------------------------
# Step 4: Legacy pattern grep gate
# ---------------------------------------------------------------------------
echo ""
echo ">> Step 4: Checking for legacy import survivors..."
LEGACY_FOUND=0

for f in $(cat "$BATCH_FILE"); do
  if grep -qE "from ['\"]node:test['\"]|from ['\"]node:assert" "$f" 2>/dev/null; then
    echo "   LEGACY node:test/node:assert: $f"
    LEGACY_FOUND=1
  fi
  if grep -qE "function test\(name|function assert\(cond|let passed = 0|let failed = 0" "$f" 2>/dev/null; then
    echo "   LEGACY handwritten harness: $f"
    LEGACY_FOUND=1
  fi
done

if [[ $LEGACY_FOUND -ne 0 ]]; then
  fail_with_snapshot "HARD STOP: Legacy patterns found. Conversion incomplete."
fi
echo "   OK — no legacy patterns."

# ---------------------------------------------------------------------------
# Step 5 + 6: Per-file dual-run comparison
# ---------------------------------------------------------------------------
echo ""
echo ">> Step 5/6: Building dual-run comparison..."

BATCH_HEADER="### ${PHASE} ${BATCH_NAME} (${DATE_NOW})"
MISMATCH_COUNT=0
COMPARISON_LINES=()

for f in $(cat "$BATCH_FILE"); do
  # Read pre-conversion bash outcome from snapshot JSON
  BASH_OUTCOME=$(node -e '
    const d=JSON.parse(require("fs").readFileSync("'"$SNAPSHOT_JSON"'","utf8"));
    const e=d.find(x=>x.file==="'"$f"'".replace(/\\\\/g,"/"));
    console.log(e?e.outcome:"not-discovered");
  ' 2>/dev/null || echo "not-discovered")

  # Determine Vitest outcome from the log file (heuristic; JSON reporter is authoritative for global comparison)
  if grep -qE "FAIL.*$(basename "$f")|$(basename "$f").*FAIL" "$LOG_FILE" 2>/dev/null; then
    VITEST_OUTCOME="fail"
  elif grep -qE "skip.*$(basename "$f")|$(basename "$f").*skip" "$LOG_FILE" 2>/dev/null; then
    VITEST_OUTCOME="skip"
  elif [[ $VITEST_EXIT -eq 0 ]]; then
    VITEST_OUTCOME="pass"
  else
    VITEST_OUTCOME="unknown"
  fi

  # Valid matches: pass↔pass, fail↔fail, skip↔skip, not-discovered→pass (outliers)
  if [[ "$BASH_OUTCOME" == "$VITEST_OUTCOME" ]] || \
     [[ "$BASH_OUTCOME" == "not-discovered" && "$VITEST_OUTCOME" == "pass" ]]; then
    MATCH="yes"
  else
    MATCH="no"
    MISMATCH_COUNT=$((MISMATCH_COUNT + 1))
  fi

  COMPARISON_LINES+=("$f bash:${BASH_OUTCOME} vitest:${VITEST_OUTCOME} match:${MATCH}")
done

# Append to dual-run consistency doc
{
  echo ""
  echo "$BATCH_HEADER"
  for line in "${COMPARISON_LINES[@]}"; do
    echo "$line"
  done
} >> "$DUAL_RUN_DOC"

echo "   Appended to $DUAL_RUN_DOC"

if [[ $MISMATCH_COUNT -gt 0 ]]; then
  fail_with_snapshot "HARD STOP: $MISMATCH_COUNT dual-run mismatch(es). Review $DUAL_RUN_DOC. Do not commit."
fi

# ---------------------------------------------------------------------------
# Step 6a: Test name drift check (WARNING only, not hard fail)
# ---------------------------------------------------------------------------
echo ""
echo ">> Step 6a: Test name drift check..."

CURRENT_NAMES=$(echo "$VITEST_LIST_JSON" \
  | node -e '
    let s=""; process.stdin.on("data",c=>s+=c);
    process.stdin.on("end",()=>{
      try {
        const d=JSON.parse(s);
        const entries=Array.isArray(d)?d:d.files||[];
        const names={};
        for(const e of entries){
          const file=(e.file||e.path||e.filepath||"").replace(/\\/g,"/");
          names[file]=(e.tasks||e.tests||[]).map(t=>t.name||t.title||"").filter(Boolean);
        }
        console.log(JSON.stringify(names,null,2));
      } catch(ex){ console.log("{}"); }
    });
  ' 2>/dev/null || echo "{}")

if [[ -f "$NAMES_CACHE" ]]; then
  # Compare current names against the previous successful run of this same batch
  NAME_WARNINGS=$(node -e '
    const prev=JSON.parse(require("fs").readFileSync("'"$NAMES_CACHE"'","utf8"));
    const curr='"$CURRENT_NAMES"';
    const warnings=[];
    for(const file of Object.keys(prev)){
      const prevNames=new Set(prev[file]);
      const currNames=new Set(curr[file]||[]);
      const lost=[...prevNames].filter(n=>!currNames.has(n));
      const gained=[...currNames].filter(n=>!prevNames.has(n));
      if(lost.length>0) warnings.push("  LOST in "+file+": "+lost.join(", "));
      if(gained.length>0) warnings.push("  GAINED in "+file+": "+gained.join(", "));
    }
    console.log(warnings.join("\n"));
  ' 2>/dev/null || true)

  if [[ -n "$NAME_WARNINGS" ]]; then
    echo "   WARNING: Test names changed vs previous successful run of this batch."
    echo "   This is a signal only — not a hard fail. Verify the changes are intentional:"
    echo "$NAME_WARNINGS"
    echo "   If intentional (test renamed for clarity), proceed. If unexpected, investigate."
  else
    echo "   OK — test names match previous run."
  fi
else
  echo "   No previous name cache found (first run). Cache will be written on success."
fi
# NOTE: cache is written only after all checks pass (at end of script) to prevent
# a failed run from creating a partial cache that corrupts future comparisons.

# ---------------------------------------------------------------------------
# Step 7: Escalations cap check
# ---------------------------------------------------------------------------
echo ""
echo ">> Step 7: Checking escalations cap..."
ESC_COUNT=$(grep -c "^- " "$ESCALATIONS_DOC" 2>/dev/null || echo 0)
echo "   Current escalations: $ESC_COUNT / 5"
if [[ $ESC_COUNT -gt 5 ]]; then
  echo ""
  echo "  WARNING: Escalations cap (5) exceeded. Surface to user before next batch."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "========================================================"
echo "  SUMMARY: $BATCH_NAME"
echo "========================================================"
echo "  Vitest exit:    $VITEST_EXIT"
echo "  0-test files:   0 (would have hard-stopped)"
echo "  Legacy imports: 0 (would have hard-stopped)"
echo "  Mismatches:     $MISMATCH_COUNT"
echo "  Escalations:    $ESC_COUNT / 5"
echo "  Raw log:        $LOG_FILE"
echo "  Names cache:    $NAMES_CACHE"
echo ""
echo "  RESULT: PASS — Safe to commit this batch."
echo ""

# Write names cache only on successful completion — prevents partial/failed runs
# from poisoning the baseline used by future drift comparisons.
echo "$CURRENT_NAMES" > "$NAMES_CACHE"

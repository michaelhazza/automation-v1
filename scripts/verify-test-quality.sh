#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-test-quality.sh
#
# Single guard for the testing-conventions invariants. Enforces what
# docs/testing-conventions.md L88-93 already names ("Forbidden patterns")
# plus the discovery-location rule, with the patterns that surfaced during
# the Vitest migration and the post-migration CI hang investigation.
#
# What it forbids in any *.test.ts file:
#
#   1. File location:
#      *.test.ts must live under a __tests__/ directory. Files outside the
#      Vitest discovery glob silently provide zero coverage (TI-002 root
#      cause; bit us at canonicalAdapterContract, workspaceEmail/Identity,
#      and shared/types|billing).
#
#   2. node:assert / node:test imports:
#      The single permitted runner is Vitest. node:test and node:assert are
#      pre-migration assertion patterns that drift from the rest of the
#      suite and fragment the assertion vocabulary.
#
#   3. Handwritten harness leftovers:
#      function asyncTest(, pendingTests, let passed = 0, let failed = 0,
#      passed++, failed++, Promise.all(pendingTests). These caused the
#      13-minute CI hang on PR #238 — the asyncTest resolver threw
#      ReferenceError, the promise never resolved, and the top-level
#      `await Promise.all(pendingTests)` waited forever.
#
#   4. process.exit in tests:
#      Tests must use test.skip / test.skipIf / throw to skip or fail.
#      process.exit kills the worker mid-stream and bypasses Vitest's
#      reporter, so a failure prints nothing useful.
#
#   5. Files with zero test()/describe() blocks:
#      A file in __tests__/ that registers no test or describe block runs
#      no tests but still loads. Symptom: silent "0 test" report, hidden
#      coverage gap. (workspaceEmail/Identity Pure tests landed in this
#      shape on master.)
#
# Excluded paths:
#   - node_modules, dist
#   - tools/mission-control/** (out of CI scope per vitest.config.ts)
#   - The conversion script itself (scripts/convert-assert-to-expect.mjs
#     is removed after one-shot use; not an exclusion).
#
# Suppression: prefix the file with
#   // guard-ignore-file: test-quality reason="..."
# on the first line.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="test-quality"
GUARD_NAME="Test Quality (vitest conventions)"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=0

emit_header "$GUARD_NAME"

# Find every *.test.ts file in the repo, skipping node_modules / dist /
# mission-control. We DO NOT restrict to __tests__/ — the gate's #1 rule is
# that test files must live under __tests__/, so we need to see the whole
# repo to flag stragglers.
while IFS= read -r test_file; do
  [ -z "$test_file" ] && continue
  FILES_SCANNED=$((FILES_SCANNED + 1))

  rel_path="${test_file#$ROOT_DIR/}"

  # File-level suppression on any of the first 10 lines (allows stacking
  # multiple guard-ignore-file directives, e.g. pure-helper + test-quality).
  if head -10 "$test_file" | grep -qE "guard-ignore-file:\s*${GUARD_ID}\s+reason=\"[^\"]+\""; then
    continue
  fi

  # ── Rule 1: location — must be under a __tests__/ directory ─────────────
  if ! echo "$rel_path" | grep -q "/__tests__/"; then
    emit_violation "$GUARD_ID" "error" "$rel_path" "1" \
      "Test file outside __tests__/ — Vitest's include glob will not pick it up" \
      "Move the file under a __tests__/ directory next to the module it tests. See docs/testing-conventions.md § Test discovery."
    VIOLATIONS=$((VIOLATIONS + 1))
    # Continue scanning other rules — multiple violations per file are fine.
  fi

  # ── Rule 2: forbidden imports ──────────────────────────────────────────
  if grep -nE "from\s+['\"]node:test['\"]" "$test_file" >/dev/null 2>&1; then
    line=$(grep -nE "from\s+['\"]node:test['\"]" "$test_file" | head -1 | cut -d: -f1)
    emit_violation "$GUARD_ID" "error" "$rel_path" "$line" \
      "Imports node:test — only Vitest is allowed" \
      "Replace with 'import { test } from \"vitest\"' and convert assertions to expect()."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  if grep -nE "from\s+['\"]node:assert(/strict)?['\"]" "$test_file" >/dev/null 2>&1; then
    line=$(grep -nE "from\s+['\"]node:assert(/strict)?['\"]" "$test_file" | head -1 | cut -d: -f1)
    emit_violation "$GUARD_ID" "error" "$rel_path" "$line" \
      "Imports node:assert — convention requires expect() from vitest" \
      "Drop the import and replace assert.* calls with expect(). See docs/testing-conventions.md § Forbidden patterns."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  # ── Rule 3: handwritten-harness leftovers ──────────────────────────────
  # The Promise<T>[] declaration + Promise.all + tests.push patterns are the
  # exact shapes that surfaced under different variable names (pendingTests,
  # promises, tests) during cleanup. Match the shape, not just the name.
  for pattern in \
    "function asyncTest" \
    "pendingTests" \
    "let passed = 0" \
    "let failed = 0" \
    "passed\+\+" \
    "failed\+\+" \
    "Promise\.all\(pendingTests\)" \
    ":\s*Promise<[^>]+>\[\]\s*=\s*\[\]" \
    "\.push\(async\s*\(\s*\)\s*=>\s*test\("
  do
    if grep -nE "$pattern" "$test_file" >/dev/null 2>&1; then
      line=$(grep -nE "$pattern" "$test_file" | head -1 | cut -d: -f1)
      emit_violation "$GUARD_ID" "error" "$rel_path" "$line" \
        "Handwritten-harness leftover: \`$pattern\` — caused the PR #238 CI hang" \
        "Convert to vitest test() blocks. See tasks/builds/vitest-migration/progress.md (2026-04-30 entry)."
      VIOLATIONS=$((VIOLATIONS + 1))
      break  # One harness violation per file is enough — caller will see them all on rerun.
    fi
  done

  # ── Rule 3b: bare top-level await ──────────────────────────────────────
  # Bare \`await\` at column 0 in a test file is the exact shape that caused
  # the PR #238 hang (await Promise.all(pendingTests) blocked module load
  # forever). Allowed exceptions: \`import 'dotenv/config'\` is sync, so use
  # that instead of \`await import('dotenv/config')\`. For conditional
  # dynamic imports, indent them inside an if/else block (column > 0).
  if grep -nE "^await " "$test_file" >/dev/null 2>&1; then
    line=$(grep -nE "^await " "$test_file" | head -1 | cut -d: -f1)
    snippet=$(sed -n "${line}p" "$test_file" | head -c 60)
    emit_violation "$GUARD_ID" "error" "$rel_path" "$line" \
      "Bare top-level await: ${snippet}..." \
      "Use a synchronous import or move the await inside a test() / beforeAll() / inside an indented if-block. Bare module-level await runs on import and can deadlock the worker."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  # ── Rule 3c: module-level env mutation without restore ─────────────────
  # \`process.env.FOO = 'bar'\` at column 0 mutates global state for every
  # subsequent test in the worker. Allowed: \`??=\` (only assigns if unset)
  # and assignments inside hooks (beforeEach / afterEach / beforeAll /
  # afterAll) where the value gets restored.
  if grep -nE "^process\.env\.[A-Z_]+\s*=\s*['\"]" "$test_file" >/dev/null 2>&1; then
    line=$(grep -nE "^process\.env\.[A-Z_]+\s*=\s*['\"]" "$test_file" | head -1 | cut -d: -f1)
    emit_violation "$GUARD_ID" "error" "$rel_path" "$line" \
      "Module-level process.env assignment leaks state across tests" \
      "Use \`process.env.X ??= 'val'\` (idempotent) or wrap the assignment in beforeEach/afterEach with a restore. See docs/testing-conventions.md § Env mutation."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  # ── Rule 4: process.exit in tests ──────────────────────────────────────
  # Skip lines that are part of the suppression comment itself.
  if grep -nE "process\.exit(Code)?" "$test_file" | grep -vE "guard-ignore" >/dev/null 2>&1; then
    line=$(grep -nE "process\.exit(Code)?" "$test_file" | grep -vE "guard-ignore" | head -1 | cut -d: -f1)
    emit_violation "$GUARD_ID" "error" "$rel_path" "$line" \
      "process.exit / process.exitCode in a test file" \
      "Use test.skip / test.skipIf to skip, or throw to fail. process.exit kills the worker mid-stream."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  # ── Rule 5: files with no test()/describe() blocks ─────────────────────
  # Only enforced on files that ARE under __tests__/ — files outside already
  # tripped Rule 1.
  if echo "$rel_path" | grep -q "/__tests__/"; then
    if ! grep -qE "(^|\s)(test|describe|it)(\.[a-zA-Z]+)?\s*[\(\.]" "$test_file"; then
      emit_violation "$GUARD_ID" "error" "$rel_path" "1" \
        "Test file has no test()/describe()/it() block — Vitest will report '0 test'" \
        "Wrap your assertions in test('description', () => { ... }) blocks."
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi

done < <(find "$ROOT_DIR" -type f -name '*.test.ts' \
  -not -path '*/node_modules/*' \
  -not -path '*/dist/*' \
  -not -path '*/tools/mission-control/*' \
  2>/dev/null)

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"

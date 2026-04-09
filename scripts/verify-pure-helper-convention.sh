#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-pure-helper-convention.sh
#
# Introduced by P0.1 Layer 3 of docs/improvements-roadmap-spec.md.
#
# Enforces the *Pure.ts + *.test.ts convention codified in
# docs/testing-conventions.md: every *.test.ts file under a __tests__/
# directory must import from at least one sibling module that lives in the
# parent directory of __tests__/.
#
# This catches drift where a developer:
#   1. Creates a *.test.ts file but forgets to extract the pure logic.
#   2. Tests the impure module directly, which couples the test to the
#      database / env / service layer.
#   3. Imports from a faraway module instead of the sibling pure helper.
#
# Allowed import patterns inside a *.test.ts file:
#   - Relative import from the parent directory (sibling module):
#       import { foo } from '../somethingPure.js';
#       import { foo } from '../something.js';
#   - Type-only imports from anywhere (these don't make the test impure):
#       import type { ... } from '...';
#
# Disallowed:
#   - A test file with NO sibling import at all (likely a stranded helper
#     file or a broken extraction).
#   - Test files that ONLY use third-party imports and no sibling imports.
#
# Suppression: prefix the test file with `// guard-ignore-file: pure-helper-convention reason="..."`
# on the first line.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="pure-helper-convention"
GUARD_NAME="Pure-Helper Convention"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=0

emit_header "$GUARD_NAME"

# Find every *.test.ts file inside a __tests__/ directory under server/
# (excluding node_modules and dist).
while IFS= read -r test_file; do
  [ -z "$test_file" ] && continue
  FILES_SCANNED=$((FILES_SCANNED + 1))

  # File-level suppression on the first line.
  first_line=$(sed -n '1p' "$test_file" 2>/dev/null || echo "")
  if echo "$first_line" | grep -qE "guard-ignore-file:\s*${GUARD_ID}\s+reason=\"[^\"]+\""; then
    continue
  fi

  # Look for at least one relative import from a sibling module. Either:
  #   - Parent directory (typical case): from '../foo.js' or '../fooPure.js'
  #   - Same directory (test helper case): from './foo.js' or './fooPure.js'
  #
  # We match on the `from '...'` clause alone, which works for both
  # single-line and multi-line import statements (the closing `from`
  # is always on the line that names the module path).
  #
  # We deliberately do NOT exclude `import type` because the convention
  # is about importing FROM a sibling module — type-only imports still
  # demonstrate the test/sibling relationship.
  #
  # `grep -c` exits 1 on zero matches but still prints "0"; we use
  # `|| true` to discard the exit code and `${var:-0}` for safety.
  total_sibling_imports=$(grep -cE "from\s+'(\.\./|\./)[^']+\.js'" "$test_file" 2>/dev/null || true)
  total_sibling_imports=${total_sibling_imports:-0}

  if [ "$total_sibling_imports" -eq 0 ]; then
    # No sibling import at all.
    rel_path="${test_file#$ROOT_DIR/}"
    emit_violation "$GUARD_ID" "error" "$rel_path" "1" \
      "Test file imports nothing from its parent directory" \
      "Add an import from a sibling module (e.g. '../somethingPure.js'). See docs/testing-conventions.md for the convention."
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(find "$ROOT_DIR/server" -type d -name '__tests__' -not -path '*/node_modules/*' \
  -exec find {} -type f -name '*.test.ts' \; 2>/dev/null)

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"

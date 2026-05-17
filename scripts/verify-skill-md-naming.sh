#!/usr/bin/env bash
# verify-skill-md-naming.sh  (PP-SK3)
#
# Walks server/skills/ recursively and rejects any .md file whose basename
# contains a hyphen (kebab-case), unless the file is listed in the
# allowlist at server/skills/.naming-allowlist.json.
#
# Per-file diagnostic line with rename suggestion on violation.
#
# Exit codes:
#   0 — all .md filenames are snake_case (or allowlisted)
#   1 — one or more non-allowlisted kebab filenames found
#
# Usage: bash scripts/verify-skill-md-naming.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_DIR="$ROOT_DIR/server/skills"
ALLOWLIST_FILE="$SKILLS_DIR/.naming-allowlist.json"

# Load allowlist keys (filenames relative to SKILLS_DIR) if allowlist exists
ALLOWLISTED_FILES=""
if [ -f "$ALLOWLIST_FILE" ]; then
  ALLOWLISTED_FILES=$(node --input-type=module <<NODEEOF
import { readFileSync } from 'node:fs';
const al = JSON.parse(readFileSync('$ALLOWLIST_FILE', 'utf8'));
process.stdout.write(Object.keys(al).join('\n'));
NODEEOF
)
fi

FAIL_COUNT=0
VIOLATIONS=""

# Walk server/skills/ recursively; skip README.md
while IFS= read -r -d '' filepath; do
  filename=$(basename "$filepath")

  # Skip README.md
  if [ "$filename" = "README.md" ]; then
    continue
  fi

  # Check for hyphen in basename (kebab-case)
  if [[ "$filename" == *-* ]]; then
    # Get path relative to SKILLS_DIR for allowlist lookup
    rel="${filepath#$SKILLS_DIR/}"

    # Check if this file is in the allowlist
    if [ -n "$ALLOWLISTED_FILES" ] && echo "$ALLOWLISTED_FILES" | grep -qxF "$rel"; then
      continue
    fi

    # Build rename suggestion: replace hyphens with underscores
    suggested="${filename//-/_}"
    VIOLATIONS="$VIOLATIONS\n  [FAIL] $rel\n         Rename suggestion: ${suggested}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done < <(find "$SKILLS_DIR" -name "*.md" -print0)

echo ""
echo "--- verify-skill-md-naming ---"

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "[PASS] All .md files in server/skills/ use snake_case naming."
  exit 0
fi

echo "[FAIL] $FAIL_COUNT kebab-named .md file(s) found in server/skills/:"
printf "%b\n" "$VIOLATIONS"
echo ""
echo "Fix: rename each file replacing hyphens with underscores."
echo "     If a file must stay kebab, add it to server/skills/.naming-allowlist.json"
exit 1

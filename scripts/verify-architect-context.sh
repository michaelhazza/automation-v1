#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="architect-context"
GUARD_NAME="Architect Context Drift"
AGENT_FILE="$ROOT_DIR/.claude/agents/architect.md"
EXPECTED_FILE="$SCRIPT_DIR/architect-context-expected.txt"

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

VIOLATIONS=0
FILES_SCANNED=1

if [ ! -f "$AGENT_FILE" ]; then
  emit_violation "$GUARD_ID" "error" "$AGENT_FILE" "1" \
    "architect.md not found" "Restore .claude/agents/architect.md"
  VIOLATIONS=$((VIOLATIONS + 1))
  emit_summary "$FILES_SCANNED" "$VIOLATIONS"
  exit "$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)"
fi

# Extract file paths from the ## Context files section of architect.md.
# Capture backtick-quoted tokens that look like paths (contain a dot and no spaces).
# We collect only the section between "## Context files" and the next "## " heading.
ACTUAL=$(awk '/^## Context files/,/^## [^C]/' "$AGENT_FILE" \
  | grep -oE '`[^`]+\.[^`]+`' \
  | tr -d '`' \
  | grep -v ' ' \
  || true)

EXPECTED=$(cat "$EXPECTED_FILE")

# Check for missing entries (in expected but not in actual)
while IFS= read -r path; do
  [ -z "$path" ] && continue
  if ! printf '%s\n' "$ACTUAL" | grep -qF "$path"; then
    emit_violation "$GUARD_ID" "error" "$AGENT_FILE" "1" \
      "Expected context file missing from architect.md: $path" \
      "Add '$path' back to the ## Context files section"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
  # Also check the file exists on disk
  if [ ! -f "$ROOT_DIR/$path" ]; then
    emit_violation "$GUARD_ID" "error" "$ROOT_DIR/$path" "1" \
      "Context file listed but does not exist on disk: $path" \
      "Create the file or remove it from architect.md ## Context files"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done <<< "$EXPECTED"

# Check for unexpected entries (in actual but not in expected)
while IFS= read -r path; do
  [ -z "$path" ] && continue
  if ! grep -qF "$path" "$EXPECTED_FILE"; then
    emit_violation "$GUARD_ID" "error" "$AGENT_FILE" "1" \
      "Unexpected context file in architect.md not in fixture: $path" \
      "Add '$path' to scripts/architect-context-expected.txt if intentional"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done <<< "$ACTUAL"

emit_summary "$FILES_SCANNED" "$VIOLATIONS"
exit "$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)"

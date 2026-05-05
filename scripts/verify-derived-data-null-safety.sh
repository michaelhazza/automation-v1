#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="derived-data-null-safety"
GUARD_NAME="Derived Data Null Safety"
FIELDS_FILE="$SCRIPT_DIR/derived-data-null-safety-fields.txt"

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

VIOLATIONS=0
FILES_SCANNED=0

if [ ! -f "$FIELDS_FILE" ]; then
  emit_violation "$GUARD_ID" "error" "$FIELDS_FILE" "1" \
    "Fields allowlist not found" "Create scripts/derived-data-null-safety-fields.txt"
  VIOLATIONS=$((VIOLATIONS + 1))
  emit_summary "$FILES_SCANNED" "$VIOLATIONS"
  exit 1
fi

# Collect all .ts files under the scan directory.
# Default: server/ excluding node_modules and __tests__. Fixture-runner mode
# overrides SCAN_DIR (and drops the __tests__ exclusion) so the H1 gate
# self-test can run the gate against the deliberate-violation fixture.
SCAN_DIR="${DERIVED_DATA_NULL_SAFETY_SCAN_DIR:-$ROOT_DIR/server}"
if [ -n "${DERIVED_DATA_NULL_SAFETY_SCAN_DIR:-}" ]; then
  mapfile -t TS_FILES < <(find "$SCAN_DIR" -name "*.ts" \
    ! -path "*/node_modules/*" \
    2>/dev/null || true)
else
  mapfile -t TS_FILES < <(find "$SCAN_DIR" -name "*.ts" \
    ! -path "*/node_modules/*" \
    ! -path "*/__tests__/*" \
    2>/dev/null || true)
fi

FILES_SCANNED="${#TS_FILES[@]}"

while IFS= read -r field; do
  # Skip blank lines
  [ -z "$field" ] && continue
  # Skip comment lines
  [ "${field:0:1}" = "#" ] && continue

  for file in "${TS_FILES[@]}"; do
    # Look for non-null assertion on this field: <field>!
    # Use grep to find candidate line numbers, then check suppression
    while IFS= read -r lineno; do
      [ -z "$lineno" ] && continue

      # Check for @null-safety-exempt annotation on same line
      current_line=$(sed -n "${lineno}p" "$file" 2>/dev/null || true)
      if echo "$current_line" | grep -q "@null-safety-exempt:"; then
        continue
      fi

      # Check standard guard suppression (guard-ignore / guard-ignore-next-line)
      is_suppressed "$file" "$lineno" "$GUARD_ID" && continue

      emit_violation "$GUARD_ID" "warning" "$file" "$lineno" \
        "Non-null assertion on derived field '${field}' (may not be populated yet)" \
        "Use logDataDependencyMissing and return null/empty sentinel; import from server/lib/derivedDataMissingLog.ts"
      VIOLATIONS=$((VIOLATIONS + 1))
    done < <(grep -n "${field}!" "$file" 2>/dev/null | cut -d: -f1 || true)
  done
done < "$FIELDS_FILE"

emit_summary "$FILES_SCANNED" "$VIOLATIONS"
if [ "$VIOLATIONS" -gt 0 ]; then
  exit 1
fi
exit 0

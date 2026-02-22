#!/usr/bin/env bash
set -euo pipefail

# Gate Script Splitter - Standalone extraction utility
# Extracts quality gate scripts from gate-scripts-reference.md
# Application: Automation OS

REFERENCE_FILE="docs/gate-scripts-reference.md"
OUTPUT_DIR="scripts"
EXPECTED_SCRIPTS=14
# GENERATION INSTRUCTION: Replace "14" above with the exact integer from "Total Scripts:"
# in gate-scripts-reference.md. Must be identical. Plain integer literal only.

if [ ! -f "$REFERENCE_FILE" ]; then
  echo "[ERROR] Reference file not found: $REFERENCE_FILE" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "Extracting gate scripts from $REFERENCE_FILE"

# Extract scripts using awk with deterministic markers.
# -v output_dir passes OUTPUT_DIR into awk so extraction is CWD-independent.
# sub(/.*\//, "", filename) strips any path prefix from the marker (e.g. "scripts/verify-foo.sh"
# becomes "verify-foo.sh") and then output_dir is prepended, making extraction deterministic.
awk -v output_dir="$OUTPUT_DIR" '
/^#===== FILE: / {
  if (output_file != "") {
    close(output_file)
  }
  match($0, /FILE: (.+\.sh) =====/, arr)
  if (arr[1] == "") {
    print "[ERROR] Malformed marker line: " $0 > "/dev/stderr"
    exit 2
  }
  filename = arr[1]
  sub(/.*\//, "", filename)
  output_file = output_dir "/" filename
  writing = 1
  next
}
/^#===== END FILE: / {
  if (output_file != "") {
    close(output_file)
  }
  output_file = ""
  writing = 0
  next
}
writing && output_file != "" {
  print > output_file
}
' "$REFERENCE_FILE"

# Set executable permissions
chmod +x "$OUTPUT_DIR"/*.sh 2>/dev/null || true

# Count extracted scripts
EXTRACTED_COUNT=$(find "$OUTPUT_DIR" -name "verify-*.sh" | wc -l)

echo "Extracted $EXTRACTED_COUNT gate scripts"

# Validate extraction count
if [ "$EXTRACTED_COUNT" -ne "$EXPECTED_SCRIPTS" ]; then
  echo "[ERROR] Expected $EXPECTED_SCRIPTS scripts, extracted $EXTRACTED_COUNT" >&2
  exit 1
fi

echo "[OK] Gate scripts extracted successfully"
exit 0

#!/usr/bin/env bash
set -euo pipefail

# QA Script Splitter - Standalone extraction utility
# Extracts QA test scripts from qa-scripts-reference.md
# Application: Automation OS

REFERENCE_FILE="docs/qa-scripts-reference.md"
OUTPUT_DIR="scripts"
EXPECTED_SCRIPTS=10
# GENERATION INSTRUCTION: Replace "10" above with the exact integer from "Total Scripts:"
# in qa-scripts-reference.md. Must be identical. Plain integer literal only.

if [ ! -f "$REFERENCE_FILE" ]; then
  echo "[ERROR] Reference file not found: $REFERENCE_FILE" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "Extracting QA scripts from $REFERENCE_FILE"

# -v output_dir passes OUTPUT_DIR into awk so extraction is CWD-independent.
# sub(/.*\//, "", filename) strips path prefix from marker before prepending output_dir.
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

chmod +x "$OUTPUT_DIR"/qa-*.sh 2>/dev/null || true

EXTRACTED_COUNT=$(find "$OUTPUT_DIR" -name "qa-*.sh" | wc -l)

echo "Extracted $EXTRACTED_COUNT QA scripts"

if [[ "$EXTRACTED_COUNT" -ne "$EXPECTED_SCRIPTS" ]]; then
  echo "[ERROR] Expected $EXPECTED_SCRIPTS scripts, extracted $EXTRACTED_COUNT" >&2
  exit 1
fi

echo "[OK] QA scripts extracted successfully"
exit 0

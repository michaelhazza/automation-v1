#!/usr/bin/env bash
set -e
# Multiline-aware scan: collapses each file to a single line before matching.
# A plain grep -E with [^)]* would miss calls formatted across multiple lines,
# silently allowing the runId invariant to drift with CI still green.
FAILED=0
while IFS= read -r -d '' file; do
  collapsed=$(tr '\n' ' ' < "$file")
  bad=$(echo "$collapsed" | grep -oE 'resolveSkillsForAgent\s*\([^;]*\)' | grep -vE 'runId' || true)
  if [ -n "$bad" ]; then
    echo "verify-resolver-runid-invariant: $file: callsite missing runId"
    echo "  $bad"
    FAILED=1
  fi
done < <(find server/ shared/ -name '*.ts' -print0 2>/dev/null)
if [ "$FAILED" -ne 0 ]; then
  echo "verify-resolver-runid-invariant: runId invariant violated (multiline-aware scan)"
  exit 1
fi

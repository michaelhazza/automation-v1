#!/usr/bin/env bash
set -e
HITS=$(grep -RnE 'resolveSkillsForAgent\([^)]*\)' server/ shared/ --include='*.ts' | grep -vE 'runId' || true)
if [ -n "$HITS" ]; then
  echo "verify-resolver-runid-invariant: callsites without runId:"
  echo "$HITS"
  exit 1
fi

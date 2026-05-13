#!/usr/bin/env bash
# iee-browser sandbox entrypoint — runs the harness with the task input
set -euo pipefail

mkdir -p /workspace/artefacts /workspace/logs /workspace/profile

STDOUT_LOG="/workspace/logs/stdout.log"
STDERR_LOG="/workspace/logs/stderr.log"

# Run the harness, passing /workspace/input.json as the task source
node /harness/dist/index.js \
  > >(tee -a "$STDOUT_LOG") \
  2> >(tee -a "$STDERR_LOG" >&2)

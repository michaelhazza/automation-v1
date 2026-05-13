#!/usr/bin/env bash
# iee-browser sandbox entrypoint — runs the harness with the task input
set -euo pipefail

mkdir -p /workspace/artefacts /workspace/logs /workspace/profile

STDOUT_LOG="/workspace/logs/stdout.log"
STDERR_LOG="/workspace/logs/stderr.log"

# Wait for /workspace/input.json to be injected by the host.
# e2bSandbox.runTask writes this AFTER createSandbox returns, so there is a
# startup window during which the entrypoint runs but input is not yet present.
# Defensive timeout: if the host never injects input within 30s, write a
# structured failure to output.json and exit 1. This prevents silent spinning
# and gives the harvest pipeline a clear failure to classify.
INPUT_PATH="/workspace/input.json"
TIMEOUT_SECONDS=30
for _ in $(seq 1 "$TIMEOUT_SECONDS"); do
  if [ -f "$INPUT_PATH" ]; then
    break
  fi
  sleep 1
done
if [ ! -f "$INPUT_PATH" ]; then
  echo "entrypoint: timed out waiting for $INPUT_PATH after ${TIMEOUT_SECONDS}s" >&2
  printf '{"status":"failed","reason":"entrypoint: timed out waiting for /workspace/input.json (host did not inject input within %ss)"}' "$TIMEOUT_SECONDS" \
    > /workspace/output.json
  exit 1
fi

# Run the harness, passing /workspace/input.json as the task source
node /harness/dist/index.js \
  > >(tee -a "$STDOUT_LOG") \
  2> >(tee -a "$STDERR_LOG" >&2)

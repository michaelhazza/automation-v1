#!/usr/bin/env bash
# synthetos-sandbox entrypoint — Spec B §15.1, §8.3
#
# Sets up /workspace directories, runs the task script passed as $1,
# and captures stdout/stderr to /workspace/logs/{stdout,stderr}.log.
#
# The task script is injected by the sandbox orchestrator at runtime
# as a file written to /workspace/task.sh before sandbox start.
#
# Exit code from the task script is passed through; the harvest pipeline
# consults /workspace/output.json and /workspace/logs/ per spec §8.3.
set -euo pipefail

# Ensure workspace directories exist (belt-and-braces; Dockerfile creates them at build time)
mkdir -p /workspace/artefacts /workspace/logs

TASK_SCRIPT="/workspace/task.sh"
STDOUT_LOG="/workspace/logs/stdout.log"
STDERR_LOG="/workspace/logs/stderr.log"

if [[ ! -f "$TASK_SCRIPT" ]]; then
  echo "entrypoint: task script not found at $TASK_SCRIPT" >&2
  exit 1
fi

chmod +x "$TASK_SCRIPT"

# Run the task, tee-ing stdout and stderr to their respective log files.
# The task is responsible for writing /workspace/output.json on success.
"$TASK_SCRIPT" \
  > >(tee -a "$STDOUT_LOG") \
  2> >(tee -a "$STDERR_LOG" >&2)

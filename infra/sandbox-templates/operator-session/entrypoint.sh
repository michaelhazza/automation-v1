#!/usr/bin/env sh
# operator-session sandbox template — entrypoint.sh
# PLACEHOLDER: not built by V1 CI. The operator runtime binary invocation is infra-managed.
# This script documents the intended startup sequence.

set -e

# Start the filesystem watcher as a background process.
node /workspace/file-watcher.js &
WATCHER_PID=$!

# Clean up the watcher when the container receives SIGTERM or SIGINT.
cleanup() {
  echo "[entrypoint] shutting down watcher (pid $WATCHER_PID)"
  kill "$WATCHER_PID" 2>/dev/null || true
  exit 0
}
trap cleanup TERM INT

# PLACEHOLDER: start the operator runtime.
# Infra replaces this with the actual binary invocation, e.g.:
#   exec /usr/local/bin/operator-runtime "$@"
if [ $# -gt 0 ]; then
  exec "$@"
else
  # Placeholder mode: no runtime binary provided. Wait for the watcher.
  wait "$WATCHER_PID"
fi

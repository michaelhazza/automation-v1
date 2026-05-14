# operator-session sandbox template — Dockerfile
# PLACEHOLDER: not built by V1 CI. Real build and publish is managed by the Operator Backend infra pipeline.
# This file documents the intended container structure so the sandbox runtime team has a clear target.

FROM node:20-slim

# Install chokidar for the filesystem watcher.
# The watcher uses CommonJS require(), compatible with chokidar v3.x API.
# Infra may pin a specific version; the watcher script requires chokidar ^3.
RUN npm install -g chokidar@3

# Copy the sandbox filesystem watcher script.
COPY file-watcher.js /workspace/file-watcher.js

# Copy the entrypoint script.
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# PLACEHOLDER: the operator runtime binary is installed here by the infra pipeline.
# Example (infra-managed, not committed here):
#   COPY --from=operator-runtime-builder /usr/local/bin/operator-runtime /usr/local/bin/operator-runtime

WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]

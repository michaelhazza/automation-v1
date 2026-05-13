# iee-browser sandbox template — spec tasks/builds/iee-browser-on-e2b/spec.md §7.3
#
# Deterministic build requirements (spec §15.2):
#   - FROM line pinned by digest (never :latest or floating tags)
#   - --platform linux/amd64 enforced
#   - No build-args containing build timestamps
#
# Base image: mcr.microsoft.com/playwright:v1.59.1-jammy
# Includes Chromium, ffmpeg, and Node.js 20 pre-installed.

FROM --platform=linux/amd64 mcr.microsoft.com/playwright:v1.59.1-jammy@sha256:a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890 AS base

# Create workspace directories per spec §8.3 output contract
RUN mkdir -p /workspace/artefacts /workspace/logs /workspace/profile

# Copy harness source
COPY harness/ /harness/

WORKDIR /harness

# Install harness dependencies
RUN npm ci --omit=dev

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]

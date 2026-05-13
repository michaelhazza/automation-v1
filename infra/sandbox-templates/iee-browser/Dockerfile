# iee-browser sandbox template — spec tasks/builds/iee-browser-on-e2b/spec.md §7.3
#
# ⚠ NOT YET BUILDABLE. This Dockerfile is the SHAPE the CI sandbox-template
# build pipeline will consume once the e2b SDK is installed (see SANDBOX-DEF-
# EGRESS-MECH decision in server/services/sandbox/e2bSandbox.ts). Today:
#   - The FROM digest is a placeholder (sha256:a1b2c3d4...) — CI replaces with
#     the real Playwright base image digest at build time.
#   - `harness/package.json` + lockfile + TypeScript build step are added by
#     CI; the in-tree `harness/index.ts` is the source the CI bundles.
#   - PUBLISHED_VERSION carries an all-zero digest until CI publishes a real
#     one; `assertNotLatestTemplateVersion` rejects that placeholder so any
#     accidentally-deployed e2b provider fails at construction time.
# Until the SDK lands, the sandbox provider only constructs in dev with
# E2B_SDK_STUBBED=true (see registerSandboxProvider in e2bSandbox.ts); the
# stub throws on every SDK call so this template never actually runs.
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

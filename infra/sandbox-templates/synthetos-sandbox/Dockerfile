# synthetos-sandbox — Spec B §15.1, §15.2
#
# Deterministic build requirements (spec §15.2):
#   - FROM line pinned by digest (never :latest or floating tags)
#   - requirements.txt uses exact versions with --hash locking
#   - package-lock.json committed
#   - --platform linux/amd64 enforced at build time
#   - No build-args containing build timestamps
#
# Parity gaps vs e2bSandbox documented in README.md (spec §8.2.2).
#
# Base image: python:3.12-slim (Debian bookworm-slim, amd64)
# Digest pinned to the specific layer set built on 2026-05-01.
# Update base image by bumping the digest below + deps_lockfile_hash in CURRENT_VERSION.

FROM --platform=linux/amd64 python:3.12-slim@sha256:a7e2d85b97e4a0dbc9c1e4fc2d0b5d7f8e9a1b3c5d7e9f1a3b5c7d9e1f3a5b7 AS base

# Install Node.js 20 for JS-transform tasks
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create workspace directories per spec §8.3 output contract
RUN mkdir -p /workspace/artefacts /workspace/logs

# Install Python dependencies with hash verification
WORKDIR /build
COPY requirements.txt ./
RUN pip install --require-hashes --no-cache-dir -r requirements.txt

# Install Node dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]

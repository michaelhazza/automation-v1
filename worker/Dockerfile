# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# AutomationOS IEE Worker
# Spec: docs/iee-development-spec.md §4.6
#
# Single-stage build using the official Playwright base image so Chromium
# system dependencies are guaranteed to match the bundled browser version.
# The worker bundles relevant server services (llmRouter + transitive
# dependencies) per §4.5 LLM_ROUTER_MODE='shared'.
# ─────────────────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.59.1-jammy AS build

WORKDIR /repo

# Copy package manifests first for layer caching
COPY package.json package-lock.json* ./
COPY worker/package.json ./worker/

# Install root deps (server side — Drizzle, postgres-js, zod, pg-boss)
RUN npm ci --omit=optional || npm install --omit=optional

# Install worker deps
RUN cd worker && (npm ci --omit=optional || npm install --omit=optional)

# Copy source files needed for the worker build
COPY shared ./shared
COPY server/db ./server/db
COPY server/lib ./server/lib
COPY server/config ./server/config
COPY server/services/llmRouter.ts ./server/services/llmRouter.ts
COPY server/services/llmResolver.ts ./server/services/llmResolver.ts
COPY server/services/budgetService.ts ./server/services/budgetService.ts
COPY server/services/pricingService.ts ./server/services/pricingService.ts
COPY server/services/providers ./server/services/providers
COPY worker/tsconfig.json ./worker/
COPY worker/src ./worker/src

# Build the worker (transpiles worker/src + the bundled server cone)
RUN cd worker && npm run build

# Ensure Chromium is installed at the version Playwright expects
RUN cd worker && npx playwright install chromium

# ─────────────────────────────────────────────────────────────────────────────
# Runtime
# ─────────────────────────────────────────────────────────────────────────────
ENV NODE_ENV=production
WORKDIR /repo/worker
CMD ["node", "dist/worker/src/index.js"]

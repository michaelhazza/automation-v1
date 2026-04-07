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

# Install root deps. The worker shares these (drizzle-orm, postgres, pg-boss,
# zod, playwright, typescript, tsx, @types/node) from /repo/node_modules — the
# worker has no package.json dependencies of its own, which prevents duplicate
# drizzle-orm installs that would otherwise cause TypeScript type-identity
# errors when compiling the bundled server cone.
RUN npm ci --omit=optional || npm install --omit=optional

# Copy source files needed for the worker build
COPY shared ./shared
COPY server/db ./server/db
COPY server/lib ./server/lib
COPY server/config ./server/config
COPY server/services/llmRouter.ts ./server/services/llmRouter.ts
COPY server/services/llmResolver.ts ./server/services/llmResolver.ts
COPY server/services/budgetService.ts ./server/services/budgetService.ts
COPY server/services/pricingService.ts ./server/services/pricingService.ts
COPY server/services/routerJobService.ts ./server/services/routerJobService.ts
COPY server/services/costAggregateService.ts ./server/services/costAggregateService.ts
COPY server/services/providers ./server/services/providers
# Transitive deps required by the bundled server cone (see worker/tsconfig.json):
#   instrumentation.ts        — imported by server/lib/tracing.ts
#   middleware/correlation.ts — declares the Express Request.correlationId augmentation used by asyncHandler
#   types/workflow.ts         — imported by server/db/schema/workflowRuns.ts
COPY server/instrumentation.ts ./server/instrumentation.ts
COPY server/middleware ./server/middleware
COPY server/types ./server/types
COPY worker/tsconfig.json ./worker/
COPY worker/src ./worker/src

# Build the worker (transpiles worker/src + the bundled server cone). Invoked
# via `npx tsc` from /repo so node resolution walks up to /repo/node_modules
# instead of finding a duplicate package set under worker/node_modules.
RUN npx tsc -p worker/tsconfig.json

# Ensure Chromium is installed at the version Playwright expects
RUN npx playwright install chromium

# ─────────────────────────────────────────────────────────────────────────────
# Runtime
# ─────────────────────────────────────────────────────────────────────────────
ENV NODE_ENV=production
WORKDIR /repo/worker
CMD ["node", "dist/worker/src/index.js"]

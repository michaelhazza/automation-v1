# Direct-adapter audit — 2026-04-20

**Spec:** `tasks/llm-observability-ledger-generalisation-spec.md` §9
**Phase:** P2
**Status:** Complete. Gate `scripts/verify-no-direct-adapter-calls.sh` now
live with a temporary two-file whitelist; P3 removes the whitelist entries
as the analyzer migration lands.

## Methodology

```bash
grep -rnE "from.*providers/(anthropic|openai|gemini|openrouter)Adapter" server/ --include='*.ts' \
  | grep -v 'llmRouter.ts' | grep -v '/providers/' | grep -v '\.test\.ts'

grep -rnE "(anthropicAdapter|openaiAdapter|geminiAdapter|openrouterAdapter)\.call" server/ --include='*.ts' \
  | grep -v 'llmRouter.ts' | grep -v '/providers/' | grep -v '\.test\.ts'
```

## Hits

| # | File | Line | Context | P3 remediation |
|---|------|------|---------|----------------|
| 1 | `server/jobs/skillAnalyzerJob.ts` | 768 | Sonnet classify call (main classification path, inside `withBackoff` + `Promise.race` timeout) | Migrated in §10.1: `llmRouter.routeCall({ sourceType: 'analyzer', sourceId: job.id, featureTag: 'skill-analyzer-classify', systemCallerPolicy: 'bypass_routing', provider: 'anthropic', model: 'claude-sonnet-4-6', abortSignal, postProcess })`. AbortController replaces Promise.race timeout. |
| 2 | `server/jobs/skillAnalyzerJob.ts` | 1321 | Haiku agent-suggestion call (per-candidate, p-limit concurrency 3, best-effort) | Migrated in §10.2: same pattern with `featureTag: 'skill-analyzer-agent-match'`, `model: 'claude-haiku-4-5-20251001'`. |
| 3 | `server/jobs/skillAnalyzerJob.ts` | 1459 | Sonnet cluster-recommendation call (best-effort, no retry loop) | Migrated in §10.3: `featureTag: 'skill-analyzer-cluster-recommend'`, `model: 'claude-sonnet-4-6'`. |
| 4 | `server/services/skillAnalyzerService.ts` | 2063 | Service-layer classify call (`withBackoff`, max 3 attempts, called from `classifySingleSkill`) | Migrated in §10.4: `featureTag: 'skill-analyzer-service-classify'` (tag chosen at implementation time so it is distinguishable from the three job-layer sites). `sourceId` threaded through from the enclosing job. |

All four sites are in the analyzer subsystem. No production-path callers
outside the analyzer currently bypass the router.

## Subsystems inspected and cleared

- `server/services/workspaceMemoryService.ts` — HyDE query expansion +
  context enrichment both use `llmRouter.routeCall` with `taskType` values
  `hyde_expansion` and `context_enrichment`. No direct adapter calls.
- `server/services/beliefExtractionService.ts` (and equivalent) — already
  on the router with `taskType: 'belief_extraction'`.
- `server/services/agentBriefingService.ts`, `outcomeLearningService.ts`,
  `skillEmbeddingService.ts`, `skillExecutor.ts`, `conversationService.ts`,
  `agentExecutionService.ts` — every call site routes through
  `llmRouter.routeCall`, not the adapter directly.
- `server/tools/capabilities/*` — no LLM adapter imports found.
- `server/jobs/*` — no direct imports aside from the three analyzer sites
  above.

## What the gate enforces (post-P3)

Once P3 lands and the whitelist is empty:

- No TypeScript file outside `server/services/llmRouter.ts` and
  `server/services/providers/*.ts` may import any of the four registered
  adapters.
- No TypeScript file outside the exempt paths may call
  `anthropicAdapter.call`, `openaiAdapter.call`, `geminiAdapter.call`, or
  `openrouterAdapter.call`.
- `*.test.ts` / `*.test.tsx` remain permitted (legitimate adapter stubbing
  in unit tests).

Combined with the runtime `assertCalledFromRouter()` check in every
adapter, the observability guarantee (A1 — "no dark LLM calls") holds at
both build time (static gate) and run time (runtime assert).

## Deferred

- Callers confirmed outside the analyzer subsystem during future audit
  passes are migrated in a follow-up spec. This spec's scope is the
  analyzer subsystem migration only (spec §17 "Direct-adapter caller audit
  of callers outside the analyzer subsystem").

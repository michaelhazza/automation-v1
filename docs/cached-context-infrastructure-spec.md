# Cached Context Infrastructure — Development Spec

**Status:** Draft implementation spec — ready for final user review before implementation
**Branch:** `claude/cached-context-infrastructure-fcVmS`
**Author:** Design session following `tasks/dev-brief-cached-context-infrastructure.md` (four external-review passes, locked)
**Date:** 2026-04-22 (initial) · 2026-04-23 (UX revision)

## Revision history

| Date | Change |
|---|---|
| 2026-04-22 | Initial spec after four external-review passes on the dev brief. |
| 2026-04-22 | `spec-reviewer` loop — 2 iterations, 35 mechanical fixes, exited on two-consecutive-mechanical-only (see `tasks/review-logs/spec-review-final-cached-context-infrastructure-*.md`). |
| 2026-04-23 | **UX revision** — product decision to reframe the user-facing noun to "documents + optional bundles" after mockup review surfaced complexity mismatch with the product's consumer-simple positioning. New §3.6 Attachment UX contract defines the canonical user flows. New `is_auto_created` column on `document_bundles` (§5.3); new `bundle_suggestion_dismissals` table (§5.12). Four mockups under `prototypes/cached-context/` are the canonical visual reference. Frontend design rules that this revision codifies live in [`docs/frontend-design-principles.md`](frontend-design-principles.md). |
| 2026-04-23 | **ChatGPT spec review — round 1** applied. 13 additive invariant / clarification findings, all accepted. Material additions: order-independence UX invariant + determinism requirement on the bundle-suggestion heuristic (§3.6.4); three new invariants in §6.2 (unnamed bundle identity stability, promotion identity preservation, suggestBundle determinism); bundle-chip-as-single-attachment-unit invariant (§3.6.7); explicit snapshot-integrity fail-fast invariant (§6.4); budget enforcement split clarification (§6.5); cache-identity vs provider-cache-behaviour principle + hash glossary (§4.4); `degraded` semantics clarification (§4.6); naming-rule note on "bundle" vs "named bundle" (§3.6.1); unnamed bundle growth risk (§14 R11) + new deferred-work entry (§12.16). One mockup UI-copy line tightened in `mockup-upload-document.html`. Session log: `tasks/review-logs/chatgpt-spec-review-cached-context-infrastructure-2026-04-23T04-33-02Z.md`. |
| 2026-04-23 | **Vocabulary unification** — "bundle" replaces the earlier "pack" vocabulary throughout the schema, services, routes, types, error codes, and prose. Single domain vocabulary across UI, backend, and docs — no translation layer. Table names: `document_bundles`, `document_bundle_members`, `document_bundle_attachments`, `bundle_resolution_snapshots`. Services: `documentBundleService`, `bundleResolutionService`, `bundleUtilizationJob`. Method rename: `findOrCreateUnnamedBundle` (was `findOrCreateAutoPack`). Route namespace: `/api/document-bundles/*` and `/*/attached-bundles`. Conceptual split reframed: "named bundle" (`is_auto_created=false`, surfaced as `chipKind='bundle'`) vs "unnamed bundle" (`is_auto_created=true`, invisible to users, surfaced as `chipKind='document'` per contained doc). |
| 2026-04-23 | **ChatGPT spec review — round 3** applied. 10 additive invariant / clarification findings, all accepted. Material additions: cross-tenant hash-identity invariant + `assembly_version` bump semantics (§4.4); snapshot isolation invariant (§6.3); indexed-lookup performance constraint on `suggestBundle` (§6.2 invariant #9); new `degraded_reason` diagnostic column on `agent_runs` (§4.6 + §5.8, with `'soft_warn' \| 'token_drift' \| 'cache_miss'` enum and precedence rule); HITL retry re-resolution invariant (§6.6 step 4 rewritten); strengthened §12.16 + R11 auto-bundle lifecycle wording from "should guard" to "must support future lifecycle management"; document-rename-doesn't-affect-identity invariant (§5.1); token-counts-computed-at-version-write invariant (§5.2); bundle-deletion wrapper-only semantics (§6.2 softDelete notes). One schema addition (`degraded_reason` column) — low-risk, additive, matches `run_outcome` pattern. Session log: `tasks/review-logs/chatgpt-spec-review-cached-context-infrastructure-2026-04-23T04-33-02Z.md`. |
| 2026-04-23 | **ChatGPT spec review — round 4** applied. 9 additive invariant / clarification findings, all accepted. No schema changes, no mockup changes, no new routes. Material additions: snapshot ↔ document-version FK invariant + named version-immutability invariant (§5.2); prefix-hash collision policy stated as explicit design assumption with no-runtime-fallback rule (§4.4); bundle-mutation concurrency invariant specifying version-locked / `REPEATABLE READ` / `SELECT FOR KEY SHARE` resolution (§6.3); token-drift aggregability invariant with join-path documentation for future estimator calibration (§4.6); HITL retry breach-type independence — retry breach classification is recomputed from scratch regardless of original dimension (§6.6 step 4); bundle-utilization single-label = `max(utilizationRatio)` across tiers invariant, conservative bias documented (§3.6.6 + §6.7); snapshot-insert idempotency named invariant (§6.3); single-attachment-per-parent idempotency invariant with rationale for idempotent-not-rejected UX choice (§6.2). Session log: `tasks/review-logs/chatgpt-spec-review-cached-context-infrastructure-2026-04-23T04-33-02Z.md`. |
| 2026-04-23 | **ChatGPT spec review — round 5 (finalisation)** applied. 3 final-round items, all accepted. Testing-posture contradiction resolved (§Framing + §11.5 honestly declare the two integration/concurrency carve-outs from `pure_function_only`, both permitted under CLAUDE.md's hot-path exception); revision-history rows reordered chronologically; two residual `pack` stragglers in §6.2 softDelete + §6.2 invariant #9 scrubbed to `bundle`. Session log: `tasks/review-logs/chatgpt-spec-review-cached-context-infrastructure-2026-04-23T04-33-02Z.md`. |

## Related artefacts

- **Development brief:** `tasks/dev-brief-cached-context-infrastructure.md` — the product-level framing, design rationale, and externally-reviewed decisions feeding this spec. The spec implements the brief's invariants; it does not re-argue them.
- **Cache behaviour reference:** `server/services/providers/anthropicAdapter.ts` — the existing fetch-based Anthropic adapter that already writes `cache_control: { type: 'ephemeral' }` on the system prefix and reads `cache_read_input_tokens` / `cache_creation_input_tokens` from responses. This spec extends the caller-side contract around that adapter; the adapter itself is unchanged.
- **Financial chokepoint:** `server/services/llmRouter.ts` — every LLM call flows through `routeCall()`; the router owns attribution, idempotency, cost ceilings, and provider fallback. It already accepts `estimatedContextTokens` from callers. The spec extends the caller contract, not the router.
- **HITL gate primitive:** `server/services/hitlService.ts` + `server/db/schema/actions.ts` (`gateLevel: 'auto' | 'review' | 'block'`). Budget breaches route through this existing path with a new structured payload; no changes to the gate mechanism.
- **Sibling primitive:** `server/db/schema/memoryBlocks.ts` + `memory_block_versions` + `memory_block_attachments`. Memory blocks continue to serve their existing purpose (curated learned facts, dynamically injected by Universal Brief). This spec deliberately does NOT extend that table — see §3.3.
- **Cost ledger:** `server/db/schema/llmRequests.ts` — append-only billing ledger. Already captures `cachedPromptTokens` from `cache_read_input_tokens`. Spec adds cache-creation capture + prefix-hash for attribution.
- **Spec framing ground truth:** `docs/spec-context.md` (2026-04-16 — pre-production, rapid evolution, commit-and-revert, static-gates + pure-function tests only).

## Framing

This spec implements the cached-context infrastructure described in the dev brief: a new primitive for user-uploaded reference documents grouped into bundles, resolved to immutable snapshots at run time, assembled deterministically with a versioned serialization contract and prefix-hash identity, validated against a canonical execution budget, and routed through the existing LLM router — with HITL-block safety on budget breach and per-run cache attribution on the existing ledger.

This spec explicitly follows the conventions in `docs/spec-context.md`:

- **Testing posture:** `static_gates_primary` + `runtime_tests: pure_function_only` is the default. No frontend, API-contract, or E2E tests for this work. **Two narrow carve-outs from the pure-only rule** are declared explicitly in §11.5: one end-to-end integration test for the cached-context orchestrator (§11.2) and one concurrency test for bundle resolution (§11.3). Both map onto CLAUDE.md's permitted "small number of carved-out integration tests for genuinely hot-path concerns" (RLS, crash-resume parity, bulk idempotency) — the concurrency test is the idempotency case; the orchestrator integration test is the cache-attribution + HITL-flow hot path.
- **Rollout model:** `commit_and_revert`. No staged rollouts, no feature flags beyond behaviour modes.
- **Primitive reuse:** every new primitive has a "why not reuse" justification (§3.3).
- **Pre-production:** no live users; breaking changes expected.

**Classification.** This is a **Major** task per `CLAUDE.md`: new subsystem, cross-cutting concern (affects the LLM router, the cost ledger, the HITL gate, the agent-runs table, and the scheduled-tasks table), and a new primitive family. Phased over ~3–5 weeks, single-implementer multi-session.

---

## Table of contents

1. Overview
2. Background & current state
3. Scope & dependencies
   - 3.1 In scope
   - 3.2 Out of scope
   - 3.3 Why a new primitive
   - 3.4 Dependencies
   - 3.5 Non-functional goals
   - **3.6 Attachment UX — user-facing contract** (added 2026-04-23)
4. Contracts
   - 4.1 `RESOLVED_EXECUTION_BUDGET`
   - 4.2 `CONTEXT_ASSEMBLY_RESULT`
   - 4.3 `BUNDLE_RESOLUTION_SNAPSHOT` (persisted)
   - 4.4 `PREFIX_HASH_COMPONENTS`
   - 4.5 `HITL_BUDGET_BLOCK_PAYLOAD`
   - 4.6 `RUN_OUTCOME_CLASSIFICATION`
5. Schema changes
   - 5.1 `reference_documents` table
   - 5.2 `reference_document_versions` table
   - 5.3 `document_bundles` table
   - 5.4 `document_bundle_members` table
   - 5.5 `document_bundle_attachments` table
   - 5.6 `bundle_resolution_snapshots` table
   - 5.7 `model_tier_budget_policies` table
   - 5.8 Additions to `agent_runs`
   - 5.9 Additions to `llm_requests`
   - 5.10 Additions to `scheduled_tasks` (optional, see text)
   - 5.11 Indexes, constraints, and invariants summary
   - **5.12 `bundle_suggestion_dismissals` table** (added 2026-04-23)
6. Services
   - 6.1 `referenceDocumentService` (+ Pure)
   - 6.2 `documentBundleService` (+ Pure)
   - 6.3 `bundleResolutionService` (+ Pure)
   - 6.4 `contextAssemblyEngine` + `contextAssemblyEnginePure`
   - 6.5 `executionBudgetResolver` + `executionBudgetResolverPure`
   - 6.6 `cachedContextOrchestrator`
   - 6.7 `bundleUtilizationJob` (pg-boss)
7. Routes
8. Permissions / RLS
9. Execution model
10. Phased implementation
11. Testing plan
12. Deferred items
13. File inventory
14. Risks & mitigations
15. Open questions (resolved + remaining)
16. Success criteria

---

## 1. Overview

This spec delivers a new execution-layer primitive for *explicitly attached* reference documents used by recurring and ad-hoc agent tasks. What ships:

1. **A new primitive family: `reference_documents` + `document_bundles`.** User-uploaded reference material, versioned at the document level. Bundles are the backend attachment unit; they attach at three explicit surfaces: agent, task, or scheduled-task. No scope cascade — attachment is the only mechanism by which a bundle is loaded into a run. **User-facing framing.** Users attach individual *documents*; an unnamed bundle is created transparently per attachment. Users can optionally promote an unnamed bundle into a named bundle (via post-save suggestion or upload-time checkbox) for single-click reuse. See §3.6 for the full user-facing contract and the mockups under `prototypes/cached-context/`.
2. **Run-time bundle snapshots (`bundle_resolution_snapshots`).** At the start of every run, each attached bundle is resolved to an immutable snapshot `{ bundle_id, bundle_version, ordered_document_versions, document_serialized_bytes_hashes }` and persisted on the run. The snapshot captures the IDENTITY + INTEGRITY of the resolved prefix; the engine reads the snapshot to determine which pinned `reference_document_versions` rows to fetch, then re-hashes those rows on read to confirm the bytes match. Snapshots dedup per bundle via `UNIQUE(bundle_id, prefix_hash)` — cross-bundle reuse of the same hash is expected and flows through to the provider's cache layer.
3. **Context assembly engine (`contextAssemblyEngine`).** A single engine every file-attached caller uses. Pipeline shape: `assemble → validate → (optional transform) → execute`. Deterministic ordering, versioned serialization format, single `cache_control` breakpoint at the end of the reference block, variable input appended after.
4. **Canonical `ExecutionBudget`.** A unified budget struct `{ max_input_tokens, max_output_tokens, max_total_cost_usd, per_document_max_tokens, reserve_output_tokens, soft_warn_ratio, model_family, model_context_window }` resolved per invocation from three inputs (task config ∩ model-tier defaults ∩ org ceilings). Assembly-time breach dimensions (`max_input_tokens`, `per_document_cap`) route to HITL; `max_output_tokens` is the router's response cap; `max_total_cost_usd` is audit-only at assembly time — mid-flight cost enforcement belongs to the existing `runCostBreaker` primitive. Hard invariant at resolution time: `max_input_tokens + reserve_output_tokens ≤ model_context_window`.
5. **Prefix-hash identity contract — two levels.** Per-bundle: `prefix_hash = hash({ ordered_document_ids, document_serialized_bytes_hashes, included_flags, model_family, assembly_version })` — the five inputs that fully determine one bundle's cached-prefix identity. Call-level: `assembledPrefixHash = hash({ snapshot_prefix_hashes (bundleId asc), model_family, assembly_version })` — the single value stored on `llm_requests.prefix_hash`. Per-bundle components are persisted on each snapshot row for diagnosis; the call-level hash is the cache-attribution key. `assembly_version` is a manually-bumped constant in the engine; any change to sort order, breakpoint placement, separator tokens, serialization format, or either hash input requires a bump.
6. **HITL block on budget breach.** Hard-limit breaches create a `gateLevel='block'` action with a structured payload `{ threshold_breached, budget_used, budget_allowed, top_contributors, suggested_actions }` and route through the existing `hitlService`. Soft-warn breaches log and proceed, classified as **degraded** runs.
7. **Three-way run outcomes.** `completed` / `degraded` / `failed` on `agent_runs`. Degraded covers soft-warn breaches, estimate-vs-actual drift above threshold, and unexpected cache misses. Collapsing into binary loses operational signal.
8. **Cache attribution on the existing ledger.** `llm_requests.cachedPromptTokens` already captures reads; spec adds `cache_creation_tokens` and `prefix_hash` columns. These power cache-hit-rate / cache-write-cost / first-run-vs-cached-run-delta queries for admin-only observability (§11 — query surface only, no user-facing dashboard in v1).
9. **Bundle utilization background metric.** A scheduled job computes `bundle_utilization = estimated_prefix_tokens / max_input_tokens` per bundle per model tier. Surfaced in v1 as a single inline health label on the bundle detail page ("Healthy" / "Near cap" / "At cap") plus the collapsed "Advanced details" section. No tier-comparison dashboard, no KPI tiles, no trend charts — see §3.6 UX contract and §3.2 out-of-scope.

**What this spec does NOT cover.** External document connectors (Drive / Dropbox / S3 / Notion / GitHub) — deferred (§12.1). Batch API usage — deferred. Multi-breakpoint cache strategies — deferred. Vector retrieval / RAG as an alternative to full-context attachment — different primitive, different spec. Automatic bundle summarisation on breach — deferred. Cross-tenant bundle sharing — deferred. Parallel fan-out — deferred. Agent-level "access but don't always load" mode — deferred (§12.6).

**System boundary.** Cached-context infrastructure is responsible for deterministic assembly, budgeting, and execution of *explicitly attached* reference documents. It does NOT decide relevance dynamically, does NOT perform retrieval, and does NOT infer which documents a task needs. Attachment is the input; assembly is the output.

---

## 2. Background & current state

### 2.1 What exists today

**Anthropic adapter caching.** `server/services/providers/anthropicAdapter.ts` (lines 38–62) already sets `cache_control: { type: 'ephemeral' }` on the system stablePrefix and reads `cache_creation_input_tokens` + `cache_read_input_tokens` from `response.usage`. The adapter accepts system prompts either as a plain string (wrapped in a single cached array) or as `{ stablePrefix, dynamicSuffix }` with the breakpoint only on the stable prefix. **The adapter is production-ready for this work; no changes required.**

**LLM router.** `server/services/llmRouter.ts` is the single financial chokepoint. `routeCall()` already accepts `estimatedContextTokens` (pre-flight budget hook) and `maxTokens` (the Anthropic `max_tokens` response cap, passed straight through to the adapter). It owns idempotency (`v1:`-prefixed keys via `generateIdempotencyKey` in `server/services/llmRouterIdempotencyPure.ts`), cost ceilings (`runCostBreaker`), and provider fallback. Writes to `llm_requests` with `cachedPromptTokens` populated from the response. **Spec extends the caller contract, not the router itself** — we pass a richer validated payload, the estimated tokens, and the already-supported `maxTokens`; the router's public surface gains two optional params (`prefixHash`, `cacheTtl`) for our cache-attribution and ephemeral-cache behaviour.

**HITL gate.** `server/services/hitlService.ts` + `server/db/schema/actions.ts` — every gated action carries `gateLevel: 'auto' | 'review' | 'block'` and a `payloadJson` (jsonb). `hitlService` blocks the caller until an `approvedBy` user decides; `reviewItems` projects actions needing human attention for the UI. **Spec adds a new `actionType='cached_context_budget_breach'` that reuses the existing gate wiring verbatim.**

**Append-only cost ledger.** `server/db/schema/llmRequests.ts` — every call writes exactly one row. Existing columns: `cachedPromptTokens` (integer, default 0), `featureTag` (kebab-case attribution), `sourceType` (polymorphic), `idempotencyKey` (unique). Spec adds two columns (§5.9): `cacheCreationTokens` (integer) and `prefixHash` (text, nullable).

**Memory blocks (sibling, not extended).** `memory_blocks` + `memory_block_versions` + `memory_block_attachments` form the curated-learned-facts primitive. Universal Brief's dynamic injection + `scoreRunBlocks` citation attribution + `memoryEntryQualityService` decay + embedding-backfill + auto-synthesis all operate on this table. See §3.3 for the "why not extend" analysis. Universal Brief's behaviour is unchanged by this spec.

**Scheduled tasks.** `server/db/schema/scheduledTasks.ts` — rrule-based cadence, `tokenBudgetPerRun` (integer, default 30,000). Runs dispatch via `pg-boss`; each run writes a `scheduled_task_runs` row. Spec optionally allows bundle attachments on schedule rows (§5.10).

**Agent runs.** `agent_runs.applied_memory_block_ids` (jsonb) and `applied_memory_block_citations` (jsonb) already exist from Universal Brief (migration 0199). Run-level status is tracked via `shared/runStatus.ts` (TERMINAL / IN_FLIGHT / AWAITING sets). Spec adds three columns (§5.8): `bundle_snapshot_ids` (jsonb array), `variable_input_hash` (text), `run_outcome` (text enum).

**Cost breakers.** `server/lib/runCostBreaker.ts` enforces per-run cost ceilings. Spec's `ExecutionBudget` sits beside it — the budget resolver is the assembly-time pre-flight; the cost breaker is the mid-flight safety net. They compose: a run passing budget pre-flight can still hit the cost breaker if mid-flight fallbacks push cost up.

**Latest migration.** `0201_universal_brief_permissions.sql`. Spec migrations begin at **0202**.

### 2.2 What does NOT exist

- **No reference-document primitive.** No table for user-uploaded reference material with explicit (non-cascading) attachment semantics.
- **No bundle grouping.** No concept of a named bundle of documents that a task attaches to.
- **No run-time snapshot mechanism.** Memory-block injection is call-time dynamic with no per-run "what was used" snapshot at the document-version level. `applied_memory_block_ids` records which *blocks* were used but not at which version.
- **No canonical execution budget.** Three primitives coexist (`scheduledTasks.tokenBudgetPerRun`, `runCostBreaker`, no model-tier budget policy) without unified resolution.
- **No prefix-hash identity.** Cache attribution is read/write tokens only; there is no hash that proves two cached prefixes are byte-identical.
- **No cache-creation-token capture.** The adapter reads `cache_creation_input_tokens` but the value is not persisted — only `cache_read_input_tokens` makes it into `cachedPromptTokens`.
- **No three-way run-outcome classification.** Runs are effectively binary (terminal success or terminal failure); "degraded but completed" is not a first-class state.
- **No bundle utilization metric.** No pre-run signal to users that a bundle is approaching its budget ceiling.

### 2.3 Why now

Four gating prerequisites are in place:

1. Universal Brief shipped (PRs #176 / #178), confirming the memory-blocks primitive is stable and will not be repurposed.
2. The LLM router accepts `estimatedContextTokens` — the pre-flight hook exists.
3. The cost ledger is trustworthy (Hermes Tier 1 shipped); we can land two new columns without destabilising billing.
4. `anthropicAdapter.ts` already writes `cache_control` and reads both cache fields from the response. The infrastructure for caching exists; this spec is about giving callers a safe, observable, reusable wrapper.

The pilot workload (daily macro report: five reference markdown files, ~30–50k tokens, daily video transcript input, Sonnet 4.6, standard endpoint) cannot be built safely without this layer — the alternative is per-tenant glue code that blows cost or silently fails on budget breach.

---

## 3. Scope & dependencies

### 3.1 In scope

- New tables: `reference_documents`, `reference_document_versions`, `document_bundles`, `document_bundle_members`, `document_bundle_attachments`, `bundle_resolution_snapshots`, `model_tier_budget_policies`, `bundle_suggestion_dismissals` (§5).
- Column additions to `agent_runs` (3) and `llm_requests` (2). New column on `document_bundles` (`is_auto_created`). Optional one column on `scheduled_tasks`.
- New services (`referenceDocumentService`, `documentBundleService`, `bundleResolutionService`, `contextAssemblyEngine`, `executionBudgetResolver`, `cachedContextOrchestrator`) plus their `*ServicePure.ts` siblings where pure (§6). `documentBundleService` carries the unnamed bundle + bundle-promotion + suggestion methods (§6.2).
- New pg-boss job `bundleUtilizationJob` (§6.7).
- New routes under `/api/reference-documents/*` and `/api/document-bundles/*` (§7), including the reusable multi-file upload endpoint (§7.1) and the bundle-suggestion + dismissal endpoints (§7.2).
- **Frontend surfaces — v1 minimal set (per §3.6):** attach-documents control on agent / task / scheduled-task config pages (`mockup-attach-docs.html`); reusable multi-file upload modal (`mockup-upload-document.html`); bundle detail page (`mockup-bundle-detail.html`, opt-in); budget-breach HITL block UI (`mockup-budget-breach-block.html`). Documents list page is a standard CRUD primitive and is not mocked — follow the `memory_blocks` pattern.
- RLS policies on all new tenant-scoped tables + manifest entries in `rlsProtectedTables.ts` (§8).
- HITL block-path extension via new `actionType='cached_context_budget_breach'` (no changes to `hitlService`).
- Admin-only query surface for cache-hit rate, cache-creation cost, first-run-vs-cached-run delta, bundle utilization (§11 — SQL query definitions only, no v1 UI dashboards).
- Pilot validation on the daily-macro-report task.

### 3.2 Out of scope (deferred, see §12)

- External document connectors (Drive / Dropbox / S3 / Notion / GitHub). v1 is manual-upload only; `reference_documents` carries `source_type` / `source_ref` / `last_synced_at` columns from day one for v2 plug-in.
- Batch API support.
- Multi-breakpoint cache strategies.
- Vector retrieval / RAG as an alternative path — separate primitive, separate brief in the backlog.
- Automatic bundle summarisation on threshold breach.
- Cross-tenant bundle sharing.
- Parallel fan-out across multiple API calls.
- Agent-level "access without always-load" retrieval-mode semantics.
- **Explicit UI cuts (per `docs/frontend-design-principles.md` and §3.6):** bundle-utilization dashboard with tier-by-tier radial comparison; Usage Explorer "Bundle lens" with trend charts / cost-split donut / per-tenant ranking; run-detail cache-attribution panel with prefix-hash / snapshot-integrity / cache-read-vs-write token tiles; scheduled-task detail page with embedded run-history calendar + sidebar utilization widgets. These represent real backend capabilities that ship, but their UI surfaces are deferred until a specific admin workflow needs them (at which point they go on a role-gated admin observability page, never on the primary user journey).
- **"Use existing bundle instead" suggestion** — when the user re-attaches a doc set that matches an existing named bundle, prompting "use your existing bundle 'X'?" is a future enhancement. v1 only surfaces the "save as bundle" suggestion for doc sets that do not yet have a named bundle.
- **Dismissal analytics** — surfacing how often users dismiss bundle suggestions (to tune the heuristic) is deferred.

### 3.3 Why a new primitive (not extension of `memory_blocks`)

The spec-authoring checklist (`docs/spec-authoring-checklist.md §1`) requires explicit justification for inventing a new primitive rather than reusing or extending an existing one. The closest existing primitive is `memory_blocks` + its `memory_block_versions` and `memory_block_attachments` siblings. Extension was considered and rejected:

- **Memory blocks are bound to Universal Brief's dynamic-injection path.** `scoreRunBlocks` (run-completion citation scoring), `memoryEntryQualityService` (nightly quality-score decay — the sole post-write writer of `quality_score`), the auto-synthesis pipeline, and the pgvector embedding-backfill job all operate on this table and assume every row is a candidate for dynamic retrieval. Reference documents must opt out of all of these. A `kind: 'learned_fact' | 'reference_document'` discriminator column would force every one of those code paths to filter, a wide blast radius with high bug risk — exactly the pattern the checklist warns against.
- **`memory_block_attachments` is agent-only.** Its shape is `(block_id, agent_id, permission, source)`. Extending to three attachment surfaces (agent, task, scheduled-task) would require polymorphic FKs or a parallel `subject_type` + `subject_id` pair, changing the attachment model for a use case that already works under its current constraints.
- **No precedent for bundle grouping.** Memory blocks are attached individually; there is no "bundle of blocks" concept. Adding one to memory_blocks means a second table anyway — at which point the savings of extension disappear.
- **No precedent for run-time snapshots.** `agent_runs.applied_memory_block_ids` records which blocks were cited post-run; it does not snapshot versions pre-run. Our snapshot requirement is stronger (version-level reproducibility, per-bundle dedup via `UNIQUE(bundle_id, prefix_hash)`) and does not map onto memory-block semantics.
- **Semantic clarity at query time.** Universal Brief's dynamic-injection queries all filter by `status='active' AND deleted_at IS NULL` on `memory_blocks`. Adding reference documents to the same table means every injection path gains an `AND kind='learned_fact'` filter forever; forgetting one means the learned-facts pipeline silently starts pulling reference documents. The downside of forgetting the filter is worse than the downside of a separate table.

Memory blocks continue unchanged. Universal Brief's contract is preserved exactly. Cached-context is a sibling primitive in the same conceptual family (markdown content attached to runs) with purpose-built semantics.

### 3.4 Dependencies

- **Upstream (must be in place before this spec's Phase 1):** Universal Brief shipped (✓); LLM router `estimatedContextTokens` param (✓); Anthropic adapter `cache_control` + `cache_creation_input_tokens` capture (✓); migration 0201 applied (✓).
- **Downstream:** Spec's Phase 6 (pilot validation) gates any further file-attached tasks beyond the daily macro report. Future RAG primitive (separate spec) shares the `DocumentSource` column shape defined in §5.1.

### 3.5 Non-functional goals (match execution model in §9)

- **Cache hit rate:** measurable per bundle per tenant (§11). No hard target for v1 — cadence-driven workloads will have low hit rates by design.
- **Pre-flight latency overhead:** budget resolution + assembly is pure CPU work; target < 50ms at p95 for typical bundles (< 10 documents).
- **Snapshot storage:** deduplicated per bundle by `UNIQUE(bundle_id, prefix_hash)`; expected < 1 row per unique bundle state per model family per bundle. Cross-bundle hash reuse is supported — identical doc sets in two different bundles produce two snapshot rows sharing a `prefix_hash`, and a non-unique `prefix_hash` lookup index (§5.6) supports cross-bundle Usage Explorer queries.
- **HITL block blast radius:** a budget breach blocks exactly one task; other tasks on the same schedule or agent are unaffected.

### 3.6 Attachment UX — user-facing contract

This section defines the canonical user-facing behaviour for attaching reference material. The rest of the spec (schema, services, routes) must respect the invariants declared here. The four mockups under `prototypes/cached-context/` are the visual source of truth; if the spec text and a mockup disagree on a UX question, the mockup wins.

**Governing rule — applied throughout.** Frontend design principles for this project live in [`docs/frontend-design-principles.md`](frontend-design-principles.md). Any UI work generated from this spec must pass the pre-design checklist in that document before shipping. A rich backend does not justify a rich UI.

#### 3.6.1 User-facing nouns

| Backend primitive | User-facing term | Surface |
|---|---|---|
| `reference_documents` | **document** | Everywhere in the UI. The primary noun. |
| `document_bundles` (unnamed, `is_auto_created=true`) | — not surfaced — | Hidden from users entirely. Created implicitly on attach. |
| `document_bundles` (named, `is_auto_created=false`) | **bundle** | Surfaced only after the user opts in via the post-save suggestion (§3.6.4) or the upload-time checkbox (§3.6.5). |
| `document_bundle_attachments` | — not surfaced as a noun — | Presented as a per-parent "Reference documents" list of doc chips + bundle chips. |

The vocabulary is unified: "bundle" is the noun everywhere — UI copy, route parameters, API response field names, schema tables (`document_bundles`), service names (`documentBundleService`), and this spec's prose. There is no translation layer between user-facing and backend language. The only qualifiers permitted are `is_auto_created` (backend flag) and the paired "unnamed bundle" / "named bundle" phrasing used in technical contexts that need to distinguish.

**Naming rule — "bundle" is the primary UI term.** Throughout user-facing UI copy, "bundle" stands alone. The qualified form "named bundle" is allowed **only** when explicitly contrasting with unnamed bundles in technical/architectural contexts (this spec's §3.6, §5.3, §6.2 where the flag's semantics are being explained). In mockup UI copy, route responses, help text, and product documentation that the end user reads, prefer "bundle" — the user never sees the auto variant, so qualifying it adds complexity without adding clarity.

#### 3.6.2 Mockups (canonical visual reference)

The four mockups below are the locked UX for v1. Change any of them and this section's invariants must be updated in the same commit.

| # | Mockup | Covers |
|---|---|---|
| 1 | [`prototypes/cached-context/mockup-attach-docs.html`](../prototypes/cached-context/mockup-attach-docs.html) | The hero attach flow. Unified picker (documents + bundles in one search). Context tabs for agent / task / scheduled-task. Post-save bundle suggestion card (§3.6.4). |
| 2 | [`prototypes/cached-context/mockup-upload-document.html`](../prototypes/cached-context/mockup-upload-document.html) | Reusable multi-file upload modal. Opt-in "Group these documents as a bundle" checkbox. Context-aware auto-attach confirmation. |
| 3 | [`prototypes/cached-context/mockup-bundle-detail.html`](../prototypes/cached-context/mockup-bundle-detail.html) | Named-bundle detail. Soft intro callout on first visits. "Attach to a task" primary action. Advanced details (size, model fit) collapsed. |
| 4 | [`prototypes/cached-context/mockup-budget-breach-block.html`](../prototypes/cached-context/mockup-budget-breach-block.html) | HITL block UX rendering `HitlBudgetBlockPayload` (§4.5). Safety-critical information-dense exception. |

The landing page at [`prototypes/cached-context/index.html`](../prototypes/cached-context/index.html) groups these with rationale and the "what was cut and why" record from the pre-UX-revision mockup set.

#### 3.6.3 Primary user flows

**Flow A — Attach existing documents.**
1. User opens an agent / task / scheduled-task config page.
2. Under "Reference documents", user clicks "Add a document".
3. Picker opens with a single search input covering BOTH the user's documents and their named bundles (two labelled sections in one dropdown).
4. User clicks a document → it appears as a doc chip (`📄`) on the parent. User clicks a bundle → the bundle appears as a bundle chip (`📦`) on the parent (representing the bundle as a unit, not its expanded documents).
5. User clicks Save → the attachments are persisted. Post-save suggestion fires if §3.6.4 conditions are met.

**Flow B — Upload new documents (attach-flow entry).**
1. From the picker (Flow A step 3), user clicks "Upload a new document".
2. Multi-file upload modal opens (§3.6.5).
3. User drops 1–N files, optionally names each, optionally ticks "Group as bundle" + names the bundle.
4. On submit → documents are uploaded to the library AND auto-attached to the current parent. If the bundle checkbox was ticked, the bundle is created and attached as a unit.
5. Modal closes. Attached items appear as chips on the parent.

**Flow C — Upload new documents (standalone entry).**
1. User opens `Knowledge › Documents` page.
2. Clicks "Upload documents".
3. Same modal as Flow B, but the auto-attach confirmation strip is hidden — uploads land in the library only.

**Flow D — Save as bundle (post-save suggestion).**
1. User completes Flow A for the second time with the same doc set on a different parent.
2. After save, a soft suggestion card appears below the Save button (not a modal — does not interrupt): *"Save these N documents as a bundle? You've now attached the same N documents to 2 tasks."*
3. User clicks "Save as bundle" → named-bundle input appears inline → user names it → bundle is created (the underlying unnamed bundle is promoted).
4. Or user clicks "No thanks" → permanent dismissal for this doc set (§3.6.4 invariants).

**Flow E — Reuse a named bundle.**
1. Bundle appears in the picker's "Your bundles" section (Flow A step 3) and in the bundle detail page's "Attach to a task" action (mockup 3).
2. Attaching a bundle adds it as a bundle chip (`📦`) on the parent — the bundle's documents are NOT exploded into individual doc chips. Removing the bundle chip detaches the bundle as a unit.

**Flow F — HITL block.**
1. A run's assembly breaches `max_input_tokens` or `per_document_cap` (§4.5).
2. The user sees the block UX (mockup 4). Copy: *"The reference documents attached to this task are too big."* Regardless of whether the documents came from a bundle or were attached individually, the block is framed around "attached documents", not "the bundle".
3. User picks one of four actions: Remove or trim a document (recommended) · Upgrade to a bigger model · Split into two tasks · Stop this run.

#### 3.6.4 Bundle suggestion heuristic (exact match only)

The post-save suggestion (Flow D) fires only when ALL of these conditions hold. Fuzzy matching (e.g. Jaccard similarity over shared document IDs) is explicitly rejected — it produces brittle, unpredictable prompts.

1. The attachment that just saved includes **2 or more documents**. Single-document "bundles" are noise.
2. The exact same document set (same document IDs, any order) is already attached to **≥ 1 other subject** (task, agent, or scheduled-task). Detection uses the existing `prefix_hash` primitive (`contextAssemblyEnginePure.computePrefixHash`, §4.4) — the hash is invariant under reordering because the engine sorts document IDs ascending before hashing.
3. The user has NOT previously dismissed this exact doc set (see `bundle_suggestion_dismissals`, §5.12). Dismissal is permanent per (user, doc-set-hash) pair — the suggestion does not re-appear for that user + doc set combination.
4. The user does NOT already have a named bundle (`is_auto_created=false`) with this exact doc set. In the v1 spec, if a match exists the suggestion simply does not fire. A future enhancement may replace it with a "use your existing bundle" prompt (§3.2 deferred).

**Order independence — user-facing UX invariant.** Document sets are considered identical regardless of selection order. A user who attaches documents A, B, C to task 1 and then B, A, C to task 2 sees the same suggestion as if both attachments were ordered identically. This is a direct user-facing consequence of the `prefix_hash` ordering invariant (§4.4); surfacing it here prevents "why did this suggestion fire?" confusion when a user's second attachment is in a different order from their first.

**Determinism.** The suggestion decision must be deterministic for a given document set and user state. Given the same `(organisationId, subaccountId, userId, documentIds)` input at a given instant in time, `suggestBundle` (§6.2) returns the same result every time; the decision is a pure function over the state queried in the four conditions above. No time-windowing, no sampled A/B behaviour, no ordering-dependent tie-breaks. This avoids flickering suggestions and avoids race conditions under concurrent edits.

**Timing.** The suggestion fires on save, not during the edit. The user is never interrupted mid-flow.

**Presentation.** A non-modal card below the Save button, dismissible. Two buttons: "No thanks" (permanent dismissal) and "Save as bundle" (opens an inline name input, then promotes the existing unnamed bundle to a named bundle).

**Dismissal scope.** Dismissal only suppresses the suggestion for the specific (user, doc-set) pair. It does NOT prevent the user from later creating the same bundle manually — via the upload-time "Group as bundle" checkbox (§3.6.5) or any other bundle-creation path. The dismissal is a suggestion-suppression preference, not a capability restriction.

#### 3.6.5 Reusable multi-file upload modal contract

The upload modal (mockup 2) is a single component used from two entry points with one context-aware branch.

**Invariants (applied to all entries):**
- Multi-file drag-drop into a single dashed drop zone, or click-to-browse fallback. The whole modal is a drop target when files are already staged.
- Each staged file renders as a row: icon, filename (read-only display in monospace), size + token-estimate (computed on the client from the file bytes pre-upload for instant feedback), and an inline editable **Name** field (seeded from the filename with extension stripped).
- A `+ Add more files` button below the list; drop-to-add continues to work.
- An opt-in **"Group these documents as a bundle"** checkbox below the file list.
  - Checkbox is **disabled** when < 2 files are staged (no bundle of one).
  - When ticked, a **Bundle name** input reveals inline; it is **required** when the checkbox is ticked.
  - The checkbox is **unchecked by default** — bundles are an opt-in affordance.
- Accepted formats: `.md`, `.pdf`, `.txt`, `.docx`. Limit: 10 MB per file. Total files per submit: no hard cap in v1, but the submit button disables if any file fails client-side parsing.
- On submit, files upload in parallel (not sequential — single transaction at the service layer handles atomicity, §7.1).
- On success, the modal closes; the invoking page refreshes its "Reference documents" list (attach-flow entry) or its documents table (standalone entry).

**Entry-point differences:**

| Entry | Auto-attach | Confirmation-strip copy |
|---|---|---|
| From the picker on an agent / task / scheduled-task config page (Flow B) | Yes — all uploaded documents auto-attach to the current parent. If the bundle checkbox was ticked, the bundle is created and attached as a unit. | Shown: *"These N documents will be added to \<parent name\> after upload."* If bundle: *"These N documents will be saved as the \<bundle name\> bundle and attached to \<parent name\>."* |
| From the standalone `Knowledge › Documents` page (Flow C) | No — documents land in the library only. If the bundle checkbox was ticked, the bundle is created but not attached anywhere. | Hidden. (The library context needs no attach confirmation.) |

The modal is a single component with a `context: 'attach' \| 'library'` prop and a `parent?: { subjectType, subjectId }` prop when in attach context. No code duplication between the two entries.

#### 3.6.6 Health signal surfacing

Backend capability (§6.7 `bundleUtilizationJob` + `utilizationByModelFamily`) computes per-bundle utilization per model tier. v1 user-facing surfacing is **deliberately minimal**:

- **Bundle detail page** — a single inline text label in the header: one of "Healthy" (`< 70%` worst tier), "Near cap" (`70–90%`), "At cap" (`> 90%`). Collapsed "Advanced details" section (closed by default) shows per-tier numbers as a small KV list. No radial rings. No side-by-side tier comparison as a primary element.
- **Picker on attach flow** — the same three-state label appears on the bundle rows in the picker so the user can see it before picking.
- **Nowhere else** in v1. No dashboard. No Usage Explorer bundle lens. No KPI tiles on the task config page.

**Aggregation invariant: the single-label value is the worst-case across supported tiers.** `utilizationByModelFamily` is a per-tier map; the UI's three-state label is computed by taking `max(utilizationRatio)` across every model family in the map, then thresholding that max value (< 0.70 → Healthy, 0.70–0.90 → Near cap, > 0.90 → At cap). This is the conservative bias — a bundle that fits comfortably in Sonnet but barely fits in Haiku is rendered as "Near cap" so the user sees the risk regardless of which tier they're currently targeting. Any future UI surface (admin observability, Usage Explorer tier breakdown) that derives a single-label utilization MUST use the same worst-tier rule; implementations must not silently substitute the "current model's tier" or "average across tiers" without an explicit spec change.

See §3.2 out-of-scope for the explicit dashboard cuts.

#### 3.6.7 UX invariants the rest of the spec must respect

1. **Documents are independently attachable.** The attach surface (routes in §7) must accept a set of document IDs — not just a bundle ID. Internally, an unnamed bundle is created or reused; the client never names it.
2. **Named bundles are opt-in and created through exactly two paths:**
   - Accepting a post-save suggestion (Flow D) → promotes an existing unnamed bundle.
   - Ticking the upload-time checkbox (Flow B / C) → promotes the unnamed bundle created during the upload.
   No other service path creates a named bundle. `POST /api/document-bundles` with an explicit name is retained for API completeness but is not surfaced in the UI.
3. **Unnamed bundles are invisible.** No UI surface lists unnamed bundles; no error message names them; no email / notification references them. Queries for "Your bundles" filter `WHERE is_auto_created = false`.
4. **Health signals are secondary.** Any new observability surface derived from `utilizationByModelFamily` defaults to hidden / admin-only. The primary user flow renders a single three-state label.
5. **HITL block is doc-framed, not bundle-framed.** Copy and `HitlBudgetBlockPayload` presentation (mockup 4) describe "the reference documents attached to this task", regardless of whether they came from a bundle. The backend payload shape (§4.5) is unchanged — only the UI rendering is doc-framed.
6. **Bundle edits affect all attached parents.** A bundle's document list is shared state. Editing a bundle used by ≥ 2 parents displays an inline warning (mockup 3) — this is a UX invariant, not a validation.
7. **Single vocabulary — "bundle" throughout.** The schema, services, routes, types, error codes, and UI copy all use "bundle". "Pack" is deprecated vocabulary from earlier spec revisions and must not be reintroduced in any layer. The only exception: "unnamed bundle" and "named bundle" are permissible in technical prose when distinguishing the two `is_auto_created` states.
8. **A bundle chip always represents a single attachment unit.** Regardless of how many documents a bundle contains, the bundle renders as exactly one chip (`chipKind='bundle'`) on a parent's Reference documents list. Clicking the chip's remove (✕) detaches the bundle as a unit — never as a partial detachment of some-but-not-all of its documents. The alternative (sometimes-expanding a bundle into individual doc chips) is explicitly rejected — it breaks the mental model the user just learned.
9. **Document-set identity ignores order.** A doc set is identified by the set of document IDs, not by the order the user picked them. The UI treats two attachments with the same document IDs in different orders as identical for every purpose: bundle suggestion, duplicate detection, dismissal matching, existing-bundle lookup. The backend hash (§4.4) already sorts before hashing; this is the user-facing consequence (cross-references §3.6.4 order-independence).

---

## 4. Contracts

Every data shape that crosses a service boundary is pinned here with a worked example. Per `docs/spec-authoring-checklist.md §3`.

### 4.1 `RESOLVED_EXECUTION_BUDGET`

**Type:** TypeScript interface. Exported from `shared/types/cachedContext.ts`.

**Producer:** `executionBudgetResolver.resolve()` (§6.5).
**Consumers:** `contextAssemblyEngine.validate()` (§6.4), `cachedContextOrchestrator.execute()` (§6.6), HITL block payload builder (§4.5).

```ts
interface ResolvedExecutionBudget {
  /** Max input-side tokens (bundle prefix + variable input). */
  maxInputTokens: number;
  /** Max output-side tokens (response reservation). Passed to the router as the per-call response cap (§6.6 step 6 — `max_tokens` in the Anthropic request). Enforced by the router, not by the assembly validator. */
  maxOutputTokens: number;
  /** Hard per-call cost ceiling in USD. Integer cents internally, USD at boundary. Not enforced by the assembly-time validator — mid-flight cost enforcement belongs to `runCostBreaker` (§2.1). Carried on the budget for audit / debugging. */
  maxTotalCostUsd: number;
  /** Per-document hard cap in tokens. The assembly validator emits `thresholdBreached='per_document_cap'` when any included document exceeds this. Carried forward from `model_tier_budget_policies.perDocumentMaxTokens`. */
  perDocumentMaxTokens: number;
  /** Reserved output tokens subtracted from maxInputTokens headroom. */
  reserveOutputTokens: number;
  /** Soft-warn threshold as a fraction of maxInputTokens (0 < x < 1). Default 0.7. */
  softWarnRatio: number;
  /** Source inputs recorded for debugging / audit. */
  resolvedFrom: {
    taskConfigId: string | null;
    modelTierPolicyId: string;
    orgCeilingPolicyId: string | null;
  };
  /** Model family this budget was resolved against. */
  modelFamily: 'anthropic.claude-sonnet-4-6' | 'anthropic.claude-opus-4-7' | 'anthropic.claude-haiku-4-5';
  /** Declared model context window at resolution time. Used for the capacity invariant. */
  modelContextWindow: number;
}
```

**Example instance (Sonnet 4.6 default, no task override, no org cap):**

```json
{
  "maxInputTokens": 800000,
  "maxOutputTokens": 16000,
  "maxTotalCostUsd": 5.00,
  "perDocumentMaxTokens": 100000,
  "reserveOutputTokens": 16000,
  "softWarnRatio": 0.70,
  "resolvedFrom": {
    "taskConfigId": null,
    "modelTierPolicyId": "mtb_7d2c...",
    "orgCeilingPolicyId": null
  },
  "modelFamily": "anthropic.claude-sonnet-4-6",
  "modelContextWindow": 1000000
}
```

**Nullability and defaults:** `maxInputTokens`, `maxOutputTokens`, `maxTotalCostUsd`, `perDocumentMaxTokens`, `reserveOutputTokens`, `softWarnRatio`, `modelFamily`, `modelContextWindow` are all required. `taskConfigId` and `orgCeilingPolicyId` are nullable when no override exists.

**Invariants enforced at resolution time (raises `BudgetResolutionError`):**

- `maxInputTokens + reserveOutputTokens ≤ modelContextWindow`
- `maxOutputTokens ≤ reserveOutputTokens` — reserve must be at least as large as the response cap. Equality is the expected post-resolution state whenever a task/org override narrows `maxOutputTokens` below the tier's default reserve (see §6.5 step 4); that is by design, not a contradiction.
- `0 < softWarnRatio < 1`
- All numeric fields > 0.

### 4.2 `CONTEXT_ASSEMBLY_RESULT`

**Type:** TypeScript discriminated union. Exported from `shared/types/cachedContext.ts`.

**Producer:** `contextAssemblyEngine.assemble()` (§6.4).
**Consumers:** `cachedContextOrchestrator.execute()` (§6.6).

```ts
type ContextAssemblyResult =
  | {
      kind: 'ok';
      /** The fully formed LLM payload ready to hand to llmRouter.routeCall. */
      routerPayload: {
        system: { stablePrefix: string; dynamicSuffix: string };
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
        estimatedContextTokens: number;
      };
      /** Call-level assembled-prefix-hash identity (§4.4 via `computeAssembledPrefixHash`). Aggregates every attached-bundle snapshot's per-bundle `prefixHash` under a single `modelFamily + assemblyVersion` root. This is the value written to `llm_requests.prefix_hash`. Per-bundle components live on each `bundle_resolution_snapshots` row. */
      prefixHash: string;
      /** Hash of the variable input alone (not cached), for full run identity. */
      variableInputHash: string;
      /** Snapshot IDs referenced by this assembly (for agent_runs.bundle_snapshot_ids). */
      bundleSnapshotIds: string[];
      /** Soft-warn signal carried forward for run-outcome classification. */
      softWarnTripped: boolean;
      /** Assembly-version constant that produced this payload. */
      assemblyVersion: number;
    }
  | {
      kind: 'budget_breach';
      /** Structured HITL block payload (see §4.5). */
      blockPayload: HitlBudgetBlockPayload;
    };
```

**Example `ok` instance (excerpted — full payloads omitted for brevity):**

```json
{
  "kind": "ok",
  "routerPayload": {
    "system": {
      "stablePrefix": "---DOC_START---\nid: 92f...\nversion: 3\n---\n<content>\n---DOC_END---\n...",
      "dynamicSuffix": "Today's transcript:\n<transcript>"
    },
    "messages": [{ "role": "user", "content": "Generate today's macro report." }],
    "estimatedContextTokens": 45231
  },
  "prefixHash": "0x4a9f8e...",
  "variableInputHash": "0x7c3b1e...",
  "bundleSnapshotIds": ["bns_5f2a..."],
  "softWarnTripped": false,
  "assemblyVersion": 1
}
```

**Nullability and defaults:** `kind` is always present; the remaining fields are present iff `kind='ok'`. A `budget_breach` result carries only `kind` and `blockPayload`.

### 4.3 `BUNDLE_RESOLUTION_SNAPSHOT` (persisted)

**Type:** Drizzle row from `bundle_resolution_snapshots` (schema §5.6). JSONB fields pinned here.

**Producer:** `bundleResolutionService.resolveAtRunStart()` (§6.3).
**Consumers:** `contextAssemblyEngine.assemble()` (§6.4) — uses the snapshot's `orderedDocumentVersions` to fetch the pinned `reference_document_versions` rows (by `documentId + documentVersion`) and produces `routerPayload` from those immutable bytes. The snapshot's `serializedBytesHash` values are the integrity check — the engine re-hashes each fetched version row during assembly and fails loudly on mismatch (a live content mutation under a pinned version row indicates tampering or a schema-invariant violation). Debugging / audit (read-only everywhere else).

```ts
interface BundleResolutionSnapshot {
  id: string; // UUID
  organisationId: string;
  subaccountId: string | null;
  bundleId: string;
  bundleVersion: number;
  modelFamily: string;
  /** Deterministic order — document_id ascending. Recorded verbatim. */
  orderedDocumentVersions: Array<{
    documentId: string;
    documentVersion: number;
    /** SHA-256 of the serialized-with-delimiters form of this document version — mirrors `reference_document_versions.serializedBytesHash` (§5.2) and is the source-of-truth input to `PrefixHashComponents.documentSerializedBytesHashes` (§4.4). The raw-content hash `reference_document_versions.contentHash` is NOT stored here; it serves the idempotent-write check in §6.1 and plays no role in prefix identity. */
    serializedBytesHash: string;
    tokenCount: number;
  }>;
  /** SHA-256 of the full assembled prefix for this single bundle. Per-bundle; the call-level `prefix_hash` on `llm_requests` is computed over all attached-bundle snapshot hashes (§6.4 `computeAssembledPrefixHash`). */
  prefixHash: string;
  prefixHashComponents: PrefixHashComponents;
  /** Total estimated input tokens for this snapshot (prefix only, not variable input). */
  estimatedPrefixTokens: number;
  createdAt: string; // ISO 8601
}
```

**Example instance:**

```json
{
  "id": "bns_5f2a...",
  "organisationId": "org_abc...",
  "subaccountId": "sub_xyz...",
  "bundleId": "bnd_42m...",
  "bundleVersion": 3,
  "modelFamily": "anthropic.claude-sonnet-4-6",
  "orderedDocumentVersions": [
    { "documentId": "doc_001...", "documentVersion": 2, "serializedBytesHash": "0xaaa...", "tokenCount": 8421 },
    { "documentId": "doc_002...", "documentVersion": 1, "serializedBytesHash": "0xbbb...", "tokenCount": 6117 }
  ],
  "prefixHash": "0x4a9f8e...",
  "prefixHashComponents": { /* see §4.4 */ },
  "estimatedPrefixTokens": 14538,
  "createdAt": "2026-04-22T08:00:00Z"
}
```

**Uniqueness invariant:** `UNIQUE(bundle_id, prefix_hash)` at the DB level (§5.6). Two distinct bundles whose current document sets happen to hash identically will each get their own snapshot row — cross-bundle reuse of the provider's cache entry still happens at the adapter level (identical `prefix_hash` → same cached prefix), but per-bundle attribution stays clean. Concurrent cron bursts resolving the same bundle against the same model family insert at most one row; losers re-select the winning row.

### 4.4 `PREFIX_HASH_COMPONENTS`

**Hash glossary — two identities, two scopes.**
- **`prefix_hash` (per-bundle identity).** Lives on `bundle_resolution_snapshots.prefix_hash`. Hashes the inputs that fully determine ONE bundle's cached-prefix bytes: `{ orderedDocumentIds, documentSerializedBytesHashes, includedFlags, modelFamily, assemblyVersion }`. Two snapshots with the same per-bundle `prefix_hash` serve the same cached prefix at the provider.
- **`assembledPrefixHash` (call-level identity).** Lives on `llm_requests.prefix_hash`. Hashes the set of per-bundle `prefix_hash` values for the bundles attached to one call: `{ snapshotPrefixHashesByBundleIdAsc, modelFamily, assemblyVersion }`. This is the cache-attribution key for the LLM call. Two calls with the same `assembledPrefixHash` and the same TTL window should produce a provider cache hit.

**Cache identity vs provider cache behaviour.** These hash identities guarantee determinism on our side — the spec ensures byte-identical prefixes produce identical hashes, and non-identical prefixes produce different hashes. **But a cache hit at the provider is NOT guaranteed by identity alone.** Provider caches are best-effort: TTL can expire between calls (the 5-minute ephemeral window), provider-side cache-key shape may evolve, provider-side eviction policies are opaque, and provider-level incidents can flush caches. A `cache_read_input_tokens = 0` on a call whose `assembledPrefixHash` matches an earlier call within the TTL window is possible and must not be treated as a bug — it is classified as a degraded run (§4.6 "unexpected cache miss"). Dashboards and debugging proceed from this premise: we can prove our hash identities are stable; we cannot prove the provider cached the prefix.

**Cross-tenant hash identity.** Prefix-hash identity is content-based — the hash is a pure function of the byte-serialized documents + `model_family` + `assembly_version`. Two tenants that upload identical document content produce identical hashes. This is **expected and safe**: the provider's cache is keyed by the bytes sent in the request, so cross-tenant cache reuse happens naturally at the provider level whenever the bytes match. No tenant data is leaked by this reuse — both tenants are independently sending the same bytes, and each tenant's `bundle_resolution_snapshots` row remains tenant-scoped for attribution. Do NOT salt hashes per tenant; doing so would eliminate cross-tenant cache reuse (a real cost-saving benefit) without adding any isolation property the current design doesn't already have.

**Assembly-version bumps are non-destructive.** A bump to `ASSEMBLY_VERSION` in `contextAssemblyEnginePure` invalidates cache reuse across the version boundary: runs on the new version produce new `prefix_hash` values that do not collide with runs on the old version. **But existing snapshot rows are NOT invalidated.** `bundle_resolution_snapshots` is append-only; prior-version snapshots remain readable for audit, are still referenced by historical `agent_runs.bundle_snapshot_ids`, and coexist indefinitely with new-version snapshots. No migration, no deletion, no "cleanup" sweep. The rule is enforced at the engine level — the engine can always read a prior-version snapshot's `prefix_hash_components` because those components are persisted with the `assembly_version` field that produced them (§4.3 `assemblyVersion` field). This keeps the system append-only across engine evolution.

**Hash-collision policy (design assumption).** SHA-256 prefix-hash collisions are assumed cryptographically negligible at the cardinality this system will ever see. **No runtime collision-handling logic is implemented** — no secondary disambiguator, no "if-match-but-differ-then-fallback" branch, no collision counters. The system treats `prefix_hash` equality as byte-equality. If the engine ever detects a mismatch between a snapshot's recorded `prefix_hash` and the hash freshly computed from the reconstructed bytes (e.g. integrity check in §6.4), that mismatch is a **fatal integrity error** (`CACHED_CONTEXT_SNAPSHOT_INTEGRITY_VIOLATION` 500) — never treated as a probabilistic collision. Future reviewers must reject proposals to add collision-handling fallback logic; the hash identity is the contract.

**Type:** TypeScript interface. Exported from `shared/types/cachedContext.ts`. Stored as JSONB on `bundle_resolution_snapshots.prefix_hash_components` — one components object per bundle per unique resolution state. `llm_requests.prefix_hash` is the CALL-LEVEL assembled hash (the `assembledPrefixHash` from the glossary above) and does NOT directly join any single snapshot row. For diagnosis, consumers join `llm_requests.llm_request_id` to `agent_runs.llm_request_id` (where present) or reconstruct from `agent_runs.bundle_snapshot_ids`: read every snapshot row whose `id` is in that JSONB array, diff the per-bundle `prefix_hash_components` against a prior run's snapshots, and recompute the call-level `assembledPrefixHash` via `computeAssembledPrefixHash` to verify it matches `llm_requests.prefix_hash`. `llm_requests` does NOT carry components directly (§5.9).

**Producer:** `contextAssemblyEnginePure.computePrefixHash()` (§6.4).
**Consumers:** Debugging tools that diff two snapshots with different hashes.

```ts
interface PrefixHashComponents {
  orderedDocumentIds: string[];                // document_id ascending
  documentSerializedBytesHashes: string[];     // parallel to orderedDocumentIds; each entry is `reference_document_versions.serializedBytesHash` for the version pinned in the snapshot
  includedFlags: Array<{                       // parallel to orderedDocumentIds
    documentId: string;
    included: true;                            // only included docs appear; excluded ones are absent
    reason: 'attached_and_active';             // only this value in v1; kept as enum for future
  }>;
  modelFamily: string;
  assemblyVersion: number;
}
```

**Example instance:**

```json
{
  "orderedDocumentIds": ["doc_001...", "doc_002..."],
  "documentSerializedBytesHashes": ["0xaaa...", "0xbbb..."],
  "includedFlags": [
    { "documentId": "doc_001...", "included": true, "reason": "attached_and_active" },
    { "documentId": "doc_002...", "included": true, "reason": "attached_and_active" }
  ],
  "modelFamily": "anthropic.claude-sonnet-4-6",
  "assemblyVersion": 1
}
```

**Inclusion rule for a document:** not paused (document_versions current row has no `paused_at`), not deprecated (document row has no `deprecated_at`), and passes attachment scope at resolution time. Excluded documents do NOT appear in `includedFlags` — absence is signal. This matches §4.5 of the brief's §4.5 "included_flags" definition.

**`assemblyVersion` bump rule:** incremented manually in the PR that changes sort order, separator tokens, delimiter shape, metadata ordering, breakpoint placement, or serialization logic. A unit test in `server/services/__tests__/contextAssemblyEnginePure.test.ts` (§11.1) asserts the current version against a fixture prefix — changing assembly without bumping the version fails the test.

### 4.5 `HITL_BUDGET_BLOCK_PAYLOAD`

**Type:** TypeScript interface + stored as `actions.payloadJson` with `actionType='cached_context_budget_breach'`. Exported from `shared/types/cachedContext.ts`.

**Producer:** `contextAssemblyEngine.validate()` (§6.4) when the resolved budget is exceeded.
**Consumers:** Operator UI rendering block items (`client/src/pages/ReviewQueuePage.tsx` or equivalent — UI rendering is route-surface only in v1; see §7).

```ts
interface HitlBudgetBlockPayload {
  kind: 'cached_context_budget_breach';
  /** Which budget dimension was breached first. v1 enumerates only the assembly-time breach modes. Cost enforcement at mid-flight is `runCostBreaker`'s responsibility (§2.1) and surfaces as `run_outcome='failed'` rather than a HITL block. */
  thresholdBreached: 'max_input_tokens' | 'per_document_cap';
  budgetUsed: {
    inputTokens: number;
    worstPerDocumentTokens: number;
  };
  budgetAllowed: {
    maxInputTokens: number;
    perDocumentCap: number;
  };
  /** Top 5 contributors, ordered by token count descending. */
  topContributors: Array<{
    documentId: string;
    documentName: string;
    tokens: number;
    percentOfBudget: number; // 0 < x <= 100
  }>;
  /** Enumerated suggested actions the operator can take. */
  suggestedActions: Array<'trim_bundle' | 'upgrade_model' | 'split_task' | 'abort'>;
  /** The resolved budget (§4.1) for audit. */
  resolvedBudget: ResolvedExecutionBudget;
  /** The prefix-hash components that were about to be submitted (for diagnosis). */
  intendedPrefixHashComponents: PrefixHashComponents;
}
```

**Example instance:**

```json
{
  "kind": "cached_context_budget_breach",
  "thresholdBreached": "max_input_tokens",
  "budgetUsed": {
    "inputTokens": 845000,
    "worstPerDocumentTokens": 132000
  },
  "budgetAllowed": {
    "maxInputTokens": 800000,
    "perDocumentCap": 100000
  },
  "topContributors": [
    { "documentId": "doc_big...", "documentName": "Annual report", "tokens": 132000, "percentOfBudget": 16.5 }
  ],
  "suggestedActions": ["trim_bundle", "upgrade_model", "split_task", "abort"],
  "resolvedBudget": { /* §4.1 */ },
  "intendedPrefixHashComponents": { /* §4.4 */ }
}
```

**Action flow:** the orchestrator (§6.6) calls `actionService.proposeAction` with `actionType='cached_context_budget_breach'`, `gateLevel='block'`, `payloadJson = HitlBudgetBlockPayload`. `hitlService` blocks the orchestrator until an operator approves, rejects, or the suspend window elapses. Approval does NOT automatically execute — approval only unblocks the orchestrator, which then re-runs the resolver + assembly **exactly once** (§6.6 step 4 retry cap). If the second assembly still breaches, the run terminates with `run_outcome='failed'` and `failureReason='hitl_second_breach'` — no further HITL cycles. Rejection or timeout terminates the run with `run_outcome='failed'` and the matching `failureReason`.

### 4.6 `RUN_OUTCOME_CLASSIFICATION`

**Type:** Postgres text enum pinned via Drizzle `$type<...>` on `agent_runs.run_outcome`. Stored as text for enum-add flexibility (no Postgres ENUM type to evolve).

**Producer:** `cachedContextOrchestrator.execute()` (§6.6) at the run-terminal write.
**Consumers:** Admin observability queries (§11 testing + §16 success criteria), retry logic (not implemented in v1 — §12.7), future admin-only dashboards (deferred — §3.2 / §12.12).

```ts
type RunOutcome = 'completed' | 'degraded' | 'failed';

/** Internal-only diagnostic tag recorded alongside run_outcome='degraded'. NEVER surfaced to users. */
type DegradedReason = 'soft_warn' | 'token_drift' | 'cache_miss';
```

**Semantics (authoritative — consumed by dashboards and future retry logic):**

- **`completed`**: Run finished; no soft-warn tripped; estimated-vs-actual token drift within tolerance; cache behaved as expected.
- **`degraded`**: Run finished AND at least one of: soft-warn breach (§4.1 `softWarnRatio`), estimate-vs-actual input-token delta above 10% (tolerance manual-tunable — see §12.5), unexpected cache miss when the prefix hash matched a previous snapshot within the TTL window. **`degraded` reflects suboptimal execution conditions, not necessarily incorrect output.** The run's result is valid — it just cost more, took longer, or behaved differently than an ideal run. Dashboards and retry logic must not equate "degraded" with "bad output"; it is an infrastructure / cost signal.
- **`failed`**: Run did not finish (HITL-block rejected, router error, provider 5xx, timeout, parse failure, budget-resolver raised `BudgetResolutionError`, orchestrator aborted).

**`degraded_reason` diagnostic tag (persisted alongside `run_outcome`).** Three categorically different things can degrade a run, and conflating them in dashboards makes tuning impossible. v1 persists a nullable `degraded_reason` text column on `agent_runs` (§5.8). Semantics:

- `soft_warn` — a soft-warn threshold was tripped (`§4.1 softWarnRatio`). The user's bundle is approaching its cap; they may want to trim before it blocks.
- `token_drift` — actual input tokens exceeded estimated by more than the tolerance (§12.5). The token estimator needs calibration for this workload / model family.
- `cache_miss` — `prefix_hash` matched a prior snapshot within the TTL window but the provider returned `cache_read_input_tokens = 0`. Provider-side variability (§4.4 cache-identity-vs-provider-behaviour); not a bug on our side.

Precedence when multiple conditions are true in one run: `soft_warn` > `token_drift` > `cache_miss` (the user-actionable signal wins). This column is **internal-only** — the UI never renders it. It exists for admin observability, future retry logic (§12.7 can route by reason), and debugging.

**Drift-data aggregability invariant.** Token-drift signals (`degraded_reason = 'token_drift'` or underlying drift magnitudes) must remain aggregatable per `model_family` and per document type to support future estimator calibration (§12.5). No new schema is needed — the join path is already supported by v1 columns: group `agent_runs.degraded_reason = 'token_drift'` by (a) `llm_requests.model_family` via `agent_runs.llm_request_id` for the model dimension, (b) `bundle_resolution_snapshots.orderedDocumentVersions[*].documentId` → `reference_documents.source_type` via `agent_runs.bundle_snapshot_ids` for the document-type dimension. Drift magnitude can be recovered from the difference between the snapshot's recorded `estimatedPrefixTokens` and the actual `llm_requests.input_tokens - cachedPromptTokens`. Future schema additions must not break this join path; future calibration jobs (§12.5) read from exactly these tables, no intermediate materialisation required.

**Example instances (fragment of an agent_runs row):**

```json
{ "run_outcome": "completed", "degraded_reason": null }
{ "run_outcome": "degraded", "degraded_reason": "soft_warn", "soft_warn_tripped": true }
{ "run_outcome": "degraded", "degraded_reason": "token_drift" }
{ "run_outcome": "degraded", "degraded_reason": "cache_miss" }
{ "run_outcome": "failed", "degraded_reason": null }
```

**Invariant:** `run_outcome` is written exactly once, at the terminal write. In-flight runs have `run_outcome IS NULL`. The terminal-write UPDATE carries the `run_outcome IS NULL` optimistic-lock precondition (§9.3) — duplicate writes under retry update 0 rows. `degraded_reason` is written in the same UPDATE; `NULL` unless `run_outcome = 'degraded'`. This UPDATE is NOT co-transactional with the router's `llm_requests` insert; both writes are idempotent in effect, and no observer can see a contradictory in-flight state.

---

## 5. Schema changes

All new tables land in one migration file per table group (see §10 for the phase ordering that groups them). Migrations use the raw-SQL convention (numbered files under `/migrations/`, starting at **0202**). Drizzle schema files under `server/db/schema/` are created alongside each migration.

All new tenant-scoped tables (every table in §5.1–5.7) are added to `server/config/rlsProtectedTables.ts` in the same migration that creates them — §8 covers policies and manifest entries.

### 5.1 `reference_documents` table

**File:** `server/db/schema/referenceDocuments.ts`
**Migration:** `0202_reference_documents.sql`

One row per user-uploaded reference document. Content lives on `reference_document_versions` (§5.2); this row is the stable identity + current-version pointer.

```ts
export type ReferenceDocumentSourceType = 'manual' | 'external';

export const referenceDocuments = pgTable(
  'reference_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),

    /** Human-friendly name, unique within (org, subaccount). Rename is cheap. */
    name: text('name').notNull(),
    /** Optional author-facing description. Not loaded into prompts. */
    description: text('description'),

    /** Pointer to the current version row (§5.2). Null on initial insert; set in-tx by the creation path. */
    currentVersionId: uuid('current_version_id'),
    /** Monotonically increments on every content edit. Mirrors the version row's `version`. */
    currentVersion: integer('current_version').notNull().default(0),

    /** Deferred v2 connector fields — v1 only writes 'manual'. */
    sourceType: text('source_type').notNull().default('manual').$type<ReferenceDocumentSourceType>(),
    sourceRef: text('source_ref'),                // e.g. 'gdrive:<file_id>' — null for manual
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),

    /** Lifecycle. Paused documents are excluded from assembly; deprecated documents are excluded AND cannot be added to new bundles. */
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
    deprecationReason: text('deprecation_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    orgNameUniq: uniqueIndex('reference_documents_org_name_uq')
      .on(t.organisationId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    orgIdx: index('reference_documents_org_idx').on(t.organisationId),
    subaccountIdx: index('reference_documents_subaccount_idx')
      .on(t.subaccountId)
      .where(sql`${t.subaccountId} IS NOT NULL`),
    activeIdx: index('reference_documents_active_idx')
      .on(t.organisationId, t.subaccountId)
      .where(sql`${t.deletedAt} IS NULL AND ${t.deprecatedAt} IS NULL AND ${t.pausedAt} IS NULL`),
  })
);
```

**Notes.**
- `currentVersionId` is a soft FK to `reference_document_versions.id` (§5.2). The FK constraint is created in migration 0203 (the versions table) rather than 0202 to avoid circular dependency — same pattern as `memory_blocks.activeVersionId` (see `memoryBlocks.ts` lines 93–103).
- `source_type`/`source_ref`/`last_synced_at` are deferred-feature columns from day one — v1 never writes anything but `manual`/`null`/`null`. Exists to make the v2 connector landing a non-refactor.
- Soft-delete via `deletedAt`. A soft-deleted document is excluded from assembly even if still bundle-linked.
- **Document rename does not affect prefix-hash identity.** The `name` column is metadata only. Prefix-hash components (§4.4) hash `documentSerializedBytesHashes` (which derives from `reference_document_versions.serializedBytesHash`) and `orderedDocumentIds` — neither includes the document name. Renaming a document leaves every existing bundle's `prefix_hash` unchanged and every cached provider prefix intact. This is invariant: future changes must not smuggle user-facing names into the hash input.

### 5.2 `reference_document_versions` table

**File:** `server/db/schema/referenceDocumentVersions.ts`
**Migration:** `0203_reference_document_versions.sql` (adds the soft FK from §5.1 in the same migration).

One immutable row per content revision. Consecutive identical-content writes coalesce (idempotent — see `referenceDocumentService.writeVersion` §6.1).

```ts
export type ReferenceDocumentChangeSource = 'manual_upload' | 'manual_edit' | 'external_sync';

export const referenceDocumentVersions = pgTable(
  'reference_document_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => referenceDocuments.id, { onDelete: 'cascade' }),

    /** Monotonically increments per document, starting at 1. */
    version: integer('version').notNull(),

    /** Full content. Stored as text — markdown is the only supported format in v1. */
    content: text('content').notNull(),
    /** SHA-256 of `content` (raw bytes). Used as the identity for de-duplication. */
    contentHash: text('content_hash').notNull(),

    /** Per-model-family token counts. Written at version-create time; never recomputed. */
    tokenCounts: jsonb('token_counts')
      .notNull()
      .$type<Record<'anthropic.claude-sonnet-4-6' | 'anthropic.claude-opus-4-7' | 'anthropic.claude-haiku-4-5', number>>(),

    /** Bytes-hash of the serialized (with delimiters / metadata) form — part of the prefix-hash identity. */
    serializedBytesHash: text('serialized_bytes_hash').notNull(),

    /** Who wrote this version + why. */
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    changeSource: text('change_source').notNull().$type<ReferenceDocumentChangeSource>(),
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    docVersionUniq: unique('reference_document_versions_doc_version_uq').on(t.documentId, t.version),
    docVersionIdx: index('reference_document_versions_doc_version_idx').on(t.documentId, t.version),
    contentHashIdx: index('reference_document_versions_content_hash_idx').on(t.contentHash),
  })
);
```

**Notes.**
- `tokenCounts` is a JSONB map keyed by `modelFamily`. v1 writes three keys (Sonnet / Opus / Haiku). New model families append new keys in a future migration — no schema change.
- **`tokenCounts` is the source of truth — computed once, at version-write time, never at assembly time.** When `referenceDocumentService.writeVersion` (§6.1) inserts a new version row, it invokes `anthropicAdapter.countTokens` once per supported model family and records the result. Assembly (§6.4) reads `tokenCounts[modelFamily]` directly from the pinned version row — it does NOT re-tokenise, re-estimate, or mutate the value. This keeps per-request latency low (no provider round-trip during assembly), makes token counts auditable and reproducible, and prevents drift between what the budget resolver saw and what assembly assembled against. Rule: any future optimisation that wants to "freshen" token counts at assembly time must instead trigger a new version write; assembly-time recomputation is forbidden.
- `serializedBytesHash` is hashed over the serialized form (document bytes plus the delimiter/metadata wrapper from the engine's serialization format — see §6.4). This is the hash that feeds `prefix_hash_components.documentSerializedBytesHashes` (§4.4) and is mirrored onto each snapshot's `orderedDocumentVersions[].serializedBytesHash` entry (§4.3 / §5.6). We hash the serialized form (not raw content) because that is what Anthropic sees — byte-identical serialization is the identity that matters for cache hits. `contentHash` on this table is the RAW-content hash; it serves the idempotent-write check in §6.1 (`updateContent` short-circuits when new content's `contentHash` matches the current version) and plays no role in prefix identity.
- **Version rows are immutable (named invariant).** No `deletedAt` column. Rows in `reference_document_versions` are never updated, never deleted, never soft-deleted. Content changes create new rows with a higher `version` number. Document-level soft-delete on `reference_documents` hides the parent but leaves all version rows in place.
- **Snapshot ↔ version-row guarantee (named invariant).** Every `(documentId, documentVersion)` pair persisted in `bundle_resolution_snapshots.orderedDocumentVersions` MUST resolve to an existing immutable version row for the entire lifetime of the snapshot. Because version rows are never deleted and snapshots are append-only (§5.6), this guarantee is structural — no application-layer FK check is needed. This is the load-bearing property behind per-run reproducibility + hash-verification: assembly (§6.4) reads the pinned version row, re-hashes the serialized bytes, and compares against the snapshot's recorded `serializedBytesHash`. If a future change ever introduces version-row deletion, snapshot integrity breaks — do NOT allow that change without first designing a snapshot-migration story.
- Idempotent writes: if the caller attempts to write a version row whose content matches the current version's `contentHash`, `referenceDocumentService.writeVersion` returns the existing row without inserting — matches the `memoryBlockVersions` coalescing pattern.

### 5.3 `document_bundles` table

**File:** `server/db/schema/documentBundles.ts`
**Migration:** `0204_document_bundles.sql`

One row per bundle. Bundles are the backend attachment unit. The `is_auto_created` flag distinguishes implicit bundles (created on attach with `name=NULL`, invisible to users) from named bundles (created by opt-in user action, visible in "Your bundles"). See §3.6 for the user-facing contract.

```ts
export const documentBundles = pgTable(
  'document_bundles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),

    /** NULL iff is_auto_created=true. Non-null iff is_auto_created=false. Enforced by CHECK constraint. */
    name: text('name'),
    description: text('description'),

    /**
     * TRUE when the bundle was created implicitly by an attach flow (user picked a set of documents
     * and the backend wrapped them into this bundle). FALSE when a user has promoted the bundle to a
     * named bundle via the post-save suggestion (§3.6.4) or the upload-time checkbox (§3.6.5).
     *
     * Promotion is a one-way transition: auto → named. Demotion back to auto is not supported.
     *
     * UI queries for "Your bundles" filter `WHERE is_auto_created = false`. Unnamed bundles are hidden
     * from all user-facing lists.
     */
    isAutoCreated: boolean('is_auto_created').notNull().default(true),

    /** Audit — who created the bundle (either the implicit-attach actor or the explicit bundle-namer). */
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),

    /** Monotonically increments on any membership edit (add/remove/reorder). Starts at 1. */
    currentVersion: integer('current_version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    /**
     * Named-bundle name uniqueness per org. Unnamed bundles (name IS NULL) never collide; the partial
     * predicate `name IS NOT NULL` lets the index serve only the named-bundle subset.
     */
    orgNameUniq: uniqueIndex('document_bundles_org_name_uq')
      .on(t.organisationId, t.name)
      .where(sql`${t.deletedAt} IS NULL AND ${t.name} IS NOT NULL`),
    orgIdx: index('document_bundles_org_idx').on(t.organisationId),
    subaccountIdx: index('document_bundles_subaccount_idx')
      .on(t.subaccountId)
      .where(sql`${t.subaccountId} IS NOT NULL`),
    /** Fast lookup of named bundles in the UI picker and bundles list. */
    namedBundleLookupIdx: index('document_bundles_named_lookup_idx')
      .on(t.organisationId, t.subaccountId)
      .where(sql`${t.deletedAt} IS NULL AND ${t.isAutoCreated} = false`),
  })
);
```

**CHECK constraint (attached in migration 0204):**
```sql
ALTER TABLE document_bundles
  ADD CONSTRAINT document_bundles_name_matches_auto_flag
  CHECK (
    (is_auto_created = true  AND name IS NULL) OR
    (is_auto_created = false AND name IS NOT NULL AND length(trim(name)) > 0)
  );
```

**Notes.**
- `currentVersion` is bumped transactionally by `documentBundleService.updateMembers()` on any membership change. Run-time snapshots record the bundle version they resolved against — historical runs stay reproducible when the bundle evolves.
- No embedding column; bundles are groupings, not retrieval candidates.
- Soft-delete. A soft-deleted bundle cannot be attached; existing attachments are left in place to preserve historical attribution but are filtered out at resolution time.
- **Unnamed bundle reuse by document-set hash.** When a user attaches the same document set a second time (to a different parent), the backend does NOT create a new unnamed bundle. It reuses the existing unnamed bundle (matched by the document set's canonical hash — see `documentBundleService.findOrCreateUnnamedBundle` in §6.2). This is what makes the bundle-suggestion heuristic in §3.6.4 work: the condition "same doc set is already attached to ≥ 1 other subject" is equivalent to "an unnamed bundle with these documents has an attachment on another subject".
- **Named-bundle promotion path.** When the user accepts the bundle-save suggestion or ticks the upload-time checkbox, the existing unnamed bundle is promoted in place (`is_auto_created` flipped to `false`, `name` set). The bundle's `id` does not change, so existing attachments are preserved — the parents that had the unnamed bundle attached now have the named bundle attached, automatically and without re-issuing attach writes.

### 5.4 `document_bundle_members` table

**File:** `server/db/schema/documentBundleMembers.ts`
**Migration:** `0205_document_bundle_members.sql`

Join table. One row per document-in-bundle membership. Membership is unordered at the table level — ordering is deterministic at resolution time (§6.3) by `documentId` ascending.

```ts
export const documentBundleMembers = pgTable(
  'document_bundle_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bundleId: uuid('bundle_id').notNull().references(() => documentBundles.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull().references(() => referenceDocuments.id, { onDelete: 'restrict' }),

    /** Audit — which bundle version this row was added in. Helps reconstruct historical bundle states. */
    addedInBundleVersion: integer('added_in_bundle_version').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** Audit — which bundle version removed this row. Null while the row is live. */
    removedInBundleVersion: integer('removed_in_bundle_version'),
  },
  (t) => ({
    bundleDocUniq: uniqueIndex('document_bundle_members_bundle_doc_uq')
      .on(t.bundleId, t.documentId)
      .where(sql`${t.deletedAt} IS NULL`),
    bundleIdx: index('document_bundle_members_bundle_idx').on(t.bundleId),
    docIdx: index('document_bundle_members_doc_idx').on(t.documentId),
  })
);
```

**Notes.**
- `onDelete: 'restrict'` on the `referenceDocuments` FK prevents accidental deletion of a document that's a bundle member. Operators must remove the bundle membership first, then delete the document — the UI surfaces this constraint.
- Soft-delete of a membership row leaves a history trail; reactivating a document in a bundle creates a new row rather than un-deleting (keeps the audit trail linear).
- No ordering column. Deterministic ordering is computed at resolution time by `documentId` ascending — cheap, stable, cache-friendly. If user-controlled ordering becomes necessary (§15 open question), an `orderIndex` column can be added later without migration conflict.

### 5.5 `document_bundle_attachments` table

**File:** `server/db/schema/documentBundleAttachments.ts`
**Migration:** `0206_document_bundle_attachments.sql`

The three explicit attachment surfaces live in one table via a discriminator. Agent / task / scheduled-task attach to bundles (not to individual documents).

```ts
export type AttachmentSubjectType = 'agent' | 'task' | 'scheduled_task';
/** v1 always uses 'always_load'. 'available_on_demand' is reserved for the v2 retrieval mode — see §12.6. */
export type AttachmentMode = 'always_load' | 'available_on_demand';

export const documentBundleAttachments = pgTable(
  'document_bundle_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),

    bundleId: uuid('bundle_id').notNull().references(() => documentBundles.id, { onDelete: 'cascade' }),

    /** Polymorphic subject. No FK — enforced at the service layer, not the DB, because three possible target tables. */
    subjectType: text('subject_type').notNull().$type<AttachmentSubjectType>(),
    subjectId: uuid('subject_id').notNull(),

    /** v1 always 'always_load'. Column exists so v2 retrieval can slot in without a schema change. */
    attachmentMode: text('attachment_mode').notNull().default('always_load').$type<AttachmentMode>(),

    /** Audit — who attached this bundle to this subject. */
    attachedByUserId: uuid('attached_by_user_id').references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    bundleSubjectUniq: uniqueIndex('document_bundle_attachments_bundle_subject_uq')
      .on(t.bundleId, t.subjectType, t.subjectId)
      .where(sql`${t.deletedAt} IS NULL`),
    subjectIdx: index('document_bundle_attachments_subject_idx').on(t.subjectType, t.subjectId),
    orgIdx: index('document_bundle_attachments_org_idx').on(t.organisationId),
  })
);
```

**Notes.**
- **Polymorphic subject with no DB-level FK.** The `subjectId` points into `agents`, `tasks`, or `scheduled_tasks` based on `subjectType`. This follows the same pattern as `llm_requests.sourceId` (see `llmRequests.ts` comment above). Enforcement of target-row existence is the service layer's job (`documentBundleService.attach` — §6.2). The checklist §5 execution-model contract is satisfied: the route handler synchronously verifies the subject row exists before inserting the attachment.
- **Three attachment surfaces are exhaustive for v1.** Future surfaces (agent-run-level "just-this-run" attachments, org-level defaults) are deferred and would add new `subjectType` enum values — no schema change required.
- **Soft-delete.** Detaching a bundle preserves the row with `deletedAt` set; the uniqueness index on `(bundle_id, subject_type, subject_id)` is partial-indexed where `deleted_at IS NULL` so re-attaching after a detach creates a fresh row rather than resurrecting the old one — audit-trail linear.
- **No auto-attach in v1.** All attachments are explicit user actions. This contrasts with `memory_block_attachments.source` which supports `auto_attach` — reference documents are explicitly *not* auto-attached by any system pathway (principle §10 of the brief).

### 5.6 `bundle_resolution_snapshots` table

**File:** `server/db/schema/bundleResolutionSnapshots.ts`
**Migration:** `0207_bundle_resolution_snapshots.sql`

One row per unique `(bundle_id, bundle_version, ordered_document_versions, model_family, assembly_version)` — deduplicated by `prefix_hash`. Every run's assembly reads a snapshot row; if an identical snapshot already exists, the run references it rather than inserting a new one.

```ts
export const bundleResolutionSnapshots = pgTable(
  'bundle_resolution_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),

    bundleId: uuid('bundle_id').notNull().references(() => documentBundles.id),
    bundleVersion: integer('bundle_version').notNull(),

    /** Anthropic model family this snapshot was tokenised against. */
    modelFamily: text('model_family').notNull(),
    /** The engine version that produced this snapshot. Bumped per §4.4. */
    assemblyVersion: integer('assembly_version').notNull(),

    /** JSONB array matching the shape in §4.3. Ordered by documentId ascending. `serializedBytesHash` mirrors `reference_document_versions.serializedBytesHash` for the pinned version (§4.3 / §5.2). */
    orderedDocumentVersions: jsonb('ordered_document_versions').notNull().$type<
      Array<{ documentId: string; documentVersion: number; serializedBytesHash: string; tokenCount: number }>
    >(),

    /** Per-bundle prefix-hash identity (§4.4). The unique index below is `(bundle_id, prefix_hash)` — cross-bundle reuse of the same hash is expected and supported at the provider-cache layer; per-bundle attribution stays clean. */
    prefixHash: text('prefix_hash').notNull(),
    prefixHashComponents: jsonb('prefix_hash_components').notNull().$type<PrefixHashComponents>(),

    /** Sum of token counts across all included documents — excludes variable input. */
    estimatedPrefixTokens: integer('estimated_prefix_tokens').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    bundlePrefixHashUniq: uniqueIndex('bundle_resolution_snapshots_bundle_prefix_hash_uq').on(t.bundleId, t.prefixHash),
    prefixHashLookupIdx: index('bundle_resolution_snapshots_prefix_hash_idx').on(t.prefixHash),
    bundleVersionIdx: index('bundle_resolution_snapshots_bundle_version_idx').on(t.bundleId, t.bundleVersion),
    orgIdx: index('bundle_resolution_snapshots_org_idx').on(t.organisationId),
  })
);
```

**Notes.**
- **`UNIQUE(bundle_id, prefix_hash)` is the concurrency guard.** Under cron burst, two runs resolving the same bundle at the same time will race to insert. The first wins; the loser catches the unique-violation error, re-reads the winning row, and carries on. `bundleResolutionService.resolveAtRunStart` (§6.3) owns this retry logic. The non-unique `prefix_hash` index is for cross-bundle lookup (e.g. Usage Explorer queries correlating an `llm_requests.prefix_hash` back to the snapshot row).
- **Two bundles can share a `prefix_hash`.** If Bundle A and Bundle B attach the same document set (same serialized bytes), their per-bundle snapshots will share the same `prefix_hash`. This is expected and beneficial — the provider's cached prefix is the same byte sequence — but each bundle gets its own row under the `(bundle_id, prefix_hash)` unique index, preserving per-bundle utilization and audit attribution.
- **No `deletedAt`.** Snapshots are immutable and retained indefinitely (v1). Retention tiering — deleting snapshots older than N days that are no longer referenced by any run row — is deferred (§12.2).
- **No FK from `agent_runs.bundle_snapshot_ids` to this table.** The agent_runs column is a JSONB array; enforcing RI on array elements is a Postgres anti-pattern. Referential integrity is preserved by never deleting snapshot rows in v1.

### 5.7 `model_tier_budget_policies` table

**File:** `server/db/schema/modelTierBudgetPolicies.ts`
**Migration:** `0208_model_tier_budget_policies.sql`

Seed data for the canonical budget resolver. Per-model-family defaults that can be edited by system admins without a deploy.

```ts
export const modelTierBudgetPolicies = pgTable(
  'model_tier_budget_policies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Nullable = platform default. Non-null = per-org override. */
    organisationId: uuid('organisation_id').references(() => organisations.id),

    modelFamily: text('model_family').notNull(),
    /** Declared model context window (canonical source — the resolver trusts this, not any provider metadata). */
    modelContextWindow: integer('model_context_window').notNull(),

    /** Budget dimensions — all required. */
    maxInputTokens: integer('max_input_tokens').notNull(),
    maxOutputTokens: integer('max_output_tokens').notNull(),
    reserveOutputTokens: integer('reserve_output_tokens').notNull(),
    maxTotalCostUsdCents: integer('max_total_cost_usd_cents').notNull(),
    perDocumentMaxTokens: integer('per_document_max_tokens').notNull(),

    /** Soft-warn as a ratio 0<x<1 of maxInputTokens. */
    softWarnRatio: numeric('soft_warn_ratio', { precision: 4, scale: 3 }).notNull().default('0.700'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgModelUniq: uniqueIndex('model_tier_budget_policies_org_model_uq')
      .on(t.organisationId, t.modelFamily),
    modelIdx: index('model_tier_budget_policies_model_idx').on(t.modelFamily),
  })
);
```

**Seed rows (written in migration 0208 itself, not deferred to a later backfill):**

```sql
INSERT INTO model_tier_budget_policies
  (organisation_id, model_family, model_context_window, max_input_tokens, max_output_tokens, reserve_output_tokens, max_total_cost_usd_cents, per_document_max_tokens, soft_warn_ratio)
VALUES
  (NULL, 'anthropic.claude-sonnet-4-6', 1000000, 800000, 16000, 16000, 500, 100000, 0.700),
  (NULL, 'anthropic.claude-opus-4-7',   1000000, 800000, 16000, 16000, 1000, 100000, 0.700),
  (NULL, 'anthropic.claude-haiku-4-5',  200000,  150000,  8000,  8000, 100,   50000, 0.700);
```

**Capacity invariant (DB CHECK, enforced in migration 0208):**

```sql
ALTER TABLE model_tier_budget_policies ADD CONSTRAINT model_tier_budget_policies_capacity_ck
  CHECK (max_input_tokens + reserve_output_tokens <= model_context_window);
```

This guarantees §4.1's hard invariant at the DB level — no policy row can be inserted that would resolve to an invalid budget. The resolver re-checks at resolution time for defence in depth.

### 5.8 Additions to `agent_runs`

**Migration:** `0209_agent_runs_cached_context.sql`

```sql
ALTER TABLE agent_runs ADD COLUMN bundle_snapshot_ids jsonb;            -- array of bundle_resolution_snapshots.id
ALTER TABLE agent_runs ADD COLUMN variable_input_hash text;           -- SHA-256 of the dynamic (post-breakpoint) content
ALTER TABLE agent_runs ADD COLUMN run_outcome text;                   -- §4.6 enum, nullable while in-flight
ALTER TABLE agent_runs ADD COLUMN soft_warn_tripped boolean NOT NULL DEFAULT false;
ALTER TABLE agent_runs ADD COLUMN degraded_reason text;               -- §4.6 DegradedReason enum; NULL unless run_outcome='degraded'

CREATE INDEX agent_runs_run_outcome_idx ON agent_runs (run_outcome)
  WHERE run_outcome IS NOT NULL;

-- Optional partial index to support degradation-category dashboards without scanning all agent_runs.
CREATE INDEX agent_runs_degraded_reason_idx ON agent_runs (degraded_reason)
  WHERE degraded_reason IS NOT NULL;
```

**Drizzle diff in `server/db/schema/agentRuns.ts`:**

```ts
// appended to existing table definition
bundleSnapshotIds: jsonb('bundle_snapshot_ids').$type<string[]>(),
variableInputHash: text('variable_input_hash'),
runOutcome: text('run_outcome').$type<'completed' | 'degraded' | 'failed'>(),
softWarnTripped: boolean('soft_warn_tripped').notNull().default(false),
degradedReason: text('degraded_reason').$type<'soft_warn' | 'token_drift' | 'cache_miss'>(),
```

**Notes.**
- `bundleSnapshotIds` is JSONB (array of UUIDs) rather than a dedicated join table. Rationale: a run references at most ~5 snapshots (one per attached bundle, and v1 expects 1–2 bundles per run); the join table overhead isn't justified.
- `runOutcome` is nullable on purpose — `NULL` means in-flight. Terminal writes set it atomically with the LLM-request status (§9.3).
- `softWarnTripped` is a cheap boolean hoisted out of JSONB so dashboards can filter without JSON ops.
- `degradedReason` is the diagnostic enum recorded alongside `run_outcome='degraded'` (§4.6). Text-typed with Drizzle enum pinning; nullable (always `NULL` when `run_outcome != 'degraded'`); not surfaced to users. Precedence when multiple conditions trip simultaneously: `soft_warn` > `token_drift` > `cache_miss`, computed in `cachedContextOrchestrator` (§6.6 terminal write).

### 5.9 Additions to `llm_requests`

**Migration:** `0210_llm_requests_cached_context.sql`

```sql
ALTER TABLE llm_requests ADD COLUMN cache_creation_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE llm_requests ADD COLUMN prefix_hash text;

CREATE INDEX llm_requests_prefix_hash_idx ON llm_requests (prefix_hash)
  WHERE prefix_hash IS NOT NULL;
```

**Drizzle diff in `server/db/schema/llmRequests.ts`:**

```ts
// appended to existing table definition
cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
prefixHash: text('prefix_hash'),
```

**Notes.**
- `cache_creation_tokens` pairs with the existing `cached_prompt_tokens` (which currently captures `cache_read_input_tokens`). The router's cache-capture path (§6.6) populates both from `response.usage`.
- `prefix_hash` is nullable — only cached-context calls carry one. Non-cached-context calls keep `NULL`. Dashboards filter on `WHERE prefix_hash IS NOT NULL` for cache-attribution queries.
- No `prefix_hash_components` column on `llm_requests` — components live per-bundle on the snapshot rows (§5.6). `llm_requests.prefix_hash` is the call-level assembled hash and does not directly key a single snapshot row; diagnosis joins via `agent_runs.bundle_snapshot_ids` (see §4.4 diagnosis path).

### 5.10 Additions to `scheduled_tasks` (optional surface)

**Migration:** `0211_scheduled_tasks_bundle_attachment.sql` (skippable — see note).

No schema change to `scheduled_tasks` itself. Bundle attachments at the schedule level are stored as rows in `document_bundle_attachments` with `subject_type='scheduled_task'`, `subject_id=scheduled_task.id`. The attachment service enforces that `subject_id` refers to an existing schedule row.

**Migration 0211 is empty** — it is retained as a no-op slot in the numbering sequence so a future schema addition to scheduled_tasks (e.g. `default_attachment_mode`) can land at 0211 without renumbering. Alternatively, 0211 can be skipped entirely and the next migration lands at 0211.

**Decision recorded (§15): skip 0211 entirely.** Migrations are not numbered sequentially by convention (numbers may have gaps from reverted work). The 0211 slot is not reserved.

### 5.11 Indexes, constraints, and invariants summary

**Unique indexes (data integrity):**

| Table | Index | Purpose |
|---|---|---|
| `reference_documents` | `(organisation_id, name) WHERE deleted_at IS NULL` | Prevents duplicate names within an org |
| `reference_document_versions` | `(document_id, version)` | Monotonic version per document |
| `document_bundles` | `(organisation_id, name) WHERE deleted_at IS NULL AND name IS NOT NULL` | Prevents duplicate NAMED-bundle names within an org; unnamed bundles (name IS NULL) are excluded from the uniqueness constraint |
| `document_bundle_members` | `(bundle_id, document_id) WHERE deleted_at IS NULL` | Prevents duplicate membership |
| `document_bundle_attachments` | `(bundle_id, subject_type, subject_id) WHERE deleted_at IS NULL` | Prevents duplicate attachment |
| `bundle_resolution_snapshots` | `(bundle_id, prefix_hash)` | Dedup across concurrent resolution, per bundle (cross-bundle prefix sharing permitted) |
| `model_tier_budget_policies` | `(organisation_id, model_family)` | One policy per org per model, NULL org = platform default |
| `bundle_suggestion_dismissals` | `(user_id, doc_set_hash)` | One dismissal per user per doc set; idempotent second dismissal |

**DB CHECK constraints:**

| Table | Constraint | Purpose |
|---|---|---|
| `model_tier_budget_policies` | `max_input_tokens + reserve_output_tokens <= model_context_window` | Capacity invariant (§4.1) |
| `document_bundles` | `(is_auto_created=true AND name IS NULL) OR (is_auto_created=false AND name IS NOT NULL AND length(trim(name)) > 0)` | Unnamed bundle vs named-bundle invariant (§5.3) — name is present iff and only iff the bundle has been promoted |

**Soft-FK columns (no DB RI, service-layer enforcement):**

| Table | Column | Notes |
|---|---|---|
| `reference_documents` | `current_version_id → reference_document_versions.id` | Circular dep avoidance |
| `document_bundle_attachments` | `subject_id → agents.id / tasks.id / scheduled_tasks.id` | Polymorphic |

**Invariants not expressible as constraints (enforced at service layer — see §6):**

| Invariant | Enforced in |
|---|---|
| Reference-document pausing excludes from assembly | `bundleResolutionService.resolveAtRunStart` |
| Bundle attachment subject row must exist | `documentBundleService.attach` |
| Assembly-version bump required on engine logic change | `contextAssemblyEnginePure.test.ts` fixture assertion |
| Run outcome written exactly once | `cachedContextOrchestrator.execute` — single-row `UPDATE agent_runs SET run_outcome = :outcome WHERE id = :runId AND run_outcome IS NULL` (optimistic lock; duplicate terminal writes under retry update 0 rows and are treated as idempotent no-ops) |
| No silent fallback (no auto-truncation, auto-drop, auto-downgrade) | `contextAssemblyEngine.validate` raises `BudgetBreachError` instead of mutating the payload |
| Unnamed bundle reuse across attachments with identical doc sets | `documentBundleService.findOrCreateUnnamedBundle` — canonical doc-set hash lookup before insert |
| Named-bundle promotion is a one-way transition | `documentBundleService.promoteToNamedBundle` — rejects rows with `is_auto_created=false` |

### 5.12 `bundle_suggestion_dismissals` table

**File:** `server/db/schema/bundleSuggestionDismissals.ts`
**Migration:** `0212_bundle_suggestion_dismissals.sql`

Records per-user permanent dismissals of the bundle-save suggestion (§3.6.4). One row per (user, doc-set-hash) pair. When the suggestion fires, the service checks for a matching row and suppresses the prompt if present.

```ts
export const bundleSuggestionDismissals = pgTable(
  'bundle_suggestion_dismissals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    userId: uuid('user_id').notNull().references(() => users.id),

    /**
     * Canonical hash of the document set the user dismissed. Computed by
     * `documentBundleServicePure.computeDocSetHash(documentIds: string[])` — sorts
     * the IDs ascending and hashes the sorted sequence with SHA-256. The same
     * primitive is used by `contextAssemblyEnginePure.computePrefixHash` (§4.4)
     * for its `orderedDocumentIds` sub-hash component, so matching dismissed
     * sets against live attachments is a single hash comparison.
     */
    docSetHash: text('doc_set_hash').notNull(),

    dismissedAt: timestamp('dismissed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    /** One dismissal per user per doc set. A second dismiss of the same set is a no-op. */
    userDocSetUniq: uniqueIndex('bundle_suggestion_dismissals_user_doc_set_uq')
      .on(t.userId, t.docSetHash),
    /** Fast lookup by user for cleanup or cross-org views. */
    userIdx: index('bundle_suggestion_dismissals_user_idx').on(t.userId),
    /** Org-scoped RLS support. */
    orgIdx: index('bundle_suggestion_dismissals_org_idx').on(t.organisationId),
  })
);
```

**Notes.**
- **Scoping: per-user, not per-org.** A second user in the same org who attaches the same doc set sees the suggestion the first time — dismissals are the personal preference of the user who did the dismissing.
- **No soft-delete.** Dismissals are permanent per the §3.6.4 heuristic. If a future UX change wants to support un-dismissing, it will add a `deleted_at` column then.
- **`doc_set_hash` is not a foreign key to `bundle_resolution_snapshots.prefix_hash`.** The two hashes are related but not identical (the snapshot prefix hash also includes `model_family` + `assembly_version`); the dismissal hash is just the doc-ID set. Decoupling keeps the dismissal table engine-version-agnostic — an `assembly_version` bump does not invalidate dismissals.
- **RLS.** The table is org-scoped via `organisation_id`, with an additional user-identity check in the read path: `bundleSuggestionDismissals.findForUser(userId, docSetHash)` joins through the user context so a user cannot see other users' dismissals even within the same org. Full RLS clause in §8.1.

**Example row:**

```json
{
  "id": "bsd_5f2a...",
  "organisationId": "org_abc...",
  "subaccountId": null,
  "userId": "usr_42...",
  "docSetHash": "0xaf2c91...",
  "dismissedAt": "2026-04-23T14:32:17Z"
}
```

---

## 6. Services

All services follow the repo's split convention: a stateful `*.ts` file that handles I/O (DB access via Drizzle, external calls) and a pure `*Pure.ts` sibling exporting deterministic functions that are unit-testable without a DB. The `Pure.ts` files are the primary test surface per `docs/spec-context.md` (`runtime_tests: pure_function_only`).

All services throw errors in the `{ statusCode, message, errorCode }` shape caught by `asyncHandler`. Service-layer errors carry `errorCode` strings prefixed `CACHED_CONTEXT_*`.

### 6.1 `referenceDocumentService` (+ `referenceDocumentServicePure`)

**File:** `server/services/referenceDocumentService.ts` + `server/services/referenceDocumentServicePure.ts`

Owns the CRUD + versioning + token-counting lifecycle for `reference_documents` and `reference_document_versions`.

**Public surface (stateful):**

```ts
export interface ReferenceDocumentService {
  create(input: {
    organisationId: string;
    subaccountId: string | null;
    name: string;
    description?: string;
    content: string;
    createdByUserId: string;
  }): Promise<ReferenceDocument>;

  updateContent(input: {
    documentId: string;
    content: string;
    updatedByUserId: string;
    notes?: string;
  }): Promise<ReferenceDocumentVersion>;

  rename(input: { documentId: string; newName: string }): Promise<ReferenceDocument>;

  pause(documentId: string, userId: string): Promise<void>;
  resume(documentId: string, userId: string): Promise<void>;
  deprecate(input: { documentId: string; reason: string; userId: string }): Promise<void>;
  softDelete(documentId: string, userId: string): Promise<void>;

  listByOrg(organisationId: string, filters?: { subaccountId?: string | null; includeDeleted?: boolean }): Promise<ReferenceDocument[]>;
  getByIdWithCurrentVersion(documentId: string): Promise<{ doc: ReferenceDocument; version: ReferenceDocumentVersion } | null>;
  listVersions(documentId: string): Promise<ReferenceDocumentVersion[]>;
  getVersion(documentId: string, version: number): Promise<ReferenceDocumentVersion | null>;
}
```

**Public surface (pure):**

```ts
export function hashContent(content: string): string; // SHA-256
export function hashSerialized(serialized: string): string;
export function serializeDocument(args: { documentId: string; version: number; content: string }): string; // see §6.4 for the format
```

**Key behaviours.**

- **`create`** inserts a `reference_documents` row AND a `reference_document_versions` row (version 1) in a single transaction. Token counts are computed against all three model families (Sonnet / Opus / Haiku) via the Anthropic SDK `countTokens` endpoint, invoked via a helper in `server/services/providers/anthropicAdapter.ts` (new helper function, not on the existing adapter call path). `serializedBytesHash` is computed over `serializeDocument(...)`.
- **`updateContent`** is idempotent by `contentHash`: if the new content's hash matches the current version's `contentHash`, the call is a no-op and returns the existing version. Otherwise it writes a new version row with `version = currentVersion + 1` and advances the `currentVersionId` + `currentVersion` pointer on the document row, all in one transaction. Token counts are recomputed.
- **`pause` / `resume` / `deprecate`** flip the lifecycle columns on `reference_documents`. Pause is reversible; deprecation is forward-only (the document cannot be added to new bundles after deprecation but remains in existing bundles — the bundle's resolution will exclude it via `included_flags`). Soft-delete is a stronger form — excludes from every listing plus every resolution.
- **Authorisation.** The service does NOT enforce permissions itself — route handlers enforce org scope and permission keys (§7, §8). The service assumes a pre-validated `organisationId` and `subaccountId`.

**Error codes:**

- `CACHED_CONTEXT_DOC_NAME_TAKEN` — another document in the org has the same name (409).
- `CACHED_CONTEXT_DOC_NOT_FOUND` (404).
- `CACHED_CONTEXT_DOC_ALREADY_DEPRECATED` (409).
- `CACHED_CONTEXT_DOC_TOKEN_COUNT_FAILED` (502) — upstream `countTokens` failed; the document is not persisted.
- `CACHED_CONTEXT_DOC_CONTAINS_DELIMITER` (400) — document content contains the reserved `---DOC_END---` delimiter (§6.4).
- `CACHED_CONTEXT_DOC_TOKEN_COUNT_MISSING` (500) — assembly requested a `modelFamily` whose `tokenCounts` key is missing from a stored version row; triggers the §12.14 backfill escalation.

**Token-count failure policy.** If `countTokens` fails for any of the three model families, the document create / update-content operation rolls back. No document is persisted without its token counts for all declared model families. This is strict by design: the budget resolver MUST be able to answer "does this fit?" for any model without a re-measurement round trip. Retry is the caller's responsibility.

### 6.2 `documentBundleService` (+ `documentBundleServicePure`)

**File:** `server/services/documentBundleService.ts` + `server/services/documentBundleServicePure.ts`

Owns CRUD for `document_bundles`, `document_bundle_members`, and `document_bundle_attachments`.

**Public surface (stateful):**

```ts
export interface DocumentBundleService {
  /** Explicit named-bundle creation. Not surfaced in the UI in v1 (§3.6.7). Retained for API completeness. */
  create(input: {
    organisationId: string;
    subaccountId: string | null;
    name: string;
    description?: string;
    createdByUserId: string;
  }): Promise<DocumentBundle>;

  /**
   * Core attach-flow primitive (§3.6.3 Flow A). Given a set of document IDs, returns either
   * (a) an existing unnamed bundle whose members match the input set exactly, or (b) a new
   * unnamed bundle with those members inserted in the same transaction. The returned bundle has
   * `isAutoCreated = true` and `name = null`.
   *
   * Matching is by canonical doc-set hash (§5.12 — same hash used for dismissal tracking).
   * Lookup is scoped to `(organisationId, subaccountId)` — a doc set belonging to different
   * orgs produces different unnamed bundles even if the hash coincides.
   *
   * Idempotent under concurrent calls: two parallel requests with identical inputs will race
   * on the doc-set hash lookup; the loser catches the unique-violation error and re-selects
   * the winner's row. The returned bundle is always the unique row for the (org, subaccount,
   * doc-set-hash) triple.
   */
  findOrCreateUnnamedBundle(input: {
    organisationId: string;
    subaccountId: string | null;
    documentIds: string[];
    createdByUserId: string;
  }): Promise<DocumentBundle>;

  /**
   * Promotes an existing unnamed bundle to a named bundle (§3.6.3 Flow D accept, §3.6.5 upload
   * checkbox). Flips `is_auto_created` from true to false and sets `name`. Rejects with
   * `CACHED_CONTEXT_BUNDLE_ALREADY_NAMED` (409) if the bundle is already `is_auto_created=false`.
   * Rejects with `CACHED_CONTEXT_BUNDLE_NAME_TAKEN` (409) if another non-auto bundle in the same
   * org already has this name.
   *
   * Promotion is a one-way transition — demotion (named → auto) is not supported.
   *
   * Importantly, the bundle's `id` does NOT change. Existing `document_bundle_attachments` rows
   * referring to this bundle continue to work; the parents that had the unnamed bundle attached now
   * have the named bundle attached, without re-issuing attach writes.
   */
  promoteToNamedBundle(input: {
    bundleId: string;
    name: string;
    userId: string;
  }): Promise<DocumentBundle>;

  /**
   * Bundle-save suggestion lookup (§3.6.4). Returns whether the suggestion should fire for
   * the given user + doc set, and — if it should — how many OTHER subjects currently have
   * this doc set attached (used for the "attached to N tasks" copy in the suggestion card).
   *
   * Condition truth table:
   * - `documentIds.length < 2`: always returns { suggest: false }
   * - Any dismissal row exists for (userId, docSetHash): { suggest: false }
   * - A named bundle (is_auto_created=false) exists with this exact doc set: { suggest: false }
   * - Otherwise, counts distinct subjects attached to the unnamed bundle with this doc set:
   *   - count === 0: { suggest: false } — just created, nothing to suggest yet
   *   - count === 1: { suggest: false } — only attached to the current subject
   *   - count >= 2: { suggest: true, alsoUsedOn: count - 1, docSetHash, unnamedBundleId }
   *
   * The `excludeSubjectId` parameter is used when the caller is in the middle of a save
   * flow and needs to exclude the subject they just saved to from the "other attachments"
   * count. It is NOT used for access control.
   */
  suggestBundle(input: {
    organisationId: string;
    subaccountId: string | null;
    userId: string;
    documentIds: string[];
    excludeSubjectId?: { subjectType: AttachmentSubjectType; subjectId: string };
  }): Promise<BundleSuggestion>;

  /**
   * Records a permanent dismissal of the bundle-save suggestion for the given user + doc set
   * (§3.6.4). Idempotent: second call with the same inputs is a no-op and returns the existing
   * dismissal's timestamp rather than raising a uniqueness error.
   */
  dismissBundleSuggestion(input: {
    organisationId: string;
    subaccountId: string | null;
    userId: string;
    documentIds: string[];
  }): Promise<BundleSuggestionDismissal>;

  addMember(input: { bundleId: string; documentId: string }): Promise<DocumentBundleMember>;
  removeMember(input: { bundleId: string; documentId: string }): Promise<void>;

  attach(input: {
    bundleId: string;
    subjectType: 'agent' | 'task' | 'scheduled_task';
    subjectId: string;
    attachedByUserId: string;
  }): Promise<DocumentBundleAttachment>;
  detach(input: { bundleId: string; subjectType: AttachmentSubjectType; subjectId: string }): Promise<void>;

  /**
   * Lists ONLY named bundles (is_auto_created=false). Used by the "Your bundles" section of
   * the attach picker (§3.6.3) and the bundles list page. Unnamed bundles are deliberately excluded.
   */
  listBundles(organisationId: string, filters?: { subaccountId?: string | null }): Promise<DocumentBundle[]>;

  /**
   * Lists ALL bundles including unnamed bundles. Admin-only; not exposed on user-facing routes.
   */
  listAllBundles(organisationId: string, filters?: { subaccountId?: string | null }): Promise<DocumentBundle[]>;

  getBundleWithMembers(bundleId: string): Promise<{ bundle: DocumentBundle; members: Array<{ member: DocumentBundleMember; document: ReferenceDocument }> } | null>;
  listAttachmentsForSubject(input: { subjectType: AttachmentSubjectType; subjectId: string }): Promise<DocumentBundleAttachment[]>;

  softDelete(bundleId: string, userId: string): Promise<void>;
}

/** Return type for suggestBundle (§6.2). */
export type BundleSuggestion =
  | { suggest: false }
  | {
      suggest: true;
      alsoUsedOn: number;         // count of OTHER subjects already attached (>= 1)
      docSetHash: string;          // for passing back to dismissBundleSuggestion or promoteToNamedBundle
      unnamedBundleId: string;          // the existing unnamed bundle that would be promoted
    };

export interface BundleSuggestionDismissal {
  id: string;
  userId: string;
  docSetHash: string;
  dismissedAt: string; // ISO 8601
}
```

**Pure helpers (`documentBundleServicePure.ts`):**

```ts
/**
 * Canonical doc-set hash (§5.12 field `docSetHash`). Sorts IDs ascending then hashes with
 * SHA-256. Must produce the same value as `contextAssemblyEnginePure.computePrefixHash`'s
 * `orderedDocumentIds` sub-hash (§4.4). Unit tested on both modules with a shared fixture.
 */
export function computeDocSetHash(documentIds: string[]): string;
```

**Key behaviours.**

- **`create`** inserts the bundle at `currentVersion = 1` with `isAutoCreated = false` and `name` set. Retained for API completeness; not surfaced in the v1 UI (§3.6.7).
- **`findOrCreateUnnamedBundle`** is the core attach-flow primitive. Canonical-hash lookup within the org scope; INSERT on miss under a unique constraint (`document_bundles` would reject the duplicate through the service-layer de-duplication via the hash — note the DB doesn't enforce this directly, so the service's concurrency handling has an `ON CONFLICT DO NOTHING + re-select` pattern on the members join).
- **`promoteToNamedBundle`** performs an UPDATE in a single transaction: `UPDATE document_bundles SET is_auto_created = false, name = :name, updated_at = now() WHERE id = :bundleId AND is_auto_created = true`. If 0 rows are updated, the bundle is already named — raise `CACHED_CONTEXT_BUNDLE_ALREADY_NAMED`. Name-uniqueness is caught by the partial unique index.
- **`suggestBundle`** is a read-only lookup composing three queries: (1) existence check in `bundle_suggestion_dismissals`, (2) existence check for a named bundle with this doc set (joins `document_bundles` + `document_bundle_members`), (3) attachment count for the matching unnamed bundle. Returns in < 20ms at p95 under expected v1 volumes.
- **`dismissBundleSuggestion`** issues `INSERT INTO bundle_suggestion_dismissals ... ON CONFLICT (user_id, doc_set_hash) DO UPDATE SET dismissed_at = excluded.dismissed_at` so a second dismissal re-stamps the timestamp without raising.
- **`addMember` / `removeMember`** each bump `document_bundles.currentVersion` in the same transaction. Re-adding a previously-removed document creates a new `document_bundle_members` row (soft-deleted rows are left in place). The bundle-version bump is the signal that bundle state has changed — `bundleResolutionService` reads the current version and builds a fresh snapshot on the next run. **Editing a named bundle affects every subject the bundle is attached to** — this is the UX invariant surfaced by the "Used by: 2 tasks" warning on the bundle-detail page (§3.6.3 Flow E, mockup 3); the backend behaviour is unchanged.
- **`attach`** verifies the subject row exists by table lookup (`agents` / `tasks` / `scheduled_tasks`) and that the subject's org scope matches the bundle's org scope. The polymorphic FK is service-enforced here.
- **Single-attachment-per-parent invariant (named).** A given bundle may be attached to a given `(subject_type, subject_id)` at most once, concurrently. The partial unique index `(bundle_id, subject_type, subject_id) WHERE deleted_at IS NULL` (§5.5) enforces this at the DB level. Service behaviour: `attach` is **idempotent** under duplicate calls — a second `attach` for an already-live attachment returns the existing row rather than raising an error or creating a second row. This is a deliberate UX choice (a double-click should not error); the "rejected" behaviour is achieved structurally through idempotency rather than by raising a uniqueness violation. A re-attach against a soft-deleted row INSERTS a fresh row — the partial unique index permits this because `deleted_at IS NULL` excludes the soft-deleted row from the uniqueness constraint; the audit trail stays linear rather than resurrecting old attribution.
- **`detach`** soft-deletes the row. Live attachments under a soft-deleted bundle return no results in `listAttachmentsForSubject` — the bundle-level soft-delete is authoritative.
- **`softDelete` (bundle deletion semantics).** `softDelete` sets `document_bundles.deletedAt` on the bundle row — a **wrapper-only removal**. It does NOT cascade:
  - The bundle's member documents (`reference_documents`) are NOT deleted. They remain in the library and can still be individually attached, added to other bundles, or uploaded into new bundles.
  - Existing `bundle_resolution_snapshots` rows referencing the deleted bundle remain intact. Historical runs that referenced those snapshots via `agent_runs.bundle_snapshot_ids` are still auditable — the snapshot's pinned `orderedDocumentVersions` are readable, and the engine can still reconstruct the prefix bytes if asked.
  - `agent_runs` rows are not touched. A run that completed against a now-deleted bundle keeps its `run_outcome`, `bundle_snapshot_ids`, and attribution exactly as recorded.
  - Live `document_bundle_attachments` rows under a soft-deleted bundle become invisible to `listAttachmentsForSubject` (filtered at the bundle-level soft-delete). New runs on those subjects will raise `CACHED_CONTEXT_NO_BUNDLES_ATTACHED` if nothing else is attached.
  The user-facing consequence: "Delete bundle" removes the reusable group but preserves every underlying document, every historical record, and every audit trail. Recreation is an explicit "Create bundle" action — there is no undelete.
- **Authorisation** — same pattern as `referenceDocumentService`: routes enforce, service trusts.

**Error codes:**

- `CACHED_CONTEXT_BUNDLE_NAME_TAKEN` (409) — promoting an unnamed bundle to a name already used by another named bundle in this org.
- `CACHED_CONTEXT_BUNDLE_ALREADY_NAMED` (409) — calling `promoteToNamedBundle` on a bundle that's already `is_auto_created=false`.
- `CACHED_CONTEXT_BUNDLE_NOT_FOUND` (404).
- `CACHED_CONTEXT_DOC_CANT_ADD_DEPRECATED` (409) — attempt to add a deprecated document to a bundle.
- `CACHED_CONTEXT_BUNDLE_SUBJECT_NOT_FOUND` (404) — attach target row does not exist.
- `CACHED_CONTEXT_BUNDLE_SUBJECT_ORG_MISMATCH` (403) — attach target belongs to a different org.
- `CACHED_CONTEXT_BUNDLE_NAME_EMPTY` (400) — attempted promote with empty/whitespace-only name.

**Invariants (enforced by service + DB):**

1. Calling `findOrCreateUnnamedBundle` twice with identical inputs returns the same bundle row (idempotent by doc-set hash scoped to org + subaccount).
2. A bundle with `is_auto_created=true` never has a non-null name (DB CHECK, §5.3).
3. A bundle with `is_auto_created=false` always has a non-null, non-empty name (DB CHECK, §5.3).
4. Promotion preserves `id` — attachments are not moved, re-issued, or invalidated.
5. Dismissals are idempotent per (user, doc-set-hash).
6. **Unnamed bundle identity is stable and independent of attachment context.** The bundle row produced by `findOrCreateUnnamedBundle` is a function purely of `(organisationId, subaccountId, documentIds)`. It does NOT vary with: the calling `subjectType` / `subjectId`, the user's role, whether the attach flow was triggered from upload vs picker, the current model family, or any lifecycle flag on the documents. Two attach flows for the same doc set at the same (org, subaccount) scope always resolve to the same bundle row — which is what makes the bundle-suggestion heuristic in §3.6.4 work. This invariant prevents accidental unnamed bundle forking by a future code path that adds an extra discriminator to the lookup.
7. **Promotion does not alter membership, identity, or hash identity.** `promoteToNamedBundle` changes exactly three columns: `is_auto_created` (true → false), `name` (null → user-supplied), `updated_at` (now). It does NOT change: `id`, `organisation_id`, `subaccount_id`, `current_version`, `created_by_user_id`, `created_at`, the set of rows in `document_bundle_members` for this bundle, or any downstream `bundle_resolution_snapshots.prefix_hash` value. This preserves cache reuse across the promotion boundary (same bundle → same snapshots → same cached prefixes) and protects `agent_runs.bundle_snapshot_ids` integrity for historical runs.
8. **`suggestBundle` is deterministic over queried state.** Given the same `(organisationId, subaccountId, userId, documentIds)` input and the same DB state, `suggestBundle` returns the same result on every call. The output is a pure function over the four conditions in §3.6.4; no time-based tiebreaks, no A/B sampling, no ordering-dependent signals.
9. **Suggestion detection operates on indexed lookups, not full attachment scans.** Implementation of `suggestBundle` must resolve "is this doc set attached elsewhere?" via indexed queries — the `document_bundles` lookup by canonical doc-set hash (matching `findOrCreateUnnamedBundle`'s identity), the partial index on named bundles for the existing-named-bundle check, and the `bundle_suggestion_dismissals` unique index by `(user_id, doc_set_hash)`. The three-query composition in §6.2's `suggestBundle` description must not be implemented as a join that scans `document_bundle_attachments` without an index-backed predicate on the matching unnamed-bundle ID. Performance target: p95 < 20ms under pilot volumes.

### 6.3 `bundleResolutionService` (+ `bundleResolutionServicePure`)

**File:** `server/services/bundleResolutionService.ts` + `server/services/bundleResolutionServicePure.ts`

Owns run-start snapshotting. Called exactly once per run, at the top of the cached-context orchestrator path.

**Run isolation invariant (load-bearing).** Snapshot resolution fully isolates a run from subsequent bundle or document mutations. Once `resolveAtRunStart` returns the snapshot set for a run, that run reads its context exclusively from those pinned snapshots for its entire lifetime — no live re-read of `document_bundles`, `document_bundle_members`, or `reference_document_versions` is permitted after resolution, even if a user edits the bundle or a document version mid-run. The engine's read-time integrity check (§6.4) reads the pinned `reference_document_versions` row by `(documentId, documentVersion)` and verifies the bytes still hash to the snapshot's recorded value; this is integrity verification against tampering, not re-resolution against live state. Together with the fail-fast rule in §6.4 (snapshot integrity mismatch → terminate the run), this gives per-run reproducibility as a hard property: the input side of every run is a function of exactly one snapshot set, captured at one point in time, and never re-evaluated.

**Resolution is version-locked against concurrent bundle edits (mid-resolution consistency invariant).** Within a single `resolveAtRunStart` call, the read of `document_bundles.currentVersion`, the read of `document_bundle_members` for that bundle version, and the computation of `prefix_hash_components` MUST observe a single consistent view of the bundle's state. A user edit that lands between "read bundle.currentVersion = N" and "read members at version N" must not produce a snapshot that mixes version-N bundle identity with version-(N+1) member rows. Implementation: the resolution transaction uses one of (a) Postgres `REPEATABLE READ` isolation for the duration of the read-set, or (b) `SELECT ... FOR KEY SHARE` on the target `document_bundles` row before reading `document_bundle_members` (preventing mutators from committing during the read), or (c) an explicit "version-lock": capture `bundle.currentVersion` in the first read and re-verify it is still that value after reading members — if not, retry the whole resolution from the top. All three produce the same guarantee: the snapshot written to `bundle_resolution_snapshots` reflects one point-in-time bundle state, never a mid-edit split. Partial reads across bundle mutations are a bug and must fail the resolution (the retry branch of option (c) is the service's correctness response).

**Public surface (stateful):**

```ts
export interface BundleResolutionService {
  /**
   * Resolves every bundle attached to the given subject into persisted snapshot rows.
   * Dedups by prefix-hash. Returns the snapshot rows and the total estimated prefix tokens.
   */
  resolveAtRunStart(input: {
    organisationId: string;
    subaccountId: string | null;
    subjectType: AttachmentSubjectType;
    subjectId: string;
    modelFamily: string;
    assemblyVersion: number;
  }): Promise<{
    snapshots: BundleResolutionSnapshot[];
    totalEstimatedPrefixTokens: number;
  }>;

  getSnapshot(snapshotId: string): Promise<BundleResolutionSnapshot | null>;
}
```

**Public surface (pure):**

```ts
/** Produces the ordered document-version list for a given bundle at a given point in time. The `serializedBytesHash` mirrors `reference_document_versions.serializedBytesHash` (§5.2). */
export function orderDocumentsDeterministically(
  members: Array<{ documentId: string; documentVersion: number; serializedBytesHash: string; tokenCount: number; pausedAt: Date | null; deprecatedAt: Date | null }>
): Array<{ documentId: string; documentVersion: number; serializedBytesHash: string; tokenCount: number }>;

/** Produces the snapshot row candidate — full shape except DB-generated id + createdAt. */
export function buildSnapshotRow(input: {
  organisationId: string;
  subaccountId: string | null;
  bundleId: string;
  bundleVersion: number;
  modelFamily: string;
  assemblyVersion: number;
  orderedDocumentVersions: Array<{ documentId: string; documentVersion: number; serializedBytesHash: string; tokenCount: number }>;
}): {
  orderedDocumentVersions: Array<{ documentId: string; documentVersion: number; serializedBytesHash: string; tokenCount: number }>;
  prefixHash: string;
  prefixHashComponents: PrefixHashComponents;
  estimatedPrefixTokens: number;
};
```

**Key behaviours.**

- **`resolveAtRunStart` under a single transaction:**
  1. Read all `document_bundle_attachments` where `subject_type / subject_id` match and `deleted_at IS NULL`. Filter out bundles whose own `deleted_at IS NOT NULL`.
  2. For each bundle: read the bundle's current version + all live members + each member's current version row.
  3. Filter out paused (`pausedAt` set) and deprecated (`deprecatedAt` set) documents, and soft-deleted documents.
  4. **Token-count presence check.** For each surviving document version row, assert `tokenCounts[modelFamily]` is present. If any row is missing the key, abort with `CACHED_CONTEXT_DOC_TOKEN_COUNT_MISSING` (500) — this is the runtime check site referenced from §6.1's error-code list and §12.14's backfill trigger. The orchestrator maps this to `failureReason='document_token_count_missing'` (§6.6 failure mapping).
  5. Order by `documentId` ascending (via the pure `orderDocumentsDeterministically`).
  6. Compute the prefix-hash components (§4.4) and final `prefixHash` via `contextAssemblyEnginePure.computePrefixHash` (cross-service call — pure-layer only).
  7. Attempt `INSERT ... ON CONFLICT (bundle_id, prefix_hash) DO NOTHING RETURNING *`. If no row returned, the conflict fired — re-select the existing row by `(bundle_id, prefix_hash)`. If the re-select ALSO returns zero rows (extremely rare — only possible if the winning transaction is still uncommitted at the loser's read time under snapshot-isolation edge cases), retry the `INSERT ... ON CONFLICT ... RETURNING` up to 3 times; if all three retries lose and still re-select zero rows, abort with `CACHED_CONTEXT_SNAPSHOT_CONCURRENCY_LOST` (500). The orchestrator maps this to `failureReason='snapshot_concurrency_lost'`.
  8. Sum `estimatedPrefixTokens` across all snapshots (one per bundle).
- **No writes to live tables.** This service reads documents / versions / bundles / members / attachments and writes only to `bundle_resolution_snapshots`.
- **Execution model.** Synchronous, called inline from the orchestrator. See §9.

**Error codes:**

- `CACHED_CONTEXT_NO_BUNDLES_ATTACHED` (409) — called on a subject with zero attached bundles. Orchestrator maps to `failureReason='no_bundles_attached'` (pilot-mode behaviour; future §12.8 fallback).
- `CACHED_CONTEXT_DOC_TOKEN_COUNT_MISSING` (500) — a surviving document version row has no `tokenCounts[modelFamily]` key for the requested model family. Orchestrator maps to `failureReason='document_token_count_missing'`. Triggers §12.14 backfill path.
- `CACHED_CONTEXT_SNAPSHOT_CONCURRENCY_LOST` (500) — `ON CONFLICT DO NOTHING` retries exhausted without observing the winning row (snapshot-isolation edge case). Orchestrator maps to `failureReason='snapshot_concurrency_lost'`.

**Concurrency invariant.** The `UNIQUE(bundle_id, prefix_hash)` constraint + `ON CONFLICT DO NOTHING` + re-select pattern is the full concurrency story. Two concurrent runs resolving identical snapshots for the same bundle will both end up with the same winning row. Under Postgres's default `READ COMMITTED` isolation level, the loser's re-select sees the winner's committed row, not its own failed insert — no row-level locking is needed.

**Snapshot-insert idempotency (named invariant).** Snapshot insertion is idempotent under concurrent attempts: N parallel resolutions of the same `(bundle_id, prefix_hash)` all converge to exactly one row in `bundle_resolution_snapshots`. Callers MUST treat "INSERT then fall back to re-select" as the contract. No caller ever sees a failed insert as an error; the only failure mode is `CACHED_CONTEXT_SNAPSHOT_CONCURRENCY_LOST` after N retry attempts also fail to observe the winning row (pathological edge case tied to snapshot isolation, not to the unique constraint). This idempotency composes with the mid-resolution consistency invariant above: the full resolution transaction is safe under arbitrary concurrent edits and arbitrary concurrent resolutions.

### 6.4 `contextAssemblyEngine` + `contextAssemblyEnginePure`

**File:** `server/services/contextAssemblyEngine.ts` + `server/services/contextAssemblyEnginePure.ts`

The engine. One implementation, explicitly pipelined `assemble → validate → (optional transform) → execute`. v1 has no transforms — the slot exists for future degrade strategies.

**Public surface (stateful — minimal wrapper):**

```ts
export interface ContextAssemblyEngine {
  /**
   * Full pipeline: assemble → validate. Does NOT execute the call — returns a
   * CONTEXT_ASSEMBLY_RESULT (§4.2) that the orchestrator hands to llmRouter.
   */
  assembleAndValidate(input: {
    snapshots: BundleResolutionSnapshot[];
    variableInput: string;
    instructions: string;
    resolvedBudget: ResolvedExecutionBudget;
  }): ContextAssemblyResult;
}
```

**Public surface (pure — the real logic):**

```ts
/** Current assembly version — bumped manually when serialization or ordering logic changes. */
export const ASSEMBLY_VERSION = 1 as const;

/**
 * Deterministic serialization of one document's contribution to the cached prefix.
 * Format is part of the assembly contract; changing it requires bumping ASSEMBLY_VERSION.
 */
export function serializeDocument(args: {
  documentId: string;
  version: number;
  content: string;
}): string;

/**
 * Produces the full cached prefix string from an ordered list of snapshots plus
 * their pinned version rows. Deterministic ordering:
 *   1. Snapshots sort by `bundleId` ascending.
 *   2. Within each snapshot, documents sort by `documentId` ascending (the order
 *      recorded on the snapshot row).
 * Equivalent to concatenating serializeDocument() per document across all bundles
 * with a fixed separator. The pinned version rows (fetched by the caller and
 * passed in) are the source of content bytes — snapshots carry integrity
 * hashes, not content.
 */
export function assemblePrefix(input: {
  snapshots: BundleResolutionSnapshot[];
  versionsByDocumentVersionKey: Map<string /* `${documentId}:${version}` */, { content: string }>;
}): string;

/**
 * Computes the PER-BUNDLE prefix hash from its components. Used by
 * `bundleResolutionService.buildSnapshotRow` to populate each snapshot's
 * `prefixHash`. The hash algorithm and input ordering are part of the contract
 * and covered by ASSEMBLY_VERSION.
 */
export function computePrefixHash(components: PrefixHashComponents): string;

/**
 * Computes the CALL-LEVEL assembled prefix hash from the ordered list of
 * per-bundle snapshot prefix hashes. This is the value stored on
 * `llm_requests.prefix_hash` and used by the router for cache attribution.
 * Ordering: snapshot hashes are sorted by the originating snapshot's `bundleId`
 * ascending before hashing — matches the `assemblePrefix` cross-bundle rule.
 * Covered by ASSEMBLY_VERSION.
 */
export function computeAssembledPrefixHash(input: {
  snapshotPrefixHashesByBundleIdAsc: string[];
  modelFamily: string;
  assemblyVersion: number;
}): string;

/**
 * The validator — pure budget check producing either 'ok' or a structured breach payload.
 * Does not mutate anything. Does not know about the DB.
 */
export function validateAssembly(input: {
  assembledPrefixTokens: number;
  variableInputTokens: number;
  perDocumentTopTokens: Array<{ documentId: string; documentName: string; tokens: number }>;
  resolvedBudget: ResolvedExecutionBudget;
}): { kind: 'ok'; softWarnTripped: boolean } | { kind: 'breach'; payload: HitlBudgetBlockPayload };
```

**The serialization contract (v1 — `ASSEMBLY_VERSION = 1`):**

```
---DOC_START---
id: <document_id>
version: <document_version>
---
<content verbatim>
---DOC_END---

```

Between documents: a single blank line (the trailing `\n` after `---DOC_END---` plus one more `\n`). Documents are separated only by this two-character block. No per-document trailing whitespace trimming, no content normalisation. Content is embedded verbatim — if a document contains the literal string `---DOC_END---`, the reference doc is rejected by `referenceDocumentService.create` at upload time (adds `CACHED_CONTEXT_DOC_CONTAINS_DELIMITER` 400).

**Placement in the Anthropic system prompt** (via `anthropicAdapter`'s `{ stablePrefix, dynamicSuffix }` shape):

- `stablePrefix`: the concatenated serialized documents in order. This is the content `cache_control: { type: 'ephemeral' }` is applied to.
- `dynamicSuffix`: `instructions + "\n\n" + variableInput`. The caller's instructions and the variable input (transcript / email / report) live here. Never cached.

**Assembly flow (from `assembleAndValidate`):**

**Snapshot-integrity invariant (fail-fast, no silent corruption).** If ANY `reference_document_versions` row at read time hashes to a different `serializedBytesHash` than the snapshot recorded at resolution time, the engine MUST fail the run immediately with `CACHED_CONTEXT_SNAPSHOT_INTEGRITY_VIOLATION` (500). No partial fall-through, no degraded-but-proceed path, no attempt to recover by re-resolving. A mismatch means either the content table was mutated out-of-band or the snapshot's record of it has been corrupted — both are system-level faults that must surface loudly. The run terminates with `run_outcome='failed'` and `failureReason='snapshot_integrity_violation'` (§6.6). This is what makes per-run reproducibility load-bearing: a silent integrity failure would produce runs that subtly drift from their recorded snapshot, which is exactly what the snapshot mechanism exists to prevent.

1. **Stateful pre-step (in `contextAssemblyEngine.ts`, not `Pure`):** load the pinned `reference_document_versions` rows for every `(documentId, documentVersion)` pair across all snapshots. For each row, verify `SHA-256(serializeDocument(row))` matches the snapshot's recorded `serializedBytesHash` — if any mismatch, raise `CACHED_CONTEXT_SNAPSHOT_INTEGRITY_VIOLATION` (500) per the invariant above. This is the engine's read-time integrity check.
2. Call `assemblePrefix({ snapshots, versionsByDocumentVersionKey })` — deterministic string concat across all bundles: snapshots ordered by `bundleId` asc, documents within each snapshot ordered by `documentId` asc.
3. Compute `variableInputTokens` (pure — uses a token-count helper; the count is an *estimate*, not a call to `countTokens`).
4. Compute `estimatedContextTokens = snapshots.sum(estimatedPrefixTokens) + variableInputTokens + resolvedBudget.reserveOutputTokens + fixed_system_overhead(100)`.
5. Compute the call-level `assembledPrefixHash`: first sort the `snapshots` array by `bundleId` ascending, then map to `prefixHash` (preserving that order), and pass the result as `snapshotPrefixHashesByBundleIdAsc`: `computeAssembledPrefixHash({ snapshotPrefixHashesByBundleIdAsc: [...snapshots].sort((a, b) => a.bundleId.localeCompare(b.bundleId)).map(s => s.prefixHash), modelFamily, assemblyVersion })`. The `bundleId`-ordered result is the single hash that goes to `llm_requests.prefix_hash`. Ordering by `bundleId` (not by the hash value itself) is the same rule as `assemblePrefix` — the two invariants must stay aligned.
6. Call `validateAssembly(...)`.
7. If `{ kind: 'breach' }` — return `{ kind: 'budget_breach', blockPayload }`.
8. If `{ kind: 'ok' }` — return `{ kind: 'ok', routerPayload: { system: { stablePrefix, dynamicSuffix }, messages: [...], estimatedContextTokens }, prefixHash: assembledPrefixHash, prefixHashComponents: null /* components live per-snapshot */, variableInputHash, bundleSnapshotIds, softWarnTripped, assemblyVersion }`.

**Assembly-version enforcement test** (§11 Testing). A pure unit test asserts:

```
expect(computePrefixHash(GOLDEN_COMPONENTS)).toBe(GOLDEN_HASH);
```

Any change to `serializeDocument`, `assemblePrefix`, or `computePrefixHash` that doesn't also change `GOLDEN_HASH` (bumping the fixture deliberately) fails the test. Bumping the fixture without bumping `ASSEMBLY_VERSION` also fails a second assertion.

### 6.5 `executionBudgetResolver` + `executionBudgetResolverPure`

**File:** `server/services/executionBudgetResolver.ts` + `server/services/executionBudgetResolverPure.ts`

Resolves an `ExecutionBudget` per call. Three-input resolution: task config ∩ model-tier policy ∩ org ceiling.

**Division of enforcement responsibilities.** Budget enforcement is split deliberately across two primitives and this service sits on one side of the split. **Assembly-time validation (this service + `contextAssemblyEngine.validate`) prevents invalid requests from entering the router** — if the assembled prefix exceeds `maxInputTokens` or `perDocumentCap`, the call never leaves the caller's process and is blocked at HITL (§4.5). **Runtime cost enforcement (`runCostBreaker`) handles execution-time variance and fallback behaviour** — cumulative spend across a run, mid-flight fallback to a larger-model retry, and any cost that arises *after* the budget-resolved call enters the router. The two primitives compose: a run that passes assembly-time validation can still be terminated mid-flight by the cost breaker if provider fallback pushes cost over `maxTotalCostUsd`. Implementers must not duplicate enforcement in both primitives — pre-flight request shape belongs here; in-flight running cost belongs to the breaker.

**Public surface (stateful):**

```ts
export interface ExecutionBudgetResolver {
  /**
   * Resolves the canonical ExecutionBudget for this call site.
   * Raises BudgetResolutionError if the three inputs don't produce a valid budget.
   */
  resolve(input: {
    organisationId: string;
    modelFamily: string;
    taskConfig?: { maxInputTokens?: number; maxOutputTokens?: number; maxTotalCostUsdCents?: number };
  }): Promise<ResolvedExecutionBudget>;
}
```

**Public surface (pure):**

```ts
export function resolveBudgetPure(input: {
  taskConfig: { maxInputTokens?: number; maxOutputTokens?: number; maxTotalCostUsdCents?: number } | null;
  modelTierPolicy: ModelTierBudgetPolicy; // full row
  orgCeilingPolicy: ModelTierBudgetPolicy | null; // org override row, if present
}): ResolvedExecutionBudget;
```

**Resolution order (narrowing):**

1. Start from `modelTierPolicy` (platform default or org override — the stateful wrapper queries for the org-specific row first, falling back to the platform default row where `organisation_id IS NULL`).
2. If `orgCeilingPolicy` is present, narrow: each dimension becomes `min(current, orgCeiling)`.
3. If `taskConfig` has an override, narrow further: each dimension becomes `min(current, taskOverride)`. Task config cannot widen — only narrow.
4. Compute `reserveOutputTokens = min(modelTierPolicy.reserveOutputTokens, resolvedMaxOutputTokens)`. This preserves §4.1's `maxOutputTokens ≤ reserveOutputTokens` invariant: when the resolved `maxOutputTokens` is narrower than the tier's default reserve, the reserve narrows to match (equality post-resolution). When not narrowed, the tier's default reserve survives.
5. Assert `maxInputTokens + reserveOutputTokens ≤ modelTierPolicy.modelContextWindow`. If not, throw `BudgetResolutionError` (500 — this can't happen if the DB CHECK constraint is correct; it's defence in depth).
6. Assert all numeric fields > 0.
7. Return the resolved `ResolvedExecutionBudget`.

**Error codes:**

- `CACHED_CONTEXT_BUDGET_NO_POLICY` (500) — no matching `model_tier_budget_policies` row for the requested model family and no platform default. Shouldn't happen in production; guard exists to catch schema-drift.
- `CACHED_CONTEXT_BUDGET_INVARIANT_VIOLATED` (500) — the DB CHECK was bypassed somehow; re-checked at resolution time.
- `CACHED_CONTEXT_BUDGET_NARROWED_TO_ZERO` (400) — task-config override narrowed a dimension to ≤ 0.

**No caching.** Resolution is cheap (two DB reads, pure arithmetic). The resolver is called once per cached-context orchestrator invocation. No memoisation — stale policy changes would leak into in-flight runs.

### 6.6 `cachedContextOrchestrator`

**File:** `server/services/cachedContextOrchestrator.ts` (no Pure sibling — this service is pure orchestration, no deterministic logic to extract)

The public entry point for callers. Wraps snapshot resolution → budget resolution → assembly → router → attribution → outcome classification.

**Public surface:**

```ts
export type CachedContextOrchestratorResult =
  | {
      runOutcome: 'completed' | 'degraded';
      llmResponseContent: string;   // passthrough from anthropicAdapter
      llmRequestId: string;
      bundleSnapshotIds: string[];
      prefixHash: string;           // call-level assembled hash (§4.4)
      cacheStats: {
        readTokens: number;
        creationTokens: number;
        hitType: 'miss' | 'partial' | 'full';
      };
    }
  | {
      runOutcome: 'failed';
      failureReason:
        | 'hitl_rejected'
        | 'hitl_timeout'
        | 'hitl_second_breach'              // §6.6 step 4 — one-retry cap reached
        | 'router_error'
        | 'provider_error'
        | 'parse_failure'
        | 'budget_resolution_error'         // thrown by executionBudgetResolver (§6.5)
        | 'document_token_count_missing'    // thrown by bundleResolutionService step 4 (§6.3); triggers §12.14 backfill
        | 'snapshot_integrity_violation'    // thrown by assembleAndValidate pre-step (§6.4) when serializedBytesHash mismatch on fetched version row
        | 'snapshot_concurrency_lost'       // thrown by bundleResolutionService step 7 (§6.3) when ON CONFLICT retries exhausted
        | 'no_bundles_attached';              // thrown by bundleResolutionService (§6.3) when zero attached bundles — pilot mode treats as failure (§12.8)
      /** Snapshots resolved before failure, if any. Present when failure happened post-resolution. Persisted to `agent_runs.bundle_snapshot_ids` in the terminal-failed-path UPDATE (§6.6 step 9). */
      bundleSnapshotIds?: string[];
      /** Variable-input hash, if computed before failure (§6.6 step 5 paths). Persisted to `agent_runs.variable_input_hash` in the terminal-failed-path UPDATE when present. */
      variableInputHash?: string;
      /** Call-level assembled hash, if computed before failure. Present on failures after successful assembly. */
      prefixHash?: string;
      /** LLM request row, if the router wrote one before the failure. */
      llmRequestId?: string;
    };

export interface CachedContextOrchestrator {
  execute(input: {
    organisationId: string;
    subaccountId: string | null;
    subjectType: AttachmentSubjectType;
    subjectId: string;
    runId: string;
    variableInput: string;
    instructions: string;
    modelFamily: string;
    taskConfig?: ExecutionBudgetOverrides;
    ttl?: '5m' | '1h'; // caller hint passed through to the adapter; no resolver narrowing in v1 (§12.15)
  }): Promise<CachedContextOrchestratorResult>;
}
```

**Error → `failureReason` mapping.** The orchestrator catches errors from downstream services and maps them to `CachedContextOrchestratorResult.failureReason` values. Complete mapping (single source of truth):

| Origin | Error condition | `failureReason` |
|---|---|---|
| §6.5 `executionBudgetResolver.resolve` | any `BudgetResolutionError` subtype (`CACHED_CONTEXT_BUDGET_*`) | `budget_resolution_error` |
| §6.3 `bundleResolutionService.resolveAtRunStart` step 1-3 | zero attached bundles (`CACHED_CONTEXT_NO_BUNDLES_ATTACHED`) | `no_bundles_attached` |
| §6.3 step 4 | document missing `tokenCounts[modelFamily]` (`CACHED_CONTEXT_DOC_TOKEN_COUNT_MISSING`) | `document_token_count_missing` |
| §6.3 step 7 | `ON CONFLICT` retries exhausted (`CACHED_CONTEXT_SNAPSHOT_CONCURRENCY_LOST`) | `snapshot_concurrency_lost` |
| §6.4 stateful pre-step | `serializedBytesHash` mismatch on fetched version row (`CACHED_CONTEXT_SNAPSHOT_INTEGRITY_VIOLATION`) | `snapshot_integrity_violation` |
| §6.6 step 4 (HITL path) | operator rejection | `hitl_rejected` |
| §6.6 step 4 | `hitlService` suspend window elapsed | `hitl_timeout` |
| §6.6 step 4 | second assembly attempt after approval still breaches | `hitl_second_breach` |
| §6.6 step 6 (router call) | router exception (cost-breaker trip, idempotency-key reuse rejection, network) | `router_error` |
| §6.6 step 6 | upstream provider returned a non-retryable error status | `provider_error` |
| §6.6 step 7 | response parsing failure (malformed JSON, missing required fields) | `parse_failure` |

Any uncaught / unmapped error is surfaced as `router_error` with the original exception attached as `cause` — this is a safety net, not a design choice; the reviewer checks that every new call site maps explicitly.

**End-to-end flow:**

1. Resolve `ExecutionBudget` (§6.5) — includes the capacity invariant check.
2. Resolve bundle snapshots (§6.3) — produces one snapshot per attached bundle. If no bundles attached, raises `CACHED_CONTEXT_NO_BUNDLES_ATTACHED` (the caller decides handling; pilot mode treats as error).
3. Call `contextAssemblyEngine.assembleAndValidate(...)` (§6.4).
4. **If `{ kind: 'budget_breach' }`:** call `actionService.proposeAction({ actionType: 'cached_context_budget_breach', gateLevel: 'block', payloadJson: blockPayload, ... })`. Wait for `hitlService` resolution. On approval → **re-run steps 1–3 exactly once against the current state of the bundle, documents, and budget policy at the moment of re-entry**. The retry must not reuse the previous snapshot, previous budget resolution, or previous assembly output — between the original block and the approval, the operator may have trimmed the bundle, edited a document version, or changed the task's budget override, and the re-run must reflect all of those. Concretely: the orchestrator calls `executionBudgetResolver.resolve` afresh, `bundleResolutionService.resolveAtRunStart` afresh (producing a new snapshot set — which may reuse existing `bundle_resolution_snapshots` rows if the state hasn't actually changed, per §5.6 dedup), and `contextAssemblyEngine.assembleAndValidate` afresh. **Retry breach classification is independent.** The retry's breach check is computed from scratch against the fresh resolved state; the original breach's `thresholdBreached` dimension has NO effect on the retry's classification. A run that first breached on `max_input_tokens` and then on retry breaches on `per_document_cap` is still a second breach — terminate with `run_outcome='failed'` and `failureReason='hitl_second_breach'`. Implementation must not special-case "retry on same dimension vs different dimension"; both are the same terminal path. If the second assembly attempt ALSO returns `{ kind: 'budget_breach' }` — regardless of which breach dimension — terminate as above. No third attempt, no second HITL block. On rejection or suspend-window timeout → write `run_outcome='failed'` on `agent_runs` with `failureReason='hitl_rejected'` or `'hitl_timeout'` respectively.
5. **If `{ kind: 'ok' }`:** write `bundle_snapshot_ids` + `variable_input_hash` + `soft_warn_tripped` to `agent_runs` (pre-call write). The run outcome is still `NULL`.
6. Call `llmRouter.routeCall({ payload: routerPayload, estimatedContextTokens, prefixHash: assembledPrefixHash, featureTag: 'cached-context', maxTokens: resolvedBudget.maxOutputTokens, cacheTtl: ttl ?? '1h', ... })`. Router handles idempotency, attribution, provider fallback, and cost ceilings. `maxOutputTokens` is the per-call response cap (existing router parameter, named `maxTokens` at the router surface, passed through to `anthropicAdapter` as `max_tokens` on the request body). `prefixHash` + `cacheTtl` are new optional params the router's `llmRouter.ts` gains (see below).
7. Parse `response.usage`: capture `cachedPromptTokens = cache_read_input_tokens`, `cacheCreationTokens = cache_creation_input_tokens`. Determine `hitType` from the ratio.
8. **Run outcome classification (§4.6):**
   - If soft-warn was tripped → `degraded` with `degraded_reason = 'soft_warn'`.
   - Else if actual input tokens exceed estimated by > 10% → `degraded` with `degraded_reason = 'token_drift'`.
   - Else if `hitType === 'miss'` AND a prior snapshot with this `prefixHash` exists in-window → `degraded` with `degraded_reason = 'cache_miss'`.
   - Otherwise → `completed` with `degraded_reason = NULL`.
   Precedence is the one listed above: `soft_warn` > `token_drift` > `cache_miss`. If multiple conditions trip simultaneously, only the highest-precedence reason is recorded.
9. **Terminal write on `agent_runs`** (single-row UPDATE, not in the same transaction as the router's `llm_requests` write). One UPDATE shape, used for both success and failure paths:

   ```sql
   UPDATE agent_runs
     SET run_outcome       = :outcome,
         degraded_reason   = :degradedReason,  -- NULL unless :outcome='degraded'
         bundle_snapshot_ids = COALESCE(agent_runs.bundle_snapshot_ids, :bundleSnapshotIds),
         variable_input_hash = COALESCE(agent_runs.variable_input_hash, :variableInputHash),
         soft_warn_tripped = :softWarnTripped
   WHERE id = :runId
     AND run_outcome IS NULL;
   ```

   - On the `completed` / `degraded` path, all five fields are supplied; the `COALESCE` is defensive against step 5's pre-call write having already landed them.
   - `degraded_reason` is always supplied: `'soft_warn' | 'token_drift' | 'cache_miss'` when `:outcome='degraded'`, `NULL` otherwise. The orchestrator's classification in step 8 computes the single precedence-winning reason.
   - On the `failed` path, `:bundleSnapshotIds` and `:variableInputHash` are supplied WHEN KNOWN (§6.3 succeeded for the former, §6.4 step 3 succeeded for the latter) and NULL otherwise — the `COALESCE` preserves any values step 5 already wrote, and also preserves NULLs when the failure happened before step 5 could run. This keeps failed-path attribution on the run row (per G9 fix in iteration 2).
   - The `run_outcome IS NULL` precondition is the optimistic lock — a duplicate terminal write under retry updates 0 rows and is treated as an idempotent re-entry (no error; the caller observes the row already has a terminal outcome).

   The router's `llm_requests` row is committed by the router at call completion (its existing write path, now also carrying `prefix_hash` + `cache_creation_tokens` as of Phase 5). This write is not co-transactional with the `agent_runs` UPDATE. Cross-table atomicity is not required: the `prefix_hash` column on `llm_requests` is append-only once the router commits, and the `agent_runs` UPDATE is idempotent — a reconciler reading the two tables cannot observe a contradictory in-flight state.

**Router-side changes** (minimal — §2.1 confirmed the router has the hooks):

- `llmRouter.routeCall` gains optional params: `prefixHash?: string`, `cacheTtl?: '5m' | '1h'` (default `'1h'` — sent through to `anthropicAdapter` which already supports `cache_control: { type: 'ephemeral', ttl: '1h' }` via its existing shape). Phase 4 accepts both params on the routeCall surface but does NOT persist `prefixHash` (the column lands in Phase 5 / migration 0210). Phase 5 enables write-through: `prefixHash` is persisted on `llm_requests.prefix_hash` at row insert time, and `cacheCreationTokens` is populated from `response.usage.cache_creation_input_tokens`. `maxTokens` is the existing `routeCall` parameter that bounds Anthropic `max_tokens` — documented on the existing router surface; the orchestrator now always passes `resolvedBudget.maxOutputTokens` through it.
- No changes to idempotency, attribution, or provider fallback.
- **`cacheTtl` is a direct caller hint**, not a resolver-narrowed value. v1 does not include TTL in `ResolvedExecutionBudget` or in `model_tier_budget_policies`. Resolver-narrowed TTL is deferred (§12.15).

**Execution model** — see §9 for the end-to-end sync/async accounting.

**No silent fallback invariant (principle §10 of the brief).** The orchestrator NEVER mutates the assembled payload to fit within the budget. The only paths are: (a) assembly succeeds and runs, (b) assembly produces a structured block payload that routes to HITL, (c) an upstream failure terminates the run as `failed`. Auto-truncation, auto-drop, and auto-downgrade are not implemented and are explicit non-goals.

### 6.7 `bundleUtilizationJob` (pg-boss)

**File:** `server/jobs/bundleUtilizationJob.ts`

Background metric computation. Runs on a pg-boss schedule (hourly default, configurable via the job's registration row). Writes a derived metric per `(bundleId, modelFamily)` to a cache-like table or the existing cost-aggregates surface.

**Job shape:**

```ts
export const bundleUtilizationJob = {
  name: 'maintenance:bundle-utilization',
  schedule: '0 * * * *', // hourly
  handler: async (_job: Job) => { /* ... */ },
};
```

**Handler behaviour:**

The handler runs under `withAdminConnection` + `SET LOCAL ROLE admin_role` (see §8.6 carve-out). This matches the pattern used by `memoryDedupJob`, `llmLedgerArchiveJob`, `securityEventsCleanupJob`, and `regressionReplayJob`. The handler's top-level block MUST start with the admin-connection wrapper; any direct `db` access inside the job would violate `verify-rls-contract-compliance.sh`.

1. For every live bundle + every model family present in `model_tier_budget_policies`:
   - Read the bundle's latest snapshot row via `bundle_resolution_snapshots` ordered by `createdAt DESC LIMIT 1` for that `(bundle_id, model_family)`.
   - **If the latest snapshot's `bundleVersion < bundle.currentVersion`** (the bundle has been edited since the last run resolved it): recompute `estimatedPrefixTokens` live by summing the current `document_bundle_members`' pinned current-version `tokenCounts[modelFamily]`. This prevents the utilization metric from lying to users after a bundle edit — the pre-run warning must reflect the CURRENT bundle state, not the last resolved state.
   - If no snapshot exists (bundle has never been resolved): derive `estimatedPrefixTokens` by summing the live members' `tokenCounts[modelFamily]`.
   - Compute `utilizationRatio = estimatedPrefixTokens / modelTierBudgetPolicy.maxInputTokens`.
2. Write to a new `bundle_utilization_metrics` table (schema deferred — see note below) or, more simply for v1, a single flat JSONB column on `document_bundles` — `utilizationByModelFamily: jsonb` — updated in place. v1 uses the flat JSONB column to avoid a second migration.
3. Emit nothing else; the operator UI reads the column directly.

**Thresholds surfaced by queries (not by the job):**
- `< 0.70` → green
- `0.70 ≤ x < 0.90` → yellow warn
- `0.90 ≤ x < 1.00` → red urgent
- `≥ 1.00` → block-at-runtime zone

**Per-bundle label derivation is the worst-case across tiers (§3.6.6 invariant).** The single-label value that the UI renders on bundle rows and the bundle detail page is computed by taking `max(utilizationRatio)` across every model family in `utilizationByModelFamily` and thresholding that max against the bands above. Consumer queries that produce the three-state label MUST apply the max-first-then-threshold rule, not the per-tier-then-combine rule. This is the conservative bias that guards the user from "fits in current model, breaks if you switch tiers" surprises.

**Migration note.** The `utilizationByModelFamily` JSONB column on `document_bundles` is added in migration 0204 (the bundle table creation itself), so no separate migration is needed for this job. The §5.3 schema block above did not include this column for clarity; it is added below as an erratum:

```ts
// Erratum to §5.3 — add this column to document_bundles:
utilizationByModelFamily: jsonb('utilization_by_model_family').$type<
  Record<string, { utilizationRatio: number; estimatedPrefixTokens: number; computedAt: string }>
>(),
```

**Execution model.** Queued via pg-boss. The job is idempotent by computing from authoritative state (snapshots + members + policies) — re-running on overlap writes the same values.

---

## 7. Routes

Two new route files, thin handlers over the services (§6). Every route uses `asyncHandler` (`server/lib/asyncHandler.ts`). Org scope + permission checks follow the repo's existing pattern (`authenticate` → `requireOrgPermission(key)` → `resolveSubaccount` when scoped).

### 7.1 `server/routes/referenceDocuments.ts`

```
GET    /api/reference-documents                  list by org
POST   /api/reference-documents                  create single document (body: name, content, description?, subaccountId?)
POST   /api/reference-documents/bulk-upload      multi-file upload (see below — the §3.6.5 contract)
GET    /api/reference-documents/:id              get with current version
PATCH  /api/reference-documents/:id              rename + description (NOT content)
PUT    /api/reference-documents/:id/content      updateContent (body: content, notes?)
POST   /api/reference-documents/:id/pause
POST   /api/reference-documents/:id/resume
POST   /api/reference-documents/:id/deprecate    (body: reason)
DELETE /api/reference-documents/:id              soft delete
GET    /api/reference-documents/:id/versions     version history
GET    /api/reference-documents/:id/versions/:v  one version
```

**`POST /api/reference-documents/bulk-upload` — multi-file upload contract.** Backs the reusable upload modal in `mockup-upload-document.html` (§3.6.5).

Request — `multipart/form-data`:
- `files[]` — 1..N file parts. Accepted MIME types mapped to `source_type='upload'`: `text/markdown`, `application/pdf`, `text/plain`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. 10 MB per file limit enforced at the multipart parser.
- `names[]` — parallel array of display names, same length and order as `files[]`. Empty strings are replaced with the filename (extension stripped).
- `subaccountId` — optional string. Applies to every uploaded document.
- `bundleName` — optional string. Non-empty iff the user ticked the "Group as bundle" checkbox (§3.6.5). When present, a named bundle is created containing exactly the uploaded documents.
- `attachTo` — optional JSON string `{ subjectType: 'agent' | 'task' | 'scheduled_task', subjectId: string }`. When present, the upload auto-attaches its output (the N individual documents if `bundleName` is absent, OR the single bundle if `bundleName` is present) to the named subject. Omitted for standalone-library entries (§3.6.5 Flow C).

Request validation:
- `files[].length === names[].length` — reject 400 otherwise (`CACHED_CONTEXT_UPLOAD_NAMES_LENGTH_MISMATCH`).
- If `bundleName` is present, `files[].length >= 2` — reject 400 otherwise (`CACHED_CONTEXT_UPLOAD_BUNDLE_TOO_FEW_FILES`).
- Every `names[i]` after the filename-fallback must be non-empty and unique within the request — reject 400 otherwise (`CACHED_CONTEXT_UPLOAD_NAME_EMPTY` / `CACHED_CONTEXT_UPLOAD_NAME_DUPLICATE_IN_REQUEST`).

Response — `200 OK`:
```json
{
  "documentIds": ["doc_a1...", "doc_b2...", "doc_c3..."],
  "bundleId": "bnd_xyz..." | null,
  "autoAttachedTo": { "subjectType": "scheduled_task", "subjectId": "sch_42..." } | null
}
```

**Transactional semantics.** The handler wraps the whole flow (N document creates + optional bundle create + optional attach) in a single DB transaction. Any failure rolls back all document creates — the user is never left with a partial library mutation. Client-side token estimation (done in-browser pre-upload for the modal's token display) is NOT re-validated server-side for trust; the server computes its own authoritative token counts on the uploaded bytes and writes those to `reference_document_versions.token_counts`. The pre-upload estimate is a UX affordance only.

**Idempotency.** The endpoint accepts `Idempotency-Key` header per the repo's existing idempotency pattern. A replayed request with the same key returns the original response within the key's 24-hour TTL.

**Permissions:** new permission keys `reference_documents.read`, `reference_documents.write`, `reference_documents.deprecate`. The `bulk-upload` endpoint requires `reference_documents.write` AND — when `attachTo` is present — the corresponding attachment permission on the target subject (e.g. `document_bundles.attach`). Added to `server/config/permissions.ts` + seeded via migration 0202 on permission-set upsert (follow the pattern used for `memory_blocks.*` permission keys).

### 7.2 `server/routes/documentBundles.ts`

Routes split by user-facing vs admin-only. All routes use the "bundle" noun; admin-only routes expose additional fields (e.g. `isAutoCreated`, utilization metrics) that user-facing routes hide.

**User-facing routes (surfaced in the UI):**

```
GET    /api/document-bundles/bundles                                  list NAMED bundles only (is_auto_created=false)
GET    /api/document-bundles/:id                                      get bundle with members (works for named bundles; unnamed bundles only accessible to the owning user's attach context)
PATCH  /api/document-bundles/:id                                      rename + description (named bundles only; rejects unnamed bundles with 409)
POST   /api/document-bundles/:id/members                              addMember (body: documentId) — bumps currentVersion
DELETE /api/document-bundles/:id/members/:docId                       removeMember — bumps currentVersion
POST   /api/document-bundles/:id/attach                               attach (body: subjectType, subjectId)
DELETE /api/document-bundles/:id/attach/:subjectType/:subjectId       detach
DELETE /api/document-bundles/:id                                      soft delete (named bundles; unnamed bundles are gc'd when the last attachment is removed)

POST   /api/document-bundles/attach-documents                         attach-by-document-set (§3.6.3 Flow A primitive)
POST   /api/document-bundles/:id/promote                              promote an unnamed bundle to a named bundle (§3.6.4 Flow D, §3.6.5 upload)
GET    /api/document-bundles/suggest-bundle                           bundle-suggestion lookup (query: documentIds, excludeSubjectType?, excludeSubjectId?)
POST   /api/bundle-suggestion-dismissals                            dismiss the suggestion (body: documentIds)
```

**Admin-only routes (NOT surfaced in the UI):**

```
GET    /api/document-bundles/admin/all                                list ALL bundles including unnamed bundles (admin only)
GET    /api/document-bundles/admin/:id/utilization                    read utilization JSONB (admin only; computed by §6.7 job)
```

**`POST /api/document-bundles/attach-documents` contract (§3.6.3 Flow A):**

Request body:
```json
{
  "documentIds": ["doc_a1...", "doc_b2...", "doc_c3..."],
  "subjectType": "agent" | "task" | "scheduled_task",
  "subjectId": "sch_42..."
}
```

Response — `200 OK`:
```json
{
  "bundleId": "bnd_xyz...",
  "bundleIsAutoCreated": true,
  "attachmentId": "att_abc..."
}
```

Behaviour: calls `documentBundleService.findOrCreateUnnamedBundle` to resolve/create the unnamed bundle, then `documentBundleService.attach` to bind it to the subject. Idempotent — re-attaching the same doc set to the same subject returns the existing attachment row. If the subject already has a DIFFERENT unnamed bundle attached with a different doc set, the new bundle is ADDED as a second attachment (multi-bundle composition per §2.1).

**`POST /api/document-bundles/:id/promote` contract (§3.6.4 Flow D):**

Request body:
```json
{ "name": "2026 Q2 reference bundle" }
```

Response — `200 OK`:
```json
{ "bundleId": "bnd_xyz...", "name": "2026 Q2 reference bundle", "isAutoCreated": false }
```

Errors: `CACHED_CONTEXT_BUNDLE_ALREADY_NAMED` (409), `CACHED_CONTEXT_BUNDLE_NAME_TAKEN` (409), `CACHED_CONTEXT_BUNDLE_NAME_EMPTY` (400), `CACHED_CONTEXT_BUNDLE_NOT_FOUND` (404).

**`GET /api/document-bundles/suggest-bundle` contract (§3.6.4):**

Query params:
- `documentIds` — comma-separated doc UUIDs, minimum length 2 (shorter returns `{ suggest: false }` without error).
- `excludeSubjectType` — optional, one of `agent | task | scheduled_task`.
- `excludeSubjectId` — optional.

Response — `200 OK`:
```json
{ "suggest": false }
// or
{ "suggest": true, "alsoUsedOn": 1, "docSetHash": "0xaf2c91...", "unnamedBundleId": "bnd_xyz..." }
```

Callers (the UI, post-save) use `unnamedBundleId` as the target for a subsequent promote call, and `docSetHash` as the dismissal key.

**`POST /api/bundle-suggestion-dismissals` contract (§3.6.4 dismissal):**

Request body:
```json
{ "documentIds": ["doc_a1...", "doc_b2...", "doc_c3..."] }
```

The server computes `docSetHash` server-side (not trusting a client-supplied hash) and writes the dismissal row. Response `201 Created` with the dismissal record, or `200 OK` with the existing record on idempotent replay.

**Subject listings (read-side):**

```
GET    /api/agents/:id/attached-bundles            listAttachmentsForSubject('agent', :id)
GET    /api/tasks/:id/attached-bundles             listAttachmentsForSubject('task', :id)
GET    /api/scheduled-tasks/:id/attached-bundles   listAttachmentsForSubject('scheduled_task', :id)
```

Response shape distinguishes bundle chips from individual-document chips (§3.6.3 Flow A):
```json
{
  "attachments": [
    {
      "bundleId": "bnd_aa...",
      "isAutoCreated": false,
      "bundleName": "42 Macro",
      "documentCount": 3,
      "chipKind": "bundle"
    },
    {
      "bundleId": "bnd_bb...",
      "isAutoCreated": true,
      "bundleName": null,
      "documentCount": 1,
      "documents": [{ "id": "doc_z9...", "name": "Standalone doc" }],
      "chipKind": "document"
    }
  ]
}
```

Clients render `chipKind='bundle'` rows as a single 📦 chip, and `chipKind='document'` rows as one 📄 chip per document in the unnamed bundle.

**Permissions:** new keys `document_bundles.read`, `document_bundles.write`, `document_bundles.attach`. Admin routes (`/admin/*`) require a platform-admin role in addition. Seeded in migration 0204.

### 7.3 No changes to the `llmRouter` surface

The router's public `routeCall()` gains two optional params (`prefixHash`, `cacheTtl`) as noted in §6.6. The route surface (`/api/*`) is unchanged — the router is an internal service.

### 7.4 Client-side UI surfaces

The v1 client scope is defined by the four mockups under `prototypes/cached-context/` (§3.6.2). Implementation touches:

- **Agent / task / scheduled-task config pages** — existing pages gain a "Reference documents" section using the pattern in `mockup-attach-docs.html`. This includes the unified picker, the upload-modal trigger, and the post-save bundle-suggestion card. Backed by `/api/document-bundles/attach-documents`, `/api/document-bundles/suggest-bundle`, `/api/document-bundles/:id/promote`, `/api/bundle-suggestion-dismissals`, and the subject listings above.
- **`Knowledge › Documents` page** — new standalone documents page. Standard CRUD list (pattern borrowed from `memory_blocks` page). Hosts the "Upload documents" button that opens the same upload modal in library-only context (§3.6.5 Flow C).
- **`Knowledge › Bundles` page** — new standalone bundles list page. Lists named bundles only (`GET /api/document-bundles/bundles`). Clicking a bundle opens the bundle-detail page.
- **Bundle-detail page** — implements `mockup-bundle-detail.html`. Driven by `/api/document-bundles/:id` + member edits via the existing `/members` routes.
- **HITL review queue rendering** — existing review-queue page gains a renderer for `actionType='cached_context_budget_breach'` using the layout in `mockup-budget-breach-block.html`.

All UI surfaces must be built against `docs/frontend-design-principles.md` — `chipKind`-aware rendering, no prefix-hash / snapshot-id surfacing to users, no tier-comparison dashboards, no Usage Explorer panels.

---

## 8. Permissions / RLS

Every new tenant-scoped table (§5.1–5.7) must satisfy the four requirements in `docs/spec-authoring-checklist.md §4`.

### 8.1 RLS policies

Every table creation migration (0202–0208) includes an RLS policy block in the same migration. Policies follow the three-layer fail-closed pattern documented at `architecture.md §1155` and mirror the exact shape used by `memory_blocks`.

Template for tenant-scoped tables with both `organisation_id` and nullable `subaccount_id`:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY <table>_org_isolation ON <table>
  USING (organisation_id = current_setting('app.current_organisation_id')::uuid);

CREATE POLICY <table>_subaccount_isolation ON <table>
  USING (
    subaccount_id IS NULL
    OR subaccount_id = current_setting('app.current_subaccount_id', true)::uuid
  );
```

Applied to:
- `reference_documents`
- `reference_document_versions` (inherits via FK — policy checks via `EXISTS (SELECT 1 FROM reference_documents WHERE id = document_id AND organisation_id = current_setting(...))`)
- `document_bundles`
- `document_bundle_members` (inherits via bundle FK, same EXISTS pattern)
- `document_bundle_attachments`
- `bundle_resolution_snapshots`
- `model_tier_budget_policies` — **uses a custom policy shape** that permits platform-default rows (`organisation_id IS NULL`) for SELECT across all orgs, while scoping INSERT / UPDATE / DELETE to matching org or `admin_role`:

  ```sql
  ALTER TABLE model_tier_budget_policies ENABLE ROW LEVEL SECURITY;

  CREATE POLICY model_tier_budget_policies_read ON model_tier_budget_policies
    FOR SELECT
    USING (
      organisation_id IS NULL
      OR organisation_id = current_setting('app.current_organisation_id')::uuid
    );

  CREATE POLICY model_tier_budget_policies_write ON model_tier_budget_policies
    FOR ALL
    USING (organisation_id = current_setting('app.current_organisation_id')::uuid)
    WITH CHECK (organisation_id = current_setting('app.current_organisation_id')::uuid);
  ```

  Platform-default row editing is admin-role only (§8.5 + §12.13). The generic `<table>_org_isolation` template in this section is NOT applied to `model_tier_budget_policies` — the table has its own explicit block above.

### 8.2 `rlsProtectedTables.ts` manifest entries

Every table above is added to `server/config/rlsProtectedTables.ts` in the same migration PR. CI gate `verify-rls-coverage.sh` enforces manifest coverage — missing entry = gate failure.

```ts
// Added to RLS_PROTECTED_TABLES in migration 0202..0208:
'reference_documents',
'reference_document_versions',
'document_bundles',
'document_bundle_members',
'document_bundle_attachments',
'bundle_resolution_snapshots',
'model_tier_budget_policies',
```

### 8.3 Route-level guards

Every route handler in §7 declares:
- `authenticate` (first middleware, always) — populates `req.user`, `req.orgId`.
- `requireOrgPermission('reference_documents.read' | ...)` — permission-set enforcement.
- `resolveSubaccount(:subaccountId, req.orgId)` for subaccount-scoped routes — throws 404 if not found or org-mismatch.

### 8.4 Principal-scoped agent-run access

When `cachedContextOrchestrator.execute` is invoked from the agent-run path, `withPrincipalContext` is already bound by the run harness (`agentExecutionService`). All snapshot reads and DB writes inside the orchestrator flow through that context. No new wrapper needed.

### 8.5 System-wide reference data

`model_tier_budget_policies` rows with `organisation_id IS NULL` are the platform defaults — readable to all orgs. The table-specific policy block in §8.1 permits this via a custom SELECT policy (`organisation_id IS NULL OR organisation_id = current_setting(...)`). Writes (INSERT / UPDATE / DELETE) stay org-scoped, so platform-default rows can only be modified by an `admin_role` connection — v1 does not expose a system-admin route (§12.13); seed rows are edited via direct DB access until that route ships.

### 8.6 No bypasses (with one documented exception)

No service, route, or orchestrator path uses `withAdminConnection` or any RLS-bypass primitive. Every read and write on the request/orchestrator path goes through the principal-scoped connection. Adding `withAdminConnection` to any cached-context request-path code is a reviewer-blocker.

**Documented exception — `bundleUtilizationJob` (§6.7).** The hourly utilization sweep is a cross-tenant maintenance job and follows the codebase's accepted convention for such jobs: `withAdminConnection` + `SET LOCAL ROLE admin_role`, mirroring `memoryDedupJob`, `llmLedgerArchiveJob`, `securityEventsCleanupJob`, and `regressionReplayJob`. The job MUST write that explicit justification in its header comment (same pattern the existing jobs use).

**Compliance allow-list mechanism.** `scripts/gates/verify-rls-contract-compliance.sh` today scans service files (`server/services/**`) and blocks direct-DB-access bypasses. For jobs (`server/jobs/**`), the same gate reads `scripts/gates/rls-bypass-allowlist.txt` — an explicit file of permitted cross-org-maintenance entry points. `server/jobs/bundleUtilizationJob.ts` MUST be added to that allow-list in the same PR that adds the job file, and the PR MUST include the same inline justification comment the other allow-listed jobs use. The allow-list file is listed in the file inventory (§13.10) as a modified config file. No other cached-context code path is permitted this carve-out.

---

## 9. Execution model

Per `docs/spec-authoring-checklist.md §5`, every behaviour that crosses a latency or transactional boundary is pinned to one of three execution models.

### 9.1 Inline / synchronous

The following are inline from the caller's perspective:

- **`referenceDocumentService.create` / `updateContent`** — the caller blocks on the DB write + the three token-count calls. Token-counting can be slow (~200–500ms per model family, three families). Typical end-to-end: 1–2 seconds. Acceptable for interactive upload.
- **`documentBundleService.*`** — trivially fast DB operations.
- **`bundleResolutionService.resolveAtRunStart`** — inline from the orchestrator. Pure reads + one `INSERT ... ON CONFLICT DO NOTHING` per bundle. Typical: < 100ms.
- **`executionBudgetResolver.resolve`** — inline. Two DB reads. < 10ms.
- **`contextAssemblyEngine.assembleAndValidate`** — inline, pure CPU. < 50ms for typical bundles.
- **`cachedContextOrchestrator.execute`** — inline wrapper over the above plus the router call. The router call itself is the dominant latency (1–10 seconds).

**No inline operations enqueue a pg-boss job.** Every inline call described above is synchronous in both the prose and the implementation.

### 9.2 Queued / asynchronous (pg-boss)

- **`bundleUtilizationJob`** — the only pg-boss job this spec introduces. Schedule: hourly. Idempotent by computing from authoritative state.

No other pg-boss jobs. In particular, budget breaches go through `actionService.proposeAction` + `hitlService` (existing primitives) — not a new job.

### 9.3 Transactional boundaries

Two multi-statement operations use a single transaction:

- **`referenceDocumentService.create` / `updateContent`** — document row + version row + `currentVersionId` update, all in one tx.
- **`cachedContextOrchestrator.execute` terminal `agent_runs` UPDATE** — the single-row UPDATE that sets `agent_runs.run_outcome` carries the `WHERE id = :runId AND run_outcome IS NULL` optimistic-lock precondition, making the terminal write idempotent under retry (a second attempt updates 0 rows and is treated as a no-op). This UPDATE is NOT co-transactional with the router's `llm_requests` insert — the router commits the ledger row at call completion via its own write path (§6.6 step 9). Cross-table atomicity is not required because both writes are idempotent and append-only in effect.

### 9.4 Cached vs dynamic

- **Cached (stable prefix):** the concatenated `reference_documents` serialized content, with `cache_control: { type: 'ephemeral', ttl: '1h' }` via the existing adapter. Default TTL 1h. v1 treats `ttl` as a direct caller hint (§6.6) — resolver-narrowed TTL is deferred (§12.15).
- **Dynamic (no cache):** `instructions + "\n\n" + variableInput` lives in `dynamicSuffix` and is never cached.
- **Cache efficiency claim:** no numeric target for v1. Cadence-driven workloads (once-daily scheduled tasks) have intrinsically low hit rates because cache TTLs max out at 1h. This is stated plainly in the brief and reflected here — no non-functional goal contradicts it.

### 9.5 No staged rollout, no feature flags

Per `docs/spec-context.md` (`rollout_model: commit_and_revert`, `feature_flags: only_for_behaviour_modes`): no staged rollout, no feature flag gating. Migrations land, services land, pilot task is switched to the new path by directly editing the pilot task's configuration. If the pilot task regresses, revert the commit; no flag toggle.

---

## 10. Phased implementation

Six phases. Each phase is a standalone commit series mergeable to `main` in order. Later phases import earlier phases' primitives — no backward dependencies.

### Phase 1 — Data model foundations

**Migrations:** 0202, 0203, 0204, 0205, 0206, 0207, 0208.

All new tables created + RLS + manifest entries + DB CHECK constraints + seed `model_tier_budget_policies` rows for the three model families.

**Services:** `referenceDocumentService` + Pure (create / updateContent / rename / pause / resume / deprecate / list / getByIdWithCurrentVersion / listVersions / getVersion). Token-count helper added to `anthropicAdapter`.

**Routes:** `/api/reference-documents/*` full surface.

**Acceptance:** documents can be uploaded and retrieved by the UI; version history is visible; lifecycle flags work; permission checks fire correctly.

**Schema changes introduced:** 7 new tables + DB constraint.
**Columns referenced by code:** all Phase 1 tables fully self-contained.

### Phase 2 — Bundles + attachment + bundle suggestion

**Migrations:** `0212_bundle_suggestion_dismissals.sql` (§5.12). Bundle tables landed in Phase 1; Phase 2 adds the dismissals table + code.

**Services:** `documentBundleService` + Pure — full §6.2 surface including `findOrCreateUnnamedBundle`, `promoteToNamedBundle`, `suggestBundle`, `dismissBundleSuggestion`, and the pure helper `computeDocSetHash`.

**Routes:** `/api/document-bundles/*` full surface (§7.2) + `/api/bundle-suggestion-dismissals` + subject-listing routes. The `attach-documents` primitive (§7.2) goes in here — it's the backing endpoint for the mockup-attach-docs UX.

**Acceptance:**
- Bundles can be created (both explicit-named and implicit-auto); documents added/removed; attachments to agents / tasks / scheduled-tasks work; listings by subject return correctly with `chipKind` discrimination.
- `findOrCreateUnnamedBundle` is idempotent by doc-set hash + org + subaccount scope.
- `promoteToNamedBundle` flips an unnamed bundle to named in place (same `id`, existing attachments preserved).
- `suggestBundle` returns `{ suggest: false }` for single-doc sets, dismissed sets, and sets already covered by a named bundle; returns `{ suggest: true, alsoUsedOn: N }` for sets attached on 2+ subjects.
- `dismissBundleSuggestion` is idempotent (second call on same user + doc-set updates the timestamp without raising).

### Phase 3 — Budget resolver + assembly engine

**Migrations:** none new.

**Services:** `executionBudgetResolver` + Pure; `contextAssemblyEngine` + `contextAssemblyEnginePure` (serializeDocument, assemblePrefix, computePrefixHash, validateAssembly, ASSEMBLY_VERSION constant).

**Acceptance:** pure tests for assembly determinism + prefix-hash golden-fixture + budget-resolver narrowing math all pass. No integration yet — engine + resolver are dead code in this phase.

### Phase 4 — Bundle resolution + orchestration

**Migrations:** 0209 (`agent_runs` columns).

**Services:** `bundleResolutionService` + Pure; `cachedContextOrchestrator`.

**Router-side additions:** `llmRouter.routeCall` gains optional `prefixHash` and `cacheTtl` params — accepted but NOT persisted in Phase 4 (the `llm_requests.prefix_hash` + `cache_creation_tokens` columns do not yet exist). The router discards `prefixHash` and passes `cacheTtl` through to the adapter (which accepts it today). Phase 5's migration 0210 enables column persistence; no further router code change is required beyond swapping the write-through from a no-op to an insert.

**Acceptance:** `cachedContextOrchestrator.execute` can run end-to-end against a test DB and stubbed `anthropicAdapter` in a manual check. The snapshot row is persisted; `agent_runs.bundle_snapshot_ids`, `agent_runs.variable_input_hash`, and `agent_runs.run_outcome` are written correctly. Cache attribution on `llm_requests` is NOT asserted here — those columns land in Phase 5 (§11.2's integration test is attached to Phase 5).

**Columns referenced by code:** 0202–0209 must all be present. `llm_requests.prefix_hash` / `cache_creation_tokens` are NOT referenced in Phase 4 — the orchestrator passes `prefixHash` to the router, but the router-side write of the column is a Phase 5 change.

### Phase 5 — Ledger attribution + HITL block path

**Migrations:** 0210 (`llm_requests` columns).

**Services:** `actionType='cached_context_budget_breach'` wired through `actionService`. No new service — existing gate primitives handle the flow.

**Cache attribution write path:** router's `anthropicAdapter` response handler now populates both `cachedPromptTokens` and `cacheCreationTokens`, plus `prefixHash`. Update path in `anthropicAdapter.ts` documented inline.

**Acceptance:** a run that breaches the budget creates an `actions` row with the structured payload and pauses the orchestrator; operator approval / rejection resumes / terminates correctly. A successful run produces an `llm_requests` row with non-zero cache-read or cache-creation tokens and a non-null `prefix_hash`.

### Phase 6 — Pilot validation

**Migrations:** none.

**Work:** configure the daily-macro-report scheduled task to use the cached-context orchestrator. Upload the five reference documents via the upload modal (§3.6.5) — either one by one or as a single multi-file upload, with or without the bundle checkbox depending on the pilot operator's preference. Attach to the scheduled task. Run for one week. Monitor via admin observability queries (not through a dedicated Usage Explorer page — that UI is deferred per §3.2).

**Acceptance (the pilot validation criteria from the brief's §9):**
- Two runs within 1 hour produce a cache hit on the second (non-zero `cache_read_input_tokens`).
- A deliberate budget-breach test (add a large document) blocks at HITL with the structured payload, rendered per `mockup-budget-breach-block.html`; no API credits consumed.
- Admin queries surface cache hit rate, cache-write cost, and first-run-vs-cached-run cost delta per run.
- `bundle_utilization` job runs hourly and updates the bundle's utilization JSONB.
- Seven consecutive days of clean runs with correct cache attribution.

**Promotion.** After Phase 6 passes, the infrastructure is considered validated and can be offered to other file-attached task patterns.

### Phase dependency graph

```
Phase 1 — tables + refDocSvc + routes
   ↓
Phase 2 — bundle svc + routes
   ↓
Phase 3 — budget resolver + assembly engine (pure logic)
   ↓
Phase 4 — bundle resolution + orchestrator (first integration)
   ↓
Phase 5 — HITL wiring + ledger columns
   ↓
Phase 6 — pilot validation
```

No backward references; no orphaned deferrals; no phase-boundary contradictions. Columns introduced in Phase 1 are referenced by Phase 2 services; columns in 0209 (Phase 4) are only referenced in Phase 4+; columns in 0210 (Phase 5) are only referenced in Phase 5+.

---

## 11. Testing plan

Per `docs/spec-context.md`: `testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`, `frontend_tests: none_for_now`, `api_contract_tests: none_for_now`, `e2e_tests_of_own_app: none_for_now`. The test plan below honours this.

### 11.1 Pure unit tests (the primary test surface)

All `*Pure.ts` modules get unit tests via the existing tsx + static-gate convention. No vitest / jest / supertest / playwright (per `convention_rejections` in `docs/spec-context.md`).

**`contextAssemblyEnginePure.test.ts`:**
- `ASSEMBLY_VERSION` asserts equals the current constant; changing it without updating fixtures fails.
- **Three-layered golden-fixture test.** The fixture covers a representative multi-bundle input (two bundles, three documents total, one document paused-and-excluded) and asserts:
  1. `computePrefixHash(GOLDEN_COMPONENTS_BUNDLE_A) === GOLDEN_PER_BUNDLE_HASH_A` and same for bundle B — the per-bundle hash function.
  2. `assemblePrefix(GOLDEN_SNAPSHOTS, GOLDEN_VERSION_ROWS) === GOLDEN_ASSEMBLED_PREFIX_BYTES` — the full assembled stablePrefix bytes. Catches serialization / separator / cross-bundle ordering changes even if `computePrefixHash` inputs happen to be stable.
  3. `computeAssembledPrefixHash({ snapshotPrefixHashesByBundleIdAsc, modelFamily, assemblyVersion }) === GOLDEN_CALL_LEVEL_HASH` — the call-level aggregation used for `llm_requests.prefix_hash`.
  Any change to `serializeDocument`, `assemblePrefix`, `computePrefixHash`, or `computeAssembledPrefixHash` that doesn't also regenerate the matching fixture fails the build. This closes R8's "non-hash pure-logic change slips through" hole within the pure-function test envelope.
- `serializeDocument` produces byte-identical output for identical input across invocations.
- `assemblePrefix` is stable under reordering the input array (must sort snapshots by `bundleId` asc, then documents by `documentId` asc, before concat).
- `validateAssembly` returns `{ kind: 'breach' }` for the two v1 `thresholdBreached` values (`max_input_tokens`, `per_document_cap`). Returns `{ kind: 'ok', softWarnTripped: true }` when over the warn ratio but under the hard limit.

**`executionBudgetResolverPure.test.ts`:**
- Narrowing math: `min(task, min(org, modelTier))` across all four dimensions.
- Capacity invariant raises `CACHED_CONTEXT_BUDGET_INVARIANT_VIOLATED`.
- Narrow-to-zero raises `CACHED_CONTEXT_BUDGET_NARROWED_TO_ZERO`.
- `softWarnRatio` passed through.

**`bundleResolutionServicePure.test.ts`:**
- `orderDocumentsDeterministically` sorts by `documentId` ascending stably and carries `serializedBytesHash` verbatim.
- Paused / deprecated / soft-deleted documents are excluded.
- `buildSnapshotRow` produces a `prefixHash` that matches `computePrefixHash(components)` — cross-module consistency check using the same components the snapshot persists.

**`referenceDocumentServicePure.test.ts`:**
- `hashContent` is SHA-256 over raw bytes.
- `hashSerialized` hashes the serialized form including delimiters.
- `serializeDocument` output contains the exact delimiter sequence.

### 11.2 Integration tests (selective)

Per spec-context framing, API contract tests are `none_for_now`. This spec deliberately does NOT ship supertest-style route tests. Integration coverage is limited to one harness test per the Live Agent Execution Log spec's pattern (pure-adjacent integration against a test DB):

**`cachedContextOrchestrator.integration.test.ts`** — single end-to-end flow. **Phase 5**, not Phase 4 — the test asserts `llm_requests.prefix_hash` + `cache_creation_tokens` which land in migration 0210.

1. Seed: org, subaccount, 3 reference documents, 1 bundle with all 3 as members, attach to a synthetic task.
2. Stub `anthropicAdapter.call` to return a canned response with `cache_creation_input_tokens=1000, cache_read_input_tokens=0`.
3. Invoke `cachedContextOrchestrator.execute` with a fixture variable input.
4. Assert: `bundle_resolution_snapshots` row created; `agent_runs` row has `bundle_snapshot_ids`, `variable_input_hash`, `run_outcome='completed'`; `llm_requests` row has `prefix_hash` (call-level assembled hash per §4.4), `cache_creation_tokens=1000`.
5. Second invocation with identical inputs — stub returns `cache_creation=0, cache_read=1000`. Assert: same snapshot row (no new insert — dedup by `(bundle_id, prefix_hash)`); `run_outcome='completed'`; `cachedPromptTokens=1000`.
6. Third invocation with budget-breach — stub not called; `actions` row created with `gateLevel='block'` and the structured payload.
7. Fourth invocation: approve the block, but the re-assembly still breaches (bundle unchanged). Assert: `run_outcome='failed'`, `failureReason='hitl_second_breach'`, stub never called — exercises the one-retry cap (§6.6 step 4).

### 11.3 Concurrency test (pure, but worth calling out)

**`bundleResolutionService.concurrency.test.ts`** — tsx script that starts two concurrent `resolveAtRunStart` calls with identical inputs. Asserts exactly one `bundle_resolution_snapshots` row exists for that `(bundle_id, prefix_hash)` pair and both calls return the same snapshot row. Validates the `UNIQUE(bundle_id, prefix_hash)` + `ON CONFLICT (bundle_id, prefix_hash) DO NOTHING` + re-select pattern under race.

### 11.4 Static gates

`scripts/gates/verify-rls-coverage.sh` and `scripts/gates/verify-rls-contract-compliance.sh` enforce:
- Every new tenant-scoped table in §5 appears in `rlsProtectedTables.ts`.
- No direct-DB-access bypass in any service under `server/services/referenceDocumentService.ts`, `documentBundleService.ts`, `bundleResolutionService.ts`, `cachedContextOrchestrator.ts`.
- `server/jobs/bundleUtilizationJob.ts` is listed in `scripts/gates/rls-bypass-allowlist.txt` with the documented §8.6 carve-out justification — the contract-compliance gate treats allow-listed jobs as permitted bypasses.

Failing any gate blocks the PR per existing CI setup.

### 11.5 Framing deviations

Two narrow carve-outs from the default `runtime_tests: pure_function_only` posture set by `docs/spec-context.md`. Both are permitted by the CLAUDE.md rule that allows "a small number of carved-out integration tests for genuinely hot-path concerns (RLS, crash-resume parity, bulk idempotency)". Declared explicitly here so the deviation is auditable:

1. **`cachedContextOrchestrator.integration.test.ts` (§11.2)** — DB-backed integration test against a test Postgres. **Justification:** the orchestrator is the convergence point for four independent subsystems (budget resolver, bundle resolution, assembly engine, LLM router cache-attribution). Its terminal-write contract on `agent_runs` + the HITL one-retry cap can only be verified against a real DB — stubbing all four seams would verify the stubs, not the contract. One test, one file, stubs only the outbound provider call (`anthropicAdapter.call`). Does NOT count as an API-contract test (no HTTP layer involved).
2. **`bundleResolutionService.concurrency.test.ts` (§11.3)** — tsx-driven concurrency test against a test Postgres. **Justification:** the snapshot-insert idempotency invariant (§6.3) and the `UNIQUE(bundle_id, prefix_hash)` + `ON CONFLICT DO NOTHING` + re-select pattern cannot be expressed as a pure unit test — the guarantee is specifically about what happens when two real transactions race on a real DB. One test, one file, no stubs.

Both carve-outs are limited to a single file each. No additional integration tests are permitted without updating this section + §11.2 or §11.3. API-contract tests (supertest-style) and frontend/E2E tests remain `none_for_now` per the default posture.

---

## 12. Deferred items

Per `docs/spec-authoring-checklist.md §7`. Every deferred item here corresponds to a prose reference elsewhere in the spec.

- **12.1 External document connectors (Drive / Dropbox / S3 / Notion / GitHub).** v1 ships `source_type` / `source_ref` / `last_synced_at` columns on `reference_documents` (§5.1) so connector jobs can populate external rows without schema change. v2 adds one connector at a time, driven by tenant demand.
- **12.2 Snapshot retention tiering.** v1 retains `bundle_resolution_snapshots` indefinitely. A future retention job will delete snapshots older than N days that are no longer referenced by any `agent_runs.bundle_snapshot_ids` JSONB array. Blocked on establishing volume thresholds from production data.
- **12.3 Batch API integration.** Async 50% cost discount. Requires rework of the orchestrator's return contract to support deferred responses and changes to `llmRouter.routeCall`. Separate spec when demand exists.
- **12.4 Multi-breakpoint cache strategies.** Supporting up to 4 `cache_control` breakpoints for document-set tiering by change frequency. Not needed until a bundle has genuinely tiered content.
- **12.5 Token-estimate calibration algorithm.** v1 tracks `actual_tokens - estimated_tokens` drift per model family and flags systematic drift (§4.6 degraded classification). The correction strategy (additive offset, multiplicative factor, recalibration trigger) is deferred to the first tranche of live data.
- **12.6 Agent-level "access without always-load" retrieval mode.** `attachment_mode` column exists on `document_bundle_attachments` (§5.5) with `'always_load' | 'available_on_demand'` enum; v1 only implements `always_load`. The on-demand mode is a retrieval-behaviour pattern that depends on a separate retrieval primitive (different brief / different spec).
- **12.7 Retry strategy for degraded runs.** v1 classifies `degraded` runs but does not re-run them automatically. Retry logic (exponential back-off, bundle re-resolution, fallback model) belongs in a platform-wide retry spec that covers more than cached-context.
- **12.8 Graceful fallback to non-cached call when no bundles attached.** v1 raises `CACHED_CONTEXT_NO_BUNDLES_ATTACHED` — pilot mode treats this as an error. Future: the orchestrator can fall through to a plain `llmRouter.routeCall` without cache when no bundles are attached, enabling the same code path for both cached and non-cached workloads. Blocked on the decision about whether cached-context is the universal path or a sibling path.
- **12.9 Automatic bundle summarisation on threshold breach.** Not supported in v1 — breach routes to HITL for operator decision. Summarisation would live in the assembly pipeline's `(optional transform)` slot (§4 of the brief), which is reserved but empty.
- **12.10 Cross-tenant bundle sharing.** Tenants keep their own bundles. Platform-level reference material (standard disclaimers, common frameworks) is deferred.
- **12.11 Parallel fan-out across multiple API calls.** Splitting a task across multiple parallel LLM calls (for token-count-over-budget workloads) is a separate concern.
- **12.12 Bundle observability UI (admin-only).** Per-bundle utilization dashboard with tier-by-tier radial rings, usage explorer "bundle lens" with hit-rate trends / cost-split / ranking / per-tenant breakdown, and run-detail cache-attribution panel. These represent real backend capabilities the spec already ships at the query layer (§11), but their UI surfaces are deferred until a specific admin workflow needs them — at which point they go on a role-gated admin observability page, never on the primary user journey. See `docs/frontend-design-principles.md` for the governing rule. The pre-revision mockups in `prototypes/cached-context/index.html` document what was cut and why.
- **12.13 Admin editing of platform-default `model_tier_budget_policies`.** v1 seed rows are editable only via direct DB access. A system-admin-gated route is deferred.
- **12.14 New-model-family backfill.** When a new `model_tier_budget_policies` row is added for a previously-unseen `modelFamily`, existing `reference_document_versions.tokenCounts` rows lack that key and assembly against that family would fail. v1 does not ship a backfill migration/job because v1 has a fixed three-family set (Sonnet / Opus / Haiku per §5.2). Adding a fourth family post-pilot is a deliberate operational step that MUST include: (a) a data migration that computes `tokenCounts[newFamily]` for every live `reference_document_versions` row via the Anthropic `countTokens` helper, and (b) a gate on the `model_tier_budget_policies` insert that refuses to activate until the backfill reports zero unfilled rows. Strict fail policy: `referenceDocumentService` throws `CACHED_CONTEXT_DOC_TOKEN_COUNT_MISSING` (500) if assembly encounters a missing `tokenCounts[modelFamily]` key at run time.
- **12.15 Resolver-narrowed cache TTL.** v1 treats the caller's `ttl` hint as a pass-through. A future `model_tier_budget_policies.maxCacheTtl` column + resolver narrowing (`min(caller, orgCeiling, modelTier)`) is deferred — the adapter today supports only `'5m'` and `'1h'` values, so narrowing has small practical value until multi-tier TTLs land upstream.
- **12.16 Unnamed bundle lifecycle management (required future work).** Unnamed bundles are created implicitly on every unique-doc-set attach (§6.2 `findOrCreateUnnamedBundle`). Because the attach flow is frictionless, a power user can easily create hundreds of unnamed bundles in a single session — most of which may never be promoted to named bundles. **v1 intentionally does not implement lifecycle management for unnamed bundles, but the system MUST support future lifecycle management (pruning, consolidation, or non-persistence strategies).** This is required future work, not aspirational — table sizes will justify action during or shortly after the pilot, and the follow-up spec must land before general-availability promotion. The follow-up spec will need to balance: (a) retention for auditability (attachments reference bundle IDs), (b) reclaiming storage for orphaned unnamed bundles (no live attachments, no bundle name, no snapshot references within retention window), and (c) not breaking the bundle-suggestion heuristic's ability to detect "this same doc set exists elsewhere" — the dismissal table's decoupled `doc_set_hash` (§5.12) was deliberately chosen so hash persistence survives any pruning policy. See §14 R11 for the live risk.

---

## 13. File inventory

Exhaustive list of files this spec creates or modifies. Per `docs/spec-authoring-checklist.md §2`, every prose reference elsewhere in the spec appears in this list.

### 13.1 Migrations (new files)

| # | File | Phase | Contents |
|---|---|---|---|
| 0202 | `migrations/0202_reference_documents.sql` | 1 | Create `reference_documents` + RLS + manifest entry + permission seed keys |
| 0203 | `migrations/0203_reference_document_versions.sql` | 1 | Create `reference_document_versions` + RLS + soft-FK on `reference_documents.current_version_id` |
| 0204 | `migrations/0204_document_bundles.sql` | 1 | Create `document_bundles` (incl. `is_auto_created`, `created_by_user_id`, `utilization_by_model_family` JSONB) + CHECK constraint (`is_auto_created` ↔ `name` invariant, §5.3) + partial unique index on named-bundle names + RLS + permission seed keys |
| 0205 | `migrations/0205_document_bundle_members.sql` | 1 | Create `document_bundle_members` + RLS |
| 0206 | `migrations/0206_document_bundle_attachments.sql` | 1 | Create `document_bundle_attachments` + RLS |
| 0207 | `migrations/0207_bundle_resolution_snapshots.sql` | 1 | Create `bundle_resolution_snapshots` + RLS + `UNIQUE(bundle_id, prefix_hash)` + non-unique `prefix_hash` lookup index |
| 0208 | `migrations/0208_model_tier_budget_policies.sql` | 1 | Create `model_tier_budget_policies` + CHECK constraint + seed 3 platform-default rows |
| 0209 | `migrations/0209_agent_runs_cached_context.sql` | 4 | Add `bundle_snapshot_ids` / `variable_input_hash` / `run_outcome` / `soft_warn_tripped` to `agent_runs` |
| 0210 | `migrations/0210_llm_requests_cached_context.sql` | 5 | Add `cache_creation_tokens` / `prefix_hash` to `llm_requests` |
| 0212 | `migrations/0212_bundle_suggestion_dismissals.sql` | 2 | Create `bundle_suggestion_dismissals` (§5.12) + RLS (user-scoped read + write) + manifest entry + unique index on (user_id, doc_set_hash) |

### 13.2 Drizzle schema (new files)

| File | Phase | Table |
|---|---|---|
| `server/db/schema/referenceDocuments.ts` | 1 | `reference_documents` |
| `server/db/schema/referenceDocumentVersions.ts` | 1 | `reference_document_versions` |
| `server/db/schema/documentBundles.ts` | 1 | `document_bundles` (incl. `is_auto_created`, `created_by_user_id`) |
| `server/db/schema/documentBundleMembers.ts` | 1 | `document_bundle_members` |
| `server/db/schema/documentBundleAttachments.ts` | 1 | `document_bundle_attachments` |
| `server/db/schema/bundleResolutionSnapshots.ts` | 1 | `bundle_resolution_snapshots` |
| `server/db/schema/modelTierBudgetPolicies.ts` | 1 | `model_tier_budget_policies` |
| `server/db/schema/bundleSuggestionDismissals.ts` | 2 | `bundle_suggestion_dismissals` (§5.12) |

### 13.3 Drizzle schema (modified files)

| File | Phase | Change |
|---|---|---|
| `server/db/schema/agentRuns.ts` | 4 | +4 columns (§5.8) |
| `server/db/schema/llmRequests.ts` | 5 | +2 columns (§5.9) |

### 13.4 Services (new files)

| File | Phase | Purpose |
|---|---|---|
| `server/services/referenceDocumentService.ts` | 1 | CRUD + versioning + token-counting |
| `server/services/referenceDocumentServicePure.ts` | 1 | hashContent / hashSerialized / serializeDocument |
| `server/services/documentBundleService.ts` | 2 | CRUD + attachment + membership + unnamed bundle lifecycle (`findOrCreateUnnamedBundle`, `promoteToNamedBundle`, `suggestBundle`, `dismissBundleSuggestion`) per §6.2 |
| `server/services/documentBundleServicePure.ts` | 2 | attachment-key canonicalisation helpers + `computeDocSetHash` (§6.2 pure helper; shared fixture with `contextAssemblyEnginePure.computePrefixHash`) |
| `server/services/bundleResolutionService.ts` | 4 | run-start snapshot resolution |
| `server/services/bundleResolutionServicePure.ts` | 4 | orderDocumentsDeterministically / buildSnapshotRow |
| `server/services/contextAssemblyEngine.ts` | 3 | stateful wrapper |
| `server/services/contextAssemblyEnginePure.ts` | 3 | ASSEMBLY_VERSION / serializeDocument / assemblePrefix / computePrefixHash / validateAssembly |
| `server/services/executionBudgetResolver.ts` | 3 | stateful wrapper |
| `server/services/executionBudgetResolverPure.ts` | 3 | resolveBudgetPure |
| `server/services/cachedContextOrchestrator.ts` | 4 | end-to-end orchestration |

### 13.5 Services (modified files)

| File | Phase | Change |
|---|---|---|
| `server/services/llmRouter.ts` | 4 (param surface), 5 (write-through) | Phase 4 adds optional `prefixHash` and `cacheTtl` params to `routeCall` with no-op write-through (column does not exist until 0210); Phase 5's migration 0210 enables the write-through to `llm_requests.prefix_hash` + `cache_creation_tokens`. The orchestrator in Phase 4 passes `prefixHash` but the router discards it until 0210 lands — this is declared in both Phase 4 and Phase 5 acceptance text. |
| `server/services/providers/anthropicAdapter.ts` | 1 + 5 | Add `countTokens` helper (Phase 1); capture `cache_creation_input_tokens` (Phase 5, column first written in Phase 5 migration 0210) |
| `server/services/actionService.ts` | 5 | Accept new `actionType='cached_context_budget_breach'` (no code change — the service already accepts arbitrary action types; this is a configuration-level addition to the action registry) |
| `server/config/actionRegistry.ts` | 5 | Register `cached_context_budget_breach` action type + payload Zod schema |

### 13.6 Routes (new files)

| File | Phase | Notable endpoints |
|---|---|---|
| `server/routes/referenceDocuments.ts` | 1 | standard CRUD + **`POST /api/reference-documents/bulk-upload`** multi-file upload endpoint (§7.1) |
| `server/routes/documentBundles.ts` | 2 | CRUD + attach/detach + **`POST /api/document-bundles/attach-documents`** (doc-set attach primitive) + **`POST /api/document-bundles/:id/promote`** + **`GET /api/document-bundles/suggest-bundle`** + **`POST /api/bundle-suggestion-dismissals`** (all §7.2) |

### 13.7 Routes (modified files)

| File | Phase | Change |
|---|---|---|
| `server/routes/agents.ts` | 2 | Add `GET /api/agents/:id/attached-bundles` |
| `server/routes/tasks.ts` | 2 | Add `GET /api/tasks/:id/attached-bundles` |
| `server/routes/scheduledTasks.ts` | 2 | Add `GET /api/scheduled-tasks/:id/attached-bundles` |
| `server/index.ts` | 1, 2 | Mount new route files |

### 13.8 Jobs (new files)

| File | Phase | Registered in |
|---|---|---|
| `server/jobs/bundleUtilizationJob.ts` | 2 (registered), 6 (enabled) | `server/jobs/index.ts` |

### 13.9 Shared types (new file)

| File | Phase | Exports |
|---|---|---|
| `shared/types/cachedContext.ts` | 3 | `ResolvedExecutionBudget`, `ContextAssemblyResult`, `PrefixHashComponents`, `HitlBudgetBlockPayload`, `RunOutcome`, `AttachmentSubjectType`, `AttachmentMode`, `ReferenceDocumentSourceType`, `ReferenceDocumentChangeSource`, `BundleSuggestion`, `BundleSuggestionDismissal` (last two added in Phase 2 per §6.2) |

### 13.10 Config (modified files)

| File | Phase | Change |
|---|---|---|
| `server/config/rlsProtectedTables.ts` | 1, 2 | +7 manifest entries in Phase 1 + 1 entry for `bundle_suggestion_dismissals` in Phase 2 (§8.2) |
| `server/config/permissions.ts` | 1, 2 | +6 permission keys (`reference_documents.*` ×3, `document_bundles.*` ×3) |
| `server/config/actionRegistry.ts` | 5 | +1 action type + Zod schema |
| `scripts/gates/rls-bypass-allowlist.txt` | 2 | +1 line allow-listing `server/jobs/bundleUtilizationJob.ts` (§8.6 carve-out) |

### 13.11 Tests (new files)

| File | Phase | Type |
|---|---|---|
| `server/services/__tests__/contextAssemblyEnginePure.test.ts` | 3 | Pure |
| `server/services/__tests__/executionBudgetResolverPure.test.ts` | 3 | Pure |
| `server/services/__tests__/bundleResolutionServicePure.test.ts` | 4 | Pure |
| `server/services/__tests__/referenceDocumentServicePure.test.ts` | 1 | Pure |
| `server/services/__tests__/cachedContextOrchestrator.integration.test.ts` | 5 | Integration (DB + stubbed adapter) — asserts `llm_requests` columns that land in 0210 |
| `server/services/__tests__/bundleResolutionService.concurrency.test.ts` | 4 | Concurrency (DB) |

### 13.12 Documentation (modified)

| File | Phase | Change |
|---|---|---|
| `architecture.md` | 6 | Add "Cached context" entry to Key files per domain §; document the new primitive family |
| `docs/capabilities.md` | 6 | Add "File-attached recurring tasks" as a Product Capability under the relevant category |

### 13.13 Documentation + mockups (reference — created alongside this spec revision)

These files are already on disk as of the 2026-04-23 UX revision. Listed here for completeness so the file inventory is exhaustive.

| File | Purpose |
|---|---|
| `docs/frontend-design-principles.md` | Governing UI rules (pre-design checklist, ship-by-default, defer-by-default, complexity budget, worked example for this feature). §3.6 references this as the authority for UI decisions. |
| `prototypes/cached-context/index.html` | Landing page for the mockup set, concept-shift summary, iteration notes. |
| `prototypes/cached-context/mockup-attach-docs.html` | §3.6.3 Flow A + §3.6.4 post-save suggestion. |
| `prototypes/cached-context/mockup-upload-document.html` | §3.6.5 reusable upload modal. |
| `prototypes/cached-context/mockup-bundle-detail.html` | §3.6.3 Flow E + bundle management. |
| `prototypes/cached-context/mockup-budget-breach-block.html` | §3.6.3 Flow F + `HitlBudgetBlockPayload` (§4.5) rendering. |

---

## 14. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Assembly logic drifts without an `ASSEMBLY_VERSION` bump**, silently invalidating caches against new serialization or producing wrong prefix hashes under old callers. | Golden-fixture test in `contextAssemblyEnginePure.test.ts` (§11.1) fails the build on any serialization change without a matching version bump. |
| R2 | **Polymorphic `subject_id` on `document_bundle_attachments` accumulates orphans** when referenced agents / tasks / scheduled_tasks are deleted. | `documentBundleService.attach` validates row existence at attach time. Garbage-collection of orphaned rows deferred (§12) — v1 relies on soft-delete pattern on the target tables. A future sweep job flags orphans. |
| R3 | **`bundle_resolution_snapshots` grows without bound.** `UNIQUE(bundle_id, prefix_hash)` bounds duplicates per bundle but not unique snapshot variants over time. | Dedup plus snapshot retention tiering (§12.2). Volume unknown pre-pilot; measure in Phase 6, set retention thresholds in a follow-up migration. |
| R4 | **Model tokeniser changes in a provider upgrade** invalidate stored `tokenCounts` on `reference_document_versions`. | `referenceDocumentService.updateContent` recomputes on every content change. A platform-wide re-count sweep is triggered manually on model-family upgrade — documented as a follow-up runbook task. |
| R5 | **HITL block window (suspend_until) elapses before operator approves.** | Existing `hitlService` timeout logic produces a `run_outcome='failed'`. The operator can re-trigger the scheduled task. Not considered a bug — this is the documented failure mode. |
| R6 | **Concurrent bundle edits vs in-flight runs.** If a user removes a document from a bundle mid-run, does the run fail? | Snapshot-at-run-start (§4.3 + §6.3) resolves this: the run reads the pre-edit snapshot; the edit applies from the next run onwards. Atomic resolution rule (§10 brief principle). |
| R7 | **`prefixHash` collisions.** SHA-256 collision probability is negligible for our cardinality but theoretically non-zero. | Hash collision would produce a false cache hit (wrong prefix serves a different bundle). Mitigation: `prefixHashComponents` stored alongside the hash — a post-hoc audit can detect mismatched components sharing a hash. If the collision actually fires before that audit runs, we have a bad day; accepted risk. |
| R8 | **`ASSEMBLY_VERSION = 1` forever risk.** The manual-bump convention means a dev forgetting the bump produces silent cache-invalidation confusion. | Mitigated by a three-layered golden-fixture test in §11.1 covering: per-bundle `computePrefixHash`, the full assembled `stablePrefix` bytes, and the call-level `computeAssembledPrefixHash` aggregation. Any serialization, separator, ordering, or hash-input change that doesn't regenerate the matching fixture fails the build. CI-based auto-detection of "spec-layer contract changed without ASSEMBLY_VERSION bumped" is deferred — v1 relies on tests + code-review + the checklist. |
| R9 | **Router contract extension drift.** Adding `prefixHash` + `cacheTtl` to `llmRouter.routeCall` is a caller-side change. If another caller passes these unintentionally, they'd land in `llm_requests.prefix_hash`. | Both params are optional; only `cachedContextOrchestrator` passes them. A one-line check in the router's callsite can assert the caller is registered, but v1 relies on code review. |
| R10 | **`run_outcome` classification drift.** Future additions (a new enum value like `cancelled`) could break dashboards expecting the three current values. | The column is text, not Postgres ENUM — adding values is schema-free. Dashboards read via aggregation that groups by the enum; unknown values surface as their own bucket. Documented in §4.6. |
| R11 | **Unbounded unnamed bundle growth.** The attach flow creates a new unnamed bundle for every previously-unseen doc set (§6.2 `findOrCreateUnnamedBundle`). A user iterating on doc selections in an attach picker can produce tens of unnamed bundles in a single session, most never promoted. Over time this bloats `document_bundles`, `document_bundle_members`, and the `document-bundles → suggest-bundle` query cost. | Principle: the system should guard against unbounded growth of auto-created bundles over time. v1 does not implement a GC policy — the table sizes are expected to handle pilot + early-production volume without one. A future unnamed bundle GC policy (see §12.16) will retire orphaned unnamed bundles (no live attachments, no named-bundle promotion, no snapshots within retention window). Implementation teams watch for bloat patterns during the pilot and trigger the follow-up spec when volume justifies it. |

---

## 15. Open questions (resolved + remaining)

The brief's open questions (§8) were all resolved in the brief's fourth review pass. Remaining genuine decisions are spec-level and small.

**Resolved in the brief:**
1. Cached-context vs Universal Brief: cached-context is the pre-declared static primitive; Universal Brief is the dynamic runtime injection. Composed, not competing.
2. Budget layering: one canonical `ExecutionBudget` at the enforcement boundary, three inputs at resolution.
3. Lifecycle vs cache coherence: the `included_flags` input to `prefix_hash` handles this naturally.
4. Quality-score interaction: bundle membership wins; paused/deprecated hard-exclude.
5. Attribution lives across two tables: `agent_runs.applied_memory_block_ids` + `agent_runs.applied_memory_block_citations` (both existing, unchanged by this spec) record memory-block attribution; `agent_runs.bundle_snapshot_ids` (new, §5.8) records the bundle snapshots resolved for the run; `llm_requests.prefix_hash` (new, §5.9) records the call-level cache-attribution hash. There is NO `agent_runs.cached_prefix_hash` column — the prefix hash lives on `llm_requests` because that is where cache-attribution queries join.
6. External connectors: deferred with `source_type` / `source_ref` / `last_synced_at` columns from day one.

**Remaining (spec-level, resolved in implementation):**

- **Q1. User-controlled bundle ordering.** v1 sorts by `documentId` ascending at resolution time. If operators want a specific order (e.g. most important document last, closest to the breakpoint), we'd add an `orderIndex` column on `document_bundle_members`. Decision: ship v1 with deterministic-by-ID; promote to user-controlled only if operators request it during pilot.
- **Q2. Platform-default policy editing.** §5.7 admin-edit route is deferred (§12.13). Open question: do we edit via direct DB in the interim, or add a minimal system-admin route in Phase 1? Recommendation: direct DB for v1; a seed-tuning exercise mid-pilot (§11) will reveal whether a route is necessary before general release.
- **Q3. `estimatedContextTokens` source for `variable_input`.** v1 uses a pure token-count estimator (approximation based on character count — roughly `chars / 3.5`). This is cheap but introduces the drift tracked in §4.2 / §4.6. Alternative: call `countTokens` on the variable input per run (+200ms latency). Decision: go with the approximation for v1, track drift, revisit if drift exceeds threshold.
- **Q4. `actions.subaccount_scope` for the budget-breach action.** The `actions.actionScope` column defaults to `'subaccount'`. For budget-breach blocks, does the org-admin see breaches across all subaccounts? **Decision for v1: `'subaccount'` scope.** Breaches belong to the subaccount whose bundle budget was breached; org-admin cross-subaccount visibility is handled by existing review-queue projections that aggregate across subaccounts an admin has access to, not by changing the action scope here. Implemented in Phase 5 via the `actionRegistry` entry for `cached_context_budget_breach`.
- **Q5. Prefix-hash dedup across model families.** A snapshot row is keyed by `prefix_hash` only (§5.6). The hash includes `modelFamily` in its inputs (§4.4), so Sonnet and Opus naturally produce different hashes. Confirmed — no action needed; noted here for reviewer-clarity.

---

## 16. Success criteria

The spec is validated when the following are all true after Phase 6:

1. **End-to-end pilot run.** The daily-macro-report scheduled task runs through `cachedContextOrchestrator` with its 5-document bundle, Sonnet 4.6, standard endpoint. No per-task glue code.
2. **Cache hit verifiable.** Two runs within the TTL window produce a cache hit on the second — `cache_read_input_tokens > 0` on the `llm_requests` row. The first run has `cache_creation_input_tokens > 0`.
3. **Budget-breach block.** A deliberate test bundle (3 oversized documents) triggers a `gateLevel='block'` action with the structured payload. Zero API credits consumed on the blocked run. The orchestrator pauses; operator approves; orchestrator re-resolves and runs cleanly.
4. **Attribution visible at the admin query surface.** SQL queries expose: cache-hit rate per bundle per tenant per day, cache-creation cost per tenant per day, first-run-vs-cached-run cost delta per bundle, bundle utilization per bundle per model family. No user-facing dashboard in v1 — these queries back the existing admin observability tooling only (per §3.2 out-of-scope, the "Bundle lens" Usage Explorer page is deferred).
5. **Run outcome classification works.** Queries against `agent_runs.run_outcome` distinguish `completed`, `degraded`, and `failed` counts. Degraded runs surface at least one of: `soft_warn_tripped = true`, drift > 10%, unexpected cache miss.
6. **Prefix-hash diagnosis proves diagnostic.** A deliberate bundle edit produces a different call-level `prefix_hash` on `llm_requests` on the next run. The diagnosis path documented in §4.4 (read `agent_runs.bundle_snapshot_ids`, fetch per-bundle `prefix_hash_components`, diff against prior snapshots) identifies which specific bundle / document / version inputs changed.
7. **Seven days clean.** Seven consecutive daily runs of the pilot task, no failures, cache behaviour consistent with expectations, cost attribution clean.
8. **Static gates green.** `verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh`, all pure-test suites, CI build — all pass.
9. **Documentation synced.** `architecture.md` + `docs/capabilities.md` updated in the same PR as Phase 6.

When all nine are green, cached-context is promoted from pilot to general-availability and can be offered to new file-attached task patterns.












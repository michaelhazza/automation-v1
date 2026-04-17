# Memory & Briefings — Build Plan

**Source spec:** [`docs/memory-and-briefings-spec.md`](./memory-and-briefings-spec.md) (sign-off: 5 spec-reviewer iterations + 2 external reviews)
**Branch:** `claude/task-memory-context-retrieval-Mr5Mn`
**Status:** Ready to build
**Author:** architect agent handoff

This document translates the 902-line spec into three build-oriented artifacts. It does **not** re-review the spec — see the spec for rationale, trade-offs, and open-question resolutions. Section references (§) point back to the spec.

Three artifacts, in order:

1. **Artifact 1 — Schema migration list**
2. **Artifact 2 — Phase-by-phase implementation checklist**
3. **Artifact 3 — Acceptance-test matrix**
4. **Spec ambiguities surfaced during planning** (trailing notes — spec is NOT modified by this plan)

---

## Artifact 1 — Schema Migration List

All migrations follow the Drizzle-managed convention in `migrations/` (see `/home/user/automation-v1/architecture.md` "Schema & Migrations"). Next free slot starts at **0129** (highest in-tree is `0128_memory_block_source_reference.sql`).

Every migration uses `CREATE … IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` idempotent form (repo convention). Soft-delete columns follow the existing `deletedAt timestamptz` pattern. All new tables include `organisationId uuid NOT NULL REFERENCES organisations(id)` for RLS alignment where tenant-scoped.

| # | Seq | Migration name | Tables / columns affected | Required by (item ID) | Phase | Backfill | Rollback strategy |
|---|---|---|---|---|---|---|---|
| 1 | 0129 | `memory_blocks_status_source.sql` | `memory_blocks`: add `status text NOT NULL DEFAULT 'active'` (enum: active, draft, pending_review, rejected), `source text NOT NULL DEFAULT 'manual'` (enum: manual, auto_synthesised). Add partial index `memory_blocks_active_idx ON (organisation_id, subaccount_id) WHERE status = 'active' AND deleted_at IS NULL`. | S6, S11 | Phase 1 | No — defaults cover existing rows (all existing blocks become `status='active', source='manual'`). | Drop columns + index. No data loss since defaults re-apply on column drop. |
| 2 | 0130 | `memory_blocks_embedding.sql` | `memory_blocks`: add `embedding vector(1536)`. Add HNSW index `memory_blocks_embedding_hnsw ON memory_blocks USING hnsw (embedding vector_cosine_ops) WHERE deleted_at IS NULL AND status = 'active'`. | S6 | Phase 1 (schema) + Phase 2 (backfill job) | **Yes** — one-shot pg-boss job `memory-blocks-embedding-backfill` scheduled on Phase 2 deploy. Per §5.2. | Drop column + index. Backfill can be re-run idempotently. |
| 3 | 0131 | `subaccounts_portal_mode.sql` | `subaccounts`: add `portal_mode text NOT NULL DEFAULT 'hidden'` (enum: hidden, transparency, collaborative). | S15, S16 (required by S5 step 8 in Phase 3) | Phase 1 | No — default `'hidden'` matches spec §6.2. | Drop column. |
| 4 | 0132 | `subaccounts_portal_features.sql` | `subaccounts`: add `portal_features jsonb NOT NULL DEFAULT '{}'::jsonb`. | S17 | Phase 4 | No — empty object is valid; features read fall back to registry defaults via `portalGate.ts`. | Drop column. |
| 5 | 0133 | `subaccounts_client_upload_trust_state.sql` | `subaccounts`: add `client_upload_trust_state jsonb NOT NULL DEFAULT '{"approvedCount":0,"trustedAt":null,"resetAt":null}'::jsonb`. | S9 | Phase 4 | No — default JSON shape per §5.5. | Drop column. Trust can be recomputed from `drop_zone_upload_audit` if ever lost. |
| 6 | 0134 | `subaccounts_clarification_routing_config.sql` | `subaccounts`: add `clarification_routing_config jsonb` (nullable — null means fallback chain defaults per §5.4). | S8 | Phase 2 | No — null is the documented default sentinel. | Drop column. |
| 7 | 0135 | `subaccount_onboarding_state_resume_state.sql` | `subaccount_onboarding_state`: add `resume_state jsonb` (nullable). | S5 | Phase 3 | No — null means "no mid-conversation progress captured". | Drop column. |
| 8 | 0136 | `agent_beliefs_entity_key.sql` | `agent_beliefs`: add `entity_key text` (nullable). Add index `agent_beliefs_entity_key_idx ON (subaccount_id, entity_key) WHERE deleted_at IS NULL AND superseded_by IS NULL AND entity_key IS NOT NULL`. | S3 | Phase 1 | Optional best-effort backfill via script (can leave null; conflict detection only fires for beliefs with explicit `entityKey`). | Drop index + column. |
| 9 | 0137 | `agent_runs_citation_tracking.sql` | `agent_runs`: add `cited_entry_ids jsonb NOT NULL DEFAULT '[]'::jsonb` (uuid[] shape enforced in service), `had_uncertainty boolean NOT NULL DEFAULT false`. Extend `status` enum check constraint to include `'waiting_on_clarification'` (run-level state for S8 pauses). | S8, S12 | Phase 2 | No — defaults valid for existing rows. | Drop columns; status constraint revert requires a follow-up migration because no row should have `'waiting_on_clarification'` once S8 is rolled back. |
| 10 | 0138 | `agent_run_step_status_extend.sql` | Extend the step-status enum (per-step state persisted on `agent_runs` step records — confirm target storage location during implementation; see Spec Ambiguities §S8.1) to include `completed_with_uncertainty` and `waiting_on_clarification`. | S8 | Phase 2 | No. | Revert enum extension; precondition: no step rows carry the new values. Drain or backfill to nearest terminal state before revert. |
| 11 | 0139 | `memory_review_queue.sql` | New table `memory_review_queue` per §5.3. Columns: `id uuid PK`, `organisation_id uuid NOT NULL FK`, `subaccount_id uuid NOT NULL FK`, `item_type text NOT NULL` (enum: belief_conflict, block_proposal, clarification_pending), `payload jsonb NOT NULL`, `confidence real NOT NULL`, `status text NOT NULL DEFAULT 'pending'` (enum: pending, approved, rejected, auto_applied, expired), `created_at timestamptz NOT NULL DEFAULT now()`, `expires_at timestamptz`, `created_by_agent_id uuid` (nullable), `resolved_at timestamptz`, `resolved_by_user_id uuid`. Indexes: `(subaccount_id, status, created_at DESC)`; `(organisation_id, status)` for org rollup counts. | S3, S7, S11 | Phase 1 | No. | Drop table. |
| 12 | 0140 | `memory_citation_scores.sql` | New table `memory_citation_scores` per §4.4. Columns: `run_id uuid NOT NULL FK agent_runs(id) ON DELETE CASCADE`, `entry_id uuid NOT NULL FK workspace_memory_entries(id) ON DELETE CASCADE`, `tool_call_score real NOT NULL`, `text_score real NOT NULL`, `final_score real NOT NULL`, `cited boolean NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`. PK: `(run_id, entry_id)`. Index: `(entry_id, created_at DESC)` for S4 rolling-window queries. | S4, S12 | Phase 2 | No. | Drop table. Cascade preserves referential integrity against run cleanup job. |
| 13 | 0141 | `drop_zone_upload_audit.sql` | New table `drop_zone_upload_audit` per §5.5. Columns: `id uuid PK`, `organisation_id uuid NOT NULL FK`, `subaccount_id uuid NOT NULL FK`, `uploader_user_id uuid` (nullable — null for client portal uploads), `uploader_role text NOT NULL` (enum: agency_staff, client_contact), `file_name text NOT NULL`, `file_hash text NOT NULL`, `proposed_destinations jsonb NOT NULL`, `selected_destinations jsonb NOT NULL`, `applied_destinations jsonb`, `required_approval boolean NOT NULL`, `approved_by_user_id uuid` (nullable), `created_at timestamptz NOT NULL DEFAULT now()`, `applied_at timestamptz` (nullable). Indexes (required per §5.5): `(subaccount_id, created_at DESC)`, `(file_hash)`, `(subaccount_id, uploader_role, created_at DESC)`. No `deleted_at` — append-only, immutable per spec. | S9 | Phase 4 | No. | Drop table. Audit rows lost on rollback — acknowledge in migration comment. |
| 14 | 0142 | `onboarding_bundle_configs.sql` | New table `onboarding_bundle_configs` per §8.7. Columns: `id uuid PK`, `organisation_id uuid NOT NULL FK UNIQUE` (one row per org), `playbook_slugs jsonb NOT NULL DEFAULT '["intelligence-briefing","weekly-digest"]'::jsonb`, `ordering jsonb NOT NULL DEFAULT '{}'::jsonb` (map of slug→integer order), `updated_at timestamptz NOT NULL DEFAULT now()`, `updated_by_user_id uuid`. | S5 (onboarding bundle manifest) | Phase 3 | **Yes** — seed script inserts one row per existing org with default bundle on first deploy of Phase 3. | Drop table. Seed script re-runnable. |
| 15 | 0143 | `scheduled_tasks_delivery_channels.sql` | `scheduled_tasks`: add `delivery_channels jsonb` (nullable — null means "use playbook default"). | S22 (component) — consumed by S19, S20 | Phase 1 (column); Phase 3 reads it | No — null is a valid state. | Drop column. |

**Count: 15 migrations total** (slots 0129–0143).

**Cross-cutting migration rules (per `/home/user/automation-v1/CLAUDE.md` and `architecture.md`):**

- Every new tenant-scoped table (`memory_review_queue`, `memory_citation_scores`, `drop_zone_upload_audit`, `onboarding_bundle_configs`) MUST be added to `server/config/rlsProtectedTables.ts` in the same commit that ships the `CREATE POLICY` statement. CI gate `verify-rls-coverage.sh` will fail otherwise.
- Every migration goes through `npm run db:generate` — never hand-authored raw SQL alone. Verify the generated file matches the table/column plan in this list before committing.
- `drop_zone_upload_audit` is append-only; do NOT add an `updated_at` trigger or a `deletedAt` column. Immutable by design (§5.5).
- `memory_blocks_embedding_hnsw` index creation runs in a separate migration statement after the backfill job completes, not in 0130 itself, if the backfill produces meaningful volume — otherwise the index build locks the table. For initial deploy (empty `embedding` column), the index can be created alongside the column add in 0130.

---

## Artifact 2 — Phase-by-phase Implementation Checklist

Phases are defined in §3 of the spec and are NOT reordered here. Each task is atomic — one service, one route, one job, one schema file, or one UI component — so it maps to a single PR or a single chunk in a chunked PR.

**Reviewer-model routing** per-task:

- **Opus** = cross-cutting, invariant-heavy, or agent-loop-adjacent. These need senior review: S6 (relevance retrieval — changes agent context injection), S8 (real-time clarification — changes run loop + step graph), S11 + S4 (feedback loop + quality mutation invariant), S21 (config-document parser reliability).
- **Sonnet** = pattern-following, mechanical — everything else (migrations, routes that follow existing shapes, UI components, jobs that mirror existing job scaffolding).

Reviewer note is one word at the end of each task line: `[Opus]` or `[Sonnet]`.

---

### Phase 1 — Foundations

**Scoped items landing:** S1, S2, S3, S15 (data layer only), S22 (component), plus schema foundations for S6, S11, S16 (portal mode column).

**Done when:**
- All 6 Phase 1 migrations (0129, 0130, 0131, 0134, 0136, 0139, 0143) applied and verified via `npm run db:generate` + inspection of the generated files.
- Memory decay/pruning job runs nightly and prunes at least one entry end-to-end in a scripted test.
- RRF recency boost is live and visible in `workspaceMemoryService.getRelevantMemories()` unit tests.
- Belief conflict supersession fires (queue-entry path only; real-time path is a no-op placeholder per §4.3).
- `DeliveryChannels` UI component renders standalone with an integration-aware channel list.
- `canRenderPortalFeature()` helper returns correct gates for `hidden` / `transparency` / `collaborative` modes (feature registry exists but Phase 4 populates portalFeatures JSONB consumers).

**Dependency ordering within Phase 1:** Migrations 0129 (block status/source) and 0131 (portalMode) MUST land **before** anything in Phase 2 starts (§3 phasing note — S6 in Phase 2 reads `status='active'` as its injection invariant; S5 step 8 in Phase 3 writes `portalMode`).

**Ordered task list:**

1. [ ] `migrations/0129_memory_blocks_status_source.sql` — add `status` and `source` columns + active-status partial index. (S6, S11 prep.) [Sonnet]
2. [ ] `server/db/schema/memoryBlocks.ts` — add `status`, `source` columns to the Drizzle table definition. Add typed enums. (S6, S11.) [Sonnet]
3. [ ] `migrations/0130_memory_blocks_embedding.sql` — add `embedding vector(1536)` + HNSW index on `(embedding) WHERE status='active'`. (S6 prep.) [Sonnet]
4. [ ] `server/db/schema/memoryBlocks.ts` — add `embedding` column to Drizzle schema, typed `pgvector`. (S6.) [Sonnet]
5. [ ] `migrations/0131_subaccounts_portal_mode.sql` — add `portal_mode text NOT NULL DEFAULT 'hidden'`. (S15, S16, S5 step 8.) [Sonnet]
6. [ ] `server/db/schema/subaccounts.ts` — add `portalMode` typed enum column. (S15.) [Sonnet]
7. [ ] `migrations/0134_subaccounts_clarification_routing_config.sql` — add nullable jsonb. (S8 prep — column ready, logic arrives in Phase 2.) [Sonnet]
8. [ ] `server/db/schema/subaccounts.ts` — add `clarificationRoutingConfig` jsonb column. (S8.) [Sonnet]
9. [ ] `migrations/0136_agent_beliefs_entity_key.sql` — add `entity_key text` + partial index. (S3.) [Sonnet]
10. [ ] `server/db/schema/agentBeliefs.ts` — add `entityKey` column + index. (S3.) [Sonnet]
11. [ ] `migrations/0139_memory_review_queue.sql` — new table with indexes per §5.3. (S3, S7, S11.) [Sonnet]
12. [ ] `server/db/schema/memoryReviewQueue.ts` — new Drizzle schema file; export types; register in `server/db/schema/index.ts`; add to `server/config/rlsProtectedTables.ts`. (S3, S7, S11.) [Sonnet]
13. [ ] `migrations/0143_scheduled_tasks_delivery_channels.sql` — add `delivery_channels jsonb` nullable. (S22 support.) [Sonnet]
14. [ ] `server/db/schema/scheduledTasks.ts` — add `deliveryChannels` typed jsonb shape. (S22.) [Sonnet]
15. [ ] `server/config/limits.ts` — add constants: `DECAY_WINDOW_DAYS=90`, `DECAY_RATE=0.05`, `PRUNE_THRESHOLD=0.15`, `PRUNE_AGE_DAYS=180`, `REINDEX_THRESHOLD=500`, `RECENCY_BOOST_WINDOW=60`, `RECENCY_BOOST_WEIGHT=0.15`, `CONFLICT_CONFIDENCE_GAP=0.2`. (S1, S2, S3.) [Sonnet]
16. [ ] `server/services/memoryEntryQualityService.ts` (new) — pure + impure split per `architecture.md` §Services. Sole owner of `qualityScore` mutation (§4.4 invariant). Exports: `applyDecay(subaccountId)`, `pruneLowQuality(subaccountId)`. Throws `{ statusCode: 500, message, errorCode: 'DECAY_FAILED' }` on batch failure. (S1.) [Sonnet]
17. [ ] `server/services/memoryEntryQualityServicePure.ts` — decay-factor math; prune eligibility decision; unit-tested. (S1.) [Sonnet]
18. [ ] `server/jobs/memoryEntryDecayJob.ts` — pg-boss nightly job, per-subaccount work units; registers via `server/jobs/index.ts`; triggers `memory-hnsw-reindex` one-shot job when pruned count > `REINDEX_THRESHOLD`. Logs weekly pruned-count summary. (S1.) [Sonnet]
19. [ ] `server/jobs/memoryHnswReindexJob.ts` — one-shot rebuild trigger (pg-boss). Re-issues `REINDEX` on the HNSW index. (S1.) [Sonnet]
20. [ ] `server/services/__tests__/memoryEntryQualityServicePure.test.ts` — decay-factor edge cases (never access, first-access-today, prune-floor). (S1.) [Sonnet]
21. [ ] `server/services/workspaceMemoryService.ts` — modify `getRelevantMemories()` RRF fusion to add the recency-boost multiplier per §4.2 formula. Document the non-persistent nature — NEVER write `recencyBoost` back to `qualityScore` (§4.4 invariant). (S2.) [Opus] — agent-loop-adjacent; reviewer must verify the invariant holds.
22. [ ] `server/services/__tests__/workspaceMemoryServicePure.test.ts` — RRF recency-boost ordering; invariant test: boost never persisted. (S2.) [Sonnet]
23. [ ] `server/services/beliefConflictService.ts` (new) — supersession logic per §4.3. Cross-agent conflict queries on `(subaccountId, entityKey)`. Auto-supersede when confidence gap > 0.2; otherwise insert `memory_review_queue` row with `itemType='belief_conflict'`. Phase 1 stops here — real-time injection into active runs is a no-op stub that logs "S8 not yet landed" and returns. (S3.) [Opus] — invariant-heavy; single point of supersession truth.
24. [ ] `server/services/__tests__/beliefConflictServicePure.test.ts` — conflict-detection + supersession decision truth table. (S3.) [Sonnet]
25. [ ] `server/services/agentBeliefService.ts` — integrate `beliefConflictService` into the belief write path (pre-insert conflict check). (S3.) [Sonnet]
26. [ ] `server/config/portalFeatureRegistry.ts` (new) — static registry mapping feature keys to minimum `portalMode`. Seed keys: `dropZone`, `clarificationRouting`, `taskRequests`, `memoryInspector`, `healthDigest`. (S15, S17 consumers.) [Sonnet]
27. [ ] `server/lib/portalGate.ts` (new) — `canRenderPortalFeature(subaccountId, featureKey)` helper per §6.1. Reads registry + subaccount `portalMode`. Returns false if `portalMode < required` or `portalFeatures[featureKey] === false`. For Phase 1 the `portalFeatures` read falls back to `{}` (column not yet added — migration 0132 is Phase 4). (S15.) [Opus] — security-adjacent; reviewer verifies no bypass paths.
28. [ ] `server/services/__tests__/portalGateTest.ts` — truth table across (portalMode × portalFeatures × requiredTier). (S15.) [Sonnet]
29. [ ] `client/src/components/DeliveryChannels.tsx` (new) — component per §10.4 API. Queries `/api/subaccounts/:id/integrations/available-channels` (new endpoint — add as part of this task) to render channel list. Always-on inbox invariant rendered as a read-only badge, not a checkbox. (S22.) [Sonnet]
30. [ ] `server/routes/integrations.ts` OR new `server/routes/deliveryChannels.ts` — `GET /api/subaccounts/:subaccountId/integrations/available-channels` returning `{ email: true, portal: false, slack: false, ... }` based on connected integrations. Uses `resolveSubaccount` + `asyncHandler`. (S22.) [Sonnet]
31. [ ] `server/services/deliveryChannelService.ts` (new) — `getAvailableChannels(subaccountId, orgId)` aggregator; consumed by route. (S22.) [Sonnet]
32. [ ] `client/src/components/__tests__/DeliveryChannels.test.tsx` — renders correctly with 1/2/all integrations connected; email always pre-ticked; portal only visible when `portalMode >= transparency`. (S22.) [Sonnet]
33. [ ] `server/services/deliveryService.ts` (new) — `deliver(artefact, deliveryConfig, subaccountId)` per §10.5. Always writes to inbox. Enforcement boundary: ESLint rule or architectural test that forbids direct inbox writes outside this service (document in PR). Retry ladders per spec. (S22.) [Opus] — enforcement boundary; reviewer verifies the inbox guarantee cannot be bypassed.
34. [ ] `server/services/__tests__/deliveryServicePure.test.ts` — per-channel dispatch, retry ladder, always-inbox invariant. (S22.) [Sonnet]

**Phase-exit gate:**

- `npm run lint`, `npm run typecheck`, `npm test` — all green.
- `npm run db:generate` produces empty diff (schema matches migrations).
- Scripted verification: seed 100 synthetic memory entries with staggered `lastAccessedAt`; run decay job; confirm expected prune count; confirm HNSW reindex job was enqueued if threshold crossed.
- Scripted verification: write two contradicting beliefs for the same `entityKey` on different agents; confirm `memory_review_queue` row with `itemType='belief_conflict'` appears; confirm NO run-loop pause happens (S8 not landed yet).
- `pr-reviewer` + `dual-reviewer` pass for each Opus-flagged task.

---

### Phase 2 — Core automation

**Scoped items landing:** S6 (relevance-driven block retrieval), S7 (confidence-tiered HITL), S8 (real-time clarification), S12 (self-tuning metrics / citation detection), S4 (self-tuning quality adjustment — reads S12 data).

**Done when:**
- Agent runs pull blocks via relevance scoring by default; explicit attachments continue to work as override; no block with `status != 'active'` is ever injected (global invariant, §5.2).
- `memory_review_queue` has active writers (belief conflicts from S3, block proposals stub from S7, clarifications for audit from S8) and read/resolve routes wired to the UI.
- `request_clarification` tool is callable by any agent; blocking clarifications correctly pause only dependent downstream steps; timeout transitions the paused step to `completed_with_uncertainty` and the run to `hadUncertainty: true`.
- Citation detector scores every run's injected entries and writes `memory_citation_scores`; `cited_entry_ids` populated on `agent_runs`.
- Weekly quality-adjustment job reads citation data and nudges `qualityScore` per §4.4 rules. Invariant holds: S4 is the only path that mutates `qualityScore` post-write.
- Threshold tuning pass (Phase 2 exit-criterion per §4.4 calibration note) has completed: cited/injected distribution reviewed against `CITATION_THRESHOLD`, `CITATION_TEXT_OVERLAP_MIN`, `CITATION_TEXT_TOKEN_MIN`; defaults either confirmed or adjusted in `limits.ts`.

**Dependency ordering within Phase 2:**
1. Embedding backfill (task 1) must complete before S6 relevance retrieval can ship (task 3) — without embeddings, all blocks score zero.
2. S12 citation detector (tasks 15–19) must run in shadow mode (scoring but not acting) for at least one full week before S4 quality-adjustment job (task 20) is enabled in production. This is the threshold-tuning window — S4 without tuning risks corrupting `qualityScore` based on miscalibrated citation signal.
3. S8 clarification (tasks 9–14) depends on `beliefConflictService` (Phase 1 task 23) real-time path — flip its stub to live only after tasks 9–11 land.

**Ordered task list:**

1. [ ] `server/jobs/memoryBlocksEmbeddingBackfillJob.ts` — one-shot pg-boss job; iterates `memory_blocks` rows with `embedding IS NULL AND deleted_at IS NULL`; batches 50 at a time; calls existing embedding service; writes back. Scheduled on Phase 2 deploy. (S6.) [Sonnet]
2. [ ] `server/services/memoryBlockService.ts` — add `getRelevantBlocks(taskContext, subaccountId, orgId, tokenBudget)` per §5.2 algorithm. Cosine scoring against task-context embedding, threshold `BLOCK_RELEVANCE_THRESHOLD=0.65` (new const in `limits.ts`), top-K default 5. Filters `WHERE status='active'` — enforces global block status invariant (§5.2). (S6.) [Opus] — invariant-heavy; reviewer verifies status filter cannot be bypassed.
3. [ ] `server/services/memoryBlockServicePure.ts` — pure scoring + ranking logic; unit-tested. (S6.) [Sonnet]
4. [ ] `server/services/memoryBlockService.ts` — modify `getBlocksForAgent()` to compose: (a) explicit `memory_block_attachments` join (existing path) filtered to `status='active'`, (b) union with `getRelevantBlocks()` results, (c) dedupe by block id preferring explicit. Token-budget enforcement in relevance order. (S6.) [Opus] — agent-loop-adjacent; touches every run.
5. [ ] `server/routes/memoryBlocks.ts` — add route-level 409 rejection when attempting to create/update an attachment whose target block has `status != 'active'`. Enforces §5.2 global invariant at the surface. (S6.) [Opus] — security-adjacent.
6. [ ] `server/services/agentExecutionService.ts` — wire `getBlocksForAgent()` in context injection at run start (lines ~678–760 per spec §2). Replace any code path that reads attachments directly. (S6.) [Opus] — touches run loop; every agent's context depends on this landing correctly.
7. [ ] `server/services/__tests__/memoryBlockServicePure.test.ts` — relevance ranking, threshold floor, token-budget eviction in relevance order, status filter. (S6.) [Sonnet]
8. [ ] `server/services/__tests__/memoryBlockServiceTest.ts` (integration) — verify draft blocks never surface (explicit or relevance); verify protected `config-agent-guidelines` always surfaces. (S6.) [Sonnet]
9. [ ] `server/skills/request_clarification.md` — new skill file; schema: `question`, `contextSnippet`, `urgency: 'blocking' | 'non_blocking'`, `suggestedAnswers?`. Registers handler key in `server/config/actionRegistry.ts`. Distinct from existing `ask_clarifying_question` (§5.4). (S8.) [Sonnet]
10. [ ] `server/services/clarificationService.ts` (new) — routing logic per §5.4: resolve recipient via `clarificationRoutingConfig` jsonb on subaccount; fallback chain subaccount_manager → agency_owner; portal route for client-domain questions in Collaborative mode. Writes `memory_review_queue` row with `itemType='clarification_pending'` for audit. Emits WebSocket event via existing `useSocket` room infrastructure. Email fallback service call if no active WS session. (S8.) [Opus] — routing logic is security + UX critical.
11. [ ] `server/services/clarificationServicePure.ts` — recipient resolution decision table; unit-tested against all routing config permutations. (S8.) [Sonnet]
12. [ ] `server/services/agentExecutionService.ts` — extend step state machine: on blocking clarification, transition current step to `waiting_on_clarification`; mark run `hadUncertainty=false` initially; on timeout, transition step to `completed_with_uncertainty` and run to `hadUncertainty=true`. Dependent downstream steps blocked via existing step-graph; independent downstream steps proceed. Per §5.4 items 4–6. (S8.) [Opus] — cross-cutting state machine change; the watchpoint ChatGPT flagged.
13. [ ] `server/jobs/clarificationTimeoutJob.ts` — pg-boss scheduled job polling `agent_runs` for steps in `waiting_on_clarification` past `CLARIFICATION_TIMEOUT`. Fires timeout path; resumes run via existing run-resume infrastructure. (S8.) [Sonnet]
14. [ ] `client/src/components/ClarificationInbox.tsx` — WebSocket subscriber; renders clarification requests with suggested-answer buttons + free-text. POSTs response to `POST /api/clarifications/:id/respond` (new route). (S8.) [Sonnet]
15. [ ] `server/routes/clarifications.ts` — `GET /api/subaccounts/:id/clarifications/pending` and `POST /api/clarifications/:id/respond`. Response endpoint resolves the run via `clarificationService.resolveClarification()`. (S8.) [Sonnet]
16. [ ] `server/services/beliefConflictService.ts` — flip the Phase 1 stub real-time-injection path to call `clarificationService.requestClarification()` when a run is active and confidence gap ≤ 0.2 (§4.3 Phase-2 activation note). (S3 + S8.) [Sonnet]
17. [ ] `server/services/memoryCitationDetector.ts` (new) — implements two-path matcher per §4.4: exact tool-call-arg string match + Jaccard n-gram (n=3) over text. Constants `CITATION_THRESHOLD=0.7`, `CITATION_TEXT_OVERLAP_MIN=0.35`, `CITATION_TEXT_TOKEN_MIN=8` in `limits.ts`. Writes `memory_citation_scores` rows; updates `cited_entry_ids` on `agent_runs`; increments `citedCount` / `injectedCount` on entries. (S12.) [Opus] — the invariant-heavy watchpoint; thresholds are launch knobs.
18. [ ] `server/services/memoryCitationDetectorPure.ts` — Jaccard math + tool-call arg matcher; unit-tested with paraphrase / exact-match / near-miss fixtures. (S12.) [Sonnet]
19. [ ] `server/services/agentExecutionService.ts` — hook citation detector into run-completion path (after tool calls + generated output are finalised, before run marked complete). (S12.) [Opus] — run-loop integration; idempotency important (never score twice per run).
20. [ ] `server/services/__tests__/memoryCitationDetectorPure.test.ts` — matcher truth table; threshold edge cases. (S12.) [Sonnet]
21. [ ] `server/jobs/memoryEntryQualityAdjustJob.ts` — weekly pg-boss job per subaccount. Reads rolling-window `utilityRate` per entry from `memory_citation_scores`; applies §4.4 S4 adjustment rules. Enforces `qualityScore` mutation invariant (co-located with `memoryEntryQualityService`). Gated behind a feature flag `S4_QUALITY_ADJUST_LIVE` (default off until Phase 2 threshold-tuning pass complete). (S4.) [Opus] — invariant-heavy; reviewer verifies single-writer property.
22. [ ] `server/services/memoryEntryQualityService.ts` — add `adjustFromUtility(subaccountId)` method; sole callee is the weekly job (21). Invariant check: no other service imports this method. Architectural test in task 24 enforces. (S4.) [Opus] — same reviewer rationale as task 21.
23. [ ] `server/services/__tests__/memoryEntryQualityServicePure.test.ts` — adjustment thresholds, boost ceiling, reduction floor, never-injected no-op. (S4.) [Sonnet]
24. [ ] `server/services/__tests__/qualityScoreMutationBoundaryTest.ts` — architectural test: grep all TS sources for writes to `qualityScore`; assert only `memoryEntryQualityService.ts` (and the decay job which calls into it) produces them. Fails CI if a new writer appears. (S1 + S4 invariant.) [Sonnet]
25. [ ] `client/src/pages/MemoryReviewQueuePage.tsx` — new page rendering `memory_review_queue` items per subaccount. Three item types render differently (belief_conflict → diff view; block_proposal → block preview + approve/reject; clarification_pending → read-only audit view). Uses existing permission gate for agency staff. (S7.) [Sonnet]
26. [ ] `server/routes/memoryReviewQueue.ts` — `GET /api/subaccounts/:id/memory-review-queue`, `POST /.../:itemId/approve`, `POST /.../:itemId/reject`. Approve for belief_conflict supersedes; for block_proposal activates (`status='active'`); for clarification_pending returns 400 (not resolvable here). (S7.) [Sonnet]
27. [ ] `server/services/memoryReviewQueueService.ts` — queue read + resolve logic; emits audit log on each resolution. (S7.) [Sonnet]
28. [ ] `server/services/trustCalibrationService.ts` (new) — trust-builds-over-time per §5.3: tracks approval rate per agent per domain; after N consecutive retrospectively-validated auto-applies, lowers that agent's auto-threshold by 0.05, floor 0.70. (S7.) [Opus] — feedback loop with invariant implications (threshold must not drop below floor; validated-not-overridden window is 30 days).
29. [ ] `server/services/__tests__/trustCalibrationServicePure.test.ts` — threshold-decrement math; floor enforcement; 30-day window edge cases. (S7.) [Sonnet]
30. [ ] `server/routes/api.ts` — add sidebar/nav route for the review queue page (org-level rollup view renders counts grouped by `subaccountId`). (S7.) [Sonnet]

**Phase-exit gate:**

- Lint / typecheck / tests green.
- Scripted run: create agent with no attachments; trigger run with task context mentioning domain X; verify relevance retrieval surfaces expected block; verify draft block with matching embedding is NOT surfaced.
- Scripted run: attach a draft block explicitly via direct DB write (bypassing route guard); verify `getBlocksForAgent()` still filters it out (defence-in-depth).
- Scripted run: fire blocking clarification from a skill; verify WebSocket delivery in < 30s; verify dependent downstream step waits; verify independent step proceeds. Let it time out; verify `completed_with_uncertainty` step status and `hadUncertainty=true` on run.
- Scripted run: complete 50 agent runs with seeded memory entries; verify `memory_citation_scores` rows present for all injected entries; verify `cited_entry_ids` populated.
- **Threshold-tuning pass:** export `memory_citation_scores` distribution; review with human; confirm defaults in `limits.ts` or adjust; document decision in `tasks/phase-2-threshold-calibration.md`. S4 quality-adjust job remains feature-flagged off until this completes.
- `pr-reviewer` + `dual-reviewer` pass for each Opus-flagged task (§CLAUDE.md).

---

### Phase 3 — Playbooks & onboarding

**Scoped items landing:** S18 (rename Intelligence Briefing), S19 (Weekly Digest playbook with stub memory-health section), S20 (default schedules), S5 (Configuration Assistant onboarding mode), S10 (chat-based task creation mode), S21 (Configuration Document workflow).

**Done when:**
- `daily-intelligence-brief` renamed to `intelligence-briefing` throughout repo, portal route updated (or 301-redirected), all seed data and fixtures reconciled.
- `weekly-digest.playbook.ts` runs end-to-end: gathers run logs + memory events + KPI data + stub memory-health section; drafts via LLM; delivers via `deliveryService`.
- Default schedules land via seed: Intelligence Briefing `FREQ=WEEKLY;BYDAY=MO` 07:00; Weekly Digest `FREQ=WEEKLY;BYDAY=FR` 17:00 in subaccount TZ.
- Configuration Assistant gains `subaccount-onboarding` mode and `task-creation` mode; both inherit the existing `config-agent-guidelines` memory block (shipped).
- Onboarding flow (live path) completes the 9-step arc end-to-end and reaches `ready` state only when the minimum viable set (Steps 1 + 6 + 7) is structurally satisfied per §8.2.
- Configuration Document generation produces DOCX (always) and Google Doc (if Google Workspace integration connected); upload pipeline parses → validates → confidence-gates → gap-analyses using the canonical `ParsedConfigField` shape per §9.4.

**Dependency ordering within Phase 3:**
1. S18 rename (tasks 1–6) lands first — other tasks reference `intelligence-briefing` slug.
2. S19 playbook (tasks 7–11) and S20 defaults (task 12) land before S5 onboarding — onboarding autostarts both playbooks at its Step 9.
3. S5 onboarding (tasks 13–22) and S10 task-creation (tasks 23–26) can proceed in parallel after the playbooks are available — both are Configuration Assistant modes, independent of each other.
4. S21 (tasks 27–35) depends on the `ConfigQuestion` interface (task 27) being shipped before any playbook can declare its schema.

**Ordered task list:**

1. [ ] `server/playbooks/intelligence-briefing.playbook.ts` — rename file from `daily-intelligence-brief.playbook.ts`; update internal `slug` to `intelligence-briefing`; user-facing label "Intelligence Briefing". (S18.) [Sonnet]
2. [ ] Global `rg 'daily-intelligence-brief|daily-brief'` sweep — resolve every non-comment reference: imports, seed data, test fixtures, migrations, documentation. (S18 migration checklist per spec §7.1.) [Sonnet]
3. [ ] `server/routes/portal.ts` — rename `/daily-brief-card` route to `/intelligence-briefing-card`; add 301 redirect from old path (tombstone for external callers). (S18.) [Sonnet]
4. [ ] Data migration (optional seq slot 0144) — update any existing `scheduled_tasks.playbookSlug = 'daily-intelligence-brief'` rows to the new slug. Idempotent. (S18.) [Sonnet]
5. [ ] `client/src/pages/**` UI label sweep — rename "Daily Intelligence Brief" strings to "Intelligence Briefing". (S18.) [Sonnet]
6. [ ] `server/playbooks/__tests__/intelligenceBriefingPlaybookTest.ts` — regression test: autostart on onboarding, delivery invocation, RRULE default. (S18.) [Sonnet]
7. [ ] `server/playbooks/weekly-digest.playbook.ts` — new file mirroring `intelligence-briefing.playbook.ts` structure. Steps: Gather (skill_call) → Draft (skill_call) → Deliver (action_call via `deliveryService`). `autoStartOnOnboarding: true`. Default RRULE `FREQ=WEEKLY;BYDAY=FR` 17:00. (S19.) [Sonnet]
8. [ ] `server/skills/weekly_digest_gather.md` + handler — aggregates past 7 days of: run logs, memory write events (new entries, beliefs updated, blocks created), KPI deltas, pending review queue items, memory health stub (coverage gaps `null` until S14 lands in Phase 4), next-week scheduled-task preview. (S19.) [Sonnet]
9. [ ] `server/skills/weekly_digest_draft.md` + handler — LLM drafts structured digest from gathered data per §7.2 six sections. Returns markdown + structured JSON (for portal rendering). (S19.) [Sonnet]
10. [ ] `server/playbooks/__tests__/weeklyDigestPlaybookTest.ts` — end-to-end test: seed 7-day window of events, run playbook, assert delivery + all 6 sections present (memory health section renders stub "coverage gaps will be computed from Phase 4"). (S19.) [Sonnet]
11. [ ] `server/services/playbookRegistryService.ts` — register `weekly-digest` playbook. Document the `autoStartOnOnboarding: true` contract. (S19.) [Sonnet]
12. [ ] `server/config/defaultSchedules.ts` (new) — central map of playbook slug → default RRULE + time. Read by onboarding Step 6/7 defaults. (S20.) [Sonnet]
13. [ ] `server/services/configAssistantModeService.ts` (new) — mode resolver for Configuration Assistant. Modes: `org-admin` (existing), `subaccount-onboarding` (new), `task-creation` (new). Loads the correct system-prompt template per mode; scopes toolset. (S5 + S10.) [Opus] — agent behaviour; reviewer verifies guidelines block still attaches in every mode.
14. [ ] `server/config/configAssistantPrompts/subaccountOnboardingPrompt.md` — system prompt for onboarding mode implementing the 9-step arc per §8.4. Explicitly references the already-shipped `config-agent-guidelines` block. (S5.) [Opus] — prompt engineering shapes outcomes; reviewer compares against the Three C's priority order.
15. [ ] `server/services/subaccountOnboardingService.ts` — orchestrates the 9-step arc. State reads/writes `subaccount_onboarding_state.resumeState` (Phase 1 column). Exposes: `startOnboarding`, `getNextStep`, `recordStepAnswer`, `markReady`. (S5.) [Opus] — coordinates multi-step workflow; reviewer verifies transactional consistency.
16. [ ] `server/services/subaccountOnboardingServicePure.ts` — implements the `markReady` guard: rejects transition without Steps 1 + 6 + 7 (identity + both playbooks) structurally satisfied per §8.2. Returns structured error listing missing steps. (S5 minimum-viable enforcement.) [Opus] — invariant enforcement.
17. [ ] `server/skills/smart_skip_from_website.md` + handler — given a website URL, scrapes and extracts draft brand voice / services / audience signals. Used in onboarding Steps 2–3 to pre-fill per §8.5. (S5.) [Sonnet]
18. [ ] `server/routes/onboarding.ts` — `POST /api/subaccounts/:id/onboarding/start`, `GET /.../next-step`, `POST /.../answer`, `POST /.../mark-ready`, `POST /.../generate-config-doc` (triggers §9 doc generation). (S5.) [Sonnet]
19. [ ] `client/src/pages/SubaccountOnboardingPage.tsx` — chat-style UI for the onboarding conversation. Uses existing `useSocket` for streaming. Renders DeliveryChannels component at Steps 6–7. Renders portal-mode explainer at Step 8. (S5.) [Sonnet]
20. [ ] `client/src/pages/SubaccountsPage.tsx` — "+ New Client" button routes to onboarding page instead of form modal. (S5.) [Sonnet]
21. [ ] `server/services/__tests__/subaccountOnboardingServicePure.test.ts` — `markReady` guard truth table; resume-from-step edge cases; smart-skip fulfilment recognition. (S5.) [Sonnet]
22. [ ] `server/services/__tests__/subaccountOnboardingServiceTest.ts` (integration) — end-to-end: start onboarding, walk 9 steps, assert both playbooks autostarted, portalMode persisted, subaccount transitions to `ready`. (S5.) [Sonnet]
23. [ ] `server/config/configAssistantPrompts/taskCreationPrompt.md` — system prompt for task-creation mode per §5.6. Parses NL → structured task config (agent, RRULE, instructions, KPIs). Calls existing `config_create_scheduled_task` tool. (S10.) [Opus] — prompt shapes RRULE accuracy; reviewer spot-checks edge cases ("every other Tuesday", "monthly on the 15th").
24. [ ] `client/src/pages/TaskCreationChatPage.tsx` (or embed as drawer on existing task list page) — chat UI that invokes Configuration Assistant in `task-creation` mode. Renders proposal review card on completion with DeliveryChannels component. (S10.) [Sonnet]
25. [ ] `server/services/configAssistantModeService.ts` — wire `task-creation` mode route; scope toolset to task-creation-relevant tools only. (S10.) [Sonnet]
26. [ ] `server/services/__tests__/taskCreationModeTest.ts` — NL → task config fixtures; DeliveryChannels config persisted to `scheduled_tasks.deliveryChannels`. (S10.) [Sonnet]
27. [ ] `server/types/configSchema.ts` (new) — exports `ConfigQuestion` interface and `ParsedConfigField` interface per §9.2 + §9.4 canonical shapes. This is the single source of truth for both schema declaration and parser output. (S21.) [Opus] — contract of record; reviewer verifies no downstream code uses non-canonical variants.
28. [ ] `server/playbooks/intelligence-briefing.schema.ts` (new) — declares the playbook's `ConfigQuestion[]`: schedule day, schedule time, DeliveryChannels, recipients. (S21.) [Sonnet]
29. [ ] `server/playbooks/weekly-digest.schema.ts` (new) — same pattern as (28) for Weekly Digest. (S21.) [Sonnet]
30. [ ] `server/services/configDocumentGeneratorService.ts` (new) — produces DOCX via `docx` npm package; Google Doc via existing Google Workspace integration client; Markdown for plain-text path. Aggregates schemas across a playbook bundle (reads `onboarding_bundle_configs`). Output per §9.3. (S21.) [Sonnet]
31. [ ] `server/services/configDocumentParserService.ts` (new) — the parser pipeline per §9.4. Extracts text (DOCX/PDF OCR/plain); calls LLM with schema + doc text; returns `ParsedConfigField[]` with confidence + optional sourceExcerpt; validates each field against schema constraints; confidence-gates at `PARSE_CONFIDENCE_THRESHOLD=0.7`; runs gap analysis. Single canonical shape throughout. (S21.) [Opus] — watchpoint + parser reliability; reviewer verifies no variant leakage.
32. [ ] `server/services/configDocumentParserServicePure.ts` — validation + gap-analysis logic; tested against a fixture set of clean / partial / malformed / off-template documents. (S21.) [Sonnet]
33. [ ] `server/routes/configDocuments.ts` — `POST /.../generate`, `POST /.../upload`, `GET /.../:id/status`, `GET /.../:id/gaps`. Wires into the onboarding drop-zone and the standalone upload path. (S21.) [Sonnet]
34. [ ] `client/src/pages/ConfigDocumentUploadPage.tsx` — drag-and-drop uploader; renders parse status + gap-list; low-confidence fields link back to onboarding conversation to complete. (S21.) [Sonnet]
35. [ ] `server/services/__tests__/configDocumentParserServicePure.test.ts` — canonical shape round-trip; confidence gating; gap identification; malformed input rejection path. (S21.) [Sonnet]

**Phase-exit gate:**

- Lint / typecheck / tests green.
- Scripted onboarding run: new subaccount, walk 9-step live path, verify `intelligence-briefing` + `weekly-digest` autostarted with correct RRULEs, portalMode persisted, minimum-viable guard enforced when attempting early `markReady`.
- Scripted doc round-trip: generate Configuration Document for onboarding bundle → fill with fixture answers → upload → verify all fields parsed at confidence ≥ 0.7 → verify auto-apply path completes without follow-up.
- Scripted gap path: upload partial document with 3 unanswered required fields → verify follow-up conversation loads those 3 questions only.
- Regression pass: existing intelligence-briefing tests still green after rename; portal `/intelligence-briefing-card` renders correctly; `/daily-brief-card` 301-redirects.
- `pr-reviewer` + `dual-reviewer` pass for each Opus-flagged task.

---

### Phase 4 — Portal & rollups

**Scoped items landing:** S16 (portal toggle UI), S17 (per-feature gating UI), S23 (portfolio rollup briefings/digests), S14 (memory health data populates Phase 3 stub), S9 (drop zone with multi-destination filing), S11 (auto-synthesised blocks), S13 (natural-language memory inspector).

**Done when:**
- Subaccount settings page has a Portal Mode selector (Hidden / Transparency / Collaborative) and a Features toggle grid shown when mode is Collaborative; server enforces every gate via `canRenderPortalFeature()` (Phase 1 helper) with `portalFeatures` jsonb reads live.
- Portfolio Briefing and Portfolio Digest generate exactly one inbox item per week each at the org subaccount, drilling through to individual artefacts.
- Weekly Digest's memory health section (Section 5) now renders real data from `memoryHealthDataService` — replaces the Phase 3 stub.
- Drop zone accepts uploads (agency + client portal paths), proposes multi-destination checkboxes with confidence scores, files in one transaction, and writes a `drop_zone_upload_audit` row per upload with required indexes per §5.5.
- Weekly `memory-block-synthesis` job runs, clusters high-quality entries, proposes candidate blocks, routes per confidence tier (S7), and passive-ages drafts to `active` after 2 cycles without rejection.
- Natural-language memory inspector answers "why did the agent do X?" for any run via chat UI, with tier-appropriate filtering for client portal.

**Dependency ordering within Phase 4:**
1. Migrations 0132 (`portalFeatures`), 0133 (`clientUploadTrustState`), 0141 (`drop_zone_upload_audit`) land first — all have downstream UI + service dependencies.
2. S14 memory-health data (tasks 12–14) lands before the Weekly Digest gather skill is updated to consume real data (task 15) — ordering matters because the digest must not crash on missing data if the order flips.
3. S11 auto-synthesis (tasks 20–23) and S7 queue routing (Phase 2 task 25) must both be live — S11 writes block proposals into the queue.
4. S23 portfolio rollups (tasks 24–28) depend on individual briefings + digests having completed state — requires Phase 3 delivery service + Phase 4 memory health data.

**Ordered task list:**

1. [ ] `migrations/0132_subaccounts_portal_features.sql` — `portal_features jsonb NOT NULL DEFAULT '{}'::jsonb`. (S17.) [Sonnet]
2. [ ] `server/db/schema/subaccounts.ts` — add `portalFeatures` jsonb column with typed shape `{ dropZone?: boolean; clarificationRouting?: boolean; taskRequests?: boolean; memoryInspector?: boolean; healthDigest?: boolean }`. (S17.) [Sonnet]
3. [ ] `migrations/0133_subaccounts_client_upload_trust_state.sql` — `client_upload_trust_state jsonb` with default shape per §5.5. (S9.) [Sonnet]
4. [ ] `server/db/schema/subaccounts.ts` — add `clientUploadTrustState` typed jsonb column. (S9.) [Sonnet]
5. [ ] `migrations/0141_drop_zone_upload_audit.sql` — new table per §5.5 with three required indexes. Append-only; no `deletedAt`. (S9.) [Sonnet]
6. [ ] `server/db/schema/dropZoneUploadAudit.ts` — Drizzle schema; register in `schema/index.ts` and `rlsProtectedTables.ts`. (S9.) [Sonnet]
7. [ ] `client/src/pages/SubaccountSettingsPage.tsx` — add Portal Mode selector + Features toggle grid (conditional on Collaborative mode). Calls existing subaccount update route. (S16 + S17.) [Sonnet]
8. [ ] `server/routes/subaccounts.ts` — add `PATCH /api/subaccounts/:id/portal` endpoint accepting `{ portalMode, portalFeatures }`. Validates mode enum; validates feature keys against `portalFeatureRegistry`. (S16 + S17.) [Sonnet]
9. [ ] `server/services/portalConfigService.ts` (new) — portal-mode + portalFeatures update logic; emits audit log on change; re-publishes portal feature list over WebSocket to any active client-portal sessions so they respond live. (S16 + S17.) [Sonnet]
10. [ ] `server/lib/portalGate.ts` — update `canRenderPortalFeature()` to read the live `portalFeatures` jsonb column (Phase 1 shipped the helper against an empty map fallback; this phase wires the real read). (S17.) [Opus] — security-critical gate; reviewer verifies no bypass path and 403 correctness.
11. [ ] `server/services/__tests__/portalConfigServiceTest.ts` — mode transitions; feature toggle grid permutations; WebSocket re-publish on change. (S16 + S17.) [Sonnet]
12. [ ] `server/services/memoryHealthDataService.ts` (new) — gathers S14 metrics per §5.10: new entries captured (count + top 3 by quality), conflicts auto-resolved, entries pruned, beliefs updated (with uncertain flags), block proposals pending, coverage gaps ("no memories about [topic] despite N recent tasks"). Exposes `getMemoryHealthForSubaccount(subaccountId, windowDays)`. (S14.) [Sonnet]
13. [ ] `server/services/memoryHealthDataServicePure.ts` — coverage-gap detection heuristic; top-N entry ranking; unit-tested. (S14.) [Sonnet]
14. [ ] `server/services/__tests__/memoryHealthDataServiceTest.ts` — integration: seed entries + run logs + reviews; verify gathered shape matches §5.10 spec. (S14.) [Sonnet]
15. [ ] `server/skills/weekly_digest_gather.md` handler — replace the Phase 3 stub memory-health payload with live data from `memoryHealthDataService`. Keep the Section-5 output shape stable. (S14 → completes S19.) [Sonnet]
16. [ ] `server/services/dropZoneService.ts` (new) — upload pipeline per §5.5: text extraction (DOCX / PDF OCR / plain), summarisation, destination proposal (scores via embedding similarity to candidate blocks + task contexts), trust-gate check (`clientUploadTrustState` for portal uploads), single-transaction file-to-all-destinations, audit-log write. (S9.) [Opus] — complex workflow with integrity + security implications; reviewer verifies transactional guarantee and audit row never missed.
17. [ ] `server/routes/dropZone.ts` — `POST /api/subaccounts/:id/drop-zone/upload`, `GET /.../proposals/:uploadId`, `POST /.../proposals/:uploadId/confirm`. Portal path goes through a separate permission guard that checks `canRenderPortalFeature(id, 'dropZone')`. (S9.) [Sonnet]
18. [ ] `client/src/components/DropZone.tsx` — drag-and-drop surface; renders proposal checkboxes with confidence scores per §5.5 (pre-ticked >0.8, shown 0.5–0.8, hidden <0.5 behind "Show more"). Free-form custom destination entry. (S9.) [Sonnet]
19. [ ] `client/src/pages/ClientPortalPage.tsx` — conditionally renders `DropZone` when `portalMode === 'collaborative'` AND `portalFeatures.dropZone !== false`. Trust-gate messaging surfaces approval-required state for first-5 uploads. (S9 + S17.) [Sonnet]
20. [ ] `server/services/memoryBlockSynthesisService.ts` (new) — weekly per-subaccount job orchestration per §5.7: scans `qualityScore > 0.7, citedCount > 2` entries; agglomerative clustering at threshold 0.82; LLM summarises clusters with ≥ 5 entries into candidate blocks; scores candidate confidence; routes via S7 tiers. (S11.) [Opus] — feedback loop into review queue; reviewer verifies draft → active transitions respect §5.2 status invariant and passive-ageing is correct.
21. [ ] `server/services/memoryBlockSynthesisServicePure.ts` — clustering math; candidate-confidence formula; passive-ageing decision (2-cycle survival). (S11.) [Sonnet]
22. [ ] `server/jobs/memoryBlockSynthesisJob.ts` — pg-boss weekly job per subaccount; calls service; logs cluster + proposal metrics. (S11.) [Sonnet]
23. [ ] `server/services/__tests__/memoryBlockSynthesisServicePure.test.ts` — clustering thresholds; passive-age after 2 cycles; confidence scoring edge cases. (S11.) [Sonnet]
24. [ ] `server/services/portfolioRollupService.ts` (new) — aggregates completed briefings + digests across an org's subaccounts; LLM drafts rollup artefact per §11.3/§11.4; delivers via `deliveryService.deliver(artefact, deliveryConfig, orgSubaccountId)` (reads persisted config from the org subaccount). (S23.) [Opus] — cross-tenant aggregation; reviewer verifies subaccount isolation (no client data leakage between orgs) and drill-through link correctness.
25. [ ] `server/jobs/portfolioRollupJob.ts` — pg-boss scheduled job; runs Mon 08:00 (portfolio briefing) and Fri 18:00 (portfolio digest) by default per §11.7 — 1 hour after individual defaults for completion. (S23.) [Sonnet]
26. [ ] `server/services/__tests__/portfolioRollupServicePure.test.ts` — aggregation math; auto-enable threshold (>= 3 subaccounts) per §11.5; drill-through link generation. (S23.) [Sonnet]
27. [ ] `client/src/pages/OrgSettingsPage.tsx` (or existing org settings) — portfolio rollup settings: opt-in/out (default opt-in at ≥ 3 subaccounts), DeliveryChannels config. (S23.) [Sonnet]
28. [ ] `server/routes/portfolioRollup.ts` — `GET /api/organisations/:id/portfolio-rollup/settings`, `PATCH /.../settings`. Persists DeliveryChannels to the org subaccount row. (S23.) [Sonnet]
29. [ ] `server/services/memoryInspectorService.ts` (new) — natural-language inspector per §5.9: parses question scope (run-specific / memory-specific); retrieves relevant run context, injected memories, tool calls; LLM explains in plain English with citations. Tier-aware response filter strips internal operational details for client portal. (S13.) [Opus] — surface for support + client-facing; reviewer verifies no PII / internal detail leakage through the tier filter.
30. [ ] `server/routes/memoryInspector.ts` — `POST /api/subaccounts/:id/memory-inspector/ask`; returns streaming LLM response over WebSocket. Permission gate: agency staff always; client portal if `canRenderPortalFeature(id, 'memoryInspector')`. (S13.) [Sonnet]
31. [ ] `client/src/components/MemoryInspectorChat.tsx` — embeds in subaccount dashboard; renders in client portal when gate allows. (S13.) [Sonnet]
32. [ ] `server/services/__tests__/memoryInspectorServiceTest.ts` — tier-filter truth table: internal query rendered fully for agency, filtered for client portal. (S13.) [Sonnet]

**Phase-exit gate:**

- Lint / typecheck / tests green.
- Scripted portal walkthrough: toggle mode Hidden → Transparency → Collaborative; verify UI surfaces appear/disappear client-side and server returns 403 for disabled features regardless of client-side state.
- Scripted drop zone: upload document via agency path; verify proposals with confidence scores; confirm selection; verify all destinations filed in single transaction; verify `drop_zone_upload_audit` row with index-eligible columns populated.
- Scripted trust progression: upload 5 documents via client portal path, each approved by agency; verify 6th upload auto-files with notification and audit row shows `requiredApproval=false`.
- Scripted portfolio test: seed 10 subaccounts with completed briefings; run portfolio rollup job; verify exactly one inbox item in org subaccount; verify drill-through links reach individual artefacts.
- Scripted synthesis test: seed clustered high-quality entries; run synthesis job; verify candidate block lands in review queue at `status='draft'`; roll forward 2 weeks without rejection; verify block transitions to `status='active'` via passive aging.
- Scripted inspector test: run an agent task end-to-end; ask "why did the agent do X?" in inspector; verify response cites the injected memories and tool calls used.
- `pr-reviewer` + `dual-reviewer` pass for each Opus-flagged task.

---

### Phase 5 — Governance

**Scoped items landing:** S24 (memory block governance affordances — version history, diff vs canonical, reset-to-canonical). The protection layer (allowlist, route guards, idempotent seeding, divergence-logging) is already shipped in the `config-agent-guidelines` branch — this phase adds the UI affordances that make human operation of protected blocks comfortable.

**Done when:**
- Memory block detail page shows a version history list (most recent first) and a diff view comparing any two versions.
- When viewing a protected block, a "Diff vs canonical" tab shows the current DB state against the canonical file at `docs/agents/*.md`.
- When runtime diverges from canonical, the block view surfaces a warning banner with a "Reset to canonical" button that re-seeds from the canonical file (logged; recoverable).
- All changes are audit-logged with actor + timestamp + before/after.

**Dependency ordering within Phase 5:** Governance table migration (task 1) lands first; everything else reads from it.

**Ordered task list:**

1. [ ] `migrations/0144_memory_block_versions.sql` — new table `memory_block_versions`. Columns: `id uuid PK`, `memoryBlockId uuid NOT NULL FK ON DELETE CASCADE`, `content text NOT NULL`, `version int NOT NULL` (monotonically incremented per block), `createdAt timestamptz NOT NULL DEFAULT now()`, `createdByUserId uuid` (nullable — null for seed events), `changeSource text NOT NULL` (enum: `manual_edit | seed | reset_to_canonical | auto_synthesis`), `notes text` (nullable). Index: `(memoryBlockId, version DESC)`. (S24.) [Sonnet]
2. [ ] `server/db/schema/memoryBlockVersions.ts` — Drizzle schema + register in `schema/index.ts` and `rlsProtectedTables.ts`. (S24.) [Sonnet]
3. [ ] `server/services/memoryBlockService.ts` — modify every content-mutation path (manual edit, seed, reset, synthesis activation) to write a `memory_block_versions` row in the same transaction. Idempotent — duplicate consecutive versions coalesce. (S24.) [Opus] — invariant enforcement across multiple write paths; reviewer verifies no path skips version write.
4. [ ] `server/services/memoryBlockVersionService.ts` (new) — exposes `listVersions(blockId)`, `diffVersions(blockId, fromVersion, toVersion)`, `diffAgainstCanonical(blockId)` (reads canonical file for protected blocks), `resetToCanonical(blockId, actorUserId)`. (S24.) [Sonnet]
5. [ ] `server/routes/memoryBlocks.ts` — add `GET /.../:blockId/versions`, `GET /.../:blockId/versions/:v1/diff/:v2`, `GET /.../:blockId/diff-canonical`, `POST /.../:blockId/reset-canonical`. Reset endpoint requires agency-admin permission; protected blocks require org-admin. (S24.) [Sonnet]
6. [ ] `client/src/pages/MemoryBlockDetailPage.tsx` — add Version History tab (list view), Diff viewer (side-by-side), Diff-vs-Canonical tab for protected blocks. Reset button surfaces confirmation modal before calling reset endpoint. (S24.) [Sonnet]
7. [ ] `server/services/protectedBlockDivergenceService.ts` — background job (daily) that checks every protected block against its canonical file; writes a divergence flag on the block row (new nullable column `divergenceDetectedAt timestamptz`) so the UI banner can render without a round-trip file read. (S24.) [Sonnet]
8. [ ] `migrations/0145_memory_blocks_divergence_flag.sql` — `divergence_detected_at timestamptz` nullable column on `memory_blocks`. (S24.) [Sonnet]
9. [ ] `server/services/__tests__/memoryBlockVersionServicePure.test.ts` — version sequence; diff correctness; canonical-diff for a known protected block. (S24.) [Sonnet]
10. [ ] `server/services/__tests__/memoryBlockServiceTest.ts` (integration) — verify every content mutation path creates a version row; verify reset-to-canonical restores the block to canonical content and writes a version with `changeSource='reset_to_canonical'`. (S24.) [Sonnet]

**Phase-exit gate:**

- Lint / typecheck / tests green.
- Scripted walkthrough: edit `config-agent-guidelines` block via UI; verify version history shows new version with `changeSource='manual_edit'`; verify "Diff vs canonical" tab shows the divergence; click "Reset to canonical"; verify block content restored and a new version row created with `changeSource='reset_to_canonical'`.
- Divergence detection job test: seed a protected block with divergent content; run the daily job; verify `divergenceDetectedAt` populated; verify UI banner renders on next load.
- `pr-reviewer` + `dual-reviewer` pass for each Opus-flagged task.

---

## Artifact 3 — Acceptance-test matrix

One row per F1–F12 and NF1–NF6 criterion from §12 of the spec. Test file paths follow the CLAUDE.md "Key files per domain" conventions: pure tests as `*Pure.test.ts` (no DB / no network), integration tests as `*Test.ts` in `server/services/__tests__/`, client tests colocated under `client/src/**/__tests__/`, scripted scenarios under `scripts/acceptance/`.

Every row lists: **verification type** (unit / integration / load / scripted), **test file path**, **preconditions**, **happy-path steps**, **at least one edge case**.

### Functional — F1 through F4

| ID | Criterion | Type | Test file | Preconditions | Happy-path steps | Edge case |
|---|---|---|---|---|---|---|
| **F1** | New subaccount onboarded via live conversation in < 10 min | Scripted | `scripts/acceptance/f1-onboarding-live.ts` | Seeded org subaccount, mocked Google Workspace integration, Configuration Agent guidelines block attached (shipped in previous branch). | (1) Trigger onboarding start via `POST /api/subaccounts/:id/onboarding/start`. (2) Walk all 9 steps via `POST /.../answer` with realistic fixture answers. (3) At Step 9, assert `markReady` succeeds. (4) Assert: subaccount in `ready`, both playbooks have scheduled-task rows with correct RRULEs, all drafted blocks persisted, `portalMode` set, elapsed wall-time < 10 min. | Agency skips Steps 2–5 and 8; assert `markReady` still succeeds (§8.2 minimum: 1 + 6 + 7). Then repeat skipping Step 6; assert `markReady` rejects with structured error listing missing step. |
| **F2** | Async Configuration Document round-trip onboards subaccount | Scripted | `scripts/acceptance/f2-onboarding-async.ts` | As F1 plus fixture DOCX `docs/fixtures/onboarding-filled.docx` (all required fields present, confidence ≥ 0.7). | (1) `POST /.../onboarding/generate-config-doc` returns DOCX. (2) Upload fixture DOCX via `POST /api/config-documents/upload`. (3) Poll `GET /.../status` until parsed. (4) Assert all `ParsedConfigField` confidences ≥ 0.7; auto-apply completes; subaccount in `ready`; both playbooks autostarted. | Upload a partial DOCX missing Weekly Digest fields; assert follow-up conversation loads only those fields; complete via live path; assert `markReady` succeeds. Also: upload an unrecognisable DOCX (blank template); assert rejection with parseable error per §9.4 outcome routing. |
| **F3** | Intelligence Briefing lands in inbox at configured time | Integration | `server/services/__tests__/intelligenceBriefingDeliveryTest.ts` | Subaccount with `intelligence-briefing` scheduled task RRULE `FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0`; timezone `Europe/London`. | (1) Advance mocked clock to Monday 07:00 London time. (2) Assert scheduled-task-runner fires the playbook. (3) Assert Gather → Draft → Deliver steps complete. (4) Assert inbox row present in subaccount inbox; delivery log has `email` + `portal` entries per DeliveryChannels config. | Subaccount timezone set to `America/Los_Angeles`; assert delivery fires at Mon 07:00 Pacific, not UTC. Second edge: delivery channel `slack` is configured but Slack integration is disconnected; assert email still delivered and Slack logged as skipped, not errored. |
| **F4** | Weekly Digest lands in inbox at configured time | Integration | `server/services/__tests__/weeklyDigestDeliveryTest.ts` | Subaccount with `weekly-digest` scheduled task at Fri 17:00; run logs + memory events seeded for the past 7 days. | (1) Advance clock to Fri 17:00. (2) Assert playbook runs. (3) Assert digest contains all 6 sections per §7.2 (work completed, what system learned, KPI movement, items pending, memory health, next-week preview). (4) Memory health section renders real data post-Phase-4 (or stub pre-Phase-4 — both cases asserted with a phase-gated fixture). | No activity in the past 7 days; assert digest still delivers with a "Quiet week — nothing to report" summary. Second edge: `memory_review_queue` has 10+ pending items; assert Section 4 (Items pending) lists them with priority ordering. |

### Functional — F5 through F8

| ID | Criterion | Type | Test file | Preconditions | Happy-path steps | Edge case |
|---|---|---|---|---|---|---|
| **F5** | Portfolio Briefing and Digest each produce exactly ONE inbox item in the org subaccount inbox (not N × 2) | Scripted | `scripts/acceptance/f5-portfolio-rollup.ts` | Org with 10+ subaccounts, each with completed individual intelligence briefings and weekly digests for the current week. Org subaccount exists and is auto-enabled for portfolio rollup (count ≥ 3 per §11.5). | (1) Advance clock to Mon 08:00 (Portfolio Briefing default). (2) Assert `portfolio-rollup` job runs. (3) Assert exactly ONE inbox row in the org subaccount's inbox with artefact type `portfolio-briefing`. (4) Assert drill-through links to each of the 10 individual briefings. (5) Repeat for Fri 18:00 / Portfolio Digest. | Run with exactly 2 subaccounts (below auto-enable threshold); assert portfolio rollup does NOT run unless org explicitly opted in. Second edge: 3 of 10 individual briefings failed this week; assert portfolio rollup still runs with remaining 7 and lists failed ones under "Items pending". |
| **F6** | Document drop zone proposes multi-destination checkboxes with confidence scores | Integration | `server/services/__tests__/dropZoneServiceTest.ts` | Subaccount with seeded memory blocks + active tasks; fixture document `docs/fixtures/drop-zone-brand-voice.pdf` with clear brand-voice content. | (1) Upload fixture via `POST /api/subaccounts/:id/drop-zone/upload`. (2) `GET /.../proposals/:uploadId` returns proposal payload. (3) Assert at least one destination with confidence > 0.8 (pre-ticked); one destination 0.5–0.8 (shown unticked); destinations < 0.5 hidden (under `moreDestinations` key). (4) `POST /.../proposals/:uploadId/confirm` with selected destinations applies all in one transaction. (5) Assert `drop_zone_upload_audit` row with `proposedDestinations`, `selectedDestinations`, `appliedDestinations` populated. | Upload a document that matches 5 destinations with confidence > 0.8 (all pre-ticked); user unticks 3; assert only 2 destinations filed and `selectedDestinations` reflects the delta. Second edge: user adds a custom destination not in the proposals; assert custom destination filed and recorded in `selectedDestinations` with flag `userAdded: true`. |
| **F7** | Real-time clarification reaches the correct recipient within 30 seconds | Integration | `server/services/__tests__/clarificationRoutingTest.ts` | Agent run in progress; subaccount manager online via WebSocket; `clarificationRoutingConfig` null (fallback chain). | (1) Agent calls `request_clarification` with `urgency: 'blocking'`. (2) Assert WebSocket event reaches subaccount manager's session within 30s of the tool call. (3) Assert paused step transitions to `waiting_on_clarification`; run `hadUncertainty` still `false`. (4) Subaccount manager replies; assert run resumes within 10s; step transitions to `completed` and run completes normally. | Subaccount manager is offline; `urgency: 'blocking'`; assert escalation to agency owner per §5.4 fallback chain. Second edge: portal mode is Collaborative and the question is client-domain (topic in `clientDomainTopics` array); assert route to client contact via portal notification, not agency staff. |
| **F8** | Confidence-tiered HITL auto-applies high-confidence items and queues medium | Scripted | `scripts/acceptance/f8-hitl-tiered.ts` | Subaccount with empty `memory_review_queue`; agent with domain reputation > N consecutive validated auto-applies. | (1) Generate a high-confidence (0.92) belief supersession; assert superseded immediately without queue entry; digest log records it. (2) Generate a medium-confidence (0.74) block proposal; assert queue row `itemType='block_proposal'`, `status='pending'`; block `status='draft'`; not surfaced in retrieval. (3) Generate a low-confidence (0.5) signal; assert discarded; no queue row; no block created. (4) Approve N more high-confidence items without any retrospective override; assert the agent's auto-threshold decreases from 0.85 → 0.80 in `trustCalibrationService`. | Approve a high-confidence belief, then override it within 30 days (retrospective rejection); assert trust counter resets for that agent+domain; auto-threshold does NOT decrease. Second edge: threshold already at floor 0.70; further approvals should not push it below floor. |

### Functional — F9 through F12

| ID | Criterion | Type | Test file | Preconditions | Happy-path steps | Edge case |
|---|---|---|---|---|---|---|
| **F9** | Memory entries decay over time and pruned entries no longer appear in retrieval | Integration | `server/services/__tests__/memoryEntryDecayTest.ts` | Subaccount with 200 seeded entries; staggered `lastAccessedAt` (100 fresh, 50 aged ~100 days, 50 aged ~200 days with `qualityScore ≤ 0.15`). | (1) Run `memory-entry-decay` job. (2) Assert fresh entries unchanged. (3) Assert 100-day-aged entries had `qualityScore` reduced per `DECAY_RATE`. (4) Assert 200-day low-quality entries soft-deleted (`deletedAt` set). (5) Query retrieval for a task context matching the pruned entries; assert zero returned. (6) If > `REINDEX_THRESHOLD` pruned, assert `memory-hnsw-reindex` one-shot enqueued. | Entry with high `citedCount` (> 10) and low `qualityScore` (below prune floor); assert exempt from pruning per §13 risk-mitigation note. Second edge: decay pass reduces entry to exactly `0.1` floor; assert it does NOT go below floor; next pass does not re-reduce (idempotent on already-floored rows). |
| **F10** | Self-tuning retrieval adjusts quality scores based on citation data | Integration | `server/services/__tests__/memoryEntryQualityAdjustTest.ts` | Subaccount with 50 entries; seeded `memory_citation_scores` over the past rolling window: 20 entries with `utilityRate > 0.5`, 15 entries with `utilityRate < 0.1` over 10+ injections, 15 never injected. Feature flag `S4_QUALITY_ADJUST_LIVE` set to true. | (1) Run `memoryEntryQualityAdjustJob`. (2) Assert high-utility entries boosted (score increased, capped at 1.0). (3) Assert low-utility entries reduced. (4) Assert never-injected entries unchanged. (5) Grep-based architectural test: assert no other service mutated `qualityScore` during the test run (single-writer invariant). | Feature flag `S4_QUALITY_ADJUST_LIVE=false`; assert job runs but makes no writes — logs "flagged off" and exits. Second edge: one of the seeded entries hit `qualityScore=1.0` ceiling; assert further positive adjustments are no-ops. |
| **F11** | Client portal respects mode toggles + per-feature gating | Integration + scripted | `server/lib/__tests__/portalGateTest.ts` + `scripts/acceptance/f11-portal-walkthrough.ts` | Subaccount with a client-portal user role; portal feature registry seeded. | (1) `portalMode='hidden'`: assert client sees no portal (`GET /api/portal/...` returns 403 or 404 per route). (2) `portalMode='transparency'`: assert read-only surfaces visible; interaction endpoints 403. (3) `portalMode='collaborative'`: assert all surfaces visible and interactive. (4) Toggle `portalFeatures.dropZone=false`; assert drop zone hidden client-side AND server returns 403 for `POST /.../drop-zone/upload` regardless of client state. | Cycle `portalMode` rapidly (Hidden → Collaborative → Transparency → Collaborative) via `PATCH`; assert WebSocket publishes feature list on each change and client-portal UI reflects within 2s. Second edge: feature registry declares `memoryInspector` requires `collaborative`; set `portalMode='transparency'` with `portalFeatures.memoryInspector=true`; assert the static tier floor overrides the runtime flag — inspector still hidden and API still 403s. |
| **F12** | DeliveryChannels component renders conditionally based on connected integrations | Component | `client/src/components/__tests__/DeliveryChannels.test.tsx` | Subaccount with Email (always), Slack connected, Teams not connected. | (1) Render `<DeliveryChannels>`. (2) Assert Email row shown, ticked by default. (3) Assert Slack row shown, unticked, with channel picker dropdown populated from connected workspace. (4) Assert Teams row NOT shown (integration not connected — no greyed-out placeholder per §10.2). (5) Connect Teams via test fixture; assert Teams row appears without remount. (6) Disconnect Slack; assert Slack row disappears. | `portalMode='hidden'`; assert Portal row NOT shown. Change to `portalMode='transparency'`; assert Portal row appears. Second edge: Email integration is the ONLY connected channel; component still renders for recipient configuration with minimal footprint (no empty-state crash). |

### Non-functional — NF1 through NF3

| ID | Criterion | Type | Test file | Preconditions | Happy-path steps | Edge case |
|---|---|---|---|---|---|---|
| **NF1** | Memory decay + pruning job completes in < 60s for 10,000 entries | Load | `scripts/load/nf1-decay-load.ts` | Seed subaccount with 10,000 `workspace_memory_entries` at varied `lastAccessedAt` and `qualityScore`. Run on prod-equivalent DB instance. | (1) Record start time. (2) Trigger `memory-entry-decay` job for the subaccount. (3) Await completion. (4) Assert `elapsedMs < 60_000`. (5) Record metrics: decayed count, pruned count, reindex-triggered flag. | Seed 10,000 entries where half would be pruned in a single pass; assert the soft-delete batch + audit-log write do not push past the 60s budget. Second edge: run the job concurrently on 10 subaccounts; assert no per-run regression > 20% vs single-subaccount run. |
| **NF2** | Retrieval latency (embedding + hybrid search + rerank) < 500ms p95 | Load | `scripts/load/nf2-retrieval-latency.ts` | Seed subaccount with 50,000 `workspace_memory_entries` and 2,000 `memory_blocks`, all with embeddings. HNSW indexes warm. Prod-equivalent DB. | (1) Issue 1,000 `getMemoryForPrompt()` calls with varied task contexts. (2) Record per-call latency. (3) Assert p95 < 500ms end-to-end (embedding + hybrid + RRF + optional rerank). (4) Break down: embedding call p95, vector query p95, keyword query p95, RRF fusion p95 — surface each so regressions are debuggable. | Cold start: restart the DB container (cold cache); assert p95 after first 100 calls still < 500ms. Second edge: the external reranker is enabled and times out on 5% of calls; assert fallback to non-reranked ordering without exceeding the 500ms budget. |
| **NF3** | Configuration Document generation (DOCX) < 5s | Integration | `server/services/__tests__/configDocumentGeneratorPerfTest.ts` | Seeded onboarding bundle with 2 playbooks declaring 20 `ConfigQuestion` entries total. | (1) Call `configDocumentGeneratorService.generateDocx(bundleId, subaccountId)`. (2) Measure wall time. (3) Assert `elapsedMs < 5_000`. (4) Assert generated DOCX is valid (opens cleanly in `docx` parser round-trip). | Bundle grows to 10 playbooks / 100 questions; assert generation still < 5s (scales roughly linearly). Second edge: Google Workspace integration connected and Google Doc output requested; assert p95 < 8s (additional network call — documented as separate budget). |

### Non-functional — NF4 through NF6

| ID | Criterion | Type | Test file | Preconditions | Happy-path steps | Edge case |
|---|---|---|---|---|---|---|
| **NF4** | Configuration Document upload processing < 30s | Integration | `server/services/__tests__/configDocumentParserPerfTest.ts` | 5-page filled DOCX fixture with 20 answered fields. | (1) `POST /.../upload` with the fixture. (2) Poll `GET /.../status` until `parsed`. (3) Measure wall time from upload to parsed. (4) Assert `elapsedMs < 30_000`. (5) Assert all `ParsedConfigField` records returned with confidence scores. | 15-page scanned PDF (OCR path); assert p95 < 60s (OCR has its own budget documented as a separate NF — for now surface as a warning, not a failure). Second edge: document contains garbage between answers; assert parse completes within budget and low-confidence fields surface in gap analysis. |
| **NF5** | Portfolio rollup generation < 30s for 200 subaccounts | Load | `scripts/load/nf5-portfolio-rollup-load.ts` | Org with 200 subaccounts, each with a completed Intelligence Briefing for the current week. | (1) Trigger `portfolio-rollup` job manually. (2) Measure wall time from job-start to inbox row written. (3) Assert `elapsedMs < 30_000`. (4) Assert exactly one inbox row in org subaccount inbox. (5) Assert drill-through links to all 200 individual briefings present. | 500 subaccounts (stress test beyond target); measure elapsed — not required to meet 30s but target sublinear scaling with subaccount count (< 75s for 500). Second edge: 10% of individual briefings failed this week; assert rollup still completes within budget and excludes failed items cleanly. |
| **NF6** | Zero human involvement required for standard weekly operation (briefing + digest + memory maintenance) | Scripted | `scripts/acceptance/nf6-four-week-scenario.ts` | Mocked-time environment with 1 subaccount fully onboarded; seeded agent + 5 active tasks; RRULEs firing on mocked clock. See detailed scenario below. | See "NF6 scripted scenario" below this table. | Inject a transient failure in Week 2 (e.g., pg-boss job worker dies mid-run); assert recovery on restart without human intervention; Week 3 and Week 4 still hit zero unscheduled interventions. |

#### NF6 scripted scenario — the 4-week zero-human-involvement run

A single deterministic script drives mocked time forward across 4 weeks. Every tick advances the clock; at each RRULE-due event the corresponding job fires against the live DB. **Target: zero operations in this scenario require unscheduled human intervention.**

**Baseline seed (t = 0, "Sunday before Week 1"):**

1. One org with one subaccount. Subaccount onboarded end-to-end (F1 path). Both playbooks autostarted with default RRULEs (Mon 07:00 Briefing, Fri 17:00 Digest).
2. One agent with a moderate reputation history — auto-threshold currently 0.80 (below the 0.85 starting default, simulating some trust-builds-over-time progress).
3. Five active `scheduled_tasks` with weekday RRULEs, each with DeliveryChannels configured.
4. Seeded memory state: 200 `workspace_memory_entries` across domains; 3 active `memory_blocks`; empty `memory_review_queue`; empty `agent_beliefs` conflict state.

**Week 1 — Establish baseline.**

| Day | Mocked events | Assertions |
|---|---|---|
| Mon 07:00 | Intelligence Briefing playbook fires. | One inbox row, one email sent, delivery log clean. |
| Mon–Fri | Five `scheduled_tasks` fire once each on their weekday slots. Each run produces 2–4 new memory entries. | 10–20 new entries written via `memoryWriteService`; `memory_citation_scores` populated for each run via `memoryCitationDetector`; no review-queue entries because all confidence scores are in the auto-apply band. |
| Fri 17:00 | Weekly Digest fires. | Inbox row + email; 6 sections populated; memory-health section reflects Week 1 deltas. |
| Sat | Nightly `memory-entry-decay` job (already running daily across the week) — on this tick, assert idempotency: no entries are newly pruned because none have aged past `PRUNE_AGE_DAYS`. | Decay-pass logs zero pruned; no reindex enqueued. |

**Week 2 — Inject low-effort signals.**

| Day | Mocked events | Assertions |
|---|---|---|
| Mon 07:00 | Briefing fires. | Standard delivery. |
| Tue | One task run produces a belief with `confidence=0.92` that contradicts an existing belief. | `beliefConflictService` auto-supersedes (gap > 0.2); no queue entry; audit log records action. |
| Wed | One task run produces a block proposal candidate at `confidence=0.78` (medium tier). | `memory_review_queue` row `itemType='block_proposal'`, `status='pending'`; block `status='draft'`, not surfaced in retrieval. **Queue entry exists but takes no human action — digest will surface it Friday.** |
| Thu | Inject a transient failure: kill the pg-boss worker mid-run. On restart (automated), the run is retried and completes. | Run retried successfully; no stuck rows; no alert escalation. |
| Fri 17:00 | Digest fires. | "Items pending" section lists the Wed block proposal. Digest is delivered — human reads it but takes no action (the queue entry sits, awaiting passive ageing). |

**Week 3 — Passive ageing kicks in.**

| Day | Mocked events | Assertions |
|---|---|---|
| Mon 07:00 | Briefing fires. | Standard. |
| Mon–Fri | Normal task runs; no new contradictions, no new block proposals. | Memory entries grow; citation scores accumulate for S4 windowing. |
| Wed | Weekly `memory-block-synthesis` job fires. | The Wed-Week-2 draft block has survived one synthesis cycle without rejection; counter incremented. Still `status='draft'`. One additional new candidate is synthesised at high confidence (0.91) — auto-creates as draft, enters passive-ageing clock. |
| Fri 17:00 | Digest fires; Weekly `memoryEntryQualityAdjustJob` also fires (feature-flag on per exit-criterion). | Digest delivered. Quality-adjust job boosts high-utility entries, reduces low-utility. Assert single-writer invariant held — no other service wrote `qualityScore` during the job. |

**Week 4 — Full feedback loop.**

| Day | Mocked events | Assertions |
|---|---|---|
| Mon 07:00 | Briefing fires. | Standard. |
| Wed | `memory-block-synthesis` fires. The Wed-Week-2 block has now survived 2 cycles → **auto-activates** (`status='active'`) via passive ageing per §5.7. | Block now surfaces in S6 relevance retrieval. `memory_review_queue` row marked `auto_applied`. Digest log entry records the activation. |
| Fri 17:00 | Digest fires. Weekly quality-adjust fires. | Digest reports the newly-active block. Weekly pruning prediction: still none pruned (entries not yet 180 days old). |
| Sat | Nightly decay job. | Older entries now have reduced `qualityScore` from decay, but none below `PRUNE_THRESHOLD` yet. |

**Final assertion across all 4 weeks:**

1. **Scheduled deliverables:** 4 Intelligence Briefings + 4 Weekly Digests = 8 scheduled inbox items. Match expected exactly.
2. **Scheduled maintenance:** 28 nightly decay passes + 4 weekly synthesis jobs + 4 weekly quality-adjust jobs + every minute-level job tick. All completed without manual re-run.
3. **Human interventions required:** **0**. Assert via a log scan for any record tagged `severity=human_action_required` across the 4-week span. If present, the test fails and the offending event is surfaced.
4. **Review queue state at end of Week 4:** 0 items in `pending` state; 1 item in `auto_applied` (the passive-aged block); 0 in `rejected` or `expired`.
5. **Trust calibration:** The agent's auto-threshold has decreased by a further 0.05 step if the approval rate stayed clean — document the observed transition in the test report.

This scenario is the operating-model smoke test: if the platform fails it, the "zero human involvement" claim in the spec's value proposition is invalidated.

---

## Spec ambiguities surfaced during planning

These were flagged during plan authoring. Per architect brief, the spec is NOT modified by this plan — the main session decides whether to re-open the spec or resolve inline at build time.

1. **Step-status enum storage location (S8, migration 0138).** The spec adds `completed_with_uncertainty` and `waiting_on_clarification` to a "step-status enum" (§5.4 item 4–5) but does not specify which table physically stores per-step state. Candidates: a hypothetical `agent_run_steps` table, a JSONB `steps` column on `agent_runs`, or an enum column on a per-skill run artefact. Resolution needed before migration 0138 can be generated — verify against current `server/db/schema/agentRuns.ts` and `server/services/agentExecutionService.ts` during Phase 2 task 12. If no per-step row exists today, the state machine change becomes a JSONB shape-change plus a service-level validator, not a migration.

2. **`modules.onboardingPlaybookSlugs` declaration site.** §8.7 references a module-level declaration as the source of available playbooks per module, paired with `onboarding_bundle_configs` as the org-level selection. The spec does not specify where `modules` live — is this a `modules` table, a code-level registry, or a field on an existing table? Phase 3 task 11 (`playbookRegistryService`) is the natural place to land this; resolution needed before that task starts.

3. **`dropZoneService` text extraction for images.** §5.5 says "text extraction for PDF/DOCX/images via OCR". Image OCR is mentioned but no integration is identified in the spec. Tesseract? A cloud OCR provider? Deferred or in-scope for S9? NF4 edge-case treats OCR as a separate budget — consistent with "add later if needed." Recommend Phase 4 task 16 ships PDF + DOCX + plain-text only; image OCR deferred to a follow-up unless a fixture set demonstrates genuine need.

4. **Portfolio rollup's source of "client spotlight" and "highlights/lowlights".** §11.3 item 4 and §11.4 item 2 both require comparative analysis across clients. The spec doesn't specify the ranking heuristic. Options: KPI delta vs last week, absolute KPI value, a composite quality score. Phase 4 task 24 should either pick a reasonable default (I'd suggest week-over-week KPI delta, flagged as tunable) or defer to the first real agency using this and ship a placeholder.

5. **S13 memory inspector and persisted reasoning chains.** §5.9 item 2 explicitly notes "Reasoning chain (LLM internal chain-of-thought) is not currently persisted — this is out of scope for S13 and deferred." But the inspector's stated UX ("walks through these and explains in plain English") implies reconstructing reasoning from run metadata alone. Phase 4 task 29 should narrow the inspector's claim: it explains **what happened** (tool calls, memory retrievals, final output), NOT **why the model chose** (that requires chain-of-thought persistence, out of scope). Surface this in the UI copy.

6. **Feature flag for S4 quality-adjust job.** Phase 2 introduces `S4_QUALITY_ADJUST_LIVE` as a gate during the threshold-tuning window. The spec does not mandate this flag — it is a plan-level safety decision derived from the calibration note in §4.4. Document the flag's default-off state and exit condition in the deploy notes for Phase 2.

7. **Phase 1 `portalFeatureRegistry` keys vs Phase 4 migration 0132 defaults.** Phase 1 seeds the static registry with five feature keys; Phase 4 adds the dynamic `portalFeatures` jsonb column with default `{}`. The `portalGate.ts` fallback per §6.3 is "all features ON when portal mode is Collaborative." Confirm at Phase 4 task 10 that the empty JSONB `{}` correctly resolves to that default path — there's a potential gotcha where `portalFeatures.dropZone === undefined` is treated the same as `=== true`. Write the test in `portalGateTest.ts` to pin this explicitly.

8. **`drop_zone_upload_audit.appliedDestinations` rollback semantics.** §5.5 specifies the column as the authoritative record of what was filed. If a post-transaction step (e.g., auto-synthesis trigger) fails downstream, does the audit row stay "applied" (because the filing transaction succeeded) or is there a rollback log? Phase 4 task 16 implementer should default to "audit row is immutable and records what the filing transaction committed; downstream failures are logged separately."

9. **Protected-block edits vs version history (S24).** Phase 5 creates `memory_block_versions` — every content mutation writes a version row. The existing protected-block route guards already log content edits (per spec §2 "Content edits are permitted for org admins and logged for observability"). Confirm at Phase 5 task 3 that the existing observability log and the new version row are consistent (same actor, same timestamp) or explicitly converged into the version table as the single source of truth.

10. **Clarification routing for runs that span a client-domain topic boundary mid-run.** §5.4 routes client-domain questions to the client contact when portal mode is Collaborative. What if a single run asks two clarifications — one client-domain, one internal? Phase 2 task 10 should route each independently (per-question routing, not per-run routing). The spec implies this but doesn't state it explicitly — document in `clarificationService.ts` docstring.

None of these block Phase 1 start. Items 1, 2, 6 and 10 are Phase 2 pre-reqs; items 3, 4, 7, 8 are Phase 4 pre-reqs; item 5 is a UI-copy decision at Phase 4 task 29; item 9 is a Phase 5 verification item.

---

## Summary

- **Total tasks across all 5 phases:** Phase 1: 34 · Phase 2: 30 · Phase 3: 35 · Phase 4: 32 · Phase 5: 10 — **141 atomic tasks**.
- **Total migrations:** 17 (slots 0129–0145).
- **Acceptance-test rows:** 18 (F1–F12 + NF1–NF6).
- **Opus-routed tasks:** ~22 (invariant enforcement, agent-loop integration, security gates, feedback loops, prompt engineering).
- **Sonnet-routed tasks:** ~119 (pattern-following, mechanical — schema files, routes, UI components, jobs).

Spec sign-off path: this plan is the second handoff artefact after the spec itself. When Phase 1 kicks off, reference this document for the ordered task list and migration sequence; reference the spec for rationale and invariants; raise new ambiguities against the trailing section above in the same PR that surfaces them.

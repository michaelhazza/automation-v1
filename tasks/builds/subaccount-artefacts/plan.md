# F1 Sub-Account Baseline Artefacts — Implementation Plan

| Field | Value |
|---|---|
| Spec | `docs/sub-account-baseline-artefacts-spec.md` |
| Branch | `claude/stream-1-onboarding-scope` |
| Worktree | `C:\Files\Projects\automation-v1.stream-1-onboarding-scope\` (referred to below as `<worktree>`) |
| Migration | `0277_subaccount_baseline_artefacts.sql` (+ `.down.sql`) |
| Stream | 1 of 2 — F1 lands first; F3 starts after F1 PR merges |
| Status | READY |
| Plan model | Opus (decomposition) → execute on Sonnet |

> All paths in this plan are relative to the **worktree root** `<worktree>`, not to the main session's CWD. Code is written there. The plan itself lives in the main repo at `tasks/builds/subaccount-artefacts/plan.md` because plans are coordination documentation, not code.

---

## Model-collapse check

The feature is a **structured-form capture wizard plus deterministic prompt-prepend**. There is no ingest → extract → transform → render pipeline; the user types into form fields, the values land in `memory_blocks` rows, and a loader prepends those rows to the system prompt. No LLM call sits anywhere in the F1 critical path. There is therefore no candidate "single frontier-multimodal call" that could collapse the pipeline — the work is already a single-step deterministic write. Collapse rejected because the alternative is not a pipeline.

---

## Architecture notes

Decisions and the reasoning behind them.

### 1. Convention over schema (spec §2) is correct — confirm the trade-off

The spec proposes `tier` and `applies_to_domains` columns on `memory_blocks` plus a status JSONB on `subaccounts`. No new tables. The trade-off: the six artefacts are not modelled as first-class entities; their identity is the reserved-slug naming convention (`baseline.brand_identity`, etc.).

- **Considered:** a dedicated `baseline_artefacts` table.
- **Rejected because:** Tier 1+2 artefacts are already memory blocks, full stop — adding a parallel table forces a join on every tier-1 prompt assembly hit (high traffic) and re-litigates `auto_attach`, RLS, soft-delete, embedding backfill, version rows, and the protected-block invariant. The naming convention is enforceable via a `shared/constants/baselineArtefacts.ts` (single source of truth) plus a workflow validator.

### 2. Tier-3 writes need an explicit path — `knowledgeBindings` does not cover them

`WorkflowKnowledgeBinding` (server/lib/workflow/types.ts:361) writes only to `memory_blocks`. Tier-3 artefacts (operating constraints, proof library) are spec'd to land in `workspace_memory_entries` with `domain='baseline'`. Therefore Tier-3 cannot use the same `knowledgeBindings[]` declarative path as Tier 1+2.

- **Chosen approach:** Tier 1+2 use `knowledgeBindings`. Tier 3 writes are performed by `markArtefactCaptured` itself when called from the Tier-3 step's terminal completion. The reader function (Tier-3 search) already works through `workspaceMemoryService.getMemoryForPromptWithTracking()` filtering on `domain='baseline'`.
- **Considered:** extend `WorkflowKnowledgeBinding` with a `target: 'memory_block' | 'workspace_memory'` discriminator.
- **Rejected because:** Tier 3 has only two artefacts, and the proof library further demands attaching files to `reference_documents`. The workspace write path is non-trivial. A discriminator would force `WorkflowKnowledgeBinding` to grow into a polymorphic type with target-specific fields. Cleaner to keep `knowledgeBindings` mono-purpose and put Tier-3 writes inside `markArtefactCaptured`.

### 3. Single source of truth for status — JSONB shape is locked

`subaccounts.baseline_artefacts_status` is a versioned JSONB blob (`version: 1`). The shape is locked by `baselineArtefactsStatusSchema` in `shared/schemas/subaccount.ts`. Service code reads `version` and refuses to operate on an unknown one.

- **Source-of-truth precedence:** `baseline_artefacts_status` JSONB is the canonical state. The `memory_blocks.tier=1|2` rows and `workspace_memory_entries.domain='baseline'` rows are content; the JSONB is metadata. When two disagree (e.g. status says `completed` but the block is soft-deleted), the JSONB wins for the workflow validator (a status of `completed` permits wizard exit) but the loader is content-driven (no block, no inject). This is intentional — status drives the wizard; content drives runtime injection.

### 4. Telemetry events — five additions to `EVENT_NAMES`

The spec §6a names five events. They register in `server/lib/tracing.ts` `EVENT_NAMES` (compile-time enforced). Emit via `createEvent(name, metadata)`. None batched — emit at each transition.

### 5. F1→F2 contract — narrow reader, no F2 import

Per spec §6b: F1 exports `getBaselineVoiceTone(orgId, subaccountId): Promise<BaselineVoiceTone | null>` from `memoryBlockService`. The shared type `BaselineVoiceTone` lives in `shared/types/baselineArtefacts.ts`. F1 does not import from F2; F2 imports the reader from F1. Returns null for any non-`completed` state (single read path: `subaccounts.baseline_artefacts_status.tier1.voice_tone.status` plus the actual block content).

### 6. Status enum invariants — pure tests, not runtime guards

Per spec §8 hard invariants. Pure-function validators in `shared/schemas/subaccount.ts` enforce: status enum closed, `skipped` is Tier-3-only, `captured_at` and `skipped_at` mutually exclusive, version gate. Workflow validator (`server/workflows/__tests__/baselineArtefactsCapture.test.ts`) exercises the wizard-exit predicate: any Tier-1/2 artefact in `not_started` or `in_progress` blocks completion.

### 7. Hash-stable Tier-1 ordering for prefix caching

`getTier1Blocks` returns blocks sorted by `name` (deterministic). The `agentExecutionService.ts:834` insertion is `prepend` and lands inside the `stablePrefix` block (above the dynamicSuffix split at line 936). Cached-context prefix-hashing is therefore preserved.

### 8. No new RLS surface

No new tables; column adds inherit existing RLS on `memory_blocks` and `subaccounts`. `server/config/rlsProtectedTables.ts` already lists both. No update required.

---

## Chunk list

A "chunk" is a single builder-session-sized unit. Phase 1 splits into 1A (migration) + 1B (schema + constants + zod) for cleaner review. Phase 2 splits into 2A (Tier-1 loader) + 2B (Tier-2 domain filter + integration). Phase 3 splits into 3A (telemetry registry + workflow scaffold) + 3B (`markArtefactCaptured` + Tier-3 write path) + 3C (workflow validator + capture-workflow wiring). Phase 4 splits into 4A (wizard step) + 4B (Knowledge drawer + status badge).

| # | Name | Phase | Files (count) | Estimated effort |
|---|---|---|---|---|
| 0 | Riley doc-sync | 0 | 7 docs | 30-45 min |
| 1A | Migration 0277 + Drizzle schema | 1 | 4 | 1h |
| 1B | Reserved slugs + zod status schema + types | 1 | 4 + 2 tests | 2h |
| 2A | Tier-1 loader + agentExecutionService prepend | 2 | 2 + 1 test | 2h |
| 2B | Tier-2 domain filter + integration + telemetry | 2 | 3 + 1 test | 2h |
| 3A | Telemetry events + capture-workflow scaffold | 3 | 2 | 1.5h |
| 3B | `markArtefactCaptured` + Tier-3 write path | 3 | 2 + 1 test | 2h |
| 3C | F1→F2 reader + workflow validator wiring | 3 | 2 + 1 test | 1.5h |
| 4A | OnboardingWizardPage new step | 4 | 1 | 2h |
| 4B | EditArtefactDrawer + status badge + Knowledge wiring | 4 | 3 | 3h |
| 5 | Closeout — manual verification + doc updates | 5 | 4 docs | 1.5h |

Total estimated: ~18-19h. Matches spec §6 ranges.

---

## Forward dependency graph (no backward refs)

```
0  (doc-only)
1A → 1B → 2A → 2B → 3A → 3B → 3C → 4A → 4B → 5
                          (3B blocks 3C; 3A unblocks 3B)
```

Phase 0 is mechanical doc-sync, runs in parallel with anything; commit on its own. Every other chunk depends on the previous one (column adds → schema typing → loaders → workflow → UI). 4A and 4B can be split across two builder sessions but 4B reads the status produced by 3B+3C.

---

## Executor notes

- Run all chunks in the worktree at `<worktree>`. Switch into it before issuing commands.
- Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.
- After each chunk: `npm run lint` + `npm run typecheck`. Add `npm run build:client` for chunks 4A and 4B. Add the targeted `npx tsx <test>` for any chunk that authors a test file.
- Migration 0277 is reserved here; do not touch other migration numbers. F3 (next sub-stream) gets 0278-0280.
- The user commits explicitly after reviewing changes. Do NOT auto-commit. Commit messages below are the suggested message — present them for the user to apply.
- Preserve hash-stable prefix ordering at every step. Tier-1 blocks must always sort by `name` ASC; the prepend in `agentExecutionService.ts` must NOT rebuild the prefix on every call (the existing `stablePrefix` join at line 936 handles caching — tier-1 sits inside that prefix).

---

## Chunk 0 — Riley doc-sync

**Goal:** Mechanical doc-only updates so future sessions read Riley wave status accurately. No code changes. Single commit.

**Phase:** 0

**Files (modify only):**
- `docs/riley-observations-dev-spec.md`
- `tasks/builds/riley-observations/progress.md`
- `tasks/builds/riley-observations/plan-w2-explore-execute-mode.md`
- `tasks/builds/riley-observations/plan-w3-context-assembly-telemetry.md`
- `tasks/builds/riley-observations/plan-w4-heartbeat-gate.md`
- `docs/capabilities.md` (verify only — edit only if Riley vocabulary is wrong)
- `architecture.md` (verify only — edit only if naming is stale)
- `tasks/current-focus.md` (verify only — repoint if it still says Riley)
- `KNOWLEDGE.md` (append one Correction-style entry at the end)

**Steps:**
1. In `docs/riley-observations-dev-spec.md`, insert a **Shipping status** section near the top of the file (before §1) carrying the table from spec §6 Phase 0:
   - W1 — naming + `invoke_automation` → SHIPPED via PR #186 + migrations 0219-0222
   - W2 — Explore/Execute mode → SCHEMA-ONLY via migration 0230 (list `flow_runs.safety_mode`, `subaccount_agents.portal_default_safety_mode`, `system_skills.side_effects`)
   - W3 — context-assembly telemetry → NOT STARTED (no `context.assembly.complete` in `server/lib/tracing.ts`; no emit in `agentExecutionService.ts`)
   - W4 — heartbeat gate → NOT STARTED (prep columns landed in 0230: `subaccount_agents.last_meaningful_tick_at`, `ticks_since_last_meaningful_run`)
2. Wave-by-wave callouts inside `docs/riley-observations-dev-spec.md`: §4 (naming) → SHIPPED, §5 (`invoke_automation`) → SHIPPED, sections covering Explore/Execute → SCHEMA-ONLY, sections covering context-assembly telemetry and heartbeat gate → NOT STARTED with pointers to the per-wave plan files. Do **NOT** propagate the false claim that W2 includes "skill-execution timing capture" — this is not in the source spec.
3. In `tasks/builds/riley-observations/progress.md`, append a "Wave status as of 2026-05-01" section that updates the prior "W2-W4 deferred to subsequent waves" line to reflect that W2 schema landed in 0230 (note origin: `pre-launch-hardening` build), W3+W4 are still un-started.
4. Header note in `tasks/builds/riley-observations/plan-w2-explore-execute-mode.md`: "Schema portion of this plan landed via migration 0230 (out-of-band, in `pre-launch-hardening` build). Service / route / UI work below has not started." List the three columns.
5. Header note in `plan-w3-context-assembly-telemetry.md`: "Not started. No `context.assembly.complete` event registered in `server/lib/tracing.ts`, no emit in `agentExecutionService.ts`, no helper module."
6. Header note in `plan-w4-heartbeat-gate.md`: "Not started. Two prep columns landed in migration 0230 (`subaccount_agents.last_meaningful_tick_at`, `ticks_since_last_meaningful_run`). Gate service / dispatcher / UI / event registry all pending."
7. Verify `docs/capabilities.md`: search for Riley-related lines (Workflows / Automations vocabulary, `invoke_automation` step). Confirm shipped capabilities are stated in present tense; ensure Explore/Execute mode and heartbeat gate are NOT listed as shipped. Editorial rules apply (vendor-neutral, present-tense for shipped). Edit ONLY if a violation is found.
8. Verify `architecture.md`: confirm naming uses `flow_runs` (not `workflow_runs`/`playbook_runs`), `automations` (not `processes`), `workflows` (not `playbooks`). Edit ONLY if old names persist.
9. Verify `tasks/current-focus.md` doesn't still point at Riley as the active sprint. If it does, repoint to the F1 build slug.
10. Append to the bottom of `KNOWLEDGE.md` (NEVER edit existing entries):
    > **Correction (2026-05-04) — Riley waves ship independently.** W1 shipped via PR #186 + migrations 0219-0222. W2 schema landed in migration 0230 out-of-band from `pre-launch-hardening`; W2 services / UI did not. W3 and W4 unstarted in code. Don't conflate the four waves when reading Riley docs — check migrations and `server/lib/tracing.ts` for actual state.

**Tests:** None (doc-only).

**Verification:**
- `git diff --stat` — confirm only the doc files above changed.
- `npm run lint` — sanity, no code changed but a markdown lint pass costs nothing.

**Commit:** `docs: sync Riley wave status — W1 shipped, W2 schema-only, W3+W4 not started`

**Out of scope:** any new Riley code, any wave-plan rewrite, any priority change. Doc-sync only.

---

## Chunk 1A — Migration 0277 + Drizzle schema columns

**Goal:** Add `tier`, `applies_to_domains` to `memory_blocks` and `baseline_artefacts_status` JSONB to `subaccounts`. Wire Drizzle schema and partial index. Migration is reversible.

**Phase:** 1

**Files:**
- create: `migrations/0277_subaccount_baseline_artefacts.sql`
- create: `migrations/0277_subaccount_baseline_artefacts.down.sql`
- modify: `server/db/schema/memoryBlocks.ts`
- modify: `server/db/schema/subaccounts.ts`

**Steps:**
1. Author `migrations/0277_subaccount_baseline_artefacts.sql` exactly per spec §3:
   ```sql
   -- migrations/0277_subaccount_baseline_artefacts.sql
   -- F1 Sub-Account Baseline Artefacts — schema additions.
   -- See docs/sub-account-baseline-artefacts-spec.md §3.
   ALTER TABLE memory_blocks
     ADD COLUMN IF NOT EXISTS tier SMALLINT,
     ADD COLUMN IF NOT EXISTS applies_to_domains TEXT[];

   CREATE INDEX IF NOT EXISTS memory_blocks_tier_idx
     ON memory_blocks(organisation_id, subaccount_id, tier)
     WHERE tier IS NOT NULL;

   ALTER TABLE subaccounts
     ADD COLUMN IF NOT EXISTS baseline_artefacts_status JSONB
     DEFAULT '{"version":1,"tier1":{"brand_identity":{"status":"not_started"},"voice_tone":{"status":"not_started"}},"tier2":{"offer_positioning":{"status":"not_started"},"audience_icp":{"status":"not_started"}},"tier3":{"operating_constraints":{"status":"not_started"},"proof_library":{"status":"not_started"}}}'::jsonb;
   ```
2. Author the matching down migration:
   ```sql
   -- Down for 0277_subaccount_baseline_artefacts.sql
   ALTER TABLE subaccounts DROP COLUMN IF EXISTS baseline_artefacts_status;
   DROP INDEX IF EXISTS memory_blocks_tier_idx;
   ALTER TABLE memory_blocks
     DROP COLUMN IF EXISTS applies_to_domains,
     DROP COLUMN IF EXISTS tier;
   ```
3. In `server/db/schema/memoryBlocks.ts`:
   - Import `smallint` from `drizzle-orm/pg-core` (the existing import block).
   - In the column declarations, after the existing `capturedVia` line, add:
     ```ts
     // F1 Sub-Account Baseline Artefacts (migration 0277). Tier 1 = always
     // injected; Tier 2 = injected on agent-domain match; null = ordinary block.
     tier: smallint('tier').$type<1 | 2>(),
     // Domain match list for tier=2 (e.g. ['sales','content','outreach']).
     // Null for tier=1 and ordinary blocks. See shared/constants/baselineArtefacts.ts.
     appliesToDomains: text('applies_to_domains').array(),
     ```
   - In the index block at the end of the table definition, add a partial index matching the migration:
     ```ts
     tierIdx: index('memory_blocks_tier_idx')
       .on(table.organisationId, table.subaccountId, table.tier)
       .where(sql`${table.tier} IS NOT NULL`),
     ```
4. In `server/db/schema/subaccounts.ts`:
   - After the existing `optimiserEnabled` column, add:
     ```ts
     // F1 Sub-Account Baseline Artefacts (migration 0277). Per-artefact status JSONB.
     // Shape locked by shared/schemas/subaccount.ts:baselineArtefactsStatusSchema.
     baselineArtefactsStatus: jsonb('baseline_artefacts_status').notNull().default(
       sql`'{"version":1,"tier1":{"brand_identity":{"status":"not_started"},"voice_tone":{"status":"not_started"}},"tier2":{"offer_positioning":{"status":"not_started"},"audience_icp":{"status":"not_started"}},"tier3":{"operating_constraints":{"status":"not_started"},"proof_library":{"status":"not_started"}}}'::jsonb`
     ),
     ```
   - Confirm `sql` is already imported (it is — line 3).
5. Confirm Drizzle does not produce a spurious diff: `npm run db:generate` should NOT generate a competing migration. If it does, delete the generated file and keep the hand-authored 0277 (this repo authors migrations by hand; `db:generate` is verification only).

**Contracts pinned by this chunk:**
- `memory_blocks.tier`: `smallint`, nullable, allowed values `1 | 2`. NULL means "not a baseline tier-1/2 block".
- `memory_blocks.applies_to_domains`: `text[]`, nullable, set only for `tier=2`. Domain identifiers come from `agentRoleToDomain` output (`sales`, `content`, `outreach`, `crm`, `ads`, `reporting`, `marketing`, `dev`, `finance`, `ops`).
- `subaccounts.baseline_artefacts_status`: `jsonb`, NOT NULL with default. Shape per spec §3 and locked by zod schema in chunk 1B.

**Tests:** None in this chunk (Drizzle compile verifies type wiring; the JSONB shape is exercised in chunk 1B).

**Verification:**
- `npm run lint`
- `npm run typecheck`
- `npm run db:generate` — verify no spurious diff is produced. If a diff appears, the hand-authored migration is canonical; delete the generated artefact.

**Commit:** `feat(artefacts): migration 0277 — memory_blocks tier/applies_to_domains, subaccounts baseline_artefacts_status`

---

## Chunk 1B — Reserved slugs, status zod schema, F1→F2 type

**Goal:** Lock the reserved-slug naming convention, the JSONB status shape, and the F1→F2 `BaselineVoiceTone` type. Pure-function tests verify slug/tier/domain consistency and JSONB shape invariants.

**Phase:** 1

**Files:**
- create: `shared/constants/baselineArtefacts.ts`
- create: `shared/schemas/subaccount.ts` (new directory `shared/schemas/`)
- create: `shared/types/baselineArtefacts.ts`
- create: `shared/constants/__tests__/baselineArtefacts.test.ts`
- create: `shared/schemas/__tests__/subaccount.test.ts`

**Steps:**
1. Author `shared/constants/baselineArtefacts.ts` as the single source of truth for reserved slugs, tier mapping, and domain mapping. Export:
   - `BASELINE_SLUGS` — readonly array of all six slugs in canonical order: `['baseline.brand_identity','baseline.voice_tone','baseline.offer_positioning','baseline.audience_icp','baseline.operating_constraints','baseline.proof_library']`.
   - `TIER_BY_SLUG: Record<string, 1 | 2 | 3>` — maps each slug to its tier.
   - `APPLIES_TO_DOMAINS_BY_SLUG: Partial<Record<string, readonly string[]>>` — Tier-2 only:
     - `baseline.offer_positioning`: `['sales','content','outreach','crm']`
     - `baseline.audience_icp`: `['content','outreach','ads','reporting']`
   - `WORKSPACE_MEMORY_TOPIC_BY_SLUG: Partial<Record<string, string>>` — Tier-3 only:
     - `baseline.operating_constraints`: `'operating_constraints'`
     - `baseline.proof_library`: `'proof_library'`
   - `WORKSPACE_MEMORY_DOMAIN`: `'baseline'` (constant).
   - Type guards: `isBaselineSlug(s: string): s is BaselineSlug`, `tierFor(slug)`, `domainsFor(slug)`.
   - `ARTEFACT_STATUSES = ['not_started','in_progress','completed','skipped'] as const`; export `ArtefactStatus` union.
2. Author `shared/schemas/subaccount.ts` (creating the directory) — the locked JSONB shape:
   - Import `z` from `zod`.
   - Define a base zod object per Tier-1+2 artefact entry: `{ status: z.enum(ARTEFACT_STATUSES), captured_at: z.string().datetime().nullable(), skipped_at: z.string().datetime().nullable(), memory_block_id: z.string().uuid().nullable(), captured_by_user_id: z.string().uuid().nullable() }`. Add a refinement: NOT (`captured_at !== null && skipped_at !== null`).
   - Define a Tier-3 entry: identical shape but with `workspace_memory_id` replacing `memory_block_id`.
   - Define `baselineArtefactsStatusSchema` = `z.object({ version: z.literal(1), tier1: z.object({ brand_identity: tier12Entry, voice_tone: tier12Entry }), tier2: z.object({ offer_positioning: tier12Entry, audience_icp: tier12Entry }), tier3: z.object({ operating_constraints: tier3Entry, proof_library: tier3Entry }) })`.
   - Add a refinement at the top level: every Tier-1 + Tier-2 entry whose `status === 'skipped'` is invalid (Tier 1+2 cannot be skipped). Tier 3 may be skipped.
   - Export a pure helper: `isWizardCompletable(status: BaselineArtefactsStatus): boolean` — returns false if any Tier-1 or Tier-2 entry is `not_started` or `in_progress`. Tier-3 is permitted in any state for wizard exit (skip-and-complete-later).
   - Export a pure helper: `assertVersionGate(parsed: unknown, expectedVersion: 1): BaselineArtefactsStatus` — parses, checks version, throws `{ statusCode: 500, message: 'baseline_artefacts_status version mismatch', errorCode: 'BASELINE_ARTEFACTS_VERSION_MISMATCH' }` if not equal. Used by service code to refuse operating on unknown shape.
3. Author `shared/types/baselineArtefacts.ts`:
   ```ts
   /**
    * F1 → F2 contract. Voice/tone artefact, parsed from
    * memory_blocks.content where name = 'baseline.voice_tone' AND status = 'active'.
    * Returned by memoryBlockService.getBaselineVoiceTone(orgId, subaccountId).
    * Returns null when the artefact's wizard status is not 'completed'.
    * See docs/sub-account-baseline-artefacts-spec.md §6b.
    */
   export interface BaselineVoiceTone {
     descriptors: string[];          // 3-5 tone words
     example_sentences: string[];    // 2-3 examples
     prohibited_phrases: string[];   // explicit list — drives F2 escalation.repeat_phrase action hint
     formality_level: 'casual' | 'neutral' | 'formal';
     captured_at: Date;              // for staleness checks downstream
   }
   ```
4. Author `shared/constants/__tests__/baselineArtefacts.test.ts` — pure-function tests:
   - All six slugs appear in `BASELINE_SLUGS` exactly once.
   - `TIER_BY_SLUG` maps every slug; tiers add up to 2+2+2.
   - Tier-1 slugs have NO entry in `APPLIES_TO_DOMAINS_BY_SLUG`.
   - Tier-2 slugs each have 3-4 domain identifiers; each domain is a string already produced by `agentRoleToDomain` (assert against a hardcoded valid-domain set).
   - Tier-3 slugs each have an entry in `WORKSPACE_MEMORY_TOPIC_BY_SLUG`.
   - `isBaselineSlug` returns false for `'baseline.unknown'`, true for each of the six.
   - `tierFor('baseline.brand_identity') === 1`, `tierFor('baseline.audience_icp') === 2`, `tierFor('baseline.proof_library') === 3`.
5. Author `shared/schemas/__tests__/subaccount.test.ts`:
   - Default JSONB (per spec §3) parses cleanly.
   - Tier-1 entry with `status: 'skipped'` is rejected (Tier 1+2 may not skip).
   - Tier-2 entry with `status: 'skipped'` is rejected.
   - Tier-3 entry with `status: 'skipped'` is accepted.
   - Entry with both `captured_at` and `skipped_at` set is rejected.
   - `version: 2` is rejected by `assertVersionGate(_, 1)` with `BASELINE_ARTEFACTS_VERSION_MISMATCH`.
   - `version: 1` parses and passes.
   - `isWizardCompletable` returns false when any Tier-1 entry is `in_progress`; returns true when all Tier-1+2 are `completed` even if Tier-3 is `not_started`.

**Tests:** as listed in steps 4-5.

**Verification:**
- `npm run lint`
- `npm run typecheck`
- `npx tsx shared/constants/__tests__/baselineArtefacts.test.ts`
- `npx tsx shared/schemas/__tests__/subaccount.test.ts`

**Commit:** `feat(artefacts): reserved slugs, status zod schema, F1->F2 voice-tone type`

---

## Chunk 2A — Tier-1 loader and stable-prefix prepend

**Goal:** Add `getTier1Blocks` to `memoryBlockService`, prepend to system prompt at `agentExecutionService.ts:834` region while staying inside the existing `stablePrefix` block. Hash-stable ordering preserved.

**Phase:** 2

**Files:**
- modify: `server/services/memoryBlockService.ts`
- modify: `server/services/agentExecutionService.ts`
- create: `server/services/__tests__/baselineArtefactsLoader.test.ts`

**Steps:**
1. In `server/services/memoryBlockService.ts`, after `getBlocksForInjection` (around line 305), add:
   ```ts
   /**
    * F1 / spec §4 — Tier-1 always-pinned baseline blocks.
    * Returns active blocks with tier=1 + matching subaccount, sorted by name
    * for hash-stable prefix caching. Called once per agent run from
    * agentExecutionService just before stablePrefix joins.
    *
    * Bypasses relevance scoring, token budget, and embedding gates — these
    * blocks are tiny (<200 tokens each, ~400 combined per spec §1).
    */
   export async function getTier1Blocks(
     organisationId: string,
     subaccountId: string | null,
   ): Promise<MemoryBlockForPrompt[]> {
     if (!subaccountId) return [];
     const rows = await db
       .select({
         id: memoryBlocks.id,
         name: memoryBlocks.name,
         content: memoryBlocks.content,
       })
       .from(memoryBlocks)
       .where(
         and(
           eq(memoryBlocks.organisationId, organisationId),
           eq(memoryBlocks.subaccountId, subaccountId),
           eq(memoryBlocks.tier, 1),
           eq(memoryBlocks.status, ACTIVE_STATUS),
           isNull(memoryBlocks.deletedAt),
         ),
       )
       .orderBy(asc(memoryBlocks.name));

     return rows.map((r) => ({
       id: r.id,
       name: r.name,
       content: r.content,
       permission: 'read' as const,
     }));
   }
   ```
2. In `server/services/agentExecutionService.ts`, locate the existing memory-blocks injection at line ~896 (`getBlocksForInjection` call inside the `Layer 2a: Shared memory blocks` comment block). Immediately BEFORE that call, fetch tier-1 blocks and prepend them to the section:
   ```ts
   // Tier-1 baseline artefacts — pinned, hash-stable, always present when
   // captured. Spec docs/sub-account-baseline-artefacts-spec.md §4.
   const tier1Blocks = await memoryBlockService.getTier1Blocks(
     request.organisationId,
     request.subaccountId ?? null,
   );

   const memoryBlocksForPrompt = await memoryBlockService.getBlocksForInjection({
     // ...existing params unchanged...
   });

   // Prepend tier-1 ahead of the relevance/explicit set so it sits at the
   // top of the section. Dedupe: if a tier-1 block also reaches injection
   // via explicit attachment, the tier-1 entry wins (tier=1 implies pinned).
   const seenIds = new Set(tier1Blocks.map((b) => b.id));
   const composedBlocks = [
     ...tier1Blocks,
     ...memoryBlocksForPrompt.filter((b) => !seenIds.has(b.id)),
   ];

   const memoryBlocksSection = memoryBlockService.formatBlocksForPrompt(composedBlocks);
   ```
   Replace the existing `memoryBlocksForPrompt` reference downstream with `composedBlocks` for the section formatter and the `injectedBlockIds` provenance trail (line 907).
3. Re-export `getTier1Blocks` from the `memoryBlockService` namespace import path (the file uses `import * as memoryBlockService from './memoryBlockService.js'` style — confirm the new export is reachable; if not, add it explicitly).
4. Author `server/services/__tests__/baselineArtefactsLoader.test.ts` with pure-ish tests using a mocked db client OR an in-process pg-mem instance per the existing `*Pure.test.ts` pattern in this repo (check the existing `memoryBlockServicePure.ts` test for the project's mocking style; if mocking the db is fragile, restrict the test file to pure functions only and put DB-touching cases under `npm run test:gates` — which CI runs):
   - `getTier1Blocks` returns blocks sorted by `name` ASC.
   - Returns empty array when `subaccountId` is null.
   - Filters out `tier=2`, `tier=null`, `status='draft'`, soft-deleted blocks.
   - Returns each block with `permission: 'read'`.
5. If the test file ends up requiring DB fixtures, fall back to a pure ranking test against in-memory inputs and document the DB-side coverage as deferred to integration. The test file MUST run via `npx tsx <path>` without external DB.

**Tests:** as in step 4.

**Verification:**
- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/baselineArtefactsLoader.test.ts`

**Commit:** `feat(artefacts): tier-1 loader + stable-prefix prepend at agentExecutionService:834`

---

## Chunk 2B — Tier-2 domain filter, integration, telemetry event

**Goal:** Extend `getBlocksForInjection` to accept an optional `agentDomain`, fetch Tier-2 candidates filtered by `applies_to_domains @> ARRAY[agentDomain]`, merge into the existing relevance/explicit set with a small priority boost. Wire `agentDomain` from `agentExecutionService.ts`. Emit `baseline_artefact.tier_loaded`.

**Phase:** 2

**Files:**
- modify: `server/services/memoryBlockService.ts`
- modify: `server/services/agentExecutionService.ts`
- modify: `server/lib/tracing.ts` (add `baseline_artefact.tier_loaded` to `EVENT_NAMES` — done here since 2B is the first emitter; the other four events register in chunk 3A)
- modify: `server/config/limits.ts` — add `MEMORY_BLOCK_TIER2_BOOST` constant (default `0.15`).
- create: `server/services/__tests__/memoryBlockService.tier.test.ts`

**Steps:**
1. In `server/lib/tracing.ts` `EVENT_NAMES`, add `'baseline_artefact.tier_loaded'` (single event in this chunk; the other four artefact events land in chunk 3A).
2. In `server/config/limits.ts`, add:
   ```ts
   /**
    * F1 §4 — relevance-score boost applied to tier=2 baseline blocks when
    * the agent's domain matches the block's applies_to_domains list.
    * Tunable; defaults align with spec §4.
    */
   export const MEMORY_BLOCK_TIER2_BOOST = 0.15;
   ```
3. In `server/services/memoryBlockService.ts`:
   - Extend `GetBlocksForInjectionParams`:
     ```ts
     /** F1 §4 — agent domain for tier-2 selection. Use agentRoleToDomain. */
     agentDomain?: string;
     ```
   - In `getBlocksForInjection`, when `params.agentDomain` is set:
     - After loading explicit + relevance candidates, fetch Tier-2 candidates:
       ```ts
       let tier2Candidates: CandidateBlock[] = [];
       if (params.agentDomain && params.subaccountId) {
         const tier2Rows = await db
           .select({
             id: memoryBlocks.id,
             name: memoryBlocks.name,
             content: memoryBlocks.content,
           })
           .from(memoryBlocks)
           .where(
             and(
               eq(memoryBlocks.organisationId, params.organisationId),
               eq(memoryBlocks.subaccountId, params.subaccountId),
               eq(memoryBlocks.tier, 2),
               eq(memoryBlocks.status, ACTIVE_STATUS),
               isNull(memoryBlocks.deletedAt),
               sql`${memoryBlocks.appliesToDomains} @> ARRAY[${params.agentDomain}]::text[]`,
             ),
           );
         tier2Candidates = tier2Rows.map((r) => ({
           id: r.id,
           name: r.name,
           content: r.content,
           score: BLOCK_RELEVANCE_THRESHOLD + MEMORY_BLOCK_TIER2_BOOST,
           source: 'relevance', // join the candidate set; ranker handles eviction
           protected: false,
         }));
       }
       ```
     - Pass the combined `[...explicitCandidates, ...relevantCandidates, ...tier2Candidates]` to `rankBlocksForInjection`.
   - Import `MEMORY_BLOCK_TIER2_BOOST` from `../config/limits.js`.
4. In `server/services/agentExecutionService.ts`, the `agentDomain` derivation already exists at line 1005 (`agentRoleToDomain(agent.agentRole) ?? undefined`). That value lives in the dynamic-suffix region. Move the derivation EARLIER — before the line ~896 `getBlocksForInjection` call — and pass it down:
   ```ts
   const agentDomain = agentRoleToDomain(agent.agentRole) ?? undefined;

   const tier1Blocks = await memoryBlockService.getTier1Blocks(/* ... */);

   const memoryBlocksForPrompt = await memoryBlockService.getBlocksForInjection({
     agentId: request.agentId,
     subaccountId: request.subaccountId ?? null,
     organisationId: request.organisationId,
     taskContext: workspaceContext,
     agentDomain,            // ← new
   });
   ```
   The duplicate derivation at line 1005 stays — it's used by `workspaceMemoryService.getMemoryForPromptWithTracking` further down. Do NOT delete it; reuse the same const variable name (capture once, use twice).
5. Telemetry emit — after the `composedBlocks` array is materialised (chunk 2A point), iterate and emit one event per tier-1 + tier-2 block actually injected:
   ```ts
   for (const block of composedBlocks) {
     const tier = tier1Blocks.some((b) => b.id === block.id) ? 1
       : (block as { _tier?: 1 | 2 })._tier ?? null;
     if (tier === 1 || tier === 2) {
       createEvent('baseline_artefact.tier_loaded', {
         organisation_id: request.organisationId,
         subaccount_id: request.subaccountId,
         agent_role: agent.agentRole,
         tier,
         block_slug: block.name,
         token_count: estimateTokenCount(block.content), // existing util in shared/utils
       });
     }
   }
   ```
   Tier detection for non-tier-1 entries: the simplest path is to extend `MemoryBlockForPrompt` with an optional `tier?: 1 | 2 | null` propagated from the row. Add `tier` to the `select(...)` projections in both `getTier1Blocks` (always 1) and the tier-2 fetch in `getBlocksForInjection`; surface it on the returned shape. Update `MemoryBlockForPrompt` in `server/services/memoryBlockServicePure.ts` if necessary. Existing relevance-only blocks return `tier: null`.
6. Confirm `createEvent` import exists at the top of `agentExecutionService.ts`. If not, add `import { createEvent } from '../lib/tracing.js'`.
7. Author `server/services/__tests__/memoryBlockService.tier.test.ts` — pure-input tests against the ranker:
   - With `agentDomain='sales'`, a tier-2 block with `appliesToDomains=['sales','content']` is included in candidates with score `BLOCK_RELEVANCE_THRESHOLD + 0.15`.
   - With `agentDomain='ads'`, the same block is NOT a tier-2 candidate (sales vs ads mismatch).
   - With no `agentDomain`, no tier-2 candidates surface.
   - Tier-1 always-loaded path (covered in 2A) does not double-fire here — but assert that `composedBlocks` from a hypothetical agent run with both tier-1 and matching tier-2 contains exactly one entry per `id` (no duplicate when a tier-1 block also reaches via explicit/relevance).
   - Tier-3 (`tier=null` rows synthetic with `domain='baseline'`) are NOT loaded by either tier loader.

**Tests:** as in step 7.

**Verification:**
- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/memoryBlockService.tier.test.ts`

**Commit:** `feat(artefacts): tier-2 domain filter + telemetry baseline_artefact.tier_loaded`

---

## Chunk 3A — Telemetry events + capture-workflow scaffold

**Goal:** Register the remaining four §6a events. Author the capture workflow file with six `user_input` steps and `knowledgeBindings[]` for Tier 1+2. Tier-3 binding wiring lands in chunk 3B.

**Phase:** 3

**Files:**
- modify: `server/lib/tracing.ts`
- create: `server/workflows/baseline-artefacts-capture.workflow.ts`

**Steps:**
1. In `server/lib/tracing.ts` `EVENT_NAMES`, add the four remaining names from spec §6a:
   - `'artefact.capture.started'`
   - `'artefact.capture.completed'`
   - `'artefact.capture.skipped'`
   - `'artefact.capture.edited'`
   (`'baseline_artefact.tier_loaded'` already added in chunk 2B.)
2. Author `server/workflows/baseline-artefacts-capture.workflow.ts` modelled on `intelligence-briefing.workflow.ts`. Slug: `baseline-artefacts-capture`. `version: 1`. `autoStartOnOnboarding: true`.
3. `initialInputSchema`: minimal, just sub-account name pre-fill (the wizard pre-populates from sub-account record):
   ```ts
   z.object({
     prefillFromSubaccount: z.boolean().default(true),
   })
   ```
4. Six steps, each `type: 'user_input'`, each `sideEffectType: 'none'`, dependencies forming a linear chain (`brand_identity` first, each subsequent depends on the prior). Per spec §5:
   - `brand_identity` — `formSchema = z.object({ name: z.string().min(1).max(120), oneLiner: z.string().max(160), industry: z.string().min(1), targetCustomer: z.string().min(1), geography: z.string().min(1), stage: z.string().min(1) })`. `outputSchema` mirrors.
   - `voice_tone` — `formSchema = z.object({ descriptors: z.array(z.string()).min(3).max(5), example_sentences: z.array(z.string()).min(2).max(3), prohibited_phrases: z.array(z.string()), formality_level: z.enum(['casual','neutral','formal']) })`.
   - `offer_positioning` — `formSchema = z.object({ services: z.array(z.string()), value_prop: z.string(), differentiators: z.array(z.string()), pricing_tiers: z.array(z.object({ name: z.string(), description: z.string() })) })`.
   - `audience_icp` — `formSchema = z.object({ primary_buyer: z.string(), pain_points: z.array(z.string()), objections: z.array(z.string()), success_criteria: z.array(z.string()) })`.
   - `operating_constraints` — `formSchema = z.object({ hours: z.string(), response_time_commitments: z.string(), escalation_paths: z.array(z.string()), compliance: z.array(z.string()), languages: z.array(z.string()) })`.
   - `proof_library` — `formSchema = z.object({ uploads: z.array(z.object({ referenceDocumentId: z.string().uuid(), tags: z.array(z.string()) })) })`.
5. Top-level `knowledgeBindings`:
   ```ts
   knowledgeBindings: [
     { stepId: 'brand_identity',     outputPath: '$',  blockLabel: 'baseline.brand_identity',     mergeStrategy: 'replace', firstRunOnly: false },
     { stepId: 'voice_tone',         outputPath: '$',  blockLabel: 'baseline.voice_tone',         mergeStrategy: 'replace', firstRunOnly: false },
     { stepId: 'offer_positioning',  outputPath: '$',  blockLabel: 'baseline.offer_positioning',  mergeStrategy: 'replace', firstRunOnly: false },
     { stepId: 'audience_icp',       outputPath: '$',  blockLabel: 'baseline.audience_icp',       mergeStrategy: 'replace', firstRunOnly: false },
     // Tier-3 (operating_constraints, proof_library) write via markArtefactCaptured —
     // workspaceMemoryEntries is not a knowledgeBindings target. See chunk 3B.
   ],
   ```
6. Add a code comment in the workflow file pointing at chunk 3B for the Tier-3 write path so future readers understand why two of six steps are NOT in `knowledgeBindings`. Cite `docs/sub-account-baseline-artefacts-spec.md §5`.
7. Confirm the workflow validates: `npx tsx server/lib/workflow/cli/validate.ts` if such a CLI exists, else rely on the type compiler. The spec-time validator (`workflowValidatorPure`) runs as part of `npm run typecheck` indirectly through `defineWorkflow`'s zod assertions.

**Tests:** none in this chunk; the workflow validator test file is added in chunk 3C alongside the wizard-completability assertion.

**Verification:**
- `npm run lint`
- `npm run typecheck`
- (No targeted test in this chunk.)

**Commit:** `feat(artefacts): capture workflow scaffold + 4 telemetry events`

---

## Chunk 3B — `markArtefactCaptured` + Tier-3 write path + tier-fields persisted

**Goal:** Implement `subaccountOnboardingService.markArtefactCaptured(...)` that updates the JSONB status, emits `artefact.capture.completed` / `artefact.capture.skipped`, and (for Tier 3 only) writes the workspace-memory entry. Also: ensure Tier 1+2 blocks created via `knowledgeBindings` carry `tier`, `applies_to_domains`, and `auto_attach=true` so the loaders find them.

**Phase:** 3

**Files:**
- modify: `server/services/subaccountOnboardingService.ts`
- modify: `server/services/memoryBlockService.ts` (post-binding hook to set `tier`/`appliesToDomains` on blocks created via `baseline-artefacts-capture` workflow)
- modify: `server/lib/workflow/runtime` (or wherever `finaliseRun()` invokes `upsertFromWorkflow`) — add a hook OR a post-write step that sets tier columns based on `BASELINE_SLUGS` membership. Confirm exact location via grep on `upsertFromWorkflow` callers.
- create: `server/services/__tests__/subaccountOnboardingArtefacts.test.ts`

**Steps:**
1. **Tier-field persistence path.** `knowledgeBindings`'s `upsertFromWorkflow` does NOT know about `tier` / `applies_to_domains` — those are F1-specific. Two options:
   - **Option A (minimal — chosen).** Extend `upsertFromWorkflow` accept-list with optional `tier?: 1 | 2` and `appliesToDomains?: string[]`, and have the runtime caller resolve them from `BASELINE_SLUGS` lookup when `workflowSlug === 'baseline-artefacts-capture'`. Set `auto_attach=true` for any baseline tier-1 row (so the loader's hash-stable prepend has subaccount-scoped data).
   - **Option B (rejected — heavier).** A new dedicated `upsertBaselineBlock` helper bypassing `upsertFromWorkflow`. Rejected because we lose the rate-limit, HITL-overwrite, and merge-strategy infrastructure for free with Option A.
2. Modify `server/services/memoryBlockService.ts` `UpsertFromWorkflowParams` to add:
   ```ts
   /** F1 §3 — tier classification for baseline blocks. Null otherwise. */
   tier?: 1 | 2 | null;
   /** F1 §3 — domain match list for tier=2. */
   appliesToDomains?: string[] | null;
   ```
   Set both on the `INSERT` and on the `UPDATE` paths (UPDATE: only if the existing row's value is null — a baseline block must never lose its tier).
3. In the runtime caller (the file that loops `definition.knowledgeBindings` and calls `upsertFromWorkflow`), when `workflowSlug === 'baseline-artefacts-capture'` AND `blockLabel` is in `BASELINE_SLUGS`:
   - Look up `tierFor(blockLabel)` — only 1 or 2 reach this path (Tier 3 has no binding).
   - Look up `domainsFor(blockLabel)` — non-empty for tier=2, empty for tier=1.
   - Pass `{ tier, appliesToDomains, autoAttach: true }` into `upsertFromWorkflow`.
   - Confirm the existing `autoAttach` default is `true` (it already is — line 700) so this is reinforcement, not change.
4. **Tier-3 write path.** In `subaccountOnboardingService`, add:
   ```ts
   /**
    * F1 §5 — called by the capture workflow's terminal completion hook.
    * Updates baseline_artefacts_status JSONB and (Tier-3 only) writes the
    * workspace memory entry with domain='baseline'.
    *
    * Source-of-truth precedence: this method writes the JSONB, which is
    * the canonical "wizard state" representation. The memory_blocks /
    * workspace_memory_entries content is loaded by the runtime separately.
    */
   async markArtefactCaptured(params: {
     organisationId: string;
     subaccountId: string;
     slug: string;             // BASELINE_SLUGS member
     userId: string;
     // Tier 1+2: memory_block_id is supplied by the binding pipeline.
     memoryBlockId?: string;
     // Tier 3 only: payload to write into workspace_memory_entries.content.
     tier3Payload?: Record<string, unknown>;
   }): Promise<void> {
     // 1. Resolve tier from constants.
     // 2. Read + version-gate the JSONB.
     // 3. For Tier 3: insert row into workspace_memory_entries with
     //    domain='baseline', topic=WORKSPACE_MEMORY_TOPIC_BY_SLUG[slug],
     //    content=JSON.stringify(payload), entryType='preference',
     //    provenanceSourceType='manual', subaccountId, organisationId.
     //    Capture the inserted id as workspace_memory_id.
     // 4. JSONB merge: set tier{N}.{slug_short}.status='completed',
     //    captured_at=now(), captured_by_user_id=userId,
     //    memory_block_id=params.memoryBlockId (Tier 1+2)
     //    OR workspace_memory_id=insertedId (Tier 3).
     //    skipped_at remains null.
     // 5. UPDATE subaccounts SET baseline_artefacts_status=$1::jsonb
     //    WHERE id=subaccountId.
     // 6. createEvent('artefact.capture.completed', { subaccount_id, tier,
     //    slug, user_id: userId, memory_block_id|workspace_memory_id, version: 1 }).
   }
   ```
5. Add a sibling method `markArtefactSkipped(params)` for Tier-3 only — error if invoked for Tier 1+2 (`{ statusCode: 400, errorCode: 'BASELINE_SKIP_NOT_PERMITTED' }`):
   - Update JSONB `tier3.{slug_short}.status='skipped'`, `skipped_at=now()`, `captured_by_user_id=userId`.
   - Emit `artefact.capture.skipped` with `reason: 'defer_for_later' | 'not_applicable'`.
6. Both methods MUST use `assertVersionGate` from chunk 1B before mutating the JSONB. If the version doesn't match, throw — do not silently overwrite.
7. JSONB updates must be atomic. Use a single SQL update with `jsonb_set` chained, NOT read-modify-write in JS (race condition risk if two clients race during wizard exit). Example:
   ```ts
   await db.execute(sql`
     UPDATE subaccounts
     SET baseline_artefacts_status = jsonb_set(
       jsonb_set(
         jsonb_set(
           baseline_artefacts_status,
           '{tier1,brand_identity,status}', '"completed"'
         ),
         '{tier1,brand_identity,captured_at}', to_jsonb(now())
       ),
       '{tier1,brand_identity,memory_block_id}', to_jsonb(${memoryBlockId}::text)
     )
     WHERE id = ${subaccountId}
   `);
   ```
   Build the path dynamically from the slug (`tier1`, `brand_identity` are the segments). The version gate runs as a SELECT before the UPDATE; if version=1 fails, throw without mutating.
8. **Idempotency posture (Section 10.1 of authoring checklist):** state-based. The UPDATE path is idempotent — calling `markArtefactCaptured` twice for the same artefact moves the JSONB to the same state and emits two events. Documented behaviour: the wizard guarantees once-per-step invocation, and the post-onboarding edit path uses `artefact.capture.edited` (chunk 3C) instead. Two concurrent wizard exits cannot race because the wizard step is sequential and the workflow run is single-threaded.
9. Author `server/services/__tests__/subaccountOnboardingArtefacts.test.ts`:
   - `markArtefactCaptured` for `baseline.brand_identity` updates JSONB to `tier1.brand_identity.status='completed'` with `captured_at` set.
   - `markArtefactCaptured` for `baseline.operating_constraints` (Tier 3) writes a `workspace_memory_entries` row with `domain='baseline'`, `topic='operating_constraints'`, sets `workspace_memory_id` in the JSONB, and emits `artefact.capture.completed`.
   - `markArtefactSkipped` for `baseline.brand_identity` throws with `BASELINE_SKIP_NOT_PERMITTED`.
   - `markArtefactSkipped` for `baseline.proof_library` succeeds and JSONB has `status='skipped'`, `skipped_at` set, `captured_at` null.
   - Version-gate failure: a fixture sub-account whose JSONB has `version: 2` causes `markArtefactCaptured` to throw `BASELINE_ARTEFACTS_VERSION_MISMATCH`.
   - For test cases that need a database, follow the existing test-double pattern in `server/services/__tests__/*.test.ts`. If the only available pattern requires a real db, restrict this test file to the pure version-gate + JSONB-shape assertions (using `assertVersionGate` directly + a hand-built JSONB) and let CI's gate suite cover the DB integration.

**Tests:** as in step 9.

**Verification:**
- `npm run lint`
- `npm run typecheck`
- `npx tsx server/services/__tests__/subaccountOnboardingArtefacts.test.ts`

**Commit:** `feat(artefacts): markArtefactCaptured + tier-3 workspace-memory write + atomic JSONB update`

---

## Chunk 3C — F1→F2 reader + workflow validator + capture-workflow wiring

**Goal:** Implement `getBaselineVoiceTone` (F1→F2 reader). Wire the capture-workflow's terminal completion to call `markArtefactCaptured` per step (Tier 1+2 use post-binding hook; Tier 3 uses explicit step-completion hook). Add the wizard-completability validator test.

**Phase:** 3

**Files:**
- modify: `server/services/memoryBlockService.ts` (add `getBaselineVoiceTone`)
- modify: the capture workflow runtime hook OR `server/lib/workflow/runtime` to call `markArtefactCaptured` on step completion for `baseline-artefacts-capture`
- create: `server/workflows/__tests__/baselineArtefactsCapture.test.ts`

**Steps:**
1. Add to `server/services/memoryBlockService.ts`:
   ```ts
   import type { BaselineVoiceTone } from '../../shared/types/baselineArtefacts.js';
   import { assertVersionGate } from '../../shared/schemas/subaccount.js';
   import { subaccounts } from '../db/schema/index.js';

   /**
    * F1 → F2 contract (spec §6b). Returns the parsed voice/tone artefact
    * when status='completed'; null otherwise. F2 imports this; F1 does not
    * import F2.
    */
   export async function getBaselineVoiceTone(
     organisationId: string,
     subaccountId: string,
   ): Promise<BaselineVoiceTone | null> {
     // 1. Version-gate the JSONB and check status.
     const [sub] = await db
       .select({ status: subaccounts.baselineArtefactsStatus })
       .from(subaccounts)
       .where(and(
         eq(subaccounts.id, subaccountId),
         eq(subaccounts.organisationId, organisationId),
       ));
     if (!sub) return null;
     const status = assertVersionGate(sub.status, 1);
     if (status.tier1.voice_tone.status !== 'completed') return null;

     // 2. Read the active block by reserved slug.
     const [block] = await db
       .select({ content: memoryBlocks.content, updatedAt: memoryBlocks.updatedAt })
       .from(memoryBlocks)
       .where(and(
         eq(memoryBlocks.organisationId, organisationId),
         eq(memoryBlocks.subaccountId, subaccountId),
         eq(memoryBlocks.name, 'baseline.voice_tone'),
         eq(memoryBlocks.status, ACTIVE_STATUS),
         isNull(memoryBlocks.deletedAt),
       ));
     if (!block) return null;

     // 3. Parse the JSON payload (the workflow stores form output via
     //    knowledgeBindings → upsertFromWorkflow, which stringifies the
     //    object payload). Defensively narrow.
     try {
       const parsed = JSON.parse(block.content) as Partial<BaselineVoiceTone>;
       if (
         !Array.isArray(parsed.descriptors) ||
         !Array.isArray(parsed.example_sentences) ||
         !Array.isArray(parsed.prohibited_phrases) ||
         (parsed.formality_level !== 'casual' && parsed.formality_level !== 'neutral' && parsed.formality_level !== 'formal')
       ) return null;
       return {
         descriptors: parsed.descriptors as string[],
         example_sentences: parsed.example_sentences as string[],
         prohibited_phrases: parsed.prohibited_phrases as string[],
         formality_level: parsed.formality_level,
         captured_at: block.updatedAt,
       };
     } catch {
       return null;
     }
   }
   ```
2. Capture-workflow terminal completion hook. For Tier 1+2, the existing `finaliseRun()` → `upsertFromWorkflow` chain creates/updates the memory block. We need a follow-up that:
   - Resolves the `memoryBlockId` for each just-upserted Tier-1/2 block.
   - Calls `subaccountOnboardingService.markArtefactCaptured(...)` for each.
   For Tier 3, the workflow step's `outputSchema` carries the user payload; on step completion we call `markArtefactCaptured` with `tier3Payload`.
3. Implementation path: add a workflow lifecycle hook keyed off `workflowSlug === 'baseline-artefacts-capture'` inside the existing `finaliseRun` (locate the current `knowledgeBindings` loop; add a follow-up loop).
   - For each step in the run whose `id` matches a slug-short of `BASELINE_SLUGS`:
     - If the step is Tier 1+2: lookup the upserted block (`memory_blocks.name = 'baseline.<slug-short>'` AND `subaccount_id = <run.subaccount_id>`), capture its `id`, call `markArtefactCaptured({ memoryBlockId })`.
     - If Tier 3: build `tier3Payload` from the step's persisted output, call `markArtefactCaptured({ tier3Payload })`.
   - For any tier-3 step explicitly skipped (a "skip" affordance in the wizard step), call `markArtefactSkipped` instead with `reason: 'defer_for_later'`.
4. Emit `artefact.capture.started` from the wizard step entry — that emit lives in chunk 4A (client → server route call) and is scaffolded here as a `subaccountOnboardingService.recordArtefactStarted(subaccountId, slug, userId)` helper that just emits the event. Add the helper now (~10 LOC, no DB write).
5. Author `server/workflows/__tests__/baselineArtefactsCapture.test.ts`:
   - `isWizardCompletable` against a status with `tier1.brand_identity.status='in_progress'` returns false.
   - `isWizardCompletable` with all Tier-1+2 `completed` and Tier-3 `not_started` returns true.
   - `isWizardCompletable` with all Tier-1+2 `completed` and Tier-3 `skipped` returns true.
   - Workflow definition (imported via `import workflow from '../baseline-artefacts-capture.workflow.js'`) has six steps with the correct ids, four `knowledgeBindings` (Tier 1+2 only), `autoStartOnOnboarding: true`.
   - `getBaselineVoiceTone` against a stubbed db returning `status: not_started` returns null. Returns null when block content is malformed JSON. Returns the typed shape when both status and content are valid.
6. Confirm by reading `server/lib/workflow/runtime` (or wherever `finaliseRun` lives — grep for `finaliseRun` if path not obvious) that the post-binding hook does not re-fire on workflow re-runs. The wizard runs once per sub-account; future edits go through `<EditArtefactDrawer>` which calls a different code path (chunk 4B).

**Tests:** as in step 5.

**Verification:**
- `npm run lint`
- `npm run typecheck`
- `npx tsx server/workflows/__tests__/baselineArtefactsCapture.test.ts`

**Commit:** `feat(artefacts): F1->F2 voice-tone reader + capture-workflow completion hook`

---

## Chunk 4A — OnboardingWizardPage new step "Tell us about your client"

**Goal:** Insert a new wizard step after sync, before done. Launch the `baseline-artefacts-capture` workflow inline. Pre-fill brand-identity step from sub-account name + GHL data when available. Block "done" until `isWizardCompletable` returns true (Tier 1+2 must be `completed`).

**Phase:** 4

**Files:**
- modify: `client/src/pages/OnboardingWizardPage.tsx`

**Steps:**
1. Update `STEPS = ['Connect GHL', 'Select clients', 'Syncing', 'Tell us about your client', 'Done']` (5 steps now).
2. Author a new component `Step4Baseline({ onComplete }: { onComplete: () => void })`:
   - Reads owed onboarding workflows for the active sub-account via existing `subaccountOnboardingService` route (find via grep: there is likely already a `GET /subaccounts/:id/onboarding/workflows` endpoint shipping `OwedOnboardingWorkflow[]`).
   - Locates the `baseline-artefacts-capture` slug; if its `latestRun` is null OR not terminal, render the workflow's `user_input` steps inline using the existing `WorkflowRunInline` component (or the equivalent — confirm by searching client for the workflow runner used in `intelligence-briefing` onboarding entry).
   - On final step terminal completion, calls `onComplete()`.
   - Pre-fill: brand-identity step receives `name = subaccount.name`, `geography = subaccount.metadata?.country ?? ''`, etc. via `initialValues` prop on the form. Pre-fill is best-effort; user edits before submit.
3. Block forward navigation: the existing wizard `currentStep` state controls the StepBar. Step 4 cannot transition to step 5 ("Done") unless the server's status JSON satisfies `isWizardCompletable`. Add a server endpoint `GET /api/onboarding/baseline-artefacts-status?subaccountId=...` returning the parsed JSONB. Client polls on step entry and after every form submission. (If the existing onboarding API already exposes this state, reuse it; do not introduce a new route just for this.)
4. Skip-and-complete-later affordance for Tier 3: each Tier-3 step (`operating_constraints`, `proof_library`) shows a "Skip for now" button that posts to `/api/subaccounts/:id/baseline-artefacts/:slug/skip` (server route: chunk 4B owns the route handler — confirm cross-chunk dependency or move the route handler into 4A if 4B is delayed).
5. **Cross-chunk dependency:** the skip and edit routes land in 4B. Chunk 4A consumes the read endpoint already exposed by `subaccountOnboardingService.listOwedOnboardingWorkflows` plus the new status read endpoint. The skip and edit POST routes are 4B. If 4A ships before 4B, the skip button is hidden behind a feature flag — but per `docs/spec-context.md` we do NOT use feature flags. Resolution: 4A and 4B land in a single PR; the executor must complete BOTH before opening the PR.
6. Telemetry emit: on step entry into step 4, the client posts `POST /api/onboarding/baseline-artefacts/started` with `{ subaccountId, slug }` per substep — handler emits `artefact.capture.started`. The handler is a single ~15-LOC file `server/routes/onboardingArtefacts.ts` (or wherever onboarding routes live; grep for `onboarding/notify-on-complete` to find the file). Add it here in 4A so the telemetry is end-to-end.
7. Re-check the five frontend rules from CLAUDE.md `Frontend Design Principles`:
   - Primary task per screen: ONE — capture the artefacts. No KPI tiles, no aggregated dashboards.
   - Default to hidden: the page shows the active step's form ONLY. No status grid, no progress chart.
   - Inline state: per-step "saved" inline; no separate dashboard.
   - Re-check: a non-technical operator should complete each form without overwhelm. Forms must be plain text inputs, no jargon.

**Tests:** none (frontend; per `docs/spec-context.md` `frontend_tests: none_for_now`). Manual verification only.

**Verification:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Commit:** `feat(artefacts): onboarding wizard new step "Tell us about your client" + status read endpoint`

---

## Chunk 4B — `<EditArtefactDrawer>`, status badge, Knowledge wiring, edit + skip routes

**Goal:** Component for post-onboarding edits per artefact. Status badge surfaces inline state on the subaccount detail page. Knowledge page wires the drawer. Server routes: skip (Tier 3 only) and edit (all six).

**Phase:** 4

**Files:**
- create: `client/src/components/baseline/EditArtefactDrawer.tsx`
- create: `client/src/components/baseline/BaselineArtefactsStatusBadge.tsx`
- modify: `client/src/pages/SubaccountKnowledgePage.tsx`
- modify: `server/routes/onboardingArtefacts.ts` (created in 4A) — add edit + skip handlers
- modify: `server/services/subaccountOnboardingService.ts` — `markArtefactEdited` method emitting `artefact.capture.edited`

**Steps:**
1. `<EditArtefactDrawer artefactSlug=...>` props:
   - `artefactSlug: BaselineSlug`
   - `subaccountId: string`
   - `open: boolean`, `onClose: () => void`, `onSaved: () => void`
   The drawer fetches the current memory-block content (Tier 1+2) or workspace-memory-entry content (Tier 3) and renders the SAME form schema used in the workflow step — share the schema definition between client and server by exporting the per-step form schemas from `shared/schemas/baselineArtefactsForms.ts` (new file — add to chunk's file list). On submit, posts to `PATCH /api/subaccounts/:id/baseline-artefacts/:slug` with the form payload. Server route validates against the shared schema, calls a new `subaccountOnboardingService.markArtefactEdited(...)` which:
   - Reads `prior_version`: hash of current content.
   - Replaces content (for Tier 1+2: `updateBlockAdmin` with the slug's row id; for Tier 3: insert new entry with `provenanceSourceType='manual'` and soft-delete the old entry, OR update in place — match the existing Knowledge edit pattern in `workspaceMemoryService`).
   - Emits `artefact.capture.edited` with `prior_version` and `new_version` hashes.
2. `<BaselineArtefactsStatusBadge subaccountId=... />`:
   - Compact inline component. Reads the JSONB. Renders: dot color per artefact (green=completed, gray=not_started, amber=in_progress, slate=skipped) with a tooltip showing the slug name. NO numbers, NO counts displayed prominently — inline state, not a dashboard (CLAUDE.md frontend rule 4).
3. `SubaccountKnowledgePage.tsx`: add a "Baseline" section that lists the six slugs, each row clickable to open `<EditArtefactDrawer>`. Reuse the existing memory-block list rendering pattern; wrap baseline rows with the drawer trigger.
4. Server routes in `server/routes/onboardingArtefacts.ts`:
   - `POST /api/subaccounts/:subaccountId/baseline-artefacts/:slug/skip` — Tier 3 only. Calls `markArtefactSkipped({ reason })`. Returns 400 with `BASELINE_SKIP_NOT_PERMITTED` for Tier 1+2.
   - `PATCH /api/subaccounts/:subaccountId/baseline-artefacts/:slug` — all six. Calls `markArtefactEdited`. Body validated against the shared form schema for that slug.
   - `GET /api/subaccounts/:subaccountId/baseline-artefacts-status` — read the parsed JSONB.
   - All three routes use the `asyncHandler` pattern (per `architecture.md`) and `resolveSubaccount(subaccountId, orgId)` guard. Permissions: any user with `subaccount:read` for status; `subaccount:write` for skip/edit.
5. **State machine closure (spec authoring checklist §10.7):** the per-artefact status enum is closed at `not_started | in_progress | completed | skipped`. Valid transitions:
   - `not_started → in_progress` (wizard step entry)
   - `in_progress → completed` (wizard step terminal completion via `markArtefactCaptured`)
   - `not_started → skipped` (Tier 3 only, via `markArtefactSkipped`)
   - `completed → completed` (post-onboarding edit; status unchanged but `captured_at` updates and `artefact.capture.edited` emits)
   Forbidden:
   - `completed → not_started` (no "uncomplete" affordance)
   - `skipped → not_started` (instead, edit moves it to `completed`)
   - `* → in_progress` from any non-`not_started` start (re-running the wizard is not a supported flow)
   The validator in chunk 1B enforces the type-level invariants (status enum closed, mutual exclusion); the runtime predicates `markArtefactCaptured` / `markArtefactSkipped` / `markArtefactEdited` enforce transition validity by inspecting current status before mutation.
6. **Idempotency posture per route:**
   - Skip: state-based; precondition `tier3.{slug}.status IN ('not_started')` — UPDATE WHERE that predicate. 0 rows affected = race; return 409 with the current state.
   - Edit: state-based; precondition `tier{N}.{slug}.status = 'completed'`. Concurrent edits collapse to last-write-wins on content hash; the `prior_version` field captures the value at read time so the client can detect concurrent edits and re-prompt.
   - Status read: pure read, idempotent, no concurrency concern.

**Tests:** none for the client components; the server routes are exercised via the Tier-3 path test in chunk 3B. Add no new test files in 4B (per spec-context.md `api_contract_tests: none_for_now`).

**Verification:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:client`

**Commit:** `feat(artefacts): edit drawer + status badge + skip/edit/status routes`

---

## Chunk 5 — Closeout: manual verification + capability docs + progress note

**Goal:** Hand-verify the end-to-end flow against a fresh sub-account. Update human-facing docs (`docs/capabilities.md`, `architecture.md`) so future readers see the feature in canonical references. Close out the build progress file.

**Phase:** 5

**Files:**
- modify: `docs/capabilities.md` — add the Sub-account context capability + the six artefacts.
- modify: `architecture.md` — register `domain='baseline'` as reserved keyword in the Memory and context section. Cite spec.
- modify: `tasks/builds/subaccount-artefacts/progress.md` — write chunk-by-chunk closeout with PR link.
- modify: `KNOWLEDGE.md` — append a single closing entry per `docs/doc-sync.md`'s "single closing entry per build" rule.

**Steps:**
1. Manual verification:
   - Create a fresh sub-account via the onboarding wizard.
   - Walk through the new "Tell us about your client" step end-to-end. Submit each form.
   - Confirm `subaccounts.baseline_artefacts_status` row reflects six `completed` (or five completed + one skipped for Tier 3).
   - Confirm `memory_blocks` rows exist with the four reserved slugs, `tier=1|2`, `applies_to_domains` set on Tier 2.
   - Confirm `workspace_memory_entries` rows exist with `domain='baseline'` for the two Tier-3 artefacts.
   - Trigger an agent run for that sub-account; inspect the system prompt (via the run's `appliedMemoryBlockIds` or via dev tools): Tier-1 blocks present at the top of the memory-blocks section. Tier-2 blocks present only if the agent's role maps to a matching domain.
   - Open the Knowledge page for the sub-account; click each baseline slug; confirm the drawer renders with the correct form, edit, save. Edit re-emits `artefact.capture.edited`.
   - Confirm token-budget telemetry shows < 1k tokens combined for Tier 1+2 (matches spec §8 functional outcome).
2. `docs/capabilities.md`:
   - Locate the Sub-account context section (or create one near other foundational sub-account capabilities).
   - Describe the six artefacts and tier loading. Vendor-neutral, present-tense for shipped capability. NO em-dashes (per user preferences); use commas/colons. Editorial rules apply.
   - Example: "Sub-accounts capture six baseline artefacts at onboarding: brand identity, voice and tone, offer positioning, audience profile, operating constraints, and proof library. The first two ship with every client-touching agent run; the next two ship when the agent's role matches the artefact's domain; the last two are retrieved on demand via workspace memory."
3. `architecture.md`:
   - In the Memory and context section, add a one-liner: "`domain='baseline'` in `workspace_memory_entries` is a reserved keyword for the F1 Sub-Account Baseline Artefact set; see `docs/sub-account-baseline-artefacts-spec.md`."
   - Register the tier loader path in the Key files per domain index: row entry "Sub-account baseline artefacts" → `server/services/memoryBlockService.ts` (loader), `server/workflows/baseline-artefacts-capture.workflow.ts` (capture), `shared/constants/baselineArtefacts.ts` (slug registry).
4. `tasks/builds/subaccount-artefacts/progress.md`:
   - Chunk-by-chunk closeout: chunk number, completion date, commit SHA, PR link.
   - Note any deviations from the plan and why.
   - Note any deferred items (proof-library file-upload UX may need round-trip iteration; if so, document under `## Deferred Items` here).
5. `KNOWLEDGE.md`:
   - Append a single entry summarising the F1 build:
     > **F1 Sub-Account Baseline Artefacts (2026-05-XX).** Migration 0277 added `memory_blocks.tier`, `memory_blocks.applies_to_domains`, `subaccounts.baseline_artefacts_status` JSONB. Six reserved-slug artefacts are captured at onboarding via `baseline-artefacts-capture` workflow. Tier-1 blocks are pinned hash-stable to system prompt; Tier-2 blocks load when agent domain matches; Tier-3 lives in workspace memory under `domain='baseline'`. F1→F2 contract: `memoryBlockService.getBaselineVoiceTone(orgId, subaccountId)` returns the parsed brand-voice payload when status is `completed`. JSONB shape locked by `shared/schemas/subaccount.ts:baselineArtefactsStatusSchema` with `version: 1` gate; service code refuses unknown versions.

**Tests:** None added in chunk 5 (closeout). The verification step in step 1 is a manual smoke walk; CI test gates run on the PR.

**Verification:**
- `npm run lint`
- `npm run typecheck`
- (No targeted test in this chunk.)

**Commit:** `docs(artefacts): capabilities + architecture + KNOWLEDGE entries; close out F1`

---

## Risks and mitigations

### R1 — Token-budget regression on every client-touching agent run

Tier-1 always loads. Per spec §1, ~400 tokens per run. Cumulative with Tier 2 (~550 when domain matches): up to ~1k tokens added to the system prompt for any sub-account that has captured.

- **Mitigation:** hash-stable ordering inside `stablePrefix` (chunk 2A) means cached-context prefix-hashing absorbs the cost. The 1k tokens land once per stable-prefix mutation, not once per run.
- **Verify:** chunk 5 manual check confirms `< 1k token impact for tier 1+2 combined` (spec §8 functional outcome).

### R2 — JSONB version-gate trap

`assertVersionGate` throws when `version != 1`. This means a future migration that bumps version without backfilling existing rows will break F1 reads. The spec says "any future redesign bumps version and gates the migration on the prior shape" — that obligation lives outside F1.

- **Mitigation:** chunk 1B includes the version-gate test (`version: 2` rejected). The Correction entry in `KNOWLEDGE.md` chunk 5 records the gate so future migration authors know to backfill.

### R3 — Tier-3 write is NOT idempotent against re-runs

If the wizard step is re-fired (e.g. duplicate-submit on slow network), a second `markArtefactCaptured` for Tier 3 inserts a SECOND `workspace_memory_entries` row. The JSONB `workspace_memory_id` would point to the latest, leaving the prior row orphaned.

- **Mitigation:** chunk 3B step 8 documents the intended behaviour (wizard guarantees once-per-step). The skip and edit routes in chunk 4B use state-based predicates that reject double-fire (`UPDATE WHERE status = 'expected_pre_state'`). For the wizard initial-capture path, the workflow runtime's own duplicate-step guard prevents re-fire (`workflow_runs_one_active_per_task_idx` from migration 0276).
- **Residual risk:** if the workflow's `finaliseRun()` retries after a partial failure (write succeeded, JSONB update failed), the next attempt inserts a duplicate. Acceptance: chunk 3B's atomic SQL update uses a single statement; a partial failure after the WS-memory write but before the JSONB update is detectable in the `artefact.capture.completed` event audit trail (no event for the orphan). Document under `## Deferred Items` in `progress.md` if observed in production.

### R4 — Soft conflict with manually-named blocks

Spec §10: if an org already has a manual block named `baseline.brand_identity`, capture will fail (unique index `memory_blocks_org_name_idx`).

- **Mitigation:** the `upsertFromWorkflow` `workflowSlug` predicate path: when `workflowSlug='baseline-artefacts-capture'` AND a non-baseline block with the conflicting name exists (i.e. its `tier IS NULL`), throw a 409 `BASELINE_SLUG_CONFLICT` error and surface in the wizard. User must rename the existing block or accept that the baseline workflow takes the slug.
- **Build action:** chunk 3B `upsertFromWorkflow` extension MUST detect this conflict pre-write. Add a SELECT before the upsert; if a row with the slug exists and its `tier IS NULL`, throw.

### R5 — Concurrent F3 work on the same files

F3 (next sub-stream) extends `subaccountOnboardingService.ts`. F3 cannot start until F1 PR is merged (per `tasks/builds/stream-1-onboarding-scope/plan.md`).

- **Mitigation:** sequential merge order. The plan in this file ships F1 standalone.

### R6 — Frontend forms are non-verifiable work

The capture-workflow forms (six steps, pre-fill, skip-and-complete-later) involve UX taste. CLAUDE.md `Verifiability heuristic` calls these out as needing human-in-the-loop iteration.

- **Mitigation:** chunk 4A and 4B should NOT be subagent-driven overnight. Sit with the wizard, iterate visually, run a real onboarding flow before opening the PR.

### R7 — `appliesToDomains` mapping drift between F1 and `agentRoleToDomain`

Tier-2 domain identifiers MUST match the strings produced by `agentRoleToDomain` in `workspaceMemoryService.ts`. If `agentRoleToDomain` adds a new domain (e.g. `legal`), the F1 mapping in `shared/constants/baselineArtefacts.ts` will not pick it up automatically.

- **Mitigation:** chunk 1B `__tests__/baselineArtefacts.test.ts` step 4 asserts every Tier-2 domain is in the valid-domain set. Update the test fixture when `agentRoleToDomain` evolves. Add a note to the constants file pointing at `agentRoleToDomain` as the canonical source.

---

## Self-consistency pass — coverage check against spec §8 Done definition

| §8 functional outcome | Covered by chunk(s) | Asserted by |
|---|---|---|
| All six artefacts capturable via wizard | 3A (workflow), 4A (wizard step) | manual verification in chunk 5 |
| Tier-1 blocks present in system prompt of any client-touching agent run for a sub-account that has captured them | 2A | chunk 2A test + chunk 5 manual |
| Tier-2 blocks present only when agent domain matches | 2B | chunk 2B test |
| Tier-3 retrievable via existing workspace memory paths | 3B (write); existing `workspaceMemoryService` (read) | chunk 5 manual |
| Token-budget telemetry shows < 1k tokens for Tier 1+2 combined | 2B telemetry emit | chunk 5 manual |
| `subaccounts.baseline_artefacts_status` accurately reflects capture state | 1A (column), 1B (schema), 3B (`markArtefactCaptured`) | chunk 1B + 3B tests |
| Riley docs accurately reflect shipped/unshipped state | 0 | chunk 0 doc verification |
| All 5 §6a telemetry events emit at correct state transitions | 2B (1 event), 3A (4 events), 3B/3C/4A/4B (emit sites) | event-name registry compile-time enforcement + manual trace inspection |

| §8 hard invariant | Covered by chunk(s) | Test assertion |
|---|---|---|
| Status enum locked. Tier-1 + Tier-2 wizard cannot complete with `not_started` or `in_progress` | 1B `isWizardCompletable`, 3C workflow validator test | `baselineArtefactsCapture.test.ts` |
| `skipped` is Tier-3-only | 1B refinement, 3B `markArtefactSkipped` guard | `subaccount.test.ts` + `subaccountOnboardingArtefacts.test.ts` |
| `captured_at` and `skipped_at` mutually exclusive | 1B refinement | `subaccount.test.ts` |
| `version` gate refuses unknown shape | 1B `assertVersionGate`, 3B + 3C use it | `subaccount.test.ts` + `subaccountOnboardingArtefacts.test.ts` version-gate failure case |
| F1→F2 contract honoured: `getBaselineVoiceTone` returns null for non-completed, parsed shape for completed | 3C | `baselineArtefactsCapture.test.ts` `getBaselineVoiceTone` cases |

Every §8 item is mapped to at least one chunk and one assertion. Goals align with implementation. No load-bearing claim is left without a named mechanism.

---

## File inventory cross-check vs spec §7

Spec §7 lists these files; this plan covers each:

| Spec §7 file | Plan chunk | Notes |
|---|---|---|
| `server/services/agentExecutionService.ts` | 2A, 2B | Loader integration at lines ~896 (memory blocks) and ~1005 (`agentDomain`); ~30 LOC |
| `server/services/memoryBlockService.ts` | 2A, 2B, 3B, 3C | `getTier1Blocks`, domain filter on `getBlocksForInjection`, `tier`/`appliesToDomains` on `upsertFromWorkflow`, `getBaselineVoiceTone` |
| `server/services/subaccountOnboardingService.ts` | 3B, 3C, 4B | `markArtefactCaptured`, `markArtefactSkipped`, `markArtefactEdited`, `recordArtefactStarted` |
| `server/db/schema/memoryBlocks.ts` | 1A | `tier` + `appliesToDomains` columns |
| `server/db/schema/subaccounts.ts` | 1A | `baselineArtefactsStatus` column |
| `server/workflows/baseline-artefacts-capture.workflow.ts` | 3A | New file |
| `server/lib/tracing.ts` | 2B (1 event), 3A (4 events) | Five new event names |
| `shared/constants/baselineArtefacts.ts` | 1B | New |
| `shared/schemas/subaccount.ts` | 1B | New (creates `shared/schemas/` directory) |
| `shared/types/baselineArtefacts.ts` | 1B | New, F1→F2 contract |
| `client/src/pages/OnboardingWizardPage.tsx` | 4A | New step |
| `client/src/components/baseline/EditArtefactDrawer.tsx` | 4B | New |
| `client/src/components/baseline/BaselineArtefactsStatusBadge.tsx` | 4B | New |
| `client/src/pages/SubaccountKnowledgePage.tsx` | 4B | Drawer wiring |
| Tests (4 files) | 1B (×2), 2A, 2B, 3B, 3C | Five test files total — slightly more than spec §7's four; we split slug/schema tests |

Additional files this plan introduces beyond spec §7:
- `migrations/0277_subaccount_baseline_artefacts.sql` + `.down.sql` (chunk 1A) — implied by §3.
- `server/config/limits.ts` — adds `MEMORY_BLOCK_TIER2_BOOST` constant (chunk 2B). Spec §4 references this.
- `server/routes/onboardingArtefacts.ts` — three routes (status read, skip, edit). Spec §5 references the post-onboarding edit surface.
- `shared/schemas/baselineArtefactsForms.ts` (chunk 4B step 1) — shared form schemas between client and workflow. Reuses zod from chunk 3A's workflow definition; the executor may collapse this back into the workflow file if extraction is awkward.

Spec §7 deferred items: none. The §8 done definition is fully covered.

---

## Deferred Items

None at plan time. If the manual verification in chunk 5 surfaces issues (e.g. proof-library upload UX needs iteration, telemetry format changes), document them in `tasks/builds/subaccount-artefacts/progress.md` under `## Deferred Items` rather than expanding this plan.

---

## Sign-off

Plan ready for execution on Sonnet via `superpowers:subagent-driven-development`. Each chunk is independently buildable; chunks 4A and 4B should be paired in a single PR per chunk-4A step 5.

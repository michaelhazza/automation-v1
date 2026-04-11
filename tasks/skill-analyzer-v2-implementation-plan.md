# Skill Analyzer v2 — Consolidated Implementation Plan

**Spec:** `docs/skill-analyzer-v2-spec.md` (frozen, revision 2)
**Plan author:** architect agent
**Date:** 2026-04-11
**Target branch:** `bugfixes-april26` (spec will ship as a single PR in one session; per-phase commits below are for bisectability)

## Table of contents

1. Summary
2. Open-item resolutions
3. Per-phase plan
   - Phase 0 — System skill DB migration + handler registry + startup validator
   - Phase 1 — Analyzer rescope + GET response extensions + handler gate
   - Phase 2 — Agent embed + propose pipeline + execute agent-attach
   - Phase 3 — Classify-stage merge proposal
   - Phase 4 — Review UI agent chips + PATCH endpoints
   - Phase 5 — Review UI three-column merge view + merge PATCH/reset
4. Cross-phase risks
5. Cut lines

---

## 1. Summary

Skill Analyzer v2 is a six-phase feature that (a) migrates `system_skills` from file-based to DB-backed while preserving the existing `systemSkillService` public API, (b) rescopes the analyzer to operate exclusively on system skills and system agents, (c) adds agent-proposal scoring to the pipeline so DISTINCT candidates ship with top-K=3 pre-selected system-agent attachments, and (d) adds an LLM-generated three-column merge view for PARTIAL_OVERLAP / IMPROVEMENT cards with inline edit, reset-to-original, and atomic per-result transactions on execute. The whole feature is six phases: Phase 0 (DB migration + handler registry + startup validator) → Phase 1 (analyzer rescope + GET response extensions + handler gate) → Phase 2 (agent-embed + agent-propose + execute agent-attach) → Phase 3 (classify-stage merge proposal) → Phase 4 (Review UI agent chips + PATCH endpoints) → Phase 5 (three-column merge view + merge PATCH/reset). The build ships as a single PR in one session, with per-phase commits preserved for bisectability.

---

## 2. Open-item resolutions

### 2.1 Diff library selection — custom jsdiff-backed renderer

**Decision:** Add `diff` (kpdecker/jsdiff) as a runtime dependency and write a small custom React renderer over its `diffWordsWithSpace` / `diffLines` APIs. Do NOT add `react-diff-view`.

**Reasoning:** I checked `package.json` (there is only one root `package.json` — this is a monorepo with client + server sharing deps). Neither `diff`, `react-diff-view`, `diff2html`, nor `jsdiff` is currently installed, so every option adds at least one new dep. `react-diff-view` is a heavier component library (pulls `gitdiff-parser`, opinionated CSS, and a file-tree/unified-split abstraction) that is tuned for rendering git-style unified patches — the spec's requirements (§7.1) are three independent panels with inline highlighting only on the Recommended column, synced scrolling across three panels, and inline editing of the Recommended column. None of that maps cleanly onto `react-diff-view`'s `<Diff>` / `<Hunk>` abstraction without fighting it. `diff` is a small, well-maintained library (no React bindings, no CSS) whose token-level output is trivial to render as spans, which is the exact contract the spec asks for. The Phase 5 pure helper `deriveDiffRows` in `skillAnalyzerServicePure.ts` will wrap `diffWordsWithSpace` so the diff algorithm is tested at the pure layer; the React component is a thin renderer.

**Files cited:** `package.json` (root, no client-side diff library present).

### 2.2 `agent_embeddings` invalidation policy — lazy (confirm)

**Decision:** Lazy invalidation, at the Agent-embed pipeline stage. `agent_embeddings.contentHash` is recomputed at every analyzer run; stale rows are silently overwritten when the hash differs. No eager invalidation from `systemAgentService.updateAgent`.

**Reasoning:** Eager invalidation would require `systemAgentService.updateAgent` to either delete-or-null the embedding row on every master-prompt edit (adds a foreign coupling — `systemAgentService` has no current dependency on `agentEmbeddingService`) or enqueue a refresh job (adds a pg-boss edge and failure mode for a path that only matters inside the analyzer pipeline). The spec's agent-embed stage already does a content-hash comparison before recomputing, so lazy is both correct and cheap: a stale row costs zero until the next analyzer run, at which point it is detected and refreshed as part of normal Phase 2 work. This also matches the `skill_embeddings` pattern already in the codebase — both use content-hash upsert semantics, not eager invalidation. The manual-add flow in §6.2 / §7.3 calls `refreshSystemAgentEmbedding(systemAgentId)` which is a single-agent lazy refresh, so the manual path is covered too.

**Files cited:** `server/jobs/skillAnalyzerJob.ts` (existing embed stage uses content-hash upsert), `server/db/schema/skillEmbeddings.ts` (content-hash-keyed model referenced in spec §5.2).

### 2.3 `definition` validation on merge edits — inherit from `updateSystemSkill`, no forked validator

**Decision:** The merge PATCH endpoint at `PATCH /api/system/skill-analyser/jobs/:jobId/results/:resultId/merge` does NOT duplicate validation. It stores the incoming `definition` as-is into `proposedMergedContent` (jsonb). The real validation gate is `systemSkillService.updateSystemSkill` at execute time. The PATCH endpoint performs only the shape check the spec requires at §7.3 ("definition must be a plain object matching the Anthropic tool-definition shape") — implemented via a small shared predicate `isValidToolDefinitionShape(def: unknown): def is AnthropicTool` placed in `shared/skillParameters.ts` (which already exports `buildToolDefinition` / `parseParameterSection` and owns the tool-definition contract) and reused by BOTH the PATCH endpoint AND `systemSkillService.createSystemSkill` / `updateSystemSkill`.

**Reasoning:** Forking a second validator risks drift — a schema change to the Anthropic tool-definition shape would need to be made in two places. Centralising the predicate in `shared/skillParameters.ts` means the PATCH endpoint, the create/update service methods, and the Phase 0 backfill script all agree on "what counts as a valid tool definition." The execute path is the backstop: if a malformed `definition` somehow reaches `updateSystemSkill`, the service throws `{ statusCode: 400, message: 'definition must be a tool-definition object' }` before any DB write and the per-result transaction rolls back.

**Files cited:** `shared/skillParameters.ts` (referenced by `server/services/systemSkillService.ts:6` via `buildToolDefinition` / `parseParameterSection`).

### 2.4 Phase 0 backfill trigger — one-shot script (confirm)

**Decision:** `scripts/backfill-system-skills.ts` is a one-shot tsx script. It is NOT wired into server bootstrap. The developer runs it once after the Phase 0 migration is applied (`npm run migrate && tsx scripts/backfill-system-skills.ts`). A follow-up `npm` script `skills:backfill` is added to `package.json` so the invocation is discoverable.

**Reasoning:** Auto-on-startup is attractive for fresh environments (one less step) but adds two risks that matter even pre-production: (1) a parse failure on a malformed `.md` file would crash the server at startup rather than surfacing as a script error, and (2) once the DB is the source of truth, running the backfill on every boot would silently rewrite any DB-only edits back to the markdown baseline unless the script is carefully written to skip rows that already exist with a different hash — adding conditional logic that defeats the "idempotent upsert" simplicity. A one-shot script is safer, more honest about its role, and can be promoted to auto-on-startup later if the team decides fresh-environment setup is painful. The `server/skills/README.md` note will document the manual-run convention.

**Files cited:** spec §10 Phase 0, `package.json` (existing `skills:apply-visibility` script precedent).

### 2.5 Analyzer library read filter — include `isActive = false` (confirm)

**Decision:** The analyzer's library read (`skillAnalyzerJob.ts` Hash / Embed / Compare stages) uses `systemSkillService.listSkills()` and includes all rows regardless of `isActive`. No analyzer-side filter is layered on top. The Review UI surfaces match metadata (`matchedSkillContent`) as-is; a match against an `isActive = false` row is visible to the reviewer via the matched row's `isActive` field in `matchedSkillContent`.

**Reasoning:** Spec §10 Phase 0 explicitly describes the `listSkills()` contract as "returns all rows regardless of either flag" and the §11 open item confirms the rationale: including inactive rows prevents the analyzer from re-importing a duplicate of a retired skill. Filtering out inactive rows on the analyzer side would reintroduce that hazard. The edge case the spec handles — a matched inactive row whose `handlerKey` is no longer registered — is already guarded at execute time by the PARTIAL_OVERLAP branch in §8 (re-reads the matched row and fails with a clear `executionError` if the slug is not in `SKILL_HANDLERS`). The Review UI does NOT need to warn about this pre-approval because the server is the authority.

**Files cited:** spec §10 Phase 0 (`listSkills()` contract), §8 PARTIAL_OVERLAP branch (handler re-check), §11 open item 5.

---

## 3. Per-phase plan

Each phase ends green on the relevant gates before the next begins. Phases are sequential; Phase 5 can run in parallel with Phase 4 on the client only.

### Phase 0 — System skill DB migration + handler registry + startup validator (server)

#### Files to create

- `c:\Files\Projects\automation-v1\migrations\0097_system_skills_db_backed.sql` — Drizzle-generated. Adds `visibility` text column (default `'none'`, CHECK `visibility IN ('none','basic','full')`), `handler_key` text NOT NULL UNIQUE, on `system_skills`. No other schema changes in this migration.
- `c:\Files\Projects\automation-v1\scripts\backfill-system-skills.ts` — tsx script that parses every `server/skills/*.md` file via the existing parser (lifted or imported from `systemSkillService`), validates `handlerKey = slug` and `slug in SKILL_HANDLERS`, upserts by slug. Idempotent. Fails fast and exits non-zero on unregistered handlers or parse errors. Writes a one-line summary per row.
- `c:\Files\Projects\automation-v1\server\services\systemSkillHandlerValidator.ts` — exports `validateSystemSkillHandlers(): Promise<void>`. Queries `system_skills WHERE is_active = true`, reads `handler_key` per row, asserts each resolves to a key in the `SKILL_HANDLERS` registry. Throws `SystemSkillHandlerError` listing any missing keys. Inactive rows are ignored.
- `c:\Files\Projects\automation-v1\server\services\systemSkillServicePure.ts` — pure markdown parser extracted from the current `systemSkillService.ts` (`parseSkillFile`, `extractSection`, visibility-from-frontmatter logic). Used by the backfill script AND by any seed path. Pure so it can be unit-tested without fs.
- `c:\Files\Projects\automation-v1\server\services\__tests__\systemSkillServicePure.test.ts` — covers: frontmatter parse happy path, CRLF normalisation, `isVisible: true` legacy fallback → `full`, missing `## Parameters` → null return, JSON parse error → null return.
- `c:\Files\Projects\automation-v1\server\services\__tests__\systemSkillHandlerValidatorPure.test.ts` — pure unit test over a small helper that compares a set of active `handlerKey`s against a set of registered handlers. The DB-touching portion is thin; the diff logic is the pure kernel.
- `c:\Files\Projects\automation-v1\server\services\__tests__\skillHandlerRegistryEquivalence.test.ts` — asserts `Object.keys(SKILL_HANDLERS).sort()` matches a hard-coded list of the pre-refactor switch case labels. Prevents accidental handler loss during the switch→registry refactor.
- `c:\Files\Projects\automation-v1\server\skills\README.md` — one-page note explaining markdown files are now a seed source, runtime reads/writes go to `system_skills` table, backfill is `tsx scripts/backfill-system-skills.ts` (or `npm run skills:backfill`).

#### Files to modify

- `c:\Files\Projects\automation-v1\server\db\schema\systemSkills.ts` — add `visibility: text('visibility').notNull().default('none')` with a CHECK constraint in the `(table) => ({...})` block, and `handlerKey: text('handler_key').notNull()` with `uniqueIndex('system_skills_handler_key_idx').on(table.handlerKey)`. Keep all existing columns.
- `c:\Files\Projects\automation-v1\server\services\skillExecutor.ts` — replace the 111-case switch at `skillExecutor.execute()` (currently at line 298, switch opens at line 328, closes at line 1099) with a module-level `export const SKILL_HANDLERS: Record<string, SkillHandler>` constant. Each existing case body becomes a named async function or inline arrow; cases that currently use `await import('...')` for dynamic loading preserve the dynamic import inside the handler to maintain the current lazy-load behaviour. The `execute()` method becomes a thin lookup. Leaf-module invariant: this file must not import from `skillAnalyzerService.ts`, `skillAnalyzerServicePure.ts`, `skillAnalyzerJob.ts`, or `server/routes/skillAnalyzer.ts`.
- `c:\Files\Projects\automation-v1\server\services\systemSkillService.ts` — rewrite to be DB-backed. Preserve the full public API surface: `invalidateCache` (becomes a no-op façade), `listSkills`, `listActiveSkills`, `listVisibleSkills`, `getSkill`, `getSkillBySlug`, `updateSkillVisibility`, `resolveSystemSkills`, `stripBodyForBasic`. Add `createSystemSkill(input, opts?: { tx?: DrizzleTx })` and `updateSystemSkill(id, patch, opts?: { tx?: DrizzleTx })`. `createSystemSkill` throws if `input.handlerKey !== input.slug` or if `input.handlerKey` is not in `SKILL_HANDLERS`. `updateSystemSkill` does not accept `slug` or `handlerKey` in its patch type. Both methods accept an optional `tx` and run against `opts.tx ?? db`. Remove the in-memory cache entirely. `invalidateCache` stays as an exported no-op so callers compile unchanged.
- `c:\Files\Projects\automation-v1\server\routes\systemSkills.ts` — replace the `notSupported` 405 handler on `POST /api/system/skills` with a `createSystemSkill`-wired route: body `{ slug, name, description, definition, instructions, visibility?, isActive? }`, wraps `systemSkillService.createSystemSkill({ ...body, handlerKey: body.slug })`. The DELETE 405 handler stays. Rewire `GET /api/system/skills`, `GET /api/system/skills/:id`, and the visibility PATCH without signature changes.
- `c:\Files\Projects\automation-v1\server\index.ts` — add `await validateSystemSkillHandlers();` after DB connection is established but before `httpServer.listen(PORT, ...)` at line 365. Import from `./services/systemSkillHandlerValidator.js`.
- `c:\Files\Projects\automation-v1\shared\skillParameters.ts` — add and export `isValidToolDefinitionShape(def: unknown): def is AnthropicTool` predicate. Used by `systemSkillService.createSystemSkill` / `updateSystemSkill` and (in Phase 5) by the merge PATCH endpoint.
- `c:\Files\Projects\automation-v1\package.json` — add `"skills:backfill": "tsx scripts/backfill-system-skills.ts"` under `scripts`.

#### Key implementation notes

- The `system_skills_handler_key_idx` unique constraint matches the invariant `handlerKey = slug` — `slug` already has a unique index, so the new unique index on `handler_key` is structurally redundant but required by §5.5. Do not skip it.
- `systemSkillService` currently owns the in-memory cache. Callers that currently import `invalidateCache` continue to compile because the no-op façade preserves the symbol.
- `systemSkillService.getSkill(id)` historically takes a slug-style id (the file-based version sets `id = slug`). The DB-backed version must accept the DB UUID. Audit the 8 files that import `systemSkillService` to confirm each caller passes the correct key. The existing `server/routes/systemSkills.ts:17` calls `getSkill(req.params.id)` — confirm whether that param is slug or UUID in the route before switching.
- The `skillExecutor.ts` switch refactor is large but mechanical. Do it in two passes: (1) extract every case body into a named function above the `SKILL_HANDLERS` const; (2) build the registry map. Commit the registry equivalence test alongside so a lost case fails CI immediately.
- Transaction-threading contract: Phase 0 ships the `opts?: { tx?: DrizzleTx }` signature on `createSystemSkill` / `updateSystemSkill` even though no caller uses it yet. Phase 1 is the first caller to pass `tx`. Do NOT defer the signature to Phase 1.
- Backfill script ordering: the script reads frontmatter via the Pure parser, writes to DB, and prints per-row output. It must run AFTER the handler-registry refactor is in place (same commit) because it validates `slug in SKILL_HANDLERS` before writing.
- `updateSkillVisibility(slug, visibility)` stops rewriting `.md` files. The new implementation is `UPDATE system_skills SET visibility = $1 WHERE slug = $2 RETURNING *`.

#### Gates

- `npm run typecheck`
- `npm run lint`
- `npm run db:generate` — verify the Phase 0 migration file at `migrations/0097_system_skills_db_backed.sql` matches the schema diff. Exactly one new migration file.
- `npm test` (unit suite — the new `*Pure.test.ts` files plus the registry equivalence test)
- Manual smoke: fresh DB + `npm run migrate` + `npm run skills:backfill` + `npm run dev:server` + confirm the validator passes and the server binds its port.

#### Commit message

`feat(system-skills): migrate to DB-backed store with handler registry (Phase 0)`

---

### Phase 1 — Analyzer rescope + GET response extensions + handler gate (server)

#### Files to create

- `c:\Files\Projects\automation-v1\migrations\0098_skill_analyzer_v2_columns.sql` — Drizzle-generated. Adds `agent_proposals` jsonb NOT NULL DEFAULT `'[]'`, `proposed_merged_content` jsonb, `original_proposed_merge` jsonb, `user_edited_merge` boolean NOT NULL DEFAULT false, `candidate_content_hash` text NOT NULL on `skill_analyzer_results`. Drops `matched_system_skill_slug` and `matched_skill_name`. Re-points `matched_skill_id` comment to reference `system_skills.id` (soft FK, no constraint). Also adds the new `agent_embeddings` table per spec §5.1 — the table lands in Phase 1 even though the first caller is in Phase 2, per spec §10 Phase 1.
- `c:\Files\Projects\automation-v1\server\db\schema\agentEmbeddings.ts` — new schema file mirroring `skillEmbeddings.ts`. Columns: `systemAgentId uuid PK references system_agents(id) on delete cascade`, `contentHash text not null`, `embedding vector(1536)`, `updatedAt timestamptz default now()`.

#### Files to modify

- `c:\Files\Projects\automation-v1\server\db\schema\skillAnalyzerResults.ts` — add the four new columns (`agentProposals`, `proposedMergedContent`, `originalProposedMerge`, `userEditedMerge`, `candidateContentHash`), drop `matchedSystemSkillSlug` and `matchedSkillName`. `$inferSelect` / `$inferInsert` types flow through automatically.
- `c:\Files\Projects\automation-v1\server\db\schema\index.ts` — export `agentEmbeddings` from the new schema file.
- `c:\Files\Projects\automation-v1\server\jobs\skillAnalyzerJob.ts` — switch library reads in Hash / Embed / Compare stages from the mixed `skillService` / `systemSkillService` path to `systemSkillService.listSkills()` exclusively. Persist `candidateContentHash` on every result row in the Write stage. Keep the six-stage structure; Agent-embed / Agent-propose land in Phase 2.
- `c:\Files\Projects\automation-v1\server\services\skillAnalyzerService.ts` — rewrite `executeApproved()` per the §8 contract, DISTINCT / PARTIAL_OVERLAP / IMPROVEMENT / DUPLICATE branches. Remove the "Cannot update a system skill" rejection at line 228. Wrap each per-result write in `await db.transaction(async (tx) => { ... })` — in Phase 1 there is only one statement inside (the skill create/update) so the transaction is doing "preparing for multi-statement atomicity" work. Import `SKILL_HANDLERS` from `server/services/skillExecutor.ts` for the DISTINCT handler gate. Call `systemSkillService.getSkillBySlug(candidate.slug)` for the DISTINCT slug-uniqueness gate. Call `systemSkillService.createSystemSkill({ ...candidate, handlerKey: candidate.slug }, { tx })` for the DISTINCT write. Call `systemSkillService.updateSystemSkill(matchedSkillId, proposedMergedContent, { tx })` for the PARTIAL_OVERLAP / IMPROVEMENT branch (which in Phase 1 always fails the `proposedMergedContent === null` guard).
- `c:\Files\Projects\automation-v1\server\services\skillAnalyzerService.ts` (same file, `getJob` method) — extend the GET response shape: attach `matchedSkillContent` per result via a live `systemSkillService.getSkill(matchedSkillId)` lookup; attach `unregisteredHandlerSlugs: string[]` on the job by diffing candidate slugs against `Object.keys(SKILL_HANDLERS)`; attach `availableSystemAgents: { systemAgentId, slug, name }[]` on the job via a live `systemAgentService.listAgents()` read.
- `c:\Files\Projects\automation-v1\server\services\skillAnalyzerServicePure.ts` — no new helpers in Phase 1, but audit existing helpers for any dependency on the now-dropped `matchedSystemSkillSlug` / `matchedSkillName` columns.
- `c:\Files\Projects\automation-v1\server\services\__tests__\skillAnalyzerServicePure.test.ts` — extend with cases covering the §8 execute-time error paths at the pure layer where possible (e.g., `validateHandlerRegistered(candidate, registeredKeys)` extracted as a pure helper).

#### Key implementation notes

- The existing `executeApproved` at `server/services/skillAnalyzerService.ts:174` currently uses `organisationId` to scope writes to org-level skills. After this rewrite, `organisationId` stays on the params for audit/logging but is not threaded into the write path — system skills have no org scope.
- Phase 1 is the first PR to open a transaction in the skill analyzer execute path. Open the `db.transaction` block even though there's only one statement inside — this keeps the Phase 2 diff small and makes the §8.1 contract visible from Phase 1.
- Null-guard window: between Phase 1 shipping and Phase 3 shipping, every execute attempt on a PARTIAL_OVERLAP row fails with `executionError: "merge proposal unavailable — re-run analysis"`. This is intentional and covered by a pure test.
- Handler-gate window: between Phase 1 and Phase 4, the Review UI does not know to disable Approve on unregistered-handler cards. A reviewer who clicks Approve on such a card will have the result fail at execute time with the §8 error. Covered by a pure test.
- The existing client `SkillAnalyzerResultsStep.tsx` has a `{result.matchedSkillName && ...}` guard that silently swallows the missing field. This is the accepted pre-production behaviour per iteration-3 HITL.
- Phase 1 imports `SKILL_HANDLERS` from `skillExecutor.ts` into `skillAnalyzerService.ts`. Confirm the leaf-module invariant (`skillExecutor.ts` does not back-import from analyzer files) is still intact after this change.

#### Gates

- `npm run typecheck`
- `npm run lint`
- `npm run db:generate` — exactly one new migration file at `migrations/0098_skill_analyzer_v2_columns.sql`.
- `npm test` (unit suite — `skillAnalyzerServicePure.test.ts` extended for the new execute branches)

#### Commit message

`feat(skill-analyzer): rescope to system skills, add handler gate and GET response extensions (Phase 1)`

---

### Phase 2 — Agent embed + propose pipeline + execute agent-attach (server)

#### Files to create

- `c:\Files\Projects\automation-v1\server\services\agentEmbeddingService.ts` — exports `refreshSystemAgentEmbeddings(): Promise<void>`, `refreshSystemAgentEmbedding(systemAgentId: string): Promise<AgentEmbedding>`, `getAgentEmbedding(systemAgentId: string): Promise<AgentEmbedding | null>`. Uses the existing `generateEmbeddings` helper from `server/lib/embeddings.ts`. Content string is `name + "\n" + description + "\n" + masterPrompt`.
- `c:\Files\Projects\automation-v1\server\services\__tests__\skillAnalyzerServicePureAgentRanking.test.ts` — pure unit tests for `rankAgentsForCandidate`: threshold boundary, top-K truncation, tie-breaking, empty agent list, K > agent count.

#### Files to modify

- `c:\Files\Projects\automation-v1\server\services\skillAnalyzerServicePure.ts` — add `rankAgentsForCandidate(candidateEmbedding, agentEmbeddings, { topK, threshold }): AgentProposal[]` pure helper, plus exported constants `AGENT_PROPOSAL_THRESHOLD = 0.50` and `AGENT_PROPOSAL_TOPK = 3`.
- `c:\Files\Projects\automation-v1\server\jobs\skillAnalyzerJob.ts` — add Agent-embed stage (75 → 80) that calls `agentEmbeddingService.refreshSystemAgentEmbeddings()`. Add Agent-propose stage (80 → 90) that, for each DISTINCT result, computes cosine similarity against every system agent embedding, applies `rankAgentsForCandidate`, and writes the result to `agentProposals`. Write stage (now 90 → 100) persists the new column.
- `c:\Files\Projects\automation-v1\server\services\systemAgentService.ts` — extend `updateAgent(id, patch, opts?: { tx?: DrizzleTx })` and `getAgentById(id, opts?: { tx?: DrizzleTx })` with optional `tx`. Existing callers unchanged.
- `c:\Files\Projects\automation-v1\server\services\skillAnalyzerService.ts` — extend `executeApproved()` DISTINCT branch: after the skill is created inside the transaction, read `agentProposals` off the result row, filter `selected === true`, for each selected proposal call `systemAgentService.getAgentById(systemAgentId, { tx })`, if null log `{ outcome: 'skipped-missing' }` and continue, else compute `nextArray = [...agent.defaultSystemSkillSlugs, newSkillSlug]` (de-dupe) and call `systemAgentService.updateAgent(systemAgentId, { defaultSystemSkillSlugs: nextArray }, { tx })`. Emit `logger.info({ resultId, systemAgentId, outcome })` for each proposal.

#### Key implementation notes

- `agentEmbeddingService.refreshSystemAgentEmbeddings` iterates all system agents, recomputes embeddings where `contentHash` differs. Uses `generateEmbeddings` batch API (same pattern as `skillEmbeddingService`).
- The `systemAgents` table has a `defaultSystemSkillSlugs` jsonb column. Confirm its current type at implementation time — if it's stored as string[] in jsonb, the de-dupe and append are straightforward.
- Phase 2 is where the per-result transaction starts doing real multi-statement rollback work. Inside the `db.transaction(async (tx) => {...})` block: skill create → N agent reads → N agent updates → all or nothing.
- Logger: use the existing structured logger (confirm the project's logger primitive at implementation time). Per-proposal outcomes are logs only, NOT persisted to a DB column, per spec §8.
- Zero-agents edge case: the Agent-embed and Agent-propose stages no-op when `system_agents` is empty, `agentProposals` stays `[]` on every result. Confirm with a test case in the pure ranking helper.

#### Gates

- `npm run typecheck`
- `npm run lint`
- `npm test` — new `skillAnalyzerServicePureAgentRanking.test.ts` suite passes.
- `npm run db:generate` — no new migration expected in Phase 2 (the `agent_embeddings` table shipped in Phase 1). Confirm zero drift.

#### Commit message

`feat(skill-analyzer): agent embedding pipeline and execute agent-attach (Phase 2)`

---

### Phase 3 — Classify-stage merge proposal (server)

#### Files to create

- `c:\Files\Projects\automation-v1\server\services\__tests__\skillAnalyzerServicePureMergePrompt.test.ts` — pure unit tests for `buildClassifyPromptWithMerge` and `parseClassificationResponseWithMerge`: happy path (valid `proposedMerge`), missing `proposedMerge` on PARTIAL_OVERLAP → fallback to null, malformed `proposedMerge` (missing fields) → fallback to null, `definition` as string instead of object → fallback to null, DUPLICATE / DISTINCT classifications have `proposedMerge` omitted (parser enforces).

#### Files to modify

- `c:\Files\Projects\automation-v1\server\services\skillAnalyzerServicePure.ts` — add `buildClassifyPromptWithMerge(candidate, libraryRow): string` and `parseClassificationResponseWithMerge(rawLlmResponse): { classification, confidence, reasoning, proposedMerge: MergeContent | null }`. Both pure. The parser validates `definition` is a plain object (via the shared predicate from Phase 0), not a string.
- `c:\Files\Projects\automation-v1\server\jobs\skillAnalyzerJob.ts` — switch the Classify stage from the existing prompt builder / parser to the new merge-aware variants. Write stage persists `proposedMergedContent` and `originalProposedMerge` (identical at write time) when the parser returns non-null `proposedMerge`.

#### Key implementation notes

- The classify prompt extension is additive: the existing `{classification, confidence, reasoning}` contract is preserved, `proposedMerge` is a new optional top-level key. LLM prompt must include the explicit instruction from §6.1 (*"If classification is PARTIAL_OVERLAP or IMPROVEMENT, produce a proposedMerge..."*).
- Fallback path: if the LLM call fails (API key missing, rate limit, network), the existing §6.3 fallback kicks in and `proposedMergedContent` / `originalProposedMerge` stay null. The parser never tries to field-level repair from the library row — it is a pure function with no library dependency (per §9 edge case).
- After Phase 3 ships, the PARTIAL_OVERLAP null-guard window in `executeApproved` closes: rows with a valid `proposedMergedContent` are executable.

#### Gates

- `npm run typecheck`
- `npm run lint`
- `npm test` — new merge-prompt test suite passes.

#### Commit message

`feat(skill-analyzer): classify stage produces merge proposals (Phase 3)`

---

### Phase 4 — Review UI agent chips + PATCH endpoints (client + server)

#### Files to create

- `c:\Files\Projects\automation-v1\client\src\components\skill-analyzer\AgentChipBlock.tsx` — renders the agent chip block on New Skill cards. Reads `agentProposals` from the result; renders chips in stored order (score desc); click toggles `selected` and PATCHes; "Add another..." opens a combobox populated from `availableSystemAgents`.
- `c:\Files\Projects\automation-v1\client\src\components\skill-analyzer\HandlerStatusBlock.tsx` — renders the "Handler: ✓ registered" badge or the red warning block, based on `unregisteredHandlerSlugs.includes(result.candidateSlug)`.
- `c:\Files\Projects\automation-v1\server\services\__tests__\skillAnalyzerServicePureChipState.test.ts` — pure unit tests for any chip-state derivation helper extracted into `skillAnalyzerServicePure.ts`.

#### Files to modify

- `c:\Files\Projects\automation-v1\server\routes\skillAnalyzer.ts` — add `PATCH /api/system/skill-analyser/jobs/:jobId/results/:resultId/agents` with body `{ systemAgentId, selected? | remove? | addIfMissing? }`. `asyncHandler`-wrapped. Dispatches to a new `skillAnalyzerService.updateAgentProposal` method. Exactly-one-of validation returns 400; invalid classification returns 409; proposal-not-found returns 404.
- `c:\Files\Projects\automation-v1\server\services\skillAnalyzerService.ts` — add `updateAgentProposal({ resultId, jobId, systemAgentId, mode, selected? })` method. For `mode === 'addIfMissing'`, call `agentEmbeddingService.refreshSystemAgentEmbedding(systemAgentId)`, read `candidateContentHash` from the result row, look up the candidate embedding in `skill_embeddings` by `contentHash` alone (no `sourceType` filter), compute live cosine similarity, append to `agentProposals`, re-sort by score desc.
- `c:\Files\Projects\automation-v1\client\src\components\skill-analyzer\SkillAnalyzerResultsStep.tsx` — render `<HandlerStatusBlock>` above each New Skill card, `<AgentChipBlock>` below the header on each New Skill card. Disable the Approve button and filter "Approve all new" client-side when the card's slug appears in `unregisteredHandlerSlugs`. Show an info banner on bulk-approve if any cards were excluded.
- `c:\Files\Projects\automation-v1\client\src\components\skill-analyzer\SkillAnalyzerWizard.tsx` — extend `AnalysisJob` / `AnalysisResult` types with `availableSystemAgents`, `unregisteredHandlerSlugs`, `agentProposals`, `matchedSkillContent`, `proposedMergedContent`, `originalProposedMerge`, `userEditedMerge`.

#### Key implementation notes

- Manual-add flow must NOT make an OpenAI call on the PATCH hot path. The candidate embedding was already written during the pipeline's Embed stage and is keyed by `candidateContentHash`, which was persisted to the result row in the Phase 1 Write stage. The PATCH handler reads the hash off the row and looks up `skill_embeddings WHERE contentHash = $1 LIMIT 1` — no `sourceType` filter because `sourceType` reflects the last writer and is not a legal source-filtered read. See spec §5.2 candidateContentHash notes.
- The PATCH endpoint returns the full updated result row (same shape as a result entry in `GET /jobs/:jobId`).
- The Review UI's chip state is derived: a chip's "selected" visual state is `proposal.selected`, not local component state. The PATCH round-trip updates the source of truth.
- Frontend tests are NOT part of the testing envelope. The test coverage for Phase 4 is limited to the pure helpers in `skillAnalyzerServicePure.ts`. No component tests.

#### Gates

- `npm run typecheck`
- `npm run lint`
- `npm test` — chip-state pure tests pass.
- `npm run build` — client builds cleanly (catches any type drift in the extended `AnalysisResult` interface).

#### Commit message

`feat(skill-analyzer): review UI agent chips and proposal PATCH endpoint (Phase 4)`

---

### Phase 5 — Review UI three-column merge view + merge PATCH/reset (client + server)

#### Files to create

- `c:\Files\Projects\automation-v1\client\src\components\skill-analyzer\MergeReviewBlock.tsx` — three-column renderer (Current / Incoming / Recommended). Reads `matchedSkillContent` for Current, `candidate` for Incoming, `proposedMergedContent` for Recommended. The Recommended column is editable; short fields as single-line inputs, `definition` / `instructions` as autosizing textareas. Inline-diff highlighting against Current on the Recommended column via the Phase-5 `deriveDiffRows` pure helper. Responsive tab-strip fallback below ~1100px. Synced scrolling across columns for long fields. "Reset to AI suggestion" link (right-aligned, disabled when `userEditedMerge` is false). Debounced PATCH on edit (300ms). Fallback single-line notice when `proposedMergedContent === null` or `matchedSkillContent` is omitted.
- `c:\Files\Projects\automation-v1\server\services\__tests__\skillAnalyzerServicePureDiffRows.test.ts` — pure unit tests for `deriveDiffRows(current, recommended): DiffRow[]` covering: empty vs non-empty, word-level insertions, word-level deletions, mixed, multi-line strings, unchanged strings → empty diff.

#### Files to modify

- `c:\Files\Projects\automation-v1\server\routes\skillAnalyzer.ts` — add `PATCH /api/system/skill-analyser/jobs/:jobId/results/:resultId/merge` (body: partial of `{ name, description, definition, instructions }`) and `POST /api/system/skill-analyser/jobs/:jobId/results/:resultId/merge/reset`. `asyncHandler`-wrapped. Classification-valid-for guards return 409 on wrong classification. `definition` shape validation uses the shared `isValidToolDefinitionShape` predicate from `shared/skillParameters.ts`.
- `c:\Files\Projects\automation-v1\server\services\skillAnalyzerService.ts` — add `patchMergeFields({ resultId, jobId, patch })` and `resetMergeToOriginal({ resultId, jobId })` service methods. `patchMergeFields` sets `userEditedMerge = true`. `resetMergeToOriginal` copies `originalProposedMerge` into `proposedMergedContent`, clears `userEditedMerge`, returns 409 if `originalProposedMerge` is null.
- `c:\Files\Projects\automation-v1\server\services\skillAnalyzerServicePure.ts` — add `deriveDiffRows(current: string, recommended: string): DiffRow[]` pure helper wrapping jsdiff's `diffWordsWithSpace`. Keeps the React component trivially shallow.
- `c:\Files\Projects\automation-v1\client\src\components\skill-analyzer\SkillAnalyzerResultsStep.tsx` — render `<MergeReviewBlock>` on PARTIAL_OVERLAP / IMPROVEMENT cards. Add the "Approve all partial overlaps (with proposal)" bulk button with client-side eligibility filtering and the info banner for skipped rows. Remove the old `<DiffView>` field-pills panel on partial-overlap cards (the three-column view replaces it); leave it on DISTINCT cards since there is no merge proposal there.
- `c:\Files\Projects\automation-v1\package.json` — add `"diff": "^7.0.0"` (or current stable) to `dependencies`. Also `"@types/diff"` to `devDependencies`.

#### Key implementation notes

- jsdiff is NOT tree-shakeable; importing from `'diff'` pulls the whole package (~35KB min+gzipped). This is acceptable — the three-column view is lazy-loaded with the rest of the skill analyzer UI, and 35KB on a system-admin-only route is well within budget.
- `deriveDiffRows` should be idempotent: pass the same strings twice, get the same row array. This matters for debounce / re-render loops.
- `definition` is a JSON object on the wire, never a string. The Recommended column renders it as a JSON textarea, parses on blur client-side, and PATCHes only when the parse succeeds. The server rejects any PATCH whose `definition` is not a plain object with a clear 400 error (via the shared predicate).
- `userEditedMerge` is ONLY toggled by the merge PATCH endpoint. The reset endpoint clears it. The UI reads the flag directly; it is not derived-in-client state.
- The fallback path for `proposedMergedContent === null` (LLM failure) AND the fallback path for missing `matchedSkillContent` (library skill deleted after analysis) both render the same single-line notice. The renderer never has to partially render the three-column view.
- Phase 5 Review UI depends on Phase 1's `matchedSkillContent` GET response extension already being present. Order matters.

#### Gates

- `npm run typecheck`
- `npm run lint`
- `npm test` — `skillAnalyzerServicePureDiffRows.test.ts` passes.
- `npm run build` — client builds cleanly.

#### Commit message

`feat(skill-analyzer): three-column merge view and merge PATCH endpoints (Phase 5)`

---

## 4. Cross-phase risks

### 4.1 Leaf-module invariant on `skillExecutor.ts`

Phase 0 introduces `SKILL_HANDLERS` and Phase 1 imports it into `skillAnalyzerService.ts`. This is a one-way edge. At every phase commit, grep-verify that `skillExecutor.ts` does NOT import from `skillAnalyzerService.ts`, `skillAnalyzerServicePure.ts`, `skillAnalyzerJob.ts`, or `server/routes/skillAnalyzer.ts`. A cycle would not fail the typecheck but would break the invariant the spec (§10 Phase 0) calls out explicitly.

### 4.2 Migration ordering vs. backfill

Phase 0 migration (`0097`) adds `visibility` and `handler_key` columns. The backfill script must run AFTER the migration is applied but BEFORE the server first boots (the startup validator reads `handler_key` and throws on missing keys). If the developer runs `npm run dev:server` between `npm run migrate` and the backfill, the server will fail to boot because `handler_key` is NOT NULL and the existing rows have no value. **Mitigation:** the `0097` migration must either (a) add `handler_key` with a temporary default that is dropped after a one-time `UPDATE system_skills SET handler_key = slug` inside the migration, OR (b) add `handler_key` as nullable, perform the backfill, and have a follow-up `ALTER` set NOT NULL. Recommend option (a) via Drizzle `sql\`...\`` raw escape for the in-migration data step. Confirm with Drizzle docs at implementation time. Because `system_skills` is today an EMPTY dormant table (verified by spec §3), the migration may also be able to simply add `handler_key text NOT NULL` without a default — but the backfill script must run before `dev:server` on any environment where rows already exist. Document this in the backfill script's help text.

### 4.3 `systemSkillService.getSkill(id)` semantic drift

The current file-based `getSkill(id)` treats `id` as a slug (because the file-based service sets `id = slug` on every row). The DB-backed version treats `id` as a real UUID. Callers to audit at Phase 0 implementation time:

- `server/routes/systemSkills.ts:17` calls `getSkill(req.params.id)` — confirm whether the existing route is called with a slug or a UUID. If slug, rewire to `getSkillBySlug` OR add a method overload.
- `server/mcp/mcpServer.ts:167` calls `listActiveSkills()` — safe, no `getSkill`.
- `server/services/agentExecutionService.ts:525` calls `getSkillBySlug('read_data_source')` — slug path, safe.
- `server/services/skillService.ts:100` calls `getSkillBySlug(slug)` — slug path, safe.

### 4.4 Registry equivalence test brittleness

The registry equivalence test (`skillHandlerRegistryEquivalence.test.ts`) hard-codes the list of 111 pre-refactor case labels. Any legitimate future addition to `SKILL_HANDLERS` requires updating the test. This is intentional (it's an anti-drift gate) but the developer must remember to update both sides when adding a new skill.

### 4.5 Phase 1 GET response extensions landing early

Phase 1 extends the GET response with `matchedSkillContent`, `unregisteredHandlerSlugs`, `availableSystemAgents`. All three are consumed only in Phases 4/5, but they ship in Phase 1 alongside the migration. Between Phase 1 and Phase 4 the existing client ignores these fields, which is fine — they're additive. Document this in the Phase 1 commit message so future bisectors understand why the fields land early.

### 4.6 Transaction rollback vs. OpenAI cost

Phase 2 wraps `db.transaction` around skill create + N agent updates. If an agent update throws, the entire block rolls back. This is correct. But the Agent-propose pipeline stage (which lands embeddings) runs OUTSIDE the per-result transaction — the embeddings are a sunk cost regardless of whether a given row's execute path commits or rolls back. This is acceptable per spec §4 ("embeddings cost flat") but worth noting.

### 4.7 PATCH classification guards

Phase 4 (`/agents` PATCH) validates `classification === 'DISTINCT'`. Phase 5 (`/merge` PATCH and `/merge/reset` POST) validate `classification IN ('PARTIAL_OVERLAP', 'IMPROVEMENT')`. Both are 409 Conflict, not 400 Bad Request, per spec §7.3. Do NOT defer these guards to service-layer throws — they are spec-mandated route-level responses with specific error payload shapes.

### 4.8 jsdiff on server vs. client

The `diff` package added in Phase 5 is consumed by `skillAnalyzerServicePure.ts` (which runs in Node for the pure tests) AND by `MergeReviewBlock.tsx` (which runs in the browser via Vite). Confirm the package has both Node and browser entry points (it does — kpdecker/jsdiff is isomorphic). If the server build (`tsc -p server/tsconfig.json`) complains about browser-only imports, move the `deriveDiffRows` helper to a shared location OR split the import into a server-pure module and a client-only renderer.

---

## 5. Cut lines

The spec (§10 "PR cut line") describes a three-PR cut: Phase 0 alone → Phases 1–3 → Phases 4–5. The user has decided to ship as a single PR in one session, but the internal per-phase commit structure is preserved for bisectability.

**Confirmed per-phase commit structure (one commit per phase):**

1. `feat(system-skills): migrate to DB-backed store with handler registry (Phase 0)`
2. `feat(skill-analyzer): rescope to system skills, add handler gate and GET response extensions (Phase 1)`
3. `feat(skill-analyzer): agent embedding pipeline and execute agent-attach (Phase 2)`
4. `feat(skill-analyzer): classify stage produces merge proposals (Phase 3)`
5. `feat(skill-analyzer): review UI agent chips and proposal PATCH endpoint (Phase 4)`
6. `feat(skill-analyzer): three-column merge view and merge PATCH endpoints (Phase 5)`

**Bisectability properties preserved:**

- Each commit ends green on all applicable gates (lint, typecheck, relevant test suites, `db:generate` where migrations land).
- Phase 0 is independently deployable — rollback = revert the commit, restore the 405 handlers, no data loss (markdown files still on disk).
- Phases 1–3 are server-only; between 1 and 3 there's a known PARTIAL_OVERLAP null-guard window (spec §10 Phase 1) and a known UI handler-status-gap window (spec §10 Phase 1) that are tolerated pre-production.
- Phase 4 depends on Phase 2 (needs `agentProposals` populated) and Phase 1 (needs `availableSystemAgents` on the GET response).
- Phase 5 depends on Phase 3 (needs `proposedMergedContent` populated) and Phase 1 (needs `matchedSkillContent` on the GET response).
- Phase 4 and Phase 5 could technically commit in parallel on the client (no mutual dependency), but this plan keeps them sequential to preserve a clean linear history.

**Recommendation:** accept the spec's phase ordering as the commit structure above. Do NOT collapse phases into fewer commits — the six-phase structure is the bisectability spine.

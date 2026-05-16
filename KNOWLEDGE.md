# Project Knowledge Base

## 2026-05 quarterly trim — see docs/knowledge-sweep-inventory.md for the full inventory and docs/decisions/ for promoted patterns.

Append-only register of patterns, gotchas, conventions, and corrections discovered during development.
Read this at the start of every session. Default rule: append only — do not edit or remove existing entries.

**Controlled exception: quarterly compression.** Once per quarter, a maintainer may compress or promote entries when ALL of the following hold: (1) the change is captured in `docs/knowledge-sweep-inventory.md` with before/after rationale, (2) any removed material is preserved either in an ADR under `docs/decisions/` or in git history (with the inventory naming the recovery path), (3) compressed bodies leave a pointer to the new canonical location so future readers can trace from the old anchor. Day-to-day edits remain forbidden; compression is a deliberate, documented, quarterly sweep — never a drive-by trim.

> **Architecture decisions live in [`docs/decisions/`](./docs/decisions/), not here** (convention introduced 2026-05-03). KNOWLEDGE.md captures the "watch out for this" stream — observations, gotchas, learned conventions, user corrections. ADRs capture the "we chose X over Y because Z" stream — durable architectural choices with rationale and trade-offs. When in doubt, write a KNOWLEDGE entry first; promote to ADR if the decision keeps coming up.
>
> Entries before 2026-05-03 mix both streams (the convention didn't exist yet). They stay in place — splitting historical entries adds noise without adding signal. New entries follow the split.

## Size-bound policy

KNOWLEDGE.md is append-only and grows. At year 1, a healthy KNOWLEDGE.md is ~1,500–2,500 lines. Beyond ~3,000 it becomes noise — future sessions skim past entries that don't match their domain.

Two safety valves:

1. **Quarterly grouping / compression pass.** Once per quarter, a maintainer (operator or `audit-runner` in a future mode) reads the file end-to-end and groups thematically duplicate entries with a short summary, citing originals by anchor. Compression / removal-by-pointer is also permitted in this pass under the controlled-exception rules at the top of the file: every change recorded in `docs/knowledge-sweep-inventory.md`, removed material recoverable from ADRs or git history, pointers left where bodies were trimmed. Day-to-day edits between sweeps remain forbidden — only the quarterly pass touches existing entries.
2. **Promote to ADR / architecture.md when an entry keeps being cited.** If a Pattern entry has been quoted in 3+ specs or review logs, promote it: write an ADR or extend `architecture.md`, then leave a final entry pointing future readers to the new home.

The file's value is in retrieval, not preservation. If retrieval slows down, the file is too big.

---

## How to Use

### When to write a KNOWLEDGE entry (proactively, not just on failure)
- You discover a non-obvious codebase pattern
- You find a gotcha that would trip up a future session
- You learn something about how a library/tool behaves in this project
- The user corrects you (always capture the correction)
- You learn a convention not documented elsewhere

### When to write an ADR instead (`docs/decisions/`)
- You make an architectural decision (chose X over Y) and the rationale matters for future sessions
- You lock in a contract or invariant the system depends on
- You set a policy (rate-limit, retention, security) that needs to be defended later

See [`docs/decisions/README.md`](./docs/decisions/README.md) for the ADR convention and template.

### Entry format

```
### [YYYY-MM-DD] [Category] — [Short title]

[1-3 sentences. Be specific. Include file paths and function names where relevant.]
```

### Categories (post-split)
- **Pattern** — how something works in this codebase
- **Gotcha** — non-obvious trap or edge case
- **Correction** — user corrected a wrong assumption
- **Convention** — team/project convention not documented elsewhere

The historical **Decision** category is retired for new entries — write an ADR instead. Existing Decision entries stay in place; future readers should treat them as observations rather than authoritative ADRs.

---

## Entries

> **Quarterly grouping pass — 2026-05-13.** Entries before 2026-05-08 moved verbatim to `KNOWLEDGE-archive-2026-Q2.md`. Read the archive when you need the full context behind a referenced entry. The 4 weeks of removed entries covered: paperclip-hierarchy, riley-observations, clientpulse-ui-simplification, audit-remediation, pre-test-* hardening, code-intel-phase-0, dev-mission-control, ghl-module-c-oauth, agentic-commerce, framework-standalone-repo, pre-launch-phase-1/2/3, baseline-capture, subaccount-artefacts, subaccount-optimiser, agent-as-employee, workflows-v1-phase-2, system-monitoring-agent, consolidation-foundation, consolidation-govern, and trust-verification-layer builds. Patterns to grep the archive for if needed: "best-effort write swallow point", "bounded payload size", "defence-in-depth composition", "warn codes namespacing", "discriminator-trust contract", "review-finding triage technical vs user-facing", "RLS withOrgTx FORCE-RLS", "mixed-mode review agents", "node --watch kills jobs", "Drizzle self-references TS inference ceiling".

### [2026-05-08] Pattern — Legacy route telemetry and deprecation tracking

**Date:** 2026-05-08
**Source:** Consolidation-build Round 2 ChatGPT tightening (task 4).
Legacy routes from the pre-consolidation UI (`/admin/agents`, `/admin/skills`, `/admin/skill-studio`, `/system/skill-analyser`, etc.) are consolidated into `/agents`, `/recurring-tasks`, and `/projects`. Today, client-side `<Navigate>` components in `client/src/App.tsx:401-511` redirect old bookmarks silently. Future telemetry: add a middleware or custom Navigate wrapper to emit structured logs with `sourceRoute`, `destinationRoute`, `userAgent`, and `timestamp`. Monitor redirect volumes in logs; after traffic drops below a threshold for N days, routes can be retired entirely. See `docs/doc-sync.md` § Legacy Route Deprecation for the tracking process. (Phase 1: redirects active, no telemetry. Phase 2: add telemetry emit. Phase 3+: retire routes.)

### [2026-05-08] Pattern — Skill Studio iframe recursion protection pattern

**Date:** 2026-05-08
**Source:** Consolidation-build Round 2 ChatGPT tightening (task 7).
Skill Studio is no longer embedded as an iframe in the consolidation-build UI. If a future phase embeds Skill Studio (or similar recursive-openable components), apply the `embedded` prop pattern: pages accept an optional `embedded?: boolean` prop; when true, suppress recursive-open affordances (e.g., "Edit in modal", "Open in new window", "Open Skill Studio"). Example in existing codebase: `client/src/pages/AdminBoardConfigPage.tsx` and `AdminCategoriesPage.tsx` check `!embedded` before rendering navigation affordances. Pattern: wrap recursive-open buttons in `{!embedded && (<button>...</button>)}`. (Phase 1: SkillsTab uses a modal picker, not an embedded Skill Studio, so no protection needed yet. Phase 2+: if embedding is added, apply this pattern.)

### [2026-05-08] Pattern — Closed-enum service-boundary mapping for typed error.code contracts

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #273 (slug: consolidation-govern); pr-reviewer blocker B-1 (testConnection error.code widening).

When a route returns a typed error.code field whose contract is a tight closed enum (e.g. spec defines `error.code: 'TIMEOUT' | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'PROVIDER_ERROR'`), the service that produces the value MUST map every internal error state — including the catch-all/unknown branch — to one of the four codes at the boundary. SDK-level error codes (`NO_CREDENTIALS`, `TOKEN_EXPIRED`, `SERVER_ERROR`, raw axios codes, etc.) MUST NOT leak into the contract value. The mapper lives in the service (e.g. `connectionTokenService.testConnection`), not in the route handler — so every caller of the service gets the same canonical mapping, and the contract is enforced at one location. Concrete shape:

```ts
// In connectionTokenService.testConnection
function mapErrorToCode(err: unknown): 'TIMEOUT' | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'PROVIDER_ERROR' {
  if (isAbortOrTimeout(err)) return 'TIMEOUT';
  if (isAuthFailed(err))     return 'AUTH_FAILED';
  if (isNetworkErr(err))     return 'NETWORK_ERROR';
  return 'PROVIDER_ERROR'; // catch-all — every unmapped class lands here
}
```

Why it matters: the contract enum is a public commitment to the client. If the service leaks new SDK codes the moment a new SDK is added, every consumer's exhaustive switch silently breaks. Pair this rule with §8.30 in DEVELOPMENT_GUIDELINES.md (SQL CASE enum mappers use `ELSE NULL`) — same family of failure mode (unknown values silently coerced past the safety guarantee), same family of fix (force the mapping at the typed boundary, fail-closed on unknown).

### [2026-05-08] Pattern — Targeted `onConflictDoNothing(target)` for partial-unique idempotency

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #273 (slug: consolidation-govern); pr-reviewer strong-recommendation 2 (overrideEntry onConflictDoNothing scope).

`onConflictDoNothing()` without a `target:` argument silently swallows ANY unique-constraint violation on the row, including constraints unrelated to the idempotency key. For body-hash idempotency on `memory_block_versions` (partial unique on `(memory_block_id, body_hash) WHERE body_hash IS NOT NULL`), the correct shape is:

```ts
.onConflictDoNothing({ target: [memoryBlockVersions.memoryBlockId, memoryBlockVersions.bodyHash] })
```

Untargeted `.onConflictDoNothing()` would also swallow a hypothetical version-counter collision (if the schema gained one), letting the buggy state persist silently. Targeted form ensures unrelated constraint violations bubble as errors so the caller can retry. Rule: any `onConflictDoNothing` MUST name the column set whose conflict is the intended dedupe key. A bare `.onConflictDoNothing()` is a code-review blocker.

### [2026-05-08] Pattern — Migration-number collision after S2 sync requires renaming on the feature branch

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #273 (slug: consolidation-govern); main landed `0286_consolidation_build_schema_additions` while `ui-consolidation-govern` was authoring `0286_govern_auto_update_disabled`.

When the S2 sync surfaces a migration-number collision (same number, different content on both sides of the merge base), the feature branch renames its migration to the next free integer. Renaming is correct because main's migration has already shipped to production (or imminently will via the merge that's already on main); the feature branch is the side that hasn't shipped yet. The rename also cascades to:

1. The migration file itself (header comment + filename)
2. The down-migration file
3. `architecture.md` § Key files per domain (any row referencing the migration filename)
4. NOT plan.md — historical artefact, leave the original number for archaeology

Verification after rename: `grep -rn '<old-number>_<slug>' .` should return only `tasks/builds/*/plan.md` historical references and zero hits in source / docs / migrations. Down migration MUST also be renamed in lockstep so the rollback path tracks the forward path.

### [2026-05-08] Pattern — App.tsx route-handler regression after upstream page deletions during S2 sync

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #273 (slug: consolidation-govern); G4 regression guard caught 10 missing identifiers after S2 merged `consolidation-build` (PR #271) and `operate-stream` (PR #272) which deleted `AdminAgentsPage`, `AdminAgentEditPage`, `AdminSkillsPage`, `AdminSkillEditPage`, `SystemAgentsPage`, `GoalsPage`, `SkillStudioPage`, `SkillAnalyzerPage`, `ScheduledTasksPage`.

When a parallel branch lands a UI consolidation that deletes pages, the feature branch's `client/src/App.tsx` will compile-fail post-S2 because the JSX route declarations still reference the deleted page identifiers — even after the lazy-import lines are dropped (which TypeScript checks at routine compile time). The fix pattern: for each broken route, replace the JSX element with either:

- `<Navigate to="<canonical-new-path>" replace />` — for direct redirect of the old path
- a small redirect helper (`function RedirectAgentEdit() { const { id } = useParams(); return <Navigate to={\`/agents/${id}/edit\`} replace />; }`) — for parameterised redirects where the path segment must be reshaped
- the new page component, registered under the new canonical route — for the canonical destination itself

Always cross-check against the consolidating branch's App.tsx (`git show origin/main:client/src/App.tsx`) for the canonical mapping; do not invent route names. After the rewrite, also remove any duplicate redirect elsewhere in the file (e.g. an old `<Route path="/agents" element={<Navigate to="/" />} />` that conflicts with the new canonical `<Route path="/agents" element={<AgentsListPage />} />`).

### [2026-05-08] Pattern — Coordinators run INLINE in the main session, never dispatched as sub-agents

Promoted to ADR 0014 on 2026-05.

### [2026-05-08] Pattern — Cross-tenant source-pill compression rule

**Date:** 2026-05-08
**Source:** Trust & Verification Layer spec §6.8, Chunk 7.

Scorecard source pills compress based on the viewer's scope, not the scorecard's scope. `compressSourcePill(scope, viewerScope)` returns five canonical values: `system`, `organisation`, `this_subaccount`, `platform`, `custom`. The rule: `subaccount`-scoped scorecards always show `this_subaccount`; `system`-scoped show `system` to org_admins and `platform` to workspace viewers; `org`-scoped show `organisation` to org_admins and `custom` to workspace viewers. This compression prevents org-name leakage to subaccount-scope viewers. Pure function in `scorecardServicePure.ts`; mirrored in `ScorecardSourcePill.tsx` for client-side rendering without a round-trip. Permutation test in `server/services/__tests__/scorecardServicePure.test.ts` covers all four `(scope, viewerScope)` combinations.

### [2026-05-08] Pattern — Three-tier authority lock model for scorecards

**Date:** 2026-05-08
**Source:** Trust & Verification Layer spec §6.4, Chunk 7.

Scorecard authority resolves in three tiers: system > org > subaccount. When an agent has two attachments for the same scorecard slug — one from a higher tier and one from a lower tier — `resolveAuthority(attachments)` always picks the higher-tier source. Attachments at the same tier conflict only if the same org/subaccount owns two rows for the same slug; that is a data invariant violation, not a normal state. The resolver is a pure function in `scorecardServicePure.ts`, never hits the DB. Any route that surfaces "which scorecard is active" must pass the full attachment list through the resolver before responding.

### [2026-05-08] Pattern — Single-share-toggle visibility primitive

**Date:** 2026-05-08
**Source:** Trust & Verification Layer spec §6.3, Chunk 7.

Scorecard visibility is controlled by a single `isShared` boolean. `isShared: true` makes the scorecard visible to all subaccounts under the owning org. `isShared: false` (default) makes it visible only to the owning org admins and the subaccount that created it. There is no per-subaccount sharing list, no ACL, no role-based filter — just one toggle. This keeps the permission surface minimal. Route-level visibility is enforced by `getVisibleScorecards(organisationId, subaccountId?)` in `scorecardService.ts`, which applies the `isShared` predicate in SQL rather than in application code.

### [2026-05-08] Pattern — Idempotent UPSERT on operator correction capture

**Date:** 2026-05-08
**Source:** Trust & Verification Layer spec §10.1, Chunk 13.

Correction capture uses `onConflictDoUpdate` with a partial unique index target: `(organisation_id, source_run_id) WHERE captured_via = 'operator_correction' AND deleted_at IS NULL`. This means the operator can correct the same run multiple times and each subsequent correction silently updates the existing block (last-write-wins) rather than inserting a duplicate. The `targetWhere` clause in the Drizzle `onConflictDoUpdate` maps to the partial index predicate. Without `targetWhere`, Drizzle cannot locate the partial index and the UPSERT falls through to an error. Always specify both `target` columns and `targetWhere` when the conflict target is a partial index.

### [2026-05-08] Pattern — Runtime check three-state UI collapsed from five internal states

**Date:** 2026-05-08
**Source:** Trust & Verification Layer spec §6.2, Chunk 5.

Internally, runtime check results carry five states: `pending`, `running`, `pass`, `fail`, `inconclusive`. The UI collapses these to three visual groups: loading (pending + running), pass, not-pass (fail + inconclusive). `inconclusive` is surfaced distinctly from `fail` in the drawer detail — `fail` means the check fired and found a problem; `inconclusive` means the check could not determine a verdict (e.g. model output was ambiguous or the check function threw). Never merge `fail` and `inconclusive` at the data layer — they carry different operator actions. Merge only at the UI summary level, and always expose both labels in the detail view.

### [2026-05-08] Pattern — `verify` shape on actionService-wrapped skills always evaluates inconclusive

**Date:** 2026-05-08
**Source:** Trust & Verification Layer fix-loop, Codex P1 finding.

`runtimeCheckService.dispatchEvaluation` reads the tool result's top-level `statusCode` / `status` field. Skills that go through `proposeAction` / `executeWithActionAudit` (review-gated AND most auto-gated skills) return the action service envelope `{ status: 'pending_approval' | 'approved' | 'completed', actionId, ... }` — `status` is a STRING, not a numeric HTTP status. So `verify: { kind: 'api_status_2xx' }` declared on these skills will resolve to `inconclusive` every time. With `blastRadius: 'external'` that maps to the same pause/inbox path as `fail` per spec §11.2 — every successful action would pause for inbox review.

**Rule:** before declaring a concrete `verify` shape on an `ACTION_REGISTRY` entry, trace the actual handler path. If the handler routes through `executeWithActionAudit` or any other action service wrapper, declare `verify: null` with a justification ("Review-gated: HITL approval is the verification boundary; actionService wrapper has no comparable post-check shape" or "External read — backfill candidate; current actionService wrapper hides the inner field from the runtime-check dispatcher"). A future follow-on can teach the runtime-check dispatcher to unwrap the actionService envelope before evaluation.

### [2026-05-08] Pattern — Position-match against agent_execution_events.sequence_number is wrong for toolCallsLog

**Date:** 2026-05-08
**Source:** Trust & Verification Layer fix-loop, Codex P2 finding.

`runAgenticLoop` pushes one entry to `toolCallsLog` per tool dispatch, but does NOT emit `skill.invoked` / `skill.completed` events for every tool call. Those event types are emitted only by special paths (`crmQueryPlanner.plannerEvents`, `chargeRouterService`). A naive position-match — Nth toolCall ↔ Nth skill.completed event ordered by `sequence_number` — produces two failure modes: (a) ordinary tool calls resolve to `null` (they have no matching event), and (b) when special-path events DO exist, an event from one slug may be attached to a tool call from a different slug.

**Rule:** when reconciling toolCallsLog entries to event-log rows, match by `(skillSlug, ordinal-within-slug)`, not by global position. Group events by `payload.skillSlug` and pair the Nth toolCall whose `tool === foo` with the Nth `skill.completed` event whose `payload.skillSlug === foo`. Tool calls without matching events resolve to `null` cleanly. See `linkToolCallsToEventIds` in `server/services/agentRunMessageServicePure.ts`.

### [2026-05-08] Pattern — Cross-subaccount IDOR slips past RLS in agent-scoped routes

**Date:** 2026-05-08
**Source:** Trust & Verification Layer adversarial-review S-3.

Subaccount-scoped routes that carry both `:subaccountId` and `:agentId` in the URL (e.g. `DELETE /api/subaccounts/:subaccountId/agents/:agentId/scorecards/:id`) are protected by RLS at the org level but NOT at the subaccount level — RLS on the writes-target table (`scorecards`, `agents`, etc.) filters rows to the caller's org via `app.organisation_id`, but does not enforce that the named agent belongs to the named subaccount. A power user with `subaccount.X.manage` on subaccount A could target an agent in subaccount B (same org) and the route would proceed.

**Rule:** for any subaccount-scoped route that carries both `:subaccountId` AND a target-resource id (`:agentId`, `:templateId`, etc.), add an explicit application-layer assertion that the resource has an active link to the named subaccount via `subaccount_agents` (or the relevant join table). Fail-403 not 404 — 404 leaks the resource's existence in another subaccount; 403 is the standard cross-tenant rejection envelope. Pure verdict-shaping helper (`assertAgentSubaccountMembership`) keeps the route → HTTP mapping testable.

### [2026-05-08] Pattern — Workers that opt out of `createWorker` auto-org-tx must wrap FORCE-RLS reads in a short org-scoped tx before any external I/O

[cross-reference 2026-05] See also the 2026-05-05 canonical entry `db.transaction() opened from module-level pool runs WITHOUT GUC` above for the broader "what goes wrong" family.

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #274 (slug: auto-knowledge-retrieval); dual-reviewer iter 1 (3 P1 fixes in `documentChunkEmbedJob`, `documentReembedJob`, `documentPromotionFinaliseJob`).

When a pg-boss handler is built with `createWorker({ resolveOrgContext: () => null, ... })` (because the spec mandates the embedding API call run OUTSIDE any DB tx, e.g. spec §1.5 #9 in auto-knowledge-retrieval), it explicitly opts OUT of the auto-org-tx wrapper. Any `db.select(...)` against a FORCE-RLS table that the worker issues at module-top scope will then run with no `app.organisation_id` GUC — and FORCE-RLS policies that require `current_setting('app.organisation_id', true) <> ''` return **zero rows silently**. The worker then short-circuits with a `version_not_found` warn or similar, and the job is dead in the water for that document forever.

**Pattern:** for workers that opt out of auto-org-tx, every FORCE-RLS read MUST be inside a short org-scoped read tx that explicitly sets the GUC, BEFORE the I/O the spec wants to keep tx-free:

```ts
const { row } = await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`);
  const [row] = await tx.select(...).from(forceRlsTable).where(...);
  return { row };
});
// embedding API call / external I/O happens HERE, outside any tx.
```

Combine multiple back-to-back FORCE-RLS reads into one tx where possible — they share the same GUC scope and a single tx is cheaper than multiple short ones. Spec invariants like "embedding API call runs outside any DB tx" are PRESERVED because the read tx ends before the I/O starts.

**Detection heuristic.** Grep the worker for `db.select(` / `db.transaction(` and confirm: (a) the file contains `resolveOrgContext: () => null`, AND (b) every read against a FORCE-RLS table is inside a tx that issues `set_config('app.organisation_id', ...)` as the first statement. If a worker has (a) but a read fails (b), it is the bug. The adversarial-reviewer's "Additional observations" section may flag this without routing it as a tracked finding — promote to a fix anyway.

This is a stricter form of the existing 2026-05-04 (cleanup jobs need `withAdminConnection`) and 2026-05-05 (`db.transaction()` must set the GUC) patterns. The new wrinkle: workers can legitimately opt out of `withOrgTx` (because the spec mandates I/O outside tx), but that opt-out CANNOT extend to reads against FORCE-RLS tables — those still need their own short-lived org-scoped tx.

### [2026-05-08] Pattern — Embedding inputs must NEVER be silently truncated — log when they are

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #274 (slug: auto-knowledge-retrieval); pr-reviewer Strong-1 (8192 magic-number truncation in `documentEmbeddingService.embedChunks`).

Embedding services frequently apply a per-call byte cap to avoid provider 4xx errors (OpenAI text-embedding-3 at 8192 tokens, ~32k chars worst case, but the input cap can be set lower for cost). When the chunker produces semantically-coherent chunks but a non-Latin / sentence-resistant chunk hits the byte-window fallback path and exceeds the cap, the embedding represents only the first N chars while the chunk row persists FULL content. Result: vector search returns the chunk's truncated-text similarity, the agent loads the full chunk, and operators have no signal that retrieval quality has silently regressed.

**Pattern:** every embedding-input cap must (a) live as an exported constant (`EMBEDDING_INPUT_BYTE_LIMIT = 8192` etc.), NOT a magic number, AND (b) emit a structured `logger.warn('document.embed.input_truncated', { chunkIndex, originalLength, truncatedLength, embeddingModel })` on every truncation event. Without the log, the regression is invisible. With it, ops can dashboard `truncation_rate_per_org` and tune chunk size before quality degrades.

**Detection heuristic.** Grep `\.slice\(0, \d+\)` and `\.substring\(0, \d+\)` inside any service that emits an embedding call. Every hit is a candidate truncation site — if no `logger.warn` fires alongside, route it as a Strong recommendation.

This generalises beyond embeddings: the same pattern applies to summary inputs, search-query truncation, ranker payloads. Silent truncation is always a quality regression hiding in the metrics.

### [2026-05-08] Pattern — Pure helpers used for their return value MUST have their return value consumed; side-effect-free helpers called for "side effects" are the bug

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #274 (slug: auto-knowledge-retrieval); pr-reviewer Blocker B-2 (`groupCandidatesByDocument` called with return value discarded in `retrievalService.ts`).

A frequent bug shape during ranker / pure-helper refactors: a function declared as `(input: T[]) => U[]` is called for what looks like a side effect — but pure helpers HAVE no side effects. If the return value is not assigned, used, or written, the pure helper has done nothing the caller observed. The spec's intended invariant (e.g. "document-level relevance is `MAX(chunk.finalScore)`") is therefore not delivered at runtime, even though the pure helper was implemented correctly and tested correctly.

**Detection heuristic.** During PR review, grep the changed services for `^\s*<helperName>\(` (helper call as a statement, not as an assignment / argument). Every hit needs justification: if the helper's signature shows a non-void return, the call is almost certainly a bug. Pure-helper Convention §8 already says "pure helpers must be deterministic and side-effect-free" — combine that with: "if you call one as a statement, you have written a no-op."

This complements the existing pure-helper-input-mutation entries in KNOWLEDGE.md: the inverse failure mode is **calling a pure helper for side effects that don't exist** (this entry); the dual is **mutating an input expecting it to be returned later** (covered earlier). Both are reviewable mechanically — either no return value is consumed, or an input is mutated.

### [2026-05-08] Pattern — Retrieval-version completeness invariant requires an active production read-path filter, not just a write-side guard

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #274 (slug: auto-knowledge-retrieval); pr-reviewer Blocker B-3 (`filterDocumentChunks` exists + tested but not called from `retrievalService`).

When the spec says "X invariant must hold at read time" (e.g. auto-knowledge-retrieval §13.1: "`retrieval_version_id` MUST always reference a version whose full chunk set exists for `active_embedding_model`"), implementing the invariant ONLY in the chunking job's atomic-swap commit path is insufficient. A test that exercises the pure helper that enforces the invariant (e.g. `documentRetrievalServicePure.filterDocumentChunks`) but is never wired into the production read path passes green — and the read path silently does its own inline filter that checks pointer alignment but NOT chunk-count completeness. Result: a partial-write race window or any future invariant deviation goes undetected.

**Pattern:** for any spec invariant that includes "must hold at read time", the doc-conformance check is "find every read site for this data and confirm it routes through the canonical filter." The pure helper having a green test is necessary but not sufficient. PR reviewers should ALWAYS grep the production read path for the canonical filter call — if the test exists but the production call doesn't, the test is dead.

This is closely related to the existing "test coverage that doesn't exercise production paths" anti-pattern, but framed for invariant-enforcement specifically: a write-side guard is fine, a read-side guard is fine, both is best, and a tested-pure-helper-without-production-wiring is the bug.

### [2026-05-08] Pattern — Document-promotion atomicity needs an audit-row idempotency anchor inside the inline transaction

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #274 (slug: auto-knowledge-retrieval); architectural pattern from spec §6.5 + adversarial-reviewer AKR-ADV-6 + dual-reviewer §3 (FORCE-RLS reads on `document_promotion_audit`).

When a one-click "promote source X to durable Y" flow has both an inline tx (for the user-visible "marked durable" instant feedback) and a post-commit job (for slow side effects like flipping `expires_at` to NULL or far-future), there is a race window: if the post-commit job runs after the source row's expiry sweep also fires, the source could be pruned before the durability flip lands. The promotion path then re-runs (UI retry, idempotency replay, etc.), and the system either creates a duplicate target row or 23505s.

**Pattern:** write an append-only audit-ledger row inside the inline tx with `UNIQUE (file_id) WHERE deleted_at IS NULL`. The audit row IS the idempotency anchor — its existence proves promotion already started, and the post-commit job reads it under the same RLS context to know whether to flip durability. Auto-knowledge-retrieval's `document_promotion_audit` table (migration 0294) is the canonical implementation: written inside the same tx as the new `reference_documents` row + link rows, then read by `documentPromotionFinaliseJob` (in a short org-scoped read tx — see the worker-opt-out pattern above) to prove the promotion is real before flipping `execution_files.expiresAt`.

**Detection heuristic.** Any "instant durability + post-commit side effects" pattern needs the audit-ledger anchor. If you see `promotionService.promote` followed by a fire-and-forget `enqueueFinaliseJob`, ask: how does the finalise job know the inline tx committed and isn't a phantom retry? The answer should be a row in an audit table, written inline, with a UNIQUE constraint that idempotency-keys the source-id.

### [2026-05-08] Pattern — Retrieval rankers should share a generic core; primitive-specific filters wrap it

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #274 (slug: auto-knowledge-retrieval); spec decision §3.3.3 (extract generic ranker, keep block-specific filters).

When a project gains a second knowledge primitive that needs ranking (auto-knowledge-retrieval added document chunks alongside the pre-existing memory blocks), the temptation is to copy the ranker. Don't. Extract the generic ranker into a pure module that operates on a polymorphic `RetrievalCandidate` shape (id, kind, scope-tier columns, embedding, tokenCount, finalScore inputs); leave primitive-specific FILTERS (mode handling, version pinning, owner-agent semantics, divergence flags) in the primitive's own service that wraps the generic ranker.

This is what `retrievalServicePure.ts` (generic ranker) + `documentRetrievalServicePure.ts` (document-specific filter) + `memoryBlockRetrievalServicePure.ts` (block-specific filter) shipped together in PR #274. Future cross-encoder re-ranking, learned thresholds, and new knowledge primitives all benefit from concentrating the algorithm.

**Convention:** any new knowledge-style primitive that needs ranking goes through `retrievalServicePure`. Primitive-specific code lives upstream (pre-ranking filter) or downstream (post-ranking truncation / formatting). The comparator chain `finalScore DESC, scopeTier DESC, updatedAt DESC, id ASC` is locked — `id ASC` is the determinism anchor. Tests in `retrievalServicePure.test.ts` pin it; reordering or dropping a column is a spec amendment.

### [2026-05-08] Pattern — Bounded observability payloads with deterministic top-N truncation are the right shape for retrieval traces

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #274 (slug: auto-knowledge-retrieval); spec §11.4 + §10.8 (ranking determinism), `retrievalObservabilityService` design.

Retrieval traces tempt unbounded JSON payloads (every candidate, every score component, every rejection reason). Two failure modes:
1. Storage cost grows linearly with candidate-pool size, which itself grows with org maturity.
2. Replay determinism fails: a re-emit with `JSON.stringify` of the same candidate set produces a different byte sequence if Map iteration order or floating-point serialisation drifts.

**Pattern:** every retrieval-trace event has a strict byte-bound contract — top-N items per array (sort + slice, fixed N), constants exported from the observability service, and replays MUST be byte-identical given the same candidate set. Tests assert `Buffer.byteLength(emit) === Buffer.byteLength(replay)`. Truncation is silent in the payload (no per-event "5 more truncated" wording — the constant is the contract); a separate truncation-indicator-rate metric tells ops when caps need raising via the documented escalation path (migrate to a dedicated `retrieval_events` table — DON'T raise the inline cap).

This is the spec §11.4 design pinned in `retrievalObservabilityServicePure.test.ts`. Mirror it for any future high-cardinality observability event (rule-firing trace, capability-discovery trace, etc.) — bounded payload + dedicated escalation path beats unbounded inline payload every time.

### [2026-05-08] Pattern — Always-available document budget needs a preventive UI surface, not a runtime safety net

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #274 (slug: auto-knowledge-retrieval); spec §11.5 + chatgpt-spec-review item A (operator chose option a — telemetry-driven preventive surface).

When a feature lets operators flag documents as "always available" (loaded on every run, bypassing relevance ranking), there's a temptation to handle starvation at runtime: degrade gracefully when the always-available block alone exceeds budget. That works mid-run, but it's the WRONG primary surface — operators only learn about the misconfiguration after a degraded run lands, and they have no signal in the configuration UI to tell them they're approaching the cliff.

**Pattern:** the primary surface is preventive, in the configuration tab. Soft warning fires at thresholds well below the runtime cliff (`doc_count >= 30` OR `token_cost >= 30000` for v1) and surfaces in the Documents tab as an inline chip. The runtime degradation path still exists as the last-line-of-defence safety net, but operators see the chip first and reconfigure before any run degrades. Constants live in `retrievalObservabilityService` for v1; per-org overrides explicitly deferred to a post-launch amendment once production telemetry exists to inform tuning.

**Convention.** When designing any "soft cap" feature where operators can over-configure, the question to ask is: *does the operator see the warning before the bad outcome, or only after?* If only after, the design is wrong; redo with a configuration-time surface.

### [2026-05-09] Pattern — Single-node SSE topology with reconnect-snapshot recovery

`agentPresenceStreamPublisher.ts` uses an in-process singleton `Map` keyed by scope (no Redis, no message broker). Each scope holds a sorted ring buffer (300 events, canonical order `(eventTimestamp ASC, eventId ASC)`). On reconnect the route calls `replaySinceLastEventId(lastEventId)` to replay the ring buffer. The `Last-Event-ID` request header always supersedes the `lastEventId` query param when both are present; query param is consulted only when the header is absent. Multi-node fan-out is explicitly deferred (spec §18 Agent Workspace). File: `server/services/agentPresenceStreamPublisher.ts`; routes: `server/routes/agentPresenceStream.ts`.

### [2026-05-09] Pattern — Monotonic-clock hysteresis for working time

`agentWorkingTimeService.ts` uses `process.hrtime.bigint()` for elapsed measurement to avoid `Date.now()` wall-clock drift and NTP adjustments. Elapsed accumulates into a per-run bucket in `agent_working_time_buckets`. UTC half-open intervals `[start, end)` prevent double-counting at midnight: runs that cross midnight are split into two buckets inside the pure helper `splitIntervalAcrossBuckets`. The monthly compact job (`workingTimeRollupCompactJob.ts`) keeps per-day rows for 1 year then collapses to monthly resolution. File: `server/services/agentWorkingTimeService.ts` + `agentWorkingTimeServicePure.ts`.

### [2026-05-09] Pattern — Bounded-payload pattern reuse applied to SSE (KNOWLEDGE.md 2026-05-08 retrieval pattern applied)

`agentPresenceStreamPublisher.ts` applies the same bounded-observability-payload pattern from `retrievalObservabilityService`: per-event hard cap is 32KB measured via `Buffer.byteLength(JSON.stringify(event.data), 'utf8')`. Over-limit events have their `data` replaced with `{ truncated: true, byteLength }` and `truncated: true` set on the envelope. Truncation is logged at most once per 24h per event-type (in-process Map keyed on event-type name, reset at UTC midnight) to prevent log storms on burst traffic. The 24h suppression key is `(eventType, host)` — same pattern as the cache-invalidation log suppression (plan Rev 3 tightening #3).

### [2026-05-09] Pattern — Immutability GUC bypass for retention prune

`agentObservationsPruneJob.ts` bypasses the `agent_observations` DB immutability trigger via `set_config('app.allow_observation_mutation', 'retention_prune', true)` issued as the first statement inside the DELETE transaction. The GUC is transaction-scoped only. Every prune cycle calls `recordSecurityEvent` with action `agent.observations.retention_prune` — this is the ONLY authorised mutation path for non-pinned rows. GUC + audit-log pairing is the canonical pattern for any table that uses a trigger-based immutability guard but needs a maintenance prune path. Delete batches: 1000 rows ordered `(created_at ASC, id ASC)` with `FOR UPDATE SKIP LOCKED`.

### [2026-05-09] Pattern — withOrgTx external side-effect boundary

`ieeSessionService.tearDown()` uses `withOrgTx` for the DB update. The external container release (IEE infra teardown) MUST be placed AFTER the `await withOrgTx(...)` call returns — never inside the transaction callback. Pattern: commit first, then side-effect. Placing the release inside the callback violates atomicity: if the release throws before the implicit commit, the transaction may roll back leaving the DB row in a stale state while the container is already gone. `markFailed()` and `recordSummary()` use `getOrgScopedDb` because a single UPDATE needs no full transaction wrapper. File: `server/services/ieeSessionService.ts`.

### [2026-05-09] Correction — chatgpt-pr-review is iterative until operator says done; never auto-close after a single APPROVED round

**Date:** 2026-05-09
**Source:** Operator correction during PR #275 (slug: trust-verification-layer) Phase 3 finalisation. Round 1 was auto-closed by finalisation-coordinator with disposition `APPROVED — round-2 not requested` after a single round, without pausing for operator input. Operator pointed out that the agent contract is iterative.

The `chatgpt-pr-review` agent is **operator-driven on cadence** — there is no auto-finalise on a single APPROVED round, even when the round produces no findings. Per `.claude/agents/chatgpt-pr-review.md` line 230 ("Empty findings array AND verdict APPROVED → log and ask the user whether to finalise or run another round") and `.claude/agents/finalisation-coordinator.md` line 237 ("Coordinator pauses inside this sub-agent for the operators full ChatGPT loop. No time cap. Operator drives cadence."), the coordinator MUST pause after every round and wait for the operator to either:

- paste the next ChatGPT response (round N+1), or
- say `done` (close the loop and proceed to step 6 doc-sync sweep).

**Why:** even when ChatGPT returns APPROVED with no findings, the operator may want to run a second round at a different prompting angle (strategic risks, security framing, ergonomics). Auto-closing after a single round denies that option and silently truncates the review.

**Detection heuristic.** When running finalisation Step 5, the coordinator must surface BOTH options at the end of every round, regardless of disposition: "say `done` to close the loop, or paste another ChatGPT response to run another round." Never write `APPROVED — round-N+1 not requested` as a self-decided verdict — that field is set only when the operator explicitly says done.

**Applies to:** `.claude/agents/finalisation-coordinator.md` Step 5; `.claude/agents/chatgpt-pr-review.md` per-round loop step 9 (round summary). Both files are correct in their text — this entry exists to lock in the discipline against future drift.

### [2026-05-09] Correction — finalisation-coordinator must auto-monitor CI, auto-fix CI red (with guardrails), and auto-merge

**Date:** 2026-05-09
**Source:** Operator correction during PR #275 (slug: trust-verification-layer) Phase 3 finalisation. The prior contract for finalisation-coordinator stopped at Step 11 with "operator drives the merge sequence" — the operator pointed out that this has failed to fire automatically multiple times across recent finalisations. They want the full lifecycle (label → CI watch → CI fix → merge) automated, since they do not review CI logs themselves.

The `finalisation-coordinator` agent now owns the entire post-Step-10 lifecycle:

- **Step 11 (NEW):** CI monitoring + iterative fix loop. Polls `gh pr view {N}` every 90s via `ScheduleWakeup`. State machine: `green` → Step 12; `running` → schedule another poll; `red` → enter fix sub-loop. Bounded at 5 iterations per session.
- **Step 12 (NEW):** Auto-merge. Update current-focus → NONE, commit + push, run `gh pr merge {N} --squash --delete-branch`, capture squash sha, patch main with the actual sha.
- **Step 13 (was 11):** End-of-phase prompt — confirms merged.

**Guardrails (mandatory) on the fix sub-loop.** Without these, auto-fix is unsafe — the agent can silently game tests, scope-creep, or mask real bugs. With them, the auto-fix path is bounded to genuinely mechanical CI red:

1. **G1 — Test files off-limits.** Never modify `*.test.ts` / `*.spec.ts` / `tests/` / `__tests__/` / `e2e/` / `fixtures/` / vitest+jest config. Failing tests usually mean the implementation is wrong; the fix belongs in the implementation, never in the assertion. If the test really is outdated, escalate — the operator owns the spec-amendment decision.
2. **G2 — Diff size cap: 50 lines per iteration.** Bigger fixes almost always indicate the agent is solving the wrong problem. The migration-0300 IMMUTABLE fix (1 line) and the corrections-route service-helper fix (30 lines) both fit comfortably. If a genuine fix needs more than 50 lines, that is a feature-scoped change — spawn `builder`, get pr-reviewer, do not roll it through the auto-fix path.
3. **G3 — Category allowlist.** Auto-fix is allowed for: SQL/migration syntax, lint, typecheck, missing imports, gate-script bugs, RLS-contract violations, idempotency-index issues. Auto-fix is **escalate-immediately** for: failing unit / integration tests, security-scanner findings, "Workspace Actor Coverage" or similar policy gates, anything whose name does not match the allowlist.
4. **G4 — Mandatory post-merge audit log.** Every iteration appends to `tasks/review-logs/auto-fix-log-{slug}-{timestamp}.md` with failed check, root cause, category, guardrail status, fix summary, commit sha, and CI re-fire result. The squash-commit preserves the log so post-hoc review of "what did the bot do under my nose" takes 30 seconds.

**Why the guardrails matter.** The operator stated they do not review CI output themselves. That changes the risk profile of auto-fix from "minor inconvenience if the bot is wrong" to "real bug ships with no human gate". The four guardrails preserve the automation while bounding the blast radius — auto-fix handles "obvious mechanical CI red", escalation handles "behaviour might actually be broken".

**Detection heuristic for future drift.** If a future agent edit removes any guardrail (G1–G4), the iteration cap (5), the stuck-detection rule, or the no-`--no-verify` rule, treat it as a contract violation and surface to operator before merging the change. These four guardrails are the difference between automated maintenance and unbounded agentic merge.

**Applies to:** `.claude/agents/finalisation-coordinator.md` Steps 11, 12, 13. Locked in by operator 2026-05-09.


### [2026-05-09] Pattern — Paired-event accumulators need explicit stable identity, never "latest prior in same scope"

**Date:** 2026-05-09
**Source:** finalisation-coordinator finalisation pass on PR #276 (slug: agent-workspace); chatgpt-pr-review Round 1 B3 + Round 2 R2-S2 (agentWorkingTimeService.ts step pairing).

Whenever a service pairs `*_started` / `*_completed` (or `*_open` / `*_closed`) events into intervals, the pairing key MUST be a stable identity carried by both ends — `payload.stepId`, `(taskId, taskSequence)`, span_id, observation_correlation_id, etc. The "latest prior `*_started` in the same scope" pattern silently mispairs under three real-world conditions: concurrent intervals in the same scope, retries (a started event re-fires before the previous completed), and nested intervals.

**Pattern (mandatory shape).** Pair end-to-start by exact identity. If the end carries identity but no matching start exists, **drop the pair and warn** (`<service>.identity_missing`) — never cross-fall through to a fallback path that could match a different open. The cross-fallthrough is what destroys correctness: a stepId-bearing end that falls through to an unidentified slot pairs with whichever step happens to be open, not with its actual sibling.

**Strict fallback rule.** A run-level / scope-level fallback (no identity on either side) is allowed ONLY when both ends lack identity AND no identified open exists in that scope. The "no identified open" check is what prevents an unidentified end from cross-pairing to an identified start. Pure-helper invariant: the fallback opens at most ONE slot per scope and never pairs an end to an unrelated start; the worst case is an under-count, never mis-attribution.

**Detection heuristic.** Any service that uses `WHERE event_type = '<X>_started' AND sequenceNumber < <ours> ORDER BY sequenceNumber DESC LIMIT 1` to find a pair is using the broken pattern. Replace with identity-keyed lookup; keep the legacy fallback only if you also count identified opens and refuse to pair when one is in flight. Tests must include: (a) interleaved concurrent intervals in same scope with explicit identity, (b) retry where the same identity re-fires, (c) asymmetric identity (one end carries it, the other does not — must drop), (d) ambiguous unidentified end while an identified open is in flight (must drop). Files: `server/services/agentWorkingTimeService.ts` + `server/services/agentWorkingTimeServicePure.ts` + `server/services/agentWorkingTimeServicePure.test.ts`.

### [2026-05-09] Pattern — Permission-gated UI surfaces must fail closed during async permission load

**Date:** 2026-05-09
**Source:** finalisation-coordinator finalisation pass on PR #276 (slug: agent-workspace); chatgpt-pr-review Round 2 R2-S1 (AgentEditPage.tsx Overview tab gate).

When a UI surface is permission-gated and the permission set loads asynchronously (e.g. `/api/my-permissions` fetch on mount), the default during the pre-fetch window MUST be "hide everything that has a gate", not "show everything". The opposite default — render the gated affordance, redirect once perms arrive — has two failure modes: (a) UI contract violation (the "tab does not appear" guarantee is broken for the brief flicker window even when the backend rejects the data), and (b) the gated component can mount and fire a protected backend request before the redirect, producing 403s that look like real failures in observability.

**Pattern (mandatory shape).** Treat `permissions === null` as "permission denied" for the purpose of visibility computation, not as "permission unknown, show everything". Hold the page-level loading state until both the resource fetch AND the permission fetch resolve — never render a tab strip / sidebar / button row that includes a gated affordance while permissions are loading. Admin / system_admin paths can short-circuit (always-visible, never gated) if the role flag is locally cached.

**Detection heuristic.** Any `useMemo` / filter that returns the full unfiltered list when the permission state is `null` is using the broken pattern. The correct shape is: `if (perms === null) return false` (per-tab) inside the filter. Pair this with a top-level `if (permsAreLoading) return <Loading/>` so content rendering also waits.

File: `client/src/pages/build/AgentEditPage.tsx`.


### [2026-05-09] Correction — finalisation-coordinator must commit Phase 3 BEFORE applying ready-to-merge label

**Date:** 2026-05-09
**Source:** Operator correction during PR #276 (slug: agent-workspace) Phase 3 finalisation. The original `finalisation-coordinator` Step 10 ordered: apply label → write handoff → write current-focus → commit → push. Applying the label fired CI on the pre-Phase-3 HEAD; the Phase 3 commit then landed and re-fired CI from scratch. Operator caught it and pointed out the wasted compute / wasted minutes.

**Rule:** the ready-to-merge label is what triggers CI on this repo. CI must therefore fire against the final post-Phase-3 commit, never against a pre-Phase-3 HEAD that the next push will immediately invalidate. Apply the label LAST in the Phase 3 sequence, AFTER all Phase 3 artefacts (`handoff.md`, `current-focus.md`, `KNOWLEDGE.md`, `tasks/todo.md`) are committed and pushed.

**Required Step 10 order (locked):**

1. Capture `LABEL_TIMESTAMP_PLACEHOLDER` via `date -u`.
2. Write `tasks/builds/{slug}/handoff.md` Phase 3 section (recording the placeholder timestamp).
3. Write `tasks/current-focus.md` mission-control + prose for MERGE_READY.
4. Commit all four files in a single `chore(finalisation-coordinator): Phase 3 complete` commit.
5. Push to remote. **Wait for push to complete.**
6. THEN run `gh pr edit {N} --add-label "ready-to-merge"`.

The pre-captured placeholder timestamp is the operator-visible "labelling moment" recorded in the handoff. Drift between the placeholder and the actual `gh` call is at most a few seconds and is acceptable; the alternative (capture timestamp after `gh`, then amend the handoff) requires either an `--amend` (forbidden in this flow) or a second commit (which itself triggers a third CI run).

**Detection heuristic.** If a future `finalisation-coordinator` edit reorders Step 10 such that `gh pr edit ... --add-label "ready-to-merge"` runs before the Phase 3 commit, treat it as a contract violation and surface to the operator before merging the change. The label-after-commit ordering is what makes the auto-CI-watch loop affordable; reverting it doubles every Phase 3's CI cost.

**Applies to:** `.claude/agents/finalisation-coordinator.md` Step 10. Locked in by operator 2026-05-09.


### [2026-05-09] Correction — four CI-only gates that G1 (lint + typecheck) misses; comply WHILE writing, not after

**Date:** 2026-05-09
**Source:** Operator correction during PR #276 (slug: agent-workspace) Phase 3 finalisation. CI red after `ready-to-merge` label fired surfaced four blocking-gate failures that G1 did not catch. Operator asked: "anything you can add into knowledge or doco to prevent this in the future instead of having to fix it from failing tests".

The G1 gate run inside `builder` only exercises lint + typecheck + targeted vitest. Four static gates run CI-only and routinely catch chunks that G1 cleared. Every one of them is mechanical to satisfy WHILE writing the chunk and 10–30× more expensive to fix retroactively.

**The four gates and their pre-flight rules:**

1. **`verify-test-quality.sh`** — `*.test.ts` MUST live under `__tests__/`. Inline siblings (`server/services/foo.test.ts`) are silently invisible to Vitest's discovery glob. Correct shape: `server/services/__tests__/foo.test.ts` (and the import is `../foo`, not `./foo`). Same rule for `client/src/**/*.test.ts`. PR #276 had 7 violations from chunks that landed tests inline. Reference: `docs/testing-conventions.md § Test discovery`.

2. **`verify-rls-coverage.sh`** — `CREATE POLICY <name> ON <table>` must be on a single line. The gate uses line-oriented grep. Splitting across two lines (`CREATE POLICY <name>\n  ON <table>`) makes the gate fail to match. The body (`USING (...) / WITH CHECK (...)`) can wrap normally. PR #274 + PR #276 both hit this. KNOWLEDGE.md `[2026-05-08]` recorded the PR #274 instance and the rule still got missed in PR #276 — promote it from history to a checklist item every migration writer reads.

3. **`verify-rls-contract-compliance.sh`** — no raw `db` import from `server/db/index.js` outside `server/services/**`. New helpers in `server/lib/*.ts` that need a query either: (a) use `getOrgScopedDb('caller-tag')` from `server/lib/orgScopedDb.ts` (allowed everywhere); (b) move into a `server/services/` file; or (c) deliberately add the path to `ALLOWLIST_DIRS` in `scripts/verify-rls-contract-compliance.sh` (reserved for short bootstrap helpers — `resolveSubaccount.ts`, `resolveAgent.ts` are the precedents).

4. **FK references to `agent_execution_events(id)` need `ON DELETE` clause.** Default `NO ACTION` blocks integration-test cleanup that deletes events for the run. Pointer columns (nullable: "last seen", "current focus") → `ON DELETE SET NULL`. Dependent rows (NOT NULL: "this row was generated from this event") → think about retention before choosing CASCADE vs the default. PR #276's `agent_presence_projections.last_event_id_fkey` was the first integration-test failure; both pointer columns now `SET NULL`.

**Why the rule lives here AND in `builder.md`.** The `builder` agent definition has a "CI-gate pre-flight" subsection in Step 3 — that's the workflow-level reminder. KNOWLEDGE.md is the durable cross-session record so the lesson survives builder agent revisions and so any agent reading project knowledge sees it as a known-tripwire pattern.

**Detection heuristic.** When writing or reviewing a chunk that touches: any new `*.test.ts` (gate 1), any new `migrations/*.sql` (gate 2 + gate 4), any new `server/lib/*.ts` that queries the DB (gate 3) — run the corresponding compliance check by hand before claiming SUCCESS:

- `find <chunk dir> -name '*.test.ts' -not -path '*/__tests__/*' -print` should return zero.
- `grep -E '^CREATE POLICY[^O]*$' migrations/<new>.sql` should return zero (any line that starts with CREATE POLICY but has no ON before EOL).
- `grep -l "from '../db/index" server/lib/<new-files>.ts` plus check it's in the gate allowlist.
- `grep "REFERENCES agent_execution_events" migrations/<new>.sql` should not return entries without an `ON DELETE` clause unless the column is intentionally `NO ACTION`.

**Applies to:** `.claude/agents/builder.md` Step 3 ("CI-gate pre-flight"); `docs/testing-conventions.md § Test discovery` (already names the rule but builder agents missed it). Locked in by operator 2026-05-09.


### [2026-05-09] Sub-pattern — `verify-pure-helper-convention.sh` requires `.js` extension on relative imports

**Date:** 2026-05-09
**Source:** Phase 3 finalisation auto-fix iteration 2 on PR #276 (slug: agent-workspace). Iteration 1 fixed test-file location (`./X` → `../X`); iteration 2 caught a follow-on gate failure because the gate's regex requires `.js` on the relative import.

The gate (`scripts/verify-pure-helper-convention.sh`) checks that every test file under `__tests__/` imports something from its parent directory. The grep pattern is `from\s+'(\.\./|\./)[^']+\.js'` — the `.js` extension is required. Without it, a TypeScript-only relative import like `from '../somethingPure'` is invisible to the gate even though TypeScript resolves it correctly.

**Pattern (mandatory shape).** Every relative import in a test file MUST end in `.js` — both the sibling-module import and any deeper relative path (`../../../shared/types/X.js`). This matches the project's TypeScript-ESM `nodenext` resolution mode and the gate's regex.

**Detection heuristic.** Pair this check with the test-file-location check in builder.md Step 3:

- `find <new-test-files> -name '*.test.ts' | xargs grep -E "from '(\.\./|\./)[^']+'$"` should return zero (every relative import should have an extension).
- If zero, also check `from '(\.\./|\./)[^']+\.ts'` is zero (never `.ts` — always `.js` for ESM resolution).

**Applies to:** `.claude/agents/builder.md` Step 3 "CI-gate pre-flight"; `KNOWLEDGE.md [2026-05-09] Correction — four CI-only gates that G1 misses` (this is sub-rule 1.b — the `.js` extension requirement on relative imports inside `__tests__/`).


### [2026-05-09] Correction — finalisation-coordinator merge command must use `--admin --squash --delete-branch`

**Date:** 2026-05-09
**Source:** Operator correction during PR #276 (slug: agent-workspace) Phase 3 finalisation merge step. The original `finalisation-coordinator` Step 12.3 used `gh pr merge {N} --squash --delete-branch`. The post-merge-prep commit in 12.2 (a docs-only `tasks/current-focus.md` edit setting status to NONE + capturing the squash-sha placeholder) triggers a fresh CI run on push. The merge then has to wait for required status checks to pass on a commit that changes nothing CI cares about — pure compute / wall-clock waste.

**Rule.** `gh pr merge` in 12.3 is invoked with `--admin --squash --delete-branch`. The `--admin` flag bypasses the required-status-checks gate and merges immediately. This is safe because:

- The prep commit in 12.2 is pure metadata: `tasks/current-focus.md` only. It cannot break code, schema, RLS, lint, or types.
- The PREVIOUS commit (the last code-bearing commit on the feature branch) already passed all required checks before Step 12.1 was reached. That's the actual "what shipped" content; the squash-merge bundles the prep commit in but adds no new risk.
- Required-status-checks is the contract for code changes; `--admin` is the documented operator override for exactly this kind of metadata-only trailing commit.

**Apply to:** `.claude/agents/finalisation-coordinator.md` Step 12.3. Locked in by operator 2026-05-09.

**Detection heuristic.** Any future Phase-3 merge that does NOT use `--admin` either: (a) skips the prep commit entirely (also valid — but loses the bundled `current-focus → NONE` state in the squash), OR (b) wastes a full CI run on a docs-only commit. If the playbook ever drops `--admin`, treat as a contract violation and surface to operator before merging.


### [2026-05-09] Pattern — deferred-FK migration when two new tables reference each other (cross-cycle)

**Date:** 2026-05-09
**Source:** chatgpt-spec-review Round 1 finding F1 on `support-desk-canonical` spec. ChatGPT caught that `canonical_ticket_messages.source_draft_id` was declared as an inline FK to `canonical_ticket_drafts(id)`, but the schema chunks had `canonical_ticket_messages` (migration 0310) landing BEFORE `canonical_ticket_drafts` (migration 0311). The migration would have failed at apply time because the referenced table doesn't yet exist.

When two new tables reference each other in either direction, you cannot satisfy both FKs at table-create time — at least one direction must be deferred to a later migration. Three valid strategies, in order of preference:

1. **Order them so the cycle resolves.** If A.fk_b → B and B has no FK back to A, create B first. Always preferred when the cycle is one-way; the spec's chunk ordering should naturally land the producer table first.
2. **Deferred FK via ALTER TABLE.** When the cycle is genuine (A → B and B → A), the second migration adds the FK constraint after the second table lands: `ALTER TABLE first_table ADD CONSTRAINT first_fk_x FOREIGN KEY (x) REFERENCES second_table(id);`. The first migration declares the column without the inline FK reference. The partial index (`WHERE x IS NOT NULL`) lands in the same later migration as the FK — both are only meaningful once the referenced table exists.
3. **Drop the DB FK and enforce in service layer.** Last resort. Use only when the FK semantics are too weak for a real constraint (e.g. cross-tenant pointer where RLS would make the FK check fail anyway).

**Pattern (mandatory shape).** Spec the migration ordering explicitly in the phase plan and again in the schema sections of each affected table. Make the deferred-FK pattern visible — name the migration that creates the column, AND the migration that adds the FK + partial index, in both schema sections. Do not rely on chunk ordering alone to communicate the deferral.

**Detection heuristic.** When reviewing a spec's data-model section, grep for FKs whose target table is created in a later chunk than the source table. If any are found, the spec is broken — either reorder the chunks or document the deferred-FK pattern.

**Applies to:** future spec authoring (`docs/spec-authoring-checklist.md` Section 6 phase sequencing — backward-dependency check should include "FKs to tables created later").


### [2026-05-09] Pattern — polymorphic FK splitting in Postgres (no native support)

**Date:** 2026-05-09
**Source:** chatgpt-spec-review Round 1 finding F2 on `support-desk-canonical` spec. The first draft had `canonical_ticket_messages.author_id` as a single UUID column referencing `canonical_contacts.id` when `author_type='customer'` and `canonical_support_agents.id` when `author_type IN ('agent','bot')`. A single Postgres column cannot have conditional FKs to two different parent tables — the constraint syntax has no `WHEN <discriminator>` clause and there is no native polymorphic-association pattern.

**Pattern (mandatory shape).** Split the polymorphic column into one nullable column per target table, plus a CHECK constraint enforcing exactly-one-non-null tied to the discriminator. Example:

```sql
author_type text NOT NULL CHECK (author_type IN ('customer','agent','bot','system')),
author_contact_id uuid REFERENCES canonical_contacts(id),
author_support_agent_id uuid REFERENCES canonical_support_agents(id),
CONSTRAINT author_id_matches_type CHECK (
  (author_type = 'customer' AND author_support_agent_id IS NULL)
  OR (author_type IN ('agent','bot') AND author_contact_id IS NULL AND author_support_agent_id IS NOT NULL)
  OR (author_type = 'system' AND author_contact_id IS NULL AND author_support_agent_id IS NULL)
);
```

The `author_contact_id` column is allowed to be NULL even when `author_type='customer'` (e.g. customer email did not match a canonical contact at ingestion); the support-agent column is the only column that's NOT NULL for its discriminator.

**Detection heuristic.** When reviewing a spec, grep for prose like "FK to X if Y, FK to Z if not" or column descriptions that reference multiple parent tables. If found, the column is impossible as written — split it.

**Applies to:** future spec authoring. The spec-authoring checklist's "Existing primitives search" (Section 1) should add a sub-rule: "polymorphic FKs are not a primitive — split into typed nullable columns + CHECK constraint per discriminator."


### [2026-05-09] Pattern — polling absence ≠ deletion; tombstoning requires either webhook or strict full-reconciliation

**Date:** 2026-05-09
**Source:** chatgpt-spec-review Round 2 finding F1 on `support-desk-canonical` spec. The first draft of the deletion logic in `canonical_tickets` set `provider_deleted=true` "when a poll cycle proves a previously-known ticket is no longer returned by the provider." With incremental polling, pagination, rate limits, partial page failure, cursor windows, inbox filters, or provider search semantics, "not returned" almost always means "not in this slice", NOT "deleted."

A false tombstone is the worst-case correctness failure for a canonical-ingestion layer: it hides live tickets from the agent queue. The agent stops responding to them; the operator may not notice; the customer waits.

**Pattern (mandatory shape).** Tombstone-by-poll requires ALL of the following preconditions to hold for the pass that issues the tombstone:

1. Explicit **full-reconciliation pass** (a distinct cadence from the day-to-day incremental cycle — e.g. nightly per-inbox or operator-triggered).
2. Every page of the relevant provider endpoint completed successfully (no partial pagination state).
3. No `provider.poll_page_failed` was emitted during the pass for the relevant scope.
4. No rate-limit truncation (`provider.rate_limited` did not interrupt the pass).
5. The provider endpoint used has semantics where absence proves deletion (an unfiltered "all entities in this scope" endpoint, NOT a filtered or windowed search).

**Incremental polls must NEVER tombstone.** A row missing from an incremental window is "not in this slice", not "deleted." Specs that conflate the two are unsafe.

If any precondition fails, deletion is **webhook-only** for the affected scope until the next qualifying full-reconciliation pass succeeds. The webhook path is unconditional — provider deletion events are deterministic.

**Detection heuristic.** When reviewing a spec that introduces tombstone columns (`*_deleted`, `deleted_at`, `tombstoned`), grep for "poll" within the same section. If polling can set the tombstone, the spec must enumerate the full-reconciliation precondition — otherwise it is unsafe. Same rule applies to "out of scope" / "removed from view" boolean columns where the source-of-truth is a polled provider.

**Applies to:** future spec authoring. Any spec that mirrors provider entities and supports deletion must include this precondition in its data-model section. The spec-authoring checklist Section 10 (execution-safety contracts) should add a sub-rule for deletion-by-poll.




### [2026-05-09] Pattern — symmetric ingest paths must both implement the same FK / CHECK contracts

**Date:** 2026-05-09
**Source:** dual-reviewer iter-1 P1 #2 + pr-reviewer round 3 B1 on `support-desk-canonical` Phase 2. Two convergent ingest paths (polling Phase D + webhook delivery) both write to the same canonical table (`canonical_ticket_messages`). Migration 0310 enforces a polymorphic-FK CHECK requiring `author_support_agent_id NOT NULL` for `author_type IN ('agent','bot')`.

The polling path was patched first (dual-reviewer iter-1) by adding the agent lookup. The webhook path was missed — every webhook-delivered agent reply would have failed the CHECK constraint at insert, aborting the transaction silently. A second review round caught it; without that round it would have shipped to prod and broken every agent reply via webhook.

**Pattern (mandatory shape).** When a canonical table has multiple ingest paths (polling + webhook + manual + import), every path must independently:
1. Resolve the same FK lookups (author, contact, agent — whichever the schema requires).
2. Honour the same CHECK constraints (polymorphic discriminators, asymmetric NULL rules, status-invariant CHECKs).
3. Emit the same `INGEST_CONTRACT_VIOLATION` (or equivalent) on lookup failure and skip the insert without crashing the surrounding transaction.

A patch to one ingest path is incomplete unless the symmetric paths are patched in the same commit. Reviewers must verify symmetry explicitly — "I fixed the polling path" is not "I fixed the bug."

**Detection heuristic.** When fixing an ingest-path bug, grep for OTHER call sites that insert into the same canonical table. Specifically search for `insert(canonicalTable)` and `tx.insert(canonicalTable)` patterns. Each call site is a separate ingest path that must satisfy the same contracts. The polling/webhook split is the most common case but not the only one — also check boot-recovery loops, manual-resolve handlers, and import scripts.

**Applies to:** any canonical table with FK / CHECK contracts and >1 ingest path. Generalises beyond support — same rule for canonical_contacts (CRM polling + GHL webhook + Stripe webhook), canonical_revenue (Stripe polling + Stripe webhook + manual entry), etc.


### [2026-05-09] Pattern — cross-tenant boot scans against FORCE-RLS tables silently no-op without admin role

[cross-reference 2026-05] See also the 2026-05-05 canonical entry `db.transaction() opened from module-level pool runs WITHOUT GUC` above for the broader "what goes wrong" family.

**Date:** 2026-05-09
**Source:** pr-reviewer round 3 B2 on `support-desk-canonical` Phase 2. `supportDispatchBootRecovery.ts` imported raw `db` and ran a `SELECT ... FROM canonical_ticket_drafts WHERE status = 'dispatching'` at server boot. Intended behaviour: scan all orgs for stranded drafts and re-enqueue. Actual behaviour: the FORCE-RLS policy on `canonical_ticket_drafts` requires `current_setting('app.organisation_id', true) IS NOT NULL`. At boot, no session var is set; the policy fails closed; the SELECT returns ZERO rows even when stranded drafts exist. **The R5 mitigation is silently a no-op** — every restart leaks dispatching drafts.

A `// guard-ignore reason="boot-time cross-tenant scan"` comment ACKNOWLEDGES the intent but does NOT authorise the access — RLS is enforced at the DB role layer, not the application layer.

**Pattern (mandatory shape).** Boot-time cross-tenant scans against FORCE-RLS tables MUST:
1. Use `withAdminConnectionGuarded({ allowRlsBypass: true, source, reason })` from `server/lib/rlsBoundaryGuard.ts`.
2. Issue `SET LOCAL ROLE admin_role` as the FIRST `tx.execute(...)` call inside the callback, before any SELECT/UPDATE.
3. Perform per-row UPDATEs through the same boundary-wrapped `tx` handle (the proxy enforces `wrapWithBoundary` checks).
4. Justify `allowRlsBypass: true` inline within +/-1 line of the call (satisfies `verify-rls-protected-tables.sh` check 3).

The `guard-ignore` comment is not a substitute for proper admin-role bypass — it only suppresses the static lint, not the runtime RLS policy.

**Detection heuristic.** Grep boot-time / startup / scheduled-job code for `db.select(`, `db.update(`, `db.insert(` against canonical or RLS-protected tables. If the code runs without a per-call org context (no `withOrgTx`, no `getOrgScopedDb`), it must be inside `withAdminConnectionGuarded` with explicit `SET LOCAL ROLE admin_role`. Otherwise the access silently no-ops in prod and the operator never sees an error.

**Applies to:** boot recovery jobs, maintenance jobs, cross-tenant sweepers, billing aggregators — anywhere a startup or scheduled task needs to scan across organisations. Same rule applies to peer-medians materialised view refresh, baseline rot detectors, and any future cross-tenant background work.

### [2026-05-09] Pattern — Spec-design: drop the backfill that contradicts a conservative default introduced in the same spec

**Date:** 2026-05-09
**Source:** ChatGPT spec review of `tasks/builds/synthetos-foundation-refactor/spec.md` round 1, finding F1. Session log: `tasks/review-logs/chatgpt-spec-review-synthetos-foundation-refactor-2026-05-09T07-43-56Z.md`.

**Rule.** When a spec adds (i) a new column with a conservative DEFAULT, (ii) a new governance column with a conservative DEFAULT that constrains downstream behaviour, AND (iii) a one-shot UPDATE that retroactively rewrites historical rows on the new column — check whether (iii) writes values the new governance default in (ii) would block. If yes, the backfill creates a permanent row-vs-policy mismatch (e.g., `agent_runs.controller_style = 'operator'` for an agent whose `subaccount_agents.controller_style_allowed = 'native_only'`). Drop the backfill rather than constraining it: the constrained version usually no-ops in practice (because the conservative default applies to almost all rows) and the unconstrained version produces inconsistent state. Forward-only on the new column is the right trade.

**Apply to:** every spec that adds a new typed/enum column on a hot table AND introduces a governance column or default that gates downstream values on that column. Specifically: when migration N introduces both columns, ask "does my proposed backfill on column A write values that column B's default would forbid?". If yes, drop the backfill in the spec and document the forward-only trade (existing rows render with the conservative default; historical accuracy is the explicit cost).

**Detection heuristic.** During spec review, grep the spec for `UPDATE.*SET.*WHERE.*default` patterns and cross-check against any new `DEFAULT` introduced in the same migration set. The contradiction is invisible at the SQL level (both statements are valid) but produces a class of "agent allow-list says X but historical run says Y" data states that surface confusingly months later in Run Trace UI.

**Related:** the same review caught a CI-gate script using `node --eval "require('./....ts')"` (won't load TypeScript without a loader). Repo precedent for typed verifier harnesses is `npx tsx scripts/foo.ts` invoked from a thin bash wrapper — see `scripts/verify-visibility-parity.sh`. When sketching a new verify gate in a spec, match the existing repo pattern (bash + awk for source-text scans; bash + `npx tsx` for typed import-then-check). Don't invent a third pattern.

## Pattern: First-resolver-wins UPDATE on per-run JSONB snapshots requires snapshot.organisationId as the predicate source

**Context.** The Policy Envelope `persist` function (`server/services/policyEnvelopeResolver.ts`) writes a one-shot JSONB snapshot to `agent_runs` with `WHERE id = $runId AND policy_envelope_snapshot IS NULL`, and re-reads on zero-rows-affected to distinguish "another resolver won" from "row missing". Round-1 pr-reviewer flagged the missing `organisationId` predicate per DEVELOPMENT_GUIDELINES §1 ("filter by organisationId in app code, even with RLS").

**Resolution.** The snapshot itself encodes the run's `organisationId` because the resolver computes it from `ctx.organisationId` before assembly. Use `snapshot.organisationId` as the predicate source in both the UPDATE and the re-read — same value the resolver was scoped against, no risk of the predicate disagreeing with the data being written.

**Why this matters.** Reading from a separate context object would create a class of bugs where the snapshot's contents differ from the predicate's scope. Sourcing from the snapshot itself makes the invariant load-bearing: if the snapshot's `organisationId` is wrong, the UPDATE matches nothing and the loop fails closed.

## Pattern: `replace_all=true` silently misses identical strings with different leading indentation

**Context.** Round-2 pr-reviewer fix replaced two `console.log('foundation.risk_tier.gate_derived', { … })` blocks in `policyEngineService.ts` with `replace_all=true`. The two call sites had different leading indentation (8 spaces inside a `for-of` loop body vs 4 spaces at function-body top level). `replace_all` operates on exact-match strings — only the first site converted; the second was missed. Round-3 pr-reviewer caught it; required a second surgical Edit.

**Resolution.** When replacing call-site patterns that may appear at different indentation levels, do separate surgical Edits per site OR use a regex tool. `replace_all` is for true rename-style replacements (e.g., a single identifier).

**Why this matters.** Linter/typecheck both passed because half-converted code was still valid. Only the human reviewer caught it. Add to the mental checklist for "identical-content blocks at multiple call sites".

## Pattern: Pagination correctness requires SQL filter pushdown, never in-memory filter after LIMIT

**Context.** Run Trace service (`server/services/runTraceService.ts`) initially fetched `LIMIT N+1` rows from a UNION ALL across 7 ledger tables, then applied cursor / eventType / sinceTimestamp / untilTimestamp / toolSlug filters in JavaScript. Codex (dual-reviewer) caught that any filter that reduces the page size below `limit` makes page 2 unreachable — the cursor stops as soon as one filtered page returns less than `limit`, even though more matching events exist downstream.

**Resolution.** Push every filter predicate into the SQL query: cursor as a tuple comparison `(ts, COALESCE(seq,0), source_table, source_id) > $cursor` matching the canonical ORDER BY; `eventType = ANY($::text[])` against the post-translation column; per-arm `toolSlug` predicates that emit `AND FALSE` for non-tool-scoped UNION arms; `ts >= $since::timestamptz` / `ts <= $until::timestamptz`. The LIMIT then operates on the already-filtered row set.

**Detection heuristic.** Whenever a UNION ALL or paginated query feeds a downstream JavaScript `.filter()` call, the LIMIT is applied against the wrong row set. Treat in-memory filtering after LIMIT as a paging-correctness bug, not just a performance hint.

## Pattern: Subaccount-scoped fallback UPDATE must filter by subaccountId, not just organisationId

**Context.** The CredentialBrokerService `revoke` method initially scoped its fallback UPDATE for subaccount-scoped connections by `(id, organisationId)` only. An actor with `CONNECTIONS_MANAGE` on subaccount-A could call `DELETE /api/subaccounts/<sub-A>/connections/<sub-B-connection>` and revoke a sibling subaccount's credential within the same org. The route resolved subaccount-A but did not pass it to the broker — the broker's fallback UPDATE matched any connection in the org.

**Resolution.** Make `subaccountId` a required param on `revoke` (typed `string | null` so org-level vs subaccount-scoped revokes are explicit), and always include the subaccount predicate in the fallback UPDATE: `eq(connections.subaccountId, params.subaccountId)` for subaccount-scoped, `isNull(connections.subaccountId)` for org-level. Codex (dual-reviewer) further hardened by strict-branching on `subaccountId === null` to choose between the two delegate paths up front. Return type changed from `void` to `boolean` so callers can restore the pre-broker 404 behaviour for missing/cross-scope IDs.

**Why this matters.** This is a class of cross-tenant-within-org isolation hole that adversarial-reviewer's auto-trigger surface (server/db/schema, routes, middleware) catches at the route layer but misses at the service-layer when the route looks correct. The defense-in-depth is to make subaccountId a hard parameter at the service boundary.

## Pattern: Stable structured-log codes must use logger.info, never console.log

**Context.** New foundation log codes (`foundation.risk_tier.gate_derived`, `foundation.policy_envelope.resolution_failed`, etc.) had two `console.log` call sites in `policyEngineService.ts` instead of `logger.info`. Downstream observability and alerting consume these codes via the structured-log pipeline (correlation IDs, level, structured fields). `console.log` writes to stdout outside that pipeline, breaking ingestion of half the events emitted from that service.

**Resolution.** All new stable log codes route through `import { logger } from '../lib/logger.js'`. Sibling new services (`credentialBrokerService.ts`, `runTraceService.ts`) had it correct from chunk 5; `policyEngineService.ts` regressed because it pre-existed and the chunk-4 patch didn't add the import. Lint/typecheck don't catch this — the contract is "downstream consumes the stable code", which is observability, not type-system.

**Detection heuristic.** When introducing a new namespaced log code (`<feature>.<event>`), grep the file for both `console.log('<code>` and `logger.info('<code>` — only the structured form should appear.

## Pattern: Type seam for future variants — declare the wider type now, restrict registration at runtime

**Context.** While locking the ExecutionBackend Adapter Contract spec (`tasks/builds/execution-backend-adapter-contract/spec.md`), ChatGPT-spec-review F1 caught that typing `ExecutionBackend.id` as `ExecutionMode` (a closed five-value union) would force a future cascading rename when OpenClaw lands and introduces internal variants like `openclaw_managed` vs `openclaw_external`. Renaming a contract type after it has propagated through the registry, finaliser, and reconcile signatures is exactly the kind of "expensive to retrofit" cost that's cheap to pre-empt at spec time.

**Resolution.** Introduce the wider type now (`ExecutionBackendId = ExecutionMode | 'openclaw_managed' | 'openclaw_external'`) and key the registry, `resolve()`, finaliser, and reconcile on it. Keep dispatch keyed on the narrower `ExecutionMode` (subtype assignment is automatic). Restrict V1 by a runtime guard at registration time: a register-call carrying an OpenClaw `ExecutionBackendId` value throws `BackendCapabilityViolation('OpenClaw backend ids reserved for Phase 3')`. The guard is removed when the OpenClaw adapter lands.

**Why this matters.** A type seam carries forward without code changes; a type rename touches every call site. The wider type costs nothing at runtime (V1 still only registers ExecutionMode values) but eliminates a future PR that exists solely to rename the parameter type at every dispatch / finalise / reconcile call site. Apply this pattern whenever a contract field will plausibly need to accept additional discriminant values within the next ~2 specs — the cost-to-add-now is one type definition; the cost-to-add-later is a contract-wide rename.

**Detection heuristic.** During spec review, ask: "is this id/discriminant typed as a closed union that the spec itself already mentions might expand?" If yes, expand the type now and restrict at runtime.

## Pattern: Service-layer circular import — extract shared types into a neutral file

**Context.** Same spec session, F3. Adapter types (`executionBackends/types.ts`) needed `TokenBudget` and `LoopResult` from `agentExecutionService.ts`, while `agentExecutionService.ts` imports `executionBackends/registry.ts` (which imports `executionBackends/types.ts`). Result: `types.ts → agentExecutionService.ts → registry.ts → types.ts` cycle. This is the service-layer analogue of the 2026-04-25 schema-as-leaf finding (KNOWLEDGE.md), but the fix shape is different.

**Resolution.** Extract the shared type aliases (`TokenBudget`, `LoopResult`) into a new neutral file (`server/services/agentExecutionTypes.ts`) — type aliases only, zero runtime code. Both consumers import directly from the neutral file. The original service file re-exports the types for backwards compatibility with existing consumers (so call sites do not churn). Acceptance test: `expect(typesModuleSource).not.toMatch(/from .+agentExecutionService/)` in the contract pure test.

**Why this matters.** Schema-leaf and service-leaf cycles have the same root cause (a leaf depending upward) but different fix shapes — schema fix is to drop the import; service fix is to relocate the shared type. Don't try to fix a service-layer cycle by inverting one of the imports; the right move is to lift the shared shape into a neutral module that neither side owns.

**Detection heuristic.** When a new file references a "private" type from a module that will eventually depend on the new file, treat the type as already-shared and lift it before authoring the new module. The cycle is preventable at design time; catching it at typecheck time is rework.
## Pattern: actionRegistry directory-shim split (refactor-action-registry, 2026-05-10)

**Context.** The monolithic `server/config/actionRegistry.ts` (3971 lines) was split into per-domain modules under `server/config/actionRegistry/` as part of the refactor-action-registry build.

**Directory shape:**

```
server/config/actionRegistry/
  types.ts          — ActionDefinition type + factory helper types (unchanged)
  factories.ts      — nine deep-module factory functions (unchanged)
  core.ts           — capability discovery, email/tasks, devops, workflow entries
  intelligence.ts   — cross-subaccount intelligence, universal skills, social media
  agents.ts         — ads, CRM, finance, content/SEO, knowledge management
  methodology.ts    — read_priority_feed, search_agent_history, 31 methodology skills
  configuration.ts  — config-write skills, Phase G digest skills, workflow.run.start
  clientpulse.ts    — crm.* actions, notify_operator, cached_context_budget_breach
  commerce.ts       — spend skills, promote_spending_policy_to_live
  support.ts        — support.* actions
  index.ts          — assembles all domains, runs IIFE, exports all helpers/constants
```

`server/config/actionRegistry.ts` is a 3-line re-export shim (`export * from './actionRegistry/index.js'`). All callers resolve unchanged.

**Key constraints:**

1. **Insertion order.** The spread order in `index.ts` must match the original file's section order: `coreActions, intelligenceActions, agentsActions, methodologyActions, configurationActions, clientpulseActions, commerceActions, supportActions`. V8 preserves insertion order for non-integer string keys.

2. **IIFE runs AFTER all spreads.** `applyRuntimeCheckCoverageDefaults` mutates `ACTION_REGISTRY` post-construction. It must appear in `index.ts` after the final spread, never in a domain module.

3. **IIFE-target factories must not pre-populate IIFE-owned fields; inline-bucket factories must.** `verify`, `verifyNullJustification`, `reversible`, and `blastRadius` are set by the trailing IIFE sweep for entries that don't set them inline. The seven IIFE-target factories (`defineCanonicalRead`, `defineInternalRead`, `defineExternalRead`, `defineInternalStateWrite`, `defineExternalWrite`, `defineConfigWrite`, `defineMethodologySkill`) must leave these fields `undefined` so the IIFE can apply the bucket-correct defaults — pre-populating breaks the IIFE. The two inline-bucket factories (`defineCustomerMessagingWrite`, `defineSpendWrite`) DO pre-populate these because the original source's customer-messaging and spend entries carried inline justification strings that must be preserved byte-for-byte.

4. **Diff-test gate is the correctness oracle.** `scripts/diff-action-registry.ts` compares the built registry against `scripts/snapshots/action-registry.snapshot.json`. A pure file relocation produces zero semantic diff. Never modify the snapshot file — CI maintains it.

5. **Direct-object exceptions.** Roughly 25-30 entries don't fit any factory and stay as direct object literals in the relevant domain module. Common reasons: `actionCategory: 'api'` for internal reads (factories hardcode `'worker'`), entries with no `mcp` field (factories pre-populate it), unique `defaultGateLevel: 'block'`, dotted slugs, non-standard fields like `scopeRequirements`/`onFailure`, and customer-messaging-shaped entries whose IIFE-derived `blastRadius: 'tenant'` would shift to `'external'` under `defineCustomerMessagingWrite`. Each direct-object entry carries an inline comment naming the divergence.

**Why this matters.** The shim pattern is zero-cost for callers: `import { ACTION_REGISTRY } from 'server/config/actionRegistry.js'` still works. Adding a new skill means editing only the relevant domain module (e.g. `core.ts` for a new capability skill). The diff-test gate catches semantic drift without manual inspection of 3000-line diffs.

## Pattern: chatgpt-spec-review automated mode saturates around round 3 — stop on re-raise majority

**Context.** Running automated chatgpt-spec-review on `phase-1-showcase-mvps/spec.md` with `gpt-4.1`: round 1 produced 10 findings (6 real applies + 4 already-deferred/rejected). Round 2 produced 8 findings (6 real applies + 2 re-raises). Round 3 produced 10 findings of which 6 were re-raises of items already addressed in rounds 1-2, 1 was a project-policy rejection (frontend tests forbidden), 2 were already-deferred Open Decisions, 1 was a real low-severity apply.

**Resolution.** The agent contract says "Run automated rounds until APPROVED or 3 rounds elapse without APPROVED, then finalise." That's the saturation cap. Practical stopping rule: if round N produces 50%+ re-raises of already-addressed items, the loop has converged regardless of verdict — stop. Verdicts can stay CHANGES_REQUESTED indefinitely because the model rewords concerns the spec already handled.

**Detection heuristic.** Track findings by `evidence` text and rationale across rounds. A round where most rationales reference sections you edited in prior rounds is saturation. The model is generating noise, not finding new gaps.

## Pattern: Two-ledger artifact designs (worker-internal + customer-facing) need explicit drift-handling subsection

**Context.** Spec described `iee_artifacts` (worker-internal) and `run_artifacts` (customer-delivery) as separate by-design ledgers. ChatGPT spec-review raised "no canonical source of truth" three rounds in a row — once with the original framing, once after the round-1 drift-handling fix, once after the round-2 fix. The reviewer wanted a single source of truth even when the design intentionally has two.

**Resolution.** Document the two-ledger split with: (1) what each ledger covers, (2) what happens when one has a row the other doesn't (each direction's failure mode and self-healing path), (3) the explicit "no reconciliation worker" decision with rationale. Reviewers stop re-raising once the failure modes are enumerated.

**Detection heuristic.** Any spec that describes two ledgers/tables for the "same" data (worker vs main, internal vs external, ledger vs cache) needs an explicit drift-handling subsection up front, not deferred to "see Open Decision."

## Pattern: Prompt-injection prevention in MVP specs — defence-in-depth beats programmatic enforcement

**Context.** Spec exposed `agent_config.promptOverride` as a freeform 500-char textarea per inbox. ChatGPT spec-review flagged "no programmatic prompt-injection prevention" three rounds running. There is no proven programmatic prompt-injection prevention at scale today — the field is an open research problem.

**Resolution.** The MVP posture is dev-discipline (length cap + forbidden-token scan + composition rules + audit trail) plus defence-in-depth via the architecture (fixed agent tool surface + HITL approval still gates customer-facing replies). State explicitly in the spec that the controls "are dev-discipline, not a security boundary" and that the defence-in-depth comes from the agent's locked tool surface plus the approval flow. Even a successful prompt-injection cannot send a customer-facing reply in `assisted` mode without passing the HITL gate.

**Detection heuristic.** When a spec exposes any LLM-input-from-customer-config surface, the security review pass will flag prompt injection. Pre-empt by writing the four-line defence-in-depth posture into the spec itself.

## Pattern: PG advisory_xact_lock + partial unique index for singleton-per-tenant install

**Context.** Spec asserted "singleton-per-subaccount" enforcement at install time but didn't address the race where two concurrent installs both pass the existence check before either commits. Standard SELECT-then-INSERT can interleave under read-committed isolation.

**Resolution.** Two-layer defence: (1) `pg_advisory_xact_lock(hashtextextended(<subaccount_id::text || system_agent_id::text>))` taken at install transaction start — second concurrent transaction blocks until first commits/rolls back; (2) partial unique index on `subaccount_agents (subaccount_id, applied_template_id) WHERE is_active = true` filtered to the system-agent-template — even if both transactions race past the advisory lock, the second insert fails with `23505`. Map `23505` to HTTP 409.

**Detection heuristic.** Any "singleton-per-X" install / enable / activate flow needs both: advisory lock for clean error path AND partial unique index as the safety net. Check for whether the existing schema's unique index actually filters by the right scope (active rows only, correct linkage column) — broader indexes don't enforce singleton.

## Pattern: Eval gate fail-open with Activity-feed signal beats fail-closed for sub-2-row state

**Context.** Spec required Foundry-derived regression set for the support-agent eval gate. If Foundry export is unavailable at gate time (export hiccup, data stale), fail-closed would block all unrelated PRs from merging until the data is restored.

**Resolution.** Two-tier policy: (1) CI gate fails open (exits 0) when fewer than two `support_eval_runs` rows exist, AND emits `phase1.support.eval_drift_detected` to the Activity feed so the operator sees the silence. Sub-2-row state happens whenever the daily eval job has not yet run twice, including legitimate fresh-CI scenarios. (2) Lock-in gate (per production-verification step at §8.5) is fail-closed: lock-in cannot proceed without a fresh regression set within 30 days, and Open Decision escalates if the data is permanently unavailable. Ad-hoc CI doesn't block; lock-in does.

**Detection heuristic.** Any acceptance criterion that depends on eternally-available external data needs a two-tier "ad-hoc fail-open + lock-in fail-closed" split, with the fail-open clearly logged so the operator can see it.

## Pattern: Stable-slug discriminator beats UUID literal in partial unique indexes (refinement of PG advisory + partial index pattern above)

**Context.** Round 2 of the phase-1-showcase-mvps chatgpt-spec-review (2026-05-10) raised that the original "partial unique index on `subaccount_agents (subaccount_id, applied_template_id) WHERE is_active = true AND applied_template_id = <system-agent-template-id>`" wording could not be implemented as written: a partial index cannot reference a runtime UUID placeholder (the system_agent_id is a `gen_random_uuid()` generated at seed time, not a stable literal), and a partial index cannot reference another table to look up the slug.

**Resolution.** Add a stable-slug column to the table the partial index keys on (in this case `subaccount_agents.applied_template_slug text`, INV-5-allowed additive), backfilled from `system_agents.slug` in the same migration. The partial unique index then filters on the slug literal (`WHERE is_active = true AND applied_template_slug = 'support-agent'`). Pin the slug stability invariant explicitly: future system-agent renames must NOT rewrite historical slugs — the slug is identity, not display copy. Successor-identifier migrations are deliberate corrective migrations per `DEVELOPMENT_GUIDELINES.md § 6` rule 5, never casual updates.

**Detection heuristic.** Any partial unique index whose `WHERE` clause needs to scope to a foreign-key target's identity (system-template, system-agent, system-skill) cannot use the FK UUID as the literal — UUIDs are seed-time-generated. Add a denormalised stable-slug column on the indexed table, populate at write time, and filter on the literal. Trips up reviewers when the spec says "filtering on `applied_template_id = <UUID>`" without explaining how the literal becomes stable.

## Pattern: COALESCE optional canonical-layer watermarks in NOT-EXISTS predicates (silent UNKNOWN bug)

**Context.** Round 2 of the phase-1-showcase-mvps chatgpt-spec-review (2026-05-10) caught a real correctness bug: the support-agent run-loop terminal-event predicate compared `e.created_at >= canonical_tickets.last_customer_message_at`. When `last_customer_message_at` is NULL (no inbound customer message ingested yet, or legacy ingestion paths predated the column), the comparison evaluates to UNKNOWN, the inner subquery returns no rows, the outer NOT EXISTS returns TRUE, and old tickets with terminal events get reprocessed forever. Silent failure mode — easy to miss in code review because the predicate looks fine for non-null cases.

**Resolution.** Wrap any optional canonical-layer watermark in `COALESCE(<watermark>, <safe-floor>)` so the predicate degrades to a known-good comparison rather than UNKNOWN. For the support-agent case: `COALESCE(last_customer_message_at, created_at)` pins the lower bound to ticket creation time as a degenerate safe floor. Pair the COALESCE with an explicit ingestion-contract paragraph naming the writers (`connectorPollingService`, `webhookAdapterService`) so future developers know who is responsible for keeping the watermark fresh. Add test fixtures specifically for the null-timestamp degenerate cases — null + earlier-created (excluded) and null + later-created (eligible).

**Detection heuristic.** Any predicate of shape `<event_column> >= <optional_canonical_column>` inside a NOT EXISTS / WHERE NOT IN / aggregate filter is a silent-UNKNOWN landmine when the optional column is nullable. Reviewer prompt: "Is this column ALWAYS populated by every ingestion path that touches the parent row, including legacy paths?" If the answer is "should be" or "the writer is supposed to", COALESCE the comparison. The cost of the COALESCE is one extra column read; the cost of the bug is silently re-processing data forever.

## Pattern: Worker-internal `iee_artifacts` vs customer-delivery `run_artifacts` source-of-truth precedence

**Context.** Phase 1 Showcase MVPs (2026-05-10). The IEE browser worker already has its own artifact table (`iee_artifacts`) used internally for IEE progress UI, transcription cache, and dedup-by-content-hash inside the worker loop. A naive design would reuse that table for customer-facing file delivery.

**Resolution.** Two separate tables, distinct roles: `iee_artifacts` is the worker-internal ledger (write by worker; read by IEE progress UI + worker loop). `run_artifacts` is the customer-delivery ledger (write by `fileDeliveryService.upload` via main-app finalize route; read by customer-facing UI only). Promotion path: worker calls `uploadArtifact` helper → main-app `/api/internal/run-artifacts/finalize` → `fileDeliveryService.upload` inserts `run_artifacts` row. The original `iee_artifacts` row is NEVER moved or deleted by promotion. Customer-facing UI reads `run_artifacts` only; worker reads `iee_artifacts` only. No automatic backfill of pre-MVP `iee_artifacts` rows.

**Detection heuristic.** Whenever an internal-caching table and a customer-delivery table serve the same content, keep them separate. Conflating them couples customer-delivery SLAs to internal caching volatility and creates dual-write complexity. The promotion step (internal → delivery) is the explicit boundary.

## Convention: Detector pattern path is workspaceHealth, not systemMonitoring

**Context.** Phase 1 Showcase spec §4.6.2 referenced `server/services/systemMonitoring/detectors/` for the stale-macro-run detector. That path does not exist.

**Convention.** The workspace health detector pattern lives at `server/services/workspaceHealth/detectors/`. All async detectors that perform their own DB reads are registered in `ASYNC_DETECTORS` in `server/services/workspaceHealth/detectors/index.ts`. Pure helper functions live in a `<name>Pure.ts` sibling file; the async wrapper imports the pure function and converts findings to `WorkspaceHealthFinding[]`. When a spec mentions `systemMonitoring/detectors/`, always use `workspaceHealth/detectors/` instead.

## Pattern: Singleton-agent-per-subaccount — advisory lock + partial unique index on applied_template_slug

**Context.** Phase 1 Showcase MVPs Chunk 7 (2026-05-10). The Support Agent must be installed at most once per subaccount. A naive `SELECT → INSERT` check is vulnerable to TOCTOU races under concurrent requests.

**Resolution.** Two-layer defence: (1) `pg_advisory_xact_lock(hashtext(subaccountId || ':' || systemAgentId)::bigint)` acquired at the start of the install transaction serialises concurrent installs for the same (subaccount, system_agent) pair. (2) Partial unique index `subaccount_agents_support_agent_singleton_idx ON subaccount_agents(subaccount_id) WHERE is_active = true AND applied_template_slug = 'support-agent'` is the safety net — catches any race that bypasses the lock and maps `23505` to `409 already_installed`. The advisory lock produces the clean error path (checked before INSERT); the partial index is the serialisation guarantee. Migration `0314`.

**Pattern location.** `server/services/supportAgentInstallService.ts`. CI gate: `scripts/gates/verify-support-agent-skill-set.sh`.

## Convention: applied_template_slug is a stable install discriminator — never rewrite

**Context.** Phase 1 Showcase MVPs Chunk 7 (2026-05-10). The `applied_template_slug` column on `subaccount_agents` is the value the partial unique index keys on for the singleton guard.

**Convention.** Once a `subaccount_agents` row carries `applied_template_slug = 'support-agent'`, that value MUST NOT be rewritten by future system-agent renames or any other code path. Rewriting would either reopen the singleton race or invalidate the index's coverage. Mutating `applied_template_slug` outside `supportAgentInstallService.ts` is a CI gate failure (`scripts/gates/verify-support-agent-skill-set.sh`). The slug is the install identity, not a display string — it is decoupled from the system agent's `name` field on purpose.

## Pattern: window.open() for authenticated download endpoints — call sync, not after await

**Context.** Phase-1-showcase-mvps Chunk 4 (RunTraceArtifactsPanel). Preview and Download buttons need to open an authenticated platform download URL in a new tab. An early implementation called `issueSignedUrl()` (async) before the `window.open()`, which silently fails popup-blocker checks: browsers only allow `window.open()` called synchronously inside a user gesture handler — any `await` before the call severs the gesture link, the browser blocks the popup, and the user sees nothing.

**Resolution.** Route Preview and Download directly to the authenticated endpoint URL (`/api/run-artifacts/:id/download`) — no async call needed, the URL is computed from the artifact ID already in state. Call `window.open(url, '_blank')` synchronously. Reserve async issueSignedUrl only for Copy-link, where the signed URL is the actual payload rather than a navigation target. Check the return value (`const win = window.open(...); if (!win) { setRowError('Popup blocked...'); }`) to surface the popup-blocker case.

**Detection heuristic.** Any `await X; window.open(...)` pattern in a click handler is a popup-blocker trap. If the URL can be computed synchronously, remove the await. If async is genuinely needed, the only fix is user-education (popup permission prompt, or a fallback link element).

## Pattern: Inline Content-Disposition for browser PDF preview via download proxy

**Context.** Phase-1-showcase-mvps Chunk 4. A single route (`GET /api/run-artifacts/:id/download`) serves both Preview (inline, browser renders PDF) and Download (attachment, browser saves file) by reading a `?disposition=inline` query parameter. The default (no param) is `attachment`; `?disposition=inline` sets `Content-Disposition: inline; filename="..."` which causes Chrome/Firefox to render PDFs in the built-in viewer instead of downloading.

**File:** `server/routes/runArtifacts.ts`

**Detection heuristic.** When a route needs to serve the same binary with different browser behaviour, a single query-param-controlled disposition is simpler than two separate routes and keeps the event-emission logic (the `phase1.file_delivery.downloaded` audit event) in one place.

## Gotcha: Judge score scale is 0–5, not 0–1 — threshold and clamp must match

**Context.** Phase-1-showcase-mvps Chunk 9 (eval harness). The spec §5.5.2 documents the draft judge prompt as scoring on a 0–5 scale (`draftJudgeScoreAvg` column comment: "0..5"). An early implementation used a 0–1 scale throughout (threshold 0.70, clamp `Math.min(1, score)`), which made the gate pass trivially for any non-zero score.

**Resolution.** Three places must all agree: (1) the judge prompt's scoring rubric ("Score from 0.0 to 5.0"), (2) `THRESHOLD_JUDGE_MIN = 4.0`, (3) `Math.min(5, overallScore)` clamp. If any one of these is on a different scale the gate silently becomes meaningless. The DB column `numeric(4,2)` stores 0–5 correctly.

**Detection heuristic.** Whenever a judge or rubric score threshold appears, explicitly state the scale (0–N) in the constant name or comment. "0.70 threshold" is ambiguous; "4.0 threshold (0–5 scale)" is not.
## Pattern: Cycle-prevention regex must anchor on the exact filename, not a substring

**Context.** Execution Backend Adapter Contract build (2026-05-10) added §8.32 cycle-prevention assertion coverage rule, then extended the assertion to 8 files in the dispatch chain. The new tests immediately failed against `_ieeShared.ts` even though it has no runtime cycle. Root cause: the original regex `[^'"]*agentExecutionService[^'"]*` matches `agentExecutionServicePure.js` as a false positive — `_ieeShared.ts:44` legitimately imports `computeRunResultStatus` from there.

**Resolution.** Tighten the regex to `agentExecutionService\.(?:js|ts)` so the file extension anchors the match. Both the original two assertions (on `types.ts` and `options.ts`) and the new chain-coverage assertion need the precise pattern. Pure-helper sibling files (`*Pure.js`, `*Pure.ts`) legitimately re-share the prefix and must not trip the cycle-prevention test.

**Detection heuristic.** Any "MUST NOT import from `<filename>`" assertion regex must anchor on `<filename>\.(?:js|ts)` (not `<filename>[^'"]*`) so adjacent pure-helper modules sharing the prefix don't false-positive. The convention `xxx.ts` + `xxxPure.ts` is widespread in this codebase — every pure-helper extraction creates a regex landmine.

## Pattern: Domain-primitive registration must not be gated on queue-backend choice

**Context.** Execution Backend Adapter Contract build (2026-05-10) — pr-reviewer flagged that `server/index.ts` registered all five `ExecutionBackend` adapters inside `if (env.JOB_QUEUE_BACKEND === 'pg-boss') { ... }`. Three of the five (`api`, `headless`, `claude-code`) have no pg-boss dependency at all; the gating was a copy-paste hangover from when the block was originally just the IEE event handler attachment. With `JOB_QUEUE_BACKEND='bullmq'` (an env enum value the codebase still allows), the registry would be empty at HTTP-handler time and EVERY `executeRun` call would throw `BackendNotRegistered`, including the default `api` mode. Silent regression — no compile-time warning would surface it.

**Resolution.** Split the boot block in two: (1) unconditional adapter registration in its own try/catch, (2) pg-boss-gated event-handler attachment that depends on registration completing first. Document the boot-ordering invariant inline so a future maintainer doesn't re-merge the blocks.

**Detection heuristic.** Any boot-time `register*()` call sitting inside an env-conditional gate is suspicious. Ask: "Does the thing being registered actually depend on the env condition, or just one consumer of it?" If the registration is for a domain primitive (registry entry, dispatch table, capability map), it almost always belongs outside the env gate, with the env-conditional consumer attached separately.

## Pattern: Lifting code into a generic orchestrator drops the leaf side-effects

**Context.** Execution Backend Adapter Contract build (2026-05-10) — Chunk 3 lifted `finaliseAgentRunFromIeeRun`'s body into the new generic `finaliseAgentRunFromBackend` orchestrator. The legacy function had an early-return for the parent-row-missing case that ALSO stamped `iee_runs.event_emitted_at = now()` so the worker's `retryUnemittedEvents()` sweep would not re-fire forever. The lift moved the early-return into the orchestrator but dropped the stamp. The Codex dual-reviewer pass caught it; without the stamp, every orphaned `iee_runs` row would have re-emitted its terminal event indefinitely once deployed.

**Resolution.** When lifting a special-case path (early return / null guard / failure branch) into a generic orchestrator, audit it for non-obvious side-effects baked into the original code path. The fix here was to widen the adapter contract to allow `parentRun: null` and have the adapter own the stamp, so the side-effect followed the lifecycle into the new abstraction. Generic orchestrators should not own concrete-row side-effects; lift them into the adapter that owns the row.

**Detection heuristic.** Whenever a refactor extracts a generic shape from a concrete function with multiple early-return paths, diff the legacy function against the lift line by line. Side-effects in early-return branches (write a stamp, emit a metric, log an audit event, schedule a retry) are the easy ones to drop. The acceptance criterion should explicitly enumerate the side-effects the extraction must preserve, not just the happy-path return value.

## Pattern: Capability-gated optional methods make adapter contract widenings cheap

**Context.** Execution Backend Adapter Contract build (2026-05-10) — dual-reviewer fix needed to widen `BackendFinalisationInput.parentRun` from a non-null shape to nullable so the orchestrator could hand the orphan case to the adapter. Five adapters live behind the contract, but only the two delegated ones (`iee_browser`, `iee_dev`) implement `finalise()`. The api/headless/claude-code adapters declare `'in_process'` / `'subprocess'` capabilities and have no `finalise()` slot — the registry's Rule 2 only requires the delegated lifecycle methods when `capabilities.includes('delegated')`.

**Resolution.** Capability-gated optional methods in the contract mean a widening that touches a delegated method only edits the delegated implementations. The api/headless/claude-code adapters were untouched. Both IEE adapters are thin forwarders to `_ieeShared.ts::ieeFinalise`, so the actual edit was to one shared body. The contract type signature change required no adapter-level edits beyond the shared helper.

**Detection heuristic.** When considering a contract change against a registry-resolved adapter set: list the adapters and their declared capabilities. Methods gated by capability only need re-edits in adapters that declare the gating capability. Contract widenings (T → T | null, narrow union → wider union) flow through cleanly; contract narrowings (the reverse) require all gated implementations to re-validate. The DRY of the IEE pair via `_ieeShared.ts` reduces the per-edit cost from N×M to 1 — worth preserving when adding new delegated adapters.

### [2026-05-10] Pattern — Boot-time registration validation must be FATAL, not log-and-continue

**Context.** ChatGPT PR review (PR #281, Round 1, B1) — `server/index.ts` registered all five `ExecutionBackend` adapters in a try/catch that logged registration errors and continued startup. The spec made registration validation a boot-time safety boundary (adapters that fail validation must never reach dispatch); a partial-registry boot would surface as a 500 on every dispatch, strictly worse than a clean fatal-on-failure crash.

**Rule.** When a spec says "registration validation must prevent dispatch", the implementation must rethrow after logging, matching the fatal-boot-failure pattern of other required boot dependencies. Catching-and-continuing produces a half-booted process where every consumer of the registry fails at runtime, the operator sees no boot-time signal, and "boot succeeded" is technically true but functionally misleading. The fix is two lines: keep the structured warn line for forensics, then `throw err`.

**Detection heuristic.** Any boot-time `register*()` call wrapped in try/catch where the catch logs and proceeds is suspicious. The right shape is: log structured detail (error message, stack, context) FOR forensics, then rethrow. The exception is when the registration is truly optional (e.g., a feature-flagged plugin that's opt-in). For domain-primitive registries (dispatch tables, capability maps, finaliser routing), opt-in is rare and rethrow is the safe default.

### [2026-05-10] Pattern — Adapter-contract field semantics must match the migration intent

**Context.** ChatGPT PR review (PR #281, Round 1, B2) — `claudeCodeBackend.ts` returned `ccResult.sessionId` as `backendTaskId` for observability. The contract spec said `backendTaskId` is for delegated backends only and should be `null` for in-process and subprocess adapters. The migration `0313_execution_backend_columns.sql` introduced `(backend_id, backend_task_id)` as a generic delegated-task reference, with `backend_task_id` null for in-process/subprocess paths. Returning a Claude session ID in that field was hidden contract drift inside what looked like an observability improvement.

**Rule.** When a migration introduces a typed contract field with a stated semantics ("delegated-task reference, null for non-delegated"), the adapter implementations must match the stated semantics — even when the adapter has another value that "fits" the field's shape. Observability identifiers belong in the typed log payload (`toolCallsLog[0].sessionId` already preserved this) or in a deliberately named future field (`backendSessionId`); never in a contract field whose semantics are documented elsewhere.

**Detection heuristic.** Cross-check every adapter implementation against the migration that introduced the contract field. Grep the migration text for the field's column comment, then grep adapter code for the field name in returned objects. If an adapter populates the field with a value that doesn't match the migration's stated semantics, the implementation has drifted from the contract. The most common drift shape: an adapter has a "spare" identifier (session id, request id, trace id) that's tempting to surface through a contract field that happens to be the right type. Resist — add a deliberate observability field.

### [2026-05-10] Pattern — Verify route-error envelope behaviour before documenting HTTP shape in code comments

**Context.** ChatGPT PR review (PR #281, Round 2, P1) — A code comment near a `throw ParentRunNotDispatchable` claimed "the route layer's existing error envelope renders typed errors as a 4xx". Investigation showed: `ParentRunNotDispatchable` extends `Error` with no `statusCode` field; `normaliseRouteError` checks `instanceof AppError`, then duck-typed `statusCode`, then falls through to `kind: 'unknown'` with statusCode 500. The error today actually maps to a 500 envelope, not a 4xx — the comment was verifiably wrong, and would mislead future maintainers reasoning about the route surface.

**Rule.** When a typed error is returned to a route layer, do NOT document its HTTP shape in code comments unless you've grep-verified the route mapping. The safe default is a neutral comment ("the route layer will surface the typed error according to the existing error-envelope behaviour") that doesn't claim a specific status code. A deliberate AgentRunResult shape can be added later if/when the desired client-visible shape is decided — that's a behaviour change, separate scope.

**Detection heuristic.** Any inline comment that claims "renders as 4xx" / "renders as 5xx" / "returns N" near a `throw` site is a verification target. Grep the route layer for the typed error class name and check the envelope normalisation code. If the error class lacks `statusCode` AND doesn't extend the route layer's typed-error base, it falls through to the unknown-error branch — which is almost always a 500. Don't write status-code claims into code comments without that grep.

### [2026-05-10] Pattern — When the plan says "rethrow if no existing race-loser shape exists", verify by searching origin/main first

**Context.** ChatGPT PR review (PR #281, Round 1, T1) — The plan explicitly said: "map ParentRunNotDispatchable to the exact existing race-loser shape, or rethrow and document if no such shape exists". The implementation invented a synthetic zeroed `AgentRunResult` with `summary: null`, zero counters, and a coerced status. Verification against `origin/main` showed the pre-cutover dispatch had no such shape — the synthetic response was invented, not replicated.

**Rule.** When a plan directs "match the existing X shape, or rethrow if X doesn't exist", verification is mandatory: grep `origin/main` for the shape's call sites BEFORE inventing one. The "or rethrow" branch exists precisely so the implementation doesn't invent a new shape during a refactor — synthetic shapes are silent contract additions that are hard to back out later. Rethrow + structured warn line is the spec-compliant path when no existing shape exists.

**Detection heuristic.** Plans that mention "existing X" alongside "or do Y if X doesn't exist" are testing whether the implementer verified. The invented-shape failure mode looks like a normal refactor at first glance — the synthetic values often look reasonable in isolation. The tell is that those values weren't there before the refactor. The verification step is one grep against `origin/main` for the shape's signature; skipping it produces a class of bugs where downstream consumers receive plausible-but-wrong data.

### [2026-05-10] Pattern — Capability mismatches that the registry should make impossible must THROW, not silently return false

**Context.** ChatGPT PR review (PR #281, Round 1, T2) — `finaliseAgentRunFromBackend()` resolved an adapter and, if the adapter wasn't delegated or lacked finalisation methods, logged `agentRunFinalization.non_delegated_adapter` and returned `false`. The registry already validates delegated adapters at registration time (Rule 2 requires delegated lifecycle methods when `capabilities.includes('delegated')`), so reaching this branch indicates caller misuse (stale event payload, wrong reconciliation backendId, registry/config drift) — not a recoverable reconciliation result. Returning `false` made a bad call look like an idempotent no-op.

**Rule.** When a runtime check covers a case the registry's invariants make impossible, the right outcome is a typed throw, not a silent boolean false. False says "this is a recoverable no-op state"; throw says "the system is in an invalid configuration the registry promised wouldn't happen". Calling finalisation on `api`, `headless`, or `claude-code` is a programmer error, not a recoverable case — the typed `FinaliseRequiresDelegatedAdapter` error makes the misuse loud at every layer (logs, sentry, route 500).

**Detection heuristic.** When implementing a runtime guard that "shouldn't" be reachable per the registry's invariants, ask: "if this branch fires, is the system still in a valid state?" If no, throw a typed error so the failure is loud. If yes, return a typed result that distinguishes "recoverable no-op" from "actual success". Don't conflate the two by returning a generic false — the caller can't tell which branch fired and bug-hunting takes longer.

## Pattern: UI pct() helper applied to wrong scale produces 400% — use scale-specific formatters

**Context.** Phase-1-showcase-mvps finalisation (2026-05-11) — `SupportEvalsPage.tsx` had a shared `pct(value)` helper that multiplied by 100 and appended `%`. Classification accuracy (0–1 scale) rendered correctly: `pct(0.87) = "87.0%"`. Draft judge score (0–5 scale) rendered wrong: `pct(4.0) = "400.0%"`. Both the score and its threshold used `pct()`, so the mismatch was consistent (both showed 400%) and made it harder to spot.

**Rule.** When a page displays two metrics with different scales (0–1 vs 0–5, or percentage vs score), each scale needs its own formatting helper. A single generic `pct()` is only safe when every value it formats is truly 0–1. The moment one metric is on a different scale, extract `judgeScoreDisplay()` (or equivalent) rather than overloading the 0–1 helper. The formatter name should encode the scale contract (`judgeScoreDisplay` is explicit; `pct` is ambiguous).

**Detection heuristic.** Whenever a page renders two metrics side by side and one uses `pct()` while the other is documented as a 0–N scale elsewhere (column comment, spec, constant name), grep the UI for every `pct()` call and verify all inputs are genuinely 0–1.

## Pattern: Components built in Phase 2 but never imported = dead UI — wire the registration at definition time

**Context.** Phase-1-showcase-mvps chatgpt-pr-review (2026-05-11) — ChatGPT identified three run-trace UI components (`RunTraceArtifactsPanel`, `SupportEventRenderers` map, `MacroFailureRenderers`) that were fully implemented and exported but never imported in their entry-point files (`RunTracePage.tsx`, `RunTraceEventRenderer.tsx`). They were correct implementations of the spec but produced zero visible UI.

**Rule.** When building a new panel, renderer, or map that must be registered or imported somewhere to take effect, write the registration (import statement + wiring line) in the same commit as the component definition. "The component is done" is not done — it's done when it's visible in the UI. For run-trace renderers specifically: a new `*Renderer` component must be (1) exported from its file and (2) imported + either registered in a lookup map or returned from a lookup function in `RunTraceEventRenderer.tsx`.

**Detection heuristic.** After building any component intended for the run-trace event stream, grep `RunTraceEventRenderer.tsx` and `RunTracePage.tsx` for the component or its module path. If neither file imports it, the component is dead. Same applies to any registry pattern: grep the registry's file for the new handler's symbol.

## Pattern: Pure helper encapsulates a policy — always call it, never hardcode the constant at the call site

**Context.** Phase-1-showcase-mvps chatgpt-pr-review (2026-05-11) — `fileDeliveryServicePure.ts::deriveSignedUrlExpiry(artifactKind)` existed and correctly returned 604800s (7d) for `report` and 86400s (24h) for everything else. The signed-URL route in `runArtifacts.ts` built `expiresAt` with `const sevenDays = 7 * 24 * 60 * 60 * 1000` — always 7d regardless of artifact kind.

**Rule.** When a pure helper encapsulates a policy (expiry, TTL, limit, threshold), callers MUST call the helper — never inline the magic number. The pure helper is the policy; inlining the number at the call site creates a second policy that silently diverges the moment the pure helper is updated. The fix is also a useful template: add the artifact kind to the select query, type it via the shared type, pass it to the pure helper.

**Detection heuristic.** When writing any code that encodes a duration, limit, or threshold as a numeric literal, grep the codebase for a pure helper that returns the same kind of value. If a helper exists — use it. Common offenders: signed URL TTL (use `deriveSignedUrlExpiry`), eval thresholds (use the DB-stored values), score clamps (use `Math.min(MAX_SCALE, ...)`).

## Pattern: Separate `usability_state` (broker gate) from `plan_verification_status` (audit signal) — two concerns, two columns

**Context.** Operator-session-identity chatgpt-spec-review (2026-05-11, Round 1 F1). Initial spec made self-declaration connects land in `connected_unverified` — meaning the broker would never issue credentials until plan was independently verified. This made the feature dead-on-arrival for all early users, since V1 has no independent verification mechanism.

**Rule.** When a credential has two separate concerns — "can the broker decrypt and use this?" and "is this credential's metadata confirmed by a third party?" — model them as distinct columns with distinct semantics. `usability_state` is the broker gate: only `connected_usable` allows decryption and injection. `plan_verification_status` is the audit trail: `self_declared` signals unconfirmed tier without blocking access. Mixing the two into a single "unverified = unusable" state creates an unrecoverable hold state that has no exit until infrastructure that may never exist is built.

**Detection heuristic.** When a spec has a state that means both "not yet confirmed by a third party" AND "blocked from use," ask: does the user's action (accepting a disclosure, self-declaring a tier) provide enough confidence to unblock? If yes, split into two fields. The "unconfirmed" signal belongs in a `*_status` or `*_verification_status` column; the "usable" gate belongs in a dedicated `usability_state` or similar state machine column.

## Pattern: Type union members need defined write paths — orphaned values become implementation traps

**Context.** Operator-session-identity chatgpt-spec-review (2026-05-11, Round 1 IC-3). The `planVerificationStatus` TypeScript union included `'unverified'` as a valid value, but no code path in the spec ever set it. The `'failed'` value already covered "couldn't determine tier."

**Rule.** Every value in a discriminated-union or string-literal type MUST have at least one explicitly named write path in the spec (a service method, migration default, or code branch that produces it). Values with no write path will either never appear in production data, or will be set by ad-hoc code that bypasses the intended semantics — both outcomes are bugs. Before locking a spec, grep the type definition and confirm each member is reachable from the execution model.

**Detection heuristic.** For each string-literal type or discriminated union in the data model section, list its values. For each value, search the execution model and chunk plan for the phrase that sets it (e.g., "`plan_verification_status = 'self_declared'`"). A value with no grep hit is orphaned — remove it or add the write path.

## Pattern: Close open questions explicitly in §18 when the answer lands in §18b — stale open questions create builder contradictions

**Context.** Operator-session-identity chatgpt-spec-review (2026-05-11, Round 2 T1). Open Question §18.3 ("subaccount vs org scope for Plus consent — confirm before implementation") was resolved in §18b during spec-reviewer iteration 5, but §18 still showed the original question verbatim. ChatGPT's Round 2 found the contradiction.

**Rule.** When a resolution lands in §18b, update §18 immediately — replace the open question prose with "(Resolved — see §18b: [title])". Do not leave §18 and §18b as parallel documents. Builders reading §18 will see an unresolved question; builders reading §18b will see a resolution. Both reading paths must be consistent.

**Detection heuristic.** Before locking a spec, grep §18 for any question that also appears (by subject) in §18b. Any §18 item whose topic matches a §18b entry should be replaced with a pointer. Conversely, any §18b entry with no corresponding §18 pointer is an invitation to add one (so the §18 reader is not confused by an apparently-unresolved question).

## Pattern: Stale regression tests survive when the test mocks the consequence rather than the implementation

**Context.** Pre-test-hardening pr-reviewer re-review (2026-05-11, commit `3423a0d5` blocker B1.x) — `taskService.createTask.regression.test.ts` asserted that the legacy 4-arg overload "throws synchronously and writes zero rows" via `expect(...).rejects.toThrow('legacy 4-arg shape')` plus `expect(tx.insert).not.toHaveBeenCalled()`. The implementation later pivoted from "throws" to "opens its own db.transaction + sets the GUC + delegates to the canonical path" (needed for sister-branch callers in `workflowEngineService.ts:2716` + `:2962`). The test's mocks did NOT cover `db.transaction` because the original throw fired before any db call — when the implementation pivoted, only the `rejects.toThrow` assertion failed; the unmocked `db.transaction` call hit production code and produced a misleading connection error, not an assertion failure.

**Rule.** A regression test for a contract-narrowing or contract-pivoting change MUST assert on the path taken (which branch ran, which dependency was called, in what order), not just visible side effects on a pre-mocked surface. If you mock `tx.insert` and assert it was not called, you've pinned ONE consequence — but the SUT can change to a different code path that bypasses `tx.insert` entirely without your test catching the pivot. The mock surface area must cover every dependency the test's contract claims is or isn't called.

**Detection heuristic.** When a regression test mocks one path but asserts negatively against a different path ("X was NOT called"), grep the SUT for OTHER side-effect dependencies it could plausibly use (db.transaction, file I/O, network, logger). If any of those are reachable from the SUT and unmocked, the test will pass-by-accident under a pivot. Either mock them too, or restructure the assertion to be a positive claim about the path actually taken.

## Pattern: Sister-branch reconciliation via transitional overloads needs explicit dual-mode test coverage

**Context.** Pre-test-hardening commit `3423a0d5` — `taskService.createTask` ships a `@deprecated` 4-arg overload that opens its own `db.transaction`, sets the `app.organisation_id` GUC, and delegates to the canonical `(input, tx)` path. The overload exists to keep sister-branch callers in `workflowEngineService.ts:2716` + `:2962` functional during the pre-prod-workflow-and-delegation branch's own migration. Without explicit dual-mode tests, a future refactor could remove the GUC SET, change the delegation order, or silently break the legacy path — invisible until sister-branch ships its withOrgTx wrappers.

**Rule.** Whenever a signature change ships a transitional overload that delegates rather than throws, BOTH paths need pinned tests in the same regression file: (1) canonical path succeeds end-to-end, (2) transitional path opens its own context (transaction / lock / session) AND sets every implicit prerequisite (GUC, env var, header) BEFORE delegating, AND emits the deprecation log so ops can track migration runway. The transitional overload's purpose is invisible silent compatibility — pinning the contract is the only way that purpose survives future refactors.

**Detection heuristic.** When reviewing a PR that adds a `@deprecated` overload, look for tests asserting (a) the deprecation log fires, (b) the transitional context-setup runs (tx open, GUC set, etc.), (c) the canonical path is then reached. If any of the three are missing, the overload is a regression risk; route as a Strong recommendation.

## Pattern: Migration-number collision after S2 sync requires renumbering forward, not backward

[compressed 2026-05] Duplicate of the 2026-05-08 `Migration-number collision after S2 sync requires renaming on the feature branch` entry above — same rule, different wording. Forward-renumbering (not reuse) is the canonical action.

### [2026-05-10] Correction — apply defence-in-depth patterns consistently across siblings; cross-check Drizzle schema against the migration

Three corrections from `chatgpt-pr-review` Round 3 on PR #284 pre-test-hardening:

1. **Inconsistent ALS-presence checks across sibling services.** When I added the `peekOrgTxContext()` fallback pattern to three services in successive rounds (`deliveryService.deliver`, `scheduledTaskService.fireOccurrence`, `knowledgeService.overrideEntry`), the first two used a truthy check (`peekOrgTxContext() ? ... : ...`) and the third used `peekOrgTxContext() !== undefined`. They behave the same in production (the function returns `OrgTxContext | undefined`), but test mocks return `null` and `null !== undefined` is `true`, which routes mocked tests to `getOrgScopedDb()` and incorrectly throws `missing_org_context`. **Rule:** when applying the same defence-in-depth pattern to multiple call sites in successive commits, choose ONE check style and reuse it verbatim across all sites. Truthy check is more lenient and handles mock variations; `!== undefined` is too strict against `null` returns. Verify after the third site that all three look identical.

2. **Drizzle schema vs migration drift on FK.** Authored `webhookReplayNonces.ts` with `.references(() => organisations.id)` but migration `0318_webhook_replay_nonces.sql` did not include `REFERENCES organisations(id) ON DELETE CASCADE`. The Drizzle schema is a TypeScript-side declaration; the migration is the source of truth for the DB. They must agree. **Rule:** every time a Drizzle schema declares `.references(...)`, the matching migration's column definition MUST include the SQL FK constraint. The reverse check is also required: if the migration has a FK, the schema must declare `.references()` so the introspection layer stays consistent. Verify both sides before merging.

3. **ChatGPT scope-of-view false positive (already-imported claim).** Three rounds in a row, ChatGPT claimed `connectorConfigService.ts` was missing `withAdminConnection` import based on a diff hunk that didn't show line 7's existing import. The import has been in the file since well before this PR. **Rule:** when ChatGPT (or any review agent) flags a missing import based on what's "visible in the diff", verify the full file with `grep -n "^import" <file>` before fixing. Diff-hunk visibility is not file-state. Auto-reject duplicate false positives across rounds — they are noise, not signal.

## Pattern: usability_state vs plan_verification_status implementation — two columns, two writers, two read paths

**Context.** Operator-session-identity Phase 2 implementation (2026-05-11). Spec-review identified the conceptual split (see earlier entry: "Pattern: Separate `usability_state` (broker gate) from `plan_verification_status` (audit signal) — two concerns, two columns"). Implementation surfaced that the split needs two independent writers, two independent read sites, and two independent invariants.

**Rule.** `usability_state` is written ONLY by `operatorSessionLifecycleService.transition` (after initial INSERT). `plan_verification_status` is written by `operatorSessionService.verifyPlan` and by `operatorSessionService.connect` (initial value). Read paths: the broker checks `usability_state === 'connected_usable'` exclusively; the UI pill checks both (state for color, status for "verified" badge). The pure helper `orderResolvedCredentials` in `credentialBrokerServicePure.ts` is the single sort site for failover ordering (default-first, then alphabetical by label).

**Detection heuristic.** If a state machine has two responsibilities (gate + audit), confirm each column has exactly one writer and that read sites consult only the relevant column — never both. Conflating them at read time recreates the original drift. When adding a new writer to either column, verify no existing caller already writes it outside the designated write path.

### [2026-05-11] Gotcha — Permission-helper-tier mismatch: `hasOrgPermission` does NOT accept a `SUBACCOUNT_PERMISSIONS.*` constant

`server/routes/integrationConnections.ts` consolidated route added `hasOrgPermission(req, SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_VIEW)` to gate which connection rows the caller could see. The permission constant lives under `SUBACCOUNT_PERMISSIONS` — a workspace-scoped permission set — but the helper was `hasOrgPermission`, an organisation-scoped permission check. The two helpers operate on different permission tiers and look up different membership tables; passing a workspace permission constant into the org helper silently returns the wrong answer (in this case: either hides workspace-scoped operator-session rows for legitimate users, or applies the wrong permission model for org-scope callers). TypeScript does not catch the mismatch because both helpers accept `string`-typed permission codes.

**Pattern:** the permission helper must match the tier of the permission constant exactly:
- `ORG_PERMISSIONS.*` → `hasOrgPermission(req, code)` — no subaccount required
- `SUBACCOUNT_PERMISSIONS.*` → `hasSubaccountPermission(req, subaccountId, code)` — subaccount required, parsed from the request scope/query

**Rule for code review:** when grepping for permission gates, treat `has<Tier>Permission(req, <TIER>_PERMISSIONS.*)` as a structural unit. If the helper tier and the constant tier disagree, that line is wrong by construction — not a stylistic preference. The fix is to swap to the matching helper AND parse the scope-appropriate context (e.g. for `scope=workspace` callers, validate `parsed.data.subaccountId` and pass it as the second arg).

**Applied to:** PR #286 chatgpt-pr-review Round 1 F2 — `server/routes/integrationConnections.ts` flipped to `hasSubaccountPermission(req, parsed.data.subaccountId, SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_VIEW)` gated on `scope === 'workspace'`; for `scope=org` / undefined scope the flag is forced false (operator_session rows are already skipped downstream for org scope in `connectionsService.ts`). Session log: `tasks/review-logs/chatgpt-pr-review-operator-session-identity-2026-05-11T22-01-13Z.md`.

**Generalises to:** any route handler in `server/routes/*` that gates row visibility or write access via a permission helper. The same trap exists in reverse (passing an `ORG_PERMISSIONS.*` constant into `hasSubaccountPermission`). A future linting rule could enforce: the `<TIER>_` prefix of the constant must match the tier embedded in the helper name, statically. Until that exists, code review catches it via the pattern above.

### [2026-05-11] Gotcha — DB-time bucket queries must fail closed; never fall back to `Date.now()` for ordering / dedupe keys

[cross-reference 2026-05] See also the 2026-04-29 entry `DB-canonical now_epoch must be threaded through any time-delta computation derived from a rate-limit check` above — same DB-canonical-time principle, different application surface.

`server/jobs/operatorSessionRefreshJob.ts:runOperatorSessionRefreshSweep` (PR #286) computed a 5-minute bucket via `SELECT floor(extract(epoch from transaction_timestamp()) / 300)::bigint AS bucket` to dedupe sweep ticks across pods, and computed `expiryThreshold = Date.now() + REFRESH_WINDOW_MINUTES * 60_000` to filter sessions that needed refreshing. Two regressions snuck in during chunk-level implementation:

1. **App-clock fallback on the bucket query** — if the SQL query returned zero rows, the code substituted `Math.floor(Date.now() / 300_000)` as the bucket. That defeats the purpose of using DB time for dedupe: under clock skew between Node processes, two pods could compute different `Date.now()` buckets and both run the sweep tick, doubling work and producing dedupe-key collisions.
2. **App-clock for the expiry predicate** — `Date.now()` flows into the `WHERE token_expires_at <= $1` clause. Same skew exposure: a session expiring at `T + 30s` could be picked up by one pod's predicate and skipped by another's, depending on the pod's wall clock.

**Fix pattern (PR #286 Round 1 F4):**
- Fail closed on the bucket query — if zero rows, log `bucket_query_empty` and SKIP the sweep tick. Better to drop a tick than to corrupt the dedupe key.
- Compute the expiry threshold inside SQL: `WHERE token_expires_at <= transaction_timestamp() + (${REFRESH_WINDOW_MINUTES} * interval '1 minute')`. The predicate evaluates entirely in the database, so all pods see the same threshold for the same transaction.

**Rule:** when a job uses DB-side time for dedupe or ordering semantics (any `transaction_timestamp()`, `now()`, `clock_timestamp()` derivative used as a bucket key, cursor, or predicate), there is NEVER an app-clock fallback. The fallback is "skip this tick / fail closed", not "compute it from Node". Same principle as `[2026-04-30] Date.now() poisons cursor-based projection delta polling` (KNOWLEDGE 2108) and the rate-limit `Retry-After` correctness rule (KNOWLEDGE 1630) — those are reads from DB-time scalars; this entry covers the predicate / bucket-key flavour of the same family.

**Detection heuristic.** Grep any job file for `Date.now()`. Every hit needs a justification: is it used purely for ephemeral instrumentation (latency timing, telemetry), or does it feed into a dedupe key, ordering cursor, or a predicate compared against a DB-side column? If the latter, the value MUST come from a DB query within the same transaction — no fallback.

**Applied to:** PR #286 chatgpt-pr-review Round 1 F4 — `server/jobs/operatorSessionRefreshJob.ts`. The earlier plan-review pass had already removed this pattern once; this was a regression reintroduced during chunk-level implementation. Confirmed resolved in Round 2 with verdict APPROVED. Session log: `tasks/review-logs/chatgpt-pr-review-operator-session-identity-2026-05-11T22-01-13Z.md`.
### [2026-05-11] Pattern — Registration-seam lets provider resolver compile before concrete providers exist

When introducing a new provider-resolved service (e.g. `SandboxExecutionService`) that depends on three concrete implementations not yet built, the order-of-delivery problem is solved by a "registration seam": the resolver module exports a `registerSandboxProvider(name, ctor)` function, and each concrete provider calls it at module-init time. The resolver compiles and type-checks independently; C4 (resolver) can ship before C9 (e2bSandbox) and C10 (localDockerSandbox) because the concrete modules are never statically imported by the resolver. The resolver only fails at runtime when `SANDBOX_PROVIDER` names a provider that hasn't been registered — a fail-fast boot error, not a compile error. This avoids both a circular-dependency and a "everything must land in one giant chunk" build constraint. Applied in Spec B: `server/services/sandbox/sandboxProviderResolver.ts` + concrete providers C9/C10.

### [2026-05-11] Pattern — String-constant module breaks circular pg-boss registration dependencies

When two service modules want to import each other's queue names for pg-boss `boss.subscribe(queueName, ...)` calls, the straightforward import creates a circular dependency. The fix is a dedicated string-constants module (`server/jobs/sandboxJobNames.ts` in Spec B) that both parties can import without pulling in each other's service logic. The constant module has zero imports itself — pure `export const JOB_NAME_X = '...'` — so it cannot participate in a cycle. This is cheaper than a DI container and avoids the "register everything at a central index" approach that forces all jobs to import each other at boot. Applied in Spec B C8 (`withSandboxProvider.ts`) + C11a (job handlers): the provider wrapper imports only the queue name constant, not the job handler module.

### [2026-05-11] Gotcha — Stale gitignored .js files alongside .ts source intercept Vitest imports

When a TypeScript ESM project has an old `.js` file sitting next to a `.ts` file of the same base name (e.g. a leftover compiled output that was committed and then gitignored), Vitest's module resolver under `nodenext` resolution can import the `.js` file instead of the `.ts` source. Tests pass against the stale compiled version and ignore source changes — the most confusing failure mode is "my change has no effect on the test". Detection: `ls server/services/sandbox/` — if a `.js` appears next to its `.ts` counterpart without being intentional, delete it. The `.js` extension on relative imports (required by `nodenext` + `verify-pure-helper-convention.sh`) is fine in source; the problem is a physical `.js` file that the resolver picks up as a sibling artifact. Preventive: run `git status --ignored` before each chunk and delete any stale `.js` alongside new `.ts` files.

### [2026-05-11] Pattern — Intentional OR-clause chunk cohesion: ≤5 files OR ≤1 logical responsibility

The chunk-size posture rule has an OR clause: a chunk that exceeds 5 files is still within the heuristic if every file represents a single cohesive logical responsibility (the C14 doc-sync + gate sweep in Spec B is the example: 9 files, one "build closeout" responsibility). When applying this exception, document the rationale explicitly in the plan at the chunk level — not just "large chunk justified" but "each file is structurally cohesive because X; splitting would require two simultaneous PRs that land atomically anyway." The OR-clause is not a free pass for large chunks — the "≤1 logical responsibility" test is strict: if two files in the chunk have different reviewers, different CI failure modes, or different rollback strategies, they are different responsibilities and should split.

## DB CHECK constraints require a pure application-level transition classifier
**Date:** 2026-05-11
**Source:** finalisation-coordinator finalisation pass on PR #287 (slug: sandbox-isolation), Round 2 R2-F1.
**Pattern:** When a table has paired CHECK constraints that depend on multiple columns (`sandbox_executions_running_harvesting_needs_provider_id` requires `provider_sandbox_id IS NOT NULL` when `status IN ('running', 'harvesting')`; the paired `provider_sandbox_id_not_pending` requires NULL when `status='pending'`), the application MUST encode the legal-transition matrix in a pure helper rather than relying on the CHECK to catch violations at write time. Two reasons: (1) the CHECK rejects the write as an opaque DB error after the application has already decided to issue it, which surfaces as a generic 500 instead of a deliberate error path; (2) defence-in-depth requires both layers — the application classifier prevents the round-trip, the CHECK guards against bypass via raw SQL or untyped Drizzle escapes.
**Why it matters:** PR #287 originally swept `pending → harvesting` transitions in both `sandboxCeilingMonitorJob.markForHarvest` and `sandboxHarvestReconciliationJob.reconcileExecution` — a pending row would have NULL `provider_sandbox_id` and the harvesting flip would violate the CHECK. The fix is `classifyCeilingTransition(status, providerSandboxId, ceilingType): CeilingTransition` in `sandboxCeilingMonitorPure.ts` with four outcomes (`harvesting`, `start_failed`, `noop:already_harvesting`, `noop:unexpected_state`). Both call sites consult the classifier; the pure-test matrix encodes every (status, providerSandboxId) cell. The race-safe `status=` WHERE predicate on the UPDATE backs it up. This pattern generalises to any table where a CHECK constraint involves a conditional on >1 column.

## DB-anchored elapsed time in correctness-sensitive paths (ceiling monitor)

[cross-reference 2026-05] See also the 2026-04-29 entry `DB-canonical now_epoch must be threaded through any time-delta computation derived from a rate-limit check` above — same DB-canonical-time principle, different application surface.

**Date:** 2026-05-11
**Source:** finalisation-coordinator finalisation pass on PR #287 (slug: sandbox-isolation), Round 2 R2-T1.
**Pattern:** When a path enforces a quantitative invariant (timeout, cost ceiling, rate limit, billing window) by comparing elapsed time against a threshold, BOTH endpoints of the comparison MUST come from the same time source. Compute the elapsed value inside the SQL that loads the row: `(EXTRACT(EPOCH FROM (NOW() - {column})) * 1000)::bigint`. Never compute elapsed in Node code by combining DB-stored `started_at` with `Date.now()` — that mixes DB clock with Node wall-clock, and cross-instance clock skew (NTP drift, container clock drift) silently changes the outcome.
**Why it matters:** PR #287 originally computed `elapsedMs = Date.now() - new Date(startedAt).getTime()` in `sandboxCeilingMonitorJob`, where `startedAt` is the DB-set value of `sandbox_executions.started_at`. Pre-existing patterns in the codebase already enforce DB-anchored time: `inboundRateLimiter.ts` returns `extract(epoch from now()) as now_epoch` from the rate-limit query and propagates `nowEpochMs` to all callers (KNOWLEDGE.md 2026-05-XX entry); `agentWorkingTimeService.ts` uses `process.hrtime.bigint()` for elapsed measurement to avoid `Date.now()` NTP drift. The sandbox ceiling monitor is the same class of code (it drives both timeout enforcement AND billing via the `estimateSandboxCostCents` correlation). Drizzle pattern: extend the existing typed `.select({...})` with a `sql<string | null>` fragment for the elapsed value (bigint returned as string for safety; `null` when the source timestamp is null, which the application's classifier handles).

## CI grep gates authored in code must be wired into a workflow before merge
**Date:** 2026-05-11
**Source:** finalisation-coordinator finalisation pass on PR #287 (slug: sandbox-isolation), Round 2 R2-T2 (scope expansion).
**Pattern:** Authoring a new CI grep gate script (`scripts/gates/verify-*.sh`) is half the work — the other half is adding a step to `.github/workflows/ci.yml` (or the appropriate workflow) that invokes the script. A gate that exists as a script but has no workflow step has zero enforcement value; it is documentation, not a gate. Phase 2 doc-sync did not catch this because doc-sync verifies code/doc coherence, not code/CI coherence. Going forward: any chunk that adds a `scripts/gates/verify-*.sh` MUST also touch `.github/workflows/ci.yml` (or equivalent) in the same commit. The chatgpt-pr-review Round 2 T2 finding caught the symptom (`STRICT_TEMPLATE_TAG_CHECK` env var not wired); the actual gap was that ALL FIVE of the C14 sandbox gates were script-only.
**Why it matters:** Spec B Phase 2 closed with 5 new gates documented in the handoff and architecture.md as "5 new CI grep gates added per spec" — but `git grep -l verify-sandbox-classification .github/` returned empty. The fix wires all 5 into `ci.yml § grep_invariants` with `STRICT_TEMPLATE_TAG_CHECK` enabled via `contains(github.event.pull_request.labels.*.name, 'ready-to-merge')`. The wider lesson is process: doc-sync sweeps must include a "any new `scripts/gates/verify-*.sh` is referenced in `.github/workflows/`" check, or the C14-equivalent chunk in future Specs must explicitly include the workflow file in its plan.

## Strict CI gates require pre-publish version-string convention to avoid blocking ship
**Date:** 2026-05-11
**Source:** finalisation-coordinator finalisation pass on PR #287 (slug: sandbox-isolation), Round 2 R2-T2 follow-on.
**Pattern:** A CI gate whose strict mode hard-fails on "non-`local-dev-*` version with no matching publish tag" creates a chicken-and-egg problem for the FIRST publish: the PR that introduces the template cannot push the tag before merge (no commit hash to tag), and cannot rely on the tag existing after merge (the tag is the operator's post-merge work). The convention that resolves this: pre-first-publish `CURRENT_VERSION.version` MUST use a `local-dev-*` prefix (e.g. `local-dev-v1.0.0`). The operator flips the prefix off at first-publish time as step 0 of the runbook. The gate's `local-dev-*` exemption is the "we know this isn't tagged yet, it's not supposed to be" signal.
**Why it matters:** PR #287's initial `CURRENT_VERSION.version=v1.0.0` would have blocked its own `ready-to-merge` label firing (strict gate fails because no `sandbox-template/synthetos-sandbox/v1.0.0` tag exists). Flipping to `local-dev-v1.0.0` keeps the strict gate green during V1 ship while accurately signalling pre-first-publish state. The operator's SANDBOX-F1 step 0 flips back to `v1.0.0` at first-publish. This pattern applies to any "production release fingerprint" file where a CI gate enforces post-publish coherence: the pre-first-publish state needs an explicit "not yet published" sentinel that the gate exempts.

### 2026-05-12 Correction — Mockups must be grounded in the actual codebase UI before drafting, not invented in parallel

**Recurring failure pattern:** mockup-designer (and the main session when authoring UI prompts) jumps straight to drafting hi-fi prototypes without first reading the existing UI surfaces the new capability extends. The result is a parallel UI universe — new pages, new nav entries, new visual languages — for functionality that the existing app already has the right surface for.

**Concrete recent example (Phase D Operator Backend, round 1 mockups):** the operator-run experience was drafted as a standalone "autonomous runs" world (dedicated session-in-progress page, dedicated completed/failed/cancelled pages, dedicated active-sessions list, dedicated provider-suspended page). The actual codebase already has `OpenTaskView.tsx` with `TaskHeader` + `ChatPane` + `ActivityPane` + `RightPaneTabs (Now / Plan / Files)` — the exact surface where an operator run should appear. Operator review caught it in round 1, forced a complete round-2 rebuild against `client/src/pages/OpenTaskView.tsx` and the components under `client/src/components/openTask/`. One wasted mockup round + half a session of context.

**The fix lives in three places (applied 2026-05-12):**
1. `.claude/agents/mockup-designer.md` — added **Step 0a: Codebase grounding pass**, mandatory every round before drafting. The agent must Read the existing pages/components, quote inherited vocabulary in `mockup-log.md`, and explicitly justify any new dedicated page proposal. Mockup-log entry format extended to include the codebase-grounding section.
2. `docs/frontend-design-principles.md` — added a new pre-design checklist item (now #1): "Where does this surface live in the existing UI?" The five-hard-rules re-check now includes "Did I extend an existing page/component instead of inventing a new one?"
3. This entry — captures the failure pattern itself so future sessions reading KNOWLEDGE.md at session start see it.

**Detection signal in future:** if a mockup round produces top-level new pages or new nav entries for functionality that has an existing analogue (run-tracking, task-management, connections, settings, agent config), assume the mockup is wrong-shape and challenge it before delivery. The default answer is *extend, don't replace*. The legitimate exception is cross-cutting surfaces (a dashboard that aggregates across multiple existing pages) — and even then, the new page must be justified per item.

**Caller-side reinforcement:** when dispatching mockup-designer, the prompt MUST name the existing UI files the new capability extends. Don't trust the agent to find them via a generic "explore the codebase" instruction — point to specific paths. The Step 0a rule now requires the agent to ask the caller if the brief doesn't name them, but caller specificity is the cheaper safeguard.

### 2026-05-12 Correction — Step 0a "codebase grounding pass" must enumerate exact filenames per screen, not just claim grounding was done

**Concrete failure (Phase D Operator Backend, round 2 mockups, 2026-05-12):** mockup-designer round 2 ran with Step 0a in place and claimed grounding was performed, but produced `r10-tasks-list-operator-filter.html` — a fictional tasks-list page that does not exist anywhere in the codebase. The real kanban-style task board is `client/src/pages/WorkspaceBoardPage.tsx` (route `/admin/subaccounts/:subaccountId/workspace`) with `TaskCard` components in drag-and-drop columns. The agent missed it because it searched for the literal word "kanban" rather than enumerating the page files in `client/src/pages/`.

**Root cause:** Step 0a as originally worded asked the agent to "identify the existing pages/components the new capability touches and Read those files BEFORE drafting any HTML" — but did not require the agent to name those files in its mockup-log entry per screen. A claim of "I grounded" passes the rule's bar even when the grounding missed the actual surface.

**The fix:** Step 0a now requires the mockup-log Round entry to include a "Codebase grounding (existing files identified)" subsection that lists, per screen, the exact filenames in `client/src/pages/` or `client/src/components/` the screen grounds against. If a screen claims to extend an existing surface but doesn't name the file, the grounding pass is incomplete and the round is rejected.

**Detection signal in future:** if a mockup-log Round entry lacks an explicit per-screen filename list, the grounding pass was skipped. Reject the round before reviewing the HTML.

### 2026-05-12 Correction — Verify PR state before referencing it as actionable

**Concrete failure:** mid-session I proposed "push this strengthening commit to PR #289 now" assuming the PR was still open. User corrected: PR #289 had already been merged. A `mcp__github__pull_request_read` call would have shown `state: closed, merged: true` in one call.

**The fix:** before referencing an open-PR action ("push commit to PR #N", "add comment to PR #N", "amend PR #N's description"), run `mcp__github__pull_request_read` with method `get` and check `merged` + `state`. If merged, the action is fresh-branch + fresh-PR, not amend.

**Detection signal:** any phrase like "PR #N" that's older than 30 minutes of conversation state is unsafe to act on without re-reading. PR state changes off-session (operator merges, CI auto-closes, conflicts arise) and assumed-open PRs are a common stale-state failure mode.

---

### 2026-05-13 Gotcha — bare db.select/db.update on dual-GUC tables silently returns 0 rows (seen in operator-backend B2/B3)
**Date:** 2026-05-13
**Source:** pr-reviewer fix-loop on operator-backend branch (slugs B2, B3)

`operator_runs`, `operator_task_profiles`, and `subaccount_operator_settings` have FORCE ROW LEVEL SECURITY policies keyed on BOTH `app.organisation_id` AND `app.subaccount_id`. Any `db.select()` or `db.update()` that does NOT run inside a `db.transaction(async tx => { await setOrgAndSubaccountGUC(tx, orgId, subaccountId); ... })` block acquires a fresh pool connection with neither GUC set. RLS fails closed — the query returns 0 rows or affects 0 rows, silently. No error is thrown.

**Concrete failure:** the operator-backend dispatcher read `operator_runs` without a transaction. `currentAttemptNumber` always defaulted to 1 and `chainSeqNext` always defaulted to 1, so every chain link wrote `chain_seq=1`. The `(agent_run_id, attempt_number, chain_seq)` UNIQUE index failed on the second link. The entire chain mechanism was non-functional.

**Rule:** for ANY table with a dual-GUC RLS policy, call `setOrgAndSubaccountGUC(tx, orgId, subaccountId)` as the first statement inside the transaction before reading or writing the table. Never make bare pool calls against these tables. Use `setOrgGUC` only for org-scoped-only tables (agent_runs, iee_runs, etc.). See architecture.md "Dual-GUC pattern" for the canonical list.

---

### 2026-05-13 Gotcha — extend-budget routes must accumulate per-task, not write subaccount-wide settings (seen in operator-backend B1)
**Date:** 2026-05-13
**Source:** pr-reviewer finding B1 on operator-backend branch

When a route provides a per-task budget extension (POST /api/operator-tasks/:id/extend-budget), the correct write target is a per-task accumulator column (e.g. `agent_runs.per_task_budget_extension_minutes`), NOT the subaccount-wide settings row (`subaccount_operator_settings.per_task_budget_cap_minutes`). Writing to the subaccount-wide row makes every task in the subaccount — including future tasks — inherit the elevated cap permanently. The cap drifts upward with every extension and can only be corrected via a manual settings PATCH.

**Rule:** budget caps that are spec-stated as per-task additives must be stored on the task row, not the settings table. The dispatcher composes the effective cap at dispatch time: `effectiveSettings.per_task_budget_cap_minutes + run.perTaskBudgetExtensionMinutes`. The settings table remains the baseline; the task row holds the delta.
### [2026-05-13] Gotcha — EA Draft F2 invariant: approval state lives ONLY on `actions`, never on `ea_drafts`

`ea_drafts.send_state` is a SEND-only lifecycle (`idle → sending → sent | send_failed`). It NEVER reaches `approved`. Approval state lives exclusively on `actions.status = 'approved'`. The approve route (POST /api/ea-drafts/:id/approve) writes to `actions`, then dispatches a fire-and-forget send job that transitions `send_state` from `idle → sending → sent|send_failed`. The stall-reset job (`workflowGateStallNotifyJob.ts`) recovers drafts stuck in `sending`. Consequence: any code that checks `ea_drafts.state === 'approved'` is always wrong — that state is structurally impossible. Always check `actions.status = 'approved'` for the approval predicate; read `ea_drafts.send_state` only for delivery status.

### [2026-05-13] Pattern — Cross-org background job admin pattern for FORCE RLS tables

Background jobs that must scan across all orgs (e.g. `voiceProfileRefreshJob`, `gmailInboxPollJob`, `calendarLookaheadJob`) cannot use the bare `db` handle — FORCE RLS tables (`voice_profiles`, `ea_drafts`, `integration_connections`, etc.) require `app.organisation_id` to be set, and a plain pg-boss handler never has it. Correct pattern:

```typescript
await withAdminConnection({ source: 'job-name', reason: 'cross-org scan' }, async (tx) => {
  await tx.execute(sql`SET LOCAL ROLE admin_role`);
  return tx.query(...);
});
```

`withAdminConnection` acquires a BYPASSRLS connection; `SET LOCAL ROLE admin_role` is required for tables with FORCE RLS (the BYPASSRLS flag alone is not sufficient when the policy uses `FORCE`). Do NOT use raw `db` for cross-org scans against FORCE RLS tables. See `server/lib/adminDbConnection.ts` and `server/jobs/agentRunCleanupJob.ts` as reference implementations.

### [2026-05-13] Pattern — User-owned agent credential isolation: `agents.owner_user_id` gates OAuth token access

User-owned agents (Personal Assistant, executive-assistant slug) introduce `agents.owner_user_id` — which user's OAuth tokens are used for calendar/Slack skill execution. The SKILL_HANDLERS for user-scoped skills (`calendar.*`, `slack.*`) MUST resolve `ownerUserId` from the DB via the agent record (`agents.ownerUserId`), never from LLM-provided input. The canonical resolver is `resolveAgentOwner(agentId, orgId, db)` in `server/services/skillExecutor.ts`. Never trust `context.input.userId` or any caller-supplied user reference for credential resolution — this is a security boundary. An agent cannot execute skills on behalf of a user it is not owned by, regardless of what the LLM puts in the tool input.

### [2026-05-13] Pattern — Approval routes must NOT fire-and-forget dispatch; the proposal/action primitive's commit hook owns it

Source: PR #291 chatgpt-pr-review Round 1 F3. The original EA approval route did `actionService.transitionState(actionId, 'approved')` then immediately dynamic-imported the slack/calendar handler and dispatched fire-and-forget from the HTTP route. Failure modes: (a) `transitionState` succeeds but the process crashes before dispatch — action is approved but the send never happens; (b) if the proposal primitive later gains its own commit hook, the route's dispatch double-sends; (c) fire-and-forget errors only `console.log`, the operator never sees them; (d) exactly-once dispatch is no longer owned by the state transition.

Rule: the HTTP route does ONE thing — call `transitionState('approved')`. The proposal/action primitive's `approved` commit hook (registered at boot via `actionService.registerCommitHook`) owns the dispatch. The hook awaits the dispatch service so any error propagates back into the transition's error path. No HTTP route may directly invoke a send-side service after approving. Detection: grep for `transitionState.*'approved'` in a route handler followed by any direct service call — if you see it, the dispatch needs to move into a commit hook. See `server/services/eaDrafts/eaDraftDispatchService.ts` + `actionService.registerCommitHook` for the canonical wiring.

### [2026-05-13] Pattern — Dispatch hooks must claim BEFORE routing; pre-claim errors otherwise leave drafts in idle

Source: PR #291 chatgpt-pr-review Round 2 F2. The naive dispatch hook was: receive `approved` event → switch on `draft.kind` → invoke handler → handler's first line is `claimSend` (idle → sending). Any error thrown BEFORE the handler's own claim (dynamic import failure, malformed body, missing provider module, routing bug, unexpected kind/body mismatch) leaves the draft at `ea_drafts.send_state = 'idle'` while `actions.status = 'approved'` — a durable approved-but-never-sent state. The stall-reset job (`workflowGateStallNotifyJob`) only recovers drafts stuck in `sending`, not `idle`, so the row stays orphaned forever.

Rule: the dispatch hook itself MUST `claimSend` BEFORE routing. Pattern: call `eaDraftService.claimSend(row.id)` first; if `claimed === false`, return silently (idempotent — already in flight); otherwise wrap `routeDraftSend(row, { ...ctx, _dispatchPreClaimed: true })` in try/catch and call `eaDraftService.markSendFailed(row.id, String(err))` from the catch. Downstream handlers honour the `_dispatchPreClaimed` flag and skip their own claim. Every failure becomes `send_failed`; manual-retry endpoints work. Detection: any time you write `await routeXyz(row)` inside a state-transition hook with no preceding claim, the row can get orphaned on hook-internal errors. The rule generalises to any "approved → send" decoupled handler: the hook that bridges the two states owns the claim, not the leaf handler.

### [2026-05-13] Pattern — List endpoints must not return sensitive sub-objects that the detail endpoint already gates

Source: PR #291 chatgpt-pr-review Round 2 F3. The new `GET /api/agent-runs?agentId=` list route initially returned the full `agent_runs` row, including `triggerContext`. RLS already gated row-level access correctly, but `triggerContext` is a sensitive sub-object on user-owned runs — its visibility was previously owned exclusively by the Run Trace detail endpoint (`GET /api/agent-runs/:id/trace`), which applies owner/admin redaction rules. Adding a new LIST surface that returns the field as-is widens the data-exposure perimeter without inheriting the detail endpoint's content rules.

Rule: when an existing detail endpoint owns the visibility contract for a sensitive sub-object (`triggerContext` on `agent_runs`, draft `body` on `ea_drafts`, decoded `secret` on `integration_connections`, etc.), new list endpoints should NOT return that field — even when row-level access is permitted. List endpoints return metadata + a `<field>Redacted: true` marker; clients follow up with the detail endpoint to get redacted-or-full content per the existing rules. Detection: any new list route on a table where a detail route already exists — diff its SELECT against the detail route's SELECT. If the list route returns fields the detail route redacts in some branches, the list route has widened the contract; reduce it to metadata + redacted marker. The cost of removing a field is one extra round-trip; the cost of leaving it is silently expanding the privacy surface.

### [2026-05-13] Pattern — Admin-write paths to FORCE RLS tables use withAdminConnection + SET LOCAL ROLE admin_role (BYPASSRLS), not inline WITH CHECK carve-outs

Source: PR #291 chatgpt-pr-review Round 2 F1. The `external_trigger_dedup` table is FORCE RLS with a tight owner-only WITH CHECK. Webhook ingestion and trigger dispatch insert rows on behalf of users they don't represent (the webhook handler runs as the system, not the impersonated user). ChatGPT recommended widening the WITH CHECK to also allow `current_setting('app.current_role', true) IN ('org_admin', 'system_admin')` — but this fails for the webhook path because `withAdminConnection` sets the DATABASE role (`admin_role`), not the `app.current_role` GUC. App-tier inserts that set the GUC would pass; admin-connection inserts that don't set the GUC would still be rejected.

Rule: pick ONE convention per table and stick to it.
- Admin-write via `withAdminConnection` + `SET LOCAL ROLE admin_role` (BYPASSRLS) — the established repo convention. WITH CHECK stays owner-only. The admin role bypasses RLS entirely; the predicate never runs against the insert. Used by cleanup jobs, webhook ingestion, and cross-org background scans. See `KNOWLEDGE.md [2026-05-04] Gotcha — Cleanup jobs on FORCE-RLS tables MUST use withAdminConnection` and `KNOWLEDGE.md [2026-05-13] Pattern — Cross-org background job admin pattern for FORCE RLS tables`.
- Inline WITH CHECK carve-out — only viable when admin writes flow through the app tier with `app.current_role` set (rare; needs the route to call `setCurrentRoleGUC` before the insert). The pattern works but creates two write paths on the same table and is easy to drift on.

Detection: any new write path to a FORCE RLS table — if the path is webhook ingestion, scheduled job, or background worker, it MUST be inside `withAdminConnection`. Trying to "open up" the WITH CHECK to `org_admin | system_admin` is a code smell that means the author hasn't picked the right convention. Confirm with `grep -r withAdminConnection` against the table name — if the table already has admin-connection writes, that's the established convention and the new path joins it.

### [2026-05-13] Pattern — Unique partial indexes bind a key for life — adoption helpers MUST adopt terminal rows, not fresh-start

**Source:** chatgpt-pr-review Round 1 F2 on operator-backend branch (PR #288). The `sandbox_start_key` column on `sandbox_executions` has a unique partial index `(sandbox_start_key) WHERE sandbox_start_key IS NOT NULL` (migration 0340). The pure decision `decideAdoptOrStart` originally returned `fresh_start` for terminal rows, intending the caller to re-INSERT a new row. The unique index makes this impossible: any second INSERT with the same key violates the index and crashes the dispatch. The bug was structurally invisible until a chain link's first sandbox completed and the dispatcher re-fired with the same `operator_run_id` as the start_key — at which point every retry crashed.

**Rule:** when a column has a unique partial index, any adoption / idempotency helper keyed on that column MUST treat terminal and live rows identically — adopt when the caller's id matches the existing row, conflict when the caller's id differs, fresh-start only when no row exists at all. Returning `fresh_start` for terminal rows is only safe if the column has no unique constraint. Detection: any pure helper returning a `fresh_start | adopt | conflict` enum keyed on a column — grep `migrations/` for `UNIQUE INDEX` or `unique partial index` on that column; if found, terminal rows must adopt. The fix is in the pure helper, not in the SQL: keep the unique index (it's the integrity contract); adjust the decision to match.

### [2026-05-13] Pattern — orderBy DESC discipline for "latest non-superseded" queries

**Source:** chatgpt-pr-review Round 2 F2 on operator-backend branch (PR #288). The fresh-profile-restart route reads `operator_runs` filtered by `isNull(supersededByAttempt)` (current attempt only) and was supposed to inspect the LATEST chain link's `failure_reason`. The original query used `.orderBy(operatorRuns.chainSeq).limit(1)` — ascending — which returns the EARLIEST chain link. Combined with the predicate checking `failure_reason='OPERATOR_PROFILE_UNRECOVERABLE'`, the predicate could never match because the earliest chain link almost always has a different (or null) failure reason. The route was structurally dead for its intended trigger.

**Rule:** any query whose semantics are "select the most recent X" MUST use `.orderBy(desc(<sortColumn>))`. ASC + LIMIT 1 returns the earliest, not the latest — easy to typo, hard to detect because the query "looks right" until a predicate based on the field returns 0 rows in production. Detection: grep for `orderBy(<table>.chainSeq)` / `orderBy(<table>.createdAt)` / `orderBy(<table>.<timestamp>)` without a `desc(...)` wrapper — if the surrounding code reads it as "latest", it's wrong.

### [2026-05-13] Pattern — Coarse permission middleware can short-circuit handler-level actor rules

**Source:** chatgpt-pr-review Round 4 F1 on operator-backend branch (PR #288). The operator-task routes (retry-chain-failure, extend-budget) intend to allow "assigned user OR manager+". The handler implements this via `evaluateRouteActorRule` against `agent_runs.assigned_user_id` and the actor role. But the routes also mounted `requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT)` as middleware — and AGENTS_EDIT is typically a manager-level permission, so rank-and-file assigned users were rejected at the middleware BEFORE the handler ever ran. The handler-level rule was unreachable for the case it most needed to admit.

**Rule:** when a route uses BOTH a coarse permission middleware AND a fine-grained handler actor rule, the middleware permission must be a strict superset of every actor the rule would admit. If the rule needs to admit user-level actors with task-assignee context, the middleware permission must be at user-level or removed entirely (let the handler rule be the gate). Detection: any route with `requireOrgPermission(X)` middleware followed by a handler-level role-or-context check — verify that X is granted to every role the handler rule would admit. If the handler admits "assigned user with no special permission", the middleware can't gate on a permission that user lacks. The clean V1 solution for the operator-backend case was to remove the middleware on the user-or-manager routes (handler rule is sufficient) and keep it on the admin-only routes (where the middleware filters non-admins early).

### [2026-05-13] Pattern — Spec aspirational fields require schema reality check before route wiring

**Source:** chatgpt-pr-review Round 3 F1 on operator-backend branch (PR #288). Spec §6.5b stated: "The route handler reads `agent_runs.assigned_user_id` and `users.role` before authorising." But `agent_runs.assigned_user_id` did not exist in V1 — the spec was authored aspirationally and the Phase 2 build matched the spec by passing `null` everywhere instead of adding the column. The result: a structurally-dead-code branch in the actor-rule helper that no production caller could ever reach.

**Rule:** when a spec references a column or field that doesn't exist yet, the implementation MUST either (a) add the column in the same build, (b) document the absence and route around it with a real V1 fallback, or (c) defer the entire feature. Hardcoding `null` for the missing field "to match the spec" creates dead code that masks the absence and accumulates technical debt invisible at review time. Detection: at spec-time, grep the schema files for every column the spec mentions; flag any absences before the build starts. At build-time, before writing a route that reads `<table>.<field>`, run `grep -n "<field>" server/db/schema/<table>.ts` — if the column isn't there, decide the (a)/(b)/(c) question with the operator before writing the route.

### [2026-05-13] Process — Long-running review windows produce migration-number collisions; the loser branch renumbers + sweeps

**Source:** finalisation-coordinator S2 step on operator-backend branch (PR #288). While the operator-backend branch ran 4 rounds of chatgpt-pr-review, main shipped PR #291 (Personal Assistant V1) with migrations 0327-0332. Operator-backend had reserved 0327-0334. The S2 merge surfaced 6 migration filename collisions on the same numbers.

**Rule:** when a long-running review window collides with main's migrations, the convention is the loser branch (still in review) renumbers all colliding migrations to the next available slot, in their original relative order. This is mechanical but requires a thorough sweep — migration filenames, internal `-- Migration NNNN` header comments, `policyMigration:` entries in `rlsProtectedTables.ts`, schema-file comment pointers (`// Migration: NNNN_<name>.sql`), spec file inventory + body prose, plan file inventory + acceptance criteria, handoff narrative, and any `migration NNNN` inline references in service code or test files. Detection: after S2 merge, `git diff --stat` the migration directory — pairs added on both sides with the same number are collisions. The renumber should preserve relative order (lower → still-lower in new numbering) and a single `chore(sync): merge main into <slug> (S2) — migration renumber NNNN-NNNN → MMMM-MMMM` commit captures the entire sweep so future bisect can trace the rename event cleanly.

Source: PR #291 chatgpt-pr-review Round 2 F1. The `external_trigger_dedup` table is FORCE RLS with a tight owner-only WITH CHECK. Webhook ingestion and trigger dispatch insert rows on behalf of users they don't represent (the webhook handler runs as the system, not the impersonated user). ChatGPT recommended widening the WITH CHECK to also allow `current_setting('app.current_role', true) IN ('org_admin', 'system_admin')` — but this fails for the webhook path because `withAdminConnection` sets the DATABASE role (`admin_role`), not the `app.current_role` GUC. App-tier inserts that set the GUC would pass; admin-connection inserts that don't set the GUC would still be rejected.

Rule: pick ONE convention per table and stick to it.
- Admin-write via `withAdminConnection` + `SET LOCAL ROLE admin_role` (BYPASSRLS) — the established repo convention. WITH CHECK stays owner-only. The admin role bypasses RLS entirely; the predicate never runs against the insert. Used by cleanup jobs, webhook ingestion, and cross-org background scans. See `KNOWLEDGE.md [2026-05-04] Gotcha — Cleanup jobs on FORCE-RLS tables MUST use withAdminConnection` and `KNOWLEDGE.md [2026-05-13] Pattern — Cross-org background job admin pattern for FORCE RLS tables`.
- Inline WITH CHECK carve-out — only viable when admin writes flow through the app tier with `app.current_role` set (rare; needs the route to call `setCurrentRoleGUC` before the insert). The pattern works but creates two write paths on the same table and is easy to drift on.

Detection: any new write path to a FORCE RLS table — if the path is webhook ingestion, scheduled job, or background worker, it MUST be inside `withAdminConnection`. Trying to "open up" the WITH CHECK to `org_admin | system_admin` is a code smell that means the author hasn't picked the right convention. Confirm with `grep -r withAdminConnection` against the table name — if the table already has admin-connection writes, that's the established convention and the new path joins it.

### [2026-05-13] Decision — V1 Executive Assistant: owner-only approval, no admin break-glass content access

Source: PR #291 chatgpt-pr-review Round 1 F2. Spec §18 line 1573 locks V1 EA approval to the draft owner only: `if (draft.ownerUserId !== req.user.id) → 403`. The original route allowed `org_admin | system_admin` to approve another user's draft — this is rejected for V1 because it conflates "admin can see metadata" with "admin can act on content". Admin break-glass for EA drafts (read body, approve on behalf, reject on behalf) requires an explicit V2 spec with an audit gate: every break-glass action writes an audit row with reason, the admin's identity, and the affected draft owner. Until that spec exists, admin paths return 403 on approve/reject/retry.

Generalises beyond EA: any "AI-drafted content awaiting user decision" surface (EA drafts, agent recommendations awaiting user approval, generated reports pending publish) defaults to owner-only action. Admin metadata visibility is fine (list endpoints can show "Bob has 3 pending drafts"). Admin content visibility and admin content action are separate, gated capabilities that require their own audit story. Detection: any new route that gates by `isAdmin || isOwner` for an action on user-generated content — challenge it. The default is `isOwner` only; the `isAdmin` branch requires a documented audit-and-rationale layer.

### [2026-05-15] Pattern — Page split for mega-pages: host + `components/<feature>/` + scoped hook

Source: simultaneous refactor of `client/src/pages/AdminSubaccountDetailPage.tsx` (1,415 LOC), `client/src/components/Layout.tsx` (1,325 LOC), and `client/src/pages/UsagePage.tsx` (1,280 LOC). Hosts shrunk to 92 / 192 / 127 LOC respectively. Specs at `tasks/builds/feat-split-{adminsubaccountdetailpage,layout,usagepage}/spec.md`.

Reusable shape when a page or shared component crosses ~800 LOC:
1. **Folder convention.** Extracted subcomponents go in `client/src/components/<kebab-feature>/`, matching the established `pulse/`, `clientpulse/`, `skill-analyzer/`, `baseline/` precedent. NEVER under `client/src/pages/<page>/components/` for top-level pages — that creates a third placement convention nobody else follows.
2. **Three placement buckets.** Atoms (`Badge`, `FilterSelect`) under `<feature>/atoms/`; orchestrating tabs / regions directly under `<feature>/`; modals under `<feature>/modals/`. Pure helpers in `<feature>/format.ts` + `constants.ts`; shared types in `<feature>/types.ts`.
3. **Hooks separate from components.** Side-effect-heavy state extracts into focused hooks under `client/src/hooks/use<Feature><Slice>.ts`. One hook per coherent slice (identity, permissions, badges, sidebar config, etc.). Each hook's return contract is pinned in the spec's §7. Hooks own their own `useEffect` blocks including the eslint-disable rationale comments — those carry over verbatim.
4. **Three ownership models for cross-tab data.** (a) host-owned + passed down + `onChange={load}` callback for mutations (e.g. `categories`, `linkedProcesses`); (b) tab-owned self-fetch when no cross-tab consumer exists (e.g. `BoardConfigTab` after refactor); (c) hook-owned single source of truth when multiple chrome regions consume it (e.g. `useLayoutIdentity` for `subaccounts`). Pin the model per data item in spec §7.
5. **Per-tab error banners not a shared host banner.** When tabs extract, their local error state moves with them. The host's previously-shared `error` field becomes dead — remove it as part of the refactor. Spec must explicitly call this out: §8 "error-banner contract" naming exactly which tabs render their own banner.
6. **Optimistic state mutations need an action on the owning hook.** If pre-refactor behaviour did `setSubaccounts(prev => [...prev, newEntry])` inline, the equivalent post-refactor is `useLayoutIdentity.addSubaccount(sa)` — an explicit action exposed by the hook. Forgetting this is a behavioural regression flagged immediately by spec-conformance review.
7. **Imports inside `client/src/components/<feature>/` files use NO `.js` suffix** — matches the `pulse/`, `clientpulse/`, etc. precedent. Hooks under `client/src/hooks/` are mixed; new ones can go either way under `moduleResolution: bundler`. Be consistent within a folder.
8. **Page-file path stays put.** Top-level pages keep their flat `client/src/pages/PageName.tsx` location — moving to `client/src/pages/<feature>/index.tsx` would touch `App.tsx` routing and is a separate refactor (deferred unless explicitly in scope).
9. **Spec-conformance pickier than pr-reviewer.** Spec-conformance flags spec/implementation divergence as `NON_CONFORMANT` even for cleaner alternatives (e.g. dropping redundant props that `identity` already supplies). pr-reviewer treats the same divergence as a "strong rec" not blocking. Both reviewers correctly catch behavioural regressions (dropped optimistic adds, dead state retention) — fix those before merge.

Detection: any `client/src/pages/*.tsx` or top-level `client/src/components/*.tsx` exceeding ~800 LOC is a candidate. Start with the spec-authoring step (see `docs/spec-authoring-checklist.md` §1 "existing primitives search") and reuse this pattern rather than inventing a new one.

### [2026-05-15] Pattern — Batch 2 follow-on for the page-split refactor

Source: simultaneous refactor of `client/src/pages/SubaccountKnowledgePage.tsx` (1,160 → 256 LOC), `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` (1,102 → 230 LOC), and `client/src/pages/subaccount/WorkflowRunPage.tsx` (952 → 200 LOC). Specs at `tasks/builds/feat-split-{subaccountknowledgepage,skillanalyzerresultsstep,workflowrunpage}/spec.md`.

Three additional patterns surfaced beyond the batch-1 list:

10. **Cross-tab side-effect ordering: mutate-while-mounted, then unmount via tab-switch.** When a tab's action (e.g. Promote in References) triggers a tab switch + parent refetch, the spec-correct ordering is: `api.post(...)` → `toast.success(...)` → close any open modal → `await onMutated()` (the parent's load) → `onTabSwitchTo(other)`. Doing the tab-switch first causes the React 18 setState-on-unmounted-component warning because the originating tab is still in the middle of post-success state cleanup. Spec must pin this ordering verbatim.

11. **Header-button-to-tab handshake via `openCreateOnMount` / `onCreateConsumed`.** When the host renders a "+ New X" button that should open the active tab's create modal, the active-tab component receives `openCreateOnMount: boolean` + `onCreateConsumed: () => void` props. On mount with `openCreateOnMount=true`, the tab opens its create modal and calls `onCreateConsumed()` to clear the host's `pendingCreate` flag (so a subsequent tab switch + return doesn't re-trigger). The `onCreateConsumed` callback must be `useCallback`-stabilised on the host or the `useEffect` re-fires every render.

12. **Sub-folder convention for orchestrator-internal pieces.** When a single orchestrator (e.g. `SkillAnalyzerResultsStep`) decomposes into 5+ sub-files that are not reused elsewhere, group them in a sub-folder named after the orchestrator (`skill-analyzer/resultsStep/` ⊂ `skill-analyzer/`) rather than flat-listing them alongside truly shared siblings. The sub-folder signals "internal pieces of X" vs `skill-analyzer/` which signals "the skill-analyzer feature surface as a whole". Same principle would apply to `<feature>/<orchestrator>/` for future page-or-component splits where the orchestrator has its own dedicated sub-pieces.

13. **Defer optional internal splits unless the LOC threshold is breached AND the split simplifies something concrete.** Specs commonly include conditional "If X.tsx exceeds ~300 LOC after this move, also split Y" lines. At 350-407 LOC such splits are sometimes still worth doing (RenameReferenceModal extraction at 407 LOC made the parent shorter and clearer); at 320 LOC they may not be (AgentsTab at 377 LOC was deliberately not split because the 3 modals form a coherent unit). Spec-conformance reviewer will flag the spec-vs-code drift either way; the call is whose-judgement and whether the split improves readability or just moves lines.

14. **Verbatim-source preservation can preserve latent bugs.** PR-reviewer surfaced a long-standing `WorkflowSlug` (Pascal-case) typo in `WorkflowRunPage` that mismatches the server's `workflowSlug` field — the buggy fallback branch has been unreachable for as long as the field has been on the wire. The refactor's "preserve verbatim" rule means the bug carried over. Decision: keep latent bugs intact during a refactor unless the spec explicitly opts in to fixing them. The natural fix is a follow-on commit, not a refactor amendment.
### 2026-05-13 Pattern — "Suppression is success" for single-writer event emitters _(promoted from tasks/todo.md)_

When a single-writer event emitter loses a coordination race (another writer already produced the canonical event), the emitter MUST return `{ success: true, suppressed: true, reason }` rather than `{ success: false, ... }`. Returning failure triggers retries, false incident signals, and broken metrics — the metaphor is "we agreed not to write, that IS success." ADR-0013 formalises the rule; `architecture.md § Home dashboard live reactivity` documents the canonical implementation; `system-monitoring writeDiagnosis` enforces it; this KNOWLEDGE entry captures the pattern in retrievable form. When introducing a new single-writer emitter, name a helper (e.g. `suppressedSuccess(reason)`) that returns the shape above rather than hand-rolling it at the call site.

### 2026-05-13 Pattern — Closed-enum service-boundary error mapping _(promoted from tasks/todo.md)_

When a service throws typed errors with a `code` discriminator, the route MUST map the code to its HTTP envelope via a closed `switch` (every branch enumerated, `default: throw`). Open-ended string-comparison mapping (`if (err.code === 'foo') ...` cascades) is a blocking review finding — new codes silently fall through with the wrong HTTP status and the wrong envelope shape. The canonical pattern: define the error-code union at the service boundary (`shared/types/...` if shared across routes), import it into both the service and the route, and let TypeScript's exhaustiveness checking enforce the mapping. Surfaced repeatedly during consolidation-govern (CONSOL-GOV-DEF-9) and audit-remediation reviews; promoted because the pattern is reusable across every service that throws typed errors. Cross-link: `architecture.md § Service Layer` now references this entry directly.

### 2026-05-13 Correction — OpenTaskView + run-trace invariants are platform-level, not per-agent or per-build

Drafted V2 framing scoped the "operator-mode tasks surface through the same OpenTaskView / ChatPane / FilesTab / Activity primitives" rule to V2 (the EA's operator-mode upgrade). Operator pushed back: this is universal — every agent run in every controller mode in every build uses the same task surface. No agent and no controller gets a "special" task screen, ever. Capture in V2 spec only at the level of "EA inherits the universal invariant"; the invariant itself belongs in `architecture.md` and the master brief, not in a use-case spec. Detection: any new spec that proposes a task-management UI surface tied to a specific agent / controller / runtime is automatically suspect — challenge it back to "reuse OpenTaskView, extend the event channel if needed."

### 2026-05-13 Correction — Orchestrator routing must be declarative (capability-map + scope), never hard-coded per agent

Drafted V2 routing logic for the EA as if the orchestrator needed special-case rules ("if intent mentions calendar → route to PA"). Operator corrected: the orchestrator already does declarative capability matching via `capabilityMapService.ts`; V2's job is to extend the matcher's scope axis (capabilities tagged `scope: user:<owner_user_id>` match only when `requester_user_id == owner_user_id`), not to add per-agent if-statements. Explicit name addressing (`@PA`, `@MyAssistant`) is a soft routing hint that boosts a candidate's score but doesn't bypass capability matching. Cross-ownership delegation uses the same rules — parent agent's request carries through to capability matching at the delegated step. Detection: any spec that proposes "the orchestrator detects X and routes to Y" without showing it as a capability-declaration + scope-match is incorrectly hard-coded; reframe as a declarative rule.

### 2026-05-13 Pattern — Derive event type from UPSERT result, never from a preflight existence check

Source: PA-V2-OP chatgpt-spec-review Round 2 F1 (spec §4.2 / §5.7 / §9.1 / §9.3 for `operator_run_files`).

When an event-emitter writes through an UPSERT on a UNIQUE key and emits an event whose type discriminator depends on whether the row was new or pre-existing (`*.created` vs `*.modified`, `inserted` vs `updated`, etc.), the discriminator MUST be sourced from the post-write return value — `RETURNING version`, `RETURNING xmax = 0`, the UPSERT result version field, etc. — NEVER from a separately-issued preflight `SELECT` against the same key. The race: two writers issue independent preflight lookups, both observe "no prior row", both decide `*.created`, the UNIQUE constraint serialises the UPSERTs so one gets version 1 and the other gets version 2, and both incorrectly emit `*.created`. The correct contract: writer A's UPSERT returns version=1 (emits `*.created`), writer B's UPSERT returns version=2 (emits `*.modified`). Preflight lookups are acceptable for watcher dedupe / fast-path skip ("same hash already stored, no need to write"), but never as the source of truth for event type under concurrency. This generalises across every agent-emitted event stream that fronts a Postgres UPSERT — webhook fan-out, file-event bridges, audit trails, lifecycle events. Detection: in any new spec touching event-stream emission against an UPSERT-backed table, search the contract for "looks up prior row" / "checks existence" / "preflight" wording on the event-type-decision path and challenge it; the rule is "ask the database what happened, don't ask twice."

### [2026-05-13] Pattern — Idempotency keys MUST include a per-emission discriminator when the product allows multi-emission

Source: PR #296 chatgpt-pr-review Round 2 F2 (REVIEW-F2 reversal). `eaDraftService.createDraftWithProposal` originally built the upstream `actionService.proposeAction` idempotency key from `(agentRunId, kind, ownerUserId)` only. Within a single agent run, that key collapses every draft of the same kind for the same owner onto the FIRST proposal action — the second `proposeAction` call returns `isNew: false` with the first action's id, the second `ea_drafts` row is then inserted sharing that `proposal_action_id`, and on approval `dispatchAfterApproval`'s `.limit(1)` only sends one. The second draft is permanently stuck in `idle` with no recovery path.

**Rule.** An idempotency key's identity tuple MUST be drawn from "what makes two CALLS logically the same call" — not from "what makes two CALLERS logically the same caller." If the product allows the same caller to legitimately make multiple distinct calls (multiple drafts in one run, multiple writes to the same external object with different bodies, multiple invocations of the same skill with different inputs), the key needs a per-call discriminator. Concretely: prefer a caller-supplied stable id (`targetRef`, external object id, dedup key from the trigger), fall back to a content hash (`sha1(canonicaliseJson(distinguishing-shape))`) when no natural id exists. The retry-vs-replay contract on `actionService.buildActionIdempotencyKey` remains the canonical model — same logical attempt = same key; different logical attempt = different key.

**Detection.** Any new idempotency key built from "caller-context-only" tuples (run id + kind + user id, session id + endpoint + user id, etc.) without a per-call discriminator. Ask: can this caller legitimately make two distinct calls that would collapse onto the same key? If yes, the key is wrong; add the discriminator. Defence-in-depth: any "1:1 between parent action and dependent draft/row" invariant should be enforced by a UNIQUE constraint on the FK column — silent stuck-state failures are strictly worse than loud unique-violation errors.

Cross-link: `server/services/eaDrafts/eaDraftService.ts` `createDraftWithProposal` jsdoc; migration `0344_ea_drafts_proposal_action_unique.sql`; spec `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md` §7.5 invariant block + eighth-pass amendment (REVIEW-F2).

### [2026-05-13] Correction — Operator-override of a chatgpt-pr-review duplicate-finding defer is allowed when the override is a substantive scope reassessment, not rephrasing

Source: PR #296 chatgpt-pr-review Round 2 F2 reversal. `chatgpt-pr-review` §1a duplicate-detection rule auto-applies the prior round's decision when the same finding re-surfaces in a later round. The carveout language reads: "even when rephrased with stronger language ('must-fix', 'not optional', 'blocking')". The 2026-05-13 PR #296 round 2 review re-surfaced F2 (deferred in round 1) with stronger framing AND a substantive new argument: ChatGPT explicitly named the product condition under which the bug is real ("unless the product explicitly forbids 'multiple drafts of the same kind per run'"). The operator accepted that condition does NOT hold (the product allows multi-draft flows) and instructed the agent to reverse the defer.

**Rule.** Operator-override of a duplicate-finding auto-apply is valid when the operator supplies a substantive scope reassessment — not when the operator merely repeats "go again, do it this time" against the same evidence. "Substantive" means new information about product scope, new evidence about real-world frequency, or an explicit acknowledgement that the prior defer rationale ("out of scope for this PR") no longer holds. Log the reversal as `user (implement) — Round N defer reversed by operator after Round M evidence` so the audit trail captures both the original decision and the trigger for the reversal. Do NOT silently re-decide on the agent's own — the duplicate-detection rule's purpose is to protect against agent re-litigation; an operator-driven reassessment is a different signal and must be explicit.

**Detection.** Any chatgpt-pr-review Round 2+ finding that matches a prior decided finding by `finding_type + file` — if the agent's instinct is to override the duplicate-auto-apply, STOP and require an explicit operator instruction. The instruction must include the substantive new reasoning (one sentence is fine); the audit log records both.

---

## Two-axis routing for owner-scoped capabilities (V2, 2026-05-13)

When a capability map has `owner_user_id` set, the orchestrator's target resolution is `target_owner_user_id ?? requester_user_id` (not `requester_user_id` alone). Without the second axis, cross-owner delegation (Sarah asking about Michael's calendar) would filter out Michael's PA because `requester_user_id != owner_user_id`. The two fields must both be propagated from HTTP intake through `RoutingContext` to the matcher. `target_owner_user_id` is server-side-only — HTTP-supplied values are discarded at intake.

---

## Approval routes follow the executor's owner, not the initiator (V2, 2026-05-13)

For cross-owner action proposals inside a sub-run, `actions.approver_user_id` is set to `executor_agent.owner_user_id`, not the initiating user. This means Michael's EA, when invoked by Sarah's parent task, routes approvals to Michael's queue — not Sarah's. Same-owner runs preserve V1 default: `approver_user_id = NULL` (initiator-defaulted path unchanged). Pattern: **approval ownership follows the executor's data boundary, not the request origin**.

---

## Live-file events on R2 via UPSERT-derived version (V2, 2026-05-13)

`operator_run_files` uses a canonical UPSERT (`INSERT ... ON CONFLICT (agent_run_id, path) DO UPDATE SET version = operator_run_files.version + 1 RETURNING version`) as the single source of truth for event type. `version === 1` → `file.created`; `version > 1` → `file.modified`. Never use a preflight SELECT to determine event type — two racing writers would both observe "no prior row" and both emit `file.created`. The UPSERT serialises the conflict under Postgres row-lock and the returned `version` is authoritative. Both the tool-call interceptor path and the sandbox watcher path go through the same UPSERT.

---

## Two-layer service + route privacy projection enforcement (V2, 2026-05-13)

`runTraceProjectionForViewer` is applied at BOTH the service layer (`agentExecutionEventService`) AND the route layer (`server/routes/`). The deliberate two-layer enforcement ensures a future direct consumer of `agentExecutionEventService` (bypassing the route) still gets the projection. Do not remove the route-layer call assuming the service call is sufficient — the redundancy is intentional security depth.

Cross-link: `.claude/agents/chatgpt-pr-review.md` §1a duplicate-detection carveouts; this session's log under `tasks/review-logs/chatgpt-pr-review-claude-close-deferred-pa-v1-13lHR-2026-05-13T06-43-44Z.md` Round 2 entry.
### 2026-05-13 Pattern — Brief-level external review does NOT substitute for spec-level external review

Discovered during `iee-browser-on-e2b` chatgpt-spec-review. The brief had been refined through 7 ChatGPT-driven external reframes (v2 through v7) before spec authoring; the working hypothesis was that this absorbed the directional review and the spec could skip chatgpt-spec-review. That hypothesis was wrong. When the operator later re-opened chatgpt-spec-review, round 1 surfaced 4 high-severity build-readiness blockers the brief reviews had not caught: (1) a referenced warm-pool persistence table with no schema/migration/RLS definition; (2) an audit-able mutation path for a launch-control flag that was described as "direct DB / future route" with no permission, audit, or rollback contract; (3) two new `FailureReason` enum values introduced in the spec but absent from the file inventory; (4) a profile-mount concurrency claim that didn't actually serialise the operation. Pattern: **brief-level review catches scope and policy gaps; spec-level review catches contract / schema / inventory / safety-mechanism gaps. They are different review surfaces and neither substitutes for the other.** For Significant / Major specs: always run chatgpt-spec-review at least one round, regardless of how thoroughly the brief was reviewed. The brief and the spec speak about different things — a brief that locked the right decisions can still produce a spec that fails build-readiness in execution-safety, schema completeness, or contract mechanics. Cost is small (one or two manual rounds); the downside of skipping is a build that stalls in Phase 2 with implementation-readiness failures.

### 2026-05-13 Pattern — Each review round can introduce its own bugs; trend matters more than absolute count

Discovered during `iee-browser-on-e2b` chatgpt-spec-review. Round 1 fix for warm-pool persistence (added a `browser_warm_sessions` table and a unique partial index on `llm_requests(warm_session_id)`) introduced a new inconsistency caught in round 2: the partial index referenced a `warm_session_id` column that wasn't listed in the `llm_requests` schema EXTEND or any migration. Round 2 fix for that introduced a migration-ordering problem (FK target table 0346 exists AFTER 0345 needs the FK) caught in round 3, which split the FK into 0347. Round 3 fix for that introduced a CHECK-constraint null-three-valued-logic bug caught in round 4. Pattern: **assume each fix may create its own gap; do not lock after one good round.** Two healthy signals to trust: (1) verdict trajectory improves monotonically across rounds (CHANGES_REQUESTED → NEEDS_MINOR_TIGHTENING → APPROVED_WITH_MINOR_EDITS → APPROVED); (2) finding severity decreases monotonically (highs → mediums → lows → style). When both signals hold for two consecutive rounds and the latest round produces only style nits, locking is safe. Locking after a single round risks shipping a fix-that-introduced-a-bug.

### 2026-05-13 Pattern — Postgres CHECK constraints with nullable columns need `IS DISTINCT FROM`, not `<>`

Discovered during `iee-browser-on-e2b` chatgpt-spec-review round 3. SQL's three-valued logic makes `NULL <> 'x'` evaluate to NULL (not TRUE), which means a CHECK constraint of the form `CHECK ((col_a = 'x' AND col_b IS NOT NULL) OR (col_a <> 'x' AND col_b IS NULL))` is trivially satisfied whenever `col_a` is NULL — the constraint silently does nothing. The correct null-safe form is `IS DISTINCT FROM`: `CHECK ((col_a = 'x' AND col_b IS NOT NULL) OR (col_a IS DISTINCT FROM 'x' AND col_b IS NULL))`. The `IS DISTINCT FROM` operator treats NULL as a normal value for comparison purposes — `NULL IS DISTINCT FROM 'x'` returns TRUE, not NULL. Pattern applies to any CHECK that needs to enforce a contract between two columns when at least one is nullable. Easy to miss because `<>` looks idiomatic; the bug surfaces only under specific null-row conditions that may not appear until production data does. Spec-authoring rule: every CHECK constraint that references a nullable column MUST use `IS DISTINCT FROM` (or `IS NOT DISTINCT FROM`) for the comparison; reviewers should flag `<>` against any nullable column as a default-incorrect pattern.

### 2026-05-13 Pattern — "Rows are never deleted" service contracts pair with `ON DELETE RESTRICT`, not `SET NULL`

Discovered during `iee-browser-on-e2b` chatgpt-spec-review round 3. A new `browser_warm_sessions` table was specified with the invariant "rows are never deleted; state transitions only" (`available → leased → terminated`, audit trail preserved). The FK from `llm_requests.warm_session_id` was initially specified as `ON DELETE SET NULL` — the conventional default for nullable FKs. But the two are inconsistent: if `SET NULL` ever fires, it silently destroys the idempotency link (the unique partial index keyed on `warm_session_id` depends on the value being present and unique). Pattern: **when the service contract says rows are never deleted, the FK action should be `ON DELETE RESTRICT`, not `SET NULL`.** RESTRICT surfaces any accidental DELETE as a constraint violation (loud failure); SET NULL silently corrupts the idempotency invariant. SET NULL is correct only when the FK is allowed to outlive its target — explicitly NOT the case for audit / cost-attribution trails. Rule: match the FK action to the service contract; if the contract is "rows never deleted," prefer RESTRICT to surface contract violations rather than masking them with silent NULL.

### 2026-05-13 Pattern — Brief citation drift is normal; spec should cite wire-truth, not the brief

Discovered during `iee-browser-on-e2b` Phase 1 + chatgpt-spec-review round 1. The brief referenced "Spec D §3.13 profile primitive" while the actual Spec D file + the codebase comment in `server/db/schema/operatorTaskProfiles.ts:10` cite "Spec D §3.15". Investigation found the brief was written before Spec D finalised its numbering; the citation drifted between brief-lock and spec-authoring. Pattern: **briefs lock decisions and design intent; section citations within briefs are informational and drift over time.** When authoring a spec from a brief, the spec must cite the WIRE-TRUTH source (codebase comments, actual spec file section numbers, live schema files) rather than copy section references from the brief. spec-reviewer's pre-emptive citation finding raised this; investigation confirmed the spec was correct (§3.15 matches wire-truth) and the brief reference is the stale one. Rule: when section numbers disagree between brief and live source, live source wins; surface the brief drift as a separate todo if the brief might be re-cited later.
### 2026-05-13 Pattern — Semantic ranker recall fallback (memory-improvements branch)

Source: spec `tasks/builds/memory-improvements/spec.md` §13.5 + plan Chunk 9.

When `AKR_SEMANTIC_RANKER_ENABLED=true`, `retrievalService` computes cosine similarity per candidate and filters each category (chunks, memory blocks) INDEPENDENTLY by `AKR_RETRIEVAL_THRESHOLD` (default 0.30) BEFORE merging the two pools. Per-category recall fallback fires when filtering empties one category (all of THAT category's candidates fell below threshold); the fallback resets `finalScore: 0` for every candidate in that category and bypasses the filter for that category only. The other category's threshold filtering is unaffected. The merged pool is passed to `rankCandidates` with threshold `0` because category-level filtering is already complete (this is what prevents one category's fallback from dragging below-threshold candidates from the other category through). With the flag off, `queryEmbedding` stays `null`, category-level filtering is skipped, every candidate keeps `finalScore: 0`, and legacy scope+recency ordering applies. Embedding failure (OpenAI call throws) is caught per-run; `queryEmbedding` stays `null` and scoring branches are skipped entirely. These three safety properties — per-category isolation, recall fallback, embedding-failure tolerance — are decoupled from the env flag and from each other. Source: ChatGPT PR review R1 F1+F2 (2026-05-13) — the original implementation used a single `anyFallbackApplied` flag and applied threshold globally on the merged pool, which let one category's fallback disable thresholding for the other.

### 2026-05-13 Pattern — Memory-block lineage idempotency contract (memory-improvements branch)

Source: spec `tasks/builds/memory-improvements/spec.md` §2, plan Chunk 2.

`memory_block_version_sources` records which `workspace_memory_entries` contributed to each `memory_block_versions` row. Idempotency anchor is the version row, NOT the synthesis run. A synthesis run that produces no content change returns `null` from `writeVersionRow` (dedup guard in `memoryBlockVersionsService`); in that case the caller skips `writeLineageRowsForVersion`. A synthesis run that commits a new version row always writes the source links in the same operation. Consequence: every `memory_block_versions` row is guaranteed to have at least one source link if the block is `auto_synthesised`. Pre-migration blocks (`source !== 'auto_synthesised'`) and blocks synthesised before migration 0333 have no source rows — the Sources tab shows "No lineage data available" for those. Deletion-safe: each source link row retains `content_hash` (entry content snapshot) and `source_run_label_at_capture` (formatted agent + timestamp label) so lineage remains readable after the source entry is soft-deleted or the source `agent_runs` row is hard-deleted.

### 2026-05-13 Pattern — 403-before-query for MV-backed routes (memory-improvements branch)

Source: spec `tasks/builds/memory-improvements/spec.md` §6.2.

Routes that read from materialised views (e.g., `mv_memory_utility_30d`) MUST canonicalise and compare path-org vs session-org BEFORE issuing any DB query. Pattern: `const canonical = pathOrgId.toLowerCase()` vs `req.organisationId.toLowerCase()`, 403 if mismatch. This is doubly important for MV-backed surfaces because MVs are excluded from RLS (they are read-only aggregates; RLS on the base tables governs write access; route-layer permission gates govern read access). Skipping the 403-before-query check on an MV route means a user with a valid session for org A can read org B's aggregated metrics by substituting the path parameter. Detection: any new route that queries an MV or a table in `rlsExclusions.ts` — confirm a 403-before-query guard is present before the first DB call.

### 2026-05-13 Note — Synthesis must always write memory_block_versions before memory_block_version_sources (memory-improvements branch)

Source: plan Chunk 2 review.

`memory_block_version_sources` has a FK to `memory_block_versions`. If auto-synthesis writes a `memoryBlocks` row (insert), it MUST also call `writeVersionRow` to produce a `memory_block_versions` row in the same operation, or the FK constraint for source links will fail. Previously this was implicit; it is now explicit. `writeVersionRow` returns `null` for consecutive identical content (dedup); callers skip `writeLineageRowsForVersion` in that case. The correct call order is always: `insertMemoryBlock` → `writeVersionRow` → `writeLineageRowsForVersion` (if version row was created).

### [2026-05-14] Pattern — RUNTIME-DISABLED scaffold for partially-wired features _(iee-browser-on-e2b)_

Source: PR #297 chatgpt-pr-review Round 3 F17.

When a service exports methods that the rest of the codebase will eventually call but whose dependencies are not yet wired (cross-tenant sweeps awaiting `withAdminConnection`, provisioning paths awaiting an external SDK install), the unsafe method body MUST be replaced with a runtime throw rather than left as a partially-correct implementation. The throw carries a specific `FailureReason` code from the existing enum (here: `sandbox_provider_unavailable`), a clear message naming the dependency that must land first, and a pointer to the tracking entry in `tasks/todo.md` (IEE-DEF-N). The reference implementation that the future caller will need lives in git history, not in the running tree. This forces any future operator who wires the feature to (a) confront the dependency before re-enabling, (b) read the prior implementation deliberately, (c) re-author the safer version.

Why this beats keeping the broken implementation: silent RLS bypass risk if anyone accidentally wires a caller (the partial implementation would have run without admin connection); visibility (a grep "RUNTIME-DISABLED scaffold" instantly enumerates unsafe methods); doesn't pollute the type system or import graph (the export shape stays the same).

Detection: any function with a stale `TODO: <something> — deferred` comment that still has a working body. Convert to throw with the pattern above and queue the wiring TODO with a stable id.

Cross-link: `server/services/sandbox/browserWarmPool.ts::evictStale` + `refillIfEligible`, `server/services/sandbox/ieeBrowserProfileManager.ts::gcSweep`. Tracked as IEE-DEF-1, IEE-DEF-2, IEE-DEF-3.

### [2026-05-14] Pattern — Placeholder-digest rejection at construction, not at run-time _(iee-browser-on-e2b)_

Source: PR #297 chatgpt-pr-review Round 1 F4 + Round 3 F16.

When a service depends on a content-addressed identifier (sha256 digest, immutable image alias, content hash) read from a file at construction time, the parser MUST reject explicit placeholder values (`sha256:0000...`, `1970-01-01T00:00:00Z`, etc.) before the value is handed to downstream code. Two reasons: (1) fail at construction not at runtime — a placeholder digest that passes local validation then hits the external API and fails there is harder to diagnose, costs a network round-trip, and may leak placeholder state into provider-side state; (2) decouple from environment — the rejection is a property of the value itself, not of NODE_ENV.

Companion pattern: env-flag gating for partially-wired template paths. When the rest of the system needs to construct without the placeholder-bearing path, gate that path behind a dedicated env flag (here: `E2B_BROWSER_TEMPLATE_ENABLED=true`). The flag defaults to off; CI flips it to on when the real digest publishes. Cleaner than per-path try/catch.

Detection: any `assertNotPlaceholderX` / `validateNotStub` pattern that only checks one specific stub form. Audit for missed forms: literal all-zero hashes, well-known placeholder values, any string that survives a `[a-z0-9_-]{6,}` regex without distinguishing from a real value.

Cross-link: `server/services/sandbox/e2bSandboxPure.ts::assertNotLatestTemplateVersion`, `server/services/sandbox/e2bSandbox.ts::registerSandboxProvider` (gates browserPublishedVersionPath behind `E2B_BROWSER_TEMPLATE_ENABLED`).

### [2026-05-14] Pattern — Warm-pool lease MUST thread provider identity to the executor _(iee-browser-on-e2b)_

Source: PR #297 chatgpt-pr-review Round 3 F15.

When a warm-pool service hands out a pre-provisioned resource, the executor MUST adopt the provider-side identity (sandbox id, container id, connection id) — not create a fresh one and treat the warm-pool row as accounting metadata. Otherwise the warm-pool row becomes a phantom (created, leased, terminated) while every actual execution starts cold. Symptoms: cost ledger shows warm-pool charges but execution latency never improves; warm sessions accumulate in 'available' state but rotation reveals nothing was reused.

The thread-through pattern: warm-pool `checkout()` returns both bookkeeping id (`warmSessionId`) AND provider id (`sandboxId`); dispatcher derives `leasedProviderSandboxId` from the decision when warm_leased; the executor input carries an optional `leasedProviderSandboxId?: string`; the provider's `runTask` adopts the leased id via an if/else around `createSandbox`.

The fix is small but easy to miss: a code review that focuses only on "is the warm-pool row tracked?" misses the question "is the warm-pool sandbox actually executed?" Always ask both. A targeted unit test ("warm-leased dispatch does not call createSandbox") is the cheapest reviewer-facing proof.

Detection: any warm-pool / connection-pool / session-pool service whose `checkout()` returns a provider identity AND whose call site has a "createX" path. Verify the createX path is gated on absence of the leased identity.

Cross-link: `shared/types/sandbox.ts::SandboxRunTaskInput.leasedProviderSandboxId`, `server/services/sandbox/e2bSandbox.ts::E2bSandbox.runTask` (createSandbox skip path), `server/services/executionBackends/_ieeShared.ts::ieeDispatchBrowser`.

### [2026-05-14] Pattern — `.strict()` Zod schemas for admin-controlled fields _(iee-browser-on-e2b)_

Source: PR #297 chatgpt-pr-review Round 2 F13.

When a body schema accepts non-admin patches but the underlying table has an admin-only field (here: `rolloutApproved`), the non-admin schema MUST use `.strict()` so unknown keys return a 400, not silently strip. Silent-strip is dangerous because the client receives a 200 with `rolloutApproved` in their patch body absent from the response — they think it took effect when it didn't. The dedicated admin route is the only path that can mutate the admin-only field; `.strict()` is the receipt that non-admin callers got the right error.

Companion: the matching test must assert the rejection shape. Zod's strict-mode error uses `code: 'unrecognized_keys'` with the offending key list in `keys: string[]`. A test that only asserts `result.success === false` is shallow — also assert `result.error.errors.some(e => e.code === 'unrecognized_keys' && e.keys.includes('forbiddenField'))`. This catches future schema author errors where `.strict()` gets removed and the schema reverts to passthrough.

Detection: any schema where a field is documented as "not accepted here — admin-only" but the schema is plain `z.object({...})` without `.strict()`. The doc comment claims the contract; `.strict()` enforces it.

Cross-link: `server/services/subaccountIeeBrowserSettingsServicePure.ts::patchBodySchema`, `server/services/__tests__/subaccountIeeBrowserSettingsServicePure.test.ts` (the unrecognized_keys assertion).

---

## [Pattern title] Three-state owner lookup must be preserved through every layer
**Date:** 2026-05-14
**Source:** finalisation-coordinator finalisation pass on PR #299 (slug: personal-assistant-v2-operator) — chatgpt-pr-review Rounds 2/3/4 (F6, F9, F12)
**Pattern:** `runTraceProjectionForViewer` treats `ownerUserId === null` as "subaccount-owned, no privacy boundary, return all events". Owner-lookup helpers return three states: `string` (owned), `null` (subaccount-owned within this org), `undefined` (run not found / cross-org). Any caller that coerces `undefined → null` via `?? null` turns a failed-or-cross-org lookup into "no privacy boundary" — a fail-open on a privacy boundary. The three-state lookup MUST be preserved end-to-end: route layer detects `undefined` and returns 404 / empty-response; service layer detects missing-row and returns an empty page. Add `eq(organisationId, opts.forUser.organisationId)` to every owner-lookup query so cross-org runIds produce the same fail-closed result as missing runs — relying on the underlying `db` handle being RLS-scoped is implicit; explicit org filter is the contract.
**Why it matters:** prevents privacy-projection fail-open when run lookup fails or crosses tenancy. Grep for `?? null` adjacent to any function whose return type includes `undefined` and whose downstream consumer has a non-restrictive `null` branch.

---

## [Pattern title] Cross-row event durability via atomic claim+emit + stale-claim TTL
**Date:** 2026-05-14
**Source:** finalisation-coordinator finalisation pass on PR #299 (slug: personal-assistant-v2-operator) — chatgpt-pr-review Rounds 2/3 (F4, F8, F10, F11)
**Pattern:** when a row-level state machine emits an external event (via `appendEvent`) as part of a transition, the emit is NOT atomic with the row UPDATE. Naive "UPDATE then emit" loses the event on crash; naive "emit then UPDATE" duplicates under concurrent writers. Per event-type, add two columns: `<type>_event_claim_at TIMESTAMP NULL` and `<type>_event_emitted_at TIMESTAMP NULL`. Flow: (1) atomic claim — `UPDATE ... SET claim_at = NOW() WHERE id = $1 AND emitted_at IS NULL AND (claim_at IS NULL OR claim_at < NOW() - $TTL) RETURNING id`; (2) if 0 rows, skip; (3) if 1 row, append the event; (4) on success, UPDATE `emitted_at = NOW()`; (5) on failure, leave columns alone — stale-claim TTL (5 min default) releases for retry. Pair with a retry pass at sweep start for state-machine-terminal rows where `emitted_at IS NULL`, with a tight WHERE clause that only matches the specific policy/status combination that owns the emit (avoid permissive fallbacks that emit synthetic events).
**Why it matters:** keeps audit-trail durable across in-process crashes without sacrificing concurrent-writer dedupe. Residual edge case (crash between successful `appendEvent` and `emitted_at` UPDATE) requires event-idempotency support for a full fix; otherwise the stale-TTL retry can produce a duplicate. Documented in migrations 0351–0356 + the `crossOwnerApprovalTimeoutSweep` job.

---

## [Pattern title] DB trigger to auto-bump status-transition timestamp
**Date:** 2026-05-14
**Source:** finalisation-coordinator finalisation pass on PR #299 (slug: personal-assistant-v2-operator) — chatgpt-pr-review Round 2 F7
**Pattern:** when a state-machine column needs a "last transitioned at" companion timestamp, document-only enforcement ("writers must set both") fails the first time a new caller forgets. A `BEFORE UPDATE` trigger gated on `NEW.<status> IS DISTINCT FROM OLD.<status>` is the only enforcement that future writers cannot bypass. The `IS DISTINCT FROM` guard is essential — without it, no-op race-claim UPDATEs (where the column is SET to its own current value as a row-lock) would incorrectly bump the timestamp. Application code can then drop manual `<column>_updated_at` writes; the trigger owns the invariant.
**Why it matters:** moves the status-transition-timestamp invariant from convention-and-hope to enforced-at-the-DB. Future writers cannot break it. The reverse-coded case (no-op row-lock UPDATEs) is handled by `IS DISTINCT FROM`.

---

## [Pattern title] Reject scope before checking shape in JSONB-key gates
**Date:** 2026-05-14
**Source:** finalisation-coordinator finalisation pass on PR #299 (slug: personal-assistant-v2-operator) — chatgpt-pr-review Round 6 T7
**Pattern:** `jsonb_typeof(col->'key')` returns SQL `NULL` for absent keys, and `NULL != 'array'` evaluates to `NULL` (not `TRUE`) — so a WHERE clause like `WHERE jsonb_typeof(col->'key') != 'array'` silently accepts rows where the key is missing entirely. Always combine key-existence (`NOT (col ? 'key')`) with the type assertion: `WHERE NOT (col ? 'key') OR jsonb_typeof(col->'key') != 'array'`. Three-valued logic in CI gates is a common silent-failure source.
**Why it matters:** prevents JSONB-shape gates from silently passing rows that are missing the required key. Pair with explicit FAIL messages that say "absent or non-array" so the cause is unambiguous when the gate finally triggers on a real violation.

## Pattern: Spec-edit grep sweep — load-bearing values (counts, canonical sources, escalation enums) leave stale references unless explicitly grepped
**Date:** 2026-05-14
**Source:** chatgpt-spec-review session on `tasks/builds/development-lifecycle-governance-upgrade/spec.md` — Round 2 surfaced 3 high/medium findings (F2-1, F2-2, F2-3) and Round 3 surfaced 2 low findings (F3-1, F3-2) that were ALL continuations of Round 1 decisions (F1 count cleanup; F4 cluster source-of-truth; F8 revise soft gate). Each was a section I missed during the original local-Edit sweep — the integrity-check pass at end-of-Round-1 caught 5 issues but missed these 5 because they appeared in sections I hadn't explicitly opened during the round.
**Pattern:** When a spec edit changes a load-bearing value — a count (e.g. "8 modified files"), a canonical source-of-truth pointer (e.g. "§7.4.2 → docs/capabilities.md"), or an escalation enum (e.g. "stop / merge / revise") — the same value almost certainly appears in multiple sections (Goals, Acceptance Criteria, Backwards-Compatibility Invariants, Deferred Items, Open Questions). Edit one location and ChatGPT/spec-reviewer Round 2+ will find every other instance. The local Edit is necessary but not sufficient — a complete `grep` of the spec for the old value is the only way to close the class in one round.
**Detection heuristic.** After any Edit that changes a count, a section reference, an enum value, or a canonical-source reference, immediately `grep` the spec for the OLD value (not the new one — old) and update every hit in the same round. Apply to all of: numeric file counts, §-number cross-references, enum-value lists, "[X | Y | Z]" recommendation/verdict triples, "must update both [A] and [B]" coupling phrases. The grep takes 5 seconds; finding it via a Round 2 ChatGPT pass costs a full round.
**Why it matters:** Round 2 of the dev-lifecycle-governance-upgrade session was 5 cleanup findings + 0 architectural findings. Round 3 was 2 cleanup findings + 0 architectural findings. Both rounds were paid in full (a paste-back, an integrity check, a commit, a push) for issues that should have been caught in Round 1's integrity check. A grep-the-old-value step folded into the Round 1 integrity check would have collapsed those rounds.
**Generalises** the existing line 919 entry (`Pattern: Close open questions explicitly in §18 when the answer lands in §18b`) — that pattern is a special case of this broader rule (§18 / §18b is one specific load-bearing-coupling instance).

---

## [Pattern title] Stripped-field upstream means downstream cannot reconstruct it
**Date:** 2026-05-14
**Source:** feature-coordinator branch review on skill-merge-consolidation-pass — pr-reviewer Round 1 Blocking 1 (rationale not threaded into consolidation prompt/parser)
**Pattern:** when a shared object has a field stripped to `undefined` for storage-shape conformance (e.g. `mergeRationale` stripped from `storedMerge` before persistence to a four-field jsonb column), DO NOT pass the stripped object into a downstream consumer that expects the full shape. The consumer cannot tell "never had it" from "stripped before passing." `JSON.stringify` will silently drop the field from prompts; equality-check parsers will reject any non-undefined response as "mutated." Always reconstruct the full-shape object from local state at the point of consumption: `const forConsumer = { ...stripped, neededField: localValue }`. Mirror it on both the prompt-build and the parser-input sides; passing different shapes to each is a separate latent bug.
**Why it matters:** the round-trip invariant for LLM prompts that ask the model to echo a field is silently broken when the field is `undefined` in the input — `JSON.stringify` drops it, the LLM sees nothing to echo, and the parser rejects every response. The bug is invisible at the call site and only surfaces in end-to-end testing. Pin with a unit test that exercises the full round-trip: build prompt -> synthetic LLM response echoing the field -> parser -> assert non-rejection.

---

## [Pattern title] Canonicalise JSON before deep-equality on LLM-echoed objects
**Date:** 2026-05-14
**Source:** finalisation-coordinator finalisation pass on PR #300 (slug: skill-merge-consolidation-pass) — chatgpt-pr-review Round 1 F4 (independently flagged by pr-reviewer Round 3 as a consider-only nit)
**Pattern:** when a parser validates that an LLM "echoed an object unchanged" via `JSON.stringify(a) !== JSON.stringify(b)`, the check is silently order-sensitive — LLMs commonly reorder JSON keys without changing semantics, and the naive stringify-compare rejects every reordering as `mutated_*`. Always canonicalise both sides before comparison: `canonicalJSON(value) = JSON.stringify(sortKeys(value))` where `sortKeys` recursively sorts object keys (arrays preserve order; primitives pass through). The fix is 10 lines of pure helper + 1 changed line. The codebase has a precedent at `server/services/skillParserServicePure.ts:240` (skill normalisation hashing) which is why we kept the helper local rather than exporting it (per CLAUDE.md §6 three-similar-lines rule, 2nd occurrence stays inlined; export at 4th).
**Why it matters:** without canonicalisation, the parser would emit a spurious `CONSOLIDATION_FAILED` with reason `mutated_definition` for any LLM response that reorders keys — a silent reliability tax with no observable bug surface (the failure looks like "LLM hallucinated"). Lock with a regression test that uses non-canonical key order and asserts acceptance. Applies to any parser that round-trips a structured payload through an LLM.

---

## [Pattern title] LLM-self-attestation is not the success signal — measure the artefact
**Date:** 2026-05-14
**Source:** finalisation-coordinator finalisation pass on PR #300 (slug: skill-merge-consolidation-pass) — dual-reviewer ACCEPT iter-1 (non-shortening outputs routed to `failed` with `failureReason='not_shortened'`)
**Pattern:** when an LLM is prompted to perform a measurable transformation (shorten, simplify, translate, normalise, deduplicate), and the model returns BOTH the transformed artefact AND a self-report of success (`declinedToConsolidate: false`, `summary: "I made it shorter"`, etc.), do NOT trust the self-report as the success classification. Compute the objective post-measure on the artefact itself (here: `postWords < preWords` against the pre-consolidation draft) and use that as the `succeeded` gate. The LLM's self-report becomes ONE input to triage, not the verdict. A non-shortening "success" is a protocol violation — the model ignored its own self-check — and routes to `failed` with a typed `failureReason` so telemetry isn't polluted by "0% shorter" or negative-reduction noise.
**Why it matters:** generalises beyond skill-merge: any pipeline where the LLM both transforms and self-rates is exposed to this. The fix is small (post-measure + reroute) but invisible without it — the failure looks like "the operator's downstream metric is wrong" rather than "the gate accepted a non-result." Locks the post-measure into the closed enum of outcomes so it's enforced by type, not by a comment.

---

## [2026-05-14] Pattern — §2 context-block staleness silently mis-classifies audit decisions
**Date:** 2026-05-14
**Source:** audit-runner pre-v1 lockdown — Module C finding 2 (audit log: `tasks/review-logs/codebase-audit-log-pre-v1-lockdown-2026-05-14T04-49-08Z.md`)
**Pattern:** the `docs/codebase-audit-framework.md` §2 AutomationOS context block is the first reference the audit-runner reads to classify "safe vs protected files" and to populate the validation table. When stack facts drift (e.g. Vitest replacing bare `tsx` runners; ESLint flat config landing as `npm run lint`), §2 silently lies to future audits — agents continue to enforce removed rules ("don't invent `npm run lint`"; "tests are bare tsx runners") and skip newly-applicable ones (Vitest test files become validation targets). The drift surfaced in the 2026-05-14 audit weeks after the Vitest migration shipped. Fix: framework v1.4 refresh + the P13 prevention proposal (`scripts/verify-framework-context-block.sh`) that parses §2 against `package.json` scripts and fails CI on drift. Anchor file: `docs/codebase-audit-framework.md:117-120`.
**Why it matters:** the framework was authored as the single source of truth for "how this codebase is built" — once it goes stale, every downstream agent decision is mis-anchored. Auto-detect via gate, do not rely on humans remembering to bump §2.

---

## [2026-05-14] Pattern — Gate baselines must expire, not just exist
**Date:** 2026-05-14
**Source:** audit-runner pre-v1 lockdown — Area 9 finding 1 / Module I critical finding (`tasks/review-logs/codebase-audit-log-pre-v1-lockdown-2026-05-14T04-49-08Z.md`)
**Pattern:** `scripts/verify-no-db-in-routes.sh` line 43 uses `check_baseline "$GUARD_ID" "$VIOLATIONS" 2` — a baseline mechanism that allows pre-existing violations to persist silently while blocking new ones. The 2026-05-14 audit found `server/routes/support/supportAgentRoutes.ts` building Drizzle queries from the `canonicalInboxes` schema table object directly in the route handler. The gate flags the import but the baseline absorbs it. Baselines are debt instruments — without an expiry mechanism, they become permanent exemptions. Fix: either set an expiry date per baseline entry OR require an ADR to add to a baseline (proposal P2). General rule: any CI gate that "passes despite X violations because they're baselined" must declare WHEN each baseline entry is expected to be cleared.
**Why it matters:** baselining is a useful debt-management tool but it disguises critical findings. A pre-v1 audit found a tenant-data-shaped layer breach that the gate had absorbed for weeks. The gate did its job (flagging the import) but the *reporting* swallowed the signal.

---

## [2026-05-14] Pattern — Custom retry loops are pass-3 even when they look right
**Date:** 2026-05-14
**Source:** audit-runner pre-v1 lockdown — Module J finding 1 (`tasks/review-logs/codebase-audit-log-pre-v1-lockdown-2026-05-14T04-49-08Z.md`)
**Pattern:** `server/services/agentBeliefService.ts:124-403` implements its own retry counter with `BELIEFS_MAX_RETRIES_PER_RUN` storm detection — bypassing `server/lib/withBackoff.ts`. The custom code reads "correct" — it's a counter, a storm cap, and a structured error log. The smell: when a canonical retry primitive exists, *every* retry pattern that doesn't use it forks the invariant set. The right move is to extend `withBackoff` to support storm caps (the genuine novel feature here) and migrate the call site — not to copy the primitive into a service module. Even when the custom path is genuinely better in isolation, parallel primitives compound until "retry behaviour" depends on which file you're in.
**Why it matters:** retry / idempotency invariants are state-shaped and untestable in isolation. A divergent retry primitive that someone tweaked once and forgot becomes a latent reliability bug that takes a production incident to surface. The audit's job is to flag the smell even when the local read looks fine.

---

## [2026-05-14] Pattern — Build-stream consolidations need a "delete the replaced" task, not just a comment
**Date:** 2026-05-14
**Source:** audit-runner pre-v1 lockdown — Area 1 finding 1 (`tasks/review-logs/codebase-audit-log-pre-v1-lockdown-2026-05-14T04-49-08Z.md`)
**Pattern:** `client/src/App.tsx:39` has a comment listing 9 superseded pages that the build-stream consolidation replaced. Only the entry point (`SkillAnalyzerPage.tsx`) was actually deleted; the rest of the subtree (Wizard, ImportStep, ProcessingStep, ResultsStep, ExecuteStep, MergeReviewBlock, RestoreBackupControl, RestoreOutcomeBanner, analyzerStatus, mergeTypes, types) survived as dead replicas — ~4,114 LOC, including 2 god files. The consolidation comment described intent but didn't carry a paired deletion task. Pattern: when a refactor replaces a page or feature, the same PR must delete the replaced subtree OR file an explicit follow-up task (`tasks/todo.md` entry, not a code comment). Prevention proposal P15 (`verify-no-orphan-react-component.sh`) would have caught this at write time.
**Why it matters:** dead replicas cost in three ways — they slow `grep`/IDE search ("which one is real?"), they confuse future authors who copy from them, and they age into hard-to-delete tangles as transitive imports drift. The consolidation comment created the illusion of cleanup. The audit caught it; the gate proposed will catch the next one.

---

## [2026-05-14] Pattern — Manual-mode chatgpt-pr-review loses prior-round context between rounds
**Date:** 2026-05-14
**Source:** finalisation pass on PR #305 (pre-v1-lockdown audit branch) — `tasks/review-logs/chatgpt-pr-review-pre-v1-lockdown-2026-05-14T07-02-09Z.md`
**Pattern:** Between rounds of a `chatgpt-pr-review` MANUAL session, ChatGPT's web UI expires prior file uploads (and may not retain prior-turn rationale unless re-pasted explicitly). On PR #305, Round 2 came back with byte-identical findings to Round 1 even though Round 1's REJECT rationale had been pasted into the chat — ChatGPT explicitly stated *"some prior uploaded files have expired on the platform side, so I reviewed the current pasted diff only, plus the prior round summary from this chat."* If you want continuity-aware rounds, paste the prior round's rationale ALONGSIDE the diff every round; otherwise expect each round to be a cold review.
**Why it matters:** the operator drives cadence on the loop, but without prior-round context ChatGPT will re-surface the same false positives every round. Two rounds with the same findings is the canonical signal that the loop has reached diminishing returns under the cold-paste workflow. Don't keep iterating expecting a different answer — either inject context, change the framing question, or close the loop.

---

## [2026-05-14] Pattern — Diff-only second-opinion reviewers produce predictable false positives on deletion-heavy + manifest-only PRs
**Date:** 2026-05-14
**Source:** finalisation pass on PR #305 (pre-v1-lockdown audit branch) — `tasks/review-logs/chatgpt-pr-review-pre-v1-lockdown-2026-05-14T07-02-09Z.md`
**Pattern:** ChatGPT (and any diff-only reviewer) only sees the diff under review, not the surrounding repo. On PR #305 it flagged the 4,114 LOC skill-analyzer deletion as a "regression" (evidence of importers lives outside the diff — gone post-deletion, by definition) and the four `package.json` dep declarations as "unrelated to visible source changes" (the static-import sites at `server/routes/users.ts:2`, `server/routes/systemUsers.ts:2`, `server/mcp/mcpServer.ts:14` are pre-existing in `main`, hence not in the diff). Both classes of finding are structural to the reviewer's input shape, not real issues. `pr-reviewer` (with full-tree grep access) is the right verification for deletion-safety and manifest-correctness questions. Reserve diff-only second-opinion reviewers for prose/semantic/UX issues where the diff is self-contained evidence.
**Why it matters:** failing to classify these as expected false positives consumes review cycles and (worse) can pressure the implementer to "fix" already-correct code. Calibrate reviewer expectations to reviewer inputs.

---

## [2026-05-14] Pattern — Audit branches bypass the formal Phase 1/2/3 entry guard via Light finalisation
**Date:** 2026-05-14
**Source:** finalisation pass on PR #305 (pre-v1-lockdown audit branch) — `tasks/review-logs/chatgpt-pr-review-pre-v1-lockdown-2026-05-14T07-02-09Z.md`
**Pattern:** `audit-runner` produces a different pipeline shape from `feature-coordinator` — it auto-commits/pushes its three-pass output but does NOT write a `tasks/builds/{slug}/handoff.md` and does NOT set `tasks/current-focus.md` to `REVIEWING`. The `finalisation-coordinator` entry guard refuses to proceed without `status: REVIEWING`, which means audit branches need a recovery path. Canonical recovery: **Light finalisation** — operator-confirmed entry-guard bypass; open PR manually, run pr-reviewer + optionally chatgpt-pr-review, run the doc-sync sweep, then apply `ready-to-merge`. Audit branches do NOT execute `finalisation-coordinator` Step 9 (MERGE_READY transition) because they were never in REVIEWING — they go straight from `NONE` to `MERGED` on squash.
**Why it matters:** without this recovery path the operator either has to manually fake a handoff (high-friction + state-confusing) or skip the formal finalisation entirely (skipping doc-sync and KNOWLEDGE extraction). Naming the recovery as "Light finalisation" makes it explicit and reusable for future audit branches.

---

### [2026-05-14] Pattern — Per-critical-path coverage tier matrix

Not every critical path needs the same coverage shape. Static gates are cheap, unit tests are mid, trajectory tests are expensive. Match the tier to the failure-mode being defended against.

**Initial matrix (refresh quarterly):**

| Critical path | Coverage tier | Rationale |
|---|---|---|
| RLS context propagation (`withOrgTx`, `getOrgScopedDb`, session var canonicalisation) | gates + unit | Failure mode is silent cross-tenant; gates catch shape, unit tests catch propagation through transformations |
| `agentRunVisibility` resolution | gates + unit | Failure mode is permission bypass; both invariant types tested |
| Idempotency-key dedup | gates + sparse unit | Failure mode is double-execution; gates assert declaration, sparse unit covers the dedup logic at one canonical site |
| Cost-breaker invocation | gates only | Failure mode is over-spend; the invariant ("breaker wraps every LLM call") is structural and gate-detectable |

Refresh this matrix every quarterly review. If a new critical path emerges and lacks a tier, the first PR that touches it picks one.

**Anchor:** 2026-05-14 pre-v1-lockdown audit, Layer 1 Area 5 coverage assessment.

---

### [2026-05-14] Pattern — Custom retry loops are pass-3 even when they look right

`agentBeliefService.ts:124-403` rolls its own `retryCount` storm-detection loop with manual jitter and exponential backoff. The implementation is sound on first read. On second read it's a partial reimplementation of `server/lib/withBackoff.ts`. Audit caught it because the gate `verify-canonical-retry.sh` (P5) flagged the `retryCount` declaration outside the canonical helper.

**Rule.** A retry-shaped construct outside `server/lib/withBackoff.ts` is pass-3 by default, never auto-merge a custom retry loop on Rule 8 ("trust this is intentional"). Either extend `withBackoff` to cover the new case, OR document why the canonical helper genuinely cannot, AND add a `guard-ignore: canonical-retry ADR-<id> <rationale>` suppression that future audits can grep.

**Anchor:** 2026-05-14 pre-v1-lockdown audit, Module J finding 1.

---

### [2026-05-14] Pattern — Handoff depth-cap rejections need structured events, not `console.warn`

`server/services/skillExecutor.ts:3992` (the `enqueueHandoff` depth-cap path) rejected handoffs deeper than 5 with a `console.warn` and a silent drop. The three-tier agent invariant is "handoffs up to 5 deep", a rejection at that boundary is a meaningful event, not a debug log. The 2026-05-14 audit found this only because the audit explicitly walked all three-tier invariants; routine log review never flags `console.warn` strings.

**Rule.** Any invariant rejection (depth cap, rate limit, idempotency conflict, RLS gate) emits a structured event via the canonical logger AND a Langfuse tag, not a `console.*` call. Gate-enforced via `verify-no-raw-console.sh` (pre-existing; P6's intended scope is a strict subset of this gate).

**Anchor:** 2026-05-14 pre-v1-lockdown audit, Module K finding 3.
## [2026-05-14] Pattern — Code-only diff exclusions in manual chatgpt-pr-review produce false-positive "missing file" findings
**Date:** 2026-05-14
**Source:** chatgpt-pr-review session on PR #304 — `tasks/review-logs/chatgpt-pr-review-claude-ai-driven-dev-lifecycle-FRqBd-2026-05-14T09-47-42Z.md`, Round 1 findings T1 + T2.
**Pattern:** Manual-mode `chatgpt-pr-review` uploads the **code-only** diff to ChatGPT (excludes `tasks/review-logs/`, `tasks/todo.md`, `docs/*spec*.md`, `docs/specs/`, `KNOWLEDGE.md` etc — these are spec-reviewer / spec-conformance scope already). ChatGPT cannot see those files but does not know they exist outside the diff, so it routinely flags them as **changelog entries with no backing file** ("the changelog claims X was updated, but X is not in this diff") or **dangling references** ("this links to anchors in `tasks/todo.md` that don't exist"). On PR #304, T1 alleged the changelog falsely claimed `docs/spec-authoring-checklist.md` and `tasks/review-logs/README.md` were updated; T2 alleged the Asset Register linked to non-existent `tasks/todo.md` anchors. Both were false positives — `git diff origin/main...HEAD --stat -- <path>` confirmed all the named files had +N lines on the branch; they were just excluded from ChatGPT's view by the manual-mode exclusion globs. Coordinator MUST verify any "missing file" / "dangling link" / "changelog claims X" finding against `git diff origin/main...HEAD -- <path>` before treating it as a real defect; if the file is in the branch diff but not the ChatGPT-visible diff, it's a scope artefact and the finding is `reject — false positive due to diff scope`.
**Why it matters:** without this check, the coordinator either auto-applies a "fix" that strips correct content or sends the operator back into the loop chasing a phantom regression. Both waste cycles; the strip-correct-content variant is actively destructive.

---

## [2026-05-14] Pattern — Round-N duplicate findings can be narrowed-case subfindings of decided general-case findings
**Date:** 2026-05-14
**Source:** chatgpt-pr-review session on PR #304 — `tasks/review-logs/chatgpt-pr-review-claude-ai-driven-dev-lifecycle-FRqBd-2026-05-14T09-47-42Z.md`, Round 2 F4 vs Round 1 F1.
**Pattern:** Coordinator's duplicate-detection step (per-round step 1a) auto-applies the prior round's decision when a later-round finding is a "substantive duplicate" — same `finding_type` + same file/area, no new evidence. The trap: a later-round finding can share the *finding type* and *file* with a previously-rejected general-case finding, but be a **localised sub-case the original rejection rationale does not cover**. On PR #304: Round 1 F1 claimed "Step 3/3a writes to `tasks/builds/<slug>/...` before Step 4 ratifies the slug" (general case, rejected because line 127 of `spec-coordinator.md` already reconciles this via a provisional-slug rule). Round 2 F4 claimed "the *ambiguous-classification* paragraph writes to `<slug>/progress.md` and the provisional-slug rule is textually *below* it" — same finding_type (`architecture`/sequencing), same file (`spec-coordinator.md`), but a narrower scope: the ambiguous branch's write happens at line 125, the provisional-slug rule lives at line 127, so the local order *is* wrong even though the general case is reconciled. The narrow case is a real defect that the broad rejection does not cover. **Rule:** before auto-rejecting a Round-N finding as a duplicate, compare the textual *scope* (not just type+file) — if the new finding names a specific paragraph/line/branch the prior rationale did NOT address, treat it as a new finding and triage it on its own merits.
**Why it matters:** silent auto-reject of narrowed-case subfindings ships real sequencing/scope defects under the guise of "we already decided this." The duplicate-detection heuristic exists to save the operator from repeated rephrased findings, not to filter out legitimately new evidence with overlapping classification.

---

## [2026-05-14] Pattern — Manual-mode ChatGPT has no session memory across rounds — same diff-misread can recur indefinitely
**Date:** 2026-05-14
**Source:** finalisation-coordinator chatgpt-pr-review on PR #307 (audit-prevention-gates-2026-05-14) — `tasks/review-logs/chatgpt-pr-review-audit-prevention-gates-2026-05-14-2026-05-14T12-23-57Z.md`, Round 1 T3 → Round 2 T4 → Round 3 T6, all the SAME finding.
**Pattern:** ChatGPT in manual-mode chatgpt-pr-review uses no shared session state between rounds — each upload is processed against a fresh chat. If a finding was rejected as a diff-only-reviewer false positive in Round N (e.g. "this PR claims `verify-org-id-source.sh` is wired but the diff doesn't show the wiring" — but the wiring lives in `main` at line 65 of `run-all-gates.sh` from a 2026-04-04 commit), the same finding will recur verbatim in Round N+1, N+2, etc. until something in the diff itself disproves it. Round-N+1's prompt cannot teach ChatGPT what Round-N learned because it doesn't carry the Round-N transcript. PR #307 saw T3/T4/T6 — three rounds, three identical misreads, rejection rationale ("verified via `git blame`, wired 2026-04-04 in commit 89a818cc") had to be re-emitted each time.
**Rule.** When a finding is rejected as a diff-misread once, add a `## Pre-triage verification` block to the session log with the exact verification command (`git blame -L X,Y file` / `grep -n term file` / etc.) and its output. On Round N+1+ recurrences, auto-reject as duplicate per playbook step 1a — do NOT re-engage the substance, do NOT re-verify, do NOT escalate to operator. The operator made the call once; ChatGPT will keep raising it; the coordinator's job is to absorb the noise. A third occurrence of the same misread is the moment to commit to "ignore class of finding for remainder of this review" rather than triple-handling it.
**Why it matters:** at one repeat the cost is small (a re-verification + log entry). At three repeats (PR #307 actually got there) the cost is two extra rounds the operator paid for, plus context burn on a defect that doesn't exist. Calibrate engagement to information yield: same finding + same rationale = zero new information regardless of round number.

---

## [2026-05-15] Pattern — Modal stays mounted on `return null` — local state leaks between opens

**Date:** 2026-05-15
**Source:** chatgpt-pr-review R1 F1 on PR #313 (page-splits build) — `CreateClientModal.tsx` post-split.
**Pattern:** A component that renders `if (!open) return null` stays **mounted** in the React tree — only its DOM output is removed. State variables (`useState`) persist across close/reopen cycles. Pre-split, Layout.tsx unmounted modals by conditional JSX; post-split the extracted components remain in the JSX tree unconditionally and gate on `return null` internally. Without an explicit reset, stale values (error messages, half-filled fields, loading flags) reappear on the next open. Fix: add a `useEffect` on the `open` prop that resets all owned state when `open` becomes `true`:
```ts
useEffect(() => {
  if (open) { setState1(''); setState2(''); setErrorState(''); }
}, [open]);
```
**Why it matters:** the bug is invisible in initial testing (happy path always opens fresh) and only surfaces after a failed create or a close-without-submit. Extraction is the trigger — if the original host unmounted the component, the bug was invisible; once extracted and kept mounted, it's guaranteed.
**Detection:** grep for extracted modal components that use `if (!open) return null` AND hold `useState` — every one is a candidate unless it has an `open`-effect reset.

---

## [2026-05-15] Pattern — prevSeededRef pattern: distinguish untouched seed from user override in a modal

**Date:** 2026-05-15
**Source:** chatgpt-pr-review R1 F3 / R2 F4 on PR #313 (page-splits build) — `NewBriefModal.tsx`.
**Pattern:** When a modal seeds dropdown state from external identity (e.g. `activeOrgId`) on open, and must sync when identity changes while the modal is open, but must NOT clobber a value the user manually changed — track the last-seeded IDs in a `useRef`. On each effect run, compare the current override to the ref before updating:
```ts
const prevSeededRef = useRef<{ orgId: string | null } | null>(null);
useEffect(() => {
  // ...
  const prev = prevSeededRef.current;
  prevSeededRef.current = { orgId: identity.activeOrgId };
  setOverride(current => {
    if (opening) return nextValue;          // initial seed — always take
    if (current === null) return nextValue; // null = data-race seed (wasn't loaded yet)
    if (current.id === prev?.orgId) return nextValue; // untouched seed — re-sync
    return current;                         // user changed it — leave alone
  });
}, [open, identity.activeOrgId, ...]);
```
The functional `setState` form is required — it receives the actual current state at dispatch time, avoiding stale-closure bugs when the effect fires with multiple dep changes at once.
**Why it matters:** without `prevSeededRef`, any identity-change-while-open overwrites the user's manual selection. Without functional setState, the comparison uses the captured closure value which may be one render stale.

---

## [2026-05-15] Pattern — Page-split slim shell: original file becomes ~150-line orchestrator; sub-files live in a named sub-directory

**Date:** 2026-05-15
**Source:** PR #313 page-splits build — 16 client-side page-level files split along tab / region / atom seams.
**Pattern:** When splitting a monolithic page component, the original file (e.g. `AdminSubaccountDetailPage.tsx`) becomes a **slim shell** (~150-200 lines) that imports and dispatches to sub-components. Sub-files live in a co-located directory named after the page domain (e.g. `client/src/pages/admin-subaccount-detail/`). The split seam hierarchy:
- **Tab**: full-width content area that maps 1:1 to a tab in the page's tab bar (`OnboardingTab.tsx`, `EnginesTab.tsx`, etc.)
- **Region**: logical sub-section within a tab (not a tab itself — e.g. `HeaderRegion.tsx`, `StatsRegion.tsx`)
- **Atom**: the smallest extractable display unit within a region (e.g. `StatusBadge.tsx`, `CostPill.tsx`)

Types shared between the shell and sub-components live in `types.ts` at the sub-directory level. The shell's ActiveTab union and TAB_LABELS record live in that `types.ts`, not in the shell itself.

Tab additions that land on main while the branch is in flight must be **manually grafted** after the S2 merge: take `--ours` for the slim shell (preserving the split structure), then add the new tab's import + permission guard + conditional push + render block.
**Why it matters:** without this pattern documented, a future reader of a slim shell will not know where the tab implementation lives (no inline code), and may try to add a tab to the shell directly rather than extracting to the sub-directory.

---

## [2026-05-14] Pattern — `verify-rls-contract-compliance.sh` allowlists `server/services/` and lets raw-`db` queries on tenant tables slip through
**Date:** 2026-05-14
**Source:** Track A audit (RLS + agent-execution), F3 / F4 / F7 — `tasks/review-logs/codebase-audit-log-rls-agent-exec-2026-05-14T13-14-38Z.md`
**Pattern:** The "no raw db outside services" gate (`scripts/verify-rls-contract-compliance.sh`) treats `server/services/` as the trusted layer that may import `db` from `../db/index.js`. But the rule that makes RLS effective is finer-grained than that: services must obtain their tx handle via `getOrgScopedDb()` so the query runs inside the ALS `withOrgTx` block with `app.organisation_id` set. 231 of 526 service files import `db`; only 85 import `getOrgScopedDb`. Many of the 231 do `db.select(...)` directly on RLS-protected tables (e.g. `permissionSetService.listForOrg`, `agentExecutionService.executeRun`) — those queries run on the unscoped pool, missing the GUC. App-layer `where(eq(table.organisationId, orgId))` is the only defence; RLS-as-defence-in-depth depends on whether the prod DB role enforces RLS (TI-008 tracks the dev gap). The gate as written gives a false sense of coverage.
**Rule:** Treat the directory-level allowlist as a tier-1 trust shortcut, not a correctness guarantee. When auditing a service that touches a tenant-scoped table, grep for `getOrgScopedDb` inside the function — if absent and the table is in `RLS_PROTECTED_TABLES`, treat it as a Module I finding regardless of what `verify-rls-contract-compliance.sh` reports. The complementary gate `verify-with-org-tx-or-scoped-db.sh` exists but does not yet flag this pattern at the service tier; widening it is logged as P2.
**Why it matters:** the three-layer fail-closed posture is the highest-blast-radius defence in this codebase. A gate that quietly accepts 231 service files importing raw `db` undermines the posture's "Layer 1" claim. Catching it requires looking past gate output, not at gate output.

## [2026-05-14] Pattern — Mixed scoped-vs-raw DB posture inside a single service file is the signal of an incomplete migration, not a stable design
**Date:** 2026-05-14
**Source:** Track A audit, F4 — `server/services/agentExecutionService.ts`
**Pattern:** In a 2,807-LOC service file, the entrypoint `executeRun` (line 457) hits `organisations`, `subaccounts`, `agent_runs`, `subaccountAgents` on raw `db`. The peer entrypoint `resumeAgentRun` (line 2442) opens with `const tx = getOrgScopedDb('agentExecutionService.resumeAgentRun')` and uses `tx.*` throughout. Both functions are tenant-scoped; the scoping discipline differs. The likely explanation is that `resumeAgentRun` is newer code written after the org-scoped-db convention was introduced, while `executeRun` predates it and the migration was never finished. Mixed posture within a single file is rarely intentional — it almost always means the migration is incomplete.
**Rule:** When a service file shows mixed `db` / `getOrgScopedDb` usage, treat the unscoped half as in-flight technical debt, not as a design choice. File an audit finding to migrate the unscoped paths to match the scoped paths. Pair with an architecture.md note (P5) so the next maintainer doesn't replicate the pre-convention pattern by example.
**Why it matters:** mixed posture is a teaching surface for future contributors — a new function in `agentExecutionService.ts` is as likely to use raw `db` as `getOrgScopedDb` depending on which existing function the author copies from. Convention compounds when consistently applied; mixed posture self-perpetuates.

## [2026-05-14] Pattern — God-files persist after a "split" commit — the *Pure.ts companion landed; the main file did not shrink
**Date:** 2026-05-14
**Source:** Track A audit, F6 — `server/services/skillExecutor.ts` 6,133 LOC, `agentExecutionService.ts` 2,807 LOC, `agentExecutionLoop.ts` 1,415 LOC
**Pattern:** The operator brief said "four god-file splits (skillExecutor, workflowEngine, skillAnalyzerServicePure, agentExecutionService) have since landed on main". Verified: the `*Pure.ts` companions exist (`skillExecutorPure.ts` 99 LOC, `skillExecutorDelegationPure.ts` 171 LOC, `agentExecutionServicePure.ts` 608 LOC). Verified: the original files are still huge (`skillExecutor.ts` 4× soft cap and 2.4× hard cap). A "split" that extracts pure helpers but leaves the main file at 6k LOC has not reduced the maintenance burden of the file — it has only created a parallel surface for unit tests. The framework Area 10 caps were violated before the split and remain violated after.
**Rule:** Treat "split" as a misleading term. The audit-relevant question is "is the original file at or below its hard cap?" — not "was a `*Pure.ts` companion added?". Each split commit should land alongside a `wc -l` assertion in the commit body, e.g. "skillExecutor.ts: 6,133 → 1,400 LOC". Add a paired gate (`verify-loc-cap.sh` already exists; confirm it fires on this codebase). Frame splits as a deletion-from-original operation, not as an addition-of-companion operation.
**Why it matters:** god-files are a productivity tax — every contributor has to load the full file's context to safely edit any part of it. A claimed split that doesn't shrink the original is the worst case: it suggests a fix has happened (so reviewers don't push for further work) without actually delivering the benefit.

## [2026-05-14] Pattern — FK-scoped tenant data tables can ship with zero Postgres-level isolation if no one writes a CREATE POLICY
**Date:** 2026-05-14
**Source:** Track A2 audit (workflowEngine split, post-refactor), WF1 — `tasks/review-logs/codebase-audit-log-workflow-engine-2026-05-14T16-30-31Z.md`
**Pattern:** Five workflow tables — `workflow_step_runs`, `workflow_step_reviews`, `workflow_studio_sessions`, `workflow_run_event_sequences`, `flow_step_outputs` — hold tenant-private payloads (LLM input/output JSON, HITL decision reasons, workflow-studio chat sessions, per-step agent outputs) but have NO `CREATE POLICY` statement in any migration. They reference RLS-protected parents (`workflow_runs`, `flow_runs`) via FK, but no Postgres-level isolation propagates through that FK without an explicit EXISTS-based policy. The gate `verify-rls-protected-tables.sh` did not flag the gap because it only inspects tables with a literal `organisation_id` column in their `CREATE TABLE` — these are FK-only. Concrete evidence of the bypass: `server/services/workflowEngineService.ts:151-152` queries `workflow_step_runs` by id alone with no org filter: `db.select({status}).from(workflowStepRuns).where(eq(workflowStepRuns.id, stepRunId))`. Currently safe because the surrounding flow has already validated org, but the DB layer offers zero defence-in-depth.
**Rule.** When a new table holds tenant-private data and is FK-scoped (no `organisation_id` column of its own), the check is NOT "does the parent have RLS" but "does THIS table have its own CREATE POLICY". Two valid patterns: (a) its own `organisation_id` column + standard RLS policy, OR (b) an EXISTS-based policy joining through the FK to the parent's `organisation_id`. See `connector_location_tokens`, `document_bundle_members`, `subaccount_baseline_metrics` in `scripts/rls-not-applicable-allowlist.txt` for examples of (b). Audit-time check: `grep -E "<table_name>" migrations/*.sql | grep -iE "POLICY|ENABLE ROW|FORCE ROW"` — if the grep is empty, the table has no RLS.
**Why it matters:** "the parent has RLS so the child is fine" is one of the most common reasoning errors in multi-tenant DB design. Postgres RLS does not transit through FK references unless you write a policy that does the JOIN explicitly. Five real production tables shipping with this gap proves the assumption is easy to make.

## [2026-05-14] Pattern — pg-boss worker `resolveOrgContext: () => null` is a footgun if the handler then does scoped work without re-opening withOrgTx
**Date:** 2026-05-14
**Source:** Track A2 audit, WF4 — `server/services/workflowEngineService.ts:3897`
**Pattern:** `createWorker` lets a handler opt out of the default org-context resolver by returning null. This is the right escape hatch when the job payload genuinely has no tenant context (cross-org sweeps, admin maintenance jobs). But it's a footgun when used for "the org lives in the row, not the payload" — because the handler then does dozens of DB operations without ever re-opening a tenant-scoped tx. The workflow tick worker pays this cost: after `db.select().from(workflowRuns).where(eq(workflowRuns.id, runId))` finds the run + its org, the rest of `tick()` (30+ DB calls across dispatchStep, completeStepRun, failStepRunInternal, etc.) runs on the unscoped pool. The `app.organisation_id` GUC is never set.
**Rule.** A pg-boss worker that calls `resolveOrgContext: () => null` because it needs to look up the org from the row MUST re-open a `withOrgTx` block after that lookup. Pattern: `(1) raw-db lookup to find the run; (2) call withOrgTx({tx, organisationId: run.organisationId, ...}, async () => { /* rest of handler uses getOrgScopedDb */ })`. The opt-out is for the FIRST query only, not for the entire handler body.
**Why it matters:** `resolveOrgContext: () => null` looks like a small escape-hatch but its implications cascade through the entire handler. The longer the handler, the more cross-tenant work runs in a context Postgres can't validate. workflow tick is 30+ DB calls — a code path with this much surface area should never run un-scoped after the first lookup.

## [2026-05-14] Pattern — A 'split' commit can land two god-files instead of one — the Pure module can end up bigger than its impure shell
**Date:** 2026-05-14
**Source:** Track A3 audit (skillAnalyzerServicePure split), SA2 — `tasks/review-logs/codebase-audit-log-skill-analyzer-2026-05-14T16-53-39Z.md`
**Pattern:** The skillAnalyzerServicePure "split" produced `skillAnalyzerService.ts` at 2,642 LOC and `skillAnalyzerServicePure.ts` at **3,727 LOC** — the Pure module is 1.4× the impure shell. Total 6,369 LOC across the split, larger than skillExecutor's pre-split state (6,133 LOC). The Pure module being bigger than its shell is the inverse of the usual split shape (Pure = small focused helpers); here the Pure module is itself a parallel god-file.
**Rule.** Treat "split" as a misleading term whenever BOTH halves of a split are over the framework Area 10 hard cap. The audit-relevant check is "is each file at or below its hard cap after the split?" — not "did a `*Pure.ts` companion get created?". Each split commit should land with a `wc -l` assertion in the commit body showing both files' sizes; if the Pure module is over the cap, plan its decomposition before claiming the work done.
**Detection:** `wc -l server/services/<name>.ts server/services/<name>Pure.ts` after every split PR. If either file exceeds 2,500 LOC (services hard cap), the split is incomplete.
**Why it matters:** the productivity tax of a god-file applies to the Pure module just as much as the impure shell — a 3,727-LOC Pure module is just as hard to navigate as a 3,727-LOC service. Worse: the "split" framing suggests the problem is solved, so future contributors don't push for further decomposition.

## [2026-05-15] Pattern — FK-scoped tenant data is NOT automatically RLS-protected
**Date:** 2026-05-15
**Source:** Track A2 audit, WF1 — `tasks/review-logs/codebase-audit-log-workflow-engine-2026-05-14T16-30-31Z.md` (build: split-workflow-engine)
**Pattern:** Five workflow tables (`workflow_step_runs`, `workflow_step_reviews`, `workflow_studio_sessions`, `workflow_run_event_sequences`, `flow_step_outputs`) held agent outputs, HITL decisions, workflow studio chat sessions, and event-sequence counters — all tenant-private — with zero Postgres-level isolation. Each table references a tenant-scoped parent (e.g. `workflow_runs.id`) via FK, but FK constraints are not RLS policies. Postgres does NOT propagate a parent table's RLS policy to child tables that reference it; each table needs its own `CREATE POLICY`. The gate `verify-rls-protected-tables.sh` missed this because it inspects only tables with an `organisation_id` column — FK-only tables are invisible to it.
**Rule.** Any table holding tenant-private data and referencing a tenant-scoped parent via FK MUST carry its own `CREATE POLICY` using an EXISTS-based predicate that joins through the parent FK chain to `organisations.id`. FK + parent RLS alone is not Postgres-level isolation. Detection: `grep -rn "pgTable\b" server/db/schema/ | xargs grep -L "organisation_id" | xargs ... ` cross-referenced against `migrations/*.sql | grep "CREATE POLICY"` — tables absent from policy set and absent from the explicit allowlist are gaps.
**Planned fix pattern (targeted for the WF1 follow-up PR; RLS migration not landed in this build):** `CREATE POLICY <table>_rls_policy ON <table> USING (current_setting('app.organisation_id', true) IS NOT NULL AND current_setting('app.organisation_id', true) <> '' AND EXISTS (SELECT 1 FROM <parent> p WHERE p.id = <table>.<fk_col> AND p.organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid))`. Every `::uuid` cast wraps the GUC in `NULLIF(...)` to prevent the cast from throwing on empty string (Postgres CAN re-order AND clauses despite short-circuit expectations).
**Why it matters:** without their own policies, these FK-only tables are accessible to any role with BYPASSRLS or to any handler running without a GUC — including the workflow tick worker (which uses `resolveOrgContext: () => null` and thus runs without `app.organisation_id` set).

## [2026-05-14] Pattern — `boss.work(queue, ...)` outside `createWorker` bypasses canonical org-context plumbing
**Date:** 2026-05-14
**Source:** Track A3 audit, SA4 — `server/index.ts:691`
**Pattern:** `createWorker` is the project's canonical pg-boss handler wrapper. It does three load-bearing things: (1) reads `organisationId` from the job payload via `defaultResolveOrgContext`, (2) opens a Drizzle transaction with `app.organisation_id` GUC set, (3) calls `withOrgTx` so downstream services can `getOrgScopedDb()` and get the scoped tx. Bare `boss.work(queue, handler)` does NONE of this. The skill-analyzer worker at `server/index.ts:691` uses bare `boss.work`, so `runSkillAnalyzerJobWithIncidentEmission(jobId)` and downstream `processSkillAnalyzerJob(jobId)` run entirely on the unscoped pool. No GUC. No org-scoped tx. Defence is the app-layer `where(eq(skillAnalyzerJobs.id, jobId))` filter only. Cross-reference: Track A2 WF4 found the workflow tick worker has the same anti-pattern via `resolveOrgContext: () => null` (different bypass mechanism — opting out within `createWorker` rather than skipping `createWorker` entirely).
**Rule.** Every pg-boss queue handler MUST be registered via `createWorker(...)`. Bare `boss.work(...)` is reserved for: (a) the wrapper itself (server/lib/createWorker.ts), (b) boot-time DLQ wiring (where the handler does no DB work), (c) intentionally cross-org sweep handlers — and even those should use `createWorker({ resolveOrgContext: () => null })` so the opt-out is visible to grep, then re-open `withOrgTx` once the row's org is loaded (Track A2 WF4 lesson).
**Detection:** `grep -rnE "boss\.work\b" server/ --include="*.ts" | grep -v "server/lib/createWorker.ts" | grep -v "server/lib/__tests__/"`. Every hit is a candidate.
**Why it matters:** queue handlers are the easiest place for tenant-context bugs to sneak in: the payload schema is usually small, no HTTP middleware runs, the handler often spans many service calls. `createWorker` is the single chokepoint that gets this right; bypassing it makes every DB call in the handler an opportunity to leak.

## [2026-05-15] Pattern — `verify-no-db-in-routes.sh` regex does NOT catch schema-table imports; only literal `db` symbol imports
**Date:** 2026-05-15
**Source:** fix-route-db-support-agent build (chunk-0 caller sweep), Q2 plan-gate
**Pattern:** The gate at `scripts/verify-no-db-in-routes.sh` uses the regex `import.*db.*from.*['"].*\/db`. This matches `import { db } from '../../db/db.js'` (the literal `db` object) but NOT `import { canonicalInboxes } from '../../db/schema/index.js'` — because the string between `import` and `from` is `{ canonicalInboxes }`, which does not contain "db". A route that imports only schema table objects (and calls Drizzle query builder methods like `db.select().from(canonicalInboxes)`) bypasses the gate entirely. `supportAgentRoutes.ts` had this breach for its entire existence; the gate showed 0 violations every CI run.
**Rule.** When reviewing route files for the "no direct DB access" invariant, grep for BOTH the literal `db` symbol AND schema-table imports from `'../../db/schema'`. The gate catches the former; code review and this rule are the only defence against the latter. A future tightening of the gate's regex should cover `from '.*\/db/schema'` as a separate alternation. Deferred to a separate `audit-prevention-gates-v2` ticket per plan Q2.
**Why it matters:** "the gate passes" is not the same as "the route is clean". A route can bypass the architectural invariant with schema imports alone.

## [2026-05-15] Pattern — Route handlers under a subaccount-scoped mount MUST build their principal via `resolveSubaccount`, even when the handler doesn't explicitly read `:subaccountId` from `req.params`
**Date:** 2026-05-15
**Source:** fix-route-db-support-agent build, Decision 4 and Chunk 2
**Pattern:** `supportAgentRoutes.ts` was mounted at `/api/subaccounts/:subaccountId/support` (server/index.ts:512) but its `makePrincipal` function hardcoded `subaccountId: null`. This had two consequences: (a) `listInboxes` returned ALL org-scoped inboxes instead of only the subaccount's inboxes — a privilege-widening bug; (b) `updateAgentConfig`'s subaccount-ownership guard (which checks `existingRow.subaccountId !== principalCtx.subaccountId`) was always bypassed because `principalCtx.subaccountId` was `null` and the guard is a no-op when the principal is org-scoped.
**Rule.** When a route is mounted at a path containing `:subaccountId`, its `makePrincipal` function MUST call `resolveSubaccount(req.params.subaccountId, req.orgId!)` and use `subaccount.id` as the principal's `subaccountId`. The mount path's `:subaccountId` is the source of truth — not whether the route's individual handler bodies explicitly read from `req.params`. Check `server/routes/support/supportInboxesRoutes.ts` for the canonical pattern: `Router({ mergeParams: true })` + async `makePrincipal` that calls `resolveSubaccount`.
**Why it matters:** `subaccountId: null` in a subaccount-scoped mount silently widens the result set to the entire org and defeats all subaccount-ownership guards downstream. The bug is invisible from a test that only checks HTTP response shape; it requires reviewing the principal construction logic specifically.
## [2026-05-15] Pattern — URL paths diverge from internal naming over time (UK vs US spelling, etc.)
**Date:** 2026-05-15
**Source:** Track A3 audit, R6 — `tasks/review-logs/codebase-audit-log-skill-analyzer-2026-05-14T16-53-39Z.md`
**Pattern:** Internal TypeScript identifiers and URL path segments can diverge over time as naming conventions shift. A common case is UK vs US English: `organisationId` in code but `organization` (US) embedded in older API paths, or vice versa. Once a URL path ships, it is a breaking API change to rename it — but the code identifiers don't carry that constraint. The result is a permanent split between what the URL looks like (`/api/organizations/...`) and what the code calls it (`organisationId`). This affects both developer mental models (which spelling do I search for?) and audit tooling (grep on `organisation` misses the US path, grep on `organization` misses the TS code).
**Rule.** When flagging a naming inconsistency during a code review: (a) if both are internal-only (TypeScript identifiers, DB column names, JS keys), prefer the canonical project spelling and change it; (b) if one end is a shipped API URL path, flag it as a tech-debt item and rename via a deprecation cycle (old URL 301s to new). Never silently accept the inconsistency — document it in the PR body so the next reviewer understands it is a known divergence, not an error.
**Why it matters:** naming divergence compounds. The next engineer adds new code matching whichever spelling they search first, widening the split. Documenting it explicitly keeps the divergence visible and scoped.

## [2026-05-15] Pattern — Audit log file references become stale after splits — verify line numbers post-PR before classifying as regressions
**Date:** 2026-05-15
**Source:** Track A3 audit review, NEEDS-DISCUSSION triage — `tasks/review-logs/codebase-audit-log-skill-analyzer-2026-05-14T16-53-39Z.md`
**Pattern:** Audit logs capture findings as `<file>:<line>:<description>`. When a subsequent PR splits the referenced file, the line numbers shift — sometimes drastically. A finding at `skillAnalyzerService.ts:1420` may become `skillAnalyzerServicePure.ts:380` after extraction, making the audit log entry look like a regression ("the file doesn't even exist") when the code was actually moved and the real concern is whether it was addressed. Post-split audit reviews that compare new line numbers against old audit log entries will misclassify moved-but-unaddressed code as "fixed" (no longer at the referenced location) or classify moved code as a new finding.
**Rule.** When resuming an audit after a split PR: (1) re-run the detection pass for all findings in the affected area before triaging — never triage from stale line-number references; (2) for NEEDS-DISCUSSION items, note explicitly in the triage whether the cited line is still at the same location or has moved; (3) audit log entries should reference git commit SHAs alongside file paths when the audit spans multiple PRs to pin the file state.
**Why it matters:** the purpose of an audit log is to track whether findings are addressed, not just that they were found. Stale line numbers cause addressed findings to appear unresolved and vice versa — the log loses its value as a tracking artifact.

---

## [2026-05-15] Pattern — Gate scripts that glob `*.sql` must exclude `*.down.sql`
**Date:** 2026-05-15
**Source:** chatgpt-pr-review R1 F1 on PR #317 (wave-1-cleanup-prevention) — `verify-fk-only-tenant-tables.sh`.
**Pattern:** Migration gate scripts that enumerate SQL files via `find ... -name '*.sql'` or `glob migrations/*.sql` inadvertently include `*.down.sql` rollback files. Down migrations can contain `CREATE POLICY` statements (restoring a dropped policy) or `CREATE TABLE` statements (restoring a dropped table), which will give a false-positive signal to both the coverage check ("policy exists") and the discovery scan ("table exists"). The gate `verify-fk-only-tenant-tables.sh` shipped this bug on first merge — the CREATE TABLE walk and the CREATE POLICY grep both used `*.sql` globs, so a policy in a down migration would count as coverage.
**Rule.** Every gate that scans migrations for schema-presence signals (CREATE TABLE, CREATE POLICY, ALTER TABLE, CREATE INDEX, ENABLE ROW LEVEL SECURITY) MUST exclude down migrations. Canonical fix: `find "$MIGRATIONS_DIR" -name '*.sql' ! -name '*.down.sql'`. For glob-based greps: `grep ... migrations/*.sql` → `find ... ! -name '*.down.sql' -print0 | xargs -0 grep ...`. The summary file-count passed to `emit_summary` should also exclude down migrations for an accurate "N files scanned" metric.
**Why it matters:** a policy found in a down migration gives false confidence that a table is protected — the down migration exists to REMOVE the policy on rollback, not assert it. A scan that counts this as coverage would silently miss a table with no active up-migration policy.

---

## [2026-05-15] Pattern — Drizzle ORM uses two distinct REFERENCES forms; gate regexes must handle both
**Date:** 2026-05-15
**Source:** chatgpt-pr-review R1 F2 + R2 follow-up on PR #317 (wave-1-cleanup-prevention) — `verify-fk-only-tenant-tables.sh`.
**Pattern:** Drizzle ORM generates FK references in two distinct forms depending on migration statement type:
- **ALTER TABLE FK constraints** (e.g. `0000_wandering_firedrake.sql:139`): `REFERENCES "public"."executions"("id")` — schema-qualified, double-quoted.
- **Inline column definitions** (e.g. `0013_phase_two_scheduled_workforce.sql:49`): `REFERENCES "scheduled_tasks"("id")` — no schema prefix, single-quoted.
A regex `/REFERENCES[[:space:]]+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/` captures `public` (not `executions`) for the ALTER TABLE form, silently missing every FK expressed via schema-qualified form. The fix is a two-stage match: try the schema-qualified form `"schema"."table"` first (capturing the part after the dot), then fall back to the plain `"table"` form. Similarly, `CREATE POLICY ... ON "public"."table"` requires the policy grep to handle an optional schema prefix before the table name.
**Rule.** Any gate regex that matches table names in SQL must test against both forms. Canonical two-stage awk match:
```awk
if (match($0, /REFERENCES[[:space:]]+"?[a-zA-Z_][a-zA-Z0-9_]*"?\."?([a-zA-Z_][a-zA-Z0-9_]*)/, fkm)) {
  parent = fkm[1]  # schema-qualified: capture after the dot
} else if (match($0, /REFERENCES[[:space:]]+"?([a-zA-Z_][a-zA-Z0-9_]*)/, fkm)) {
  parent = fkm[1]  # plain form
}
```
Canonical policy grep pattern variable: `policy_table_pattern="(\"?[a-zA-Z_][a-zA-Z0-9_]*\"?\.)?\"?${table}\"?"`.
**Why it matters:** Drizzle's initial migration file (`0000_wandering_firedrake.sql`) uses the ALTER TABLE form for ALL FK constraints. A scanner that only handles the plain form will miss every FK in the entire initial migration — zero coverage on the most FK-dense file in the repo.

---

## [2026-05-15] Pattern — Use org-only read for PATCH merge-read; let the write layer enforce subaccount scope
**Date:** 2026-05-15
**Source:** finalisation-coordinator PR #318 (fix-route-db-support-agent) — chatgpt-pr-review Round 1 F1.
**Pattern:** When a PATCH route reads an existing record to extract current values before merging a patch, it should load by org only (no subaccount predicate). If the read uses a subaccount-scoped helper (e.g. `getInbox(id, principal)` which filters by `subaccountId`), a sibling-subaccount inbox returns 404 at the read step before `updateAgentConfig` can reach its write-scope check and throw the planned 403 `support.inbox.scope_mismatch`. Fix: add a separate org-only read helper (e.g. `getInboxForOrg(id, orgId)`) for the merge-read step; the write helper enforces subaccount scope internally.
**Why it matters:** Silent 404-for-sibling-access may be defensible security-wise but breaks the approved error-code contract and is hard to catch with structural tests. The pattern applies to any service that has both a scoped-read and an org-level read use case.

---

## [2026-05-15] Pattern — sub-module import paths must reflect actual directory depth, not original file location
**Date:** 2026-05-15
**Source:** build: split-workflow-engine — 70+ TypeScript TS2307 cascade errors after structural split.
**Pattern:** When a builder agent extracts a module from `server/services/bigService.ts` into `server/services/newTree/subModule.ts`, it may copy relative imports verbatim from the source file. Those imports were correct for `server/services/` depth but are wrong at `server/services/newTree/` depth — every path needs one extra `../` level. For modules extracted two levels deep (`server/services/newTree/subDir/leaf.ts`), paths need two extra levels. The TypeScript error (TS2307 "Cannot find module") cascades: all symbols from the broken import become `any`, which then triggers TS7006 ("implicitly has 'any' type") and TS18046 ("is of type 'unknown'") on every downstream usage — 70+ errors tracing to ~15 wrong import paths.
**Rule.** After any structural split that moves files to a deeper directory, audit every external import in every extracted file and verify the `../` depth matches the file's new location (not its origin). Canonical test: for a file at `server/services/A/B/leaf.ts` wanting `server/db/index.ts`, count: `server/services/A/B/leaf.ts` → up 3 → `server/` → down to `db/index.ts` = `../../../db/index.js`.
**Why it matters:** TS2307 errors from wrong paths cause cascading `any`-type pollution that inflates error count by 5-10× and obscures the true root cause. The fix is always the same (add `../` levels) but the inflated error list wastes diagnostic time if the root cause isn't identified first.

---

## [2026-05-15] Pattern — FORCE RLS on FK-only tenant tables uses a parent-EXISTS policy (no direct organisation_id column)
**Date:** 2026-05-15
**Source:** build: split-skill-analyzer (PR #320) — migration 0359 (`0359_skill_analyzer_results_rls.sql`).
**Pattern:** Some tables (e.g. `skill_analyzer_results`) hold their org FK indirectly — via a parent `job_id` that points to `skill_analyzer_jobs.organisation_id`, with no direct `organisation_id` column of their own. The canonical FORCE RLS policy for such tables uses a correlated EXISTS subquery:
```sql
CREATE POLICY "org_isolation" ON skill_analyzer_results
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM skill_analyzer_jobs
      WHERE skill_analyzer_jobs.id = skill_analyzer_results.job_id
        AND skill_analyzer_jobs.organisation_id = current_setting('app.organisation_id', true)
    )
  );
ALTER TABLE skill_analyzer_results FORCE ROW LEVEL SECURITY;
```
This is the first parent-EXISTS policy in the codebase. Direct-`organisation_id` tables (e.g. `agent_runs`) use the simpler `USING (organisation_id = current_setting(...))` form; the EXISTS form is needed only when the row has no direct org column.
**Rule.** Any table without a direct `organisation_id` column that holds tenant-sensitive data MUST use the parent-EXISTS form. Use the EXISTS subquery on the immediate parent table (the one that does carry `organisation_id`), not a deeper ancestor. The `FORCE ROW LEVEL SECURITY` directive (not just `ROW LEVEL SECURITY`) is mandatory — it overrides `BYPASSRLS` for application-role connections, ensuring no code path can accidentally bypass the policy.
**Why it matters:** omitting FORCE RLS on such tables means that admin-role connections or connections with `BYPASSRLS` would silently see all rows across all orgs. The parent-EXISTS form ensures tenant isolation even for tables that, for schema-evolution reasons, inherited their org FK indirectly.

---

## [2026-05-15] Pattern — Inner `db.transaction()` inside a route-called service method silently bypasses FORCE RLS
**Date:** 2026-05-15
**Source:** build: split-skill-analyzer (PR #320) — `resolveWarning()` in `server/services/skillAnalyzerService/results/warnings.ts`.
**Pattern:** `resolveWarning()` originally wrapped its read + update in `await db.transaction(async (tx) => { ... })`. In postgres.js, `db.transaction(callback)` checks out a BRAND-NEW pool connection for `tx`. That new connection has NO `app.organisation_id` GUC — the GUC is LOCAL to the auth middleware's outer transaction. With FORCE RLS enabled on `skill_analyzer_results`, any SELECT or UPDATE through `tx` silently returns 0 rows. The outer `db.transaction()` wrapper was also redundant: the auth middleware already runs the entire HTTP handler inside a long-lived transaction, so a second inner transaction just added a savepoint and a new (unconfigured) connection.
**Fix.** Remove the `db.transaction()` wrapper entirely. Replace all `tx.select()` / `tx.update()` calls with `const orgTx = getOrgScopedDb('caller-tag')` calls. `getOrgScopedDb()` reads the Drizzle tx from AsyncLocalStorage — this is the auth middleware's outer transaction, which already has `app.organisation_id` set. The `FOR UPDATE` row lock is still honoured on the outer tx.
**Rule.** A service method called from a route handler MUST NOT open its own `db.transaction()` for the purpose of accessing FORCE RLS tables. Use `getOrgScopedDb()` instead. Reserve inner `db.transaction()` calls for operations that genuinely need a savepoint (e.g. creating skills inside a job execute, where partial failure must roll back only that skill). Before adding an inner `db.transaction()` to any service method, ask: does this method touch a FORCE RLS table? If yes, use `getOrgScopedDb()`.
**Detection heuristic.** Grep service files for `db.transaction(` — every hit in a file that also touches `skillAnalyzerResults` (or any other FORCE RLS table) is a candidate. Check whether the callback uses the `tx` parameter to query RLS-protected tables; if so, it's the bug.
**Why it matters:** the bug is entirely silent — no error is thrown, queries simply return 0 rows or affect 0 rows. Under FORCE RLS the application appears to work (no 500s) but reads return empty and writes are no-ops, so reviewer state never persists and the feature is effectively broken for the affected operations.

---

## [2026-05-15] Pattern — When adding FORCE RLS to a table, grep ALL service sub-module files for raw `db.*` access
**Date:** 2026-05-15
**Source:** build: split-skill-analyzer (PR #320) — F1+F4 fix sequence across two ChatGPT review rounds.
**Pattern:** The initial FORCE RLS fix (Round 1, F1) migrated 5 files in `results/` and `jobLifecycle/get.ts` to `getOrgScopedDb`. Round 2 (F4) caught 2 more files in `execute/` (`approved.ts`, `retry.ts`) that were also using raw `db` against `skillAnalyzerResults`. The split happened because the fix was applied file-by-file as found rather than starting from a comprehensive grep.
**Rule.** When adding FORCE RLS to any table, the FIRST step before writing any fix is:
```bash
grep -rn "skillAnalyzerResults\|skill_analyzer_results" server/services/ --include="*.ts" | grep -v "\.test\." | grep -v "schema/"
```
This produces the complete list of service files that access the table. Review every hit for raw `db.` usage. Fix ALL of them in one commit — do not fix them iteratively across multiple rounds. The same procedure applies for any FORCE RLS table: substitute the table name and run the grep first.
**Detection.** After fixing, verify with:
```bash
grep -rn "await db\." server/services/<serviceTree>/ --include="*.ts" | grep -v "\.test\." | grep -v "schema/"
```
Any remaining `await db.` calls against the RLS-protected table name in the output = missed sites.
**Why it matters:** each missed site silently drops writes and returns empty reads. With a large service tree split across many sub-modules, an exhaustive pre-fix grep is cheaper than multiple chatgpt-pr-review rounds catching the same missed pattern.

---

## [2026-05-15] Pattern — Bare `db` import on a FORCE RLS table silently fails every write
**Date:** 2026-05-15
**Source:** build: sandbox-safety-batch (adversarial-reviewer F1 confirmed-hole on `agentRunSoftDeleteService.ts`).
**Pattern:** A new service `agentRunSoftDeleteService.softDeleteAgentRun()` imported `{ db }` directly from `server/db/index.js` and called `db.update(agentRuns).set({ deletedAt }).where(...)`. The `agent_runs` table has `FORCE ROW LEVEL SECURITY` (migration 0079). Under FORCE RLS the policy fires against the table owner, and the bare-`db` connection has no `app.organisation_id` GUC set, so the policy evaluates to `false`. Result: every UPDATE silently returned `rowCount=0`; every SELECT returned empty. The function's suppression-is-success path treated this as `{ deleted: false, reason: 'not_found' }`, hiding the bug behind a perfectly normal-looking return value.
**Rule.** Any service that writes to a FORCE-RLS table MUST use `getOrgScopedDb('serviceName.methodName')` rather than the bare `db` handle. `getOrgScopedDb()` reads the active org-scoped transaction from AsyncLocalStorage (set by `withOrgTx` or the auth middleware). Bare `db` is acceptable only for tables that do NOT have FORCE RLS, where the explicit `eq(organisationId, ...)` predicate is defence-in-depth.
**Detection.** When adding a new service that writes to a `force_rls = true` table: (1) confirm `getOrgScopedDb` import is present; (2) grep the service for `from '.*?/db/index'` — any hit on the bare db is a bug; (3) the unit test must mock `getOrgScopedDb`, not `db` directly, so the call shape mirrors production.
**Why pr-reviewer missed it.** PR-reviewer pattern-matched "228 other services do this" and rated the bare-`db` import as a consider-only item. Adversarial-reviewer correctly classified it as confirmed-hole because the threat-model lens specifically checks `FORCE_RLS_TABLES ∩ writers_using_bare_db`. **Lesson:** when pr-reviewer and adversarial-reviewer disagree on tenant isolation, adversarial wins.

---

## [2026-05-15] Pattern — `hashtext(uuid)::bigint` for `pg_advisory_xact_lock` gives 32-bit, not 64-bit, entropy
**Date:** 2026-05-15
**Source:** build: sandbox-safety-batch (adversarial-reviewer F2 likely-hole on `sandboxTelemetrySequencePure.ts`).
**Pattern:** The initial Chunk 3 implementation acquired the per-execution advisory lock via `pg_advisory_xact_lock(hashtext(${sandboxExecutionId})::bigint)`. PostgreSQL `hashtext()` returns `int4` (32-bit). The `::bigint` cast is sign-extension only — it does NOT add entropy. Effective lock-key space is 2^32. Birthday-paradox collision probability for two distinct executions sharing a lock key reaches 50% at ~77,000 concurrent executions. Two collided executions serialise their telemetry writes against each other across separate transactions — DoS class.
**Fix.** Use the two-argument form `pg_advisory_xact_lock(lockid_hi, lockid_lo)` and split the UUID into two int4 halves derived directly from the hex string: `('x' || substr(replace(${id}::text, '-', ''), 1, 8))::bit(32)::int` for hi, `('x' || substr(replace(${id}::text, '-', ''), 9, 8))::bit(32)::int` for lo. The 8 hex chars at positions 1 and 9 give full 64 bits of UUID entropy.
**Rule.** Single-arg `pg_advisory_xact_lock(::bigint)` is acceptable when the lock key is a sequential integer (table primary key, sequence value). When the lock key is derived from a UUID via `hashtext`, always use the two-arg form with explicit int4 halves of the UUID.

---

## [2026-05-15] Pattern — `char_length(line)` vs `Buffer.byteLength(line, 'utf8')` are different units
**Date:** 2026-05-15
**Source:** build: sandbox-safety-batch (pr-reviewer S5 + adversarial-reviewer F3 on `sandboxHarvestService.step9LogPersistence`).
**Pattern:** Step 9 of the log-persistence path computed `thisBatchBytes = sum(Buffer.byteLength(line, 'utf8'))` for the incoming batch and queried the day's accumulated bytes via `SELECT SUM(char_length(line))` from the DB. The two functions count DIFFERENT things — `char_length` counts Unicode code points; `octet_length` counts UTF-8 bytes. For ASCII text they coincide. For 4-byte emoji or 3-byte CJK characters, `Buffer.byteLength` returns up to 4x the `char_length` value. Net effect on a 100MB quota: emoji-heavy logs appear to exhaust the quota at ~25MB of actual storage, erroneously rejecting legitimate harvests.
**Rule.** When comparing or summing byte counts across SQL and JS sides: SQL byte count → `SUM(octet_length(text_column))`; JS byte count → `Buffer.byteLength(s, 'utf8')`. Never mix `char_length` (SQL code points) with `Buffer.byteLength` (JS bytes) in the same arithmetic.
**Related rule** (from the same build): when a DB CHECK constraint says `char_length(line) <= 10000`, the application must truncate at `s.length` characters (code-point-equivalent for the BMP) — NOT at `Buffer.byteLength(s, 'utf8')` bytes. Match the units on both sides.

---

## [2026-05-15] Pattern — Drizzle `$type<...>()` is documentation, not enforcement
**Date:** 2026-05-15
**Source:** build: sandbox-safety-batch (dual-reviewer accept: corrected `sandboxExecutions.credentialAliases.$type` + INSERT wire-up).
**Pattern:** Chunk 1b declared `credentialAliases: jsonb('credential_aliases').notNull().$type<string[]>().default([])`. Chunk 5 used a boundary cast (`as unknown as StuckRow[]`) to coerce the reconciliation row into `Array<{alias, connectionId}>`. The `runTask` INSERT path never set the column. Net effect: production rows stored `[]`, reconciliation read `[]`, the spec acceptance was "met" (read path returns column value), but the actual data path was empty. Dual-reviewer caught it because the test only asserted the READ side, not the WRITE side.
**Rule.** When `$type<X>()` is declared on a JSONB column: (1) the writer must actually populate the column with X-shaped data — confirm via grep of `.set({ <columnName>: ... })` and `.values({ <columnName>: ... })` sites; (2) read paths that consume the column must NOT use `as unknown as X[]` casts — that pattern signals the `$type` and the read-shape disagree; (3) author a Vitest that asserts read/write shape parity: a row INSERTed with a structured object should be SELECTable with the same structure (not a cast-through-unknown).
**Why pr-reviewer missed it.** PR-reviewer flagged the type drift as `should-fix` but treated the write-path gap as v2-deferred (since REQ #57 was already deferred). Dual-reviewer treated it as a current-build bug because the column was added in chunk 1b for THIS build's chunk 5 to use — the gap wasn't pre-existing.

---

## [2026-05-15] Pattern — Migration `ADD CONSTRAINT CHECK` without a backfill UPDATE fails on existing data
**Date:** 2026-05-15
**Source:** build: sandbox-safety-batch (dual-reviewer accept: added `UPDATE sandbox_logs SET line = left(line, 10000)` before `ADD CONSTRAINT` in migration 0362).
**Pattern:** Migration 0362 originally added `CHECK (char_length(line) <= 10000)` directly. If any existing `sandbox_logs.line` row had `char_length(line) > 10000` (possible if a prior harvest landed a long line before the cap was enforced), the migration would fail with a 23514 constraint violation, blocking the entire transaction.
**Rule.** Any migration that adds a non-trivial CHECK constraint to an existing table MUST either (a) backfill-truncate or normalise existing rows in the same transaction, or (b) use `ADD CONSTRAINT ... NOT VALID` followed by a separate `VALIDATE CONSTRAINT` step that runs after the backfill. Both approaches are acceptable; the trade-off is lock-window length vs deferred validation. For pre-production builds, in-transaction backfill is simpler and matches the test posture.
**Template:** `BEGIN; UPDATE <table> SET <col> = <truncate-expr> WHERE <violates-constraint>; ALTER TABLE <table> ADD CONSTRAINT <name> CHECK (<expr>); COMMIT;`

---

## [2026-05-15] Pattern — `withSandboxProvider` diagnostics must be wired at the CALLER, not the wrapper
**Date:** 2026-05-15
**Source:** build: sandbox-safety-batch (spec-conformance Round 1 directional gap on REQ #31, fix-loop commit `79310bbf`).
**Pattern:** Chunk 6 added an optional `telemetryWriter` callback to `WithSandboxProviderOpts<T>` so the wrapper can persist provider diagnostics (`slow_start`, `rate_limit`, `retry`, `ambiguous_terminal`) to `sandbox_telemetry_events` as DB rows in addition to log emissions. The wrapper change alone is insufficient — diagnostics still only land in logs unless EVERY production caller passes a writer with the right tenancy context. The fix-loop wired 12 of 14 call sites; 2 private methods (`_harvestLogs`, `_harvestArtefacts`) lacked tenancy context and stayed log-only with marker comments.
**Rule.** Optional-callback contracts only fulfill the spec when every in-scope caller wires the callback. Pattern matches the `telemetryWriter` shape: lib provides the seam; the harvest service / execution service supplies the closure that builds the row payload from its own context.
**Detection.** When a spec mandates "diagnostics persist to DB rows", search for the wrapper's call sites via `git grep -n 'withSandboxProvider(' server/`. Every hit must either pass `telemetryWriter` or be explicitly marked `// no-tenancy-context: defaults to log-only` with a routing comment to the follow-up todo. A silent omission is a CONFORMANT-vs-NON_CONFORMANT difference.

---

## [2026-05-15] Pattern — When telling builder to "move X to file Y", spell out BOTH halves explicitly
**Date:** 2026-05-15
**Source:** build: split-services-soft-cap-batch (Wave 2 Session B) — Chunk W2 required a second builder round because the first builder created the new files but left the original code in place, producing 567 lines of duplicated code.
**Pattern:** When the plan says symbols "move to" a new file, builders sometimes interpret "move" as "create the destination" without removing from the source. The result is silently passing G1 (no errors, types align) while the barrel is bloated and the new files unused.
**Rule.** Every builder invocation that moves code MUST state both halves explicitly:
1. "Create the new file X with these symbols"
2. "Remove the SAME symbols from file Y AND wire Y to import them from X"
3. "Verify with `wc -l Y` — barrel should drop substantially"
**Why it matters:** silent duplication compounds across chunks. G1 (lint + typecheck) doesn't fail on duplicated logic. By the time spec-conformance catches it via LOC budget, N misplaced commits have already landed.

---

## [2026-05-15] Pattern — Static gate path-pattern regexes need updating when files move to subdirectories
**Date:** 2026-05-15
**Source:** build: split-services-soft-cap-batch — pr-reviewer R1 found a BLOCKING bug: `server/services/providers/callerAssert.ts:22` regex `/server[/\]services[/\]llmRouter\./` no longer matched after `routeCall` moved from `llmRouter.ts` to `llmRouter/routeCall.ts` (`llmRouter` followed by `/`, not `.`).
**Pattern:** Runtime guards that walk V8 stack frames to enforce caller-source invariants use regex patterns over file paths. When a god-file is split into a barrel + sub-directory, the literal path in stack frames changes from `<service>.ts:LINE` to `<service>/<submodule>.ts:LINE`. Single-character matchers (`\.`) that anchored on the old shape silently fail to match the new shape.
**Rule.** Before splitting any service that has a runtime caller-assertion guard, grep for the guard's regex and update it to match BOTH the barrel and the sub-tree: `/server[/\]services[/\]<name>([/\]|\.)/` — either slash or dot after the service name.
**Other locations to audit at split time:**
- `scripts/gates/verify-no-direct-adapter-calls.sh` (and similar static gate scripts that grep file paths)
- `scripts/.gate-baselines/*.txt` (positional entries reference old paths)
- `architecture.md` references with line markers
**Why it matters:** the regex bug shipped clean static-gate output AND clean type-checks AND clean lint. It would only have shown up at runtime, on the first LLM call in any non-test environment, throwing `ADAPTER_DIRECT_CALL` and breaking every agent in production.
### [2026-05-15] Pattern — Conformance log can outlive the spec it audits

**Date:** 2026-05-15
**Source:** pa-v1-cleanup-batch chunk-0 architecture sweep (PR #324, slug `pa-v1-cleanup-batch`).

A spec-conformance log is a code-vs-spec snapshot at a specific timestamp. If the spec is amended AFTER the log is written (the conformance reviewer surfaces a divergence, the team chooses to ratify the as-built shape into the spec rather than change the code), the log goes stale before the code does. Future remediation work that reads the log will spin up "fix" chunks for items that are no longer gaps. The PA-V1 deferred batch had 12 directional + 1 bookkeeping items dated 2026-05-12; on 2026-05-13 the spec was amended (8 amendment passes documented in the spec header) ratifying the as-built shape for 8 of the 12. Of the remaining items, 3 were closed by prior PRs (migrations 0343/0344). Only 2 needed real code work (REQ-C4 voice_profiles schema + REQ-M15 sidebar reorder). The architect's chunk-0 mandatory re-read of the PA-V1 spec (not just the log) caught the divergence and prevented 11 wasteful "fix" chunks. **Rule:** when a remediation batch references a conformance log, the architect MUST re-read the underlying spec section for each REQ before drafting fixes — the log is secondary to the spec.

### [2026-05-15] Pattern — Column-rename grep discipline: both casings plus provisioning paths

**Date:** 2026-05-15
**Source:** pa-v1-cleanup-batch chunk-1 builder report (PR #324) + pr-reviewer Round 1 BLOCKING finding.

When planning a column rename, grep BOTH the camelCase Drizzle field name AND any snake_case literals in SELECT projections / SQL templates / spec-referenced provisioning code paths. Architect's chunk-0 file-set enumeration for REQ-C4 (`voice_profiles` 3 column renames + 2 new jsonb columns) missed:
- `server/services/agentExecutionServicePure.ts` — referenced `optedOutAt` in a function parameter type. Caught by typecheck on attempt 2.
- `server/services/operatorSessionInitialContextBundler.ts` — direct Drizzle column reference `voiceProfilesTable.optedOutAt`. Caught by typecheck on attempt 2.
- `server/services/eaProvisioningService.ts:128-140` — wizard-provisioning code that writes new voice_profile rows with the legacy `refreshPolicy: 'manual'` shape, NOT covered by typecheck because the schema's `refreshPolicy text` accepts any string. Caught by pr-reviewer R1 as a BLOCKING semantic divergence from spec §13.4 step 6. Required a fix-loop iteration.

The provisioning-code blind spot is the most dangerous: typecheck doesn't catch it because the column type is loose (`text`). **Rule:** grep both casings + scan spec-referenced provisioning code paths (anything that writes the table in the wizard / setup / seed flow) BEFORE declaring the chunk file-set. Cheaper than a fix-loop round.

### [2026-05-15] Pattern — `.down.sql` idempotent guards convention is brittle but established

**Date:** 2026-05-15
**Source:** pa-v1-cleanup-batch dual-reviewer Codex P1 finding + chatgpt-pr-review F1 rejection (PR #324).

`scripts/migrate.ts` matches both `*.sql` and `*.down.sql` (regex `/^\d{4}_.*\.sql$/`), tracks applied filenames in `schema_migrations`, and applies any pending files in lex order. On a fresh DB, `0NNN_*.down.sql` (which sorts BEFORE `0NNN_*.sql` because `.` < terminating `.sql`) runs FIRST as a forward migration — so the down file MUST be idempotent enough to be a complete no-op against the pre-up state. Convention across 92 existing `.down.sql` files: wrap renames in `DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = '...' AND column_name = '...') THEN ALTER TABLE ... END IF; END $$;` plus `DROP COLUMN IF EXISTS` / `DROP INDEX IF EXISTS` / `CREATE INDEX IF NOT EXISTS`.

**False-alarm trap:** the convention LOOKS unsafe ("won't the down destructively roll back an upgraded DB on a later migrate pass?"). It doesn't, because `schema_migrations` tracks applied filenames and only applies *pending* files. Once a `.down.sql` is recorded as applied, it never runs again. The only real risk is the contrived case where `.sql` was deployed before `.down.sql` existed in the repo — both `0360_*.sql` AND `0360_*.down.sql` shipped together in chunk 1 (`44e79c4f`), so this branch's deployments cannot hit it.

The reviewer's "best fix" (exclude `*.down.sql` from forward discovery in the runner, remove the workaround comments) is a ~92-file convention change deserving its own ADR + dedicated build. Out of scope for any single feature PR. Reference: `migrations/0358_skill_merge_consolidation.down.sql` header documents the same convention.


---

## [2026-05-15] Pattern — When telling builder to move X to file Y, spell out BOTH halves explicitly
**Date:** 2026-05-15
**Source:** build: split-services-soft-cap-batch (Wave 2 Session B) — Chunk W2 required a second builder round because the first builder created the new files but left the original code in place, producing 567 lines of duplicated code.
**Pattern:** When the plan says symbols move to a new file, builders sometimes interpret move as create the destination without removing from the source. The result is silently passing G1 (no errors, types align) while the barrel is bloated and the new files unused.
**Rule.** Every builder invocation that moves code MUST state both halves explicitly:
1. Create the new file X with these symbols
2. Remove the SAME symbols from file Y AND wire Y to import them from X
3. Verify with — barrel should drop substantially
**Detection.** After a move-chunk, run:

**Why it matters:** silent duplication compounds across chunks — by the time the final-chunk verification runs, the barrel is bloated and the sub-modules are dead code that imports cleanly but never executes. The builder won't catch it because G1 (lint + typecheck) doesn't fail on duplicated logic. Spec-conformance might catch it via LOC budget, but only after the cost of N misplaced commits.

---

## [2026-05-15] Pattern — Static gate path-pattern regexes need updating when files move to subdirectories
**Date:** 2026-05-15
**Source:** build: split-services-soft-cap-batch (Wave 2 Session B) — pr-reviewer R1 found a BLOCKING bug: `server/services/providers/callerAssert.ts:22` regex `/server[/\]services[/\]llmRouter\./` no longer matched after `routeCall` moved from `server/services/llmRouter.ts` to `server/services/llmRouter/routeCall.ts` (`llmRouter` followed by `/`, not `.`).
**Pattern:** Runtime guards that walk V8 stack frames to enforce caller-source invariants use regex patterns over file paths. When a god-file is split into a barrel + sub-directory, the literal path in stack frames changes from `<service>.ts:LINE` to `<service>/<submodule>.ts:LINE`. Single-character matchers (`\.`) that anchored on the old shape silently fail to match the new shape.
**Rule.** Before splitting any service that has a runtime caller-assertion guard, grep for the guard's regex and update it to match BOTH the barrel and the sub-tree:
```bash
grep -rnE 'service-name-pattern' server/services/providers/ server/lib/ server/middleware/
```
Widen the regex to allow both forms: `/server[/\]services[/\]<name>([/\]|\.)/` — either slash or dot after the service name.
**Other locations to audit at split time:**
- `scripts/gates/verify-no-direct-adapter-calls.sh` (and similar static gate scripts that grep file paths)
- `scripts/.gate-baselines/*.txt` (positional entries reference old paths)
- `architecture.md` references with line markers
**Why it matters:** the regex bug shipped clean static-gate output AND clean type-checks AND clean lint. It would only have shown up at runtime, on the first LLM call in any non-test environment, throwing `ADAPTER_DIRECT_CALL` and breaking every agent in production.

---

## [2026-05-16] Pattern — Third-opinion review on a structural refactor: verify "introduced vs pre-existing" before accepting any finding
**Date:** 2026-05-16
**Source:** finalisation-coordinator finalisation pass on PR #327 (slug: split-services-soft-cap-batch) — chatgpt-pr-review Round 1 flagged 3 findings as if they were new (F1 stage5cSourceFork name-collision filter; T1 budget_block_upsert_ghost observability gap; T2 WORKSPACE_MIGRATION_CONCURRENCY unbounded env var). Verification against `origin/main` confirmed all three were byte-identical on main — the structural split moved the buggy lines verbatim into the new sibling files.
**Pattern:** Third-opinion external reviewers (ChatGPT-web, Codex, any model with no git-history access) see the diff but not the blame. For a pure-barrel split, the diff *looks* like new code to them, but `git blame` reveals the lines existed pre-split. Accepting a third-opinion finding without verification can balloon a structural-refactor PR's scope and violate CLAUDE.md §6 (surgical changes).
**Rule.** For every third-opinion finding on a refactor / split / move PR, run before accepting:
```bash
git diff main -- <flagged-file> | grep -A2 -B2 '<flagged-line-fragment>'
```
- **Introduced by this PR** → implement in this PR.
- **Pre-existing, merely moved** → defer to `tasks/todo.md` as a follow-up. Refactor PRs MUST NOT grow scope to fix bugs that lived on main.
**Why it matters:** chatgpt-pr-review on PR #327 produced 3 findings, all pre-existing on main. Accepting them would have expanded the PR from "5 god-files split" to "5 god-files split + 3 unrelated bug fixes," muddying the "no behavioural change" claim AND coupling the structural refactor's review to three unrelated correctness investigations. The follow-ups now sit in `tasks/todo.md` with full context and can be batched into a focused "diagnostics hardening" PR.

---

## [2026-05-16] Pattern — Comment-block boundaries between import + re-export can fool external reviewers into "unused imports" false positives
**Date:** 2026-05-16
**Source:** finalisation-coordinator finalisation pass on PR #327 — chatgpt-pr-review Round 2 F1 claimed `server/services/llmRouter.ts` had unused imports of `TASK_TYPES, SOURCE_TYPES, EXECUTION_PHASES, ROUTING_MODES`. False positive: the barrel imports them on lines 1-2 then re-exports them on lines 38-39 (the canonical "thin barrel + sibling tree" pattern surfaces schema constants through the service boundary). ChatGPT stopped scanning at the comment-block boundary near line 33-37 and missed the bottom-of-file re-exports.
**Pattern:** Barrel files often have a structure of `import → sub-module re-exports → header comment block → schema/type re-exports`. External reviewers reading raw diffs without an AST can mistake a comment block for the file's effective end, returning a confident-but-wrong "unused import" claim. Applying the suggested fix would break the build (`Cannot find name 'TASK_TYPES'`).
**Rule.** Before accepting any "unused import" finding from an external reviewer on a barrel file:
1. Read the file end-to-end. Look for `export { X }` lines BELOW comment blocks.
2. Run `npm run typecheck` — TypeScript treats import + re-export as a use; a passing typecheck disproves the claim.
3. Reject with evidence quoting both the import line and the re-export line.
**Why it matters:** the barrel pattern is the project's canonical service-API surface. A "fix" that removes the schema re-exports would silently break every downstream caller that uses the barrel as the single import source per CLAUDE.md § Architecture Rules. The verification step (read the WHOLE file, not just where the reviewer pointed) catches this before damage.

### [2026-05-16] Pattern — Column rename audit must cover camelCase, snake_case, AND provisioning write paths

**Date:** 2026-05-16
**Source:** wave-4-audit-absorber Chunk 10 (PA-V1 voice profile leftovers).
When planning a column rename, grep BOTH camelCase Drizzle field names AND any snake_case literals in select projections AND any spec-referenced provisioning code paths that write the column.

---

### [2026-05-16] Pattern — PP-CD3: file-split LOC reduction does not resolve cycles or durability gaps

**Date:** 2026-05-16
**Source:** wave-4-audit-absorber Chunk 12 (Doc rules — PP-CD3).
Post-split file size can drop without resolving the underlying cycle or durability semantics. Verify cycles and audit-trail awaiting separately from LOC checks.
---

## [2026-05-16] Pattern — Idempotency keys with time-bucketed defaults trade rare-collision risk for common-case safety
**Date:** 2026-05-16
**Source:** audit finding F8 — `server/routes/agentRuns.ts:53-65` manual-run default key `manual:${agentId}:${subaccountId}:${userId}:${taskId??'heartbeat'}:${Math.floor(Date.now()/10000)}`. Operator decision 2026-05-15: document trade-off, no code change.
**Pattern:** A default idempotency key built from stable identifiers + a coarse time bucket (e.g. `Math.floor(Date.now()/10000)` = 10s bucket) gives "click twice within 10s" protection at the cost of a narrow false-positive window: two intentional triggers within the same 10s bucket with identical caller defaults collide and the second is silently dropped.
**Rule.** Two-pronged contract:
1. **Default is safe for the human-facing common case** — double-click on a "Run" button is the usual cause of duplicate POSTs; 10s absorbs it.
2. **Callers needing back-to-back distinct triggers MUST supply an explicit `idempotencyKey`** (request-scoped UUID or hash including a per-call discriminator). Document the requirement in the route comment AND surface it in the API client. Treat the absence of a caller-supplied key as opt-in to bucket coalescing.
**When to deviate:**
- Programmatic callers (other services, scheduled jobs): always supply explicit key — never rely on the default.
- HITL UI buttons: default is fine; rate-limit at the UI layer for additional safety.
- Bulk operations: synthesise per-row keys; never share a single bucket across many rows.
**Why it matters:** the default's `Math.floor(Date.now()/10000)` is the entire defence against accidental duplicate submission. Replacing it with a per-request UUID would over-correct (no protection against double-click) and shift the bug class from "silent drop" to "duplicate execution" — worse for write-side workflows. The audit's "low/medium" severity classification matches: rare collision, well-bounded blast radius, documented escape valve.

---

## [2026-05-16] Pattern — FK-scoped tenant tables must carry explicit RLS even when the parent does, AND raw-db consumers must migrate in lockstep
**Date:** 2026-05-16
**Source:** audit finding WF1 (Track A2, codebase-audit-log-workflow-engine-2026-05-14T16-30-31Z) — 5 workflow tables (`workflow_step_runs`, `workflow_step_reviews`, `workflow_studio_sessions`, `workflow_run_event_sequences`, `flow_step_outputs`) hold tenant-private payloads with no Postgres-level isolation. Migration 0364 was authored in PR #329 but reverted on pr-reviewer feedback because the consumer paths in `server/services/workflowEngine/*`, `flowExecutorService.ts`, and `workflowStudioService.ts` still use raw `db.(insert|update|select)(...)`. Bundle constraint: 0364 cannot ship without F4/WF3 migration of those consumers in the same PR.
**Pattern:** A table that holds tenant-private data and references a tenant-scoped parent via FK is NOT automatically protected by the parent's RLS. The FK constraint enforces referential integrity, not access control. `verify-rls-protected-tables.sh` Check 1 only inspects tables with a literal `organisation_id` column — FK-only tables slip through the gate silently.
**Rule.** Every table holding tenant-private data MUST carry one of:
- (a) Its own `organisation_id` column + a canonical org-isolation RLS policy (preferred when the table has many query paths)
- (b) An EXISTS-based RLS policy joining through the parent FK (`USING (EXISTS (SELECT 1 FROM <parent> p WHERE p.id = <this>.<fk> AND p.organisation_id = current_setting('app.organisation_id', true)::uuid))`)
- (c) An explicit entry in `scripts/rls-not-applicable-allowlist.txt` with rationale citing a spec section or invariant ID
FK-alone is not protection — option (b) is the FK-scoped pattern, documented in `architecture.md § Canonical org-isolation policy template`. The Q2/R3 gates flag FK-only tables that lack both a CREATE POLICY and an allowlist entry.
**Detection.** From the codebase root:
```bash
# Find pgTable definitions FK'd to a tenant-scoped parent but lacking own org column
grep -rE "references\(\(\) => (organisations|users|subaccounts|workflowRuns|flowRuns)\." server/db/schema/ | \
  while read line; do
    file=$(echo "$line" | cut -d: -f1)
    grep -L "organisation_id" "$file" || true
  done
```
**Why it matters:** the WF1 audit found 5 such tables holding LLM payloads, HITL decision logs, Studio chat sessions, and per-run event counters — all tenant-private. Any database role without RLS bypass would have read across organisations. The fix is mechanical (one migration per affected table cluster) but the *discovery* requires a gate that walks schema files, not just migrations.
**Companion rule — RLS migrations cannot ship before their consumers migrate.** `withOrgTx` binds `set_config('app.organisation_id', …, true)` to the transaction handle only (Postgres LOCAL scope). Raw `db.(insert|update|select)(...)` calls use a different pool connection where the GUC is NULL, which means `current_setting('app.organisation_id', true)` returns empty and the policy denies every row. Shipping a `FORCE ROW LEVEL SECURITY` migration without first migrating every raw-db consumer in the codebase turns latent isolation bugs into hard runtime failures on the next deploy. PR #329 hit this exact trap: 0364 enabled RLS on 5 workflow tables; `workflowEngine/readySet.ts`, `workflowEngine/stepLifecycle.ts`, `flowExecutorService.ts`, and `workflowStudioService.ts` all hold raw `db` calls against those tables. The pr-reviewer caught this pre-merge; the migration was reverted and bundled with the F4 consumer-migration follow-up so they ship together.


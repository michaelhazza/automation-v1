# Pre-Test Brief Follow-up + Dashboard UX — Implementation Plan

> **For agentic workers:** This is the high-level task list. The deep step-level breakdown (test-first steps, exact code blocks, exact commands) will be produced by `architect` when `feature-coordinator` is invoked. Until then, treat each `## Task` as a chunk; each `- [ ]` is a checkpoint within the chunk.

**Goal.** Land four pre-testing-round items from `tasks/todo.md`: dashboard error visibility (S3), brief artefact pagination (N7), post-commit websocket emits (S8), brief follow-up re-invocation (DR2).

**Architecture.** Four file-disjoint chunks against spec `docs/superpowers/specs/2026-04-28-pre-test-brief-and-ux-spec.md` (§0.4 disjointness matrix is binding). One new server primitive (`postCommitEmitter`) in §1.2; everything else composes existing primitives. Pair spec runs concurrently on a separate branch — do NOT touch any file in the pair-spec column of §0.4.

**Tech stack.** Node 22 + Express + Drizzle + Vitest/`node:test` (server); React + TanStack Query (client); `node:async_hooks.AsyncLocalStorage` (new in §1.2).

**Sequencing (per spec §2).** S3 → N7 → S8 → DR2. One commit per item; final PR consolidates all four.

---

## Contents

- [Pre-flight](#pre-flight)
- [Task 1 — §1.4 S3: Dashboard inline error banners](#task-1--14-s3-dashboard-inline-error-banners)
- [Task 2 — §1.3 N7: Paginate brief artefacts](#task-2--13-n7-paginate-brief-artefacts)
- [Task 3 — §1.2 S8: Post-commit websocket emit primitive](#task-3--12-s8-post-commit-websocket-emit-primitive)
- [Task 4 — §1.1 DR2: Brief follow-up re-invocation](#task-4--11-dr2-brief-follow-up-re-invocation)
- [Pre-merge pipeline (mandatory order)](#pre-merge-pipeline-mandatory-order)
- [Out-of-scope guardrails (per spec §3)](#out-of-scope-guardrails-per-spec-3)

---

## Pre-flight

- [ ] Confirm working tree clean on `pre-test-brief-and-ux-spec`.
- [ ] Confirm spec is at HEAD: `git log -1 --oneline -- docs/superpowers/specs/2026-04-28-pre-test-brief-and-ux-spec.md` shows `eed49ee7`.
- [ ] `npx tsc --noEmit` baseline green before any change (anchor for "no regressions introduced by this branch").
- [ ] `bash scripts/run-all-unit-tests.sh` baseline green (or known-failing set logged).

---

## Task 1 — §1.4 S3: Dashboard inline error banners

**Files.**
- Modify: `client/src/pages/DashboardPage.tsx` (errors state + `refetchAll` + banner mount).
- Modify: `client/src/pages/ClientPulseDashboardPage.tsx` (errors state + banner mount).
- Create: `client/src/components/DashboardErrorBanner.tsx` (shared sibling component — both pages render it; per §0.3 this is permissible because the spec names two consumers; do NOT generalise into a `<ErrorBanner>` primitive).
- Create: `client/src/components/dashboardErrorBannerPure.ts` (`failedSourceNames` pure helper).
- Create: `client/src/components/__tests__/dashboardErrorBannerPure.test.ts`.

**Invariants (spec §0.5 + §1.4).**
- Atomic `setErrors(cycleErrors)` exactly once per fetch cycle. No per-promise `setErrors`.
- Cycle-local `cycleErrors` map; `Promise.all` settles before commit.
- Banner renders iff at least one flag is true.
- No regression of websocket merge or auth-redirect behaviour.

**Steps.**
- [ ] 1.1 Author `dashboardErrorBannerPure.ts` + test (label-mapping table; 4-key + 2-key inputs).
- [ ] 1.2 Author `DashboardErrorBanner.tsx` (props: `errors: Record<string, boolean>`, `onRetry: () => void`; renders amber `role="alert"` banner with "Retry" button).
- [ ] 1.3 Refactor `DashboardPage.tsx`: introduce `errors` state, `refetchAll()` with per-promise `.catch` flipping `cycleErrors[key] = true`, single `setErrors(cycleErrors)` after `Promise.all`. Mount banner above main grid.
- [ ] 1.4 Refactor `ClientPulseDashboardPage.tsx`: same pattern; identify the two/three fetches at lines 57-71 and adapt.
- [ ] 1.5 `npx tsc --noEmit` clean; `npm run build:client` clean.
- [ ] 1.6 Manual smoke: stop API → reload → banner appears naming the failed source → start API → click Retry → banner clears. Both pages. Record in `progress.md`.
- [ ] 1.7 Commit: `feat(dashboard): inline error banners for fetch failures (§1.4 S3)`.

---

## Task 2 — §1.3 N7: Paginate brief artefacts

**Files.**
- Modify: `server/routes/briefs.ts` (route handler at lines 74-86 — accept `limit` + `cursor` query params, return `{ items, nextCursor }`).
- Modify: `server/services/briefCreationService.ts` (extend `getBriefArtefacts` signature; add sibling `getAllBriefArtefacts`).
- Create: `server/services/briefArtefactCursorPure.ts` (`encodeCursor` / `decodeCursor` / `isValidCursor` over `{ ts, msgId }`).
- Create: `server/services/__tests__/briefArtefactCursorPure.test.ts`.
- Create: `server/services/__tests__/briefArtefactPaginationPure.test.ts` (next-cursor decision logic).
- Create: `server/routes/__tests__/briefsArtefactsPagination.integration.test.ts` (75-artefact seed; 50 + cursor → 25 + null cursor).
- Modify: `client/src/pages/BriefDetailPage.tsx` (state for `nextCursor`; "Load older" button; prepend on click).

**Invariants (spec §0.5 + §1.3).**
- Backward-pagination only; newer artefacts arrive via websocket, never via cursor.
- `created_at` monotonicity is the consistency anchor; client-side `msgId` dedupe is the documented fallback (do not implement defensively, do not snapshot).
- ORDER BY `created_at DESC, id DESC`; cursor predicate `(created_at, id) < (cursor.ts, cursor.msgId)` (strict).
- `limit` clamps to `[1, 200]` (do NOT 400); emit `brief_artefacts.limit_clamped` log only when `requested !== applied`.
- Decode malformed cursor → null → treat as first page (do NOT 400).
- Internal callers that want the full set use the new `getAllBriefArtefacts` (do NOT touch the artefact-backstop path beyond what the §0.4 matrix permits).

**Steps.**
- [ ] 2.1 Author `briefArtefactCursorPure.ts` + test (round-trip; null on garbage / non-JSON / valid base64-but-not-JSON / empty).
- [ ] 2.2 Author `briefArtefactPaginationPure.ts` (or co-locate the helper inside the existing service module — architect decides) + `briefArtefactPaginationPure.test.ts` (next-cursor truthiness matrix).
- [ ] 2.3 Extend `getBriefArtefacts(briefId, organisationId, opts?)` → `Promise<{ items, nextCursor }>`. Fetch `limit + 1` rows; if overflow, drop last and emit nextCursor from kept tail.
- [ ] 2.4 Add sibling `getAllBriefArtefacts(briefId, organisationId): Promise<Artefact[]>` (delegates to the underlying query without limit). Migrate any existing in-tree caller of the old `getBriefArtefacts` to it.
- [ ] 2.5 Update route handler in `server/routes/briefs.ts`: parse `limit` (clamp + log), decode `cursor` (graceful), call `getBriefArtefacts`, respond `{ items, nextCursor }`.
- [ ] 2.6 Author integration test `briefsArtefactsPagination.integration.test.ts` covering: 75 seeds → page 1 (50 + cursor) → page 2 (25 + null cursor) → concatenation matches newest-first; clamping behaviours; malformed cursor; the 3-step interleave from spec §1.3 acceptance (load page 1 → insert 5 newer → load page 2 → 5 newer absent from page 2).
- [ ] 2.7 Update `BriefDetailPage.tsx`: switch fetch to `?limit=50`; consume `{ items, nextCursor }`; render "Load older" iff `nextCursor !== null`; prepend on click; preserve websocket-driven prepends untouched.
- [ ] 2.8 `npx tsc --noEmit` clean; `bash scripts/run-all-unit-tests.sh` clean; `npm run build:client` clean.
- [ ] 2.9 Manual smoke: open a Brief with > 50 artefacts; verify initial 50; click "Load older"; verify next 50 prepend (older than originals). Record in `progress.md`.
- [ ] 2.10 Commit: `feat(briefs): paginate GET /api/briefs/:id/artefacts (§1.3 N7)`.

---

## Task 3 — §1.2 S8: Post-commit websocket emit primitive

**Files.**
- Create: `server/lib/postCommitEmitter.ts` (`PostCommitStore` interface; `getPostCommitStore` / `runWithPostCommitStore`; `AsyncLocalStorage`-backed; states open / closed / absent).
- Create: `server/middleware/postCommitEmitter.ts` (`postCommitEmitterMiddleware`; flush on `res.finish` 2xx/3xx; `reset` on 4xx/5xx and on `res.close`).
- Modify: `server/index.ts` (one-line registration AFTER the org-tx middleware — invariant from §0.5).
- Modify: `server/services/briefConversationWriter.ts` (replace 3 inline emits at lines 203, ~214-216 with `store.enqueue` when bound; absent-store branch emits inline for job-worker callers).
- Create: `server/lib/__tests__/postCommitEmitter.test.ts` (unit cases 1–8 from spec §1.2 Tests).
- Create: `server/services/__tests__/briefConversationWriterPostCommit.integration.test.ts` (lifecycle: middleware → writer → res.finish 2xx → emit fires; second case: 5xx → emit dropped).

**Consumer contract (all downstream code and tests).**
- All downstream consumers (tests and UI) MUST treat websocket emits as eventually consistent relative to the HTTP response. No consumer may rely on synchronous websocket visibility after a successful HTTP response.

**Invariants (spec §0.5 + §1.2).**
- Middleware mounted AFTER org-tx middleware in `server/index.ts`. Direct inspection at PR-review time.
- Closed store → `enqueue(emit)` executes `emit` immediately (NOT silently drops). This is the spec's "closed-state fallback" and is non-negotiable.
- `flushAll` and `reset` are terminal — store never reopens.
- `flushAll` is best-effort (one throwing emit does not abort the rest); log `post_commit_emit_flushed { requestId, emitCount }`.
- `res.on('close')` → `reset()` (premature disconnect; drop queue regardless of status).
- Job-worker callers (no bound store) emit inline via the absent-store branch in the writer; log `post_commit_emit_fallback { reason: 'no_store' }`.
- Closed-store fallback logs `post_commit_emit_fallback { reason: 'closed_store' }`.
- Failed POST (4xx/5xx after writer ran) → enqueued emits dropped via `statusCode >= 400` branch; log `post_commit_emit_dropped { requestId, droppedCount, statusCode }`.
- Do NOT introduce a tx-outbox table (spec §1.2 step 5 explicitly rejects it).

**Steps.**
- [ ] 3.1 Author `server/lib/postCommitEmitter.ts` with the surface in spec §1.2 Approach step 1; `AsyncLocalStorage<PostCommitStore>` singleton; `enqueue` branches on `isClosed`.
- [ ] 3.2 Author `server/lib/__tests__/postCommitEmitter.test.ts` covering all 8 cases (enqueue→flush; enqueue→reset; flush-after-reset; throwing-emit best-effort; closed-state enqueue; reset-then-enqueue; ALS binding; concurrent-request isolation).
- [ ] 3.3 Author `server/middleware/postCommitEmitter.ts` per spec §1.2 Approach step 2.
- [ ] 3.4 Register middleware in `server/index.ts` AFTER the org-tx middleware. Call out in the commit body that the order matters per §0.5.
- [ ] 3.5 Refactor `briefConversationWriter.ts` lines 203, ~214-216: replace 3 direct emits with the `getPostCommitStore() ? store.enqueue(...) : <inline emit>` pattern. Architect to confirm the exact branch shape.
- [ ] 3.6 Add the three structured logs (`post_commit_emit_flushed`, `post_commit_emit_dropped`, `post_commit_emit_fallback`) at their named sites.
- [ ] 3.7 Search for tests that depend on inline emit ordering (`briefConversationWriter` callers reading websocket events synchronously after the writer call); update to await `res.finish` or use the absent-store path.
- [ ] 3.8 Author `briefConversationWriterPostCommit.integration.test.ts` (happy path emits; 500 path drops).
- [ ] 3.9 `npx tsc --noEmit` clean; `bash scripts/run-all-unit-tests.sh` clean.
- [ ] 3.10 Manual smoke: trigger contrived 500 in a route after `writeConversationMessage`; observe NO websocket event in dev tools; happy-path observed normal. Record in `progress.md`.
- [ ] 3.11 Commit: `feat(server): post-commit websocket emits via AsyncLocalStorage primitive (§1.2 S8)`.

---

## Task 4 — §1.1 DR2: Brief follow-up re-invocation

**Files.**
- Modify: `server/routes/conversations.ts` (handler at lines 74-105 — branch BEFORE write; mutually-exclusive paths).
- Modify: `server/services/briefConversationService.ts` (extend `handleConversationFollowUp` return type to include `message`; the only behavioural change is surfacing a value already created internally).
- Create: `server/services/conversationsRoutePure.ts` (`selectConversationFollowUpAction(conv) → 'brief_followup' | 'noop'`).
- Create: `server/services/__tests__/conversationsRoutePure.test.ts` (predicate matrix: brief / task / agent_run / agent / null / undefined).
- Create: `server/routes/__tests__/conversationsRouteFollowUp.integration.test.ts` (Brief-scoped POST → exactly-once write + classify + orchestrator-routing for `needs_orchestrator`; non-Brief POST → existing behaviour).

**Invariants (spec §0.5 + §1.1).**
- Branch-before-write mutual exclusion: `selectConversationFollowUpAction(conv)` BEFORE any `writeConversationMessage` call. Brief branch goes through `handleConversationFollowUp`; noop branch calls `writeConversationMessage` directly. Never both, never inline write before branching.
- Uniform response shape `{ ...message, route, fastPathDecision }` on every successful response. Brief branch populates both; noop branch sets both to `null`. Never `undefined`, never omitted.
- `writeConversationMessage` dedupe semantics are the dependency anchor — DR2 acceptance "no duplicate user messages on retry" depends on it. Do NOT modify it; if a change is required, re-review §1.1.
- Pass `conv.subaccountId ?? null` to `handleConversationFollowUp` (orchestrator-routing context).
- Non-Brief scopes (`task`, `agent_run`) remain out of scope (`'noop'` branch matches pre-spec behaviour).
- Telemetry: `conversations_route.brief_followup_dispatched { conversationId, briefId, organisationId, fastPathDecisionKind }`.

**Steps.**
- [ ] 4.1 Author `server/services/conversationsRoutePure.ts` + test (predicate matrix, defensive null/undefined returns `'noop'`).
- [ ] 4.2 Extend `handleConversationFollowUp` in `briefConversationService.ts` to capture and return the `writeConversationMessage` result alongside `{ route, fastPathDecision }`. Confirm no other callers break (TypeScript will surface this).
- [ ] 4.3 Refactor `routes/conversations.ts:74-105`: invert order — `selectConversationFollowUpAction(conv)` FIRST; brief branch calls `handleConversationFollowUp` and early-returns; noop branch calls inline `writeConversationMessage`. Both branches respond `{ ...message, route, fastPathDecision }`.
- [ ] 4.4 Add the `conversations_route.brief_followup_dispatched` log entry on entry to the brief branch.
- [ ] 4.5 Verify by code-grep that `routes/conversations.ts` contains exactly one `writeConversationMessage` call and exactly one `handleConversationFollowUp` call, each inside its own scope-discriminated branch.
- [ ] 4.6 Author `conversationsRouteFollowUp.integration.test.ts`: Brief-scoped POST writes once (assert 1 row) + classify fires + orchestrator-routing job enqueues for `needs_orchestrator`; non-Brief POST returns 201 with the existing shape. **Integration tests MUST assert DB state (row count, message contents) and orchestrator job enqueue only. Tests MUST NOT assert websocket events or timing of emits.**
- [ ] 4.7 Verify duplicate-POST behaviour against `writeConversationMessage` dedupe (read the function before shipping; if dedupe is absent or weakened, surface as a §1.1 implementation blocker NOT a scope expansion — log to `tasks/todo.md` and stop).
- [ ] 4.8 `npx tsc --noEmit` clean; `bash scripts/run-all-unit-tests.sh` clean.
- [ ] 4.9 Manual smoke against dev DB: post a follow-up to a Brief-scoped conversation; observe orchestrator job enqueue + structured log line. Record in `progress.md`.
- [ ] 4.10 Commit: `feat(conversations): re-invoke fast-path + Orchestrator on Brief follow-ups (§1.1 DR2)`.

---

## Pre-merge pipeline (mandatory order)

- [ ] 5.1 `npx tsc --noEmit` clean across the whole branch.
- [ ] 5.2 `bash scripts/run-all-unit-tests.sh` — runs ONCE at programme-end per gate-cadence rule.
- [ ] 5.3 `npm run test:gates` — runs ONCE immediately after unit tests, still before `pr-reviewer`.
- [ ] 5.4 `npm run build:client` (UI changes in §1.3 + §1.4 affect bundle).
- [ ] 5.5 Manual smoke results recorded in `progress.md` for §1.3 and §1.4.
- [ ] 5.6 Invoke `spec-conformance` against the spec. Expect at most directional findings → routed to `tasks/todo.md`. If `CONFORMANT_AFTER_FIXES`, re-run `pr-reviewer` against the expanded changed-code set.
- [ ] 5.7 Invoke `pr-reviewer` against the diff.
- [ ] 5.8 (Only if user explicitly asks) Invoke `dual-reviewer`.
- [ ] 5.9 Update `tasks/todo.md` — tick off DR2, S8, N7, S3 with commit SHAs.
- [ ] 5.10 Update spec §5 Tracking table with commit SHAs.
- [ ] 5.11 Append KNOWLEDGE.md entry for the post-commit emit pattern (spec §4 Definition of Done item 6).
- [ ] 5.12 Open consolidated PR (single PR, four commits; description references each §1.x item and links to `tasks/todo.md` lines).

---

## Out-of-scope guardrails (per spec §3)

If implementation surfaces any of these, log to `tasks/todo.md` and STOP — do NOT expand scope:

- DR2 for `task` / `agent_run` scopes.
- S7 socket-merge validation in `ClientPulseDashboardPage`.
- Tx-outbox table for S8.
- Infinite-scroll / scroll-restoration for N7.
- Generic `<ErrorBanner>` extraction (only the named two-page sibling banner is permitted).
- Any file in the §0.4 pair-spec column.
- Any new server primitive other than `postCommitEmitter` (named in §0.3).

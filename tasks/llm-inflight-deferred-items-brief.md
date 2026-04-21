# LLM In-Flight Tracker — Deferred Items Brief

**Parent spec:** `tasks/llm-inflight-realtime-tracker-spec.md` (merged via PR #161, 2026-04-21).
**Purpose:** Single-session-readable context for the eight follow-up items the in-flight tracker spec parked in §9. Each brief pins *problem → minimal shape → key files → tripwires* so a future session can jump straight into a draft spec without re-loading the parent's context.

This is not a development specification. It's a primer. Pick any item, start a new session, and the content below plus the file pointers are enough to write a proper spec.

**Related parent:** `tasks/llm-observability-ledger-generalisation-spec.md` §17 tracks a separate set of deferred items on the ledger side (cancel wiring, `provider_model` aggregate dimension, cost-efficiency dashboards, externally-submitted ledger events). Out of scope for this doc except where a tracker item crosses into ledger territory (specifically #1 partial-external-success).

---

## Priority summary

| # | Item | Risk if ignored | Effort | Priority |
|---|---|---|---|---|
| 1 | Partial-external-success protection — provisional ledger row | Provider double-bill under DB-blip + retry | Medium | **High** |
| 2 | Idempotency-key versioning (`v1:` prefix) | Silent dedup break on canonicalisation refactor | Low | **High** |
| 3 | Queueing-delay visibility (`queuedAt`) | Ops blindness to pre-dispatch contention | Low | Medium |
| 4 | Provider fallback visibility (`providerAttemptSequence`) | Admin UX gap in In-Flight tab | Low | Medium |
| 5 | Token-level streaming progress | UX polish on long calls; adapter contract change | High | Low-Medium |
| 6 | Historical in-flight archive | No current trigger; incident-driven | Medium | Low |
| 7 | Per-caller detail drawer mid-flight | UX polish; needs payload capture | Medium | Low |
| 8 | Mobile/responsive In-Flight tab layout | Pure UI | Low | Low |

Pick top-to-bottom when the next slot opens. #1 is real money. #2 is cheap insurance that gets expensive if we forget it before the first canonicalisation change lands.

---

## 1. Partial-external-success protection — provisional ledger row

_See detail section below._

### Detail — §1

**Priority:** High. Direct financial risk (provider double-bill), not ergonomics. Spec-reviewer round 2 pushed back on deferring this purely on "narrow window" grounds and the pushback was correct.

**The gap (2-sentence version).** `providerAdapter.call()` returns 200 (provider has billed and generated tokens) → `db.insert(llmRequests)` fails for any reason (DB blip, network flake, constraint violation) → caller retries under the same `idempotencyKey` → the pre-dispatch idempotency check misses (no row in `llm_requests` yet) → router dispatches a second concurrent call → double-bill at the provider with no ledger trace of the first success. No LLM provider currently supports a request-level dedup header.

**Why deferred from the tracker merge.** Scope separation. The tracker was a focused observability change with zero schema impact. This fix is a schema migration + ledger-write pattern change + retry-contract change — an independent concern that deserves its own review and phased rollout. Bundling would have doubled the surface area of the tracker PR.

**Minimal viable shape** (pinned in tracker spec §9):

1. Add a provisional value to the `llm_requests.status` enum — preferred name `'started'`. Append-only semantics preserved: first write is an append, second is an upsert that *replaces* the started row keyed by `idempotencyKey`.
2. Write the `'started'` row in the same transaction that reserves budget, **before** `providerAdapter.call()`. Row carries `idempotencyKey`, `runtimeKey` (from the in-flight tracker), `provider`, `model`, `startedAt` — everything needed for a forensic "we called this provider" record.
3. On provider success, upsert via the existing `onConflictDoUpdate({ target: idempotencyKey, where: status != 'success' })` path — `'started'` is an error-like state for the dedup check, so a successful retry cleanly overwrites it (same mechanic used today for error → success transitions).
4. On provider failure, the existing failure-path upsert already writes the terminal row — no new wiring.
5. Retry semantics: a caller retrying under the same `idempotencyKey` after provider-success + DB-insert-failure sees a `'started'` row in the pre-dispatch check. The check treats `'started'` as "in-flight, do not re-dispatch — return cached partial response or surface a reconciliation-required error". **The exact return contract is the open question the draft spec has to answer.**

**Interaction with the in-flight tracker.** The in-memory registry becomes a **low-latency cache in front of the provisional `'started'` row**, not a parallel surface. The registry still handles sub-second UI updates; the row handles durability and cross-retry dedup. No redesign of the tracker needed — the existing `runtimeKey`, `idempotencyKey`, and `ledgerRowId` fields already carry the reconciliation handles.

**Key files / call sites:**
- `server/services/llmRouter.ts` — the pre-dispatch idempotency check lives around line 394 (`db.transaction` + `existing[0].status === 'success'` check). Needs to treat `'started'` like `'success'` for the skip-dispatch decision but with different return semantics.
- `server/services/llmRouter.ts` — the budget-reservation transaction (around line 394-417) is where the `'started'` row insert should land. Same transaction means atomic "budget reserved AND started row written" before the provider call.
- `server/db/schema/llmRequests.ts` — `status` column definition. Migration needs to relax any CHECK constraint that enumerates valid status values.
- `migrations/` — new migration adding `'started'` to the status check constraint. Next free sequence number (was 0189 at time of writing).
- `server/services/systemPnlService.ts` — P&L queries should filter out `status='started'` from cost rollups (those rows don't have a final cost yet). Double-check every `WHERE status IN (...)` predicate.

**Open questions for the draft spec:**
- **Retry contract.** When a retry sees a `'started'` row, what's the correct return? Options: (a) block and poll until the row terminalises (simple but adds latency); (b) throw a `RECONCILIATION_REQUIRED` error the caller handles (more control, more complexity); (c) return the partial data from the first call's response buffer (would need server-side response caching, bigger scope).
- **TTL on `'started'` rows.** A crash between `'started'` insert and provider call would leave an orphaned row. The in-flight registry's sweep handles this at the memory layer with a 30s post-timeout buffer, but the DB row needs its own TTL — probably `startedAt + PROVIDER_CALL_TIMEOUT_MS + a minute`, reaped by a pg-boss job.
- **Aggregation.** `cost_aggregates` must ignore `'started'` rows. Pinned by test in `systemPnlServicePure.test.ts`.

**Tripwires:**
- The tracker's registry and the `'started'` row are two separate systems. Make sure they don't both claim to be the source of truth for "is this call in-flight" — the row is authoritative, the registry is cache.
- Do not break the append-only invariant. The spec says "second write is an upsert that replaces" — use `onConflictDoUpdate` with a `where` clause that permits only `'started' → terminal` transitions.
- The existing `where: ${llmRequests.status} != 'success'` guard at llmRouter.ts:933 must stay — a successful row should never be downgraded. Add `'started'` to the list of states the upsert is allowed to overwrite.

**Tracked in:** `tasks/llm-observability-ledger-generalisation-spec.md §17` (the ledger-side deferred-items list).

---


## 2. Idempotency-key versioning (`v1:` prefix)

_See detail section below._

### Detail — §2

**Priority:** High. Not a bug today, but cheap insurance that gets expensive if skipped before the first canonicalisation change lands. Do this before you do anything else that touches either key-derivation function.

**The problem.** The platform has two idempotency keys, both content-hashes of their inputs:

- `llmRouter`'s `generateIdempotencyKey()` — hashes `(organisationId, runId/executionId/ieeRunId/sourceId, agentName/featureTag, taskType, provider, model, messageHash)` — see `server/services/llmRouter.ts:121-147`.
- `actionService.buildActionIdempotencyKey()` — hashes a canonicalised payload via `canonicaliseJson()` and `hashActionArgs()` — see `server/services/actionService.ts`.

If the canonicalisation contract ever changes — a new field added, nested-key sort tweaked, null-vs-absent policy adjusted — dedup silently breaks across the deploy boundary: old rows hash one way, new calls hash another, so a retry that *should* be caught by the existing-row check gets treated as a fresh call. For `llmRouter` that's a provider double-bill. For `actionService` it's a duplicate action execution (potentially a duplicate external CRM write).

**Why deferred.** No canonicalisation change has landed yet, and the current contract is pinned by `actionServiceCanonicalisationPure.test.ts` — any breaking change trips those tests. The prefix is future-proofing for a refactor that hasn't been proposed, not a patch for a live bug.

**Minimal viable shape:**

1. Define a constant `IDEMPOTENCY_KEY_VERSION = 'v1'` somewhere central (probably `server/lib/idempotencyVersion.ts` — new file).
2. Change both key derivations to prepend the version: `return \`\${IDEMPOTENCY_KEY_VERSION}:\${existingHash}\`;`.
3. When the canonicalisation contract changes, bump `IDEMPOTENCY_KEY_VERSION` to `'v2'` in the same commit. Old rows keep their `v1:` prefix (grandfathered — still valid dedup keys for any retry of the old shape). New calls hash as `v2:...` and don't collide.
4. Add a pure test that pins the current `v1:`-prefixed output of both derivations against a known-good fixture — so any accidental prefix removal or version bump is a test failure.

**Key files / call sites:**
- `server/services/llmRouter.ts:121-147` — `generateIdempotencyKey()`. One-line change.
- `server/services/actionService.ts` — `buildActionIdempotencyKey()`. One-line change.
- `server/services/__tests__/llmRouterIdempotencyPure.test.ts` — doesn't exist yet; create to pin the prefixed output.
- `server/services/__tests__/actionServiceCanonicalisationPure.test.ts` — already exists and pins current fixtures. Add a prefix assertion.

**Migration risk:** Zero. `llm_requests.idempotency_key` is a unique text column — any new string fits. `actions.idempotency_key` same. No schema change. The only observable effect is that retries issued *after* the prefix lands don't dedupe against rows written *before* it — but retries that span a deploy are already an edge case, and the tracker + `'started'` row design (§1) catches the financial-risk variant of that same edge case.

**Tripwires:**
- Don't build a runtime "accepts `v1:` or unprefixed" fallback. The whole point of versioning is to make the contract explicit. If the prefix is optional, operators will forget to bump the version and drift silently — exactly the failure mode this is supposed to prevent.
- If you need to dedup across the deploy boundary (e.g. a retry of an old call after the prefix lands), the answer is: that request falls back to the normal happy path. The prefix is intentionally a soft line-in-the-sand, not a migration.
- `tasks/llm-observability-ledger-generalisation-spec.md §17` may also want to reference this — the ledger-side deferred-items list tracks related contract changes.

---


## 3. Queueing-delay visibility (`queuedAt` / `dispatchDelayMs`)

_See detail section below._

### Detail — §3

**Priority:** Medium. Low effort, high ops value once you hit a contention incident. The in-flight tracker shows dispatch→completion latency well, but it hides everything that happens *before* dispatch.

**The gap.** The tracker currently captures `startedAt` = the moment we're about to call `providerAdapter.call()`. It does NOT capture `queuedAt` = the moment the caller invoked `routeCall()`. The gap between those two timestamps covers:

- Budget-reservation lock wait (concurrent callers serialising on the same org's budget)
- Provider-cooldown bounce chain (primary provider in cooldown → iterate through fallback chain testing each one)
- Model-resolver work (`resolveLLM()` for auto-routed callers)
- Pricing + margin lookups

If an admin sees "this call has been in-flight for 45s and counting", they can't distinguish "the provider is slow" from "we spent 43s waiting for a budget lock and 2s calling the provider". Both look identical in the current UI.

**Minimal viable shape:**

1. Add two fields to `InFlightEntry`: `queuedAt: string` (ISO timestamp captured at the top of `routeCall()`) and `dispatchDelayMs: number` (computed as `Date.parse(startedAt) - Date.parse(queuedAt)` at add-time).
2. Thread `queuedAt` through the router — capture at line 244 (top of `routeCall`) via `const queuedAt = new Date().toISOString()`, pass it to every `inflightRegistry.add()` call.
3. Update `shared/types/systemPnl.ts` `InFlightEntry` interface to include both fields.
4. Update the `PnlInFlightTable` column set — add a "Queued" column showing `dispatchDelayMs` formatted. When >1s, render in amber; when >5s, render in red. The primary "Elapsed" column stays on dispatch→now.
5. Update the `buildEntry` helper in `llmInflightRegistryPure.ts` to accept and pass through the new fields.
6. Add a pure test asserting `dispatchDelayMs = startedAt - queuedAt` across a couple of fixtures.

**Key files / call sites:**
- `server/services/llmRouter.ts:244` — capture `queuedAt` at the very top of `routeCall()`, before the Zod parse. Needs to survive all the early-return paths (cache hit, budget_blocked — though neither of those produces a registry entry, so it doesn't matter for those paths).
- `server/services/llmRouter.ts:596` — the `inflightRegistry.add()` call. Thread `queuedAt` + `dispatchDelayMs` through.
- `server/services/llmInflightRegistryPure.ts` — `BuildEntryInput` + `buildEntry()` + pure tests.
- `server/services/llmInflightRegistry.ts` — `RegistryAddInput` shape.
- `shared/types/systemPnl.ts` — `InFlightEntry` interface.
- `client/src/components/system-pnl/PnlInFlightTable.tsx` — new column + threshold colouring.

**Tripwires:**
- Do NOT capture `queuedAt` inside the inner provider-retry loop. That would give dispatch-delay = 0 for retries, which is wrong — we want retry-attempt-N's delay to include the backoff sleep from attempt N-1. Capture once per `routeCall()` invocation.
- A caller's AbortSignal firing during the queue wait (`budget_blocked` or cache-hit path) never produces a registry entry, so those paths never need the field. Keep the capture at the top of `routeCall()` simple — don't try to only-capture-if-will-dispatch.
- The active-count gauge (`llm.inflight.active_count`) does not need a delay dimension. The current gauge is fine; this is a per-entry display field.

---


## 4. Provider fallback visibility (`providerAttemptSequence`)

_See detail section below._

### Detail — §4

**Priority:** Medium. Admin UX gap flagged by both pr-reviewer and the final merge-ready reviewer. Not a correctness bug — runtimeKeys are unique because `startedAt` differs across providers — but "what just happened to this call?" is subtly harder to answer than it should be.

**The gap.** The inner `for (let attempt = 1; ...)` loop resets to 1 for each provider in the fallback chain. The ledger's `attemptNumber` and the registry's `attempt` field track the same reset. So an admin looking at the In-Flight tab during a provider-A → provider-B fallback sees:

- Row 1: `anthropic/claude-sonnet-4-6`, attempt #1, (fails, disappears)
- Row 2: `anthropic/claude-sonnet-4-6`, attempt #2, (fails, disappears)
- Row 3: `openai/gpt-4o`, attempt #1, (in-flight)

Row 3's "#1" gives no signal that this is actually the third attempt of the same logical call. Admins debugging a slow call need that lineage.

**Minimal viable shape:**

1. Add a new field to `InFlightEntry`: `globalAttemptSequence: number` — monotonically incrementing across the entire `routeCall()`, starting at 1 for the first provider's first attempt, continuing across provider fallbacks.
2. In the router, declare `let globalAttemptSequence = 0` alongside `currentRuntimeKey` at line 530. Increment it immediately before each `inflightRegistry.add()` call.
3. Optionally also add `fallbackIndex: number` — which provider in the fallback chain this attempt belongs to (0 for primary, 1 for first fallback, etc.). Cheap and orthogonal.
4. Update `PnlInFlightTable` to render `#${attempt}` as `#${globalAttemptSequence}` when `globalAttemptSequence !== attempt` — i.e. show the cross-provider number when fallback has happened, the provider-local number otherwise.
5. Pure test: buildEntry + a couple of fixtures pinning the new fields.

**Key files / call sites:**
- `server/services/llmRouter.ts:530` — declare the sequence counter alongside `currentRuntimeKey`.
- `server/services/llmRouter.ts:596` — thread into `inflightRegistry.add()`.
- `shared/types/systemPnl.ts` — `InFlightEntry` interface.
- `server/services/llmInflightRegistryPure.ts` — `BuildEntryInput` + `buildEntry()`.
- `client/src/components/system-pnl/PnlInFlightTable.tsx` — the Attempt column's rendering.

**Tripwires:**
- Do not conflate `globalAttemptSequence` with the ledger's `attemptNumber`. The ledger field's definition pre-dates the tracker and is per-provider by design (that's how the fallback chain already reports in `fallback_chain` JSON). Don't change the ledger field — add a separate one on the registry entry.
- The per-attempt `attempt` field stays as-is, because the runtimeKey derivation (`${idempotencyKey}:${attempt}:${startedAt}`) depends on it and changing it would invalidate the crash-restart-safety argument.
- If you want to also surface this on the ledger, that's a separate conversation — it's a column add + backfill + P&L query update. Keep it off the critical path for this brief.

---


## 5. Token-level streaming progress

_See detail section below._

### Detail — §5

**Priority:** Low-Medium. Genuine UX improvement for long-running reasoning-model calls (o1/o3 up to 10 minutes) — the admin can see "this call is generating" vs "this call is hanging". But the primary "is this stuck?" question is already answered by `startedAt + elapsed-ms`, so this is polish not rescue.

**The change.** Providers that support SSE streaming (Anthropic Messages API, OpenAI Responses API, OpenRouter when upstream supports it) could emit incremental token events. The router would buffer partial tokens, periodically flush a progress signal to the in-flight registry, and the UI would render a live token counter and/or progress bar.

**Why deferred.** Non-trivial change to the adapter contract. Every provider adapter currently exposes a `call()` method returning a complete `ProviderResponse`; adding streaming means either:
- Breaking change: all adapters implement a new `stream()` method.
- Additive change: a `streaming: true` option on `call()` that switches to an async iterator return type.

Either way, every adapter (`anthropicAdapter`, `openaiAdapter`, `geminiAdapter`, `openrouterAdapter`) needs new code. The router needs buffer-management, throttling (you don't want to socket-emit on every token — 1 Hz aggregation is the right rate), and partial-response semantics for cancellation mid-stream. The ledger needs a decision on whether `tokensOut` reflects complete generation or streaming cumulative — currently `provider.tokensOut` is authoritative and comes from the provider's final usage report.

**Minimal viable shape** (the draft spec would refine this):

1. Adapter contract: add optional `stream(params): AsyncIterable<TokenChunk>` to `ProviderAdapter`. Adapters that don't implement it fall through to `call()` as today.
2. Router: a new `stream: boolean` option on `RouterCallParams`. When true, the router uses `providerAdapter.stream()` and accumulates tokens server-side. Every ~1s, emit a progress event on the socket — same envelope pattern as add/remove — carrying `{ runtimeKey, tokensSoFar, lastTokenAt }`.
3. Registry: no schema change — progress events are transient and don't need to hit the map. Treat like active-count gauge: emit to room, don't store.
4. Client: `PnlInFlightTable` subscribes to a new `llm-inflight:progress` socket event, stores `tokensSoFar` on the row, renders a small progress indicator.
5. On completion, the final `remove()` carries the authoritative `tokensOut` from the provider's usage report. Progress signals are purely advisory.

**Key files / call sites:**
- `server/services/providers/anthropicAdapter.ts` + the other three adapters — new `stream()` method.
- `server/services/providers/types.ts` — adapter interface extension.
- `server/services/llmRouter.ts` — the inner provider-call block at ~line 620. Needs a branch on `stream: boolean`.
- `server/services/llmInflightRegistry.ts` — new exported method `emitProgress(runtimeKey, tokensSoFar)` that broadcasts on `llm-inflight:progress`.
- `client/src/components/system-pnl/PnlInFlightTable.tsx` — subscribe to the new event, render a token count column.
- `shared/types/systemPnl.ts` — new `InFlightProgress` payload type.

**Tripwires:**
- Don't emit on every token — socket spam will kill the client. Aggregate to 1 Hz, matching the existing elapsed-time tick.
- Streaming + `callWithTimeout` — the timeout is per-call, not per-token-chunk. If a stream starts fast but stalls mid-response, the timeout still fires. Good. The existing `AbortSignal` threading already handles this.
- `parseFailureError` handling — `postProcess` currently runs on the complete response. Streaming callers either can't use postProcess (schema checks need complete output) or postProcess runs on the accumulated buffer at stream end. Spec needs to decide.
- Cost attribution for aborted streams — if the caller aborts mid-stream, the provider has already billed for every token emitted. The ledger needs to record partial token counts. This crosses into `llm-observability-ledger-generalisation-spec.md §17` "partial-external-success" territory and should coordinate with §1 of this brief.

---


## 6. Historical in-flight archive

_See detail section below._

### Detail — §6

**Priority:** Low. Incident-driven — there's no current trigger. The tracker spec explicitly said "deferred until we hit an incident where the registry disappeared before we could debug." Put this in the backlog and let the universe tell us when to build it.

**The gap.** The in-flight registry is in-memory only. When a call completes, its entry is removed from the map after a 30s retention window (long enough to catch late dedup events, short enough to bound memory). When the process restarts, the whole map is gone. If an operator wanted to investigate "what calls were running at 3:17am last Tuesday during the outage", the ledger has the completed calls but nothing about the in-flight ones that got swept or orphaned.

**Why this is usually fine.** Almost every diagnostic question is answerable from the ledger (which IS durable) + the structured logs (which ARE captured by whatever log sink the environment uses). The in-flight view answers "what is happening NOW" — historically it answers "what WAS happening right now, at THIS moment". Post-hoc replay is a different tool.

**Minimal viable shape** (when we decide to build):

1. A short-TTL table `llm_inflight_history` capturing every `add` and `remove` event (including `swept_stale` and `evicted_overflow`) with their full payloads. Retention: 7 days, indexed on `startedAt`.
2. The registry service writes to this table alongside the socket emit. Fire-and-forget; a DB failure must not block the live path.
3. Admin route: `GET /api/admin/llm-pnl/in-flight/history?from=X&to=Y` returning entries whose startedAt falls in the window. system-admin only, matching the live snapshot endpoint's gating.
4. UI: a "History" sub-tab inside the In-Flight tab that takes a time-range picker and reads from this endpoint. Same table shell as the live view, no socket wiring.

**Key files / call sites** (projected):
- `migrations/` — new table `llm_inflight_history` with (runtime_key, idempotency_key, organisation_id, event_kind, event_payload jsonb, created_at). Next free sequence number.
- `server/db/schema/llmInflightHistory.ts` — new Drizzle schema file.
- `server/services/llmInflightRegistry.ts` — new internal helper `persistHistoryEvent()` called from the broadcast paths. Must be fire-and-forget; wrap in try/catch + log on failure.
- `server/routes/systemPnl.ts` — new route.
- `client/src/components/system-pnl/PnlInFlightTable.tsx` or a new sibling component.

**Tripwires:**
- Do not block live emissions on DB writes. The registry's contract is sub-second; a DB hiccup must not delay a socket event. Use an append-only queue (pg-boss or an in-memory buffer with periodic flush) if latency is a concern.
- Writes across every in-flight event could generate serious row count — at 5000 concurrent calls churning through a 30s lifecycle, that's ~10k rows/minute. A 7-day retention at that rate is ~100M rows. Plan the index + partition strategy up front. `created_at` partitioning with daily cuts is the conventional answer.
- RLS: this table carries cross-tenant attribution. Either FORCE ROW LEVEL SECURITY + admin bypass (matches `llm_requests` / `llm_requests_archive`) or make it system-admin-read-only via route-level gating + `admin_role` GRANT. The former is safer but more wiring.
- If #1 (partial-external-success with `'started'` row) has already landed, this archive becomes somewhat redundant — the `'started'` row + completed ledger row together tell most of the same story. Delay building this until after #1 to avoid duplicating coverage.

---


## 7. Per-caller detail drawer mid-flight

_See detail section below._

### Detail — §7

**Priority:** Low. UX polish. The tracker's "Recently landed" rows already have a `[ledger]` button that opens `PnlCallDetailDrawer` with the full post-completion detail. This item proposes extending that to live rows — click an in-flight row to see the prompt that was sent and (if streaming is available per §5) the completion-so-far.

**Why deferred.** Requires payload capture at dispatch time. The ledger stores request/response hashes, not bodies. To render prompts in the drawer we'd need to either (a) stash payloads on the registry entry (balloons memory — a single Anthropic request body can be 100KB+) or (b) persist them somewhere queryable for the lifetime of the call. Neither is cheap and most debugging questions are answerable from the ledger row once the call lands.

**Minimal viable shape:**

1. Registry entry gains a `payloadSnapshotKey: string | null` field — a short reference (not the payload itself). Values land in a short-TTL side store.
2. Side store options (pick one in the spec):
   - **In-memory `Map<payloadSnapshotKey, PayloadSnapshot>`** bounded at ~100 entries, LRU-evicted. Zero latency, fits local-only mode, lost on process restart.
   - **Redis hash** keyed on `payloadSnapshotKey` with TTL = `timeoutMs + deadlineBufferMs + 60s`. Survives restart but re-introduces the Redis dependency the registry explicitly avoids today.
3. Router captures `{ messages, system, tools, maxTokens }` right before dispatch, generates a short key (uuid or hash-prefix), stashes into the store, passes the key to `registry.add()`.
4. New admin route `GET /api/admin/llm-pnl/in-flight/:runtimeKey/payload` — returns the captured snapshot if still in-store, 410 Gone otherwise.
5. `PnlInFlightTable` row becomes clickable; opens `PnlCallDetailDrawer` in a new "live" mode that fetches the payload and renders it.

**Key files / call sites:**
- `server/services/llmRouter.ts:596` — stash before `inflightRegistry.add()`.
- `server/services/llmInflightRegistry.ts` — either host the in-memory map here or add a sibling `payloadSnapshotStore.ts`.
- `server/routes/systemPnl.ts` — new route.
- `server/services/llmInflightRegistryPure.ts` — `InFlightEntry` gains `payloadSnapshotKey`.
- `shared/types/systemPnl.ts` — ditto.
- `client/src/components/system-pnl/PnlInFlightTable.tsx` — row click handler.
- `client/src/components/system-pnl/PnlCallDetailDrawer.tsx` — new "live" mode path that accepts a runtimeKey instead of a ledger row id.

**Tripwires:**
- This exposes raw prompt bodies to system admins. That's currently the case via Langfuse traces and the post-completion ledger detail, but doing it live makes the exposure window wider. Confirm the security posture with the data-protection policy before shipping.
- Payload-at-dispatch ≠ payload-at-ledger-write. If the router mutates `params` mid-dispatch (it doesn't today, but future refactors might), the snapshot would drift from the ledger. Capture should be a deep freeze.
- Memory sensitivity: stashing full payloads balloons RAM. The 100-entry in-memory cap is a guess — actual memory math depends on average payload size. A 500KB prompt × 100 entries = 50MB; tolerable but not free. Spec should pick the cap based on observed payload sizes.
- Redis option forces a real Redis dependency (not the optional one the tracker has today). That's a platform-level decision, not a tracker decision — coordinate with whoever owns the Redis roadmap before making this the chosen path.

---


## 8. Mobile/responsive In-Flight tab layout

_See detail section below._

### Detail — §8

**Priority:** Low. Pure UI. The In-Flight tab is desktop-first — a 7-column dense table that degrades on narrow viewports. System admins are overwhelmingly on desktops during operational work, so the urgency is genuinely low.

**The gap.** The `PnlInFlightTable` uses a standard HTML `<table>` with seven columns (Provider/model, Feature, Source, Call site, Attempt, Elapsed, Status). On a phone, the table overflows horizontally and individual cells become unreadable. There's no card layout, no column-hiding, no collapse-and-expand — the desktop grid is the only rendering.

**Minimal viable shape:**

1. Introduce a breakpoint (probably `md:` in Tailwind conventions used elsewhere in `system-pnl/`). Below it, switch the table to a card-per-row layout.
2. Card layout: provider/model + label as the headline, everything else stacked underneath. Elapsed time stays prominent — it's the field admins glance at.
3. The "Recently landed" line at the bottom stays mostly as-is — it already wraps reasonably.
4. Consider a sticky filter bar at the top for mobile (filter by feature or source) — but leave that as stretch, not core.

**Key files / call sites:**
- `client/src/components/system-pnl/PnlInFlightTable.tsx` — the only file that changes. Everything is self-contained to this component.
- Possibly `client/src/components/system-pnl/PnlCallDetailDrawer.tsx` if the drawer needs a mobile-specific rendering — check how the rest of the P&L tabs handle this before inventing a new pattern.

**Tripwires:**
- Match the mobile patterns already used in the rest of the P&L page. `PnlByOrganisationTable`, `PnlBySubaccountTable`, etc. may already have mobile breakpoint decisions baked in — inherit those rather than invent. If they're also desktop-first, that's a different (larger) piece of work than just the In-Flight tab.
- Don't hide columns on mobile without a way to reveal them. An admin debugging a weird call on their phone needs access to every field eventually. Collapse-to-summary-with-tap-to-expand is better than hard-hide.
- No state-management change needed. The socket wiring, stateVersion guards, and buffering logic are all independent of presentation.

---

## Cross-item interactions

A few of these items aren't fully independent — the sequencing matters:

- **§1 (partial-external-success) before §6 (historical archive).** The `'started'` row gives us durable per-call forensic state. A historical archive built without §1 would duplicate coverage of the same question; built after §1, it becomes a focused operational-replay tool rather than a crash-recovery layer.
- **§2 (idempotency-key versioning) before any canonicalisation refactor.** The prefix is cheap now and expensive later. If someone proposes a change to either `generateIdempotencyKey` or `buildActionIdempotencyKey`, make §2 the first commit in that PR chain.
- **§5 (streaming) coordinates with §1.** Streaming exposes a new partial-success window (tokens billed but stream aborted before completion). Whatever §1's retry contract decides about `'started'` rows needs to work for streamed-then-aborted cases too.
- **§3 (queueing delay) and §4 (fallback visibility) can ship together.** Both are small router + registry + UI changes with no dependency on each other; bundling saves one review cycle.
- **§7 (detail drawer) after §5 (streaming).** Live payload view is much more valuable once completion-so-far is visible. Without streaming, the drawer is "see the prompt we sent, then wait" — not a big win. With streaming, it's "see the prompt AND the live response generation" — the actual debugging tool.

---

## How to use this doc

A future session picks an item, starts fresh, and:

1. Reads this doc's relevant section end to end (each is ~50-80 lines).
2. Opens the parent spec `tasks/llm-inflight-realtime-tracker-spec.md` for contract language on runtimeKey, stateVersion, entry shape.
3. Opens the cited `Key files / call sites` to orient to the real code state.
4. Drafts a proper spec in `tasks/<feature-name>-spec.md` using the existing spec template (`docs/spec-authoring-checklist.md`) — primitives search, file inventory, phase sequencing, contracts, testing posture.
5. Runs `spec-reviewer` against the draft.
6. Implements against the approved spec using the standard build workflow (architect → build → pr-reviewer → dual-reviewer if local).

This document is intentionally not a spec. It's the context brief that lets the drafting go quickly.


---

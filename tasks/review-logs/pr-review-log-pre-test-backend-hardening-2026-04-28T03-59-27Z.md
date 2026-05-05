# PR Review — pre-test-backend-hardening

**Reviewed at:** 2026-04-28T03-59-27Z
**Branch:** `claude/pre-test-backend-hardening`
**Base:** `origin/main`
**HEAD at review:** `e75b5326bb1e6085fa0c082607767d374a4379a5`
**Commits in scope:** `7ebac102`, `69e5b0dc`, `4131d97f`, `018317c6`, `65465a5a`, `28f7b371`, `8191c954`, `15f7eebc`, `d94bb62e`, `ad03b8b2`, `b09e2ebc`, `a0253a76`, `a704be83`

**Files reviewed (production):**
- `server/services/incidentIngestor.ts`
- `server/services/incidentIngestorThrottle.ts`
- `server/services/llmRouter.ts`
- `server/services/llmRouterLaelPure.ts`
- `server/services/agentRunPayloadWriter.ts`
- `server/services/agentExecutionEventEmitter.ts`
- `server/services/invokeAutomationStepService.ts`
- `server/services/resolveRequiredConnectionsPure.ts`
- `server/services/resolveApprovalDispatchActionPure.ts`
- `server/services/workflowRunService.ts`
- `server/services/workflowEngineService.ts`
- `server/services/clientPulseHighRiskService.ts`
- `server/services/briefArtefactValidatorPure.ts`
- `server/services/briefArtefactValidator.ts`
- `server/services/reviewService.ts`
- `server/services/briefConversationService.ts` (impacted by migration but not in branch diff — see Blocking #1)
- `server/db/schema/conversations.ts`
- `server/db/schema/agentRunLlmPayloads.ts`
- `shared/types/agentExecutionLog.ts`
- `migrations/0240_conversations_org_scoped_unique.sql`
- `migrations/0240_conversations_org_scoped_unique.down.sql`
- Tests: `incidentIngestorThrottle.integration.test.ts`, `resolveRequiredConnectionsPure.test.ts`, `decideApprovalStepTypePure.test.ts`, `llmRouterPayloadEmissionPure.test.ts`, `briefArtefactValidatorPure.test.ts`, `reviewServiceIdempotency.test.ts`, `llmRouterLaelIntegration.test.ts`, `workflowEngineApprovalResumeDispatch.integration.test.ts`

---

## Verdict: REQUEST_CHANGES

One blocking correctness bug from migration 0240 (an upsert call site was not updated to match the new unique index), plus a strong recommendation around residual non-atomicity of the LAEL payload INSERT/DELETE and a call for an explicit async-worker exclusion test. Two integration tests are stubs (already documented as deferred Gaps C/F) — listed under Strong rather than Blocking because spec-conformance accepted them as deferred.

---

## Blocking

### B1 — `briefConversationService.findOrCreateBriefConversation` will throw on every call after migration 0240

**File:** `server/services/briefConversationService.ts:68`
**Trigger commit:** `a0253a76` (migration 0240) — the bug is that no commit on this branch touched `briefConversationService.ts` to keep it in sync.

The current upsert is:
```ts
.onConflictDoNothing({ target: [conversations.scopeType, conversations.scopeId] })
```

Migration 0240 drops the old `(scope_type, scope_id)` unique index and replaces it with `(organisation_id, scope_type, scope_id)`. PostgreSQL requires the `ON CONFLICT` target to match a unique constraint or unique index exactly. Once migration 0240 has run, this insert raises:
> `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification`

Callers of `findOrCreateBriefConversation` in production:
- `server/routes/conversations.ts:23` (`GET /api/conversations/task/:taskId`, `GET /api/conversations/agent-run/:runId`, plus the brief-conversation lookup)
- `server/services/briefCreationService.ts:47` (every brief creation goes through here)

So **brief creation, conversation find-or-create on tasks, and conversation find-or-create on agent runs all fail with a 500 the moment migration 0240 lands**. This is the primary user-visible flow for the entire brief feature — a hard break.

**Fix.** Update the conflict target to match the new index column tuple:
```ts
.onConflictDoNothing({ target: [conversations.organisationId, conversations.scopeType, conversations.scopeId] })
```

This is a one-line change in `briefConversationService.ts`. No other upsert sites exist (verified via `grep onConflict.*conversations`), but worth a final scan before commit to confirm.

This is a textbook §8.13 "discriminated-union allow-list" miss: the migration changed the uniqueness shape and the consuming upsert was not updated in the same commit. The schema update in `server/db/schema/conversations.ts:27` is correct; the application-layer dependency was missed.

---

## Strong

### S1 — Residual non-atomicity in LAEL payload INSERT/DELETE catch path (§1.1, Gap E follow-up)

**File:** `server/services/llmRouter.ts:1610–1635` (success path)

Spec §1.1 acceptance criteria: *"a follow-up DELETE on the contested key MUST run inside the same tx so the post-commit invariant holds."* Commit `7ebac102` added a defensive DELETE in the catch block, which is good — but the INSERT and the DELETE are NOT wrapped in `db.transaction()`. They are two independent statements with their own implicit transactions.

Failure mode the spec explicitly calls out: if the INSERT commits, then control returns to the catch handler (e.g. via a thrown error from `inserted?.id` evaluation, an OOM during deserialisation of `.returning()`, or any code path between insert and `payloadInsertStatus = 'ok'`), and the DELETE itself then throws (network blip, pool exhaustion, etc.), the catch on line 1630 swallows it. Final state:
- `agent_run_llm_payloads` row is visible post-commit.
- `llm.completed.payloadInsertStatus === 'failed'` is emitted.
- `llm.completed.payloadRowId === null` is emitted.

That is exactly the third state the spec said cannot exist ("There is no third state").

The spec's own contract acknowledges this: *"If the underlying driver creates ambiguity (e.g. a retried INSERT that may or may not have committed before the connection error), the catch handler MUST treat that row as failed (set `payloadInsertStatus: 'failed'`, `payloadRowId: null`) AND a follow-up DELETE on the contested key MUST run inside the same tx so the post-commit invariant holds."*

**Recommended fix.** Wrap the INSERT + (catch → DELETE on err) in a single `db.transaction()`. If the INSERT succeeds and any subsequent error fires, throw out of the inner block; the wrapping tx rolls back automatically (no row visible). The catch outside the tx then sets `payloadInsertStatus = 'failed'` for the event without needing a manual DELETE at all. Sketch:

```ts
try {
  payloadRowId = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(agentRunLlmPayloads).values({...}).returning(...);
    return inserted?.id ?? null;
  });
  payloadInsertStatus = payloadRowId ? 'ok' : 'failed';
} catch (err) {
  logger.warn('lael_payload_insert_failed', { ... });
  payloadInsertStatus = 'failed';
  payloadRowId = null;
}
```

This collapses the contract to two states (ok-with-row / failed-no-row) with no defensive DELETE needed. Alternative: keep the current structure but document the residual gap in code (one-line comment near the `} catch {}` swallow at 1630-1633 noting the rare-DB-error race) and accept it as best-effort.

### S2 — No test asserts the async-worker exclusion contract (§1.7)

**File:** `server/services/__tests__/incidentIngestorThrottle.integration.test.ts`

The "MUST hold" contract says: *"the async-worker ingestion path MUST NOT call `checkThrottle`."* The current test exercises only `recordIncident`'s sync branch (lines 125, 142, 163). No test asserts that `ingestInline` (the path the async-worker uses directly per `incidentIngestorAsyncWorker.ts:15`) bypasses the throttle.

A future refactor that re-introduces the throttle inside `ingestInline` would silently regress, with no failing test — exactly the regression the spec MUST is meant to prevent.

**Recommended test (Given/When/Then).**

> **Given** the throttle counter is at 0 and a fingerprint has not been seen
> **When** `ingestInline(input)` is called directly 1000 times for that fingerprint within the throttle window
> **Then** `getThrottledCount()` is still 0 (the throttle was bypassed) and the DB upsert mock fired 1000 times.

A second case for symmetry: invoke `ingestInline` from a fixture that simulates the async-worker path (`incidentIngestorAsyncWorker.ingestInline`) and assert the same.

### S3 — Two integration tests are stubs (§1.1 Gap F, §1.3 Gap C)

**Files:**
- `server/services/__tests__/llmRouterLaelIntegration.test.ts`
- `server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts`

Both contain only `assert.ok(true, 'TODO: implement with test DB harness')`. These were classified as DIRECTIONAL_GAP C/F by spec-conformance and accepted as deferred per `tasks/todo.md` because no shared fake-webhook / fake-provider harness exists yet.

The risk: a future contributor scanning the test suite sees two test files with descriptive names, assumes the lifecycle is covered, and ships a regression. The acceptance-criterion-bearing test for the §1.3 "double-approve fires exactly one webhook" invariant — the *call-count* assertion the spec specifically demanded over a status-only assertion — is currently a no-op.

**Recommended action.** At minimum, mark these tests as skipped (`test.skip(...)` with an explanatory link to the deferred-items section in `tasks/todo.md`) so green CI doesn't imply the lifecycle is covered. Better: build the fake-webhook / fake-provider harness as the next chunk after this PR merges and convert the two stubs to real assertions.

### S4 — `decideApproval` returns an inflated `newVersion` for the loser of an approve/approve race

**File:** `server/services/workflowRunService.ts:583`

When two concurrent `decideApproval('approved')` calls hit a supervised `invoke_automation` step:
1. Winner: atomic UPDATE wins, `resumeInvokeAutomationStep` returns `{ alreadyResumed: false, stepOutcome: 'completed' }`. `decideApproval` returns `{ stepRunStatus: 'completed', newVersion: stepRun.version + 1 }`.
2. Loser: atomic UPDATE returns 0 rows, `resumeInvokeAutomationStep` returns `{ alreadyResumed: true, stepOutcome: 'completed' }`. `decideApproval` returns `{ stepRunStatus: 'completed', newVersion: stepRun.version + 1 }`.

Both callers see `newVersion: stepRun.version + 1`. But `stepRun.version` was read before either ran, and the actual DB version after the winner's `completeStepRunInternal` runs is `stepRun.version + 2` (one bump for the `awaiting_approval → running` transition, one for `running → completed`). So the loser receives a **client cache key that's stale by two versions** when it gets back `success: true` — but indistinguishable from the winner's response.

This is pre-existing behaviour (the `+1` math has been there before this branch), but the spec §1.3 made the invocation pattern more concurrent. Worth a follow-up to either return the actual post-commit version (fetch after the dispatch) or document that `newVersion` is a "best-effort hint" in the API contract.

Not blocking on this PR; flagged so it's tracked.

### S5 — Throttle integration test fixture has likely TypeScript strictness gap

**File:** `server/services/__tests__/incidentIngestorThrottle.integration.test.ts:101–108`

`makeInput()` returns a literal whose `source` field is `` `test-source-${suffix}` as const ``, but `IncidentInput.source` is typed `SystemIncidentSource = 'route' | 'job' | 'agent' | 'connector' | 'skill' | 'llm' | 'synthetic' | 'self'` (not a generic string). Passing `makeInput('A')` to `recordIncident` should fail TypeScript's structural check.

If `npx tsc --noEmit` was not run against this file, the project's typecheck is misleadingly green. If it was run and passed, there is some implicit widening I missed.

**Recommended fix.** Either change the fixture to use a real source like `'self' as const` (the natural choice for synthetic test traffic) or add a `satisfies IncidentInput` annotation so the type mismatch is loud.

---

## Nit

### N1 — `resolveApprovalDispatchAction` decision-type drift documented but not surfaced in the helper's signature

**File:** `server/services/resolveApprovalDispatchActionPure.ts:1–13`

The helper accepts `decision: 'approved' | 'rejected' | 'edited'` but the spec talks about `'approve' | 'reject'`. Commit `65465a5a` added comments documenting this. The helper handles `'edited'` correctly (treats it as non-redispatch). No correctness issue, just want to confirm the comment is enough — for a future reader the chain "spec uses approve, code uses approved, the codebase is the source of truth" is non-obvious. Consider re-exporting the decision type from a single canonical location (the helper is one good candidate) so the drift is visible in one place rather than re-explained in every call site.

### N2 — `clientpulse_cursor_secret_fallback` log entry no longer carries `firstObservedAt`

**File:** `server/services/clientPulseHighRiskService.ts:172–178`

Spec §1.5 step 2 named `firstObservedAt: new Date().toISOString()`; the implementation emits `event` and `message` only. The spec-conformance log explicitly accepted this as PASS-with-deviation ("Spec MUST is 'log exactly once,' not 'include this field.'") and the deviation is sound. Calling out as a Nit so the field is on the radar if a downstream alert filter ever wants to deduplicate or correlate.

### N3 — `XX_REGEX` constants pattern repetition (§1.6 forward-look)

**File:** `server/services/briefArtefactValidatorPure.ts:83`

Spec §1.6 is correctly scoped to `briefArtefactValidatorPure.ts` only. The forward-look says: *"If the testing pass surfaces malformed UUIDs reaching other validation boundaries (e.g. `runId`, `subaccountId`, `automationId` arriving from external clients with bad shape), promote `requireUuid` to a shared validation helper in the next pass."*

Track this in the deferred-items list explicitly under `tasks/todo.md` so it's not lost — a quick grep for `requireString` calls on `*Id` fields elsewhere will surface the candidates when the time comes.

### N4 — `__testHooks` discriminant-name regex test is fragile

**File:** `server/services/__tests__/reviewServiceIdempotency.test.ts:445–459`

The test reads `reviewService.ts` source via `readFileSync` and counts string-literal occurrences of `'idempotent_race'`. A refactor that constants-extracts the literal (e.g. `const KIND_IDEMPOTENT_RACE = 'idempotent_race'`) would still preserve behaviour but reduce the count below 2 and fail the test. Consider asserting the *return value* shape instead (e.g. trigger a race and assert `result.wasIdempotent === true && getKindFromAuditTrail() === 'idempotent_race'`) — couples to behaviour, not source-text layout.

Not blocking; this test does what it intends, just brittle.

---

## Deferred (out of scope for this PR — already routed)

These are not new findings; they're the gaps spec-conformance already routed to `tasks/todo.md`. Listed here for reviewer transparency:

- **Gap B (§1.2):** `AutomationStepError.type: 'configuration'` deviation. Code uses `'execution'`. Intentional adaptation to existing type union.
- **Gap D (§1.1):** failure-path payload row insertion intentionally skipped (no provider response to persist).
- **Gap C/F (§1.1, §1.3):** Two integration test stubs. See S3 above.

---

## What the team did well

- Clean pure-function extractions with `*Pure.ts` naming honoured throughout (`resolveRequiredConnectionsPure`, `resolveApprovalDispatchActionPure`, `llmRouterLaelPure`).
- The §1.1 finally guard for the pairing-completeness invariant is structurally correct — `laelRequestEmitted` / `laelCompletedEmitted` flags plus the wrapping try/finally produce a fail-loud orphan emission rather than silent drops.
- §1.7 throttle move from `ingestInline` to `recordIncident`'s sync branch is the right call for the async-worker exclusion contract — minimum-surface fix.
- §1.8 race tests use a real DB and `__testHooks.delayBetweenClaimAndCommit` for genuine race determinism, plus a hook-presence assertion at startup. Genuinely covers the race, not just the happy path twice.
- Migration 0240 wraps DROP + CREATE inside a single transaction (per the G5 guardrail) — concurrency window is correctly closed.
- §1.6 `requireUuid` correctly extends the `ValidationError` discriminated union (`code: 'invalid_format'`) in the same commit per §8.13.

---

**Verdict line:** REQUEST_CHANGES — fix B1 (one-line `target` update in `briefConversationService.ts`) before merge; address S1–S3 in the same PR or as immediate follow-up commits; S4–S5 and N1–N4 are non-blocking.

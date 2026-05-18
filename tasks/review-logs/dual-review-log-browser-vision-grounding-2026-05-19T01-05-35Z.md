# Dual Review Log — browser-vision-grounding

**Files reviewed:** 22 feature files (diff base `e90906fb`; iter 1 scoped via prompt to drop unrelated OSS pattern-lifts files; iter 2 against working-tree changes only)
**Iterations run:** 2/3
**Timestamp:** 2026-05-19T01:05:35Z
**Commit at finish:** `5b656629` (local; push REJECTED — branch had pre-existing divergence with `origin/main`: 20 ahead, 3 behind at session start, now 21 ahead, 3 behind. Operator must reconcile via `git pull --rebase` and re-push. Do NOT force-push to main per repo policy.)

---

## Iteration 1

Codex output: `tasks/review-logs/_codex_browser-vision-grounding_iter1.txt` (full transcript)
Codex output (raw, broader scope): `tasks/review-logs/_codex_browser-vision-grounding_iter1_raw.txt` (initial attempt that timed out)

Codex raised 4 findings (1 P1, 3 P2):

**[REJECT]** `server/jobs/visionInferenceCostRollupJob.ts:114-115` — P1: Per-run rollup writes `(entity_type='run', entity_id=runId::text, period_type='daily', period_key=<UTC-date>)` but `runCostBreaker.getRunCostCents` (`server/lib/runCostBreaker.ts:93-112`) queries `(entity_type='run', entity_id=runId, period_type='run')`. The rows the rollup writes are never read by the breaker.
  Reason: Finding is REAL. Verified against `server/services/costAggregateService.ts:76` (canonical writer uses `period_type='run', period_key=runId`) and confirmed the unique key `(entity_type, entity_id, period_type, period_key)` on `cost_aggregates` makes the naive fix (changing the period_type) a collision risk with LLM-cost ADDITIVE upserts. The architecturally correct fix is V2-scope (drop the row, introduce a vision-specific entity_type, or switch to additive shared-row semantics). V1 impact is zero — harness is a stub, so no rows are produced. Per dual-reviewer contract ("default to rejecting if the fix is uncertain or architectural, not mechanical"), routed to `tasks/todo.md § Deferred dual-reviewer findings — browser-vision-grounding (Phase 2)` as **BVG-DR-1** with full rationale and three V2 paths documented for the follow-up build.

**[REJECT]** `server/jobs/visionInferenceCostRollupJob.ts:94-98` — P2: REPLACEMENT-semantics race between concurrent rollup workers can regress totals.
  Reason: Pre-existing pattern, NOT introduced by this change. `ieeCostRollupDailyJob.ts:94-98` uses the identical pattern with the same race profile, and that job has been in production. The 2-day lookback + recompute-from-source-of-truth design is intentional and was already evaluated by `adversarial-reviewer` (FINDING 1 closed in commit 887219dc covered the cross-tenant collision in the same job). Codex is flagging a known architectural choice, not a regression. Out-of-scope for this PR.

**[ACCEPT]** `server/services/visionActionParserPure.ts:16-17` — P2: `normalise()` runs `replace(/\s+/g, ' ')` on the entire line, collapsing whitespace inside quoted args. `type("hello  world")` parses as `'hello world'`, changing what Playwright will type.
  Reason: Real bug. The 9-verb spec (§8.1) specifies double-quoted string args for `type` and `hotkey`; those contents must round-trip byte-for-byte. Fix: `normalise()` now does `.trim()` only. Numeric verbs still tolerate inter-arg whitespace because `splitArgs` + per-arg `.trim()` in `parseNonNegInt`/`parseSignedInt` handle it. All 34 existing tests still pass; the `whitespace normalisation > internal whitespace runs are collapsed` test continues to pass because the test case is numeric (`click(340,  220)`), and per-arg trim still parses it correctly.

**[ACCEPT]** `server/services/visionGroundingService.ts:45` (record field) / `:222` (insert site) — P2: Harvested `actionType` is `text` with no runtime narrowing to the 9-variant `VisionAction['type']` union. A drifted harness or malformed artefact could persist arbitrary strings.
  Reason: Trivial defensive fix (~15 lines). Added a `VISION_ACTION_TYPES: ReadonlySet<VisionAction['type']>` constant mirroring the union, and a guard in `harvestVisionCalls` that emits `logger.warn('vision.harvest.unknown_action_type', ...)` and `continue`s on mismatch. V1 path is unreachable (stub harness), but the wired code is correct for follow-up.

---

## Iteration 2

Codex output: `tasks/review-logs/_codex_browser-vision-grounding_iter2.txt`

Codex raised 1 finding:

**[REJECT]** `server/services/visionGroundingService.ts:208` — P2: The new actionType guard `continue`s on unknown action_type, silently dropping paid vision-inference cost data when the harness drifts.
  Reason: Trade-off, not a clear-cut bug. Codex prefers persisting under a sentinel value; the current behaviour drops the row but logs `vision.harvest.unknown_action_type` with `ieeRunId/stepIndex/callIndex/actionType` — sufficient for ops to count the loss and detect drift. Sentinel persistence would itself corrupt actionType-grouped telemetry (the dominant downstream consumer per spec §8.5). Spec §8.1 takes a strict "9 variants; adding a 10th requires a spec amendment" posture, which leans toward strict rejection. V1 path is unreachable; the follow-up build owns the final policy decision and can switch behaviours if production data shows the sentinel approach is preferable. Logging-only mitigation accepted per "default to rejecting if uncertain."

Zero findings accepted in iteration 2 → terminate (Codex is raising stylistic preferences Claude judges not worth fixing).

---

## Changes Made

- `server/services/visionActionParserPure.ts` — `normalise()` no longer collapses internal whitespace; quoted-arg content in `type("...")` and `hotkey("...")` now round-trips byte-for-byte. Added docstring explaining the per-arg trim contract for numeric verbs.
- `server/services/visionGroundingService.ts` — Added `VISION_ACTION_TYPES` ReadonlySet mirroring the 9-variant `VisionAction['type']` union; `harvestVisionCalls` now narrows `rec.actionType` against the set, emits `logger.warn('vision.harvest.unknown_action_type', ...)` and skips on mismatch.
- `tasks/todo.md` — Added **BVG-DR-1** under a new "Deferred dual-reviewer findings — browser-vision-grounding (Phase 2)" section documenting the per-run-rollup key-mismatch architectural defect for the follow-up build.

Verification: `npm run lint` (0 errors, 879 warnings — all pre-existing), `npm run typecheck` (clean), `npx vitest run server/services/__tests__/visionActionParserPure.test.ts` (34/34 pass), `npx vitest run server/services/__tests__/visionGroundingServicePure.test.ts` (9/9 pass).

---

## Rejected Recommendations

- **Iter 1 P1 (rollup key mismatch)** — real architectural defect, but the fix is non-trivial and V1 path is unreachable (stub harness). Routed to V2 backlog as BVG-DR-1 with three documented fix paths.
- **Iter 1 P2 (REPLACEMENT race)** — pre-existing pattern from IEE rollup precedent; not introduced by this change; adversarial-reviewer already evaluated this layer.
- **Iter 2 P2 (silent drop of unknown actionType)** — stylistic preference for sentinel persistence vs strict rejection. The current `continue` + `logger.warn` mitigation preserves ops visibility (drift is countable from logs), and persisting under a sentinel would corrupt actionType-grouped telemetry. V1 path is unreachable; the follow-up build owns the final policy. Spec §8.1's strict "9 variants" posture supports rejection.

---

**Verdict:** APPROVED (2 iterations; 2 fixes applied; 1 architectural defect routed to V2 backlog with documented fix paths; 2 stylistic / pre-existing patterns rejected with rationale)

# PR Review Log — browser-vision-grounding

**Build slug:** browser-vision-grounding
**Branch:** main (diff base: e90906fb)
**Reviewer:** pr-reviewer (independent, read-only)

## Round 1 — CHANGES_REQUESTED

**Reviewed at:** 2026-05-19T00:00:00Z
**Files reviewed:** Full diff `e90906fb..HEAD` covering 20 files.

### 🔴 Blocking

- **B1** — `server/services/sandbox/e2bSandbox.ts:373-382`: sandbox provider does NOT propagate `decisionMode`, `visionEndpointUrl`, `visionEndpointToken`, or `visionModelId` into the harness `input.json` envelope. `_ieeShared.ts:335-338` correctly threads them into `sandboxRunTask({...})`, but the e2b provider's `harnessInput` literal contains only the pre-existing six fields. The four new fields are silently dropped; the harness always sees `decisionMode: undefined` and falls through to dom mode regardless of skill YAML or env config.

### 🟡 Should-fix

- **S1** — `ParsedSkill.ieeDecisionMode` is never propagated into `AgentRunRequest.ieeTask.decisionMode` anywhere in the V1 call chain. C13 added the types but no producer wires them.
- **S2** — `visionGroundingService.ts:133-142`: `iee_artifacts` query lacks explicit `eq(ieeArtifacts.organisationId, ieeRun.organisationId)` filter; relies on the RLS GUC alone. DEVELOPMENT_GUIDELINES.md §1 mandates explicit org filter even with RLS.
- **S3** — `visionDecisionLoop.ts:15, 33-34`: shallow `_ComputeCostCentsFn` type-alias scaffold with `eslint-disable-next-line` exists only to hold a future-import slot.
- **S4** — `visionGroundingService.ts:198`: non-null assertion `ieeRun.agentRunId!` without explicit guard in function body.
- **S5** — `visionInferenceCostRollupJob.ts:134-136`: completion log records `durationMs` only. *(Withdrawn after verification — `ieeCostRollupDailyJob` precedent also logs `durationMs` only.)*
- **S6** — Missing Vitest test for `parseVisionEndpointHostPort`.
- **S7** — Missing Vitest test for `resolveEndpointConfig` env-var branches.
- **S8** — `_ieeShared.ts:255-257`: refactor-residue comment describing completed C13 work.

### 💭 Consider

- **C1** — Duplicate `HarnessInput` interface in `visionDecisionLoop.ts` will drift from `index.ts`.
- **C2** — Generic `Error` wrap in `harvestVisionCalls` discards storage-outage vs malformed-JSON distinction.
- **C3** — `like(...)` with leading wildcard `%vision_calls.json` is less precise than exact match.

**Round 1 verdict:** CHANGES_REQUESTED (1 blocking, 8 should-fix, 3 consider)

---

## Round 2 — APPROVED

**Reviewed at:** 2026-05-19T00:00:00Z (after fix commit `fea13172`)
**Files reviewed:** Re-read every file affected by round 1.

### 🔴 Blocking
None.

**B1 closed end-to-end:** `e2bSandbox.ts:382-385` writes `decisionMode`, `visionEndpointUrl`, `visionEndpointToken`, and `visionModelId` into the `harnessInput` object that is JSON-stringified to `/workspace/input.json`. Type chain verified: `SandboxRunTaskInput` (`shared/types/sandbox.ts:271-281`) → `_ieeShared.ts:333-336` populates from `visionGroundingService.resolveEndpointConfig()` → `e2bSandbox.ts` propagates → harness reads matching `HarnessInput`. Tokens never appear in any `logger` call inside `e2bSandbox.ts`.

### 🟡 Should-fix carry-forward

- **S4** (carry-forward): two `ieeRun.agentRunId!` non-null assertions remain at `_ieeShared.ts:742, :774` (pre-existing in `postCommit` closures, not introduced by this build). Safe due to early-return guard at `:599`. **Accepted** per CLAUDE.md surgical-changes rule — refactoring pre-existing patterns is out of scope.

### Status of round 1 items

- **B1 (BLOCKER):** FIXED in `fea13172` (e2b vision-field propagation)
- **S1:** ROUTED to `tasks/todo.md` as BVG-PR-S1 (no V1 producer exists for skill-driven IEE; deferred to V2)
- **S2:** FIXED in `fea13172` (explicit organisationId predicate + exact path match)
- **S3:** FIXED in `fea13172` (scaffold removed)
- **S4:** Accepted (pre-existing, semantically safe)
- **S5:** Withdrawn (precedent doesn't log row counts either)
- **S6:** FIXED in `fea13172` (3 tests for `parseVisionEndpointHostPort`)
- **S7:** FIXED in `fea13172` (6 tests for `resolveEndpointConfig`)
- **S8:** FIXED in `fea13172` (refactor-residue comment removed)
- **C1:** ROUTED to `tasks/todo.md` as BVG-PR-C1
- **C2:** ROUTED to `tasks/todo.md` as BVG-PR-C2
- **C3:** FIXED in `fea13172` (exact path match replaces wildcard LIKE)

**Round 2 verdict:** APPROVED (B1 closed end-to-end, 6 should-fix items closed, 1 pre-existing yellow accepted, 3 items routed to V2 backlog)

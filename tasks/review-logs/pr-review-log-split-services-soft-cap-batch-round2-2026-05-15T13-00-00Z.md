# PR Review Log — split-services-soft-cap-batch (round 2 fix-loop)

**Reviewed:** 2026-05-15T13:00:00Z
**Branch:** claude/split-services-soft-cap-batch
**HEAD:** 8209bc2c
**Scope:** Re-review of 4 fixes from round 1 (1 blocker + 3 should-fix). Prior PASS code not re-reviewed.

**Files reviewed:**
- server/services/providers/callerAssert.ts
- server/services/queueService/backend.ts
- server/jobs/skillAnalyzerJob/orchestrator.ts
- architecture.md (lines 2810-2823)

Blocking: 0 / Should-fix: 0 / Consider: 1
**Verdict:** APPROVED

---

## Round 1 — Blocking finding (fixed)

`server/services/providers/callerAssert.ts:22` — `ROUTER_FRAME_PATTERN` regex `/server[/\\]services[/\\]llmRouter\./` required literal `.` after `llmRouter`. Post-split, `routeCall` lives at `server/services/llmRouter/routeCall.ts` — slash, not dot. ESM re-export semantics mean the barrel `llmRouter.ts` doesn't appear in V8 stack frames, so the regex didn't match anywhere in the production stack. Every non-test LLM call would have thrown `ADAPTER_DIRECT_CALL`. Fix in `8209bc2c`: regex widened to `/server[/\\]services[/\\]llmRouter([/\\]|\.)/`. Verified to match both barrel and sub-module frames on POSIX and Windows path separators.

## Round 1 — Should-fixes (3 of 5 fixed; 2 deferred)

- **Fixed** — `backend.ts:10` `export let queueWorkerReady` → `let queueWorkerReady` (module-private). No external consumers.
- **Fixed** — orchestrator unified try/catch wrapping all 13 stages. Forward-safe for future sentinel-throwing stages.
- **Fixed** — `architecture.md:2821` row replaced with barrel-row + sub-tree-row pair, mirroring `skillAnalyzerService` precedent.
- **Deferred** — `routeCall.ts` 1637 LOC > 1500 soft cap (operator default open-question #4; gate regex exempts sub-directory files; CI clean).
- **Deferred** — missing test for `callerAssert` (spec §13 no new tests this build; deferred to `SOFTCAP-PURE-llmRouter-1`).

## Round 2 — Consider tier

`scripts/verify-no-direct-adapter-calls.sh:71` — static gate exemption `grep -v 'server/services/llmRouter.ts:'` doesn't cover the new `server/services/llmRouter/` sub-tree. No current risk (routeCall.ts dispatches via name-agnostic `getProviderAdapter()`); a future llmRouter sub-module that imports `anthropicAdapter` directly would trigger a false-positive gate failure. Consider widening to `grep -vE 'server/services/llmRouter(\.ts|/)'` to mirror the runtime guard. Non-blocking; routed to `SOFTCAP-PURE-llmRouter-1` follow-up.

---

Blocking: 0 / Should-fix: 0 / Consider: 1
**Verdict:** APPROVED

# Spec Review Log — feat-split-skillexecutor — Iteration 2

**Spec:** `tasks/builds/feat-split-skillexecutor/spec.md`
**Spec commit at start of iter 2:** `20b949c5`
**Timestamp:** 2026-05-14T13:57:54Z
**Codex raw output:** `tasks/review-logs/_codex_feat-split-skillexecutor_iter2_2026-05-14T13-57-54Z.txt`

## Findings

### FINDING #1 — Codex iter2 #1 — §5.2 still places `SkillExecutionParams` in `context.ts`
- **Description:** §5.2 directory layout still names `SkillExecutionParams` as part of `context.ts`'s contents — contradicts §4/§5.7/Chunk 1/Chunk 14 where it stays private in `registry.ts`.
- **Classification:** mechanical (iteration-1 fix missed the §5.2 layout block).
- **Disposition:** auto-apply. Removed from §5.2 line and added an inline pointer to §5.7.

### FINDING #2 — Codex iter2 #2 — §5.3 stale `tasks.ts → handoff.ts` exception
- **Description:** §5.3 had an exception "`tasks.ts` may export `enqueueHandoff` for `handoff.ts` to consume" — but per §5.5 `enqueueHandoff` lives in `pipeline.ts`, so the exception is wrong.
- **Classification:** mechanical (contradiction between §5.3 and §5.5).
- **Disposition:** auto-apply. Replaced with the two real cross-handler edges: `calendar.ts`/`slack.ts` → `userOwnedAgentOwner.ts`, and `tasks.ts`/`handoff.ts` → `pipeline.ts` for `enqueueHandoff`.

### FINDING #3 — Codex iter2 #3 — §5.2 vs Chunk 4: `run_playwright_test` / `analyze_endpoint`
- **Description:** §5.2 listed `run_playwright_test` and `analyze_endpoint` under `devContext.ts`, but Chunk 4 (web.ts) actually moves them. Source places `executeRunPlaywrightTest` and `executeAnalyzeEndpoint` near the browser tooling. Pick one.
- **Classification:** mechanical (contradiction).
- **Disposition:** auto-apply. Moved both into the `web.ts` line in §5.2; removed from `devContext.ts` line.

### FINDING #4 — Codex iter2 #4 — Many slug families unmapped to any handler module [CRITICAL]
- **Description:** The spec only enumerated ~50 functions in `handlers/<family>.ts` modules. Source has 214 slugs. Many families have no destination: methodology stubs (~30), auto-gated stubs (~5), reviewGated proposers (~20), system-monitor shells (11), optimiser shells (8), spend shells (5), config shells (~30), CRM (5+), org-insights (10+), `output.recommend`, `update_thread_context`, `notify_operator`, capability discovery (~8), digest (~3), media (~3), memory blocks. Without this mapping, Chunk 14 (registry assembly) cannot consolidate; the in-barrel literal still holds ~150 inline handlers.
- **Classification:** mechanical (file-inventory drift on a large scale; the spec's design rule is "no inline handlers in registry.ts post-split" and Chunk 14 cannot satisfy it without this mapping).
- **Disposition:** auto-apply. Added §5.2.1 "stub / thin-dispatcher placement rule" that names every remaining slug family and assigns it to a handlers/* module. Added 5 new sub-chunks (10a-10e) to §7 that land the new modules between Chunk 10 and Chunk 11. After Chunk 10e, the in-barrel `SKILL_HANDLERS` literal is empty — every slug has moved.

### FINDING #5 — Codex iter2 #5 — §6 line ranges stale
- **Description:** `SkillHandler` is at line 426 (not 137-243). One-off helpers missing `serializeTask` (line 2965) and `redactSensitiveFields` (line 3312) — they were lumped into iteration-1's enumeration but without precise line numbers.
- **Classification:** mechanical.
- **Disposition:** auto-apply. Split concern 1 to give precise ranges; rewrote concern 7 with one helper per line-anchor.

### FINDING #6 — Codex iter2 #6 — §10 textual-references list incomplete
- **Description:** Other files mention "skillExecutor" in comments / string literals but don't import; codex listed six (`notifyOperatorFanoutService.ts`, `reviewService.ts`, `middleware/errorHandling.ts`, `skillExecutorPure.ts`, `skillExecutorPure.test.ts`, `tools/config/configSkillHandlers.ts`).
- **Classification:** mechanical (caller-sweep noise hygiene).
- **Disposition:** auto-apply. Listed all six in the NOT-importers block; added the precise grep command the Chunk 15 sweep should run so future text-reference drift doesn't pollute the import list.

## Iteration 2 Summary

- Mechanical findings accepted: 6
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions: 0
- Spec commit after iteration: (to be recorded after commit)

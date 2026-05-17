# Spec review iteration 1 — feat-split-agentexecutionservice

**Spec:** `tasks/builds/feat-split-agentexecutionservice/spec.md`
**Started:** 2026-05-15
**Reviewer:** spec-reviewer agent (Codex CLI v0.125 + Claude adjudication)
**Spec-context staleness:** green (4 days old; `last_reviewed_at: 2026-05-11`)

## Pre-loop context check

- `docs/spec-context.md` present and current.
- Spec framing aligns with context (pre-production, static-gates-primary, no new tests, no feature flags). No HITL mismatch.
- Companion pattern-setter spec `tasks/builds/feat-split-skillexecutor/spec.md` exists with §5.1, §5.4, §5.5, §5.6 referenced subsections present.

## Codex run

`codex exec --skip-git-repo-check` with a self-contained prompt (ground-truth exports + numbered-phase list + caller-import list inlined so Codex did not need to call tools). Returned 40 numbered findings.

## Findings classified + adjudicated

### Mechanical — ACCEPTED + APPLIED (Codex findings)

[ACCEPT] §4/§6/§8.3/§9 DEF-1/§14 — `executeRunAsync` is wrong; actual method is `startRunAsync`.
  Fix: Renamed all six occurrences. §4 now locks `agentExecutionService.startRunAsync` with full signature. §6 split into two sub-bullets for `executeRun` and `startRunAsync`.

[ACCEPT] §5.6/§7 — Barrel did not prove `startRunAsync` preservation.
  Fix: §4 locks `{ executeRun, startRunAsync }` on the object. The `export { agentExecutionService }` re-export carries both methods automatically.

[ACCEPT] §7 — Chunk plan omitted source-phases 3, 3.5, 4, 4.5.
  Fix: New Chunk 7a (loadContext.ts) covers source phases 3, 3.5, 4, 4.5 in source order.

[ACCEPT] §7 — Chunk plan omitted source-phases 5, 5a, 5b, 6, 7.
  Fix: Old Chunk 7 split into Chunk 7b (prepare.ts) covering source phases 5, 5a, 5b, 6, 7 in source order.

[ACCEPT] §7 — Chunk plan omitted source-phases 10, 11, 12.
  Fix: Chunk 9 (complete.ts) expanded to cover phases 9, 10, 11, 12 with the MCP-cleanup invariant called out explicitly ("preserved inside the existing try/finally control flow").

[ACCEPT] §7 — Old Chunk 7 listed prompt and hierarchy work BEFORE runContextLoader, contradicting source order.
  Fix: Chunks 7a + 7b now follow strict source order: 3 → 3.5 → 4 → 4.5 → 5 → 5a → 5b → 6 → 7.

[ACCEPT] §10 — `server/lib/testRunIdempotency.ts` listed but only mentions in comments.
  Fix: Removed from §10. Added to the "Excluded — filename mentions only" footnote.

[ACCEPT] §1/§5.4/§7 — Spec said "untouched" but also said "extend" and "append".
  Fix: §1.6 tightened to "import from them — do not duplicate; this build does NOT modify any of those four siblings". §5.4 and §7 anti-chunks lines updated to match. Three statements now agree.

[ACCEPT] §5.2/§7 — §5.2 said Phase E lives in top-level `backendDispatch.ts`; Chunk 8 introduced `runLifecycle/dispatch.ts`.
  Fix: §5.2 lists `runLifecycle/dispatch.ts` as "optional — Q3". §5.3 prose adds the permitted exception. Chunk 8 prose adds the matching note. All three sections agree.

[ACCEPT] §6 — Stale phase summary "3-4 agent load + saLink load".
  Fix: §6 item 3 replaced with full source-order phase list (0a-12). New §6 item 4 covers `startRunAsync`.

[ACCEPT] §8.1 — "Targeted unit tests authored for this build" contradicted §13 and `docs/spec-context.md`.
  Fix: §8.1 bullet now reads "Targeted re-run of any EXISTING test file that touches the chunk's surface". Chunk 4's targeted line tightened to match.

### Mechanical — ACCEPTED + APPLIED (rubric findings)

[ACCEPT] §10 — Spec said "25 hits" but real import-grep returned 16 files; 7 false positives present.
  Fix: §10 rewritten with the verified 16-import list. Excluded-list footnote names webLoginConnections, workflowEngineService, agentExecutionEventService, agentExecutionEventServicePure, runtimeCheckService, registerOptimiserSchedulePure.test, testRunIdempotency. §12 self-consistency line updated from "25" to "16".

[ACCEPT] §6 — `executeRun` line range "453-2388, ~1,936 LOC" was stale; actual is ~457-2302 (~1,850 LOC), with 2304-2388 belonging to `startRunAsync`.
  Fix: Corrected line ranges in §6 for both methods.

[ACCEPT] §5.2 — `validate.ts` description omitted org-subaccount detection (phase 0c).
  Fix: Description now reads "(source phases 0a-0d): subaccountId/subaccountAgentId validation, org kill switch, org-subaccount detection, idempotency lookup".

[ACCEPT] §5.2 — `runLifecycle/*.ts` rows lacked source-phase mappings.
  Fix: Each row now carries "(source phases X, Y, Z)" parenthetical for traceability.

[ACCEPT] §5.2 — `complete.ts` description omitted phases 10, 11, 12.
  Fix: Updated to cover phases 9, 10, 11, 12; MCP-cleanup invariant stated explicitly.

[ACCEPT] §5.3 DAG — Diagram missed `loadContext.ts` and `dispatch.ts`.
  Fix: Diagram lists all eight `runLifecycle/*` nodes with phase labels.

[ACCEPT] §5.2 — `types.ts` row didn't mention `RunExecutionContext`.
  Fix: Row now reads "AgentRunRequest, AgentRunResult, TaskWithAgent, ExecutionClosureContext, RunExecutionContext (internal)".

[ACCEPT] §9 DEF-2 — Said "Chunk 4 introduces a placeholder interface" but Chunk 1 authors it.
  Fix: DEF-2 now reads "Chunk 1 authors the placeholder interface; Chunks 4-9 extend it as each phase function consumes / returns the running context." Chunk 1's placeholder-comment also updated.

### Mechanical — REJECTED

[REJECT] §10 — Codex #10 claimed `server/routes/skills.ts` is a false positive.
  Reason: Codex was wrong. Verified: line 8 has `import { agentExecutionService } from '../services/agentExecutionService.js';`. Spec inclusion is correct.

[REJECT] §10 — Codex #11 claimed `server/routes/subaccountSkills.ts` is a false positive.
  Reason: Codex was wrong. Verified: line 8 has the import. Spec inclusion is correct.

[REJECT] §10 — Codex #13-35 (23 omitted callers).
  Reason: All 23 are filename-grep matches but NOT real `import` statements. Verified each individually (`grep -E "^import .* from ['\"][^'\"]*agentExecutionService['\"]"` returned zero matches for every one). Comments/strings, not imports.

[REJECT] §7 — Codex #40 claimed per-chunk "Targeted: test still passes" lines violate the no-new-tests posture.
  Reason: Those lines refer to RE-RUNNING EXISTING test files, not authoring new ones. After fix #39 applied, the language is unambiguous.

### Directional / ambiguous — RESOLVED AUTONOMOUSLY

None. No directional or framing-conflict findings surfaced.

## Iteration 1 summary

- Codex findings:                40
- Rubric findings (independent): 8
- Mechanical findings accepted:  19 (11 Codex + 8 rubric)
- Mechanical findings rejected:  26 (Codex false positives)
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          0 (no items routed to tasks/todo.md)

Spec commit after iteration: pending (Step 8b auto-commit)


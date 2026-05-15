# Spec review iteration 4 — feat-split-agentexecutionservice

**Spec:** `tasks/builds/feat-split-agentexecutionservice/spec.md`
**Started:** 2026-05-15
**Reviewer:** spec-reviewer agent (Codex CLI v0.125 + Claude adjudication)
**Prior iterations:** 1 (15541bab), 2 (a6c813e5), 3 (c0c732ee)

## Codex run

`codex exec --skip-git-repo-check`. Returned 2 numbered findings.

## Findings classified + adjudicated

### Mechanical — ACCEPTED + APPLIED

[ACCEPT] §7 Chunk 11 — Caller import-path shifting allowance collided with the "pre-existing siblings untouched" boundary. The §10 caller list correctly includes `agentExecutionServicePure.ts`, `agentExecutionLoop.ts`, and `executionBackends/options.ts` as importers, but those three are declared untouched in §2 and §5.4. Chunk 11 must not touch their import lines even though they appear in §10.
  Fix: Chunk 11 carries an explicit hard boundary: "pre-existing siblings declared untouched in §2 and §5.4 — agentExecutionServicePure.ts, agentExecutionLoop.ts, agentExecutionTypes.ts, and executionBackends/* (including executionBackends/options.ts) — are NEVER modified by this sweep even though they appear in §10."

[ACCEPT] §5.3 — `types.ts` rule was internally inconsistent: it said "imports types only from ... sibling service types (e.g. LoopParams re-import)" then immediately said "NO imports from services". Runtime-vs-type-only distinction was implicit only.
  Fix: Rewrote the rule to spell out: "`import type {...}` (type-only) from db/schema, shared/types/**, the named pre-existing siblings (e.g. LoopParams from agentExecutionLoop.ts), and external libs. NO runtime imports from db, no imports of any kind from sibling service modules under server/services/ other than `import type` from the named pre-existing siblings, and no imports from sibling sub-modules under agentExecutionService/."

### Directional / ambiguous — RESOLVED AUTONOMOUSLY

None.

## Iteration 4 summary

- Codex findings:                2
- Rubric findings (independent): 0
- Mechanical findings accepted:  2
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Autonomous decisions:          0

Spec commit after iteration: pending (Step 8b auto-commit)

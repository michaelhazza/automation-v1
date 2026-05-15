# Wave 2 Session B — Phase 2 progress

**Slug:** split-services-soft-cap-batch
**Branch:** claude/split-services-soft-cap-batch
**Spec:** tasks/builds/split-services-soft-cap-batch/spec.md
**Plan:** tasks/builds/split-services-soft-cap-batch/plan.md
**Start:** 2026-05-15

## Phase 2 — autonomous mode

Operator delegated full autonomous execution from plan-write through to start of chatgpt-pr-review manual gate. All open questions answered self-applying defaults (per plan §Open questions). No operator prompts during chunk loop.

## REVIEW_GAP entries (Phase 2)

```
REVIEW_GAP: chatgpt-plan-review | task-class: Significant | reason: Operator delegated autonomous mode; manual ChatGPT-web review loop incompatible | operator-override: yes-2026-05-15T autonomous-mode-directive | remediation: chatgpt-pr-review at Phase 3 covers second-opinion pass
```

## Plan-gate

Self-approved per operator delegation. Plan finalised at `tasks/builds/split-services-soft-cap-batch/plan.md`. 27 chunks across 5 targets + 1 final. PR shape: one master PR. Target order: queueService → agentService → workspaceMemoryService → llmRouter → skillAnalyzerJob.

## Open-question defaults (self-answered)

1. `getTree` placement → keep with data-sources (Chunk A4 default)
2. Stage 5 sub-split → defer to SOFTCAP-PURE-skillAnalyzerJob-1
3. Sentinel vs null-return → sentinel (Chunk S2 default)
4. routeCall phase-split → defer to SOFTCAP-PURE-llmRouter-1
5. architecture.md update timing → same commit as Final chunk
6. Target order → queueService first (plan default)

## Chunk progress

(populated as chunks complete)

---

## LEARNING_FEEDBACK_PROPOSAL (Phase 3 Step 7a)

Producer: `finalisation-coordinator` for build `split-services-soft-cap-batch`.
Consumer: operator marks each row's `Operator decision` inline (`approved` / `rejected` / `deferred`). Approved entries become `tasks/todo.md` items handled as separate (often Trivial) PRs. **Auto-apply prohibited in v1** — coordinator MUST NOT apply the change in the same finalisation cycle.

| Pattern | Target | Rationale | Operator decision |
|---|---|---|---|
| When telling builder to MOVE X to Y, spell out BOTH halves explicitly (create + remove + verify the source shrinks) | `agent-instruction` (`builder`) | Chunk W2 burned a second builder round because the first builder created new files but did not remove the originals (567 LOC of dead duplication). Builder prompt template should require both halves explicitly. | _pending_ |
| Static gate path-pattern regexes need widening when files move to subdirectories | `hook-or-grep-gate` | `callerAssert.ts:22` regex broke silently after the llmRouter split — would have thrown `ADAPTER_DIRECT_CALL` on every prod LLM call. A pre-split grep step (find any regex over the moving service's path) would have caught it before merge. | _pending_ |
| Third-opinion external reviewers see the diff but not git history — verify "introduced vs pre-existing" before accepting findings on refactor PRs | `agent-instruction` (`chatgpt-pr-review`) | All 3 findings from chatgpt-pr-review R1 on PR #327 were pre-existing on `main` (the structural split moved buggy lines verbatim). Without verification, refactor PRs balloon scope and muddy the "no behavioural change" claim. The agent's standing contract should explicitly require `git diff main -- <file>` verification for every finding on a refactor / split / move PR. | _pending_ |
| Comment-block boundaries between import + re-export can fool external reviewers into "unused imports" false positives on barrel files | `no-further-action` | chatgpt-pr-review R2 F1 on PR #327 confidently claimed `llmRouter.ts` had unused imports — the re-exports were 5 lines below a header comment block. Pattern is generic to all ChatGPT-web reviews on barrel files; mitigation (read whole file + run typecheck before accepting) already lives in the chatgpt-pr-review standing contract. No further action — existing verification step catches it. | _pending_ |

Approved entries route to `tasks/todo.md` with heading format `### compound-learning: <pattern-title> (split-services-soft-cap-batch)`. Unapproved rows remain here as deferred — they do NOT block `MERGE_READY` per Step 7a.




# Spec Review Log — feat-split-skillexecutor — Iteration 1

**Spec:** `tasks/builds/feat-split-skillexecutor/spec.md`
**Timestamp:** 2026-05-14T13:36:24Z
**Codex raw output:** `tasks/review-logs/_codex_feat-split-skillexecutor_iter1_2026-05-14T13-36-24Z.txt`

## Findings — classification

### FINDING #1 — Codex #4 — §4 row `SkillExecutionParams`
- **Description:** Line 231 is `interface SkillExecutionParams` (private, not exported); spec §4 claims "exported interface".
- **Suggested fix:** Remove from public-surface lock OR call out as new public export.
- **Classification:** mechanical (contradiction between §4 and source state).
- **Disposition:** auto-apply. Remove `SkillExecutionParams` from §4 public-surface table; also remove from §5.7 barrel re-export; update §10 reference; add a note that the symbol stays private.

### FINDING #2 — Codex #6 — §5.3 / §7 Chunk 4 cyclic transitional import
- **Description:** Chunk 4 says `adapter-registration.ts` imports the handler functions "from the barrel transitionally" — but the barrel side-effect-imports adapter-registration, AND the handler functions are private (not exported) in the barrel, so adapter-registration cannot import them by name.
- **Suggested fix:** Move/export adapter target handlers before adapter extraction, or defer adapter extraction until target modules exist.
- **Classification:** mechanical (sequencing bug — Chunk 4 depends on private-symbol access that the source layout does not permit). The fix is to reorder chunks so that adapter-registration is created LAST (after pages.ts and delegation.ts exist) OR to keep adapter-registration logic in the barrel during transition.
- **Disposition:** auto-apply. The cleanest mechanical fix: reorder — adapter-registration extraction moves from Chunk 4 to a position after Chunks 10 (pages) and 12 (delegation), since those chunks create the handler modules adapter-registration depends on. Specifically: the registerAdapter call STAYS at the top of the barrel during all intermediate chunks; it only moves out into its own file once `handlers/pages.ts` and `handlers/delegation.ts` exist. Renumber chunks accordingly.

### FINDING #3 — Codex #7 — §5.3 / §7 adapter-registration imports incomplete
- **Description:** The final adapter dispatch needs `createWorkerAdapter`, `resolveActionSlug`, page executors, and dynamic `config_update_organisation_config` + `notify_operator` dispatch — not only `executionLayerService.registerAdapter` + context + delegation handlers.
- **Suggested fix:** Expand §5.3 adapter-registration rule and the chunk that extracts it.
- **Classification:** mechanical (file-inventory drift in dependency direction rule).
- **Disposition:** auto-apply. Update §5.3 adapter-registration bullet to list the full import set; update the chunk description (after reorder per Finding #2).

### FINDING #4 — Codex #8 — §5.3 / §7 Chunk 2 pipeline.ts imports incomplete
- **Description:** `enqueueHandoff` uses `db`, schema tables (`subaccountAgents`, `agents`, `agentRuns`), `isActive`, `and`/`eq` from drizzle, `MAX_HANDOFF_DEPTH`, `pgBossSend`, `AGENT_HANDOFF_QUEUE`, and `createEvent` — but the §5.3 rule for `pipeline.ts` lists only `context.ts`, `skillExecutorPure.ts`, `actionRegistry`, `tracing`, `tripwire`, `incidentIngestor`.
- **Suggested fix:** Either expand pipeline.ts's allowed imports OR move enqueueHandoff to a handoff-focused module.
- **Classification:** mechanical (file-inventory drift in the dependency-direction rule). The placement of enqueueHandoff is part of the spec's design decision (§5.5 says it lives in pipeline.ts); the §5.3 imports list is the drift.
- **Disposition:** auto-apply. Update §5.3 pipeline.ts bullet to list the full import set (`db`, drizzle helpers, `subaccountAgents`/`agents`/`agentRuns` from schema, `MAX_HANDOFF_DEPTH`, schema query helpers).

### FINDING #5 — Codex #9 — §5.3 / §5.7 registry.ts "no logic" contradicts skillExecutor.execute
- **Description:** §5.3 says `registry.ts` "contains no logic — only the assembled map", but §5.7 puts `skillExecutor.execute` there, and `execute` has MCP dispatch + unknown-skill behaviour.
- **Suggested fix:** Make registry.ts map-only and put `skillExecutor.execute` in a separate executor module, OR relax the no-logic rule.
- **Classification:** mechanical (contradiction between §5.3 and §5.7).
- **Disposition:** auto-apply. Relax the §5.3 rule — `registry.ts` may also contain the `skillExecutor` const that closes over `SKILL_HANDLERS`. Update the §5.3 rule wording: "imports from every `handlers/*` module and assembles. May also export the `skillExecutor` const that closes over `SKILL_HANDLERS` (so the closure stays in the same module). No other logic."

### FINDING #6 — Codex #10 + Rubric — §7 Chunk 13 missing `resolveAgentOwner`
- **Description:** `resolveAgentOwner` (line ~2356) is used by all calendar.* and slack.* handlers but is not placed in any chunk.
- **Suggested fix:** Add to Chunk 13 in a shared support module that both calendar.ts and slack.ts import.
- **Classification:** mechanical (function-inventory drift — handler placed but its required helper isn't).
- **Disposition:** auto-apply. Place `resolveAgentOwner` in a shared sibling — the cleanest place is `skillExecutor/handlers/userOwnedAgentOwner.ts` (a tiny helper module that both `calendar.ts` and `slack.ts` import). Document the one-way edge (calendar.ts → userOwnedAgentOwner.ts ← slack.ts) explicitly.

### FINDING #7 — Codex #11 — §7 Object.assign coverage of support slugs
- **Description:** The line 2210 `Object.assign(SKILL_HANDLERS, {...})` block contains 10 support.* slugs. The spec lists `support.ts` as a "post-registration merge" placeholder in §5.2 but doesn't enumerate the slugs in §7 Chunk 13.
- **Suggested fix:** Record the slug set in Chunk 13.
- **Classification:** mechanical (file-inventory drift — slug set unspecified).
- **Disposition:** auto-apply. Add the 10 support.* slug names to Chunk 13's description.

### FINDING #8 — Codex #13 — §10 lists three non-importers
- **Description:** `agentExecutionEventServicePure.ts`, `chargeRouterService.ts`, and `crmQueryPlanner/plannerEvents.ts` contain only string literals or comments referring to "skillExecutor" — they do NOT import from `skillExecutor.ts`.
- **Suggested fix:** Remove from caller sweep or mark as textual references.
- **Classification:** mechanical (false caller entries, verified by grep).
- **Disposition:** auto-apply. Remove all three from §10.

### FINDING #9 — Codex #14 — §10 wrong symbol + wrong file count
- **Description:** `optimiser/runOptimiserScan.ts` imports `skillExecutor` (value), not `SkillExecutionContext`. `systemMonitor/skills/*.ts` is 11 files, not 10.
- **Suggested fix:** Correct the entries.
- **Classification:** mechanical.
- **Disposition:** auto-apply. Fix both.

### FINDING #10 — Codex #15 — Anti-chunk discipline: SkillExecutionParams and adapter-targets
- **Description:** Exporting `SkillExecutionParams` and transitionally exporting private adapter target handlers would expand public surface beyond today's exports.
- **Suggested fix:** Don't export them unless §4 explicitly permits expansion.
- **Classification:** mechanical (same root as Finding #1 and Finding #2 — addressed by those fixes).
- **Disposition:** subsumed by #1 and #2. No additional action.

### FINDING #11 — Rubric — Three-piece SKILL_HANDLERS assembly
- **Description:** Source uses one literal (line 439) + two `Object.assign(SKILL_HANDLERS, {...})` blocks (lines 2210, 2374). Spec §6 enumeration calls this "a 2,054-line object literal" — wrong shape.
- **Suggested fix:** Update §6 to acknowledge the three-piece assembly; add a one-line note in §7 Chunk 14 that the new `registry.ts` consolidates the three pieces into a single assembled map.
- **Classification:** mechanical.
- **Disposition:** auto-apply.

### FINDING #12 — Codex #1, #2, #3, #5, #16 — confirmations
- **Description:** Codex confirmed five rows are accurate (skillExecutor, SKILL_HANDLERS, SkillExecutionContext, SkillHandler/registerProcessor/setHandoffJobSender, requireSubaccountContext placement).
- **Classification:** not-a-finding (positive confirmations).
- **Disposition:** none — captured for the final report.

### FINDING #13 — Codex #12 — helper inventory
- **Description:** Codex confirms most helpers placed; only `resolveAgentOwner` is the omission.
- **Classification:** confirmation of Finding #6 — subsumed.

## Iteration 1 Summary (running totals — will finalise after fixes apply)

- Mechanical findings to apply: 9 (#1, #2, #3, #4, #5, #6, #7, #8, #9, #11)
- Subsumed/confirmations: 4 (#10, #12, #13, and Codex #1/#2/#3/#5/#16 covered by #12)
- Directional/Ambiguous: 0
- Auto-rejected (framing/convention): 0
- AUTO-DECIDED: 0

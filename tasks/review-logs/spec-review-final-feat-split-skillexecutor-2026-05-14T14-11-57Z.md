# Spec Review Final Report

**Spec:** `tasks/builds/feat-split-skillexecutor/spec.md`
**Spec commit at start:** (untracked draft — initial author-side commit was the same session's first commit)
**Spec commit at finish:** `75cc6450`
**Spec-context commit:** `62497257bb53bc99cf55b9f442af951cf4ddd318`
**Iterations run:** 4 of 5
**Exit condition:** two-consecutive-mechanical-only (actually four consecutive mechanical-only rounds — the heuristic triggered after iteration 2 but the operator chose to continue through iterations 3 and 4 because each prior iteration's larger structural edits surfaced new mechanical findings)
**Verdict:** READY_FOR_BUILD (4 iterations, 24 mechanical fixes applied, 0 directional findings remain unresolved, 0 AUTO-DECIDED items routed to tasks/todo.md)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 16 | 10 (rubric pre-pass) | 9 (12 of 16 codex confirmations subsumed) | 0 | 0 | 0 | none |
| 2 | 6  | 0 | 6 | 0 | 0 | 0 | none |
| 3 | 7  | 0 | 7 | 0 | 0 | 0 | none |
| 4 | 2  | 0 | 2 | 0 | 0 | 0 | none |

**Totals:** 31 distinct codex findings + 10 rubric findings → 24 mechanical fixes applied across 4 iterations. 0 directional findings. 0 ambiguous findings.

---

## Mechanical changes applied

Grouped by spec section:

### §1 / Frontmatter
- (no changes)

### §4 — Public-Surface Lock
- Removed `SkillExecutionParams` row (it is NOT exported in source — verified by reading line 231 `interface SkillExecutionParams` without `export`).
- Corrected consumer lists for `skillExecutor`, `SKILL_HANDLERS`, `SkillHandler` rows against actual `grep` results.
- Added an explicit note that `SkillExecutionParams` stays private — exporting it would be a public-surface expansion requiring its own amendment.

### §5.2 — Directory Layout
- Removed `SkillExecutionParams` from `context.ts` entry.
- Corrected slack slug list (6 slugs: `list_channels`, `read_channel`, `search_messages`, `summarise_thread`, `post_message`, `post_dm`). Earlier draft used non-existent `list_users` / `list_messages`.
- Added `support.classify_ticket` (inline at source line 840) to `handlers/support.ts`.
- Moved methodology from `pages.ts` into its own `methodologyStubs.ts` (single owner per §5.2.1).
- Removed `analyse_pipeline`/`draft_followup`/`detect_churn_risk` from `crm.ts` (they dispatch via `executeMethodologySkill` so they belong with sibling stubs).
- Added 14 new handler modules to cover the 214 source slugs: `methodologyStubs.ts`, `autoGatedStubs.ts`, `reviewGatedProposers.ts`, `thinDispatchers.ts`, `systemMonitorShells.ts`, `optimiserShells.ts`, `spendShells.ts`, `configShells.ts`, `crm.ts`, `orgInsights.ts`, `output.ts`, `threadContext.ts`, `notifyOperator.ts`, `mediaTranscription.ts`, `capabilityDiscovery.ts`, `digest.ts`, `memoryBlock.ts`, `financialReporting.ts`, and `userOwnedAgentOwner.ts`.
- Moved `run_playwright_test` and `analyze_endpoint` from `devContext.ts` to `web.ts` to match Chunk 4.
- Moved `write_patch`/`run_command`/`create_pr` to `handlers/devContext.ts` alongside `proposeDevopsAction` (they route via `proposeDevopsAction`, not `proposeReviewGatedAction`).

### §5.2.1 — NEW Stub/Thin-Dispatcher Placement Rule
- Added a complete new sub-section that enumerates the three stub shapes (`executeMethodologySkill`, `executeWithActionAudit` stub, `proposeReviewGatedAction` thin-wrap) and assigns each shape to its own catch-all module.
- Added an explicit slug-placement precedence rule: §5.2 domain modules win over §5.2.1 catch-all stub modules.

### §5.3 — Dependency Direction
- Expanded `pipeline.ts` import list to cover `enqueueHandoff` dependencies: `db`, schema tables (`subaccountAgents`/`agents`/`agentRuns`), drizzle helpers (`eq`/`and`/`isActive`), `MAX_HANDOFF_DEPTH`, `createEvent`, `AGENT_HANDOFF_QUEUE`.
- Expanded `adapter-registration.ts` import list to cover the full dispatch: `createWorkerAdapter`, `resolveActionSlug`, page executors from `handlers/pages.ts`, worker-approved executors from `handlers/delegation.ts`, plus the two inline `await import(...)` dispatch arms (`config_update_organisation_config` and `notify_operator`).
- Relaxed `registry.ts` "no logic" rule to admit the `skillExecutor.execute` closure (with its MCP dispatch + unknown-skill branch).
- Replaced the stale `tasks.ts → handoff.ts` cross-edge exception with the two real edges: calendar/slack → `userOwnedAgentOwner.ts`, and tasks/handoff → `pipeline.ts`.

### §5.7 — Barrel re-export shape
- Removed `SkillExecutionParams` from the type re-export list.

### §6 — Current State
- Split concern 1 to give precise line ranges per symbol (`SkillExecutionContext` 137-229, `SkillExecutionParams` 231-243, `SkillHandler` 426-429).
- Rewrote concern 4 to acknowledge the three-piece `SKILL_HANDLERS` shape (one literal + two `Object.assign` blocks at lines 2210 and 2374).
- Corrected concern 4's slug counts: "12 slugs (6 calendar + 6 slack)" not "11"; total ~214 not ~200.
- Rewrote concern 7 with precise line anchors for every one-off helper.

### §7 — Chunked Migration Plan
- Added a "Sequencing rule for the worker-adapter `registerAdapter('worker', ...)` call" paragraph that explains why adapter extraction goes LAST (Chunk 13).
- Reordered chunks: adapter-registration moved from former Chunk 4 to current Chunk 13 (after `handlers/pages.ts` Chunk 9 and `handlers/delegation.ts` Chunk 12 both exist).
- Added five sub-chunks (10a-10e) that land the new modules introduced by §5.2.1 (methodology stubs, auto-gated stubs, reviewGated proposers, system-monitor/optimiser/spend/config shells, CRM, org-insights, output, threadContext, notifyOperator, memoryBlock, financialReporting, mediaTranscription, digest, capability-discovery, thin-dispatchers).
- Renumbered Chunk 11 → 11, Chunk 12 → 12 (after the 10a-10e expansion).
- Updated Chunk 9 to explicitly state methodology lives in `methodologyStubs.ts` (Chunk 10a), NOT in `pages.ts`.
- Corrected Chunk 10 `import_n8n_workflow` slug name (snake_case slug, camelCase function name).

### §10 — Caller Sweep
- Removed three falsely-listed non-importers: `agentExecutionEventServicePure.ts`, `chargeRouterService.ts`, `crmQueryPlanner/plannerEvents.ts` (they reference "skillExecutor" only as string literals).
- Corrected `optimiser/runOptimiserScan.ts` symbol — imports `skillExecutor` value, not `SkillExecutionContext`.
- Corrected systemMonitor/skills file count to 11 (was 10) and enumerated each filename.
- Added `agentRecommendations.skillExecutor.test.ts` as a real test consumer (dynamic `await import('../skillExecutor.js')` for `SKILL_HANDLERS`).
- Added new vi.mock subsection naming the three test files that mock the barrel path.
- Added a NOT-importers subsection covering six additional textual-only references.
- Added the precise `grep` command Chunk 15's sweep should use to filter to real imports only.

### §11 — Open Questions
- Resolved all three OQs based on iteration findings:
  - Adapter-registration extraction: now in Chunk 13 (after `pages.ts` and `delegation.ts` exist), with the §7 sequencing rule paragraph as the canonical reference.
  - Worker-adapter dispatch un-listed types: preserved exactly; named the two dynamic-import dispatch arms explicitly.
  - `buildSupportPrincipal`: in `handlers/support.ts`.
- Added new OQ #4 (resolved): `resolveAgentOwner` placement → `handlers/userOwnedAgentOwner.ts`.

### §12 — Self-Consistency Pass
- Updated every ✓ line with the post-iteration verification note.

---

## Rejected findings

None. All 24 codex and rubric findings classified as mechanical were accepted and applied. No findings were classified as directional (which would have triggered Step 7 autonomous decision) — every issue was a contradiction, file-inventory drift, or sequencing bug that the spec had already decided how to handle.

---

## Directional and ambiguous findings (autonomously decided)

None. The spec stayed within the framing assumptions throughout (pre-production, static-gates testing posture, no feature flags, prefer existing primitives, no behaviour change as the build's core invariant).

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review. The 24 mechanical fixes covered: public-surface accuracy, dependency-direction soundness, slug-to-module mapping completeness, chunk-sequencing soundness, caller-sweep accuracy, and ~10 numeric/naming consistency fixes.

However:

- The review did not re-verify the framing assumptions at the top of this document. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's §3 Framing Assumptions and §13 Testing Posture Statement before calling the spec implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement.
- The review did not prescribe what to build next. Sprint sequencing, scope trade-offs, and priority decisions are still the human's job.
- The spec's biggest single risk surface is the §5.2.1 stub/thin-dispatcher rule. It assigns ~150 slugs to ~14 new modules. Each slug's destination was verified at least once during iterations 2-4 against the source, but the operator should expect that the actual implementation will surface 1-3 placement edge cases that need amendment during Chunks 10a-10e.

**Recommended next step:** read the spec's framing sections (§3 + §13) one more time, confirm the goals match your current intent, then start implementation. The `architect` agent can decompose the chunked plan into a buildable order; the `builder` agent can land Chunks 1-3 first as smoke tests before tackling the larger handler-family chunks.

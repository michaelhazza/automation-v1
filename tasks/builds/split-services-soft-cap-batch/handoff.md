# Handoff — split-services-soft-cap-batch

## Phase 2 (BUILD) — complete

**Plan path:** tasks/builds/split-services-soft-cap-batch/plan.md
**Chunks built:** 23 commits across 27 planned chunks (4 chunks — Q5, A7, W5, L4 — folded into their predecessor because the barrel-thinning contract was satisfied earlier than expected)
**Branch HEAD at handoff:** `d3f213f8` (post dual-reviewer log housekeeping)
**G1 attempts (per chunk):** average 1.2, max 2 (W2 needed a fix-up round to wire the barrel after the initial builder created files but didn't remove the source bodies)
**G2 attempts:** 1 (clean)

### Review verdicts

| Reviewer | Verdict | Notes |
|---|---|---|
| spec-conformance | NON_CONFORMANT → CONFORMANT after rebase | 1 directional gap: positional gate-baseline drift in `canonical-retry.txt` (4 entries) + `no-silent-failures.txt` (1 entry). Rebased in `fe6357ca`. Count 4→4, 1→1 preserved. |
| adversarial-reviewer | skipped — diff does not match §5.1.2 security surface (per GRADED policy) | No auth / permission / orgScoping / tenantContext / routes / schema / webhook files in diff |
| pr-reviewer R1 | CHANGES_REQUESTED | 1 BLOCKING: callerAssert.ts regex broke after split. 5 should-fix, 3 consider. |
| pr-reviewer R2 (post fix-loop) | APPROVED | 1 consider-tier note routed to SOFTCAP-PURE-llmRouter-1 follow-up. |
| reality-checker | READY | 9 of 10 criteria verified; criterion 10 (todo.md closures) deferred to finalisation per scope |
| dual-reviewer | APPROVED | Codex 1 iteration, zero findings |
| chatgpt-pr-review | (Phase 3) | Enforced at Phase 3 by finalisation-coordinator |

### REVIEW_GAP entries

```
REVIEW_GAP: chatgpt-plan-review | task-class: Significant | reason: Operator delegated autonomous mode; manual ChatGPT-web review loop incompatible | operator-override: yes-2026-05-15T-autonomous-mode-directive | remediation: chatgpt-pr-review at Phase 3 covers second-opinion pass
```

### Fix-loop iterations

1 iteration applied 4 fixes from pr-reviewer R1 in commit `8209bc2c`:
- BLOCKER: widened `callerAssert.ts` regex to match both `llmRouter.ts` and `llmRouter/<sub>.ts`
- should-fix: made `queueWorkerReady` module-private
- should-fix: unified orchestrator try/catch wrapping all 13 stages
- should-fix: updated `architecture.md:2821` skillAnalyzerJob row

### Doc-Sync gate

- architecture.md updated: yes (Key files per domain — skillAnalyzerJob.ts row replaced with barrel + sibling-tree pair, mirroring skillAnalyzerService precedent at lines 2817-2818)
- capabilities.md updated: n/a: internal refactor with no capability surface change
- integration-reference.md updated: n/a — no integration changes
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: no — no convention or build-discipline change introduced by this split
- CONTRIBUTING.md updated: n/a — no lint-suppression / comment-format change
- frontend-design-principles.md updated: n/a — server-only refactor
- KNOWLEDGE.md updated: yes (2 entries — "When telling builder to move X to Y, spell out BOTH halves" + "Static gate path-pattern regexes need updating when files move to subdirectories")
- spec-context.md updated: n/a — not a spec-review session
- docs/decisions/ updated: n/a — no durable architectural choice locked
- docs/context-packs/ updated: n/a — no anchor changes in architecture.md
- references/test-gate-policy.md updated: n/a — no gate posture change
- docs/incident-response.md updated: n/a
- .claude/FRAMEWORK_VERSION updated: n/a — no framework-level change

### Open issues for finalisation

- **SOFTCAP-PURE-llmRouter-1** — `routeCall.ts` ships at 1637 LOC (>1500 soft cap). Gate exempts sub-directory files but the deferral is documented. Follow-up should: (a) extract a `RouterCallContext` value-type to split phases 5-8 + 9-12 into peer files; (b) widen `scripts/verify-no-direct-adapter-calls.sh` filter to cover the `llmRouter/` sub-tree; (c) add Vitest test for `callerAssert.ts` regex.
- **SOFTCAP-PURE-{agentService,workspaceMemoryService,queueService,skillAnalyzerJob}-1** — Pure extraction opportunities surfaced during the split (e.g., RRF scoring in `hybridRetrieval.ts`, classification prompt builder in `stage5Classify.ts`). Deferred per spec §3 no drive-by cleanup.
- **tasks/todo.md line 296 (Area 10 soft-cap register)** and **SA3** — closure markers to be added by finalisation-coordinator in the merge commit (`[status:closed:pr:<num>]`).

### Final barrel sizes

| Target | LOC | Status |
|---|---|---|
| `server/services/agentService.ts` | 39 | thin barrel |
| `server/services/queueService.ts` | 29 | thin barrel |
| `server/services/workspaceMemoryService.ts` | 45 | thin barrel |
| `server/services/llmRouter.ts` | 46 | thin barrel |
| `server/jobs/skillAnalyzerJob.ts` | 1 | thin barrel |
| **Total** | **160** | all well under 250 cap |

### Sub-module tree summary

- `server/services/agentService/` — 10 sub-modules (types, helpers, caches, scheduler, externalFetchers, dataSourceScope, crud, agentDataSources, scheduledTaskDataSources, agentFullView)
- `server/services/queueService/` — 8 sub-modules incl. `maintenanceJobs/` subdir (types, backend, executionProcessor, enqueueHelpers, migrationAdapter, maintenanceJobs/{intervalFallback, pgBossRegistrations, start})
- `server/services/workspaceMemoryService/` — 13 sub-modules (types, hydeCache, quality, hybridRetrieval, graphExpansion, read, extract, retrieve, entities, dedup, decayAndEmbedding, enrichmentJob, regenerateSummary)
- `server/services/llmRouter/` — 7 sub-modules (types, billing, cooldown, fallbackMap, ieeResolver, aggregateEnqueue, routeCall)
- `server/jobs/skillAnalyzerJob/` — 16 sub-modules (orchestrator, types, helpers, stage1Parse, stage2Hash, stage3Embed, stage4Compare, stage4bNonSkillDetect, stage5Classify, stage5bCrossBatchCollision, stage5cSourceFork, stage6AgentEmbed, stage7AgentPropose, stage7bAgentSuggest, stage8WriteResults, stage8bClusterRecommend)

### Cross-target import audit

Only 2 cross-target edges exist, both pre-existing, both into `llmRouter.routeCall`:
1. `server/jobs/skillAnalyzerJob/stage*.ts` → `routeCall` from `'../../services/llmRouter.js'` (barrel path)
2. `server/services/workspaceMemoryService/extract.ts` → `routeCall` from `'../llmRouter.js'` (barrel path)

Both resolve through the public barrel. No internal-path imports leaked.

### Public-surface preservation

All locked exports (per spec §5 + plan §1) preserved byte-for-byte. Verified by:
- `build:server` exits 0 (caller compile proof)
- Cross-target grep — no caller imports from internal sub-module paths
- `callerAssert.ts` runtime guard widened to accept both barrel and sub-module frames

---

## Phase 3 entry point

Ready for finalisation-coordinator.

**Branch:** `claude/split-services-soft-cap-batch` at `d3f213f8`
**PR:** (to be created at Phase 3 start)
**Required reviewers in Phase 3:** chatgpt-pr-review (manual ChatGPT-web rounds — operator-driven)

The branch is in a known-good state: G2 clean, all reviewers green, doc-sync recorded, 2 KNOWLEDGE.md patterns appended. Ready to merge after chatgpt-pr-review and `tasks/todo.md` closures land.

# Wave 5 Session K — cleanup + CI consolidation 6→3

Single coordinated PR. Standard-class light-pipeline. ~25 items covering Wave 4 carry-forward debt + spec-conformance deferrals + CI workflow consolidation + stale-status sweep.

**Paste the block below as the opening message of a fresh Claude Code session in Env K.**

---

## Header

```
Wave 5 Session K — cleanup + CI consolidation 6→3. Standard-class
light-pipeline. No spec-coordinator. Scope locked below. ~25 items
in one coordinated PR. Final consolidation pass before pre-prod.

Work in order: must-fix correctness items first (PP-AE2 violations
already flagged by gate), then debt batch, then spec-conformance,
then tests, then CI consolidation, then stale-status sweep at the
end.
```

## Branch + sync

```
1. Sync and branch:
     git fetch origin main
     git checkout -b claude/wave-5-cleanup-and-ci-consolidation origin/main

2. Verify Wave 4 merge state:
     git log --oneline -10
   Should show Wave 4 PRs #329 (Session I'), #330 (Session E),
   #331 (Session H), #332 (Session G) merged.
```
## Wave 4 builder debt (W4AA-DEBT-1..19)

```
MUST-FIX FIRST (PP-AE2 gate currently failing CI):
- W4AA-DEBT-15: 3 PP-AE2 violations in server/services/skillExecutor/handlers/tasks.ts.
  Line 575: void insertExecutionEventSafe({eventType:'tool.error',...}) → await
  Line 693: void insertOutcomeSafe({outcome:'rejected'}) → await
  Line 711: void insertExecutionEventSafe({eventType:'tool.error',...}) → await
  All three match §5.1 critical-event invariant. Gate blocks merge until fixed.

CORRECTNESS / DRIFT:
- W4AA-DEBT-1: 17 action-registry entries have no skill .md file on disk
  (assign_task, cached_context_budget_breach, canonical_dictionary, ...).
  Decision (chunk 0): create stub .md files OR remove from registry.
  Default: create stubs marked [INTERNAL: no LLM description needed]
  for the registry entries that are internal-only (e.g. notify_operator,
  scan_integration_fingerprints, workflow.run.start); remove the rest
  if they're truly dead.
- W4AA-DEBT-2: dot-qualified registry keys vs flat underscore filenames
  for calendar/slack/ea skills. Fix: extend the snapshot comparator rule
  X.Y ↔ X_Y for single-level namespaces. ~5 LOC in comparator.
- W4AA-DEBT-3: workflow-bulk-parent-check in JOB_CONFIG but no handler
  anywhere. Decision (chunk 0): implement the handler OR remove from
  JOB_CONFIG. Default: remove (treat as cruft from Sprint 4 P3.1 placeholder).
- W4AA-DEBT-4: madge peer deps not in node_modules locally
  (dependency-tree, commander). Fix: pin in package.json so npm install
  resolves them. ~3-line package.json change.
- W4AA-DEBT-12: workflow-drafts-cleanup absent from chunk-0 inventory.
  Already added to JOB_CONFIG by W4 G chunk 3a; verify presence + add
  to a baseline check.
- W4AA-DEBT-13: iee-cost-rollup-daily vs iee-browser:daily-cost-rollup
  two queue names for one concept. Decision (chunk 0): unify OR document
  both. Default: document — iee-cost-rollup-daily is external worker,
  iee-browser:daily-cost-rollup is main-app handler. Add KNOWLEDGE.md
  entry.
- W4AA-DEBT-14: refresh_optimiser_peer_medians + refresh_memory_utility_30d
  use underscore convention vs project's kebab-case for queue names.
  Decision (chunk 0): rename now (with pg-boss schedule migration) OR
  document as exceptions. Default: document — renaming requires a
  schedule migration and the cost outweighs the benefit pre-v1.
- W4AA-DEBT-18: warning path in scripts/verify-handler-registry-fixture.sh
  doesn't propagate to shell. ~5 LOC: parse VERDICT_WARNINGS, bump
  WARNINGS counter.
- W4AA-DEBT-19: Node heredoc Windows path expansion. Use quoted
  'NODEEOF' delimiter or pass CONFIG_FILE via env var.
- W4AA-DEBT-16: missing Vitest unit test for persistAndAnnounce
  UPDATE-claim branch. ~30 LOC test file.
- W4AA-DEBT-17: re-seed scripts/.gate-baselines/duplicate-blocks.txt
  post-DUP6 extract. Run jscpd, update baseline.
- W4AA-DEBT-11: comparesTables in idempotencyContract are best-effort
  guesses. Defer to v2-backlog (review responsibility per spec §6.1 C1;
  not a gate check).
```

## Wave 4 spec-conformance deferrals

```
- F-1 (W4H REQ C1.9): §8 acceptance #1 literal grep test over-broad
  (returns 7 hits). Tighten the grep to exclude setHandoffJobSender,
  SKILL_HANDLERS in 4 specific files, the export type re-export in
  tools/meta/types.ts, and the test fixture. Semantic CD1 cycle break
  IS achieved; grep just needs refining.
- F-2 (W4H REQ D4.2): DUP4 spec §6.4 references a MessageRender named
  export that doesn't exist. Actual exports: renderAssistantContent,
  renderInlineMarkdown, renderBold. Update spec to match.
- F-3 (W4H REQ D8.2): DUP8 missed webhookReplayNoncePruneJob conversion.
  Migrate server/jobs/webhookReplayNoncePruneJob.ts to the
  definePruneJob factory pattern used for the other 5 prune jobs.
- F-4 (W4H REQ A.4): npm run build:server fails on pre-existing main
  issue (missing docx + mammoth modules). Branch did not introduce.
  Action: investigate root cause; if main is genuinely broken, fix
  here. If transient, document.
- REQ #36 (W4G MC7): double-fire equivalence assertion not actually
  executed. The MC7 test currently registers handlers but doesn't
  assert that double-fire produces equivalent side effects. Add the
  assertion: capture DB state after first fire, fire again, capture
  again, compare.
- REQ #37 (W4G integration tests MC8/MC10/MC2/MC3/MC11/MC12): tests
  skip behavioral assertions outside NODE_ENV=integration. Either
  enable integration mode in CI (matches existing integration_tests
  job pattern) OR remove the conditional skip and let tests run
  always.
```
## Wave 3 deferred tests

```
Three small tests from Wave 3 review pipeline (PR #330). Each is ~15 LOC.

- Test clampMigrationConcurrency (T2 fix): extract the
  Math.max(1, Math.min(32, ...)) + NaN guard from
  server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:731-734
  into a pure helper. Pin: "abc"/""/undefined/"-5" → 8; "1000" → 32;
  "3.7" → 3.
- Test assertInboxScope SUPPORT-PATCH-SCOPE-ORDER invariant:
  hand-rolled inbox + principalCtx with mismatched subaccountId must
  throw 403 (support.inbox.scope_mismatch) BEFORE body-validation.
- Test stage5cSourceFork filter-by-index (F1 fix): input group with
  display names ["A","A","B"] must produce warnings where every
  candidate sees the other two in others, including the
  duplicate-name sibling.
```

## PR #327 carry-forward bugs

```
Three pre-existing bugs the soft-cap split carried verbatim. Not
introduced by #327 but visible now. Fix the actual bugs (not just
the tests above — those test the fixes).

- F1: server/jobs/skillAnalyzerJob/stage5cSourceFork.ts:33-44.
  names.filter(n => n !== r.candidate.name) collapses duplicates when
  two candidates share a display name. Fix: filter by index/identity:
  group.filter((_, i) => i !== currentIndex).map(x => x.candidate.name)
- T1: server/services/llmRouter/routeCall.ts:449. The
  llm_router.budget_block_upsert_ghost warn condition has no metric
  or alert. Add a counter (use the existing structured logger.warn +
  emit a synthetic Langfuse span tag, OR add a Prometheus counter if
  one is already wired). At minimum: structured logger with severity:
  'warn' + counter increment via the existing metrics surface.
- T2: server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:726.
  Number(process.env.WORKSPACE_MIGRATION_CONCURRENCY ?? 8) has no
  upper clamp. Wrap with Math.max(1, Math.min(32, value)). Extract
  to clampMigrationConcurrency pure helper (tested by Wave 3
  deferred test above).
```
## CI workflow consolidation 6 jobs → 3

```
Operator-requested 2026-05-16. Current PR check matrix shows 6 status
checks; consolidate to 3 without losing coverage.

DROP ENTIRELY:
- .github/workflows/workspace-actor-coverage.yml. The exact same
  command (npx tsx scripts/verify-workspace-actor-coverage.ts) already
  runs as step 7 of CI / unit tests ("Verify workspace-actor coverage
  (Phase A gate)"). Pure duplication. Delete the workflow file.

FOLD INTO Lint + Typecheck:
- Move steps from "CI / Grep invariants (Phase 3 B.1-B.4)" job (17
  pure-bash grep steps, no DB, ~16s) into the lint_and_typecheck job
  in .github/workflows/ci.yml.
- Move steps from "CI / Portable framework tests" job (portable sync
  engine Vitest, no DB, ~34s) into the same lint_and_typecheck job.
- Combined job runs sequentially on the same ubuntu-latest runner
  without DB. Expected wall-clock ~3min total (currently ~2min for
  lint+typecheck alone).
- Rename the consolidated job to "Lint + Typecheck + Static gates"
  (or operator-confirmed name during chunk 0).

KEEP PARALLEL (no change):
- unit_tests (Postgres-backed, ~3-5min) — stays standalone
- integration_tests (Postgres-backed, ~5-8min) — stays standalone

RESULT: 6 jobs → 3 (unit_tests, integration_tests, lint_and_typecheck-plus).

TRADE-OFFS:
- Lose individual green dots for the 17 grep invariant steps and the
  portable framework job (still visible inside the consolidated job
  log).
- Any branch-protection rules referencing dropped check names
  ("Grep invariants (Phase 3 B.1-B.4)", "Portable framework tests",
  "Workspace Actor Coverage / verify") must be updated to reference
  the consolidated check.

POST-MERGE OPERATOR ACTION: update GitHub branch protection rules to
remove the dropped check names and add the new consolidated check
name. Document in PR body.
```

## Stale-status verify-and-flip

```
The Wave 4 merge commits did not always flip status in tasks/todo.md
when items were closed in code. Verify each candidate against current
main; if confirmed done, flip [status:open] →
[status:closed:pr:<NNN>:verified-in-main]. If NOT done, leave open.

Architect's chunk 0 produces a verification report; status flips land
in the same PR after operator review.

CANDIDATES (verify against main, do not auto-close):
- CD1 (skillExecutor ↔ workflowEngine super-cycle) — W4H spec §1.1
  claims structurally addressed via HandlerContext injection. Verify
  by running madge --circular and confirming only buildHandlerContext.ts
  value-imports BOTH skillExecutor + workflowEngineService.
- DUP1, DUP2, DUP3, DUP4, DUP5, DUP7, DUP8, DUP9 — W4H scoped all
  of these. Verify each shared module exists at the spec'd path.
  DUP8 webhookReplayNoncePruneJob handled separately above (F-3).
- FE1, FE4, FE5+FE6 — W4H scoped frontend complexity. Verify
  operate/HomePage.tsx tile count + SystemIncidentsPage.tsx LOC +
  the 4 dashboard pages' documented-acceptance headers.
- WF2 (workflowEngineService god-file post-split) — verify
  workflowEngineService.ts is now < 250 LOC (was 4,073). PR #319
  scoped this.
- WF5 (Workflow run permission inconsistency) — verify
  workflowRuns.ts routes use WORKFLOW_RUNS_* perms, not AGENTS_VIEW.
- F8 (manual-run idempotency 10s bucket) — per operator decision
  2026-05-15, this is documented-trade-off-only. Verify the inline
  comment + KNOWLEDGE.md pattern entry both exist; close as
  [status:closed:operator-decision:doc-only].
- AE1 (handoff fire-and-forget) — W4G scoped this. Combined with
  the W4AA-DEBT-15 must-fix above, AE1 is structurally addressed
  after this PR.
```
## Final checks

```
- npm run lint
- npm run typecheck
- npm run build:server (note: may fail on pre-existing docx/mammoth
  issue per F-4; investigate and fix if root cause is in this PR's
  scope)
- npm run build:client
- The PP-AE2 gate now exits 0 (W4AA-DEBT-15 must-fix complete)
- duplicate-blocks.txt baseline reflects post-DUP6 state
- Verify the consolidated CI workflow runs successfully:
    cat .github/workflows/ci.yml | grep -E "^  [a-z_]+:" | wc -l
  Expected: 3 jobs (unit_tests, integration_tests, lint_and_typecheck-plus)
- Run pr-reviewer. Apply blocker / strong-recommendation findings.
- Open PR titled "wave-5: cleanup + CI consolidation 6→3 + stale-status
  sweep (Session K)".
- PR body lists every closed tasks/todo.md item with line number.
- PR body explicitly calls out the GitHub branch-protection rule
  update operator action.
```

## File-overlap deconfliction

```
This session runs concurrently with Sessions L, M, N. File-overlap
analysis:

- Session L (capabilities backfill): touches docs/capabilities.md +
  tasks/todo.md sections lines 414-1175 (capability registry). Session
  K touches tasks/todo.md sections lines 280-340 (W4AA-DEBT) +
  1700-1880 (recent deferred). DIFFERENT SECTIONS — partition holds.
- Session M (LAEL + Hermes): touches server/services/llmRouter,
  agentExecutionService, workspaceMemoryService, skillExecutor,
  client/src/pages/AgentRunLivePage, RunCostPanel. Session K touches
  server/services/llmRouter/routeCall.ts (T1 metric — different line
  from M's emission sites), and server/services/skillExecutor/handlers/tasks.ts
  (W4AA-DEBT-15 await fix — different from M's skill.invoked/completed
  emission). COORDINATE ON LINE NUMBERS via chunk 0.
- Session N (prevention gates + RLS migration): touches scripts/*
  (new gates) and server/services/* (RLS migration on tenant queries).
  Session K touches scripts/verify-handler-registry-fixture.sh
  (W4AA-DEBT-18 + 19). Session K also touches
  server/jobs/webhookReplayNoncePruneJob.ts (F-3 DUP8) and
  server/services/skillExecutor/handlers/tasks.ts (W4AA-DEBT-15) —
  N's RLS migration may touch the same services. COORDINATE: K
  completes its targeted bug fixes BEFORE N's bulk RLS migration
  sweeps these files, OR architect coordinates merge order so K's
  smaller changes apply first.

If a merge conflict surfaces on tasks/todo.md, the conflict
resolution priority is: K's W4AA-DEBT closures > L's capability
backfill > N's stale-status sweep. Each session owns its own
sections; conflicts indicate cross-section edits that need operator
review.
```

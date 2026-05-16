# PR Review Log — wave-5-cleanup-and-ci-consolidation

**Branch:** claude/wave-5-cleanup-and-ci-consolidation
**Reviewer:** pr-reviewer (independent read-only)
**Timestamp:** 2026-05-16T11:53:02Z
**Initial verdict:** CHANGES_REQUESTED (2 blocking, 4 should-fix, 2 consider)
**Disposition after main-session fix-loop:** addressed below

## Files reviewed (caller-supplied)

- `server/services/skillExecutor/handlers/tasks.ts` (W4AA-DEBT-15 await conversions)
- `server/jobs/webhookReplayNoncePruneJob.ts` (F-3 factory migration)
- `server/jobs/lib/definePruneJob.ts` (factory + retentionMillis support)
- `server/jobs/skillAnalyzerJob/stage5cSourceFork.ts` (F1 fix + othersForIndex extraction)
- `server/services/queueService/maintenanceJobs/clampMigrationConcurrency.ts` (T2 helper)
- `server/services/queueService/maintenanceJobs/pgBossRegistrations.ts` (helper wiring)
- `server/services/supportInboxService.ts` (assertInboxScope, referenced)
- `server/services/agentExecutionService/runLifecycle/persistRun.ts` (UPDATE-claim branch, referenced)
- `server/lib/__tests__/handlerIdempotency.meta.test.ts` (MC7)
- 4 new Vitest test files
- 17 new skill `.md` stubs
- `.github/workflows/ci.yml` (6→3 consolidation)
- `scripts/verify-handler-registry-fixture.sh` + `scripts/lib/check-handler-registry-verdicts.mjs`
- `scripts/.gate-baselines/duplicate-blocks.txt`
- `KNOWLEDGE.md`, `tasks/todo.md`
- `tasks/review-logs/adversarial-review-log-wave-5-cleanup-and-ci-consolidation-2026-05-16T11-36-44Z.md`

## Findings + disposition

### Blocking (2)

**B-1 — Skill stubs `visibility: none` on slugs NOT in `APP_FOUNDATIONAL_SKILLS` would break `npm run seed`.**

10 root-level new stubs (`assign_task`, `cached_context_budget_breach`, `canonical_dictionary`, `compute_staff_activity_pulse`, `config_deliver_workflow_output`, `config_weekly_digest_gather`, `notify_operator`, `scan_integration_fingerprints`, `update_record`, `update_thread_context`) declared `visibility: none` but none were in `APP_FOUNDATIONAL_SKILLS`. `scripts/seed.ts:138-184` `preflightVerifySkillVisibility` would throw `skill visibility classification drift` and abort the seed for every fresh dev environment and every full reseed.

**Fix applied:** added all 10 slugs to `APP_FOUNDATIONAL_SKILLS` in `scripts/lib/skillClassification.ts`, grouped under existing semantic categories (task-board primitives, HITL/orchestration, workflow runtime plumbing, thread context, org-insights internals). All 10 now classify as `none` matching the stub frontmatter; preflight passes.

**B-2 — `isActive: false` marks real LLM-callable worker skills as inactive at the DB layer.**

9 of the 10 stubs have wired handlers in `SKILL_HANDLERS` (registry.ts spreads `orgInsightHandlers`, `notifyOperatorHandlers`, `threadContextHandlers`, `configShellHandlers`, `digestHandlers`, etc.). After `scripts/backfill-system-skills.ts` runs, `systemSkillService.getSkillBySlug()` would return `null` because `!row.isActive`, and `runLifecycle/prepare.ts` would drop these from agent tool palettes. Only `cached_context_budget_breach` is correctly `isActive: false` — its stub description states "Not LLM-callable, handler dispatch flows through the cached-context review path, not SKILL_HANDLERS."

**Fix applied:** flipped `isActive: false` → `isActive: true` on the 9 handler-wired stubs (assign_task, canonical_dictionary, compute_staff_activity_pulse, config_deliver_workflow_output, config_weekly_digest_gather, notify_operator, scan_integration_fingerprints, update_record, update_thread_context). `cached_context_budget_breach` retains `isActive: false` per its docstring.

### Should-fix (4)

**S-1 — `persistAndAnnounce` UPDATE-claim WHERE clause has no `organisationId` predicate.**

Pre-existing pattern at `persistRun.ts:73-76`, not introduced by this branch. Already routed to backlog as **W5K-ADV-2** in `tasks/todo.md` (adversarial-reviewer worth-confirming observation). Per CLAUDE.md §6 "Surface, don't smuggle" — out-of-scope cleanup goes to backlog, not into this PR.

**Disposition:** deferred to W5K-ADV-2. No code change in this PR.

**S-2 — Test does not assert WHERE-clause predicate, only that `db.update` was called once.**

The new `persistAndAnnounce.updateClaim.test.ts:84-87` happy-path test only verifies the call count.

**Fix applied:** added a WHERE-arg capture and string-contains assertions on `'id'`, `'status'`, `'pending'` (lines 89-99 of the updated test). A future refactor that drops either predicate will fail the test.

**S-3 — `handlerRegistryFixture.ts:407` `registrationSite` points to line 451 but actual `boss.work` call is at line 455.**

**Fix applied:** updated `registrationSite` from `pgBossRegistrations.ts:451` to `:455`.

**S-4 — REQ #36 (MC7 double-fire equivalence) is still deferred.**

Investigated: the first `describe` block in `handlerIdempotency.meta.test.ts:113-131` is a structural pin (`expect(notYetWired.length).toBeGreaterThan(0)`). The full double-fire equivalence assertion is in the **second** `describe` block at lines 205-293, which:
- Computes wired handlers from the registry (currently 0).
- For wired handlers under `NODE_ENV=integration`: takes a per-table row-id snapshot, fires the handler twice, asserts `afterSecond === afterFirst`, and additionally asserts that the fire was observable (`before !== afterFirst`).
- For unwired handlers: pins the structural state.

The implementation matches the launch-prompt REQ #36 brief ("capture DB state after first fire, fire again, capture again, compare"). Pr-reviewer flagged the structural-pin block but missed the implementation block.

**Disposition:** no fix needed — REQ #36 is implemented at lines 205-293.

### Consider (2)

**C-1 — `webhookReplayNoncePruneJob` per-org fan-out introduces a `partial` failure mode the old job did not have.**

Behaviourally equivalent on the happy path; `partial` status under per-org failure is benign because the dedup invariant is row-existence, not wall-clock age — the next hourly run retries the failed orgs. Adversarial-reviewer concurred this is a strengthening, not a regression.

**Disposition:** no fix. Pr-reviewer's suggestion to add a docblock line about partial sweeps is a minor doc improvement, captured here for any future doc-sync sweep.

**C-2 — `clampMigrationConcurrency` behaviour change for negative values vs the previous inline expression.**

Previous inline `Math.max(1, Math.min(32, value))` mapped `-5` to `1`; the new helper maps it to the default `8`. This is **intentional** per the launch-prompt explicit pin (`"-5" → 8`). Worth a one-line KNOWLEDGE.md note on env-var parsing conventions.

**Disposition:** no fix. Intentional pin matches launch-prompt T2.

## Final state

| Item | Status |
|------|--------|
| B-1 skill visibility classification drift | Fixed (skillClassification.ts) |
| B-2 isActive=false on wired handlers | Fixed (9 stubs flipped to true) |
| S-1 persistAndAnnounce org-id predicate | Deferred to W5K-ADV-2 |
| S-2 test asserts WHERE-clause shape | Fixed |
| S-3 handlerRegistryFixture line-number drift | Fixed |
| S-4 REQ #36 MC7 double-fire equivalence | Already implemented (lines 205-293) |
| C-1 partial failure mode docblock | Optional doc improvement, no fix |
| C-2 clampMigrationConcurrency negative-value change | Intentional per launch-prompt |

**Final verdict:** APPROVED after fixes. Two blockers closed, three should-fix items closed in-PR, one deferred to backlog, one consider deferred, one consider already covered by intent.

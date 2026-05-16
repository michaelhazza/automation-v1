# Wave 3 Session E — cleanup + housekeeping + foundational + Wave 1 audit residue

Single coordinated PR. No spec-coordinator. Scope locked below. Runs AFTER Wave 2 (Sessions A-D) merges to main.

**Paste the block below as the opening message of a fresh Claude Code session in Env E.**

---

## Header

```
Wave 3 Session E — cleanup + housekeeping + foundational + Wave 1
audit residue. Single coordinated PR. Standard-class, no spec-coordinator.

PREREQUISITE: Wave 2 Sessions A, B, C, D must be merged to main before
launching this session. Verify on entry with: gh pr list --state merged
| head -20

Scope locked below. Work in order: verification first, then quality,
then mechanical, then docs/decisions.
```

## Branch + sync

```
1. Sync and branch:
     git fetch origin main
     git checkout -b claude/wave-3-cleanup-and-foundational origin/main
   
   Verify Wave 2 merge state:
     git log --oneline -10
   Should show recent Wave 2 PR merges (audit sweep, soft-cap splits,
   sandbox safety, PA-V1 cleanup).
```
## Stale todo housekeeping

```
Close these tasks/todo.md items by replacing [status:open] with
[status:closed:pr:<this-PR-num>]. Verify each is genuinely done BEFORE
flipping (grep the file/migration; if not done, do not close):

- Line 295: Area 10 god-file hard-cap register — verify all 8 listed
  files under hard cap.
- Line 1559: F4 — agentExecutionService directory has no raw db.* on
  tenant tables.
- Line 1561: F6 — skillExecutor + agentExecutionService under hard cap.
- Line 1582: WF1 — 5 FK-scoped workflow tables (workflow_step_runs,
  workflow_step_reviews, workflow_studio_sessions,
  workflow_run_event_sequences, flow_step_outputs) have RLS policies.
  PR #319 did NOT visibly land a workflow-RLS migration. If still
  missing, this becomes the WF1 migration in the next section.
- Line 1584: WF3 — server/services/workflowEngine/ raw db.* migrated.
- Line 1585: WF4 — queueLifecycle/tick.ts + watchdog.ts wrap DB work
  in withOrgTx.
- Line 1587: WF6 — workflowAgentRunHook.ts uses getOrgScopedDb.
- Line 1596: Q1 — superseded by Q2 (closed:pr:317). Close as
  [status:closed:superseded:q2].
- Lines 1623-1625: R4/R5/R6 — duplicates of lines 1630-1632 (closed:
  pr:317). DELETE the duplicate entries entirely from the file.
```

## Wave 1 audit residue

```
- WF1 migration (if missing): author migrations/<NNNN>_workflow_fk_tables_rls.sql
  + .down.sql with parent-EXISTS policies joining through workflow_runs.
  Update server/config/rlsProtectedTables.ts allowlist. Verify
  scripts/verify-rls-coverage.sh + verify-rls-protected-tables.sh pass.
- F4 residue: any remaining raw db.* inside server/services/agentExecutionService/
  on a tenant table → migrate to getOrgScopedDb.
- F7: server/services/skillExecutor/ post-#311 directory — locate the
  legacy line:4302 db.update(tasks) site in the new layout, migrate to
  getOrgScopedDb. Remove guard-ignore-next-line if trust chain cleans up.
- F8: server/routes/agentRuns.ts:54-55 manual-run idempotency 10s bucket
  — per operator decision 2026-05-15, DOCUMENT trade-off only. Inline
  comment + KNOWLEDGE.md pattern entry. No code change.
```
## Foundational / pre-prod-boundary

```
- Multer 500MB memory storage (DoS risk) at server/middleware/validate.ts:17-20
  — reduce limit to spec-mandated value (likely 25-50MB based on actual
  document sizes the product supports). Add size-rejection error path
  with structured logger. Audit upload-handling routes to confirm no
  caller relies on the 500MB ceiling.
- In-memory rate limiting lost on restart / bypassed in multi-process at
  server/routes/auth.ts:14-30 — switch to a Redis-backed limiter OR
  Postgres-backed limiter. Match the existing pattern used in
  llmBudgetGuard (if Postgres-backed) for consistency. If neither exists,
  author server/lib/rateLimiter.ts with Postgres backing.
- OAuth state JWT window (5min) — review the 30-day telemetry. If no
  real auth failures, close CHATGPT-R1-7 as confirmed. If failures
  observed, propose a revert with rationale.
```

## Code-quality batch

```
- Line 301: agentBeliefService.ts:124-403 custom retry loop — extend
  withBackoff with storm cap. Cleaner than documenting divergence.
- Line 302: enqueueHandoff silent depth-cap at skillExecutor/<new-location>:3988-3994
  — replace console.warn with structured logger.warn + Langfuse span tag.
- Line 303: 3 silent .catch(() => {}) in agentExecutionService at legacy
  lines 1157, 1240, 1368 — locate in the post-#314 directory layout,
  annotate each with guard-ignore + WHY comment.
- Line 320: agentExecutionService.ts:72-116 comment cluster (WHAT-prose
  residue) — delete. Re-verify after #314 split; close without action
  if already removed.
- Line 1640: SUPPORT-PATCH-SCOPE-ORDER (operator-approved fix) —
  server/routes/support/supportAgentRoutes.ts. Add verifyOwnership
  helper in supportAgentInboxService, call before req.body validation.
  ~30 LOC. Sibling-subaccount PATCH always returns 403 regardless of
  payload validity.
```
## Mechanical batch

```
- Line 318: pagePreview.ts:12-13 + pageServing.ts:13-14 type-only imports
  from db/schema/* — move row types to shared/types/page.ts.
- Line 319: req.user.organisationId dual-source in auth.ts lines 262, 288,
  318, 384 — extract resolveOrganisationId(req) helper. Apply to all 4.
- Line 322: 19 duplicate React default+named exports — drop default
  exports on 7 named components per audit list. Keep auth.ts shims.
- Line 323: UNIVERSAL_SKILL_NAMES dual-source — generate from
  ACTION_REGISTRY. New shared/derived/universalSkillNames.ts (generated).
  Delete hand-maintained source. verify-universal-skill-sync.sh must pass.
- Line 306: knip 306 unused-file flags — author knip.json. Aim for under
  50 real flags after this PR.
- Line 305: 133 marker comments — remove 10 DEPRECATED and 1 XXX. Defer
  73 TEMP and 50 TODO.
- Line 304: 188 `: any` budget — let verify-any-budget.sh ratchet
  naturally. No batch fix; document as ongoing.
- Line 307: ~80 unused exports in shared/types/* — per-export manual
  cross-check, do top 10 highest-risk in this PR. Defer rest.
- page-splits PAGE-SPLITS-T1: consolidate duplicate formatTime /
  formatConvDate helpers across agent-chat + config-assistant. Move
  to client/src/lib/dateFormat.ts.
- page-splits PAGE-SPLITS-T2: tighten weak error handling in extracted
  components — swallowed create-project errors, category/workflow delete
  calls without catch. Add explicit catch + structured logger.
```

## Gate / prevention follow-ups

```
- Line 1557: F2 — verify-rls-protected-tables.sh silent exit 123 on
  Windows Git Bash. Wrap xargs grep with || true. Regression-test on
  Linux before merging.
- Line 1558: F3 — verify-rls-contract-compliance.sh service-tier
  allowlist masks raw-db usage. Remove blanket server/services/
  allowlist; add per-file guard-ignore where genuinely needed.
- Line 1571: P2 — widen verify-with-org-tx-or-scoped-db.sh to flag
  service-tier raw-db patterns on RLS_PROTECTED_TABLES. Allowlist via
  guard-ignore.
- Line 1572: P3 — Windows-portable harness test for scripts/verify-*.sh.
  Each gate runs on a clean clone (Linux CI fine — goal is OS-parity).
  Asserts exit ∈ {0,1,2} AND non-empty stdout.
- Line 1573: P4 — DEVELOPMENT_GUIDELINES.md §8 rule: services that read
  or write tenant-scoped tables MUST use getOrgScopedDb(). Raw db.*
  allowed only inside withAdminConnection or for tables in
  rls-not-applicable-allowlist.txt.
```
## Decisions baked in

```
Operator-confirmed 2026-05-15:

- docs/capabilities.md:210 — remove Google Docs / Dropbox vendor names
  entirely. Replace with vendor-neutral phrasing per § Editorial Rules.
  Closes line 321.
- SA5 — keep UK/Aus spelling at URL surface. Add note in architecture.md
  "URL naming conventions" subsection documenting that UK/Aus spelling
  is preferred at the external surface. Do NOT rename internal code.
  Closes line 1612.
- F8 — manual-run idempotency 10s bucket: document trade-off only.
  Inline comment + KNOWLEDGE.md pattern entry. No code change. Closes
  line 1563.
- SUPPORT-PATCH-SCOPE-ORDER — implement sibling-subaccount 403 invariant
  (covered above in "Code-quality batch"). Closes line 1640.
```

## Bug fixes from prior builds

```
- PA-V2-C4-1 (from builder 2026-05-13): cross_owner.ask_initiator_decision
  action type missing from server/config/actionRegistry/. Add to
  agents.ts or new crossOwner.ts. The crossOwnerApprovalTimeoutSweep
  wraps proposeAction in try-catch and logs warning — registry entry
  needed for action to land in approval queue.
- PA-V2-C4-2 (from builder 2026-05-13): server/services/agentExecutionEventServicePure.ts
  has no validator cases for cross_owner_substep.awaiting_initiator_decision
  or cross_owner_substep.completed. validateEventPayload switch hits
  default:never, silently dropping events. Add two case branches.
- PA-V2-C4-3 (from builder 2026-05-13): server/services/actionService.ts
  line 2 — createHash imported from 'crypto' but unused. Remove the
  dead import.
- SKILL-MERGE-RLS-1: add skill_analyzer_results to
  server/config/rlsProtectedTables.ts with join-based policy via
  skill_analyzer_jobs.organisation_id. Add system-scoped comment to
  migrations/0358 skill_analyzer_config ALTER block. Reference:
  tasks/review-logs/adversarial-review-log-skill-merge-consolidation-pass-2026-05-14T02-39-41Z.md
  finding 1.
- SKILL-MERGE-AUTHGATE-1: verify the config-update route serving
  consolidationEnabled / consolidationTriggerSeverity is gated by
  requireSystemAdmin, not a tenant-scoped admin middleware. Fix if not.
```

## NEW — PA-V1 cleanup-batch deferrals (post-#324)

```
- PA-CLEANUP-DEF-1: Add eq(voiceProfiles.organisationId, ctx.organisationId)
  to the three follow-on state-flip UPDATEs in voiceProfileService.deriveProfile
  (lines 88-91, 99-102, 112-121). Initial claim has it; follow-ons don't.
  Defense-in-depth fix. ~3-line change per site.
- PA-CLEANUP-DEF-4: voiceProfileService.deriveProfile writes
  sampleSize: 0 (hardcoded). Spec §1092 trace event
  voice.profile.refreshed { profileId, sampleSize, durationMs }
  expects the actual count. Fix: change to samples.length. Update
  the misleading "sample count intentionally zeroed" comment.
```

## NEW — PR #327 (split-services-soft-cap) carry-forward bugs

```
Three pre-existing bugs the split carried forward verbatim from main.
Not introduced by #327 but visible now:

- F1: server/jobs/skillAnalyzerJob/stage5cSourceFork.ts:33-44.
  names.filter(n => n !== r.candidate.name) collapses duplicates when
  two candidates share a display name. Fix: filter by index/identity
  (group.filter((_, i) => i !== currentIndex).map(x => x.candidate.name))
  or include slug pairs. Realistic for imported/generated skills with
  templated names.
- T1: server/services/llmRouter/routeCall.ts:449. The
  llm_router.budget_block_upsert_ghost warn condition has no metric
  or alert. Add a counter or alert hook so audit drops aren't lost
  in logs under load.
- T2: server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:726.
  Number(process.env.WORKSPACE_MIGRATION_CONCURRENCY ?? 8) has no
  upper clamp. Add defensive guard: Math.max(1, Math.min(32, value)).
```
## Final checks

```
- npm run lint
- npm run typecheck
- npm run build:server
- npm run build:client
- All flipped gates exit 0 against current main (no new violations).
- New gates exit 0 (their baselines accept current main).
- Targeted Vitest for any pure helpers authored in this PR.
- Run pr-reviewer against the branch. Apply blocker / strong-recommendation
  findings. Strong-recommendation may be deferred with rationale in
  tasks/todo.md.
- Open PR titled "wave-3: cleanup + foundational + Wave 1 audit residue (Session E)".
- PR body lists every closed tasks/todo.md item with line number and
  origin tag.
- End-of-session CEO-level report under 200 words.
```

## Out of scope

```
Explicitly v2-backlog. Do NOT action in this PR:

- LAEL Phase 1/2/3 (10 items): user did not select for v1.
- Hermes H1/H2/H3/§6.8 (4 items): user did not select for v1.
- iee-browser IEE-DEF-1..9 (9 items): dead-code paths, wait until live.
- OSI-DEF-2..13 (12 items): future-state operator-session items.
- TI-001 through TI-008 (4 items): test infra non-blocking.
- CHATGPT-R3-1/2/6, R1-7 (4 items, except R1-7 confirmation in
  foundational section above): CI hardening non-blocking.
- PA-V1 worth-confirming (3 items at lines 1408-1420): observational.
- PA-V2-OP-INFO-1/2 (2 items at lines 124-150): informational only.
- SKILL-MERGE-BUDGET-1/INJECTION-1/AUDIT-1/RESET-UX-1/COPY-1/RATIONALE-1/TEST-1
  (7 items): advisory.
- SANDBOX-DEF-EGRESS-MECH + SANDBOX-F1 (2 items): wait on e2b SDK.
- 5 "Not feasible" prevention items: keep documented.

For each v2-backlog item: change [status:open] to [status:v2-backlog]
with a one-line rationale. This makes the v1 lockdown bar explicit
and traceable.
```

## Source-line map

| Section | tasks/todo.md line | Notes |
|---|---|---|
| Stale closures | 295, 1559, 1561, 1582, 1584, 1585, 1587, 1596 | Verify before flipping |
| Duplicate R4/R5/R6 | 1623-1625 | Delete the dupes |
| Wave 1 residue | 1559, 1562, 1582-1587, 1563 | Code + migration |
| Foundational | 65-68 | Multer, rate limiting, OAuth |
| Code quality | 301, 302, 303, 320, 1640 | Annotate + restructure |
| Mechanical batch | 304, 305, 306, 307, 318, 319, 322, 323 + 1524 PAGE-SPLITS-T1/T2 | Long tail |
| Gate / prevention | 1557, 1558, 1571, 1572, 1573 | Gate hardening |
| Decisions baked in | 321, 1612, 1563, 1640 | Operator-approved 2026-05-15 |
| Prior-build bugs | 88-95 PA-V2-C4-*, 263-265 SKILL-MERGE-RLS-1 + SKILL-MERGE-AUTHGATE-1 | Real bugs |
| v2-backlog | LAEL 22-32 / Hermes 33-37 / IEE 242-258 / OSI-DEF 1196-1255 / TI 77-82 / CHATGPT-R3 84-87 / PA-V1-WC 1408-1420 / PA-V2-INFO 124-150 / SKILL-MERGE-other / SANDBOX-DEF + F1 / not-feasible 391-407 | Mark status, do not action |

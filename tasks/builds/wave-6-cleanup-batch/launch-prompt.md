# Wave 6 Session Q — cleanup batch + stale-status sweep

Standard-class light-pipeline. Single coordinated PR. ~20 items across stale-status verification + adversarial deferrals + small fixes + Wave 6 follow-ups.

**Paste the block below as the opening message of a fresh Claude Code session in Env Q.**

---

## Header

```
Wave 6 Session Q — cleanup batch + stale-status sweep. Standard-class
light-pipeline. No spec-coordinator. Scope locked below. ~20 items
in one coordinated PR.

This is the final small-tail consolidation pass. After this, the
codebase is genuinely complete on all v1-blocking work.
```

## Branch + sync

```
1. Sync and branch:
     git fetch origin main
     git checkout -b claude/wave-6-cleanup-batch origin/main
```

## Hard prerequisite — wait for Session O chunk 0

```
DO NOT start the stale-status sweep section below until Session O
has published its chunk-0 tier-categorisation.md to its branch
(claude/wave-6-rls-residue-and-gate-fix). Q's status flips for WF1/
WF3/WF4/WF6 reflect O's tier verdicts; flipping early risks closing
items O is about to re-migrate.

Coordination protocol:
1. Q starts on chunks that don't depend on O (small fixes, LAEL
   leftovers, adversarial deferrals)
2. Q polls O's branch hourly: `git fetch origin claude/wave-6-rls-residue-and-gate-fix && git log --oneline origin/claude/wave-6-rls-residue-and-gate-fix -5`
   Look for a commit like "chunk 0: tier categorisation published"
3. Once O publishes, pull O's tier-categorisation.md (read-only) and
   run the stale-status sweep
4. If O hasn't published within 24 hours of Q starting, escalate to
   operator — O may have surfaced a blocker requiring re-plan
```
## Stale-status verify-and-flip

```
Many tasks/todo.md items are [status:open] but actually closed in
code by Wave 4/5 builds. Verify each against current main; if
confirmed done, flip [status:open] → [status:closed:pr:<NNN>:verified-in-main].
If NOT done, leave open with a note explaining what's still missing.

DEPENDS ON SESSION O CHUNK 0: verify WF1/WF3/WF4/WF6 against O's
tier-categorisation.md before flipping.

Candidates to verify:
- CD2 (agentExecutionService ↔ agentExecutionLoop ↔ executionBackends
  triangle) — Wave 4 H spec §1.1 claims structurally addressed.
  Verify via madge --circular.
- CD3 (workflowEngineService post-split residual cycles) — Wave 4 H.
  Verify via madge.
- CD4 (notifyOperatorFanoutService ↔ channels) — Wave 4 H.
- CD5-CD10 (misc small cycles) — already showing as
  [status:closed:pr:332:verified-in-main] in line 1647 of todo.md.
  Verify the duplicate [status:open] entry at line 1622 is the stale
  one and remove it.
- DUP6 (87L same-file clone in workflowEngine/queueLifecycle/agentStep.ts)
  — Wave 4 G closed at pr:332 per line 1641. Duplicate [status:open]
  entry at line 1631 is stale. Remove.
- AE2 (executeSpawnSubAgents queue backing) — DUPLICATE entry: one at
  line 1632 [status:open], one at line 1646 [status:closed:pr:332].
  Remove the open duplicate.
- WF1 (5 FK-scoped tenant tables RLS) — DEPENDS ON O. Wave 5 may have
  landed the migration; verify against current migrations/. If
  migration 0364+ adds the RLS policies, close. If not, leave open
  and pair with O's WF1 chunk.
- WF3/WF4/WF6 (workflow service raw db) — DEPENDS ON O.
- SK1/SK2/SK3 (skill registry alignment) — Wave 4 G claimed done.
  Verify scripts/snapshots/action-registry.snapshot.json matches
  current registry. If yes, close.
- SC-1 (NameMismatch placement) — Verify current location of
  detectNameMismatch in server/services/skillAnalyzerServicePure/.
- 188 :any ratchet (line 295) — verify-any-budget.sh ratchets
  naturally. Close as [status:closed:wave-6:ratchet-handles].
- 101 client pages frontend audit (line 308) — Wave 2 audit ran in
  PR #323; close as [status:closed:wave-2:findings-absorbed-by-wave-4-H].
- 186 skill ↔ actionRegistry alignment (line 310) — Wave 4 G grounded
  via the snapshot. Close.
- Per-critical-path coverage matrix (line 311) — Wave 4 G authored
  tasks/critical-paths-manifest.yml + PP-MC2 gate. Close.
- madge --circular not run (line 312) — Wave 2 audit ran it. Close.
- jscpd not run (line 313) — Wave 2 audit ran it. Close.
- Handoff audit-trail durability (line 314) — Wave 2 audit + Wave 4
  G handled. Close.
```

## Wave 5 adversarial deferrals

```
- W5K-ADV-1: tighten extraWhere regex in definePruneJob —
  server/jobs/lib/definePruneJob.ts:50-61. Replace partial-prefix
  regex with an allowlist of column names + operators. ~10 LOC.
- W5K-ADV-2: persistAndAnnounce UPDATE-claim missing organisationId
  predicate — server/services/agentExecutionService/runLifecycle/persistRun.ts:73-76.
  Add eq(agentRuns.organisationId, request.organisationId) to the
  WHERE clause. ~3 LOC defence-in-depth.
```

## LAEL Phase 2 leftovers

```
- LAEL-P2-L2: prevSummary TOCTOU in workspaceMemoryService/read.ts::updateSummary.
  Current SAVEPOINT fix reduces but doesn't eliminate the race.
  Decision (chunk 0): add SELECT ... FOR UPDATE on the summary row
  OR set the transaction to SERIALIZABLE isolation level. Default:
  SELECT FOR UPDATE (narrower scope, smaller blast radius).
- LAEL-P2-L3: add CHECK (entity_type IN ('memory_block',
  'workspace_memory_summary')) to migration 0367 agent_execution_log_edits.
  Author a follow-up migration (next sequential number).
```
## Small fixes batch

```
- pagePreview.ts:12-13 + pageServing.ts:13-14 type-only imports
  from db/schema/* — move row types to shared/types/page.ts.
- req.user.organisationId dual-source in server/middleware/auth.ts
  lines 262, 288, 318, 384 — extract resolveOrganisationId(req)
  helper. Apply to all 4 sites.
- 19 duplicate React default + named exports — drop the default
  exports on 7 named components per Wave 1 audit list (line 322).
  Keep auth.ts shims (operator-documented exception).
- UNIVERSAL_SKILL_NAMES dual-source — Wave 4 G claimed addressed.
  Verify the existing PP-SK2 gate covers the bidirectional invariant.
  If gap remains, extend the gate. If fully covered, close as
  [status:closed:pr:332:verified-by-PP-SK2].
- SystemPnlPage admin-only KPI cards — confirm gate in
  client/src/pages/SystemPnlPage.tsx. Verify
  scripts/verify-frontend-design-budget.sh allowlists the page as
  admin-only OR add the // frontend-design: admin-only-acceptance
  header annotation.
- AE4: document worker-restart recovery for in-flight handoffs in
  architecture.md § agent-execution durability. ~30-line doc
  addition. Reference Wave 4 G's handoff durability fixes (AE1/AE2/
  AE5) and the test-meta framework MC8.
- PP-SK1 gate — verify-skill-registry-alignment.sh. Author if not
  already present. Reads the action-registry snapshot + skill .md
  files; flags drift.
```

## V2-backlog items folded in (operator decision 2026-05-17)

```
Per operator review 2026-05-17, the following items were re-categorised
from v2-backlog to Wave 6 scope because their original deferral reasons
no longer apply (no production data needed, no prerequisites missing,
small LOC budget). 13 items, ~150 LOC total.

HERMES LEFTOVERS:
- §6.8 errorMessage gap: server/services/agentExecutionService — thread
  preFinalizeMetadata.errorMessage into extractRunInsights call when
  finalStatus==='failed' via the normal terminal path. Pre-existing
  limitation per LAEL spec §11.4. ~5 LOC.
- H3 runResultStatus='partial' decision: keep !hasSummary as orthogonal
  field (not a downgrade signal). Doc the decision in architecture.md
  + ~1 LOC code tweak if any coupling exists today. Original deferral
  was "monitor production rates first" — pre-prod resolves the question
  by decision instead.

PA-V1 WORTH-CONFIRMING (defence-in-depth):
- dispatch() integrationConnections orgId filter:
  server/services/triggers/externalSourceTriggers.ts:38-52 — add
  eq(integrationConnections.organisationId, ctx.organisationId). ~3 LOC.
- dispatch() rate-cap orgId scope:
  server/services/triggers/externalSourceTriggers.ts:87-97 — add
  organisationId filter to rate-cap count query. ~3 LOC.

OSI-DEF (operator-session pre-emptive hardening):
- OSI-DEF-2: token encryption defence-in-depth on unreachable connect()
  mock path. server/services/operatorSessionService.ts:287-289 — wire
  connectionTokenService.encryptToken(mockToken.access) and
  ...(mockToken.refresh) even in the mock so encryption contract is
  self-executing when the registry flips. ~3 LOC.
- OSI-DEF-5: down-migration ordering guards.
  migrations/0326_operator_session_columns.down.sql + 0325. Add explicit
  guard query at top of each down file. ~10 LOC.
- OSI-DEF-7: UUID validation at route layer.
  server/routes/operatorSessionConnections.ts:442 — add
  z.string().uuid() validation to req.params.agentId. ~3 LOC.
- OSI-DEF-9: usability_state CHECK constraint. Author migration
  <next-N>_operator_session_usability_state_check.sql + .down.sql:
    ALTER TABLE operator_session_connections
      ADD CONSTRAINT usability_state_check
      CHECK (usability_state IN ('connected_usable',
        'connected_needs_consent', 'connected_needs_reauth',
        'connected_unverified', 'revoked', 'disabled'));
  ~10 LOC migration pair.

SKILL-MERGE CONSOLIDATION:
- SKILL-MERGE-TEST-1: extract classifyConsolidationOutcome pure helper
  from server/jobs/skillAnalyzerJob.ts ~line 1407 + Vitest covering
  postWords >= preWords → 'not_shortened' branch. ~30 LOC.
- SKILL-MERGE-COPY-1: plain-English failureReason enum mapping in
  client/src/components/MergeReviewBlock.tsx — replace verbatim
  "Reason: not_shortened" with operator-friendly copy. ~20 LOC.
- SKILL-MERGE-RATIONALE-1: short-circuit guard at
  server/jobs/skillAnalyzerJob.ts ~line 1267 when mergeRationale is
  null upstream — skip parseConsolidationResponse + rejected-LLM-call.
  ~2 LOC.
- SKILL-MERGE-BUDGET-1: verify whether systemCallerPolicy:'bypass_routing'
  exempts consolidation calls from per-org LLM budget guards. File:
  server/jobs/skillAnalyzerJob.ts ~lines 1289-1306. If verification
  shows exemption, add per-job consolidation-call cap or
  budget-aware skip. ~30 LOC if cap needed; doc-only if verified
  no-exemption.

GOVERN MODAL HARDENING:
- OSI-DEF-4 type="button" sweep across new Govern modals.
  client/src/pages/govern/components/*.tsx (~36 occurrences) +
  client/src/pages/govern/ConnectionsPage.tsx lines 67-77 (tab buttons).
  Per DEVELOPMENT_GUIDELINES.md §8.25 the class-level rule wants
  type="button". Currently theoretical (no <form> wrappers) but cheap
  defensive sweep. Mechanical change.

Total added: 13 items, ~150 LOC. Q remains Standard-class light-pipeline.
Each item closes a tasks/todo.md v2-backlog entry — flip status from
[status:v2-backlog:*] to [status:closed:pr:<num>] in the merge commit.
```

## Final checks

```
- npm run lint
- npm run typecheck
- npm run build:server
- npm run build:client
- All Wave 5/6 gates exit 0 against current main
- tasks/todo.md open count drops by ~20 items
- PR title: "wave-6: cleanup batch + stale-status sweep (Session Q)"
- PR body lists every closed item with line number and verification
  evidence (commit hash + verify command for each verify-and-flip
  candidate)
- Run pr-reviewer. Apply blocker / strong-recommendation findings.
- End-of-session CEO-level report < 200 words.
```

## File-overlap deconfliction

```
- Session O (RLS residue): touches server/services/ heavily. Q
  reads tier-categorisation.md (read-only); no file conflicts.
  Q's WF1/3/4/6 verification waits on O's chunk 0 (per Hard
  Prerequisite above).
- Session P (knip triage): touches mostly client/src/components/
  and server/{routes,services}/<deprecated>.ts. Q touches
  client/src/components/* for 19 duplicate exports drop — small
  + specific list. Coordinate: Q's 19-export list verified against
  P's delete list at chunk 0; if any of Q's targets are also P
  delete candidates, defer Q's edit (P wins).
- Session R (operator feature): unknown overlap until R lands.
  Q's small-fix list is mostly defensive / type-cleanup; unlikely
  to conflict.
```

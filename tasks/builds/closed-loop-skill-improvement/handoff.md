# Handoff — closed-loop-skill-improvement

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** docs/superpowers/specs/2026-05-18-closed-loop-skill-improvement-spec.md
**Branch:** claude/review-mockup-suggestions-tVf84
**Build slug:** closed-loop-skill-improvement
**Build class:** Major
**UI-touching:** yes
**Mockup paths:**
- prototypes/closed-loop-skill-improvement/index.html
- prototypes/closed-loop-skill-improvement/s1-inbox-improvements.html
- prototypes/closed-loop-skill-improvement/s2-review-drawer.html
- prototypes/closed-loop-skill-improvement/s3-skill-row-expanded.html
- prototypes/closed-loop-skill-improvement/s4-runtrace-event.html

**Spec-reviewer iterations used:** 3 / 5 (READY_FOR_BUILD on iteration 3, exit via two-consecutive-mechanical-only)
**ChatGPT spec review:** 3 rounds — APPROVED on Round 3. Log: `tasks/review-logs/chatgpt-spec-review-closed-loop-skill-improvement-2026-05-18T20-30-00Z.md`

**PR:** [#353](https://github.com/michaelhazza/automation-v1/pull/353)

**Final spec commit:** `3577b3e3`

---

## Open questions for Phase 2

None. All design decisions resolved in:
- The dev brief at `tasks/research-briefs/closed-loop-skill-improvement-dev-brief.md` (§7 questions all marked CLOSED at brief-lock time)
- The grill-me Q&A in `tasks/builds/closed-loop-skill-improvement/intent.md § Grill-me Q&A` (8 decisions locked)
- Three rounds of spec-reviewer + three rounds of chatgpt-spec-review

---

## Decisions made in Phase 1

### Operator decisions during grill-me (Step 3b)

1. **Proposer trigger mechanism** — subordinate pg-boss dispatch from `scorecardJudgeJob` (single `send` call inside the verdict-write transaction). Atomic, no polling.
2. **Morning queue UI shape** — section band below existing Needs Review tab content (not a third tab). Mockups are the design source of truth.
3. **Peer reviewer vendor** — GPT-class via OpenAI API (already configured). Final routing: through `llmRouter.routeCall()` (decided in chatgpt-spec-review R1) — not direct SDK.
4. **Regression set storage** — new `skill_regression_cases` table. Bench infrastructure replay mechanics callable from the regression replay job without sharing bench_runs storage schema.
5. **Feature flag for Step 1 schema** — none. Data-gated: empty `skill_amendments` table produces identical resolver output to today. Consistent with `docs/spec-context.md`.
6. **`learned_failure_mode` memory entry type** — deferred to Phase 2. RCA record on `skill_amendments.rca_json` is sufficient Phase 1 provenance.
7. **Correction-pattern-detector changes** — modify the existing `correctionPatternDetectorJob.ts` (add `failed_check_id + entity_type` clustering dimension). No new job.
8. **Rollback UI trigger path** — skill detail page only for Phase 1. Morning queue tier-1 alert links to skill detail page where the operator executes the rollback.

### Operator decisions during chatgpt-spec-review

**Round 1:**
- F1 Snapshot fallback resolved wrong state — **applied** (use base-only resolver, no live composition for historical RCA grounding)
- F2 Fire-and-forget snapshot conflicts with replay guarantee — **applied** (snapshot write now synchronous inside resolver transaction)
- F3 Peer review bypasses llmRouter — **applied** (route through `llmRouter.routeCall()` with `taskType=peer_review`)
- F4 Multi-instance cache invalidation — **deferred** to §22

**Round 2:**
- F1 Snapshot `ON CONFLICT DO NOTHING` could silently mask divergence — **applied (shape a)** — `RETURNING` + compare + fail-closed with typed `composition.divergence` error
- F3 RCA context used live amendment stack instead of snapshot — **applied** — RCA now reads from `skill_amendment_run_snapshot.included_amendment_ids` / `excluded_amendment_ids`
- F2 (transient vs permanent snapshot failure) — auto-applied
- F5 (router exhaustion not terminally classified — added `amendment.dropped.peer_review_unavailable`) — auto-applied
- F4 (OpenAI header retry wording) — auto-rejected (factually wrong — already addressed in R1)

**Round 3:**
- Snapshot uniqueness invariant promoted to first-class in §7.7 (no longer derived from `ON CONFLICT` wording) — auto-applied
- Spec status: `reviewing → accepted`. Verdict: **APPROVED**.

### spec-reviewer auto-decided directional findings

- CL-SKI-1 and CL-SKI-2 routed to `tasks/todo.md` (low-priority directional items auto-decided `accept`)

---

## Build estimate

Per the spec's ABCd Estimate (§ABCd Lifecycle Estimate):

| Dimension | Sizing |
|---|---|
| Acquire | L |
| Build | L |
| Carry | M |
| decommission | M |

Six sequencing steps per §17:
1. Schema + resolver (no UI)
2. `failure_post_mortem` job — RCA only, no proposals
3. Amendment proposer + peer review
4. Morning queue UI + accept/reject flows
5. Skill detail + run trace UI + rollback + freeze switch
6. Evaluation harness (effectiveness, freshness, stack health)

The dev brief estimated 6 to 10 weeks of focused build for one engineer.

---

## Lifecycle Declaration (per §7.2 governance)

| Field | Value |
|---|---|
| Capability cluster | Agent Runtime, Audit & Governance, Approvals |
| Capability owner | ai-agent |
| Lifecycle state on launch | Inception |
| Risk surface | server/db/schema, server/routes, agent runtime, approvals |
| Review cadence | quarterly |

---

## Key files Phase 2 will touch

**New tables (8):**
- `skill_amendments`
- `skill_regression_cases`
- `peer_reviewer_drops`
- `skill_amendment_effectiveness`
- `amendment_proposer_metrics` (system-wide, no RLS)
- `amendment_proposer_entropy`
- `skill_amendment_run_snapshot`
- `skill_amendment_freezes`

**New jobs (4):** `failure:post-mortem`, `amendment:regression-replay`, `amendment:stale-retire`, `amendment:effectiveness-update`

**Modified jobs (2):** `scorecardJudgeJob`, `correctionPatternDetectorJob`

**New service (1):** `server/services/skillAmendmentService.ts`

**Modified service:** `server/services/skillService.ts` — adds `composeAmendmentsPure` + amendment composition step in `resolveSkillsForAgent`. New `skillServicePure.ts` companion.

**New routes (10):** under `/api/subaccounts/:subaccountId/skill-amendments` and `/api/subaccounts/:subaccountId/skill-amendment-freezes`

**New client surfaces (4):**
- Amendments section band on `ReviewQueuePage.tsx`
- New `AmendmentReviewDrawer.tsx` under `client/src/components/review-queue/`
- Inline amendment stack expanded row on `SubaccountSkillsPage.tsx`
- Inline composition panel + improvement-proposed event on `RunTracePage.tsx` / `RunTraceEventRenderer.tsx`

**New permission key:** `manage_skill_amendments` (granted to `subaccount_admin`, `org_admin`)

---

## Notes for the architect

- The spec includes a full §19 Trust Boundary Diagram and §20 Failure Atomicity Definitions — use these as the source for chunk-boundary decisions.
- Phase 1 ships Surface A only (in-workspace queue per subaccount). Surface B (cross-subaccount org-admin roll-up) is deferred per §22.
- The 4-screen mockup set is the design source of truth (Round 5 CLEAN per `tasks/builds/closed-loop-skill-improvement/mockup-log.md`). The brief's earlier 7-screen Round 2 set was archived to `_archive/prototypes/` and is NOT the source of truth.
- The `composeAmendmentsPure` / `resolveSkillsForAgent` split (§8.1) is the pure / impure boundary the architect should respect when chunking — `composeAmendmentsPure` is testable in isolation; the wrapper performs DB I/O and is tested via the existing skill-resolution integration paths.
- Step 2 (RCA-only job, no proposals yet) is a deliberate sanity gate — the operator inspects 10 real RCA outputs before Step 3 wires amendment writes. This gate should be a chunk boundary or an explicit pause in the plan.

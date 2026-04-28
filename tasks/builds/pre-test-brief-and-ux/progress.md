# Pre-Test Brief Follow-up + Dashboard UX — Build Progress

**Slug:** `pre-test-brief-and-ux`
**Spec:** `docs/superpowers/specs/2026-04-28-pre-test-brief-and-ux-spec.md`
**Branch:** `pre-test-brief-and-ux-spec` (from `origin/main`)
**Pair spec (do NOT touch):** `docs/superpowers/specs/2026-04-28-pre-test-backend-hardening-spec.md`
**Classification:** Major (feature-coordinator orchestration)

---

## Session log

### 2026-04-28 — Setup

- Branched `pre-test-brief-and-ux-spec` from `origin/main` (post-fetch). Local `main` was 38 commits stale; the spec was already merged into origin/main via PR #221 (`fca02517`) so no cherry-pick was required.
- Read spec end-to-end. §0.5 critical-invariants index logged into the plan as the contract surface that cannot regress.
- Wrote initial implementation task list to `plan.md`. Awaiting confirmation before invoking `feature-coordinator` to produce the architect's deep plan and execute.

---

## Decisions made

| Decision | Rationale |
|----------|-----------|
| Branch from `origin/main` not local `main` | Spec already on origin/main via PR #221; local main 38 commits behind. Avoids spurious cherry-pick. |
| Branch name `pre-test-brief-and-ux-spec` | User instruction (overrides the spec's `claude/pre-test-brief-and-ux` suggestion). |
| Sequence S3 → N7 → S8 → DR2 | Spec §2 recommended sequence — minimises rework, ships visible UI feedback first, lands the new primitive before the largest user-facing change. |
| One commit per §1.x item | Spec §2 — keeps review item-by-item; final PR consolidates all four. |

---

## Open items / blockers

_None._

---

## Implementation session — 2026-04-28

All four items implemented, tested, and committed on branch `pre-test-brief-and-ux-spec`:

| Item | Commit | Summary |
|------|--------|---------|
| §1.4 S3 | `6ef1ea79` | DashboardErrorBanner component; cycle-local error state; both pages |
| §1.3 N7 | `04613015` | Cursor pagination; briefArtefactCursorPure + paginationPure; BriefDetailPage "Load older" |
| §1.2 S8 | `60a68d07` | AsyncLocalStorage postCommitEmitter; middleware; briefConversationWriter refactor; 8-case unit + lifecycle integration test |
| §1.1 DR2 | `4d64df6d` | selectConversationFollowUpAction; branch-before-write; uniform response shape; predicate + DB integration tests |
| Fix | `c8acd7ed` | Integration test DATABASE_URL guard + FK-violation skip (triageDurability pattern) |

Pre-merge pipeline: tsc clean (pre-existing ClarificationInbox + SkillAnalyzer errors, not introduced by branch), 252 unit tests pass, client build clean, spec-conformance NON_CONFORMANT (9 directional gaps — all manual smokes or PR-prep workflow, no mechanical gaps).

### Integration test scope rationale (S8-10, DR2-8)

The full S8 lifecycle (middleware → writer → res.finish → emit fires) is covered by `briefConversationWriterPostCommit.integration.test.ts` using the AsyncLocalStorage plumbing directly without a DB or HTTP server. The end-to-end S8 smoke (contrived 500 → no WS event) and DR2 (brief follow-up → orchestrator job in pg-boss) require a live app + browser + pg-boss, covered by manual smoke below.

## Manual smoke test results

| Item | Date | Pages exercised | Result | Notes |
|------|------|-----------------|--------|-------|
| §1.4 S3 | _pending user verification_ | DashboardPage, ClientPulseDashboardPage | _pending_ | Stop API → expect banner names the failed source → start API → Retry → banner clears |
| §1.3 N7 | _pending user verification_ | BriefDetailPage with > 50 artefacts | _pending_ | Initial 50 → "Load older" button visible → click → older artefacts prepend |
| §1.2 S8 | _pending user verification_ | Any brief message post | _pending_ | Contrived 500 after writer → NO websocket event in browser dev tools; happy path → event arrives normally |
| §1.1 DR2 | _pending user verification_ | Brief detail page follow-up | _pending_ | Post follow-up → `conversations_route.brief_followup_dispatched` log appears → orchestrator job enqueues |

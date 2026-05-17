# ChatGPT Spec Review — iee-worker-retirement

## Session Info

- **Spec:** `tasks/builds/iee-worker-retirement/spec.md`
- **Branch:** `claude/hosting-provider-evaluation-oqQDV`
- **PR:** #340 — https://github.com/michaelhazza/automation-v1/pull/340
- **Mode:** manual
- **Started:** 2026-05-17T07:12:49Z
- **Reviewer:** ChatGPT (manual paste)

---

## Round 1

### ChatGPT Feedback (raw)

> Spec is directionally solid, but I'd tighten before implementation. Main issues:
>
> 🔴 Blocking
>
> 1. ieeDevBackend kept registered but dispatches to a dead queue. A header comment is not enough. If any forgotten path selects ieeDevBackend, it silently enqueues work that never runs. Recommended fix: add one explicit invariant: ieeDevBackend may remain registered for contract compatibility, but production dispatch must fail closed unless an iee-dev-task consumer is enabled. Add either: runtime guard returning typed "backend retired" failure, or feature flag / env gate proving it cannot be selected in v1.
>
> 2. Manual smoke gate is backwards. "Absence of iee.costrollup.schedule_failed proves success" is weak. Absence of an error log proves very little. Replace with a positive assertion: Boot server and confirm iee-cost-rollup-daily is registered/scheduled via pg-boss schedule inspection or a positive iee.costrollup.scheduled log.
>
> 🟡 Should-fix
>
> 3. Spec says "no behavioural change," but cron migration is runtime behaviour. This is mostly cleanup, but moving the daily rollup from worker to main server is a live scheduling change. Reword classification.
>
> 4. Verification grep is too narrow. Current grep only checks server/ shared/ client/. Worker references can live in .github/, scripts/, docs/, tasks/, Dockerfile, docker-compose.yml, package files, CI, etc. Use repo-wide rg, excluding .git, node_modules, build output.
>
> 5. "No new tests required" conflicts with Chunk 1. Chunk 1 says targeted test for rollup SQL. Section 9 says no new tests required. Change wording.
>
> 6. Deleting tasks/builds/openclaw-adapter/scope.md may remove useful breadcrumbing. Better than deletion: replace with a short tombstone pointing to the shipped operator backend spec and this cleanup spec. Git history is not enough for future agents.
>
> 💭 Consider
>
> 7. Add duplicate cron registration invariant. When moving to main server, specify whether schedule registration is idempotent and how duplicate schedules are avoided across deploys.
>
> 8. Clarify docs/iee-development-spec.md authority. Saying other sections remain authoritative for OpenClaw may be risky if they still describe worker-era execution loops. Add a review step to mark every worker-era section superseded, not just §4.
>
> Suggested verdict: Do not implement yet. Patch the spec with the two blocking changes, especially the dead-queue fail-closed invariant.

### Findings extracted

| ID | Title | Severity | Category | Type |
|---|---|---|---|---|
| F1 | ieeDevBackend fail-closed invariant required, not just comment | critical | architecture | architecture |
| F2 | Manual smoke gate uses absence-of-error; replace with positive assertion | medium | improvement | test_coverage |
| F3 | "No behavioural change" wording inaccurate — cron migration is runtime behaviour | low | style | scope |
| F4 | Verification grep restricted to server/shared/client; widen to repo-wide rg with exclusions | medium | improvement | scope |
| F5 | § 9 "no new tests required" contradicts Chunk 1 targeted regression test | low | style | test_coverage |
| F6 | Replace deletion of `openclaw-adapter/scope.md` with a tombstone pointer | medium | improvement | other |
| F7 | Cron registration on main server: specify idempotency / dedup invariant | medium | improvement | idempotency |
| F8 | `docs/iee-development-spec.md` supersession scope wider than § 4 | medium | improvement | other |

### Recommendations and Decisions

| ID | Triage | Recommendation | Final Decision | Rationale |
|---|---|---|---|---|
| F1 | technical | apply | auto (apply) | Real silent-failure risk; runtime fail-closed guard is the correct primitive. Per user review-triage policy, critical/architectural findings auto-apply. |
| F2 | technical | apply | auto (apply) | Positive assertion strictly stronger than absence-of-error for a scheduled job. |
| F3 | technical | apply | auto (apply) | Internal accuracy; restate as "no customer-visible change" while acknowledging the scheduling migration. |
| F4 | technical | apply | auto (apply) | Worker refs do live in CI/docker/scripts/docs; narrow grep would miss them. |
| F5 | technical | apply | auto (apply) | Pure internal-consistency fix between two sections. |
| F6 | technical | apply | auto (apply) | Tombstone is cheaper than future-agent confusion; git history alone is insufficient for AI sessions. |
| F7 | technical | apply | auto (apply) | pg-boss `schedule()` is idempotent by name, but spec should state the invariant explicitly. |
| F8 | technical | apply | auto (apply) | Wording change in § 3.4 + add a Chunk 4 step to grep the doc for worker-era references. No exhaustive audit at spec time — that is implementation work. |

### Integrity check

2 issues found this round (auto: 2, escalated: 0).

| ID | Issue | Decision |
|---|---|---|
| I1 | End-section line 162 said "which is itself deleted by this spec" — contradicts the new tombstone disposition from F6 | auto (apply) — rewrote to "which this spec converts to a tombstone" |
| I2 | § 1 #5 said "three doc references" — undercount after F8 widened the supersession scope to N sections of `iee-development-spec.md` | auto (apply) — replaced fixed count with "doc references and supersede worker-era sections … exact list determined by Chunk 4 audit" |

Post-integrity sanity: no broken anchors, no empty sections introduced.

### Top themes

- **Silent-failure prevention** (F1) — runtime fail-closed guard instead of advisory header comment for the retired backend.
- **Positive vs negative assertions** (F2) — observability acceptance must be a positive signal, not absence-of-error.
- **Verification scope** (F4, F8) — repo-wide grep, not subtree grep; audit doc end-to-end, not single section.
- **Internal consistency** (F3, F5, integrity I1, I2) — wording across sections must agree after each round of edits.
- **AI-session-friendly breadcrumbs** (F6) — tombstones over deletions when future grep visibility matters.
- **Idempotency invariants stated explicitly** (F7).

### Round 1 summary

Auto-accepted (technical): 10 applied, 0 rejected, 0 deferred (8 findings + 2 integrity).
User-decided: 0 applied, 0 rejected, 0 deferred.

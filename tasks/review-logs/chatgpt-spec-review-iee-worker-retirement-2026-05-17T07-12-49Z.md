# ChatGPT Spec Review — iee-worker-retirement

## Session Info

- **Spec:** `tasks/builds/iee-worker-retirement/spec.md`
- **Branch:** `claude/hosting-provider-evaluation-oqQDV`
- **PR:** #340 — https://github.com/michaelhazza/automation-v1/pull/340
- **Mode:** manual
- **Started:** 2026-05-17T07:12:49Z
- **Finalized:** 2026-05-17T07:30:00Z
- **Reviewer:** ChatGPT (manual paste)
- **Rounds:** 2
- **Verdict:** APPROVED (2 rounds, 9 findings + 2 integrity, all auto-applied)

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

---

## Round 2

### ChatGPT Feedback (raw)

> Yes. One remaining should-fix:
>
> 🟡 Add a hard assertion that no runtime deploy still starts the worker.
> The spec deletes worker/, but verification focuses on references to worker/src. It should also check deployment/process entrypoints.
>
> Add to Chunk 5:
>
>     rg -n "dev:worker|build:worker|start:worker|worker/Dockerfile|node .*worker|tsx .*worker|worker:" \
>       package.json package-lock.json .github scripts Dockerfile docker-compose.yml infra \
>       --glob '!node_modules'
>
> Acceptance: zero live deploy/start/build references, except intentional tombstone/spec docs.
>
> Everything else from Round 1 looks properly closed: fail-closed guard, positive cron smoke, wider doc audit, tombstone, idempotent schedule, and test-count consistency are all addressed.

### Findings extracted

| ID | Title | Severity | Category | Type |
|---|---|---|---|---|
| F9 | Chunk 5 grep covers source refs but not deploy/process entrypoints | medium | improvement | scope |

### Recommendations and Decisions

| ID | Triage | Recommendation | Final Decision | Rationale |
|---|---|---|---|---|
| F9 | technical | apply | auto (apply) | Real orthogonal failure mode — source can be gone while a CI workflow, npm script, Dockerfile target, or compose service still tries to start it. The entrypoint-pattern grep is narrow and high-signal. |

### Integrity check

0 issues found this round.

### Round 2 summary

Auto-accepted (technical): 1 applied, 0 rejected, 0 deferred.
User-decided: 0 applied, 0 rejected, 0 deferred.

---

## Final Summary

### Consistency check across rounds

No contradictions across Round 1 and Round 2. Round 2 added a single orthogonal verification (deploy-entrypoint grep) to Chunk 5; Round 1 had already converted the same chunk's source-ref grep from subtree to repo-wide. The two greps are complementary (source refs vs. deploy entrypoints), not overlapping.

### Implementation-readiness checklist

| Check | Status |
|---|---|
| All inputs defined | PASS — env var `IEE_DEV_TASK_CONSUMER`, source files, SQL upsert |
| All outputs defined | PASS — typed `failure('iee_dev_backend_retired')`, `cost_aggregates` row, schedule row |
| Failure modes covered | PASS — dead-queue (fail-closed guard), cron bug (daily, backfillable), worker resurrection (git revert), missed CI ref (Chunk 5 entrypoint grep) |
| Ordering guarantees explicit | PASS — Chunks 1-5 sequenced with explicit invariants ("do NOT delete the worker file in this chunk") |
| No unresolved forward references | PASS — § 3.5 / Chunk 2 / § 7 all cross-reference the fail-closed guard consistently; Contents matches headings |

All five gates pass. Spec is implementation-ready.

### Doc sync sweep verdicts

| Doc | Verdict |
|---|---|
| `architecture.md` | n/a — internal cleanup, no service-boundary / agent-fleet / routing change |
| `docs/capabilities.md` | n/a: internal refactor with no capability surface change |
| `docs/integration-reference.md` | n/a — no integration change |
| `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` | n/a — no convention / gate / policy change |
| `CONTRIBUTING.md` | n/a — no lint-suppression policy change |
| `docs/frontend-design-principles.md` | n/a — no UI |
| `KNOWLEDGE.md` | yes — 3 new patterns appended (retired-adapter fail-closed guard, positive-assertion acceptance gates, tombstone-vs-delete for build-dir placeholders) |
| `docs/spec-context.md` | n/a — no framing-assumption change implied; spec aligns with existing pre-prod / light-testing posture |
| `docs/decisions/` | n/a — implementation cleanup, not a durable architectural choice (no ADR warranted) |
| `docs/context-packs/` | n/a — no section-anchor change in architecture.md |
| `references/test-gate-policy.md` | n/a — no test-gate posture change |
| `references/spec-review-directional-signals.md` | n/a — patterns added to KNOWLEDGE.md; signals threshold (>2 occurrences) not yet met |
| `docs/incident-response.md` | n/a — no SEV / timeline / post-mortem change |
| `docs/testing-transition-plan.md` | n/a — no migration-trigger / test-inventory change |
| `.claude/FRAMEWORK_VERSION` | n/a — repo-specific change, not framework |
| `scripts/verify-*` | n/a — no gate added / removed / renamed |

### Deferred items

None this session — every finding auto-applied as `apply`.

### KNOWLEDGE.md entries added

3 new patterns appended (all 2026-05-17):
1. Retired-but-still-registered adapter backends need a runtime fail-closed guard, not just a header comment
2. Acceptance gates must be positive assertions, never absence-of-error
3. Stale placeholder docs in `tasks/builds/` should be tombstoned, not deleted

### Totals across 2 rounds

| Source | Apply | Reject | Defer |
|---|---|---|---|
| Auto-accepted (technical) | 11 | 0 | 0 |
| User-decided | 0 | 0 | 0 |
| **Total** | **11** | **0** | **0** |

(11 = 8 round-1 findings + 2 round-1 integrity fixes + 1 round-2 finding)

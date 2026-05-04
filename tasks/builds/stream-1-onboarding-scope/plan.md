# Stream 1 — Sub-account onboarding scope (F1 → F3)

| Field | Value |
|---|---|
| Stream | 1 of 2 (concurrent with Stream 2) |
| Goal | Ship F1 then F3 sequentially in one worktree. Both extend onboarding plumbing; F1 must land first. |
| Status | READY TO START — both specs revised against main 2026-05-04 |
| Branch | `claude/stream-1-onboarding-scope` |
| Worktree | `../automation-v1.stream-1-onboarding-scope` |
| Specs (canonical) | `docs/sub-account-baseline-artefacts-spec.md` (F1), `docs/baseline-capture-spec.md` (F3) |
| Migrations claimed | `0277` (F1), `0278`, `0279`, `0280` (F3) |
| Total estimated effort | ~16-19 dev-days (F1 ~10-13d, F3 ~5-6d) |

This file is the orchestration layer. Phase-level detail lives in the specs — do not duplicate it here.

---

## Why one stream

F1 and F3 share the sub-account onboarding surface:
- Both extend `server/services/subaccountOnboardingService.ts` (F1 adds `markArtefactCaptured`; F3 adds `pending` baseline row creation + readiness subscriber)
- Both touch the `subaccounts` table area (different JSONB columns; no collision)
- Both extend the `/subaccounts/:id` UI surface

Running them as separate concurrent worktrees forces awkward rebase coordination. Sequential in one branch is cleaner.

## Coordination with Stream 2

Stream 2 = F2 Phases 1-4 (optimiser finish). **Fully orthogonal** — different files, different services, different scope. Zero coordination required beyond final merge to main.

The one cross-stream signal: F2's `escalation.repeat_phrase` recommendation produces a better action hint when F1's brand-voice artefact is captured. F2 degrades gracefully without it. No build-time dependency.

## Stream 1 sequence

```
Branch claude/stream-1-onboarding-scope
  ├── A: F1 sub-account baseline artefacts
  │     → spec §6 Phases 0-5
  │     → PR #1 → review + merge to main
  │
  └── B: F3 baseline capture (begins after F1 PR merged)
        → spec §8 Phases 1-6
        → PR #2 → review + merge to main
```

**Hard constraint:** F3 cannot start until F1 PR is merged. Both modify the same files at the same area; trying to interleave creates merge hell. Pattern: complete F1 end-to-end → merge → rebase Stream 1 branch on main → start F3.

## Sub-stream A — F1 sub-account baseline artefact set

**Goal:** Capture six tiered artefacts at sub-account onboarding (brand identity, voice/tone, offer/positioning, audience/ICP, operating constraints, proof library).

**Phases (full detail in spec §6):**

| Phase | Effort | Phase output |
|---|---|---|
| 0 — Riley doc-sync | 30-45 min | Single mechanical-edit commit. Spec lists exact files + edits. |
| 1 — Schema + naming convention | ~3h | Migration 0277 + Drizzle schema + reserved-slug constants + zod schema + pure tests. |
| 2 — Tier loaders | ~4h | `getTier1Blocks` helper, domain-filter on `getBlocksForInjection`, `agentExecutionService.ts:834` integration, telemetry. |
| 3 — Capture workflow | ~5h | `baseline-artefacts-capture.workflow.ts` with six `user_input` steps + `knowledgeBindings` + `markArtefactCaptured`. |
| 4 — Wizard extension + Knowledge UI | ~5h | New step in `OnboardingWizardPage.tsx`, drawer component, status badge, Tier-3 skip-to-later. |
| 5 — Verification | ~2h | Lint + typecheck + targeted tests + manual E2E + doc updates + progress closeout. |

**Migration:** `migrations/0277_subaccount_baseline_artefacts.sql` (+ `.down.sql`).

**Done definition (F1):** see spec §8.

## Sub-stream B — F3 baseline capture

**Goal:** When a new sub-account becomes ready (≥2 stable polls + ≥2 of the 4 core metrics non-null), capture an immutable T0 snapshot for month-over-month delta narration.

**Phases (full detail in spec §8):**

| Phase | Effort | Phase output |
|---|---|---|
| 1 — Schema | ~3h | Migrations 0278/0279/0280: `subaccount_baselines` + `subaccount_baseline_metrics` + RLS + canonicalDictionary. |
| 2 — Readiness + sync-complete event | ~5h | `baselineReadinessService.evaluate`, `connector.sync.complete` emit, subscriber, daily fallback job. |
| 3 — Capture service + retry | ~5h | `captureBaselineService.run`, per-metric readers, 3-attempt retry, telemetry events, integration test. |
| 4 — Manual entry UI + admin reset | ~4h | `<ManualBaselineForm>`, validation, manual + admin-reset endpoints, status badge. |
| 5 — Reporting Agent delta | ~3h | `getBaselineForSubaccount` helper, extend `generate_portfolio_report` skill, honest-gap narration. |
| 6 — Verification | ~2h | Lint + typecheck + tests + manual E2E (now possible end-to-end via Module C) + doc updates. |

**Migrations:** `0278_subaccount_baselines.sql`, `0279_subaccount_baseline_metrics.sql`, `0280_baseline_rls.sql` (all + `.down.sql`). **Confirm next-free at build start** if main has moved.

**Done definition (F3):** see spec §10.

## Cross-sub-stream coordination (within Stream 1)

| Concern | F1 (A) | F3 (B) | Resolution |
|---|---|---|---|
| `subaccountOnboardingService.ts` | Adds `markArtefactCaptured` | Adds `pending` row creation + readiness subscriber | F1 first; F3 adds new methods only |
| `subaccounts` table | New column `baseline_artefacts_status` | New JSONB key `baseline_metrics_opt_in` in `subaccount_settings` | Different columns; F1 migration first |
| `/subaccounts/:id` UI | Artefact drawer + status badge | Baseline status badge + manual entry | Different components |
| `agentExecutionService.ts` | Lines ~834-870 | Doesn't touch | Safe |
| Migration order | 0277 | 0278-0280 | Strict numeric order |

## Pre-flight migration check (mandatory at every schema phase)

Migration drift on main is a real risk during a multi-day stream. At the start of any phase that adds a migration, run:

```bash
# Print the highest existing migration number on main (excluding _down + meta)
ls migrations/ | grep -v _down | grep -v meta | grep -E '^[0-9]{4}_' | sort | tail -1
```

If the next-free number is higher than this plan's reservation, **bump the reservation** and update both the spec and the per-build progress file before authoring the migration. Do NOT skip: a colliding migration number is a merge nightmare on main.

## Risks

- Spec drift if F1 review reshapes `subaccountOnboardingService`. Mitigate: same operator reviews both PRs; F3 rebases on main after F1 merges.
- Migration number drift on main during the build. Mitigate: pre-flight check above at every schema phase.
- Race conditions in F3's four-trigger surface (subscriber, cron, retry, manual). Mitigate: spec §5.2 single-writer rule + §3 partial UNIQUE index — both invariants asserted by tests in `baselineInvariants.test.ts`.

## Done definition (Stream 1)

- F1 PR merged with `pr-reviewer` + `chatgpt-pr-review` clean
- F3 PR merged with same review bar
- Both build progress files closed out
- `KNOWLEDGE.md` appended for patterns learned
- `tasks/current-focus.md` returned to NONE after final merge

Hard invariants (asserted before either PR ships, not just at end-of-stream):
- **Baseline created exactly once per sub-account** — F3 §10 invariant; UNIQUE index test in `baselineInvariants.test.ts` is green.
- **Idempotent retry** — F3 §10 invariant; running `captureBaselineService.run` twice on the same `ready` baseline produces no new metric rows. Test green.
- **Manual override never conflicts with auto capture** — F3 §10 invariant; concurrent-simulation test green.
- **Admin reset never destroys history** — F3 §10 invariant; `baseline_version` increment test green.
- **All baseline timestamps use Postgres `now()`** — static check (grep for `Date.now()` in `server/services/captureBaselineService.ts` + `baselineMetricReaders/` + `baselineReadinessService.ts`) returns zero hits.
- **F1 artefact status enum locked** — F1 §8 invariant; wizard cannot exit with Tier 1+2 in `not_started` / `in_progress`. Test green.
- **F1→F2 interface contract honoured** — F1 §6b; `getBaselineVoiceTone` returns `null` for any non-`completed` voice_tone artefact. Test green.

## Kickoff prompt

> "load context pack: implement. Start Stream 1. Spec for sub-stream A is `docs/sub-account-baseline-artefacts-spec.md`. Use `architect` to produce the F1 plan, then `superpowers:subagent-driven-development`. Branch `claude/stream-1-onboarding-scope`. Migration `0277` claimed. After F1 PR merges, rebase + start sub-stream B (`docs/baseline-capture-spec.md`, migrations 0278-0280)."

# Handoff — consolidation-foundation

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** tasks/builds/consolidation-foundation/spec.md
**Branch:** claude/learn-harbour-ui-B4k7a
**Build slug:** consolidation-foundation
**UI-touching:** yes
**Mockup paths:** prototypes/consolidation-2026-05-06/ (parent consolidation prototype set; consolidation-foundation is the cross-cutting primitives extracted from it)
**Spec-reviewer iterations used:** n/a — spec authored and reviewed via manual workflow (see commit history below); spec-reviewer not invoked
**ChatGPT spec review log:** tasks/review-logs/chatgpt-spec-review-consolidation-foundation-2026-05-07T02-35-29Z.md
**Open questions for Phase 2:** none
**Decisions made in Phase 1:**

- Phase 0 draft scoped the spec as cross-cutting frontend primitives extracted from the broader `consolidation` work (commit `450f7532`).
- Round 1 contract tightenings: sort, filter, z-index, exclusivity, type contracts (commit `e71760c5`).
- Round 1 F10 decision: defer F10 (commit `b87091dd`).
- Round 2 final micro-tightenings: NaN handling, sentinel values, side-effect table, exclusivity boundary, padding (commit `eee9967d`).
- Round 3 final invariants: `persistKey v1`, stable-sort contract, scroll-lock ownership (commit `94752162`).
- ChatGPT spec review session finalised (commit `649f94be`); see log file above.

**Provenance note:** Phase 1 was completed via the manual chatgpt-spec-review workflow rather than through `spec-coordinator`. The handoff was written retrospectively by the operator immediately before launching `feature-coordinator` Phase 2. All Phase 1 decisions are recoverable from the commit history listed above. Spec was confirmed finalised by the operator before this handoff was written.

## Phase 3 (FINALISATION) — complete

**PR number:** #270
**PR URL:** https://github.com/michaelhazza/automation-v1/pull/270
**Branch:** claude/consolidation-foundation
**chatgpt-pr-review log:** tasks/review-logs/chatgpt-pr-review-consolidation-foundation-2026-05-07T08-15-18Z.md (2 rounds, APPROVED. Round 1 verdict: APPROVE with tightenings — F1 focus-trap escape recovery, F2 visibility helper, F3 shared keyframes in `index.css`, F4 `import.meta.env.DEV` + `vite-env.d.ts`, F5 `aria-labelledby` + `useId`, F7 sort-stability JSDoc all implemented; F6 deferred as `CONSOL-FND-DEF-5`. Round 2 verdict: APPROVED — both ultra-low notes closed as no-action.)
**spec_deviations reviewed:** n/a — none recorded in handoff
**S2 sync:** merged origin/main (`23dd4d90..58f4068d`). Three conflicts resolved by operator authorisation: spec.md / plan.md kept HEAD; tasks/todo.md hand-merged to union both deferred-items blocks (consolidation-foundation kept, consolidation-govern appended). Auto-merged: KNOWLEDGE.md, architecture.md, sibling consolidation-* specs, review logs, references/iee-worker-timing.md, worker bootstrap.
**G4 regression guard:** lint 0 errors / 872 pre-existing warnings; typecheck clean (root + server projects); build:client clean (3.75s); targeted pure-helper tests all green (sortableTablePure 29/29, buildNavItems all pass, buildRoute all pass, useViewModePure 26/26, colorHash 9/9).

**Doc-sync sweep verdicts:**

| Doc | Verdict |
|-----|---------|
| `architecture.md` | yes (Client Patterns, "How do I…" index) — updated in-build (commit `d7d5ef94`) |
| `docs/capabilities.md` | n/a — Phase 0 ships internal UI primitives only |
| `docs/integration-reference.md` | n/a — no integration behaviour change |
| `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` | no — checked PageShell / Drawer / Modal / SortableTable / FormFooter / SearchBox / EmptyState / ErrorState / WorkspaceBadge / ViewModeSwitcher / colorHash / switchWorkspace / useViewMode / overlayScrollLock / sortableTablePure / APP_ROUTE_PATTERNS / buildRoute / buildNavItems / vite-env / import.meta.env / consolidation-foundation; zero stale references |
| `CONTRIBUTING.md` | no — no change to lint-suppression policy or contributor-facing conventions |
| `docs/frontend-design-principles.md` | no — change-set adds shared primitive components only; no new UI pattern, hard rule, or worked example introduced |
| `KNOWLEDGE.md` | yes (9 entries appended in Phase 3 — focus-trap escape recovery, visibility helper, shared keyframes, `import.meta.env` + `vite-env.d.ts`, `aria-labelledby` + `useId`, runtime-invariant JSDoc for stable sort, reference-counted scroll-lock with HMR-safe Symbol.for, branded route-pattern type with negative-lookahead regex, pure-helper-colocated-with-React-wrapper test pattern) |
| `docs/spec-context.md` | n/a — PR-review session, not a spec-review session |
| `docs/decisions/` | n/a — no durable architectural choice locked in this build |
| `docs/context-packs/` | n/a — no section anchor changed in architecture.md |
| `references/test-gate-policy.md` | n/a — no change to test-gate posture |
| `references/spec-review-directional-signals.md` | n/a — no recurring spec-reviewer signal surfaced |
| `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` | n/a — no framework-level change |

**KNOWLEDGE.md entries added:** 9 (all marked with provenance: finalisation-coordinator finalisation pass on PR #270, slug consolidation-foundation)
**tasks/todo.md items removed:** 0 (no open todo items corresponded to "build consolidation-foundation primitives" — work was scoped via spec.md, not via a todo entry; deferred CONSOL-FND-DEF-1..6 retained intentionally as forward backlog)
**Manual G2 still owed (not finalisation-coordinator scope):** visual diff of Layout sidebar across user shapes; ViewModeSwitcher transitions; SortableTable filter dropdown select-all; direct-URL nav to `/clientpulse` for a non-system-admin without that module.
**ready-to-merge label applied at:** 2026-05-07T08:32:57Z

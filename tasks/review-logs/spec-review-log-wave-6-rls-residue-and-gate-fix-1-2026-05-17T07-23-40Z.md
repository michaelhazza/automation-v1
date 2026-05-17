# Spec review log — wave-6-rls-residue-and-gate-fix iteration 1

- Timestamp: 2026-05-17T07-23-40Z
- Spec commit at start: `9fdcabd7cb8232a84ca9ed4bce5d0b1d689e95dd`
- Codex output: `tasks/review-logs/_codex_wave-6-rls-residue-and-gate-fix_iter1_2026-05-17T07-23-40Z.txt`

## Findings summary

Codex returned 32 distinct findings (C1–C32). Rubric pass added 6 (R1–R6). 28 accepted as mechanical, 5 rejected, 1 auto-rejected as directional.

## Mechanical — ACCEPT

- **C1** §7.1 example DROPS `.where(eq(organisationId, orgId))` but comment says STAYS — fix the example to keep the predicate (critical: would propagate to 1108 callsites).
- **C2** §3 "no schema changes" vs §7.3 WF1 "If still missing, author migration" — clarify contingent migration scope.
- **C3** Chunk 0 categorisation depends on Chunk 1 gate-fix output — reorder: design artefacts produced first; per-callsite categorisation refreshed after Chunk 1.
- **C4** §5.1 Option A/B free choice vs §6.1 Option B mandated for affected gates — align §5.1 to Option B.
- **C5/C17** "Windows-portable harness" without Windows execution — restate goal as "OS-parity guard with seeded fixtures" + drop "Windows-portable" framing (adding a Windows runner = directional scope).
- **C6** Per-gate verdict format undefined — pin columns in §6.1 (script path, uses-find-temp-existsSync, baseline type, Linux count, Windows count, fix decision, residual risk).
- **C7** Per-callsite categorisation lacks Wave-5 mandatory fields — enumerate file:line, call expression, table, tenant key, tier verdict, upstream entrypoint, bypass rationale.
- **C8** Tier 1 acceptance doesn't require preserving query semantics — add same-columns/joins/predicates/order/limit/return-shape requirement.
- **C9** "Honest baseline drops to 0" rule scattered — canonical sentence in §9.
- **C11** `getOrgScopedDb('source')` source-string format unpinned — adopt Wave-5 `serviceName.functionName` convention.
- **C12** Tier 2 `withAdminConnection` contract missing `SET LOCAL ROLE admin_role` — restate.
- **C13** Tier 1 runtime-path evidence not a mandatory categorisation field — elevate.
- **C14** No required harness/audit rerun after final migration chunk — add acceptance criterion.
- **C15** Tier 2 annotation-sweep-last creates per-domain ambiguity — clarify per-domain chunks handle their Tier 2 inline; final sweep audit-only.
- **C16** WF1 RLS policies must precede code migration — sequencing fix in §10.
- **C18** §6.2 harness needs per-gate seeded fixtures (the entire point of the build).
- **C19** Scope says all `verify-*.sh` but `run-all-gates.sh` includes `gates/*.sh` and `.mjs`/`.js` — pin scope: every script invoked by `run-all-gates.sh` with the bug pattern.
- **C20** Baseline file is `scripts/guard-baselines.json` (verified), NOT `.gate-baselines/with-org-tx-or-scoped-db.txt` — correct §5.2.
- **C21** Repo already has direct `glob ^13.0.6` dependency — mandate reuse over `fast-glob`/`globby`.
- **C22** §9 "existing test suite passes" violates CLAUDE.md "test gates are CI-only" — restate as "CI passes".
- **C23** Targeted Vitest for path-handling helper currently optional — mandate extraction + targeted Vitest.
- **C24** WF1 missing-policy migration is unlisted scope — add contingent scope item (tied to C2).
- **C25** Blocked Tier 1 follow-up format unspecified — pin handoff fields.
- **C26** Tier 3 "already-clean" in violation residue is ambiguous — add false-positive bucket OR document exclusion.
- **C27** Tenant-table source-of-truth not named — point at `server/config/rlsProtectedTables.ts`.
- **C28'** Hoist §13 tenant-isolation merge-conflict hard rule to a prominent location (operator-required: "verify it's prominent enough").
- **C29** Concurrent-session coordination covers tier categorisation only, not gate-fix/baseline writes — extend §13.
- **C30** Add §11 risk row for predicate-removal-during-mechanical-migration (ties to C1).
- **C31** "1108 callsites" partitioning — clarify chunk 0 distinguishes raw-`db`-on-tenant-tables (Tier 1/2) vs non-tenant (Tier 3/clean) vs analyser false-positives.
- **C32** §7.1 import-path / name-collision / nesting / `tx`-parameter guidance — extend.
- **R2** §12 "Out of Scope" satisfies the checklist §7 Deferred Items requirement — add a one-line bridging note.

## Mechanical — REJECT

- **C10** `[status:closed:pr:<num>]` IS the repo's convention (verified 100+ uses).
- **R1** YAML frontmatter matches `tasks/builds/<slug>/spec.md` convention (Wave 5 precedent).
- **R3** No Lifecycle Declaration — consolidation-class spec; no new capability cluster (Wave 5 precedent lacks it).
- **R4** No ABCd Estimate — same reasoning as R3.
- **R6** §9 todo-IDs already restated in §1 scope.

## Directional — AUTO-REJECT (framing)

- **C28** §13 tenant-isolation merge-conflict rule lacks enforcement primitives (PR template, protected label, conflict-log). Operator chose operator-review SOP as the mechanism; new enforcement tooling = scope expansion. Framing assumption: pre-production posture; existing SOP is the chosen mechanism.

## Counts

- mechanical_accepted: 28 (C1, C2, C3, C4, C5/17, C6, C7, C8, C9, C11, C12, C13, C14, C15, C16, C18, C19, C20, C21, C22, C23, C24, C25, C26, C27, C28', C29, C30, C31, C32, R2 → consolidated into 28 distinct edits)
- mechanical_rejected: 5 (C10, R1, R3, R4, R6)
- directional_or_ambiguous: 1 (C28 — auto-rejected via framing)
- reclassified_to_directional: 0

# iee-worker-retirement — Progress

**Build slug:** iee-worker-retirement
**Spec:** `tasks/builds/iee-worker-retirement/spec.md`
**Branch:** `claude/hosting-provider-evaluation-oqQDV`
**PR:** [#340](https://github.com/michaelhazza/automation-v1/pull/340)
**Classification:** Standard
**Started:** 2026-05-17

## Build path

Standard path (operator decision 2026-05-17): no architect, no plan-gate, no chatgpt-plan-review. Implement chunks per spec §4 directly with G1 per chunk, then `spec-conformance` → `pr-reviewer` at the end.

## Chunks

- [x] Chunk 1 — Migrate cost-rollup to main server (G1 PASS: lint, typecheck, 2 vitest)
- [x] Chunk 2 — Fail-closed guard + header on `ieeDevBackend.dispatch()` (G1 PASS: lint, typecheck, 2 vitest)
- [x] Chunk 3 — Delete `worker/` directory + Dockerfile / docker-compose / ieeRunCompletedHandler comment + eslint.config.js / vitest.config.ts cleanup (HITL-approved) + iee_runs.ts terminal-status caller-list refresh (G1 PASS)
- [x] Chunk 4 — Tombstone `openclaw-adapter/scope.md`; banner `iee-on-e2b-rollout.md`; partial-supersession banner + per-part banners on `iee-development-spec.md` (Parts 4–8)
- [x] Chunk 5 — Grep verification (source refs: clean; deploy/entrypoint: 1 acceptable match in `verify-no-do-references.sh` deletion-guard) + knip.json worker entries removed + final lint/typecheck/build:server/build:client all green + targeted vitest both files re-run green

## Out-of-spec fixes flagged for operator review

1. **`cost_aggregates.organisation_id` NOT NULL.** Migration 0272 added a NOT NULL `organisation_id` column to `cost_aggregates`. The original worker SQL did not supply this column — so the worker's daily rollup would have failed on every insert against the post-0272 schema. The migrated `runIeeCostRollup` now sources `organisation_id` from the existing `GROUP BY organisation_id` clause. Surfacing as the spec asked for "the SQL upsert still writes" verification.
2. **`server/db/schema/ieeRuns.ts` TERMINAL STATUS FINALITY CONTRACT** comment refresh. The schema comment listed three deleted worker callers as the only writers of terminal status. Refreshed in place to point at the live callers (`_ieeShared.ts::ieeFinalise()`, `_ieeShared.ts::ieeDispatch` orphan branch, `agentRunCancelService.ts`).
3. **`eslint.config.js` worker T8 boundary rule** + **`vitest.config.ts` worker/** exclude removed (HITL-approved both edits). The rule files matched empty file sets after deletion.
4. **`knip.json`** entry + project patterns updated to drop `worker/src` paths so knip's orphan detector doesn't flag non-existent paths.

## Adjacent docs with stale worker references (not in this spec's audit scope)

These were NOT modified — they are spec-context records and revising them is out of scope for this build. Surface for operator decision:
- `docs/iee-delegation-lifecycle-spec.md` — refers to worker-side state machine writers.
- `docs/reporting-agent-paywall-workflow-spec.md` — refers to worker-side login + persistence layout, including the deleted ESLint T8 rule.
- `docs/agentic-commerce-exploration-report.md` — historical investigation report citing the worker design.
- `docs/ci-readiness-report.md` — historical CI report referencing worker test layout.
- `KNOWLEDGE.md:2112, 2118, 2285` — historical entries (KNOWLEDGE.md is append-only by convention; per CLAUDE.md §3 do not edit existing entries).

## Doc-sync gate

Per `docs/doc-sync.md` investigation procedure. Grep terms drawn from branch diff: `worker/`, `worker process`, `IEE worker`, `iee-dev-task`, `iee-cost-rollup-daily`, `iee_dev_backend_retired`, `cost_aggregates.organisation_id`, `IEE_DEV_TASK_CONSUMER`.

- architecture.md updated: yes (`### Worker service` section rewritten as retirement record; `### Other shared primitives` table updated; `Run artefact handling` section updated; `IEE delegation lifecycle` Step 2 updated; IEE idempotency table cancelled-row text updated)
- capabilities.md updated: n/a: internal refactor with no capability surface change
- integration-reference.md updated: n/a (no integration scope / skill / status / OAuth / MCP changes)
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: n/a (grepped both — zero worker refs; no build-discipline / convention / RLS / §8 changes)
- CONTRIBUTING.md updated: n/a (no lint-suppression policy changes)
- frontend-design-principles.md updated: n/a (no UI changes)
- KNOWLEDGE.md updated: yes (1 entry — cross-process producers vs NOT NULL column migration drift)
- spec-context.md updated: n/a (not a spec-review session)
- docs/decisions/ updated: n/a (no durable architectural choice locked beyond what the spec itself records)
- docs/context-packs/ updated: n/a (grepped — no anchor refs to worker sections)
- references/test-gate-policy.md updated: n/a (no test-gate posture change)
- references/spec-review-directional-signals.md updated: n/a (no directional signal surfaced >2 times)
- docs/incident-response.md updated: n/a (no incident response changes)
- docs/testing-transition-plan.md updated: n/a (no testing phasing changes)
- .claude/FRAMEWORK_VERSION + CHANGELOG: n/a (repo-specific change, not framework-layer)
- scripts/verify-* gates updated: yes — `scripts/lib/check-knip-config.mjs` and `scripts/verify-knip-config.sh` updated to drop the now-non-existent worker entry from the required-surface assertion. No gate name change; no suppression-grammar change; references/test-gate-policy.md is not affected.

## Superseded sections in docs/iee-development-spec.md

Top-level partial-supersession banner added directly under doc title.

Per-part SUPERSEDED 2026-05-17 banners added on:
- Part 4 — Worker Service Skeleton (entire part — describes deleted worker/)
- Part 5 — Execution Loop, Observation & Action Schemas, LLM Integration (worker-internal loop)
- Part 6 — Browser Execution Handler (worker-side handler; replaced by e2b harness + ieeBrowserBackend)
- Part 7 — Dev Execution Handler (worker-side; replaced by fail-closed guard on ieeDevBackend)
- Part 8 — Tracing, Logging & Failure Classification (worker-side classification module; shared FailureReason enum stays)

Remaining authoritative parts (declared in top banner):
- Part 1 — Architecture & Codebase Integration
- Part 2 — Data Model & Migrations (iee_runs schema unchanged)
- Part 3 — Job Contracts (cost-rollup now main-server; iee-dev-task definitions retained for contract compatibility, fail-closed at adapter)
- Part 9 — AgentExecutionService Routing (already superseded by docs/iee-delegation-lifecycle-spec.md per existing note)
- Part 11 — Cost Attribution (data model survives; isolated worker handler refs at line 1513 are now dead and read as historical)
- Parts 12–13 — Risk & Robustness (applies to e2b path; isolated worker module refs are dead)

## LEARNING_FEEDBACK_PROPOSAL

| Pattern | Target | Rationale | Operator decision |
|---|---|---|---|
| `timestamptz` daily rollups must cast `AT TIME ZONE 'UTC'` inside `date_trunc('day', ...)` | `regression-test` | A grep-pattern gate (`date_trunc.*'day'` without `AT TIME ZONE 'UTC'` on timestamptz columns in `server/jobs/**/*.ts`) catches this class of bug at CI time | |
| Retired-backend dispatch must fail closed + carry a regression-guard test | `agent-instruction` (spec-coordinator) | Encode in the spec-authoring checklist for backend-retirement specs — fail-closed guard + enum failure-reason + test is a non-obvious invariant that reviewers miss | |
| Cross-process producers vs NOT NULL column migration drift | `hook-or-grep-gate` | Migrations that add NOT NULL columns to tables with cross-process producers (separate worker, sandbox, external service) need an explicit cross-process audit step in the migration review checklist | |

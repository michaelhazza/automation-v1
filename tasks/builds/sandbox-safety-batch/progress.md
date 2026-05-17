# Phase 2 (BUILD) progress — sandbox-safety-batch

**Spec:** `tasks/builds/sandbox-safety-batch/spec.md`
**Branch:** `claude/sandbox-safety-batch`
**Spec scope:** 22 items across 3 critical, 6 high, 5 spec-conformance REQ, 6 medium/observe, 2 additional. Out-of-scope per spec §12: SANDBOX-DEF-EGRESS-MECH, SANDBOX-F1, SANDBOX-R3-T2, OSI-DEF-2..13.

---

## Pre-architect resolution

### REQ #35 — `sandboxArtefactPurgeJob` trigger from run-soft-delete

**Operator decision (2026-05-15):** Event-driven listener via service-layer enqueue. Wherever an `agent_runs` row is soft-deleted, the service method that performs the UPDATE also calls `queueService.send('sandbox-artefact-purge', { sandboxExecutionId })` for each affected `sandbox_executions` row.

**Rationale:** Matches codebase precedent (sandbox-isolation, ea-v1, agentic-commerce all enqueue from the service layer rather than from DB triggers). DB triggers that talk to pg-boss are atypical in this repo and harder to test.

**Bypass mitigation (architect to wire into the plan):**
- Single canonical helper (e.g. `softDeleteAgentRun()`) that all callers route through.
- The helper is the only function permitted to write `agent_runs.deleted_at`.
- Optional: a verify gate scanning for raw `deletedAt` writes outside the helper.

---

## Pre-existing condition — migration-number collision on main

Two migrations on `origin/main` share prefix `0359`:
- `0359_skill_analyzer_results_rls.sql` (PR #320, merged 2026-05-15)
- `0359_workflow_runs_org_permissions.sql` (PR #319, merged 2026-05-15)

This collision is inherited from main, not introduced by this branch. The S1 freshness check is therefore informational only — no resolution needed in this build. **New migrations for sandbox-safety-batch start at 0360.**

---

## S1 freshness check

- `git fetch origin main` — clean
- Branch created from `origin/main` HEAD `795f0fed` — no merge required
- Migration-number collision on this branch vs main: none (architect numbers from 0360+)
- Post-merge typecheck: not required (no merge commit)
- Overlapping-files guard: not required (no merge)

---

## Plan

Architect wrote the 14-chunk plan to `tasks/builds/sandbox-safety-batch/plan.md` (2026-05-15).

**Notable plan-time framing corrections** discovered during the chunk-0 sweep:
- Spec §4 named `sandbox_harvest_runs` as one of the 5 missing-FK tables — that table does not exist. Actual 5th table is `sandbox_egress_audit`.
- SANDBOX-ADV-4.1 case-insensitive credential-leak filter is **already fixed** in main from PR #287 fix-loop (commit `c5167bc5`). Chunk 9 only extracts the inline logic into a pure helper + adds the missing targeted Vitest.
- REQ #11, REQ #28, REQ #29 are **already CONFORMANT** per spec-conformance Round 2 (2026-05-11T08-35-46Z). Chunk 14 records acceptance, no code change.

**chatgpt-plan-review:** autonomously skipped per operator directive (autonomous mode for this Wave 2 Session C build). The plan still goes to chatgpt-pr-review at Phase 3 — second-opinion coverage is preserved at the diff level, not the plan level. This is consistent with the PR #273 (consolidation-govern) precedent.

**Plan-gate:** auto-proceed per operator directive.

---

## Per-chunk progress

(Filled in during Step 6 per-chunk loop.)

---

## G2 integrated-state gate

(Filled in during Step 7.)

---

## Branch-level review pass

(Filled in during Step 8.)

---

## Doc Sync gate

Investigation procedure executed per `docs/doc-sync.md` against the cumulative branch diff. Grep terms checked: `sandboxArtefactPurgeJob`, `softDeleteAgentRun`, `agentRunSoftDeleteService`, `sandboxTelemetrySequencePure`, `allocateAndInsertTelemetryEvent`, `telemetryWriter`, `ceilingMonitorRaceDecision`, `MAX_LOG_LINE_BYTES`, `MAX_LOG_LINE_CHARS`, `credentialAliases`, `hashtext`, `sandbox_harvest_runs`.

- **architecture.md updated**: no — grepped the 7 new sandbox symbols + `sandbox_harvest_runs`; zero stale references. New helpers are implementation details under the existing § Sandbox Isolation primitive section. The only `hashtext::bigint` hit (line 3017) is in the playbook-run pattern, an unrelated context.
- **capabilities.md updated**: n/a: internal refactor with no capability surface change. This build is a bug-fix batch closing the open sandbox-isolation backlog; it does not create, mutate, split, or merge any capability surface.
- **integration-reference.md updated**: n/a — sandbox is an internal subsystem, not an external integration; no scope/skill/status/OAuth/MCP changes.
- **CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated**: no — no changes to build discipline, conventions, agent fleet, review pipeline, or §8 development discipline rules. The build references existing rules (§8.10, §8.13, §8.33, §8.35, §8.36) but does not modify them.
- **frontend-design-principles.md updated**: n/a — no UI changes in this build.
- **KNOWLEDGE.md updated**: yes (6 entries appended) — bare-`db` on FORCE RLS silently fails; `hashtext(uuid)::bigint` gives 32-bit entropy; `char_length` vs `Buffer.byteLength` unit mismatch; Drizzle `$type<>` is documentation not enforcement; migration CHECK without backfill UPDATE fails on existing data; optional-callback contracts (e.g. `telemetryWriter`) only meet spec when every caller wires them.
- **spec-context.md updated**: n/a — feature pipeline, not a spec-review session.

---

## Acceptance criteria — CI-deferred items (operator-acknowledged 2026-05-15)

Spec §10 lists seven acceptance criteria. Three are CI-only per the operator's standing rule (`references/test-gate-policy.md` and CLAUDE.md §4) — they are NOT run locally; CI is the canonical source. The reality-checker initial verdict flagged this gap; the operator's standing rule supersedes:

- **Criterion 2 — `npm run build:server`**: CI-deferred. Local typecheck via `tsc --noEmit -p server/tsconfig.json` is the local proxy; full server build runs in CI.
- **Criterion 5 — `verify-rls-coverage.sh` + `verify-rls-protected-tables.sh` + `verify-with-org-tx-or-scoped-db.sh`**: CI-deferred. These three scripts are explicitly listed in the spec but the standing test-gate policy makes them CI-only; CI greenness before merge is the proof.
- **Criterion 6 — targeted Vitest run**: Test files are AUTHORED locally for every new pure-helper (15 files listed in the reality-checker evidence); the RUN is CI-deferred per the operator's no-tests-during-dev memory.
- **Criterion 7 — todo.md item closure with `[status:closed:pr:<num>]`**: Post-merge action handled by finalisation-coordinator. Pre-merge state shows `[ ]` (expected).

Local-verified criteria: 1 (spec §5-8 items via spec-conformance Round 2 CONFORMANT_AFTER_FIXES), 3 (`npm run lint` exits 0), 4 (4 migration pairs present). Items deferred to CI / finalisation: 2, 5, 6, 7.

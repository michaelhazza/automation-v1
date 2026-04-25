# Audit Remediation — Progress

**Build slug:** `audit-remediation`
**Source spec:** `docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md`
**Plan:** `tasks/builds/audit-remediation/plan.md`
**Status:** `not_started`
**Started:** —
**Last updated:** 2026-04-25 (plan authored)

---

## Chunk progress

| # | Chunk | Spec sections | Branch / PR | Status | Notes |
|---|---|---|---|---|---|
| 1 | `phase-1-rls-hardening` | §4.1 – §4.6 | — | [ ] not started | |
| 2 | `phase-2-gate-compliance` | §5.1 – §5.8 | — | [ ] not started | |
| 3 | `phase-3-architectural-integrity` | §6.1 – §6.3 | — | [ ] not started | |
| 4 | `phase-4-system-consistency` | §7.1 – §7.4 | — | [ ] not started | |
| 5 | `phase-5a-rate-limiter-shadow-mode` | §8.1 PR 1 | — | [ ] not started | |
| 6 | `phase-5a-rate-limiter-authoritative-flip` | §8.1 PR 2 | — | [ ] not started | Pre-condition: Chunk 5 on `main` for ≥ 1 operator-observed window |
| 7 | `phase-5a-silent-failure-path-closure` | §8.2 | — | [ ] not started | Independent of Chunks 5/6 |
| 8 | `phase-5b-optional-backlog` | §8.3, §8.4 | — | [ ] not started | Multiple PRs in any order; programme blocker only as listed in spec §13.5B |

---

## Session log

(Append a dated entry per session; record what was done, what's next, any decisions made.)

### 2026-04-25 (session 3) — Chunks 1 and 2 complete; paused for session handoff

**Completed this session:**
- Chunk 1 (Phase 1 — RLS hardening): commit `c6f491c3` — migration 0227, 6 new services, 13 route refactors, cross-org write guards, subaccount resolution, gate baselines. TypeScript errors in Phase 1 files fixed (req.userId → req.user!.id, webLoginConnections incomplete refactor, findLink() added to subaccountAgentService).
- Chunk 2 (Phase 2 — Gate compliance): commit `79b6e89f` — allowlist path fixed, canonical-read enforcement, countTokens re-routed through llmRouter, principal context propagation in 6 files, canonical dictionary additions (canonical_flow_definitions + canonical_row_subaccount_scopes). §5.5 skill read-path skipped (lowest priority, enumeration not quick).
- plan.md updated: gate scripts only run at programme start (baseline) and end (final pass), not per chunk.
- architect.md updated: explicit Gate-Timing Rule added to Architecture Constraints section.

**Next: Chunk 3 — Phase 3 Architectural integrity**
- Create `shared/types/agentExecutionCheckpoint.ts` (extract 4 types: AgentRunCheckpoint, SerialisableMiddlewareContext, SerialisablePreToolDecision, PreToolDecision)
- Update `server/services/middleware/types.ts` to re-export from shared
- Update `server/db/schema/agentRunSnapshots.ts:3` to import from shared (breaks 175-cycle cascade)
- Extract ProposeInterventionModal cluster to `client/src/components/clientpulse/types.ts`
- Extract SkillAnalyzerWizard cluster to `client/src/components/skill-analyzer/types.ts`
- Ship gate: `npx madge --circular --extensions ts server/ | wc -l` ≤ 5; client cycles ≤ 1; build passes

**Deferred from Chunk 2:** §5.5 skill read-path completeness (enumerate missing readPath entries in actionRegistry.ts) — not a blocker; left for Chunk 2 follow-up or Phase 5B.

### 2026-04-25 (session 2) — Implementation session started, paused for operator login change

- Branch: `feat/codebase-audit-remediation-spec` (all implementation happens here)
- Pulled `main` to get 227 commits of upstream work before starting
- Ran Phase 1 gates to capture current baseline (pre-implementation):
  - `verify-rls-session-var-canon.sh` — 8 violations in historical migrations 0204–0208, 0212 (expected; will be baselined in 1E)
  - `verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh`, `verify-org-scoped-writes.sh`, `verify-subaccount-resolution.sh` — outputs captured in background tasks (not yet read)
- **Next when resuming:** Start Chunk 1 implementation — dispatch implementer subagent (or inline) with the full 1A–1E steps. Gate baseline is pre-captured.
- **No code has been written yet.** All chunks still at `not_started`.

### 2026-04-25 — Plan authored

- Loaded context: CLAUDE.md, architecture.md, docs/spec-context.md, tasks/current-focus.md, the audit remediation spec in full, and confirmed gate-script paths.
- Decomposed the spec's 5 phases into 8 chunks following the spec's §2.6 PR boundaries (Phases 1–4 each one PR; Phase 5A §8.1 split into 2 PRs; §8.2 separate; Phase 5B as a fan-out chunk with multiple optional PRs).
- Wrote `tasks/builds/audit-remediation/plan.md` and this `progress.md`.
- **Next:** human review of `plan.md`. After review, switch to Sonnet and begin Chunk 1 via `superpowers:executing-plans` (per CLAUDE.md plan gate convention).

---

## Decisions log

(Record any architectural or scoping decisions made during execution that diverge from the spec. Each entry should reference the spec section.)

(none yet)

---

## Deferred items captured during execution

(When a chunk's PR review or `spec-conformance` run routes items to `tasks/todo.md`, mirror the high-level summary here so this file remains the single source of truth for build state. The detailed entries live in `tasks/todo.md`.)

(none yet)

---

## Audit closure status

Rollup of items routed to `tasks/todo.md` from the original audit and any subsequent re-runs. Updated as items move between states. Filter source: `tasks/todo.md` entries tagged `[origin:audit:<scope>:<timestamp>]`. See `tasks/review-logs/README.md` § *Item format — origin tag + status*.

| Audit (origin) | Open | In progress | Resolved | Won't fix | Total |
|---|---:|---:|---:|---:|---:|
| `audit:full:2026-04-25T07-09-00Z` (full audit, 47+16) | TBD | 0 | 0 | 0 | TBD |

(Update the row counts when triaging audit findings into chunks. A new row is added per re-run.)

---

## Programme completion checklist (from spec §13.6)

- [ ] All five phase DoDs satisfied (Chunks 1–7 ship gates green; Chunk 8 items landed or deferred).
- [ ] Every audit finding (P3-C1 … P3-L10) is either resolved or appears in spec §14 Deferred Items with operator sign-off.
- [ ] A retro entry has been added to `KNOWLEDGE.md` summarising what shipped, what deferred, and what changed in the gate baselines.
- [ ] `tasks/current-focus.md` is updated to reflect the programme's completion and unblocks feature development.

The operator owns the decision to declare the programme complete.

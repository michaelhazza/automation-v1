# Handoff — synthetos-foundation-refactor

**Phase complete:** SPEC (Phase 1)
**Next phase:** BUILD (Phase 2 — run `feature-coordinator` in a new session)
**Spec path:** `tasks/builds/synthetos-foundation-refactor/spec.md`
**Brief path:** `docs/synthetos-governed-agentic-os-brief-v1.2.md` (v1.2, Section 18.1 = the six Phase 1 foundation items this spec implements)
**Branch:** `claude/openclaw-worker-mode-VnjQT`
**Build slug:** `synthetos-foundation-refactor`
**Scope class:** Major (foundation refactor across schema, services, API contract, action registry, UI surfaces; six logically-distinct items)
**UI-touching:** yes
**Mockup paths:** n/a (no hi-fi prototypes were authored — UI changes in §5 are descriptive, applied to the existing Run Trace + Agent Config + Approval UX + Credentials surfaces)

---

## Spec status

**Phase 1 closed.** Implementation-ready, ChatGPT-approved at Round 2 close. No architectural rewrites required.

- Spec line count: **2299 lines**
- 12 sections present (Status/Anchors, Background, Goals/Non-Goals, Constraints/Invariants, Component Design 4.1–4.6, UI Changes, Migrations, Test Strategy, Rollout, Acceptance, Risks, Deferred, Open Decisions)
- All 12 Open Decisions (§12.1–§12.7) marked **RESOLVED**; none pending operator/architect input at build start
- Companion CSV artefact: `tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv` (per §12.5 — to be authored during the §4.2 Risk Tier sweep chunk)

---

## Review history summary

### spec-reviewer (Codex loop) — 3 iterations of 5

- Per-iteration logs: `tasks/review-logs/spec-review-log-synthetos-foundation-refactor-{1,2,3}-*.md`
- Codex transcripts: `tasks/review-logs/_codex_synthetos_foundation_iter{1,2,3}_*.txt`
- Final summary: `tasks/review-logs/spec-review-final-synthetos-foundation-refactor-2026-05-09T07-34-15Z.md`
- Verdict: `READY_FOR_BUILD`. Iteration 3 closed mechanical tightening (terminal status fixes + governance enforcement); did not exhaust the 5-iteration cap

### ChatGPT-web spec review — Round 1 (2026-05-09)

- Verbatim review notes captured during the manual loop
- 7 mechanical findings auto-applied; 3 user-approved directional adjustments
- Commit: `06020dee docs(synthetos-foundation-refactor): chatgpt-spec-review round 1 — 7 auto-applied + 3 user-approved`

### ChatGPT-web spec review — Round 2 (2026-05-09)

- 4 final tightenings applied; spec locked
- Commit: `b2786c84 docs(synthetos-foundation-refactor): chatgpt-spec-review round 2 — 4 final tightenings, ready to lock`
- Combined session log: `tasks/review-logs/chatgpt-spec-review-synthetos-foundation-refactor-2026-05-09T07-43-56Z.md`
- Final commit: `bd48fa8e docs(synthetos-foundation-refactor): finalize ChatGPT spec review session — APPROVED`
- Verdict: **APPROVED.** No Round 3 needed.

---

## Open questions for Phase 2

**None blocking build start.** All 12 open decisions are resolved (§12). Phase 2 build proceeds against the spec as written.

Items the architect should still cite/produce during planning (not blockers):

- **Risk Tier assignment CSV** (§4.2.6, §9.5) — must ship at `tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv` before the §4.2 chunk closes; architect sign-off required per §9.5.
- **Q5 in §12.1** — `CONTROLLER_LIMITS.operator.maxLoopIterations = 100` is the resolved default; architect to revisit post-Spec-C with real-workload data (post-merge follow-up, not Phase 2 work).

---

## Decisions made in Phase 1 (locked into the spec)

Recorded in §12 — quick-reference list:

- §12.1 Operator default loop iteration limit = **100** (configurable per agent)
- §12.2 Per-subaccount Risk Tier defaults = **deferred to Phase 1.5**; per-agent defaults sufficient for Phase 1
- §12.3 Run Trace pagination = **limit 50, max 200**
- §12.4 Policy Envelope snapshot location = **JSONB column on `agent_runs`** (not a separate table)
- §12.5 Risk Tier CSV = **separate artefact** at `tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv`
- §12.6 Phase-3 placeholder rows in Models and Identity tab = **ship grayed-out**, label "Phase 3 — coming soon"
- §12.7 Build invocation pattern = **single `feature-coordinator` run**, chunked plan covering all six items in §8.1 phase order (1A → 1D)

Additional Phase 1 framings the architect must respect when building the plan:

- Closure of `allowed_environments` is enforced in **application-layer Zod**, not as a Postgres enum (§3.6, §9.1) — runtime backstop is mandatory.
- All migrations require `.down.sql` counterparts that succeed on staging (§9.1).
- Two new advisory CI gates are **sketched but explicitly deferred** (§11): `verify-controller-style-mapping.sh` and `verify-no-direct-credential-service-calls.sh`. Phase 2 should NOT implement these — visual review at PR time covers Phase 1.
- Performance baselines are deferred per `performance_baselines: defer_until_production` (§7.5); alerting thresholds (e.g. p95 > 500ms on `foundation.run_trace.queried`) ARE in scope.
- Naming pass produces **glossary + awareness comments only** (§4.6, §11 NG7) — service-wide renames are forbidden in Phase 2.

---

## Deferred items (post-merge backlog)

19 items enumerated in **spec §11** (do not inline — read directly). Categories:

- **Out of scope by product principle:** per-task sandbox isolation (NG1), ExecutionBackend adapter (NG2 — Phase 3), Operator Session Identity (NG3 — Phase 3), canonical Run Trace event ledger (NG4 — Phase 3+), per-task containers / Firecracker / K8s (NG5 — Phase 3+), service-wide renames (NG7), AI/Models settings tab (NG8 — Phase 1.5), cost analytics dashboards (NG9), Marketplace/multi-region/full-autonomy (NG10 — Phase 4+).
- **Downstream Phase 1 specs:** 42 Macro Task Full MVP + Support Inbox showcase MVP (NG6) — Specs B and C, not this build.
- **Phase 1.5 follow-ups:** Run Trace details panel (§5.1.4), Beliefs tab (§5.2.7), per-agent cost limits (§5.2.7), escalation rules matrix (§5.2.7), BYO API keys (§5.2.7), per-subaccount Risk Tier defaults (§12.2), Phase-3 placeholder rows actual feature behind them (§12.6).
- **Test posture:** frontend / E2E / API contract / composition tests (§7.1) — none added by this spec; performance baselines (§7.5).
- **Advisory CI gates:** `verify-controller-style-mapping.sh` and `verify-no-direct-credential-service-calls.sh` (§11).

---

## Phase 2 entry note (operator-written, not from spec-coordinator)

The Phase 1 → Phase 2 handoff was not written automatically by `spec-coordinator` at the close of Round 2. This file was authored at Phase 2 entry (2026-05-09) by the operator-driven `feature-coordinator` adoption, reconstructed from the spec, the four spec-review-related commits (`58d4c477`, `06020dee`, `b2786c84`, `bd48fa8e`), and the per-iteration review logs. Build proceeds on the existing branch `claude/openclaw-worker-mode-VnjQT` per operator confirmation.

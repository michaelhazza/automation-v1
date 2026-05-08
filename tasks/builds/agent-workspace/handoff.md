# Handoff — agent-workspace

**Phase complete:** SPEC (Phase 1)
**Next phase:** BUILD (Phase 2 — run `feature-coordinator` in a new session)
**Spec path:** `tasks/builds/agent-workspace/spec.md`
**Brief path:** `docs/agent-workspace-implementation-brief.md` (Rev 10, LOCKED)
**Branch:** `claude/add-agent-cloud-compute-Kb4ii`
**Build slug:** `agent-workspace`
**Scope class:** Major (new subsystem — agent presence, working-time accounting, cloud-compute sessions, live-event projection, Agent Workspace UI consolidation)
**UI-touching:** yes
**Mockup paths:**
- `prototypes/agent-workspace/index.html`
- `prototypes/agent-workspace/01-home-widget.html`
- `prototypes/agent-workspace/02-overview-tab.html`
- `prototypes/agent-workspace/03-overview-running.html`
- `prototypes/agent-workspace/04-overview-degraded.html`
- `prototypes/agent-workspace/05-run-trace-lineage.html`

Mockups are the design source of truth for Overview tab (Mockups 2/3/4), Home widget (Mockup 1), and run trace lineage (Mockup 5). Per brief Rev 10 lock, the spec was designed TO the mockups — Phase 2 must not redesign these surfaces.

---

## Spec status

**Phase 1 closed.** The spec is implementation-ready with hardening. Both review loops complete. No architectural rewrites required. Operator verdict: *"the spec now has the characteristics of a build-safe contract: explicit invariants, deterministic ordering, bounded operational semantics, replay/idempotency classification, lock scope clarity, and degradation-mode behaviour pinned."*

- Spec line count: **1599 lines**
- File inventory locked at §5 — Phase 2 plan must respect this
- All 19 spec sections present (goals, file inventory, data model, contracts, RLS, execution model, phase plan, execution-safety, state machine, transport, capabilities, coordination, testing posture, open questions, deferred items, self-consistency)

---

## Review history summary

### spec-reviewer (Codex loop) — 5 rounds, hit lifetime cap

- All 5 iterations recorded in `tasks/review-logs/_codex_agent_workspace_iter{1..5}_*.txt`
- Final summary: `tasks/review-logs/spec-review-final-agent-workspace-2026-05-08T11-44-56Z.md`
- **41 mechanical findings** auto-applied across rounds
- Codex hit the 5-iteration lifetime cap — directional review is operator-owned per `spec-reviewer` contract
- Non-blocking per the agent's own contract; Phase 1 continued to ChatGPT review

### ChatGPT-web spec review — Round 1 (2026-05-08)

- Verbatim review: `tasks/builds/agent-workspace/chatgpt-spec-review-round-1.md`
- Verdict: *implementation-ready with hardening*
- **8 findings**, all mechanical/technical — applied directly to spec; no operator-judgement calls required
- Coverage: projection-writer race tiebreaker, observation supersession cycle guard, SSE single-node topology lock, working-time bucket-split invariant, monotonic clock for degraded timers, observation 8KB hard cap, projection rebuild chunking contract, filesSnapshot cache invalidation triggers

### ChatGPT-web spec review — Round 2 (2026-05-08)

- Verbatim review: `tasks/builds/agent-workspace/chatgpt-spec-review-round-2.md`
- Format: regression-surface verification of the 8 Round 1 changes
- Audit found **7 mechanical gaps** — all fixed in-spec
- 1 genuine latent consistency bug closed: §12.3 hysteresis was using wall-clock + SQL-delta in direct contradiction of the monotonic-clock requirement; rewritten to use `process.hrtime.bigint()` against in-process `Map`
- 6 precision tightenings: deterministic `(created_at DESC, id DESC)` tiebreaker on observation reads, explicit cycle-DFS scope + `SELECT … FOR UPDATE` row-locks, UTC-anchored bucket math leading the §7.5 block, `Buffer.byteLength(body, 'utf8')` pinned for octet count, "at-least-once replay; idempotent projection writes" classifier on rebuild, file-lifecycle triggers expanded from 4 → 7 categories
- ChatGPT verdict: *"if Round 2 comes back mostly clean after those surfaces are checked, move directly to handoff rather than continue review cycling"*
- Operator confirmed: **no Round 3.** Diminishing returns reached; dangerous ambiguity classes closed.

## Outstanding open questions for Phase 2

11 open questions logged at **spec §17** (do not inline — read directly). Summary by ownership:

- **Phase 1 owns 2 questions** that block Phase 5 build start: (Q4) deep-link query param contract finalisation; (Q11) Phase 1 file-lifecycle event names AND coverage. Phase 2 must coordinate with Phase 1 spec author before scheduling Phase 5.
- **Phase 2 builder owns 4 questions**: (Q3) idle-timeout configurability — locked at global default 300s for v1; (Q5) container handle lifecycle on failure — locked at 24h retention for v1; (Q6) worst-case Overview payload profiling owner; (Q9) anti-fake-progress validator location — locked at focus-line summariser server-side; (Q10) current-focus cache backend — defaults to process-local memory if Redis is not in use.
- **Resolved (do not re-open):** Q1 (SSE locked, no WebSocket); Q2 (default-tab migration UX locked); Q8 (sub-agent delegation cost roll-up read path resolved).
- **Profiling-gated:** (Q7) materialised activity-feed projection — deferred unless profiling shows it's needed.

---

## Deferred items (post-merge backlog)

19 deferred items logged at **spec §18** (do not inline — read directly). Categories:

- Phase 1-owned (4 items): workspace artifact store, per-agent Data Sources tab refresh, per-agent memory editing surface, Memory tab
- Out of scope by product principle (3 items): Dedicated Agent Runtime tier, always-on compute, cross-task container reuse
- v1.1 follow-ups (5 items): live workspace mutation, Active Session drill-in modal, multi-agent shared workspaces, `is_pinned` operator surface, per-agent override of session idle-timeout
- Future / breadcrumb-only (4 items): Confidence surface, presence privacy redaction, self-narrating agents priority-2 focus chain, materialised activity-feed projection
- Infrastructure (3 items): multi-node SSE fan-out broker, `agent_presence_projections` rebuild job, section-collapse persistence

Phase 2 must NOT implement deferred items — if a chunk surfaces a need that pulls a deferred item back in scope, escalate before adding it to the plan.

---

## Phase 2 entry checklist

`feature-coordinator` workflow per `.claude/agents/feature-coordinator.md`:

1. **Context load** — CLAUDE.md, architecture.md, this handoff, the spec (`tasks/builds/agent-workspace/spec.md`), the brief, the mockups
2. **S1 branch sync** — verify branch is current with main
3. **Plan authoring (Opus)** — invoke `architect` to decompose the spec into ordered build chunks. Output → `tasks/builds/agent-workspace/plan.md`. Plan MUST respect the file-inventory lock at spec §5 and the phase dependency graph at spec §10.
4. **`chatgpt-plan-review`** — manual ChatGPT-web review of the plan; auto-invoked by feature-coordinator
5. **Plan gate** — feature-coordinator stops; operator reviews plan and **manually switches model to Sonnet** before continuing
6. **Builder loop (Sonnet)** — per-chunk: builder writes the chunk → G1 gate (lint + typecheck) → spec-conformance (if relevant) → pr-reviewer → fixes → progress update
7. **Branch review pass** — once all chunks land: dual-reviewer (if Codex available), adversarial-reviewer (auto-invoked when diff matches security surface §5.1.2), and chatgpt-pr-review (manual ChatGPT-web loop) at branch level
8. **Phase 3 handoff** — feature-coordinator writes the FINALISE handoff and updates `tasks/current-focus.md` to REVIEWING / MERGE_READY

## Things Phase 2 needs to know that aren't obvious from the spec

1. **The spec is implementation-ready with hardening — no architectural rewrites needed.** Both review loops surfaced precision invariants, not design changes. The plan should treat the spec as locked contract, not malleable scaffold.

2. **File-inventory lock is binding (spec §5).** Every migration number, table name, column name, route path, and file path is fixed. If Phase 2 needs to add a file not in §5, that is a spec amendment — escalate to a fresh spec-coordinator pass; do not silently append to the plan.

3. **Phase 1 coordination is real.** Two open questions (Q4 deep-link contract, Q11 file-lifecycle event names) require Phase 1 spec author confirmation BEFORE Phase 5 build chunks land. The plan should sequence so Phase 5 builder waits on those confirmations — do not block earlier phases.

4. **Mockups are the visual canon.** Brief Rev 10 locked the spec to the mockups, not the other way around. Builders must compare implementation against the prototype HTML files; any divergence is a builder bug, not a spec bug.

5. **Pre-production posture (per `docs/spec-context.md`).** No live data corruption to recover from in v1; rebuild contract is locked at §6.3 but the rebuild job itself is deferred. Builders should not over-invest in migration ergonomics for hypothetical existing tenants — there are none in production.

6. **Testing posture: pure-function unit tests only mid-build** (per user-preference filter and CLAUDE.md). Per-chunk verification is `npx tsc --noEmit` only. Full test suites are CI-only. Do NOT run `run-all-unit-tests.sh` mid-build.

7. **Hardened invariants the builder MUST NOT relax:**
   - `(event_timestamp ASC, event_id ASC)` deterministic ordering for projection writes
   - `process.hrtime.bigint()` monotonic clock for degraded-state hysteresis (NOT wall-clock + SQL-delta)
   - `Buffer.byteLength(body, 'utf8')` for the 8KB observation cap (NOT `body.length`)
   - UTC-anchored, half-open, non-overlapping bucket intervals for working-time accounting
   - Single-node SSE publisher topology — multi-node broker is deferred (§18)
   - `SELECT … FOR UPDATE` row-locks during cycle-DFS supersession traversal
   - Per-agent partition basis (concurrency=4) for projection rebuild — never per-org / per-run / unbounded global

8. **Capabilities / positioning rewrite (spec §14, Phase 6).** This is the operator-facing positioning update for `docs/capabilities.md`. Do not let it slip — the deliverable is part of the build, not a doc-sync afterthought.

---

## Model guidance reminder

| Phase 2 step | Model | Why |
|---|---|---|
| Plan authoring (architect invocation) | **Opus** | Decomposing a Major spec into chunks needs reasoning capacity |
| Plan gate (operator review) | — | Manual checkpoint; switch model before continuing |
| Builder loop (per-chunk implementation) | **Sonnet** | Plan is clear; execution is token-intensive; Sonnet handles a clear plan equally well |
| Mid-build hard architectural choice | Switch to **Opus** for that question only, then back to Sonnet |
| Branch review pass | Whatever each review agent specifies in its definition |

---

## Phase 3 (FINALISE)

To be filled in by `finalisation-coordinator` after Phase 2 completes. Do not pre-populate.

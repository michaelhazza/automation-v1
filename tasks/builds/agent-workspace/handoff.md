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

## Phase 2 (BUILD) — complete

**Plan path:** `tasks/builds/agent-workspace/plan.md` (Rev 4 — migration renumber post-S2)
**Chunks built:** 13 of 14 (Chunk 12 deliberately deferred per spec — HARD-BLOCKED on Phase 1 contract lock; intentional and pre-approved)
**Branch HEAD at handoff:** `57334bec`
**Branch state:** 0 behind / 55 ahead of `origin/main` (S2 sync absorbed PR #275 trust-verification-layer)
**G1 attempts (per chunk):** all chunks 1-attempt G1 except Chunk 8 (2 attempts) and Chunk 9 (3 attempts due to spec-compliance fix `d03de2cd`)
**G2 attempts:** 1
**G3 attempts (post-fix-loops):** 1 each round, 0 errors

### Branch-level review pass

| Stage | Verdict | Log |
|---|---|---|
| spec-conformance | CONFORMANT_AFTER_FIXES (1 mech fix; 6 directional gaps deferred AGW-DEF-1..6) | `tasks/review-logs/spec-conformance-log-agent-workspace-2026-05-08T22-10-41Z.md` |
| adversarial-reviewer | HOLES_FOUND (1 confirmed AGW-ADV-1 closed in fix-loop; 2 likely AGW-ADV-2/3 deferred) | `tasks/review-logs/adversarial-review-log-agent-workspace-2026-05-08T22-28-13Z.md` |
| pr-reviewer round 0 | CHANGES_REQUESTED (8 Blockers B1..B8) | `tasks/review-logs/pr-review-log-agent-workspace-2026-05-08T22-41-57Z.md` |
| Fix-loop round 1 | Closed 6 of 8 (B1, B3, B4, B6, B7, B8). B2 partial. | Commits `2f2a3ed3`, `54796eb9`, `b9f90b49`, `a9f1f2c4` |
| pr-reviewer round 1 | CHANGES_REQUESTED (4 new Blockers B-NEW-1..4 + 1 strong S2) | `tasks/review-logs/pr-review-log-agent-workspace-2026-05-09T00-23-16Z.md` |
| Fix-loop round 2 | Closed B-NEW-1, B-NEW-2, B-NEW-3, B-NEW-4, S2 | Commit `ba956806` |
| Migration renumber + S2 merge | Branch's 0295/0296 → 0305/0306; PR #275 absorbed; 7 conflicts resolved | Commits `cbe5904f`, `d931116d` |
| pr-reviewer round 2 (post-merge) | APPROVED (zero Blockers; 4 Strong carry-overs + 1 new strong S4 dead authenticateSSE) | `tasks/review-logs/pr-review-log-agent-workspace-2026-05-09T01-09-02Z.md` |
| S4 cleanup | Dead `authenticateSSE` export removed | Commit `58739da5` |
| dual-reviewer (Codex) | APPROVED with 3 substantive fixes applied: schema `.js` suffixes, scope-kind enforcement, canonical `run.*` event names | `tasks/review-logs/dual-review-log-agent-workspace-2026-05-09T01-29-34Z.md` (commits `b7335b75`, `57334bec`) |
| pr-reviewer §8.5 re-review | APPROVED (3 dual-reviewer fixes confirmed-closed; no regressions; 1 Strong carry-over surfaced not introduced) | `tasks/review-logs/pr-review-log-agent-workspace-2026-05-09T01-37-36Z.md` |

### Doc-sync gate (13 registered docs)

All verdicts recorded in `tasks/builds/agent-workspace/progress.md § Phase 2 close doc-sync verdicts`. Summary:

- **Updated:** `architecture.md` (Agent Workspace section, Presence stream topology with new auth scheme), `KNOWLEDGE.md` (5 patterns), `docs/capabilities.md` (Persistent Agent Workspace), `docs/decisions/0008-sse-stream-token-auth.md` (new ADR), `docs/decisions/README.md` (index)
- **Not updated (with rationale):** `docs/integration-reference.md`, `CLAUDE.md`/`DEVELOPMENT_GUIDELINES.md`, `CONTRIBUTING.md`, `docs/frontend-design-principles.md`, `docs/context-packs/`, `references/test-gate-policy.md`, `references/spec-review-directional-signals.md`, `.claude/FRAMEWORK_VERSION`/`.claude/CHANGELOG.md`
- **n/a:** `docs/spec-context.md` (spec-review only)

### Open issues for finalisation

**Deferred from this build (routed to `tasks/todo.md`):**
- AGW-DEF-1..6 (6 directional gaps from spec-conformance — non-architectural)
- AGW-ADV-2 (working-time split-brain on crash; partly mitigated by B6 rewrite, retains a small window)
- AGW-ADV-3 (unbounded pagination on Overview endpoints — stub today, becomes hole when stubs replaced with real queries)
- 4 Strong carry-overs from pr-reviewer rounds 1/2: S1 (idempotency UNIQUE org-scope follow-up migration), S2 (permission-revocation lag on live SSE — bounded by 120s TTL), S3 (producer-wiring tests), S-NEW (`finalStatus !== 'completed'` discriminator coarseness — surfaced not introduced)

**For Phase 3 (finalisation-coordinator):**
- Run S2 branch sync (already done early in Phase 2 at operator's request — should be a no-op or tiny delta)
- G4 regression guard
- chatgpt-pr-review (manual ChatGPT-web rounds — operator-driven cadence)
- Full doc-sync sweep
- KNOWLEDGE.md pattern extraction (any new patterns surfaced during Phase 3)
- `tasks/todo.md` cleanup
- `tasks/current-focus.md` → MERGE_READY
- Apply ready-to-merge label
- CI monitor + auto-fix (per `finalisation-coordinator` Step 11)
- Auto-merge

**Notable architectural decision recorded as ADR:**
- ADR-0008 — SSE auth via short-lived signed stream-token (not long-lived JWT in URL). Operator-elected during fix-loop B3 over HttpOnly cookie / fetch-event-source polyfill alternatives.

---

## Phase 3 (FINALISATION) — complete

**PR number:** #276 — https://github.com/michaelhazza/automation-v1/pull/276
**chatgpt-pr-review log:** `tasks/review-logs/chatgpt-pr-review-agent-workspace-2026-05-09T01-52-09Z.md`
**spec_deviations reviewed:** n/a (no `spec_deviations:` field in the Phase 2 handoff)

**Doc-sync sweep verdicts (13 registered docs):**

| Doc | Verdict | Notes |
|---|---|---|
| `architecture.md` | yes (Agent Workspace, Working time accounting, IEE session lifecycle) | Phase 2 already updated SSE topology + auth scheme; Phase 3 R1 B4 fixed migration numbers (0295/0296 → 0305/0306), table names (`agent_working_time_buckets` → `agent_working_time_rollups` + `agent_working_time_event_ledger`), and added the step-identity pairing rule. |
| `docs/capabilities.md` | yes (Persistent Agent Workspace) | Added in Phase 2 (Chunk 13). No R1/R2 capability changes. |
| `docs/integration-reference.md` | no — no integration behaviour change in this PR (no new scope, skill, status, write capability, OAuth provider, MCP preset, capability slug, or alias). Grep terms checked: `agent-workspace`, `agent_presence`, `working_time` — zero stale references. |
| `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` | no — no build-discipline / convention / agent-fleet / locked-rules change. Grep terms: `agent-workspace`, `defaultAgentTab`, `working_time`, `step_identity` — zero stale references. |
| `CONTRIBUTING.md` | no — no lint-suppression / `// reason:` / contributor-convention change. |
| `docs/frontend-design-principles.md` | no — the "Waiting on you" / "Waiting on system" distinction is a spec-pinned implementation detail, not a new design principle. The general pattern (operator-actionable vs system-actionable status copy) is implicit in the existing principle 5 (re-check operator load). |
| `KNOWLEDGE.md` | yes (2 entries) | Two patterns appended: (a) paired-event accumulators need explicit stable identity; (b) permission-gated UI surfaces fail closed during async permission load. |
| `docs/spec-context.md` | n/a (spec-review only) |
| `docs/decisions/` | yes (ADR-0008 added in Phase 2 for SSE stream-token auth) | No new ADRs in R1/R2. |
| `docs/context-packs/` | no — no `architecture.md` section anchor renamed; existing packs still resolve. |
| `references/test-gate-policy.md` | no — no test-gate posture change. |
| `references/spec-review-directional-signals.md` | no — no spec-reviewer drift. |
| `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` | no — no framework-level change in this PR (repo-specific feature work only). |

**KNOWLEDGE.md entries added:** 2

- `[2026-05-09] Pattern — Paired-event accumulators need explicit stable identity, never "latest prior in same scope"`
- `[2026-05-09] Pattern — Permission-gated UI surfaces must fail closed during async permission load`

**tasks/todo.md items removed:** 1 (AGW-DEF-3 — `users.default_agent_tab` read path closed by R1 B1 fix).

**ready-to-merge label applied at:** 2026-05-09T02:45:11Z

### chatgpt-pr-review summary

**Mode:** manual. **Rounds:** 2. **Verdict:** APPROVED — operator finalised after Round 2.

| Round | Verdict | Findings | Outcome |
|---|---|---|---|
| 1 | CHANGES_REQUESTED | 4 Blockers (B1..B4) + 3 Strong (S1..S3) | All 7 fixed in commit `6a105041`. Lint 0 errors, typecheck clean, pure-helper tests 12/12. |
| 2 | APPROVED w/ minor follow-ups | 2 small follow-ups (R2-S1 fail-closed pre-fetch, R2-S2 strict pairing) + 1 polish (R2-Polish identity-language) | All 3 fixed in commit `3c4760ae`. Lint 0 errors, typecheck clean, pure-helper tests 15/15. |

### Open issues remaining (from Phase 2; not addressed in Phase 3)

These were carry-overs from Phase 2 that R1/R2 did not touch — they remain open as durable backlog:

- **AGW-DEF-1, 2, 4, 5, 6** (5 spec-conformance directional gaps — non-architectural). In `tasks/todo.md`.
- **AGW-ADV-2, AGW-ADV-3** (2 likely-hole adversarial findings — working-time split-brain on crash; unbounded pagination on Overview stub endpoints). NOT yet routed to `tasks/todo.md` — Phase 2 close did not write them. Recommend operator routing after merge.
- **4 Strong carry-overs from pr-reviewer rounds 1/2** (S1 idempotency-UNIQUE follow-up migration; S2 permission-revocation lag on live SSE bounded by 120s TTL; S3 producer-wiring tests; S-NEW `finalStatus !== 'completed'` discriminator coarseness). NOT yet routed to `tasks/todo.md`.

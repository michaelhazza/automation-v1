# System Monitor — Active Monitoring Spec (Phase A + 1 + 2)

**Status:** v1 — draft, pre-review
**Owner:** Platform
**Scope:** Server + client + migrations + new `docs/investigate-fix-protocol.md` doc + new system-managed agent
**Predecessor:** `tasks/builds/system-monitoring-agent/phase-0-spec.md` (Phase 0 + 0.5 — shipped via PR #188)
**Successor:** None planned. Phase 0.75 / Phase 3 / Phase 4 remain deferred (§19).

This spec moves the System Monitor from **passive incident sink** (Phase 0/0.5) to **active monitoring** by:

1. Adding the foundations needed to safely run a system-scoped agent (Phase A).
2. Adding **synthetic checks** that detect silent failures — absence-of-events the error-driven sink cannot see (Phase 1).
3. Adding the **`system_monitor` agent** itself: incident-triggered + sweep-driven, diagnosis-only, emits a single standalone `investigate_prompt` per incident formatted per a shared **Investigate-Fix Protocol** that the operator pastes into a local Claude Code session for diagnosis and approved fixes (Phase 2 + 2.5).

All three internal phases ship on **one branch** with **one PR at the end**, but execution is staged across **multiple Claude Code sessions** — one per slice (A, B, C, D). At the end of each session the executor writes current state to `tasks/builds/system-monitoring-agent/progress.md`; the next session picks up from there. This avoids `/compact` mid-build at the cost of larger end-of-build PR review surface — accepted trade-off.

---

## Table of contents

0. [Decisions log](#0-decisions-log)
0A. [Glossary](#0a-glossary)
1. [Summary](#1-summary)
2. [Context](#2-context)
3. [Goals, non-goals, success criteria](#3-goals-non-goals-success-criteria)
4. [Phase A — Foundations](#4-phase-a--foundations)
5. [Investigate-Fix Protocol](#5-investigate-fix-protocol)
6. [Heuristic Registry (config-as-code)](#6-heuristic-registry-config-as-code)
7. [Baselining primitive](#7-baselining-primitive)
8. [Phase 1 — Synthetic checks](#8-phase-1--synthetic-checks)
9. [Phase 2 — Monitor agent (day-one + 2.5)](#9-phase-2--monitor-agent-day-one--25)
10. [UI surface](#10-ui-surface)
11. [Feedback loop](#11-feedback-loop)
12. [Observability + kill switches](#12-observability--kill-switches)
13. [File inventory](#13-file-inventory)
14. [Testing strategy](#14-testing-strategy)
15. [Rollout plan](#15-rollout-plan)
16. [Risk register](#16-risk-register)
17. [Implementation slicing & session pacing](#17-implementation-slicing--session-pacing)
18. [Out-of-scope (explicit)](#18-out-of-scope-explicit)
19. [Future phases (summary)](#19-future-phases-summary)

---

## 0. Decisions log

This section captures every binding decision made during scoping, in CEO-level prose so the executor doesn't need to reverse-engineer intent from downstream sections. Anything the user wants to override is a single edit here; downstream sections cross-reference back.

### 0.1 Prerequisites — verified against the current codebase (post-PR-#188)

| ID | Question | Finding | Effect on spec |
|---|---|---|---|
| P1 | Is the Phase 0 incident sink live? | Yes — PR #188 merged. `system_incidents`, `system_incident_events`, `system_incident_suppressions` exist. Ingest hooks live in global error handler, asyncHandler, DLQ monitor, agent-run terminal-failed transition, connector polling, skill execution, LLM router. | Phase A builds **on** the existing sink; does not rebuild it. |
| P2 | Is there a system-managed agent precedent? | Yes — Orchestrator (migration 0157) and Portfolio Health Agent (migration 0068). Both use `isSystemManaged=true` flag. | `system_monitor` follows the same pattern; see §9.1. |
| P3 | Does pg-boss have a job-handler convention for system-scoped agents? | Yes — Orchestrator triggers agent runs via pg-boss handlers. | `system-monitor-triage` and `system-monitor-sweep` jobs follow the existing handler convention; see §9.2 / §9.3. |
| P4 | Is there a principal-context primitive that supports `type='system'`? | **Partial.** Phase 0/0.5 used Option A (request-attached `req.principal` carrying user context). The existing `PrincipalContext` discriminated union has three variants — `UserPrincipal | ServicePrincipal | DelegatedPrincipal` — discriminated by `type`. System-scoped agent runs need a fourth `SystemPrincipal` variant added to that union. `phase-0-spec.md §7.4` flagged this as Option B, deferred. | Phase A §4.3 builds Option B. **Hard prerequisite for Phase 2.** |
| P5 | Is there a baselining primitive (rolling p50/p95 per agent / skill / connector)? | **No.** No service computes per-entity rolling stats today. | Phase A §7 builds it. **Hard prerequisite for baseline-relative heuristics.** |
| P6 | Is Claude Code already integrated with this repo? | Yes — `CLAUDE.md` is the canonical project-instruction file, read by every Claude Code session in this repo. | Investigate-Fix Protocol references go in `CLAUDE.md`; see §5.3. |
| P7 | Is `docs/` an established home for protocol documents? | Yes — `docs/capabilities.md`, `docs/spec-context.md`, `docs/codebase-audit-framework.md`, `docs/frontend-design-principles.md`. | `docs/investigate-fix-protocol.md` lives alongside; see §5.1. |

### 0.2 Open questions — resolved during scoping

| ID | Question | Decision | Reasoning |
|---|---|---|---|
| Q1 | Defer Phase 0.75 (email/Slack push)? | **Yes — defer indefinitely.** | Stated workflow is page-based monitoring. Push channels add ~3-5 days of work for capability not used by the workflow. Revisit only if monitoring fatigue across multiple operators creates a need. |
| Q2 | Build a separate server-side investigate-fix agent? | **No.** Use the **Investigate-Fix Protocol** pattern instead — a shared markdown contract that both ends (system monitor + Claude Code) honour. | Claude Code already IS the investigate-fix agent. Building a server-side facsimile is Phase 3 (auto-remediation) in disguise — pre-production it masks signal. The protocol-doc approach preserves the "eventually roll into auto-fix" path: when ready, point a server-side worker at the same protocol. No architectural change. |
| Q3 | Prompt field name on `system_incidents`? | **`investigate_prompt`** (single nullable text column). | Matches the user's framing. Avoids the word "remediation" which implies execution. Surfaced in the triage drawer with a copy button. |
| Q4 | Trigger model for the monitor agent? | **Both.** (a) Incident-driven — auto-triggered on incident open with `severity >= medium`. (b) Sweep-driven — periodic `system-monitor-sweep` pg-boss job runs every 5 min over the last 15 min of activity. | Incident-driven covers known errors. Sweep covers degraded-correctness signals on runs that did not error. Together they cover "every run". |
| Q5 | Heuristic registry storage — DB table or config-as-code? | **Config-as-code module** (`server/services/systemMonitor/heuristics/`). | Heuristic set is small and churns with deploys anyway. DB-table flexibility is unnecessary at this scale and adds an admin-UI dependency. Promote to DB only if tuning frequency exceeds deploy frequency. |
| Q6 | Heuristic metadata wrapper? | **Yes.** Every heuristic carries `{id, severity, confidence, expectedFpRate, suppressionRules, baselineRequirements}`. | False-positive fatigue is the failure mode this whole project has to avoid. Metadata is non-optional. Per-heuristic suppression rules let us tune one heuristic without disabling the agent. |
| Q7 | Baseline-relative thresholds vs absolute? | **Baseline-relative wherever possible.** Absolute thresholds only as a floor (e.g. minimum 1s latency before "5× p95" applies). | Avoids noise on tiny medians; avoids lockstep tuning across agent types of different complexity. |
| Q8 | Sweep input cap to control token cost? | **Yes.** Max 50 runs OR 200 KB of log payload per sweep, whichever hits first. Summary stats first; deep-read only on heuristic fire. | Prevents a busy day from blowing the agent budget. Deep-read is the expensive call; gate it behind a cheap-heuristic pre-pass. |
| Q9 | Phase 2.5 — same spec or follow-up? | **Same spec, same execution.** Day-one heuristics (Phase 2.0) ship first; Phase 2.5 cross-run/systemic heuristics ship in the same session once baseline data exists. | The structural surface (heuristic registry, baselining, agent prompt) is identical. Only the heuristic configuration grows. Splitting specs would duplicate ~80% of the document. |
| Q10 | What does "every run" mean? | **Every terminal agent-run transition + every job-completed transition + every skill-execution completion within the sweep window.** | Phase 0 already ingests *failed* terminal transitions. Phase 2 sweep extends coverage to *successful* transitions, which is where the soft-fail signals live. |
| Q11 | Are non-sysadmin operators in scope? | **No.** The triage drawer remains sysadmin-only. The agent runs as a system principal. | Matches Phase 0/0.5 access model; no new permission surface. |
| Q12 | Auto-remediation in this spec? | **No.** Phase 3. The agent only annotates incidents and emits `investigate_prompt` text. | Explicit non-goal. Diagnosis-only skills; no `destructiveHint: true` skills wired in this spec. |
| Q13 | Multi-agent coordination heuristics in this spec? | **No.** Phase 3 (per the heuristics review). Schema reserves space (correlation-ID clusters, run-graph references) but no heuristics fire in 2.0/2.5. | Multi-agent coordination is a separate signal class with its own design surface; cleanest as a follow-on phase. |
| Q14 | Semantic correctness (LLM judge) in this spec? | **No.** Phase 3. Listed as a deliberate non-goal in §3.2. | Adds a per-run LLM call cost lever and a separate prompt-engineering surface. Not worth coupling to the structural delivery. |

### 0.3 Decisions inherited from `phase-0-spec.md` (unchanged)

The three-table schema, fingerprint algorithm + override governance, classification taxonomy, severity enum, sync/async ingest mode toggle, suppression model, escalation guardrails, AlertFatigueGuardBase, self-check job, admin page layout, Pulse integration, manual-escalate-to-agent flow — all stand. This spec adds to the surface; it does not modify any of it.

### 0.4 Why this spec covers three internal phases

Phase A, Phase 1, and Phase 2 (with 2.5 expansion) share most of their delivery surface — schema additions, agent definition, UI changes, file inventory, test strategy, rollout. Splitting into three specs would duplicate ~70% of the content and introduce stale-cross-reference risk between them. One unified spec, three internal slices, one branch, one PR — review burden concentrated at the end, accepted trade-off per user direction.

### 0.5 Decisions deferred to architect

The architect pass (after this spec passes user review) will resolve:

- Exact file paths for new server modules (the spec names directories, not files, where naming convention has multiple valid options).
- Migration sequencing relative to any in-flight migrations on `main`.
- Whether the Phase 2.5 baseline storage table merges with an existing analytics table or stands alone.
- Final pg-boss queue concurrency and rate-limit settings.
- React component hierarchy for the triage drawer additions.

This spec defines the **what** and the **why**; the architect plan defines the **where** and the **how**.

## 0A. Glossary

Spec-internal terms with specific meanings. Used throughout the document. Naming differences from the wider codebase are flagged.

| Term | Definition |
|---|---|
| **Agent** | A configured agent row in the `agents` table. Has a slug, system prompt, bound skill set, and a scope (`subaccount` / `org` / `system`). The new `system_monitor` agent is system-scoped (§9.1). |
| **Agent run** | A single execution of an agent — one row in `agent_runs`. Carries inputs, message history, terminal status, runtime, token counts. Terminal statuses live in `shared/runStatus.ts` (`TERMINAL_RUN_STATUSES`). |
| **Skill** | A registered tool an agent may invoke during a run. Has an id, input schema, output schema, and a `destructiveHint: boolean` flag. The `system_monitor` agent's skill set is read-only with two narrow write skills (§9.4). |
| **Skill execution** | A single invocation of a skill within an agent run — one row in `skill_executions`. Carries input, output, runtime, success/failure. |
| **Job** | A pg-boss queue entry. Identified by `(queue_name, id)`. Has a state (`created` / `active` / `completed` / `failed`), a payload, and retry count. Phase 2 introduces `system-monitor-triage`, `system-monitor-sweep`, `system-monitor-synthetic-checks`, `system-monitor-baseline-refresh` queues. |
| **Heuristic** | A TypeScript module under `server/services/systemMonitor/heuristics/` that conforms to the `Heuristic` interface (§6.2). Evaluates one signal against one candidate (or windowed candidate set for Phase 2.5). Carries metadata (severity, confidence, expectedFpRate, suppressions, requiresBaseline). |
| **Synthetic check** | A check that detects **absence** of expected events — no agent runs in N minutes, queue stalled, connector poll stale, etc. Distinct from heuristics (which evaluate **presence** of degraded events). Lives under `server/services/systemMonitor/synthetic/`. Runs on a 60-second tick. |
| **Sweep** | The 5-minute pg-boss tick that iterates the heuristic registry over recent agent runs, jobs, and skill executions (§9.3). Two-pass: cheap pre-pass + deep-read on fire. Window is rolling 15 minutes. |
| **Triage** | The act of the `system_monitor` agent reading evidence about an incident or sweep cluster and producing (a) a structured `agent_diagnosis` JSON and (b) a paste-ready `investigate_prompt` (§9.2, §9.7, §9.8). Triggered either by an incident-open event (severity ≥ medium) or by a sweep cluster. |
| **Baseline** | The current rolling-window p50/p95/p99/mean/stddev/min/max for one `(entity_kind, entity_id, metric_name)` triple. Refreshed every 15 minutes. Stored in `system_monitor_baselines`. Read via `BaselineReader` (§7.5). |
| **Fingerprint** | A stable, content-derived hash that identifies an incident class. Inherited unchanged from Phase 0/0.5 (§5.2 of `phase-0-spec.md`). Used as the dedup / throttle / rate-limit key. |
| **Incident** | A row in `system_incidents`. Created by `recordIncident()` either reactively (from error hooks) or by a synthetic check or by a sweep cluster. Has severity, status, source, fingerprint, and (after triage) `agent_diagnosis` + `investigate_prompt`. |
| **Investigate-Fix Protocol** | The shared markdown contract in `docs/investigate-fix-protocol.md` (§5) that defines (a) how the monitor agent formats `investigate_prompt` text and (b) how Claude Code consumes it. Versioned by git history of the doc. |
| **System principal** | The synthesised principal context — a new `SystemPrincipal` variant of the existing `PrincipalContext` union (`type='system'`, sentinel `userId`, `isSystemPrincipal=true`) — used by system-managed agent runs and pg-boss handlers that have no inbound HTTP request. Set via `withSystemPrincipal()` (§4.3). |
| **Kill switch** | An env-var-based on/off flag for one layer of the system. The hierarchy is documented in §12.2. Always defaults to `true` (system on); the operator sets `false` to disable. |

## 1. Summary

**Vision.** A system-scoped monitoring agent that watches every agent run, every job-completed transition, and every skill execution in the platform; flags anything that looks wrong (errors **and** soft-fail signals like degraded outputs, runtime/token anomalies, silent infrastructure drift); and emits a single standalone **`investigate_prompt`** per incident — formatted per a shared **Investigate-Fix Protocol** — that the operator pastes into a local Claude Code session. Claude Code investigates, proposes fixes, executes on approval. Human-in-the-loop throughout; no auto-remediation in this scope.

**Three internal phases delivered in this spec.**

| Slice | Builds | Why this order |
|---|---|---|
| **Phase A — Foundations** | Idempotency at `recordIncident`, per-fingerprint throttle, system-principal context (Option B), `assertSystemAdminContext` defence-in-depth, `investigate_prompt` schema column, baselining tables. | Unblocks Phase 2 (system-principal context is a hard prerequisite); hardens the ingest path for traffic Phase 1 will generate. |
| **Phase 1 — Synthetic checks** | `system-monitor-synthetic-checks` pg-boss tick. Checks for absence-of-events: queue stalls, no-runs-in-N-minutes, stale connectors, heartbeat probes. Writes incidents with `source='synthetic'`. | Catches silent failures the error-driven sink misses. Generates incident volume that Phase 2 then triages — useful to have before Phase 2 day one. |
| **Phase 2 — Monitor agent (day-one + 2.5)** | New `system_monitor` agent (system-managed, scope `system`). Two triggers: incident-driven (`severity >= medium`) + sweep-driven (5-min tick over 15-min window). Day-one heuristic set per the structural review. Phase 2.5 cross-run/systemic heuristics layered on top. Generates `investigate_prompt` per the Investigate-Fix Protocol. Diagnosis-only skills. Rate-limited. Kill switch. | The actual deliverable. Everything before it is plumbing. |

**Two cross-cutting primitives** introduced once and used across phases:

- **Investigate-Fix Protocol** — `docs/investigate-fix-protocol.md`. The shared contract between (a) the system monitor's prompt-authoring instructions and (b) Claude Code's prompt-consumption behaviour. Iterating the protocol improves both ends in lockstep. When Phase 3 (auto-remediation) eventually arrives, a server-side worker pointed at the same protocol becomes the auto-fixer — no architectural change.
- **Heuristic Registry** — `server/services/systemMonitor/heuristics/`. Config-as-code module. Every heuristic carries `{id, severity, confidence, expectedFpRate, suppressionRules, baselineRequirements}`. False-positive fatigue is the failure mode this whole project has to avoid; metadata is non-optional.

**Explicit non-goals** (covered in §3.2):
- No push notifications (Phase 0.75 — deferred indefinitely).
- No auto-remediation (Phase 3).
- No semantic-correctness LLM judge (Phase 3).
- No multi-agent coordination heuristics (Phase 3).
- No dev-agent handoff (Phase 4).

**Delivery model.** One branch (`claude/add-system-monitoring-BgLlY` or successor), one PR at the end. Execution staged across multiple Claude Code sessions; each session writes to `tasks/builds/system-monitoring-agent/progress.md` before ending; next session picks up from there. No mid-build `/compact`.

**Estimated effort.** ~11-13 days of focused work split across 4 sessions: A (~1d), B (~3d), C (~5d), D (~2-3d).

## 2. Context

### 2.1 Vision recap

The long-term goal — articulated since the Phase 0 spec — is a system-managed monitoring agent that watches the platform in real time, self-diagnoses issues, eventually self-fixes simple ones (retry, throttle, flag-flip), and escalates anything requiring human judgement. Pre-production we deliberately do **not** auto-fix: stabilisation needs raw unremediated error streams, not an agent papering over bugs. This spec covers the **active monitoring + diagnosis + human-in-the-loop fix** stages. Auto-fix is Phase 3, gated on accumulated evidence that the agent's diagnosis quality is high enough to trust with the action.

### 2.2 What Phase 0/0.5 already shipped (PR #188)

**Reuse — do not rebuild:**

| Primitive | Location | How this spec uses it |
|---|---|---|
| `system_incidents` table | `server/db/schema.ts` (post-merge) | Add `investigate_prompt` column, agent diagnosis fields. Do not modify shape otherwise. |
| `system_incident_events` table | same | Add new event types (§12.1). Append-only contract preserved. |
| `recordIncident` ingest service | `server/services/systemIncidentIngest/` (or post-merge equivalent) | Wrap with idempotency + per-fingerprint throttle (Phase A). Do not touch fingerprint algorithm. |
| Fingerprint algorithm + override governance | `phase-0-spec.md §5.2` | Inherited unchanged. Phase 1 synthetic checks use `fingerprintOverride` per the override contract. |
| Severity enum `low \| medium \| high \| critical` | shared | Reused unchanged. |
| Sync/async ingest mode toggle | `SYSTEM_INCIDENT_INGEST_MODE` env var | Reused unchanged. |
| `SystemIncidentFatigueGuard` (extracted base class) | `server/services/alertFatigueGuard.ts` | Reused for sweep-driven incident dedupe (§9.3). |
| Self-check job | `system-monitor-self-check` pg-boss job | Reused unchanged. Phase 2 sweep job sits alongside, not on top. |
| `requireSystemAdmin` middleware | `server/middleware/requireSystemAdmin.ts` | Reused for new routes. |
| System admin incidents page | `client/src/pages/SystemIncidentsPage.tsx` | Extended with triage drawer additions (§10), not replaced. |
| Pulse `system_incident` kind | `server/services/pulseService.ts` | Reused unchanged. Sweep-source incidents fan out via the same mechanism. |
| Manual escalate-to-agent | Phase 0.5 §10.2 | Reused unchanged. Phase 2 auto-triggered triage runs alongside, not in place of. |
| Orchestrator + Portfolio Health Agent precedent | migrations 0157, 0068 | Blueprint for `system_monitor` agent (§9.1). |

**Critical gaps this spec fills:**

1. **No system-principal context.** Phase 0/0.5 used Option A (request-attached). System-scoped agent runs need synthesised system-principal (Option B). Phase A §4.3.
2. **No baselining primitive.** Heuristics that reference "5× the p95 baseline" need a service that computes p50/p95 per agent type / skill id / connector id over a rolling window. Phase A §7.
3. **No proactive sink.** All Phase 0 ingest hooks are **reactive** — they fire on errors. Silent failures (no-runs-in-N-minutes) emit no event and so create no incident. Phase 1 fills this with synthetic checks.
4. **No diagnosis layer.** Incidents currently land on the page raw — operator reads stack trace, decides what to do. Phase 2 adds an agent that annotates each incident with a diagnosis hypothesis and a paste-ready Claude Code prompt.
5. **No prompt-emission contract.** What "good prompt to hand to Claude Code" means is undefined. The Investigate-Fix Protocol (§5) defines it.

### 2.3 What this spec adds (in one diagram)

```
                                  ┌────────────────────────────────────────────┐
                                  │   Phase 0/0.5 (shipped) — passive sink     │
                                  │                                            │
   reactive errors  ──────────────┼─►  recordIncident()                        │
                                  │       │                                    │
                                  │       └──► system_incidents (table)        │
                                  └────────────────────────────────────────────┘
                                                     │
                                                     │  THIS SPEC adds:
                                                     ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  Phase A — Foundations                                                    │
   │  ┌─────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐  │
   │  │ idempotency +   │  │ system-principal     │  │ baselining tables +  │  │
   │  │ per-fp throttle │  │ context (Option B)   │  │ investigate_prompt   │  │
   │  └─────────────────┘  └──────────────────────┘  └──────────────────────┘  │
   ├──────────────────────────────────────────────────────────────────────────┤
   │  Phase 1 — Synthetic checks                                               │
   │  ┌──────────────────────────────────────────────┐                         │
   │  │ system-monitor-synthetic-checks (1-min tick) │ ───► recordIncident()   │
   │  │ queue stalls, no-runs, stale connectors      │      source='synthetic' │
   │  └──────────────────────────────────────────────┘                         │
   ├──────────────────────────────────────────────────────────────────────────┤
   │  Phase 2 — Monitor agent (day-one + 2.5)                                  │
   │                                                                           │
   │  Trigger 1: incident-open (severity >= medium)                            │
   │     enqueue system-monitor-triage(incidentId)                             │
   │                                                                           │
   │  Trigger 2: system-monitor-sweep (5-min tick, 15-min window)              │
   │     pre-pass: heuristic registry over recent runs                         │
   │     on fire: deep-read; agent run                                         │
   │                                                                           │
   │  Agent: system_monitor (system-managed, scope='system')                   │
   │     reads: agent runs, jobs, DLQ, connectors, logs                        │
   │     writes: diagnosis + investigate_prompt                                │
   │              ─► back onto system_incidents row                            │
   │              ─► event log: agent_diagnosis_added                          │
   ├──────────────────────────────────────────────────────────────────────────┤
   │  Cross-cutting: Investigate-Fix Protocol (docs/investigate-fix-protocol.md)│
   │     contract for: how the agent formats prompts                            │
   │                   how Claude Code consumes prompts (via CLAUDE.md hook)    │
   ├──────────────────────────────────────────────────────────────────────────┤
   │  UI: triage drawer adds copy-button on investigate_prompt + feedback widget│
   └──────────────────────────────────────────────────────────────────────────┘
```

### 2.4 Why one branch, four sessions, one PR

**Why one branch.** The slices are cohesive — Phase 1 generates volume Phase 2 consumes; Phase A schema additions are referenced by every later slice. Splitting branches creates merge-conflict surface against `main` for no review benefit.

**Why four sessions.** Building all four slices in one session would push context utilisation past the comfortable threshold (~50-60% per CLAUDE.md §12). Compacting mid-build loses fidelity on prior decisions. Starting a fresh session per slice keeps each one in clean context, with `progress.md` as the durable handoff artefact.

**Why one PR.** Slice boundaries are not natural review boundaries — Phase A on its own is dead code, Phase 1 without Phase 2 is noise. The reviewable unit is the whole feature. User has explicitly accepted the larger end-of-build PR review surface.

**The trade-off accepted.** Larger PR surface (~11-13 days of work in one review) vs. context cleanliness mid-build. User direction: cleanliness wins. To partially mitigate, the spec includes per-slice verification commands (§15.3) so the executor can self-verify each slice before handoff — review at the end then has confidence each slice was internally coherent.

## 3. Goals, non-goals, success criteria

### 3.1 Goals

**Phase A:**

- GA.1 `recordIncident()` is idempotent on an optional `idempotencyKey` per fingerprint. Two calls with the same key within a 60-second dedupe window do not double-increment `occurrence_count`.
- GA.2 Per-fingerprint ingestion throttle. `lastSeen[fp] < 1s ago` causes the second call to be silently dropped (counted in a process-local metric, not raised as an error).
- GA.3 A system-principal context primitive exists. Calling code can synthesise a principal with `type: 'system'` (a new `SystemPrincipal` variant added to the existing `PrincipalContext` union) for use by system-managed agent runs and authenticated server-to-server calls.
- GA.4 Service-layer `assertSystemAdminContext(ctx)` is wired into every `system_incidents` mutation entry point as defence-in-depth. Failures throw a typed error before the DB write.
- GA.5 The `investigate_prompt` text column exists on `system_incidents`. Nullable. No length cap. Surfaced via a new GET endpoint shape and the existing list/detail endpoints.
- GA.6 Baselining primitive: rolling p50/p95/p99/median for runtime and token-count is computed per `(entity_kind, entity_id)` over the last 7 days, refreshed every 15 minutes, exposed as a read API for heuristics.

**Phase 1:**

- G1.1 A `system-monitor-synthetic-checks` pg-boss job runs every 60 seconds.
- G1.2 The job applies the day-one synthetic check set (§8.2) and writes incidents with `source='synthetic'` for any check that fires.
- G1.3 Synthetic incidents use `fingerprintOverride` per the override governance contract (`phase-0-spec.md §5.2`) — namespace `synthetic:<check_id>:<resource_kind>:<resource_id>` — to ensure a stalled queue does not produce N incidents.
- G1.4 The synthetic check job has its own kill switch (`SYNTHETIC_CHECKS_ENABLED`) independent of `SYSTEM_INCIDENT_INGEST_ENABLED`.
- G1.5 No synthetic check produces a false positive within the first hour of running on an idle staging environment. (Cold-start tolerance: checks gracefully report "insufficient baseline" rather than firing.)

**Phase 2 (day-one + 2.5):**

- G2.1 The `system_monitor` agent exists as a system-managed agent (`isSystemManaged=true`), scope `system`, with diagnosis-only skills (§9.4).
- G2.2 An incident-driven trigger enqueues `system-monitor-triage(incidentId)` whenever an incident opens with `severity >= medium` AND `source != 'self_check'` (avoids self-recursion).
- G2.3 A sweep-driven trigger runs every 5 minutes via `system-monitor-sweep` pg-boss job. The job evaluates the heuristic registry against the last 15 minutes of agent runs, jobs, and skill executions. On any heuristic fire above its `confidence` threshold, the agent is invoked with the relevant evidence context.
- G2.4 The agent emits, for every incident it triages, a single standalone `investigate_prompt` formatted per the Investigate-Fix Protocol (§5). The prompt includes file paths and line numbers where available.
- G2.5 The agent annotates the incident with a structured diagnosis (hypothesis + evidence references + confidence). Annotation is written via a new event type `agent_diagnosis_added` (§12.1).
- G2.6 The agent is rate-limited: max 2 invocations per fingerprint per 24 hours; persistent recurrence past the rate limit auto-escalates to human via the existing manual-escalate path.
- G2.7 The agent has a kill switch (`SYSTEM_MONITOR_ENABLED`) that, when off, disables both triggers cleanly without touching the synthetic-check job or the incident sink.
- G2.8 The day-one heuristic set (§9.5) ships with metadata (severity, confidence, expectedFpRate, suppression rules) and is gated by baseline availability — heuristics with `requiresBaseline: true` no-op when the baseline service reports `insufficient_data`.
- G2.9 The Phase 2.5 heuristic expansion (§9.6) adds cross-run/systemic heuristics, layered onto the same registry without breaking changes to the registry interface.

**UI:**

- GU.1 The triage drawer renders `investigate_prompt` in a copy-formatted block with a one-click copy button.
- GU.2 The drawer renders the agent's diagnosis annotation if present, with confidence and evidence links.
- GU.3 A "was this useful?" feedback widget appears when the operator marks an incident resolved against an agent-diagnosed incident. Captures `wasSuccessful: bool + freeText: string`.
- GU.4 A list-view filter pill: "Diagnosed by agent" / "Awaiting diagnosis" / "All".

**Feedback loop:**

- GF.1 Resolution outcomes against agent-diagnosed incidents emit an `investigate_prompt_outcome` event, capturing whether the prompt was used, whether the resulting fix was accepted, and free-text on what the agent missed.
- GF.2 The feedback data is queryable for tuning heuristics and the Investigate-Fix Protocol — the source-of-truth for the eventual auto-fix gate.

### 3.2 Non-goals

These are deliberate omissions, not deferred work:

- **NG1 No push notifications.** Phase 0.75 (email/Slack) remains deferred indefinitely. Operator workflow is page-based monitoring; no channel adapters, no preferences UI, no fatigue-guard wiring beyond what Phase 0/0.5 already shipped.
- **NG2 No auto-remediation.** No skills with `destructiveHint: true`. The agent reads, diagnoses, annotates, emits prompts. It does not retry jobs, disable flags, restart connectors, or change any state outside `system_incidents` rows it owns.
- **NG3 No semantic-correctness LLM judge.** Heuristics that check "does this output make sense given this input" are Phase 3. The cost lever (per-run LLM judge calls) and the prompt-engineering surface are out of scope.
- **NG4 No multi-agent coordination heuristics.** Handoff failure, state mismatch between agents, duplicate work, conflicting outputs — Phase 3. Schema preserves correlation-ID space; no heuristics fire.
- **NG5 No dev-agent handoff.** Phase 4 — depends on Phase 3 stable. The "persistent_defect" classification still exists from Phase 0/0.5 but is not consumed by any new agent in this spec.
- **NG6 No tenant-scoped monitoring.** This spec ships a system-scoped agent only. Per-tenant monitoring agents (Portfolio Health Agent precedent extended) are out of scope.
- **NG7 No real-time WebSocket push of agent diagnoses.** The existing Phase 0.5 WebSocket fans out incident-open / status-change events. Diagnosis annotations land via the same channel piggybacked on the existing event types — no new WS event type, no new client-side handler.
- **NG8 No new admin UI page.** All UI changes extend the existing `SystemIncidentsPage`. No new route, no new navigation entry.
- **NG9 No baseline storage in a new persistent table for tenants.** Baseline storage is global / system-scoped — not partitioned by tenant. Per-tenant baselines are Phase 3.
- **NG10 No prompt versioning.** The Investigate-Fix Protocol doc is versioned by git history. Generated `investigate_prompt` text does not carry a protocol-version stamp — protocol drift is observable from the git log of the doc, sufficient for the iteration loop.

### 3.3 Success criteria — observable, measurable

| ID | Criterion | How to verify |
|---|---|---|
| S1 | Idempotency window functional. | Unit test: two `recordIncident` calls with same `idempotencyKey` within 60s produce one row, one `occurrence_count` increment. |
| S2 | Per-fp throttle blocks tight loops. | Unit test: 100 calls in 1s with same fingerprint → 1 ingest, 99 throttled (counter incremented). |
| S3 | System-principal context usable end-to-end. | Integration test: enqueue `system-monitor-triage`, handler runs, `req.principal.type === 'system'` in agent invocation. |
| S4 | `assertSystemAdminContext` blocks unauthorised caller. | Unit test: call any `system_incidents` mutation service method with a non-sysadmin context → typed error before DB write. |
| S5 | Synthetic checks detect a stalled queue. | Smoke test: pause pg-boss processing for 5 min; verify `system-monitor-synthetic-checks` produces an incident with `source='synthetic'`. |
| S6 | Synthetic checks tolerate idle baseline. | Smoke test: cold-start staging, run synthetic checks for 1h, no false positives. |
| S7 | Agent triages incident-driven trigger. | Smoke test: emit a `severity='high'` incident; verify `system-monitor-triage` job enqueued, agent run started, `agent_diagnosis_added` event emitted within 60s. |
| S8 | Agent triages sweep-driven trigger. | Smoke test: stage a soft-fail signal (e.g. an agent run that completes but produces empty output); verify next sweep-tick triggers the agent and produces a diagnosis. |
| S9 | `investigate_prompt` is paste-ready. | Manual: copy 5 generated prompts, paste each into a local Claude Code session, verify Claude Code can act on each without follow-up clarification. |
| S10 | Day-one heuristic set fires correctly. | Unit tests: each heuristic in §9.5 has a positive test (it fires) and a negative test (it does not fire on baseline-normal data). |
| S11 | Phase 2.5 heuristics gated on baseline. | Unit test: cross-run heuristic asked to evaluate on N<10 baseline returns `insufficient_data` and does not fire. |
| S12 | Feedback widget captures outcomes. | Smoke test: resolve an agent-diagnosed incident with feedback "useful, fixed in PR #X"; verify `investigate_prompt_outcome` event written. |
| S13 | Kill switches cleanly disable each layer. | Smoke tests: set each kill-switch env var to `false`, verify the corresponding job/agent/trigger no-ops without erroring. |
| S14 | Rate-limit prevents agent invocation storms. | Unit test: invoke triage 3× in 24h on same fingerprint → first 2 run, 3rd no-ops with `rate_limited` event. |
| S15 | No Phase 0/0.5 regressions. | Existing `phase-0-spec.md §12` smoke tests still pass after this spec lands. |

## 4. Phase A — Foundations

Phase A is **dead-code-by-design** — none of these primitives are user-visible on their own. They exist to unblock Phase 1 and Phase 2. Verifiable via unit tests and integration tests; no UI surface to smoke.

### 4.1 Idempotency at `recordIncident` (deferred #1)

**Why.** Tight-loop traffic — same fingerprint, same payload, fired N× per second from a stuck retry loop — currently produces N occurrences. That is correct under the current contract but misleads triage ("incident has 1,847 occurrences") and inflates `occurrence_count` in a way that obscures real recurrence patterns.

**Shape.**

- Extend `IncidentInput` with optional `idempotencyKey?: string`.
- If `idempotencyKey` is present, ingest does an early-return lookup in a process-local LRU keyed on `${fingerprint}:${idempotencyKey}`. TTL = 60s (configurable via `SYSTEM_INCIDENT_IDEMPOTENCY_TTL_SECONDS`).
- LRU hit → no DB write, no event append. Increment process-local counter `system_incident_ingest_idempotent_hits` (logged-as-metric per the §0.5 v3 KNOWLEDGE.md convention).
- LRU miss → proceed with normal ingest path; on success, write the key to the LRU.
- LRU bound: 10,000 entries per process, soft cap. Eviction on size or TTL.

**Why process-local, not Redis.** The dedupe window is short (60s) and the cost of a missed dedupe is "two rows where one would do" — recoverable, not corrupting. Process-local LRU avoids a Redis dependency for a soft optimisation. Phase 3 may upgrade to Redis if the agent's ingest rate exceeds a single process's LRU effectiveness; that's a deferred decision.

**Callers updated.** Async ingest worker (`SYSTEM_INCIDENT_INGEST_MODE=async`) gets the `idempotencyKey` via the pg-boss payload. No changes to the `recordIncident` shape for callers that don't need idempotency — `idempotencyKey` is optional.

**Test plan.** Unit: 100 calls with same key in 1s → 1 row, 1 event, 99 LRU hits. Unit: 2 calls with same fingerprint but different keys → 2 occurrences (correct — different operations). Unit: 2 calls with same key 61s apart → 2 occurrences (TTL respected).

### 4.2 Per-fingerprint ingestion throttle (deferred #5)

**Why.** Distinct from #4.1 — idempotency keys are caller-supplied opt-in. Throttle is fingerprint-derived automatic backpressure for callers that don't know to set keys. A skill in a tight retry loop produces 100 calls/sec with no idempotency key; throttle drops 99 of them based purely on fingerprint timing.

**Shape.**

- Process-local map `lastSeenByFingerprint: Map<string, number>`.
- On every `recordIncident` call, compute fingerprint as today (Phase 0 §5.2 unchanged), then check `lastSeenByFingerprint.get(fp)`.
- If `now - lastSeen < THROTTLE_MS` (default 1000ms, env-configurable via `SYSTEM_INCIDENT_THROTTLE_MS`): drop, increment `system_incident_ingest_throttled` counter, return.
- Otherwise: set `lastSeenByFingerprint.set(fp, now)`, proceed with ingest.
- Map size cap: 50,000 entries. On eviction, oldest entries drop first. Eviction is a metric — `system_incident_ingest_throttle_map_evictions`.

**Interaction with idempotency (§4.1).** Throttle runs **first**. If throttle drops the call, idempotency LRU is not consulted. Order: `compute fingerprint → throttle check → idempotency check → DB write`.

**Interaction with sync/async toggle.** Throttle and idempotency live in the **synchronous portion** of `recordIncident`, regardless of `SYSTEM_INCIDENT_INGEST_MODE`. They prevent enqueueing duplicate jobs in async mode. The async worker does not reapply throttle — by design, anything that made it onto the queue gets processed.

**Test plan.** Unit: 100 calls in 1s with same fingerprint → 1 ingest, 99 throttled. Unit: 2 calls 1.1s apart with same fingerprint → 2 ingests (window expired). Unit: 2 calls in 1s with different fingerprints → 2 ingests (no cross-fp interference). Unit: map eviction at 50k+1th unique fingerprint → oldest drops, metric increments.

### 4.3 System-principal context (Option B from `phase-0-spec.md §7.4`)

**Why.** Phase 0/0.5 used **Option A** for principal context — `req.principal` attached by middleware on every authenticated request. That works for user-initiated traffic but cannot serve a system-managed agent run that has no inbound HTTP request. Phase 2's `system_monitor` agent runs from a pg-boss handler; there is no `req`. We need a synthesised system-principal.

**Option B shape.**

- New module: `server/services/principal/systemPrincipal.ts` (final path resolved by architect).
- Adds a fourth `SystemPrincipal` variant to the existing `PrincipalContext` discriminated union (`UserPrincipal | ServicePrincipal | DelegatedPrincipal`, defined in `server/services/principal/types.ts`). The variant follows the existing convention — discriminated by the `type` field.
- Exports `getSystemPrincipal(): SystemPrincipal` — returns a singleton with:
  - `type: 'system'` (the discriminator field used by every variant in the existing union)
  - `userId: SYSTEM_PRINCIPAL_USER_ID` (a sentinel UUID seeded via migration into `users` table with `is_system: true`, email `system@platform.local`, no password, no auth, never logs in)
  - `subaccountId: null` (system principals are not subaccount-scoped)
  - `organisationId: SYSTEM_OPERATIONS_ORG_ID` (the `isSystemOrg=true` org seeded in Phase 0/0.5)
  - `permissions: ['system_monitor.*']` — minimal scope, expanded only by explicit grant
  - `isSystemPrincipal: true` boolean — narratively useful (cheap truthy check at call sites that don't need to widen `type` first); does not conflict with the `type` discriminator

- The principal is **immutable**, **process-singleton**, and **safe to log** (no PII).

- New helper: `withSystemPrincipal<T>(fn: (ctx: PrincipalContext) => Promise<T>): Promise<T>`. Sets `AsyncLocalStorage` for the duration of `fn`. Used at the top of every system-managed pg-boss handler:

  ```ts
  bossHandler('system-monitor-sweep', async (job) => {
    return withSystemPrincipal(async (ctx) => {
      // ctx.principal.type === 'system'
      ...
    });
  });
  ```

**RLS interaction.** `phase-0-spec.md §7.4` deferred this. Decision now: **system-principal bypasses RLS for `system_*` tables only.** Three-layer fail-closed (RLS → app guard → service guard) becomes:

| Layer | For tenant tables | For `system_incidents` etc. |
|---|---|---|
| Postgres RLS | enforces tenant scope | denies all rows by default; PERMITs only when `current_setting('app.current_principal_type', true) = 'system'` |
| Drizzle app guard | tenant filter | system filter |
| Service guard | `requireOrgScoped(ctx)` | `assertSystemAdminContext(ctx)` (§4.4) |

The session-variable approach (`SET LOCAL app.current_principal_type = 'system'` inside `withSystemPrincipal`, reusing the existing session variable already set for user/service/delegated principals) is the standard Drizzle + RLS pattern (`architecture.md §Row-Level Security`).

**Why singleton, not per-call.** Avoids accidental duplication / divergence. The principal carries no per-call state — it's a stable identity object.

**Test plan.** Unit: `getSystemPrincipal()` returns the same object across calls. Integration: pg-boss handler wrapped in `withSystemPrincipal` can SELECT from `system_incidents`; same handler unwrapped fails RLS. Integration: system principal cannot SELECT from a tenant-scoped table (e.g. `agent_runs`) without explicit cross-scope grant — verifies blast radius is contained.

**Migration.** Seed the system user row + the system org row (latter already exists from Phase 0/0.5 per Q2 in `phase-0-spec.md §0.2`). New migration adds the system user only.

### 4.4 `assertSystemAdminContext` defence-in-depth (deferred #R3.1)

**Why.** PR #188 chatgpt-pr-review flagged that `system_incidents` mutations rely on route-layer `requireSystemAdmin` middleware as the only authorisation gate. If a future code path calls a service method directly (e.g. from another internal service, or a misrouted handler), authorisation is silently bypassed. Defence-in-depth mandates a service-layer assertion that throws regardless of how the caller arrived.

**Shape.**

- New helper: `assertSystemAdminContext(ctx: PrincipalContext): asserts ctx is SystemAdminContext`.
- Throws `UnauthorizedSystemAccessError` (typed) if:
  - `ctx.principal.type !== 'system'` AND
  - `ctx.principal.permissions` does not include `system_admin.write`
- System principals (from §4.3) pass automatically. Sysadmin users with `system_admin.write` permission pass.
- All other principals (regular users, even with `org_admin` or `subaccount_admin`) fail.

**Wiring.** Called as the **first line** of every `system_incidents` mutation service method:

```ts
async function resolveIncident(ctx: PrincipalContext, id: string, ...) {
  assertSystemAdminContext(ctx);
  // ...
}
```

Applied to: `createIncidentManually`, `updateIncidentStatus`, `acknowledgeIncident`, `resolveIncident`, `suppressFingerprint`, `unsuppressFingerprint`, `escalateToAgent`, `triggerTestIncident`, plus the new mutations introduced in this spec (`annotateDiagnosis`, `recordPromptFeedback` — §10, §11).

**Not called on read methods.** Reads still gate via `requireSystemAdmin` middleware + RLS. Defence-in-depth is for mutations only — read paths do not have the same blast radius.

**Test plan.** Unit: each mutation service method, called with a non-sysadmin context, throws `UnauthorizedSystemAccessError`. Unit: same methods called with a sysadmin or system context succeed. Integration: a contrived "internal service calls service method directly without middleware" path is blocked.

### 4.5 Schema additions

All additive. No column modifications to existing Phase 0/0.5 tables. No data backfills required.

**`system_incidents` — new columns:**

| Column | Type | Constraint | Purpose |
|---|---|---|---|
| `investigate_prompt` | `text` | nullable | The paste-ready Claude Code prompt generated by the monitor agent. Single field per Q3 §0.2. |
| `agent_diagnosis` | `jsonb` | nullable | Structured diagnosis object: `{hypothesis, evidence[], confidence, generatedAt, agentRunId}`. |
| `agent_diagnosis_run_id` | `uuid` | nullable, FK `agent_runs(id)` ON DELETE SET NULL | Pointer to the agent run that produced the diagnosis. Enables drilling from triage drawer to the run log. |
| `prompt_was_useful` | `boolean` | nullable | Operator's feedback on whether the `investigate_prompt` led to a useful outcome. Set when feedback widget submitted (§10.4). |
| `prompt_feedback_text` | `text` | nullable | Free-text feedback from the operator on what the agent missed or got right. |
| `triage_attempt_count` | `integer` | NOT NULL DEFAULT 0 | Number of times the monitor agent has triaged this incident. Used for rate limiting (§9.9). |
| `last_triage_attempt_at` | `timestamp` | nullable | Last triage attempt time. Used for rate-limit window. |
| `sweep_evidence_run_ids` | `uuid[]` | NOT NULL DEFAULT `'{}'` | Run IDs the agent inspected when this incident was sweep-driven (vs incident-driven, where the source row is in `metadata`). Empty for incident-driven triage. |

**New table `system_monitor_baselines`:**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `entity_kind` | `text` | enum: `agent`, `skill`, `connector`, `job_queue`, `llm_router` |
| `entity_id` | `text` | natural key per entity_kind (agent slug, skill id, connector id, queue name, router model) |
| `metric_name` | `text` | enum: `runtime_ms`, `token_count`, `output_length_chars`, `skill_invocation_count`, `tool_latency_ms`, etc. |
| `window_start` | `timestamp` | start of the rolling window this row represents |
| `window_end` | `timestamp` | end of window (= refresh time) |
| `sample_count` | `integer` | how many observations contributed |
| `p50` | `double precision` | median |
| `p95` | `double precision` |  |
| `p99` | `double precision` |  |
| `mean` | `double precision` |  |
| `stddev` | `double precision` |  |
| `min` | `double precision` |  |
| `max` | `double precision` |  |
| `created_at` | `timestamp` | refresh time |

Unique constraint: `(entity_kind, entity_id, metric_name)` — one current-baseline row per (entity, metric). Refresh updates in place via UPSERT, not append. Historical baselines are not preserved — Phase 3 may add a `system_monitor_baselines_history` table for drift detection.

**New table `system_monitor_heuristic_fires` (audit log):**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `heuristic_id` | `text` | from registry |
| `fired_at` | `timestamp` |  |
| `entity_kind` | `text` |  |
| `entity_id` | `text` |  |
| `evidence_run_id` | `uuid` | nullable, the run that triggered the fire |
| `confidence` | `double precision` | the heuristic's confidence at fire time |
| `metadata` | `jsonb` | heuristic-specific payload |
| `produced_incident_id` | `uuid` | nullable, FK `system_incidents(id)` — null if heuristic fired but throttle/dedupe blocked incident creation |

This table is the truth for "how often does heuristic X fire" and "what's its real false-positive rate". Used to tune heuristic metadata (§6.3) over time.

### 4.6 Migration

Single migration file (final number TBD by architect — auto-incremented from current head). Contents:

1. `ALTER TABLE system_incidents ADD COLUMN investigate_prompt text;`
2. `ALTER TABLE system_incidents ADD COLUMN agent_diagnosis jsonb;`
3. ... (remaining new columns from §4.5)
4. `CREATE TABLE system_monitor_baselines (...);` with unique index.
5. `CREATE TABLE system_monitor_heuristic_fires (...);`
6. `INSERT INTO users (id, email, is_system, ...) VALUES (SYSTEM_PRINCIPAL_USER_ID, 'system@platform.local', true, ...);` — system principal seed.
7. RLS policy additions for the two new tables (system-only access, mirrors `system_incidents`).

No column drops, no type changes, no constraint tightening on existing data. Migration is idempotent-friendly via `IF NOT EXISTS` where Drizzle generator allows.

**Rollback.** Drop the two new tables, drop the new columns. The system user row is left in place (deleting a referenced FK is messier than the row's footprint).

### 4.7 Failure mode tables (per critical component)

This subsection makes the per-component failure surface explicit. Constraints describe *what should hold*; failure modes describe *what happens when they don't*. Without explicit detection signals + system behaviour, multi-tenant + multi-agent failures degrade silently rather than failing loudly.

**4.7.1 PrincipalContext propagation (§4.3, §4.4).**

| Failure mode | Detection signal | System behaviour |
|---|---|---|
| `withSystemPrincipal` not invoked at handler entry | RLS denies all `system_*` table reads; query returns empty result or `permission denied` error | Hard fail. Handler logs `error('system-principal-context-missing', { handler, jobId })` and rethrows. pg-boss retries up to job retry limit (default 3); after that the job lands in DLQ and triggers the existing Phase 0/0.5 DLQ ingest hook. |
| Wrong `organisation_id` on synthesised principal (drift from `SYSTEM_OPERATIONS_ORG_ID`) | Cross-tenant read anomaly in audit log: system principal reading rows it should not be able to | Block at `assertSystemAdminContext` (§4.4) — typed `UnauthorizedSystemAccessError`. Audit log row written. RLS provides a second wall; even if the assertion is bypassed, the session-variable RLS denies the read. |
| Partial propagation — `withSystemPrincipal` covers part of a code path, then async work outside the scope queries with the wrong context | Mixed scoped + unscoped queries produce inconsistent results in the same handler | Reject the request. The integration test in §14.2 (`systemPrincipal.integration.test.ts`) explicitly probes this — a cross-scope query inside `withSystemPrincipal` for a tenant-write operation must fail. AsyncLocalStorage ensures any awaited continuation inside the wrapper inherits the context; code that breaks the context (e.g. `setImmediate` outside an `await`) fails the integration test. |
| `assertSystemAdminContext` bypassed (e.g. a new mutation method forgets to call it) | A mutation method completes against `system_incidents` from a non-sysadmin caller in CI integration test | Build fails. Slice C ships a CI gate that greps every `system_incidents` mutation method for an `assertSystemAdminContext(ctx)` call as the first executable line. Missing → CI red. |

**4.7.2 `recordIncident` ingest path (§4.1, §4.2).**

| Failure mode | Detection signal | System behaviour |
|---|---|---|
| Idempotency LRU evicts a key inside the 60s window (LRU full of newer keys) | `system_incident_ingest_idempotent_evictions` counter increments; second call with same key writes a second row | Soft fail. Metric increments; second row treated as a real second occurrence. Acceptable degradation — the LRU is a soft optimisation, not a correctness guarantee. Post-incident review catches if the eviction rate exceeds a threshold (Phase 3 dashboard signal). |
| Throttle map full (50,000 unique fingerprints) | `system_incident_ingest_throttle_map_evictions` counter increments | Oldest fingerprints lose their throttle protection. Tight-loop traffic on a recently-evicted fingerprint will not be throttled until the next call sets the entry. Acceptable — eviction rate is a tunable; if elevated, raise the cap or shorten throttle window. |
| `recordIncident` called from a handler that did not synthesise a principal | Sync mode: throws inside the route's auth middleware before reaching `recordIncident`. Async mode: the worker reads the queued payload but writing to `system_incident_events` fails RLS | Async mode: worker logs `error('incident-ingest-no-principal', ...)`, message stays on the queue, retries up to retry limit. Sync mode: 401/403 from the route. |
| Async ingest worker stalled (pg-boss queue not draining) | Synthetic check `pg-boss-queue-stalled` fires (§8.2) on the `system-incident-ingest-async` queue | High-severity incident emitted via `source='synthetic'`. The Phase 0/0.5 self-check (`system-monitor-self-check`) provides a second signal. |

**4.7.3 Sweep job (§9.3).**

| Failure mode | Detection signal | System behaviour |
|---|---|---|
| One heuristic throws inside `evaluate` | `logger.error('heuristic-evaluate-failed', { heuristic_id, candidate_id, err })` | The sweep handler's per-heuristic `try/catch` (§9.3 handler shape) catches; sweep continues with next heuristic. The candidate is not abandoned — other heuristics still evaluate against it. |
| `loadCandidates` query times out or errors | `logger.error('sweep-load-candidates-failed', { window, err })` | Sweep handler returns early; pg-boss retries the job (default 3). After retries exhausted, lands in DLQ. The next 5-min tick is independent; window overlap means missed candidates re-evaluate on the next tick (§9.3). |
| Sweep input cap hit (>50 candidates or >200 KB payload) | `sweep_capped` event written with `excess_count` (§12.1) | Top-50 by per-fire confidence proceed to triage. Excess candidates re-evaluate on next sweep (window overlap). Persistent cap-hits are a signal worth surfacing — Phase 3 dashboard. |
| Sweep tick exceeds 5-minute interval (next tick attempts to start while previous still running) | pg-boss `singletonKey: 'sweep'` causes the new tick to no-op; logger info | Acceptable — a slow sweep is a signal to investigate (deep-reads taking too long, baseline reader slow), but not a hard fail. The 15-min window means a one-tick miss is recovered on the next tick. |
| All candidates evaluate to no fires | Empty `fires[]`, `triages_enqueued: 0` in `sweep_completed` event | Normal. No incident production from this tick. |

**4.7.4 Baseline refresh (§7.3).**

| Failure mode | Detection signal | System behaviour |
|---|---|---|
| One `(entity_kind, entity_id, metric)` aggregate query fails | `baseline_refresh_failed` event written (§12.1); `logger.warn('baseline-refresh-entity-failed', ...)` | Other entities continue. The failed entity's existing baseline row stays in place (UPSERT failure leaves prior row intact); heuristics keep using stale-but-valid data until the next refresh. |
| Whole refresh job throws | `logger.error('baseline-refresh-failed', { err })`; pg-boss retries | Existing baselines unchanged. Heuristics that read `BaselineReader.get()` continue with stale data. The 15-minute refresh cadence means staleness is bounded; multi-tick failure is a signal worth investigating. |
| Refresh runs against an empty source table | Aggregate returns `count = 0`; UPSERT skipped (per architect-final aggregate logic) | No row written. `BaselineReader.get()` returns `null` for that triple → heuristics with `requiresBaseline` return `insufficient_data` (§7.4). |
| Sample count drops below `minSampleCount` for a previously-baseline entity (e.g. agent decommissioned) | Reader returns row with `sample_count < min` | `getOrNull(..., minSampleCount)` returns `null` → heuristic gracefully degrades to `insufficient_data`. |

**4.7.5 Triage agent run (§9.2, §9.8).**

| Failure mode | Detection signal | System behaviour |
|---|---|---|
| Agent run hits max-turns without producing diagnosis | `agent_runs.terminated_reason == 'max_turns'`; no `write_diagnosis` call | `agent_triage_failed` event written with `reason='agent_run_failed'`. UI drawer renders triage-failed badge (§10.3). Operator can manual-escalate via Phase 0/0.5 path. |
| `write_diagnosis` produces invalid prompt (validation fails per §9.8) | `promptValidation` rejects; agent's run loop retries up to 2× | After 2 retries: `agent_triage_failed` event with `reason='prompt_validation'`. UI shows "Prompt validation failed — operator should investigate manually" inline (§10.3 failure mode visibility line). |
| Agent run errors (LLM API down, rate-limited at provider level) | Run terminal status non-success | `agent_triage_failed` event with `reason='agent_run_failed'`, `error_message` field carries provider error. pg-boss retries the triage job (default 3). |
| Triage timeout exceeds 5-minute soft cap | Job runtime tracking | `agent_triage_failed` with `reason='timeout'`. Operator notified via the existing UI surface; manual-escalate available. |
| Concurrent triage attempts on same incident (sweep + incident-driven race) | pg-boss `singletonKey` per `incidentId` collapses (§9.2) | Second enqueue is a no-op. Audit log shows one triage; no double-charge to rate limit. |

**4.7.6 Synthetic-check tick (§8.1).**

| Failure mode | Detection signal | System behaviour |
|---|---|---|
| One check throws inside `run(ctx)` | `logger.error('synthetic-check-failed', { checkId, err })` | Per-check `try/catch` in the tick handler isolates the failure. Other checks continue. The bad check is still on the next tick — a persistently-failing check produces persistent log lines, surfaced for operator attention. |
| Check internally exceeds 5s soft cap | Check-side timeout produces `fired: false` + `logger.warn('synthetic-check-slow', ...)` | The slow check does not block the tick. Persistent slowness is a signal worth investigating; the tick budget is 30s total per §8.1. |
| Tick handler exceeds 30s budget (rare; checks isolated) | pg-boss runtime > 30s | Logger warns. Next tick is independent. Persistent breach surfaces on the operator's monitoring view. |
| `recordIncident` from inside a check fails (e.g. RLS issue on sync mode) | Per-check `try/catch` catches | Check is logged as failed; tick continues. No incident written; the next tick re-evaluates and tries again. |

**Cross-cutting failure-recovery posture.** No silent failures. Every failure mode either (a) writes a structured event (`agent_triage_failed`, `sweep_capped`, `baseline_refresh_failed`, etc.) that surfaces in the audit log + UI, or (b) increments a counter that's queryable via the standard structured-log dimensions (§12.3). Operators see what failed and why; the system does not paper over failures with default-success states.

### 4.8 Global idempotency invariant + key-format conventions

**The invariant.** Every externally-triggerable action introduced by this spec MUST carry a deterministic idempotency key. "Externally-triggerable" means: any action enqueued by pg-boss, any HTTP mutation route the operator can hit, any reactive ingest path that may be retried, any sweep / synthetic-check / baseline-refresh tick. The key must be derivable from the action's identity (the inputs that uniquely determine "this is the same action"), not from a random UUID generated at enqueue time.

**Why a deterministic key.** Random keys defeat the purpose — two retries of the same logical action with different random keys are treated as two distinct actions, double-executing the side effect. A deterministic key is the same on retry as on the original; idempotency layer collapses them.

**Structural rule for keys.** Every key in the table below is constructed from three components — there is no payload-hash step, because the components themselves are canonical:

1. **Operation type** — the action class (`triage`, `sweep`, `synthetic`, `baseline-refresh`, `sweep-tick`, `synthetic-checks`). Always the leading namespace component.
2. **Scope** — the tenant/system boundary the action runs against. For this spec, every scope is `system` (the monitor is system-scoped). Phase 5+ tenant-scoped monitoring will introduce per-`org_id` / per-`subaccount_id` namespacing; the structural slot is reserved by convention even though every current key implicitly fills it with `system`.
3. **Identity component** — the input fingerprint that uniquely identifies this logical action: `incidentId`, `(candidateKind, candidateId, bucketKey)`, `(checkId, resourceId, bucketKey)`, etc. Always derived from named action inputs; never from JSON-serialised payload + hash. Per §4.6 and the inherited Phase 0/0.5 fingerprint, the identity component is canonical by construction.

**Cross-operation collision is invalid.** Two actions with different operation types MUST NOT share the same key. The leading-namespace convention (`triage:`, `sweep:`, `synthetic:`, etc.) enforces this structurally — a `triage:<incidentId>` key cannot collide with a `sweep:<candidateKind>:<candidateId>:<bucketKey>` key because the namespaces differ. Same key + different operation types is therefore a code bug (caller forgot the namespace prefix), not a runtime case the system must tolerate.

**Same key + different payload behaviour.** Per the storage table below, every layer's collision posture is named explicitly. The cross-cutting rule: the system MUST NOT silently merge differing payloads under the same key. Either the second write is rejected (work-product layer — `write_diagnosis`, `recordPromptFeedback`), or the mismatch is logged at `warn` and treated as a fresh row (LRU layer — see §4.7.2 + storage table below), or the second enqueue's payload is discarded and the singleton-collision return is logged (pg-boss layer). No silent merge anywhere.

**Why no payload fingerprinting.** Payload-hash idempotency is the right pattern when the caller cannot pre-derive a stable key (e.g. arbitrary HTTP webhook bodies). Every key in this spec's surface is derivable from named structured inputs (`incidentId`, `candidateId`, `bucketKey`) — adding a JSON-canonicalisation + hash step would be an extra failure surface (sort-order bugs, transient field exclusion bugs) for zero benefit. Phase 5+ may introduce payload-hash keys if a caller surface emerges that needs them; not built now.

**Key-format conventions.**

| Action class | Key format | Storage | Expiry |
|---|---|---|---|
| `recordIncident` (any caller) | `<caller-supplied>:<fingerprint>` (caller may pre-derive a key, or omit and accept fingerprint-only behaviour) | Process-local LRU (§4.1) | 60s TTL (`SYSTEM_INCIDENT_IDEMPOTENCY_TTL_SECONDS`) |
| `recordIncident` from synthetic check | `synthetic:<check_id>:<resourceId>:<bucketKey>` (§8.1) | Same LRU | Same TTL |
| `recordIncident` from sweep cluster | `sweep:<candidateKind>:<candidateId>:<bucketKey>` | Same LRU | Same TTL |
| `system-monitor-triage` enqueue (incident-driven) | `triage:<incidentId>` (singletonKey) | pg-boss singleton | Job lifetime |
| `system-monitor-triage` enqueue (sweep-driven) | `sweep:<candidateKind>:<candidateId>:<bucketKey>` | pg-boss singleton + idempotencyKey on payload | Job lifetime |
| `system-monitor-sweep` tick | `sweep-tick:<bucketKey>` (singletonKey) | pg-boss singleton | Job lifetime |
| `system-monitor-synthetic-checks` tick | `synthetic-checks` (singletonKey, single tick at a time) | pg-boss singleton | Job lifetime |
| `system-monitor-baseline-refresh` tick | `baseline-refresh` (singletonKey) | pg-boss singleton | Job lifetime |
| `write_diagnosis` skill call | `(incidentId, agentRunId)` — composite primary-key-style check inside the skill | DB unique constraint on `(system_incidents.id, agent_diagnosis_run_id)` — second call is a no-op when both columns already match | Permanent (until incident reopens with new `agent_diagnosis_run_id`) |
| `write_event` skill call | `(incidentId, event_type, agentRunId)` for agent-emitted events | Composite check inside the service; idempotent INSERT pattern (existing Phase 0/0.5 pattern) | Permanent |
| `recordPromptFeedback` mutation | `(incidentId, actor_user_id)` — first submission wins, second returns 409 (§10.4) | DB unique-constraint-or-application-level check | Permanent |

**Bucket keys.** A `bucketKey` is a time-bucket string used to coarsen idempotency windows for periodic actions. Format: `YYYY-MM-DDTHH:MM` rounded to the nearest bucket interval. Examples:

- Sweep `bucketKey`: 15-minute bucket — `2026-04-26T01:30` covers 01:30:00–01:44:59.
- Synthetic-check `bucketKey`: 15-minute bucket per check — same format, prevents N incidents in N minutes from a single stalled queue.

**Deduplication windows are documented per action.** Every action declaring an idempotency key also names its window above. The window is the shortest interval during which two calls with the same key are guaranteed to collapse. Outside the window, behaviour reverts to "two distinct actions" (acceptable for the periodic actions; for permanent actions like `write_diagnosis`, the window is the lifetime of the row).

**Key consistency check (CI gate).** Slice C adds a CI script that greps every `enqueue` / `pgboss.send` / `recordIncident` call site in the new code and verifies an `idempotencyKey` or `singletonKey` is set per the table above. Missing → CI red. Pattern: regex over `server/services/systemMonitor/**` and `server/jobs/systemMonitor*.ts`.

**Storage, lifecycle, cleanup, and collision handling.**

| Idempotency layer | Storage | Lifecycle | Cleanup | Collision handling (key exists, payload differs) |
|---|---|---|---|---|
| `recordIncident` LRU (§4.1) | Process-local `Map`-backed LRU, 10,000 entries soft cap | Per-process; lost on restart by design | LRU eviction on size or TTL (60s); no background sweep needed | **Last-payload-wins is unacceptable** — payload differing means a different logical operation arrived under the same key (caller bug). The LRU stores only the key, not the payload, so collision is undetectable. The downstream DB write performs a fingerprint+content-hash compare and, on mismatch, writes a fresh row (the second call is treated as a distinct occurrence). The mismatch is logged at `warn` with `idempotency-key-payload-mismatch`. |
| Per-fingerprint throttle map (§4.2) | Process-local `Map<string, number>`, 50,000 entries cap | Per-process | LRU eviction on size; entries naturally age out as time advances past the throttle window | n/a — value is just a timestamp, not payload-bearing |
| pg-boss `singletonKey` | pg-boss tables (`pgboss.job`) | Job lifetime — ends when job state is `completed`, `failed`, or `archived` | pg-boss internal — `pgboss.archive` retention controlled by existing pg-boss config | pg-boss collapses concurrent enqueues by key; payload of the second enqueue is **discarded**, not merged. If callers must surface a payload-differs case, the caller checks the singleton-key-collision return value from `pgboss.send` and emits a log line. |
| `write_diagnosis` work-product idempotency (§4.8 row) | DB-row-level: `system_incidents.agent_diagnosis_run_id` carries the agent run id; second call with the same `(incidentId, agentRunId)` is a no-op | Permanent — until the incident reopens with a fresh `agent_diagnosis_run_id` (re-triage) | None needed — the row is durable; new triage replaces it via UPDATE | If `(incidentId, agentRunId)` already exists with a different `agent_diagnosis` payload, this is a contract violation (the agent retried with the same run id but produced different content). Write rejected with typed error; logger error `write-diagnosis-payload-conflict`. The retry-up-to-2 loop in §9.8 is the legitimate path; payload-conflict beyond that is a bug. |
| `recordPromptFeedback` mutation (§10.4) | DB unique constraint or application-level check on `(incident_id, actor_user_id)` plus the `prompt_was_useful IS NULL` precondition | Permanent (until admin-override path is added — out of scope) | None | First-wins; second submission returns 409 with body `{ error: 'feedback-already-submitted' }`. No silent overwrite. |

**Cleanup posture for in-process layers.** The two in-process layers (LRU, throttle map) self-clean via eviction and TTL. There is **no background sweep** — adding one would be a new failure surface (sweep that doesn't run leaves stale data; sweep that runs too often masks real cardinality). The cap-based + TTL-based eviction model is the simpler-and-correct posture.

**No persistent idempotency store.** This spec deliberately does not introduce a Redis / DB-backed idempotency cache. The cost of a missed dedupe is "two rows where one would do" — recoverable at the row level via the existing fingerprint deduplication in `recordIncident`. The cost of building a persistent cache is non-trivial (operational dependency, eviction story, cross-tenant blast radius). Phase 3 may upgrade if traffic patterns warrant; that decision lives in Phase 3's design, not here.

**Schema evolution rules for idempotency-bearing JSON payloads.**

The `schema_version: 'v1'` field on agent-emitted JSON (§9.8) is the version anchor. The compatibility contract is:

- **Backward compatibility (readers).** Code that reads a `v1` payload MUST tolerate unknown fields — additive changes within `v1` (new optional keys) are not version bumps. A `v1` consumer that throws on unknown keys is a bug.
- **Forward compatibility (writers).** A new version MUST NOT remove a required field without a version bump. Required-field removal or type changes are breaking — the writer bumps to `v2` and the reader switches on `schema_version` to dispatch.
- **Old-record readability.** Old records with `schema_version: 'v1'` MUST remain readable without transformation after a `v2` is introduced. Migration of historical rows is out of scope; readers handle both versions side-by-side, indefinitely. (This matches the additive-only schema posture in §4.6 — schema changes never destroy history.)
- **What "required" means.** Required fields per `v1` are the ones documented in §9.8 + §12.1 metadata tables. New optional fields can land any time without a version bump as long as readers tolerate them.
- **Version-bump trigger.** A version bump is required only when a payload field is removed, renamed, retyped, or its semantics change in a way that breaks a `v1` reader. New optional fields, additional enum values on string-enum fields (with `v1` readers ignoring unknown enum values), and stricter validation on writes (rejecting payloads `v1` would have accepted) are NOT version bumps — they are graceful evolutions within the version.

**Why this is a global invariant, not per-component.** A new sub-system added in Phase 3 must inherit the same idempotency posture without redesign. Naming the rule once + centralising the key formats is the lever that prevents per-feature drift.

**Inherited from Phase 0/0.5.** The fingerprint algorithm itself (the deterministic identity of an incident) is unchanged — it is the natural identity component for every `recordIncident` key. Phase 0/0.5 fingerprint contract is the foundation; this section layers idempotency keys *on top of* fingerprint, not in place of.

### 4.9 Concurrency + race-condition rules

**The invariant.** Every concurrent path introduced by this spec must declare its concurrency posture: last-write-wins vs reject-if-stale vs deduplicate-via-singleton. Implicit "it'll probably be fine" is not acceptable.

**4.9.1 Concurrent triage on the same incident (sweep + incident-driven race).**

- **Posture:** Deduplicate via pg-boss `singletonKey: incidentId`.
- **Mechanism:** Both the incident-driven trigger (§9.2) and the sweep-driven trigger (§9.3) enqueue with the same `singletonKey`. pg-boss collapses concurrent enqueues into one job. The second enqueue is logged as `triage_enqueue_deduplicated` (audit) and skipped.
- **Rate-limit accounting:** The collapsed enqueue counts as **one** triage attempt against `triage_attempt_count` (§9.9). A noisy candidate that fires both triggers in the same window is one triage, not two.
- **Test:** §14.2 `triageJob.incidentDriven.integration.test.ts` includes a probe that fires both triggers within 1 second and verifies one agent run.

**4.9.2 Concurrent baseline refresh (overlap with prior tick).**

- **Posture:** Single-tick-at-a-time via pg-boss `singletonKey: 'baseline-refresh'`. Last-write-wins on the row level (UPSERT).
- **Mechanism:** A slow refresh tick that exceeds 15 minutes will block the next tick from starting until it finishes. The next tick then runs against fresher data. UPSERT on `(entity_kind, entity_id, metric_name)` means even if two refreshes did somehow run, the second's UPSERT overwrites the first's row — last-write-wins is acceptable because both writers compute against the same window.
- **Failure mode:** Persistent slowness (refresh > 15min consistently) leaves baselines stale beyond their nominal cadence; surface via the existing baseline-refresh-failed audit (§12.1) and via the elapsed-time logger field.

**4.9.3 Concurrent feedback submission on the same incident.**

- **Posture:** Reject-if-stale (first wins). Second submission returns 409.
- **Mechanism:** `recordPromptFeedback` (§10.4) uses an application-level check + DB unique constraint on `(incident_id, actor_user_id)` (or equivalently, the existing nullable column transition is gated — `prompt_was_useful IS NULL` becomes the precondition for a write). Concurrent first-time submissions race; whichever commits first wins; the loser receives 409.
- **Why first-wins, not last-wins:** Feedback is meant to capture the operator's first-pass impression at resolve time. Allowing overwrite would require a richer audit trail (see §11.1 — "the audit history lives in the events log, the schema column holds the current state"). Forcing first-wins keeps the audit trail meaningful — if the operator wants to update feedback, an explicit admin override path is the right surface (out of scope for v1).

**4.9.4 Concurrent `recordIncident` calls (tight-loop traffic).**

- **Posture:** Deduplicate via per-fingerprint throttle (§4.2) + idempotency LRU (§4.1).
- **Mechanism:** Order is: `compute fingerprint → throttle check → idempotency check → DB write`. Throttle wins first (drops 99/100 same-fingerprint calls in 1s). Idempotency LRU catches the rest if `idempotencyKey` is supplied.
- **Cross-process behaviour:** Process-local LRU + map are NOT shared across processes. A multi-process deploy will, in the worst case, write one row per process per fingerprint per second. Acceptable — the cost of a missed dedupe is "two rows where one would do," and the 1s window is short enough that the multi-process overcount is bounded. Phase 3 may upgrade to Redis for cross-process coordination if traffic patterns warrant; explicitly deferred.

**4.9.5 Concurrent sweep ticks (slow tick + new tick).**

- **Posture:** Single-tick-at-a-time via pg-boss `singletonKey: 'sweep-tick'`.
- **Mechanism:** Same as baseline refresh — pg-boss collapses concurrent attempts. The new tick waits or no-ops; the 15-minute window overlap on the next clean tick recovers the missed candidates.
- **No advisory locks needed:** pg-boss singleton is sufficient. Heuristic evaluations are read-only against agent-run / job / skill-execution rows; they do not mutate state, so no locking is required at the row level.

**4.9.6 Concurrent retry overlap (pg-boss retry vs original execution).**

- **Posture:** Idempotency at the work-product level, not the job level.
- **Mechanism:** A pg-boss retry of a triage job that crashed mid-run executes again. The agent's `write_diagnosis` skill enforces idempotency on `(incidentId, agentRunId)` (§4.8). If the original run wrote the diagnosis before the crash, the retry's `write_diagnosis` is a no-op. If not, the retry re-runs the agent and writes fresh.
- **Why not job-level idempotency:** A pg-boss retry has the same job payload but the agent run may produce different content (different LLM sample, different timestamps). Job-level idempotency would mask legitimate retries; work-product idempotency catches "this row already has the diagnosis we'd write" and short-circuits.

**4.9.7 Concurrent webhook delivery (Phase 0/0.5 inheritance).**

- **Posture:** Inherited unchanged from Phase 0/0.5 — webhooks (Pulse, WebSocket fanout) are at-least-once; consumers must be idempotent.
- **No new webhooks in this spec.** Diagnosis updates fan out via the existing `system_incident:updated` channel (NG7). No new event delivery surface introduced.

**4.9.8 Throttle map race (concurrent `recordIncident` on the same fingerprint within 1ms).**

- **Posture:** Last-write-wins on the map. Acceptable race.
- **Mechanism:** Two concurrent calls reading `lastSeenByFingerprint.get(fp)` may both see no entry, both proceed to ingest, both write `lastSeenByFingerprint.set(fp, now)`. Result: two ingests in a 1-2ms window, then throttle kicks in for subsequent calls. The race window is sub-millisecond; the cost is one duplicate row at most. Not worth a mutex — the throttle is a soft optimisation.

**Cross-cutting concurrency posture.** All concurrency rules are documented and tested. The three load-bearing patterns are: (a) pg-boss `singletonKey` for tick / triage dedup, (b) work-product idempotency for retry safety, (c) accept-the-soft-race for sub-millisecond optimisations where the cost is bounded.

**4.9.9 Deterministic ordering guarantees.**

Ordering matters for some paths and is irrelevant for others. Every path introduced by this spec falls into one of two buckets — there is no implicit "probably-fine ordering" zone.

| Path | Ordering posture | Why |
|---|---|---|
| `system_incident_events` append-only log | **Ordered** by `created_at` (timestamp) and surrogate `id` (uuid v7 per existing convention) | Operators read events in time order; UI renders chronologically; downstream feedback aggregation joins on order. |
| Sweep heuristic evaluations within a tick | **Commutative** — heuristics are evaluated independently against each candidate; any order yields the same fires set | No heuristic depends on another's output within a tick. |
| Sweep candidates within a tick | **Commutative** | Each candidate is evaluated independently; clustering happens after all fires are collected. |
| Synthetic checks within a tick | **Commutative** | Each check runs in isolation; one check's outcome does not affect another's. |
| Multiple `recordIncident` calls with different fingerprints | **Commutative** | Each fingerprint owns its own incident lifecycle. |
| Multiple `recordIncident` calls with the **same** fingerprint | **First-wins-per-window** | Throttle (§4.2) drops duplicates; idempotency LRU (§4.1) collapses re-tries; `occurrence_count` increments via DB UPDATE which is serialisable. |
| `agent_runs` message history within a single run | **Ordered** by `sequence_number` (existing Phase-0 convention) | Agent execution depends on message order. |
| Baseline aggregate computation | **Commutative** | Aggregates over a window are order-independent by construction. |
| pg-boss job retries | **Ordered** per job; retries replace prior attempts at the same logical position | Existing pg-boss semantics. |

**Rule:** When a new path is introduced (in this spec or downstream), its concurrency contract must declare its ordering posture in one of these two buckets. There is no third bucket — "we'll figure it out at runtime" is the failure pattern this rule prevents.

### 4.10 Cross-invariant interaction rules

§4.7 (failure modes), §4.8 (idempotency), §4.9 (concurrency), and §9.3 (partial-success) each define one axis of system behaviour. They interact under real load — a retry that hits an idempotency layer, a partial-success that retries only failed components, a failure that must still persist its idempotency record. Without naming the interactions explicitly, the executor will pick a local rule per-axis and the system will drift.

The ten subsections below cover: (1-4) the four primary axis interactions, (5-6) liveness and in-flight-duplicate semantics, (7) source-of-truth hierarchy across layers, (8) time semantics, (9) the at-least-once-delivery / exactly-once-outcome split, and (10) backpressure / load-shedding posture.

**4.10.1 Idempotency × Retry.** Retries MUST reuse the same idempotency key as the original attempt. A new key would mean "this is a new logical operation," which is what idempotency is designed to prevent. Concretely:

- pg-boss retries inherit the original job's payload; `idempotencyKey` is part of the payload, so re-execution sees the same key.
- Application-level retry (e.g. agent's `write_diagnosis` retry-up-to-2) reuses the same `(incidentId, agentRunId)` key; the second attempt is a no-op when the row already has the diagnosis.
- A **new** idempotency key is only generated when the work itself is logically new — e.g. a fresh sweep tick (new `bucketKey`), a re-triage of an incident after a rate-limit window resets (new `(incidentId, agentRunId)` because `agentRunId` is new).

**4.10.2 Concurrency × Idempotency.** Concurrent identical requests MUST collapse to one execution. The losing call returns the in-flight or completed result; it does not re-execute and does not error. Concretely:

- pg-boss `singletonKey` collapses concurrent enqueues into one job (§4.9.1, §4.9.2, §4.9.5). The losing enqueue is logged as `triage_enqueue_deduplicated` (or equivalent) and skipped.
- Idempotency LRU (§4.1) returns "hit" for the second concurrent `recordIncident` with the same key; second caller sees no DB write but receives the same logical "incident recorded" outcome.
- Work-product idempotency (§4.8 `write_diagnosis`) makes the second attempt a no-op when the row already carries the diagnosis.

**4.10.3 Partial Success × Retry.** A `partial_success` outcome (§9.3) MUST NOT re-run successfully completed components on retry. Only the failed components are eligible for retry. Concretely:

- Sweep handler returns `partial_success` when one heuristic errored on one candidate. The fires that succeeded propagate to triage (downstream side effects already happened). The next 5-min sweep tick re-evaluates the failed pair against the new (overlapping) window — this is the natural retry, not a forced re-execution of the full tick.
- The retry policy in §9.3 ("`success` and `partial_success` are NOT retried") is the explicit form of this rule: pg-boss does not retry the whole tick on partial outcomes; the next scheduled tick is the retry surface.
- Synthetic-check tick follows the same rule: a tick with one failed check is not retried as a whole; the failing check re-runs on the next 1-min tick.

**4.10.4 Failure Mode × Idempotency.** A failed execution MUST still persist its idempotency record so a subsequent retry can detect it has already been attempted. Without this, a hard-failed call retries indefinitely from the same caller. Concretely:

- `agent_triage_failed` events (§12.1) are written for every failure mode (`prompt_validation`, `agent_run_failed`, `timeout`, `self_stuck`). The event row is the durable failure record; the rate limit (§9.9) consults `triage_attempt_count` (incremented on every triage attempt, success or failure) to bound retries.
- A `recordIncident` call that throws after writing the LRU entry leaves the entry behind — second caller within TTL is collapsed even though the first never produced a row. Acceptable: TTL bound is short (60s); the second caller's next attempt outside TTL writes fresh.
- Idempotency for failed work-product writes (e.g. failed `write_diagnosis`) is enforced via the agent's retry-up-to-2 loop (§9.8); after exhaustion, `agent_triage_failed` event is written and `triage_attempt_count` increments, preventing infinite retry through the rate-limit gate.

**4.10.5 Heartbeat × Liveness × Stalled-state.** "Running" and "stuck" must be distinguishable; an in-flight job that produces no progress for too long is stalled, not still running. Concretely:

- pg-boss provides job-level liveness via its internal heartbeat (worker → boss tables). A worker that dies leaves the job in a state pg-boss reaps after the configured timeout; the job is then retried per the retry policy (§4.10.1) or lands in DLQ (§4.7.5).
- Agent-run liveness is tracked via `agent_runs.runtime_ms` updated on every step; a run that exceeds the soft cap (5 minutes per §9.11 / §12.4) is treated as stalled — the triage handler emits `agent_triage_failed` with `reason='timeout'` and the rate-limit counter increments.
- The monitor's own self-stuck detection (§9.11) is the second-tier liveness check: cross-run pattern detection (`identical output`, `tool-only final message`, `no write_diagnosis after 8 turns`) catches semantic stuck states that runtime alone misses.
- **No heartbeat column on `system_incidents`.** Liveness is tracked at the work-product level (job, agent-run), not at the incident level. The incident is a logical entity; the job/run is the executing entity that has "running" semantics.

**4.10.6 In-flight duplicate-request semantics.** When a duplicate request arrives while the same logical work is in flight, the duplicate MUST observe the in-flight status and either (a) collapse via singleton key (no-op enqueue) or (b) return the in-flight reference if the call is read-style. Concretely:

- Triage enqueue duplicates collapse via `singletonKey: incidentId` (§4.9.1). The duplicate enqueue does not block, does not error, does not re-execute. It writes `triage_enqueue_deduplicated` to the audit log and returns.
- Sweep tick duplicates collapse via `singletonKey: 'sweep-tick'` (§4.9.5).
- Read-style requests (e.g. operator polling the incident drawer while the agent is mid-run) read the current state of `system_incidents` — `triage_attempt_count > 0 AND agent_diagnosis IS NULL AND last_triage_attempt_at > NOW() - 5 min` is the in-flight indicator (§10.1 loading state). The drawer renders a skeleton; no re-trigger.
- **No new DB column for in-flight state.** The combination of `triage_attempt_count`, `agent_diagnosis`, `last_triage_attempt_at` already encodes the four observable states (idle, in-flight, succeeded, failed-but-retryable). Adding a status column would duplicate state and create the "two sources of truth" failure mode that NG-class rules explicitly prevent.

**4.10.7 Source-of-truth hierarchy.** Multiple layers store state about the same logical action — work-product rows, audit events, idempotency caches, structured logs. Without a hierarchy, the executor will check whichever is convenient and the layers will silently disagree. The authoritative ranking:

| Layer | Role | Authoritative for |
|---|---|---|
| **Work-product rows** (`system_incidents`, `agent_runs`, `system_monitor_baselines`, `system_monitor_heuristic_fires`) | Source of truth for outcome. The "what happened" answer. | Final state of the operation: did the agent diagnose? what was the runtime? what's the current baseline? Reading any other layer to answer this is wrong. |
| **`system_incident_events`** (audit log) | Fidelity record of state transitions. The "how did we get here" answer. | History — every state change appends a row; rows are never mutated or deleted. Used for audit, drill-down, debugging, downstream training data. NOT used as the current-state read path. |
| **Idempotency layers** (LRU §4.1, throttle map §4.2, pg-boss singletons, work-product unique keys §4.8) | Execution-control only. | Whether to *execute* this attempt — never read for outcome. A "hit" in the LRU means "skip the write," not "the write succeeded." |
| **Structured logs** (logger.info / logger.warn / logger.error per §12.3) | Diagnostic-only. | Operator debugging, structured-log-as-metric (per §12.3 queryable-dimensions invariant). NEVER the source of truth for outcome — logs may be sampled, dropped on shipping failure, or rotated. |

**Cross-cutting rule:** When two layers disagree, the work-product row wins. If the LRU says "hit" but the work-product row is missing, the action did not complete (the LRU is execution-control only, see above). If the audit log says "agent_diagnosis_added" but `system_incidents.agent_diagnosis IS NULL`, the row write failed mid-flight — investigate, but trust the row. If a log line says one thing and the work-product row says another, the row is correct and the log is stale or misleading.

**Why this matters.** Pre-production code naturally accumulates layers; without a hierarchy, "where do I read X from?" becomes a per-caller decision and the layers drift. Naming the rank once + applying it across §4 / §9 / §10 / §11 / §12 is the lever that prevents per-caller drift.

**4.10.8 Time semantics.** All timestamps generated by code introduced in this spec MUST be UTC, server-generated, ISO 8601 in their text representation. Concretely:

- DB columns of `timestamp` type are written via `NOW()` or equivalent — never via a client-supplied value. The Postgres default (UTC) is the storage convention.
- Structured log timestamps are server-generated by the logger middleware (existing pattern) — call sites do not pass a `timestamp` field.
- Event-row `created_at` is `NOW()` at append time; `metadata.resolved_at` (per §11.2) is server-derived from the resolve mutation, not from the client.
- Cross-process / cross-tier ordering relies on server-issued sequence numbers + server `created_at` (per §4.9.9 ordering rules), never on client clocks.
- API responses serialise timestamps as ISO 8601 with `Z` suffix (UTC). The client renders in the operator's local zone for display only — never round-trips back to the server as authoritative.

**Why the server-only rule.** Client clocks drift; phones lie about timezone; multi-process deployments under load see different OS clocks. Treating the server (with NTP-synced clocks) as the single time source is the cheapest correctness guarantee. This is consistent with the inherited Phase 0/0.5 convention; restating here so new paths in this spec do not accidentally accept client-supplied timestamps.

**4.10.9 Delivery vs outcome model.** The execution model in this spec is **at-least-once delivery, effectively-exactly-once outcome via idempotency**. Naming both halves separately because conflating them is the failure pattern this rule prevents.

- **At-least-once delivery.** pg-boss retries failed jobs (§12.4 — default 3 retries), `recordIncident` is called by multiple sources for the same logical event (sync mode + async worker + sweep cluster), webhooks fan out at-least-once (§4.9.7). The system never assumes "this will run exactly once" at the delivery layer.
- **Effectively exactly-once outcome.** Idempotency (§4.8) is the layer that turns at-least-once delivery into effectively-once observable side effects. Two retries of the same triage produce one `agent_diagnosis_added` event row and one `agent_diagnosis` JSON. Two `recordIncident` calls with the same key produce one row. The DB row is the proof of "exactly once" at the outcome layer.
- **The two halves combine.** Code at the delivery layer (handlers, routes, ingest paths) MUST tolerate retries silently — a second invocation observes the first's side effects via the idempotency layer and returns success without re-doing the work. Code at the outcome layer (work-product writes) MUST produce one observable result regardless of how many delivery attempts arrived.
- **No "exactly-once delivery" attempts.** True exactly-once delivery is a distributed-systems hard problem and is not what this spec implements. The combination above is the operational reality — and the only reality that scales.

**4.10.10 Backpressure / load-shedding.** Under sustained overload, the system MUST reject new work loudly rather than buffer indefinitely or silently drop. The mechanism uses existing primitives — there is no new "rejected_over_capacity" status because the existing cap-signal events already encode this:

| Cap | Signal when hit | Behaviour |
|---|---|---|
| Sweep candidate cap (50) / payload cap (200 KB) per §9.3 | `sweep_capped` event with `excess_count`, `cap_kind` (§12.1) | Top-N proceed to triage; excess re-evaluated next tick. Operator sees the signal. |
| Idempotency LRU full (10,000 entries) per §4.1 | `system_incident_ingest_idempotent_evictions` counter (§4.7.2) | Eviction is the soft fail; the metric increments. Acceptable degradation per §4.7.2. |
| Throttle map full (50,000 fingerprints) per §4.2 | `system_incident_ingest_throttle_map_evictions` counter (§4.7.2) | Oldest fingerprints lose throttle; metric increments. Acceptable per §4.7.2. |
| Triage rate limit (2/fingerprint/24h) per §9.9 | `agent_triage_skipped` event with `reason='rate_limited'` (§12.1) | Triage skipped; auto-escalation path may fire (§9.9). Operator sees the signal. |
| pg-boss queue stall (job not draining) | `pg-boss-queue-stalled` synthetic check fires (§8.2) | High-severity incident produced; the synthetic-check pipeline is the load-shedding signal for queue overload. |
| pg-boss DLQ accumulation | `dlq-not-drained` synthetic check fires (§8.2) | Same — DLQ growth is detected via the synthetic-check tick, not via a direct overload-status field. |

**Cross-cutting rule:** No new code path introduced by this spec or downstream may silently drop work under load. Either it (a) collapses via an idempotency layer (no-op is fine — duplicate detection is not a drop), or (b) emits a cap-signal event when a cap is hit (sweep_capped / triage_rate_limited / synthetic-check fired), or (c) fails loudly via a structured-log line at `error` (§12.3 no-silent-fallback rule). The **third bucket — silent drop without signal — is forbidden**. This is the same rule as §12.3's no-silent-fallback invariant, applied to the load-shedding axis.

**Why no `rejected_over_capacity` status.** A new status field would duplicate signal already encoded by the cap-signal events above — the operator-visible answer to "is the system shedding load?" is "is the `sweep_capped` event firing?" / "is `triage_rate_limited` firing?" Adding a separate `rejected_over_capacity` payload would be a third source of truth (see §4.10.7) that the operator must reconcile against the existing two.

**Rule (cross-cutting):** When a new path is introduced (in this spec or downstream), the executor confirms its behaviour against the ten interaction rules above before merging. The conformance check is part of the spec-conformance pass — not a runtime gate.

## 5. Investigate-Fix Protocol

### 5.1 Document location and purpose

**Location.** `docs/investigate-fix-protocol.md` — alongside `docs/capabilities.md`, `docs/spec-context.md`, `docs/codebase-audit-framework.md`, `docs/frontend-design-principles.md`. This is the established home for cross-cutting protocol/reference docs in the repo.

**Purpose.** Define a single shared contract between two consumers:

1. **The monitor agent** (server-side, `system_monitor`). Its prompt-authoring instructions reference this protocol — "when emitting `investigate_prompt`, format per `docs/investigate-fix-protocol.md`." This makes prompt format predictable and tunable in one place.
2. **Claude Code** (operator's local development environment). Via a `CLAUDE.md` hook (§5.3), every Claude Code session in this repo is told "if given a prompt that begins with the protocol header, follow `docs/investigate-fix-protocol.md` for execution behaviour."

The protocol is the **structural** contract. Both ends iterate against it. The agent's prompt-writing improves; Claude Code's prompt-consumption behaviour improves; the contract holds the iteration coherent.

**The forward path.** When Phase 3 (auto-remediation) ships, a server-side worker will follow the **same protocol** to consume prompts unattended. No architectural change — just a new executor pointed at the same contract. The protocol-doc approach is the lever that makes Phase 3 incremental rather than a rewrite.

### 5.2 Prompt structure (the contract)

Every `investigate_prompt` value generated by the monitor agent must conform to the following structure. Sections are markdown-headered for human readability and machine parseability.

```markdown
# Investigate-Fix Request

## Protocol
v1 (per docs/investigate-fix-protocol.md)

## Incident
- ID: <system_incidents.id>
- Fingerprint: <fingerprint>
- Severity: <low|medium|high|critical>
- First seen: <ISO8601>
- Occurrence count: <integer>
- Source: <route|agent|job|connector|skill|llm_router|synthetic|self_check>

## Problem statement
<One paragraph. What looks wrong. Plain English. No internal jargon
without expansion. Example: "Agent run abc123 completed successfully
but produced no output text. The agent is configured to summarise
emails; the user-facing result is empty. This is the third occurrence
in the last 6 hours.">

## Evidence
<Bullet list. Each bullet must include a file:line reference where applicable,
or a stable resource identifier (agent_runs.id, pgboss.job.id, etc.).
Example:
- agent_runs.id = abc123 (server/services/agentRunner.ts:147 logs the
  empty-output case)
- Recent runs: see system_incidents row, sweep_evidence_run_ids
- Heuristic that fired: empty_output_baseline_aware (confidence 0.78)
  defined in server/services/systemMonitor/heuristics/agentQuality.ts:34
- Baseline median output for this agent: 1,247 chars (this run: 0 chars)>

## Hypothesis
<One paragraph. Best guess at root cause, with confidence stated.
Example: "Likely cause is the upstream Gmail connector returning an
empty thread payload — see connector_configs row id 'gmail-default'
where lastSyncError contained 'rate-limited' 8 minutes before this
run. Confidence: medium. Alternative hypothesis: a recent change to
the email-summary skill prompt (commit hash if known); see
git log -- server/skills/emailSummary.ts.">

## Investigation steps
<Numbered list. What Claude Code should do, in order. Each step concrete
enough to execute without follow-up clarification.
Example:
1. Read server/services/agentRunner.ts:140-180 for the empty-output
   handling.
2. Read server/skills/emailSummary.ts to verify prompt and tool calls.
3. Query agent_runs WHERE agent_id = '...' AND created_at > NOW() - INTERVAL '24 hours'
   — count how many produced empty output vs non-empty.
4. Check git log on server/skills/emailSummary.ts for changes in the last 7 days.>

## Scope
- In scope: server/skills/emailSummary.ts, server/services/agentRunner.ts (read), Gmail connector config (read).
- Out of scope: changes to system_incidents table, changes to the monitor agent itself, changes to RLS policies.

## Do not change without confirmation
<Optional. List of files or behaviours the operator should be asked
about before modifying. Example: "Do not modify the agent's system
prompt without explicit operator confirmation — the prompt is part of
the agent's tuned behaviour and changes affect all subaccounts using it.">

## Expected output
A diff or set of proposed changes. The operator (human in the loop)
will review and approve before merge. Do not commit or push without
approval.

## Approval gate
The user (operator) must explicitly approve any code change before it
is committed.
```

**Required sections** — Protocol, Incident, Problem statement, Evidence, Hypothesis, Investigation steps, Scope, Expected output, Approval gate.
**Optional section** — Do not change without confirmation.
**Forbidden** — anything that instructs Claude Code to commit, push, deploy, or merge without explicit operator approval.

The agent's prompt-authoring system prompt (§9.7) carries this template verbatim and is instructed to fill in each section. Empty sections are explicitly disallowed — the agent must either provide content or state `(none — see Hypothesis)`.

### 5.3 `CLAUDE.md` hook

A new section is added to `CLAUDE.md` (in this repo) under a clearly identifiable heading:

```markdown
## Investigate-Fix Protocol

When given a prompt that begins with `# Investigate-Fix Request`, the prompt
follows the contract defined in `docs/investigate-fix-protocol.md`. Read
that document, then:

1. Treat the `## Scope` section as authoritative — do not modify files
   outside it without explicit user approval.
2. Treat the `## Do not change without confirmation` list as a hard gate.
3. Execute `## Investigation steps` in order. If a step is impossible,
   stop and report — do not improvise.
4. Produce proposed changes for user review per `## Expected output`.
   Do not commit, push, deploy, or merge without explicit user approval.
5. If the incident's hypothesis is wrong, report what you found and stop —
   do not pursue an unbounded investigation.

Iterating on the protocol itself: see the document. Update it when new
patterns emerge.
```

This is **the** integration point. No code change. No skill. Just instruction text in `CLAUDE.md` that every Claude Code session in this repo will read.

### 5.4 Authoring instructions consumed by the monitor agent

The agent's system prompt (built in §9.7) includes:

- A copy of the §5.2 template structure.
- The list of required sections.
- The "forbidden" content list.
- A specific example of a well-formed prompt (one short worked example, anonymised).
- Instructions to **always** include `file:line` references when the evidence supports it; **never** fabricate file paths or line numbers; if the evidence is purely behavioural (e.g. a job that didn't run), use a stable resource identifier (`pgboss.job.id`, `agent_runs.id`, etc.) instead.
- Instructions on length: **target 400-800 tokens per prompt**, hard cap 1,500. Above the hard cap, the agent must trim Evidence or Investigation Steps and note that it did so.
- Instructions on humility: hypothesis is always stated with confidence; if confidence is `low`, the agent must say so and recommend the operator investigate before assuming the hypothesis is correct.

### 5.5 Iteration loop / feedback signal

The protocol is a **living document**. It will be wrong on day one. Iteration is the point.

**Inputs to iteration:**

- The `prompt_was_useful: bool` + `prompt_feedback_text` fields on `system_incidents` (§4.5, §11).
- The `investigate_prompt_outcome` event log (§11.2).
- Operator-side observations: which prompts led to one-shot fixes, which led to operator rewriting the prompt, which led to wrong-direction investigations.

**Iteration cadence:** weekly review of the prior week's prompts + outcomes. Adjustments land as edits to `docs/investigate-fix-protocol.md`. Each edit is a normal commit with a clear message — protocol drift is observable from git log.

**When the agent's prompts consistently lead to one-shot fixes operators accept without rewriting**, that is the signal Phase 3 (auto-fix) is on solid ground. The protocol holds; the agent's diagnosis quality has stabilised; the auto-fix executor can be pointed at the same contract. There is no formal "auto-fix gate" threshold in this spec — Phase 3 is its own design exercise — but the feedback data accumulated here is the input to that decision.

## 6. Heuristic Registry (config-as-code)

### 6.1 Module location and shape

**Location.** `server/services/systemMonitor/heuristics/` (final path TBD by architect).

**Shape.** Config-as-code, not a DB table. Each heuristic is a TypeScript module exporting a single object that conforms to the `Heuristic` interface (§6.2). A central `index.ts` collects all heuristics into a registry array. The registry is loaded at process start; reload requires deploy. This is intentional — heuristic churn aligns with deploy cadence, and DB-backed flexibility is unnecessary at this scale.

**Why config-as-code.**

- **Version controlled.** Every heuristic change is a normal git commit, reviewable in a PR.
- **Type-safe.** The compiler enforces the interface contract; mismatched metadata is a build failure, not a runtime surprise.
- **Testable.** Each heuristic ships with positive + negative unit tests in the same module file.
- **No admin UI dependency.** No new page, no permission grants, no new mutation routes.
- **Migrate when tuning frequency exceeds deploy frequency.** Today they're roughly equivalent (~weekly). Promote to DB only when "I want to tune this without a deploy" becomes a recurring need.

**Module layout** (illustrative, final paths by architect):

```
server/services/systemMonitor/heuristics/
  index.ts                            # registry array, public API
  types.ts                            # Heuristic, HeuristicResult, HeuristicContext
  agentQuality/
    emptyOutputBaselineAware.ts
    maxTurnsHit.ts
    toolSuccessButFailureLanguage.ts
    runtimeAnomaly.ts
    tokenAnomaly.ts
    repeatedSkillInvocation.ts
    identicalOutputDifferentInputs.ts
    outputTruncation.ts
    finalMessageNotAssistant.ts
  skillExecution/
    toolOutputSchemaMismatch.ts
    skillLatencyAnomaly.ts
    toolFailedButAgentClaimedSuccess.ts
  infrastructure/
    jobCompletedNoSideEffect.ts        # critical-class
    connectorEmptyResponseRepeated.ts
    cacheHitRateDegradation.ts          # Phase 2.5
    latencyCreep.ts                     # Phase 2.5
    retryRateIncrease.ts                # Phase 2.5
    authRefreshSpike.ts                 # Phase 2.5
    llmFallbackUnexpected.ts            # Phase 2.5
  systemic/
    successRateDegradationTrend.ts      # Phase 2.5
    outputEntropyCollapse.ts            # Phase 2.5
    toolSelectionDrift.ts               # Phase 2.5
    costPerOutcomeIncreasing.ts         # Phase 2.5
```

### 6.2 Heuristic interface

```ts
type Severity = 'low' | 'medium' | 'high' | 'critical';
type EntityKind = 'agent_run' | 'job' | 'skill_execution' | 'connector_poll' | 'llm_call';

interface BaselineRequirement {
  entityKind: EntityKind;
  metric: string;
  minSampleCount: number;          // e.g. 10
}

interface SuppressionRule {
  id: string;                       // unique within heuristic
  description: string;              // human-readable why
  predicate: (ctx: HeuristicContext, evidence: Evidence) => boolean;
  // returns true to suppress this fire
}

interface Heuristic {
  id: string;                       // stable, unique, kebab-case
  category: 'agent_quality' | 'skill_execution' | 'infrastructure' | 'systemic';
  phase: '2.0' | '2.5';             // ships in day-one or 2.5

  // Metadata wrapper — non-optional. False-positive fatigue protection.
  severity: Severity;               // default severity of incidents this raises
  confidence: number;               // 0..1, how confident we are when this fires (post-suppression)
  expectedFpRate: number;           // 0..1, calibrated estimate; tuned over time from heuristic_fires audit

  // Baseline gating. If any requirement fails, heuristic.evaluate returns 'insufficient_data'.
  requiresBaseline: BaselineRequirement[];

  // Suppression rules. Evaluated AFTER predicate fires. Any true → fire is dropped, audit row written.
  suppressions: SuppressionRule[];

  // Hot path. Returns one of:
  //   - { fired: false }
  //   - { fired: true, evidence: Evidence, confidence: number }
  //   - { fired: false, reason: 'insufficient_data' }
  evaluate(ctx: HeuristicContext, candidate: Candidate): Promise<HeuristicResult>;

  // Description rendered into the agent's evidence list when this fires.
  describe(evidence: Evidence): string;
}

interface HeuristicContext {
  baselines: BaselineReader;        // see §7.5
  db: Database;
  logger: Logger;
  now: Date;                        // injectable for tests
}

interface Candidate {
  // What's being evaluated. Shape per entityKind.
  // For sweep: an agent_run, a job, a skill_execution, etc.
  // For incident-driven: the incident itself + its source row.
  entityKind: EntityKind;
  entity: unknown;                  // typed per kind
}

type HeuristicResult =
  | { fired: false }
  | { fired: false; reason: 'insufficient_data' | 'suppressed'; suppressionId?: string }
  | { fired: true; evidence: Evidence; confidence: number };
```

The `confidence` returned by `evaluate` may differ from the registry-level `confidence` — the latter is the **default** when the heuristic fires; the former is the **per-fire** value computed against the specific evidence. The downstream agent uses the per-fire confidence; the registry-level value is metadata for tuning.

### 6.3 Severity, confidence, expected FP rate, suppression

**Severity.** What severity the *incident* gets if this heuristic is the top-fired contributor. The agent may upgrade severity (multiple heuristics fired, evidence converges) but never downgrades below this floor.

**Confidence.** Two readings:

- **Registry default** (`Heuristic.confidence`): a calibrated estimate of how confident we are, on average, that a fire indicates a real issue. Initial values are author's-best-guess; tuned over time from audit data.
- **Per-fire** (`HeuristicResult.confidence`): the heuristic's actual confidence in this specific fire, computed against the evidence (e.g. "90% over 1-sample threshold" vs "5% over 1-sample threshold").

The agent only triages when at least one heuristic fires with per-fire confidence ≥ a runtime threshold (default 0.5, env-configurable via `SYSTEM_MONITOR_MIN_CONFIDENCE`).

**Expected FP rate** (`Heuristic.expectedFpRate`). Author's calibrated estimate of the false-positive rate, expressed as a fraction. Used for triage prioritisation: if two heuristics fire on the same candidate, the one with lower `expectedFpRate` weighs more heavily in the agent's evidence ranking. Also surfaced in the heuristic-fires audit dashboard (Phase 3) for empirical recalibration. Initial values are author's best estimate.

**Suppression rules.** Evaluated *after* the predicate fires but *before* the heuristic counts as fired. Each rule is a named predicate with a description. Examples:

- "Suppress if the run was a known-experimental subaccount" — for agents we know are unstable on purpose.
- "Suppress if the agent has fewer than 10 historical runs" — too thin a baseline to compare against.
- "Suppress if this is the first run of the day and the system was idle for >12h" — cold-start anomalies.

Suppressions are first-class: every suppressed fire writes a `system_monitor_heuristic_fires` row with `produced_incident_id = null` and `metadata.suppression_id` set, so we can see "this heuristic would have fired 50× this week, but 47 were suppressed by rule X" — that's signal that either the rule is right (the heuristic is too eager) or the rule is wrong (we're hiding a real pattern).

### 6.4 Registration and invocation

**Registration.** `index.ts` exports `const HEURISTICS: Heuristic[] = [...]`. New heuristic = new module + add to the array. The compiler validates the interface; an array cast is forbidden.

**Invocation paths:**

1. **Sweep.** `system-monitor-sweep` job iterates `HEURISTICS` over each candidate (agent runs, jobs, skill executions in the sweep window). For each `(heuristic, candidate)`:
   - Skip if `heuristic.phase` doesn't match the current `SYSTEM_MONITOR_HEURISTIC_PHASES` env (default `'2.0,2.5'`).
   - Skip if `heuristic.requiresBaseline` is unmet.
   - Call `heuristic.evaluate(ctx, candidate)`.
   - If fired and per-fire confidence ≥ threshold and not suppressed → write `system_monitor_heuristic_fires` row, accumulate evidence for this candidate.
   - At end of sweep, candidates with ≥1 high-confidence fire are queued for agent triage.

2. **Incident-driven.** When an incident opens with `severity >= medium`, the `system-monitor-triage` job runs the heuristic registry against the incident's source data (the row that produced the incident, plus its recent context). This re-scores the incident with a richer evidence list before the agent reads it.

3. **Phase 1 synthetic checks.** Synthetic checks are **separate** from the heuristic registry — they run on a different timescale (1-min tick), they detect absence-of-events, and their fire rate is much lower. They share the metadata wrapper concept (severity, confidence, etc.) but do not implement the `Heuristic` interface. Architect may unify if a clean abstraction emerges; default is two registries.

### 6.5 Configuration / tuning workflow

Tuning is a **PR**, not an admin UI form. Workflow:

1. Audit shows heuristic X has fired 200× this week with 180 marked suppressed-by-rule-Y. Operator inspects the 20 unsuppressed fires.
2. Of the 20: 15 led to operator-approved fixes, 5 were noise.
3. Operator (or developer) opens a PR that either:
   - Tightens rule Y to allow fewer suppressions if the suppressions were wrong.
   - Adjusts heuristic X's `expectedFpRate` from 0.30 to 0.25 to reflect actual data.
   - Adjusts heuristic X's predicate (e.g. raise the multiplier from 5× to 7×) if the noise pattern is consistent.
4. PR includes the audit data as evidence; reviewer can see why the change is justified.
5. Merge → deploy → next sweep applies the new behaviour.

For the initial release, all tuning runs through this workflow. Phase 3 may add a runtime override table for emergency suppression (e.g. "disable heuristic X immediately, fix tomorrow") — explicitly out of scope for this spec.

## 7. Baselining primitive

The baselining primitive is the **substrate** under most heuristics. Without it, "5× p95" reduces to "5× a magic number". Building it once, well, prevents heuristic-by-heuristic reinvention.

### 7.1 What gets baselined

For each `(entity_kind, entity_id, metric_name)` triple, we maintain a current rolling baseline.

**Entity kinds and their natural keys:**

| `entity_kind` | `entity_id` source | Examples |
|---|---|---|
| `agent` | `agents.slug` | `portfolio-health-agent`, `orchestrator`, `system_monitor` |
| `skill` | `skills.id` (uuid) | uuid of each registered skill |
| `connector` | `connector_configs.provider_type` + `:` + `connector_configs.id` | `gmail:abc-123` |
| `job_queue` | pg-boss queue name | `connector-polling-sync`, `system-monitor-sweep` |
| `llm_router` | model identifier | `claude-opus-4-7`, `claude-sonnet-4-6` |

**Metrics** (per kind — not all metrics apply to all kinds):

| Metric | Applies to | Definition |
|---|---|---|
| `runtime_ms` | agent, skill, job_queue, connector | Wall-clock duration of one execution |
| `token_count_input` | agent, llm_router | Input tokens per call |
| `token_count_output` | agent, llm_router | Output tokens per call |
| `output_length_chars` | agent, skill | Length of final output text |
| `skill_invocation_count` | agent | Number of skill calls per agent run |
| `tool_latency_ms` | skill | Per-tool-call latency within a skill |
| `cache_hit_rate` | llm_router | Fraction of calls that hit cache |
| `success_rate` | agent, skill, connector, job_queue | Successful executions / total |
| `retry_count` | agent, skill, job_queue | Retries per execution |

Phase 2.5 adds derived metrics (ratios, deltas) — those compose existing ones, not net-new baseline columns.

### 7.2 Storage choice

**Persistent table** `system_monitor_baselines` (defined in §4.5), one row per `(entity_kind, entity_id, metric_name)`, holding the **current** rolling-window stats.

**Why persistent.**

- Survives process restart — heuristics work immediately on cold-start, no warm-up period.
- Cross-process consistent — pg-boss workers, sweep job, incident-triage job all see the same baselines.
- Cheap to read — single indexed lookup per (entity, metric).

**Why not in-memory.** Every process restart would erase baselines, leading to a "everything looks anomalous after deploy" failure mode.

**Why no history table in this spec.** Cross-run / drift detection (Phase 2.5) currently reads only the **current** baseline against per-run observed values. Drift-over-time detection (output entropy collapse, cost per outcome increasing) reads agent-run rows directly via a time-bucketed query, not from baseline history. A `system_monitor_baselines_history` table is a Phase 3 addition — not built now.

### 7.3 Refresh job

**Job:** `system-monitor-baselines-refresh` pg-boss job.

**Cadence:** every 15 minutes. Configurable via `SYSTEM_MONITOR_BASELINE_REFRESH_INTERVAL_MINUTES`.

**Window:** rolling 7 days. Configurable via `SYSTEM_MONITOR_BASELINE_WINDOW_DAYS`.

**Algorithm (per `(entity_kind, entity_id, metric_name)`):**

1. SELECT raw observations from the relevant source table (`agent_runs`, `skill_executions`, `pgboss.archive`, `connector_polls`, `llm_router_calls` — exact tables resolved by architect against current schema) WHERE `created_at >= NOW() - INTERVAL '7 days'`.
2. Compute `count`, `p50`, `p95`, `p99`, `mean`, `stddev`, `min`, `max`.
3. UPSERT into `system_monitor_baselines` keyed on `(entity_kind, entity_id, metric_name)`.

**Cost.** Roughly N entities × M metrics × one aggregate query each. For ~50 agents, ~30 skills, ~10 connectors, ~5 queues, ~3 LLM router models with ~9 metrics, that's ~900 indexed aggregate queries every 15 minutes. Acceptable. Optimisation (single multi-aggregate query per source table) is an architect decision, not a spec requirement.

**Idempotency.** UPSERT is naturally idempotent. A failed refresh leaves the prior baseline in place — heuristics keep using stale-but-valid data until the next refresh succeeds.

**Kill switch.** `SYSTEM_MONITOR_BASELINE_REFRESH_ENABLED` (default `true`). When off, baselines freeze in place. Heuristics continue to read them.

### 7.4 Bootstrap requirement (N≥10)

**The cold-start problem.** A new agent has 0 historical runs. A heuristic that says "5× p95" has nothing to compare against. Naïve fallback (use a hardcoded threshold, or fire on the first anomaly) generates false-positive storms on day one of any deploy that introduces a new agent.

**Solution.** Every heuristic that depends on a baseline declares its requirement via `requiresBaseline: BaselineRequirement[]` (§6.2). Each requirement names an entity kind, a metric, and a `minSampleCount`. Default `minSampleCount` is 10. Architects may set higher minimums for high-variance metrics (e.g. token counts on first generation might need 30 samples).

**At evaluation time:**

```ts
for (const req of heuristic.requiresBaseline) {
  const baseline = await ctx.baselines.get(req.entityKind, entity.id, req.metric);
  if (!baseline || baseline.sample_count < req.minSampleCount) {
    return { fired: false, reason: 'insufficient_data' };
  }
}
```

**Effect.** A new agent with 3 runs sees its baseline-dependent heuristics return `insufficient_data` — they no-op silently. The heuristic-fires audit captures the no-op for visibility. By the time the agent has 10+ runs, baseline-dependent heuristics activate.

**Heuristics that do NOT require a baseline.** Several day-one heuristics are baseline-free — they detect categorical conditions (e.g. `max_turns` reached, final message is a tool message, tool returned success but text says "I couldn't"). These fire on the first occurrence regardless of sample size.

### 7.5 Read API for heuristics

```ts
interface BaselineReader {
  get(
    entityKind: EntityKind,
    entityId: string,
    metric: string,
  ): Promise<Baseline | null>;

  // Convenience wrapper that returns null if sample_count < min, instead of returning a thin baseline.
  getOrNull(
    entityKind: EntityKind,
    entityId: string,
    metric: string,
    minSampleCount: number,
  ): Promise<Baseline | null>;
}

interface Baseline {
  entityKind: EntityKind;
  entityId: string;
  metric: string;
  windowStart: Date;
  windowEnd: Date;
  sampleCount: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  stddev: number;
  min: number;
  max: number;
}
```

The reader is **read-only**, **hot-path**, **no caching** beyond the connection-pool query cache. The baselines table is small (low thousands of rows) and indexed on the natural key — single-query reads are fast.

**No write API.** Baselines are written exclusively by the refresh job. Heuristics cannot mutate them.

## 8. Phase 1 — Synthetic checks

### 8.1 Job: `system-monitor-synthetic-checks`

**Job name** (kebab-case per `phase-0-spec.md §0.6`): `system-monitor-synthetic-checks`.

**Tick:** every 60 seconds via pg-boss schedule. Configurable via `SYSTEM_MONITOR_SYNTHETIC_CHECK_INTERVAL_SECONDS`.

**Handler shape:**

```ts
bossHandler('system-monitor-synthetic-checks', async (job) => {
  return withSystemPrincipal(async (ctx) => {
    if (!isEnabled('SYNTHETIC_CHECKS_ENABLED')) return;
    for (const check of SYNTHETIC_CHECKS) {
      try {
        const result = await check.run(ctx);
        if (result.fired) {
          await recordIncident({
            source: 'synthetic',
            severity: result.severity,
            fingerprintOverride: `synthetic:${check.id}:${result.resourceKind}:${result.resourceId}`,
            summary: result.summary,
            classification: 'system_fault',
            metadata: { checkId: check.id, ...result.metadata },
            idempotencyKey: `synthetic:${check.id}:${result.resourceId}:${result.bucketKey}`,
          });
        }
      } catch (err) {
        ctx.logger.error('synthetic-check-failed', { checkId: check.id, err });
        // do not throw — one bad check should not break the tick
      }
    }
  });
});
```

**Run time budget:** 30 seconds total per tick. Each check internally caps at 5s; checks that exceed time out and log a warning. The job does not run two ticks in parallel — pg-boss `singletonKey: 'synthetic-checks'`.

**Error isolation:** one check throwing does not abort the tick. The handler logs and continues.

### 8.2 Day-one checks

Each check is a TypeScript module under `server/services/systemMonitor/synthetic/` (final paths by architect). Each exports:

```ts
interface SyntheticCheck {
  id: string;
  description: string;
  defaultSeverity: Severity;
  run(ctx: HeuristicContext): Promise<SyntheticResult>;
}

type SyntheticResult =
  | { fired: false }
  | {
      fired: true;
      severity: Severity;
      resourceKind: string;
      resourceId: string;
      summary: string;
      bucketKey: string;            // for idempotency window — e.g. "2026-04-25T14:30" (15-min bucket)
      metadata: Record<string, unknown>;
    };
```

**Day-one set:**

| ID | Description | Default severity | Logic |
|---|---|---|---|
| `pg-boss-queue-stalled` | A pg-boss queue has not progressed in N minutes despite having pending jobs. | `high` | For each active queue: if `pending_count > 0` AND `last_completed_at` is older than `STALL_THRESHOLD_MINUTES` (default 5), fire. |
| `no-agent-runs-in-window` | A system-managed agent has not run in N minutes despite being scheduled / on-demand-eligible. | `medium` | For each `isSystemManaged=true` agent that has a typical run cadence: if `MAX(agent_runs.created_at) < NOW() - threshold`, fire. Threshold per agent. |
| `connector-poll-stale` | A connector configured for polling has not reported a successful poll in N minutes. | `medium` | For each connector with `polling_enabled=true`: if `last_successful_poll_at < NOW() - polling_interval × 3`, fire. |
| `dlq-not-drained` | The pg-boss DLQ has unhandled rows older than N minutes. | `high` | If `SELECT count(*) FROM pgboss.archive WHERE state = 'failed' AND last_error_at < NOW() - INTERVAL '30 minutes'` > 0, fire. (The DLQ ingestion already creates incidents per failure; this is the meta-signal that the DLQ itself isn't being drained.) |
| `heartbeat-self` | The synthetic-check job records its own heartbeat to a known KV. If the heartbeat hasn't been updated in N minutes when read, fire on next tick. | `critical` | Two-tick design: tick 1 writes `last_heartbeat = NOW()` to `system_kv`. Tick 2 reads it; if older than 3× tick interval, fire. (Detects "the synthetic-check job is itself broken" — closes the meta-loop.) |
| `connector-error-rate-elevated` | A connector has produced > N errors in the last hour without a successful poll between them. | `high` | For each connector: if `connector_polls WHERE error IS NOT NULL AND created_at > NOW() - 1h` count ≥ 3 AND no successful poll in same window, fire. |
| `agent-run-success-rate-low` | A system-managed agent's success rate over the last hour is below baseline minus 30%. | `medium` | Read baseline `success_rate` for the agent; if last-hour rate is < `baseline.p50 - 0.30`, fire. Requires baseline (`requiresBaseline`); skips with `insufficient_data` if no baseline. |

Phase 2.5 may add more synthetic checks; this is the day-one set.

**Cold-start tolerance.** Every check that depends on baseline data degrades gracefully to `fired: false` when baseline is missing, with a `ctx.logger.info('synthetic-check-skipped-baseline')` line. No false positives on a fresh staging environment.

### 8.3 Incident shape (`source='synthetic'`)

Synthetic incidents follow the existing Phase 0 schema but with these conventions:

- `source = 'synthetic'`
- `fingerprintOverride` is **required** (not optional). Format: `synthetic:<check_id>:<resourceKind>:<resourceId>`. Example: `synthetic:pg-boss-queue-stalled:queue:connector-polling-sync`.
- `idempotencyKey` set per check using a time-bucket (e.g. 15-minute bucket) so a stalled queue doesn't produce 15 incidents in 15 minutes — instead, one incident with a rising `occurrence_count` reflecting the persistence.
- `classification = 'system_fault'` always. Synthetic checks never fire on user-fault conditions.
- `severity` per check default; can be elevated by check logic (e.g. queue stalled for 30+ min escalates from `high` to `critical`).
- `metadata` includes `checkId`, the resource identifiers, and any check-specific evidence.
- `affected_resource_*` columns populated where the check identifies a specific resource.

Synthetic incidents are **first-class** in the existing UI — they appear on the system incidents page just like reactive ones, with `source='synthetic'` filterable. The triage drawer renders them identically; the agent (Phase 2) triages them just like reactive ones.

**Self-recursion guard.** The `heartbeat-self` check fires incidents with `source='synthetic'` AND `metadata.isSelfCheck=true`. Phase 2's incident-driven trigger explicitly excludes incidents where `metadata.isSelfCheck=true` from auto-triage to prevent the agent triaging its own dead heartbeat (which would be a recursion loop).

### 8.4 Configuration

| Env var | Default | Purpose |
|---|---|---|
| `SYNTHETIC_CHECKS_ENABLED` | `true` | Master kill switch. |
| `SYSTEM_MONITOR_SYNTHETIC_CHECK_INTERVAL_SECONDS` | `60` | Tick interval. |
| `SYSTEM_MONITOR_QUEUE_STALL_THRESHOLD_MINUTES` | `5` | `pg-boss-queue-stalled` threshold. |
| `SYSTEM_MONITOR_CONNECTOR_STALE_MULTIPLIER` | `3` | `connector-poll-stale` multiplier on the connector's own polling interval. |
| `SYSTEM_MONITOR_DLQ_STALE_THRESHOLD_MINUTES` | `30` | `dlq-not-drained` threshold. |
| `SYSTEM_MONITOR_HEARTBEAT_STALE_TICKS` | `3` | `heartbeat-self` tolerance in ticks. |
| `SYSTEM_MONITOR_AGENT_INACTIVITY_THRESHOLDS_JSON` | `'{}'` | Per-agent inactivity thresholds for `no-agent-runs-in-window`. JSON map of `{agentSlug: minutes}`. |

Per-check enable/disable is via heuristic-style suppression, not env vars — keeps the env surface minimal.

## 9. Phase 2 — Monitor agent (day-one + 2.5)

Phase 2 is the actual deliverable. Phase A built the substrate; Phase 1 generates volume; Phase 2 reads everything and produces the diagnosis + paste-ready prompt the operator works from.

### 9.1 Agent definition (`system_monitor`)

**Pattern.** Follows the existing system-managed agent precedent — Orchestrator (migration 0157) and Portfolio Health Agent (migration 0068). Same `agents` row shape, same `isSystemManaged=true` flag, same lifecycle.

**Seed migration.** A single `INSERT INTO agents (...)` row, idempotent via `ON CONFLICT (slug) DO NOTHING`. Lives in the same migration as the §4.6 schema additions (one migration for the whole Phase A surface, including this row).

**Row shape (verbatim values that ship in the seed):**

| Column | Value | Why |
|---|---|---|
| `slug` | `system_monitor` | Stable identifier; matches env-var prefix and queue-name prefix. |
| `name` | `System Monitor` | Display name in the few admin surfaces that render it (agent list, run logs). |
| `description` | `Watches every agent run, job-completed transition, and skill execution. Flags errors and soft-fail signals. Emits a paste-ready Investigate-Fix prompt per incident. Diagnosis-only — no remediation actions.` | Set once; not iterated weekly. |
| `is_system_managed` | `true` | Excludes from non-sysadmin agent listings; routes through system-principal context. |
| `scope` | `system` | New scope value introduced in §4.3. Distinct from `org` (Portfolio Health) and `subaccount` (user-created agents). |
| `organisation_id` | `SYSTEM_OPERATIONS_ORG_ID` | The system org seeded by Phase 0/0.5. Mirrors Orchestrator. |
| `subaccount_id` | The sentinel subaccount under System Operations | Mirrors Orchestrator. |
| `model` | `claude-opus-4-7` (default) | Diagnosis quality matters more than per-run cost; cost lever is the rate limit (§9.9), not the model tier. Configurable via `SYSTEM_MONITOR_MODEL` env var. |
| `system_prompt` | The Investigate-Fix Protocol authoring instructions (§9.7) | Stored on the row, not in code. Tunable without redeploy. |
| `tools` (or equivalent skill-binding column) | The diagnosis-only skill set (§9.4) | No `destructiveHint: true` skills. Hard contract. |
| `enabled` | `true` | Default on after migration. Kill switch is `SYSTEM_MONITOR_ENABLED` (§9.10), not the row flag. |
| `created_at` | `NOW()` | Standard. |

**Why not a config file.** The agent definition lives in the database because (a) the existing system-managed agent infrastructure expects it there, (b) the system prompt is long and benefits from editor tooling not available in migration files, and (c) tuning the system prompt without a redeploy becomes possible later if we ship a sysadmin "edit system-managed agent prompt" surface. The seed migration is the source of truth for v1; subsequent edits land via separate migrations or an admin route — not by re-running the seed.

**Permissions.** The agent inherits the system-principal scope (§4.3). It can read every table the system principal has been granted; for Phase 2 that is: `system_incidents`, `system_incident_events`, `system_monitor_baselines`, `system_monitor_heuristic_fires`, `agent_runs` (read-only), `pgboss.job` (read-only), `pgboss.archive` (read-only), `connector_polls` (read-only), `skill_executions` (read-only), `llm_router_calls` (read-only). It can write to `system_incidents` (only the diagnosis columns from §4.5) and `system_incident_events` (only event types it owns — §12.1). It cannot write to anything else; the service-layer guard (§4.4) plus RLS enforce this.

**No subaccount, no org-level visibility.** Operators see this agent in the system-admin agent list (if such a list exists or is added) but never in the per-subaccount or per-org agent views.

### 9.2 Triggers — incident-driven + sweep

Two triggers, by design. Each catches a class of failure the other misses.

**Trigger 1 — incident-driven.**

When an incident is opened (`system_incident_events` row of type `incident_opened`), the ingestor fires-and-forgets a `system-monitor-triage(incidentId)` pg-boss job. The job is enqueued **synchronously inside the same transaction** that wrote the event row, using the outbox pattern (`phase-0-spec.md §5.8.1` async-mode discussion) — same connection pool, transactional `pgboss.send` inside the Drizzle tx. If the tx rolls back, the enqueue rolls back with it; no phantom triage jobs.

Conditions for enqueueing:

- `incident.severity >= medium` (low-severity incidents do not auto-triage; operator can manually escalate per Phase 0/0.5).
- `incident.source != 'self_check'` AND `incident.metadata.isSelfCheck != true` (avoid triaging the monitor's own dead-heartbeat — recursion loop).
- `incident.triage_attempt_count < SYSTEM_MONITOR_MAX_TRIAGE_PER_FINGERPRINT` (rate limit, §9.9).
- `SYSTEM_MONITOR_ENABLED == true` (kill switch).

If any condition fails, no job is enqueued; the failure reason is logged with `incident.id` for audit. No `incident_events` row is written for the no-enqueue case — that would generate noise; the audit log is sufficient.

**Trigger 2 — sweep.**

A `system-monitor-sweep` pg-boss job runs every 5 minutes. Its purpose: catch **soft-fail** signals — runs that completed successfully but produced anomalous output, jobs that finished without their expected side effect, skill executions that returned the wrong shape. The reactive ingest hooks miss all of these because no error fires.

The sweep job is described in detail in §9.3.

**Why both, not one.**

- Incident-driven covers known errors. The error already happened; the question is what to do about it. Triaging immediately keeps the operator's working memory aligned with the incident's freshness.
- Sweep covers degraded-correctness signals on runs that did not error. These never produce an incident from the reactive path — only the sweep can see them. Phase 1 synthetic checks cover absence-of-events; Phase 2 sweep covers presence-of-degraded-events.

A single trigger covering both classes would either run too often (every state transition) or too rarely (catch errors but miss soft fails). Two triggers, each scoped to its class, is cleaner.

**Idempotency.** Both jobs use pg-boss `singletonKey`:

- `system-monitor-triage`: singleton per `incidentId`. Two enqueues for the same incident collapse to one.
- `system-monitor-sweep`: singleton per `bucketKey` (15-min window). Two enqueues for the same window collapse to one.

This means a transient pg-boss queue glitch that re-enqueues a triage cannot produce duplicate triage runs.

### 9.3 Sweep job (`system-monitor-sweep`)

**Job name:** `system-monitor-sweep` (kebab-case per `phase-0-spec.md §0.6`).

**Tick:** every 5 minutes via pg-boss schedule. Configurable via `SYSTEM_MONITOR_SWEEP_INTERVAL_MINUTES`.

**Window:** rolling 15 minutes. The window overlaps adjacent ticks by 10 minutes intentionally — a degraded run completing right at a tick boundary should not be missed. Heuristic fires are deduplicated via the `system_monitor_heuristic_fires` audit table (§4.5) and the per-fingerprint throttle (§4.2), so window overlap does not produce duplicate incidents.

**Two-pass design.** This is the load-bearing performance decision (Q8 §0.2). Without it, every sweep would deep-read every run in the window — token cost and runtime would blow up on busy days.

- **Pass 1 — cheap pre-pass.** Iterate the heuristic registry (§6) over each candidate (agent runs, jobs, skill executions, llm calls in the window). Each heuristic's `evaluate` reads only summary fields — `runtime_ms`, `output_length_chars`, `success`, `final_message_role`, etc. — plus the baseline reader (§7.5). No full payloads loaded; no LLM calls. Aim: ≤200 ms per candidate, ≤30 s total per tick.
- **Pass 2 — deep-read on fire.** Candidates with ≥1 high-confidence fire (per-fire confidence ≥ `SYSTEM_MONITOR_MIN_CONFIDENCE`, default 0.5) are escalated to deep-read: full agent-run payload, full skill-execution input/output, full message history. This is the expensive pass; the pre-pass is the gate that keeps it bounded.

**Input cap (Q8 §0.2).** Hard ceiling per sweep:

- Max 50 candidates accepted into Pass 2, OR
- Max 200 KB of total log payload across deep-reads, whichever hits first.

If the pre-pass identifies more than 50 candidates as triage-worthy, the sweep takes the top-50 by per-fire confidence and emits a `sweep_capped` event for the rest. The capped candidates are not lost — they will be re-evaluated on the next sweep, and the `sweep_capped` event itself is a signal worth surfacing on a sysadmin dashboard (Phase 3).

**Sweep handler shape:**

```ts
bossHandler('system-monitor-sweep', async (job) => {
  return withSystemPrincipal(async (ctx) => {
    if (!isEnabled('SYSTEM_MONITOR_ENABLED')) return;
    const window = computeSweepWindow(ctx.now);
    const candidates = await loadCandidates(ctx, window);  // summary fields only
    const fires: HeuristicFire[] = [];
    for (const candidate of candidates) {
      for (const heuristic of HEURISTICS) {
        if (!matchesPhase(heuristic)) continue;
        const result = await heuristic.evaluate(ctx, candidate);
        if (result.fired && result.confidence >= MIN_CONFIDENCE) {
          await writeHeuristicFireRow(ctx, heuristic, candidate, result);
          fires.push({ heuristic, candidate, result });
        } else if (result.fired === false && 'reason' in result) {
          await writeHeuristicFireRow(ctx, heuristic, candidate, result);  // audit suppressed/insufficient
        }
      }
    }
    const triagable = selectTopForTriage(fires, INPUT_CAP);
    for (const cluster of triagable) {
      await enqueueTriage(ctx, cluster);
    }
    if (fires.length > triagable.length) {
      await writeSweepCappedEvent(ctx, fires.length - triagable.length);
    }
  });
});
```

**Clustering.** Multiple heuristics firing on the same candidate produce a single triage invocation, not one per heuristic. The agent receives the cluster — list of fires plus the candidate — as one piece of evidence. This is what makes "five symptoms of one underlying cause" appear as one diagnosis, not five.

**Idempotency.** Each triage enqueue carries an `idempotencyKey` of `sweep:<candidateKind>:<candidateId>:<bucketKey>`. Two sweeps that converge on the same candidate within the same bucket collapse to one triage run.

**Failure isolation.** A heuristic throwing in `evaluate` is logged and skipped. The sweep does not abort. A bad heuristic in the registry cannot break the sweep for all heuristics.

**Partial-success contract.** A sweep tick is a multi-step batch — N candidates × M heuristics. Partial outcomes are normal, not exceptional. The structured result of every tick is:

```ts
type SweepResult = {
  status: 'success' | 'partial_success' | 'failure';
  window: { start: Date; end: Date };
  candidates_evaluated: number;
  heuristics_evaluated: number;
  fired: HeuristicFire[];          // per-fire structured records
  suppressed: HeuristicFire[];     // suppression-rule blocked
  insufficient_data: HeuristicFire[]; // baseline gating skipped
  errored: { heuristic_id: string; candidate_id: string; err: string }[];
  triages_enqueued: number;        // collapsed by clustering
  capped: { excess_count: number; cap_kind: 'candidate' | 'payload' } | null;
  duration_ms: number;
};
```

Returned from the handler, written to the structured log as the `sweep_completed` event (§12.1).

**Status values:**

- `success` — every (heuristic, candidate) pair completed (fired, suppressed, insufficient-data, or no-fire). No errors. Cap not hit.
- `partial_success` — at least one heuristic errored (`errored.length > 0`) OR the input cap was hit (`capped != null`). Successful fires still propagate to triage; errored pairs are skipped on this tick and will re-evaluate on the next.
- `failure` — the handler itself threw (e.g. `loadCandidates` failed). No fires propagate. pg-boss retries.

**Retry eligibility:** `success` and `partial_success` are NOT retried — they completed (with the partial caveat for the latter). `failure` is retried by pg-boss up to its retry limit; after exhaustion the job lands in DLQ and the synthetic-check `dlq-not-drained` (§8.2) catches the persistence.

**Per-pair retryability is structural, not a payload field.** The `errored` array does not classify each failed `(heuristic, candidate)` pair as `retryable` vs `non_retryable`. The classification is structural: errored pairs retry implicitly via the next 5-min tick's overlapping window. Adding a per-pair `retryable` boolean would be misleading because every errored pair is structurally retryable on the next tick by construction. The only way a pair becomes "non-retryable" is via the upstream guardrails — the rate limit (§9.9) caps how often a fingerprint can re-trigger triage, the heuristic-fires audit row (§4.5) deduplicates same-tick fires, and the throttle (§4.2) bounds tight-loop ingest. There is no per-pair terminal-failure state at the sweep-result layer because the next tick is the natural retry surface.

**Downstream consumption.** The triage handler consumes the `fired` array — only fires propagate to triage. `errored`, `suppressed`, `insufficient_data` are audit-only; they land in `system_monitor_heuristic_fires` (§4.5) for tuning data but do not become incidents. `capped` is surfaced as a `sweep_capped` event for operator visibility.

**Idempotency under partial success.** A `partial_success` re-tick on the next 5-min cycle re-evaluates every candidate in the new (overlapping) window. Heuristic fires from the previous tick are deduplicated via the `system_monitor_heuristic_fires` audit row + per-fingerprint throttle (§4.2) — a candidate that fired heuristic X in tick 1 and fires it again in tick 2 produces one incident, not two.

The same partial-success contract applies to the **synthetic-check tick** (§8.1). Each tick runs N checks; one check failing does not abort the others; the tick handler returns a structured `SyntheticTickResult` with the same shape (`fired`, `errored`, `duration_ms`, `status`).

### 9.4 Diagnosis-only skills

The agent's tool set is **read-only**. This is the architectural hard line that separates Phase 2 from Phase 3. No skill in this set takes a side effect outside the diagnosis columns of the incident row the agent is currently triaging.

**Day-one skill set:**

| Skill ID | Reads | Returns | Why |
|---|---|---|---|
| `read_incident` | `system_incidents` row by id | full row + recent events | Anchor — the agent always starts here. |
| `read_agent_run` | `agent_runs` row by id | run row + message history (capped at 50 messages or 100 KB) | Required for any agent-run-source incident or sweep cluster. |
| `read_skill_execution` | `skill_executions` row by id | execution row + input + output (capped) | Required for skill-source incidents. |
| `read_recent_runs_for_agent` | `agent_runs` filtered by `agent_id` and time window | recent runs (summary, capped at 20) | For "is this a repeated pattern" questions. |
| `read_baseline` | `system_monitor_baselines` row by `(entity_kind, entity_id, metric_name)` | the current baseline row | For "is this anomalous against history" questions. |
| `read_heuristic_fires` | `system_monitor_heuristic_fires` filtered by entity / window | recent fires (capped at 20) | For "what other heuristics flagged this entity recently" questions. |
| `read_connector_state` | `connector_configs` + `connector_polls` recent rows | config + last 10 polls | For connector-source incidents. |
| `read_dlq_recent` | `pgboss.archive` filtered to `state='failed'` and recent | last 20 failed jobs (summary) | For job-source / DLQ-source incidents. |
| `read_logs_for_correlation_id` | structured-log query by `correlationId` | matched log lines (capped at 200 lines or 100 KB) | For tracing a single failed request end-to-end. (Implementation note: depends on the log source — see `phase-0-spec.md §2.8` for the process-local rolling buffer; can be upgraded to a durable log store later.) |
| `write_diagnosis` | n/a | writes `agent_diagnosis` JSON, `agent_diagnosis_run_id`, and `investigate_prompt` text on the **incident currently being triaged** | The sole write skill. Locked to the `incidentId` passed at triage start. |
| `write_event` | n/a | appends `system_incident_events` row of an allowed type (`agent_diagnosis_added`, `agent_triage_skipped`, `prompt_generated`) | Audit trail of what the agent did. |

**What's deliberately missing:**

- No `update_incident_status`. Status changes belong to the operator. The agent annotates; it does not move the incident through the lifecycle.
- No `escalate_to_dev_agent`. Phase 4. The agent emits a prompt; the operator pastes it.
- No `retry_job`, `restart_connector`, `disable_flag`, `revoke_subaccount`. Phase 3 actions.
- No `create_pull_request`. Phase 4.
- No `read_user_data` or any tenant-scoped reads. The agent operates on system-scoped tables only.

**Skill registration.** Skills are registered in the existing skill catalogue with `destructiveHint: false` on every read skill, `destructiveHint: false` on `write_diagnosis` (it writes only to incident rows the agent owns and only to the four diagnosis columns), and `destructiveHint: false` on `write_event` (append-only). No skill in this set has `destructiveHint: true`. A pre-merge linter — added in Slice C — verifies the agent's bound skill set has no destructive skills; mismatch fails CI.

**Tool result size cap.** Every read skill enforces a per-call response cap (rows × max bytes). The cap is set per skill in §9.4 above; the agent's system prompt also tells it to summarise rather than re-fetch when a result is truncated.

### 9.5 Day-one heuristic set (Phase 2.0)

These heuristics ship in Slice C, before Phase 2.5. They are deliberately **categorical or single-baseline** — each one looks at one signal and answers one question. Cross-run / systemic heuristics are Phase 2.5 (§9.6).

Each heuristic's full metadata (severity, confidence, expectedFpRate, suppressions, requiresBaseline) lives in its module file; the table below summarises the firing condition and the reason it earns a slot in v1.

**Agent quality (read on every agent run, sweep + incident-driven):**

| ID | Fires when | Severity | Why it earns a v1 slot |
|---|---|---|---|
| `empty-output-baseline-aware` | Agent run completed successfully but `output_length_chars == 0` AND baseline `p50 > 200`. | medium | Empty output on an agent that normally produces text is the cleanest soft-fail signal we have. |
| `max-turns-hit` | `agent_runs.terminated_reason == 'max_turns'` (or equivalent). | medium | The agent ran out of budget mid-task; output is almost certainly incomplete. |
| `tool-success-but-failure-language` | Final assistant message contains a regex match for "I couldn't" / "I'm unable" / "failed to" / "I don't have access" AND the run is marked successful. | medium | Most-cited soft-fail in the agent-quality literature; cheap to detect. |
| `runtime-anomaly` | `runtime_ms > baseline.p95 * 5` AND `runtime_ms > absolute floor (1000 ms)`. | low | Catches slow runs without firing on tiny medians. The absolute floor avoids "5× a 50 ms baseline." |
| `token-anomaly` | `token_count_input + token_count_output > baseline.p95 * 3` AND token total > 5,000. | low | Flags runs that consumed wildly more context than usual — often indicates a prompt loop or stuck-on-retry. |
| `repeated-skill-invocation` | Same skill called > 5× in one run AND that skill's typical invocation count is ≤ 2. | low | Stuck loops where the agent calls the same tool repeatedly. |
| `final-message-not-assistant` | Last message in run is `tool` or `system`, not `assistant`. | medium | The agent terminated mid-tool-call — operator never received a coherent response. |
| `output-truncation` | Final message ends abruptly (no terminating punctuation, output length within 10% of model's max output) | low | Probable truncation; flags need-to-extend-max-tokens. |
| `identical-output-different-inputs` | Two runs of the same agent in the last hour produced identical output bytes despite different inputs. | medium | The agent is ignoring its input — either a prompt bug or a stuck cache. |

**Skill execution (read on every skill execution):**

| ID | Fires when | Severity | Why |
|---|---|---|---|
| `tool-output-schema-mismatch` | Skill returned a payload that fails its declared output schema. | medium | Catches schema drift at the connector or third-party API level before the agent consumes garbage. |
| `skill-latency-anomaly` | Skill `runtime_ms > baseline.p95 * 5` AND > 500 ms. | low | Skill-side analogue of runtime-anomaly; absolute floor prevents flapping on tiny medians. |
| `tool-failed-but-agent-claimed-success` | Skill returned an error but the assistant message after it claims the action succeeded. | high | The agent is confabulating success. Quality issue, possibly user-facing. |

**Infrastructure (read on every job / connector poll / llm call):**

| ID | Fires when | Severity | Why |
|---|---|---|---|
| `job-completed-no-side-effect` | A pg-boss job marked `completed` but its expected side effect (per a per-job manifest) is absent. | critical | The job system thinks it succeeded; reality says no. Highest-cost class of silent failure. |
| `connector-empty-response-repeated` | A connector returned an empty result set ≥ 3 times in 1 hour where its baseline median sample size is ≥ 1. | medium | Either upstream went silent or our query went wrong; both are worth investigating. |

**Total day-one count: 14 heuristics.** Calibrated to "high signal, low FP rate, cheap to evaluate." Each ships with a positive test (the heuristic fires on a synthetic example) and a negative test (it does not fire on a baseline-normal example).

**Per-heuristic suppression rules — examples:**

- `empty-output-baseline-aware` suppresses if the agent's `expected_outputs` schema declares an optional output (some agents legitimately produce empty output for "no-op" inputs).
- `max-turns-hit` suppresses if the run's input includes the metadata flag `max_turns_acceptable: true` (operator-marked acceptable cap).
- `runtime-anomaly` suppresses if the run is the first run for a newly-deployed agent version (cold-start).

Suppressions are calibrated against the audit data (§6.3) over the first month of production traffic, then iterated.

### 9.6 Phase 2.5 heuristic expansion (cross-run / systemic)

Phase 2.5 lands in the **same session as Phase 2.0** (Slice C → continuing into Slice D), once baseline data is sufficient. The expansion is layered onto the same registry — no breaking interface changes, no new code paths, just more `Heuristic` modules and more entries in the registry array.

**What Phase 2.5 adds:**

| ID | Fires when | Severity | Why this is 2.5 not 2.0 |
|---|---|---|---|
| `cache-hit-rate-degradation` | LLM router cache hit rate over the last 1h is below `baseline.p50 - 0.20` (absolute drop of 20 percentage points). | low | Requires baseline. Catches "we accidentally introduced unique tokens into a previously-cached prompt." |
| `latency-creep` | Agent or skill runtime p95 over the last 1h is > baseline p95 * 1.5 AND > baseline p95 + 500ms. | low | Slow drift is hard to see from a single run; needs windowed comparison. |
| `retry-rate-increase` | Job queue retry rate over the last 1h is > baseline p50 * 2 AND > 10 retries/h absolute. | medium | Often a precursor to a saturating queue; catches degradation before stall. |
| `auth-refresh-spike` | Connector auth-refresh rate over the last 1h is > baseline p95 * 3. | medium | Indicates token expiry storms or upstream auth instability. |
| `llm-fallback-unexpected` | LLM router fell back from primary to secondary model > 10× in 1h despite primary's baseline 5xx rate < 0.5%. | medium | Catches "primary is degraded but the router thinks it's fine" — usually a config or threshold misalignment. |
| `success-rate-degradation-trend` | Agent or skill success rate over the last 4h is trending down: linear-regression slope < -0.05/hour AND last-hour rate < baseline.p50 - 0.10. | high | The trend is the signal; a single dip is not enough. |
| `output-entropy-collapse` | Output text entropy (token-level Shannon entropy) over the last 1h is < baseline.p50 * 0.5. | medium | The agent is producing more repetitive output than usual — often a sign of prompt corruption or model degradation. (Computation cost: cheap if we sample; full computation only on fire.) |
| `tool-selection-drift` | An agent's tool-selection distribution over the last 1h diverges from its baseline distribution by KL divergence > threshold. | medium | The agent has changed how it decomposes problems. Often benign (new task mix), sometimes a regression. |
| `cost-per-outcome-increasing` | Tokens-per-successful-run for an agent over the last 4h is > baseline p95 * 1.5. | low | Flags "the agent is grinding more without producing better outputs" — useful for budget hygiene. |

**Total Phase 2.5 additions: 9 heuristics.** Combined day-one + 2.5: 23 heuristics.

**Why these are 2.5, not 2.0:**

- Each requires either a richer baseline (windowed trends) or cross-run aggregation that doesn't exist in 2.0's per-candidate evaluator.
- The pre-pass cost per candidate is higher — windowed reads vs single-row reads — so they only make sense after the 2.0 set has proved its FP profile and the budget has room.
- They benefit from real production data for FP-rate calibration. Shipping them on day one with author's-best-guess metadata produces noise; shipping them after 2.0 has accumulated `system_monitor_heuristic_fires` data lets us calibrate against reality.

**Shipping order inside the spec.** Slice C ships day-one (14 heuristics) end-to-end. Slice D ships Phase 2.5 (9 heuristics) plus the additional baseline metrics they require. Slice D is smaller because the registry, agent, sweep job, prompt template, and feedback loop all already exist.

### 9.7 Agent prompt template (Investigate-Fix Protocol consumer)

The agent's `system_prompt` (stored on the `agents` row) carries authoring instructions that produce prompts conforming to the Investigate-Fix Protocol (§5.2).

**Prompt structure (stored on the `agents.system_prompt` column):**

```
You are the System Monitor — a system-managed diagnostic agent. Your job is to
read evidence about a single incident or sweep cluster, form a diagnosis, and
emit a paste-ready Investigate-Fix prompt that a human operator will hand to a
local Claude Code session.

## Operating principles

1. You diagnose; you do not remediate. The skills available to you are read-
   only with two exceptions: `write_diagnosis` (writes to the incident row
   you are triaging) and `write_event` (appends an audit event). You have
   no other write access. If you find yourself wanting to take an action,
   describe it in the prompt for the human operator instead.

2. Be honest about uncertainty. If you cannot confidently identify a root
   cause, say so. State your confidence (low / medium / high) and your top
   alternative hypothesis.

3. Cite evidence. Every claim in your diagnosis must be backed by a specific
   read — a row id, a file:line reference, a baseline reading, a heuristic
   fire id. Never fabricate a file path or a line number. If you do not know
   a precise location, say "see <table_name>.<column_name>" or refer to the
   stable resource identifier.

4. Surface what you cannot see. If your evidence is thin (e.g. you read 5
   recent runs but the baseline window is 7 days), say so. Recommend the
   operator run additional queries.

## Output contract

Every triage produces exactly two artefacts via tools:

1. `write_diagnosis(incidentId, { hypothesis, evidence, confidence, generatedAt })`
   — your structured diagnosis. Hypothesis is one paragraph plain English.
   Evidence is an array of { type, ref, summary } objects. Confidence is
   "low" | "medium" | "high".

2. `write_diagnosis(incidentId, { investigatePrompt: <text> })` — the paste-
   ready prompt, conforming to the Investigate-Fix Protocol below. Note: in
   v1 these are stored in two columns on the same row but written via the
   same skill — one call, two fields.

You also write one `write_event` row of type `agent_diagnosis_added` with
`metadata.agent_run_id` set to your run id.

## Investigate-Fix Protocol

[Full §5.2 template inlined here — verbatim.]

## Required sections

- Protocol, Incident, Problem statement, Evidence, Hypothesis, Investigation
  steps, Scope, Expected output, Approval gate.

## Optional section

- Do not change without confirmation.

## Forbidden

- Any instruction that tells Claude Code to commit, push, deploy, or merge
  without explicit operator approval.
- Any "auto-fix" instruction. The operator approves; the operator commits.
- Any reference to skills, tools, or system-monitor agent internals — the
  prompt is for an investigator who knows the codebase but does not know
  this agent's internals.

## Length

- Target 400–800 tokens per prompt.
- Hard cap 1,500 tokens.
- If you exceed the hard cap, trim Evidence or Investigation steps and add
  a note that you trimmed.

## Worked example

[One short anonymised worked example included verbatim.]

## When in doubt

If your evidence is too thin to form a hypothesis, say so explicitly. Output
a prompt that says "Hypothesis: insufficient evidence" and asks Claude Code
to investigate fresh. This is acceptable; do not fabricate a hypothesis to
avoid an empty section.
```

**Why on the row, not in code.** The system prompt is iterated based on the feedback loop (§11). Storing it on the row enables tuning without redeploy once an admin "edit system-managed agent prompt" surface exists. For v1 the row value is set by migration; future updates land via additional migrations or a sysadmin-only mutation.

**Versioning.** The prompt itself is not versioned at runtime. Git history of the migration files is the version log. The Investigate-Fix Protocol doc (`docs/investigate-fix-protocol.md`) is also git-versioned. When the protocol changes meaningfully, both the doc and the agent's stored prompt update in the same commit.

### 9.8 `investigate_prompt` output contract

The agent calls `write_diagnosis(incidentId, { investigatePrompt: <text> })` once per triage. This populates `system_incidents.investigate_prompt` (§4.5).

**Validation at write time:**

- Required sections (§5.2) must all be present. Validation regex: header strings present in order. Missing → write rejected with a typed error; the agent retries (max 2 retries built into the agent's run loop); after 2 failures, the triage emits `agent_triage_failed` event with `reason='prompt_validation'` and the operator sees a triage-failed badge in the UI.
- Length: 200–6,000 chars (lower bound rejects truncated empty prompts; upper bound is ~1,500 tokens with margin).
- No instruction text matching the "forbidden" patterns (no "git push", no "merge to main", no "auto-deploy"). Pattern list in code.

**Idempotency.** `write_diagnosis` is idempotent on `(incidentId, agentRunId)`. The agent's own run loop will not call it twice; if the agent's process crashes mid-call and pg-boss retries, the second attempt is a no-op (the existing row already has the diagnosis). The audit event `agent_diagnosis_added` is also idempotent on `(incidentId, agentRunId)`.

**One prompt per incident.** Subsequent triages of the same incident (rate-limit allowing — §9.9) overwrite the prior diagnosis and prompt. The prior values are not preserved on the incident row; the audit trail is the `system_incident_events` log, which has the full history of `agent_diagnosis_added` rows.

**Schema versioning on agent-emitted JSON payloads.** Every agent-written JSON payload carries a `schema_version: 'v1'` field at the top level. Applies to:

- `system_incidents.agent_diagnosis` JSON: `{ schema_version: 'v1', hypothesis, evidence, confidence, generatedAt, agentRunId }`.
- `system_incident_events.metadata` for `agent_diagnosis_added`, `agent_triage_skipped`, `agent_triage_failed`, `prompt_generated`, `investigate_prompt_outcome`: each carries `schema_version: 'v1'` alongside the per-event fields documented in §12.1.

Why on every payload, not on the table: the JSON shape is the contract; tables outlive single shapes. A future Phase 3 enhancement (e.g. richer evidence types) bumps to `schema_version: 'v2'` while old rows stay readable. Consumers (UI render, downstream analytics) check `schema_version` at read time.

**No prompt-text version stamp.** The `investigate_prompt` text itself is markdown, not JSON. Its versioning is the `## Protocol` line at the top (`v1 (per docs/investigate-fix-protocol.md)` — §5.2). The protocol-doc version + the agent's stored prompt are the version pair; the text body does not need an explicit field. (Consistent with NG10 — no protocol-version stamp at runtime; per-payload `schema_version` is for the structured JSON only.)

**Display.** The triage drawer (§10) renders the `investigate_prompt` text inside a copy-formatted block with a one-click copy button. No syntax highlighting beyond markdown; the prompt is markdown-formatted and the existing markdown renderer is reused.

### 9.9 Rate limiting

Rate limiting is the bound on **agent invocation cost**. Every triage call costs LLM tokens; an unbounded agent that re-triages the same incident on every recurrence becomes a cost lever pointed at noise.

**Per-fingerprint rate limit.**

- Max **2 triage attempts per fingerprint per 24-hour rolling window**.
- Counter: `system_incidents.triage_attempt_count` (§4.5).
- Last attempt: `system_incidents.last_triage_attempt_at` (§4.5).
- 3rd attempt within window: triage is **skipped**; an `agent_triage_skipped` event is written with `reason='rate_limited'`. The incident remains in the operator's queue, ready for manual escalate-to-agent (Phase 0.5) if the operator wants to override.

**Why per-fingerprint, not per-incident.** A new incident on an existing fingerprint (recurrence after resolution) inherits the fingerprint's recent triage history. Two clean diagnoses in 24 hours are usually enough to learn anything; a third triage is unlikely to find something the first two missed.

**Auto-escalation past the rate limit.**

- If a fingerprint hits its rate limit AND the incident's `severity == high|critical` AND the incident is still open after the rate-limit window expires, an `agent_auto_escalated` event is written and the existing manual-escalate path (Phase 0.5 §10.2) is invoked **automatically** — pointing the incident at the system-ops sentinel subaccount, where a sysadmin can pick it up.
- Auto-escalation respects the existing escalation guardrails (`phase-0-spec.md §10.2.5`) — `escalation_count <= 3`, the existing 5-min cooldown — so it cannot loop.
- If the guardrails block the auto-escalation, the incident sits in the open queue with a `agent_escalation_blocked` event; sysadmin sees it on their next visit to the page.

**Sweep clustering interacts with rate limiting.** A sweep cluster groups multiple heuristic fires on one candidate into one triage. The triage counts as one against the rate limit. So a noisy candidate that hits 5 heuristics produces one triage, not five.

**Rate-limit env vars** (defaults; configurable):

| Env var | Default | Purpose |
|---|---|---|
| `SYSTEM_MONITOR_MAX_TRIAGE_PER_FINGERPRINT` | `2` | Per-fingerprint cap. |
| `SYSTEM_MONITOR_TRIAGE_RATE_LIMIT_WINDOW_HOURS` | `24` | Rolling window. |
| `SYSTEM_MONITOR_AUTO_ESCALATE_AFTER_RATE_LIMIT` | `true` | Whether to auto-escalate high/critical incidents past the rate limit. |

### 9.10 Kill switch + env vars

**Master kill switch:** `SYSTEM_MONITOR_ENABLED` (default `true`). When `false`:

- The incident-driven trigger (§9.2) does not enqueue `system-monitor-triage` jobs.
- The sweep job (§9.3) returns early with no work.
- Already-enqueued jobs are not aborted — pg-boss runs them; the handler short-circuits and emits an `agent_triage_skipped` event with `reason='disabled'`. This avoids a mid-flight surprise where a flag flip leaves orphan jobs in the queue.
- Synthetic checks (§8) are not affected — they run under their own switch (`SYNTHETIC_CHECKS_ENABLED`).
- Phase 0/0.5 incident sink is not affected — the kill switch is scoped to Phase 2 triage, not to the underlying error pipeline.

**Per-trigger switches** for finer control:

| Env var | Default | Effect when `false` |
|---|---|---|
| `SYSTEM_MONITOR_INCIDENT_DRIVEN_ENABLED` | `true` | Disables only the incident-driven trigger. Sweep continues. |
| `SYSTEM_MONITOR_SWEEP_ENABLED` | `true` | Disables only the sweep job. Incident-driven continues. |

**Other env vars introduced by this section:**

| Env var | Default | Purpose |
|---|---|---|
| `SYSTEM_MONITOR_MODEL` | `claude-opus-4-7` | LLM model for the agent. Tunable for cost/quality balance. |
| `SYSTEM_MONITOR_MIN_CONFIDENCE` | `0.5` | Minimum per-fire heuristic confidence to count as fired. |
| `SYSTEM_MONITOR_HEURISTIC_PHASES` | `'2.0,2.5'` | Comma-separated phase filter. Setting `'2.0'` disables Phase 2.5 heuristics without removing them. |
| `SYSTEM_MONITOR_SWEEP_INTERVAL_MINUTES` | `5` | Sweep tick. |
| `SYSTEM_MONITOR_SWEEP_WINDOW_MINUTES` | `15` | Sweep window length. |
| `SYSTEM_MONITOR_SWEEP_CANDIDATE_CAP` | `50` | Hard ceiling on triage candidates per sweep. |
| `SYSTEM_MONITOR_SWEEP_PAYLOAD_CAP_KB` | `200` | Hard ceiling on deep-read payload per sweep. |

The full env-var inventory across this spec lives in §12.2 (consolidated for ops).

### 9.11 Stuck-state detection for the monitor agent itself

The day-one heuristic set (§9.5) detects stuck states in **other** agents — `max-turns-hit`, `repeated-skill-invocation`, `final-message-not-assistant`, `runtime-anomaly`. The same detection must apply to the `system_monitor` agent's own runs, otherwise a stuck monitor produces no diagnoses + no audit signal + no escalation.

**Detection criteria** (any one fires):

| Condition | Threshold | Source |
|---|---|---|
| `max_turns` reached | `agent_runs.terminated_reason == 'max_turns'` | Run row |
| Runtime exceeds soft cap | `runtime_ms > 5 minutes` | Run row |
| Identical output across triages | Two consecutive triages on the same fingerprint produce byte-identical `agent_diagnosis.hypothesis` | `system_incidents` history (compared inside `recordTriageOutcome`) |
| Tool-only final message | Last message in run is `tool` or `system`, not `assistant` | Run message history |
| No `write_diagnosis` call after N turns | After 8 turns without a `write_diagnosis` invocation | Run message history |

**Escalation path.** When any criterion fires for a `system_monitor` agent run:

1. The triage handler logs `error('monitor-self-stuck', { agent_run_id, criterion })`.
2. Writes `agent_triage_failed` event (§12.1) with `reason='self_stuck'` and `metadata.criterion`.
3. The drawer renders a triage-failed badge with copy "Auto-triage encountered an unexpected state — operator should investigate manually" (§10.3 failure-mode visibility).
4. The synthetic-check `agent-run-success-rate-low` (§8.2 row 7) catches the broader trend: if monitor self-stuck persists across multiple incidents, the synthetic check fires its own incident pointing at the monitor agent itself.

**Severity ladder for self-stuck signals.** A single-run stuck event and a cross-run pattern of stuck events are graded differently — one is noise, the other is a system-level alarm. The graduated response uses existing primitives, not new ones:

| Tier | Trigger | Action | Operator visibility |
|---|---|---|---|
| INFO / WARN | One stuck signal on one run (any criterion above fires) | Logger `warn('monitor-self-stuck', ...)`; `agent_triage_failed` event with `reason='self_stuck'`; rate-limit counter increments | Triage drawer renders triage-failed badge with manual-escalate copy (§10.3). No alert. |
| CRITICAL | Cross-run pattern — the synthetic check `agent-run-success-rate-low` (§8.2) detects elevated stuck rate across the `system_monitor` agent's recent runs | The synthetic check fires its own incident with `source='synthetic'` pointing at `system_monitor` itself. Severity propagates from synthetic check metadata. | New incident appears on the SystemIncidentsPage; sysadmin sees it on next visit. The auto-escalation path (§9.9) applies if severity is `high` / `critical` and the rate limit is hit. |

**No auto-remediation, no auto-recovery.** The monitor agent does not retry itself past the existing `write_diagnosis` retry-up-to-2 loop (§9.8). A self-stuck condition is always escalated to human — the operator manually escalates the incident to a sysadmin via the existing Phase 0/0.5 path. The kill switch (`SYSTEM_MONITOR_ENABLED=false`) is the operator's tool if the monitor is stuck across many runs. The CRITICAL tier above is a **detection upgrade**, not an auto-fix path; the response is still operator-driven.

**Why no auto-remediation here.** Auto-remediation on the monitor itself would be a Phase 3 capability (auto-fix is the Phase 3 deliverable per §19.2). The Phase 2 surface deliberately stops at "diagnose + escalate to human"; introducing auto-remediation rules at the monitor layer would cross that line. Out of scope.

**No recursion.** A self-stuck monitor incident has `metadata.isMonitorSelfStuck=true`. Phase 2's incident-driven trigger explicitly excludes incidents with that flag from auto-triage (§9.2 — same recursion guard pattern as `metadata.isSelfCheck`).

**Why this is a separate subsection.** §9.5 heuristics evaluate against agent runs of *other* agents. The `system_monitor` agent's own runs are excluded from the sweep candidate set (`agent_id != system_monitor`). This subsection defines the detection that *does* apply to the monitor's own runs — equivalent rules, different code path.

## 10. UI surface

The UI scope is deliberately tight. Per CLAUDE.md frontend principles, this spec adds no new pages, no new navigation entries, no dashboards. Every change extends the existing `SystemIncidentsPage` (Phase 0/0.5) and its triage drawer. Inline state beats new surface.

### 10.1 Triage drawer additions

The Phase 0/0.5 triage drawer (`client/src/pages/SystemIncidentsPage.tsx` and the drawer subcomponent) renders a single incident's metadata, recent events, and lifecycle actions (resolve, suppress, escalate). This spec adds three inline blocks to that drawer, in the order below. Layout is vertical; existing actions remain at the top.

| Block | Position | Renders | Visibility |
|---|---|---|---|
| Diagnosis annotation | Top of drawer body, above existing metadata | The agent's hypothesis + evidence + confidence (§10.3) | Only when `agent_diagnosis IS NOT NULL`. Otherwise: a slim "Awaiting diagnosis" or "Not auto-triaged" line — see §10.5. |
| `investigate_prompt` block | Immediately below the diagnosis annotation | Markdown-rendered prompt with copy button (§10.2) | Only when `investigate_prompt IS NOT NULL`. |
| Feedback widget | Below the existing resolve action, only after a resolve has happened against an agent-diagnosed incident | "Was this useful?" yes/no + free-text (§10.4) | Only when incident `resolved` AND `agent_diagnosis IS NOT NULL` AND `prompt_was_useful IS NULL`. |

**Existing drawer surface unchanged.** The escalation modal, suppression modal, recent-events list, and metadata block all remain as-is. New blocks are additive.

**Loading states.** The diagnosis and prompt blocks render their own skeleton row when the agent is still triaging — detected via `triage_attempt_count > 0 AND agent_diagnosis IS NULL AND last_triage_attempt_at > NOW() - 5 min`. Outside that window, "no diagnosis yet" copy renders without a skeleton.

**Width.** The drawer width is unchanged. Long prompts scroll vertically inside the prompt block; horizontal overflow on the prompt block uses native `pre` wrapping behaviour with `white-space: pre-wrap` so copy/paste preserves formatting.

**Mobile.** Drawer is sysadmin-only; sysadmin workflow is desktop. Mobile layout is not optimised in this spec — the existing drawer falls back to a stacked view, and the new blocks inherit it. No mobile-specific design.

### 10.2 `investigate_prompt` copy button

**Render.** A monospace-rendered block containing the markdown text of `system_incidents.investigate_prompt`. The block is read-only and selectable. A single primary action — `Copy prompt` — sits at the top right of the block.

**Copy behaviour.**

- Click → `navigator.clipboard.writeText(investigatePrompt)`.
- On success: button label flips to `Copied` for 2 seconds, then returns to `Copy prompt`.
- On failure (clipboard API blocked): inline tooltip "Copy failed — select the text manually" with no thrown error.
- No event written for copy actions in v1. Future iteration may emit a `prompt_copied` event for the feedback loop, but copy alone is a weak signal — the resolve-time feedback widget (§10.4) is the load-bearing data point.

**Markdown rendering.** The prompt is markdown by construction (per the protocol §5.2). The drawer reuses the existing markdown renderer used elsewhere in `SystemIncidentsPage` for incident notes, with `pre`-style code block formatting preserved. Headings, lists, and inline code render as expected.

**No edit-in-place.** The prompt is rendered read-only. If the operator wants to modify the prompt before pasting, they paste into Claude Code and edit there — same as any other prompt source. Editing the stored prompt would mutate the audit record; we want the original agent-generated text on file.

**Empty state.** If `investigate_prompt IS NULL` (incident not yet triaged, or rate-limit-skipped, or validation-failed), the block does not render. The diagnosis annotation block (§10.3) carries a state line — see below.

**No download / export.** Copy-to-clipboard is the only export path. No "download as .md", no "send to email", no "open in editor". Adding those is not user-requested and would expand scope; copy is sufficient.

### 10.3 Diagnosis annotation rendering

The diagnosis JSON (`system_incidents.agent_diagnosis`, populated by `write_diagnosis` per §9.4) renders as a structured block at the top of the drawer body. Layout matches the existing incident-metadata block style — labelled rows, light typographic hierarchy.

**Rendered fields:**

| Field | Source | Display |
|---|---|---|
| Hypothesis | `agent_diagnosis.hypothesis` | Plain paragraph. No markdown — it's prose. |
| Confidence | `agent_diagnosis.confidence` | Pill badge: `low` / `medium` / `high`. Colour: low=neutral, medium=blue, high=green. (Not red — high confidence is good, not alarming.) |
| Evidence | `agent_diagnosis.evidence[]` | Bullet list. Each item: `{type, ref, summary}`. `ref` rendered as a clickable link if it points to a known entity (agent run id → run log page; row id → no link in v1). |
| Generated at | `agent_diagnosis.generatedAt` | Relative time (`2 minutes ago`) with absolute time on hover. Matches existing event-row style. |
| Agent run | `agent_diagnosis_run_id` | Small footer link: `View triage run` → opens the agent run's log in a new drawer or page. (If the agent-run-log page does not yet exist for system-managed agents, render as plain text "Triage run id: <uuid>" until that page is added — flagged as Phase 3 polish.) |

**Empty / not-yet-triaged states:**

| Condition | Render |
|---|---|
| `agent_diagnosis IS NULL` AND `triage_attempt_count == 0` AND incident is sweep-eligible | "Awaiting auto-triage" — slim status line, no skeleton, no progress bar. |
| `agent_diagnosis IS NULL` AND `triage_attempt_count > 0` AND `last_triage_attempt_at > NOW() - 5 min` | Skeleton block with "Triaging…" caption. |
| `agent_diagnosis IS NULL` AND `last_triage_attempt_at` older than 5 min AND `triage_attempt_count` at cap | "Auto-triage rate-limited — manual escalate available" with link to existing escalate-to-agent action. |
| `agent_diagnosis IS NULL` AND incident is `source = 'self_check'` OR `metadata.isSelfCheck = true` | "Auto-triage skipped (self-check incident)" — no escalate prompt; this is intentional per §9.2. |
| `agent_diagnosis IS NULL` AND `severity = 'low'` | "Auto-triage skipped (low severity)" — operator can manual-escalate. |

**Failure mode visibility.** If the agent ran but produced an invalid prompt (validation failure per §9.8), `agent_diagnosis` may be set but `investigate_prompt` is NULL — render the diagnosis as normal, plus a "Prompt validation failed — operator should investigate manually" line in red text. This is a real failure mode worth surfacing inline; hiding it would let the agent silently degrade.

**No real-time auto-update.** The drawer refreshes when the user closes and re-opens it, when the page re-fetches per Phase 0.5 backstop polling, and when a WebSocket `system_incident:updated` event fires for the open incident (existing Phase 0.5 channel, no new event type). A "diagnosis just landed" inline notification is **not** added; the drawer simply re-renders with the new content.

### 10.4 Feedback widget — was this useful

The feedback widget is the load-bearing input to the iteration loop (§5.5, §11). It captures structured operator feedback the moment the operator's working memory is sharpest — at resolve time, against an agent-diagnosed incident.

**Render.** A small inline card that appears in the drawer **only after the operator has resolved an agent-diagnosed incident** AND `prompt_was_useful IS NULL`. Layout:

```
┌──────────────────────────────────────────────────────────────────┐
│ Was the agent's diagnosis useful?                                │
│   ( ) Yes — it pointed me at the right place                     │
│   ( ) No — I had to investigate from scratch                     │
│   ( ) Partially — useful but missed something                    │
│                                                                  │
│   What did it get right or wrong? (optional)                     │
│   ┌────────────────────────────────────────────────────────────┐ │
│   │                                                            │ │
│   └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│   [ Submit ]   [ Skip ]                                          │
└──────────────────────────────────────────────────────────────────┘
```

**State machine:**

| State | Render |
|---|---|
| Resolve just happened, agent had diagnosed, no feedback submitted | Widget visible, `Submit` disabled until a radio is chosen. |
| Operator chose a radio | `Submit` enabled. Free-text remains optional. |
| Operator clicked `Submit` | Server call to new mutation `recordPromptFeedback(incidentId, { wasSuccessful: 'yes' | 'no' | 'partial', text?: string })`. On success → widget collapses to "Thanks — feedback saved" line; persists on next drawer open. |
| Operator clicked `Skip` | Widget hides for the session; no event written; widget reappears on next session if `prompt_was_useful` is still NULL. |
| `prompt_was_useful IS NOT NULL` | Widget hidden. Resolved-incident drawer shows feedback summary inline: "Operator marked this useful: yes" — for context next time someone reviews the incident. |

**Mapping `wasSuccessful` to the schema column:**

The schema column `prompt_was_useful` is `boolean | NULL`. The widget has three radio options. Mapping: `yes → true`, `no → false`, `partial → true with metadata.partial = true on the event row`. Why store `partial` on the event row, not the schema: the boolean column is the simple aggregate-friendly signal; the event log carries the fidelity. This avoids adding a third schema state for what is, fundamentally, a "useful with caveats" signal.

**Mutation route.** A new `POST /api/system/incidents/:id/feedback` endpoint, sysadmin-gated (per §4.4 `assertSystemAdminContext`), accepting `{ wasSuccessful: 'yes'|'no'|'partial', text?: string }`. Writes to `prompt_was_useful` and `prompt_feedback_text` (§4.5) and emits `investigate_prompt_outcome` event (§11.2). Idempotent on first submission per incident; subsequent submissions are rejected with 409 (one feedback per incident; over-write would lose history, and the operator can edit after the fact via the audit trail if a future iteration needs it).

**Optional free-text length.** Up to 2,000 characters. Above that, the textarea hard-stops and shows a character counter. No multi-line markdown rendering on display — the field is stored and re-displayed as plain text.

### 10.5 Filter for agent-diagnosed incidents

A new filter pill is added to the existing filter bar at the top of `SystemIncidentsPage`. The filter operates on `agent_diagnosis IS NULL` / `IS NOT NULL`.

**Pill values:**

| Value | Server filter | UI label |
|---|---|---|
| `all` (default) | none | `All` |
| `diagnosed` | `agent_diagnosis IS NOT NULL` | `Diagnosed by agent` |
| `awaiting` | `agent_diagnosis IS NULL` AND eligible for auto-triage AND `triage_attempt_count < cap` | `Awaiting diagnosis` |
| `not-triaged` | `agent_diagnosis IS NULL` AND not eligible for auto-triage (low severity, self-check, rate-limited past cap) | `Not auto-triaged` |

**Default.** `all`. Operators are expected to triage by severity and recency first; the diagnosis filter is for "let me see only the incidents the agent has annotated" workflows during weekly review.

**Stacks with existing filters.** The new pill ANDs with existing filters (severity, status, source). No special-case logic.

**Server-side query.** The list endpoint (`GET /api/system/incidents`) accepts a new query parameter `?diagnosis=all|diagnosed|awaiting|not-triaged`. Default `all`. Server validates against an enum; unknown values return 400.

**No counts on the pill.** Inline count badges on filter pills are explicitly out of scope per CLAUDE.md frontend principles ("default to hidden"). The list itself shows the count after filtering applies.

**Search and sort interaction.** Sort options (recency, severity) and the existing search box continue to operate over the filtered set. No regressions to existing behaviour.

## 11. Feedback loop

The feedback loop is the **mechanism** by which the agent gets better. The agent on day one is calibrated against author intuition; without operator-grounded data, drift cannot be detected and tuning becomes guesswork. The loop is small, structured, and queryable.

### 11.1 Schema additions for prompt-was-useful

The relevant columns are already declared in §4.5 (`prompt_was_useful`, `prompt_feedback_text`) — this subsection cross-references rather than duplicates.

**Where they sit.** Both columns live on the `system_incidents` row, not on a separate feedback table. Rationale:

- Each incident has at most one prompt and at most one feedback submission (per §10.4 — feedback is one-shot). A separate table would be a 1:1 row with the incident, which is over-normalisation.
- The audit history of the feedback (who submitted when, did it change, partial-vs-yes) lives in the `system_incident_events` log, not as additional columns. The schema columns hold the **current state**; the events hold the **history**.

**Lifecycle of these columns:**

| State | `prompt_was_useful` | `prompt_feedback_text` | Triggered by |
|---|---|---|---|
| Incident never auto-triaged | NULL | NULL | initial |
| Incident triaged, no feedback yet | NULL | NULL | agent triage write |
| Operator submitted feedback | `true \| false` | text or NULL | `recordPromptFeedback` mutation |
| Operator skipped (in §10.4 sense) | NULL | NULL | no DB write |

**No backfill.** Existing incidents (from before this spec ships) have `NULL` in both columns and remain so. The Phase 0/0.5 backlog of incidents is not eligible for auto-triage retroactively (the agent did not exist when they happened) — backfilling is meaningless.

### 11.2 Event type — `investigate_prompt_outcome`

The event row is the **fidelity-preserving** record. Where the schema columns hold "the answer", the event log holds "what happened, when, by whom, with what context."

**Event type:** `investigate_prompt_outcome`. Appended to `system_incident_events` whenever `recordPromptFeedback` is called (§10.4 mutation).

**Row shape:**

| Column | Value | Notes |
|---|---|---|
| `event_type` | `investigate_prompt_outcome` | New value in the event-type enum (§12.1). |
| `incident_id` | `system_incidents.id` | FK as usual. |
| `actor_user_id` | the sysadmin who submitted the feedback | NOT NULL — feedback always has a human actor. |
| `metadata.was_successful` | `'yes' \| 'no' \| 'partial'` | The full three-value answer, including the `partial` case that the boolean column flattens. |
| `metadata.text` | `string \| null` | Free-text feedback (max 2,000 chars). |
| `metadata.linked_pr_url` | `string \| null` | Optional. If the operator's resolution included a PR, the URL is captured (re-uses the existing resolve-modal "linked PR URL" field from Phase 0/0.5). Joining this to the agent's diagnosis is the single richest data point we collect. |
| `metadata.resolved_at` | timestamp | When the resolve happened (the trigger before feedback). |
| `metadata.diagnosis_run_id` | the agent run id from `agent_diagnosis_run_id` | Lets us join feedback back to the specific agent run that produced the diagnosis. |
| `metadata.heuristic_fires` | array of heuristic ids | Which heuristics fired on this incident. Lets per-heuristic feedback aggregation work without re-querying. |
| `created_at` | NOW() | Standard. |

**Why duplicate `was_successful` between the column and the event metadata.** The column is the "current state" the UI reads. The event metadata captures the historical fidelity. If feedback is ever re-opened (e.g. an admin override path is added later), the column updates but the original event remains; auditing remains complete.

**Idempotency.** The mutation is idempotent on `(incident_id, actor_user_id)` for first submission; subsequent calls are 409 (per §10.4). Event log holds exactly one `investigate_prompt_outcome` row per incident.

**No emit when feedback is skipped.** "Skip" in the UI does not write an event; we only record affirmative actions. A "no feedback after N days" signal is derivable from `WHERE agent_diagnosis IS NOT NULL AND prompt_was_useful IS NULL AND status = 'resolved' AND resolved_at < NOW() - 30 days`. Phase 3 may reach for this via a follow-up audit dashboard; not built now.

### 11.3 What this trains for Phase 3

The data accumulated by this loop is the **input to the Phase 3 (auto-fix) gate**. Phase 3 is its own design exercise; this section names the data dependencies it will rely on.

**Per-heuristic FP rate calibration.**

- Each `investigate_prompt_outcome` row joins to the heuristics that fired on the incident (`metadata.heuristic_fires`).
- Aggregate: for each heuristic, the ratio of `was_successful = 'yes'` to total feedback submissions is the empirical proxy for "the heuristic identified a real issue."
- This replaces author-best-guess `expectedFpRate` (§6.3) with measured rates, after enough volume.
- Operator is expected to review this monthly (target cadence) and update heuristic metadata in the registry via PR.

**Per-prompt-template effectiveness.**

- `was_successful = 'yes' AND linked_pr_url IS NOT NULL` is the strongest positive signal: the operator was satisfied, and the diagnosis led to a code change.
- `was_successful = 'no'` is the strongest negative signal: the prompt led nowhere or wrong direction.
- `was_successful = 'partial' + free-text` is the iteration goldmine — operator-described "what the agent missed" maps directly to changes the prompt template (§9.7) or the protocol doc (§5) need to absorb.

**Auto-fix gate signal (Phase 3 input).**

- The threshold "the agent's prompts consistently lead to one-shot fixes operators accept without rewriting" is qualitative on day one.
- Quantitative version: % of agent-diagnosed incidents where `was_successful = 'yes' AND linked_pr_url IS NOT NULL` exceeds (target tbd in Phase 3 design — likely 70-80%) over a rolling 30-day window.
- When this metric stabilises above the threshold, Phase 3 can be designed with confidence that the agent's diagnosis quality is high enough to drive an automated executor against the same Investigate-Fix Protocol.

**Why this matters for the overall product.**

This is the lever that turns the system monitor from a "tool that helps operators" into "infrastructure that runs unattended." The pre-condition for unattended auto-fix is operator-grounded evidence that the agent's diagnoses are right often enough to trust without review. The feedback loop accumulates that evidence in a queryable form, with every resolve event. No separate dashboard build, no instrumentation campaign, no analytics pipeline — just structured rows on the existing event log.

**No analytics view in this spec.** A sysadmin-only dashboard that visualises feedback rollups (per-heuristic FP rate over time, prompt-effectiveness trend) is **out of scope** for this spec. The data is captured; the visualisation is a Phase 3 deliverable, designed alongside the auto-fix gate. For now, the data is queryable via direct SQL or via a future audit log surface — neither blocks Phase 2 shipping.

## 12. Observability + kill switches

This section consolidates the operational surface — every new event type, every new env var, every logging convention — so an operator running a deploy or debugging in production can see the full surface in one place. Cross-references live in earlier sections; this is the index.

### 12.1 New event types

All event types append to `system_incident_events`. The Phase 0/0.5 enum is extended; no existing event types are renamed or repurposed.

| Event type | Source | When written | `metadata` shape |
|---|---|---|---|
| `agent_diagnosis_added` | `system_monitor` agent | After `write_diagnosis` succeeds — diagnosis JSON and `investigate_prompt` are now on the row. | `{ schema_version: 'v1', agent_run_id, heuristic_fires: string[], confidence }` |
| `agent_triage_skipped` | `system-monitor-triage` enqueue path or handler short-circuit | When triage was eligible but skipped (rate-limited, kill switch off, self-check, severity floor not met, monitor self-stuck). | `{ schema_version: 'v1', reason: 'rate_limited' \| 'disabled' \| 'self_check' \| 'severity_floor' \| 'self_stuck', triage_attempt_count }` |
| `agent_triage_failed` | `system-monitor-triage` handler | When the agent ran but did not produce a valid output (prompt validation failure, agent run errored, monitor self-stuck). | `{ schema_version: 'v1', agent_run_id, reason: 'prompt_validation' \| 'agent_run_failed' \| 'timeout' \| 'self_stuck', error_message?, criterion? }` |
| `agent_auto_escalated` | rate-limit-aware auto-escalation path (§9.9) | When a rate-limited high/critical incident auto-escalates to the system-ops sentinel. | `{ to_subaccount_id, escalation_count, fingerprint }` |
| `agent_escalation_blocked` | same path | When auto-escalation hit a Phase 0.5 escalation guardrail. | `{ reason: 'guardrail_cap' \| 'cooldown' \| 'subaccount_disabled' }` |
| `heuristic_fired` | sweep job | Every fire that passed the per-fire confidence threshold. Written to `system_monitor_heuristic_fires` (§4.5), not `system_incident_events` — but the audit hook still emits a `heuristic_fired` row on the incident if a fire produced an incident. | `{ heuristic_id, confidence, evidence_run_id }` |
| `heuristic_suppressed` | sweep job | When a heuristic predicate matched but a suppression rule blocked it. Written to `system_monitor_heuristic_fires`; not on the incident event log. | `{ heuristic_id, suppression_id, evidence_run_id }` |
| `sweep_completed` | sweep job | End of every sweep tick. Audit-only on the system level, not per-incident. Stored in a structured log row, not on `system_incident_events`. | `{ candidates_evaluated, fires, triages_enqueued, sweep_capped_count? }` |
| `sweep_capped` | sweep job | When the sweep input cap was hit (more than 50 candidates or 200 KB payload). | `{ excess_count, cap_kind: 'candidate' \| 'payload' }` |
| `triage_rate_limited` | triage enqueue path | Aggregated form of `agent_triage_skipped` for sysadmin-visible counters. Same data as `agent_triage_skipped` but emitted to a metrics channel for dashboarding. Not a separate event row — flagged here for completeness. | n/a (metrics) |
| `prompt_generated` | `system_monitor` agent | After `write_diagnosis` writes the `investigate_prompt`. Companion to `agent_diagnosis_added` so we can distinguish "diagnosis written" from "prompt written" if validation fails on prompt only. | `{ schema_version: 'v1', agent_run_id, prompt_length_chars }` |
| `investigate_prompt_outcome` | sysadmin via `recordPromptFeedback` mutation | When the operator submits feedback after resolving an agent-diagnosed incident (§11.2). | per §11.2 table |
| `synthetic_check_fired` | synthetic check tick | A synthetic check produced an incident. Companion event on the resulting incident — explains "this incident's source was synthetic check X." | `{ check_id, resource_kind, resource_id, bucket_key }` |
| `baseline_refreshed` | baseline refresh job | Tick completed. System-level audit, not on `system_incident_events`. Logged structurally. | `{ entities_refreshed, duration_ms }` |
| `baseline_refresh_failed` | baseline refresh job | A specific entity-metric refresh failed and was skipped. Other entities continue. | `{ entity_kind, entity_id, metric, error_message }` |

**Naming convention.** All event types are kebab-case-with-underscores in DB rows (consistent with Phase 0/0.5 — `incident_opened`, `status_changed`, `escalation`, etc.). Structured logger event names are the same string, lowercased.

**Event consumers.** The triage drawer (§10) renders the subset relevant to operator-facing context: `agent_diagnosis_added`, `agent_triage_skipped`, `agent_triage_failed`, `agent_auto_escalated`, `prompt_generated`, `investigate_prompt_outcome`. The other event types are audit-only — visible via direct SQL or via a future audit log surface.

### 12.2 New env vars

Consolidated. Defaults are production-safe — running with all defaults yields the intended Phase 2 behaviour.

| Env var | Default | Section | Purpose |
|---|---|---|---|
| `SYSTEM_INCIDENT_IDEMPOTENCY_TTL_SECONDS` | `60` | §4.1 | Idempotency LRU TTL. |
| `SYSTEM_INCIDENT_THROTTLE_MS` | `1000` | §4.2 | Per-fingerprint throttle window. |
| `SYNTHETIC_CHECKS_ENABLED` | `true` | §8.4 | Master kill switch for Phase 1 synthetic checks. |
| `SYSTEM_MONITOR_SYNTHETIC_CHECK_INTERVAL_SECONDS` | `60` | §8.4 | Synthetic check tick interval. |
| `SYSTEM_MONITOR_QUEUE_STALL_THRESHOLD_MINUTES` | `5` | §8.4 | `pg-boss-queue-stalled` threshold. |
| `SYSTEM_MONITOR_CONNECTOR_STALE_MULTIPLIER` | `3` | §8.4 | `connector-poll-stale` multiplier. |
| `SYSTEM_MONITOR_DLQ_STALE_THRESHOLD_MINUTES` | `30` | §8.4 | `dlq-not-drained` threshold. |
| `SYSTEM_MONITOR_HEARTBEAT_STALE_TICKS` | `3` | §8.4 | `heartbeat-self` tolerance. |
| `SYSTEM_MONITOR_AGENT_INACTIVITY_THRESHOLDS_JSON` | `'{}'` | §8.4 | Per-agent inactivity thresholds. |
| `SYSTEM_MONITOR_BASELINE_REFRESH_INTERVAL_MINUTES` | `15` | §7.3 | Baseline refresh tick. |
| `SYSTEM_MONITOR_BASELINE_WINDOW_DAYS` | `7` | §7.3 | Rolling baseline window. |
| `SYSTEM_MONITOR_BASELINE_REFRESH_ENABLED` | `true` | §7.3 | Kill switch for baseline refresh. |
| `SYSTEM_MONITOR_ENABLED` | `true` | §9.10 | Master kill switch for Phase 2 agent + triggers. |
| `SYSTEM_MONITOR_INCIDENT_DRIVEN_ENABLED` | `true` | §9.10 | Per-trigger switch — incident-driven. |
| `SYSTEM_MONITOR_SWEEP_ENABLED` | `true` | §9.10 | Per-trigger switch — sweep. |
| `SYSTEM_MONITOR_MODEL` | `claude-opus-4-7` | §9.10 | LLM for the agent. |
| `SYSTEM_MONITOR_MIN_CONFIDENCE` | `0.5` | §9.10 | Minimum per-fire heuristic confidence. |
| `SYSTEM_MONITOR_HEURISTIC_PHASES` | `'2.0,2.5'` | §9.10 | Phase filter for the heuristic registry. |
| `SYSTEM_MONITOR_SWEEP_INTERVAL_MINUTES` | `5` | §9.10 | Sweep tick. |
| `SYSTEM_MONITOR_SWEEP_WINDOW_MINUTES` | `15` | §9.10 | Sweep window length. |
| `SYSTEM_MONITOR_SWEEP_CANDIDATE_CAP` | `50` | §9.10 | Hard ceiling on triage candidates per sweep. |
| `SYSTEM_MONITOR_SWEEP_PAYLOAD_CAP_KB` | `200` | §9.10 | Hard ceiling on deep-read payload per sweep. |
| `SYSTEM_MONITOR_MAX_TRIAGE_PER_FINGERPRINT` | `2` | §9.9 | Per-fingerprint rate limit. |
| `SYSTEM_MONITOR_TRIAGE_RATE_LIMIT_WINDOW_HOURS` | `24` | §9.9 | Rolling window for the rate limit. |
| `SYSTEM_MONITOR_AUTO_ESCALATE_AFTER_RATE_LIMIT` | `true` | §9.9 | Auto-escalate high/critical past rate limit. |

**Inherited from Phase 0/0.5 — unchanged.** `SYSTEM_INCIDENT_INGEST_ENABLED`, `SYSTEM_INCIDENT_INGEST_MODE`, and other Phase 0/0.5 env vars retain their existing defaults and behaviour. Listed here only for completeness; no spec changes apply to them.

**Kill-switch hierarchy** (highest = most aggressive disable):

1. `SYSTEM_INCIDENT_INGEST_ENABLED=false` — disables the entire ingest pipeline. Phase 0/0.5 + Phase 1 + Phase 2 all silent. Most aggressive.
2. `SYSTEM_MONITOR_ENABLED=false` — disables Phase 2 agent + triggers only. Phase 0/0.5 reactive ingest + Phase 1 synthetic checks continue. Recommended first response if the agent itself misbehaves.
3. `SYNTHETIC_CHECKS_ENABLED=false` — disables Phase 1 only. Reactive ingest + agent triage continue. Use if synthetic checks are firing false-positives in volume.
4. Per-trigger: `SYSTEM_MONITOR_INCIDENT_DRIVEN_ENABLED=false` or `SYSTEM_MONITOR_SWEEP_ENABLED=false` — surgical disable of one trigger class. Use for "the sweep is fine but incident-driven is looping" or vice versa.
5. Per-heuristic suppression — code change via PR per §6.5. Slowest path; use when narrow targeting matters.

A global "stop everything" sequence is `SYSTEM_INCIDENT_INGEST_ENABLED=false`; all downstream switches are no-ops because nothing flows in. The sequence to gracefully bring things back is the reverse: ingest → synthetic → monitor → per-trigger → per-heuristic.

### 12.3 Logging conventions

All new code paths follow the existing structured-logger convention from `phase-0-spec.md` and `architecture.md §Logging`.

**Conventions:**

- Structured calls: `logger.info('event-name-kebab-case', { ...context })`. Never string-concatenated messages.
- Event name matches the `event_type` for paths that also write to `system_incident_events`. So `logger.info('agent-diagnosis-added', ...)` mirrors the `agent_diagnosis_added` event row.
- Required context keys per call: `correlationId` (when available), `incidentId` (when applicable), `entityKind`/`entityId` (when applicable). Optional keys per the event metadata shape (§12.1).
- Errors logged with `logger.error('event-name-failed', { err, ...context })`. The `err` field passes through the existing logger's error-serialiser.
- No PII in logs. Customer email addresses, names, message bodies — all redacted or omitted by the calling code. The system-principal context (§4.3) carries no PII; this is intentional.
- Log levels: `debug` for high-volume paths (every heuristic evaluation), `info` for state transitions (every fire, every triage, every refresh), `warn` for recoverable errors (single-heuristic throw, single-entity baseline failure), `error` for non-recoverable errors (handler throws past its catch).

**Queryable-dimensions invariant (logs-as-metrics).** Several internal counters in this spec are surfaced via tagged structured logs rather than a dedicated metrics service (§4.1 `system_incident_ingest_idempotent_hits`, §4.2 `system_incident_ingest_throttled`, §4.2 `system_incident_ingest_throttle_map_evictions`, §9.3 sweep cap counts). Any log line that is intended to be aggregated as a metric MUST carry the queryable dimensions needed to slice it. **Required dimension keys per metric-bearing log line:**

| Dimension | When required | Source |
|---|---|---|
| `correlationId` | Always when available (request-bound paths) | Existing logger middleware |
| `incidentId` | When the line refers to an incident | The incident row |
| `agentId` | When the line refers to an agent run (the *triaged* agent, not necessarily `system_monitor`) | `agent_runs.agent_id` |
| `agentRunId` | When the line refers to a specific run | `agent_runs.id` |
| `jobId` | When the line refers to a pg-boss job | pg-boss job id |
| `runId` | Alias for `agentRunId` in agent-execution paths | same |
| `entityKind` + `entityId` | When the line refers to a baselined entity | per §7.1 |
| `heuristic_id` | When the line refers to a heuristic fire / suppression / failure | from registry |
| `orgId` | When the line refers to a tenant-scoped entity (read-only access by system principal) | `agent_runs.organisation_id` |

**Rule:** any log line emitted as `logger.info(...)` or `logger.warn(...)` for the explicit purpose of metric aggregation MUST include the dimensions relevant to its metric. Lines without dimensions cannot be sliced by `orgId` / `agentId` / `jobId` / `runId` and become useless at scale. Any new metric-bearing log line in this spec's surface area is added with its dimensions named at write time, not retrofitted later.

**Why this is enforced as an invariant.** Aggregating tagged-log-as-metric works at small scale; at scale it breaks the moment an operator asks "which org / agent / run is responsible for these throttle hits?" Naming the dimension contract once + applying it to every metric-bearing line keeps the pattern viable as volume grows.

**Test posture.** No CI gate enforces dimension presence (the static-gates posture per spec-context.md does not extend to log-format linting). The convention is documented + reviewed in PRs; metric-bearing log lines are explicitly called out in §12.3 + the relevant section.

**Heuristic-fires audit table is the structured log for sweeps.** Per §4.5, `system_monitor_heuristic_fires` is the durable audit row for every heuristic fire (or suppression / insufficient-data). Logger calls are redundant for this signal; logger is used only for the sweep tick start/end and for unexpected errors.

**Log-level + sampling rules (cost guardrails).** Queryable structured logs are valuable; they are also a cost lever if every code path emits at `info`. The rules below bound volume without weakening observability:

| Tier | Always logged | Sampled / gated | Rationale |
|---|---|---|---|
| `error` | All instances. No sampling. | n/a | Errors are sparse and load-bearing — sampling would lose the signal that matters most. |
| `warn` | All instances. No sampling. | n/a | Recoverable errors (single-heuristic throw, single-entity baseline failure) are still rare per minute; full retention. |
| `info` (state transitions) | Every fire, every triage start/end, every refresh tick start/end, every kill-switch state change | n/a — state transitions are bounded volume by construction | These are the observable events operators search by; sampling would create gaps in the timeline. |
| `info` (high-frequency events) | First instance + summary every N (default N=100, configurable per call site) | Sampled | High-frequency `info` (e.g. per-evaluation logger calls if they were promoted from `debug`) gets first-write + every-Nth-write retention. The rest become a counter increment. |
| `debug` | Off in production; on in development / explicit debug sessions | Gated by environment (`LOG_LEVEL=debug`) | Per-evaluation, per-candidate, per-token-spend trace. Useful in dev; cost-prohibitive at scale. |

**Always-on rule.** Errors, warnings, and state transitions are NEVER sampled. A sampling rule that drops state transitions creates gaps in the audit log that look like missing data; debugging cost outweighs storage savings. Sampling applies only to high-frequency `info` paths flagged at the call site.

**No silent fallback rule (invariant).** Every fallback (graceful degradation, regex → AST fallback, baseline `null` → `insufficient_data`, throttle map eviction → no-throttle-on-this-fingerprint) MUST emit a structured log line at `warn` or `info` with an explicit `reason` field. A fallback that occurs without log evidence is a silent degradation — operators cannot tell the system is running on the degraded path. Concrete enforcement points:

- §4.7.2 throttle-map eviction → `system_incident_ingest_throttle_map_evictions` counter + `warn('throttle-map-evicted', { fingerprint, reason: 'cap-hit' })`.
- §4.7.4 baseline-refresh failure → `baseline_refresh_failed` event + `warn('baseline-refresh-entity-failed', { entity_kind, entity_id, metric, reason: '<err>' })`.
- §4.7.6 synthetic-check timeout → `warn('synthetic-check-slow', { check_id, duration_ms, reason: 'soft-cap-exceeded' })`.
- §6 heuristic regex fallback to AST (when an AST parser fails) → `warn('heuristic-fallback', { heuristic_id, reason: 'ast-parse-failed' })`.
- Any new fallback added downstream of this spec inherits the rule: silent fallbacks are a code-review block.

**Why the rule is enforced.** Silent degradation is the failure mode operators discover via incident postmortem — "the system was running on the degraded path for three days and nobody noticed." Naming the invariant once + applying it to every fallback is cheaper than discovering each silent path the hard way.

**Log volume estimate.** Per sweep (5-min interval): ~50-200 candidates × ~14 heuristics = ~700-2,800 evaluations. At `debug` log level, this is meaningful volume; in production, `debug` is off — sweep evaluations log at `debug`, only fires log at `info`. Per minute: ~5-30 fires across the platform under healthy conditions, with rare bursts during incidents. Acceptable.

**No log shipping change.** This spec uses the existing logger configuration. If the host runtime forwards logs to an external aggregator (Datadog, Loki, etc.), new event names will appear there without configuration changes. If the host runtime relies on stdout only, the `system-monitor-self-check` (Phase 0/0.5) constraint remains: process-local rolling buffer, multi-instance undercount acceptable. No change to that posture.

**Searchability.** Operators debugging an incident search by `correlationId` (existing convention) or `incidentId`. Both fields are present on every Phase 2 log line that involves an incident. Heuristic debugging searches by `heuristic_id`. Baseline issues search by `entity_kind`/`entity_id`/`metric`.

### 12.4 Explicit defaults — retries, timeouts, failure recovery

Implicit "the system retries a few times then gives up" is not specified. This subsection consolidates every retry count, timeout, and failure-recovery default in one place. Every default is tunable via env var where one is named in §12.2; otherwise the default is the spec-defined value.

| Path | Default | Notes |
|---|---|---|
| pg-boss job retry count (all new queues — triage, sweep, synthetic-checks, baseline-refresh) | 3 | Inherited pg-boss default. After exhaustion → DLQ → `dlq-not-drained` synthetic check (§8.2) eventually fires. |
| pg-boss retry backoff | exponential per pg-boss default | Inherited. |
| `system-monitor-triage` job soft timeout | 5 minutes | Triage run beyond this fires `agent_triage_failed` with `reason='timeout'` (§9.11 / §4.7.5). |
| `system-monitor-sweep` tick soft cap | 5 minutes (matches tick cadence) | A slow sweep blocks the next tick via `singletonKey`. Logger info on overlap; not a hard fail. |
| `system-monitor-synthetic-checks` tick budget | 30 seconds total | §8.1. Per-check internal cap: 5 seconds. |
| `system-monitor-baseline-refresh` tick budget | 5 minutes | Slow refresh blocks the next tick via `singletonKey` (§4.9.2). |
| `write_diagnosis` validation retry-loop (agent-side) | max 2 retries | §9.8. After 2 failures: `agent_triage_failed` with `reason='prompt_validation'`. |
| Incident-driven trigger cooldown | none beyond rate limit | Rate limit (§9.9) is the only gate. No additional cooldown. |
| Sweep window | 15 minutes (overlapping by 10 min) | §9.3. |
| Sweep candidate cap | 50 | §9.3. Configurable via `SYSTEM_MONITOR_SWEEP_CANDIDATE_CAP`. |
| Sweep payload cap | 200 KB | §9.3. Configurable via `SYSTEM_MONITOR_SWEEP_PAYLOAD_CAP_KB`. |
| Per-fingerprint rate limit | 2 triages / 24h rolling | §9.9. Configurable. |
| Idempotency LRU TTL | 60 seconds | §4.1. Configurable. |
| Throttle window | 1 second | §4.2. Configurable. |
| Baseline `minSampleCount` default | 10 | §7.4. Per-heuristic override allowed. |
| Baseline window | 7 days rolling | §7.3. Configurable. |
| Per-fire confidence threshold | 0.5 | §9.10 / §6.3. Configurable. |
| Synthetic-check failure handling | per-check `try/catch`; one bad check does not abort the tick | §8.1, §4.7.6. Logger error; persistence surfaces as repeated log lines. |
| Heuristic-evaluate failure handling | per-heuristic `try/catch`; one bad heuristic does not abort the sweep | §9.3, §4.7.3. Logger error. |
| Baseline-refresh entity failure handling | per-entity isolation; failed entity keeps prior row | §4.7.4. Other entities continue. |
| Triage agent run failure | `agent_triage_failed` event + drawer badge | §4.7.5, §10.3. Operator notified; manual escalate available. |
| Default agent model | `claude-opus-4-7` | §9.1. Configurable via `SYSTEM_MONITOR_MODEL`. |
| `agent_triage_skipped` reasons (the audit-log enum) | `rate_limited \| disabled \| self_check \| severity_floor \| self_stuck` | §12.1, §9.11. |
| `agent_triage_failed` reasons | `prompt_validation \| agent_run_failed \| timeout \| self_stuck` | §12.1, §9.11. |

**No retry on operator-facing mutations.** `recordPromptFeedback` is not retried — first submission wins, second returns 409 (§4.9.3). The operator either sees success or 409; no silent retry on the client.

**No retry past the documented count.** Three pg-boss retries is the maximum for any new queue introduced by this spec. The DLQ → synthetic check is the catch-all for persistent failure; the synthetic-check incident is then the operator's signal.

## 13. File inventory

Indicative inventory. Final paths and naming variants are an architect deliverable per §0.5. The table below is the authoritative list of net-new code surfaces and the existing files that need to change; the architect plan refines paths to match the repo's conventions at implementation time.

### 13.1 New files

**Server — Phase A:**

| Path (illustrative) | Purpose |
|---|---|
| `server/services/principal/systemPrincipal.ts` | `getSystemPrincipal`, `withSystemPrincipal` (§4.3). |
| `server/services/principal/assertSystemAdminContext.ts` | Service-layer guard (§4.4). |
| `server/services/incidentIngestorIdempotency.ts` | LRU + TTL helpers (§4.1). Sibling of existing `server/services/incidentIngestor.ts`; final naming resolved by architect. |
| `server/services/incidentIngestorThrottle.ts` | Per-fingerprint throttle map (§4.2). Sibling of existing `server/services/incidentIngestor.ts`; final naming resolved by architect. |
| `migrations/<NNNN>_phase_a_foundations.sql` | Schema additions per §4.5 + system principal seed + agent row seed for `system_monitor`. |
| `migrations/<NNNN>_phase_a_foundations.down.sql` | Local-revert mate. |

**Server — Phase 1 + Investigate-Fix Protocol + heuristic registry + baselining:**

| Path (illustrative) | Purpose |
|---|---|
| `server/services/systemMonitor/synthetic/index.ts` | Registry array + handler entry. |
| `server/services/systemMonitor/synthetic/types.ts` | `SyntheticCheck`, `SyntheticResult`. |
| `server/services/systemMonitor/synthetic/pgBossQueueStalled.ts` | (§8.2 row 1) |
| `server/services/systemMonitor/synthetic/noAgentRunsInWindow.ts` | (§8.2 row 2) |
| `server/services/systemMonitor/synthetic/connectorPollStale.ts` | (§8.2 row 3) |
| `server/services/systemMonitor/synthetic/dlqNotDrained.ts` | (§8.2 row 4) |
| `server/services/systemMonitor/synthetic/heartbeatSelf.ts` | (§8.2 row 5) |
| `server/services/systemMonitor/synthetic/connectorErrorRateElevated.ts` | (§8.2 row 6) |
| `server/services/systemMonitor/synthetic/agentRunSuccessRateLow.ts` | (§8.2 row 7) |
| `server/jobs/systemMonitorSyntheticChecksJob.ts` | pg-boss handler (§8.1). |
| `server/services/systemMonitor/heuristics/types.ts` | `Heuristic`, `HeuristicResult`, `HeuristicContext` (§6.2). |
| `server/services/systemMonitor/heuristics/index.ts` | Registry array. |
| `server/services/systemMonitor/heuristics/agentQuality/*.ts` | Day-one + 2.5 agent-quality heuristics (§9.5, §9.6). |
| `server/services/systemMonitor/heuristics/skillExecution/*.ts` | Day-one skill-execution heuristics (§9.5). |
| `server/services/systemMonitor/heuristics/infrastructure/*.ts` | Day-one + 2.5 infrastructure heuristics (§9.5, §9.6). |
| `server/services/systemMonitor/heuristics/systemic/*.ts` | Phase 2.5 systemic heuristics (§9.6). |
| `server/services/systemMonitor/baselines/refreshJob.ts` | Baseline refresh tick (§7.3). |
| `server/services/systemMonitor/baselines/baselineReader.ts` | Read API (§7.5). |
| `server/jobs/systemMonitorBaselineRefreshJob.ts` | pg-boss handler entry. |
| `docs/investigate-fix-protocol.md` | The protocol contract doc (§5.1). |

**Server — Phase 2:**

| Path (illustrative) | Purpose |
|---|---|
| `server/services/systemMonitor/triage/triageJob.ts` | Incident-driven trigger handler (§9.2). |
| `server/services/systemMonitor/triage/sweepJob.ts` | Sweep-driven trigger handler (§9.3). |
| `server/services/systemMonitor/triage/clusterFires.ts` | Sweep clustering helper. |
| `server/services/systemMonitor/triage/rateLimit.ts` | Per-fingerprint rate-limit + auto-escalation logic (§9.9). |
| `server/services/systemMonitor/triage/promptValidation.ts` | Validates `investigate_prompt` against §5.2 contract before write. |
| `server/services/systemMonitor/skills/readIncident.ts` | Read skill (§9.4). |
| `server/services/systemMonitor/skills/readAgentRun.ts` | Read skill (§9.4). |
| `server/services/systemMonitor/skills/readSkillExecution.ts` | Read skill (§9.4). |
| `server/services/systemMonitor/skills/readRecentRunsForAgent.ts` | Read skill (§9.4). |
| `server/services/systemMonitor/skills/readBaseline.ts` | Read skill (§9.4). |
| `server/services/systemMonitor/skills/readHeuristicFires.ts` | Read skill (§9.4). |
| `server/services/systemMonitor/skills/readConnectorState.ts` | Read skill (§9.4). |
| `server/services/systemMonitor/skills/readDlqRecent.ts` | Read skill (§9.4). |
| `server/services/systemMonitor/skills/readLogsForCorrelationId.ts` | Read skill (§9.4). |
| `server/services/systemMonitor/skills/writeDiagnosis.ts` | Write skill — diagnosis JSON + investigate_prompt (§9.4, §9.8). |
| `server/services/systemMonitor/skills/writeEvent.ts` | Write skill — append `system_incident_events` (§9.4). |
| `server/jobs/systemMonitorTriageJob.ts` | pg-boss handler entry — incident-driven. |
| `server/jobs/systemMonitorSweepJob.ts` | pg-boss handler entry — sweep. |
| `server/routes/systemIncidentFeedback.ts` | New mutation route for `recordPromptFeedback` (§10.4 + §11.2). |

**Server — tests (illustrative; see §14):**

- `server/services/__tests__/systemPrincipal.test.ts`
- `server/services/__tests__/idempotency.test.ts`
- `server/services/__tests__/throttle.test.ts`
- `server/services/__tests__/assertSystemAdminContext.test.ts`
- `server/services/__tests__/syntheticChecks.*.test.ts` (one per check)
- `server/services/__tests__/heuristics.*.test.ts` (positive + negative per heuristic)
- `server/services/__tests__/baselineReader.test.ts`
- `server/services/__tests__/triageJob.integration.test.ts`
- `server/services/__tests__/sweepJob.integration.test.ts`
- `server/services/__tests__/promptValidation.test.ts`
- `server/services/__tests__/rateLimit.test.ts`
- `server/services/__tests__/incidentFeedback.test.ts`

**Client:**

| Path (illustrative) | Purpose |
|---|---|
| `client/src/components/systemIncidents/DiagnosisAnnotation.tsx` | Renders the diagnosis JSON block (§10.3). |
| `client/src/components/systemIncidents/InvestigatePromptBlock.tsx` | Renders the prompt + copy button (§10.2). |
| `client/src/components/systemIncidents/FeedbackWidget.tsx` | The was-this-useful card (§10.4). |
| `client/src/components/systemIncidents/DiagnosisFilterPill.tsx` | Filter pill in the existing filter bar (§10.5). |
| `client/src/components/systemIncidents/__tests__/*.test.tsx` | Unit tests for each new component. |

**Docs:**

| Path | Purpose |
|---|---|
| `docs/investigate-fix-protocol.md` | The shared protocol contract (§5.1). |
| `architecture.md` | Update — add a System Monitor Active Layer section (sweep, agent, prompt protocol, baselining). |
| `docs/capabilities.md` | Update — add active monitoring capability under support-facing section. |
| `CLAUDE.md` | Update — add the §5.3 Investigate-Fix Protocol hook section. |

### 13.2 Modified files

| Path | Change |
|---|---|
| `server/services/incidentIngestor.ts` (`recordIncident` function) | Wrap with idempotency (§4.1) + throttle (§4.2). Accept new `idempotencyKey?` field. No fingerprint algorithm changes. |
| `server/services/systemIncidentService.ts` | Add `assertSystemAdminContext` as the first line of every mutation method (§4.4). Add new mutation: `recordPromptFeedback`. Existing methods otherwise unchanged. |
| `server/db/schema.ts` (Drizzle) | Add columns to `system_incidents` per §4.5; add new tables `system_monitor_baselines` and `system_monitor_heuristic_fires`. Extend the `system_incident_events.event_type` enum per §12.1. |
| `server/jobs/index.ts` (or job registration entry) | Register `system-monitor-synthetic-checks`, `system-monitor-baseline-refresh`, `system-monitor-triage`, `system-monitor-sweep` queues. Idempotency strategy declared per architecture.md `verify-idempotency-strategy-declared.sh` requirement. |
| `server/routes/systemIncidents.ts` | Add `?diagnosis=...` query param to the list endpoint (§10.5). |
| `server/services/agentRunner.ts` (or post-merge equivalent system-managed agent dispatch) | Wire the system-principal context (§4.3) at the entry point of system-managed agent runs. |
| `client/src/pages/SystemIncidentsPage.tsx` | Wire new components into the drawer (§10.1). Add diagnosis filter pill to filter bar (§10.5). |
| `CLAUDE.md` | Add §5.3 Investigate-Fix Protocol section. |
| `architecture.md` | New section — System Monitor Active Layer. |
| `docs/capabilities.md` | Updated capability entry. |

### 13.3 Files NOT touched (cross-check)

- Phase 0/0.5 ingest hooks — global error handler, asyncHandler, DLQ monitor, agent-run terminal-failed, connector polling, skill executor, LLM router. Behaviour preserved byte-for-byte. Only the `recordIncident` callable wrapper changes.
- Existing system-managed agents — Orchestrator (`migrations/0157`) and Portfolio Health Agent (`migrations/0068`). Not modified.
- AlertFatigueGuard / SystemIncidentFatigueGuard. Not modified — agent invocation rate-limit is its own logic per §9.9.
- WebSocket emitter / room model. Not modified — diagnosis updates fan out via the existing `system_incident:updated` event channel.
- Pulse `system_incident` kind. Not modified.
- Manual escalate-to-agent (Phase 0.5 §10.2). Reused by the auto-escalation path; no schema or behaviour change.
- Tenant-scoped tables (`agent_runs`, `skill_executions`, `connector_polls`, `llm_router_calls`, `pgboss.*`). Read-only access from the new system-principal context; no schema or write changes.

**Totals (indicative).** ~50-60 net-new server files, ~15-20 net-new client files (including tests), ~3-4 modified docs, ~6-8 modified server files, ~2 modified client files. Total file count is high because of one-module-per-heuristic, one-module-per-synthetic-check; total LoC remains bounded because each module is small and pure-function-shaped.

## 14. Testing strategy

Three layers — unit, integration, manual smoke. Each layer has explicit gating so the executor can self-verify each slice before handoff (§15.3). Coverage targets are stated as concrete invariants, not percentage goals.

### 14.1 Unit

Pure-function tests. Fast, deterministic, no DB, no network. CI-gating per architecture.md.

**Phase A:**

| Test target | Invariants asserted |
|---|---|
| `idempotency.ts` (§4.1) | 100 calls in 1s with same key → 1 ingest, 99 LRU hits. 2 calls 61s apart → 2 ingests (TTL respected). LRU eviction at 10,001st key drops oldest. Different fingerprints with same key → independent (key is `${fp}:${key}`). |
| `throttle.ts` (§4.2) | 100 calls in 1s with same fp → 1 ingest, 99 throttled. 2 calls 1.1s apart with same fp → 2 ingests. Map eviction at 50,001st unique fp → oldest drops, metric increments. Fingerprint isolation: cross-fp calls do not interfere. |
| `systemPrincipal.ts` (§4.3) | `getSystemPrincipal()` returns reference-equal singleton across calls. Principal carries `type='system'`, `isSystemPrincipal=true`, no PII. |
| `assertSystemAdminContext.ts` (§4.4) | Throws `UnauthorizedSystemAccessError` for: unauthenticated context, regular user context, org-admin context, subaccount-admin context. Passes for: system-principal context, sysadmin context with `system_admin.write` permission. |

**Investigate-Fix Protocol (§5):**

| Test target | Invariants asserted |
|---|---|
| `promptValidation.ts` (§9.8) | Rejects: missing required section, length below 200 chars, length above 6,000 chars, "git push" / "merge to main" / "auto-deploy" patterns. Accepts: full template with all required sections, length 400–800 tokens. |

**Heuristic registry (§6) and heuristics (§9.5, §9.6):**

| Test target | Invariants asserted |
|---|---|
| Each `Heuristic` module | Positive test (synthetic candidate that should fire → fires with expected confidence). Negative test (baseline-normal candidate → does not fire). `requiresBaseline` test (insufficient sample count → returns `insufficient_data`, does not fire). |
| Each suppression rule | Specific positive case (rule matches → fire suppressed, audit row written with `suppression_id`). |
| Registry index (§6.4) | All registered heuristics conform to the `Heuristic` interface (compile-time enforced; this is a runtime cross-check). Phase filter respects `SYSTEM_MONITOR_HEURISTIC_PHASES`. |

**Baselining (§7):**

| Test target | Invariants asserted |
|---|---|
| `baselineReader.ts` | Returns null on no row. `getOrNull` returns null when `sample_count < min`. Reads are read-only — no side effects. |
| Refresh-job pure helpers | Aggregate computation correct against fixture: p50, p95, p99, mean, stddev, min, max all match expected values for a known input set. UPSERT semantics verified at the integration layer. |

**Synthetic checks (§8):**

| Test target | Invariants asserted |
|---|---|
| Each check module (§8.2) | Positive test (condition is met → fires with expected severity, fingerprint override format correct). Negative test (condition not met → `fired: false`). Cold-start: no baseline → returns `fired: false` with skip log line, never fires false-positive. |

**Phase 2 triage (§9.2, §9.3):**

| Test target | Invariants asserted |
|---|---|
| `clusterFires.ts` | N fires on the same candidate → 1 cluster. Fires on N different candidates → N clusters. |
| `rateLimit.ts` | First two attempts within window → allowed. Third attempt → blocked, `agent_triage_skipped` event written. After window expires → counter resets. Auto-escalation respects guardrails — guardrail fail → `agent_escalation_blocked` event. |

**Client (§10):**

| Test target | Invariants asserted |
|---|---|
| `DiagnosisAnnotation.tsx` | Renders all five empty/awaiting states correctly per §10.3 mapping. |
| `InvestigatePromptBlock.tsx` | Copy button writes to clipboard mock. Markdown rendering preserves headings and code blocks. |
| `FeedbackWidget.tsx` | All three radio options enable Submit. Skip hides widget without server call. Submit posts correct payload, displays success state, persists across drawer re-open. |
| `DiagnosisFilterPill.tsx` | All four values map to expected query params. ANDs correctly with existing filters in the URL. |

### 14.2 Integration

DB required, full stack. Each test in its own transaction; rolled back at the end. Some tests need pg-boss in test mode.

**Phase A:**

| Test | What it proves |
|---|---|
| `systemPrincipal.integration.test.ts` | `withSystemPrincipal` sets the session-variable; SELECT against `system_incidents` works inside the wrapper, fails outside. SELECT against `agent_runs` returns rows (system principal has read access to tenant tables for monitoring). SELECT against tenant-write tables (e.g. `subaccounts`) without explicit grant returns RLS-denied. |
| `idempotencyEndToEnd.integration.test.ts` | Two `recordIncident` calls with same `idempotencyKey` and fp → exactly 1 row in `system_incidents`, 1 event row, occurrence count = 1. Same key + different fp → 2 rows. Different key + same fp → 2 occurrences (correct — distinct operations). |
| `throttleEndToEnd.integration.test.ts` | 100 fast calls with same fp → 1 row, 1 occurrence count, 99 throttled metrics. |
| Phase 0/0.5 regression suite | All existing Phase 0/0.5 tests still pass (no schema or behaviour regressions). Run as part of every CI build. |

**Phase 1:**

| Test | What it proves |
|---|---|
| `syntheticChecks.queueStalled.integration.test.ts` | Pause pg-boss processing for the threshold duration; tick produces an incident with `source='synthetic'`, fingerprint override per §8.3. Subsequent ticks within the bucket window do not duplicate (idempotency key works). |
| `syntheticChecks.coldStart.integration.test.ts` | Fresh test DB with no agents / connectors → ticks for 60 minutes, zero false-positive incidents written. |
| `syntheticChecks.heartbeat.integration.test.ts` | Tick 1 writes heartbeat. Manually advance clock 3× tick interval. Tick 2 reads stale heartbeat → fires critical incident. Self-check incident `metadata.isSelfCheck = true` set; Phase 2 triage does not auto-trigger (recursion guard). |
| `baselineRefresh.integration.test.ts` | Seed 100 agent_run rows; run refresh; verify `system_monitor_baselines` row created with correct stats. Re-run refresh; row updated, not duplicated. Window cutoff: rows older than 7 days excluded. |

**Phase 2:**

| Test | What it proves |
|---|---|
| `triageJob.incidentDriven.integration.test.ts` | Open an incident with `severity='high'`. Triage job dispatched within transaction. Agent run starts. `agent_diagnosis_added` event written within 60 seconds of incident open. `system_incidents` row has populated diagnosis fields. |
| `triageJob.sweepDriven.integration.test.ts` | Stage a soft-fail signal: agent run with empty output. Run a sweep tick. Heuristic `empty-output-baseline-aware` fires. Triage job dispatched. New incident created with `source='sweep'` (or appropriate). Diagnosis written. |
| `triageJob.rateLimit.integration.test.ts` | Open an incident with same fingerprint 3 times in 1 hour. First two trigger triage; third skipped (rate-limited). After 24h window: counter reset; new attempt triages. |
| `triageJob.autoEscalate.integration.test.ts` | Rate-limited incident with `severity='critical'` after window expires → auto-escalation event written, manual-escalate path invoked, escalation guardrails respected. |
| `triageJob.killSwitch.integration.test.ts` | Set `SYSTEM_MONITOR_ENABLED=false`. Open an incident. Triage job not dispatched (or, if pre-dispatched, handler short-circuits with `agent_triage_skipped` event). No agent run starts. |
| `sweepJob.cap.integration.test.ts` | Stage 100 candidates; sweep selects top 50 by confidence; emits `sweep_capped` event with `excess_count=50`. |
| `incidentFeedback.integration.test.ts` | Resolve agent-diagnosed incident → `recordPromptFeedback` mutation writes to `prompt_was_useful` + `prompt_feedback_text`, emits `investigate_prompt_outcome` event. Second submission returns 409. Non-sysadmin caller returns 403. |
| `promptValidation.integration.test.ts` | Agent run produces invalid prompt → write rejected, retry triggered, second invalid → `agent_triage_failed` event written, drawer shows failure state. |
| `agentSkillSet.integration.test.ts` | Verify the `system_monitor` agent's bound skill set has zero `destructiveHint: true` skills. CI gate. |

**RLS and access control:**

| Test | What it proves |
|---|---|
| `rls.systemMonitor.integration.test.ts` | Non-sysadmin user (regular, org-admin, subaccount-admin) cannot SELECT `system_monitor_baselines` or `system_monitor_heuristic_fires`. Non-sysadmin user cannot call any new mutation routes. |
| `rls.systemPrincipal.integration.test.ts` | System principal context can SELECT system tables, can INSERT into `system_incidents` (only via `recordIncident`), cannot INSERT into tenant tables. |

### 14.3 Smoke

Manual, run in staging, gating production deploy. Not CI-automated.

| Step | What to do | Pass criterion |
|---|---|---|
| 1. Phase A smoke | Trigger a fast retry loop (e.g. break a known route, hit it 100×/sec for 5s). | `system_incidents` shows 1 row with throttle metric incremented; not 100 rows. |
| 2. Synthetic queue stall | Pause one pg-boss queue worker for 6 minutes. | `pg-boss-queue-stalled` synthetic check fires; incident row appears in admin page with `source='synthetic'`. |
| 3. Synthetic heartbeat | Stop the synthetic-check job for 4 minutes; restart. | Tick after restart fires `heartbeat-self`; recursion guard prevents Phase 2 auto-triage on the resulting incident. |
| 4. Phase 2 incident-driven | Trigger a real high-severity incident (e.g. force a deliberate failure in a test agent). | Within 60s, drawer shows agent diagnosis + investigate prompt; `agent_diagnosis_added` event in audit log. |
| 5. Phase 2 sweep | Configure a test agent to return empty output. Trigger a run. | Within 5 minutes, sweep produces a triage; new incident with diagnosis appears. |
| 6. Prompt copy-paste | Copy the generated `investigate_prompt` from the drawer into a fresh local Claude Code session. | Claude Code reads the prompt, identifies the relevant files, follows the investigation steps without follow-up clarification. (This is the load-bearing manual test — it is the Investigate-Fix Protocol's only end-to-end validation.) |
| 7. Feedback widget | Resolve the agent-diagnosed incident from step 4. Submit `wasSuccessful='yes'` with linked PR URL. | `investigate_prompt_outcome` event row written with all metadata. Subsequent drawer open shows feedback summary. |
| 8. Rate-limit | Trigger the same incident fingerprint 3 times in succession. | First two triage; third skipped with `agent_triage_skipped` event. |
| 9. Kill switch | Set `SYSTEM_MONITOR_ENABLED=false`. Open a high-severity incident. | No triage. Page shows incident with "Auto-triage rate-limited or disabled" inline state. Reset switch; new incident triages normally. |
| 10. Cold-start | Spin up a fresh staging DB. Run for 60 minutes with no real activity. | Zero false-positive synthetic incidents. Zero baseline-dependent heuristic fires (all return `insufficient_data`). |

**Smoke checklist** lives in `tasks/builds/system-monitoring-agent/staging-smoke-checklist.md` (created in Slice D as part of the rollout-plan handoff). Every step has a pass/fail tickbox plus a notes column for observations.

**Re-run on every staging deploy** before promoting to production. The full suite is ~30 minutes of focused operator time. Acceptable for the deploy cadence.

**No load test in this spec.** Phase 0/0.5 covered the load test for the ingest path. The new layers (synthetic checks, sweep, agent triage) are bounded by their own caps (input cap on sweep, rate limit on triage, tick interval on synthetic). A load test of "100× the expected sweep candidate volume" is not flagged as needed for this spec — it is a Phase 3 readiness exercise if and when traffic patterns suggest it.

## 15. Rollout plan

The rollout plan describes how the four implementation sessions sequence into one PR, what each session must hand to the next, and how the executor self-verifies per slice. Slice content is in §17; this section is about the meta-process — order, handoff, verification.

### 15.1 Order of operations across sessions

**Slice ordering is fixed.** A → B → C → D. Each slice depends on artefacts the previous one produced; reordering would force backtracking.

| Slice | Sequence position | Why this order |
|---|---|---|
| **A — Foundations** | 1st | Idempotency, throttle, system-principal context, `assertSystemAdminContext`, schema additions, agent row seed. Phase 2 cannot run without system-principal context (§4.3). Phase 1 benefits from idempotency on the new synthetic-check ingest path. Schema changes land here so every later slice writes to the final shape. |
| **B — Phase 1 + protocol + registry + baselining** | 2nd | Synthetic checks, the Investigate-Fix Protocol doc + CLAUDE.md hook, the heuristic registry skeleton, the baselining primitive + refresh job. Slice C consumes all four. Synthetic checks are useful on their own (they generate incidents) but the agent that triages them is Slice C. |
| **C — Phase 2 day-one** | 3rd | Agent definition fully wired, triggers (incident-driven + sweep), day-one heuristic set (14 heuristics), prompt template, validation, rate limiting, UI extensions. Most of the user-visible value lands here. |
| **D — Phase 2.5 + finalisation** | 4th | Phase 2.5 cross-run/systemic heuristics (9 more), additional baseline metrics they need, rollout-readiness work: staging smoke checklist, architecture.md + capabilities.md updates, final pre-PR pass. |

**Slice deliverables flow into one PR.** No separate PRs per slice. The PR is opened only at the end of Slice D. Each slice is a sequence of commits on the same branch; the branch grows linearly across sessions.

**Why each slice ends in a `progress.md` write.** Sessions resume on different days, possibly with different operators. The handoff document carries the full state forward — what's done, what decisions were made under judgement during the slice, what the next slice is responsible for. Without it, the next session reverse-engineers from git log, which is brittle for any decision that was made-and-not-implemented.

**No `/compact` mid-session.** Per CLAUDE.md §12, context degrades before the hard limit. Each slice is sized to fit comfortably under the compact threshold. If a slice runs longer than expected, the executor pauses, writes `progress.md`, ends the session, and resumes on a fresh context — never attempts to compact.

**No mid-slice user check-ins.** Each slice runs end-to-end with the executor making judgement calls per the spec. The user reviews the result at slice end via the `progress.md` summary. If a hard architectural decision surfaces mid-slice that the spec doesn't anticipate, the executor stops and writes the question to `progress.md` rather than improvising — the same stuck-detection pattern from CLAUDE.md applies.

### 15.2 Session boundaries and `progress.md` handoff protocol

`progress.md` lives at `tasks/builds/system-monitoring-agent/progress.md`. It is the durable handoff artefact. One file, append-only summary at the top, full history below.

**What each session writes before ending:**

1. **Slice status:** which slice was just finished, what work landed, what remains (if the slice is partial).
2. **Decisions made under judgement during the slice:** anything where the spec was ambiguous and the executor made a call. Format: short bullet, with the decision + the alternative considered + why this one. Future sessions and the user can audit these.
3. **Issues surfaced for the user:** anything that would benefit from user input before the next slice. Flagged with a clear "USER ACTION:" prefix.
4. **State of the codebase:** verification commands run + their results. Lint/typecheck/test status at slice end.
5. **Next slice's starting point:** which slice is up next, where it picks up, what artefacts from this slice it consumes.

**Format conventions for `progress.md`:**

- The top of the file is a "current state" summary (what most readers want to see). Older slice handoff entries live below in reverse chronological order.
- No heavy frontmatter — this is a working document, not a publishable artefact.
- Tables for structured data (slice status, verification results); prose for decisions and rationale.
- No emojis. No filler. The reader is a future executor or the user — both want signal density.

**Example handoff entry shape (illustrative, not prescribed):**

```markdown
## Slice B handoff — 2026-MM-DD

**Status:** Slice B complete. Slice C begins next session.

**Landed:**
- Phase 1 synthetic checks (all 7 day-one checks).
- Investigate-Fix Protocol doc at docs/investigate-fix-protocol.md.
- CLAUDE.md §5.3 hook section added.
- Heuristic registry skeleton (types.ts, index.ts, empty arrays).
- Baseline refresh job + read API.

**Decisions made under judgement:**
- Synthetic check log-source: process-local rolling buffer (not durable
  store). Rationale: spec §2.8 acceptable for Phase 0.5; carried forward.
- Baseline refresh aggregate: single-query per source table (not per
  entity) — matches Drizzle batch-fetch pattern.

**Issues for user:**
- (none)

**Verification:**
- npm run lint — pass.
- npm run typecheck — pass.
- npm test (server/services/systemMonitor/**) — 47 tests, all pass.
- Smoke: synthetic queue-stall fires correctly in dev DB.

**Slice C starting point:** Heuristic registry has skeleton; populate with
day-one heuristic modules. Agent definition row already seeded by Slice A
migration. Trigger handlers (`system-monitor-triage`, `system-monitor-sweep`)
not yet wired — this is Slice C work.
```

**Handoff trigger conditions** (executor must write a handoff entry when):

- A slice completes (normal handoff).
- The session approaches the compact threshold (~50–60% per CLAUDE.md §12) — write a partial-slice handoff and end the session early.
- The executor hits a stuck state (per CLAUDE.md stuck-detection) — write a "blocker" handoff and ask the user.
- The user pauses the session (e.g. for environment maintenance) — write a paused-state handoff.

**Reading on resume.** New session starts by reading `progress.md` first. If the entry says "Slice X complete," resume at Slice X+1. If it says "Slice X partial" or "blocked," resume per the entry's instructions. If it says "paused," resume the same slice from the next outstanding item.

**No verbal handoff.** The user is not a state carrier between sessions. Anything the next executor needs to know lives in `progress.md`. The user reviews; they do not relay.

### 15.3 Verification commands per slice

Each slice has a fixed verification gate. The executor must run these before writing the handoff and marking the slice complete. Failures block the handoff — investigate root cause, do not bypass.

**Universal commands (run on every slice):**

| Command | When | Pass criterion |
|---|---|---|
| `npm run lint` | After every meaningful change; final at slice end | Zero errors. |
| `npm run typecheck` | After every meaningful TypeScript change; final at slice end | Zero errors. |
| `npm test` (or relevant suite) | After every logic change; final at slice end | All tests pass. |

If any command fails three times in a row with the same error, stop and write a stuck-state handoff. Do not retry-with-rephrasing.

**Slice-specific verification:**

| Slice | Additional commands | What they verify |
|---|---|---|
| A | `npm run db:generate` and inspect the generated migration file. Run `npm test -- server/services/__tests__/idempotency.test.ts server/services/__tests__/throttle.test.ts server/services/__tests__/systemPrincipal.test.ts server/services/__tests__/assertSystemAdminContext.test.ts`. | Migration applies cleanly to a fresh DB; all foundation invariants hold. |
| B | `npm test -- server/services/__tests__/syntheticChecks*.test.ts server/services/__tests__/baseline*.test.ts`. Validate `docs/investigate-fix-protocol.md` exists and renders cleanly. Validate CLAUDE.md §5.3 section parses. | Synthetic checks fire correctly; baseline reader/writer correct; protocol doc lands. |
| C | `npm test -- server/services/__tests__/heuristics.*.test.ts server/services/__tests__/triageJob*.test.ts server/services/__tests__/sweepJob*.test.ts server/services/__tests__/promptValidation*.test.ts server/services/__tests__/incidentFeedback*.test.ts`. `npm run build` (client) — verifies new components compile. CI gate: assert agent's bound skill set has zero `destructiveHint:true` skills. | Day-one heuristics, triage, sweep, prompt validation, feedback all functioning. UI builds. |
| D | All Slice C tests pass (regression). New Phase 2.5 heuristic tests pass: `npm test -- server/services/__tests__/heuristics.*2_5*.test.ts` (or matching pattern). Smoke checklist (`tasks/builds/system-monitoring-agent/staging-smoke-checklist.md`) ticked off in staging. `architecture.md` and `docs/capabilities.md` reflect the new state. | Phase 2.5 expansion lands without regression. Docs in sync per CLAUDE.md §11. Staging smoke verifies end-to-end. |

**Pre-PR commands (run after Slice D, before opening the PR):**

| Command | What it verifies |
|---|---|
| `npm run lint && npm run typecheck && npm test && npm run build` | Full local pass on the final state. |
| `git log main..HEAD --oneline` | Review every commit on the branch — readable, properly attributed, scope-aligned. |
| `git diff main...HEAD --stat` | Review the file-by-file diff size. Sanity check: anything outside the §13 inventory was modified for a reason captured in commit messages. |
| Architecture / capabilities doc check | `architecture.md` System Monitor section is present and accurate. `docs/capabilities.md` includes the new capability. CLAUDE.md §5.3 section is present. |
| `verify-idempotency-strategy-declared.sh` (or equivalent CI gate) | All new pg-boss queues have idempotency declared per architecture.md §Event-Driven Architecture. |
| `pr-reviewer` agent | Independent code review pass. (Caller invokes after the spec-conformance pass; per CLAUDE.md the user runs review tooling, not the executor mid-build.) |

**No CI bypass.** If any check fails, fix the root cause. Do not skip hooks (`--no-verify`), do not silence linter rules, do not mark tests `.skip`. The CLAUDE.md verification protocol applies in full.

**Manual smoke (Slice D):** the 10-step smoke checklist (§14.3) runs in staging before the PR is marked ready. Each step gets a tick or a fail-with-notes; failures block the PR.

## 16. Risk register

The risks below are the ones the build is most likely to mishandle if the executor optimises locally. Each entry names the failure mode, the likelihood-and-impact view, and the specific mitigation already designed into the spec — so the executor knows what they are protecting against, not just that risk exists.

| Risk | Likelihood | Impact | Where it bites | Mitigation in this spec |
|---|---|---|---|---|
| **False-positive fatigue** — the agent fires on noise often enough that operators stop reading its diagnoses | High | High | Operator workflow collapses; the whole project's value vanishes regardless of code quality | Per-heuristic `expectedFpRate` metadata (§6.3), per-heuristic suppression rules (§6.3), per-fire confidence threshold (§9.10), N≥10 baseline gate (§7.4), the feedback loop (§11) that surfaces miscalibrated heuristics, and the kill-switch hierarchy (§12.2) that lets operators disable a misbehaving heuristic without disabling the whole agent |
| **Sweep token cost runaway** — a busy day produces enough sweep candidates that the agent burns budget on noise | Medium | High | LLM cost line item spikes; pre-production budget exhausted before learning what works | Two-pass design (cheap pre-pass + deep-read on fire) (§9.3), 50-candidate / 200-KB hard caps per sweep (§9.3), per-fingerprint rate limit (§9.9), `SYSTEM_MONITOR_MIN_CONFIDENCE` floor (§9.10), `sweep_capped` event for visibility on excess (§12.1) |
| **Baseline cold-start** — fresh deploys produce false-positive storms because every signal looks anomalous against an empty baseline | Medium | Medium | The first hour after every deploy is noisy enough that operators tune out | `requiresBaseline` declarative gate per heuristic (§6.2), `minSampleCount` default of 10 (§7.4), heuristics that do NOT require a baseline are categorical (§9.5 — empty output, max-turns-hit, etc.), synthetic checks degrade to `fired: false` on missing baseline (§8.2 cold-start tolerance), success criterion S6 explicitly tests this |
| **System-principal blast radius** — a code path that uses `withSystemPrincipal` for purposes outside its intended scope leaks privileged reads or writes | Medium | High | Privilege escalation latent in the codebase; might be discovered only via incident | Singleton, immutable principal object (§4.3), session-variable RLS gate scoped to `system_*` tables only (§4.3), defence-in-depth `assertSystemAdminContext` on every mutation (§4.4), tenant-table writes always denied even for system principal (§4.3), integration test that confirms tenant-write access is denied (§14.2) |
| **Prompt quality drift** — agent prompts work on day one, then degrade as the codebase changes and the protocol doesn't evolve | Medium | Medium | Operators silently rewrite prompts in their head; the data we capture stops reflecting reality | Prompt validation rejects malformed output before write (§9.8), feedback widget captures `wasSuccessful` per resolve (§10.4), `investigate_prompt_outcome` event log (§11.2), iteration cadence in §5.5, protocol doc is git-versioned for audit |
| **Single-PR review surface** — one PR covering 11–13 days of work is harder to review than smaller PRs | High | Medium | Reviewer fatigue → either rubber-stamp (bad) or extended review cycle (slow) | Per-slice verification gates (§15.3) make each slice internally reviewable, commit-by-commit history is structured by slice, the `progress.md` handoff entries make slice intent traceable, the user has explicitly accepted the tradeoff (§2.4), and the spec passes ChatGPT spec review before the build starts so the reviewer's mental model is pre-aligned |
| **Agent loop / recursion** — the agent triages an incident it itself caused (e.g. agent run failure → incident → triage attempt → another failure → another incident) | Low | High | Runaway agent invocations + cost spike + audit log pollution | Self-recursion guard on `metadata.isSelfCheck` (§9.2), exclusion of `source = 'self_check'` from auto-triage (§9.2), per-fingerprint rate limit (§9.9), kill switch (§9.10) as last resort, the agent itself runs as system principal so its own runs are visibly distinct in audit, the `system-monitor-self-check` (Phase 0/0.5) catches downstream symptoms |
| **Heuristic registry churn** — frequent tuning lands as a steady stream of small PRs that overwhelm reviewers | Medium | Medium | Either every change is a long review cycle or the reviewer rubber-stamps; both fail | Tuning workflow is PR-based (§6.5) so reviewers see the audit data justifying each change; metadata-only changes are small diffs; the heuristic-fires audit table (§4.5) provides the data so PRs aren't speculative; eventual escape valve is Phase 3 runtime override (out of scope here) |
| **Sweep + idempotency interaction** — a duplicate sweep enqueue races with the in-flight one, producing two triage runs for the same candidate | Low | Medium | Two agent runs for one candidate; cost waste and confusing audit log | pg-boss `singletonKey` per `incidentId` / `bucketKey` (§9.2), idempotency key on triage enqueue per `sweep:<candidateKind>:<candidateId>:<bucketKey>` (§9.3), the integration test exercises concurrent enqueues (§14.2) |
| **Rate-limit auto-escalation loop** — auto-escalation past the rate limit creates a task that itself fails, producing a new incident that auto-escalates again | Low | High | Cascade of escalations; system-ops sentinel subaccount queue floods | Existing Phase 0/0.5 escalation guardrails — `escalation_count <= 3` cap and 5-min cooldown (§9.9), guardrail-blocked events are audit-visible (§12.1), the auto-escalation respects the same guardrails as manual escalation by reusing the same path |
| **WebSocket room membership stale on permission change** — operator demoted from sysadmin still receives `system_incident:updated` events until reconnect | Low | Low | Brief leak of incident metadata to a recently-demoted operator | Inherited from Phase 0/0.5 (`phase-0-spec.md §4.6`) as accepted limitation; no new exposure here. Documented in architecture.md TODO |
| **Synthetic-check log-source under-counting** — process-local rolling buffer means multi-instance deploys undercount across instances | Low | Low | Self-check threshold may need to be set lower than ideal in multi-instance mode | Documented limitation per `phase-0-spec.md §2.8` and inherited; multi-instance correction is Phase 3 work; for now the self-check is a safety net not a precision instrument |
| **`investigate_prompt` exfiltration** — a malformed prompt could embed sensitive data (correlation IDs, partial customer payloads) and an operator pastes it into a third-party Claude Code session that logs uploads | Low | Medium | Data leakage outside the platform's controlled boundaries | Agent system prompt forbids PII in prompts (§9.7), prompt validation could be extended to scan for known-PII patterns (Phase 3 enhancement, flagged not built), the operator workflow is explicitly local Claude Code (which is contractual), the protocol doc states the no-PII expectation explicitly |
| **Schema additions conflict with concurrent migrations** — another branch on `main` adds columns to `system_incidents` and the migrations conflict | Low | Low | Merge conflict; one branch rebases | Slice A migration is small (additive only), no column drops or type changes (§4.6), Drizzle generator handles ordering, the executor confirms migration number at write time per CLAUDE.md gate protocol |
| **`progress.md` handoff failure** — a session ends mid-slice without writing `progress.md`, next session re-discovers state from git log | Low | Medium | Wasted session time on rediscovery; risk of duplicating already-landed work | Handoff trigger conditions are explicit (§15.2), the executor writes `progress.md` before calling work complete, the user reviews `progress.md` before starting the next session and corrects gaps before resuming |

**What is NOT a risk in this spec.** A few worth naming explicitly:

- **Schema migration data loss.** All schema changes are additive. No backfill. No type changes. No constraint tightening on existing data. Rolling forward is safe; rolling back drops the new tables and columns and leaves Phase 0/0.5 intact.
- **Phase 0/0.5 regression.** No existing behaviour is modified. The only Phase 0/0.5 service touched is `recordIncident`, which gets a wrapper around it (idempotency + throttle); the underlying ingest path is unchanged.
- **Tenant data exposure.** The agent reads tenant tables read-only via system principal; the prompt validation rejects PII patterns; no skill writes to tenant data; no UI surfaces the agent's reads outside the system-admin page.
- **AlertFatigueGuard interaction.** The agent rate limit is its own logic and does not share state with the existing fatigue-guard infrastructure (which gates push channels — out of scope per NG1).

## 17. Implementation slicing & session pacing

This section is the **content** of each slice — what concretely lands in each session. §15 covered the meta-process (ordering, handoff protocol, verification gates); this section is the build manifest.

### 17.1 Slice A — Foundations

**Goal.** Land the substrate Phases 1 and 2 depend on. No user-visible change. All artefacts are dead-code-by-design until later slices wire them up.

**Estimated effort.** ~1 day of focused work.

**Deliverables in landing order:**

1. **Schema migration.** One file (`migrations/<NNNN>_phase_a_foundations.sql`) covering all of §4.5: new columns on `system_incidents`, the two new tables (`system_monitor_baselines`, `system_monitor_heuristic_fires`), the system-principal user seed, the `system_monitor` agent row seed, the new event-type enum values per §12.1, and RLS policies for the two new tables. Forward-only with a `.down.sql` mate per `phase-0-spec.md §6.3`.
2. **System principal module.** `getSystemPrincipal`, `withSystemPrincipal`, the AsyncLocalStorage wiring, the session-variable RLS interaction. Plus the integration test that confirms tenant-write access is denied even for system principal.
3. **`assertSystemAdminContext` guard.** Helper module + the typed error. Wired into every `system_incidents` mutation method as the first line — including the new `recordPromptFeedback` mutation (will be added in Slice C; placeholder only here).
4. **Idempotency layer.** LRU + TTL helper, with `IncidentInput.idempotencyKey?` field added to the existing `recordIncident` callable. Wraps the existing ingest path; no fingerprint algorithm change.
5. **Per-fingerprint throttle.** Process-local map + eviction policy + the metric. Same wrapper site as idempotency; throttle runs first, then idempotency, then existing ingest.

**Tests landed in this slice:**

- Pure unit tests for idempotency and throttle (per §14.1).
- System-principal singleton test, session-variable RLS test (per §14.1, §14.2).
- `assertSystemAdminContext` matrix (per §14.1).

**What is NOT in this slice.** No synthetic checks, no agent triggers, no UI changes, no protocol doc, no heuristic registry. All of those are Slices B and C.

**Verification gate.** Per §15.3 row "A". Must pass before handoff.

**Handoff.** `progress.md` entry includes: confirmed migration number; confirmed agent row landed; confirmed system principal can read system tables and is denied tenant writes. Outstanding for Slice B: synthetic checks, protocol doc, registry skeleton, baseline service.

### 17.2 Slice B — Phase 1 + Protocol + Registry + Baselining

**Goal.** Stand up the proactive sink (Phase 1) plus the substrate that Slice C consumes — the protocol contract, the heuristic registry skeleton, the baselining read+write API. Slice B is the largest non-Phase-2 slice because it covers four discrete subsystems.

**Estimated effort.** ~3 days of focused work, possibly split across two sessions if context pressure rises.

**Deliverables in landing order:**

1. **Investigate-Fix Protocol doc.** `docs/investigate-fix-protocol.md` per §5.1, §5.2. Full prompt-structure contract, required sections, forbidden content, worked example, iteration-loop note. Plus the §5.3 hook section appended to `CLAUDE.md`.
2. **Heuristic registry skeleton.** `server/services/systemMonitor/heuristics/types.ts` (full TypeScript interface per §6.2). `server/services/systemMonitor/heuristics/index.ts` exports `HEURISTICS: Heuristic[]` — empty array on land. Phase-filter helper (`SYSTEM_MONITOR_HEURISTIC_PHASES`) lands here so Slice C and D add heuristic modules without touching infrastructure code.
3. **Baselining primitive.** `system_monitor_baselines` table writes via the refresh job; reads via `BaselineReader` (§7.5). Refresh job tick at `SYSTEM_MONITOR_BASELINE_REFRESH_INTERVAL_MINUTES` (default 15). Compute helpers tested at the pure-function layer; UPSERT verified at the integration layer.
4. **Synthetic checks.** Seven day-one checks per §8.2, each as its own module under `server/services/systemMonitor/synthetic/`. The `system-monitor-synthetic-checks` job tick at `SYSTEM_MONITOR_SYNTHETIC_CHECK_INTERVAL_SECONDS` (default 60). Each check ships with positive + negative + cold-start unit tests. The handler wraps in `withSystemPrincipal` per §4.3.
5. **Audit table writes.** `system_monitor_heuristic_fires` table is populated by Slice C (heuristics fire), but the schema lands in Slice A. This slice does not write to it — flagged here so the table existence is not mistaken for unused.

**Tests landed in this slice:**

- Pure unit tests per heuristic module (none yet, registry is empty), per synthetic check module (all 7), and per baseline aggregate helper.
- Integration tests: synthetic queue-stall, synthetic cold-start, synthetic heartbeat, baseline refresh end-to-end (per §14.2).
- Cold-start smoke validation: 60 minutes against a fresh dev DB → zero false positives (per success criterion S6).

**What is NOT in this slice.** No agent triggers, no agent skills, no day-one heuristics (registry is empty), no UI changes (Phase 1 incidents render via existing Phase 0/0.5 page, no new components). All of those are Slice C.

**Verification gate.** Per §15.3 row "B". Must pass before handoff.

**Handoff.** `progress.md` entry includes: confirmed protocol doc and CLAUDE.md hook landed; confirmed registry types compile; confirmed baseline refresh ran successfully against dev data; confirmed synthetic checks fire correctly in dev. Outstanding for Slice C: the actual agent.

### 17.3 Slice C — Phase 2 day-one

**Goal.** The actual deliverable. The agent runs end-to-end: triggers, sweep, day-one heuristics, prompt template, validation, rate limiting, UI. Operator can resolve incidents and submit feedback. This is where the project's value materialises.

**Estimated effort.** ~5 days of focused work, almost certainly split across two sessions.

**Deliverables in landing order:**

1. **Agent skill set.** All 11 read+write skills per §9.4. Each skill is a small module with explicit `destructiveHint: false`. CI gate verifies the agent's bound skill set has zero destructive skills.
2. **Day-one heuristic modules.** All 14 heuristics per §9.5, each in its own module with metadata + `evaluate` + `describe` + suppressions. Added to `HEURISTICS` array. Each ships with positive + negative + (where applicable) `requiresBaseline` test.
3. **Triage handler.** `system-monitor-triage` job handler per §9.2 (incident-driven). Includes the conditional-enqueue logic (severity ≥ medium, not self-check, not rate-limited, not disabled), the agent-run dispatch, the prompt validation per §9.8 with retry-up-to-2 logic, the failure-mode events (`agent_triage_failed`, `agent_triage_skipped`), and the `agent_diagnosis_added` + `prompt_generated` events on success.
4. **Sweep handler.** `system-monitor-sweep` job handler per §9.3. Two-pass design (cheap pre-pass + deep-read on fire), 50-candidate / 200-KB caps, clustering, `sweep_capped` event on overflow. Idempotency keys per `sweep:<candidateKind>:<candidateId>:<bucketKey>`.
5. **Rate-limit logic.** Per §9.9 — per-fingerprint counter on the incident row, 24h rolling window, auto-escalation past the rate limit for high/critical incidents respecting Phase 0/0.5 escalation guardrails.
6. **UI extensions.** All four new components per §10: `DiagnosisAnnotation`, `InvestigatePromptBlock`, `FeedbackWidget`, `DiagnosisFilterPill`. Wired into `SystemIncidentsPage`. The `recordPromptFeedback` mutation route lands here (server-side per §10.4) plus the `?diagnosis=...` query param on the list endpoint per §10.5.
7. **`investigate_prompt_outcome` event.** Lands as part of the feedback mutation flow.

**Tests landed in this slice:**

- All Slice C tests in §14.1 and §14.2: heuristic positive/negative, triage incident-driven, triage sweep-driven, rate limiting, auto-escalation, kill switch, sweep cap, prompt validation, feedback mutation, RLS.
- Manual smoke step 4 (Phase 2 incident-driven), step 5 (Phase 2 sweep), step 6 (prompt copy-paste — load-bearing), step 7 (feedback widget), step 8 (rate-limit), step 9 (kill switch).

**What is NOT in this slice.** No Phase 2.5 heuristics (Slice D). No staging smoke checklist file (Slice D). No architecture.md or capabilities.md updates (Slice D, finalisation).

**Verification gate.** Per §15.3 row "C". Must pass before handoff. Includes the `npm run build` check on the client.

**Handoff.** `progress.md` entry includes: confirmed each of the 14 heuristics fires correctly in dev; confirmed end-to-end triage from incident-open to UI render; confirmed feedback mutation writes both schema and event; confirmed kill switch disables cleanly; the manual smoke steps that ran in dev with their results.

### 17.4 Slice D — Phase 2.5 expansion

**Goal.** Layer Phase 2.5 cross-run / systemic heuristics onto the registry. Add the additional baseline metrics they need. Land the rollout-readiness work — staging smoke checklist file, doc updates, pre-PR pass.

**Estimated effort.** ~2-3 days of focused work, typically one session.

**Deliverables in landing order:**

1. **Phase 2.5 heuristic modules.** All 9 heuristics per §9.6, each in its own module with metadata + `evaluate` + `describe` + suppressions. Added to `HEURISTICS` array. Each ships with positive + negative + `requiresBaseline` test.
2. **Additional baseline metrics.** Any metrics Phase 2.5 heuristics need that Slice B did not produce — for example, `cache_hit_rate` for `cache-hit-rate-degradation`, `success_rate` for `success-rate-degradation-trend`. Refresh-job code is extended; new metric modules lift into the existing computation pipeline.
3. **Staging smoke checklist file.** `tasks/builds/system-monitoring-agent/staging-smoke-checklist.md` per §14.3 — 10 steps with pass/fail tickboxes and notes columns.
4. **Architecture and capabilities doc updates.** `architecture.md` System Monitor Active Layer section per CLAUDE.md §11 doc-sync rule. `docs/capabilities.md` updated entry. Both land in this slice so the merged PR includes the docs in the same commit window as the code.
5. **Final pre-PR pass.** Run the §15.3 pre-PR command set. Open the PR.

**Tests landed in this slice:**

- All Phase 2.5 heuristic tests.
- Staging smoke checklist runs end-to-end against staging.
- Regression: all Slice C tests still pass.

**What is NOT in this slice.** No new code-paths beyond heuristics + their baseline metrics. No agent skill additions. No UI additions. The registry pattern means Phase 2.5 is mostly more `Heuristic` modules in more files; no infrastructure churn.

**Verification gate.** Per §15.3 row "D" plus the pre-PR command set. Must pass before opening the PR.

**Handoff.** `progress.md` entry switches from "slice handoff" to "spec complete, awaiting user review of PR." Final commit includes the doc updates and the `progress.md` close-out per the user's instructions.

### 17.5 Session handoff between slices

The mechanics of handing off between slices are covered in §15.2 (the protocol). This subsection captures the **content** the next session needs to pick up cleanly — what the previous session must have decided and recorded.

**Slice A → Slice B handoff.** The next executor needs to know:

- The migration number that landed (so Slice B doesn't pick the same one for any follow-on file).
- Confirmation that the system-principal user row + `system_monitor` agent row both exist in the dev DB (the executor reads `users WHERE is_system = true` and `agents WHERE slug = 'system_monitor'`).
- Confirmation that the new tables exist with their columns and RLS policies in place.
- Any architect-resolved file paths (Slice A may surface paths the spec deferred to architect; Slice B inherits them).

**Slice B → Slice C handoff.** The next executor needs to know:

- The protocol doc is on disk, CLAUDE.md hook is in place — the agent's prompt template (Slice C) imports the protocol structure directly from the doc's contract section.
- The registry types are stable — Slice C adds heuristic modules without changing the `Heuristic` interface.
- The baseline reader has API surface; Slice C heuristics call `getOrNull(entityKind, entityId, metric, minSampleCount)` and assume the reader returns null on insufficient samples.
- Any synthetic-check fingerprint patterns observed during Slice B that need to be honoured (e.g. if the queue-stalled check fingerprint is `synthetic:pg-boss-queue-stalled:queue:<name>`, Slice C heuristics that touch the same queue should not collide).

**Slice C → Slice D handoff.** The next executor needs to know:

- Which day-one heuristics in Slice C took longer than expected (signal for which Phase 2.5 heuristics may need extra calibration time).
- Any prompt-validation patterns observed during Slice C dev smoke that should land in the `forbidden patterns` list in Slice D (the prompt validation regex is extensible per §9.8).
- The agent's run loop behaviour under the rate-limit retry-up-to-2 logic — confirmed working in Slice C.
- Whether any Slice C tests are flaky or skipped, with their reason — Slice D inherits and either fixes or documents.

**Slice D → user (post-build).** The handoff at PR-open time is the final `progress.md` entry plus the PR description. Both should describe:

- The full set of slices that landed, with commit ranges.
- The verification commands that passed (output captured in the PR description so the reviewer doesn't have to re-run them).
- Any decisions made under judgement during the build (so the reviewer sees them inline).
- The smoke checklist results, attached or linked.
- Any Phase 3 follow-ups the build surfaced — captured to `tasks/todo.md` per the existing review-pipeline conventions.

**No `dual-reviewer` invocation by the executor.** Per CLAUDE.md, `dual-reviewer` runs only when the user explicitly asks. The executor's responsibility ends at "PR opened, smoke checklist passed, all verification green." The user runs `pr-reviewer` and (optionally) `dual-reviewer` as separate steps.

## 18. Out-of-scope (explicit)

These items are deliberate omissions, not deferred work. Naming them here prevents scope creep during the build and makes review faster — the reviewer does not need to ask "where is X?" if X is on this list.

**Push notification channels.** Phase 0.75 (email / Slack push delivery) is explicitly deferred indefinitely per Q1 §0.2. The operator workflow is page-based monitoring; adding push channels would add ~3-5 days for capability not used by the workflow. The `SystemIncidentFatigueGuard` extracted in Phase 0/0.5 is not invoked by anything in this spec — it sits dormant until and unless Phase 0.75 is reopened.

**Auto-remediation actions.** No skill in the agent's bound set has `destructiveHint: true`. The agent reads, diagnoses, annotates, emits prompts. It does not retry jobs, disable flags, restart connectors, revoke subaccounts, or change any state outside the diagnosis columns of the incident row it owns. This is the architectural hard line that separates Phase 2 from Phase 3. CI gate enforces it (§17.3 deliverable 1).

**Semantic-correctness LLM judge.** No heuristic in this spec asks an LLM "does this output make sense given this input." The cost lever (per-run LLM judge calls) and the prompt-engineering surface for the judge itself are out of scope. Phase 3.

**Multi-agent coordination heuristics.** Handoff failure between agents, state mismatch, duplicate work, conflicting outputs — none of these have heuristics in the day-one or Phase 2.5 sets. The schema preserves correlation-ID space (Phase 0/0.5 inherited) so a future phase can fire heuristics on that data without a schema change. Phase 3 design problem.

**Dev-agent handoff.** The "persistent_defect" classification path that Phase 0/0.5 introduced is preserved but unused. Nothing in this spec consumes it. Phase 4 — and Phase 4 depends on Phase 3 stable, so a meaningful timeline depends on the auto-fix gate signal accumulating from §11.

**Tenant-scoped monitoring.** This spec ships a system-scoped agent only. Per-tenant monitoring agents (an extension of the Portfolio Health Agent precedent that watches a single org's runs and produces tenant-scoped incidents) are not built. The system principal explicitly does not write to tenant tables. Phase 5+ if there is a need; not today.

**Real-time WebSocket push of agent diagnoses.** The Phase 0/0.5 WebSocket fans out incident-open / status-change events. Diagnosis annotations land via the same channel piggybacked on the existing event types — no new WS event type, no new client-side handler for "diagnosis just landed." The drawer re-renders on the existing `system_incident:updated` event when the incident changes; that includes the diagnosis fields.

**No new admin UI page.** All UI changes extend `SystemIncidentsPage`. No new route, no new navigation entry, no new dashboard. Per CLAUDE.md frontend principles, the diagnosis filter pill and the inline drawer blocks are the entire surface.

**No baseline storage in a tenant-partitioned table.** Baselines are global / system-scoped. Per-tenant baselines are Phase 3.

**No prompt versioning at runtime.** The Investigate-Fix Protocol doc is git-versioned. Generated `investigate_prompt` text does not carry a protocol-version stamp — drift is observable from `git log docs/investigate-fix-protocol.md`. If Phase 3 needs a stamp (e.g. to gate auto-fix to a specific protocol version), it is added then.

**No analytics view in this spec.** A sysadmin dashboard that visualises feedback rollups (per-heuristic FP rate over time, prompt effectiveness trend, week-over-week incident volume) is not built. The data is captured per §11; the visualisation is a Phase 3 deliverable, designed alongside the auto-fix gate.

**Deferred items inherited from PR #188.** The following items from the Phase 0/0.5 PR were deliberately not re-opened here:

| Item | Why still deferred |
|---|---|
| #2 — severity escalation in `recordIncident` (low → medium → high based on occurrence cadence) | The page-based monitoring workflow does not need it yet. Real signal is needed before tuning the cadence threshold. Revisit when feedback data shows operators miss recurring incidents. |
| #10 — badge cache for the nav badge | Nav badge currently re-queries on every page load. Performance is fine in pre-production. Add cache when query volume warrants it; not now. |
| #R3.3 — dual-count for `occurrence_count` (separate "raw" and "post-throttle" counters) | The §4.2 throttle metric is sufficient observability for now. A second column is over-instrumentation until tuning data demands it. |

**Items not in any of the above categories.** If something is on neither the "explicit deferred" list nor the "out-of-scope" list and not covered by Phases A/1/2/2.5 in this spec, it is a scope question the user resolves — not the executor.

## 19. Future phases (summary)

These are sketched here only to make the architectural choices in this spec legible — the Investigate-Fix Protocol pattern, the diagnosis-only contract, the feedback-loop schema, the system-principal context — and to clarify what is being deferred vs what is being foreclosed. Each future phase is its own design exercise; nothing here is committed.

### 19.1 Phase 0.75 — push notification channels (deferred indefinitely)

Email and Slack push delivery for incident notifications. Deferred per Q1 §0.2 because the operator workflow is page-based; push channels would add ~3-5 days of work for capability not currently used.

**Trigger to revisit.** Multiple operators with overlapping monitoring duties; monitoring fatigue from page-only checking; an incident that should have paged but didn't. None of these are present today.

**What this spec preserves for Phase 0.75.** The `SystemIncidentFatigueGuard` extracted in Phase 0/0.5 is unchanged. The `userSettings` schema for notification preferences was deferred in Phase 0/0.5 and remains deferred. When Phase 0.75 is reopened, the wiring slots into the existing fatigue-guard infrastructure without redesign.

### 19.2 Phase 3 — auto-remediation

The agent stops emitting prompts for the human and starts executing fixes itself, gated by accumulated evidence that its diagnoses are right often enough to trust unattended.

**Architectural lever.** The Investigate-Fix Protocol (§5) is already the contract. A server-side worker that follows the same protocol — reads `investigate_prompt`, executes `## Investigation steps`, produces a diff, applies it under a controlled deployment workflow — is the auto-fix executor. No protocol redesign; no agent prompt redesign. Just a new executor pointed at the same shared contract.

**Gate signal.** Per §11.3 — the percentage of agent-diagnosed incidents where `was_successful = 'yes' AND linked_pr_url IS NOT NULL` over a rolling 30-day window. Threshold tbd in Phase 3 design; expected to be 70-80%.

**Other Phase 3 work that depends on or enables this:**
- Semantic-correctness LLM judge (per-run output evaluation).
- Multi-agent coordination heuristics (handoff failure, state mismatch, conflicting outputs).
- Per-tenant baselines (so per-tenant agents have their own norms).
- A runtime override table for emergency heuristic suppression (per §6.5 forward note).
- An analytics dashboard for feedback rollups (per §11.3 forward note).
- A baseline history table (per §7.2 forward note) so drift detection works over months not hours.

Each of those is its own design problem. Phase 3 is not one PR; it is a phase boundary that contains several.

### 19.3 Phase 4 — dev-agent handoff

When the agent's diagnoses are reliably good and the auto-fix executor handles common cases, the next step is a development agent that takes the harder cases — diagnosed but unfixable-by-recipe — and produces a PR for human review.

**Architectural lever.** The "persistent_defect" classification from Phase 0/0.5 is the input. The `investigate_prompt` is the spec the dev agent works against. The Investigate-Fix Protocol is, again, the contract — but now with a more capable executor that can refactor, write tests, and propose architectural changes inside its `## Scope` block.

**Depends on Phase 3 stable.** No point in handing the dev agent ambiguous diagnoses; Phase 3 is the precondition.

### 19.4 Phase 5+ — tenant-scoped monitoring

A per-tenant monitoring agent that watches a single org's runs and produces tenant-scoped incidents (visible to org admins, not sysadmins). Extension of the Portfolio Health Agent precedent.

**Architectural lever.** The system-principal pattern (§4.3) and the monitoring agent shape (§9) generalise. A new agent with `scope='org'` and a per-org principal would inherit most of the infrastructure. Per-tenant baselines (Phase 3) are a precondition — the system-scoped baselines aggregate across all tenants and are not appropriate for per-tenant signals.

**No timeline.** Tenant-scoped monitoring is a new product surface, not just an internal extension. Phase 5 is a real product decision the team makes when it makes one — not a build that flows naturally from this work.

### 19.5 What stays unbuilt forever (probably)

A small list, mainly to close the loop on architectural conversations the team has already had:

- A "stop and wait for human approval" interrupt inside the agent's run loop. The agent runs to completion or fails; humans review at incident-resolve time. Approval gates inside the run cost more than they save.
- A "rollback the auto-fix" action surface. If Phase 3 ships, rollback is a normal git operation, not a UI action. The agent does not commit; the executor does, behind the deployment workflow's controls.
- A "let the agent author its own heuristics" surface. Heuristics are config-as-code with explicit metadata for a reason — author-best-guess values are inputs to the calibration loop. Agent-authored heuristics would short-circuit the loop. Out of scope, probably permanently.

---

## Spec Status

**Status:** Finalised — v1 (Execution Ready)
**Last review:** ChatGPT spec review, 4 rounds (2026-04-26)
**Total findings processed:** 30 (24 applied, 6 rejected, 0 deferred)
**Round 4 outcome:** Consistency / deduplication pass — no duplicate rules found that warrant collapsing. Cross-section restatements (§4.10 cross-cutting rules vs §9.x / §12.x local mechanisms) are complementary by design with explicit cross-references already in place. Spec locked.
**Next step:** implementation per §15 rollout plan (Slice A → B → C → D).

---

End of spec.

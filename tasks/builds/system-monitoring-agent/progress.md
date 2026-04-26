# System Monitoring Agent — Build Progress

**Branch:** `claude/add-system-monitoring-BgLlY`
**Last commit:** `8d83136` (spec sections 0-8)
**Last session ended:** 2026-04-26
**Next phase:** spec sections 9-19, then user-led spec review (NOT automated `spec-reviewer`).

## Current state

Drafting `tasks/builds/system-monitoring-agent/phase-A-1-2-spec.md`. Skeleton + sections 0-8 written. Sections 9-19 outstanding.

## What this build delivers (settled)

- Phase A foundations: idempotency at `recordIncident` (#1), per-fingerprint throttle (#5), system-principal context (Option B per phase-0-spec §7.4), `assertSystemAdminContext` (#R3.1), `investigate_prompt` schema column, baselining tables.
- Phase 1: `system-monitor-synthetic-checks` pg-boss tick + day-one synthetic check set.
- Phase 2: `system_monitor` agent (system-managed, scope=`system`), incident-driven + sweep-driven triggers, day-one heuristic set + Phase 2.5 cross-run/systemic expansion, Investigate-Fix Protocol-formatted `investigate_prompt` output.
- Cross-cutting: Investigate-Fix Protocol doc (`docs/investigate-fix-protocol.md`) + CLAUDE.md hook; heuristic registry as config-as-code; persistent baseline table refreshed every 15 min.

## What this build does NOT deliver (deferred)

- Phase 0.75 (email/Slack push) — deferred indefinitely. Page-based monitoring is the workflow.
- Phase 3 (auto-remediation), semantic-correctness LLM judge, multi-agent coordination heuristics — deferred.
- Phase 4 (dev-agent handoff) — deferred.
- Deferred PR-#188 items #2 (severity escalation), #10 (badge cache), #R3.3 (dual-count) — revisit when real signal demands.

## Delivery model

- **One branch** (`claude/add-system-monitoring-BgLlY`), **one PR at the end**.
- Execution staged across **multiple sessions** (one per slice A/B/C/D). Each session writes back to `progress.md` before ending.
- No mid-build `/compact`. User explicitly accepted larger end-of-build PR review surface as the trade-off.

## Spec sections completed

- §0 Decisions log (P1-P7 prereqs, Q1-Q14 resolutions, inherited decisions, three-internal-phases rationale, architect-deferred items)
- §1 Summary (vision, three phases, two cross-cutting primitives, non-goals, delivery model, ~11-13d estimate)
- §2 Context (vision recap, Phase 0/0.5 reuse table, critical gaps, architecture diagram, why one branch / four sessions / one PR)
- §3 Goals, non-goals, success criteria (GA.1-6, G1.1-5, G2.1-9, GU.1-4, GF.1-2, NG1-10, S1-15)
- §4 Phase A Foundations (idempotency LRU, per-fp throttle, system-principal Option B with RLS interaction, `assertSystemAdminContext`, schema additions table, migration outline)
- §5 Investigate-Fix Protocol (location/purpose, full prompt-structure contract, CLAUDE.md hook text, agent authoring instructions, iteration loop)
- §6 Heuristic Registry (module layout, full TypeScript interface, severity/confidence/FP-rate/suppression model, registration + invocation paths, PR-driven tuning workflow)
- §7 Baselining primitive (entity kinds + metrics, persistent table choice rationale, refresh job, N≥10 bootstrap requirement, BaselineReader read API)
- §8 Phase 1 Synthetic checks (job shape, day-one check set: pg-boss-queue-stalled, no-agent-runs-in-window, connector-poll-stale, dlq-not-drained, heartbeat-self, connector-error-rate-elevated, agent-run-success-rate-low; incident shape with fingerprintOverride; full env var table)

## Spec sections outstanding

- §9 Phase 2 — Monitor agent (day-one + 2.5). LARGEST remaining. Subsections:
  - 9.1 Agent definition (`system_monitor`, isSystemManaged=true, scope='system')
  - 9.2 Triggers — incident-driven (severity>=medium, exclude self-check) + sweep
  - 9.3 Sweep job (`system-monitor-sweep`, 5-min tick, 15-min window, max 50 runs / 200KB)
  - 9.4 Diagnosis-only skills (read recent logs, job queue health, failed agent runs, DLQ jobs, connector status — NO destructiveHint:true)
  - 9.5 Day-one heuristic set (Phase 2.0) — list: empty-output-baseline-aware, max-turns-hit, tool-success-but-failure-language, runtime-anomaly, token-anomaly, repeated-skill-invocation, identical-output-different-inputs, output-truncation, final-message-not-assistant, tool-output-schema-mismatch, skill-latency-anomaly, tool-failed-but-agent-claimed-success, job-completed-no-side-effect (CRITICAL), connector-empty-response-repeated
  - 9.6 Phase 2.5 expansion — cross-run/systemic: cache-hit-rate-degradation, latency-creep, retry-rate-increase, auth-refresh-spike, llm-fallback-unexpected, success-rate-degradation-trend, output-entropy-collapse, tool-selection-drift, cost-per-outcome-increasing
  - 9.7 Agent prompt template (Investigate-Fix Protocol consumer; references docs/investigate-fix-protocol.md verbatim; humility/confidence rules; 400-800 token target / 1500 hard cap)
  - 9.8 `investigate_prompt` output contract (per §5.2 structure; required vs optional sections; forbidden content)
  - 9.9 Rate limiting — max 2 invocations per fingerprint per 24h; persistent recurrence auto-escalates via existing manual-escalate path
  - 9.10 Kill switch (`SYSTEM_MONITOR_ENABLED`) + env var table

- §10 UI surface (extends existing SystemIncidentsPage — NO new page):
  - 10.1 Triage drawer additions
  - 10.2 `investigate_prompt` copy button
  - 10.3 Diagnosis annotation rendering (hypothesis, evidence links, confidence)
  - 10.4 Feedback widget — was-this-useful (captures wasSuccessful + freeText)
  - 10.5 Filter pill — Diagnosed by agent / Awaiting diagnosis / All

- §11 Feedback loop:
  - 11.1 Schema additions for prompt-was-useful (already in §4.5 table — cross-reference)
  - 11.2 New event type `investigate_prompt_outcome`
  - 11.3 What this trains for Phase 3 (auto-fix gate evidence)

- §12 Observability + kill switches:
  - 12.1 New event types: `agent_diagnosis_added`, `investigate_prompt_outcome`, `heuristic_fired`, `heuristic_suppressed`, `sweep_completed`, `triage_rate_limited`
  - 12.2 New env vars consolidated table (idempotency TTL, throttle ms, baseline interval/window, synthetic interval, monitor enabled, sweep interval/window/cap, min confidence, etc.)
  - 12.3 Logging conventions (kebab-case event names, structured logger.info with context)

- §13 File inventory — full list of new + modified files with brief purpose. Reference existing phase-0-spec.md §11 format. Include: server/services/systemMonitor/ tree, server/services/principal/systemPrincipal.ts, server/services/synthetic/ tree, migration file, agent definition seed, client/src/pages/SystemIncidentsPage.tsx (modified), CLAUDE.md (modified), docs/investigate-fix-protocol.md (new).

- §14 Testing strategy:
  - 14.1 Unit (heuristics positive/negative, idempotency, throttle, principal, assertions, synthetic checks)
  - 14.2 Integration (sweep produces incidents end-to-end, agent runs from triage trigger, RLS enforcement, baseline refresh)
  - 14.3 Smoke (queue stall scenario, soft-fail signal scenario, prompt copy-paste-into-Claude-Code manual test, kill-switch checks)

- §15 Rollout plan:
  - 15.1 Order of operations across sessions (Slice A → B → C → D)
  - 15.2 Session boundaries + progress.md handoff protocol — describe what each session must write to progress.md before ending
  - 15.3 Verification commands per slice (npm run lint, typecheck, test, build, db:generate)

- §16 Risk register — table form. Include: false-positive fatigue, sweep token cost, baselining cold-start, Option B principal-context blast radius, prompt quality is the product, system principal RLS bypass, single-PR review surface, agent loop-detection (rate limiting), heuristic registry churn cost.

- §17 Implementation slicing & session pacing:
  - 17.1 Slice A — Foundations (~1d)
  - 17.2 Slice B — Phase 1 + Protocol + Registry + Baselining (~3d)
  - 17.3 Slice C — Phase 2 day-one (~5d)
  - 17.4 Slice D — Phase 2.5 expansion (~2-3d)
  - 17.5 Session handoff between slices (write to progress.md, what to capture)

- §18 Out-of-scope (explicit) — restate non-goals + the deferred PR-#188 items #2, #10, #R3.3, plus the no-tenant-scoped-monitoring point.

- §19 Future phases (summary):
  - Phase 0.75 deferred indefinitely
  - Phase 3 auto-remediation (read the Investigate-Fix Protocol contract → server-side worker)
  - Phase 4 dev-agent handoff
  - Phase 5+ tenant-scoped monitoring

## Format conventions to maintain

- CEO-level prose. Cross-references to phase-0-spec.md sections where reused.
- Tables for everything that's a structured list (env vars, schema columns, heuristic IDs, success criteria, risks).
- TypeScript code blocks for interface contracts.
- No emojis.
- Headings match the skeleton already in the file. Do not renumber.
- Match the voice of the existing 0-8 sections (precise, decision-justified, defers UI/file-paths to architect).

## Constraints for the next session

- DO NOT run `spec-reviewer`. User explicitly said they will handle review themselves.
- DO NOT write any application code yet — this is the spec only.
- DO NOT run `architect`. Architect runs after the user reviews the spec.
- Continue committing each section to disk as you go (user-explicit override of the default no-auto-commit rule for this build only).
- Push to `claude/add-system-monitoring-BgLlY` after each commit.
- Use the chunked workflow (TodoWrite per section + Edit per section) per CLAUDE.md long-doc-guard.

## When the spec is complete

1. Update this `progress.md` to mark "spec complete, awaiting user review".
2. Commit the spec finalisation.
3. Hand back to user. Do NOT auto-invoke any review agent.

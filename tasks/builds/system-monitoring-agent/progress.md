# System Monitoring Agent — Build Progress

**Branch:** `claude/add-system-monitoring-BgLlY`
**Last commit:** `993b1211` (spec section 14 — testing strategy)
**Last session ended:** 2026-04-26 (paused mid-session for OAuth maintenance after §14)
**Next phase:** spec sections 15-19, then progress.md finalisation, then user-led spec review (NOT automated `spec-reviewer`).

## Current state

Drafting `tasks/builds/system-monitoring-agent/phase-A-1-2-spec.md`. Skeleton + sections 0-14 written. Sections 15-19 outstanding plus the final progress.md update.

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
- §9 Phase 2 Monitor agent (agent definition, triggers, sweep job, diagnosis-only skills, day-one + 2.5 heuristic sets, prompt template, output contract, rate limiting, kill switches)
- §10 UI surface (triage drawer additions, copy button, diagnosis annotation, feedback widget, filter pill)
- §11 Feedback loop (schema cross-reference, `investigate_prompt_outcome` event, Phase 3 input data)
- §12 Observability + kill switches (event-type table, env-var inventory, kill-switch hierarchy, logging conventions)
- §13 File inventory (new files, modified files, NOT-touched cross-check)
- §14 Testing strategy (unit invariants per target, integration tests with DB, manual smoke checklist)

## Spec sections outstanding

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

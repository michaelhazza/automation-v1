# System Monitoring Agent — Build Progress

**Branch:** `claude/add-system-monitoring-BgLlY`
**Status:** Spec complete. Awaiting user-led review.
**Last commit at spec-complete:** `daad199a` (spec section 19 — future phases summary)
**Spec file:** `tasks/builds/system-monitoring-agent/phase-A-1-2-spec.md`

## Current state

`tasks/builds/system-monitoring-agent/phase-A-1-2-spec.md` is **complete** — sections 0 through 19 written, formatted, and committed. The branch is clean and pushed to `origin/claude/add-system-monitoring-BgLlY`.

The next step is user-led spec review (NOT the automated `spec-reviewer` agent — user has explicitly opted out for this spec). After review and any directional edits, the user invokes `architect` to decompose the spec into the implementation plan; then implementation begins under the four-slice cadence (A → B → C → D) defined in §17.

## What this build delivers (settled)

- **Phase A foundations:** idempotency at `recordIncident` (#1), per-fingerprint throttle (#5), system-principal context (Option B per phase-0-spec §7.4), `assertSystemAdminContext` (#R3.1), `investigate_prompt` schema column, baselining tables.
- **Phase 1:** `system-monitor-synthetic-checks` pg-boss tick + day-one synthetic check set.
- **Phase 2 + 2.5:** `system_monitor` agent (system-managed, scope=`system`), incident-driven + sweep-driven triggers, day-one heuristic set + Phase 2.5 cross-run/systemic expansion, Investigate-Fix Protocol-formatted `investigate_prompt` output.
- **Cross-cutting:** Investigate-Fix Protocol doc (`docs/investigate-fix-protocol.md`) + CLAUDE.md hook; heuristic registry as config-as-code; persistent baseline table refreshed every 15 min.

## What this build does NOT deliver (deferred)

- Phase 0.75 (email/Slack push) — deferred indefinitely. Page-based monitoring is the workflow.
- Phase 3 (auto-remediation), semantic-correctness LLM judge, multi-agent coordination heuristics — deferred.
- Phase 4 (dev-agent handoff) — deferred.
- Phase 5+ (tenant-scoped monitoring) — deferred.
- Deferred PR-#188 items #2 (severity escalation), #10 (badge cache), #R3.3 (dual-count) — revisit when real signal demands.

## Delivery model

- **One branch** (`claude/add-system-monitoring-BgLlY`), **one PR at the end**.
- Execution staged across **multiple sessions** (one per slice A/B/C/D). Each session writes back to `progress.md` before ending.
- No mid-build `/compact`. User explicitly accepted larger end-of-build PR review surface as the trade-off.

## Spec sections written (0–19, all complete)

| § | Title | Brief |
|---|---|---|
| 0 | Decisions log | P1-P7 prereqs, Q1-Q14 resolutions, inherited decisions, three-internal-phases rationale, architect-deferred items |
| 1 | Summary | Vision, three phases, two cross-cutting primitives, non-goals, delivery model, ~11-13d estimate |
| 2 | Context | Vision recap, Phase 0/0.5 reuse table, critical gaps, architecture diagram, why one branch / four sessions / one PR |
| 3 | Goals, non-goals, success criteria | GA.1-6, G1.1-5, G2.1-9, GU.1-4, GF.1-2, NG1-10, S1-15 |
| 4 | Phase A Foundations | Idempotency LRU, per-fp throttle, system-principal Option B with RLS interaction, `assertSystemAdminContext`, schema additions table, migration outline |
| 5 | Investigate-Fix Protocol | Location/purpose, full prompt-structure contract, CLAUDE.md hook text, agent authoring instructions, iteration loop |
| 6 | Heuristic Registry | Module layout, full TypeScript interface, severity/confidence/FP-rate/suppression model, registration + invocation paths, PR-driven tuning workflow |
| 7 | Baselining primitive | Entity kinds + metrics, persistent table choice rationale, refresh job, N≥10 bootstrap requirement, BaselineReader read API |
| 8 | Phase 1 Synthetic checks | Job shape, 7 day-one checks, incident shape with fingerprintOverride, full env var table |
| 9 | Phase 2 Monitor agent | Agent definition, triggers, sweep job, diagnosis-only skills, day-one + 2.5 heuristic sets, prompt template, output contract, rate limiting, kill switches |
| 10 | UI surface | Triage drawer additions, copy button, diagnosis annotation, feedback widget, filter pill |
| 11 | Feedback loop | Schema cross-reference, `investigate_prompt_outcome` event, Phase 3 input data |
| 12 | Observability + kill switches | Event-type table, env-var inventory, kill-switch hierarchy, logging conventions |
| 13 | File inventory | New files, modified files, NOT-touched cross-check |
| 14 | Testing strategy | Unit invariants per target, integration tests with DB, 10-step manual smoke checklist |
| 15 | Rollout plan | Slice ordering, progress.md handoff protocol, per-slice verification gates |
| 16 | Risk register | Likelihood/impact + mitigation per risk; explicit non-risks |
| 17 | Implementation slicing & session pacing | Per-slice deliverables (A/B/C/D), tests landed per slice, inter-slice handoff content |
| 18 | Out-of-scope (explicit) | Push channels, auto-remediation, LLM judge, multi-agent heuristics, dev-agent, tenant-scoped, prompt versioning, analytics — all deliberate omissions |
| 19 | Future phases (summary) | Phase 0.75, Phase 3, Phase 4, Phase 5+, what stays unbuilt forever |

## Format conventions used

- CEO-level prose. Cross-references to phase-0-spec.md sections where reused.
- Tables for structured lists (env vars, schema columns, heuristic IDs, success criteria, risks, file inventory).
- TypeScript code blocks for interface contracts.
- No emojis.
- Headings match the skeleton; no renumbering.
- Voice consistent across all sections (precise, decision-justified, defers UI/file-paths to architect).

## Commit history (highlights)

- `8d83136e` — sections 0–8 (initial draft)
- `6b1c294c` — progress.md added for cross-session handoff
- `3684f280` — section 9 (Phase 2 monitor agent)
- `58af60f1` — section 10 (UI surface)
- `13101b34` — section 11 (feedback loop)
- `f43ebb7f` — section 12 (observability + kill switches)
- `d28d73ac` — section 13 (file inventory)
- `993b1211` — section 14 (testing strategy)
- `e80b61c7` — progress.md mid-session pause for OAuth
- `8d5f47a2` — section 15 (rollout plan)
- `3004219e` — section 16 (risk register)
- `a17e444f` — section 17 (slicing & session pacing)
- `a7537c05` — section 18 (out-of-scope explicit)
- `daad199a` — section 19 (future phases summary)
- *(this commit)* — progress.md finalisation

## Next steps for the user

1. Review the spec at `tasks/builds/system-monitoring-agent/phase-A-1-2-spec.md`.
2. Apply any directional edits directly. The CLAUDE.md no-auto-commit rule applies to user-side edits; this build's auto-commit override was scoped to spec authoring only.
3. When the spec is finalised, invoke `architect` to produce the implementation plan (`tasks/builds/system-monitoring-agent/implementation-plan.md` is from Phase 0; the architect output for this spec will be a new file or a new section there).
4. After the architect plan is reviewed, switch to Sonnet per CLAUDE.md model guidance and start Slice A under `superpowers:executing-plans` / `subagent-driven-development`.

## Constraints carried forward

- DO NOT run `spec-reviewer`. User explicitly handles review for this spec.
- DO NOT run `architect` until the user has reviewed the spec.
- DO NOT write any application code until the architect plan is in place.
- The auto-commit override during spec authoring was scoped to this build only — implementation reverts to the standard CLAUDE.md no-auto-commit rule (review agents excepted).

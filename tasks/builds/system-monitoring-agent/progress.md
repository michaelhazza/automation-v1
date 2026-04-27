# System Monitoring Agent — Build Progress

**Branch:** `claude/add-system-monitoring-BgLlY`
**Status:** Spec complete. Awaiting user-led review.
**Last commit at spec-complete:** `daad199a` (spec section 19 — future phases summary)
**Spec file:** `tasks/builds/system-monitoring-agent/phase-A-1-2-spec.md`

## Spec corrections

- Aligned Phase A spec narrative with actual codebase shapes pre-architect: PrincipalContext discriminator is `type` (not `scope`), `SystemPrincipal` is a new variant on the existing union, RLS session variable is `app.current_principal_type`, and `recordIncident` lives in `server/services/incidentIngestor.ts` (no `incidentIngest/` subdirectory).
- Post-merge audit of `main` after pre-launch hardening + audit-remediation-followups landed (89 commits, headed by PR #211 + PR #202 merge, branch tip `645f0a72`): rewrote §4.3 RLS interaction model — `system_*` tables intentionally bypass RLS (sysadmin-gated at route + service only, not via `current_principal_type='system'` PERMIT); cross-tenant reads from system-monitor jobs go through `withAdminConnectionGuarded({ allowRlsBypass: true, source, reason })` per the new B10 pattern; tenant-table RLS predicate has no `'system'` branch so `withSystemPrincipal` purpose is service-layer-guard uniformity + audit identity, not RLS toggling. Added §4.8 alignment block to the post-merge B2 job standard (top-of-file Concurrency + Idempotency model declaration; `pg_advisory_xact_lock(hashtext('<key>')::bigint)`); referenced the new verify gates (`verify-background-jobs-readiness`, `verify-principal-context-propagation`, `verify-rls-protected-tables`, `verify-rls-coverage`, `verify-migration-sequencing`, `verify-architect-context`); updated §4.6 step 7 (new tables follow `system_*` bypass pattern + must be added to `scripts/rls-not-applicable-allowlist.txt`); updated §4.7.1 failure modes to drop the stale "RLS denies system_* reads" claim; updated §14.2 + §16 risk-register narrative to match. Decisions log + scope + sequencing untouched.
- Final corrective pass: aligned spec with actual `users` schema (no `is_system` column — seed uses `role='system_admin'` in the `is_system_org=true` org) and actual permission shape (`PrincipalContext` carries no per-key `permissions` array; `system_admin` is a role that bypasses all permission checks per `server/lib/permissions.ts`). §4.4 `assertSystemAdminContext` admission now via Condition A (`type==='system'`) or Condition B (`actorRole==='system_admin'` plumbed from the route layer's existing `requireSystemAdmin` middleware), with the architect resolving whether `actorRole` is an explicit param or AsyncLocalStorage-channelled. Updated §0A glossary, §4.3 SystemPrincipal shape (uses `id` not `userId`, drops `permissions: ['system_monitor.*']`), §4.6 step 6 (correct INSERT shape), §14.1 test row, §17.1 Slice A handoff. Spec is now ready for the architect pass.

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

---

## Phase 0 Baseline Gate Results

**Run date:** 2026-04-27
**Gate runner:** npm run test:gates (52 gates)

**Pre-existing violations (not in build scope):**
- verify-permission-scope.sh: violations=13 — WARNING — pre-existing route middleware issues, not in system-monitor scope. DECISION: ignored.
- verify-input-validation.sh: violations=44 — WARNING — pre-existing input validation gaps, not in system-monitor scope. DECISION: ignored.
- verify-pure-helper-convention.sh: violations=9 — BLOCKING FAIL — pre-existing *Pure.test.ts convention violations in existing modules, not in system-monitor scope. DECISION: ignored (our new tests follow the convention).
- verify-no-silent-failures.sh: violations=7 — WARNING — pre-existing, not in scope. DECISION: ignored.
- verify-canonical-required-columns.sh: violations=4 — WARNING — pre-existing, not in scope. DECISION: ignored.

**Build-relevant gates (all green):**
- verify-principal-context-propagation.sh: violations=0 — PASS
- verify-background-jobs-readiness.sh: violations=0 — PASS
- verify-idempotency-strategy-declared.sh: violations=0 — PASS
- All remaining gates: PASS

**No pre-existing violations block Slice A work. No Slice A commit 0 needed.**

## Slice A — COMPLETE

All 5 commits implemented, spec-reviewed, quality-reviewed, and verified. Build passes (npm run build:server exits 0). No gates run mid-slice (per plan §1.3). Slice A handoff: all artefacts below are dead-code-by-design until Slice B/C/D wire them up.

### Commit 1: Schema migration 0233 + Drizzle schema
- migrations/0233_phase_a_foundations.sql — 8 new system_incidents columns, 2 new tables, enum widen, 3 seed rows
- migrations/0233_phase_a_foundations.down.sql — rollback (drops tables/columns, leaves seeds)
- server/db/schema/systemMonitorBaselines.ts — new (BYPASSES RLS)
- server/db/schema/systemMonitorHeuristicFires.ts — new (BYPASSES RLS)
- server/db/schema/systemIncidents.ts — 8 new columns + agentRuns FK reference
- server/db/schema/systemAgents.ts — executionScope widened to include 'system'
- server/db/schema/index.ts — 2 new exports
- scripts/rls-not-applicable-allowlist.txt — 2 new entries

### Commit 2: SystemPrincipal + getSystemPrincipal + withSystemPrincipal
- server/services/principal/types.ts — SystemPrincipal interface + PrincipalContext union extended
- server/services/principal/systemPrincipal.ts — promise-cache pattern, ALS, getCurrentPrincipal, __resetForTest

### Commit 3: assertSystemAdminContext guard
- server/services/principal/assertSystemAdminContext.ts — UnauthorizedSystemAccessError + assertSystemAdminContext (Condition A: type==='system', Condition B: actorRole==='system_admin' + principal != null)

### Commit 4: Guard wired into systemIncidentService mutations
- server/services/systemIncidentService.ts — 2 new imports + actorRole? param + guard on 6 mutation methods
- server/routes/systemIncidents.ts — req.user!.role passed to all 6 mutation call sites

### Commit 5: Idempotency LRU + per-fingerprint throttle
- server/services/incidentIngestorIdempotency.ts — new (TTL LRU, MAX_ENTRIES=10k)
- server/services/incidentIngestorThrottle.ts — new (THROTTLE_MS, MAX_FINGERPRINTS=50k)
- server/services/incidentIngestorPure.ts — idempotencyKey?: string added to IncidentInput
- server/services/incidentIngestor.ts — override validation + throttle + idempotency wired into recordIncident before isAsyncMode() branch
- server/services/__tests__/incidentIngestorIdempotency.test.ts — 7 tests, all pass
- server/services/__tests__/incidentIngestorThrottle.test.ts — 6 tests, all pass

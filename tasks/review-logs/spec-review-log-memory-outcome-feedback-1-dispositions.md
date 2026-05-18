# Iteration 1 — Per-finding dispositions

## ACCEPTED (mechanical) — 66

- F1 — Flag-off contradiction. Rewrote §1 G6, §3.7, §12, §17.7 to agree: dispatchers early-return; handler + recordOutcomeFeedback defensive; net behaviour is "no enqueue, no rows, no events" with optional `noop` terminal log.
- F2 — Approval singleton key. §10.1 keys approval enqueue by `decisionId`; §6.1 adds `decisionId` + `decidedAt`.
- F3 — Approval-to-run resolution. §3.4 + §6.4 acknowledge coarse task-level attribution; §2 + §18 add the per-artefact-attribution exclusion / deferral.
- F4 — `every([])` pitfall. §4.1 + §6.2 require `approvalsForTask.length > 0` for positive.
- F5 — Negative classification grouping. §6.2 explicit parentheses; §4.1 rephrased.
- F6 — Rollback in contracts but stubbed. §4.1 + §6.2 hard-wire `rollbackFiredForRun = false` in v1.
- F7 — Goal 5 vs §7 RLS posture. §1 G5 rewritten to "organisation at SQL via RLS, subaccount at service layer".
- F8 — RLS `WITH CHECK`. §5.1 + §7 add WITH CHECK.
- F9 — `current_setting` absence. §5.1 + §7 use the two-argument form.
- F10 — Cross-tenant FK integrity. §5.1 declares the tenant-consistency invariant as service-layer-enforced; composite FK deferred (§18).
- F11 — `real` -> `numeric(6,3)`. §5.1 schema updated.
- F12 — Weekly cap race. §4.3 adds `pg_advisory_xact_lock` keyed on `hash(orgId || ':' || entryId)`; §10.3 adds the scenario.
- F13 — Cap fuzz claim. §17 Criterion 3 narrowed to pure-helper fuzz; DB end-to-end fuzz deferred (§18).
- F14 — Flusher idempotency. §4.6 adds per-row 23505 handling; §10.1 / §10.6 updated.
- F15 — Terminal-event-vs-flush. §4.6 adds synchronous-flush hook so terminal fires after durable writes.
- F16 — Goal 3 "no events" vs terminal. §1 G3 rewritten; §10.4 adds `noop` status.
- F17 — `memory.retrieved` extension. Intro + §6.5 mark as observability-only; §16 lists emitter file.
- F18 — File inventory. §16 expanded: 4 new source + 4 new test + 12 modified + 1 stubbed + 1 fixture dir = 21 file touches + 1 migration.
- F19 — `withOrgTx` citation. §4.5 + §7 cite docs/spec-context.md.
- F20 — `sendWithTx` availability. §3.5 cites server/services/queueService/sendWithTx.ts.
- F21 — Approval refactor ordering. §3.5 adds before/after table.
- F22 — Scorecard payload vs canonical. §6.1 marks payload verdict as advisory.
- F23 — Missing `decidedAt`. §6.1 adds it.
- F24 — Missing `decisionId`. §6.1 adds it.
- F25 — Unused `artefactId`. §3.4 + §6.4 document as logged-not-filtered.
- F26 — `expected > 0` heuristic. §10.5 rewritten without the undefined field.
- F27 — Cancelled runs. §4.1 explains via verdict-null.
- F28 — Config migration semantics. §13 adds active-config-aggregation rule.
- F29 — `now()` vs replay. §4.3 / §4.7 / §13 thread `asOf`.
- F30 — Check 8 too strong. §14 redefines denominator as eligible runs.
- F31 — Check 9 tier join. §14 adds the JOIN; `tier_at_apply` deferred (§18).
- F32 — Check 9 clamp wording. §14 rewords as "configured base delta range".
- F33 — Check 10 source. §14 reads structured logs; `skipped` when log-source unavailable.
- F34 — Counter is a log. §11 + §6.5 reframe as "derived counter".
- F35 — `idempotent_skip` noise. §6.5 aggregates into `counts.idempotent`.
- F36 — `memory.retrieved` fields insufficient. §6.5 + §18 acknowledge richer fields as v2 deferred.
- F37 — Multi-source double counting. §10.3(b) clarifies UNIQUE `(run_id, entry_id, source)` is intentional.
- F38 — "Zero new write hot paths". ABCd Carry rewritten.
- F39 — Placeholders vs grounded claim. ABCd Build acknowledges 3 placeholders; §9 adds Chunk 0.
- F40 — Scope underestimates tests/fixtures. ABCd Build updated; §16 lists explicit test files + audit fixtures.
- F43 — `subaccount_id` nullable. §5.1 + §7 + §6.4 use IS NOT DISTINCT FROM; system-tier null permitted.
- F44 — Lookup index missing subaccount. §5.1 index now `(entry_id, organisation_id, subaccount_id, applied_at DESC)`.
- F45 — LIMIT 50 silent drop. §6.4 -> LIMIT 51 truncation detector; emits `fanout_cap_truncated`.
- F46 — Per-item verdict counts. §4.5 + §6.5 add `counts: { written, idempotent, capped, classifiedNone, noMemory, errors }`.
- F47 — Inconclusive job suppresses later. §10.1 keys scorecard singleton by `scorecardJudgementId`.
- F48 — Multiple judgements per run. Same fix as F47.
- F49 — Approval-source provenance. §5.1 adds `source_ref jsonb`.
- F50 — `verdict` column ambiguous. §5.1 adds `classification text`; renames `verdict` -> `scorecard_verdict` nullable.
- F51 — Rollback state source. §4.1 / §4.5.2 / §6.2 hard-wire `false` in v1.
- F52 — Migration number assignment. §9 adds Chunk 0; §7 + §16 lock manifest + filename together.
- F53 — Config history typing. §4.7 + §13 + §16 add normalisation layer.
- F54 — Config replay semantics. Same fix as F53.
- F55 — Window not named. §4.7 cites `config.reinforcementWindow`.
- F58 — Rollback path deploy-coupled. §12 documents startup-loaded config.
- F59 — DLQ / retry. §8 cites `failure:post-mortem` retry envelope.
- F60 — One service vs two. ABCd Build updated to "two service modules".
- F62 — Injected-ids validation. §4.5.1 adds UUID-array parse.
- F63 — Injected-ids dedupe. §4.5.1 adds dedupe.
- F64 — Injected-ids cap. §4.5.1 adds 200-entry cap + truncation event.
- F65 — `ON DELETE CASCADE` decision. §7 documents intent; SET NULL deferred (§18).
- F66 — Subaccount FK consistency. §5.1 tenant-consistency invariant covers; composite FK deferred.
- F67 — Event-name inconsistency `no_run_resolved`. All references use `memory.outcome_feedback.*` namespace.
- F68 — Event-name inconsistency `weekly_cap_saturated`. Same fix as F67.
- F69 — Status semantics missing `noop`. §10.4 adds `noop`; status precedence pinned.
- F70 — Post-terminal vs flusher logs. §10.4 scopes prohibition to handler correlation key.
- F72 — N+1 query risk. §4.7 batched `WHERE entry_id = ANY($1::uuid[])`.
- F73 — N+1 query risk. Same fix as F72.
- F74 — Negative `totalScore`. §4.7 documents no clamp; v1 only affects promotion.
- F75 — Effect-size example. §13 worked example.
- F76 — Threshold impact. §13 + §17 Criterion 8 added.
- F77 — "Decay only" imprecise. §2 + §1 G1 reworded.
- F78 — No confidence-field update. Intro + §2 reframe.

## RECLASSIFIED -> DIRECTIONAL (auto-routed via Step 7) — 8

- F41 — "Add migration/RLS tests, repository-level DB integration tests." AUTO-REJECT (framing). `docs/spec-context.md § runtime_tests: pure_function_only` + `convention_rejections: "do not add vitest / jest / playwright for own app"`.
- F42 — "Add explicit test case for memory_outcome_feedback_events" beyond manifest inheritance. AUTO-REJECT (framing). Same as F41; the manifest is the existing posture.
- F56 — "Initial outcomeFeedback weight 0; ramp after audit." AUTO-REJECT (framing). `staged_rollout: never_for_this_codebase_yet`.
- F57 — "Add staged enablement despite shared-flag coupling." AUTO-REJECT (framing). Same as F56.
- F61 — "reinforcementBatch is wrong abstraction; introduce dedicated repository." AUTO-REJECT (framing). `prefer_existing_primitives_over_new_ones: yes` + `convention_rejections: "do not introduce new service layers when existing primitives fit"`. Spec already justifies reuse (§4.6).
- F71 — "Split success criteria into pure tests and DB/integration tests." AUTO-REJECT (framing). Same as F41/F42.
- F79 — Rename table to `memory_outcome_feedback_applied_events`. AUTO-DECIDED reject. Table name describes the domain; the "applied" qualifier belongs in prose. Routed to tasks/todo.md.
- F80 — Trim provenance section. AUTO-DECIDED reject. §19 is informational and matches the existing repo convention. Routed to tasks/todo.md.

## REJECTED (mechanical) — 0

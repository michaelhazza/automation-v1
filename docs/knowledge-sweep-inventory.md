# KNOWLEDGE.md sweep inventory — 2026-05

**Source file:** `KNOWLEDGE.md` (3,785 lines, ~384 entries across both `### YYYY-MM-DD …` and `## Pattern …` heading styles).
**Sweep target:** ≤2,500 lines post-apply (per spec §5.C2 and plan §17).
**ADR cap:** ≤5 new ADRs (per plan §17). Next sequential ADR number: **0012** (post-codebase-health renumber: the workspace-inbound-webhook ADR moved to `0022-workspace-inbound-webhook-db-exception.md` to resolve a collision with the operator-backend chain-resume ADR at slot 0011).
**Builder verdict:** `INVENTORY_READY` — operator reviews this inventory and commits, then dispatches Chunk 12.B.

---

## Table of contents

- § Grouped entries — by domain tag
- § Proposed ADR promotions — five candidates (cap respected)
- § Defer ADR (under cap) — promotion-worthy but deferred this quarter
- § Duplicate / compression candidates — grouped pairs with rationale
- § Retained unchanged — bulk of the file
- Inventory verdict

---

## § Grouped entries

Entries grouped by primary domain. The same entry may legitimately touch two domains; assignment is by the dominant tag. Line references point at the entry's `###` heading line (or `##` heading for the trailing block).

### Domain: RLS / Tenancy / Org-scoping (~28 entries)

Entries about FORCE-RLS policies, `app.organisation_id` GUC, `withOrgTx`, `getOrgScopedDb`, admin-role bypass, cross-tenant isolation, subaccount scoping.

- L348 `2026-05-03 Pattern — GHL agency-level OAuth dual-table token architecture` (RLS-protected location_tokens table)
- L800 `[2026-04-25] Audit — Phantom RLS session variable pattern` (app.current_organisation_id vs app.organisation_id)
- L802 `[2026-04-26] Migration template — verify column existence on every target table` (RLS hardening corrective)
- L915 `2026-04-26 Gotcha — Adding getOrgScopedDb() to a log-and-swallow service must keep resolution INSIDE try/catch`
- L1003 `[2026-04-27] Decision — Risk-class split for cached-context isolation rollout (read-leak vs write-leak)`
- L1015 `[2026-04-27] Pattern — Bypass annotations bind to function name, not file` (RLS-bypass annotations)
- L1583 `[2026-04-29] Pattern — Join conditions on soft-deletable tables must always include deletedAt guard`
- L1622 `[2026-04-29] Pattern — Server-authoritative context updates: id is source of truth`
- L1624 `[2026-04-29] Convention — Every brief-creation route requires requireOrgPermission(BRIEFS_WRITE)`
- L1678 `2026-04-30 Gotcha — Agent permission scope must come from canonical actor row, not link table`
- L1758 `[2026-05-01] Pattern — Subaccount scope guards must use null-safe checks`
- L1812 `[2026-05-01] Pattern — External reviewers misread codebase canonical RLS without architecture.md context` (cited 3+ times)
- L1916 `[2026-05-03] Pattern — Observability-as-leverage: cross-provider filter field + lifecycle boundary log emits`
- L1930 `[2026-05-04] Pattern — Trigger-enforced caller-identity GUC for state-machine transitions`
- L2096 `2026-05-04 Gotcha — Cleanup jobs on FORCE-RLS tables MUST use withAdminConnection` (cited 3+ times)
- L2120 `2026-05-04 Pattern — 404 (not 403) for cross-subaccount disclosure prevention`
- L2156 `2026-05-05 Gotcha — db.transaction() opened from module-level pool runs WITHOUT GUC` (cited 3+ times)
- L2215 `2026-05-05 Gotcha — withOrgTx({tx: db}) in unauthenticated callbacks fakes ALS context without setting a GUC`
- L2570 `E.5 setOrgGUC — canonical replacement for withOrgTx({tx:db}) anti-pattern (2026-05-06)`
- L2899 `[2026-05-08] Pattern — Three-tier authority lock model for scorecards` (system > org > subaccount)
- L2906 `[2026-05-08] Pattern — Single-share-toggle visibility primitive` (org-share)
- L2945 `[2026-05-08] Pattern — Cross-subaccount IDOR slips past RLS in agent-scoped routes`
- L2954 `[2026-05-08] Pattern — Workers that opt out of createWorker auto-org-tx must wrap FORCE-RLS reads in short org-scoped tx`
- L3171 `[2026-05-09] Correction — four CI-only gates that G1 (lint + typecheck) misses` (includes verify-rls-coverage + verify-rls-contract-compliance)
- L3320 `[2026-05-09] Pattern — cross-tenant boot scans against FORCE-RLS tables silently no-op without admin role`
- L3376 `Pattern: Subaccount-scoped fallback UPDATE must filter by subaccountId, not just organisationId`
- L3717 `[2026-05-11] Gotcha — Permission-helper-tier mismatch: hasOrgPermission does NOT accept a SUBACCOUNT_PERMISSIONS.* constant`
- L222 `2026-04-22 Correction — "Key files per domain" table moved from CLAUDE.md to architecture.md` (RLS canonical anchor)

### Domain: Agent runs / Execution model (~28 entries)

`agent_runs`, agent_execution_events, agentic loop, lifecycle status, finalization, cancellation, IEE delegation, execution-backend adapter contract.

- L63 `2026-04-04 Pattern — Persist execution phase to agentRuns for observability`
- L164 `2026-04-21 Gotcha — agent_runs.hadUncertainty column exists but is never written; runtime value lives in runMetadata`
- L428 `2026-04-23 Pattern — Drizzle self-references break TS inference once a table crosses a width threshold` (agent_runs)
- L494 `2026-04-24 Pattern — Discriminator-trust contract for half-migrated payloads`
- L1185 `[2026-04-28] Post-commit winner-branch rule for dispatch on approval-resume (§1.3)`
- L1564 `[2026-04-28] Pattern — Use RETURNING to get fresh column values after UPDATE that races with concurrent write`
- L1572 `[2026-04-28] Pattern — cancelling is a transient non-terminal status`
- L987 `[2026-04-27] Pattern — Three-layer defence-in-depth for status writes (WHERE-guard / log-bridge / hard-assert)`
- L2126 `2026-05-04 Gotcha — agent_execution_events.run_id NOT NULL blocks task-level event persistence`
- L2146 `2026-05-05 Resolution — task_events table (migration 0279) closes the persistence gap`
- L2278 `2026-05-05 Pattern — logAndSwallow is "don't propagate", not "don't observe"`
- L2228 `2026-05-04 Correction — Riley waves ship independently`
- L2232 `2026-05-04 Pattern — F1 Sub-Account Baseline Artefacts (migration 0277)`
- L2787 `[2026-05-07] Gotcha — startRunAsync in agentExecutionService.ts uses bare fire-and-forget (non-durable)`
- L2942 `[2026-05-08] Pattern — Position-match against agent_execution_events.sequence_number is wrong for toolCallsLog`
- L3061 `[2026-05-09] Pattern — Monotonic-clock hysteresis for working time` (agentWorkingTimeService)
- L3070 `[2026-05-09] Pattern — Immutability GUC bypass for retention prune` (agent_observations)
- L3074 `[2026-05-09] Pattern — withOrgTx external side-effect boundary` (ieeSessionService)
- L3120 `[2026-05-09] Pattern — Paired-event accumulators need explicit stable identity` (agentWorkingTimeService)
- L3132 `[2026-05-09] Pattern — Permission-gated UI surfaces must fail closed during async permission load`
- L3411 `Pattern: actionRegistry directory-shim split (refactor-action-registry, 2026-05-10)`
- L3565 `Pattern: Domain-primitive registration must not be gated on queue-backend choice` (ExecutionBackend)
- L3571 `Pattern: Lifting code into a generic orchestrator drops the leaf side-effects`
- L3579 `Pattern: Capability-gated optional methods make adapter contract widenings cheap`
- L3587 `[2026-05-10] Pattern — Boot-time registration validation must be FATAL, not log-and-continue`
- L3595 `[2026-05-10] Pattern — Adapter-contract field semantics must match the migration intent`
- L3603 `[2026-05-10] Pattern — Verify route-error envelope behaviour before documenting HTTP shape in code comments`
- L3619 `[2026-05-10] Pattern — Capability mismatches that the registry should make impossible must THROW, not silently return false`
- L3611 `[2026-05-10] Pattern — When the plan says "rethrow if no existing race-loser shape exists", verify by searching origin/main first`

### Domain: Queues / Jobs / Scheduling (~16 entries)

pg-boss, advisory locks, singleton keys, retry, idempotency on background work, heartbeat/sweep semantics.

- L474 `2026-04-24 Gotcha — node --watch restart silently kills in-flight long-running LLM jobs`
- L612 `2026-04-24 Gotcha — Stale-job sweep window leaves a recovery-blocked gap for resume`
- L808 `[2026-04-26] Idempotency ≠ concurrency for jobs`
- L1644 `[2026-04-29] Pattern — Decay/increment-style UPDATEs are NOT idempotent; advisory lock must span mutation`
- L1650 `[2026-04-29] Pattern — Replacing advisory-lock+NOT-EXISTS dedup with ON CONFLICT requires explicit "no upstream side effects before insert" invariant`
- L1882 `[2026-05-04] Pattern — Shared register-X-schedule function for backfill + create-hook`
- L1908 `[2026-05-05] Bug — backfill advisory lock is session-scoped but acquired on a pool connection`
- L2133 `[2026-05-05] Pattern — System agents on a dedicated queue must be excluded from generic schedule registrar`
- L2139 `[2026-05-05] Pattern — Boot-time recovery summary log carries actionable counts, not a single integer`
- L2204 `2026-05-05 Pattern — Catch blocks around fire-and-forget enqueues must log; the enqueue itself does not`
- L2440 `2026-05-05 Pattern — Single-writer pg-boss job: connection-scoped singletonKey + cursor in payload`
- L2467 `2026-05-05 Pattern — Three-state job chain: terminal vs non-terminal checkpoint`
- L2528 `D.6 advisory-lock scope (2026-05-06)`
- L3472 `Pattern: PG advisory_xact_lock + partial unique index for singleton-per-tenant install` (cited 3+ times)
- L3488 `Pattern: Stable-slug discriminator beats UUID literal in partial unique indexes`
- L3518 `Pattern: Singleton-agent-per-subaccount — advisory lock + partial unique index on applied_template_slug`

### Domain: Heartbeats / Liveness / Background sweeps (~4 entries)

- L612 `2026-04-24 Gotcha — Stale-job sweep window` (cross-listed with Queues)
- L1572 `[2026-04-28] Pattern — cancelling is a transient non-terminal status` (cross-listed with Agent runs)
- L3074 `[2026-05-09] Pattern — withOrgTx external side-effect boundary` (cross-listed)
- L3320 `[2026-05-09] Pattern — cross-tenant boot scans against FORCE-RLS tables` (cross-listed)

### Domain: Migrations / Schema (~33 entries)

Migration discipline, schema invariants, partial unique indexes, Drizzle vs SQL drift, FK/CHECK semantics.

- L150 `2026-04-21 Gotcha — Application-level dedupe must ORDER BY or it's non-deterministic`
- L186 `2026-04-21 Gotcha — SELECT FOR UPDATE only locks EXISTING rows`
- L190 `2026-04-21 Gotcha — Tighten terminal-transition WHERE to equality, not negation`
- L196 `2026-04-21 Decision — Runtime /^v\d+$/ assert on IDEMPOTENCY_KEY_VERSION`
- L428 `2026-04-23 Pattern — Drizzle self-references break TS inference once a table crosses a width threshold` (cross-listed)
- L733 `[2026-04-25] Gotcha — Partial unique index predicate must match the upsert WHERE clause exactly` (cited 3+ times)
- L802 `[2026-04-26] Migration template — verify column existence on every target table` (cross-listed)
- L806 `[2026-04-26] Cross-service null-safety contract for derived data`
- L1644 `[2026-04-29] Pattern — Decay/increment-style UPDATEs are NOT idempotent` (cross-listed)
- L1722 `[2026-05-01] Pattern — Resolver version belongs in the cache key, not a metadata column only`
- L1955 `[2026-05-04] Pattern — DB-layer idempotency (partial UNIQUE + 23505 catch) beats API-layer idempotency`
- L1975 `[2026-05-04] Pattern — Pre-insert + post-resolution-snapshot for state-machine rows that need to lock during creation`
- L1987 `[2026-05-04] Rule — Do not introduce "future-use" schema columns without active invariants`
- L2532 `[2026-05-06] Gotcha — GHL subaccount INSERTs that omit external_id_namespace bypass partial unique index`
- L2551 `[2026-05-06] Pattern — Migration RAISE EXCEPTION safety checks must be scoped to rows migration targets`
- L2674 `[2026-05-07] Gotcha — PostgreSQL READ COMMITTED snapshot is per-statement, not transaction-scoped`
- L2696 `[2026-05-07] Spec authoring — body hash canonicalisation must include Unicode NFC`
- L2850 `[2026-05-08] Pattern — Migration-number collision after S2 sync requires renaming on the feature branch` (cited 3+ times)
- L2864 `[2026-05-08] Pattern — App.tsx route-handler regression after upstream page deletions during S2 sync`
- L2837 `[2026-05-08] Pattern — Targeted onConflictDoNothing(target) for partial-unique idempotency`
- L2913 `[2026-05-08] Pattern — Idempotent UPSERT on operator correction capture`
- L3232 `[2026-05-09] Pattern — deferred-FK migration when two new tables reference each other (cross-cycle)`
- L3250 `[2026-05-09] Pattern — polymorphic FK splitting in Postgres (no native support)`
- L3275 `[2026-05-09] Pattern — polling absence ≠ deletion; tombstoning requires either webhook or strict full-reconciliation`
- L3301 `[2026-05-09] Pattern — symmetric ingest paths must both implement the same FK / CHECK contracts`
- L3496 `Pattern: COALESCE optional canonical-layer watermarks in NOT-EXISTS predicates`
- L3692 `Pattern: Migration-number collision after S2 sync requires renumbering forward, not backward`
- L3699 `[2026-05-10] Correction — apply defence-in-depth patterns consistently across siblings; cross-check Drizzle schema against migration`
- L792 `[2026-04-25] Audit — Schema-as-leaf circular dependency root cause`
- L3402 `Pattern: Service-layer circular import — extract shared types into a neutral file`
- L3504 `Pattern: Worker-internal iee_artifacts vs customer-delivery run_artifacts source-of-truth precedence`
- L3763 `## DB CHECK constraints require a pure application-level transition classifier`
- L2185 `2026-05-05 Gotcha — db.execute(sql\`...\`) returns QueryResult, not a bare array`

### Domain: Testing / CI gates / Vitest (~25 entries)

Test conventions, fixtures, CI grep gates, Vitest discovery, harness patterns, env-seeding.

- L168 `2026-04-21 Gotcha — React Testing Library is ABSENT; don't treat a spec's "framing deviation" as dep approval`
- L1382 `[2026-04-28] Pattern — Test harness register/restore: prior-state capture beats unique-key discipline` (superseded)
- L1411 `[2026-04-28] Pattern — Fake HTTP receiver: body-fully-read + lowercase-header-keys are load-bearing invariants`
- L1425 `[2026-04-28] Pattern — Dual-layer assertions (HTTP + DB) defeat single-layer false-passes`
- L1437 `[2026-04-28] Convention — Pure tests assert on TS-shape; integration tests assert on DB-shape`
- L1444 `[2026-04-28] Correction — Test harness register/restore needs STACK semantics, not closure-captured prior state` (supersedes L1382)
- L1468 `[2026-04-28] Pattern — Co-located cleanup helper with scope-safety pre-flight + post-flight count match`
- L1480 `[2026-04-28] Pattern — Dual-layer assertion via mock.method spy at the boundary BEFORE the side-effect site`
- L1537 `[2026-04-28] Pattern — .match() vs .matchAll() for regex extraction inside a scan loop`
- L1542 `[2026-04-28] Pattern — Lazy ESM registry import for test files that have env-free and env-dependent sections`
- L1694 `[2026-04-30] Pattern — Test-runner-API leaks survive a runner cutover; gate the new runner's contract` (vitest migration)
- L1698 `[2026-04-30] Pattern — Hardcoded UUIDs in integration tests require explicit seeding, not shared assumption`
- L1702 `[2026-04-30] Decision — Gate-script regexes that match path segments must use (^|/)segment/`
- L1798 `[2026-05-01] Gotcha — ESLint flat config global rule insertion is silent if placed in the wrong position`
- L1794 `[2026-05-01] Pattern — Implementation spec hard stop conditions must use explicit "stop" language`
- L1726 `[2026-05-01] Gotcha — CRLF line endings in gate fixture files cause grep pattern mismatch`
- L1730 `[2026-05-01] Gotcha — verify-integration-reference gate requires primary slugs, not taxonomy aliases`
- L2095 `2026-05-04 Pattern — Single chokepoint for INSERT into a uniqueness-protected table` (CI grep gate companion)
- L2376 `[2026-05-05] Pattern — Branded type with single-constructor invariant beats grep gates for input-normalisation enforcement`
- L2405 `2026-05-05 Pattern — Factory const-object as the ONLY source for closed string-enum values`
- L2587 `Closed-enum string-grep gates need a dedicated dynamic-construction pass`
- L2609 `The "indirect constant aliasing" bypass class is doc-only enforcement, not grep-detectable`
- L3171 `[2026-05-09] Correction — four CI-only gates that G1 misses; comply WHILE writing, not after` (cited 3+ times)
- L3199 `[2026-05-09] Sub-pattern — verify-pure-helper-convention.sh requires .js extension on relative imports`
- L3775 `## CI grep gates authored in code must be wired into a workflow before merge`
- L3676 `Pattern: Stale regression tests survive when the test mocks the consequence rather than the implementation`
- L3683 `Pattern: Sister-branch reconciliation via transitional overloads needs explicit dual-mode test coverage`
- L3553 `Pattern: Cycle-prevention regex must anchor on the exact filename, not a substring`

### Domain: Routes / Services / Architecture (~32 entries)

Service-layer contracts, route handlers, error envelopes, log conventions, single-writer rules, validators, action registry.

- L142 `2026-04-21 Gotcha — "Idempotent retry" that wipes state before re-processing is NOT idempotent`
- L194 `2026-04-21 Pattern — Soft circuit breaker for fire-and-forget persistence`
- L178 `2026-04-21 Gotcha — pair visibility + aggregation in one atomic scan, not two queries`
- L182 `2026-04-21 Gotcha — "hard ceiling" means >=, not >, when the check is post-cost-record`
- L255 `2026-04-22 Pattern — When two layers consume the same user intent, share the normaliser as a single utility`
- L258 `2026-04-22 Pattern — One terminal event per logical run: separate "structured log" status events from "execution-log completion" projection`
- L264 `2026-04-22 Pattern — Split external-UX error code from internal-analytics error subcategory`
- L266 `2026-04-22 Pattern — One top-level execution-mode flag on a staged trace beats nested per-stage inspection`
- L278 `2026-04-22 Pattern — Mutation-path skeleton: pure → validate → guard → write → signal → test`
- L378 `2026-04-23 Pattern — Engine drift from contract is the dominant failure mode once the spec is clean`
- L396 `2026-04-23 Pattern — Defence-in-depth composition enforcement: authoring-time validator + runtime dispatcher guard`
- L410 `2026-04-23 Pattern — Best-effort telemetry writes need a named swallow point + distinct WARN tag per surface`
- L418 `2026-04-23 Pattern — Stable contract payloads need a serialised-size bound when they admit array-valued diagnostic fields`
- L454 `2026-04-23 Pattern — Lock orthogonal-subsystem composition contracts explicitly at merge time`
- L466 `2026-04-24 Correction — Consolidate duplicated code paths in situ, don't patch one path`
- L515 `2026-04-24 Pattern — Migration-endgame phasing for "introduce → fallback → warn → measure → remove"`
- L538 `2026-04-24 Pattern — Stable warn codes with surface.signal namespacing for observable migrations`
- L756 `[2026-04-25] Convention — Tagged-log-as-metric is the project's metrics convention` (cited 3+ times — FUNDAMENTAL)
- L1094 `[2026-04-28] Pattern — "Suppression is success" under single-writer invariants` (cited 3+ times — FUNDAMENTAL)
- L1157 `[2026-04-28] Pattern — Post-commit websocket emit primitive via AsyncLocalStorage`
- L1169 `[2026-04-28] Ledger-canonical / payload-best-effort consistency contract (§1.1 LAEL)` (cited 3+ times)
- L1228 `[2026-04-28] Lock the contract you already have — single canonical block over implied-across-comments`
- L1300 `PR #215 round 3 #3 (system-monitor): defer-enrichment is a valid technical auto-apply path`
- L1302 `[2026-04-28] Dev-tool LLM CLIs bypass the production llmRouter on purpose`
- L1314 `[2026-04-28] dataPartial signal — distinguish "intentional null" from "fetch errored" in aggregator APIs`
- L1332 `[2026-04-28] Verdict header convention — make agent outputs machine-readable`
- L1600 `[2026-04-29] Pattern — Server typecheck requires -p server/tsconfig.json; root tsc only covers client/src`
- L1750 `[2026-05-01] Pattern — URL path params extracted in route handler must appear in every relevant WHERE clause`
- L2106 `2026-05-04 Pattern — Server-side validation parity via shared module`
- L2820 `[2026-05-08] Pattern — Closed-enum service-boundary mapping for typed error.code contracts`
- L3384 `Pattern: Stable structured-log codes must use logger.info, never console.log`
- L3353 `Pattern: First-resolver-wins UPDATE on per-run JSONB snapshots requires snapshot.organisationId as the predicate source`

### Domain: Auth / OAuth / Sessions / Webhooks (~15 entries)

OAuth state, JWT semantics, webhook delivery, signature verification, replay, sessions.

- L350 `2026-05-03 Gotcha — OAuth state must carry orgId + nonce; callback must not derive org from session`
- L354 `2026-05-03 Gotcha — Webhook event dedupe row MUST commit AFTER side effects, not before`
- L1716 `[2026-05-01] Gotcha — chatgpt-pr-review automated mode must use the same diff exclusions as manual mode`
- L1948 `[2026-05-04] Pattern — Webhook connectionStatus allowlist (NOT exclusion-list) when secret persists across state changes`
- L2169 `2026-05-05 Pattern — app.set('trust proxy', N) MUST be a hop count, not true`
- L2240 `2026-05-05 Pattern — Sentinel-row dependencies are validated at boot, not caught at write time`
- L2251 `2026-05-05 Pattern — JWT iat invalidation comparisons must align both sides to whole seconds`
- L2262 `2026-05-05 Pattern — Per-route body-size caps install BEFORE the global JSON parser, not after`
- L2310 `2026-05-05 Pattern — Two-layer rate-limit key normalisation is intentional defence-in-depth, not redundant`
- L1628 `[2026-04-29] Pattern — DB-canonical now_epoch must be threaded through any time-delta computation derived from a rate-limit check` (cited 3+ times)
- L1746 `[2026-05-01] Pattern — Token-based idempotency breaks when the token is consumed before the idempotency check runs`
- L3733 `[2026-05-11] Gotcha — DB-time bucket queries must fail closed; never fall back to Date.now()`
- L3650 `Pattern: Separate usability_state (broker gate) from plan_verification_status (audit signal)`
- L3705 `## usability_state vs plan_verification_status implementation — two columns, two writers, two read paths`
- L1656 `[2026-04-29] Correction — Brief + GlobalAskBar + orchestrator IS the single-prompt fan-out primitive`

### Domain: Tooling / Review agents / Pipeline (~43 entries)

ChatGPT review, dual-reviewer, spec-reviewer, pr-reviewer, coordinator playbooks, diff misreading, finalisation discipline.

- L111 `2026-04-17 Gotcha — Rebase with merge conflicts can leave duplicate code visible in PR diff`
- L115 `2026-04-17 Correction — Verify reviewer feedback against the PR diff perspective`
- L119 `2026-04-17 Gotcha — GitHub unified diff format is commonly misread as "both lines present"`
- L128 `2026-04-18 Correction — "Execute the prompt" means invoke the pipeline, not critique the prompt`
- L132 `2026-04-19 Correction — Don't invoke dual-reviewer from within this environment`
- L200 `2026-04-22 Decision — Interactive review agents must surface decisions to screen; walk-away agents auto-defer` (cited 3+ times)
- L204 `2026-04-22 Pattern — Architectural checkpoint needs a size filter to avoid over-blocking interactive agents`
- L208 `2026-04-22 Pattern — Pending decision registers prevent architectural decisions from being lost across rounds`
- L212 `2026-04-22 Convention — _index.jsonl must only receive final decisions`
- L216 `2026-04-22 Pattern — Contract-vs-spec separation in chatgpt-spec-review: defer cross-branch findings, apply in-spec ones`
- L226 `2026-04-22 Gotcha — Spec auto-detection exclusion list must include known non-spec task files`
- L274 `2026-04-22 Decision — Mixed-mode review agents (auto-fix mechanical, route directional) are a new fleet pattern`
- L302 `2026-04-23 Correction — UI mockups surfaced every backend capability as a dashboard` (cross-listed with Frontend)
- L306 `2026-04-23 Pattern — Spec review arc converges on additive invariants after structural work lands` (cited 3+ times)
- L338 `2026-04-23 Pattern — ChatGPT PR-review re-raises previously-adjudicated items` (cited 3+ times — FUNDAMENTAL)
- L365 `2026-04-23 Pattern — Architecturally-sound PRs often need only one round of external PR review`
- L440 `2026-04-23 Pattern — Review-finding triage (technical vs user-facing) for high-volume review loops` (cited 3+ times)
- L666 `2026-04-24 Gotcha — ChatGPT reviewers hallucinate "duplicate line" bugs by reading unified diffs as final state` (cited 3+ times — FUNDAMENTAL)
- L690 `2026-04-24 Convention — Don't spot-fix a string if a deferred refactor already replaces the pathway`
- L820 `[2026-04-26] Pattern — ChatGPT spec review reject ratio rises by round; trust the explicit stop signal`
- L827 `[2026-04-26] Pattern — Default-to-user-facing triage with internal-quality specs achieves 100% autonomy`
- L832 `[2026-04-26] Culture — If a gate fails, we stop. We don't workaround the spec. We fix the system.`
- L853 `[2026-04-26] Spec review pattern — Reviewer pressure surfaces blast-radius before the reviewer surfaces blockers`
- L865 `[2026-04-26] Spec authoring — Cross-cutting §0.X meta-rule slots are the right home`
- L976 `[2026-04-27] Pattern — Post-finalisation review rounds amplify the existing reject ratio`
- L980 `[2026-04-27] Pattern — Stale non-goal entries survive multiple review rounds`
- L983 `[2026-04-27] Pattern — Default-to-user-facing triage holds across resumed reviews when the spec deliberately hides user surface`
- L1053 `[2026-04-27] Pattern — Pre-merge sanity check pass: 4 read-only confirmations after a multi-round review iteration`
- L1068 `[2026-04-27] Convention — Empty-by-design allow-lists / registries are correct, not a flaw`
- L1078 `[2026-04-27] Pattern — Reviewer follow-up may overturn round-1 defer when cost-curve evidence emerges`
- L1261 `[2026-04-28] External-reviewer false-positive rate is non-zero — verify before applying`
- L1610 `[2026-04-29] Correction — ChatGPT (and likely other LLMs) frequently misread unified diff format in PR review` (cited 5+ times)
- L1638 `[2026-04-29] Correction — When incorporating spec-review feedback, audit for second-order gaps the fix itself creates`
- L1682 `[2026-04-30] Correction — chatgpt-pr-review must check PR merge state before resuming`
- L1706 `[2026-04-30] Pattern — Drift-acknowledgment notes go stale once the underlying drift is fixed`
- L1734 `[2026-05-01] Gotcha — chatgpt-pr-review diff must use origin/main, not local main` (cited 3+ times)
- L1718 `[2026-05-01] Gotcha — chatgpt-pr-review manual mode must generate round N+1 diff before printing round summary`
- L1754 `[2026-05-01] Gotcha — local main ref is stale; always use origin/main for PR diffs` (duplicate of L1734)
- L1766 `[2026-05-01] Correction — chatgpt-spec-review manual mode prints spec as a copy-paste payload`
- L1802 `[2026-05-01] Pattern — Sustained-reject discipline in spec review: re-raises with no new evidence should stay rejected`
- L1806 `[2026-05-01] Correction — chatgpt-pr-review duplicate findings auto-apply per prior decision`
- L1814 `[2026-05-01] Pattern — Verdict-based gates need evidence-bearing verdicts, not trust-based ones`
- L1818 `[2026-05-01] Pattern — ChatGPT PR-review diff misreading: treat "" claims as needing grep verification`
- L1826 `[2026-05-01] Pattern — chatgpt-pr-review session close after 2 unproductive rounds`
- L1830 `[2026-05-01] Correction — Apply ready-to-merge label MUST be paired with ScheduleWakeup, not stop`
- L1912 `[2026-05-03] Pattern — ChatGPT diff-misreading: grep-verify every cited line before triaging`
- L1926 `[2026-05-03] Pattern — ChatGPT "ship with confidence" + "do NOT run another round" is the terminal close signal`
- L2008 `2026-05-04 Pattern — Version authority for parallel framework artefacts: source is canonical, deployment is a marker`
- L2022 `2026-05-04 Gotcha — chatgpt-pr-review can re-flag a Round-N applied fix in Round N+1`
- L2040 `2026-05-04 Pattern — TDD on adversarial-reviewer findings: write the failing test from the reviewer's trace before fixing`
- L2057 `2026-05-04 Pattern — adversarial-reviewer escalates findings that pr-reviewer treats as nits`
- L2072 `2026-05-04 Pattern — Defence-in-depth path-containment: assert at expand time AND at write time`
- L2324 `2026-05-05 Pattern — chatgpt-pr-review meta-level Round 1 without diff visibility`
- L2509 `2026-05-05 Pattern — chatgpt-spec-review terminal round produces zero findings; that IS the closure signal`
- L2877 `[2026-05-08] Pattern — Coordinators run INLINE in the main session, never dispatched as sub-agents` (cited 3+ times — FUNDAMENTAL)
- L3079 `[2026-05-09] Correction — chatgpt-pr-review is iterative until operator says done; never auto-close after a single APPROVED round`
- L3095 `[2026-05-09] Correction — finalisation-coordinator must auto-monitor CI, auto-fix CI red (with guardrails), and auto-merge` (cited 3+ times — FUNDAMENTAL)
- L3146 `[2026-05-09] Correction — finalisation-coordinator must commit Phase 3 BEFORE applying ready-to-merge label`
- L3216 `[2026-05-09] Correction — finalisation-coordinator merge command must use --admin --squash --delete-branch`
- L3339 `[2026-05-09] Pattern — Spec-design: drop the backfill that contradicts a conservative default introduced in the same spec`
- L3448 `Pattern: chatgpt-spec-review automated mode saturates around round 3 — stop on re-raise majority`
- L3456 `Pattern: Two-ledger artifact designs (worker-internal + customer-facing) need explicit drift-handling subsection`
- L3464 `Pattern: Prompt-injection prevention in MVP specs — defence-in-depth beats programmatic enforcement`

### Domain: Workflow engine / State machines (~15 entries)

Workflow runs, gates, state transitions, approvals, advisory locks on workflows, suppression-as-success, state machine guards.

- L987 `[2026-04-27] Pattern — Three-layer defence-in-depth for status writes` (cross-listed)
- L1094 `[2026-04-28] Pattern — "Suppression is success" under single-writer invariants` (cross-listed)
- L1185 `[2026-04-28] Post-commit winner-branch rule for dispatch on approval-resume` (cross-listed)
- L1782 `[2026-05-02] Pattern — Engine writes use state-based CAS predicates as the canonical idempotency mechanism`
- L1786 `[2026-05-02] Gotcha — Idempotent endpoint responses must distinguish race-won-by-decider from external-transition`
- L1790 `[2026-05-02] Pattern — Gate-snapshot model isolates in-flight gates from live state changes`
- L1866 `[2026-05-03] Pattern — Canonical terminal-state table prevents invariant drift across long specs`
- L1870 `[2026-05-03] Pattern — Webhook supremacy + timeout reversibility are separate invariants that must both be named`
- L1874 `[2026-05-03] Pattern — Defense-in-depth for financial value tampering needs two independent layers`
- L2104 `2026-05-04 Pattern — Single chokepoint for INSERT into a uniqueness-protected table` (workflows-v1)
- L2108 `2026-05-04 Gotcha — Date.now() poisons cursor-based projection delta polling`
- L2087 `2026-05-04 Pattern — Two-layer event-source dedup for live-projection hooks`
- L2287 `2026-05-05 Pattern — leftJoin + isActive(table) predicate must live in the JOIN ON clause, not WHERE clause`
- L2336 `[2026-05-06] Correction — Calendar period navigation: keep nav controls inline with period label` (cross-listed with Frontend)
- L3083 `## Pattern: actionRegistry directory-shim split` (cross-listed with Agent runs)

### Domain: LLM router / Provider adapters / Cost (~12 entries)

llmRouter, idempotency keys, provider adapters, cost ledger, provisional rows, breakers.

- L162 `2026-04-21 Gotcha — LLMCallContext schema does not carry correlationId; use idempotencyKey`
- L186 `2026-04-21 Gotcha — SELECT FOR UPDATE only locks EXISTING rows` (cross-listed)
- L194 `2026-04-21 Pattern — Soft circuit breaker for fire-and-forget persistence` (cross-listed)
- L230 `2026-04-21 Gotcha — AsyncIterable & { done: Promise<...> } leaks UnhandledPromiseRejection`
- L242 `2026-04-22 Correction — First-cut CRM free-text capability was a single skill; correct shape is a planner layer`
- L246 `2026-04-22 Correction — Planner-layer architecture was still too LLM-dependent; correct shape is deterministic-first`
- L250 `2026-04-22 Pattern — Keep capability routing and data-query routing on separate layers`
- L270 `2026-04-22 Pattern — When the external reviewer cites a correctness concern that traces to a cache key derivation, add an invariant comment not a second version knob`
- L1169 `[2026-04-28] Ledger-canonical / payload-best-effort consistency contract (§1.1 LAEL)` (cross-listed)
- L1302 `[2026-04-28] Dev-tool LLM CLIs bypass the production llmRouter on purpose` (cross-listed)
- L2978 `[2026-05-08] Pattern — Embedding inputs must NEVER be silently truncated — log when they are`
- L1722 `[2026-05-01] Pattern — Resolver version belongs in the cache key, not a metadata column only` (cross-listed)

### Domain: Frontend / UI / Mockups (~29 entries)

UI design rules, component patterns, focus traps, scroll-lock, mockup discipline, frontend principles, hooks.

- L302 `2026-04-23 Correction — UI mockups surfaced every backend capability as a dashboard instead of designing for the user task` (cited 3+ times — FUNDAMENTAL)
- L559 `2026-04-24 Pattern — Display-threshold filters must preserve state-bearing items`
- L586 `2026-04-24 Pattern — Dev-time invariant at module load catches partition/enum drift without runtime cost`
- L622 `2026-04-24 Pattern — Diff rendering must branch explicitly on empty-string inputs`
- L645 `2026-04-24 Pattern — State-bearing items should surface first, not just pass the filter`
- L1606 `[2026-04-29] Correction — Persistent context switcher already exists in the UI`
- L1620 `[2026-04-29] Pattern — Server-authoritative context updates: id is source of truth, name falls back` (cross-listed)
- L1632 `[2026-04-29] Convention — Discriminated union types used on both client and server belong in shared/types/`
- L1666 `2026-04-30 Pattern — Per-action loading + error state on multi-action UI cards`
- L1670 `2026-04-30 Pattern — Server returns effective config; client never hardcodes literals derived from server config`
- L1742 `[2026-05-01] Correction — async handlers passed as effect deps need useCallback`
- L1768 `[2026-05-01] Pattern — Pre-submit access verification prevents silent rebind failures`
- L1774 `[2026-05-02] Correction — "Newest at bottom" is event order, not container alignment`
- L1778 `[2026-05-02] Pattern — Timestamps on activity events need an "ago" suffix`
- L1834 `[2026-05-02] Pattern — Subaccount-scoped UI signals need both event filtering AND listener lifecycle cleanup`
- L2332 `[2026-05-06] Correction — Calendar period navigation`
- L2336 `[2026-05-07] Pattern — Phase-0 cross-cutting frontend-primitive specs: lock contracts at the start, not during build`
- L2353 `[2026-05-07] Pattern — Versioned localStorage key prefix for component-owned persistence`
- L2362 `[2026-05-07] Pattern — Hook-owned illegal-transition handling instead of consumer-side guards`
- L2707 `[2026-05-07] Pattern — Drawer / Modal focus-trap escape recovery`
- L2714 `[2026-05-07] Pattern — Visibility helper: offsetWidth || offsetHeight || getClientRects().length`
- L2721 `[2026-05-07] Pattern — Shared CSS keyframes belong in index.css, not inline <style> blocks per component instance`
- L2728 `[2026-05-07] Pattern — import.meta.env.DEV for Vite client code (NOT process.env.NODE_ENV)`
- L2735 `[2026-05-07] Pattern — aria-labelledby + useId for dialog/drawer accessible names`
- L2742 `[2026-05-07] Pattern — Document JS-engine assumptions when pure helpers depend on ES spec guarantees`
- L2749 `[2026-05-07] Pattern — Reference-counted scroll-lock singleton with Symbol.for(...) HMR-safe key`
- L2756 `[2026-05-07] Pattern — Branded route-pattern type with buildRoute regex using negative lookahead`
- L2763 `[2026-05-07] Pattern — Co-locate React-wrapper component with pure-helper module; test the pure half via npx tsx`
- L2806 `[2026-05-08] Pattern — Legacy route telemetry and deprecation tracking`
- L2812 `[2026-05-08] Pattern — Skill Studio iframe recursion protection pattern`
- L3627 `Pattern: UI pct() helper applied to wrong scale produces 400% — use scale-specific formatters`
- L3635 `Pattern: Components built in Phase 2 but never imported = dead UI`
- L3643 `Pattern: Pure helper encapsulates a policy — always call it, never hardcode the constant`

### Domain: Observability / Logging / Metrics (~15 entries)

Structured logs, tagged-log-as-metric, payload size bounds, telemetry contracts, error correlation, breadcrumbs.

- L702 `[2026-04-25] Pattern — Process-local counters in multi-instance services need explicit naming + first-consultation log`
- L756 `[2026-04-25] Convention — Tagged-log-as-metric is the project's metrics convention` (cross-listed with Routes — FUNDAMENTAL)
- L1314 `[2026-04-28] dataPartial signal` (cross-listed)
- L1316 `[2026-04-28] Verdict header convention` (cross-listed)
- L410 `2026-04-23 Pattern — Best-effort telemetry writes need a named swallow point + distinct WARN tag per surface` (cross-listed)
- L418 `2026-04-23 Pattern — Stable contract payloads need a serialised-size bound`
- L3036 `[2026-05-08] Pattern — Bounded observability payloads with deterministic top-N truncation are the right shape for retrieval traces`
- L538 `2026-04-24 Pattern — Stable warn codes with surface.signal namespacing for observable migrations` (cross-listed)
- L515 `2026-04-24 Pattern — Migration-endgame phasing` (cross-listed)
- L1916 `[2026-05-03] Pattern — Observability-as-leverage: cross-provider filter field + lifecycle boundary log emits` (cross-listed)
- L2139 `[2026-05-05] Pattern — Boot-time recovery summary log carries actionable counts, not a single integer` (cross-listed)
- L3060 `[2026-05-09] Pattern — Single-node SSE topology with reconnect-snapshot recovery`
- L3067 `[2026-05-09] Pattern — Bounded-payload pattern reuse applied to SSE`
- L2492 `2026-05-05 Pattern — Audit logs are observational, not causal: chain identifiers are the only ordering source`

### Domain: Performance / Pagination / Cursors (~5 entries)

- L1722 `[2026-05-01] Pattern — Resolver version belongs in the cache key` (cross-listed)
- L2108 `2026-05-04 Gotcha — Date.now() poisons cursor-based projection delta polling` (cross-listed)
- L2642 `[2026-05-07] Spec authoring — cursor pagination contract (4 invariants every paginated API spec must state)` (cited 3+ times)
- L2653 `[2026-05-07] Spec authoring — filterOptions count semantics (faceted search rule)`
- L3368 `Pattern: Pagination correctness requires SQL filter pushdown, never in-memory filter after LIMIT`

### Domain: Spec authoring / Architecture decisions / Workflow (~24 entries)

Spec patterns, ADR-adjacent observations, multi-round review patterns, doc-sync.

- L156 `2026-04-21 Correction — Check for adjacent work-streams before drafting a multi-phase spec`
- L234 `2026-04-22 Correction — Delegating a research/audit task with a generic prompt misses spec-specific requirements`
- L238 `2026-04-22 Insight — Sonnet-vs-Opus model choice: execution correctness was fine; judgment/investigation was the weak link`
- L318 `2026-05-01 Convention — Coordinator handoff write ordering on abort`
- L322 `2026-05-01 Pattern — Commit file-scope invariant in coordinator-driven builds`
- L326 `2026-05-01 Pattern — Pre-resume typecheck gate for coordinator resume runs`
- L330 `2026-05-01 Convention — Doc-sync count enforcement`
- L927 `2026-04-27 Workflow — Always use TodoWrite for any "implement" instruction`
- L940 `[2026-04-27] Gotcha — feature-dev:code-architect has no Write tool; use architect or feature-coordinator`
- L951 `[2026-04-27] Pattern — Long-doc-guard requires skeleton-first, Edit-append authoring for any doc over ~10,000 chars`
- L963 `[2026-04-27] Pattern — Safe-by-default for binary-risk fields with future-contributor pressure`
- L967 `[2026-04-27] Pattern — Defence-in-depth pair: static gate + test-mode runtime hook for highest-impact invariants`
- L971 `[2026-04-27] Pattern — Late-round consolidation block as the load-bearing audit entry point`
- L1140 `[2026-04-28] Correction — Spec contracts MUST be declarative invariants, not verification instructions`
- L1282 `[2026-04-28] Record the rejected option in deferred-decision todos, not just the accepted one`
- L1346 `[2026-04-28] Correction — Validation procedures must explicitly defeat known masking conditions`
- L1350 `2026-04-28 Pattern — Invariant + test pairing in spec authoring`
- L1360 `2026-04-28 Pattern — Spec-as-runbook via grep -n + decision table`
- L1370 `2026-04-28 Pattern — Self-consistency via file-inventory lock`
- L2336 `[2026-05-07] Pattern — Phase-0 cross-cutting frontend-primitive specs` (cross-listed)
- L2686 `[2026-05-07] Spec authoring — external-call timeout determinism (3 invariants)`
- L2661 `[2026-05-07] Spec authoring — masking/redaction token contract`
- L2669 `[2026-05-07] Spec authoring — per-user localStorage key scoping`
- L3392 `Pattern: Type seam for future variants — declare the wider type now, restrict registration at runtime`

### Domain: Sandbox / Execution backends (~12 entries)

- L3411 `Pattern: actionRegistry directory-shim split` (cross-listed)
- L3553 `Pattern: Cycle-prevention regex must anchor on the exact filename, not a substring` (cross-listed)
- L3565 `Pattern: Domain-primitive registration must not be gated on queue-backend choice`
- L3571 `Pattern: Lifting code into a generic orchestrator drops the leaf side-effects`
- L3579 `Pattern: Capability-gated optional methods make adapter contract widenings cheap`
- L3747 `[2026-05-11] Pattern — Registration-seam lets provider resolver compile before concrete providers exist`
- L3751 `[2026-05-11] Pattern — String-constant module breaks circular pg-boss registration dependencies`
- L3755 `[2026-05-11] Gotcha — Stale gitignored .js files alongside .ts source intercept Vitest imports`
- L3759 `[2026-05-11] Pattern — Intentional OR-clause chunk cohesion: ≤5 files OR ≤1 logical responsibility`
- L3763 `## DB CHECK constraints require a pure application-level transition classifier` (cross-listed)
- L3769 `## DB-anchored elapsed time in correctness-sensitive paths (ceiling monitor)` (cross-listed)
- L3781 `## Strict CI gates require pre-publish version-string convention to avoid blocking ship`

### Domain: Retrieval / Memory / Knowledge (~10 entries)

Memory blocks, retrieval rankers, embedding pipeline, document promotion, retrieval observability.

- L99 `2026-04-13 Decision — MemPalace benchmarks debunked; anda-hippocampus shortlisted for world model`
- L101 `2026-04-13 Pattern — GEO audit score storage uses JSONB for dimension breakdown`
- L95 `2026-04-13 Decision — GEO skills implemented as methodology skills, not intelligence skills`
- L2978 `[2026-05-08] Pattern — Embedding inputs must NEVER be silently truncated` (cross-listed)
- L2991 `[2026-05-08] Pattern — Pure helpers used for their return value MUST have their return value consumed`
- L3002 `[2026-05-08] Pattern — Retrieval-version completeness invariant requires an active production read-path filter`
- L3013 `[2026-05-08] Pattern — Document-promotion atomicity needs an audit-row idempotency anchor inside the inline transaction`
- L3024 `[2026-05-08] Pattern — Retrieval rankers should share a generic core; primitive-specific filters wrap it`
- L3036 `[2026-05-08] Pattern — Bounded observability payloads with deterministic top-N truncation`
- L3048 `[2026-05-08] Pattern — Always-available document budget needs a preventive UI surface, not a runtime safety net`

### Domain: Misc / Capabilities / Product strategy (~14 entries)

- L59 `2026-04-04 Decision — Injected middleware messages use role: 'user' not role: 'system'`
- L67 `2026-04-05 Decision — Strategic research: build sequence after core testing`
- L82 `2026-04-13 Pattern — Capabilities registry structure for product + GTM documentation`
- L103 `2026-04-16 Correction — capabilities.md must use marketing language, never internal technical terms`
- L1660 `[2026-04-29] Decision — Workspace identity uses canonical pattern (mirrors CRM), one workspace per subaccount` (already ADR 0003)
- L1674 `2026-04-30 Gotcha — Lifecycle state guards belong on the server, not just in UI gating`
- L1686 `2026-04-30 Pattern — Soft-then-hard invariant promotion across phase boundaries`
- L1690 `2026-04-30 Pattern — Inline column comments beat a dedicated invariant doc`
- L2638 `[2026-05-06] Correction — Synthetos is not agency-only; sub-account is a standalone product surface`
- L877 `## Post-merge observations: PR #196` (template/operator section, not a typical entry)
- L901 `## Audit-remediation followups: pre-existing test triage` (template/operator section)
- L786 `[2026-04-25] Correction — Audit framework cited wrong file paths` (cross-listed)
- L796 `[2026-04-25] Audit — Audit framework gate-path stale reference` (cross-listed)
- L348 `2026-05-03 Pattern — GHL agency-level OAuth uses a dual-table token architecture` (already ADR 0006)

## § Proposed ADR promotions

Hard cap = 5. Promotion criteria per plan §17: cited ≥3 times in specs/review-logs/other-knowledge-entries, OR so fundamental that future architectural decisions depend on them. Each candidate below is selected because it both (a) meets the citation threshold and (b) represents a durable cross-cutting choice rather than a one-off observation.

The next sequential ADR number is **0012**. Existing ADRs end at `0011-operator-backend-chain-resume-model.md`. Numbers assigned below are sequential. (Note: a pre-merge draft of this inventory used `0011-workspace-inbound-webhook-db-exception.md` as the anchor; that ADR was renumbered to `0022-workspace-inbound-webhook-db-exception.md` during spec-conformance to resolve the collision with the operator-backend chain-resume ADR.)

### ADR 0012 — Tagged-log-as-metric is the project's metrics convention

**Target id:** `0012-tagged-log-as-metric-convention.md`
**Originating KNOWLEDGE entry:** L756 `[2026-04-25] Convention — Tagged-log-as-metric is the project's metrics convention; resist adding new metric infrastructure without a scaling driver`.

**One-line rationale:** Codifies the durable choice that this codebase has NO in-process counter library, NO `metrics.increment(...)` API, and NO Prometheus registry — instead, structured `logger.error('event_name', { ... })` and `logger.warn('event_name', { ... })` are THE metrics surface, consumed downstream by the log pipeline (PostHog / Datadog). Every "add a counter" PR suggestion bounces off this convention; promoting to ADR makes the rationale defendable across years of new contributors.

### ADR 0013 — Suppression is success under single-writer invariants

**Target id:** `0013-suppression-is-success.md`
**Originating KNOWLEDGE entry:** L1094 `[2026-04-28] Pattern — "Suppression is success" under single-writer invariants`.

**One-line rationale:** A single-writer event emitter that loses a coordination race MUST return `{ success: true, suppressed: true, reason }`, NEVER `success: false`. Returning failure triggers retry storms, false incident signals, broken metrics, and alert fatigue. This is a load-bearing contract across `writeDiagnosis`, terminal status-transition writers, cache populators, idempotent webhook receivers, and notification dedup paths — promote to ADR so future single-writer code starts here.

### ADR 0014 — Coordinators run INLINE in the main session, never dispatched as sub-agents

**Target id:** `0014-coordinators-run-inline.md`
**Originating KNOWLEDGE entry:** L2877 `[2026-05-08] Pattern — Coordinators run INLINE in the main session, never dispatched as sub-agents`.

**One-line rationale:** The Claude Code runtime returns a hard error when a dispatched sub-agent attempts further sub-agent dispatches. `spec-coordinator`, `feature-coordinator`, `finalisation-coordinator`, and `audit-runner` all dispatch multiple downstream agents — nesting any of them as a sub-agent breaks the pipeline at its first dispatch. This rule already lives in CLAUDE.md and agent files, but is a fleet-architecture invariant that needs ADR durability and a defended rationale section for future fleet maintainers.

### ADR 0015 — ChatGPT review loops: convergence + diff-misreading discipline

**Target id:** `0015-chatgpt-review-discipline.md`
**Originating KNOWLEDGE entries:** L666 `2026-04-24 Gotcha — ChatGPT reviewers hallucinate "duplicate line" bugs by reading unified diffs as final state` + L338 `2026-04-23 Pattern — ChatGPT PR-review re-raises previously-adjudicated items under variant framing` + L1610 `[2026-04-29] Correction — ChatGPT (and likely other LLMs) frequently misread unified diff format in PR review`.

**One-line rationale:** Three independent entries — 6+ documented PR occurrences across PRs #232, #234, #249, #254 — converge on the same load-bearing review discipline: verify against HEAD before acting on any "duplicate line" claim, treat round-N+1 re-raises of round-N rejections as convergence signals not new findings, and close after 2 unproductive rounds. This is a durable policy choice (not just an observation) that shapes every future external-review session; ADR consolidates the three entries into one defended pattern.

### ADR 0016 — Frontend-first design principle: consumer-simple over capability-mapped dashboards

**Target id:** `0016-frontend-consumer-simple-principle.md`
**Originating KNOWLEDGE entry:** L302 `2026-04-23 Correction — UI mockups surfaced every backend capability as a dashboard instead of designing for the user task`.

**One-line rationale:** Backend richness does NOT justify frontend complexity. Every UI artifact starts from the user's primary task, defaults dashboards/diagnostics/aggregated-cost views to HIDDEN, surfaces one primary action per screen. This rule already lives in CLAUDE.md and `docs/frontend-design-principles.md`, but is cited as a touchstone across every UI mockup review and is the canonical "why our app looks different from enterprise SaaS competitors" rationale. Promoting to ADR locks in the durable product stance.

## Defer ADR (under cap)

The following candidates meet the citation threshold but are deferred this quarter to respect the ≤5 hard cap. They stay as KNOWLEDGE entries and remain candidates for the next quarterly sweep.

- **L1734 / L1754 dual citation** — `origin/main` for PR diffs (compressed below, not promoted; the rule is mechanical, more checklist-shaped than decision-shaped).
- **L1628 — DB-canonical now_epoch in time-delta computations** — three citations within KNOWLEDGE.md alone, plus referenced in rate-limit gate scripts; sufficient for ADR but lower architectural durability than the five selected.
- **L2096 — Cleanup jobs on FORCE-RLS tables MUST use withAdminConnection** — three citations and load-bearing for background workers, but is a mechanical rule already enforced by `verify-rls-contract-compliance.sh`; ADR would duplicate the gate's contract.
- **L733 — Partial unique index predicate must match the upsert WHERE clause exactly** — three citations, but is a "watch out for this" Gotcha class (catches the failure mode) rather than a "we chose X" Decision class.
- **L3472 — PG advisory_xact_lock + partial unique index for singleton-per-tenant install** — three citations and a structural pattern; deferred because it overlaps with L1644 / L1650 / L1955 in the same family. Worth a single combined ADR next quarter ("Defence-in-depth concurrency: advisory lock + partial unique index").
- **L2642 — Cursor pagination contract (4 invariants)** — three citations and a clean four-invariant declarative; could promote, but the spec-authoring-checklist already references it — duplication risk.
- **L306 — Spec review arc converges on additive invariants** — cited 3+ times across review logs; deferred because it overlaps thematically with ADR 0015 (review discipline family).
- **L440 — Review-finding triage (technical vs user-facing) for high-volume review loops** — three citations and load-bearing across `chatgpt-pr-review.md` and `chatgpt-spec-review.md`; deferred for the same review-family overlap with 0015.
- **L1812 — External reviewers misread codebase canonical RLS without architecture.md context** — three citations; pattern-shaped, more a "reject this finding" reflex than a durable choice. Deferred.

## § Duplicate / compression candidates

Pairs / groups of equivalent entries. Each group below carries a one-line rationale for the proposed compression action. Per spec §5.C2 non-deletion rule: removed content MUST either (a) be in a proposed ADR, (b) survive as a canonical compressed entry, or (c) remain recoverable through this inventory itself.

### Group 1 — ChatGPT diff misreading (7 entries → ADR 0015 + canonical anchors + back-references)

**Entries:**
- L111 `2026-04-17 Gotcha — Rebase with merge conflicts can leave duplicate code visible in PR diff`
- L115 `2026-04-17 Correction — Verify reviewer feedback against the PR diff perspective`
- L119 `2026-04-17 Gotcha — GitHub unified diff format is commonly misread as "both lines present"`
- L666 `2026-04-24 Gotcha — ChatGPT reviewers hallucinate "duplicate line" bugs`
- L1610 `[2026-04-29] Correction — ChatGPT (and likely other LLMs) frequently misread unified diff format`
- L1818 `[2026-05-01] Pattern — ChatGPT PR-review diff misreading: treat "" claims as needing grep verification`
- L1912 `[2026-05-03] Pattern — ChatGPT diff-misreading: grep-verify every cited line before triaging`

**Action:** Keep the oldest two (L111 + L119, 2026-04-17) as the canonical historical anchors. Compress L115, L666, L1610, L1818, L1912 into one canonical compressed entry `[compressed 2026-05] ChatGPT/LLM diff misreading — see ADR 0015 and originating entries at L111 / L119` with one-line back-references. ADR 0015 owns the durable policy.

**Rationale:** Seven entries on the same failure mode is review-log fatigue; the ADR is the persistent home, the originals stay for archaeology, the compressed entry is what future readers retrieve.

### Group 2 — `origin/main` for PR diffs (2 entries → 1 canonical)

**Entries:**
- L1734 `[2026-05-01] Gotcha — chatgpt-pr-review diff must use origin/main, not local main`
- L1754 `[2026-05-01] Gotcha — local main ref is stale; always use origin/main for PR diffs`

**Action:** Keep L1734 (first occurrence, ~20 lines after L1716's automated/manual mode entry). Compress L1754 to one-line back-reference to L1734.

**Rationale:** Same gotcha, two near-identical entries 20 lines apart authored on the same day. The duplicate adds no information.

### Group 3 — Tagged-log-as-metric (ADR 0012 + compressed pointer)

**Entries:**
- L756 `[2026-04-25] Convention — Tagged-log-as-metric is the project's metrics convention` (primary)

**Action:** Promote L756 to ADR 0012. Replace its body with the one-line pointer `Promoted to ADR 0012 on 2026-05.`.

**Rationale:** ADR is the canonical home; the KNOWLEDGE entry compresses to a pointer.

### Group 4 — `db.transaction()` without GUC family (5 entries → cross-references only)

**Entries:**
- L2096 `2026-05-04 Gotcha — Cleanup jobs on FORCE-RLS tables MUST use withAdminConnection`
- L2156 `2026-05-05 Gotcha — db.transaction() opened from module-level pool runs WITHOUT GUC; FORCE-RLS writes silently no-op`
- L2215 `2026-05-05 Gotcha — withOrgTx({tx: db}) in unauthenticated callbacks fakes ALS context without setting a GUC`
- L2954 `[2026-05-08] Pattern — Workers that opt out of createWorker auto-org-tx must wrap FORCE-RLS reads in short org-scoped tx`
- L3320 `[2026-05-09] Pattern — cross-tenant boot scans against FORCE-RLS tables silently no-op without admin role`

**Action:** Keep L2156 as the canonical "what goes wrong" Gotcha. L2096 + L2215 + L2954 + L3320 stay (they describe distinct sub-patterns — cleanup jobs / unauthenticated callbacks / worker opt-outs / boot scans) but each gains a one-line `see also L2156` cross-reference. No removals.

**Rationale:** This is a family of related rules, not duplicates. The canonical "what goes wrong" sits at L2156; the four sub-patterns are legitimately distinct. Cross-references improve retrieval without removing content.

### Group 5 — Migration-number collision after S2 sync (2 entries → 1 canonical)

**Entries:**
- L2850 `[2026-05-08] Pattern — Migration-number collision after S2 sync requires renaming on the feature branch`
- L3692 `Pattern: Migration-number collision after S2 sync requires renumbering forward, not backward`

**Action:** Keep L2850 (first authored). L3692 compresses to back-reference because the rule is the same; the slight wording variation ("renaming on feature branch" vs "renumbering forward") describes one action.

**Rationale:** Same rule, two phrasings, 800 lines apart.

### Group 6 — DB-canonical time / clock-skew family (4 entries → kept distinct + cross-references)

**Entries:**
- L1628 `[2026-04-29] Pattern — DB-canonical now_epoch must be threaded through any time-delta computation derived from a rate-limit check`
- L2108 `2026-05-04 Gotcha — Date.now() poisons cursor-based projection delta polling`
- L3733 `[2026-05-11] Gotcha — DB-time bucket queries must fail closed; never fall back to Date.now()`
- L3769 `## DB-anchored elapsed time in correctness-sensitive paths (ceiling monitor)`

**Action:** Keep all four (distinct surface areas: rate-limit / cursor pagination / dedupe bucket / billing-elapsed). Add cross-references at the top of L3733 and L3769 pointing back to L1628.

**Rationale:** Each entry describes a different application of the same principle; they earn their tokens individually. Cross-references improve discoverability.

### Group 7 — Test harness register/restore (2 entries → keep both; one supersedes the other)

**Entries:**
- L1382 `[2026-04-28] Pattern — Test harness register/restore: prior-state capture beats unique-key discipline`
- L1444 `[2026-04-28] Correction — Test harness register/restore needs STACK semantics, not closure-captured prior state`

**Action:** No change — L1444 already explicitly opens with "**Supersedes the 2026-04-28 'Test harness register/restore: prior-state capture beats unique-key discipline' entry above.**". The superseding pattern is correct.

**Rationale:** The supersede annotation is the canonical pattern (per CLAUDE.md "Never edit or remove existing entries — only append"). Both entries stay.

### Group 8 — `node --watch` SIGTERM / restart family (2 entries → keep both, cross-reference)

**Entries:**
- L136 `2026-04-21 Gotcha — Windows node --watch kills the dev server abruptly, SIGTERM handlers never fire`
- L474 `2026-04-24 Gotcha — node --watch restart silently kills in-flight long-running LLM jobs`

**Action:** Keep both (different surface areas: signal handling vs LLM in-flight). Add one-line cross-reference at L474 to L136.

**Rationale:** Related root cause, different consequences. Both descriptions earn their tokens.

### Summary of compression

| Group | Entries touched | Net line reduction (estimated) |
|-------|-----------------|--------------------------------|
| 1. ChatGPT diff misreading | 7 entries → ADR 0015 + canonical + 5 back-refs | ~80 lines |
| 2. origin/main duplicate | 2 entries → 1 + 1 back-ref | ~6 lines |
| 3. Tagged-log-as-metric | 1 entry → ADR 0012 + pointer | ~25 lines |
| 4. db.transaction GUC family | 5 entries → cross-references only | 0 lines (cross-ref only) |
| 5. Migration-number collision S2 | 2 entries → 1 + 1 back-ref | ~10 lines |
| 6. DB-canonical time | 4 entries → cross-references only | 0 lines (cross-ref only) |
| 7. Register/restore (already superseded) | 2 entries → no change | 0 lines |
| 8. node --watch family | 2 entries → cross-reference only | 0 lines |

**Plus the five ADR promotions:** L756 (Tagged-log-as-metric), L1094 (Suppression-is-success), L2877 (Coordinators inline), L666 + L338 + L1610 (ChatGPT review discipline), L302 (Frontend-first principle) — each compresses to a `Promoted to ADR <id> on 2026-05.` pointer.

**Estimated post-sweep line count:** 3,785 lines − ~120 lines (compressions) − ~150 lines (ADR-promotion replacements with pointers) − ~80 lines (Group 1 back-refs) ≈ **3,435 lines**.

**Gap to ≤2,500 target:** ~935 lines. The line-count target appears unreachable with this sweep alone given the non-deletion rule and the ≤5 ADR cap. The 12.B apply step should ship a dated `## 2026-05 quarterly trim` header documenting the achievable line count and flagging the next quarter's sweep as the path to ≤2,500. The non-deletion rule is a hard contract; this inventory is the audit trail demonstrating the constraint.

## § Retained unchanged

The bulk of `KNOWLEDGE.md` stays untouched. The five ADR promotions affect 7 entries (5 primary + 2 grouped under Group 1). The compression candidates affect 17 entries across Groups 1–8 (Groups 4/6/7/8 add cross-references only with zero deletion). The remaining ~360 entries — approximately **94% of the file** — are retained unchanged.

**Retained-domain headline counts (post-sweep):**

| Domain | Entries retained unchanged |
|--------|----------------------------|
| RLS / Tenancy / Org-scoping | ~26 |
| Agent runs / Execution model | ~28 |
| Queues / Jobs / Scheduling | ~16 |
| Heartbeats / Liveness | ~4 |
| Migrations / Schema | ~32 |
| Testing / CI gates / Vitest | ~24 |
| Routes / Services / Architecture | ~30 |
| Auth / OAuth / Sessions / Webhooks | ~15 |
| Tooling / Review agents / Pipeline | ~36 (after Group 1 + ADR 0015 changes) |
| Workflow engine / State machines | ~15 |
| LLM router / Provider adapters / Cost | ~11 |
| Frontend / UI / Mockups | ~28 (after ADR 0016 change) |
| Observability / Logging / Metrics | ~14 (after ADR 0012 change) |
| Performance / Pagination / Cursors | ~5 |
| Spec authoring / Architecture decisions | ~19 |
| Sandbox / Execution backends | ~11 |
| Retrieval / Memory / Knowledge | ~10 |
| Misc / Capabilities / Product strategy | ~12 |

**Total retained:** ~336 entries unchanged + ~12 entries with one-line cross-references added (no deletion) = **~348 entries** remain effectively unchanged. **5 entries** promoted to ADRs (replaced with one-line pointers). **6 entries** compressed to one-line back-references (originals remain recoverable via this inventory's anchors in §§Grouped entries / Duplicate-compression candidates).

The bulk-retained shape is intentional: KNOWLEDGE.md is append-only history. The sweep removes only the highest-confidence duplicates and the highest-confidence ADR-class observations; the long tail of one-off Gotchas, Patterns, and Conventions stays in place because retrieval value is highest when domain-tagged history is dense.

## Inventory verdict

`INVENTORY_READY`. The operator should review §§Grouped entries / Proposed ADR promotions / Duplicate-compression candidates, commit this file, and dispatch Chunk 12.B as a separate `builder` invocation. The apply step will execute the five promotions, the eight compression groups, and add the `## 2026-05 quarterly trim` header per plan §17.

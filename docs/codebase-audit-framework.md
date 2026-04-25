# AutomationOS Codebase Audit Framework

**Comprehensive Code Quality, Security & Maintainability Review — calibrated for AutomationOS**

| Field | Value |
|---|---|
| Version | 1.1 — Scope Guard, Audit Modes, validation no-silent-skip, idempotency storage-boundary clause, invariant-in-code clause (1.0: 2026-04-25 initial calibration from generic v5.0) |
| Status | Active. Reusable across audits. |
| Purpose | Post-build and periodic code quality audit for AutomationOS |
| Audience | Main session (Claude Code) running the audit, plus subagents (`pr-reviewer`, `spec-conformance`, `dual-reviewer`, `chatgpt-pr-review`) it delegates to |
| Applies to | This repo (`automation-v1`) — Express + Vite + React + Drizzle + pg-boss stack |
| Structure | Universal Rules → Protected Files → Layer 1 (9 areas) → Layer 2 (13 modules: 8 generic + 5 AutomationOS-specific) → Pipeline integration → Report template → Tooling |
| Pairs with | `CLAUDE.md`, `architecture.md`, `KNOWLEDGE.md`, `docs/spec-context.md`, `docs/frontend-design-principles.md`, `docs/capabilities.md`, `.claude/agents/*` |

---

## How to use this document

This is a runnable framework. Treat each section as the source of truth for that step of an audit. The audit itself is run from the main Claude Code session (this very session, in a future invocation), delegating reconnaissance to `Explore`, individual cleanup areas to focused subagents, and final review to the existing `pr-reviewer` / `spec-conformance` / `dual-reviewer` pipeline. Layer 1 is structural cleanup. Layer 2 is release-gate quality. Every audit run produces a durable log under `tasks/review-logs/` and updates `KNOWLEDGE.md` with patterns learnt.

---

## Scope Guard

**This framework is intentionally constrained. Resist expansion.**

Do not add new rules, modules, areas, or scoring systems to this document unless **both** of the following are true:

1. A real audit run exposed a concrete gap that this framework's existing rules and modules failed to catch.
2. That gap cannot be addressed by tightening existing rules, modules, or the AutomationOS context block in §2.

**Default action when in doubt: reuse an existing rule. Do not introduce a new one.**

Why this matters: every additional rule increases noise, dilutes attention on the rules that catch real failures, and pushes future agents toward checklist-following instead of judgement. The framework is at its useful equilibrium at v1.x. A future v2 should require evidence — not aspiration.

**Do not add:** more numbered rules, more scoring axes, more modules in either layer, more report-template fields, more "AI-specific enhancements". The three layers of control (this framework + CI gates in `scripts/gates/*.sh` + review agents in `.claude/agents/`) already cover the codebase. Additions go into the existing layers, not into a new fourth one.

**Do add:** sharper triggers inside an existing rule, new entries to the §4 Protected Files list as the codebase evolves, refreshed §2 context-block facts when the stack changes, and `KNOWLEDGE.md` entries linked from §10 when an audit catches a recurring pattern.

When tempted to expand, write a `KNOWLEDGE.md` entry instead.

---

## Table of Contents

1. How this framework is structured
2. AutomationOS context block (pre-filled reconnaissance)
3. Universal Rules (1–15)
4. Protected Files & Patterns (AutomationOS-specific)
5. Default Execution Order
6. Layer 1 — Code Cleanup Audit
   - Area 1: Dead Code Removal
   - Area 2: Duplicate Logic
   - Area 3: Type Definition Consolidation
   - Area 4: Type Strengthening
   - Area 5: Error Handling Audit
   - Area 6: Legacy and Dead Path Removal
   - Area 7: AI Residue Removal
   - Area 8: Circular Dependency Resolution
   - Area 9: Architectural Boundary Violations
7. Layer 2 — Production Readiness Audit (generic modules)
   - Module A: Security Review
   - Module B: Performance Review
   - Module C: Test Coverage
   - Module D: Documentation Completeness
   - Module E: Observability and Operability
   - Module F: Dependency and Supply Chain Risk
   - Module G: API and Spec Contract Preservation
   - Module H: Accessibility (Frontend)
8. Layer 2 — AutomationOS-specific modules
   - Module I: RLS & Multi-tenancy Three-Layer Compliance
   - Module J: Idempotency, Queue & Job Discipline
   - Module K: Three-Tier Agent Invariants
   - Module L: Skill Registry & Visibility Coherence
   - Module M: Capabilities Editorial & Frontend Design Principles Guard
9. Integration with the existing review pipeline
10. Audit lifecycle — logging, KNOWLEDGE.md, deferred items
11. Audit Report Template
12. Tooling for AutomationOS
13. Running an audit — operational guide

---

## 1. How this framework is structured

**Layer 1 — Code Cleanup Audit.** Structural hygiene: dead code, duplicates, type consolidation, type strengthening, error handling, legacy paths, AI residue, circular dependencies, architectural boundary violations. Run on demand. Findings produce surgical, behaviour-preserving changes, gated by the Universal Rules.

**Layer 2 — Production Readiness Audit.** Release-gate concerns. Eight generic modules (security, performance, tests, docs, observability, dependencies, API/spec, accessibility) and five AutomationOS-specific modules (RLS multi-tenancy, idempotency/queues, three-tier agents, skill registry, capabilities/frontend editorial). Run before significant releases or after major feature phases.

**Three-pass execution applies to both layers.** Pass 1: findings only, no code changes. Pass 2: high-confidence fixes only, validated after each area. Pass 3: medium/low-confidence and architectural items routed to `tasks/todo.md` and the existing review-loop pipeline (`pr-reviewer`, `spec-conformance`, optionally `dual-reviewer`).

**This framework defers to the existing review pipeline. It does not replace it.** Layer 1 produces structural fixes. The existing pipeline produces the final blocking review on whatever the audit changed. No fix lands without `pr-reviewer` having seen it.

---

## 2. AutomationOS context block

This block is pre-filled from the calibration recon. **Re-verify it at the start of every audit run** — anything stale here will silently mis-classify safe vs protected files. Update this section in-place when stack facts change (they will), and bump the framework version number.

| Item | Value |
|---|---|
| Repo | `automation-v1` |
| Package manager | npm (lockfile: `package-lock.json`) |
| Module system | ES Modules (`"type": "module"` in package.json) |
| TypeScript | `^5.3.3` |
| Server runtime | Node + Express `^4.18.2`, dev via `node --watch` + `tsx/esm` |
| Client runtime | React `^18.2.0` + Vite `^5.4.21` (NO Next.js — do **not** apply Next.js conventions) |
| Styling | Tailwind CSS `^4.2.2` (custom component library, NOT shadcn/ui) |
| ORM | Drizzle `^0.45.1` over `postgres ^3.4.4` (PostgreSQL native driver) |
| Queue | **pg-boss `^9.0.3` is canonical** — no BullMQ, no Redis. All background work flows through pg-boss |
| Realtime | Socket.io `^4.8.3` |
| Validation | Zod `^3.22.4` |
| Browser automation | Playwright `^1.59.1` (IEE runtime + tests) |
| Agent SDK | `@modelcontextprotocol/sdk ^1.29.0` (MCP servers) |
| Observability | Langfuse `^3.38.6` (LLM tracing) |
| Test framework | None canonical — bare `tsx` runners under `server/**/__tests__/` (NO Vitest, NO Jest) |
| Lint command | **None defined** (`npm run lint` does not exist — do not invent it) |
| Typecheck command | `npm run build:server` (= `tsc -p server/tsconfig.json`); also `vite build` for client |
| Test commands | `npm run test:gates` (~20 bash gates), `npm run test:qa`, `npm run test:unit`, `npm test` (gates → qa → unit), `npm run test:trajectories` |
| Build commands | `npm run build` (= server tsc + vite build), `npm run build:server`, `npm run build:client` |
| DB commands | `npm run db:generate` (Drizzle codegen), `npm run migrate` (custom: `tsx scripts/migrate.ts`), `npm run db:studio`, `npm run seed` |
| Skill commands | `npm run skills:apply-visibility`, `npm run skills:verify-visibility`, `npm run skills:backfill` |
| Playbook commands | `npm run playbooks:validate`, `npm run playbooks:test` |
| Layer model | `routes/` → `services/` → `db/` (one-way only). Routes never touch `db` directly. Services own ORM access. See `architecture.md` § Architecture Rules |
| Tenant scoping | Every query filters by `req.orgId` (never `req.user.organisationId`). Soft-delete via `isNull(table.deletedAt)`. Subaccount routes go through `resolveSubaccount(subaccountId, orgId)` middleware |
| RLS posture | **Three-layer fail-closed**: (1) Postgres RLS policies on `app.organisation_id` session var, (2) `withOrgTx` / `getOrgScopedDb` middleware sets the var, (3) app-level permission + visibility checks. Manifest: `server/config/rlsProtectedTables.ts` |
| Agent tiers | System → Org → Subaccount, cascading. Roles: CEO → Orchestrator → Specialist → Worker. Handoffs up to 5 deep. Exactly one active lead agent per subaccount (atomic swap) |
| Permission model | Five roles (Admin, Owner, Editor, Member, Viewer) + Delegated/Service principals; permission sets + visibility scopes (private / shared-team / shared-subaccount / shared-org) |
| Editorial law | `docs/capabilities.md` — 5 mandatory rules from `CLAUDE.md` (no provider names in customer-facing sections, marketing language only, vendor-neutral, model-agnostic). Violations block edits |
| Frontend design law | `docs/frontend-design-principles.md` — 5 hard rules. Default to hidden, one primary action per screen, inline state beats dashboards. Caps: 1 primary action, ≤3 panels, 0 KPI tiles by default |
| Spec framing | `docs/spec-context.md` — pre-production, rapid evolution, no feature flags for rollout, prefer existing primitives, gates-first testing posture |
| Review-loop logs | `tasks/review-logs/<agent>-log-<slug>[-<chunk-slug>]-<timestamp>.md` (ISO 8601 UTC, hyphens between time fields) |
| Deferred backlog | `tasks/todo.md` — single source of truth. Append-only, dated sections per review session |
| Hooks | `.claude/hooks/long-doc-guard.js` (blocks `Write` to docs >10k chars), `.claude/hooks/config-protection.js`, `.claude/hooks/correction-nudge.js` |
| CI gates | `scripts/gates/*.sh` (~20 scripts) — RLS coverage, layering, subaccount resolution, orgId source, no-db-in-routes, schema compliance, etc. **Treat any gate failure as blocking.** |
| Containers | `Dockerfile` (server+client), `worker/Dockerfile` (pg-boss workers, separate image for horizontal scaling) |
| Test coverage posture | Pre-production. Static gates are the primary defence. Unit/QA tests sparse on critical paths only (RLS context propagation, idempotency keys). E2E and frontend tests deferred. Treat coverage as "low" for Rule 9 trust-model purposes unless the specific path being changed has named test coverage |

---

## 3. Universal Rules

These rules apply across both layers, every area, every fix. They override every default elsewhere in this document. Violating one is grounds to revert and escalate.

### Rule 1 — Reconnaissance before changing

Before any code change, complete a reconnaissance pass and record it in the audit report. Reuse the AutomationOS context block (§2) as the baseline, then add audit-specific items: which paths are in scope, which are out of scope, which subagents will be used per area, and any in-flight work (other branches, open PRs, deferred items in `tasks/todo.md`) that the audit must not collide with.

### Rule 2 — Git safety rails

- Working tree clean before starting (`git status` empty).
- Starting commit SHA recorded.
- Dedicated audit branch: `audit/<scope>-<YYYY-MM-DD>` (e.g. `audit/full-codebase-2026-04-25`).
- One commit per area, message format: `audit: area <N> — <area name>`.
- Checkpoint tag after each successful area: `audit-area-<N>-complete`.
- Formatting-only changes never mix with logic changes in the same commit.
- Multiple-area failures revert to the last good tag rather than unpicking individual commits.
- Per-area validation failure → revert that area's commits before the next area.
- **Do not push to remote from the main session.** The user pushes manually after reviewing (CLAUDE.md User Preferences). The `pr-reviewer` agent never pushes either. Only `spec-reviewer`, `spec-conformance`, `dual-reviewer`, and the ChatGPT review agents auto-push within their own flows.

### Rule 3 — Three-pass execution

Strict order. Do not begin pass 2 until pass 1 is complete across all in-scope areas.

- **Pass 1 — Findings only.** Analyse and document. No code changes. One findings table per area in scope.
- **Pass 2 — High-confidence fixes only.** Each fix classified and justified before commit. Validation runs after each area; failures revert.
- **Pass 3 — Manual approval items.** Every `confidence: medium` and `confidence: low` finding routes to (a) `tasks/todo.md` under a new dated section `## Deferred from codebase audit — <date>`, and (b) the `pr-reviewer` / `spec-conformance` / `dual-reviewer` pipeline if the user opts in. The audit run itself never auto-applies these.

### Rule 4 — Behavioural preservation

Every pass-2 fix must be classified before commit. If it cannot be classified with confidence, it goes to pass 3.

| Classification | Definition |
|---|---|
| `behaviour-preserving refactor` | External behaviour identical. Internal structure changed only. |
| `bug fix` | Observable behaviour changes because the previous behaviour was incorrect. State the bug. |
| `deletion` | Code removed. State what it was and why it is safe to remove. |
| `security hardening` | A security property is improved. Behaviour may change in edge cases by design. |
| `manual review required` | Cannot be classified without human input. Do not apply. |

**Implicit contract preservation — AutomationOS edition.** A change is behavioural even if outputs look identical when it touches:

- Webhook payload format, signing scheme, or delivery timing (`server/routes/webhooks.ts`, `server/services/webhookAdapterService.ts`, `server/lib/webhookDedupe.ts`).
- pg-boss job payload shapes or job-name strings (anything in `server/jobs/`, `server/config/jobConfig.ts`).
- Persisted JSON columns (`agent_runs.execution_log`, `geo_audit.dimension_scores`, `agent_run_llm_payloads`, etc.).
- Skill markdown structure or `actionRegistry` entries (`server/config/actionRegistry.ts`, `server/skills/*.md`).
- Three-tier agent contracts (`shared/types/agentExecution.ts` and equivalents).
- Portal client API responses (`/portal/<slug>/*`).
- Agent run visibility rules (`server/lib/agentRunVisibility.ts`, `server/lib/agentRunPermissionContext.ts`).

These are contracts even when undocumented. Any change that touches them is `manual review required` unless the full consumer surface is verified safe.

### Rule 5 — Diff review before every commit

Before committing pass-2 changes:

- Review the full diff for unintended side effects (`git diff --staged`).
- Confirm no unrelated changes slipped in.
- Confirm the modified files match the declared scope of the area.
- Confirm no observability code was removed as collateral (Rule 12).
- Confirm no `scripts/gates/*.sh` script was modified (those are CI law — see Protected Files).

If anything in the diff is outside the declared scope, remove it and route it to pass 3.

### Rule 6 — Validation after every area

After each area in pass 2, run all of the following and record exact commands and outcomes. All must pass before proceeding.

| Check | Command | Notes |
|---|---|---|
| Server typecheck | `npm run build:server` | This is the authoritative typecheck — there is no separate `tsc --noEmit` script |
| Client build | `npm run build:client` | Run if any client/ or shared/ files changed |
| Static gates | `npm run test:gates` | All ~20 gates must pass. Any gate failure is blocking |
| Unit tests | `npm run test:unit` | Run if logic in covered paths changed |
| QA tests | `npm run test:qa` | Run before release-gate audits or if QA-covered paths changed |
| Skill visibility | `npm run skills:verify-visibility` | Run if `server/skills/`, `server/config/actionRegistry.ts`, or visibility rules changed |
| Playbooks | `npm run playbooks:validate` | Run if `server/lib/workflow/` or playbook configs changed |

**No silent skips.** No validation step may be skipped. If a command is genuinely not applicable to the changes in this area, mark it `N/A` in the report with a one-line reason (e.g. "N/A — no client/ files changed" for `npm run build:client`). An unmarked omission is treated as a failure. The point of the validation table is to make every check decision explicit and auditable.

Lint is **not** a separate step — there is no `lint` script. Style and naming are enforced by gate scripts and review.

If any check fails, revert the area's commits and route findings to pass 3.

### Rule 7 — Blast radius control

- Smallest viable units. Never batch unrelated fixes into one commit even within the same area.
- A fix touching a core or shared module (`server/db/`, `server/lib/`, `shared/`) auto-downgrades confidence by one level.
- A fix spanning multiple domains escalates to pass 3 regardless of apparent confidence.
- A fix touching > 10 files is `manual review required`. No exceptions.

### Rule 8 — Confidence scoring and justification

Every finding must carry a severity, a confidence rating, and a written justification.

**Severity** (impact if not fixed):

| Level | Definition |
|---|---|
| `critical` | Security vulnerability, RLS bypass, data leakage, production breakage risk |
| `high` | Performance regression, missing critical error handling, gate-script failure |
| `medium` | Code quality debt, weak types, architectural drift, missing documentation |
| `low` | Style inconsistency, minor optimisation, cosmetic issue |

**Confidence** (certainty the proposed fix is correct and safe):

| Level | Definition |
|---|---|
| `high` | Fix is unambiguously correct, no side effects, safety is provable |
| `medium` | Likely correct but has edge cases, limited test coverage, or touches shared code |
| `low` | Requires architectural understanding, changes public contracts, or has uncertain effects |

**Confidence justification — required for every `high`.** Must reference at least one of:

- Test coverage on the affected path — name the test file (e.g. `rls.context-propagation.test.ts`).
- Static analysis proof — typecheck output, gate-script output, or a specific search showing zero callers affected.
- Isolation proof — module imported in exactly one place, confirmed by `grep -r`.
- Scope proof — change is purely additive (no removal, no rename, no reorder).

A finding with no justification defaults to `confidence: medium`.

**Automatic confidence downgrade triggers.** Apply before assigning final confidence.

Downgrade to `medium` if any of:

- Touches shared utilities or a module imported across more than one domain.
- Affects > 10 files.
- Changes a function signature.
- Modifies a type used in more than one module.
- Changes async flow or error propagation.
- Involves shared mutable state, in-memory cache, or event emitter.

Downgrade to `low` (escalate to pass 3) if any of:

- Crosses architectural layers (`server/routes/` ↔ `server/services/` ↔ `server/db/`).
- Touches any RLS-relevant file (`server/config/rlsProtectedTables.ts`, `server/db/middleware/rls*`, `withOrgTx`, `getOrgScopedDb`).
- Touches any pg-boss job handler, job dedup, or idempotency-key logic.
- Touches any retry/backoff (`server/lib/withBackoff.ts`), rate limiter, or cost breaker.
- Touches webhook receivers, signing, or dedup tables.
- Touches three-tier agent execution (`server/services/agentExecution*`, `server/lib/agentRunVisibility*`).
- Modifies any `scripts/gates/*.sh` script.
- Modifies any Drizzle migration in `migrations/`.
- Crosses the customer-facing / support-facing boundary in `docs/capabilities.md` (editorial rules — Module M).
- Touches any implicit external contract from Rule 4.

**Tooling trust.** Tool output is advisory. A tool reporting "safe" is never proof of safety on its own.

### Rule 9 — Test coverage trust model

The protection that Rule 6 validation provides depends entirely on test coverage. AutomationOS is pre-production with sparse unit coverage and gates-first defence.

- Default assumption: coverage on the changed path is **low** unless a specific test file covers it. Document the assumption per area in the report.
- If critical-path coverage is low, downgrade all `high` confidence ratings to `medium` for that area.
- If coverage is absent on the changed path, do not make behavioural changes in pass 2 at all — route to pass 3.
- Static gates passing is **not** the same as test coverage. Gates catch structural violations, not logic regressions.
- Never treat a passing test suite as proof of correctness if it does not cover the path being changed.

### Rule 10 — Do not fight the framework

Never restructure patterns that are framework conventions, even if they look redundant. AutomationOS-specific framework patterns that must not be modified without explicit instruction:

- Drizzle schema files (`server/db/schema/*.ts`) — table-per-file, snake_case columns, soft-delete via `deletedAt: timestamp()`.
- Drizzle migration files in `migrations/` — auto-generated, append-only.
- Express middleware registration order in `server/index.ts` and route mounters.
- React hooks rules and component structure in `client/`.
- Vite config (`vite.config.ts`) and Tailwind v4 config.
- pg-boss job registration patterns (`server/jobs/<name>.ts` with paired entry in `server/config/jobConfig.ts`).
- MCP server registration (`@modelcontextprotocol/sdk` patterns).
- The route → service → db cascade. Even if a route looks like it could query directly for "simplicity", do not collapse the layers.
- The `req.orgId` pattern (never `req.user.organisationId` directly in queries).
- Soft-delete via `isNull(table.deletedAt)` filter on every read query.

If a pattern looks unusual but is consistent across the codebase, research it before flagging. It is more likely a framework or AutomationOS convention than an error.

### Rule 11 — Config-driven and dynamic usage

Code referenced indirectly is in use, even if static analysis tools report it as unreferenced. In AutomationOS, treat as live references:

- Files named in `server/config/actionRegistry.ts`, `server/config/jobConfig.ts`, `server/config/oauthProviders.ts`, `server/config/modelRegistry.ts`, `server/config/portalFeatureRegistry.ts`, `server/config/rlsProtectedTables.ts`, `server/config/universalSkills.ts`.
- Skill markdown files in `server/skills/*.md` referenced by slug from `actionRegistry`.
- Files loaded via dynamic `import()` with computed paths.
- Files referenced by name in any `scripts/gates/*.sh`, `scripts/run-*.sh`, `scripts/*.ts` script.
- Files referenced from `Dockerfile`, `worker/Dockerfile`, or any deployment config.
- Files referenced from `.claude/agents/*.md`, `.claude/hooks/*.js`, `.claude/settings*.json`.
- MCP server modules registered at runtime.
- Drizzle schema files re-exported through `server/db/schema/index.ts` or equivalent.

When in doubt, trace before flagging as dead.

### Rule 12 — Observability preservation

Never remove logs, metrics, traces, or error reporting without verifying:

- The output is not consumed by Langfuse traces, dashboards, or alerts.
- The output is not the only durable record of a critical operation (audit trail for an agent run, webhook receipt, job execution).
- Removal is intentional and approved, not incidental to another cleanup.

If any of these cannot be confirmed, route to pass 3.

### Rule 13 — State, side-effect, and time-dependent awareness

Any change involving the following is high-risk by default. AutomationOS specifics:

- **Shared mutable state.** Module-level caches in `server/lib/` (skill text cache, model registry cache, prompt prefix cache, system prompts).
- **pg-boss queue.** Any job handler, retry policy, dedup table, idempotency key.
- **Webhook receivers.** Signing, dedup, replay handling.
- **Cron/scheduled tasks.** `scheduleCalendarServicePure.ts`, heartbeat math, rrules / cron expressions on `scheduled_tasks`.
- **Cost & rate enforcement.** `server/lib/runCostBreaker.ts`, `server/lib/rateLimiter.ts`, `testRunRateLimit.ts`.
- **Backoff utilities.** `server/lib/withBackoff.ts` (the canonical retry primitive per `docs/spec-context.md`).
- **Agent execution loop.** `server/services/agentExecution*.ts`, the LLM call dispatcher, budget enforcement.
- **Memory & briefing extraction.** `agentBriefingService.ts`, `agentBeliefs.ts`, `memoryWeeklyDigestJob` — these read across many runs and are sensitive to subtle behaviour shifts.
- **Time-dependent logic.** TTL columns, retention windows, archival cutoffs (`llm_requests_archive`, tiered LLM payload retention).

These are never `confidence: high` unless: the change is isolated to a single execution path, that path has named test coverage, and no shared state is read or written as a side effect. Otherwise → pass 3.

### Rule 14 — Idempotency and retry safety

Any change to logic that may execute more than once (job handlers, queue consumers, webhook receivers, agent run retries) must preserve:

- **Idempotency.** Running the operation twice produces the same effect as once.
- **Retry safety.** A mid-operation failure followed by a retry produces no duplicate side effects (no double-charged customer, no double-sent notification, no double-enqueued downstream job).
- **No new dedup gaps.** Existing idempotency keys still suffice for the modified path.

If idempotency or retry safety cannot be proven post-change, the fix is `manual review required` and routes to pass 3 regardless of confidence. **Module J (Idempotency, Queue & Job Discipline)** is the deeper review.

### Rule 15 — Parallel agent coordination

When running multiple subagents across areas:

- **Pass 1 is shared.** All agents work from the same recon map (§2 + audit-specific addendum) and produce findings into the shared report before any pass-2 changes.
- **Pass 2 is serialised per area.** No two agents apply changes concurrently.
- **No overlapping file modifications.** If an area would touch files another area has already modified in the same pass-2 run, pause and escalate the overlap to pass 3.
- **Each agent records its file modification list before committing.** If another agent has already committed to those files since the audit branch was created, rebase and re-validate before committing.
- **`tasks/todo.md` is single-writer.** Two review agents cannot append concurrently — they will race on the write. Serialise human-in-the-loop invocations.
- **Do not fan out review agents in parallel against the same branch.** This applies to `pr-reviewer`, `spec-conformance`, and the ChatGPT review agents.

---

## 4. Protected Files & Patterns (AutomationOS-specific)

The files and patterns below must **never** be deleted or modified without explicit human approval, regardless of what any tool reports. When a tool flags any of these, record the finding and route to pass 3. This list is canonical — do not paraphrase it elsewhere; reference §4 of this framework instead.

### Database & Schema

- `server/db/schema/*.ts` — 50+ Drizzle table definitions. Every change cascades to migrations.
- `server/db/schema/index.ts` (or equivalent re-export barrel) — modules referenced via this barrel are live.
- `migrations/*.sql` — append-only. **Never edit a previous migration** to "fix" a column. Generate a new one.
- `drizzle.config.ts` — ORM source/output paths. Never change `out:` without a migration plan.
- `db-init/*` — one-time DB bootstrap scripts.
- Database column nullability, default values, and constraint definitions — never change without manual review even when the application-layer change "looks safe". A schema change valid in app code can silently break data assumptions.

### RLS, Tenant Isolation & Permissions

- `server/config/rlsProtectedTables.ts` — **canonical RLS manifest**. Every new tenant-scoped table must be added in the same migration that creates it. Removing or renaming entries here is a security-critical change.
- `server/db/middleware/rls*.ts`, `server/lib/withOrgTx.ts`, `server/lib/getOrgScopedDb.ts` (or equivalent) — three-layer fail-closed RLS plumbing.
- `server/lib/agentRunPermissionContext.ts` — canary for run visibility rules.
- `server/lib/agentRunVisibility.ts` — single source of truth for three-tier `canView` / `canViewPayload`.
- Any file matching `*permissionSet*`, `*permissions*`, or `*visibility*` under `server/lib/` or `server/services/`.
- Any `req.orgId` setter in route middleware — never bypass.
- Any `resolveSubaccount` middleware invocation on `:subaccountId` routes.

### CI Gates

- **All `scripts/gates/*.sh` files are CI law.** This includes (non-exhaustive): `verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh`, `verify-subaccount-resolution.sh`, `verify-org-id-source.sh`, `verify-no-db-in-routes.sh`, `verify-tool-intent-convention.sh`, `verify-schema-compliance.sh`. Modifying any gate is itself a behavioural change requiring manual review.
- `scripts/run-all-gates.sh`, `scripts/run-all-qa-tests.sh`, `scripts/run-all-unit-tests.sh` — gate orchestrators.
- `scripts/run-trajectory-tests.ts` — trajectory test runner.

### Idempotency, Queues & Jobs

- All files in `server/jobs/` — pg-boss job definitions. Each carries an implicit payload contract.
- `server/config/jobConfig.ts` — job type registry. Never delete a job type entry; mark it deprecated and stop enqueueing.
- Any file containing `idempotencyKey`, `*_idempotency_keys` table refs, or webhook dedup logic.
- `server/lib/withBackoff.ts` — canonical exponential backoff (per `docs/spec-context.md`).
- `server/lib/rateLimiter.ts`, `server/lib/runCostBreaker.ts`, `testRunRateLimit.ts` — cost & rate enforcement.

### Webhooks & External Integrations

- `server/routes/webhooks.ts` — signed webhook receiver.
- `server/routes/webhookAdapter.ts`, `server/services/webhookAdapterService.ts`, `server/lib/webhookDedupe.ts` — webhook routing & dedup.
- All files in `server/adapters/` — OAuth providers, connector implementations (Slack, HubSpot, GHL, Stripe, Teamwork, GitHub, Gmail). Each carries integration partner contracts.
- OAuth provider config: `server/config/oauthProviders.ts`.

### Three-Tier Agent System

- `server/db/schema/agents.ts`, `server/db/schema/subaccountAgents.ts` — agent hierarchy tables.
- `server/services/agentExecutionService*.ts` — execution engine.
- `server/agents/*` — system-tier agent definitions.
- `tasks/agent-hierarchy-spec.md` — legacy spec retained for reference.
- Agent execution invariants (exactly one active lead per subaccount, atomic swap, ≤5-deep handoff) are enforced at execution time. Changes that touch handoff logic are `manual review required`.

### Skill System

- `server/skills/*.md` — 100+ skill markdown files. Each is loaded by slug from the action registry.
- `server/config/actionRegistry.ts` — canonical skill registry. Renaming a slug breaks every agent that lists it.
- `server/config/universalSkills.ts` — system-wide skills.
- `server/lib/skillVisibility.ts` — visibility cascade rules (platform → org → workspace).
- `scripts/apply-skill-visibility.ts`, `scripts/verify-skill-visibility.ts` — visibility enforcement scripts.

### LLM, Models & Observability

- `server/config/modelRegistry.ts` — model definitions. Removing a model entry breaks every agent or skill that names it.
- Langfuse trace emission code — never remove without confirming external dashboards/alerts do not consume it (Rule 12).
- Tiered LLM payload retention (`agent_run_llm_payloads`, `llm_requests_archive`) — retention windows are operational.

### Editorial / Product Documentation

- `docs/capabilities.md` — product collateral. Editorial rules from `CLAUDE.md` apply (no provider names in customer-facing sections, marketing language only). Module M reviews this in detail.
- `CLAUDE.md` — global playbook. Edits go through the user, not auto-applied.
- `architecture.md` — canonical backend structure. Updates happen in the same commit as any code change that invalidates them (`CLAUDE.md` §11).
- `KNOWLEDGE.md` — append-only. **Never edit or remove existing entries** (`CLAUDE.md` §3).
- `docs/spec-context.md` — framing ground truth for `spec-reviewer` and architectural decisions.
- `docs/spec-authoring-checklist.md` — pre-authoring gate for Significant/Major specs.
- `docs/frontend-design-principles.md` — 5 hard rules. Module M and Module H reviews tie back here.
- All approved spec files under `docs/superpowers/specs/*.md` and `docs/*-spec.md` — deletion = loss of contract.

### Agent & Hook Infrastructure

- `.claude/agents/*.md` — subagent specs. Behaviour-defining; modify only with explicit instruction.
- `.claude/hooks/*.js` — `long-doc-guard.js`, `config-protection.js`, `correction-nudge.js`. Threshold/scope live in the hook itself, not settings.
- `.claude/settings.json`, `.claude/settings.local.json` — hook registration & project-wide settings.

### Task & Build State

- `tasks/current-focus.md` — sprint pointer. Update on context shift, never delete.
- `tasks/todo.md` — single source of truth for deferred items. **Append-only.** Never rewrite or delete existing sections.
- `tasks/builds/<slug>/plan.md`, `tasks/builds/<slug>/progress.md` — feature decomposition & session state.
- `tasks/review-logs/*.md` — durable review records. Append-only.
- `tasks/agent-hierarchy-spec.md` — legacy reference.

### Generated / Auto-Managed

- `dist/*` — compiled output. Never commit or hand-edit.
- `node_modules/*` — dependencies.
- Anything with `_generated_`, `.generated.`, or a header comment `// AUTO-GENERATED — DO NOT EDIT`.

### Containers & Deploy

- `Dockerfile`, `worker/Dockerfile` — server and pg-boss worker images.
- Any deployment manifest at the repo root or under `deploy/`.

### Type Declaration Files

- `*.d.ts` files — type declarations. Modifying these without understanding consumers breaks compile silently.

### Patterns (not files) that are protected

- The `req.orgId` filter on every query.
- The soft-delete `isNull(deletedAt)` filter on every read.
- The route → service → db cascade.
- Three-layer RLS (DB policy + middleware + app check).
- Idempotency keys on every dedupable mutation.
- Atomic lead-agent swap per subaccount.
- Append-only review logs and `tasks/todo.md`.
- Editorial rules on `docs/capabilities.md` (Module M).
- Frontend design hard rules (Module M, also Module H).

### Behavioural rule

When `pr-reviewer`, `spec-conformance`, `dual-reviewer`, or `chatgpt-pr-review` reports anything in this list as "could be removed" or "appears unused" — **do not act on the recommendation**. Surface it back to the human as ambiguity, not as a fix.

---

## 5. Default Execution Order

When areas run sequentially, use this order. It minimises rework and churn between areas.

| Step | Area | Reason |
|---|---|---|
| 1 | Dead code removal | Removes noise before any other analysis begins |
| 2 | Duplicate logic | Easier to spot after dead code is gone |
| 3 | Type definition consolidation | Consolidate before strengthening |
| 4 | Type strengthening | Types stable before error-handling review |
| 5 | Error handling audit | Stable types make error flow clearer |
| 6 | Legacy and dead path removal | Cleaner codebase reduces false positives |
| 7 | AI residue removal | Low-risk, high-signal cleanup |
| 8 | Circular dependency resolution | Easier to resolve after consolidation |
| 9 | Architectural boundary violations | Last, may require rework informed by earlier areas |

When running areas in parallel via independent subagents, this order does not apply, but Rule 15 (parallel agent coordination) does.

**Layer 2 modules are independent.** Run them in any order, or selectively. Suggested order when running all modules: Module I (RLS) → J (idempotency/queues) → K (three-tier agents) → L (skills) → M (editorial/frontend) → A–H (generic). The AutomationOS-specific modules go first because they cover the highest-blast-radius concerns.

---

## 6. Layer 1 — Code Cleanup Audit

### Area 1 — Dead Code Removal

**Objective.** Identify and remove code that is defined but never used. Apply the Protected Files list (§4) before acting on any tool output. Dead-code tools produce false positives — every finding requires manual verification before action.

**How to investigate.**

- Static analysis: `npx knip` is not installed canonically; run via `npx --yes knip` if needed, accepting that the result is advisory only.
- Search for unreferenced exports: `grep -r "^export " server/ shared/ client/ | grep -v __tests__` and cross-reference with `actionRegistry.ts`, `jobConfig.ts`, `oauthProviders.ts`, `modelRegistry.ts`, `portalFeatureRegistry.ts`, `rlsProtectedTables.ts`, `universalSkills.ts`.
- Check for unused npm dependencies: `npx --yes depcheck`. Cross-check with `Dockerfile`, `worker/Dockerfile`, and `scripts/*.ts` before deleting.
- Look for commented-out code blocks left in place.
- Check for feature flags or env-gated branches that can never be reached in any environment (use `git log -p` to confirm intent before deletion).
- Cross-reference every flag against Protected Files list and Rule 11 (config-driven usage).

**High-confidence fixes (pass 2 candidates).**

- Delete files confirmed unreferenced after cross-checking the Protected Files list, all `server/config/*.ts` registries, `scripts/`, `Dockerfile`, and `.claude/` configs.
- Remove unused internal exports (non-public, non-registry).
- Delete commented-out code blocks.
- Remove npm packages confirmed unused by both `depcheck` and manual `grep`.

**What NOT to do.**

- Do not remove anything on the Protected Files list (§4).
- Do not remove code used only by tests (`server/**/__tests__/`, `scripts/run-trajectory-tests.ts`, fixtures). Tests count.
- Do not remove anything loaded via `import()` with computed paths.
- Do not remove server/client entry points (`server/index.ts`, `client/main.tsx`, `worker/`).
- Do not remove anything referenced by name in `server/config/*.ts` registries — even if static analysis shows zero direct imports.
- Do not remove skill markdown files in `server/skills/` without verifying the slug isn't in `actionRegistry.ts`.
- Do not remove any `*.d.ts` declaration file.

**Tool default for AutomationOS.** Manual `grep` cross-referenced against the registries is more trustworthy than `knip` for this codebase, because so much is config-driven. Use `knip` as a starting point, never as the verdict.

---

### Area 2 — Duplicate Logic

**Objective.** Identify logic duplicated across the codebase and consolidate where doing so genuinely reduces complexity. Do not deduplicate mechanically.

Some duplication is intentional. Duplication beats coupling when:

- The two implementations may diverge independently.
- Abstracting them requires a cross-domain import (e.g. between `server/services/` domains, or between server and client without going through `shared/`).
- The duplication exists for performance isolation or readability.
- The two contexts have different change rates or ownership.

**How to investigate.**

- `npx --yes jscpd --min-tokens 15 --reporters console ./server ./client ./shared` — structural clones.
- Focus on business logic, not boilerplate. Drizzle table definitions, route handlers, and Zod schemas are intentionally repetitive — do not deduplicate them mechanically.
- Check service-layer files (`server/services/*.ts`), utility files (`server/lib/*.ts`), and route handlers (`server/routes/*.ts`) first.
- Look for near-duplicates: functions differing only in one parameter, or copy-paste blocks with minor adjustments.
- Pay special attention to `server/lib/withBackoff.ts`, rate limiter, and cost-breaker — duplicates of these patterns elsewhere are smell, not signal (they should reuse the canonical primitive per `docs/spec-context.md`).

**High-confidence fixes.**

- Extract identical utility functions into `server/lib/` or `shared/` where neither side crosses a domain boundary.
- Replace near-duplicate functions with a single parameterised version where the change is obvious.
- Consolidate repeated Zod validation logic into reusable schemas under `shared/`.

**What NOT to do.**

- Do not create premature abstractions. If two functions share one line, leave them.
- Do not consolidate code across bounded contexts (e.g. across two `server/services/` domains) just because the code looks similar.
- Do not break existing exports or signatures — flag as `manual review required`.
- Do not introduce a shared abstraction that creates a new cross-domain dependency.
- Do not deduplicate framework-shaped boilerplate (Drizzle tables, Express routes, MCP server registrations).

---

### Area 3 — Type Definition Consolidation

**Objective.** Locate all type and interface definitions; merge those representing the same concept across multiple locations into a single canonical source under `shared/types/`.

**How to investigate.**

- `grep -rn "^interface " server/ shared/ client/`
- `grep -rn "^export type " server/ shared/ client/`
- `grep -rn "^type " server/ shared/ client/`
- Look for types defined locally in route handlers or component files that duplicate a shared types module.
- Check whether API request/response types are defined independently on server and client.
- Identify types that are structurally identical or near-identical (differing only by optional fields).

**High-confidence fixes.**

- Move duplicated types into `shared/types/` (the existing canonical location).
- Replace local redefinitions with imports from the canonical source.
- Eliminate type aliases that re-export another type by a different name with no added semantics.

**What NOT to do.**

- Do not merge types representing different stages of a workflow. `CreateAgentRunRequest` is not `AgentRun`, even if fields overlap.
- Do not move types if doing so creates a circular import.
- Do not move types that are part of an MCP server's published contract.
- Do not move Drizzle-inferred types (`InferModel<typeof table>`) — they belong with the schema file.
- Do not consolidate `agentRunVisibility` or `agentRunPermissionContext` types — those are explicitly the single source of truth in their current location.

---

### Area 4 — Type Strengthening

**Objective.** Replace weak or escape-hatch types with accurate types derived from the codebase and its dependencies. The goal is not zero `any` mechanically — it is that every type accurately represents what flows through it at runtime.

**How to investigate.**

- `grep -rn ": any\b" server/ shared/ client/`
- `grep -rn " as any\b" server/ shared/ client/` — these are suppressed type errors.
- `grep -rn ": unknown\b" server/ shared/ client/` — `unknown` at trust boundaries (webhook receivers, LLM response parsing) is correct; only flag where used without a type guard.
- Pay special attention to system boundaries: HTTP request bodies (Zod-validate via `shared/`), external API responses, Drizzle query results (use `InferModel`), pg-boss job payloads, Socket.io event payloads, MCP tool responses.

**High-confidence fixes.**

- Replace `any` with the specific union type or interface that accurately represents the data.
- Replace `Function` with a specific signature.
- Use `satisfies` where inference should be retained but shape compliance asserted.
- Add Zod-derived type guards alongside `unknown` usages where narrowing is absent.
- For Drizzle results, use `InferSelectModel<typeof table>` / `InferInsertModel<typeof table>`.

**What NOT to do.**

- Do not replace `any` with a fabricated type. Research what actually flows through. A wrong specific type is worse than `any`.
- Do not add `// @ts-ignore` to suppress errors you do not understand.
- Do not mechanically replace `any` with `unknown`. This cascades narrowing requirements to every callsite.
- Do not flag `unknown` as a problem if it is used correctly with a Zod parse or type guard.
- Do not change the `tsconfig.json` strictness level as part of a Layer 1 audit — that is a Layer 2 / architectural decision.

---

### Area 5 — Error Handling Audit

**Objective.** Find and remove defensive patterns that hide errors rather than handling them. Every `try`/`catch`, error boundary, and fallback value should have a clear documented purpose.

**How to investigate.**

- `grep -rn "catch (.*) {" server/ client/` and inspect each catch body.
- `grep -rn ".catch(() =>" server/ client/` — silent Promise no-ops.
- Look for catch blocks that return a default or fallback without logging — these hide failures.
- Find React error boundaries that swallow without reporting.
- Check for default parameter values that silently substitute when a required value is missing.
- Pay attention to webhook receivers, agent execution loops, and pg-boss job handlers — these MUST surface errors to retry/dedup machinery, not swallow them.

**High-confidence fixes.**

- Replace empty catch bodies with a re-throw or a logged, typed error response.
- Replace silent fallbacks with explicit errors where the caller is responsible for providing a valid value.
- Ensure every catch either handles and records, or re-throws.

**What NOT to do.**

- Do not remove error handling at boundaries with external systems. Network failures are expected and must be caught.
- Do not remove user-facing error boundaries in `client/` — replace with ones that report, not vanish.
- Do not convert all error handling to throws without verifying the caller.
- Do not modify retry logic, queue error handling, agent-run failure paths, or webhook dedup. These are protected (Rule 14, §4 Idempotency).
- Do not modify error wrapping that feeds Langfuse traces (Rule 12).

> **Rule of thumb.** If you cannot complete the sentence "I am catching this error because..." for a given catch block, it should be removed or replaced. If you cannot complete it confidently, route to pass 3.

---

### Area 6 — Legacy and Dead Path Removal

**Objective.** Track down deprecated, legacy, and abandoned code paths. Remove them and ensure every remaining path is clean and direct.

**How to investigate.**

- Search markers: `grep -rn -E "TODO|FIXME|HACK|DEPRECATED|LEGACY|TEMP|WORKAROUND|XXX|REMOVE" server/ client/ shared/`.
- Look for env-gated branches that are now always-on or always-off (e.g. `if (process.env.FEATURE_X === 'on')` where no environment sets it differently). Check `docs/env-manifest.json`.
- Find version-check branches that can no longer be reached (e.g. legacy schema-version branches after a migration).
- Identify adapter/shim layers introduced to bridge old and new API versions where the old version is gone (the `migrate:drizzle-legacy` script suggests one such migration is in flight — confirm before pruning).
- Check for `_v1`, `_old`, `_backup`, `_new`, `_legacy` suffixes on function or file names.
- Look at `tasks/deferred-work.md` and `tasks/todo.md` for items that may already be resolved.

**High-confidence fixes.**

- Delete `TODO`/`FIXME` comments describing work already done (verify via `git log -p` first).
- Remove env flags that are always-on and inline the enabled path.
- Delete adapter layers and shims where the underlying API they bridged has been removed.
- Remove `_old`/`_backup` copies of files and functions.

**What NOT to do.**

- Do not remove a `TODO` without verifying the issue is resolved.
- Do not remove env flags still disabled in any environment.
- Do not delete a `FIXME` describing a genuine unresolved issue. Convert it to a `tasks/todo.md` entry first.
- **Do not remove resilience fallbacks.** Fallbacks that protect against external service failure, partial outages, degraded modes, or webhook signing-key rotation are operational infrastructure — not legacy. Examples: integration adapters with retry-with-backoff and a final no-op, agent execution that falls back to a "degraded" lead agent if the active one is missing, OAuth refresh-token rotation. If uncertain whether a fallback is legacy or resilience, route to pass 3.
- Do not delete the `migrate:drizzle-legacy` script or its callers without an explicit migration plan.

---

### Area 7 — AI Residue Removal

**Objective.** Find and remove the residue of AI-assisted code generation: stub implementations, placeholder comments, change-log notes, and comments that describe what the code does rather than why. If a comment stays, it must help a new developer understand something they could not derive from reading the code itself.

**How to investigate.**

- `grep -rn -E "TODO: implement|placeholder|stub|// This was changed|// Added by|// Updated to use|// Previously this was|// Note:|// We need to|// FIXME: claude|// added by claude" server/ client/ shared/`.
- Look for functions returning only a hardcoded value with a comment describing what the real implementation should do.
- Find comments restating what the adjacent code does (`// increment counter` above `i++`).
- Identify `console.log` statements left from debugging.
- Check for mock data or hardcoded test values embedded in production paths.
- Look for `Used by X` / `Added for the Y flow` / `handles the case from issue #123` style comments — these belong in commit messages, not the code (`CLAUDE.md` Tone & Style).

**High-confidence fixes.**

- Delete comments describing what already-clear code does.
- Delete change-log comments. Git history serves this purpose.
- Remove stub functions superseded by real implementations.
- Remove debug `console.log` from production paths.
- Remove hardcoded mock data from non-test files.

**What to keep.**

- Comments explaining WHY a non-obvious decision was made.
- Comments documenting a known limitation or external constraint (e.g. "GHL API requires X-API-Version: 2021-07-28 or webhook signing fails").
- Comments referencing a ticket number or external context a developer needs.
- Comments explaining a counter-intuitive algorithm or data-structure choice.
- Editorial-rule comments in `docs/capabilities.md` are not AI residue — they are intentional governance.

> **The Why Test.** Read each comment and ask: does this tell me something the code does not? If not, delete. If yes — does it tell me why, not just what? If only what, delete.

---

### Area 8 — Circular Dependency Resolution

**Objective.** Identify and resolve import cycles. Cycles cause subtle bugs, make code harder to reason about, and can cause module-initialisation failures (especially in ESM, which AutomationOS uses).

**How to investigate.**

- `npx --yes madge --circular --extensions ts,tsx ./server` (and `./client`, `./shared`).
- Prioritise cycles involving core modules (`server/db/`, `server/lib/`, `server/services/agentExecution*`, `shared/types/`) over peripheral ones.
- For each cycle, determine which direction is wrong — usually the one crossing an architectural layer.

**High-confidence fixes.**

- Extract the shared code that both sides need into a new lower-level module under `server/lib/` or `shared/`.
- Move type-only imports to a types-only file under `shared/types/` that does not import from either side of the cycle.
- Use Zod schemas from `shared/` as the dependency-inversion boundary between client and server.

**What NOT to do.**

- Do not wrap an import in a function to defer it. This hides the cycle.
- Do not introduce a global singleton or module-level cache to work around a cycle. This adds shared mutable state (Rule 13).
- Do not break a cycle by moving code into a Drizzle schema file — schema files are protected (§4) and have a single responsibility.
- Do not introduce a circular reference between `actionRegistry.ts` and any individual skill module — registry entries reference skills by slug, not by import.

---

### Area 9 — Architectural Boundary Violations

**Objective.** Identify imports that cross architectural boundaries in the wrong direction. Beyond circular dependencies, this catches directional violations that are not circular.

**AutomationOS-specific violation patterns to check.**

| Violation | Example |
|---|---|
| Route imports `db` directly | Any file in `server/routes/` importing from `server/db/` instead of going via `server/services/` |
| Service imports route/controller logic | A service importing types or helpers from a route file |
| `server/db/schema/` imports from `server/services/` or `server/routes/` | Schema must be a leaf — never imports up |
| Shared module depends on app-specific module | A `shared/` file importing from `server/services/` or `client/components/` |
| `client/` imports from `server/` | Direct imports across the runtime boundary (use HTTP / Socket.io / shared types only) |
| Server imports client code | Reverse of above — server should never need anything in `client/` |
| Test utility imported into production code | `__tests__/` helpers, fixtures, or trajectory test runners imported from non-test paths |
| Any production code imports from `tasks/` | `tasks/` is documentation, not source |
| Any code imports from `migrations/` | Migrations are sealed |
| Any code imports from `dist/` | Compiled output is never imported in source |
| Direct `db` use in non-service modules | Cron job handlers must go via services where possible; if direct `db` is required, scope via `withOrgTx` |
| Non-route file calls `req.user.organisationId` | Should use `req.orgId` set by middleware |

**How to investigate.**

- Run all gate scripts: `npm run test:gates`. The CI gates already enforce most of these (`verify-no-db-in-routes.sh`, `verify-rls-contract-compliance.sh`, `verify-org-id-source.sh`, `verify-subaccount-resolution.sh`). Any failure is a finding.
- For violations the gates don't catch: `npx --yes dependency-cruiser --include-only "^(server|client|shared)" --output-type err ./server ./client ./shared` with rules configured for layer boundaries.
- Manual inspection of `server/lib/` for files that should live under `server/services/` instead.

**High-confidence fixes.**

- Move misplaced logic to the correct layer.
- Extract shared logic depended on by multiple layers into a lower-level utility (`server/lib/` or `shared/`) with no layer dependencies of its own.

**What NOT to do.**

- Do not fix a boundary violation by moving the import without understanding why it was there. It may represent a real design gap.
- Do not introduce new abstractions unless the violation is structural — flag for pass 3.
- Do not modify any `scripts/gates/*.sh` to "make the gate pass". Failing gates are findings to fix, not noise to suppress.
- Do not collapse the route → service → db cascade for "simplicity". The layer separation is the security model.

---

## 7. Layer 2 — Production Readiness Audit (generic modules)

These modules are independently selectable. Enable the ones relevant to your release context. Each follows the same three-pass structure as Layer 1.

---

### Module A — Security Review

**Note.** This module covers generic application security. Multi-tenancy / RLS is split out into Module I because it warrants its own deep audit.

- Authentication and authorisation enforced at every API boundary, not just top-level routes. Verify `req.user` and `req.orgId` are populated before any handler accesses tenant data.
- All user inputs validated through Zod schemas in `shared/` before use. No raw `req.body` access without schema validation.
- No hardcoded secrets, credentials, or tokens in source. Cross-check with `docs/env-manifest.json`.
- Sensitive data (passwords, tokens, PII, cost ledgers, OAuth refresh tokens) excluded from all logging. Cross-check Langfuse trace emission for accidental PII leakage.
- Rate limiting (`server/lib/rateLimiter.ts`) applied to authentication and high-value endpoints (agent execution, webhook receivers, portal endpoints).
- CORS policy explicit and restrictive. No wildcard origins in production.
- Security headers present (CSP, X-Frame-Options, HSTS, Referrer-Policy) — configured in Express middleware.
- `npm audit` reports no critical-severity vulnerabilities (Module F covers this in detail).
- SQL injection not possible — Drizzle parameterises all queries. Flag any raw SQL string interpolation.
- No `eval()` or equivalent dynamic code execution on untrusted input.
- Webhook signature verification present for every inbound provider (Slack, HubSpot, GHL, Stripe, Teamwork, GitHub, Gmail).
- OAuth state parameter validated on every callback to prevent CSRF.
- Cost ceilings enforced before every LLM call (`server/lib/runCostBreaker.ts`) — cannot be bypassed by alternative code paths.

**Release gate.** Any `critical` security finding blocks release. Security fixes that change authentication flows, RLS policies, or API contracts go to pass 3 and require `pr-reviewer` + `dual-reviewer` (locally) before merge.

---

### Module B — Performance Review

- No N+1 query patterns. Verify Drizzle usage inside loops — flag any `await db.select(...)` in a `for` or `forEach`.
- Database indexes present on all foreign keys and commonly filtered columns (`organisation_id`, `subaccount_id`, `created_at`, `deleted_at`, soft-delete + tenant compound indexes).
- No synchronous blocking operations in async code paths. Long-running compute should yield via `await` or move to a pg-boss job.
- Frontend main bundle size acceptable (flag if > 500KB gzipped). Use `vite build` output stats.
- No unbounded queries. Every list query has `limit()` or pagination — especially across large tables (`agent_runs`, `llm_requests_archive`, `task_activities`).
- Long-running operations are pg-boss jobs, not HTTP request handlers.
- Prompt prefix caching (`stablePrefix`) reused — duplicate document-bundle assembly per run is a regression.
- LLM payload retention tiering working as designed (recent full / summarised older / archived oldest).

**Do not introduce proactively.** Caching, memoisation, batching, or new indexes are not added unless a real, measured problem has been identified or the change is explicitly within audit scope. Premature optimisation creates more debt than it removes.

---

### Module C — Test Coverage

**AutomationOS context.** Pre-production. Static gates are the primary defence. Module C does not require expanding the test suite mechanically — it requires verifying that critical paths have at least one named test or trajectory.

- Critical business logic has named coverage. At minimum:
  - RLS context propagation (`rls.context-propagation.test.ts` or equivalent).
  - Idempotency-key dedup logic.
  - Three-tier agent visibility rules (`agentRunVisibility.ts`).
  - Cost breaker invocation on every LLM call site.
- Happy path and at least one error path covered for each public route or trajectory.
- Multi-tenant or permission-sensitive paths have isolation coverage.
- Tests are not so heavily mocked that they cannot catch real regressions.
- Test suite runtime reasonable (flag if > 10 minutes for `npm test` full run).
- No tests dependent on execution order.
- No hardcoded dates, times, or random seeds without an explicit fixture pin.
- Trajectory tests in `tests/trajectories/` represent real recorded agent runs — not fabricated paths.
- Gate scripts (`scripts/gates/*.sh`) are not bypassed or stubbed.

**Coverage assessment per audit.** Record one of: `gates only`, `gates + sparse unit`, `gates + unit + trajectory`, `comprehensive`. Most areas will be `gates only` or `gates + sparse unit` — that is acceptable for pre-production but constrains Rule 9 trust.

---

### Module D — Documentation Completeness

- `CLAUDE.md`, `architecture.md`, `KNOWLEDGE.md` reflect the current state. Run a "doc-code drift" check: pick 5 random architectural claims from `architecture.md` and confirm against code.
- All environment variables documented in `docs/env-manifest.json` with descriptions. New env vars added since last audit are present.
- `docs/capabilities.md` reflects current product capabilities, integrations, and skills. New skills added since last audit are listed under § Skills Reference.
- Editorial rules from `CLAUDE.md` § Editorial rules respected in every customer-facing section. **Module M is the deep audit** — Module D only spot-checks.
- Non-obvious functions have a comment explaining purpose and constraints (Area 7 of Layer 1 governs comment style).
- No documentation referencing removed features or superseded architecture.
- API endpoints documented where they form a contract: portal API, MCP tool surface, webhook adapter intake.
- Deployment and rollback procedures documented (typically in `Dockerfile`, `worker/Dockerfile`, and any deploy script).
- Spec files in `docs/superpowers/specs/` and `docs/*-spec.md` reflect what was actually shipped. If they don't, route to `tasks/todo.md` for `spec-conformance` to revisit.

**Doc-code sync rule.** Per `CLAUDE.md` §11, any code change that invalidates a doc updates that doc in the same commit. Module D verifies the rule has been followed since the last audit.

---

### Module E — Observability and Operability

- Structured logging in place. Log output parseable, not freeform strings.
- Health check endpoint returns meaningful status (DB connectivity, pg-boss availability, Langfuse reachability), not just HTTP 200.
- Key operations emit Langfuse traces or metrics — agent execution, LLM calls, webhook receipts, pg-boss job lifecycle, cost-breaker triggers.
- Errors include enough context to diagnose without a debugger attached: orgId, subaccountId (if applicable), runId (if applicable), job-name + dedup-key (for jobs).
- No logging of secrets, tokens, PII, OAuth refresh tokens, or full prompt bodies (prompt body retention is governed by the LLM payload tiered retention design, not log streams).
- Graceful shutdown implemented in `server/index.ts` and `worker/` — in-flight HTTP requests complete, pg-boss workers finish current jobs before process exits.
- pg-boss queue depth, retry counts, and dead-letter rates are observable.
- Three-tier agent runs emit visibility-aware traces — service-principal traces never expose user-private payloads to org-shared dashboards.

**Preservation reminder.** Rule 12 applies. Do not remove any existing logging, metrics, or trace emission without verifying it is not consumed by an external monitoring system, alerting rule, or Langfuse dashboard. When in doubt, route to pass 3.

---

### Module F — Dependency and Supply Chain Risk

- `npm audit` shows no `critical` or `high` vulnerabilities on production paths (dev dependencies can be flagged with lower urgency).
- `package-lock.json` committed and up to date.
- No dependencies abandoned > 2 years on critical paths (Drizzle, pg-boss, Express, React, Vite, Anthropic SDK, MCP SDK, Langfuse, Playwright, Zod, Socket.io).
- No duplicate versions of the same package at major-version level (run `npm ls <pkg>` for the heaviest deps; flag, do not auto-fix).
- `package.json` engines field honoured by CI / Docker base images.
- Lockfile changes in audit branch are intentional, not accidental.

**Auto-fix discipline.** `npm audit fix` is **not** a pass-2 fix. Even patch-level upgrades can change runtime behaviour for libraries this central to the stack (Drizzle, pg-boss, Anthropic SDK). Treat any dependency change as `manual review required`.

---

### Module G — API and Spec Contract Preservation

**Enabled by default.** AutomationOS exposes durable contracts: portal client API, MCP tool surface, webhook adapter intake, integration adapter outbound calls, agent execution SDK contract.

- All endpoints documented in specs (`docs/superpowers/specs/*.md`, `docs/*-spec.md`) are implemented. Use `spec-conformance` agent for the deep audit per spec.
- No endpoints removed or path-changed without a deprecation notice.
- Request and response shapes match the documented schema (Zod schemas in `shared/`).
- Authentication requirements match what is documented.
- Error response shapes consistent across endpoints.
- pg-boss job payload shapes preserved across versions — adding optional fields is safe; renaming or removing required fields is not.
- Webhook payload contracts preserved — partner integrations cannot be silently broken.
- MCP tool surface (`@modelcontextprotocol/sdk`) preserved — agents that registered tools by name continue to find them.
- Three-tier agent execution contract (`shared/types/agentExecution.ts` and equivalents) preserved.
- Skill `actionRegistry` slugs preserved — renaming a slug breaks every agent that lists it.
- Portal client API (`/portal/<slug>/*`) preserved — agency clients depend on stable shapes.

**Rule.** Any fix that would change a public API contract is `manual review required` in pass 1. Never auto-applied in pass 2 regardless of confidence. **Use the `spec-conformance` agent for spec-driven contracts and `pr-reviewer` for the rest.**

---

### Module H — Accessibility (Frontend)

This module focuses on technical a11y. Module M covers the higher-level frontend design discipline.

- Semantic HTML used throughout (headings, lists, buttons, form labels). Avoid `<div onClick>` — use `<button>`.
- All interactive elements keyboard accessible. Tab order logical.
- Focus indicators visible.
- ARIA labels present where semantic HTML is insufficient.
- Colour contrast meets WCAG AA (4.5:1 normal text, 3:1 large text).
- No information conveyed by colour alone.
- Dynamic content updates announced to screen readers via `aria-live` where relevant — agent run status, job completion, real-time Socket.io events.
- Modals trap focus and restore on close.
- Form errors announced and associated with their inputs (`aria-describedby`).

**Defer to Module M for design judgement.** A page may be technically accessible but still violate Frontend Design Principles (`docs/frontend-design-principles.md`). Module H asks "can a screen-reader user complete this task?". Module M asks "should this dashboard exist at all?".

---

## 8. Layer 2 — AutomationOS-specific modules

These modules cover the highest-blast-radius concerns specific to AutomationOS. They have no equivalent in the generic v5.0 framework. Run them on every release-gate audit.

---

### Module I — RLS & Multi-tenancy Three-Layer Compliance

**Why this is its own module.** AutomationOS uses a fail-closed three-layer RLS architecture. A defect at any layer leaks tenant data. This is the highest-severity surface in the codebase.

**Three-layer model** (recap from `architecture.md`):

1. **Layer 1 — Postgres RLS policies** keyed on `app.organisation_id` session variable. Defined per-table in migrations. Manifest: `server/config/rlsProtectedTables.ts`.
2. **Layer 2 — Middleware** sets `app.organisation_id` via `withOrgTx` / `getOrgScopedDb` before every DB-touching code path.
3. **Layer 3 — Application-level** permission and visibility checks (`server/lib/agentRunPermissionContext.ts`, `server/lib/agentRunVisibility.ts`, `server/lib/skillVisibility.ts`).

**Audit checklist.**

- Run `npm run test:gates`. Specifically: `verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh`, `verify-subaccount-resolution.sh`, `verify-org-id-source.sh`, `verify-no-db-in-routes.sh` must all pass. Any failure is `critical` severity and blocks release.
- Every tenant-scoped table (anything with `organisation_id` or `subaccount_id`) is in `rlsProtectedTables.ts`.
- Every entry in `rlsProtectedTables.ts` has a corresponding `CREATE POLICY` migration.
- Every DB access path passes through `withOrgTx` or `getOrgScopedDb`. `db.select(...)` calls outside this scope are `critical` severity.
- Every route with `:subaccountId` calls `resolveSubaccount(subaccountId, orgId)` middleware.
- Every query filters by `req.orgId`. Direct use of `req.user.organisationId` in queries is a `critical` finding.
- Every read query filters `isNull(table.deletedAt)` for soft-deleted tables.
- Permission checks happen at route + service + RLS — three layers, not one. Removing any one is a `critical` regression even if the other two still pass.
- Visibility scope (`private` / `shared-team` / `shared-subaccount` / `shared-org`) consistent across reads and writes for the same entity.
- Service-principal and delegated-grant access paths cannot read user-private data unless explicitly shared.
- No direct SQL string interpolation that could bypass Drizzle parameterisation.
- New tables added since last audit have RLS coverage on Day 1 — there is no "we'll add RLS later" migration pattern.

**High-risk patterns to flag.**

- A `db` import in any file under `server/routes/`. Should never happen — gate enforces, but verify.
- Use of a non-org-scoped `db` instance in any query that touches a tenant-scoped table.
- A query bypassing soft-delete by using `db.execute(sql\`...\`)` instead of Drizzle.
- Three-tier agent run visibility checks that compare `runId` ownership without going through `agentRunVisibility.ts`.
- Service-principal-owned data leaking into user-shared dashboards.

**Output.** Any RLS finding is `critical` by default. Auto-fixes only if the gate-script identified the specific missing manifest entry or the specific missing `withOrgTx`. Anything else routes to pass 3 + `pr-reviewer` + `dual-reviewer` (locally).

---

### Module J — Idempotency, Queue & Job Discipline

**Why this is its own module.** pg-boss is the canonical queue and exact-once execution surface. Webhooks, agent runs, and scheduled jobs all flow through it. A break in idempotency means duplicate charges, duplicate notifications, duplicate agent runs, double-billed LLM calls.

**Audit checklist.**

- Every dedupable mutation has an idempotency key. Verify by listing tables with `*_idempotency_keys` suffix and confirming each is consulted before insert.
- Every pg-boss job handler is idempotent. Running it twice with the same payload produces the same result as running it once.
- Retry safety holds: a mid-handler crash followed by retry produces no duplicate side effects. Specifically:
  - LLM calls — cost recorded once, not twice.
  - Webhook outbound — sent once, deduped if retried.
  - Notification dispatch — fired once.
  - Cost ledger — incremented once.
  - Memory/briefing extraction — single canonical row, not duplicated.
- Job payload schemas are stable. New optional fields safe; required-field changes need migration.
- `server/lib/withBackoff.ts` is the canonical retry primitive. Custom retry loops elsewhere are smell — flag and route to pass 3.
- Rate limiter (`server/lib/rateLimiter.ts`) and cost breaker (`server/lib/runCostBreaker.ts`) cannot be bypassed by an alternate code path. Every LLM call site checks the breaker before dispatch.
- Webhook signature verification + dedup happen before any side effect.
- `scheduled_tasks` cron expressions / rrules are deterministic and don't depend on server-local time zone.
- pg-boss dead-letter queue is monitored — failed jobs not silently dropping.
- Test runs (`is_test_run = true`) excluded from usage aggregates and cost ceilings.
- Three-tier agent runs honour exactly-one-active-lead-per-subaccount via atomic swap, not last-writer-wins.

**Idempotency must be proven against real storage boundaries — never inferred from in-memory logic.** "This function looks idempotent" is not evidence. Acceptable evidence: the database has a unique constraint on the dedup key; the pg-boss job table records the idempotency key and rejects duplicates at insert time; the webhook dedup table writes-then-checks; an integration test exercises the retry path against a real DB and asserts no duplicate side effect. If the only argument for idempotency is "it reads correctly", route to pass 3.

**Output.** Any idempotency or dedup gap is `critical` severity. Per Rule 14, never `confidence: high` for changes that touch this surface.

---

### Module K — Three-Tier Agent Invariants

**Why this is its own module.** The three-tier agent model (System → Org → Subaccount) is the core product surface. Invariant violations cascade silently — a subaccount can lose its lead agent, a brief can route to the wrong specialist, an org-tier change can leak into another org's subaccounts.

**Invariants to audit.**

- **Exactly one active lead agent per subaccount** at all times. Atomic swap, not delete-then-insert. Verify via `server/services/agentExecutionService*.ts` and the schema's unique constraint.
- **Three-tier cascade direction** is System → Org → Subaccount. Subaccount cannot inherit upward; org cannot inherit from subaccount.
- **Agent handoff depth ≤ 5.** Enforced at execution time. Verify the depth-check is on every handoff path, not just the entry point.
- **Scope validation at execution time, not by convention.** A specialist cannot escalate beyond its authorised scope even if the handoff chain naively allowed it.
- **Degraded fallback path.** If a subaccount's lead is missing or broken, briefs fall back to the org Orchestrator with a "degraded" signal, not silently fail.
- **Handoff audit trail** is durable. Every handoff records who-to-whom, why, and the outcome. Verify retention.
- **System-tier changes don't leak into per-org overrides.** Org-level customisation must shadow system-tier defaults, not the reverse.
- **Subaccount-tier changes don't escape** to the org or system level.
- **Service-principal vs delegated-grant boundaries** preserved (Module I overlaps here).
- **Test runs** (`is_test_run = true`) execute in an isolated path that doesn't touch production cost ledgers, briefings, or memory extraction.

**Audit method.**

- Read `architecture.md` § AI Agent System and `docs/capabilities.md` § AI Agent System. Pick 5 invariants and trace them through the code.
- Inspect `server/services/agentExecutionService*.ts`, `server/lib/agentRunVisibility.ts`, `server/lib/agentRunPermissionContext.ts`, `server/db/schema/agents.ts`, `server/db/schema/subaccountAgents.ts`.
- For each invariant, confirm at least one path-specific test (or trajectory test) exists. If none, route to `tasks/todo.md` for test addition.

**No invariant may be enforced purely by convention. Every invariant must be enforced in code or schema.** "We always do X" is convention. "The schema rejects rows where X is violated" is enforcement. "Every code path that could break X calls a single validator that throws" is enforcement. If an invariant relies on developers remembering to do the right thing, it is already broken — flag it, route to pass 3, and recommend either a schema constraint, a single chokepoint validator, or a CI gate in `scripts/gates/`.

**Output.** Invariant violations are `critical`. Refactors that touch agent execution are never `confidence: high` (Rule 13).

---

### Module L — Skill Registry & Visibility Coherence

**Why this is its own module.** 100+ skills in `server/skills/*.md`, registered in `server/config/actionRegistry.ts`, gated by visibility cascade (`server/lib/skillVisibility.ts`), with allowlists per agent. Drift between any of these surfaces produces silent breakage — agents listing missing skills, skills callable by unauthorised tiers, methodology-vs-intelligence misclassification.

**Audit checklist.**

- Every skill markdown file in `server/skills/` has a corresponding entry in `actionRegistry.ts` (or is intentionally unregistered with a clear comment).
- Every entry in `actionRegistry.ts` has a corresponding markdown file (or a deterministic implementation, not both unless intentional).
- Every skill's `gateLevel` is consistent with how it's invoked.
- Every skill referenced from any agent's allowlist is registered in `actionRegistry.ts`.
- **Methodology skills** (template-based LLM generation) use `executeMethodologySkill()` — not deterministic computation. GEO skills are methodology skills (per `KNOWLEDGE.md`).
- **Universal skills** (`server/config/universalSkills.ts`) are visible everywhere by design — anything narrower belongs in the per-agent allowlist.
- Visibility cascade respected: platform-tier skills visible everywhere; org-tier visible only within the org; workspace-tier visible only within the subaccount.
- `npm run skills:verify-visibility` passes. If it fails, that is a `high` finding.
- Skill slugs in kebab-case. Renaming a slug breaks every agent that lists it — slug renames are `manual review required`.
- Markdown skill titles match their registered names within reason (drift suggests stale collateral).

**Output.** Skill registry drift is `medium` severity by default, `high` if it could cause an agent to fail at execution time.

---

### Module M — Capabilities Editorial & Frontend Design Principles Guard

**Why this is its own module.** `docs/capabilities.md` and the frontend surface are customer-facing. Drift from the editorial rules and design principles directly affects how the product is sold and perceived. The generic Module D (Documentation Completeness) does not protect against marketing/positioning mistakes.

**Part 1 — Capabilities editorial rules audit.** Apply the 5 rules from `CLAUDE.md` § Editorial rules to `docs/capabilities.md`:

1. **No specific LLM/AI provider names in customer-facing sections** — Core Value Proposition, Positioning & Competitive Differentiation, Product Capabilities, Agency Capabilities, Replaces / Consolidates. Run a grep for: `Anthropic`, `Claude`, `Claude Code`, `Cowork`, `Routines`, `Managed Agents`, `Agent SDK`, `OpenAI`, `ChatGPT`, `GPT`, `Gemini`, `Google`, `Microsoft Copilot`. Any hit in customer-facing sections is a violation.
2. **Provider names allowed only in Integrations Reference and Skills Reference** (factual product documentation).
3. **Marketing/sales-ready terminology in customer-facing sections.** No internal technical identifiers (table names, service names, library names — `pg-boss`, `BullMQ`, `Drizzle`). Standard industry terms (OAuth, HTTP, webhook, Docker, Playwright) acceptable when they clarify offering.
4. **Vendor-neutral positioning even under objection.** No "why not Anthropic specifically" answers in written collateral.
5. **Model-agnostic north star.** Frame as routing to the best model per task across every frontier and open-source LLM. Never imply preferred/premium provider in customer-facing copy.

**Editorial violations block the edit.** Audit findings under Module M are reported with severity `high` (customer-facing) or `medium` (support-facing) and routed to pass 3 — never auto-rewritten.

**Part 2 — Frontend Design Principles audit.** Apply the 5 hard rules from `CLAUDE.md` § Frontend Design Principles + `docs/frontend-design-principles.md` to every UI artifact (mockup, component, page) added or changed since last audit:

1. **Start with the user's primary task, not the data model.** Find any screen designed from "the backend exposes X, Y, Z — so the UI shows panels X, Y, Z". Flag for redesign.
2. **Default to hidden.** Flag any new metric dashboard, KPI board, trend chart, diagnostic panel, prefix-hash/ID exposure, aggregated-cost view, per-tenant financial breakdown, or observability surface that doesn't have an explicit user-workflow justification or an admin-only gate.
3. **One primary action per screen.** Count primary actions per screen. ≥ 2 → split. ≥ 3 sidebar panels → cut one. Table + chart + ranking + KPI tiles together → rebuilding a monitoring product.
4. **Inline state beats dashboards.** Flag any new page where the same state could live as inline UI on an existing page.
5. **The re-check.** Would a non-technical operator complete the primary task on this screen without feeling overwhelmed? If not "yes, obviously" — cut information.

**Caps to verify** (from `docs/frontend-design-principles.md`):

| Element | Cap |
|---|---|
| Primary actions | 1 |
| Panels | ≤ 3 |
| KPI tiles | 0 by default |
| Charts | 0 by default |
| Table columns | 4 (name, key state, timestamp, action) |
| Sidebar cards | 1 |
| Hash/ID exposures | 0 by default (admin-only) |

**Output.** Frontend design violations are `high` for customer-visible screens, `medium` for admin-only. Always routed to pass 3 — never auto-trimmed (design judgement requires human input).

---

## 9. Integration with the existing review pipeline

This framework **does not replace** the existing AutomationOS review-loop infrastructure. It feeds into it. Every audit run ends with `pr-reviewer` on the changed surface. Spec-driven contracts go through `spec-conformance` first.

### Sequence for an audit run

| Phase | What happens | Who owns it |
|---|---|---|
| 0. Plan | Classify scope (Trivial / Standard / Significant / Major), write recon map, choose layers/modules, write `tasks/builds/audit-<scope>-<date>/plan.md`. For Significant or Major: invoke `architect` first | Main session |
| 1. Reconnaissance | Validate / refresh §2 context block. Identify in-scope and out-of-scope paths. Check for in-flight branches and open PRs | Main session, optional `Explore` subagent |
| 2. Pass 1 — Findings | Run all in-scope areas/modules, produce findings table. No code changes. Save findings to the audit report | Main session, may delegate per-area to subagents (Rule 15) |
| 3. Pass 2 — High-confidence fixes | Apply fixes one area at a time. Validate (Rule 6) after each. Commit per area | Main session |
| 4. `spec-conformance` (if spec-driven) | If any in-scope change touches a spec-driven contract, invoke `spec-conformance` against the spec. Auto-applied mechanical fixes will appear in subsequent commits | `spec-conformance` agent (auto-commit, auto-push) |
| 5. `pr-reviewer` | Mandatory for any non-trivial audit. Review the full audit branch. Persist log to `tasks/review-logs/pr-review-log-audit-<scope>-<timestamp>.md` | `pr-reviewer` agent (read-only) |
| 6. `dual-reviewer` (optional, local-dev only) | If user explicitly asks AND session is local with Codex CLI | `dual-reviewer` agent |
| 7. ChatGPT review (optional) | Run in a dedicated new Claude Code session via `chatgpt-pr-review` if external review pass is requested | `chatgpt-pr-review` agent |
| 8. KNOWLEDGE.md update | Append audit-specific patterns/corrections to `KNOWLEDGE.md` (see §10) | Main session |
| 9. Final report | Persist the audit report to `tasks/review-logs/codebase-audit-log-<scope>-<timestamp>.md` and update `tasks/todo.md` with deferred items | Main session |
| 10. Hand off | Present the report and `tasks/todo.md` deltas to the user. The user pushes manually after review (CLAUDE.md User Preferences). The user creates the PR if required — the audit run does not | User |

### When to run which agents

- **`pr-reviewer`** — every non-trivial audit, before declaring complete.
- **`spec-conformance`** — if any in-scope change touches a spec-driven contract (most Layer 2 Module G or Module K work).
- **`dual-reviewer`** — only when the user explicitly asks AND the session is local with Codex CLI installed.
- **`chatgpt-pr-review`** — when a third-party review pass adds value (typically before a major release).
- **`architect`** — for Significant or Major audit scopes, called during phase 0 (Plan).
- **`feature-coordinator`** — only if the audit itself is a planned multi-chunk feature (rare).
- **`triage-agent`** — to capture bugs/ideas surfaced mid-audit without derailing focus.

### What the audit framework does NOT do

- **It does not auto-create PRs.** The user creates the PR.
- **It does not auto-push.** Review agents push within their flows; the main session does not.
- **It does not run in parallel against the same branch as another review agent.** Rule 15.
- **It does not modify `scripts/gates/*.sh`.** Gates are CI law (§4 Protected Files).
- **It does not modify migrations.** Migrations are append-only.
- **It does not bypass the editorial rules on `docs/capabilities.md`.** Module M flags violations; humans rewrite.

### Findings → backlog → KNOWLEDGE.md

Findings have three destinations depending on classification:

1. **Pass-2 fixes** — committed to the audit branch directly.
2. **Pass-3 deferred items** — appended to `tasks/todo.md` under a new dated section: `## Deferred from codebase audit — <date>`. Format follows `CLAUDE.md` Review-log filename convention. Each item lists `**Captured**`, `**Source log**` (path to the audit report), and a checkbox.
3. **Patterns to prevent recurrence** — appended to `KNOWLEDGE.md` per `CLAUDE.md` §3, with the `### [YYYY-MM-DD] Pattern — <short title>` heading shape (see §10 below).

---

## 10. Audit lifecycle — logging, KNOWLEDGE.md, deferred items

### Audit report log

Every audit run persists a durable report. Filename convention follows the canonical review-log shape from `CLAUDE.md`:

```
tasks/review-logs/codebase-audit-log-<scope>-<timestamp>.md
```

- `<scope>` — short kebab-case name describing the audit scope (`full-codebase`, `agent-execution-only`, `frontend-design`, `pre-release-q2`).
- `<timestamp>` — ISO 8601 UTC with hyphens between time fields, e.g. `2026-04-25T07-08-30Z`.

**The report is append-only.** If a follow-up audit re-runs the same scope, write a new file with a new timestamp — never overwrite the previous one.

### KNOWLEDGE.md updates

After every audit, append patterns the audit caught (or framework gaps it exposed) to `KNOWLEDGE.md`. Use the heading shape from `CLAUDE.md` §3:

```
### [YYYY-MM-DD] Pattern — <short title>
<1-3 specific sentences. Include file paths and function names where relevant.>
```

For example:

```
### [2026-04-25] Pattern — RLS gate caught missing rlsProtectedTables.ts entry on new agent_briefing_attempts table
The verify-rls-coverage.sh gate flagged the missing manifest entry on the new
agent_briefing_attempts table. Fix: add the table name to server/config/rlsProtectedTables.ts
in the same migration that creates the table. Pattern: every new tenant-scoped table needs
a paired manifest entry on Day 1; the gate catches it but route 6 of the audit framework
should remind the author at write time.
```

**Never edit existing KNOWLEDGE.md entries.** Always append. Vague entries don't prevent future mistakes — be specific.

### Deferred items in tasks/todo.md

The `tasks/todo.md` section header for an audit's deferred items uses:

```
## Deferred from codebase audit — <YYYY-MM-DD>
**Captured:** <ISO timestamp>
**Source log:** tasks/review-logs/codebase-audit-log-<scope>-<timestamp>.md

- [ ] <finding>: <one-line description>. <severity>/<confidence>. <recommended action>.
- [ ] ...
```

**Append-only.** Future triage closes items by checking the box, not by deleting the line. Dedup before append (scan for similar existing entry by `finding_type` or leading ~5 words).

### Updating this framework

This document is itself protected (§4 — it lives in `docs/`). When you find a real-world audit gap that this framework didn't catch:

1. Append a `KNOWLEDGE.md` entry describing the gap.
2. Update this framework in the same commit, bumping the version field at the top (1.0 → 1.1 → ...).
3. State what changed in the new section's intro line.

Doc-code sync rule (`CLAUDE.md` §11) applies — if a code change invalidates anything in §2 (the AutomationOS context block), update §2 in the same commit.

---

## 11. Audit Report Template

Use this as the structure for every audit report. Save to `tasks/review-logs/codebase-audit-log-<scope>-<timestamp>.md`. Markdown is the only format — keep tables, no embedded JSON.

````markdown
# Codebase Audit Report — <scope>

| Field | Value |
|---|---|
| Audit framework version | <version from §header of docs/codebase-audit-framework.md> |
| Project | automation-v1 |
| Audited by | Claude Code (main session) + delegated agents |
| Date | <YYYY-MM-DD> |
| Branch | audit/<scope>-<YYYY-MM-DD> |
| Starting commit SHA | <git SHA> |
| Final commit SHA | <git SHA> |
| Layers run | Layer 1 areas: <list>. Layer 2 modules: <list> |
| Subagents invoked | <list> |
| Linked review logs | <paths to pr-review-log, spec-conformance-log, dual-review-log if applicable> |

---

## Reconnaissance Map

Pre-filled context block from §2 of the framework, plus audit-specific addenda below.

| Item | Value |
|---|---|
| In-scope paths | <list> |
| Out-of-scope paths | <list> |
| In-flight branches | <list of other active branches that must not collide> |
| Open PRs touching same surface | <list> |
| Critical-path coverage assessment | gates only / gates + sparse unit / gates + unit + trajectory / comprehensive |
| Implicit external contracts identified | <list, per Rule 4> |
| State / side-effect systems identified | <list, per Rule 13> |
| Protected files identified in scope | <list> |

---

## Pass 1 Findings

### Layer 1 — Area <N>: <Name>

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| <description> | critical/high/medium/low | high/medium/low | <what makes this safe or unsafe> | <fix description> | 2 or 3 |

[Repeat per area in scope]

### Layer 2 — Module <X>: <Name>

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| <description> | ... | ... | ... | ... | 2 or 3 |

[Repeat per module in scope]

---

## Pass 2 Changes Applied

### Area / Module <N>: <Name>

**Change intent.** This area modifies <X> files, affecting <Y> modules, with <low/medium/high> risk profile. Primary concern: <one-line statement>.

| Fix | Classification | Confidence | Justification | Files Modified |
|---|---|---|---|---|
| <description> | behaviour-preserving refactor / bug fix / deletion / security hardening | high | <proof of safety> | <file list> |

#### Validation Results

| Check | Exact Command | Outcome |
|---|---|---|
| Server typecheck | `npm run build:server` | PASS / FAIL |
| Client build | `npm run build:client` | PASS / FAIL / N/A |
| Static gates | `npm run test:gates` | PASS / FAIL — list any gate that failed |
| Unit tests | `npm run test:unit` | <X> passed, <Y> failed |
| QA tests | `npm run test:qa` | <X> passed, <Y> failed / N/A |
| Skill visibility | `npm run skills:verify-visibility` | PASS / FAIL / N/A |
| Playbooks | `npm run playbooks:validate` | PASS / FAIL / N/A |
| New warnings | n/a | none / <list with justification> |

[Repeat per area / module]

---

## Pass 3 Items (Awaiting Human Decision)

Cross-listed in `tasks/todo.md` under `## Deferred from codebase audit — <YYYY-MM-DD>`.

| Item | Area / Module | Severity | Confidence | Reason for Escalation | Recommendation |
|---|---|---|---|---|---|
| <description> | <N or X> | high | medium | <why not auto-applied> | <what you recommend> |

---

## Patterns Captured to KNOWLEDGE.md

| Pattern title | Trigger | KNOWLEDGE.md entry |
|---|---|---|
| <short title> | <what surfaced it during the audit> | <heading reference, e.g. "### [2026-04-25] Pattern — RLS gate caught missing manifest entry"> |

---

## Summary

| Field | Value |
|---|---|
| Overall Status | PASS / WARN / FAIL |
| Critical findings | <count> |
| High findings | <count> |
| Medium findings | <count> |
| Low findings | <count> |
| Fixes applied (pass 2) | <count> |
| Files modified | <count> |
| Items deferred to pass 3 (in `tasks/todo.md`) | <count> |
| KNOWLEDGE.md entries appended | <count> |
| Checkpoint tags created | <list> |
| Linked `pr-reviewer` log | <path or "not yet run"> |
| Linked `spec-conformance` log | <path or "not applicable"> |
| Linked `dual-reviewer` log | <path or "not requested"> |

---

## Recommended Next Steps

- <next action 1>
- <next action 2>
- <next action 3>
````

---

## 12. Tooling for AutomationOS

This is the canonical tool list for audit work in this repo. Tools that are not in `package.json` should be invoked via `npx --yes <tool>` to avoid polluting devDependencies.

| Task | Command | Notes |
|---|---|---|
| Server typecheck (authoritative) | `npm run build:server` | = `tsc -p server/tsconfig.json`. There is **no** standalone `tsc --noEmit` script |
| Client build (typecheck + bundle) | `npm run build:client` | Vite build |
| Full build | `npm run build` | Server + client |
| Static gates (~20) | `npm run test:gates` | Primary defence; failures are blocking |
| Unit tests | `npm run test:unit` | Sparse, on critical paths |
| QA tests | `npm run test:qa` | |
| All tests | `npm test` | Gates → QA → unit (in sequence) |
| Trajectory tests | `npm run test:trajectories` | Replay recorded agent runs |
| DB schema codegen | `npm run db:generate` | Drizzle generates new migrations from schema diff |
| DB migrate (custom) | `npm run migrate` | Custom migration runner: `tsx scripts/migrate.ts` |
| DB studio | `npm run db:studio` | Browser UI for inspection |
| Skill visibility apply | `npm run skills:apply-visibility` | Apply rules |
| Skill visibility verify | `npm run skills:verify-visibility` | Audit-time check |
| Skill backfill | `npm run skills:backfill` | One-shot |
| Playbook validate | `npm run playbooks:validate` | Required if playbook configs touched |
| Playbook test | `npm run playbooks:test` | |
| Dead code (advisory) | `npx --yes knip` | Cross-check against registries before acting |
| Unused dependencies (advisory) | `npx --yes depcheck` | Cross-check against `Dockerfile`, scripts, `.claude/` configs before deleting |
| Duplicate code | `npx --yes jscpd --min-tokens 15 --reporters console ./server ./client ./shared` | |
| Circular dependencies | `npx --yes madge --circular --extensions ts,tsx ./server` | Repeat for `./client` and `./shared` |
| Architectural boundary check | `npx --yes dependency-cruiser --include-only "^(server|client|shared)" --output-type err ./server ./client ./shared` | Configure `.dependency-cruiser.cjs` if not present — gate scripts already cover most cases |
| npm audit | `npm audit --omit=dev` for production-only, `npm audit` for full | |
| npm package versions duplicates | `npm ls <pkg>` per heavy dep | |
| Bundle analysis | `npx --yes vite-bundle-visualizer` | After `npm run build:client` |

### Tools NOT to use

- **`npm run lint`** — does not exist. Do not invent it.
- **`tsc --noEmit`** as a standalone — use `npm run build:server`.
- **Vitest / Jest commands** — neither is installed canonically. Tests are bare `tsx` runners.
- **`npm audit fix`** — never as a pass-2 action. All dependency changes are `manual review required`.

---

## 13. Running an audit — operational guide

### Audit Modes

Most audits in practice will not be full-codebase sweeps. Pick the smallest mode that covers the concern.

| Mode | Scope | When to use | Layers / modules |
|---|---|---|---|
| **Full Audit** | Whole codebase | Quarterly, pre-major-release, post-incident health check | All Layer 1 areas + selected Layer 2 modules (always Modules I, J, K) |
| **Targeted Audit** | A named set of areas or modules | A specific concern is on the table (e.g. "I want a type-strengthening pass" or "verify webhook signing") | One or more Layer 1 areas, or one or more Layer 2 modules |
| **Hotspot Audit** | A single subsystem | A specific subsystem feels gnarly or recently shipped a defect (e.g. agent execution, RLS, skills, webhooks, jobs) | The relevant Layer 2 module(s) plus only the Layer 1 areas needed to clean that subsystem |

**All modes still follow Universal Rules 1–15.** Scope is constrained, not the rules. Pass 1 / pass 2 / pass 3 still apply. `pr-reviewer` is still mandatory before declaring complete. Validation (Rule 6) still runs on the changed surface — but checks not relevant to that surface are explicitly marked `N/A` per the no-silent-skips clause.

**Default to Hotspot Audit unless you have a reason to go wider.** Most production failures are subsystem-shaped, not codebase-shaped. A weekly Hotspot pass on whichever subsystem feels riskiest is more useful than a quarterly Full Audit that nobody finishes.

Record the chosen mode in the audit report header (`Layers run` field of §11 template).

### When to run

- **Periodic** — quarterly, or after a major feature phase ships.
- **Pre-release gate** — before a customer-visible release. Run Layer 2 in full.
- **Targeted** — when a specific concern surfaces (e.g. "the agent execution layer feels gnarly" → Module K + Areas 1, 2, 6).
- **Post-incident** — after a production issue, run the relevant module(s) plus Module I (RLS) as standard hygiene.

### How to start a run

1. Confirm the working tree is clean: `git status` empty.
2. Pick scope. Trivial rule of thumb: ≤ 4 files in one area = Standard. Spans multiple areas or modules = Significant. Cross-cutting = Major (and invoke `architect` first).
3. Create the audit branch:
   ```bash
   git checkout -b audit/<scope>-<YYYY-MM-DD>
   ```
4. Capture the starting commit SHA.
5. Open the recon block (§2 of this framework). Update any item that's drifted since the last audit.
6. Create the report file: `tasks/review-logs/codebase-audit-log-<scope>-<timestamp>.md`. Use the §11 template.
7. Run pass 1 (findings only). Delegate per-area research to subagents (`Explore` for read-only investigation, focused subagents for area-specific deep dives) per Rule 15.
8. Present findings to the user. Confirm scope before pass 2 if Significant or Major.
9. Run pass 2. One area at a time. Validate (Rule 6) after each. Commit per area with message `audit: area <N> — <name>`. Tag checkpoints.
10. Pass 3 items → `tasks/todo.md` under `## Deferred from codebase audit — <date>`.
11. Invoke `spec-conformance` (if spec-driven changes), then `pr-reviewer`. Mandatory. Persist their logs.
12. Append `KNOWLEDGE.md` entries for patterns surfaced.
13. Update §2 of this framework if any context-block fact changed.
14. Hand the audit branch to the user with the final report. The user pushes and creates the PR.

### Common pitfalls (prevent these)

- **Running pass 2 without finishing pass 1.** Forbidden by Rule 3.
- **Deleting a `server/skills/*.md` because static analysis says it's unused** — registry-loaded files are live (Rule 11).
- **"Cleaning up" `req.user.organisationId` to `req.orgId`** in a service — it's the right direction, but it touches RLS plumbing → pass 3 (Rule 8 downgrade trigger).
- **Modifying a `scripts/gates/*.sh` to make a failing gate pass** — gate failures are findings, not noise (§4 Protected Files).
- **Removing a Langfuse trace emission because "we have logs anyway"** — Rule 12 forbids.
- **Adding `npm run lint`** when scripts don't have it — there is no lint script (§2). Don't invent one.
- **Running multiple review agents in parallel against the same branch** — Rule 15.
- **Editing `KNOWLEDGE.md` entries** — append-only, never edit (`CLAUDE.md` §3).
- **Auto-rewriting `docs/capabilities.md`** — editorial rules require human review (Module M).
- **Removing a `// FIXME` describing an unresolved issue without first turning it into a `tasks/todo.md` entry** (Area 6).

### Escalation

If an audit blocks for any of these reasons, escalate to the user with the full context — do not attempt to work around:

- Three failed fix attempts on the same check (CLAUDE.md "Stuck Detection Protocol").
- A finding crosses architectural boundaries that need an `architect` decision.
- A Module M editorial finding requires marketing rewrite judgement.
- A Module K invariant might be wrong (or might require subsystem redesign).
- Any RLS gap (Module I) that cannot be closed by a manifest update or a `withOrgTx` wrap.
- Any contract-preserving change (Module G) where the consumer surface is unknown.

The audit is a tool for protecting the codebase. Better to escalate than to ship a wrong fix.

---

*AutomationOS Codebase Audit Framework v1.1 — calibrated 2026-04-25 from generic v5.0; v1.1 tightenings (Scope Guard, Audit Modes, no-silent-skip, idempotency storage-boundary, invariant-in-code) added 2026-04-25. Update §2 and bump version on stack changes; append KNOWLEDGE.md for every pattern caught.*


# Codebase Audit Report — pre-v1-lockdown

| Field | Value |
|---|---|
| Audit framework version | v1.3 + PR #301 (Area 10) + PR #303 (Rule 16) — see `docs/codebase-audit-framework.md` |
| Project | automation-v1 |
| Audited by | Claude Code (main session) |
| Date | 2026-05-14 |
| Branch | audit/full-pre-v1-lockdown-2026-05-14 |
| Starting commit SHA | 34eda8967d508e76ebe4aa63f5765e1de9526228 |
| Final commit SHA | (pass 1 only — branch state may grow as log + progress file commit) |
| Mode | Full audit, exclusive (operator declined `parallel` flag) |
| Layers run | Layer 1 Areas 1–10. Layer 2 Modules I, J, K, L, M, C. Skipped Modules A, B, D, E, F, G, H per operator instruction |
| Subagents invoked | None — playbook mandates direct execution |
| Linked review logs | (none yet — pass 2 / pr-reviewer not run in this session) |
| Pass gate posture | Operator requested **Pass 1 only**. STOP at findings gate. Do not interpret silence as confirmation. |

---

## Reconnaissance Map

Pre-filled context block from §2 of the framework, with audit-specific addenda below.

### §2 context-block staleness — surfaced before pass 1

Per the playbook ("If §2 appears stale vs current `package.json` / repo state, surface that to the user"), the following §2 entries are stale on the current framework head (34eda896):

| §2 row | Stale value | Actual value | Evidence |
|---|---|---|---|
| Test framework | "None canonical — bare `tsx` runners under `server/**/__tests__/` (NO Vitest, NO Jest)" | Vitest is the canonical runner | `package.json` line 38: `"test:unit": "vitest run"`; `@vitest/coverage-v8@^2.1.9` installed (line 111); `docs/testing-conventions.md` confirms |
| Lint command | "**None defined** (`npm run lint` does not exist — do not invent it)" | `npm run lint` exists and runs eslint | `package.json` line 19: `"lint": "eslint ."`; line 20: `"lint:fix": "eslint . --fix"`; eslint deps lines 95, 115–116, 122 |
| Test commands | lists `npm test` (gates → qa → unit) — accurate | accurate, but Vitest now the runner under the hood | n/a |

Routed to `tasks/todo.md` as Module D doc-drift finding (`docs/codebase-audit-framework.md` §2 must be updated alongside the Vitest migration that already shipped).

### Audit-specific addenda

| Item | Value |
|---|---|
| In-scope paths | `server/`, `client/`, `shared/` (full audit) |
| Out-of-scope paths | `node_modules/`, `dist/`, `migrations/` (sealed), generated files |
| In-flight branches | `claude/personal-assistant-post-merge-audit` (originating branch — clean), `origin/audit/full-codebase-2026-04-25` (stale from prior full audit — artifacts shipped via `audit-remediation`) |
| Open PRs touching same surface | Personal Assistant V2 plan locked on originating branch (no code changes yet — Phase 2 stopped at plan gate) |
| Critical-path coverage assessment | `gates only` for most areas; `gates + sparse unit` for RLS context propagation, idempotency, agentRunVisibility |
| Implicit external contracts identified | Portal client API `/portal/<slug>/*`; webhook adapter intake (Slack, HubSpot, GHL, Stripe, Teamwork, GitHub, Gmail); MCP tool surface; pg-boss job payload shapes; three-tier agent execution contract; `actionRegistry` slugs |
| State / side-effect systems identified | pg-boss queue, withBackoff retry, runCostBreaker, rateLimiter, webhookDedupe, agentExecutionService, memoryWeeklyDigestJob, scheduleCalendarServicePure, prompt-prefix cache |
| Protected files in scope | All per framework §4 — flagged at finding time |

---

## Pass 1 Findings

> **Reconnaissance scale.** 2,728 TS/TSX files, ~115k LOC across `server/`, `client/`, `shared/`. 186 skill markdown files in `server/skills/`. 106 pg-boss job files in `server/jobs/`. RLS manifest `server/config/rlsProtectedTables.ts` is 1,357 lines (174 tables with `organisation_id`, 119 with `subaccount_id`). 588 Vitest test files (post-migration to Vitest from bare `tsx` runners — §2 framework block is stale on this).

> **How to read each table.** *Confidence* applies Rule 8 downgrade triggers (shared-module touch / signature change / RLS-relevant file / idempotency surface / gate script / migration → downgrade). *Prevention* applies Rule 16 (target = `hook` / `gate` / `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` / `architecture.md` / `docs/frontend-design-principles.md` / `docs/capabilities.md` / `KNOWLEDGE.md` / `ADR` / `not feasible`). Prevention proposals aggregated below in the Prevention Proposals section.

### Layer 1 — Area 1: Dead Code Removal

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass | Prevention |
|---|---|---|---|---|---|---|
| `client/src/components/skill-analyzer/*` entire subtree is unreferenced — `SkillAnalyzerWizard.tsx` has no external referrer (grep `client/src` returns only its own file); App.tsx line 39 confirms `SkillAnalyzerPage` was replaced in build-stream consolidation. Includes `MergeReviewBlock.tsx` (1,107 LOC) + `SkillAnalyzerResultsStep.tsx` (1,102 LOC) + ~7 other files | high | high | Isolation proof — `grep -rn "SkillAnalyzerWizard" client/src` returns one self-reference; App.tsx comment cites the replacement | Delete the subtree | 2 | `gate` — extend `verify-no-orphan-react-component.sh` to walk the React Router tree from `App.tsx` and flag pages/components with zero ingress |
| Knip flags 306 "unused files" but reports no `knip.json` config (`Configuration hints (1): Create knip.json configuration file`) — verdict is unreliable for this codebase given the registry-driven nature (Rule 11). Multiple flagged files are demonstrably live (e.g. `.claude/hooks/*.js` are settings-registered; `infra/sandbox-templates/*` are runtime-loaded) | medium | high | Knip's own self-report flags missing config; manual cross-reference shows false positives | Configure `knip.json` with entries for `server/index.ts`, `client/src/main.tsx`, `worker/`, all `.claude/hooks/*.js`, all `scripts/__fixtures__/*`, the registries from §2 | 3 | `gate` — `verify-knip-config.sh` ensures `knip.json` exists and lists all dynamic entry surfaces |
| `depcheck` reports **5 missing dependencies** imported but absent from `package.json`: `docx`, `mammoth`, `express-rate-limit`, `zod-to-json-schema`, `pg`. Build currently relies on transitive resolution — fragile and a supply-chain risk | high | high | Static analysis proof — `depcheck` output names each file site | Add each as a direct dependency in `package.json` with a pinned major version | 2 | `gate` — `verify-no-missing-deps.sh` runs `depcheck --skip-missing=false --json` and fails on any unmet import |
| `depcheck` reports `@playwright/test` as production dep but used only in test/script paths — likely a misclassification (should be a devDependency). Also reports `@vitest/coverage-v8`, `autoprefixer`, `postcss`, `tailwindcss` as unused, but they are config-driven (PostCSS plugins, Vitest config) — false positives per Rule 11 | low | medium | Manual verification — `tailwind.config.ts` and `postcss.config.js` reference them; `vitest.config.ts` references coverage-v8 | Move `@playwright/test` from `dependencies` → `devDependencies`. Mark the false positives in a `depcheckignore` config | 3 | `not feasible — depcheck signal is structurally noisy for plugin-driven configs; manual review remains the right control` |
| Commented-out code blocks in `agentExecutionService.ts` lines 72–116 describe a completed refactor ("orgAgentConfigService import removed — deprecated post-migration 0106", "the `executionBackendRegistry.resolve(mode).dispatch(input)` call …"). Per Area 7 these are residue, not WHY-comments | low | medium | Lines 72–116 are explanatory prose, not adjacent to relevant code, describing a state that already shipped | Remove the block; the rationale belongs in commit message of the original refactor | 3 | `CLAUDE.md` — extend the existing "no AI residue" comment rule with an example for "comments describing the prior state of a finished refactor" |

### Layer 1 — Area 2: Duplicate Logic

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass | Prevention |
|---|---|---|---|---|---|---|
| `jscpd` duplicate-detection scan deferred — runtime cost is significant for a 2,728-file scan; running it sub-optimally during a Pass-1 sweep risks an incomplete picture. Sample-based read of top god-files (skillExecutor.ts at 6,133 LOC, workflowEngineService.ts at 4,073 LOC) suggests duplication is hidden *inside* god files rather than across files — surfaces in Area 10 | medium | low | Indirect — Area 10 god-file register names the candidate files; jscpd has not been run in this session | Schedule a dedicated `audit-runner: hotspot duplication` run with `npx jscpd --min-tokens 15 ./server ./client ./shared` against `audit/full-pre-v1-lockdown-2026-05-14` baseline | 3 | `gate` — add `verify-duplicate-blocks.sh` that runs `jscpd` with a clone-density baseline file checked into the repo; new clones above baseline fail CI |

### Layer 1 — Area 3: Type Definition Consolidation

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass | Prevention |
|---|---|---|---|---|---|---|
| Knip reports ~80 unused type exports in `shared/types/*` (`BriefColumnHint`, `BriefArtefactBase`, `RuleDerivedStatus`, `ContextAssemblyResult`, `OperatorBackendEvent` and many `OperatorSession*Event` types, `RetrievalMode`, `WidgetData`, `SandboxNonTerminalStatus`, etc.). Many are union components or barrel-exported event types that knip can't trace through dynamic dispatch | medium | low | Knip-only signal; no manual cross-check performed this run. Pattern matches "barrel exports + dynamic switch" where knip is structurally weak | Author a Pass-2 spec to walk each unused-export claim — keep where dispatched through `OperatorBackendEvent` discriminated union; delete where genuinely orphaned | 3 | `gate` — extend `verify-types-used.sh` (does not yet exist) to enforce that every exported event type appears in at least one discriminated union or is registered with `OperatorBackendEvent` |
| 19 "Duplicate exports" reported by knip — files exporting both a default and a named alias of the same symbol (e.g. `NeedsAttentionRow|default`, `getActiveSubaccountId|getActiveClientId`). The `auth.ts` cases are *intentional* (rename from `*Client*` → `*Subaccount*` shim) but mid-refactor leftover otherwise | low | medium | Knip output is precise; `client/src/lib/auth.ts` has a known dual-export shim for the subaccount rename | Keep `auth.ts` shims until callers migrate; for the seven `default-and-named` component files, drop the named alias | 3 | `CLAUDE.md` — add "prefer named exports for React components" rule; tightens default-vs-named ambiguity that drives the duplicate exports |

### Layer 1 — Area 4: Type Strengthening

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass | Prevention |
|---|---|---|---|---|---|---|
| 188 occurrences of `: any` or `as any` in non-test `server/` + `shared/` code. Hotspots: `server/db/schema/goals.ts`, `server/db/schema/workflowRuns.ts`, `server/jobs/benchRegressionReplayJob.ts`, `server/jobs/memoryEntryDecayJob.ts`, `server/lib/idempotencyVersion.ts`, `server/lib/jobErrors.ts`, `server/lib/protectedBlocks.ts` | medium | low | Static count via `grep`; full audit of each instance requires per-call-site analysis — many `as any` are at trust boundaries (LLM response parsing, JSONB read) where Zod is the right control | Audit per call site; replace with `unknown` + Zod parse at trust boundaries, or `InferModel<typeof table>` for Drizzle reads | 3 | `gate` — `verify-any-budget.sh` enforces a non-growing `: any` / `as any` count; new instances fail unless the file is on an exemption list with `// guard-ignore: type-strengthening reason="..."` |

### Layer 1 — Area 5: Error Handling Audit

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass | Prevention |
|---|---|---|---|---|---|---|
| `server/services/agentExecutionService.ts` lines 1157, 1240, 1368 — three silent `.catch(() => {})` calls with NO `guard-ignore` annotation, in agent-execution flow. Other silent catches in the codebase (`attachmentService.ts`, `_apiHeadlessShared.ts`) carry `guard-ignore: no-silent-failures reason="..."` justifications — these three do not | medium | medium | Rule 13 downgrade: agent execution is state/side-effect-sensitive — silent rejection on a side-channel branch could mask retries or visibility writes; needs trace before fixing | Confirm each call site's intent (best-effort metric / fire-and-forget event), then either log via `logger.warn` or add the `guard-ignore` annotation | 3 | `gate` — `verify-no-silent-catch.sh` enforces that every `.catch(() => {})` carries a `guard-ignore` annotation with reason; CI fails on unannotated cases |

### Layer 1 — Area 6: Legacy and Dead Path Removal

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass | Prevention |
|---|---|---|---|---|---|---|
| 133 marker hits in non-test `server/` + `client/` + `shared/` — 73 `TEMP`, 50 `TODO`, 23 `LEGACY`, 10 `DEPRECATED`, 1 `XXX`. Per Area 6 each requires `git log -p` verification before deletion (verify intent is resolved) or conversion to `tasks/todo.md` (if intent is unresolved) | medium | low | Static count only; per-marker review deferred to keep Pass 1 focused | Batch the 133 markers into a `tasks/todo.md` triage chunk; classify each as `done — delete` / `still open — convert to todo` / `keep — legitimate WHY comment` | 3 | `gate` — `verify-marker-budget.sh` enforces a non-growing marker count by file; new markers require justification in commit body |

### Layer 1 — Area 7: AI Residue Removal

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass | Prevention |
|---|---|---|---|---|---|---|
| Same `agentExecutionService.ts:72–116` comment cluster cited under Area 1. Comments describe completed refactor in WHAT-shaped prose rather than WHY-shaped justification. Symptom of AI-assisted code generation pre-cleanup | low | medium | Lines 72–116 are explanatory blocks describing prior import structure | Remove the prose block (overlap with Area 1 finding 4) | 3 | `CLAUDE.md` § Comments — strengthen "no WHAT comments" rule with explicit example: "describing a completed refactor in code is residue; commit message is the right home" |

### Layer 1 — Area 8: Circular Dependency Resolution

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass | Prevention |
|---|---|---|---|---|---|---|
| `madge --circular` scan deferred — runtime cost on a 2,728-file ESM codebase pushes past Pass 1 budget. No findings to enumerate this run | medium | low | Tool not run | Schedule `audit-runner: hotspot circular-deps` to run madge with a CI-checked baseline | 3 | `gate` — `scripts/verify-no-new-cycles.sh` runs `madge --circular --json` and fails CI if cycle count grows above baseline |

### Layer 1 — Area 9: Architectural Boundary Violations

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass | Prevention |
|---|---|---|---|---|---|---|
| **CRITICAL — Route → DB direct query**: `server/routes/support/supportAgentRoutes.ts` lines 6, 35–46, 74+ imports the `canonicalInboxes` schema table object from `db/schema/index.js` and builds Drizzle `.select().from(canonicalInboxes).where(...).orderBy(...)` queries inside the route handler. Violates the route → service → db cascade (`architecture.md` § Architecture Rules + framework §10 Rule 10) | critical | high | Direct read of file confirms value-import + query construction in routes layer; `architecture.md` is explicit "Routes never touch `db` directly" | Extract a `supportAgentInboxService` exposing `listAgentInboxes(principal)` and `getInboxAgentConfig(inboxId, principal)`; route handler calls the service | 3 | `gate` — `scripts/verify-no-db-in-routes.sh` is in place but **uses a baseline mechanism** (`check_baseline` at line 43) that allows pre-existing violations to persist silently. Tighten: refuse new entries and require an ADR before adding a file to the baseline |
| `server/routes/public/pagePreview.ts:12-13` and `pageServing.ts:13-14` use `import type { Page }` / `import type { PageProject }` from `db/schema/*`. Type-only imports do not cross the runtime layer boundary but DO trip the gate's regex (`import.*db.*from.*['"]./db`) — false positive currently absorbed by the baseline | low | high | Direct read; TS `import type` is erased at compile time | Move shared row types to `shared/types/page.ts` so routes consume from `shared/`, never `server/db/schema/` | 3 | `gate` — tighten `verify-no-db-in-routes.sh` regex to skip `import type` lines, then audit/expire baseline entries that only appeared because of the type-only false positive |
| `server/middleware/auth.ts` lines 262, 288, 318, 384 use `req.orgId ?? req.user.organisationId` as a fallback. Inside the middleware that *establishes* `req.orgId`, this is the bootstrap pattern — but the same shape outside this file would be a violation (orgId-source gate enforces). No violation outside auth.ts in this audit, but cluster suggests an opportunity to consolidate to one helper | low | medium | Read of auth.ts confirms middleware-internal use; `verify-org-id-source.sh` gate already enforces the outside-auth case | Extract `resolveOrganisationId(req)` helper used only inside auth.ts; banish the dual-source elsewhere | 3 | `architecture.md` — document that `req.user.organisationId` is read **only** inside `server/middleware/auth.ts`; everywhere else is `req.orgId`. Update the gate's allow-list to that single file |

### Layer 1 — Area 10: God-File Register (informational only — all findings pass 3)

Per operator instruction and per Area 10 rules, every finding routes to pass 3. No splits proposed in this run.

**Hard-cap breaches (severity high — pass 3):**

| File | LOC | Cap (Hard) | Ratio | Layer |
|---|---:|---:|---:|---|
| `server/services/skillExecutor.ts` | 6,133 | 2,500 | 2.45× | services |
| `server/services/workflowEngineService.ts` | 4,073 | 2,500 | 1.63× | services |
| `server/services/skillAnalyzerServicePure.ts` | 3,729 | 2,500 | 1.49× | services |
| `server/services/agentExecutionService.ts` | 2,807 | 2,500 | 1.12× | services |
| `server/services/skillAnalyzerService.ts` | 2,642 | 2,500 | 1.06× | services |
| `client/src/pages/AdminSubaccountDetailPage.tsx` | 1,430 | 1,200 | 1.19× | pages |
| `client/src/pages/UsagePage.tsx` | 1,284 | 1,200 | 1.07× | pages |
| `client/src/components/Layout.tsx` | 1,325 | 800 | 1.66× | components |
| `client/src/components/skill-analyzer/MergeReviewBlock.tsx` | 1,107 | 800 | 1.38× | components *(dead — see Area 1)* |
| `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` | 1,102 | 800 | 1.38× | components *(dead — see Area 1)* |

**Soft-cap breaches (severity low/medium — pass 3):**

| File | LOC | Cap (Soft) | Layer |
|---|---:|---:|---|
| `server/services/agentService.ts` | 2,335 | 1,500 | services |
| `server/jobs/skillAnalyzerJob.ts` | 2,254 | (no jobs cap; outsized) | jobs |
| `server/services/workspaceMemoryService.ts` | 1,949 | 1,500 | services |
| `server/services/llmRouter.ts` | 1,918 | 1,500 | services |
| `server/services/queueService.ts` | 1,683 | 1,500 | services |
| `server/services/agentExecutionLoop.ts` | 1,415 | 1,500 | services *(near cap)* |
| `server/services/sandboxHarvestService.ts` | 1,271 | 1,500 | services *(near cap)* |
| `server/services/agentExecutionEventService.ts` | 1,192 | 1,500 | services *(near cap)* |
| `client/src/pages/SubaccountKnowledgePage.tsx` | 1,160 | 600 (soft) | pages *(possibly dead)* |
| `server/index.ts` | 1,151 | (entry, no cap) | server entry |

**Excluded by convention:** `server/config/rlsProtectedTables.ts` (1,357 LOC) — manifest by design, one-table-per-line is the convention.

**Prevention proposal (Rule 16):** `gate` — `scripts/verify-loc-cap.sh` reads the §6 Area 10 thresholds and fails CI when a file new to the audit branch exceeds the soft cap. Hard-cap violations require an ADR with a split plan. Captures growth at write time rather than relying on quarterly audits.

### Layer 2 — Module I: RLS & Multi-tenancy Three-Layer Compliance

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass | Prevention |
|---|---|---|---|---|---|---|
| **Critical — same as Area 9 finding 1**: `supportAgentRoutes.ts` bypasses the route → service → db layer. Even though the query manually filters by `principal.organisationId` (line 42) AND Postgres RLS still applies if the call passes through `withOrgTx`, the architectural rule exists precisely so that *forgetting* to wrap is structurally impossible from routes — the bypass weakens the fail-closed model | critical | high | Direct read of supportAgentRoutes.ts; Module I framework guidance "Every DB access path passes through `withOrgTx` or `getOrgScopedDb`. `db.select(...)` calls outside this scope are `critical` severity" | Extract `supportAgentInboxService`; route handler delegates | 3 | `gate` — `verify-no-db-in-routes.sh` baseline must require ADR to expand; combined with `verify-with-org-tx-or-scoped-db.sh` (does not yet exist) that walks every `db.select/insert/update/delete` and confirms it's inside a `withOrgTx` block |
| `rlsProtectedTables.ts` is 1,357 lines covering 174 organisation-scoped + 119 subaccount-scoped tables. Manifest size is correct — but the *Day 1 coverage* invariant (new tenant table → entry in same migration) relies on `verify-rls-coverage.sh` running in CI. No findings of missing entries this run | informational | high | No grep hit for tenant columns missing the manifest | Continue current discipline | n/a | `gate` — confirmed in place; no new prevention proposal |
| `req.user.organisationId` appears only in `server/middleware/auth.ts` (4 sites) — gate is holding. No violations elsewhere | informational | high | `grep -rn 'req\.user\.organisationId' server/` returns auth.ts hits only | No fix needed | n/a | `gate` — `verify-org-id-source.sh` already enforces |

### Layer 2 — Module J: Idempotency, Queue & Job Discipline

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass | Prevention |
|---|---|---|---|---|---|---|
| `server/services/agentBeliefService.ts` lines 124–403 implements a custom retry loop with its own `retryCount` counter and `BELIEFS_MAX_RETRIES_PER_RUN` storm-detection logic. Does not use the canonical `server/lib/withBackoff.ts`. The storm detection is custom value-add — but rolling a parallel retry primitive is a smell per Module J ("Custom retry loops elsewhere are smell — flag and route to pass 3") | medium | medium | Direct read; the storm detector is genuinely outside withBackoff's surface | Either (a) extend `withBackoff` to support a per-run-key storm cap, then refactor `agentBeliefService` onto it, or (b) document the intentional divergence in `architecture.md` and add a test that the storm cap fires | 3 | `gate` — `scripts/verify-canonical-retry.sh` greps for `retryCount`-style loops outside `server/lib/withBackoff.ts` and requires a `guard-ignore: canonical-retry reason="..."` annotation |
| `withBackoff` usage is healthy — 10+ call sites including `teamworkAdapter`, `connectorPollingSync`, `ghlAutoEnrolLocationsPageJob`, `chargeRouterService`, `connectionTokenService`, `deliveryService`. No findings | informational | high | `grep -rln "withBackoff"` returns canonical pattern | n/a | n/a | n/a |
| Webhook dedup pattern healthy — `server/lib/webhookDedupe.ts` referenced from each webhook route (Slack, GHL, Stripe, Teamwork). Tests exist. No findings | informational | high | `grep -rln "webhookDedupe"` returns canonical pattern across all four providers + tests | n/a | n/a | n/a |

### Layer 2 — Module K: Three-Tier Agent Invariants

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass | Prevention |
|---|---|---|---|---|---|---|
| **Atomic lead-agent swap invariant — IN SCHEMA**: `server/db/schema/subaccountAgents.ts:141` declares `uniqueIndex('subaccount_agents_one_root_per_subaccount')`. DB rejects two roots at insert time. ✓ | informational | high | Direct read; unique index is schema-level enforcement, not convention | n/a | n/a | n/a |
| **Handoff depth ≤ 5 — IN CODE, multiple sites**: `MAX_HANDOFF_DEPTH = 5` at `server/config/limits.ts:9`; enforced at `skillExecutor.ts:3535, 3992, 4171`. ✓ All three sites use the same constant — no fork | informational | high | Direct read of three enforcement sites | n/a | n/a | n/a |
| **Depth-cap rejection is silently dropped — observability gap**: `skillExecutor.ts:3988–3994` `enqueueHandoff` returns `false` and logs via `console.warn` when depth exceeds cap. No structured event, no Langfuse trace, no metric increment. If a runaway agent triggers depth-cap repeatedly, ops has no signal beyond unstructured stderr | medium | medium | Direct read; `console.warn` is not the canonical `logger.warn` and is not consumed by Langfuse | Replace `console.warn` with a structured `logger.warn({ event: 'handoff_depth_capped', runId, agentId, depth: req.handoffDepth, max: MAX_HANDOFF_DEPTH })`; consider emitting a Langfuse span tag | 3 | `gate` — `verify-canonical-logger.sh` greps for `console\.(log|warn|error)` in `server/services` and `server/routes` and fails unless the line carries `guard-ignore: canonical-logger reason="..."` |
| **Handoff audit trail durability — NOT VERIFIED THIS RUN**: framework Module K requires "Every handoff records who-to-whom, why, and the outcome" with durable retention. `agentRuns.handoffDepth` column exists; whether a *handoff history* row is written per hop was not traced this Pass 1 | medium | low | Schema column exists but full audit path not walked | Trace `skillExecutor.ts:enqueueHandoff` → handoff history table | 3 | `not feasible — covered by `agent-execution` hotspot audit; route to that scope` |

### Layer 2 — Module L: Skill Registry & Visibility Coherence

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass | Prevention |
|---|---|---|---|---|---|---|
| 186 skill markdown files in `server/skills/` against an `actionRegistry` split across `server/config/actionRegistry/*.ts` (per-domain files: `agents.ts`, `calendar.ts`, `clientpulse.ts`, `commerce.ts`, `configuration.ts`, `core.ts`, `intelligence.ts`, etc.). Full slug-vs-markdown cross-reference deferred — high-value for `audit-runner: hotspot skills` | medium | low | File counts only; alignment audit not performed | Run `audit-runner: hotspot skills` after this Pass 1 closes | 3 | `gate` — `npm run skills:verify-visibility` already exists; confirm CI runs it on every PR, and extend to walk every markdown ↔ registry entry pair |
| `server/config/universalSkills.ts` lists 7 universal skill names. The file comment ("must stay in sync" with `ACTION_REGISTRY`) flags a hand-maintained invariant — a class of drift that Module L explicitly highlights | low | medium | Read of file header comment | Generate `UNIVERSAL_SKILL_NAMES` from `ACTION_REGISTRY` entries with `isUniversal: true`, eliminating the dual source | 3 | `gate` — `verify-universal-skill-sync.sh` asserts every entry in `UNIVERSAL_SKILL_NAMES` has an `ACTION_REGISTRY` row with `isUniversal: true` and vice versa |

### Layer 2 — Module M: Capabilities Editorial & Frontend Design Principles Guard

**Part 1 — Capabilities editorial rules audit (`docs/capabilities.md`):**

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass | Prevention |
|---|---|---|---|---|---|---|
| Provider names appear in `docs/capabilities.md` at lines 999, 1146 (Skills Reference) and 1165, 1166, 1186 (Integrations Reference). **All within the factual sections explicitly permitted by Editorial Rule 2.** No violation | informational | high | Line-by-line classification: line 999 = `geo_platform_optimizer` skill row; 1146 = `transcribe_audio` skill row; 1165/1166 = OpenAI/Anthropic integration rows; 1186 = Google Drive integration row | n/a | n/a | n/a |
| Line 210 in Product Capabilities section mentions "Google Docs, Dropbox" as knowledge-source substrates. Editorial Rule 3 permits "Standard industry terms" — whether Google Docs counts is borderline | low | medium | Boundary case; human editorial judgement required | Human review: keep if "live" knowledge sources need to be enumerated by partner name, otherwise rephrase as "cloud-document and file-storage providers" | 3 | `docs/capabilities.md` — extend § Editorial Rules with an explicit list of "always-OK industry terms" (currently lists 5 examples; codify with positive + negative sets) |

**Part 2 — Frontend Design Principles audit (`docs/frontend-design-principles.md` + `client/src/pages/*.tsx`):**

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass | Prevention |
|---|---|---|---|---|---|---|
| 101 pages in `client/src/pages/*.tsx`. Full Module M Part-2 audit requires per-screen review of the 5 hard rules — exceeds Pass 1 budget for a full sweep | medium | low | File count + framework rule that "every UI artifact must obey 5 hard rules" | Schedule `audit-runner: hotspot frontend` immediately after this run | 3 | `docs/spec-authoring-checklist.md` — already includes the 5 rules for new UI specs; extend with a pre-PR self-review checklist that the operator runs against the diff |
| `client/src/pages/SystemPnlPage.tsx` references `KpiCard`/`KpiTile` patterns — needs admin-only verification (per Module M caps: "KPI tiles 0 by default; admin-only is `medium`") | medium | low | Grep for KPI patterns surfaced this page only; admin-only status not verified | Confirm SystemPnlPage is gated to admin role; if yes, document the exception; if no, trim KPI tiles | 3 | `gate` — `verify-frontend-design-budget.sh` parses page imports for `KpiCard`/`KpiTile`/`Sparkline` and fails CI for pages not on an admin-only allowlist |

### Layer 2 — Module C: Test Coverage

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass | Prevention |
|---|---|---|---|---|---|---|
| **Named critical-path coverage confirmed**: `server/services/__tests__/rls.context-propagation.test.ts` exists; `server/lib/__tests__/agentRunVisibilityPure.test.ts` exists; 5 trajectory tests in `tests/trajectories/`; 588 Vitest files repo-wide | informational | high | Direct ls confirms each file | n/a — coverage matches Module C's "minimum named coverage" bar | n/a | `gate` — confirm `npm run test:unit` is wired into CI on every PR, not just nightly |
| **Framework §2 stale — Module D doc-drift**: §2 row "Test framework: None canonical — bare `tsx` runners (NO Vitest)" is wrong; `package.json:38` declares `"test:unit": "vitest run"`, `@vitest/coverage-v8@^2.1.9` installed (line 111). §2 row "Lint command: None defined" is wrong; `package.json:19` declares `"lint": "eslint ."`. Stale §2 silently mis-classifies audit decisions | medium | high | Direct read of package.json vs framework | Update `docs/codebase-audit-framework.md` §2: Test framework = `Vitest (vitest run)`, with `@vitest/coverage-v8` for coverage. Lint command = `npm run lint` (eslint flat config). Bump framework version to 1.4 | 2 | `gate` — `verify-framework-context-block.sh` parses `docs/codebase-audit-framework.md` §2 rows against `package.json` scripts and fails CI on drift |
| **Coverage assessment per critical path** (framework requires explicit assessment): RLS context propagation = `gates + unit`; agentRunVisibility = `gates + unit`; idempotency-key dedup = `gates + sparse unit` (test file naming not confirmed this run); cost-breaker invocation per LLM call site = `gates only` (no targeted test file found in spot-check) | medium | medium | Spot-check; full coverage matrix not produced | Build a coverage matrix per Module C requirement; route gaps to `tasks/todo.md` | 3 | `KNOWLEDGE.md` — capture the per-critical-path coverage tier; refresh quarterly |

---

## Prevention Proposals

Aggregated across all Pass 1 findings (Rule 16). One proposal can close many findings — closure list tracked per proposal. **Every proposal is pass 3; none auto-applied.** Operator reviews and applies as a batch after audit closes.

### Tier 1 — block at write time (hooks / gates)

| # | Target | Proposed addition | Closes findings | Notes |
|---|---|---|---|---|
| P1 | `gate` (`scripts/verify-no-missing-deps.sh`) | Run `depcheck --skip-missing=false --json`; fail on any imported package absent from `package.json` | Area 1 finding 3 (5 missing deps) | Supply-chain hardening |
| P2 | `gate` — tighten `scripts/verify-no-db-in-routes.sh` | (a) Skip `import type` lines so type-only imports don't trip the regex. (b) Refuse new baseline entries; require an ADR to expand. (c) Companion gate `verify-with-org-tx-or-scoped-db.sh` walks every `db.select/insert/update/delete` and confirms it's inside a `withOrgTx`/`getOrgScopedDb` block | Area 9 findings 1+2, Module I finding 1 | Closes the critical `supportAgentRoutes` exposure pattern |
| P3 | `gate` (`scripts/verify-loc-cap.sh`) | Read Area 10 thresholds; fail CI when a file new to the branch exceeds soft cap; hard-cap violations require an ADR. Excludes schema files + manifests by convention | All Area 10 findings (10 hard-cap + 10 soft-cap files) | Catches god-file growth at write time |
| P4 | `gate` (`scripts/verify-no-silent-catch.sh`) | Grep for `.catch(() => {})` and empty `catch {}`; require `guard-ignore: no-silent-failures reason="..."` annotation | Area 5 finding 1 | Forces every silent catch to be intentional + documented |
| P5 | `gate` (`scripts/verify-canonical-retry.sh`) | Grep for `retryCount`-style loops outside `server/lib/withBackoff.ts`; require `guard-ignore: canonical-retry reason="..."` | Module J finding 1 | Closes drift away from canonical retry primitive |
| P6 | `gate` (`scripts/verify-canonical-logger.sh`) | Grep for `console.(log\|warn\|error)` in `server/services` and `server/routes`; require `guard-ignore: canonical-logger reason="..."` | Module K finding 3 + many `skillExecutor.ts` sites | Forces structured logging on production paths |
| P7 | `gate` (`scripts/verify-universal-skill-sync.sh`) | Assert every entry in `UNIVERSAL_SKILL_NAMES` has a matching `ACTION_REGISTRY` row with `isUniversal: true` and vice versa | Module L finding 2 | Closes dual-source drift |
| P8 | `gate` (`scripts/verify-frontend-design-budget.sh`) | Parse page imports for `KpiCard`/`KpiTile`/`Sparkline`/chart components; fail CI for pages not on an admin-only allowlist | Module M Part-2 finding 2 | Catches design-principle violations at PR time |
| P9 | `gate` (`scripts/verify-any-budget.sh`) | Enforce a non-growing `: any` / `as any` count by file; new instances require `// guard-ignore: type-strengthening reason="..."` | Area 4 finding 1 | Ratchets `any` debt down without forcing a mass refactor |
| P10 | `gate` (`scripts/verify-marker-budget.sh`) | Enforce non-growing TODO/FIXME/HACK/TEMP/LEGACY/DEPRECATED count by file; new markers require justification in commit body | Area 6 finding 1 | Same ratchet pattern as P9 |
| P11 | `gate` (`scripts/verify-no-new-cycles.sh`) | Run `madge --circular --json` with a CI-checked baseline; fail when cycle count grows above baseline | Area 8 finding 1 | Catches circular-dep regressions when introduced |
| P12 | `gate` (`scripts/verify-duplicate-blocks.sh`) | Run `jscpd --min-tokens 15` with a clone-density baseline; fail above baseline | Area 2 finding 1 | Same ratchet pattern for duplication |
| P13 | `gate` (`scripts/verify-framework-context-block.sh`) | Parse `docs/codebase-audit-framework.md` §2 against `package.json` scripts; fail CI on drift | Module C finding 2 | Closes the drift class that produced the Vitest/lint staleness |
| P14 | `gate` (`scripts/verify-types-used.sh`) | Walk `shared/types/*` and ensure every exported event type is registered with a discriminated union or used in code | Area 3 finding 1 | Tightens shared-types maintenance |
| P15 | `gate` (`scripts/verify-no-orphan-react-component.sh`) | Walk the React Router tree from `client/src/App.tsx` and flag pages/components with zero ingress | Area 1 finding 1 | Would have caught the skill-analyzer subtree |
| P16 | `gate` (`scripts/verify-knip-config.sh`) | Assert `knip.json` exists and registers every dynamic entry surface | Area 1 finding 2 | Makes knip output trustworthy for future audits |

### Tier 2 — convention at design time (docs)

| # | Target | Proposed addition | Closes findings |
|---|---|---|---|
| P17 | `architecture.md` | Add a "Single org-id source" sub-section: `req.user.organisationId` is read **only** inside `server/middleware/auth.ts`; all other code uses `req.orgId` | Area 9 finding 3 |
| P18 | `CLAUDE.md` § Comments | Add the example "comments describing a completed refactor are residue — commit message is the right home" with `agentExecutionService.ts:72–116` as anchor | Area 1 finding 5, Area 7 finding 1 |
| P19 | `CLAUDE.md` § Frontend | Add "prefer named exports for React components" rule | Area 3 finding 2 |
| P20 | `docs/capabilities.md` § Editorial Rules | Extend with an explicit positive + negative list of "always-OK industry terms" beyond the current five examples | Module M Part-1 finding 2 |

### Tier 3 — lesson via context (KNOWLEDGE.md / ADR)

| # | Target | Proposed addition | Closes findings |
|---|---|---|---|
| P21 | `KNOWLEDGE.md` | Pattern entry: per-critical-path coverage tier matrix; refresh quarterly | Module C finding 3 |
| P22 | `KNOWLEDGE.md` | Pattern entry: "Custom retry loops are pass-3 even when they look right" — anchor on `agentBeliefService.ts` | Module J finding 1 |
| P23 | `KNOWLEDGE.md` | Pattern entry: "Handoff depth-cap rejections need structured events, not console.warn" — anchor on `skillExecutor.ts:3992` | Module K finding 3 |
| P24 | `ADR` (new) | "Service-layer extraction policy for routes touching `db/schema/`" — when to extract a service vs. when `import type` is sufficient | Area 9 findings 1+2 |

### Not feasible — rationale

| # | Finding | Reason |
|---|---|---|
| N1 | Area 1 finding 4 (depcheck false positives on PostCSS plugins, Vitest coverage) | depcheck signal is structurally noisy for plugin-driven configs (no direct import). Manual review remains the right control |
| N2 | Module K finding 4 (handoff audit-trail durability not fully traced) | Covered by dedicated `audit-runner: hotspot agent-execution` — out of scope for a Pass-1 sweep at full-codebase breadth |

---

## Pass 2 Changes Applied

Operator subsequently requested "proceed all pass-2". Three discrete commits landed on the audit branch.

### Pass 2A — Area 1 dead-code removal

**Change intent.** Delete the dead skill-analyzer client subtree confirmed unreferenced in Pass 1. Update one stale server-side comment that mentioned the deleted component.

**Risk profile.** Low. Isolation proof: `SkillAnalyzerWizard` had no external referrer; `App.tsx:39` confirmed the build-stream consolidation already replaced the entry point.

| Fix | Classification | Confidence | Justification | Files Modified |
|---|---|---|---|---|
| Delete 11 files under `client/src/components/skill-analyzer/` | `deletion` | high | Pre-deletion verification: every file's external-referrer count verified manually; only `types` returned matches but path-specific grep showed zero | 11 deleted |
| Update stale doc comment | `behaviour-preserving refactor` | high | Comment cited the deleted React component as the consumer | `server/services/skillAnalyzerServicePure.ts` (4 lines) |

**Validation results:**

| Check | Command | Outcome |
|---|---|---|
| Server typecheck | `npm run build:server` | PASS |
| Client build | `npm run build:client` | PASS (4.28s) |
| Targeted unit tests | n/a | N/A — no tests authored or modified |
| Skill visibility | `npm run skills:verify-visibility` | N/A — no skills changed |
| Playbooks | `npm run playbooks:validate` | N/A — no workflow files changed |

**Commit:** `audit: area 1 — delete dead skill-analyzer subtree (4,114 LOC)` · tag `audit-area-1-complete` · removed 4,115 lines / added 1 line.

### Pass 2B — Area 1 missing-dependency declaration

**Change intent.** Add the two static-import packages (`express-rate-limit`, `zod-to-json-schema`) to `dependencies`; add the two dynamic-import packages (`docx`, `mammoth`) to a new `optionalDependencies` block. Versions pinned to currently-resolved transitive versions to avoid surprise upgrades.

**Risk profile.** Low — additive deps that match the existing import surface. `package.json` is HITL-protected per `.claude/hooks/config-protection.js`; **operator explicitly approved** ("whatever you recommend as best practice"). Sentinel file consumed once per edit; two sentinels required for the two Edit operations.

**Pass 1 finding revision.** The Pass 1 finding listed five packages as a single pass-2 candidate. On verification the audit revised the split:
- **`express-rate-limit`, `zod-to-json-schema`** — static imports; transitive resolution via `@modelcontextprotocol/sdk` is fragile. **Pass 2.**
- **`docx`, `mammoth`** — dynamic imports with `.catch(() => null)` documented optionality. Declared as `optionalDependencies` to preserve intent while making the dep visible to tooling. **Pass 2.**
- **`pg`** — used only in tooling scripts. Tier choice (`devDependencies` vs `dependencies`) is a packaging decision. **Routed to pass 3.**

| Fix | Classification | Confidence | Justification | Files Modified |
|---|---|---|---|---|
| Add `express-rate-limit@^8.3.2` and `zod-to-json-schema@^3.25.2` to `dependencies` | `bug fix` (declared deps now match imports) | high | Static imports at fixed call sites; pinned to current transitive versions | `package.json`, `package-lock.json` |
| Add `docx@^9.6.1` and `mammoth@^1.12.0` to `optionalDependencies` | `behaviour-preserving refactor` | high | Dynamic imports + catch pattern remains the canonical handling; declaration only adds visibility | `package.json`, `package-lock.json` |
| Remove two stale `@ts-expect-error` directives now that TS resolves the optional modules | `behaviour-preserving refactor` | high | Compiler said the directives were unused | `server/services/configDocumentGeneratorService.ts`, `server/services/configDocumentParserService.ts` |

**Validation results:**

| Check | Command | Outcome |
|---|---|---|
| Server typecheck | `npm run build:server` | PASS (after removing the unused `@ts-expect-error` directives that the dep addition exposed) |
| Client build | `npm run build:client` | N/A — verified already-green from Pass 2A; no `client/` files touched in 2B |
| Targeted unit tests | n/a | N/A — no tests authored or modified |
| `npm install` | `npm install --no-audit --no-fund` | PASS (25 packages added, lockfile updated) |

**Commit:** `audit: area 1 — declare statically imported deps + optional DOCX deps` · tag `audit-area-1b-complete` · 4 files changed, 280 insertions, 9 deletions.

### Pass 2C — Module C / D framework §2 refresh

**Change intent.** Bump `docs/codebase-audit-framework.md` v1.3 → v1.4. Refresh §2 rows: Test framework is Vitest (post-migration); `npm run lint` exists. Clean three §12/§13 staleness clusters that still asserted the old facts.

**Risk profile.** Zero — documentation only. No source files touched.

| Fix | Classification | Confidence | Justification | Files Modified |
|---|---|---|---|---|
| §2 Test framework row → Vitest canonical | `behaviour-preserving refactor` | high | `package.json:38` declares `vitest run`; `@vitest/coverage-v8@^2.1.9` installed | `docs/codebase-audit-framework.md` |
| §2 Lint command row → `npm run lint` exists | `behaviour-preserving refactor` | high | `package.json:19` declares `eslint .` | `docs/codebase-audit-framework.md` |
| §12 "Tools NOT to use" — removed `npm run lint does not exist` + `Vitest/Jest not installed` | `behaviour-preserving refactor` | high | Same evidence; replaced with positive guidance "no Jest" | `docs/codebase-audit-framework.md` |
| §13 "Common pitfalls" — removed "Adding `npm run lint` when scripts don't have it" | `behaviour-preserving refactor` | high | Same evidence | `docs/codebase-audit-framework.md` |
| Version bump 1.3 → 1.4 with changelog entry | `behaviour-preserving refactor` | high | Framework §10 "Updating this framework" rule | `docs/codebase-audit-framework.md` |

**Validation results:**

| Check | Command | Outcome |
|---|---|---|
| Server typecheck | n/a | N/A — no source files changed |
| Client build | n/a | N/A — no source files changed |
| Targeted unit tests | n/a | N/A — no tests authored or modified |
| Doc consistency | grep for old "no Vitest" / "no lint" strings | PASS (zero matches remaining) |

**Commit:** `audit: framework v1.3 -> v1.4 — §2 context-block Vitest + lint refresh` · tag `audit-framework-v1.4-complete` · 1 file changed, 8 insertions, 9 deletions.

---

## Pass 3 Items (Awaiting Human Decision)

All findings except Module C finding 2 (framework §2 doc-drift, classified Pass 2 but deferred under "Pass 1 only" instruction) route to pass 3.

Cross-listed in `tasks/todo.md` under:
- `## Deferred from codebase audit — 2026-05-14` (symptom fixes)
- `## Prevention proposals from codebase audit — 2026-05-14` (Rule 16 proposals)

| Item | Area / Module | Severity | Confidence | Reason for Escalation | Recommendation |
|---|---|---|---|---|---|
| Route → DB bypass in `supportAgentRoutes.ts` | Area 9 / Module I | critical | high | RLS-relevant file (Rule 8 downgrade) — auto-fix is mechanical (service extraction) but blast radius exceeds pass-2 safety bar | Extract `supportAgentInboxService`; tighten gate baseline |
| Type-only imports from `db/schema` flagged by gate | Area 9 | low | high | Gate regex over-matches; fix touches CI law | Tighten regex; move shared row types to `shared/types/page.ts` |
| Single dual-source for `req.user.organisationId` in middleware | Area 9 / Module I | low | medium | Convention-level fix; no immediate hazard | Document; optional refactor |
| God-file register (10 hard-cap + 10 soft-cap files) | Area 10 | medium/high | informational | All Area 10 routes to pass 3 by definition | Track in todo; address per ADR with split plan |
| Skill-analyzer subtree is dead | Area 1 | high | high | Large LOC deletion (~7 files, 2 god files); best as a discrete pass-2 chunk | Delete subtree in a single commit |
| 5 missing dependencies | Area 1 / Module F | high | high | Pass-2 candidate but touches `package.json` (Module F: dep changes are `manual review required`) | Add deps in a discrete commit |
| Custom retry loop in `agentBeliefService` | Module J | medium | medium | Touches retry/backoff primitive — Rule 8 downgrade | Extend `withBackoff` OR document intentional divergence |
| `enqueueHandoff` silent depth-cap rejection | Module K | medium | medium | Three-tier agent invariant — Rule 13 high-risk surface | Replace `console.warn` with structured `logger.warn` + Langfuse tag |
| 188 `any`/`as any` instances | Area 4 | medium | low | Mass type-strengthening risk; per-site review only | Ratchet via `verify-any-budget.sh` |
| 133 marker comments | Area 6 | medium | low | Per-marker `git log -p` verification required | Batch triage |
| Three silent `.catch(() => {})` in `agentExecutionService` | Area 5 | medium | medium | State/side-effect surface — Rule 13 downgrade | Audit each site; annotate or escalate |
| 306 knip "unused files" (mostly false positives without config) | Area 1 | medium | high | Need `knip.json` first | Author `knip.json` then re-run |
| ~80 unused exports in `shared/types/*` (knip) | Area 3 | medium | low | Knip weak on discriminated unions / dynamic dispatch | Per-export manual cross-check |
| 19 duplicate exports (default + named) | Area 3 | low | medium | Mid-refactor shims; deliberate in `auth.ts` | Drop named aliases on 7 component files; keep auth.ts |
| Comment cluster `agentExecutionService.ts:72–116` | Area 1 / Area 7 | low | medium | Style / residue | Delete |
| Borderline editorial mention of Google Docs/Dropbox | Module M Part 1 | low | medium | Human editorial judgement | Human review; consider rephrasing |
| 101 client pages not fully audited against Frontend Design Principles | Module M Part 2 | medium | low | Cannot enumerate in a Pass-1 sweep | Schedule `audit-runner: hotspot frontend` |
| `SystemPnlPage.tsx` KPI cards | Module M Part 2 | medium | low | Admin-only status not verified | Confirm admin gate; document exception or trim |
| 186 skill markdown ↔ actionRegistry alignment | Module L | medium | low | Full cross-reference deferred | Run `audit-runner: hotspot skills` |
| `UNIVERSAL_SKILL_NAMES` dual-source maintained by hand | Module L | low | medium | Drift class | Refactor to generate from `ACTION_REGISTRY` |
| Per-critical-path coverage matrix not produced | Module C | medium | medium | Spot-check only | Build matrix; route gaps |
| Framework §2 stale (Vitest, lint) | Module C (D-flavour) | medium | high | Would have been Pass 2 if not for "Pass 1 only" instruction | Update §2; bump framework to v1.4 |
| `madge --circular` not run | Area 8 | medium | low | Tool runtime budget | Schedule dedicated run |
| `jscpd` not run | Area 2 | medium | low | Tool runtime budget | Schedule dedicated run |
| Handoff audit trail durability not fully verified | Module K | medium | low | Out of scope for Pass-1 breadth | `audit-runner: hotspot agent-execution` |

---

## Patterns Captured to KNOWLEDGE.md

| Pattern title | Trigger | KNOWLEDGE.md entry (appended after operator confirmation at findings gate) |
|---|---|---|
| Framework §2 staleness can outlast a major migration | Vitest + lint shipped weeks ago; §2 still says "no Vitest, no lint" | `### [2026-05-14] Pattern — §2 context-block staleness silently mis-classifies audit decisions` |
| `verify-no-db-in-routes.sh` baseline hid a critical layer breach | `supportAgentRoutes.ts` builds queries from `canonicalInboxes` table object in routes; gate has it in baseline | `### [2026-05-14] Pattern — Gate baselines must expire, not just exist` |
| Custom retry storm-detection looks idempotent until you read it twice | `agentBeliefService.ts:124–403` rolls its own counter outside `withBackoff` | `### [2026-05-14] Pattern — Custom retry loops are pass-3 even when they look right` |
| Build-stream consolidations leave dead replicas | App.tsx line 39 comment names 9 superseded pages; only one was actually deleted | `### [2026-05-14] Pattern — Build-stream consolidations need a "delete the replaced" task; comments aren't enough` |

---

## Summary

| Field | Value |
|---|---|
| Overall Status | **WARN** — 1 critical finding (Route → DB breach in `supportAgentRoutes.ts`) remains pass 3. Pass 2 shipped 3 commits (skill-analyzer subtree deletion, 4 dep declarations, framework v1.4 refresh). 24 prevention proposals routed to a separate `audit-prevention-gates-2026-05-14` build spec. |
| Critical findings | **1** (Route → DB bypass in `supportAgentRoutes.ts`) |
| High findings | **5** (skill-analyzer subtree dead, 5 missing deps, 10 god files at hard cap — counted as one Area 10 cluster, etc.) |
| Medium findings | **17** |
| Low findings | **7** |
| Informational (positive) | **7** (atomic lead-swap in schema, handoff depth ≤ 5 enforced, withBackoff health, webhookDedupe health, named coverage on RLS+agentRunVisibility, rlsProtectedTables manifest size, `req.user.organisationId` discipline) |
| Fixes applied (pass 2) | **3** discrete commits with checkpoint tags |
| Files modified by pass 2 | 17 (11 deletions, 5 modifications, 1 new section in package.json) |
| Items deferred to pass 3 | **24 symptom items** (now in `tasks/todo.md` § Deferred from codebase audit — 2026-05-14) + **24 prevention proposals** (now in `tasks/todo.md` § Prevention proposals + spec at `tasks/builds/audit-prevention-gates-2026-05-14/spec.md`) |
| Prevention target breakdown | `gate`: 16 · `architecture.md`: 1 · `CLAUDE.md`: 2 · `docs/capabilities.md`: 1 · `KNOWLEDGE.md`: 3 · `ADR`: 1 · `not feasible`: 2 |
| KNOWLEDGE.md entries appended | **4** (§2 staleness; gate baselines must expire; custom retry loops; build-stream consolidations) |
| Checkpoint tags created | `audit-area-1-complete`, `audit-area-1b-complete`, `audit-framework-v1.4-complete` |
| Build spec written | `tasks/builds/audit-prevention-gates-2026-05-14/spec.md` (Major class; 16 gates + 4 docs + 4 knowledge/ADR; awaits architect for `plan.md`) |
| Linked `pr-reviewer` log | not yet run |
| Linked `spec-conformance` log | not applicable (Pass 1 made no code changes) |
| Linked `dual-reviewer` log | not requested |

---

## Post-audit actions required

Pass 2 has shipped. Pass 3 routing and prevention spec are persisted. Remaining post-audit actions for the caller:

1. **Run `pr-reviewer` on the audit branch** — `audit/full-pre-v1-lockdown-2026-05-14`. Mandatory per framework §13 Completion Criteria. The 3 pass-2 commits + the log/progress/KNOWLEDGE/spec updates are all in scope.
2. **`spec-conformance` not applicable** — Pass 2 touched no spec-driven contract (no files under `docs/superpowers/specs/*.md` or `docs/*-spec.md` were modified). Frame the framework update as a Module D doc-drift fix, not a spec touch.
3. **Open a PR** for the audit branch when ready. The audit-runner does not create PRs.
4. **Schedule follow-up hotspot audits** (each in its own branch):
   - `audit-runner: hotspot skills` — 186-skill / registry alignment (Module L)
   - `audit-runner: hotspot frontend` — 101 client pages vs Frontend Design Principles (Module M Part-2)
   - `audit-runner: hotspot agent-execution` — handoff audit-trail durability + observability (Module K)
   - `audit-runner: hotspot duplication` — `jscpd` run (Area 2)
   - `audit-runner: hotspot circular-deps` — `madge` run (Area 8)
5. **Implement the prevention-gates spec** — invoke `architect` on `tasks/builds/audit-prevention-gates-2026-05-14/spec.md` to produce `plan.md`, then proceed via the standard feature-coordinator pipeline (recommended class: Major).
6. **Sequence god-file splits** as individual builds. Recommended order:
   1. `feat/split-skillexecutor` (6,133 LOC — touches every agent execution path; highest leverage)
   2. `feat/split-workflowengine` (4,073 LOC)
   3. `feat/split-skillanalyzerservicepure` (3,729 LOC)
   4. `feat/split-agentexecutionservice` (2,807 LOC — already moderately split via `*Pure.ts` convention; smallest delta)
   5. The remaining hard-cap pages/components in opportunistic order
7. **Service-extract `supportAgentRoutes` Route → DB breach** (the audit's 1 critical finding). Track as `feat/extract-support-agent-inbox-service`. Defer until the prevention-gates spec's P2 tightening lands so the gate baseline can be expired in the same PR.

---

## Recommended Next Steps

- Operator reviews this Pass 1 report at `tasks/review-logs/codebase-audit-log-pre-v1-lockdown-2026-05-14T04-49-08Z.md`.
- Operator replies with `proceed` / `narrow scope` / `stop` at the findings gate (a separate session is fine — the audit log is durable).
- Open the four follow-up hotspot audits scheduled above when context budget permits.
- Land the prevention-gate batch (P1–P16) before the next quarterly Full Audit so the next sweep is incremental, not exhaustive.

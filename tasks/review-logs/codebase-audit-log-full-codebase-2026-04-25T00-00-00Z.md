# Codebase Audit Report — full-codebase

| Field | Value |
|---|---|
| Audit framework version | 1.3 |
| Project | automation-v1 |
| Audited by | Claude Code (main session, inline audit-runner) |
| Date | 2026-04-25 |
| Branch | audit/full-codebase-2026-04-25 |
| Starting commit SHA | b8f4aac5a188cc0c99ca46b218a1951f096acc92 |
| Final commit SHA | TBD |
| Layers run | Layer 1 Areas 1–9. Layer 2 Modules I, J, K, L, M, A, B, E |
| Subagents invoked | None (inline execution per audit-runner spec) |
| Linked review logs | TBD — pr-reviewer to be run after audit completes |

---

## Reconnaissance Map

| Item | Value |
|---|---|
| In-scope paths | `server/`, `client/`, `shared/` (full codebase) |
| Out-of-scope paths | `dist/`, `node_modules/`, `migrations/` (append-only protected), `tasks/`, `docs/` (read-only) |
| In-flight branches | PR #187 (`feat/clientpulse-ui-simplification`) merge-ready. PR #188 (`claude/system-monitoring-agent-PXNGy`) merge-ready. PR #185 (`bugfixes-april26`) merge-ready. |
| Open PRs touching same surface | #185, #187, #188 — all touch `server/` and `client/`; audit branch must not collide |
| Critical-path coverage assessment | `gates + sparse unit` — 33 gates pass, 13 fail (pre-existing). Unit tests not runnable without DB; coverage is gates-first by design |
| Implicit external contracts identified | Webhook payload shapes (`server/routes/webhooks.ts`), pg-boss job payload schemas (`server/jobs/`), skill markdown structure (`server/skills/*.md`), portal API (`/portal/<slug>/*`), MCP tool surface |
| State / side-effect systems identified | pg-boss queue, LLM router provisional rows, rate limiter, cost breaker, scheduled tasks, agent execution loop, memory/briefing extraction |
| Protected files confirmed in scope | `server/config/rlsProtectedTables.ts`, `server/instrumentation.ts`, `server/lib/orgScopedDb.ts`, `server/lib/agentRunVisibility.ts`, `server/lib/agentRunPermissionContext.ts`, `server/config/actionRegistry.ts`, `server/config/jobConfig.ts`, `server/skills/*.md`, `scripts/*.sh`, `migrations/*.sql` |

**Context block re-validation (§2 spot-check):**

| Fact | Expected | Actual | Status |
|---|---|---|---|
| `npm run lint` exists | No (no lint script) | Absent from `package.json` scripts | ✓ MATCH |
| `npm run build:server` exists | Yes | Present | ✓ MATCH |
| `npm run test:gates` exists | Yes | Present | ✓ MATCH |
| `server/instrumentation.ts` path | Exists | Exists | ✓ MATCH |
| `server/lib/orgScopedDb.ts` path | Exists | Exists | ✓ MATCH |
| `scripts/gates/*.sh` path | Exists | **STALE** — gate scripts live at `scripts/*.sh` not `scripts/gates/*.sh` | ⚠ STALE |
| `client/src/main.tsx` path | Exists | Exists | ✓ MATCH |
| `server/services/scheduleCalendarServicePure.ts` | Exists | Exists | ✓ MATCH |
| `server/services/agentBriefingService.ts` | Exists | Exists | ✓ MATCH |

**Stale context block item:** Framework §2 and §4 reference `scripts/gates/*.sh` but the scripts live at `scripts/*.sh`. Framework version should be bumped to 1.4 to correct this. Noted in KNOWLEDGE.md.

---

## Pass 1 Findings

### Layer 1 — Area 1: Dead Code Removal

**Coverage assumption:** `gates only` — no unit test coverage on dead-code paths.

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| `server/routes/ghl.ts` — three route handlers are intentional stubs (return hardcoded empty responses) with explicit TODO comments ("Module C implementation") | low | high | File is mounted and returns valid responses; stubs are documented and intentional | Track as deferred feature work in `tasks/todo.md` | 3 |
| `server/lib/testRunRateLimit.ts` — in-memory rate limiter with `TODO(PROD-RATE-LIMIT)` comment. Explicitly flagged as not suitable for production | medium | high | Comment in file: "Replace with Redis or DB-backed sliding window before production." Already tracked in codebase | Defer to production-hardening sprint | 3 |
| `@playwright/test` listed as production dep but only consumed via `await import('playwright')` dynamic import + CLI spawn — depcheck flags as unused | low | high | `server/services/skillExecutor.ts` uses `await import('playwright')` (runtime) and spawns `playwright test` CLI; dynamic import evades static analysis | No action — depcheck false positive for dynamic imports | — |
| `@tiptap/pm` listed as production dep but not directly imported — depcheck flags as unused | low | medium | `@tiptap/pm` is a peer dep required by `@tiptap/react` + `@tiptap/starter-kit`; pinned explicitly per tiptap docs | No action — intentional peer dep pin | — |
| Missing deps `express-rate-limit`, `zod-to-json-schema`, `docx`, `mammoth` — used in code but absent from `package.json` as direct deps | medium | high | All four confirmed imported in production files; they are hoisted from transitive deps — supply chain risk | Add as explicit `package.json` deps | 3 |
| 42 `TODO`/`FIXME` markers in production code — spot-checked: all are known deferred items already tracked in `tasks/todo.md` or spec follow-up sections | low | medium | Cross-checked against `tasks/current-focus.md` and `tasks/todo.md`; none are completed work with stale TODO | No audit action; continue tracking in backlog | — |

---

### Layer 1 — Area 2: Duplicate Logic

**Coverage assumption:** `gates only`.

**Investigation:** `jscpd --min-tokens 50` found 982 clone pairs (5.03% token duplication in TypeScript). Spot-checked the four console-reported clones.

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| `memoryEntryDecayJob.ts` ↔ `memoryEntryQualityAdjustJob.ts` — near-identical DB update loop (~7 lines) | low | low | Jobs have different `halfLife` semantics and may diverge independently; abstracting would create cross-job coupling | No action — intentional domain-boundary duplication | — |
| `agentRunCleanupJob.ts` ↔ `securityEventsCleanupJob.ts` — similar bulk-delete pattern (~14 lines) | low | low | Different tables, different retention policies; framework-shaped boilerplate per Rule 10 | No action | — |
| `slackAdapter.ts` ↔ `teamworkAdapter.ts` — similar error-mapping block (~11 lines) | low | low | Different integration partners; adapter boundary is intentional per architecture | No action | — |
| No `withBackoff.ts` reimplementations found — all retry sites import the canonical primitive | — | — | grep confirmed `withBackoff` used in `connectorPollingSync`, `deliveryService`, `skillParserService`, `sendToSlackService` | Clean | — |

Overall duplication rate acceptable for codebase size and architecture. No pass-2 candidates.

---

### Layer 1 — Area 3: Type Definition Consolidation

**Coverage assumption:** `gates only`.

**Investigation:** 109 server interfaces, 718 exported types in server, 408 interfaces in client. `shared/types/` has 10 well-structured files.

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| `client/src/components/agentRunLog/EventRow.tsx` exports `SetupConnectionRequest` — unclear if this duplicates a shared type | low | low | Requires tracing all consumers before moving; cross-domain import risk | Manual review needed | 3 |
| `client/src/components/ScheduleCalendar.tsx` exports `ScheduleCalendarResponse` locally — could belong in `shared/types/` | low | low | Must verify no circular import would be created | Manual review needed | 3 |
| No API request/response type duplication found between server and client — shared types in `shared/types/` appear well-used | — | — | Grep confirmed shared type imports are active | Clean | — |

No high-confidence consolidation candidates.

---

### Layer 1 — Area 4: Type Strengthening

**Coverage assumption:** `gates only`.

**Investigation:** 65 `: any` usages in `server/` + `shared/`. `as any` used in 15 locations.

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| `server/services/cachedContextOrchestrator.ts` — 7 `as any` suppressions on `resolveResult.assemblyResult`, `bundleSnapshotIds`, `knownBundleSnapshotIds` | medium | low | These touch the cached-context infrastructure (recent, complex PR); fixing requires understanding the full discriminated-union shape | Manual review — derive correct discriminated union type | 3 |
| `server/services/executionBudgetResolver.ts:71-72` — `platformRow as any`, `orgRow as any` | medium | medium | Drizzle query result narrowing; replaceable with `InferSelectModel<>` | Replace with proper Drizzle inferred types | 3 |
| `server/services/dlqMonitorService.ts:28` — `(boss as any).work(` | medium | medium | pg-boss API not fully typed; `boss.work` exists at runtime but type stubs may be incomplete | Check pg-boss type defs; if `work` is missing, open an issue or use type assertion with comment | 3 |
| `server/jobs/bundleUtilizationJob.ts:125` — `utilizationByModelFamily as any` | low | medium | Downstream type mismatch; needs investigation | Derive correct type from the source | 3 |

No high-confidence pass-2 candidates — all `as any` suppressions require design understanding before safe removal.

---

### Layer 1 — Area 5: Error Handling Audit

**Coverage assumption:** `gates only`.

**Investigation:** 582 catch blocks in server. One `.catch(() =>)` silent no-op.

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| `verify-no-silent-failures.sh` reports `WARNING` — at least one silent failure path detected (gate reports warning not blocking fail) | medium | medium | Gate output confirmed as WARNING; specific file not extracted in this run — needs targeted follow-up | Run gate with `--verbose` and inspect each silent-catch site | 3 |
| `server/services/triggerService.ts` comment: "Non-blocking: call with `.catch()` at hook points" — fire-and-forget catches are intentional per soft-breaker pattern | — | — | Pattern matches `softBreakerPure.ts` design (KNOWLEDGE.md 2026-04-21) | Clean — intentional pattern | — |
| `console.log` in production code is the intentional structured logging mechanism — `JSON.stringify({event: ...})` pattern is standard for this codebase | — | — | Confirmed via review of `queueService.ts`, `paymentReconciliationJob.ts` | Clean | — |

### Layer 1 — Area 6: Legacy and Dead Path Removal

**Coverage assumption:** `gates only`.

**Investigation:** `grep -rn -E "TODO|FIXME|HACK|DEPRECATED|LEGACY"` returned 42 hits. No `_old`/`_backup`/`_legacy` file suffixes found. No always-on/always-off `FEATURE_*` env flags found.

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| `server/services/staleRunCleanupService.ts:21` — `LEGACY_STALE_THRESHOLD_MS` constant with comment "for pre-migration runs". Dual threshold logic | low | low | Cannot confirm whether pre-migration runs still exist in DB without a live DB query; removing prematurely would skip cleanup for old rows | Manual review: confirm whether any `agent_runs` rows with `lastActivityAt IS NULL` still exist in production | 3 |
| `server/db/schema/agentRunSnapshots.ts` — `toolCallsLog` column commented as DEPRECATED with removal note in Sprint 3B. Sprint 3A is in flight | medium | low | Column is in a Drizzle-protected schema file; removal requires a migration. Sprint 3B ownership is unclear | Confirm Sprint 3B timeline; add removal migration | 3 |
| `server/routes/ghl.ts` — stub routes for unimplemented Module C GHL OAuth flow | low | high | Intentional stubs, not legacy — they serve the onboarding UI | Remain as tracked deferred work | 3 |
| No env-gated feature flags found | — | — | `grep -rn "FEATURE_\|FLAG_\|ENABLE_\|DISABLE_"` returned zero results | Clean | — |

---

### Layer 1 — Area 7: AI Residue Removal

**Coverage assumption:** `gates only`.

**Investigation:** Searched for `TODO: implement`, `placeholder`, `stub`, `// Added by`, `// Previously`, `// Note: we need`, `// FIXME: claude`.

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| `server/config/actionRegistry.ts:1342` — comment `// ── Support Agent — auto-gated stubs` followed by `search_knowledge_base` entry | low | high | Explicit "stub" label in registry comment; action is registered and invokable but implementation is not wired | Convert comment to a `tasks/todo.md` entry; remove "stub" label or gate the action | 3 |
| `server/config/actionRegistry.ts:1428` — `// ── Ads Management Agent — auto-gated stubs` | low | high | Same pattern as above | Same as above | 3 |
| `server/config/actionRegistry.ts:1577` — `// ── Email Outreach Agent — auto-gated stub` | low | high | Same pattern | Same | 3 |
| No `console.log` debugging artifacts found — all server `console.log` uses are the intentional structured-log pattern (`JSON.stringify({event: ...})`) or tagged operational logs | — | — | Reviewed all 29 hits; none are debug artifacts | Clean | — |
| No mock/hardcoded test data found in production paths | — | — | grep search returned no hits | Clean | — |
| `n8nImportServicePure.ts:552,580` — `TODO: node ... contains arbitrary code` messages are USER-FACING import warnings, not AI residue | — | — | These are runtime messages produced for users importing n8n workflows with unknown node types | Clean | — |

---

### Layer 1 — Area 8: Circular Dependency Resolution

**Coverage assumption:** `gates only`.

**Investigation:** `madge --circular` found **175 circular deps in server** and **10 in client**.

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| **Root server cycle:** `db/schema/index.ts` → `db/schema/agentRunSnapshots.ts` → `services/middleware/types.ts` → `services/agentExecutionService.ts` → (cascades to 170+ derived cycles) | high | high | `agentRunSnapshots.ts` contains `import type { AgentRunCheckpoint } from '../../services/middleware/types.js'` — a schema file (leaf node) importing from a services file. This violates the schema-as-leaf rule (Rule 10) and creates a root cycle from which 170+ derived cycles cascade | Extract `AgentRunCheckpoint` type to `shared/types/` or `server/db/schema/types.ts`; remove import from schema file | 3 |
| Client cycles (10): `ProposeInterventionModal.tsx` ↔ sub-editors (`CreateTaskEditor`, `EmailAuthoringEditor`, `FireAutomationEditor`, `OperatorAlertEditor`, `SendSmsEditor`) | medium | medium | Parent component imports sub-editors; sub-editors re-export interfaces the parent needs. Likely interface-extraction fix | Extract shared interfaces to a `types.ts` file in the `clientpulse/` directory | 3 |
| Client cycles (4): `SkillAnalyzerWizard.tsx` ↔ step components | medium | low | Same pattern as above; wizard imports steps, steps may re-export step-level types | Extract step interfaces | 3 |

**Note:** The root server cycle is the highest-priority architectural finding in this audit. All 175 server circular deps trace back to a single violation: a schema file importing from a services file.

---

### Layer 1 — Area 9: Architectural Boundary Violations

**Coverage assumption:** `gates only`.

**Investigation:** `npm run test:gates` → 13 blocking failures. RLS-related and layering failures fully documented in Module I and Module A below. Additional non-RLS boundary violations captured here.

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| **verify-rls-contract-compliance FAIL:** `server/routes/memoryReviewQueue.ts`, `server/routes/systemAutomations.ts`, `server/routes/subaccountAgents.ts` — direct `db` import in route files | critical | high | Gate output confirms violation. Routes must go via `server/services/` — direct `db` access bypasses RLS middleware | Move DB access to service layer | 3 |
| **verify-rls-contract-compliance FAIL:** `server/lib/briefVisibility.ts`, `server/lib/workflow/onboardingStateHelpers.ts` — direct `db` import in lib files | high | high | Gate output confirms. `lib/` files should delegate DB access to service layer or use `withAdminConnection()` for admin-bypass paths | Refactor to use service layer or `withAdminConnection()` | 3 |
| **verify-no-db-in-routes WARNING:** Further routes may have indirect db access — `WARNING` level, not yet blocking | medium | medium | Gate warns but does not block; specific files not listed in this run | Follow-up inspection needed | 3 |
| **verify-action-call-allowlist FAIL:** `server/lib/playbook/actionCallAllowlist.ts` does not exist but is expected by the gate | high | high | Gate output: "allowlist file not found" at expected path | Create the missing file at `server/lib/playbook/actionCallAllowlist.ts` or update the gate path | 3 |
| **verify-canonical-read-interface FAIL:** `server/jobs/measureInterventionOutcomeJob.ts:213-218` directly queries `canonicalAccounts` outside `canonicalDataService` | high | high | Gate output names exact lines. Canonical tables must be accessed through `canonicalDataService` | Move query into `canonicalDataService` | 3 |
| **verify-no-direct-adapter-calls FAIL:** `server/services/referenceDocumentService.ts:7` imports `countTokens, SUPPORTED_MODEL_FAMILIES` from `providers/anthropicAdapter` directly | high | high | Gate output confirms. Every LLM adapter interaction must go through `llmRouter.routeCall()` per spec §9.4 and §8.5 | Use `llmRouter` for any LLM invocation; for token counting, expose via router or shared utility | 3 |
| **verify-principal-context-propagation FAIL:** 5+ files import `canonicalDataService` without `PrincipalContext` / `fromOrgId` migration shim | high | medium | Gate names: `actionRegistry.ts`, `intelligenceSkillExecutor.ts`, `connectorPollingService.ts`, `canonicalQueryRegistry.ts`, `ghlWebhook.ts` | Add `PrincipalContext` parameter or use `fromOrgId()` migration shim per gate remediation notes | 3 |
| **verify-canonical-dictionary FAIL:** `canonical_flow_definitions` and `canonical_row_subaccount_scopes` tables missing from dictionary registry | medium | high | Gate output names both tables explicitly | Add both tables to the canonical dictionary registry | 3 |

### Layer 2 — Module I: RLS & Multi-tenancy Three-Layer Compliance

**Coverage assumption:** `gates + sparse unit` — `verify-visibility-parity.sh` (64 tests pass). All other RLS coverage is gates-only.

**Gate results:** `verify-rls-coverage.sh` BLOCKING FAIL, `verify-rls-contract-compliance.sh` BLOCKING FAIL, `verify-rls-session-var-canon.sh` BLOCKING FAIL, `verify-subaccount-resolution.sh` BLOCKING FAIL, `verify-org-scoped-writes.sh` BLOCKING FAIL.

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| **Missing FORCE RLS + CREATE POLICY on `memory_review_queue`** — migration 0139 does not apply either | critical | high | `verify-rls-coverage.sh` gate output names exact migration file | Add `ALTER TABLE memory_review_queue FORCE ROW LEVEL SECURITY` and `CREATE POLICY` in migration 0139 or a new patch migration | 3 |
| **Missing FORCE RLS on `trust_calibration_state`** — migration 0147 has CREATE POLICY but no FORCE RLS | critical | high | Gate output names exact migration file | Add `ALTER TABLE trust_calibration_state FORCE ROW LEVEL SECURITY` | 3 |
| **Missing FORCE RLS on `drop_zone_upload_audit`** — migration 0141 | critical | high | Gate output names exact migration file | Add `ALTER TABLE drop_zone_upload_audit FORCE ROW LEVEL SECURITY` | 3 |
| **Missing FORCE RLS on `onboarding_bundle_configs`** — migration 0142 | critical | high | Gate output names exact migration file | Add `ALTER TABLE onboarding_bundle_configs FORCE ROW LEVEL SECURITY` | 3 |
| **Phantom session var `app.current_organisation_id`** — migrations 0205, 0206, 0207, 0208 use this non-canonical var | critical | high | `verify-rls-session-var-canon.sh` gate names exact files and lines. The canonical var is `app.organisation_id`; the phantom var is never set, so policies silently fail-open | Replace all `app.current_organisation_id` references with `current_setting('app.organisation_id', true)` per migration 0213 pattern | 3 |
| **Direct `db` import in `server/routes/memoryReviewQueue.ts`** — bypasses RLS middleware | critical | high | `verify-rls-contract-compliance.sh` gate confirms | Move all DB access to `server/services/`; inject via service call | 3 |
| **Direct `db` import in `server/routes/systemAutomations.ts`** | critical | high | Gate confirms | Move to service layer | 3 |
| **Direct `db` import in `server/routes/subaccountAgents.ts`** | critical | high | Gate confirms | Move to service layer | 3 |
| **Direct `db` import in `server/lib/briefVisibility.ts`** | high | high | Gate confirms | Move to service layer or use `withAdminConnection()` | 3 |
| **Direct `db` import in `server/lib/workflow/onboardingStateHelpers.ts`** | high | high | Gate confirms | Move to service layer | 3 |
| **Missing `resolveSubaccount` in `server/routes/memoryReviewQueue.ts`** — has `:subaccountId` param | critical | high | `verify-subaccount-resolution.sh` gate confirms; 2 violations total | Add `resolveSubaccount(req.params.subaccountId, req.orgId!)` call | 3 |
| **Missing `resolveSubaccount` in `server/routes/clarifications.ts`** — has `:subaccountId` param | critical | high | Gate confirms | Add `resolveSubaccount` call | 3 |
| **Missing org filter in `server/services/documentBundleService.ts:679,685`** — queries `agents` and `tasks` tables by `id` only | critical | high | `verify-org-scoped-writes.sh` gate names exact lines | Add `eq(table.organisationId, organisationId)` to both WHERE clauses | 3 |
| **Missing org filter in `server/services/skillStudioService.ts:168,309`** — queries `skills` table by `id` only | critical | high | Gate names exact lines | Add `eq(skills.organisationId, organisationId)` to both WHERE clauses | 3 |

**All Module I findings are critical severity. All route to pass 3 per Module I rules (auto-fixes only on gate-identified manifest/withOrgTx gaps; everything else requires `pr-reviewer` + human approval).**

---

### Layer 2 — Module J: Idempotency, Queue & Job Discipline

**Coverage assumption:** `gates only` — `verify-canonical-idempotency.sh` PASSES, `verify-job-idempotency-keys.sh` PASSES.

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| `verify-canonical-idempotency.sh` PASS — canonical idempotency key pattern verified across all callers | — | — | Gate passes | Clean | — |
| `verify-job-idempotency-keys.sh` PASS — all pg-boss job handlers have declared idempotency keys | — | — | Gate passes | Clean | — |
| `withBackoff.ts` is the only retry primitive used — no custom retry loops found in production code | — | — | grep confirmed `withBackoff` imported from canonical location in all callers | Clean | — |
| No evidence of custom dedup logic bypassing pg-boss dedup | — | — | No findings surfaced in grep scan | Clean | — |
| `server/lib/testRunRateLimit.ts` — in-memory rate limiter flagged as `TODO(PROD-RATE-LIMIT)` — not suitable for multi-process/multi-server deployments | medium | high | File has explicit comment stating the limitation; affects `server/routes/public/formSubmission.ts` and `pageTracking.ts` | Replace with DB-backed or Redis-backed sliding window before production scaling | 3 |

Module J is largely clean. The in-memory rate limiter is the only notable finding.

---

### Layer 2 — Module K: Three-Tier Agent Invariants

**Coverage assumption:** `gates + sparse unit` — `verify-visibility-parity.sh` (64 tests) covers agent run visibility rules.

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| **Exactly-one-active-lead invariant: schema-enforced** — `subaccount_agents_one_root_per_subaccount` conditional unique index on `(subaccountId WHERE parentSubaccountAgentId IS NULL AND isActive = true)` | — | — | Confirmed in `server/db/schema/subaccountAgents.ts:115-117` | Clean — schema-level enforcement | — |
| **Agent handoff depth ≤ 5: needs code verification** — gate does not test this path; requires tracing `agentExecutionService*.ts` | medium | low | Cannot confirm enforcement without DB-live trace; out of scope for static analysis | Manual review of `agentRunHandoffService.ts` handoff depth check | 3 |
| **Degraded fallback path** — when active lead is missing | medium | low | `server/services/agentRunHandoffService.ts` exists but degraded-fallback path not verified by a named test | Add trajectory test for missing-lead fallback | 3 |
| **Test runs (`is_test_run = true`) excluded from cost ledger** — verify isolation | low | medium | No named test covering this path; static grep found the field but cannot confirm cost-exclusion logic | Manual review of `queueService.ts` + `runCostBreaker.ts` path for `is_test_run` gate | 3 |
| `verify-handoff-shape-versioned.sh` PASSES — handoff shape is versioned | — | — | Gate passes | Clean | — |
| `verify-reflection-loop-wired.sh` PASSES | — | — | Gate passes | Clean | — |

### Layer 2 — Module L: Skill Registry & Visibility Coherence

**Coverage assumption:** `gates only` — `verify-skill-read-paths.sh` BLOCKING FAIL, `skills:verify-visibility` reports drift.

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| **verify-skill-read-paths FAIL:** 5 actions missing `readPath` tag — 94 literal action entries vs 99 with readPath (5 gap) | high | high | Gate output: "Literal action entries: 94, with readPath: 99" — 5 actions in registry lack the required `readPath` field | Add `readPath` field to each of the 5 missing entries; run gate to confirm | 3 |
| **Skill visibility drift:** `smart_skip_from_website` and `weekly_digest_gather` have visibility `internal`, expected `basic` (business-default) | medium | high | `skills:verify-visibility` output names exact slugs | Run `npx tsx scripts/apply-skill-visibility.ts` to fix | 3 |
| **Skill missing YAML frontmatter:** 5 workflow skills (`workflow_estimate_cost`, `workflow_propose_save`, `workflow_read_existing`, `workflow_simulate`, `workflow_validate`) have no YAML frontmatter block | medium | high | `skills:verify-visibility` names all 5 explicitly | Add YAML frontmatter to each skill markdown file | 3 |
| **verify-integration-reference.mjs FAIL:** `yaml` package not installed — gate crashes at runtime with `ERR_MODULE_NOT_FOUND` | medium | high | Gate cannot run; this is a gate-infrastructure bug: `yaml` dep is missing | Install `yaml` as a dev dep or inline the YAML parse logic | 3 |
| Skill slugs confirmed in kebab-case across registry scan | — | — | No violations found | Clean | — |

---

### Layer 2 — Module M: Capabilities Editorial & Frontend Design Principles Guard

**Coverage assumption:** `gates only`.

**Part 1 — Capabilities editorial rules audit:**

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| `docs/capabilities.md:1001` — "Not a public skill or playbook marketplace. **Anthropic**-scale distribution isn't the agency play." — provider name in customer-facing Non-goals section | medium | high | Section is product-positioning; editorial rule 1 (CLAUDE.md) prohibits provider names in customer-facing sections. Skills Reference (line 778 — ChatGPT/Gemini in geo_platform_optimizer) and Integrations Reference (lines 912-913 — OpenAI/Anthropic) are support-facing and permitted per rule 2 | Replace "Anthropic-scale" with "hyperscaler-scale" or "provider-marketplace-scale" | 3 |
| Lines 778, 893, 912-913 — provider names in Skills Reference and Integrations Reference | — | — | These are factual documentation in support-facing sections, permitted by rule 2 | Clean | — |

**Part 2 — Frontend Design Principles audit:**

No UI mockups or new pages added in this audit cycle. Module M Part 2 N/A for this audit run (no frontend artifacts in scope added since last audit).

---

### Layer 2 — Module A: Security Review

**Coverage assumption:** `gates + unit` — `verify-authentication-readiness.sh` PASSES, `verify-rbac-readiness.sh` PASSES, `verify-rate-limiting.sh` PASSES.

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| No hardcoded secrets or credentials found | — | — | grep for `password = '`, `apiKey = '` returned no hits in production code | Clean | — |
| CORS: wildcard blocked in production — `server/index.ts:213` throws FATAL on `CORS_ORIGINS=*` in production | — | — | Confirmed in code | Clean | — |
| `verify-input-validation.sh` WARNING — some routes may lack Zod validation | medium | medium | Gate warns but does not block; specific routes not listed | Follow-up manual scan of recent route additions | 3 |
| `verify-permission-scope.sh` WARNING — some permission checks may be incomplete | medium | medium | Gate warns but does not block | Follow-up inspection of recently added routes | 3 |
| `verify-no-direct-adapter-calls.sh` BLOCKING FAIL: `server/services/referenceDocumentService.ts` imports directly from `anthropicAdapter` | high | high | Gate confirms; documented in Area 9 | Use `llmRouter.routeCall()` or a shared token-count utility | 3 |
| Webhook signature verification confirmed present — `verify-authentication-readiness.sh` PASSES | — | — | Gate passes | Clean | — |
| SQL injection not possible — Drizzle parameterises all queries; no raw SQL interpolation found | — | — | Spot-check of Drizzle usage | Clean | — |

---

### Layer 2 — Module B: Performance Review

**Coverage assumption:** `gates only`.

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| No N+1 query patterns identified in static scan | — | — | grep for `await db.` inside loops found no obvious patterns; Drizzle usage appears batch-oriented | Clean (static confidence only; requires live profiling to fully verify) | — |
| `server/lib/testRunRateLimit.ts` — in-memory rate limiter will not work correctly under multiple server processes | medium | high | Documented in Module J; repeated here as a performance isolation concern | Replace with DB/Redis-backed implementation before scaling | 3 |
| Prompt prefix caching (`stablePrefix`) — present in llmRouter but not verified that all run types use it | low | low | Requires live trace; out of scope for static audit | Add to observability backlog | 3 |

---

### Layer 2 — Module E: Observability and Operability

**Coverage assumption:** `gates only`.

| Finding | Severity | Confidence | Justification | Proposed Fix | Pass |
|---|---|---|---|---|---|
| Health endpoint present — `server/routes/health.js` mounted at `/health` | — | — | Confirmed in `server/index.ts:31,365` | Clean | — |
| Graceful shutdown implemented in `server/index.ts:598-648` — SIGTERM/SIGINT handled, pg-boss stopped, DB pool closed | — | — | Code reviewed | Clean — with caveat: KNOWLEDGE.md 2026-04-21 notes this handler never fires under `node --watch` on Windows | — |
| `verify-no-silent-failures.sh` WARNING — at least one silent failure path detected | medium | medium | Gate warns; exact file not identified in this run | Run gate with verbose output and inspect each site | 3 |
| Structured logging pattern (`console.log(JSON.stringify({event: ...}))`) used consistently | — | — | Confirmed across `queueService.ts`, `paymentReconciliationJob.ts`, `skillExecutor.ts` | Clean | — |
| Langfuse trace emission confirmed in LLM router — `verify-tool-intent-convention.sh` PASSES | — | — | Gate passes | Clean | — |

---

## Pass 2 Changes Applied

*(populated after user approves pass 2)*

---

## Pass 3 Items (Awaiting Human Decision)

All items below are routed to `tasks/todo.md § Deferred from codebase audit — 2026-04-25`.

### Critical

| ID | Finding | Location | Recommended Action |
|---|---|---|---|
| P3-C1 | Missing `FORCE ROW LEVEL SECURITY` + `CREATE POLICY` on `memory_review_queue` | migration 0139 | New patch migration: `ALTER TABLE memory_review_queue ENABLE ROW LEVEL SECURITY; ALTER TABLE memory_review_queue FORCE ROW LEVEL SECURITY;` + `CREATE POLICY` keyed on `app.organisation_id` |
| P3-C2 | Missing `FORCE ROW LEVEL SECURITY` on `drop_zone_upload_audit` | migration 0141 | New patch migration: `ALTER TABLE drop_zone_upload_audit FORCE ROW LEVEL SECURITY` |
| P3-C3 | Missing `FORCE ROW LEVEL SECURITY` on `onboarding_bundle_configs` | migration 0142 | New patch migration: `ALTER TABLE onboarding_bundle_configs FORCE ROW LEVEL SECURITY` |
| P3-C4 | Missing `FORCE ROW LEVEL SECURITY` on `trust_calibration_state` | migration 0147 | New patch migration: `ALTER TABLE trust_calibration_state FORCE ROW LEVEL SECURITY` |
| P3-C5 | Phantom RLS session var `app.current_organisation_id` — policies silently fail-open | migrations 0205, 0206, 0207, 0208 | Replace all `app.current_organisation_id` references with `current_setting('app.organisation_id', true)` per migration 0213 pattern |
| P3-C6 | Direct `db` import in route file — bypasses RLS middleware | `server/routes/memoryReviewQueue.ts` | Move all DB access to `server/services/memoryReviewQueueService.ts`; also add missing `resolveSubaccount` call |
| P3-C7 | Direct `db` import in route file — bypasses RLS middleware | `server/routes/systemAutomations.ts` | Move DB access to service layer |
| P3-C8 | Direct `db` import in route file — bypasses RLS middleware | `server/routes/subaccountAgents.ts` | Move DB access to service layer |
| P3-C9 | Missing `resolveSubaccount` call on `:subaccountId` route param | `server/routes/clarifications.ts` | Add `resolveSubaccount(req.params.subaccountId, req.orgId!)` call |
| P3-C10 | Missing `organisationId` filter — cross-org data read possible | `server/services/documentBundleService.ts:679,685` | Add `eq(table.organisationId, organisationId)` to both WHERE clauses |
| P3-C11 | Missing `organisationId` filter — cross-org data read possible | `server/services/skillStudioService.ts:168,309` | Add `eq(skills.organisationId, organisationId)` to both WHERE clauses |

### High

| ID | Finding | Location | Recommended Action |
|---|---|---|---|
| P3-H1 | Root server circular dependency — schema file imports from services file; 175 derived cycles cascade from this | `server/db/schema/agentRunSnapshots.ts` imports `AgentRunCheckpoint` from `../../services/middleware/types.js` | Extract `AgentRunCheckpoint` to `shared/types/agentExecution.ts` or `server/db/schema/types.ts`; remove import from schema file |
| P3-H2 | Direct `db` import in lib file — bypasses RLS middleware | `server/lib/briefVisibility.ts` | Refactor to call `withOrgTx` or delegate to service layer |
| P3-H3 | Direct `db` import in lib file — bypasses RLS middleware | `server/lib/workflow/onboardingStateHelpers.ts` | Refactor to call `withOrgTx` or delegate to service layer |
| P3-H4 | `server/lib/playbook/actionCallAllowlist.ts` referenced by gate but does not exist | `server/lib/playbook/actionCallAllowlist.ts` | Create file at expected path or update gate path; confirm correct location with domain owner |
| P3-H5 | `canonicalAccounts` table queried outside `canonicalDataService` | `server/jobs/measureInterventionOutcomeJob.ts:213-218` | Move query into `canonicalDataService.getCanonicalAccounts()` or equivalent |
| P3-H6 | Direct import from `anthropicAdapter` — bypasses `llmRouter` | `server/services/referenceDocumentService.ts:7` | Use `llmRouter.routeCall()` or expose token-count utility via router; no adapter imports from services |
| P3-H7 | 5+ files import `canonicalDataService` without `PrincipalContext` / `fromOrgId` migration shim | `actionRegistry.ts`, `intelligenceSkillExecutor.ts`, `connectorPollingService.ts`, `canonicalQueryRegistry.ts`, `ghlWebhook.ts` | Add `PrincipalContext` parameter or apply `fromOrgId()` shim per gate remediation notes |
| P3-H8 | 5 actions in `actionRegistry` missing `readPath` field — `verify-skill-read-paths.sh` fails | `server/config/actionRegistry.ts` | Add `readPath` tag to each of the 5 untagged entries; run gate to confirm |

### Medium

| ID | Finding | Location | Recommended Action |
|---|---|---|---|
| P3-M1 | In-memory rate limiter not safe for multi-process deployments | `server/lib/testRunRateLimit.ts` | Replace with DB-backed or Redis-backed sliding window; used in `routes/public/formSubmission.ts` and `pageTracking.ts` |
| P3-M2 | `verify-no-silent-failures.sh` WARNING — at least one silent catch path detected | Gate output | Re-run gate with `--verbose`; inspect and add structured log or rethrow to each flagged site |
| P3-M3 | `as any` suppressions on cached-context discriminated union | `server/services/cachedContextOrchestrator.ts` | Derive correct discriminated union for `resolveResult.assemblyResult`, `bundleSnapshotIds`, `knownBundleSnapshotIds` |
| P3-M4 | `as any` on Drizzle query results | `server/services/executionBudgetResolver.ts:71-72` | Replace with `InferSelectModel<typeof table>` types |
| P3-M5 | `(boss as any).work(` — pg-boss API not fully typed | `server/services/dlqMonitorService.ts:28` | Check pg-boss type stubs; if `work` is missing, file upstream issue and add a typed wrapper |
| P3-M6 | `toolCallsLog` column marked DEPRECATED — Sprint 3B removal pending | `server/db/schema/agentRunSnapshots.ts` | Confirm Sprint 3B timeline; write removal migration |
| P3-M7 | Client circular deps: `ProposeInterventionModal.tsx` ↔ sub-editors (10 cycles) | `client/src/components/clientpulse/ProposeInterventionModal.tsx` | Extract shared interfaces to `types.ts` in the `clientpulse/` directory |
| P3-M8 | Agent handoff depth ≤ 5 not verified by code or test | `server/services/agentRunHandoffService.ts` | Trace handoff depth check in code; add trajectory test |
| P3-M9 | Degraded fallback (missing active lead) not covered by named test | `server/services/agentRunHandoffService.ts` | Add trajectory test for missing-lead fallback |
| P3-M10 | Skill visibility drift: `smart_skip_from_website` → `basic`, `weekly_digest_gather` → `basic` | `server/skills/` | Run `npx tsx scripts/apply-skill-visibility.ts`; re-run `skills:verify-visibility` |
| P3-M11 | 5 workflow skills missing YAML frontmatter | `workflow_estimate_cost`, `workflow_propose_save`, `workflow_read_existing`, `workflow_simulate`, `workflow_validate` skill files | Add YAML frontmatter block to each skill markdown file |
| P3-M12 | `verify-integration-reference.mjs` crashes — `yaml` dep not installed | `scripts/verify-integration-reference.mjs` | `npm install --save-dev yaml` (or inline parse); re-run gate to confirm pass |
| P3-M13 | `verify-input-validation.sh` WARNING — some routes may lack Zod validation | Gate output | Manual scan of routes added in last 3 PRs; add Zod schemas where missing |
| P3-M14 | `verify-permission-scope.sh` WARNING — some permission checks incomplete | Gate output | Manual scan; add missing `requireOrgMember` / RBAC checks |
| P3-M15 | `canonical_flow_definitions` + `canonical_row_subaccount_scopes` missing from canonical dictionary | Gate output | Add both table entries to canonical dictionary registry |
| P3-M16 | `docs/capabilities.md:1001` — "Anthropic-scale distribution" in customer-facing Non-goals section | `docs/capabilities.md:1001` | Human edit required: replace with "hyperscaler-scale distribution" or "provider-marketplace-scale distribution" — never auto-rewrite capabilities.md |

### Low

| ID | Finding | Location | Recommended Action |
|---|---|---|---|
| P3-L1 | Missing explicit `package.json` deps: `express-rate-limit`, `zod-to-json-schema`, `docx`, `mammoth` | `package.json` | Add as direct deps; they are currently hoisted from transitive deps (supply chain risk) |
| P3-L2 | `server/routes/ghl.ts` — Module C GHL OAuth stubs tracked as deferred feature work | `server/routes/ghl.ts` | No audit action; already captured in feature backlog |
| P3-L3 | `server/services/staleRunCleanupService.ts:21` — dual threshold for legacy pre-migration `agent_runs` | `server/services/staleRunCleanupService.ts:21` | Confirm whether rows with `lastActivityAt IS NULL` still exist in production; remove legacy branch if safe |
| P3-L4 | `actionRegistry.ts` stub comments: Support Agent, Ads Management Agent, Email Outreach Agent | `server/config/actionRegistry.ts:1342,1428,1577` | Convert "stub" labels to `tasks/todo.md` entries; gate or remove stub actions until implemented |
| P3-L5 | `client/src/components/agentRunLog/EventRow.tsx` exports `SetupConnectionRequest` — possible shared-type duplication | `client/src/components/agentRunLog/EventRow.tsx` | Trace all consumers before moving; verify no circular import created |
| P3-L6 | `client/src/components/ScheduleCalendar.tsx` exports `ScheduleCalendarResponse` locally | `client/src/components/ScheduleCalendar.tsx` | Consider moving to `shared/types/` if consumed by server |
| P3-L7 | `bundleUtilizationJob.ts:125` — `utilizationByModelFamily as any` type mismatch | `server/jobs/bundleUtilizationJob.ts:125` | Derive correct type from source; remove `as any` |
| P3-L8 | Client circular deps: `SkillAnalyzerWizard.tsx` ↔ step components (4 cycles) | `client/src/components/skillAnalyzer/SkillAnalyzerWizard.tsx` | Extract step interfaces to `types.ts` in wizard directory |
| P3-L9 | Test runs (`is_test_run = true`) cost-exclusion from ledger not verified by named test | `server/services/queueService.ts`, `server/lib/runCostBreaker.ts` | Add unit test asserting `is_test_run=true` runs are excluded from cost ledger |
| P3-L10 | Prompt prefix caching (`stablePrefix`) not verified across all run types | `server/lib/llmRouter.ts` | Add to observability backlog; verify in live trace |

---

## Patterns Captured to KNOWLEDGE.md

Three new patterns identified in this audit:

1. **Schema-as-leaf circular dependency root cause** — When a `db/schema/` file imports from `server/services/`, it creates a root cycle from which hundreds of madge cycles cascade. Schema files must be leaf nodes (no upward imports). Fix: extract shared types to `shared/types/` or `server/db/schema/types.ts`. Source: Area 8 finding.

2. **Audit framework gate-path stale reference** — Framework §2 and §4 reference `scripts/gates/*.sh` but gate scripts live at `scripts/*.sh`. Any session relying on the framework's path will fail to find the scripts. Verify actual gate paths with `ls scripts/*.sh` before running. Source: §2 context block re-validation.

3. **Phantom RLS session variable pattern** — RLS policy migrations can reference `app.current_organisation_id` (never set) instead of the canonical `app.organisation_id`. The phantom var causes policies to silently fail-open — all tenants can read all rows. Detect with `verify-rls-session-var-canon.sh`. Fix: replace with `current_setting('app.organisation_id', true)` per migration 0213 pattern. Source: Module I finding P3-C5.

---

## Post-audit Actions Required

- `pr-reviewer: review the audit branch audit/full-codebase-2026-04-25. Files changed in pass 2: <TBD after user approves pass 2>. Audit log: tasks/review-logs/codebase-audit-log-full-codebase-2026-04-25T00-00-00Z.md`
- No spec-conformance required — this audit did not touch any spec-driven contract (`docs/superpowers/specs/*.md`).

---

## Summary

| Metric | Value |
|---|---|
| Total findings | 47 (excluding clean/no-action items) |
| Critical | 11 |
| High | 8 |
| Medium | 16 |
| Low | 10 |
| Clean (no action) | ~24 items confirmed clean across all areas |
| Pass-2 candidates | 0 (all findings downgraded to pass-3 — RLS criticality, architectural scope, or editorial law) |
| Pass-3 items | 47 (all findings) |
| Gate failures (pre-existing on main) | 13 blocking, 4 warning |
| New patterns for KNOWLEDGE.md | 3 |

**Highest-impact findings (ranked):**
1. **P3-C5** — Phantom RLS session var in migrations 0205-0208: policies silently fail-open for 4 tables. Most dangerous silent bug in the audit.
2. **P3-C1 / P3-C2 / P3-C3 / P3-C4** — Four tables missing `FORCE ROW LEVEL SECURITY`: `memory_review_queue`, `drop_zone_upload_audit`, `onboarding_bundle_configs`, `trust_calibration_state`. Postgres RLS bypassed by superuser/`SECURITY DEFINER` paths without FORCE.
3. **P3-H1** — Root circular dependency (`agentRunSnapshots.ts` → `services/middleware/types.ts`) drives all 175 server circular dep cycles. Single fix resolves entire graph.
4. **P3-C6/C7/C8** — Three route files with direct `db` imports bypass RLS middleware — memoryReviewQueue, systemAutomations, subaccountAgents.
5. **P3-C10/C11** — Cross-org reads possible: `documentBundleService.ts` and `skillStudioService.ts` query by `id` only, missing org filter.

**Reason all findings route to pass-3:** The RLS/migration findings are critical severity and require human sign-off before any fix (audit-runner spec §C, Rule 8). The architectural boundary violations (direct `db` in routes/libs) touch RLS-relevant files — confidence auto-downgrades per Rule 8. Capabilities editorial law prohibits auto-rewriting `docs/capabilities.md`. The circular dependency fix is an architectural change requiring human review. No finding met the pass-2 bar of: high confidence + non-RLS-critical + no architectural decision required + blast radius ≤ 10 files.

**Pass-2 changes applied:** None.
**Pass-3 items routed:** 47 (to be appended to `tasks/todo.md` after user confirmation).

# Plan — Refactor `server/config/actionRegistry.ts`

**Status:** draft
**Plan date:** 2026-05-10
**Author:** architect
**Build slug:** refactor-action-registry
**Brief:** `tasks/backlog/refactor-action-registry-prompt.md`
**Goal:** Collapse ~90% boilerplate in a 3,971-line config file into deep-module factories. Target 50–60% line reduction with zero behaviour change. Cross-checked against `tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv` (108 entries) and the seven CI gates that consume `ACTION_REGISTRY`.

---

## Table of contents

1. Executor notes
2. Model-collapse check
3. Architecture notes
4. Pre-refactor inventory
5. Stepwise implementation plan
6. Per-chunk detail (Chunks 1–12)
7. Risk-tier audit step
8. UX considerations
9. Risks and mitigations
10. Expected line-count delta
11. Factory-coverage check
12. Deferred items
13. Self-consistency pass
14. Open questions

---

## 1. Executor notes

Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.

Per-chunk verification commands are limited to: `npm run lint`, `npm run typecheck` (or `npx tsc --noEmit`), `npm run build:server` when relevant, and targeted `npx vitest run <path>` for tests authored in the chunk. The diff-test gate authored in Chunk 1 is the correctness oracle for every later chunk and is invoked as a single-script `npx tsx scripts/diff-action-registry.ts` — a targeted invocation, not a broad suite run.

## 2. Model-collapse check

- Does this feature decompose into ingest → extract → transform → render? **No.** This is a code refactor of a config file, not a runtime pipeline. There are no model calls at any stage.
- Could a frontier multimodal model do this in a single call? **N/A.** The output is deterministic source code that must be byte-equivalent at runtime to the input. A model call has no role in the runtime path.

Decision: not applicable. The work is mechanical text transformation (config-data deduplication via factory functions) with the diff-test gate as the correctness oracle.

## 3. Architecture notes

### 3.1 Problem

`server/config/actionRegistry.ts` is 3,971 lines for ~118 action entries. The mean entry is ~30 source lines but only ~3–8 lines are unique to the action — the rest is mechanically derivable scaffolding (`actionType` always equals the slug; `actionCategory` defaults to `'worker'` for internal and `'api'` for external; `mcp.annotations` are derivable from `readOnlyHint`/`isExternal`; retry policies fall into 3 buckets; `idempotencyStrategy` is derivable from read/write class; the per-entry `verifyNullJustification` strings repeat with one swapped action-noun).

### 3.2 Pattern selected — deep-module factories

A handful of named factory functions (`defineCanonicalRead`, `defineInternalRead`, `defineExternalRead`, `defineInternalStateWrite`, `defineExternalWrite`, `defineCustomerMessagingWrite`, `defineConfigWrite`, `defineSpendWrite`, `defineMethodologySkill`) take only the per-action fields and fill in defaults. Each factory has a single sharp responsibility — not a swiss-army builder — so two patterns that diverge by one boolean stay as two factories with a shared internal helper.

**Public interface** of each factory: a small named-arg signature (`slug`, `description`, `topics`, `riskTier`, `payloadFields`, `parameterSchema`, optional overrides specific to the bucket).

**Hidden behind the interface**: retry-policy defaults, MCP annotation derivation, idempotency-strategy derivation, justification-string templating, `as const` widening, the trailing IIFE's interaction surface (the factory deliberately does NOT pre-populate `verify` / `verifyNullJustification` for the read-only / methodology / internal-config buckets — the existing `applyRuntimeCheckCoverageDefaults` IIFE in the registry assembly handles those, and the factory leaves the fields `undefined` so the IIFE matches behaviour exactly).

### 3.3 Pattern selected — directory split with re-export shim

After factoring, the registry is still ~1,700 lines. Per the brief's >1,500-line trigger, the file splits into `server/config/actionRegistry/{types,factories,index,<domain modules>}.ts`. The original path `server/config/actionRegistry.ts` becomes a one-line re-export shim so all 27 source-tree imports continue to resolve unchanged.

**Public interface** of `index.ts`: every existing export of the original file (`ACTION_REGISTRY`, `ActionDefinition`, `RetryPolicy`, `McpAnnotations`, `ParameterSchema`, `IdempotencyStrategy`, `IdempotencyContract`, `REQUIRED_INTEGRATION_SLUGS`, `RequiredIntegrationSlug`, `SPEND_ACTION_ALLOWED_SLUGS`, `ACTION_SLUG_ALIASES`, `resolveActionSlug`, `getActionDefinition`, `__resetActionSlugAliasLogOnceForTests`, `UNIVERSAL_SKILL_NAMES`, `getUniversalSkillNames`, `VALID_ACTION_STATUSES`, `ActionStatus`, `LEGAL_TRANSITIONS`).

**Hidden behind the interface**: the per-domain module structure, the order in which entries are merged into `ACTION_REGISTRY`, the `applyRuntimeCheckCoverageDefaults` IIFE, the use of factories vs. direct-object literals, and which entries fall into which bucket.

### 3.4 Patterns considered and rejected

- **Single mega-factory with discriminated-union input.** Rejected: violates single-responsibility; the union shape would be larger than the sum of small factory signatures and would push complexity into call sites.
- **Build-time codegen from a YAML/JSON manifest.** Rejected: no upstream demand; the factories already collapse the boilerplate without introducing a build step or losing TypeScript inference at edit time.
- **Spread-only pattern (`{ ...defineX({...}) }`).** Rejected: spreads erase the literal text of `idempotencyStrategy:` / `parameterSchema:` / `readPath:` from each call site, breaking the existing awk-text-counting CI gates. We instead update the gates to operate on the runtime registry (Chunk 2) and use direct factory-call assignment (`'support.list_open_tickets': defineCanonicalRead({...})`).

### 3.5 Why update the gates rather than preserve their text shape

`verify-action-registry-zod.sh`, `verify-idempotency-strategy-declared.sh`, and `verify-skill-read-paths.sh` use awk/grep to count text occurrences inside the registry source. Each script's own NOTE comment admits the text-counting approach is fragile (idempotency gate's NOTE: "if an entry is ever reformatted as `some_action:\n    {` the count will under-report and the gate may pass a missing field"). The runtime-check-coverage gate (`verify-runtime-check-coverage.mjs`) already operates against the compiled runtime registry — the right pattern. Chunk 2 brings the other three gates onto the same runtime-based check, which is strictly more robust than awk text-counting and removes the fragility for all future registry refactors.

This is also a pre-existing issue: on the current branch the support-desk-canonical merge introduced 10 dotted `support.*` slugs whose `readPath:` lines are NOT covered by the calibration constant of 8 in `verify-skill-read-paths.sh`. The gate is misaligned by 9 today — the refactor handles it as part of the same chunk.

### 3.6 Hard invariants (cross-checked vs the brief and the CSV)

1. Every action retains its existing `riskTier` exactly. Chunk 12 runs a one-shot script that diffs `Object.entries(ACTION_REGISTRY).map(([k, v]) => [k, v.riskTier])` against `tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv`.
2. Every `verifyNullJustification` and inline `verify` shape stays identical. Diff-test gate (Chunk 1) verifies via deep-equality.
3. The "20-most-used external skills carry concrete `verify` shapes inline" rule is preserved — we observed only 4 inline `verify: { ... }` shapes in the current source (all stripe/agentic-commerce). The "20-most-used" comment refers to the seed-list in `tasks/builds/trust-verification-layer/runtime-check-coverage-list.md`, not the count of inline shapes; the current 4 stay inline through `defineSpendWrite`'s `verify` override.
4. Every CI gate that consumes `ACTION_REGISTRY` still passes. Confirmed gate set: `verify-risk-tier-assigned.{ts,sh}`, `gates/verify-runtime-check-coverage.mjs`, `verify-action-call-allowlist.sh` (the brief's `.ts` mention was incorrect — file is `.sh`), `verify-action-registry-zod.sh`, `verify-skill-read-paths.sh`, `verify-idempotency-strategy-declared.sh`, `verify-agent-skill-contracts.ts`. Chunk 2 hardens the three text-based gates; the others are runtime-based and unaffected.
5. No public API changes. `ACTION_REGISTRY` shape and `ActionDefinition` interface stay exported as-is from the same import paths via the re-export shim.
6. `verify-runtime-check-coverage.mjs` operates on the compiled runtime registry — the diff-test approach (deep-equality of pre vs post `ACTION_REGISTRY`) is the correctness oracle for every chunk.

## 4. Pre-refactor inventory

### 4.1 Domain section map (existing file)

| Section delimiter (line) | Approx entries | Target factory |
|---|---|---|
| Capability discovery (217) | 4 | `defineInternalRead` (3 read), `defineInternalStateWrite` (1) |
| Email + tasks + records + scrape + approval (351) | 14 | `defineCustomerMessagingWrite`, `defineExternalRead`, `defineInternalStateWrite`, `defineExternalWrite` |
| BA spec submission (844) | 1 | `defineInternalStateWrite` |
| Dev/QA reads (875) | 4 | `defineInternalRead`, `defineExternalRead` |
| Dev/QA devops (1012) | 4 | `defineInternalStateWrite` (review-gated dev variant), direct (`run_command`, `write_patch`) |
| Workflow orchestration (1094) | 1 | `defineInternalStateWrite` |
| Page management (1121) | 3 | `defineInternalStateWrite` (review-gated, all `riskTier: 3`) |
| Cross-subaccount intelligence (1218) | 9 | `defineInternalRead` (mostly canonical) |
| Universal skills (1420) | 2 | `defineInternalRead` |
| Real-time clarification routing (1446) | 3 | `defineInternalRead`, `defineInternalStateWrite` |
| Support agent stub (1539) | 1 | `defineInternalRead` |
| Social media (1567) | 2 | `defineCustomerMessagingWrite`, `defineExternalRead` |
| Ads management (1632) | 5 | `defineExternalRead`, `defineCustomerMessagingWrite` (4 of 5 land messaging or material spend) |
| Email outreach (1798) | 2 | direct (`enrich_contact` is read-with-write-back), `defineExternalWrite` |
| Finance (1859) | 4 | `defineInternalRead`, `defineCustomerMessagingWrite` (`update_financial_record`) |
| Content/SEO + reporting (1949) | 3 | `defineInternalStateWrite`, `defineCustomerMessagingWrite` (`deliver_report`) |
| Onboarding (2016) | 1 | `defineInternalStateWrite` |
| CRM/pipeline stub (2046) | 1 | `defineInternalRead` |
| Canonical data dictionary (2075) | 1 | `defineInternalRead` |
| Knowledge management (2102) | 4 | `defineInternalRead`, `defineInternalStateWrite` |
| Priority feed (2194) | 1 | direct (read-shaped slug + minor write semantics) |
| Memory search (2225) | 1 | `defineInternalRead` |
| Methodology skills (2256) | 30 | `defineMethodologySkill` (already collapsed via `Object.fromEntries`) |
| Configuration assistant (2310) | 16 | `defineConfigWrite` |
| Phase G portal/email skills (2760) | 0 (header only) | n/a |
| Memory & briefings weekly digest (2764, 2785) | 3 | `defineInternalRead`, `defineCustomerMessagingWrite` |
| Workflow V1 (2847) | 1 | direct (dotted slug `workflow.run.start`) |
| ClientPulse intervention (2902) | 6 | `defineCustomerMessagingWrite` (4 of 6), direct (`config_update_organisation_config`, `notify_operator`) |
| Universal brief (3119) | 2 | `defineInternalRead` |
| Cached context (3207) | 2 | direct (`cached_context_budget_breach` has unique `defaultGateLevel: 'block'`) |
| Thread context (3249) | 2 | `defineInternalStateWrite` |
| Agentic commerce (3324) | 5 | `defineSpendWrite` |
| Shadow-to-live promotion (3584) | 1 | `defineInternalStateWrite` (HITL meta-action, no money) |
| Support desk (3619) | 10 | `defineCanonicalRead`, `defineInternalStateWrite`, `defineExternalWrite` |
| **Trailing module-scope** (3811–3971) | n/a | Moves to `index.ts`: IIFE, `SPEND_ACTION_ALLOWED_SLUGS`, `ACTION_SLUG_ALIASES`, `resolveActionSlug`, `__resetActionSlugAliasLogOnceForTests`, `getActionDefinition`, `UNIVERSAL_SKILL_NAMES` re-export, `getUniversalSkillNames`, `VALID_ACTION_STATUSES`, `ActionStatus`, `LEGAL_TRANSITIONS` |

### 4.2 Direct-object exceptions (no factory fits — keep direct literal)

These entries diverge enough from any factory's defaults that forcing a fit would either widen the factory signature (anti-pattern: swiss-army builder) or require a one-off override that costs more than the literal:

- `cached_context_budget_breach` — only entry with `defaultGateLevel: 'block'`.
- `workflow.run.start` — dotted slug + unique workflow-engine semantics.
- `run_command`, `write_patch` — devops-tier with `riskTier: 4`/`3` and unique `doNotRetryOn` lists.
- `compute_health_score`, `detect_anomaly`, `compute_churn_risk` — all `riskTier: 0` reads but with subtle parameterSchema variation; group under `defineInternalRead` only if signatures align cleanly during conversion. Otherwise direct.
- `update_thread_context` — `riskTier: 1` minor write with bespoke `idempotencyStrategy: 'keyed_write'` semantics.
- `enrich_contact` — external read with CRM write-back (`readPath: 'liveFetch'` + `idempotencyStrategy: 'keyed_write'` + `readOnlyHint: false`). Forces inventing an eighth factory `defineExternalReadWithWriteBack` for a single entry — keep direct.
- `promote_spending_policy_to_live` — HITL meta-action, no money movement, neither pure spend nor pure config.

The factory-coverage check in §11 confirms this list against the actual conversion outcome.

### 4.3 File inventory

**Created:**
- `server/config/actionRegistry/types.ts` — interface and type exports.
- `server/config/actionRegistry/factories.ts` — nine factory functions plus shared internal helpers.
- `server/config/actionRegistry/factories.test.ts` — Vitest unit tests for the factories.
- `server/config/actionRegistry/core.ts` — capability discovery, email/tasks/records, BA spec, dev/QA reads + devops, workflow, page management.
- `server/config/actionRegistry/intelligence.ts` — cross-subaccount, universal, clarification, support agent stub, social media.
- `server/config/actionRegistry/agents.ts` — ads, email outreach, finance, content/SEO, reporting, onboarding, CRM stub, canonical dictionary, knowledge.
- `server/config/actionRegistry/methodology.ts` — priority feed, memory search, methodology skills.
- `server/config/actionRegistry/configuration.ts` — Configuration Assistant + weekly digest.
- `server/config/actionRegistry/clientpulse.ts` — ClientPulse intervention, universal brief, cached context, thread context.
- `server/config/actionRegistry/commerce.ts` — agentic commerce + shadow-to-live promotion.
- `server/config/actionRegistry/support.ts` — support desk skills.
- `server/config/actionRegistry/index.ts` — assembly + IIFE + module-scope helpers + re-exports.
- `scripts/diff-action-registry.ts` — diff-test gate.
- `scripts/snapshots/action-registry.snapshot.json` — pre-refactor JSON snapshot for diff comparison.
- `scripts/snapshot-action-registry.ts` — one-shot generator for the snapshot file.
- `scripts/audit-action-registry-risk-tiers.ts` — CSV-vs-runtime risk-tier audit.
- `scripts/verify-action-registry-zod.ts` — runtime-loading harness invoked by the `.sh` wrapper.
- `scripts/verify-idempotency-strategy-declared.ts` — runtime-loading harness invoked by the `.sh` wrapper.
- `scripts/verify-skill-read-paths.ts` — runtime-loading harness invoked by the `.sh` wrapper.

**Modified:**
- `server/config/actionRegistry.ts` — replaced with one-line re-export shim from `./actionRegistry/index.js`.
- `scripts/verify-action-registry-zod.sh` — converted to runtime-loading TS harness wrapper.
- `scripts/verify-idempotency-strategy-declared.sh` — converted to runtime-loading TS harness wrapper.
- `scripts/verify-skill-read-paths.sh` — converted to runtime-loading TS harness wrapper. Calibration constant is removed.
- `architecture.md` — note in "Key files per domain" pointing to the new directory layout.
- `KNOWLEDGE.md` — append entry on the duplication-collapse + directory-shim pattern.

**Untouched (verified by import-graph check):** all 27 source-tree files importing from `'../config/actionRegistry.js'` or `'../../config/actionRegistry.js'`. Each resolves via the shim to the new `index.ts`. List in §4.4.

### 4.4 Import-graph check

Files that import from `server/config/actionRegistry` (verified by grep over `*.ts`):

| File | Imported names | Shim-safe? |
|---|---|---|
| `scripts/verify-risk-tier-assigned.ts` | `ACTION_REGISTRY` | yes |
| `server/actions/updateThreadContext.ts` | `ACTION_REGISTRY` | yes |
| `server/lib/workflow/actionCallAllowlist.ts` | `SPEND_ACTION_ALLOWED_SLUGS` | yes |
| `server/mcp/mcpServer.ts` | `ACTION_REGISTRY`, `ParameterSchema` | yes |
| `server/routes/clientpulseInterventions.ts` | `resolveActionSlug` | yes |
| `server/services/agentExecutionService.ts` | `SPEND_ACTION_ALLOWED_SLUGS`, `getActionDefinition` | yes |
| `server/services/actionService.ts` | `getActionDefinition`, `LEGAL_TRANSITIONS`, `ActionStatus` | yes |
| `server/services/clientPulseInterventionContextService.ts` | `getActionDefinition` | yes |
| `server/services/drilldownService.ts` | `getActionDefinition` | yes |
| `server/services/executionLayerService.ts` | `getActionDefinition` | yes |
| `server/services/flowExecutorService.ts` | `ACTION_REGISTRY` | yes |
| `server/services/integrationBlockService.ts` | `ACTION_REGISTRY`, `getActionDefinition`, `REQUIRED_INTEGRATION_SLUGS`, `RequiredIntegrationSlug` | yes |
| `server/services/middleware/critiqueGate.ts` | `getActionDefinition` | yes |
| `server/services/middleware/errorHandling.ts` | `getActionDefinition`, `RetryPolicy` | yes |
| `server/services/middleware/managerGuardPure.ts` | `ActionDefinition` (type) | yes |
| `server/services/middleware/proposeAction.ts` | `getActionDefinition` | yes |
| `server/services/middleware/topicFilterMiddleware.ts` | `ACTION_REGISTRY` | yes |
| `server/services/policyEngineService.ts` | `getActionDefinition` | yes |
| `server/services/pulseLaneClassifier.ts` | `getActionDefinition` | yes |
| `server/services/readPathResolutionPure.ts` | `ActionDefinition` (type) | yes |
| `server/services/skillExecutor.ts` | `getActionDefinition`, `resolveActionSlug` | yes |
| `server/services/skillIdempotencyKeysPure.ts` | `IdempotencyContract` (type) | yes |
| `server/services/spendSkillHandlers.ts` | `ACTION_REGISTRY` | yes |
| `server/services/workflowEngineService.ts` | `SPEND_ACTION_ALLOWED_SLUGS` | yes |
| `server/services/workflowEngineServicePure.ts` | `SPEND_ACTION_ALLOWED_SLUGS` | yes |
| `server/services/__tests__/agentExecution.smoke.test.ts` | `ACTION_REGISTRY` | yes |
| `server/services/__tests__/integrationBlockServicePure.test.ts` | `ACTION_REGISTRY` | yes |
| `server/services/__tests__/managerGuardPure.test.ts` | `ActionDefinition` (type) | yes |
| `server/services/__tests__/readPathResolutionPure.test.ts` | `ActionDefinition` (type) | yes |
| `server/config/__tests__/actionRegistry.test.ts` | `ACTION_REGISTRY` | yes (relative path resolves to shim) |

**No caller relies on insertion order or implementation detail.** Every consumer reads either the registry as a record (`Object.entries`, `Object.values`, key-lookup) or specific exported helper functions. The directory split with shim is safe.

### 4.5 Pre-existing violation flagged for fix in Chunk 2

`scripts/verify-skill-read-paths.sh` has a calibration constant of 8 that enumerates 8 specific exclusions (interface line, methodology template, 5 `crm.*` dotted-slug actionTypes, 1 `workflow.run.start`). Since the support-desk-canonical merge, the file additionally contains 10 `support.*` dotted-slug actionTypes. Their `readPath:` lines count toward `RAW_READ_PATH` but not toward `ACTION_COUNT` (because the `actionType: '[a-z_]+'` regex excludes dots), so the gate is misaligned by 9 today.

Fix as part of Chunk 2's runtime-loading rewrite (the calibration constant disappears entirely when the gate enumerates `Object.keys(ACTION_REGISTRY)` and checks `def.readPath !== undefined` per key).

## 5. Stepwise implementation plan

Twelve chunks. Forward-only dependencies. Every chunk runs the diff-test gate from Chunk 1 at the end (except Chunks 1 and 2, which establish the gate and prepare the gate-loader).

| # | Chunk | Public interface added/changed | Hidden behind it | Dep |
|---|---|---|---|---|
| 1 | Snapshot + diff harness | `scripts/diff-action-registry.ts` (one-shot CLI) | Snapshot loader, deep-equality walker, missing/added/changed-key reporting | none |
| 2 | Text-gate hardening | None (gates remain on disk; behaviour preserved + bug fixed) | awk → runtime-registry comparison; calibration constant removed | none |
| 3 | Types extraction | `server/config/actionRegistry/types.ts` exports | none — pure type re-export | none |
| 4 | Factories module | Nine `defineX` functions + factories.test.ts | Retry-default tables, MCP annotation derivation, justification templating | 3 |
| 5 | Core domain conversion | Factory-call rewrite of capability discovery, email/tasks/records, dev/QA, workflow, page management entries | Per-entry retry-policy choices; `isExternal`/`readPath` derivations | 1, 4 |
| 6 | Intelligence domain conversion | Factory-call rewrite of cross-subaccount, universal, clarification, support stub, social media | Per-entry topic and risk-tier choices | 1, 4 |
| 7 | Agents domain conversion | Factory-call rewrite of ads, outreach, finance, content/SEO, reporting, onboarding, CRM stub, canonical dictionary, knowledge | Per-entry retry shapes; `defineCustomerMessagingWrite` action-noun selection | 1, 4 |
| 8 | Methodology + small-domain conversion | Factory-call rewrite of priority feed + memory search; methodology block driven by `defineMethodologySkill` | The `Object.fromEntries` bridge over the methodology tuple list | 1, 4 |
| 9 | Configuration domain conversion | Factory-call rewrite of 16 Configuration Assistant entries + weekly digest | Per-entry `riskTier: 2 vs 3` selection | 1, 4 |
| 10 | ClientPulse + cached context + thread context conversion | Factory-call rewrite of ClientPulse intervention + universal brief + cached context + thread context | Direct-object exceptions for `cached_context_budget_breach`, `notify_operator`, `config_update_organisation_config` | 1, 4 |
| 11 | Commerce + support desk conversion | Factory-call rewrite of 5 spend skills + shadow-to-live + 10 support desk entries | Per-spend `executionPath` and `verify` override; mixed factory choice across support desk | 1, 4 |
| 12 | Index assembly + shim + risk-tier audit + doc-sync | New `server/config/actionRegistry/{index,core,intelligence,agents,methodology,configuration,clientpulse,commerce,support}.ts`; rewritten `actionRegistry.ts` shim; risk-tier audit script; architecture.md + KNOWLEDGE.md updates | IIFE invocation point, slug aliases, status enums, `LEGAL_TRANSITIONS` | 5–11 |

**Chunks 5–11 conversion pattern.** Each domain chunk converts entries to factory calls **inside the existing `actionRegistry.ts` file**. The diff-test gate runs after each chunk and must return 0. Physical relocation of the now-collapsed entries into per-domain modules happens in Chunk 12 as a single file move — a pure shuffle with no semantic change. This keeps the runtime registry green at every commit and makes each chunk independently revertible.

## 6. Per-chunk detail

### 6.1 Chunk 1 — Snapshot + diff harness

**Spec sections covered.** §3.6 invariants 1, 2, 5, 6 (correctness oracle); brief §7 (diff-test).

**Scope.** Capture pre-refactor `ACTION_REGISTRY` runtime state and ship a one-shot diff script that compares any candidate registry against the snapshot. Establishes the correctness oracle for every later chunk.

**Module shape.**
- *Public interface this chunk exposes:* `npx tsx scripts/diff-action-registry.ts` — exits 0 on byte-equivalent match, 1 with a key-by-key diff on mismatch.
- *What stays hidden behind it:* JSON snapshot loader, deterministic registry serialiser (Zod schemas serialise via `_def.shape()` walk — see Contracts), deep-equality walker, missing/added/changed-key reporter.

**Files to create.**
- `scripts/snapshots/action-registry.snapshot.json` — generated from current branch `ACTION_REGISTRY`. Keys ordered alphabetically; Zod schemas serialised by walking `_def` shape.
- `scripts/diff-action-registry.ts` — CLI: loads `dist/server/config/actionRegistry.js`, serialises, compares against snapshot.
- `scripts/snapshot-action-registry.ts` — one-shot generator: writes the snapshot file. Run once at the start of Chunk 1.

**Contracts.**
- Snapshot format: `{ version: 1, capturedAt: ISO, entries: Record<slug, SerialisedEntry> }` where `SerialisedEntry` is the full `ActionDefinition` minus the `parameterSchema` field, plus `parameterSchemaShape: Record<string, ZodFieldShape>` capturing field-level shape (`{ type, optional, describe, enum, items, default, min, max, length }`).
- Diff output: list of `{ slug, field, expected, actual }` tuples for every mismatch.

**Error handling.**
- If `dist/server/config/actionRegistry.js` is missing, fail fast with the message "run `npm run build:server` first" — mirrors `verify-runtime-check-coverage.mjs`.
- If snapshot file is missing, exit 2 with "run snapshot-action-registry.ts to capture baseline."
- Mismatches → exit 1 with structured stderr output.

**Test considerations.**
- Run the script against the unmodified registry pre-refactor: expect exit 0.
- Mutate one byte locally (flip a riskTier on one entry) and confirm the diff reports it precisely (manual smoke; not committed).
- Confirm the Zod-shape walker survives all four MCP-style schemas in the registry (object-with-nested-object as in `send_email`, array-of-enum as in `read_analytics`, record-of-unknown as in `update_record.fields`, optional-with-default as in `scrape_url.output_format`).

**Dependencies.** None — first chunk.

**Acceptance criteria.**
- `scripts/snapshots/action-registry.snapshot.json` committed.
- `npx tsx scripts/diff-action-registry.ts` returns 0 against the unmodified registry.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx tsx scripts/snapshot-action-registry.ts` (one-shot, captures baseline)
- `npx tsx scripts/diff-action-registry.ts` (one-shot, validates self-consistency)

**Definition of done.** Snapshot file committed; diff script returns 0 against current source; snapshot-generator script committed (will not be re-run after Chunk 1 unless a behaviour change is intentional, in which case the change must update the CSV and the snapshot in the same commit).

---

### 6.2 Chunk 2 — Text-gate hardening (pre-Phase-2 blocker)

**Spec sections covered.** §3.5 (gate hardening rationale); §3.6 invariant 4 (every gate must still pass); §4.5 (pre-existing violation fix).

**Scope.** Replace the awk/grep counting in three text-based gates with TypeScript harnesses that load the runtime registry and check the same invariants more robustly. Also fixes the pre-existing calibration-constant misalignment in `verify-skill-read-paths.sh`.

**Why this comes before any entry conversion.** The current text gates assume entries have the literal shape `^  slug: \{$` followed by inline `parameterSchema:` / `idempotencyStrategy:` / `readPath:` text within the entry body. The factory pattern (`'slug': defineCanonicalRead({...})`) breaks all three text shapes. Converting the gates first means the registry can stay green through every later chunk.

**Module shape.**
- *Public interface this chunk exposes:* the three `.sh` wrappers retain identical CLI behaviour (exit 0/1, header/summary output via `guard-utils.sh`). Adds three new TypeScript harnesses: `scripts/verify-action-registry-zod.ts`, `scripts/verify-idempotency-strategy-declared.ts`, `scripts/verify-skill-read-paths.ts`.
- *What stays hidden behind it:* registry-loading via `dist/server/config/actionRegistry.js`, Zod-instance check (`def.parameterSchema instanceof z.ZodObject`), `liveFetchRationale` non-empty validation, the `RuntimeCheckKind` field traversal.

**Files to modify.**
- `scripts/verify-action-registry-zod.sh` — replace awk body with `npx tsx "$ROOT_DIR/scripts/verify-action-registry-zod.ts"`. Keep `emit_header`, `emit_summary`, `check_baseline` for guard-utils integration.
- `scripts/verify-idempotency-strategy-declared.sh` — same wrapper-only conversion.
- `scripts/verify-skill-read-paths.sh` — same wrapper-only conversion. Calibration constant removed.

**Files to create.**
- `scripts/verify-action-registry-zod.ts` — for every `[slug, def] of Object.entries(ACTION_REGISTRY)`: assert `def.parameterSchema instanceof z.ZodObject`. Exit 1 if any fail. Mirror message shape of original.
- `scripts/verify-idempotency-strategy-declared.ts` — for every entry: assert `def.idempotencyStrategy` is one of `read_only | keyed_write | locked | state_based`. List violators on failure.
- `scripts/verify-skill-read-paths.ts` — for every entry: assert `def.readPath` is one of `canonical | liveFetch | none`; if `liveFetch`, assert `def.liveFetchRationale` is a non-empty string. List violators on failure.

**Contracts.**
- Each harness exits 0 on green, 1 on violation, with a structured stderr listing every violator's slug and the missing/invalid field.
- The `.sh` wrappers preserve the existing `[GUARD]` and `emit_violation` output formats so the CI baseline-allow logic continues to work.

**Error handling.**
- Missing `dist/`: exit with "run `npm run build:server` first" (same pattern as `verify-runtime-check-coverage.mjs`).
- Each harness exits with a non-zero code matching the original gate's contract.

**Test considerations.**
- Run each harness against the unmodified `dist/`: expect exit 0.
- Locally flip one entry's `idempotencyStrategy` to `undefined` (in a throwaway diff): confirm the harness exits 1 with the expected slug listed (manual smoke; not committed).
- Confirm `verify-skill-read-paths.ts` reports the 9 currently-uncalibrated `support.*` slugs as covered (because they all have valid `readPath`), so the post-fix gate is green where the pre-fix gate is silently broken.

**Dependencies.** None.

**Acceptance criteria.**
- All three `.sh` wrappers exit 0 on the unmodified branch.
- The `.sh` wrappers preserve the `emit_header` / `emit_violation` / `emit_summary` calls so the CI baseline machinery continues to function.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx tsx scripts/verify-action-registry-zod.ts`
- `npx tsx scripts/verify-idempotency-strategy-declared.ts`
- `npx tsx scripts/verify-skill-read-paths.ts`

**Definition of done.** Three `.sh` wrappers each exit 0 against the current branch; three `.ts` harnesses committed; `verify-skill-read-paths.sh` no longer carries a calibration constant.

---

### 6.3 Chunk 3 — Types extraction

**Spec sections covered.** §3.3 (directory split); §4.3 (file inventory).

**Scope.** Move the type and interface declarations out of `actionRegistry.ts` into a leaf module. No factory logic, no entry data, no IIFE.

**Module shape.**
- *Public interface this chunk exposes:* `server/config/actionRegistry/types.ts` exports: `ActionDefinition`, `RetryPolicy`, `McpAnnotations`, `ParameterSchema`, `IdempotencyStrategy`, `IdempotencyContract`, `REQUIRED_INTEGRATION_SLUGS`, `RequiredIntegrationSlug`.
- *What stays hidden behind it:* nothing — types are intentionally a leaf module. The shallow shape is correct for a pure type-export file (per the architecture convention of `server/db/schema/**` leaves: schema files import only from drizzle-orm, shared/types, and other schema files).

**Files to create.**
- `server/config/actionRegistry/types.ts` — copies lines 1–214 of the existing file verbatim (the imports of `RuntimeCheckKind` / `RuntimeCheckBlastRadius` / `SupportProposedActionsSchema` / `RiskTier`, the interfaces, the `REQUIRED_INTEGRATION_SLUGS` const, the `IdempotencyStrategy` and `RequiredIntegrationSlug` type aliases). The `@principal-context-import-only` comment header is preserved at the top of `types.ts`.

**Files to modify.**
- `server/config/actionRegistry.ts` — replace lines 1–214 with `export * from './actionRegistry/types.js';` plus a back-compat note (`// Types now live in ./actionRegistry/types.ts — this re-export is retained until the directory shim lands in Chunk 12.`). Lines 215–end are untouched.

**Contracts.** No new contracts. Existing types are re-exported at the same paths via `export *`.

**Error handling.** N/A — type-only.

**Test considerations.**
- `npm run typecheck` is the entire test surface for this chunk. Every consumer of `ActionDefinition`, `RetryPolicy`, etc. continues to compile.
- The `actionRegistry.test.ts` Vitest file imports `ACTION_REGISTRY` only — types come transitively. Should remain green.

**Dependencies.** None (sequence-wise after Chunk 2 to avoid gate noise during the type move).

**Acceptance criteria.**
- `npm run typecheck` clean.
- `scripts/diff-action-registry.ts` returns 0 (this chunk does not touch runtime values).

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx tsx scripts/diff-action-registry.ts`

**Definition of done.** `types.ts` exists and is imported via `export *` from the original file. Diff-test green.

---

### 6.4 Chunk 4 — Factories module

**Spec sections covered.** §3.2 (factory pattern); §4.2 (direct-object exceptions defined by what the factories cover).

**Scope.** Author the nine factory functions and their unit tests. No registry entries are converted in this chunk.

**Module shape.**
- *Public interface this chunk exposes:*
  - `defineCanonicalRead({ slug, description, topics?, riskTier, payloadFields, parameterSchema, retryPolicy?, requiredIntegration? }): ActionDefinition`
  - `defineInternalRead({ slug, description, topics?, readPath: 'canonical' | 'none', riskTier, payloadFields, parameterSchema, retryPolicy?, isUniversal? }): ActionDefinition`
  - `defineExternalRead({ slug, description, topics?, riskTier, payloadFields, parameterSchema, liveFetchRationale, retryPolicy?, requiredIntegration? }): ActionDefinition`
  - `defineInternalStateWrite({ slug, description, topics?, riskTier, defaultGateLevel?, payloadFields, parameterSchema, retryPolicy?, idempotencyStrategy?: 'keyed_write' | 'state_based', mcp?, createsBoardTask?, requiresCritiqueGate? }): ActionDefinition`
  - `defineExternalWrite({ slug, description, topics?, riskTier, defaultGateLevel?, payloadFields, parameterSchema, retryPolicy?, idempotencyStrategy?: 'keyed_write' | 'locked', mcp?, requiredIntegration?, integrationNotResumable?, createsBoardTask?, requiresCritiqueGate? }): ActionDefinition`
  - `defineCustomerMessagingWrite({ slug, description, topics, actionCategory?: 'api' | 'worker', verifyActionNoun, payloadFields, parameterSchema, retryPolicy?, mcp?, requiredIntegration?, idempotencyStrategy?: 'keyed_write' | 'locked' }): ActionDefinition`
  - `defineConfigWrite({ slug, description, parameterSchema, riskTier?: 2 | 3, mcp?: McpAnnotations }): ActionDefinition`
  - `defineSpendWrite({ slug, description, payloadFields, parameterSchema, executionPath, verify?: RuntimeCheckKind | null, verifyActionNoun? }): ActionDefinition`
  - `defineMethodologySkill({ slug, description, topics }): ActionDefinition`
- *What stays hidden behind it:* default retry-policy tables (`RETRY_NONE`, `RETRY_FIXED_DB`, `RETRY_BACKOFF_NETWORK`, etc.), the MCP-annotation derivation rule (read-only → `{ readOnlyHint: true, idempotentHint: true, openWorldHint: <isExternal>, destructiveHint: false }`; write → bucket-specific defaults overridable per call), `verifyNullJustification` templating (`Review-gated ${verifyActionNoun}: HITL approval is the verification boundary; actionService wrapper has no comparable post-check shape`), the `as const` widening avoidance, and the bucket-specific defaults (`actionCategory`, `defaultGateLevel`, `riskTier` defaults where applicable, `idempotencyStrategy`, `directExternalSideEffect`, `requiredIntegration`, `spendsMoney`).

**Files to create.**
- `server/config/actionRegistry/factories.ts` — the nine factories plus shared internal helpers (private `createRetry`, `createMcpRead`, `createMcpWrite`, `templateVerifyNullJustification`).
- `server/config/actionRegistry/factories.test.ts` — Vitest unit tests:
  - `defineCanonicalRead` produces the expected default fields when called with minimal args (smoke).
  - `defineCustomerMessagingWrite` produces the exact `verifyNullJustification` string for each known action-noun (parameterised over the action-noun list observed in the source).
  - `defineSpendWrite` injects `verify: { kind: 'external_returns', provider: 'stripe', expectedField: 'id' }` by default and respects an explicit override.
  - `defineConfigWrite` accepts `riskTier: 2` and `riskTier: 3` and produces the expected retry policy.
  - `defineMethodologySkill` produces an entry where `isMethodology === true` and `parameterSchema` is the empty `z.object({})`.

**Contracts.** Each factory returns a fully-typed `ActionDefinition`. The factory NEVER pre-populates `verify` or `verifyNullJustification` for the read-only/methodology/internal-write buckets — those defaults are added by the trailing IIFE in `index.ts`. The factory DOES pre-populate them for `defineCustomerMessagingWrite` and `defineSpendWrite` because those entries carry inline justifications in the current source and the brief mandates preserving them.

**Error handling.** Factories are pure synchronous functions. Invalid inputs (e.g. `riskTier: 9`) fail at TypeScript compile time via the `RiskTier` type from `shared/types/riskTier.ts`.

**Test considerations.**
- Each factory's defaults exactly match a representative entry from the existing source. The diff-test gate (Chunk 1) is the runtime oracle; the unit tests in `factories.test.ts` are an authoring-time assertion that catches regressions before the diff-test runs.
- The `factories.test.ts` file is allowed per CLAUDE.md "targeted execution of unit tests authored within this plan." Run via `npx vitest run server/config/actionRegistry/factories.test.ts`.

**Dependencies.** Chunk 3 (types).

**Acceptance criteria.**
- `npm run typecheck` clean.
- `npx vitest run server/config/actionRegistry/factories.test.ts` passes.
- `scripts/diff-action-registry.ts` returns 0 (no entries converted yet — registry runtime unchanged).

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/config/actionRegistry/factories.test.ts`
- `npx tsx scripts/diff-action-registry.ts`

**Definition of done.** `factories.ts` and `factories.test.ts` committed; tests green; diff-test still 0; no entries converted yet.

---

### 6.5 Chunk 5 — Core domain conversion

**Spec sections covered.** §4.1 first six rows of the domain section map (capability discovery through page management); §3.6 invariants 1, 2 (riskTier and verify shapes preserved).

**Scope.** Convert the entries in lines 217–1217 to factory calls inside the existing `actionRegistry.ts` file. Approximately 22 entries: capability discovery (4), email/tasks/records/scrape/approval (14), BA spec (1), dev/QA reads (4), dev/QA devops (4), workflow orchestration (1), page management (3). Direct-object exceptions in this range: `run_command`, `write_patch`.

**Module shape.**
- *Public interface this chunk exposes:* none yet — the file is still a single monolith. Public exports unchanged.
- *What stays hidden behind it:* per-entry choice of factory (e.g. `send_email` → `defineCustomerMessagingWrite` with `verifyActionNoun: 'send'`; `read_inbox` → `defineExternalRead`; `create_task` → `defineInternalStateWrite`); per-entry retry policy and MCP annotation reuse.

**Files to modify.**
- `server/config/actionRegistry.ts` — for each entry in the line range, replace the direct-object literal with the equivalent factory call (`'create_task': defineInternalStateWrite({ slug: 'create_task', description: '...', topics: ['task'], riskTier: 2, payloadFields: [...], parameterSchema: z.object({...}) })`). Direct-object exceptions stay verbatim.

**Contracts.** No new public contracts. Each factory call produces the exact `ActionDefinition` shape that existed before — verified by diff-test.

**Error handling.** Factory call sites that mismatch the existing entry shape are caught by diff-test, not by typecheck (the type system accepts any valid `ActionDefinition` shape).

**Test considerations.**
- Convert in groups of 4–6 entries with a diff-test run between groups. If diff-test fails, the failing entry's diff is small enough to read.
- The Vitest `actionRegistry.test.ts` per-entry assertions (parameterSchema is z.ZodObject, defaultGateLevel valid, idempotencyStrategy valid, retryPolicy valid, runtime-check coverage) must continue to pass.

**Dependencies.** Chunks 1, 4.

**Acceptance criteria.**
- All entries in the section delimiter range 217–1217 either use a factory or are documented direct-object exceptions.
- `scripts/diff-action-registry.ts` returns 0.
- Net line count for this section drops by ~50%.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npx vitest run server/config/actionRegistry/factories.test.ts`
- `npx vitest run server/config/__tests__/actionRegistry.test.ts`
- `npx tsx scripts/diff-action-registry.ts`

**Definition of done.** Diff-test green; converted entries use factories or are documented exceptions; original section delimiter comments preserved.

---

### 6.6 Chunk 6 — Intelligence domain conversion

**Spec sections covered.** §4.1 rows for cross-subaccount intelligence through social media (lines 1218–1631).

**Scope.** Convert ~17 entries: cross-subaccount intelligence (9), universal skills (2), real-time clarification routing (3), support agent stub (1), social media (2). Direct-object candidates: `compute_health_score`, `detect_anomaly`, `compute_churn_risk` if their parameterSchema variations don't fit cleanly into `defineInternalRead`.

**Module shape.**
- *Public interface this chunk exposes:* none new (entries still in the monolith).
- *What stays hidden behind it:* the per-entry topic and risk-tier selection; the `isUniversal: true` propagation through `defineInternalRead`.

**Files to modify.** `server/config/actionRegistry.ts` (entries in line range 1218–1631).

**Contracts.** No new public contracts.

**Test considerations.**
- `publish_post` is `defineCustomerMessagingWrite` with `verifyActionNoun: 'social-post publish'` (matches existing inline justification).
- `read_analytics` is `defineExternalRead` with `liveFetchRationale` from the original.

**Dependencies.** Chunks 1, 4.

**Acceptance criteria.** Diff-test green; line-count drop ≥40% for this section.

**Verification commands.** Same as Chunk 5.

**Definition of done.** Diff-test green; converted entries use factories or are documented direct-object exceptions.

---

### 6.7 Chunk 7 — Agents domain conversion

**Spec sections covered.** §4.1 rows for ads through knowledge management (lines 1632–2193).

**Scope.** Convert ~25 entries: ads management (5), email outreach (2), finance (4), content/SEO + reporting (3), onboarding (1), CRM/pipeline stub (1), canonical dictionary (1), knowledge management (4) — plus a few overflow from neighbouring sections. Direct-object candidates: `enrich_contact` (read with write-back).

**Module shape.**
- *Public interface this chunk exposes:* none new.
- *What stays hidden behind it:* `defineCustomerMessagingWrite` action-noun selection (`update_bid` → 'paid-ads bid update'; `update_copy` → 'paid-ads copy update'; `pause_campaign` → 'paid-ads campaign pause'; `increase_budget` → 'paid-ads budget increase'; `update_financial_record` → 'financial record update'; `deliver_report` → 'client report delivery'). Each must reproduce the original inline justification verbatim — the factory's templating handles this.

**Files to modify.** `server/config/actionRegistry.ts` (entries in line range 1632–2193).

**Test considerations.**
- The CSV pins ads management at `riskTier: 5` (for `update_bid`, `update_copy`, `pause_campaign`) and `riskTier: 6` (for `increase_budget`). Both must pass through `defineCustomerMessagingWrite` correctly. The `defineCustomerMessagingWrite` factory accepts `riskTier` as a parameter rather than defaulting to 6 — confirmed during factory design (Chunk 4).

**Dependencies.** Chunks 1, 4.

**Acceptance criteria.** Diff-test green; line-count drop ≥45%.

**Verification commands.** Same as Chunk 5.

**Definition of done.** Diff-test green; converted entries use factories or are documented direct-object exceptions.

---

### 6.8 Chunk 8 — Methodology + small-domain conversion

**Spec sections covered.** §4.1 rows for priority feed, memory search, methodology skills (lines 2194–2308).

**Scope.** Convert priority feed (1, direct), memory search (1, factory), methodology block (30 entries, factory-driven via `Object.fromEntries`).

**Module shape.**
- *Public interface this chunk exposes:* none new.
- *What stays hidden behind it:* the methodology tuple-list bridge. The current source uses `Object.fromEntries(([['draft_architecture_plan', '...desc...', ['dev']], ...] as [string, string, string[]][]).map(([name, desc, topics]) => [name, { actionType: name, ... }]))`. The new version uses the same bridge but the inner mapper is `defineMethodologySkill({ slug: name, description: desc, topics })` — strictly cleaner, byte-equivalent runtime.

**Files to modify.** `server/config/actionRegistry.ts` (entries in line range 2194–2308).

**Test considerations.**
- The methodology factory test in Chunk 4 confirms `parameterSchema` is the empty `z.object({})` and `isMethodology: true` propagates. Diff-test confirms runtime equivalence for all 30 entries.

**Dependencies.** Chunks 1, 4.

**Acceptance criteria.** Diff-test green; methodology block reduced from ~50 lines to ~40 lines (modest gain — the block was already collapsed).

**Verification commands.** Same as Chunk 5.

**Definition of done.** Diff-test green; methodology block uses `defineMethodologySkill`.

---

### 6.9 Chunk 9 — Configuration domain conversion

**Spec sections covered.** §4.1 rows for Configuration Assistant + weekly digest (lines 2310–2899).

**Scope.** Convert 16 Configuration Assistant entries and 3 weekly-digest entries. Heavy `defineConfigWrite` use. Confirm the two `riskTier: 2` outliers (`config_set_link_instructions`, `config_update_data_source`) carry through correctly via the factory's `riskTier` arg. `config_send_workflow_email_digest` is `defineCustomerMessagingWrite`.

**Module shape.**
- *Public interface this chunk exposes:* none new.
- *What stays hidden behind it:* the per-`config_*` entry's identical retry policy (`{ maxRetries: 2, strategy: 'exponential_backoff', retryOn: ['timeout', 'network_error'], doNotRetryOn: ['validation_error', 'auth_error'] }`) is hidden in `defineConfigWrite`'s default. 16 near-identical entries collapse from ~25 lines each to ~7 lines each.

**Files to modify.** `server/config/actionRegistry.ts` (entries in line range 2310–2899).

**Test considerations.**
- `config_create_agent` carries inline `verify: null` + `verifyNullJustification` — must preserve. `defineConfigWrite` does NOT default to setting these because most config_* entries do NOT have them inline (they fall through to the IIFE's "Internal config skill" justification). `config_create_agent` is the exception and must be either passed as an override OR kept as a direct literal.

  Decision: keep `config_create_agent` as a direct literal — it's the only `config_*` entry with an inline verify-null justification. The other 15 fit `defineConfigWrite` cleanly.

**Dependencies.** Chunks 1, 4.

**Acceptance criteria.** Diff-test green; line-count drop ≥60% for this section (the biggest single win — 16 near-identical entries).

**Verification commands.** Same as Chunk 5.

**Definition of done.** Diff-test green; 15 of 16 config_* entries use `defineConfigWrite`; `config_create_agent` is documented as a direct-object exception.

---

### 6.10 Chunk 10 — ClientPulse + cached context + thread context conversion

**Spec sections covered.** §4.1 rows for ClientPulse intervention through thread context (lines 2902–3322).

**Scope.** Convert ClientPulse intervention (6 — 4 use `defineCustomerMessagingWrite`, 2 are direct), universal brief (2 reads), cached context (2 — `cached_context_budget_breach` is direct), thread context (2 internal writes, `update_thread_context` is direct).

**Module shape.**
- *Public interface this chunk exposes:* none new.
- *What stays hidden behind it:* `defineCustomerMessagingWrite`'s `actionCategory` parameter (defaults to `'api'` but `notify_operator` etc. use `'worker'` — but `notify_operator` is direct anyway). The four `crm.*` entries that DO use the factory (`crm.fire_automation`, `crm.send_email`, `crm.send_sms`, `crm.create_task`) all use `actionCategory: 'api'`.

**Files to modify.** `server/config/actionRegistry.ts` (entries in line range 2902–3322).

**Test considerations.**
- `cached_context_budget_breach`'s `defaultGateLevel: 'block'` is unique in the entire registry — only direct-literal preserves it cleanly.
- `config_update_organisation_config` and `notify_operator` are nominally similar to other configs but live in the ClientPulse cluster with `topics: ['clientpulse', ...]`. Decision: keep direct because forcing `defineConfigWrite` to accept arbitrary topics widens its signature.

**Dependencies.** Chunks 1, 4.

**Acceptance criteria.** Diff-test green; line-count drop ≥50%.

**Verification commands.** Same as Chunk 5.

**Definition of done.** Diff-test green; converted entries use factories or are documented direct-object exceptions.

---

### 6.11 Chunk 11 — Commerce + support desk conversion

**Spec sections covered.** §4.1 rows for agentic commerce + shadow-to-live + support desk (lines 3324–3811).

**Scope.** Convert agentic commerce (5 — `defineSpendWrite` with per-entry `executionPath` + `verify` override on `pay_invoice`), shadow-to-live promotion (1 internal state write — direct, HITL meta-action), support desk (10 — mix of `defineCanonicalRead`, `defineInternalStateWrite`, `defineExternalWrite`).

**Module shape.**
- *Public interface this chunk exposes:* none new.
- *What stays hidden behind it:* `defineSpendWrite`'s defaults (`riskTier: 6`, `defaultGateLevel: 'review'`, `idempotencyStrategy: 'locked'`, `directExternalSideEffect: true`, `requiredIntegration: 'stripe_agent'`, `spendsMoney: true`, `mcp.annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true, readOnlyHint: false }`, `retryPolicy: { maxRetries: 0, strategy: 'none', retryOn: [], doNotRetryOn: [] }`, `reversible: false`, `blastRadius: 'external'`, default `verify: { kind: 'external_returns', provider: 'stripe', expectedField: 'id' }`, default verifyNullJustification absent — the 4 of 5 entries with the stripe verify shape get it inline; `pay_invoice` overrides with `verify: null` + verifyActionNoun for the HITL justification template).

**Files to modify.** `server/config/actionRegistry.ts` (entries in line range 3324–3811).

**Test considerations.**
- The support desk has 10 entries split across three factories:
  - `defineCanonicalRead`: `support.list_open_tickets`, `support.read_thread`, `support.find_customer_history` (3 entries with `readPath: 'canonical'`).
  - `defineInternalStateWrite`: `support.propose_reply`, `support.add_internal_note`, `support.reject_draft` (3 entries with `idempotencyStrategy: 'state_based'`).
  - `defineExternalWrite`: `support.set_status`, `support.assign`, `support.tag` (3 entries with `isExternal: true`, `idempotencyStrategy: 'keyed_write'`, `mcp.annotations.openWorldHint: true`).
  - `defineCustomerMessagingWrite`: `support.approve_draft` (1 entry, `riskTier: 6`, customer-inbox messaging, `verifyActionNoun: 'support reply approval'` or similar).
- The `as const` casts in the existing source are removed because factories return `ActionDefinition` (no widening).

**Dependencies.** Chunks 1, 4.

**Acceptance criteria.** Diff-test green; line-count drop ≥55% for the agentic-commerce section, ≥30% for the support desk section.

**Verification commands.** Same as Chunk 5.

**Definition of done.** Diff-test green; converted entries use factories or are documented direct-object exceptions; `as const` casts removed where the factory return type covers them.

## 7. Risk-tier audit step

(Runs between Chunk 11 and Chunk 12. Not a Sonnet-builder chunk by itself — it's a one-shot script run as a gate.)

**Spec sections covered.** §3.6 invariant 1 (every action retains its existing `riskTier` exactly).

**Scope.** Verify that no entry's `riskTier` shifted during conversion.

**Files to create.**
- `scripts/audit-action-registry-risk-tiers.ts` — one-shot script: loads `dist/server/config/actionRegistry.js`, parses `tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv`, asserts `ACTION_REGISTRY[slug].riskTier === Number(csvRow.assignedRiskTier)` for every CSV row. Reports both sides of the diff (CSV-only slugs and registry-only slugs). Exits 1 with a list of mismatches if any.

**Verification commands.**
- `npm run build:server`
- `npx tsx scripts/audit-action-registry-risk-tiers.ts`

**Definition of done.** Script returns 0; every CSV-listed slug matches its registered `riskTier`; any mismatch is a refactor bug to fix before Chunk 12 begins. The script is committed as part of the run-up to Chunk 12 — it stays in the repo as a permanent assertion (CSV-vs-runtime drift detection is generally useful, not specific to this refactor).

---

### 6.12 Chunk 12 — Index assembly + shim + risk-tier doc-sync

**Spec sections covered.** §3.3 (directory split); §4.3 (file inventory); §3.6 invariant 5 (no public API changes); CLAUDE.md §11 (docs stay in sync with code).

**Scope.** Physically relocate the converted domain entries from the monolithic `actionRegistry.ts` into per-domain module files; create the `index.ts` assembly point; replace `actionRegistry.ts` with a one-line re-export shim; update doc references.

**Module shape.**
- *Public interface this chunk exposes:* the directory structure described in §4.3. The `server/config/actionRegistry.ts` shim re-exports everything from `./actionRegistry/index.js` so all 27 callers resolve unchanged. The `index.ts` is the assembly point.
- *What stays hidden behind it:* per-domain module organisation, IIFE invocation point, slug-alias logging, `getActionDefinition`/`resolveActionSlug`/`getUniversalSkillNames` implementation. Callers see only the named exports.

**Files to create.**
- `server/config/actionRegistry/core.ts` — receives entries from the original file's lines 217–1217 (now in factory form).
- `server/config/actionRegistry/intelligence.ts` — receives entries from 1218–1631.
- `server/config/actionRegistry/agents.ts` — receives entries from 1632–2193.
- `server/config/actionRegistry/methodology.ts` — receives entries from 2194–2308 (priority feed, memory search, methodology block).
- `server/config/actionRegistry/configuration.ts` — receives entries from 2310–2899.
- `server/config/actionRegistry/clientpulse.ts` — receives entries from 2902–3322.
- `server/config/actionRegistry/commerce.ts` — receives entries from 3324–3617 (agentic commerce + shadow-to-live).
- `server/config/actionRegistry/support.ts` — receives entries from 3619–3810.
- `server/config/actionRegistry/index.ts` — assembles `ACTION_REGISTRY = { ...core, ...intelligence, ...agents, ...methodology, ...configuration, ...clientpulse, ...commerce, ...support }`, runs the `applyRuntimeCheckCoverageDefaults` IIFE, defines and exports `SPEND_ACTION_ALLOWED_SLUGS`, `ACTION_SLUG_ALIASES`, `loggedAliasHits`, `resolveActionSlug`, `__resetActionSlugAliasLogOnceForTests`, `getActionDefinition`, the `UNIVERSAL_SKILL_NAMES` re-export from `./universalSkills.js` (note: `universalSkills.ts` lives at `server/config/universalSkills.ts` — the import becomes `from '../universalSkills.js'` from inside the new directory), `getUniversalSkillNames`, `VALID_ACTION_STATUSES`, `ActionStatus`, `LEGAL_TRANSITIONS`. Re-exports types via `export * from './types.js'`.

**Files to modify.**
- `server/config/actionRegistry.ts` — replaced with a single-line file: `export * from './actionRegistry/index.js';`. The leading `@principal-context-import-only` comment is preserved at the top.
- `architecture.md` — if any "Key files per domain" entry pointed at the original monolithic path, add a note that the registry now lives under `server/config/actionRegistry/`. The shim path remains valid; consumers are unchanged.
- `KNOWLEDGE.md` — append a Correction-style entry recording the duplication-collapse pattern and the directory-shim approach so future refactors of similar large-config files can reuse it.
- `docs/doc-sync.md` — verify presence; if it references `server/config/actionRegistry.ts` directly, redirect to the index. Otherwise no-op.

**Contracts.** Public exports unchanged. The directory shim is invisible to every caller.

**Error handling.** N/A — pure file relocation plus the IIFE move. Any divergence is caught by the diff-test gate and the existing `actionRegistry.test.ts` Vitest suite.

**Test considerations.**
- The diff-test gate runs at the end and MUST return 0.
- The `audit-action-registry-risk-tiers.ts` script runs at the end and MUST return 0.
- The existing Vitest `actionRegistry.test.ts` runs at the end and MUST pass — its imports use a relative path `../actionRegistry.js` which resolves to the shim, then to `index.ts`.
- Every consumer file under §4.4 still compiles (caught by `npm run typecheck`).

**Dependencies.** Chunks 1–11 + risk-tier audit.

**Acceptance criteria.**
- `npm run typecheck` clean.
- `npm run build:server` clean.
- `npm run build:client` clean.
- `scripts/diff-action-registry.ts` returns 0.
- `scripts/audit-action-registry-risk-tiers.ts` returns 0.
- `npx vitest run server/config/__tests__/actionRegistry.test.ts` passes.
- `npx vitest run server/config/actionRegistry/factories.test.ts` passes.
- `architecture.md` and `KNOWLEDGE.md` updates are in the same commit as the file move.

**Verification commands.**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server`
- `npm run build:client`
- `npx vitest run server/config/__tests__/actionRegistry.test.ts`
- `npx vitest run server/config/actionRegistry/factories.test.ts`
- `npx tsx scripts/diff-action-registry.ts`
- `npx tsx scripts/audit-action-registry-risk-tiers.ts`

**Definition of done.** All verification commands above are green. The original monolithic `actionRegistry.ts` is now a one-line shim. The directory `server/config/actionRegistry/` contains 12 files (`types.ts`, `factories.ts`, `factories.test.ts`, `index.ts`, 8 domain modules). Total source under the directory plus the shim is in the 1,500–1,800 line range (50–60% reduction from 3,971). Doc-sync entries committed.

## 8. UX considerations

None. This is a pure backend refactor of a config file; there is no UI surface. The frontend does not import from `server/config/actionRegistry`.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Trailing IIFE behaviour drift.** `applyRuntimeCheckCoverageDefaults` mutates `ACTION_REGISTRY` after construction. If a factory pre-populates `verify` or `verifyNullJustification` for an entry whose IIFE branch would have set them, the post-IIFE registry diverges. | Factories MUST NOT pre-populate `verify` or `verifyNullJustification` for read-only / methodology / internal-write buckets. Only `defineCustomerMessagingWrite` and `defineSpendWrite` set these inline (as the existing source does). Verified by diff-test on every chunk. |
| **Calibration constant in `verify-skill-read-paths.sh` is 9 short on the current branch (pre-existing).** | Chunk 2's runtime-loading rewrite removes the constant entirely. The new harness loops `Object.entries(ACTION_REGISTRY)` and checks `def.readPath` per key — calibration disappears. |
| **Insertion order of `ACTION_REGISTRY` keys.** Some consumers may iterate via `Object.entries` and rely on insertion order. | Confirmed by import-graph check that no consumer relies on insertion order — every consumer uses key-lookup, `Object.entries` for predicate filtering, or `Object.values` for set operations. The `index.ts` spread order matches the original file's section order to keep insertion order identical anyway, as defence-in-depth. The diff-test gate compares ordered keys (V8 preserves insertion order). |
| **TypeScript inference loss inside factories.** A naïve factory might widen `riskTier: 6` to `RiskTier` and break a downstream conditional that relies on the literal type. | Factories accept `riskTier: RiskTier` and return `ActionDefinition` (where `riskTier: RiskTier`). Downstream consumers already type to the interface, not the literal. No inference loss observed in spot-checks of `policyEngineService`, `agentExecutionService`, `integrationBlockService`. |
| **Methodology block uses `'none' as const` casts that the gate's calibration depends on.** | Calibration is removed in Chunk 2. The methodology factory produces entries with `readPath: 'none'` (no `as const` needed because the factory's return type is `ActionDefinition`). Diff-test confirms runtime-equivalent. |
| **Diff-test gate misses Zod schema differences.** Two `z.object({ x: z.string() })` instances are different object identities. | The diff-test serialises Zod schemas via a deterministic walk of `_def.shape()` — capturing field-level type, optionality, default, describe, enum, items, min/max/length. This is cheaper than a full structural Zod comparator and sufficient for catching every meaningful divergence. |
| **Direct-object exceptions accidentally factory-fitted.** A builder might force-fit `cached_context_budget_breach` into `defineInternalStateWrite` and silently lose the unique `defaultGateLevel: 'block'`. | The factory-coverage check in §11 enumerates every direct-object exception. Diff-test catches the runtime divergence. |
| **`runtime-check-coverage.mjs` gate runs against `dist/`, not source.** A factory bug that produces the wrong runtime registry won't be caught by typecheck. | The diff-test gate (Chunk 1) IS the runtime check. It runs against `dist/server/config/actionRegistry.js` after `npm run build:server`. Every chunk's verification includes the build step. |
| **Risk-tier CSV drift from the runtime registry.** The CSV is hand-maintained; if a registry entry was added since the CSV was last regenerated, the audit fails on a CSV-only or registry-only slug. | The audit script reports both sides of the diff. Mismatches block Chunk 12. The audit script stays in the repo as a permanent assertion — useful beyond this refactor. |
| **Customer-messaging `verifyNullJustification` strings vary by action-noun.** 16 entries each carry a slightly different justification string. | The factory's `verifyActionNoun` parameter templates the standard prefix/suffix; the diff-test verifies each entry's resulting string matches the original byte-for-byte. The factory unit test in Chunk 4 enumerates every observed action-noun and asserts the templated output. |
| **Two `config_*` entries (`config_set_link_instructions`, `config_update_data_source`) carry `riskTier: 2` not 3.** Forgetting the override would silently re-tier them. | `defineConfigWrite` accepts `riskTier` as required (no default). Diff-test and the risk-tier audit script catch any drift. |
| **`config_create_agent` carries an inline `verify: null` + verifyNullJustification.** It's the only `config_*` entry with this. | Documented as a direct-object exception in Chunk 9. The other 15 `config_*` entries fall through to the IIFE's "Internal config skill" justification cleanly. |

## 10. Expected line-count delta

| Section | Pre lines | Post lines (new directory) | Reduction |
|---|---|---|---|
| Types (lines 1–214) | 214 | 214 (`types.ts`, verbatim) | 0% |
| Capability discovery + email/tasks/records + dev/QA + workflow + page (lines 215–1217) | 1003 | ~430 (`core.ts`) | 57% |
| Cross-subaccount + universal + clarification + support stub + social (lines 1218–1631) | 414 | ~190 (`intelligence.ts`) | 54% |
| Ads + outreach + finance + content/SEO + onboarding + CRM stub + canonical dictionary + knowledge (lines 1632–2193) | 562 | ~250 (`agents.ts`) | 56% |
| Priority feed + memory search + methodology (lines 2194–2308) | 115 | ~80 (`methodology.ts`, methodology block now factory-driven but mostly already collapsed) | 30% |
| Configuration (lines 2310–2899) | 590 | ~210 (`configuration.ts`, big win — 16 near-identical entries) | 64% |
| ClientPulse + universal brief + cached context + thread context (lines 2902–3322) | 421 | ~190 (`clientpulse.ts`) | 55% |
| Agentic commerce + shadow-to-live (lines 3324–3617) | 294 | ~110 (`commerce.ts`) | 63% |
| Support desk (lines 3619–3810) | 192 | ~130 (`support.ts`) | 32% (less repetitive — varied across factories) |
| Trailing module-scope (lines 3811–3971) | 161 | 161 (`index.ts`, IIFE + helpers + slug aliases + status enums) | 0% |
| Factories module | 0 | ~250 (`factories.ts`) | n/a (new) |
| Factory tests | 0 | ~200 (`factories.test.ts`) | n/a (new) |
| **Total registry source (excl. tests)** | **3,966** | **~2,000** | **~50%** |

Excluding `factories.test.ts` from the comparison (tests are net additive), the registry source drops from ~3,966 to ~2,000 lines — **~50% reduction**, in the brief's 50–60% target band. With `factories.test.ts` included as registry-related code, the total directory is ~2,200 lines vs the original 3,971 — still a 45% reduction in maintainable lines, with the test surface as a net win for future refactors.

## 11. Factory-coverage check

The small minority of entries that don't fit any factory and are kept as direct-object literals because force-fitting them would either widen the factory signature (violating single-responsibility) or require a one-off override that defeats the abstraction:

- **`cached_context_budget_breach`** — only entry with `defaultGateLevel: 'block'`. Direct.
- **`workflow.run.start`** — dotted-slug entry with workflow-engine-specific semantics (`createsBoardTask: false`, unique payloadFields, distinct retry shape). Direct.
- **`run_command`** — devops-tier with `riskTier: 4` and a unique `doNotRetryOn` list (`['permission_failure', 'validation_failure']`). Direct.
- **`write_patch`** — devops-tier with `riskTier: 3` plus `requiresCritiqueGate: true` and a unique `doNotRetryOn` list. Could fit `defineInternalStateWrite` with overrides, but the doNotRetryOn list is non-standard. Direct.
- **`compute_health_score`, `detect_anomaly`, `compute_churn_risk`** — `riskTier: 0` reads with bespoke parameterSchema (different per analytic). Direct unless cleanly fitting `defineInternalRead` during Chunk 6 conversion.
- **`update_thread_context`** — `riskTier: 1` with subtle keyed_write semantics. Direct.
- **`enrich_contact`** — external read with CRM write-back (`readPath: 'liveFetch'` + `idempotencyStrategy: 'keyed_write'` + `readOnlyHint: false`). Forces inventing an eighth factory `defineExternalReadWithWriteBack` for a single entry — keep direct.
- **`promote_spending_policy_to_live`** — HITL meta-action, no money movement. Doesn't fit `defineSpendWrite` (no money) or `defineConfigWrite` (different topic + actionCategory). Direct.
- **`config_update_organisation_config`, `notify_operator`** — within the ClientPulse cluster but with topic `['clientpulse', 'config', 'agent']` rather than `['configuration']`. Decision in Chunk 10: keep direct because forcing `defineConfigWrite` to accept arbitrary topics widens its signature.
- **`config_create_agent`** — only `config_*` entry with an inline `verify: null` + verifyNullJustification. Decision in Chunk 9: keep direct.
- **`read_priority_feed`** — read-shaped slug with minor-write semantics (`riskTier: 1`). Direct unless it fits `defineInternalStateWrite` cleanly during Chunk 8.

Total direct-object exceptions: ~12 of 119 entries (~10%). Within the brief's "small minority" band.

## 12. Deferred items

None for this build. Every invariant in the brief is in-scope for the chunks listed.

## 13. Self-consistency pass

- Goals (50–60% line reduction, zero behaviour change) match implementation (factories + directory split with shim).
- Every chunk has a clear scope, an independent test (diff-test), and a forward-only dependency.
- Pre-Phase-2 chunk handles gate fragility BEFORE moving entries — order is correct.
- Factory pattern is a deep-module: small named-arg interface, substantial internal logic hidden.
- Public API preserved: every exported name lives in `index.ts` and is re-exported by the shim.
- Pre-existing `verify-skill-read-paths.sh` calibration misalignment is identified and fixed inside Chunk 2's runtime-rewrite.
- Risk-tier audit step is explicit between Chunk 11 and Chunk 12 with a CSV-vs-runtime diff script.
- Direct-object exceptions documented with the criterion (uniqueness divergence that would widen the factory).
- Trailing IIFE behaviour preservation called out as risk #1 with explicit factory-design constraint.
- Doc-sync is in Chunk 12, same commit as the file move.

## 14. Open questions

1. **Should `enrich_contact` (external read with CRM write-back) get its own factory `defineExternalReadWithWriteBack`, or stay direct?** Current plan: stay direct unless a second similar entry surfaces. Two factories with shared internal helper > one swiss-army factory.
2. **Should the snapshot file (`scripts/snapshots/action-registry.snapshot.json`) live under `scripts/snapshots/` or under `tasks/builds/refactor-action-registry/`?** Decision: `scripts/snapshots/` so the diff-test script remains a permanent repo artefact (same lifecycle as `audit-action-registry-risk-tiers.ts`). The build slug directory is not the right home for a long-lived oracle.
3. **Should Chunk 12 reorder the spread inside `index.ts` (e.g. alphabetical by domain) for stability, or match the original section order?** Decision: match original section order. Insertion order is preserved in V8 and the diff-test compares ordered keys; matching the original keeps the diff-test maximally tight. A future PR can reorder once the refactor lands.
4. **Should the snapshot include `loggedAliasHits` state?** No — it's a `Set<string>` populated at runtime via `resolveActionSlug` calls. The snapshot captures the registry definition, not runtime state. The IIFE is also not captured directly; the snapshot captures the IIFE's effects on the registry (i.e. the verify/verifyNullJustification fields after the IIFE has run).

# PR Review Log — synthetos-foundation-refactor

**Review timestamp:** 2026-05-09T13:45:00Z
**Branch:** claude/openclaw-worker-mode-VnjQT
**Reviewer:** pr-reviewer (Claude Opus 4.7)
**Scope:** 93 files across 11 chunks, vs origin/main
**Spec:** tasks/builds/synthetos-foundation-refactor/spec.md (LOCKED, 2299 lines)
**Plan:** tasks/builds/synthetos-foundation-refactor/plan.md (LOCKED)

**Verdict:** CHANGES_REQUESTED (5 blocking, 6 strong, 7 nits)

Prior review logs (their findings are NOT re-flagged here):
- spec-conformance-log-synthetos-foundation-refactor-2026-05-09T12-45-00Z.md (NON_CONFORMANT — 2 deferred naming gaps)
- adversarial-review-log-synthetos-foundation-refactor-2026-05-09T13-15-00Z.md (HOLES_FOUND — ADV-A fixed, ADV-B/C + 3 obs deferred)

---

## Blocking Issues

### B1 — Em-dashes in user-facing UI copy (project-wide rule violation)

Files:
- client/src/components/agent-config/ExecutionTab.tsx:47 — `'Phase 2 — coming soon'`
- client/src/components/agent-config/ModelsIdentityTab.tsx:52, 53 — two `Phase X — coming soon` strings
- client/src/components/agent-config/GovernanceTab.tsx:16-22 — seven Risk Tier label strings (`'Tier 0 — Read-only…'`, etc.)
- client/src/components/agent-config/GovernanceTab.tsx:90 — `'Phase 1.5 — coming soon'`

CLAUDE.md § User Preferences forbids em-dashes in UI copy.

Fix: replace `—` with `:` / `,` / rewrite.

### B2 — `policyEnvelopeResolver` queries miss `organisationId` filter

File: server/services/policyEnvelopeResolver.ts:62-66, 194-198, 206-210

Four queries omit `organisationId` predicate even though `ctx.organisationId` is available. Sibling `policyEngineService.getSubaccountGovernance` uses `getOrgScopedDb` for the same table. Violates DEVELOPMENT_GUIDELINES §1.

Fix: add `eq(<table>.organisationId, ctx.organisationId)` to every read/write predicate (or wrap in `getOrgScopedDb`).

### B3 — `agentExecutionService` controllerStyle lookup misses `organisationId` filter

File: server/services/agentExecutionService.ts:430-433, 575-578

Two `subaccountAgents` lookups by `id` only.

Fix: add `eq(subaccountAgents.organisationId, request.organisationId)` to the AND. Optionally collapse the duplicate read.

### B4 — `policyEngineService` uses `console.log` for stable foundation log codes

File: server/services/policyEngineService.ts:352-357, 391-396

Two `console.log('foundation.risk_tier.gate_derived', { … })` calls. Stable log codes that downstream observability consumes cannot bypass the structured logger.

Fix: import `logger` and use `logger.info(…)`.

### B5 — `runTraceService` swallows DB errors silently

File: server/services/runTraceService.ts:319-325

Bare `catch {}` returns empty events on any DB error.

Fix: replace with `logger.error('foundation.run_trace.query_failed', { runId, error })` and rethrow, or let `asyncHandler` upstream return 500.

---

## Strong Recommendations

### S1 — `tool_security_decision` event hardcodes `riskTier: 0` and `gateLevelSource: 'tier_default'`
File: server/services/runTraceService.ts:158-174. Underlying schema lacks the columns. Document the gap or persist the values upstream.

### S2 — `runTraceService.toolSlug` filter applied AFTER `limit + 1` slicing breaks pagination
File: server/services/runTraceService.ts:319-372. Push `toolSlug` and `eventTypes` into the UNION SQL `WHERE`.

### S3 — Missing test: cross-page cursor stability with `toolSlug` filter
Test scenario provided in agent reviewer notes.

### S4 — Missing test: legacy run with NULL envelope renders correctly in headline
File: client/src/lib/__tests__/runTraceFormatters.test.ts.

### S5 — `policyEnvelopeResolverPure.test.ts` test descriptions don't match assertions
Lines 12-22, 23-32. "all auto" / "all block" descriptions are wrong.

### S6 — `computeSourceVersion` only sorts top-level keys
File: server/services/policyEnvelopeResolverPure.ts:41-44. Constrain types or recursively sort.

---

## Non-Blocking Improvements (nits)

- N1 — Manual try/catch in agentRuns.ts /trace endpoint defeats asyncHandler standardised envelope.
- N2 — controllerStyleResolver silently coerces unknown override values to `'native'`.
- N3 — runTraceService.ts header comment says "nine ledger tables", glossary says "eight", real UNION uses seven.
- N4 — Glossary documents Risk Tier values as `'low' | 'medium' | 'high' | 'critical'` but type is numeric 0-6.
- N5 — Redundant import in policyEnvelopeResolver.ts (RiskTier + GateLevel from same module).
- N6 — `activePolicySummary[0]` non-deterministic without orderBy.
- N7 — `controller_style_decided` default source is `'tier_default'` (wrong domain).

---

## Doc-sync gaps

architecture.md does NOT yet document:
- `agent_runs.controller_style` (chunk 3)
- `agent_runs.policy_envelope_snapshot` (chunk 6)
- `subaccount_agents` four governance columns (chunk 2)
- `GET /api/agent-runs/:runId/trace` (chunk 7)
- `credentialBrokerService` (chunk 5) — only the glossary mentions it
- `credentials:audit:read` permission + `/api/subaccounts/:id/credential-audit` (chunk 10)

To be addressed by the doc-sync gate later in this pipeline.

---

## Verdict rationale

CHANGES_REQUESTED. Implementer can resolve all five blockers in one focused pass. Strong recommendations cover correctness gaps in pagination + filter ordering, missing tests, and a misleading test description.

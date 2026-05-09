# Spec Conformance Log

**Spec:** `tasks/builds/synthetos-foundation-refactor/spec.md`
**Spec commit at check:** `bd48fa8e` (LOCKED, ChatGPT APPROVED 2026-05-09)
**Branch:** `claude/openclaw-worker-mode-VnjQT`
**Base:** `origin/main`
**Scope:** All 11 chunks (Phase 1 foundation refactor — single feature-coordinator run)
**Changed-code set:** 93 files
**Run at:** 2026-05-09T12:45:00Z

---

## Summary

- Requirements extracted:     ~52 (file-presence + key-contract spot-checks per chunk)
- PASS:                       50
- MECHANICAL_GAP → fixed:      0
- DIRECTIONAL_GAP → deferred:  2
- AMBIGUOUS → deferred:        0
- OUT_OF_SCOPE → skipped:      0

**Verdict:** NON_CONFORMANT (2 directional gaps — see deferred items)

> Note: both gaps are deliberate developer divergences from spec-named identifiers, not missing features. Implementation is consistent across migration / schema / Zod / tests / UI. Both routed to `tasks/todo.md` for operator decision (rename code vs. update spec); neither blocks pr-reviewer in spirit.

---

## Per-chunk verdicts

| Chunk | Name | Verdict | Notes |
|---|---|---|---|
| 1 | shared-types-and-environment-mapping | PASS (with deferred naming) | All 5 type files present; types match spec contracts. `ControllerLimits` interface uses `maxToolCallsPerRun` / `approvalDefault` instead of spec §4.1.5 `defaultMaxToolCalls` / `approvalDefaultMin` — see SCD-1. |
| 2 | subaccount-agents-governance-migration | PASS (with deferred naming) | Migration 0307 adds 4 governance columns with correct defaults and CHECK constraints. Closed-enum identifier `'native_and_operator'` shipped as `'operator_allowed'` — see SCD-2. |
| 3 | controllerStyle-field | PASS | Migration 0308 adds `controller_style` with CHECK + partial index per spec §4.1.3. Drizzle schema column added. controllerStyleResolver implements derivation rule per §4.1.6. Route handler (`server/routes/agentRuns.ts`) accepts override and maps `ControllerStyleNotAllowedForAgentError` to HTTP 422. |
| 4 | risk-tier-sweep-and-derivation | PASS | `verify-risk-tier-assigned.sh` + `verify-risk-tier-assigned.ts` exist and PASS — all 138 entries have valid riskTier. Tier→GateLevel derivation implemented in `shared/types/riskTier.ts` matching §4.2.4. |
| 5 | credential-broker-facade | PASS | All 5 facade methods present: `issueCredential`, `injectIntoEnvironment`, `revoke`, `audit`, `resolveAvailableCredentials`. Delegates to `connectionTokenService` and `integrationConnectionService` per INV-11. Emits `foundation.credential_broker.issued` per INV-16. |
| 6 | policy-envelope-resolver-and-snapshot | PASS | Migration 0309 adds `policy_envelope_snapshot jsonb`. Resolver aggregates 6 sources per §4.5.5. `persist()` uses spec's exact UPDATE pattern with first-resolver-wins re-read. INV-19 enforced in `agentExecutionService.ts:675-732` with `foundation.policy_envelope.resolution_failed` log + `policy_envelope_resolution_failed` failure reason. |
| 7 | run-trace-api-and-service | PASS | `GET /api/agent-runs/:runId/trace` route registered at `server/routes/agentRuns.ts:677`. RunTraceService imported. Cursor codec in `shared/types/runTraceEvent.ts` per §4.4. |
| 8 | run-trace-headline-ui | PASS | `RunTraceHeadline` component wired into `RunTracePage.tsx:407`. |
| 9 | agent-config-four-tabs | PASS | All 4 tabs present: ExecutionTab, GovernanceTab, IntegrationsTab, ModelsIdentityTab. |
| 10 | approval-ux-risk-context-and-credentials-audit | PASS | `ApprovalRiskContext` wired into `ReviewQueuePage.tsx:524`. `CredentialsAuditLog` wired into `CredentialsTab.tsx:464`. `GET /api/subaccounts/:subaccountId/credential-audit` route in `server/routes/credentials.ts` mounted via `server/index.ts:367`. |
| 11 | naming-glossary-and-awareness-comments | PASS | `docs/synthetos-nomenclature.md` exists (58 lines). |

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

### SCD-1 — `ControllerLimits` interface field names diverge from spec §4.1.5

Spec §4.1.5 specifies:
- `defaultMaxToolCalls: number`
- `approvalDefaultMin: 'auto' | 'review' | 'block'`

Implementation in `shared/types/controllerStyle.ts` and `server/config/controllerLimits.ts`:
- `maxToolCallsPerRun: number`
- `approvalDefault: 'auto' | 'review' | 'block'`

Semantic intent matches; identifier names differ. Cross-cutting (interface + implementation + every consumer that types against it).

### SCD-2 — `controller_style_allowed` enum diverges from spec §3.6 / §4.1.6 / §5.2.9

Spec specifies the closed enum:
- `'native_only' | 'native_and_operator'`

Implementation uses:
- `'native_only' | 'operator_allowed'`

Affected files (10):
- `migrations/0307_subaccount_agents_governance.sql` (DB CHECK constraint)
- `server/db/schema/subaccountAgents.ts` (Drizzle column type)
- `server/schemas/subaccountAgents.ts` (Zod validator)
- `server/services/policyEnvelopeResolver.ts:77`
- `server/services/__tests__/controllerStyleResolverPure.test.ts` (multiple sites)
- `server/db/schema/__tests__/subaccountAgentsGovernance.test.ts:71`
- `client/src/components/agent-config/ExecutionTab.tsx` (×3)
- `client/src/pages/SubaccountAgentEditPage.tsx` (×2)

Semantic intent is identical. Operator decision needed: either rename code to `'native_and_operator'` (requires follow-up migration to update CHECK constraint and any rows already at the legacy value) OR update the spec text to canonicalise `'operator_allowed'` retroactively. The migration is already committed, so the rename path has a real production cost.

---

## Mechanical fixes applied

None (no MECHANICAL_GAPs identified).

---

## Files modified by this run

None.

---

## Next step

NON_CONFORMANT — 2 directional gaps recorded in `tasks/todo.md`. Both are deliberate naming divergences with consistent cross-file implementation. Operator decision: rename code or update spec. Per the operator's `review-pipeline-autonomy` preference, the review pass continues to `pr-reviewer` while these gaps remain deferred for separate triage.

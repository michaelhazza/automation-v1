# SynthetOS Nomenclature — Canonical Name Glossary

**Source of truth** for the mapping between SynthetOS brief v1.2 product names and the code identifiers used throughout this codebase. Spec reference: §4.6.1–§4.6.11.

---

## Canonical names table

| Brief v1.2 product name | Code name (field / type / file) | Notes |
|---|---|---|
| Controller | `controllerStyle` (field), `ControllerStyle` (TypeScript type) | `shared/types/controllerStyle.ts`. Values: `'native'` (autonomous, no approval loop) and `'operator'` (approval-gated). Replaces the informal "execution style" terminology. |
| Execution Environment | `executionMode` (field on `agentRuns`) | Existing code field. Values reflect the agent's execution context (standard loop, IEE browser, IEE dev). See `server/services/agentExecutionService.ts`. |
| Router and Execution Planner | Capability-Aware Orchestrator | Code entry point: `server/jobs/orchestratorFromTaskJob.ts`. Architecture section: [Orchestrator Capability-Aware Routing](../architecture.md#orchestrator-capability-aware-routing). |
| IEE Integrated Execution Environment | IEE | Code files: `worker/src/handlers/browserTask.ts`, `worker/src/handlers/devTask.ts`. Service: `ieeExecutionService`. Architecture section: [IEE — Integrated Execution Environment](../architecture.md#iee-integrated-execution-environment). |
| Policy Envelope | `policyEnvelopeSnapshot` (field), `PolicyEnvelopeSnapshot` (TypeScript type) | `shared/types/policyEnvelope.ts`. The snapshot is captured at run start and embedded in every Run Trace response. See `server/services/policyEnvelopeResolver.ts`. |
| Run Trace | `runTraceService` (service), `GET /api/agent-runs/:runId/trace` (endpoint) | `server/services/runTraceService.ts`. Virtual read across eight ledger tables with cursor pagination. UI: `client/src/pages/operate/RunTracePage.tsx`. |
| Credential Broker | `credentialBrokerService` (service) | `server/services/credentialBrokerService.ts`. Identity Boundary primitive; facade over `integrationConnectionService` and `connectionTokenService`. |
| Risk Tier | `riskTier` (field on `ActionDefinition` and `PolicyDecision`) | `shared/types/riskTier.ts`. Values: `'low'`, `'medium'`, `'high'`, `'critical'`. Drives gate-level derivation via `deriveGateLevel()`. |

---

## When to use which name

**In user-facing copy and product documentation:** use the brief v1.2 terms (Controller, Execution Environment, Router and Execution Planner, IEE, Policy Envelope, Run Trace, Credential Broker, Risk Tier).

**In code, TypeScript types, and engineering documents:** use the code names (`controllerStyle`, `executionMode`, `orchestratorFromTaskJob`, `ieeExecutionService`, `policyEnvelopeSnapshot`, `runTraceService`, `credentialBrokerService`, `riskTier`).

**In architecture.md and internal specs:** use the code name first with the brief term in parentheses on first reference, e.g. "the Capability-Aware Orchestrator (Router and Execution Planner per v1.2 brief)".

---

## Why we are not renaming code identifiers

Service-wide renames across 109 action definitions, 40+ service files, and hundreds of import sites would introduce merge conflicts, grep-hazard, and review noise without functional benefit. The existing code identifiers are already precise and unambiguous — `controllerStyle`, `executionMode`, and `policyEnvelopeSnapshot` communicate their semantics clearly to engineers.

This glossary is the bridge: product managers and designers speak the brief v1.2 terms; engineers read the glossary once and then work fluently in the code names. Future specs authored by either audience should cite this document to stay in sync. (See spec §3.4 INV-13 and §4.6.5.)

Canonical ledger consolidation (moving from the current virtual UNION view to a materialised `run_events` table) is roadmapped as Phase 3+ (NG4). At that point, code identifiers may be revisited together with the schema change.

---

## Cross-references

| Code name | Primary file | Architecture section |
|---|---|---|
| `controllerStyle` / `ControllerStyle` | `shared/types/controllerStyle.ts` | `architecture.md#orchestrator-capability-aware-routing` |
| `executionMode` | `server/services/agentExecutionService.ts` | `architecture.md#orchestrator-capability-aware-routing` |
| Capability-Aware Orchestrator | `server/jobs/orchestratorFromTaskJob.ts` | `architecture.md#orchestrator-capability-aware-routing` |
| IEE browser handler | `worker/src/handlers/browserTask.ts` | `architecture.md#iee-integrated-execution-environment` |
| IEE dev handler | `worker/src/handlers/devTask.ts` | `architecture.md#iee-integrated-execution-environment` |
| `policyEnvelopeSnapshot` | `server/services/policyEnvelopeResolver.ts` | `architecture.md#policy-engine` |
| `runTraceService` | `server/services/runTraceService.ts` | `architecture.md` (key files table, Operate section) |
| `credentialBrokerService` | `server/services/credentialBrokerService.ts` | `architecture.md` (key files table) |
| `riskTier` | `shared/types/riskTier.ts` | `architecture.md#policy-engine` |

---

*Glossary introduced in synthetos-foundation-refactor (Phase 1). Update this document whenever a brief v1.2 term or code identifier changes.*

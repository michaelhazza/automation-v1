**Status:** reviewing
**Spec date:** 2026-05-18
**Last updated:** 2026-05-18
**Author:** spec-coordinator inline (Opus, 2026-05-18)
**Build slug:** `browser-vision-grounding`
**Scope class:** Major

---

## Lifecycle Declaration

| Field | Value |
|---|---|
| Capability cluster | Agent Runtime, Billing |
| Capability owner | ai-agent |
| Lifecycle state on launch | Inception |
| Risk surface | server/db/schema, agent runtime |
| Review cadence | quarterly |

---

# Vision-based Browser Grounding via Self-hosted UI-TARS

## Table of contents

1. Goals
2. Non-goals
3. Framing assumptions
4. Existing primitives reused
5. ABCd Lifecycle Estimate
6. Phase plan (chunk order)
7. File inventory lock
8. Contracts
9. Permissions / RLS checklist
10. Execution model
11. Phase sequencing
12. Execution-safety contracts
13. Deferred items
14. Self-consistency pass
15. Testing posture
16. Open questions

---

## §1 Goals

1. Add a vision-based decision layer above the IEE browser stack. Agents opt in by declaring `iee_decision_mode: vision` or `hybrid` in skill YAML frontmatter.
2. Self-host the UI-TARS 7B model behind a managed vLLM inference endpoint (OpenAI-compatible chat completions with vision). No ByteDance API calls or binaries.
3. Define a typed action schema (`VisionAction`) and a pure parser (`visionActionParserPure.ts`) for the UI-TARS native text format.
4. Scaffold the vision decision loop inside the harness (`visionDecisionLoop.ts`) as a loud-failure stub in V1, pending e2b SDK installation — same pattern as `humanize` and `proxyAlignment`.
5. Implement the server-side service (`visionGroundingService.ts`): resolve vLLM endpoint config, thread it into the task envelope, harvest `vision_calls.json` into the `vision_inference_calls` ledger at run end.
6. Track all vision inference costs in a new `vision_inference_calls` ledger table. Roll up to `cost_aggregates` with `source_type: vision_inference` via the async pg-boss rollup job. `runCostBreaker` enforces per-run ceilings against post-run aggregates from the following run onward. Mid-run enforcement against in-flight vision costs is deferred (§13) — V1 ships a stub harness so there are no in-flight vision costs in V1 regardless.
7. Existing DOM-mode workflows produce identical run logs before and after the change (no regression).
8. **Success criteria.** Split between what V1 verifies (static / structural) and what the follow-up full-wiring build verifies (execution / regression).

   **V1 (this spec — stub harness):**
   - `visionActionParserPure.ts` Vitest suite passes for all 9 action types + invalid-input cases.
   - `vision_inference_calls` table + RLS + manifest entry ship behind the same gates as other tenant-scoped tables (CI gates: `verify-rls-coverage.sh`, `verify-rls-contract-compliance.sh`).
   - Dispatch path threads `decisionMode`, `visionEndpointUrl`, `visionEndpointToken`, `visionModelId` into `SandboxRunTaskInput` for vision-mode tasks.
   - DOM workflows produce identical run logs before and after the change (verified by diff against pre-change baseline).
   - When `decisionMode !== 'dom'` and the e2b SDK is absent, the harness fails loudly per the stub convention — never writes `status: 'completed'`.
   - No ByteDance domain appears in the network allowlist for vision-mode tasks (allowlist is the internal vLLM endpoint host only).

   **Follow-up build (full harness wiring, post-e2b-SDK):**
   - A curated set of 10 workflows that fail on DOM-only pass under vision mode (test set authored by architect at follow-up plan authoring).
   - Per-task vision cost within an operator-approved alarm threshold (~5–10× DOM step cost).
   - Inference latency p95 ≤ 6 s per action on the chosen GPU class.

   §13 Deferred Items records the harness-loop wiring as the gate for the follow-up criteria.

## §2 Non-goals

- Shipping ByteDance binaries, Electron apps, or calling ByteDance / Volcengine endpoints.
- Replacing Playwright as the action execution plane (UI-TARS is the decision layer; Playwright executes).
- Making vision the default for existing workflows.
- Mobile / Android automation.
- Custom fine-tuning of UI-TARS on tenant data.
- A user-facing real-time screenshot viewer (run logs sufficient for V1).
- Multi-monitor or multi-window desktop control.
- OCR pre-processing of screenshots.
- The 72B model (7B is V1 default).
- Accessibility-tree fallback in V1.
- A configurable hybrid fallback threshold (V1 hard-codes 1 retry per step).
- Self-hosted GPU node (V1 uses a managed inference vendor).
- Full harness wiring — scaffolded as stub pending e2b SDK.

## §3 Framing assumptions

- `worker/src/browser/` no longer exists — deleted in PR #345 (`iee-worker-retirement`). File references in the brief to `worker/src/browser/executor.ts` and `worker/src/browser/captureStreamingVideo.ts` are obsolete. All browser execution flows through `infra/sandbox-templates/iee-browser/harness/index.ts`.
- `browser-hardening-primitives` (PR #349, merged 2026-05-18) has landed. The harness `HarnessInput` shape is stable: `humanize`, `proxyAlignment`, `proxyUrlEnvKey` fields already exist. This build adds `decisionMode`, `visionEndpointUrl`, `visionEndpointToken`, and `visionModelId`.
- The e2b SDK (`@e2b/sdk`) is not yet installed. The harness stub convention (fail loudly, never write `status: 'completed'`) applies to `visionDecisionLoop.ts`.
- The managed vLLM endpoint is an internal service. The inference URL and short-lived token are server-side env vars only; they never persist to the DB.
- `SandboxNetworkPolicy` already supports `mode: 'allowlist'`. Adding the inference host:port to the allowlist for vision-mode tasks is a dispatch-time configuration change — no schema change to the policy types.
- `cost_aggregates` already supports `entityType: 'source_type'` rows. Adding `entityId: 'vision_inference'` rows requires no schema change to `cost_aggregates`.
- `runCostBreaker` reads per-run totals from `cost_aggregates` via `entityType: 'run'`. V1 reflects vision costs in per-run `cost_aggregates` rows only AFTER the run completes, via the async pg-boss rollup job — so breaker enforcement against vision costs applies to the FOLLOWING run, not the run that incurred them. Mid-run enforcement (inline aggregate update during harvest, or per-call inline updates) is deferred (§13). V1 ships a stub harness so the gap is theoretical until the follow-up wiring lands.

## §4 Existing primitives reused

| Proposing | Reusing | Justification |
|---|---|---|
| Harness input shape | `HarnessInput` in `infra/sandbox-templates/iee-browser/harness/index.ts` | Add four fields; same optional-field pattern as `humanize` and `proxyAlignment` |
| `SandboxRunTaskInput` extension | `shared/types/sandbox.ts` | Same optional-field pattern as `humanize`, `proxyAlignment`, `proxyUrlEnvKey` |
| Network allowlist | `SandboxNetworkPolicy.mode: 'allowlist'` (already supported) | Dispatch layer populates for vision-mode tasks; no schema change |
| Cost ceiling enforcement | `runCostBreaker` | Reads from `cost_aggregates` automatically; vision rollup feeds it |
| Cost aggregation | `cost_aggregates` `source_type` entity type | No schema change; new `entityId: 'vision_inference'` rows follow existing convention |
| Failure taxonomy | `shared/iee/failureReason.ts` | Two new values added; all other failure paths use existing taxonomy |
| Action type file | `shared/types/` directory | New `visionActions.ts` follows `humanize.ts` / `proxyAlignment.ts` pattern |
| Artefact-based data transfer | `/workspace/artefacts/` pattern | `vision_calls.json` follows the existing artefact harvest contract |
| pg-boss rollup job | LLM cost rollup job pattern | `visionInferenceCostRollupJob.ts` mirrors `ieeCostRollupDailyJob.ts` |

## §5 ABCd Lifecycle Estimate

| Dimension | Sizing | Notes |
|---|---|---|
| Acquire | M | Apache-2.0 model weights; managed inference vendor account + GPU provisioning; vLLM deployment validation |
| Build | L | New harness decision loop, server service, parser, ledger table, cost rollup job, skill YAML extension, dispatch-path changes across `_ieeShared`, `SandboxRunTaskInput`, network policy |
| Carry | M | Managed inference vendor cost; model-version pinning cadence; `vision_inference_calls` table growth; p95 latency monitoring |
| decommission | M | Remove harness loop, server service, ledger table (migration + data archive), network allowlist cleanup, skill YAML field removal from all vision-mode skills |

## §6 Phase plan (chunk order)

Single phase — all chunks in one PR. Ordered by dependency. Every chunk verdict is `BUILD` (single-phase, single-PR delivery; no chunk is deferred — deferred work is in §13).

| Chunk | Verdict | Description | Dependencies |
|---|---|---|---|
| C1 | BUILD | `shared/types/visionActions.ts` — `VisionAction` union + `VisionDecisionMode` | none |
| C2 | BUILD | `server/services/visionActionParserPure.ts` — native text parser + Vitest tests | C1 |
| C3 | BUILD | `shared/iee/failureReason.ts` — add two new failure reason values | none |
| C4 | BUILD | `shared/types/sandbox.ts` — extend `SandboxRunTaskInput` (four new fields) | C1 |
| C5 | BUILD | `server/db/schema/visionInferenceCalls.ts` + migration `0373` | none |
| C6 | BUILD | `server/services/visionGroundingService.ts` — config resolution, envelope threading, harvest | C1, C3, C4, C5 |
| C7 | BUILD | `server/services/executionBackends/_ieeShared.ts` — dispatch threading + network allowlist + finalisation-time harvest hook | C3, C4, C6 |
| C8 | BUILD | Harness stub: `infra/sandbox-templates/iee-browser/harness/index.ts` + `visionDecisionLoop.ts` | C1, C3, C4 |
| C9 | BUILD | `server/jobs/visionInferenceCostRollupJob.ts` — pg-boss rollup + registration | C5 |
| C10 | BUILD | `server/services/skillParserServicePure.ts` — surface `iee_decision_mode` YAML key | none |
| C11 | BUILD | `server/config/visionInferencePricing.ts` — `costCents` formula source (§8.4); exact rates pinned at architect plan | none |
| C12 | BUILD | Docs: `docs/iee-development-spec.md` — document `iee_decision_mode` skill YAML field | C1, C10 |

## §7 File inventory lock

### New files (10)

| File | Type | Description |
|---|---|---|
| `shared/types/visionActions.ts` | TypeScript | `VisionAction` discriminated union + `VisionDecisionMode` type |
| `server/services/visionActionParserPure.ts` | TypeScript (pure) | Parses UI-TARS native text format to `VisionAction` |
| `server/services/__tests__/visionActionParserPure.test.ts` | Vitest | Unit tests for the parser (9 action types + invalid input cases) |
| `server/services/visionGroundingService.ts` | TypeScript | Config resolution, envelope threading, `vision_calls.json` harvest |
| `infra/sandbox-templates/iee-browser/harness/visionDecisionLoop.ts` | TypeScript | Harness-side stub: scaffold of screenshot→vLLM→parse→execute loop |
| `server/db/schema/visionInferenceCalls.ts` | TypeScript (Drizzle) | `vision_inference_calls` table definition |
| `migrations/0373_vision_inference_calls.sql` | SQL | Creates table with FORCE RLS + org-isolation policy |
| `migrations/0373_vision_inference_calls.down.sql` | SQL | Idempotent down: `DROP TABLE IF EXISTS vision_inference_calls` |
| `server/jobs/visionInferenceCostRollupJob.ts` | TypeScript | pg-boss rollup: `vision_inference_calls` → `cost_aggregates` |
| `server/config/visionInferencePricing.ts` | TypeScript | Pricing source-of-truth for `costCents` formula in `vision_calls.json` (§8.4); exact rate constants set at architect plan once vendor selected |

### Modified files (9)

| File | Change |
|---|---|
| `shared/types/sandbox.ts` | Add `decisionMode?: VisionDecisionMode \| null`, `visionEndpointUrl?: string \| null`, `visionEndpointToken?: string \| null`, `visionModelId?: string \| null` to `SandboxRunTaskInput` |
| `server/services/skillParserServicePure.ts` | Surface the optional `iee_decision_mode` YAML frontmatter key (default `'dom'` when absent) on the parsed skill record so the IEE dispatch path can read it into `SandboxRunTaskInput.decisionMode` |
| `shared/iee/failureReason.ts` | Add `vision_inference_unavailable`, `vision_inference_not_configured` to the `FailureReason` Zod enum |
| `infra/sandbox-templates/iee-browser/harness/index.ts` | Add four fields (`decisionMode`, `visionEndpointUrl`, `visionEndpointToken`, `visionModelId`) to `HarnessInput`; route to `visionDecisionLoop()` when `decisionMode !== 'dom'` |
| `server/services/executionBackends/_ieeShared.ts` | (Dispatch) Call `visionGroundingService.resolveEndpointConfig()`; thread four fields into `SandboxRunTaskInput`; set network allowlist for vision-mode tasks. (Finalisation) Call `visionGroundingService.harvestVisionCalls()` BEFORE the terminal `iee_runs.status` write — harvest failure prevents terminal write so the retry path re-attempts while status is still `running` (§12.1) |
| `server/db/schema/index.ts` | Export `visionInferenceCalls` |
| `server/jobs/index.ts` | Register `visionInferenceCostRollupJob` |
| `server/config/rlsProtectedTables.ts` | Add `vision_inference_calls` entry |
| `docs/iee-development-spec.md` | Document `iee_decision_mode` skill YAML field + three-mode behaviour |

## §8 Contracts

### 8.1 Vision action schema (`shared/types/visionActions.ts`)

**Producer:** `visionActionParserPure.ts` | **Consumer:** `visionDecisionLoop.ts`

```typescript
export type VisionDecisionMode = 'dom' | 'vision' | 'hybrid';

export type VisionAction =
  | { type: 'click';        x: number; y: number }
  | { type: 'double_click'; x: number; y: number }
  | { type: 'right_click';  x: number; y: number }
  | { type: 'type';         text: string }
  | { type: 'scroll';       dx: number; dy: number }
  | { type: 'hotkey';       combo: string }
  | { type: 'wait';         ms: number }
  | { type: 'screenshot' }
  | { type: 'done' };
```

Invariants: `x`, `y` are non-negative integers (pixel space). `dx`, `dy` are signed integers. `ms` is a positive integer. `type: 'done'` terminates the vision loop for the current step. `type: 'screenshot'` is observe-only (no action executed).

Concrete example: `{ "type": "click", "x": 340, "y": 220 }`

**Parser input grammar (UI-TARS native action text format).** `visionActionParserPure.ts` consumes the UI-TARS native chat-completion text format as published by the UI-TARS authors at <https://github.com/bytedance/UI-TARS/blob/main/README.md#action-format> (action grammar section). The parser:

- accepts one action per response line (whitespace-trimmed)
- maps each documented UI-TARS action verb to one of the 9 `VisionAction` discriminants above (1:1 — no aliases in V1)
- rejects: unknown verbs, missing required arguments, non-integer coordinates, negative `x`/`y` or `ms`, malformed `combo` strings
- normalises: leading / trailing whitespace, repeated internal whitespace collapsed to single spaces

The Vitest test file authors worked-example input strings (one per action type) and the matching `VisionAction` outputs, plus the rejection-case fixtures listed above. The architect's plan pins the exact UI-TARS release the grammar is versioned against (model version + grammar revision).

### 8.2 `SandboxRunTaskInput` extension (`shared/types/sandbox.ts`)

Four new optional fields — follow the `humanize` / `proxyAlignment` pattern exactly:

```typescript
decisionMode?: VisionDecisionMode | null;   // absent = 'dom'
visionEndpointUrl?: string | null;          // required when decisionMode != 'dom'
visionEndpointToken?: string | null;        // optional bearer token; never persisted
visionModelId?: string | null;              // resolved model id (e.g. "ui-tars-7b") — required when decisionMode != 'dom'
```

**Source-of-truth:** `_ieeShared.ts` populates these from `visionGroundingService.resolveEndpointConfig()`. They exist only in the in-flight task envelope — never written to any DB column. The harness reads `visionModelId` for the vLLM request `model` field and stamps it onto each `VisionCallRecord.modelId`.

### 8.3 `HarnessInput` extension (`infra/sandbox-templates/iee-browser/harness/index.ts`)

Same four fields added to the in-sandbox `HarnessInput` interface (written to `/workspace/input.json`):

```typescript
decisionMode?: 'dom' | 'vision' | 'hybrid' | null;
visionEndpointUrl?: string | null;
visionEndpointToken?: string | null;
visionModelId?: string | null;
```

When `decisionMode` is `'vision'` or `'hybrid'`, the harness entry point routes to `visionDecisionLoop(input)`. `visionDecisionLoop` owns the orchestration for both modes:

- `decisionMode === 'vision'`: every step is a vision-only step (screenshot → vLLM → parse → execute).
- `decisionMode === 'hybrid'`: each step starts DOM-first (existing DOM executor path); after 1 DOM selector failure + 1 retry, the loop falls back to vision for that step. Counter resets per-step (matches §8.9 semantics).

In V1, `visionDecisionLoop.ts` is a loud-failure stub (no DOM-first attempt is actually wired) — never writes `status: 'completed'`. Full DOM-first + vision-fallback orchestration is wired in the follow-up build (§13).

### 8.4 `vision_calls.json` artefact shape

Written by `visionDecisionLoop.ts` to `/workspace/artefacts/vision_calls.json` at harness exit. Absent when `decisionMode === 'dom'` or when no vision calls occurred.

```typescript
interface VisionCallRecord {
  stepIndex:       number;                  // 0-based step index
  callIndex:       number;                  // 0-based call index within step
  modelId:         string;                  // e.g. "ui-tars-7b" (threaded from SandboxRunTaskInput.visionModelId)
  costCents:       number;                  // integer; computed via visionInferencePricing.computeCostCents(...)
  latencyMs:       number;                  // wall-clock ms request→first byte
  imageSizeBytes:  number;                  // PNG screenshot byte size
  actionType:      VisionAction['type'];    // type discriminant of parsed action
  fallbackTrigger: boolean;                 // true if triggered by DOM failure in hybrid mode
}
type VisionCallsArtefact = VisionCallRecord[];
```

**`costCents` formula source-of-truth:** `server/config/visionInferencePricing.ts` exports `computeCostCents({ modelId, imageSizeBytes, latencyMs, outputTokens })` and a `VISION_PRICING_RATES` table keyed by `modelId`. The harness imports this module and rounds to the nearest integer cent (`Math.round`). The architect plan pins the exact rates per vendor at plan-authoring time once the inference vendor is selected (§16 Q1). Until the harness loop is wired (deferred §13), the V1 pure-function tests cover the formula's rounding and per-model rate lookup.

Concrete example:
```json
[{ "stepIndex": 0, "callIndex": 0, "modelId": "ui-tars-7b",
   "costCents": 4, "latencyMs": 2100, "imageSizeBytes": 241500,
   "actionType": "click", "fallbackTrigger": false }]
```

**Producer:** `visionDecisionLoop.ts` | **Consumer:** `visionGroundingService.harvestVisionCalls()`

### 8.5 `vision_inference_calls` row shape

Written by `visionGroundingService.harvestVisionCalls()` during artefact harvest.

```
id              uuid PK
organisation_id uuid NOT NULL
subaccount_id   uuid (nullable)
run_id          uuid NOT NULL REFERENCES agent_runs
iee_run_id      uuid NOT NULL REFERENCES iee_runs
model_id        text NOT NULL
cost_cents      integer NOT NULL DEFAULT 0
latency_ms      integer NOT NULL
image_size_bytes integer NOT NULL
action_type     text NOT NULL
fallback_trigger boolean NOT NULL DEFAULT false
step_index      integer NOT NULL
call_index      integer NOT NULL
created_at      timestamptz NOT NULL DEFAULT now()
UNIQUE (iee_run_id, step_index, call_index)  -- idempotent harvest key
```

RLS: `FORCE ROW LEVEL SECURITY`. Policy: `organisation_id = current_setting('app.organisation_id')::uuid`. "RLS enforces the organisation boundary; subaccount filtering is service-layer."

Concrete example:
```json
{ "id": "c1a2b3c4-...", "organisationId": "aa...", "subaccountId": "bb...",
  "runId": "cc...", "ieeRunId": "dd...", "modelId": "ui-tars-7b",
  "costCents": 4, "latencyMs": 2100, "imageSizeBytes": 241500,
  "actionType": "click", "fallbackTrigger": false, "stepIndex": 0, "callIndex": 0 }
```

### 8.6 `visionGroundingService` config contract

`resolveEndpointConfig()` reads env vars:

| Env var | Required | Default |
|---|---|---|
| `VISION_INFERENCE_ENDPOINT_URL` | required for vision tasks | — (throws `vision_inference_not_configured` when absent or scheme is not `https://`) |
| `VISION_INFERENCE_API_KEY` | optional | null (unauthenticated internal endpoints) |
| `VISION_INFERENCE_MODEL_ID` | optional | `ui-tars-7b` |

Returns `{ endpointUrl: string; apiKey: string | null; modelId: string }`. Never persisted to DB. Token included in `SandboxRunTaskInput.visionEndpointToken` for the in-flight envelope only. Model id included in `SandboxRunTaskInput.visionModelId` (§8.2).

**URL constraint:** `VISION_INFERENCE_ENDPOINT_URL` must be HTTPS. The host and port for the §8.7 network allowlist entry are parsed from the URL (`new URL(...).hostname`, `new URL(...).port || '443'`). Non-HTTPS URLs throw `vision_inference_not_configured` at `resolveEndpointConfig()` time (dispatch fails before sandbox creation).

### 8.7 Network policy extension for vision-mode tasks

When `_ieeShared.ts` dispatches a vision-mode task, it overrides `SandboxPolicy.network`:

```typescript
// vision-mode (decisionMode = 'vision' | 'hybrid')
//   host and port are PARSED from VISION_INFERENCE_ENDPOINT_URL — not hard-coded.
//   See §8.6 URL constraint (HTTPS required).
const url = new URL(visionEndpointUrl);
{
  mode: 'allowlist',
  allowlist: [{ host: url.hostname, port: Number(url.port || '443'), protocol: 'https' }],
}

// dom-mode (decisionMode = 'dom' | absent) — unchanged
{ mode: 'none' }
```

**Security posture decision:** explicit controlled departure from deny-all egress for vision-mode tasks only. The vision allowlist entry is scoped to exactly one host:port (the internal vLLM endpoint). The inference endpoint is an internal managed service — no external API keys or tenant credentials transit the network allowlist.

**Composition with broader browser navigation policy.** The current `_ieeShared.ts` dispatch sets `network: { mode: 'none' }` (see TODO IEE-DEF-7 in `_ieeShared.ts`) — production browser navigation is not yet wired. When the broader browser network policy lands (IEE-DEF-7), the vision-mode allowlist entry above is **additive** to whatever the resolution adopts (additional entries for the target site, proxy host, etc.). This spec does NOT modify the dom-mode network policy.

### 8.8 `FailureReason` additions

| Value | When raised |
|---|---|
| `vision_inference_not_configured` | `VISION_INFERENCE_ENDPOINT_URL` absent when a vision-mode skill dispatches. Raised at dispatch by `visionGroundingService.resolveEndpointConfig()`. |
| `vision_inference_unavailable` | vLLM endpoint returned non-2xx or timed out mid-run. `vision` mode: fail the run. `hybrid` mode: fail the step. Raised by `visionDecisionLoop.ts`. |

### 8.9 Skill YAML frontmatter extension

```yaml
iee_decision_mode: dom | vision | hybrid   # optional; default: dom
```

- `dom` (default when absent): DOM-selector execution. Existing behaviour. No vision calls.
- `vision`: Vision-only. Every action step calls the vLLM endpoint.
- `hybrid`: DOM-first. After 1 DOM selector failure + 1 retry, falls back to vision for that step. Counter resets per-step.

The IEE skill executor reads this at dispatch. When absent, behaviour is byte-identical to `dom`. No existing skills are affected.

## §9 Permissions / RLS checklist

### `vision_inference_calls` (new tenant-scoped table)

1. **RLS policy** — in `migrations/0373_vision_inference_calls.sql`: `ALTER TABLE vision_inference_calls FORCE ROW LEVEL SECURITY; CREATE POLICY org_isolation ON vision_inference_calls USING (organisation_id = current_setting('app.organisation_id')::uuid);`
2. **`rlsProtectedTables.ts`** — `vision_inference_calls` added in the same commit as the migration.
3. **Route guard** — no direct HTTP route reads this table in V1. Rollup writes use `withAdminConnection` (same pattern as LLM cost rollup). Any future route reading this table must use `getOrgScopedDb()`.
4. **Principal-scoped context** — not read from an agent execution path in V1.

**RLS posture:** "RLS enforces the organisation boundary; subaccount filtering is service-layer."

No other new tenant-scoped tables. All other new files are pure TypeScript / service layer with no direct DB columns.

## §10 Execution model

### `visionGroundingService` (server-side, inline/synchronous)

`resolveEndpointConfig()` — inline within IEE dispatch. Synchronous env-var read + validation. No pg-boss job.

`harvestVisionCalls()` — inline within the IEE artefact harvest pipeline. Reads `/workspace/artefacts/vision_calls.json`, upserts `vision_inference_calls` rows via `withAdminConnection`. Called once per run at terminal state. No pg-boss job.

### `visionDecisionLoop.ts` (harness-side, inline within harness process)

Runs inside the e2b sandbox process. Tight loop — no inter-process round trips per action step:

1. Capture screenshot (Playwright, post SDK wiring).
2. Encode as base64 PNG; POST to vLLM endpoint (network allowlist egress).
3. Parse native text response to `VisionAction`.
4. Execute typed action via Playwright.
5. Append `VisionCallRecord` to in-memory accumulator.
6. Repeat until `type: 'done'` or step action limit.

On harness exit (normal or error): flush accumulator to `/workspace/artefacts/vision_calls.json`.

In V1 the loop is a stub — fails loudly per established convention.

### `visionInferenceCostRollupJob` (async, pg-boss)

Scheduled pg-boss job. Reads un-aggregated `vision_inference_calls` rows for completed runs and upserts `cost_aggregates` rows:
- `entityType: 'source_type'`, `entityId: 'vision_inference'`
- `entityType: 'run'`, `entityId: <run_id>`

Pattern mirrors `ieeCostRollupDailyJob.ts`. `runCostBreaker` picks up per-run aggregates from the rollup output, but enforcement against vision costs applies to the FOLLOWING run, not the run that incurred them (see §1 Goal 6 and §13 deferred item on mid-run enforcement).

## §11 Phase sequencing

Single phase — one PR. Chunk dependency graph (from §6):

```
C1 (visionActions.ts)
├── C2 (parser + tests)
├── C4 (SandboxRunTaskInput extension)
│   └── C6 (visionGroundingService)
│       └── C7 (_ieeShared — dispatch + finalisation harvest hook)
└── C8 (harness stub)

C3 (FailureReason)
└── C6, C7, C8 (all reference new failure reasons)

C5 (schema + migration)
├── C6 (visionGroundingService imports schema)
└── C9 (rollup job reads table)

C10 (skillParserServicePure — surfaces iee_decision_mode) — no internal deps
C11 (visionInferencePricing — costCents source) — no internal deps; read by C6/C8
C12 (docs) depends on C1 and C10
```

No backward references. C5 (DB migration) introduces the table; C6 (service) references it — in the correct order. No phase-boundary contradictions (single phase). All 12 chunks can land in a single PR in the dependency order above.

## §12 Execution-safety contracts

### 12.1 Idempotency

**`vision_inference_calls` harvest:** `state-based`. Harvest runs exactly once per `ieeRunId` (IEE finalisation is single-writer gated by terminal status predicate). **Ordering invariant:** harvest completes BEFORE the terminal `iee_runs.status` write — if harvest fails, the terminal write does not occur and the retry path re-attempts harvest while `iee_runs.status` is still `running`. If the harvest itself crashes mid-write and retries, it re-reads `vision_calls.json` and upserts rows via `INSERT ... ON CONFLICT (iee_run_id, step_index, call_index) DO NOTHING`. Safe to retry.

**Cost rollup writes:** `key-based`. `cost_aggregates` unique index on `(entityType, entityId, periodType, periodKey)`. Rollup uses `ON CONFLICT DO UPDATE`. Safe to retry.

### 12.2 Retry classification

| Operation | Classification | Rationale |
|---|---|---|
| `resolveEndpointConfig()` | `safe` | Read-only env-var resolution |
| vLLM HTTP call — `screenshot` action | `safe` | Observe-only; no side effects; safe to retry |
| vLLM HTTP call — `click`, `type`, `hotkey` (any non-idempotent action) | `unsafe` (V1) | V1 does NOT retry the vLLM call for non-idempotent actions on network error — the harness fails the step with `vision_inference_unavailable` (vision mode = fail run; hybrid mode = fail step per §8.8/§12.5). Smarter re-screenshot + re-infer policy is **deferred** (§13). |
| `harvestVisionCalls()` | `guarded` | Idempotent upsert (12.1) |
| Cost rollup job | `safe` | Idempotent upsert (12.1) |

### 12.3 Concurrency guards

**`vision_inference_calls` harvest:** Single-writer per run — IEE finalisation pipeline gates on `WHERE status = 'running'`. No race possible.

**Cost rollup job:** pg-boss `singletonKey` (same pattern as LLM rollup) prevents two instances processing the same period simultaneously.

**Vision decision loop:** Single-threaded inside the harness process. No concurrent writers to `vision_calls.json`.

### 12.4 Terminal event guarantee

The vision decision loop does not emit cross-flow events directly. It writes `vision_calls.json`, harvested during the existing IEE terminal-event pipeline. The single terminal event for the IEE run is `iee-run-completed`. Vision call records are subordinate harvest data within that pipeline. Post-terminal prohibition: `vision_calls.json` is flushed once at harness exit and is immutable thereafter.

### 12.5 No-silent-partial-success

`vision_inference_unavailable` mid-run:
- `vision` mode: harness exits `status: 'failed'`. No partial success masking.
- `hybrid` mode: the failing step exits `status: 'failed'` for that step. Harness exits `status: 'failed'`. Partial completion is surfaced as failure, not masked as success.

Missing endpoint at dispatch (`vision_inference_not_configured`): dispatch fails immediately before the sandbox is created. No artefacts, no `iee_runs` row with running status.

### 12.6 Unique-constraint HTTP mapping

`vision_inference_calls_iee_run_step_call_uniq` (`iee_run_id`, `step_index`, `call_index`):
- Violation on duplicate harvest retry: `ON CONFLICT DO NOTHING` — no 23505 bubbles. Harvest is internal; no HTTP caller.

No new HTTP routes write to `vision_inference_calls` in V1. Future routes must map 23505 → 409.

## §13 Deferred items

- **Full harness wiring** — `visionDecisionLoop.ts` is a loud-failure stub in V1. Screenshot capture, vLLM HTTP call, and Playwright action execution are wired as a targeted follow-up chunk once the e2b SDK is installed. Reason: e2b SDK installation is a separate infra milestone with its own dependency chain.
- **72B model size** — UI-TARS 72B excluded from V1. Follow-up build if 7B accuracy is insufficient for a specific workflow class.
- **Self-hosted GPU node** — V1 uses managed inference vendor. V2 option if cost or latency targets are not met at production load.
- **Configurable hybrid fallback threshold** — V1 hard-codes 1 retry per step. V2 option (`hybridFallbackRetries` in skill YAML) if operators report false fallbacks.
- **p95 latency alerting** — `latencyMs` column provides data; no alert job wired in V1. V2 option: a pg-boss alert job scanning `vision_inference_calls` for sustained p95 > 6 s.
- **Per-skill vision cost ceiling** — `runCostBreaker` enforces per-run ceilings globally. Per-skill vision cost ceiling deferred to V2.
- **Mid-run vision cost-breaker enforcement** — V1 rolls up vision costs to `cost_aggregates` only after run completion (async pg-boss job), so the breaker enforces against vision costs from the FOLLOWING run onward, not the run that incurred them (§3 framing assumption, §1 Goal 6). Mid-run enforcement (inline aggregate update during harvest, or per-call inline updates from the harness) is deferred. V1 ships a stub harness so the gap is theoretical until the follow-up wiring lands.
- **`ieeRuns.decision_mode` column** — `vision_inference_calls` FK to `ieeRunId` is sufficient for V1 observability. Dedicated column deferred if analytics demand it.
- **Non-idempotent vision action retry policy** — V1 does not retry on vLLM endpoint failure for non-idempotent actions. A smarter re-screenshot + re-infer policy deferred.
- **User-facing screenshot viewer** — deferred per brief. V1 run logs show typed actions; screenshots are not surfaced.

## §14 Self-consistency pass

- **Goals vs Implementation:** Goal 4 (harness loop) explicitly marked as stub in V1. Success criteria in Goal 8 that require the harness loop (10-workflow test set, latency p95) are not verifiable in V1 — §13 Deferred items documents this. No silent contradiction.
- **Every chunk has a verdict:** §6 chunk table has a `Verdict` column. All 12 chunks are `BUILD` in the single phase. No orphaned deferrals — all deferred work lives in §13.
- **Source-of-truth claims:** `VISION_INFERENCE_ENDPOINT_URL` is the single source for endpoint URL — not in DB. `vision_calls.json` is the single source for per-call records; `vision_inference_calls` is derived via harvest. No two representations can disagree on the same fact.
- **Non-functional goals vs execution model:** p95 ≤ 6 s target. Decision loop is inline within the harness process (no harvest round-trip per step), consistent with achieving sub-6 s action latency. Non-contradiction confirmed.
- **Load-bearing claims backed by mechanism:** §12.1 names the DB unique constraint and upsert strategy for every write path. No "idempotent" claim without a named mechanism.
- **Numeric-count reconciliation:** 10 new files + 9 modified files = 19 file entries in §7 (modified count went from 8 to 9 with the addition of `server/services/skillParserServicePure.ts` for the `iee_decision_mode` frontmatter field — see Finding 5). Section body references are consistent with §7. Migration count: 2 files (`.sql` + `.down.sql`) for 1 logical migration (`0373`). Table count: 1 new table (`vision_inference_calls`).

## §15 Testing posture

Per `docs/spec-context.md`:

```yaml
testing_posture: static_gates_primary
runtime_tests: pure_function_only
```

Tests in this build: `server/services/__tests__/visionActionParserPure.test.ts` — Vitest unit tests for the pure text parser. Covers all 9 `VisionAction` types, invalid inputs (non-action text, missing coordinates, negative coordinates, non-integer coordinates), whitespace normalization. Pure function only — no network calls, no DB.

Tests NOT in this build (per `spec-context.md`):
- No integration tests for `visionGroundingService` (API contract tests deferred per posture).
- No e2e tests for `visionDecisionLoop` (harness is a stub; e2b SDK not installed).
- No latency regression tests (deferred to production monitoring).
- No frontend tests.

## §16 Open questions

All open questions from `tasks/builds/browser-vision-grounding/intent.md` were resolved in the grill-me session (2026-05-18, 11 rounds). Full log in `intent.md § Grill-me Q&A`. No open questions remain for Phase 2.

Key decisions constraining the architect's plan:

1. Inference hosting: managed vendor (V1). Architect picks specific vendor and confirms GPU class.
2. `decisionMode` on `SandboxRunTaskInput` — follow `humanize` optional-field pattern.
3. Hybrid fallback: 1 retry per step, hard-coded in V1.
4. `vision_inference_unavailable`: `vision` mode fails run; `hybrid` mode fails step.
5. Harness loop: stub in V1 (`visionDecisionLoop.ts` fails loudly).
6. Loop runs inside harness; sandbox network allowlist for vision-mode tasks.
7. Skill YAML: `iee_decision_mode: dom | vision | hybrid`.
8. Cost ledger: `vision_inference_calls` table + pg-boss rollup to `cost_aggregates`.
9. Action parser: native text format (`visionActionParserPure.ts`).
10. Logic split: `visionDecisionLoop.ts` (harness) + `visionGroundingService.ts` (server).
11. Missing endpoint: fail at dispatch (before sandbox creation) via `visionGroundingService.resolveEndpointConfig()` with `vision_inference_not_configured`. Consistent with §8.8 and §12.5.

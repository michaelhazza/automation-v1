**Status:** ready_for_execution
**Plan date:** 2026-05-18
**Author:** architect (Opus, 2026-05-18)
**Build slug:** `browser-vision-grounding`
**Scope class:** Major
**Spec:** `docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md`
**Branch:** `main` (work begins on a fresh branch off `main` cut by `feature-coordinator`)

---

## Executor notes

Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.

Per-chunk verification is limited to:
- `npm run lint`
- `npm run typecheck` (or `npx tsc --noEmit`)
- `npm run build:server` / `npm run build:client` when the chunk touches the build surface
- `npx vitest run <path-to-test>` for tests authored in THIS chunk

CI runs the full suite as a pre-merge gate. Do not pre-empt it.

---

## Table of contents

1. Model-collapse check
2. Architecture notes
   - 2.1 Vendor selection — RunPod A10G
   - 2.2 UI-TARS commit hash
   - 2.3 Migration number
   - 2.4 Pricing constants
   - 2.5 `ieeFinalise()` transaction boundary
   - 2.6 Pattern selection
   - 2.7 Spec deviations
   - 2.8 Pre-existing violation
3. Chunk dependency graph
4. Per-chunk detail (C1–C12)
5. Risks and mitigations
6. Self-consistency pass

---

## 1. Model-collapse check

The three-question pre-check:

1. **Does this feature decompose into ingest → extract → transform → render?** Partially. Each step is screenshot → VLM call → parsed action → executed action. But there is no multi-stage pipeline of model calls; each loop iteration is a SINGLE multimodal model call.
2. **Is each step doing something a frontier multimodal model could do in a single call?** Yes — the VLM call IS the model call. We are not stacking decoder calls.
3. **Can the whole pipeline collapse into one call?** It already IS one call per action step. The decision loop runs the same single call iteratively because each call's output (an action) changes the screen state and so the input to the next call. The "loop" is not pipeline stages; it is a Markov decision process whose state is the screen. Collapsing across iterations would require the model to output a full multi-step plan in advance, which is precisely the DOM-mode failure pattern vision grounding exists to escape.

**Decision:** rejected — the architecture is already at the minimum-call shape. The "loop" is an MDP over screen state, not a pipeline of stages.

---

## 2. Architecture notes

### 2.1 Vendor selection — RunPod A10G

**Decision:** RunPod managed inference, NVIDIA A10G (24 GB VRAM) GPU class, vLLM 0.6.x runtime, UI-TARS-7B FP16 weights.

**Rationale:** A10G is the cheapest 24 GB GPU class that fits UI-TARS-7B (≈14 GB FP16) with vLLM PagedAttention overhead and a 2048-token KV-cache budget. On-demand pricing ≈ $0.39/hr (≈ $0.000108/sec). Replicate is more expensive per-second and adds cold-start penalties incompatible with the p95 ≤ 6 s target. Lambda Labs is competitive but supplies dedicated bare-metal which is over-provisioned for our request volume profile in V1.

**Considered and rejected:**
- **Lambda Labs A10** — comparable hardware, ≈40 % more expensive per-hour for V1 burst load.
- **Replicate `bytedance/ui-tars-7b`** — managed but cold-start latency unpredictable; first-call p95 routinely > 15 s.
- **Self-hosted GPU node** — V1 deferred per spec §13. Reasonable V2 if cost/latency targets miss.
- **OpenAI gpt-4o vision** — closed-source, no UI-TARS native action grammar, ≈ 25× cost; violates §1 Goal 2 (no ByteDance / closed-vendor calls).

**Vendor identity is not persisted to the DB.** `VISION_INFERENCE_ENDPOINT_URL` is the only env var that names the vendor. A future vendor swap is an env-var change, no code change, no migration.

### 2.2 UI-TARS commit hash — `bytedance/UI-TARS@bc25e5f` (v1.5-7b stable)

**Decision:** Pin the UI-TARS native action grammar against the v1.5-7b stable release at GitHub commit `bc25e5f`. The parser embeds this constant:

```typescript
// shared/types/visionActions.ts
export const UI_TARS_GRAMMAR_VERSION = 'bytedance/UI-TARS@bc25e5f' as const;
```

**Implementation note for the builder:** before opening C1, verify the latest UI-TARS stable tag at `https://github.com/bytedance/UI-TARS/releases`. If a newer stable release exists at plan execution time, pin the exact commit SHA of THAT release instead. The hash is a literal constant; do not let it drift to a moving branch reference.

The parser's Vitest suite includes a fixture file at `server/services/__tests__/fixtures/ui-tars-grammar-bc25e5f.txt` (one representative input per action verb) so a future grammar bump produces a fixture-diff that surfaces in code review.

### 2.3 Migration number — `0378`

Current migration head: `0377_rename_fast_path_decisions_brief_id_to_task_id`. Next available number: **`0378`**. Files to create:

- `migrations/0378_vision_inference_calls.sql`
- `migrations/0378_vision_inference_calls.down.sql`

Per `DEVELOPMENT_GUIDELINES.md §6`, migration numbers are assigned at merge time. If another build merges to `main` between this plan's authoring and execution, the executor renumbers to the next available number in the same commit as the schema change. The placeholder `<next>` in the spec resolves to `0378` at plan time.

### 2.4 Pricing constants — RunPod A10G time-based, per-call

**Decision:** time-based pricing keyed on observed latency, since self-hosted vLLM does not separately meter input/output tokens at the API surface.

```typescript
// shared/visionInferencePricing.ts
export interface VisionPricingRate {
  /** Baseline cost per inference call, in cents (amortises image decode + per-request overhead). */
  perImageCents: number;
  /** Cost per output token, in cents. Zero for self-hosted vLLM (compute-amortised). */
  perOutputTokenCents: number;
  /** GPU-time cost per second of latency, in cents. */
  perSecondCents: number;
}

export const VISION_PRICING_RATES: Record<string, VisionPricingRate> = {
  'ui-tars-7b': {
    perImageCents: 0.03,        // baseline per-call: image decode + scheduler overhead
    perOutputTokenCents: 0,     // self-hosted vLLM does not meter output tokens separately
    perSecondCents: 0.011,      // RunPod A10G on-demand: $0.39/hr / 3600 * 100 = 0.0108 c/s; rounded up
  },
};
```

The formula `computeCostCents({ modelId, imageSizeBytes, latencyMs, outputTokens })` returns:

```
Math.round( rate.perImageCents
          + (latencyMs / 1000) * rate.perSecondCents
          + outputTokens * rate.perOutputTokenCents )
```

with `Math.round` floor of 0 (sub-cent rounds to 0; legitimate per spec §8.4). Unknown `modelId` throws `Error('Unknown vision model: <modelId>')` — never silently returns 0.

**Worked example.** A 2 100 ms inference call against `ui-tars-7b` with 30 output tokens: `0.03 + 2.1 * 0.011 + 30 * 0 = 0.0531 c -> Math.round -> 0 c`. A 5 000 ms call: `0.03 + 5.0 * 0.011 = 0.085 c -> 0 c`. A 30 000 ms call (timeout boundary): `0.03 + 30 * 0.011 = 0.36 c -> 0 c`. Sub-cent costs are the steady state in V1 because of the small RunPod hourly rate; aggregate per-run costs (10–25 calls/run) surface as 1–5 cents per run, which is the granularity the §1 Goal 6 cost ceilings operate on. This is intentional: per-call rounding to 0 cents is acceptable when aggregated rollups carry the billing signal.

**Future-proofing rationale:** the schema (per-image + per-token + per-second) generalises so a vendor swap to a token-metered API (e.g. Replicate, or OpenRouter once UI-TARS lands there) is a rate-table edit, not a formula edit.

### 2.5 `ieeFinalise()` transaction boundary — harvest is the first statement of `ieeFinalise`

**Decision:** `harvestVisionCalls(tx, ieeRun)` is the FIRST statement inside `ieeFinalise()` (`server/services/executionBackends/_ieeShared.ts:510`), executed BEFORE the existing `eventEmittedAt` stamp on `iee_runs` and BEFORE the parent `agent_runs` terminal-status update. All writes live inside the orchestrator-provided `tx` (the orchestrator already wraps `ieeFinalise` in a `db.transaction(...)` per the existing finalisation pipeline).

**Why this ordering, not the spec's literal "before the iee_runs status update":** the actual `iee_runs.status='completed'` write for browser flows happens INSIDE the harness inside the sandbox (when the harness exits with `status: 'completed'` and writes `/workspace/output.json`, which the sandbox provider surfaces via `terminalState: 'completed'` to `sandboxRunTask`), or for cancellation flows in `agentRunCancelService`. By the time `ieeFinalise()` runs, `iee_runs.status` is ALREADY terminal — the spec's literal ordering pre-dates this knowledge.

The architect's correction: **co-locating the harvest writes inside the SAME `tx` that updates `agent_runs` and stamps `iee_runs.eventEmittedAt` is sufficient to preserve the spec invariant** (no partial-success masking). If harvest throws, the entire `tx` rolls back including `eventEmittedAt`; the pg-boss event handler retries; the next attempt re-reads `vision_calls.json` and re-upserts via `ON CONFLICT (iee_run_id, step_index, call_index) DO NOTHING`. Harvest is idempotent (per spec §12.1); re-running it inside the retry is safe.

**What this means for the executor:** when implementing C7, the call site is the FIRST executable statement in `ieeFinalise()`, before the existing `if (ieeRun.status !== 'completed' && ...)` guard:

- `await visionGroundingService.harvestVisionCalls(tx, ieeRun);`

Then the existing `ieeFinalise` body runs unchanged below.

Note that `harvestVisionCalls` is called with the row regardless of `decisionMode`. The service early-exits when `vision_calls.json` is absent (the dom-mode no-op path). This keeps the dispatch path tier-agnostic.

### 2.6 Pattern selection — Single Responsibility, Adapter, Pure-function harness

**Service decomposition** (Single Responsibility):
- `visionGroundingService.ts` — server-side: env resolution + harvest. Does NOT do inference. Does NOT touch the harness.
- `visionDecisionLoop.ts` — harness-side: inference loop. Does NOT touch the DB. Does NOT resolve config.
- `visionActionParserPure.ts` — pure: text → typed action. Zero side effects.
- `visionInferencePricing.ts` — pure: dimensions → cents. Zero side effects.

**Adapter pattern rejected.** UI-TARS speaks OpenAI-compatible chat-completions over HTTPS; the `fetch` call is the adapter. Layering a `VisionProvider` interface here would be premature abstraction (one provider in V1, no immediate plan for a second). When a second vendor lands, three-similar-lines applies: extract on the FOURTH call site, not the first.

**Composition over inheritance** for the harness routing: the harness `main()` function reads `input.decisionMode` and dispatches to `runDomLoop()` or `visionDecisionLoop()`. No class hierarchy.

### 2.7 Spec deviations

**Spec literal ordering for harvest correction.** Spec §12.1 / §8.7 reads "harvest is called immediately before the UPDATE iee_runs SET status = $terminal SQL statement." The architect's plan corrects this: harvest is the FIRST statement of `ieeFinalise()`, which runs AFTER `iee_runs.status` is terminal (the literal ordering pre-dates the post-PR-#345 worker-retirement reality where harness writes terminal status directly). The spec invariant is preserved by transaction co-location with `eventEmittedAt` and the parent `agent_runs` update — see §2.5 above. C12 (docs chunk) updates `docs/iee-development-spec.md` to reflect this; the spec itself is not edited because spec amendments are out of scope at plan time, but `progress.md` records the deviation for `spec-conformance`.

**`computeCostCents` signature extension.** Spec §8.4 lists the signature as `computeCostCents({ modelId, imageSizeBytes, latencyMs, outputTokens })`. The plan keeps that signature literal; `imageSizeBytes` is recorded on `VisionCallRecord` for observability but does NOT enter the cost formula (the spec's example pricing leaves it implicit, and self-hosted vLLM cost is dominated by GPU time). The pricing-test suite asserts `imageSizeBytes` does not affect the cost output; if a vendor swap requires per-byte pricing, extend `VisionPricingRate` with `perInputByteCents` in the same chunk that adds the new vendor entry.

### 2.8 Pre-existing violation to fix in Chunk 1

None identified by static reasoning. `_ieeShared.ts` already follows the org-scoping conventions; `cost_aggregates` already supports `source_type`; `FailureReason` enum is the canonical Zod enum already in use. No baseline violations interact with the planned work.

---

## 3. Chunk dependency graph

Single phase, single PR. Ordered to surface contracts before consumers. Names are descriptive per CLAUDE.md.

```
C1  shared/types/visionActions.ts                (foundation: action union + decision mode)
+-- C2  visionActionParserPure.ts + tests        (depends C1)
+-- C4  SandboxRunTaskInput extension            (depends C1)
|   +-- C6  visionGroundingService               (depends C1, C3, C4, C5, C11)
|       +-- C7  _ieeShared dispatch + harvest    (depends C3, C4, C6, C10)
+-- C8  Harness stub + visionDecisionLoop        (depends C1, C3, C4, C11)

C3  FailureReason enum (2 new values)            (no internal deps)
+-- consumed by C6, C7, C8

C5  vision_inference_calls schema + migration    (no internal deps)
+-- C6  service imports schema
+-- C9  rollup job reads table

C11 visionInferencePricing.ts + tests            (no internal deps)
+-- C6  service validates cost parity
+-- C8  harness imports computeCostCents (stubbed in V1, real wiring in follow-up)

C10 skillParserServicePure iee_decision_mode     (no internal deps)
+-- C7  dispatch reads ParsedSkill.ieeDecisionMode -> ieeTask.decisionMode wiring
+-- consumed by C12

C12 Docs (iee-development-spec.md)               (depends C1, C10)
```

**Note on C10 -> C7 dependency (ChatGPT Round 1 finding #1):** C7 reads `ieeTask?.decisionMode` from the dispatch envelope. This field is populated by the skill-executor code that reads `ParsedSkill.ieeDecisionMode` (C10). C10 must land before C7. If `ieeTask.decisionMode` is not yet present in the dispatch envelope at execution time, the C10 acceptance criterion is expanded: add the one-line `ieeTask.decisionMode = parsedSkill.ieeDecisionMode ?? null` threading at the existing skill-executor dispatch site in the same C10 commit, not deferred to C7.

Forward-only dependencies; no backward references. C5 (DB) precedes C6 (service). C11 (pricing) precedes C6 (cost-parity validation) and C8 (harness import). All 12 chunks land in a single PR.

---

## 4. Per-chunk detail

### C1 — Vision action union + decision mode types

**spec_sections:** §8.1 (lines 173–217), §16 item 7 (decision-mode taxonomy)

**Files to create:**
- `shared/types/visionActions.ts`

**Module shape:**
- *Public interface:* `VisionDecisionMode` type, `VisionAction` discriminated union (9 variants), `UI_TARS_GRAMMAR_VERSION` constant.
- *Hidden behind it:* nothing — pure types module. All fields are inline literals; no internal state, no helpers. Intentionally a leaf module so every downstream consumer (parser, harness, service, pricing) imports a stable shape.

**Contracts:**

```typescript
// shared/types/visionActions.ts
/**
 * UI-TARS grammar version this build is pinned against.
 * Bump in the same commit as the parser fixture file when the upstream grammar changes.
 */
export const UI_TARS_GRAMMAR_VERSION = 'bytedance/UI-TARS@bc25e5f' as const;

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

Invariants per spec §8.1:
- `x`, `y` are non-negative integers
- `dx`, `dy` are signed integers
- `ms` is a positive integer
- `type: 'done'` terminates the loop; `type: 'screenshot'` is observe-only

**Error handling:** none — types module has no runtime behaviour.

**Test considerations:** none in this chunk. Type-shape tests live with the parser (C2).

**Dependencies:** none.

**Acceptance criteria:**
- File compiles cleanly under `npm run typecheck`.
- Constant `UI_TARS_GRAMMAR_VERSION` matches the architect's chosen hash (see §2.2 — verify latest UI-TARS stable tag at execution time).
- Discriminated union has exactly 9 variants (spec §8.1).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`

---

### C2 — UI-TARS native text parser + Vitest tests

**spec_sections:** §8.1 (parser input grammar, lines 196–218), §15 (testing posture)

**Files to create:**
- `server/services/visionActionParserPure.ts`
- `server/services/__tests__/visionActionParserPure.test.ts`
- `server/services/__tests__/fixtures/ui-tars-grammar-bc25e5f.txt`

**Module shape:**
- *Public interface:* `parseVisionAction(line: string): VisionAction` (throws `ParseError` on invalid input), `ParseError` typed error class.
- *Hidden behind it:* per-verb regex parsers (`parseClick`, `parseType`, `parseScroll`, `parseHotkey`, `parseWait`, etc.), whitespace normaliser, the lookup table mapping verb tokens to parser functions, and the integer-validation helpers (`assertNonNegativeInt`, `assertSignedInt`, `assertPositiveInt`). Callers do not pick a per-verb parser; they pass a line and get back a `VisionAction` or an exception.

**Contracts:**

```typescript
// server/services/visionActionParserPure.ts
import type { VisionAction } from '../../shared/types/visionActions.js';

export class ParseError extends Error {
  readonly _tag = 'VisionActionParseError' as const;
  constructor(message: string, readonly input: string) { super(message); }
}

/**
 * Parses one line of UI-TARS native action text into a typed VisionAction.
 * Throws ParseError on unknown verb, missing args, non-integer coordinates,
 * negative x/y/ms, or malformed combo strings.
 * Normalises: leading/trailing whitespace, repeated internal whitespace.
 */
export function parseVisionAction(line: string): VisionAction;
```

**Error handling:**
- Unknown verb -> `ParseError('unknown verb: <verb>', line)`
- Missing required arg -> `ParseError('missing argument: <name>', line)`
- Non-integer coord -> `ParseError('expected integer for <field>', line)`
- Negative `x`/`y`/`ms` -> `ParseError('negative value not allowed for <field>', line)`
- Malformed `combo` -> `ParseError('invalid hotkey combo: <value>', line)`

`ParseError` is the only thrown shape; callers branch on `_tag === 'VisionActionParseError'`. The harness will catch this as a parsed-output error and write the step as `vision_inference_unavailable` (per spec §8.8 — the harness treats invalid grammar as inference-layer unavailability).

**Test considerations:**
- One happy-path case per action type (9 cases, mirroring §8.1 worked examples).
- Whitespace normalisation: leading whitespace, trailing whitespace, mixed-whitespace inside args.
- Rejection cases: unknown verb (`'noverb()'`), missing arg (`'click(340)'`), non-integer (`'click(3.5, 220)'`), negative (`'click(-1, 220)'`), negative `ms` (`'wait(-1500)'`), malformed combo (`'hotkey("")'`).
- Fixture file `ui-tars-grammar-bc25e5f.txt` contains one canonical line per verb; the test reads it and asserts every line parses to a non-throwing `VisionAction`.

**Dependencies:** C1 (consumes `VisionAction` type).

**Acceptance criteria:**
- All 9 action types parse to their expected discriminant.
- All 6 rejection cases above throw `ParseError`.
- Whitespace normalisation cases pass.
- Fixture file parses end-to-end without throwing.
- File name ends in `Pure.ts` and has zero DB / network / FS-write imports (`fs.readFileSync` for the fixture is in the test file, not the parser — the parser is pure-pure).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/__tests__/visionActionParserPure.test.ts`

### C3 — FailureReason enum: two new values

**spec_sections:** §8.8 (lines 366–373), §12.5 (run-failure semantics)

**Files to modify:**
- `shared/iee/failureReason.ts`

**Module shape:**
- *Public interface:* the existing `FailureReason` Zod enum gains two new string members.
- *Hidden behind it:* nothing — one-line append per value.

**Contracts:**

Add to the `z.enum([...])` array, immediately after the existing `'iee_dev_backend_retired'` entry and before `'unknown'`:

```typescript
// Vision grounding additions (browser-vision-grounding spec §8.8).
'vision_inference_not_configured', // VISION_INFERENCE_ENDPOINT_URL absent or non-HTTPS at dispatch
'vision_inference_unavailable',    // vLLM endpoint non-2xx / timeout / malformed mid-run
```

**Error handling:** none — Zod enum literal.

**Test considerations:** no new tests. The existing `FailureReason` Zod parser tests cover enum extension automatically; if those tests assert a fixed member count, update the count assertion in the same commit. (Search for `FailureReason.options.length` and similar.)

**Dependencies:** none.

**Acceptance criteria:**
- `FailureReason.parse('vision_inference_not_configured')` returns the string.
- `FailureReason.parse('vision_inference_unavailable')` returns the string.
- No existing call site is broken (the enum is open at the consumer level — all switches that branch on `FailureReason` already have a `default` per the `unknown` fallback convention).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`

---

### C4 — `SandboxRunTaskInput` extension

**spec_sections:** §8.2 (lines 219–231), §8.3 (lines 233–256)

**Files to modify:**
- `shared/types/sandbox.ts`

**Module shape:**
- *Public interface:* four new optional fields on `SandboxRunTaskInput`.
- *Hidden behind it:* nothing — interface extension.

**Contracts:**

Add to `SandboxRunTaskInput` after the existing `humanize?` field:

```typescript
/**
 * Vision-grounding decision mode (browser-vision-grounding spec §8.2).
 * Absent or `null` = 'dom' (existing behaviour).
 */
decisionMode?: import('./visionActions.js').VisionDecisionMode | null;
/**
 * Self-hosted vLLM endpoint URL (HTTPS). Required when decisionMode !== 'dom'.
 * Resolved server-side by visionGroundingService.resolveEndpointConfig().
 * Never persisted; lives in the in-flight task envelope only.
 */
visionEndpointUrl?: string | null;
/**
 * Optional bearer token for the vLLM endpoint. Redacted from all persisted
 * artefacts, logs, and failure payloads (spec §8.3 redaction contract).
 */
visionEndpointToken?: string | null;
/**
 * Resolved model id stamped onto VisionCallRecord.modelId. Required when
 * decisionMode !== 'dom'. Default 'ui-tars-7b' (resolved by resolveEndpointConfig).
 */
visionModelId?: string | null;
```

**Error handling:** none — interface extension.

**Test considerations:** none in this chunk; service-layer tests in C6 cover the population path.

**Dependencies:** C1 (`VisionDecisionMode` import).

**Acceptance criteria:**
- All four fields are optional and accept `null`.
- File compiles cleanly under `npm run typecheck`.
- The dynamic `import('./visionActions.js')` form matches the existing pattern used for `humanize` and `proxyAlignment` (avoids a static cycle with the in-sandbox harness).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`

### C5 — `vision_inference_calls` schema and migration `0378`

**spec_sections:** §8.5 (lines 294–324), §9 (lines 387–398)

**Files to create:**
- `server/db/schema/visionInferenceCalls.ts`
- `migrations/0378_vision_inference_calls.sql`
- `migrations/0378_vision_inference_calls.down.sql`

**Files to modify:**
- `server/db/schema/index.ts` — export `visionInferenceCalls`
- `server/config/rlsProtectedTables.ts` — add manifest entry

**Module shape:**
- *Public interface:* the `visionInferenceCalls` Drizzle table object, exported through `server/db/schema/index.ts`. Manifest entry visible to RLS gates.
- *Hidden behind it:* the column definitions, the unique constraint, the index choices, and the FORCE-RLS policy. Service consumers (C6) construct rows via Drizzle's typed insert; they do not write raw SQL.

**Contracts:**

Schema file:

```typescript
// server/db/schema/visionInferenceCalls.ts
import { pgTable, uuid, text, integer, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
import { organisations } from './organisations.js';
import { subaccounts } from './subaccounts.js';
import { agentRuns } from './agentRuns.js';
import { ieeRuns } from './ieeRuns.js';

export const visionInferenceCalls = pgTable('vision_inference_calls', {
  id:              uuid('id').defaultRandom().primaryKey(),
  organisationId:  uuid('organisation_id').notNull().references(() => organisations.id, { onDelete: 'restrict' }),
  subaccountId:    uuid('subaccount_id').references(() => subaccounts.id, { onDelete: 'set null' }),
  runId:           uuid('run_id').notNull().references(() => agentRuns.id, { onDelete: 'restrict' }),
  ieeRunId:        uuid('iee_run_id').notNull().references(() => ieeRuns.id, { onDelete: 'restrict' }),
  modelId:         text('model_id').notNull(),
  costCents:       integer('cost_cents').notNull().default(0),
  latencyMs:       integer('latency_ms').notNull(),
  imageSizeBytes:  integer('image_size_bytes').notNull(),
  actionType:      text('action_type').notNull(),
  fallbackTrigger: boolean('fallback_trigger').notNull().default(false),
  stepIndex:       integer('step_index').notNull(),
  callIndex:       integer('call_index').notNull(),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ieeRunStepCallUniq: unique('vision_inference_calls_iee_run_step_call_uniq')
    .on(t.ieeRunId, t.stepIndex, t.callIndex),
}));
```

Migration `0378_vision_inference_calls.sql`:

```sql
-- Migration 0378: Create vision_inference_calls ledger table
--
-- Per-vision-call cost ledger for browser-vision-grounding (spec §8.5).
-- One row per vLLM inference call within a vision-mode IEE run. Idempotent
-- harvest key on (iee_run_id, step_index, call_index) — duplicate harvest
-- retries use ON CONFLICT DO NOTHING.
--
-- RLS: org-isolation policy keyed on app.organisation_id GUC (two-arg form,
-- fails closed on unset GUC). Subaccount filtering is service-layer (per the
-- llm_requests / agent_runs convention).
--
-- Spec: docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md §8.5, §9

CREATE TABLE vision_inference_calls (
  id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organisation_id   UUID        NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  subaccount_id     UUID        REFERENCES subaccounts(id) ON DELETE SET NULL,
  run_id            UUID        NOT NULL REFERENCES agent_runs(id) ON DELETE RESTRICT,
  iee_run_id        UUID        NOT NULL REFERENCES iee_runs(id) ON DELETE RESTRICT,
  model_id          TEXT        NOT NULL,
  cost_cents        INTEGER     NOT NULL DEFAULT 0,
  latency_ms        INTEGER     NOT NULL,
  image_size_bytes  INTEGER     NOT NULL,
  action_type       TEXT        NOT NULL,
  fallback_trigger  BOOLEAN     NOT NULL DEFAULT false,
  step_index        INTEGER     NOT NULL,
  call_index        INTEGER     NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT vision_inference_calls_iee_run_step_call_uniq
    UNIQUE (iee_run_id, step_index, call_index)
);

-- Org-scoped index for the daily rollup job's GROUP BY.
CREATE INDEX vision_inference_calls_org_created_at_idx
  ON vision_inference_calls (organisation_id, created_at);

-- RLS: org-isolation only. Subaccount filter is service-layer.
ALTER TABLE vision_inference_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE vision_inference_calls FORCE ROW LEVEL SECURITY;
CREATE POLICY vision_inference_calls_org_isolation ON vision_inference_calls
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);
```

Migration `0378_vision_inference_calls.down.sql`:

```sql
DROP TABLE IF EXISTS vision_inference_calls;
```

`rlsProtectedTables.ts` entry (append in migration order):

```typescript
{
  tableName: 'vision_inference_calls',
  schemaFile: 'visionInferenceCalls.ts',
  policyMigration: '0378_vision_inference_calls.sql',
  rationale: 'Per-call vLLM inference cost ledger; org-scoped billing surface, not PII but tenant-confidential.',
},
```

**Error handling:** none at schema layer; FK `ON DELETE RESTRICT` on `agent_runs` / `iee_runs` prevents accidental orphaning. Subaccount FK is `SET NULL` to align with the existing `llm_requests` convention for tenant-scoped tables where subaccounts can be soft-removed.

**Test considerations:** none in this chunk. CI gates `verify-rls-coverage.sh` and `verify-rls-contract-compliance.sh` will check the manifest entry and policy SQL against each other.

**Dependencies:** none.

**Acceptance criteria:**
- `npm run db:generate` produces a clean diff: no unexpected schema changes.
- Migration file passes `migrations/<NNNN>_<name>.sql` naming convention.
- Down-migration is idempotent (`DROP TABLE IF EXISTS`).
- Manifest entry is in migration order.
- File `server/db/schema/visionInferenceCalls.ts` only imports from `drizzle-orm`, other schema files, and `shared/types/**` (per `DEVELOPMENT_GUIDELINES.md §3`).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run db:generate` — verify migration diff is clean

**Renumber discipline:** if another build merges to `main` first, renumber `0378` to the next available number in the same commit and update the manifest's `policyMigration` field to match. Re-run `npm run db:generate` to verify Drizzle / migration alignment.

### C11 — Vision inference pricing constants + tests

**spec_sections:** §8.4 (lines 257–290), §15 (testing posture)

**Files to create:**
- `shared/visionInferencePricing.ts`
- `shared/__tests__/visionInferencePricing.test.ts`

**Module shape:**
- *Public interface:* `computeCostCents(input: ComputeCostInput): number`, `VISION_PRICING_RATES` constant table, `VisionPricingRate` interface.
- *Hidden behind it:* the rate-lookup table indexing, the `Math.round` rounding policy, the unknown-model error message format. Callers pass cost dimensions and get back an integer cents value. They do not pick rates per-vendor — that lives in the table.

**Contracts:**

```typescript
// shared/visionInferencePricing.ts
// Pure pricing module — no I/O, no DB, no network. Importable by both the
// in-sandbox harness and the server-side service.

export interface VisionPricingRate {
  /** Baseline cost per inference call in cents (amortises image decode + per-request overhead). */
  perImageCents: number;
  /** Cost per output token in cents. Zero for self-hosted vLLM (compute-amortised). */
  perOutputTokenCents: number;
  /** GPU-time cost per second of latency in cents. */
  perSecondCents: number;
}

export interface ComputeCostInput {
  modelId: string;
  imageSizeBytes: number;
  latencyMs: number;
  outputTokens: number;
}

/**
 * Rate table keyed by modelId. The architect plan pins per-vendor rates here.
 * `ui-tars-7b` corresponds to RunPod A10G on-demand pricing as of 2026-05-18.
 */
export const VISION_PRICING_RATES: Record<string, VisionPricingRate> = {
  'ui-tars-7b': {
    perImageCents: 0.03,
    perOutputTokenCents: 0,
    perSecondCents: 0.011,
  },
};

/**
 * Computes integer cents cost for a single vision inference call.
 * Throws Error('Unknown vision model: <modelId>') on unrecognised modelId.
 * `Math.round` applied to the raw float; sub-cent costs round to 0 (legitimate).
 */
export function computeCostCents(input: ComputeCostInput): number {
  const rate = VISION_PRICING_RATES[input.modelId];
  if (!rate) {
    throw new Error(`Unknown vision model: ${input.modelId}`);
  }
  const raw =
    rate.perImageCents +
    (input.latencyMs / 1000) * rate.perSecondCents +
    input.outputTokens * rate.perOutputTokenCents;
  return Math.max(0, Math.round(raw));
}
```

**Error handling:**
- Unknown `modelId` throws `Error('Unknown vision model: <modelId>')` — never returns 0 silently (spec §8.4 placeholder behaviour contract).
- Negative `latencyMs` or `outputTokens` are passed through (caller responsibility); `Math.max(0, ...)` guarantees a non-negative result.

**Test considerations (Vitest, pure):**
- `computeCostCents({ modelId: 'ui-tars-7b', imageSizeBytes: 241500, latencyMs: 2100, outputTokens: 30 })` returns `0` (sub-cent rounding — spec §8.4 worked example produces an integer >0 only at much higher latency).
- `computeCostCents({ modelId: 'ui-tars-7b', latencyMs: 60_000, ... })` returns a `Math.round`-rounded integer matching the architect's pricing formula (`0.03 + 60 * 0.011 = 0.69 -> 1`).
- `computeCostCents({ modelId: 'ui-tars-7b', latencyMs: 0, outputTokens: 0, imageSizeBytes: 0 })` returns `0` (sub-cent rounding from baseline 0.03 c).
- `computeCostCents({ modelId: 'unknown', ... })` throws `Error('Unknown vision model: unknown')`.
- Sub-cent 0-floor behaviour: a synthetic rate that produces `-0.001 c` raw rounds to `0`, not `-0`.

**Dependencies:** none.

**Acceptance criteria:**
- All four test cases pass.
- File name ends in `.ts` (not `.test.ts`), test file is the `__tests__` sibling.
- File location is `shared/visionInferencePricing.ts` — accessible from both the server and the in-sandbox harness without crossing a server-package boundary (matches `shared/iee/failure.ts` and `shared/types/sandbox.ts` precedent).
- `verify-pure-helper-convention.sh` (CI) accepts the pure-helper naming — the file is NOT named `*Pure.ts` because it lives under `shared/` and the convention only applies to `server/services/*Pure.ts`; verify by reading the gate script before submission. If the gate requires the `Pure` suffix universally, rename to `shared/visionInferencePricingPure.ts` in the same commit and update spec §7 reference paths via the C12 docs chunk.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run shared/__tests__/visionInferencePricing.test.ts`

### C6 — `visionGroundingService` (config resolution + harvest)

**spec_sections:** §8.6 (lines 326–338), §10 (lines 400–429), §12.1 (idempotency), §8.3 (token redaction)

**Files to create:**
- `server/services/visionGroundingService.ts`

**Module shape:**
- *Public interface:* two methods:
  - `resolveEndpointConfig(): { endpointUrl: string; apiKey: string | null; modelId: string }` — synchronous, env-var reads only; throws `FailureError(failure('vision_inference_not_configured', ...))` when URL is absent or non-HTTPS.
  - `harvestVisionCalls(tx: Transaction, ieeRun: IeeRunRow): Promise<void>` — reads `/workspace/artefacts/vision_calls.json` via the harvested artefact path, parses the Zod schema, idempotent upsert into `vision_inference_calls`. Early-exits when the file is absent (dom-mode flow).
- *Hidden behind it:* the env-var name constants, the Zod schema for `VisionCallRecord`, the per-row cost-parity validation (re-computes `computeCostCents` from C11 dimensions and warns on mismatch), the `ON CONFLICT (iee_run_id, step_index, call_index) DO NOTHING` SQL detail, the artefact-store read path (`sandboxArtefactRefs` lookup), and the redaction guard that strips `visionEndpointToken` from any error message before it surfaces.

**Contracts:**

```typescript
// server/services/visionGroundingService.ts
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { visionInferenceCalls } from '../db/schema/visionInferenceCalls.js';
import { computeCostCents } from '../../shared/visionInferencePricing.js';
import { FailureError, failure } from '../../shared/iee/failure.js';
import { logger } from '../lib/logger.js';
import type { Transaction } from '../db/index.js';

export interface VisionEndpointConfig {
  endpointUrl: string;
  apiKey: string | null;
  modelId: string;
}

const VisionCallRecordSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  callIndex: z.number().int().nonnegative(),
  modelId: z.string().min(1),
  costCents: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  imageSizeBytes: z.number().int().nonnegative(),
  actionType: z.string().min(1),
  fallbackTrigger: z.boolean(),
});
const VisionCallsArtefactSchema = z.array(VisionCallRecordSchema);

export const visionGroundingService = {
  resolveEndpointConfig(): VisionEndpointConfig { /* ... */ },
  async harvestVisionCalls(
    tx: Transaction,
    // agentRunId is string | null in the DB row type but MUST be non-null at harvest
    // time. The implementation asserts non-null before any INSERT and throws
    // 'vision.harvest.missing_agent_run_id' if violated (ChatGPT Round 1 finding #3).
    ieeRun: { id: string; organisationId: string; subaccountId: string | null; agentRunId: string | null },
  ): Promise<void> { /* ... */ },
};
```

**`resolveEndpointConfig` semantics:**
- Read `VISION_INFERENCE_ENDPOINT_URL`, `VISION_INFERENCE_API_KEY`, `VISION_INFERENCE_MODEL_ID` via `env` (`server/lib/env.ts`).
- Throw `FailureError(failure('vision_inference_not_configured', 'VISION_INFERENCE_ENDPOINT_URL is not set'))` when URL is absent.
- Parse URL via `new URL(...)`; throw `FailureError(failure('vision_inference_not_configured', 'must be HTTPS'))` when `protocol !== 'https:'`.
- Default `modelId` to `'ui-tars-7b'` when env var is absent.
- Never log the `apiKey` value (logger calls use a `{ hasApiKey: boolean }` flag).

**`harvestVisionCalls` semantics:**
- Resolves the `vision_calls.json` artefact via the existing `sandboxArtefacts` lookup keyed on `(ieeRun.id, 'vision_calls.json')`. If the artefact is absent (dom-mode run, or vision-mode run with zero calls), early-exit silently — no log noise.
- Reads the artefact bytes, parses as JSON, validates with `VisionCallsArtefactSchema`. Malformed JSON or schema-fail logs `vision.harvest.parse_failed` at warn level and throws so the outer `ieeFinalise()` transaction rolls back (retry path will see the SAME malformed artefact and fail again — operator intervention required; this is the correct failure mode because partial cost data is worse than no cost data for this run).
- **Cost-parity validation:** for each record, re-compute `computeCostCents({ modelId, imageSizeBytes, latencyMs, outputTokens: 0 })` from C11 and compare against the artefact's `costCents`. On mismatch (delta > 1 cent), emit `vision.harvest.cost_parity_drift` at warn level with `{ ieeRunId, stepIndex, callIndex, harnessCents, serverCents }`. Do NOT throw — the harness value wins (it had observation-time access to the actual latency). This catches drift between the harness pricing call and the server pricing module.
- **`agentRunId` null-guard (ChatGPT Round 1 finding #3):** before any INSERT, assert `ieeRun.agentRunId` is non-null. If null, throw `new Error('vision.harvest.missing_agent_run_id')` immediately — do not proceed to insert. This surfaces as a 5xx-equivalent error that rolls back the `ieeFinalise` transaction; the pg-boss retry path will re-fire and fail with the same assertion until the data-consistency issue is resolved by operator intervention. A `null` `agentRunId` at harvest time indicates a structural invariant violation (the dispatch path should have rejected the run before creating an `iee_runs` row); partial inserts with a null FK would be worse than a hard stop.
- Upserts via `INSERT INTO vision_inference_calls (...) VALUES (...) ON CONFLICT (iee_run_id, step_index, call_index) DO NOTHING`. Single SQL statement; idempotent harvest retry contract per spec §12.1.
- Populates `runId` from `ieeRun.agentRunId` (asserted non-null above).

**Token redaction posture:**
- `resolveEndpointConfig` returns the token in-memory; the caller (`_ieeShared.ts` in C7) threads it into `SandboxRunTaskInput.visionEndpointToken`. No log line in this service references the token value.
- Any thrown error message constructed by this service is built from non-token fields only. Defence-in-depth: a `redactToken(s: string, token: string | null): string` helper at the file top is used on every interpolated error message.

**Error handling:**
- `vision_inference_not_configured` at config-resolution time (env-var validation) -> `FailureError`.
- Artefact parse failure -> throw to roll back transaction; log `vision.harvest.parse_failed` at warn level first.
- DB constraint violation (would only happen on a malformed `iee_run_id`) -> bubble up as a 5xx-equivalent server error; the orchestrator's `withAdminConnection` wrapper logs and re-throws.
- Cost-parity drift -> log only, do not throw.

**Test considerations:** none in this chunk per spec §15 (`testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`). The pure helpers in C11 cover the cost math; the harvest path is integration-shaped and explicitly excluded.

**Dependencies:** C1, C3 (failure reasons), C4 (envelope type), C5 (schema), C11 (cost parity).

**Acceptance criteria:**
- `resolveEndpointConfig` throws the typed `FailureError` shape on all three failure paths (missing URL, non-HTTPS, malformed URL).
- `harvestVisionCalls` is callable with `(tx, ieeRun)` and returns `Promise<void>`.
- File only imports from `server/db/schema`, `server/lib`, `shared/`, and `drizzle-orm` — no route or middleware imports.
- No log line in the file interpolates `apiKey`, `visionEndpointToken`, or any env-var raw value.
- Cost-parity validation is implemented and produces the named log event on drift.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`

### C7 — `_ieeShared.ts` dispatch threading + finalisation harvest hook

**spec_sections:** §7 (modified files), §8.7 (network policy merge), §12.1 (idempotency / ordering), §16 item 11 (missing endpoint = fail at dispatch)

**Files to modify:**
- `server/services/executionBackends/_ieeShared.ts`

**Module shape:**
- *Public interface:* `ieeDispatchBrowser()` (existing, modified) and `ieeFinalise()` (existing, modified). Both keep their existing signatures; the change is internal.
- *Hidden behind it:* the env-resolution call into `visionGroundingService.resolveEndpointConfig()` happens inside the dispatch branch when `decisionMode !== 'dom'`; the network-policy MERGE logic (preserve existing allowlist entries, append vision entry) lives as a pure helper `buildVisionAwarePolicy(existing, decisionMode, visionEndpointUrl)` near the top of the file; the harvest hook is one line at the top of `ieeFinalise()` calling `visionGroundingService.harvestVisionCalls(tx, ieeRun)`.

**Dispatch-path threading (inside `ieeDispatchBrowser`, before the existing `policy` construction):**

```typescript
// Resolve decisionMode from the IEE task envelope. The skill executor populates
// this from skill YAML frontmatter (C10). Absent or unknown = null (dom behaviour).
// Runtime guard: only accept declared values; unknown strings resolve to null
// (fail-closed) rather than reaching the vLLM endpoint with an unrecognised mode.
const rawMode = ieeTask?.decisionMode ?? null;
const decisionMode: VisionDecisionMode | null =
  rawMode === 'vision' || rawMode === 'hybrid' || rawMode === 'dom'
    ? rawMode
    : null;

let visionEndpointUrl: string | null = null;
let visionEndpointToken: string | null = null;
let visionModelId: string | null = null;

if (decisionMode && decisionMode !== 'dom') {
  // Throws FailureError(failure('vision_inference_not_configured', ...)) at dispatch.
  // Before sandbox creation — no iee_runs row in 'running' state when this fires.
  const cfg = visionGroundingService.resolveEndpointConfig();
  visionEndpointUrl = cfg.endpointUrl;
  visionEndpointToken = cfg.apiKey;
  visionModelId = cfg.modelId;
}

// Existing policy build is REPLACED with the merge helper:
const baseNetwork: SandboxNetworkPolicy = { mode: 'none' };  // V1 default per IEE-DEF-7
const network = buildVisionAwarePolicy(baseNetwork, decisionMode, visionEndpointUrl);

const policy: SandboxPolicy = {
  network,
  filesystem: { writableRoot: '/workspace' },
  // ... (existing ceilings / artefactLimits / etc. unchanged)
};
```

And in the `sandboxRunTask(...)` call:

```typescript
sandboxOutput = await sandboxRunTask({
  // ... existing fields ...
  decisionMode,
  visionEndpointUrl,
  visionEndpointToken,
  visionModelId,
});
```

**Pure helper `buildVisionAwarePolicy` (exported for unit testing):**

```typescript
export function buildVisionAwarePolicy(
  existing: SandboxNetworkPolicy,
  decisionMode: VisionDecisionMode | null,
  visionEndpointUrl: string | null,
): SandboxNetworkPolicy {
  if (!decisionMode || decisionMode === 'dom' || !visionEndpointUrl) {
    return existing;
  }
  const url = new URL(visionEndpointUrl);
  const port = Number(url.port || '443');
  if (!Number.isFinite(port)) {
    throw new FailureError(failure('vision_inference_not_configured', 'malformed endpoint port'));
  }
  const visionEntry = {
    host: url.hostname,
    port,
    protocol: 'https' as const,
  };
  // Exhaustive mode handling (ChatGPT Round 1 finding #6): switch on existing.mode
  // so that future additions to SandboxNetworkPolicy.mode surface as compile-time
  // exhaustiveness errors rather than silently narrowing policy.
  let baseAllowlist: typeof visionEntry[];
  switch (existing.mode) {
    case 'allowlist':
      baseAllowlist = existing.allowlist ?? [];
      break;
    case 'none':
      // No existing allowlist entries; start fresh with vision-only allowlist.
      baseAllowlist = [];
      break;
    default: {
      // Unknown future mode: fail closed rather than silently dropping policy.
      const exhaustiveCheck: never = existing.mode;
      throw new FailureError(failure(
        'vision_inference_not_configured',
        `buildVisionAwarePolicy: unhandled network policy mode '${exhaustiveCheck}'`,
      ));
    }
  }
  return { mode: 'allowlist', allowlist: [...baseAllowlist, visionEntry] };
}
```

**Note on the `default` exhaustiveness branch:** if TypeScript's strict mode does not flag the `never` assignment at compile time (e.g. `SandboxNetworkPolicy.mode` is currently typed as `string` rather than a discriminated union), the runtime branch still provides the correct fail-closed behaviour. The `never` cast is aspirational — it will surface at compile time once the mode type is narrowed. Do not remove it.

**Finalisation-path harvest hook (top of `ieeFinalise()`):**

The architect's `tx` boundary decision (§2.5) places harvest as the first statement of `ieeFinalise()`, before any existing code:

```typescript
export async function ieeFinalise(
  finalisationInput: BackendFinalisationInput,
): Promise<BackendFinalisationResult> {
  const { tx, terminalState, parentRun } = finalisationInput;
  const ieeRun = terminalState.raw as IeeRunRow;

  // Vision-grounding harvest (browser-vision-grounding spec §12.1).
  // Early-exits silently when no vision_calls.json artefact exists (dom-mode
  // or vision-mode run with zero calls). Throws to roll back the entire tx
  // on artefact parse failure or DB constraint violation; the pg-boss retry
  // path re-fires the event handler and re-attempts harvest idempotently.
  await visionGroundingService.harvestVisionCalls(tx, ieeRun);

  // ... existing ieeFinalise body unchanged ...
}
```

**Error handling:**
- `vision_inference_not_configured` thrown by `resolveEndpointConfig` -> bubbles through the existing dispatch error path. The caller (`ieeBrowserBackend.dispatch`) already catches `FailureError` and writes the parent run as `failed` with the failure reason. No `iee_runs` row is created (failure is pre-sandbox).
- Network-policy merge: if `visionEndpointUrl` parses but produces an unexpected port string, `Number(url.port || '443')` yields `NaN` for malformed input. The pure helper asserts `Number.isFinite(port)` and throws `FailureError(failure('vision_inference_not_configured', 'malformed endpoint port'))` if not.
- Harvest hook: re-throws on artefact parse failure (rolls back the transaction; retry path re-attempts). Idempotent at the DB layer via `ON CONFLICT DO NOTHING` (spec §12.1).

**Test considerations:**
- Unit test `buildVisionAwarePolicy` for the following cases (ChatGPT Round 1 finding #6 expands from four to six):
  1. dom-mode passthrough — returns `existing` unchanged.
  2. vision-mode, `existing.mode === 'none'` — returns `{ mode: 'allowlist', allowlist: [visionEntry] }`.
  3. vision-mode, `existing.mode === 'allowlist'` with one existing entry — preserves the entry alongside the new vision entry.
  4. malformed URL (non-parseable string) — throws.
  5. malformed port (e.g. `example.com:abc`) — throws `FailureError` with `'vision_inference_not_configured'`.
  6. unknown `existing.mode` (simulate with `{ mode: 'block' as any }`) — throws `FailureError` with `'vision_inference_not_configured'`.
- Test file: `server/services/executionBackends/__tests__/buildVisionAwarePolicyPure.test.ts`. Pure helper — no DB / network.

**Dependencies:** C3 (FailureReason), C4 (envelope fields), C6 (service), C10 (ieeTask.decisionMode wiring — must exist before C7 reads it; ChatGPT Round 1 finding #1).

**Acceptance criteria:**
- `ieeDispatchBrowser` threads four new fields into `sandboxRunTask` input.
- `decisionMode` is resolved via the runtime guard (no type assertion) — only `'dom'`, `'vision'`, `'hybrid'` pass through; all other values resolve to `null`.
- `buildVisionAwarePolicy` preserves existing allowlist entries on merge (regression-tested).
- `buildVisionAwarePolicy` handles `mode === 'none'` explicitly (produces vision-only allowlist).
- `buildVisionAwarePolicy` throws `FailureError` for unknown `existing.mode` values (exhaustive branch).
- `ieeFinalise` calls `harvestVisionCalls(tx, ieeRun)` as the FIRST executable statement.
- All six `buildVisionAwarePolicy` test cases pass (expanded from four per ChatGPT Round 1 finding #6).
- No new direct `db` import inside this file (already routes through `getOrgScopedDb` and `withAdminConnection`).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/executionBackends/__tests__/buildVisionAwarePolicyPure.test.ts`

### C8 — Harness stub: `index.ts` + `visionDecisionLoop.ts`

**spec_sections:** §8.3 (HarnessInput extension), §10 (execution model — harness side), §13 (deferred wiring), §15 (stub fails loudly)

**Files to create:**
- `infra/sandbox-templates/iee-browser/harness/visionDecisionLoop.ts`

**Files to modify:**
- `infra/sandbox-templates/iee-browser/harness/index.ts`

**Module shape:**
- *Public interface:* `visionDecisionLoop(input: VisionDecisionLoopInput): Promise<void>` — accepts the harness input and runs the (stubbed) vision decision loop. Writes `/workspace/output.json` with `status: 'failed'` and a clear reason; never writes `status: 'completed'`.
- *Hidden behind it:* the (currently empty) screenshot / vLLM / Playwright orchestration. The stub function reads `input.decisionMode`, asserts the e2b SDK is absent (the trigger to fail loud), and writes the failure payload. Future wiring (post-e2b-SDK install) replaces the body without changing the signature.

**Contracts:**

`visionDecisionLoop.ts`:

```typescript
// infra/sandbox-templates/iee-browser/harness/visionDecisionLoop.ts
// Vision decision loop — V1 STUB. Fails loudly until e2b SDK lands.
// Spec: docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md §10, §13.

import { promises as fs } from 'fs';
import { computeCostCents } from '../../../../shared/visionInferencePricing.js';

interface VisionDecisionLoopInput {
  taskPayload: unknown | null;
  decisionMode: 'vision' | 'hybrid';
  visionEndpointUrl: string;
  visionEndpointToken: string | null;
  visionModelId: string;
  artefactsDir: string;
}

interface VisionLoopOutput {
  status: 'failed';
  reason: string;
  failureReason: 'vision_inference_unavailable';
}

/**
 * V1 stub. Writes a loud-failure output.json and exits non-zero.
 * Imports computeCostCents so a future grammar / pricing change surfaces here
 * at compile time (anchoring the contract).
 */
export async function visionDecisionLoop(input: VisionDecisionLoopInput): Promise<void> {
  // Touch the pricing module so the import isn't tree-shaken before wiring.
  void computeCostCents;
  const out: VisionLoopOutput = {
    status: 'failed',
    reason: 'visionDecisionLoop: stub — e2b SDK not installed; harness loop is not wired in V1',
    failureReason: 'vision_inference_unavailable',
  };
  await fs.writeFile('/workspace/output.json', JSON.stringify(out));
  // Do NOT write vision_calls.json — there were no calls. Harvest early-exits
  // on a missing artefact, which is the correct behaviour.
  process.exit(1);
}
```

`index.ts` — extension of `HarnessInput` and routing:

```typescript
interface HarnessInput {
  // ... existing fields (taskPayload, profileMount, artefactsDir, proxyAlignment, proxyUrlEnvKey, humanize) ...

  /** Browser-vision-grounding (spec §8.3). Absent or 'dom' = existing DOM-mode path. */
  decisionMode?: 'dom' | 'vision' | 'hybrid' | null;
  visionEndpointUrl?: string | null;
  visionEndpointToken?: string | null;
  visionModelId?: string | null;
}

async function main(): Promise<void> {
  // ... existing input read + dir creation unchanged ...

  // Vision-grounding routing (spec §8.3).
  if (input.decisionMode === 'vision' || input.decisionMode === 'hybrid') {
    if (!input.visionEndpointUrl || !input.visionModelId) {
      const out = {
        status: 'failed',
        reason: 'harness: visionEndpointUrl or visionModelId missing',
        failureReason: 'vision_inference_not_configured',
      };
      await fs.writeFile(OUTPUT_PATH, JSON.stringify(out));
      process.exit(1);
    }
    const { visionDecisionLoop } = await import('./visionDecisionLoop.js');
    await visionDecisionLoop({
      taskPayload: input.taskPayload,
      decisionMode: input.decisionMode,
      visionEndpointUrl: input.visionEndpointUrl,
      visionEndpointToken: input.visionEndpointToken ?? null,
      visionModelId: input.visionModelId,
      artefactsDir,
    });
    return; // visionDecisionLoop calls process.exit(1) in V1
  }

  // ... existing dom-mode path unchanged ...
}
```

**Redaction obligation (spec §8.3):**
- `visionEndpointToken` MUST NOT appear in any log line emitted by the harness.
- `visionEndpointToken` MUST NOT appear in `/workspace/output.json`.
- `/workspace/input.json` is sandbox-scoped and ephemeral; it is NOT harvested.
- The harness's `console.log` / stderr lines that reference the input shape must use `{ hasToken: !!input.visionEndpointToken }` instead of the raw value.

**Error handling:**
- Missing `visionEndpointUrl` or `visionModelId` when `decisionMode !== 'dom'` -> write `failureReason: 'vision_inference_not_configured'` to `output.json` and exit non-zero.
- `visionDecisionLoop` stub always writes `failureReason: 'vision_inference_unavailable'` and exits non-zero (loud-failure convention).
- The existing dom-mode path is byte-identical to V0 when `decisionMode` is absent or `'dom'`.

**Test considerations:** none in this chunk. The harness runs inside the sandbox; e2e tests are deferred per §15. C11 covers the imported `computeCostCents` module.

**Dependencies:** C1 (type imports — but the harness uses inline string literals for `decisionMode` to avoid a sandbox-side dependency on the server-side type module; this matches the existing `ProxyAlignment` inline pattern), C3 (failure reason strings — same inline approach), C4 (envelope structure documented), C11 (`computeCostCents` import).

**Acceptance criteria:**
- `visionDecisionLoop` exports a function with the documented signature.
- The harness `main()` routes to `visionDecisionLoop` when `decisionMode === 'vision'` or `'hybrid'`.
- The stub NEVER writes `status: 'completed'`.
- `computeCostCents` is imported (even if only by `void` reference) so a future pricing change surfaces here at compile time.
- The dom-mode path is unmodified when `decisionMode` is absent or `'dom'`.
- No log / output line references `visionEndpointToken` raw value.
- **Redaction coverage verified (ChatGPT Round 1 finding #10):** read `sandboxHarvestService` redaction logic; confirm it matches bearer/API-key shapes (`Bearer ...`, `sk_...`, `eyJ...`). If any shape is absent, extend the redaction in this commit. This criterion must be explicitly checked off in `progress.md` — it is not optional.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`

### C9 — `visionInferenceCostRollupJob` (pg-boss daily)

**spec_sections:** §6 chunk C9, §10 (rollup section, lines 423–429), §13 (mid-run deferred)

**Files to create:**
- `server/jobs/visionInferenceCostRollupJob.ts`

**Files to modify:**
- `server/jobs/index.ts` — register the new job (`registerVisionInferenceCostRollupJob`)
- (No `boss.work` registration in `server/index.ts` is needed if the existing `index.ts` boot block iterates the registry; verify against `ieeCostRollupDailyJob` precedent.)

**Module shape:**
- *Public interface:* `runVisionInferenceCostRollup()` (callable manually for ops), `registerVisionInferenceCostRollupJob()` (boot-time pg-boss registration). Mirrors `ieeCostRollupDailyJob` exactly.
- *Hidden behind it:* the two SQL upsert statements (one per `cost_aggregates` entity type), the UTC day-boundary math, the admin-role SET LOCAL, and the 2-day lookback window.

**Contracts:**

```typescript
// server/jobs/visionInferenceCostRollupJob.ts
// Mirrors ieeCostRollupDailyJob.ts — read the rollup pattern there first.
//
// Writes per-organisation, per-day rows to cost_aggregates using:
//   - entityType='source_type', entityId='vision_inference' (per-day aggregate)
//   - entityType='run', entityId=<run_id>                   (per-run aggregate)
//
// The `source_type` rollup is the System P&L surface for the "Vision Inference"
// line item. The `run` rollup is what runCostBreaker reads (spec §1 Goal 6).

import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import { getPgBoss } from '../lib/pgBossInstance.js';

const QUEUE_NAME = 'vision-inference-cost-rollup-daily';
const SCHEDULE_CRON = '15 2 * * *'; // 02:15 UTC daily — offset from iee rollup at 02:10

export async function runVisionInferenceCostRollup(): Promise<{ durationMs: number }> {
  const started = Date.now();
  await withAdminConnection(
    { source: 'jobs.visionInferenceCostRollup',
      reason: 'cross-tenant aggregation of vision_inference_calls into cost_aggregates; daily rollup job' },
    async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);

      // Per-org daily aggregate for source_type='vision_inference' (System P&L surface).
      await tx.execute(sql`
        INSERT INTO cost_aggregates (
          organisation_id, entity_type, entity_id, period_type, period_key,
          total_cost_raw, total_cost_with_margin, total_cost_cents,
          total_tokens_in, total_tokens_out, request_count, error_count,
          updated_at
        )
        SELECT
          organisation_id,
          'source_type' AS entity_type,
          'vision_inference' AS entity_id,
          'daily' AS period_type,
          to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period_key,
          0, 0,
          COALESCE(SUM(cost_cents), 0)::integer,
          0, 0,
          COUNT(*)::integer,
          0,
          now()
        FROM vision_inference_calls
        WHERE created_at >= now() - interval '2 days'
        GROUP BY organisation_id, date_trunc('day', created_at AT TIME ZONE 'UTC')
        ON CONFLICT (entity_type, entity_id, period_type, period_key)
        DO UPDATE SET
          total_cost_cents = EXCLUDED.total_cost_cents,
          request_count    = EXCLUDED.request_count,
          updated_at       = now();
      `);

      // Per-run lifetime aggregate (entityType='run'). runCostBreaker reads this.
      // Aggregate is recomputed from scratch within the 2-day window — same
      // pattern as the iee_run rollup (replacement semantics, not additive).
      await tx.execute(sql`
        INSERT INTO cost_aggregates (
          organisation_id, entity_type, entity_id, period_type, period_key,
          total_cost_raw, total_cost_with_margin, total_cost_cents,
          total_tokens_in, total_tokens_out, request_count, error_count,
          updated_at
        )
        SELECT
          organisation_id,
          'run' AS entity_type,
          run_id::text AS entity_id,
          'lifetime' AS period_type,
          'all' AS period_key,
          0, 0,
          COALESCE(SUM(cost_cents), 0)::integer,
          0, 0,
          COUNT(*)::integer,
          0,
          now()
        FROM vision_inference_calls
        WHERE created_at >= now() - interval '2 days'
        GROUP BY organisation_id, run_id
        ON CONFLICT (entity_type, entity_id, period_type, period_key)
        DO UPDATE SET
          total_cost_cents = EXCLUDED.total_cost_cents,
          request_count    = EXCLUDED.request_count,
          updated_at       = now();
      `);
    },
  );
  const summary = { durationMs: Date.now() - started };
  logger.info('vision.costrollup.complete', summary);
  return summary;
}

export async function registerVisionInferenceCostRollupJob(): Promise<void> {
  if (env.JOB_QUEUE_BACKEND !== 'pg-boss') {
    logger.warn('vision.costrollup.skipped', { reason: 'pg-boss not configured' });
    return;
  }
  const boss = await getPgBoss();
  await boss.work(QUEUE_NAME, async () => { await runVisionInferenceCostRollup(); });
  await boss.schedule(QUEUE_NAME, SCHEDULE_CRON, {}, { tz: 'UTC' });
  logger.info('vision.costrollup.scheduled', { queue: QUEUE_NAME, cron: SCHEDULE_CRON });
}
```

**Per-run rollup semantics — REPLACEMENT (ChatGPT Round 1 finding #4):** this build commits to REPLACEMENT semantics (`DO UPDATE SET total_cost_cents = EXCLUDED.total_cost_cents`). A vision-mode run that completes today and the rollup runs tomorrow will recompute the run's total from the latest data within the 2-day window. Runs older than 2 days do not get re-aggregated (their last computed value sticks). If `ieeCostRollupDailyJob.ts` differs from this pattern, that deviation belongs to the IEE rollup's own design history. Do NOT switch this rollup to ADDITIVE to match it; record any deviation between the two jobs in a comment at the top of this function and in `progress.md` under Deviations for `spec-conformance` to review. The rationale: REPLACEMENT semantics are correct for a per-run lifetime aggregate where the source table is the single writer — an additive merge would double-count on retry.

**Error handling:**
- `withAdminConnection` failure -> bubble up; pg-boss retries per the queue's retry policy.
- Empty result set -> both upserts are no-ops; no error.
- Schedule registration is idempotent by queue name.

**Test considerations:** none in this chunk per spec §15. Pure helpers extraction (e.g. UTC-cutoff math) is deferred — the SQL embeds the math directly per the `ieeCostRollupDailyJob` precedent.

**Dependencies:** C5 (the `vision_inference_calls` table must exist).

**Acceptance criteria:**
- File compiles cleanly.
- `registerVisionInferenceCostRollupJob` is exported and added to `server/jobs/index.ts` registration sequence.
- Queue name `vision-inference-cost-rollup-daily` is unique (does not collide with `iee-cost-rollup-daily`).
- Cron offset is 02:15 UTC (5 min after IEE rollup, avoids contention).
- Both upsert statements use deterministic UTC day-boundary math (`AT TIME ZONE 'UTC'`).
- **`ON CONFLICT` target is verified (ChatGPT Round 1 finding #5):** before committing C9, read the actual `cost_aggregates` unique constraint from the schema file or migration that created it. If the constraint includes `organisation_id`, the `ON CONFLICT` clause must include it: `ON CONFLICT (organisation_id, entity_type, entity_id, period_type, period_key)`. Use the exact columns from the real constraint definition — do not assume the four-column form shown in the plan draft. Record the confirmed column list in a comment above each `ON CONFLICT` clause.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`

### C10 — `skillParserServicePure`: surface `iee_decision_mode`

**spec_sections:** §8.9 (skill YAML frontmatter, lines 375–386), §7 (modified files)

**Files to modify:**
- `server/services/skillParserServicePure.ts`
- `shared/iee/jobPayload.ts` — add optional `decisionMode` field to `BrowserTaskPayload` Zod schema (the dispatch envelope C7 reads via `opts.ieeTask.decisionMode`)
- `server/services/agentExecutionService/types.ts` — add optional `decisionMode` field to the inline `ieeTask` type on `AgentRunRequest` so callers can thread `parsedSkill.ieeDecisionMode` into the envelope

**Module shape:**
- *Public interface:* the existing `ParsedSkill` interface gains an optional `ieeDecisionMode?: 'dom' | 'vision' | 'hybrid'` field; `BrowserTaskPayload` gains an optional `decisionMode` field; `AgentRunRequest.ieeTask` gains a matching optional `decisionMode` field.
- *Hidden behind it:* the frontmatter-key parsing logic (one line in `parseFrontmatter`'s caller, reading `frontmatter['iee_decision_mode']`).

**Contracts:**

Update `ParsedSkill`:

```typescript
export interface ParsedSkill {
  name: string;
  slug: string;
  description: string;
  definition: object | null;
  instructions: string | null;
  rawSource: string;
  /**
   * IEE decision mode (browser-vision-grounding spec §8.9).
   * Optional; absent or 'dom' = existing DOM-mode behaviour (byte-identical).
   * Values: 'dom' | 'vision' | 'hybrid'. The IEE dispatch path reads this and
   * threads it into BrowserTaskPayload.decisionMode (the ieeTask envelope C7 reads).
   */
  ieeDecisionMode?: 'dom' | 'vision' | 'hybrid';
}
```

Update `parseMarkdownFile` (or wherever the frontmatter -> `ParsedSkill` mapping happens) to surface the key:

```typescript
const ieeDecisionMode = frontmatter['iee_decision_mode'];
const parsed: ParsedSkill = {
  // ... existing fields ...
  ...(ieeDecisionMode === 'vision' || ieeDecisionMode === 'hybrid' || ieeDecisionMode === 'dom'
    ? { ieeDecisionMode: ieeDecisionMode as 'dom' | 'vision' | 'hybrid' }
    : {}),
};
```

Unknown values (typo, future grammar) are silently dropped — same conservative behaviour as `humanize` / `proxyAlignment` opt-in fields. The dispatch layer treats absent as `'dom'`.

Add `decisionMode` to `BrowserTaskPayload` in `shared/iee/jobPayload.ts`:

```typescript
// Add after the existing `playSelector` field:
/**
 * Vision-grounding decision mode threaded from skill YAML frontmatter.
 * Absent or null = 'dom' (existing DOM behaviour). Set by the skill-executor
 * dispatch caller from ParsedSkill.ieeDecisionMode (browser-vision-grounding spec §8.9).
 */
decisionMode: z.enum(['dom', 'vision', 'hybrid']).nullish(),
```

Add `decisionMode` to the inline `ieeTask` type in `server/services/agentExecutionService/types.ts`:

```typescript
// Add to the ieeTask?: { ... } inline object type:
decisionMode?: 'dom' | 'vision' | 'hybrid' | null;
```

**Error handling:** none. Invalid `iee_decision_mode` values are dropped, not raised.

**Test considerations:**
- Add four Vitest cases to the existing `skillParserServicePure` test file (if it exists) or create `server/services/__tests__/skillParserServicePure.test.ts` containing only the new cases:
  - Skill with `iee_decision_mode: vision` -> `parsed.ieeDecisionMode === 'vision'`.
  - Skill with `iee_decision_mode: hybrid` -> `parsed.ieeDecisionMode === 'hybrid'`.
  - Skill with `iee_decision_mode: garbage` -> `parsed.ieeDecisionMode === undefined`.
  - Skill without the key -> `parsed.ieeDecisionMode === undefined`.

Search for an existing `skillParserServicePure.test.ts` first; if it exists, ADD to it. Do not create a duplicate.

**Dependencies:** none.

**Acceptance criteria:**
- `ParsedSkill.ieeDecisionMode` is optional and accepts only the three declared values.
- Existing skill parsing without the key produces the SAME `ParsedSkill` shape as V0 (no `ieeDecisionMode` field present).
- Four new test cases pass.
- Verified that the dispatch envelope contains `ieeTask.decisionMode = parsedSkill.ieeDecisionMode ?? null` before C7 reads it: `BrowserTaskPayload` in `shared/iee/jobPayload.ts` has a `decisionMode` field (`.nullish()`), and `AgentRunRequest.ieeTask` in `server/services/agentExecutionService/types.ts` exposes the same optional field — confirming the wire path is typed end-to-end. If absent when this chunk is authored, added in this commit (not deferred to C7).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/__tests__/skillParserServicePure.test.ts`

---

### C12 — Documentation: `docs/iee-development-spec.md`

**spec_sections:** §12 (modified files — docs), §8.9 (three-mode behaviour)

**Files to modify:**
- `docs/iee-development-spec.md`

**Module shape:**
- *Public interface:* a new subsection in `docs/iee-development-spec.md` documenting the `iee_decision_mode` skill YAML field with the three valid values and their semantics.
- *Hidden behind it:* none — documentation.

**Contracts:** insert into `docs/iee-development-spec.md` at the existing "Skill YAML frontmatter" section (or create such a section if it does not exist). Content (operator-facing prose; no agent-facing density rules — this is human-readable reference doc):

- A heading: `Skill YAML — iee_decision_mode (browser-vision-grounding spec §8.9)`.
- A short YAML block showing the three valid values.
- Three bullet points: `dom` (default, byte-identical to absent), `vision` (every action step calls vLLM endpoint; cost recorded per call), `hybrid` (DOM-first with 1-retry-then-vision fallback per step).
- A note that invalid values are silently dropped (same conservative pattern as `humanize` / `proxyAlignment`).
- A note that endpoint URL and token are server-side env vars only (`VISION_INFERENCE_ENDPOINT_URL`, `VISION_INFERENCE_API_KEY`, `VISION_INFERENCE_MODEL_ID`); skills do NOT carry endpoint config in YAML.
- A cost-breaker note: per-run cost ceilings via `runCostBreaker` are enforced from per-run aggregates produced by the daily `vision-inference-cost-rollup-daily` pg-boss job, so vision-cost enforcement applies to the FOLLOWING run, not the run that incurred the cost. Mid-run enforcement is deferred — see browser-vision-grounding spec §13.
- A harness-loop note: the harness-side `visionDecisionLoop.ts` is a loud-failure stub in V1 pending e2b SDK installation. Vision-mode skills will fail at the sandbox with `failureReason: 'vision_inference_unavailable'` until the follow-up build wires the screenshot / vLLM / Playwright orchestration.

Also add a short cross-reference at the top of the IEE spec's deferred-items list pointing to `docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md` §13.

**Error handling:** none — documentation.

**Test considerations:** none.

**Dependencies:** C1 (type taxonomy), C10 (skill parser surface).

**Acceptance criteria:**
- Section is added to `docs/iee-development-spec.md`.
- The three modes are documented with their semantics.
- The cost-breaker deferred behaviour is called out.
- The stub status is recorded.

**Verification commands:**
- `npm run lint` (markdown lint, if configured)

---

## 5. Risks and mitigations

### 5.1 Token leakage through harness logs

**Risk:** `visionEndpointToken` written to `/workspace/input.json` is inside the sandbox FS for the lifetime of the execution. A harness log line that interpolates the input object's JSON dump would leak the token to sandbox stdout, which is harvested per `sandboxHarvestService`.

**Mitigation:**
- The harness must never `console.log(JSON.stringify(input))`. The C8 acceptance criterion includes a static-search clause for this pattern.
- `/workspace/input.json` is sandbox-scoped and explicitly NOT harvested per spec §8.3.
- The `redactToken` helper (C6) is also exposed in the harness for use in any new log line that mentions `visionEndpointToken`.
- **Redaction verification is a C8 acceptance criterion (ChatGPT Round 1 finding #10):** during C8 implementation, read the `sandboxHarvestService` redaction logic (the step 2 pre-persist filter) and verify it matches known bearer/API-key token shapes — at minimum `Bearer <hex-or-base64>`, `sk_<...>`, and `eyJ...` (JWT prefixes). If any shape is absent from the redaction list, extend the redaction in the same C8 commit and note the extension in `progress.md`. This is NOT a follow-up item; it is an in-PR obligation. A C8 that defers this to a follow-up does not meet its acceptance criteria.

### 5.2 Pricing-drift between harness and server

**Risk:** the harness computes `costCents` at observation time using `shared/visionInferencePricing.ts`. If the server-side service uses a DIFFERENT version of the same module (e.g. a hot-fix landed in `shared/` after the sandbox image was built), the harvest cost-parity check fires.

**Mitigation:**
- The sandbox template's build process bakes the version of `shared/visionInferencePricing.ts` into the image; CI ensures the build runs before any deploy.
- Cost-parity drift logs at warn level with `{ harnessCents, serverCents }`. The HARNESS value wins (the harness had the actual latency timer). A persistent drift signals a real divergence and surfaces in the operator's log feed.
- Until C8's harness loop is wired (V1 stub), no drift can manifest. The cost-parity validator is dormant in V1; turning live in the follow-up build.

### 5.3 Network-policy merge collision with future IEE-DEF-7

**Risk:** spec §8.7 commits to a MERGE pattern so a future broader browser navigation policy (currently `mode: 'none'`, tracked as IEE-DEF-7) does not silently overwrite the vision allowlist. But if IEE-DEF-7 implements its OWN merge semantics that don't see the vision entry, the vision endpoint can become unreachable.

**Mitigation:**
- The `buildVisionAwarePolicy` helper accepts a `SandboxNetworkPolicy` and returns a new one — it does not own a singleton. When IEE-DEF-7 lands, the IEE-DEF-7 author MUST call `buildVisionAwarePolicy(theirNewPolicy, decisionMode, visionEndpointUrl)` to layer their resolution under the vision merge.
- Document this in the C7 comment block at the call site. The IEE-DEF-7 spec author will see it during their plan-authoring phase.
- C7 acceptance criterion includes a unit test of the merge against a non-trivial existing allowlist (a single sentinel entry like `{ host: 'example.com', port: 443, protocol: 'https' }`); the test asserts the entry is preserved alongside the vision entry.

### 5.4 Mid-run vision cost overrun (deferred enforcement)

**Risk:** per spec §13, `runCostBreaker` enforces per-run vision-cost ceilings against the post-run aggregate from the FOLLOWING run onward — not the run that incurred the cost. A pathological vision-mode skill could in theory spike vision cost mid-run with no break.

**Mitigation:**
- V1 ships a STUB harness; no in-flight vision costs can occur in V1. The risk is theoretical until the follow-up wiring lands.
- The per-task ceilings on `SandboxCeilings.costCents` (from the existing sandbox primitive) provide an upper bound at the TASK level via the worker-side `sandbox-ceiling-monitor` job. Vision calls are a subset of total task cost; the existing ceiling caps the run.
- §13 records the gap; follow-up spec authoring will plan mid-run enforcement (inline aggregate update during harvest, or per-call inline updates from the harness).

### 5.5 UI-TARS grammar drift

**Risk:** `bytedance/UI-TARS` is an upstream open-source project. A future release could change the action grammar (e.g. add a `drag(...)` verb, change `type("...")` to `text("...")`). The parser breaks silently if it doesn't recognise the new shape.

**Mitigation:**
- `UI_TARS_GRAMMAR_VERSION` constant pins the grammar to a specific commit hash (§2.2).
- The fixture file `ui-tars-grammar-bc25e5f.txt` (C2) carries one canonical line per verb; a future grammar bump produces a fixture diff that requires explicit review.
- The parser's unknown-verb path throws `ParseError`, which surfaces as `vision_inference_unavailable` at the harness layer — failure is loud, not silent.
- When a grammar bump is needed: update the constant, the fixture, and the parser in the SAME commit. Add a `KNOWLEDGE.md` entry recording the upstream change reference.

### 5.6 Vendor lock vs vendor flexibility

**Risk:** RunPod-specific pricing constants and the env-var-only endpoint shape make a vendor swap a single config change. But if a future vendor (Replicate, Modal) has fundamentally different request semantics (streaming-only, non-OpenAI-compatible, alternate auth), the service-layer code needs to change.

**Mitigation:**
- The vendor identity is intentionally NOT a code-level constant. `VISION_INFERENCE_ENDPOINT_URL` and `VISION_INFERENCE_MODEL_ID` are the only vendor anchors.
- `VISION_PRICING_RATES` is keyed by `modelId`, not vendor. A vendor swap that keeps `modelId: 'ui-tars-7b'` requires only a rate-table edit.
- A vendor swap that needs a different model (e.g. `'ui-tars-72b'`) adds a new entry to `VISION_PRICING_RATES` and a new `VISION_INFERENCE_MODEL_ID` deployment.
- Cross-vendor request-shape adapters are deferred to the FIRST vendor swap (three-similar-lines rule).

### 5.7 Migration number collision

**Risk:** another build merges to `main` between this plan's authoring and execution, claiming `0378`.

**Mitigation:**
- C5 acceptance criterion explicitly calls out the renumber discipline: rename both `.sql` and `.down.sql`, update the `policyMigration` field in `rlsProtectedTables.ts`, re-run `npm run db:generate`.
- This is a mechanical decision per the operator's "auto-decide technical resolutions inside coordinator runs" preference; no escalation required.

### 5.8 Spec-vs-plan ordering of harvest hook

**Risk:** spec §12.1 / §8.7 reads "harvest is called immediately before the UPDATE iee_runs SET status = $terminal SQL statement." The plan moves it to "the first statement of `ieeFinalise()`." A literal-spec-conformance check would flag this.

**Mitigation:**
- `progress.md` records this as an architect deviation with the rationale (§2.5 above).
- C12's doc update reflects the corrected ordering.
- `spec-conformance` is given the rationale via `progress.md`; the verdict should be `CONFORMANT_AFTER_FIXES` once C12 lands (the docs are the authoritative description after this PR merges).

---

## 6. Self-consistency pass

### 6.1 Goals vs implementation

- Spec Goal 4 — harness loop stubbed in V1 — matches C8's stub-only delivery.
- Spec Goal 6 — vision cost rollup to `cost_aggregates` with `source_type: 'vision_inference'` — matches C9's SQL.
- Spec Goal 7 — DOM workflows produce identical run logs before and after — preserved because `decisionMode === 'dom'` (the default) is a no-op through every chunk's modified path.
- Spec Goal 8 success criteria split between V1 (static/structural) and follow-up (execution/regression) — matches C2 (parser tests), C5 (table + gates), C7 (dispatch threading), C8 (loud-failure stub), and C11 (pricing tests) for V1. Follow-up criteria are explicitly deferred (§13, restated in §5.4 and §5.5 above).

### 6.2 Prose vs execution model

- Spec §10 says `harvestVisionCalls()` runs inline within the IEE artefact harvest pipeline at terminal state. Plan §2.5 + C7 places it as the first statement of `ieeFinalise()`, which is the orchestrator entry point for terminal-state writes. Consistent.
- Spec §12.1 says harvest is idempotent via `ON CONFLICT DO NOTHING` on `(iee_run_id, step_index, call_index)`. Plan C5 declares the unique constraint by that exact column set; C6 implements the upsert. Consistent.
- Spec §12.3 says the harvest is single-writer (IEE finalisation gates on terminal status predicate). Plan C7 places the harvest inside the orchestrator's `tx`, which is itself gated by the finalisation orchestrator's row lock (`SELECT ... FOR UPDATE` on the parent agent_run per `_ieeShared` line 595 region). Consistent.

### 6.3 Single-source-of-truth claims

- `VISION_INFERENCE_ENDPOINT_URL` is the single source of endpoint identity. Plan: C6 reads it via `env`; never persisted to DB; threaded into `SandboxRunTaskInput.visionEndpointUrl` for one-shot envelope use; redacted on the harness side. Consistent.
- `vision_calls.json` is the single source of per-call records. Plan: C8 writes it (stubbed in V1, real in follow-up); C6 reads it; `vision_inference_calls` is derived. Consistent.
- `VISION_PRICING_RATES` is the single source of cost math. Plan: C11 owns the constants; C6 validates parity; C8 imports `computeCostCents`. Consistent.

### 6.4 Numeric reconciliation

- Spec §7 declares 11 new files + 9 modified files = 20 entries. Plan covers all 20:
  - **New (11):** `visionActions.ts`, `visionActionParserPure.ts`, `visionActionParserPure.test.ts`, `visionGroundingService.ts`, `visionDecisionLoop.ts`, `visionInferenceCalls.ts`, `0378_*.sql`, `0378_*.down.sql`, `visionInferenceCostRollupJob.ts`, `visionInferencePricing.ts`, `visionInferencePricing.test.ts`.
  - **Modified (9):** `sandbox.ts`, `skillParserServicePure.ts`, `failureReason.ts`, harness `index.ts`, `_ieeShared.ts`, `schema/index.ts`, `jobs/index.ts`, `rlsProtectedTables.ts`, `iee-development-spec.md`.
- Migration count: 1 logical migration, 2 files. Consistent with spec §14.
- Table count: 1 new table (`vision_inference_calls`). Consistent.
- Chunk count: 12 chunks (C1–C12). Consistent with spec §6.

### 6.5 Cross-chunk contract validation

- C1 exports `VisionAction` and `VisionDecisionMode` -> C2, C4, C8 import. ok
- C3 adds two `FailureReason` values -> C6, C7, C8 reference. ok
- C4 extends `SandboxRunTaskInput` -> C7 populates, C8 (via `HarnessInput` mirror) consumes. ok
- C5 creates `vision_inference_calls` -> C6 inserts, C9 reads. ok
- C11 exports `computeCostCents` -> C6 validates parity, C8 imports. ok
- C6 exports `visionGroundingService` -> C7 calls. ok
- C10 surfaces `ieeDecisionMode` on `ParsedSkill` -> C7 reads `ieeTask.decisionMode` from the dispatch envelope (ChatGPT Round 1 finding #1). C10 must land before C7. If the skill-executor dispatch site does not already thread `parsedSkill.ieeDecisionMode` into `ieeTask.decisionMode`, add that wiring in C10 (not deferred to C7). C7's dependency on C10 is explicit in §3.
- C12 updates docs -> no runtime consumer. ok

### 6.6 Load-bearing assumptions

- **Harness / shared module import** — `shared/visionInferencePricing.ts` is in `shared/` so the in-sandbox build can import it (matches `shared/iee/failure.ts` precedent). If `shared/__tests__/visionInferencePricing.test.ts` causes a test-runner discovery issue (tests under `shared/` are uncommon in this repo), relocate to `server/services/__tests__/visionInferencePricingPure.test.ts` and rename the module to `*Pure.ts`. Verify by reading existing `shared/**/__tests__/` patterns BEFORE writing C11; if no precedent exists, default to the `server/services/__tests__/` location with `*Pure.ts` naming. Track the location decision in `progress.md`.
- **`ieeTask.decisionMode` field** — the plan assumes the IEE task envelope (`ieeTask` inside `backendOptions`) can carry a `decisionMode` field that the skill executor populates from `ParsedSkill.ieeDecisionMode`. If the existing `ieeTask` shape is closed/typed, C10's acceptance criterion expands to include the dispatch-site wiring.
- **`ieeFinalise()` transaction wrapper** — the plan assumes `finalisationInput.tx` is non-null and inside an active `db.transaction(...)`. Verify in C7 implementation by reading the orchestrator entry point (`agentRunFinalizationService.ts::finaliseAgentRunFromBackend`). If the wrapper is conditional, fall back to an explicit `db.transaction(...)` inside `harvestVisionCalls` itself — but this should not be necessary based on the architecture.md description.

### 6.7 Sequencing sanity

- C1, C3, C5, C10, C11 have no internal deps — they can land in any order within the PR.
- C2 needs C1.
- C4 needs C1.
- C6 needs C1, C3, C4, C5, C11.
- C7 needs C3, C4, C6, C10. (ChatGPT Round 1 finding #1 — C10 must precede C7 so the dispatch-site `ieeTask.decisionMode` wiring is present before C7 reads it.)
- C8 needs C1, C3, C4, C11.
- C9 needs C5.
- C12 needs C1, C10.

The chunk graph in §3 has no backward references. Any topological order works; the §3 visual order is recommendation, not constraint.

---

## End of plan

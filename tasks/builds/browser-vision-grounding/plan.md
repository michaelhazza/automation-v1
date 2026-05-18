# Implementation Plan — Vision-based Browser Grounding via Self-hosted UI-TARS

**Build slug:** `browser-vision-grounding`
**Spec:** `docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md` (status: accepted, 2026-05-18, ChatGPT R2 closed APPROVED)
**Plan date:** 2026-05-18
**Scope class:** Major (13 chunks, single PR, single phase)
**Author:** architect (Opus)

---

## Table of contents

1. Model-collapse check
2. Architecture notes
3. System invariants
4. Resolved plan-time constants
5. File inventory
6. Chunk dependency graph
7. Per-chunk detail
   - C1 — `shared/types/visionActions.ts`
   - C3 — `shared/iee/failureReason.ts` (add two enum values)
   - C11 — `shared/visionInferencePricing.ts` (+ Vitest)
   - C5 — schema + migration + RLS manifest
   - C4 — `shared/types/sandbox.ts` extension
   - C10 — `server/services/skillParserServicePure.ts`
   - C2 — `server/services/visionActionParserPure.ts` + Vitest
   - C6 — `server/services/visionGroundingService.ts`
   - C8 — harness stub
   - C7 — `server/services/executionBackends/_ieeShared.ts`
   - C9 — rollup job + boot registration
   - C12 — docs
   - C13 — `decisionMode` thread audit + IeeTask wiring
8. Risks & mitigations
9. Self-consistency pass
10. Executor notes
11. Final file inventory

---

## 1. Model-collapse check

The spec describes a control-loop, not a one-shot transform:

1. Decompose into ingest → extract → transform → render? **No.** Vision grounding is an iterative perceive-decide-act loop (screenshot → vLLM → parse → Playwright action → re-screenshot). Each step's input depends on the previous step's side effect on the browser. There is no linear pipeline to flatten.
2. Could a single frontier multimodal call replace it? **No.** A single call cannot observe the DOM mutation produced by its own click. The 9-verb action grammar (`click`, `type`, `scroll`, `hotkey`, `wait`, `screenshot`, `done`, `double_click`, `right_click`) is a tool-use protocol the model emits per step, with the browser state as the feedback channel between calls.
3. Reject collapse — recorded reason: **the harness loop IS the model-collapsed primitive at the step granularity.** Each vLLM call IS one structured-output frontier call (image-in, typed-action-out). What we are not collapsing is the iteration; iteration is intrinsic to GUI agent loops. The model-collapse principle applies within a step (one model call per decision) and is already honoured by the design.

---

## 2. Architecture notes

### 2.1 Decision — harvest inside `ieeFinalise()` transaction

**Problem:** spec §12.1 requires harvest write + terminal `iee_runs.status` write to be atomic so a crashed harvest cannot leave a `completed` run without its cost ledger rows.

**Inspection finding (caller-mandated):** `ieeFinalise()` in `server/services/executionBackends/_ieeShared.ts:510-711` receives `tx: Transaction` from `server/services/agentRunFinalizationService.ts:195` (`db.transaction(async (tx) => { ... })`). All terminal writes (`tx.update(agentRuns)` at L613, `tx.update(ieeRuns).set({eventEmittedAt})` at L650) execute inside this transaction. Therefore the harvest call CAN be placed inside the same DB transaction.

**Decision:** `visionGroundingService.harvestVisionCalls(tx, ieeRun)` is invoked from `ieeFinalise()` immediately before the `agent_runs` terminal `UPDATE` (currently L613-637 in `_ieeShared.ts`). Both the harvest INSERTs and the terminal status write share the same `tx`. Harvest failure throws out of the transaction → `agent_runs` terminal write never commits → orchestrator's `finaliseAgentRunFromBackend` rolls back → the worker retries → harvest re-runs idempotently against `(iee_run_id, step_index, call_index) ON CONFLICT DO NOTHING`. No `withAdminConnection` in the harvest path; we use the orchestrator's `tx` directly.

**RLS note (load-bearing):** the orchestrator transaction does NOT call `setOrgGUC` for IEE backends (only for `operator_managed`). `vision_inference_calls` has the canonical org_isolation policy with `WITH CHECK`; INSERTs require `current_setting('app.organisation_id', true)` to match `organisation_id`. **Therefore `harvestVisionCalls(tx, ieeRun)` MUST call `setOrgGUC(tx, ieeRun.organisationId)` as its first statement** before the INSERT loop. Without this, harvest INSERTs would fail under FORCE RLS (the `WITH CHECK` clause causes an error, not a silent no-op).

**Rejected:** moving harvest to a post-commit hook (post-commit `postCommit` closure already exists at L662-704). Reason: post-commit harvest violates spec §12.1 atomicity — a crash between the parent commit and the post-commit closure leaves a `completed` run without ledger rows.

### 2.2 Decision — stub harness, real envelope

V1 ships `visionDecisionLoop.ts` as a loud-failure stub (per spec §3 / §13). The pattern matches existing `humanize` / `proxyAlignment` fields in `infra/sandbox-templates/iee-browser/harness/index.ts` (L92-111). All envelope plumbing (dispatch → SandboxRunTaskInput → /workspace/input.json → HarnessInput → routing to `visionDecisionLoop`) is wired end-to-end. The `visionDecisionLoop()` function exits with `status: 'failed'` and a clear "stub: e2b SDK not wired" reason. The Playwright call, screenshot capture, and vLLM HTTP call are deferred to the follow-up build.

### 2.3 Decision — pricing module location and contract

`shared/visionInferencePricing.ts` lives under `shared/` (NOT `server/`) so the in-sandbox harness can `import` it without crossing the server-package boundary — same convention as `shared/iee/failure.ts` (already imported by the harness via the existing failure-emit path) and `shared/types/sandbox.ts`. The architect verified that `infra/sandbox-templates/iee-browser/harness/index.ts:5` already does `import type { HumanizeOptions } from '../../../../shared/types/humanize.js'` so the relative-path precedent is established.

**Placeholder pricing rates (caller-mandated):**

```typescript
export const VISION_PRICING_RATES = {
  'ui-tars-7b': { perImageCents: 0.01, perOutputTokenCents: 0.00002 },
} as const;
```

RunPod is the V1 target managed-vLLM vendor (simplest A10G 24 GB VRAM deployment for UI-TARS 7B). The rates above are placeholders; they will be updated to actual RunPod billing rates once the GPU instance is provisioned. The architect notes this as a Carry-phase item, not a launch blocker.

`computeCostCents({ modelId, imageSizeBytes, latencyMs, outputTokens })`:
- Throws `Error('Unknown vision model: <modelId>')` on unknown model id (spec §8.4 placeholder behaviour contract).
- Applies `Math.round` to `(rates.perImageCents + outputTokens * rates.perOutputTokenCents)`.
- Returns `0` for sub-cent results (floor of 0; spec §8.4 explicit).
- Pure function. No DB, no env. Vitest-tested.

### 2.4 Decision — parser grammar pin

The 9-verb action grammar in spec §8.1 is the authoritative source. The UI-TARS upstream README is mutable; we pin to it conceptually but the spec's 9-verb table is what the parser implements. Caller-mandated pin: **`HEAD@2026-05-18`** at <https://github.com/bytedance/UI-TARS> — the parser is versioned against the spec's table, not the upstream README's current text. The parser file header includes:

```typescript
/**
 * UI-TARS native action format parser.
 * Grammar source: spec §8.1 (browser-vision-grounding, 2026-05-18), pinned conceptually
 * against bytedance/UI-TARS HEAD@2026-05-18. The 9-verb table in the spec is authoritative;
 * upstream README mutations do NOT change the parser without a spec amendment.
 */
```

If a future operator needs a specific upstream SHA pin (e.g. after forking the repo), the architect notes that the right time to do it is when the parser is updated to a new grammar version, not now.

### 2.5 Decision — network policy merge, not replace

Spec §8.7 mandates **merge** semantics: when dispatch resolves vision-mode, append the vision endpoint to the existing allowlist rather than replacing the policy. This forward-compatibility prevents the policy from silently regressing when the IEE-DEF-7 production network policy lands. Concretely, `_ieeShared.ts` change:

```typescript
const url = new URL(visionEndpointUrl);
const visionEntry = { host: url.hostname, port: Number(url.port || '443'), protocol: 'https' as const };
const existingAllowlist = policy.network.mode === 'allowlist' ? (policy.network.allowlist ?? []) : [];
policy.network = { mode: 'allowlist', allowlist: [...existingAllowlist, visionEntry] };
```

The current `_ieeShared.ts:230` sets `policy.network = { mode: 'none' }` unconditionally; for vision-mode tasks we replace that line with the merge construction above. For DOM-mode tasks (`decisionMode === 'dom'` or absent) the existing `mode: 'none'` is preserved unchanged.

### 2.6 Decision — skill parser surfaces `iee_decision_mode` as a string field

`server/services/skillParserServicePure.ts` parses YAML frontmatter into a flat `Record<string, string>` (L19-44). The parser surfaces the new `iee_decision_mode` key as `parsedSkill.ieeDecisionMode?: 'dom' | 'vision' | 'hybrid'`. Default behaviour when absent: `undefined` (NOT `'dom'`). The IEE dispatch path treats `undefined` as `'dom'` — keeping the parser-default null lets downstream callers distinguish "skill author did not declare" from "skill author explicitly chose dom" if that distinction ever matters. Validation of unknown values is deferred to the dispatch path (which has Zod schemas already); the parser is forgiving.

The `ParsedSkill` interface gains one optional field; all 101 existing skill .md files continue to parse unchanged (no `iee_decision_mode` frontmatter present → field is `undefined` → behaviour byte-identical to before).

### 2.7 Decision — rollup job mirrors `ieeCostRollupDailyJob.ts` exactly

`server/jobs/visionInferenceCostRollupJob.ts` follows the daily-rollup pattern in `server/jobs/ieeCostRollupDailyJob.ts` 1:1:

- Queue name: `vision-inference-cost-rollup-daily`.
- Schedule: `'15 2 * * *'` UTC (5-minute offset from the IEE rollup at `'10 2 * * *'` to spread DB load).
- Look-back: 2 days (matches IEE rollup).
- Two upserts to `cost_aggregates`:
  - `entityType: 'source_type'`, `entityId: 'vision_inference'`, `period_type: 'daily'`, `period_key: YYYY-MM-DD` — platform-wide aggregate (matches spec §10).
  - `entityType: 'run'`, `entityId: <run_id::text>`, `period_type: 'daily'`, `period_key: YYYY-MM-DD` — per-run aggregate so `runCostBreaker` picks it up next run.
- `withAdminConnection` for cross-tenant aggregation (mirrors `ieeCostRollupDailyJob.ts:42`).
- `SET LOCAL ROLE admin_role` to bypass RLS during the GROUP BY scan (mirrors L48).
- Registration emits `vision_inference.costrollup.scheduled` log on success.

`server/index.ts` registers it alongside the existing IEE rollup at L807-816 (no new file; appended to that block). Spec §7 names `server/jobs/index.ts` as the registration site, but the actual registration site is `server/index.ts` — verified by reading the existing `registerIeeCostRollupDailyJob` call. Plan adjusts accordingly.

### 2.8 Single-responsibility check (per CLAUDE.md §6 Surgical Changes)

- Each chunk modifies ≤5 files OR has ≤1 logical responsibility (caller constraint).
- No abstraction extracted before the fourth occurrence (Three-Similar-Lines rule). The parser, the harvest service, and the rollup job are first-of-kind for vision-inference; no helper is extracted.
- No drive-by reformatting. No deletion of pre-existing code in any chunk except where explicitly noted (Chunk 7 replaces one line in `_ieeShared.ts:230`).

### 2.9 Patterns applied

- **Adapter pattern (existing).** `visionGroundingService.resolveEndpointConfig()` adapts env-var configuration to the typed `SandboxRunTaskInput` envelope. No new pattern; mirrors how `proxyAlignmentService` and `humanizeService` already work.
- **Pure-function service.** `visionActionParserPure.ts` and `visionInferencePricing.ts` are pure (no DB, no env). They go in *Pure.ts companions per the existing convention.
- **No new design patterns introduced.** This build extends existing primitives; no inheritance hierarchies, no DI containers, no factories beyond what the established conventions already provide.

---

## 3. System invariants

The plan preserves these invariants:

1. **Three-tier agent model** — untouched. Vision grounding is an execution-plane primitive, not an agent-tier change.
2. **RLS coverage** — `vision_inference_calls` is added to `RLS_PROTECTED_TABLES` in the same commit as migration `0378`. The `verify-rls-coverage.sh` gate (CI-only) will pass.
3. **Soft delete** — `vision_inference_calls` is append-only ledger data; no `deleted_at` column. Matches `llm_requests` precedent.
4. **`req.orgId` discipline** — the new code touches no HTTP route handlers; all org scoping flows through `ieeRun.organisationId`.
5. **Idempotency keys** — `(iee_run_id, step_index, call_index)` UNIQUE constraint is the harvest idempotency key (spec §8.5, §12.1). No new ID generation outside Drizzle's `defaultRandom()`.
6. **Heartbeat / minute-offset precision** — untouched.
7. **Migration discipline** — exactly one migration pair (`0378_vision_inference_calls.sql` + `.down.sql`). No raw SQL outside migrations.

---

## 4. Resolved plan-time constants (caller-mandated)

| Constant | Value | Source |
|---|---|---|
| Migration prefix | `0378` (verified — last existing migration is `0377`) | caller |
| Inference vendor | RunPod (managed vLLM, A10G 24 GB VRAM) | caller; replaceable |
| `VISION_PRICING_RATES['ui-tars-7b']` | `{ perImageCents: 0.01, perOutputTokenCents: 0.00002 }` (placeholder; replace with RunPod rates at provisioning) | caller |
| UI-TARS grammar pin | `HEAD@2026-05-18` at <https://github.com/bytedance/UI-TARS>; parser implements the 9-verb table in spec §8.1 | caller |
| `ieeFinalise()` tx boundary | External `tx: Transaction` from `agentRunFinalizationService.ts:195`; harvest goes inside the same tx; harvest calls `setOrgGUC(tx, ieeRun.organisationId)` before INSERT loop | architect inspection |

---

## 5. File inventory (cross-referenced with spec §7)

**New files (11):**

| File | Chunk | Spec §7 |
|---|---|---|
| `shared/types/visionActions.ts` | C1 | ✓ |
| `server/services/visionActionParserPure.ts` | C2 | ✓ |
| `server/services/__tests__/visionActionParserPure.test.ts` | C2 | ✓ |
| `server/services/visionGroundingService.ts` | C6 | ✓ |
| `infra/sandbox-templates/iee-browser/harness/visionDecisionLoop.ts` | C8 | ✓ |
| `server/db/schema/visionInferenceCalls.ts` | C5 | ✓ |
| `migrations/0378_vision_inference_calls.sql` | C5 | ✓ |
| `migrations/0378_vision_inference_calls.down.sql` | C5 | ✓ |
| `server/jobs/visionInferenceCostRollupJob.ts` | C9 | ✓ |
| `shared/visionInferencePricing.ts` | C11 | ✓ |
| `shared/__tests__/visionInferencePricing.test.ts` | C11 | ✓ |

**Modified files (9):**

| File | Chunk | Spec §7 |
|---|---|---|
| `shared/types/sandbox.ts` | C4 | ✓ |
| `server/services/skillParserServicePure.ts` | C10 | ✓ |
| `shared/iee/failureReason.ts` | C3 | ✓ |
| `infra/sandbox-templates/iee-browser/harness/index.ts` | C8 | ✓ |
| `server/services/executionBackends/_ieeShared.ts` | C7 | ✓ |
| `server/db/schema/index.ts` | C5 | ✓ |
| `server/index.ts` (was specced as `server/jobs/index.ts`, but the actual registration site is `server/index.ts` — verified L807-816 around `registerIeeCostRollupDailyJob`) | C9 | adjusted |
| `server/config/rlsProtectedTables.ts` | C5 | ✓ |
| `docs/iee-development-spec.md` | C12 | ✓ |

Total: 20 file entries — matches spec §14 numeric-count reconciliation (11 new + 9 modified).

---

## 6. Chunk dependency graph (per spec §11)

```
C1 (visionActions.ts)
├── C2 (parser + tests)
├── C4 (SandboxRunTaskInput extension)
│   └── C6 (visionGroundingService)
│       └── C7 (_ieeShared — dispatch + finalisation harvest hook)
└── C8 (harness stub)

C3 (FailureReason)
└── C6, C7, C8

C5 (schema + migration)
├── C6 (visionGroundingService imports schema)
└── C9 (rollup job reads table)

C11 (visionInferencePricing) [no internal deps]
├── C6 (validates against computeCostCents)
└── C8 (imports computeCostCents into the stub for the follow-up wiring)

C10 (skillParserServicePure) [no internal deps]
├── C12 (docs)
└── C13 (decisionMode thread audit + IeeTask wiring)
    └── C7 (_ieeShared — C13 proves the upstream field before C7 consumes it)

C12 (docs) depends on C1, C10
```

**Implementation order (single PR, forward-only):**
C1 → C3 → C11 → C5 → C4 → C10 → C2 → C6 → C8 → C13 → C7 → C9 → C12

Rationale: leaf nodes first (C1, C3, C11, C5, C10 have no internal deps); types/schema before consumers; tests with their producer (C2 follows C1); harness stub (C8) before dispatch (C7); C13 threads `decisionMode` from `ParsedSkill` into `IeeTask` so C7 can consume a proven field rather than a type-assertion cast.

---

## 7. Per-chunk detail

### Chunk C1 — `shared/types/visionActions.ts`

**spec_sections:** §8.1 (vision action schema), §8.9 (decision-mode enum)

**Files to create:**
- `shared/types/visionActions.ts`

**Files to modify:** none.

**Module shape:**
- *Public interface:* one TS type export (`VisionDecisionMode`), one discriminated-union type export (`VisionAction`). No functions, no runtime code.
- *What stays hidden:* nothing — this is a pure types file. Mirrors `shared/types/humanize.ts` and `shared/types/proxyAlignment.ts` in shape.

**Contracts (verbatim from spec §8.1):**

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

**Invariants documented as JSDoc on the type:** `x`, `y` non-negative integers; `dx`, `dy` signed integers; `ms` positive integer; `done` terminates the loop; `screenshot` observe-only.

**Error handling:** N/A (types only).

**Test considerations:**
- Type-level tests are implicit (Chunk C2 parser tests instantiate every discriminant).
- No runtime tests needed for this chunk.

**Dependencies:** none.

**Verification commands:**

```
npm run typecheck
npm run lint
```

**Acceptance criteria:**
- `tsc --noEmit` clean.
- File is < 50 lines (types only).
- No imports of any kind.
- JSDoc on `VisionAction` explicitly states the 9 verbs and invariants.

---

### Chunk C3 — `shared/iee/failureReason.ts` (add two enum values)

**spec_sections:** §8.8 (FailureReason additions), §12.5 (run-failure semantics)

**Files to modify:**
- `shared/iee/failureReason.ts` — add two values to the `FailureReason` Zod enum.

**Module shape:**
- *Public interface:* unchanged surface (`FailureReason` Zod enum, `FailureObject`, helper classes). Two new enum values become valid `FailureReason` strings.
- *What stays hidden:* nothing new — leaf change.

**Contracts:**

Add to the `z.enum([...])` array at L13-93, in the appropriate section (after `'iee_dev_backend_retired'` near L92, before `'unknown'`):

```typescript
// Browser vision grounding (spec docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md §8.8).
// vision_inference_not_configured: raised at dispatch by visionGroundingService.resolveEndpointConfig()
//   when VISION_INFERENCE_ENDPOINT_URL is absent or non-HTTPS.
// vision_inference_unavailable: raised by the harness's visionDecisionLoop when the vLLM endpoint
//   returned non-2xx or timed out mid-run. Both vision and hybrid modes fail the entire run
//   on this reason in V1 (multi-step recovery deferred — §13).
'vision_inference_not_configured',
'vision_inference_unavailable',
```

**Error handling:** N/A.

**Test considerations:**
- The enum is consumed by `FailureObjectSchema` (L110) and via the typed `failure()` helper in `shared/iee/failure.ts`. No new tests needed in C3 — downstream chunks (C6 dispatch-time throw, C8 stub harness) exercise the new values.

**Dependencies:** none.

**Verification commands:**

```
npm run typecheck
npm run lint
```

**Acceptance criteria:**
- Both new strings appear in the Zod enum in the documented section.
- JSDoc comment cites spec §8.8.
- Existing `FailureObject` / `failure()` callers continue to compile.

---

### Chunk C11 — `shared/visionInferencePricing.ts` (+ Vitest)

**spec_sections:** §8.4 (`costCents` formula), §16 (resolved decision #1 inference hosting)

**Files to create:**
- `shared/visionInferencePricing.ts` — pure pricing module.
- `shared/__tests__/visionInferencePricing.test.ts` — Vitest.

**Files to modify:** none.

**Module shape:**
- *Public interface:* `computeCostCents({ modelId, imageSizeBytes, latencyMs, outputTokens }) => number`; `VISION_PRICING_RATES` const lookup table; `VisionPricingModelId` type.
- *What stays hidden:* per-model rate constants, the `Math.round` rounding helper, the unknown-model error construction.

**Contracts:**

```typescript
// shared/visionInferencePricing.ts
export type VisionPricingModelId = 'ui-tars-7b';

export interface VisionPricingRate {
  /** Per-image inference cost in cents (float; rounded at computeCostCents). */
  perImageCents: number;
  /** Per-output-token cost in cents (float; rounded at computeCostCents). */
  perOutputTokenCents: number;
}

export const VISION_PRICING_RATES: Readonly<Record<VisionPricingModelId, VisionPricingRate>> = {
  // RunPod managed vLLM placeholder rates — NOT PRODUCTION BILLING AUTHORITATIVE.
  // Replace with actual RunPod GPU instance rates before shipping the full
  // harness wiring (follow-up build, spec §13). These placeholder values are
  // acceptable in V1 only because the harness is a stub and no real inference
  // costs are incurred. Spec §8.4 placeholder behaviour contract; §16 resolved
  // decision #1.
  'ui-tars-7b': { perImageCents: 0.01, perOutputTokenCents: 0.00002 },
} as const;

export interface ComputeCostCentsInput {
  modelId: string;
  imageSizeBytes: number;   // reserved for tiered-pricing extensions; unused in V1
  latencyMs: number;        // reserved for surcharge tiers; unused in V1
  outputTokens: number;
}

/**
 * Compute integer-cent cost for one vision inference call.
 *
 * Throws if modelId is not in VISION_PRICING_RATES (never silently returns 0).
 * Sub-cent results round to 0 (floor of 0 is acceptable in V1; floor of 1 is a
 * deferred option — spec §13).
 */
export function computeCostCents(input: ComputeCostCentsInput): number {
  const rates = (VISION_PRICING_RATES as Record<string, VisionPricingRate>)[input.modelId];
  if (!rates) {
    throw new Error(`Unknown vision model: ${input.modelId}`);
  }
  const raw = rates.perImageCents + input.outputTokens * rates.perOutputTokenCents;
  return Math.round(raw);
}
```

**Error handling:**
- Unknown model → `Error('Unknown vision model: <modelId>')`. Never returns a default; never returns 0 for unknown model.
- Negative `outputTokens` → not explicitly guarded in V1; the formula simply produces a non-positive value rounded to 0. Acceptable in V1; document as a known property in the JSDoc.

**Test considerations (`shared/__tests__/visionInferencePricing.test.ts`):**
1. Correct rate lookup for `ui-tars-7b` with `outputTokens: 0` returns the rounded per-image cost (0).
2. Correct rate lookup for `ui-tars-7b` with `outputTokens: 500_000` returns the rounded sum (10).
3. `Math.round` boundary: rates × tokens → 0.5 rounds to 1; 0.49 rounds to 0.
4. Unknown modelId `'gpt-5'` throws `Error` with message containing `'gpt-5'`.
5. Sub-cent input → returns 0 (floor of 0 confirmed).

All tests Vitest-only. No DB, no env.

**Dependencies:** none.

**Verification commands:**

```
npm run lint
npm run typecheck
npx vitest run shared/__tests__/visionInferencePricing.test.ts
```

**Acceptance criteria:**
- All 5 test cases pass.
- File is < 100 lines.
- Zero imports outside TypeScript built-ins.
- JSDoc cites spec §8.4 placeholder behaviour contract.

---

### Chunk C5 — schema + migration + RLS manifest

**spec_sections:** §7 (file inventory), §8.5 (row shape), §9 (permissions / RLS checklist), §12.6 (unique constraint)

**Files to create:**
- `server/db/schema/visionInferenceCalls.ts` — Drizzle table.
- `migrations/0378_vision_inference_calls.sql` — CREATE TABLE + FORCE RLS + policy + unique index.
- `migrations/0378_vision_inference_calls.down.sql` — `DROP TABLE IF EXISTS vision_inference_calls;`

**Files to modify:**
- `server/db/schema/index.ts` — add `export * from './visionInferenceCalls';` (next to the IEE block at L104-106).
- `server/config/rlsProtectedTables.ts` — append a `RLS_PROTECTED_TABLES` entry.

**Module shape:**
- *Public interface:* `visionInferenceCalls` Drizzle table export, `VisionInferenceCall` (`$inferSelect`) and `NewVisionInferenceCall` (`$inferInsert`) types. Manifest gains one new row consumable by `verify-rls-coverage.sh`.
- *What stays hidden:* the migration's exact SQL (consumed by Postgres only); the index naming.

**Contracts:**

**`server/db/schema/visionInferenceCalls.ts`:**

```typescript
import { pgTable, uuid, text, integer, bigint, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { organisations } from './organisations';
import { subaccounts } from './subaccounts';
import { agentRuns } from './agentRuns';
import { ieeRuns } from './ieeRuns';

// ---------------------------------------------------------------------------
// vision_inference_calls — per-call ledger for browser vision grounding.
//
// Spec: docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md
//   §8.5 row shape, §9 RLS checklist, §12.6 unique constraint, §10 rollup model.
//
// Idempotent harvest key: (iee_run_id, step_index, call_index). Inserts use
// ON CONFLICT DO NOTHING.
//
// Append-only — no deleted_at; matches llm_requests precedent.
// ---------------------------------------------------------------------------

export const visionInferenceCalls = pgTable(
  'vision_inference_calls',
  {
    id:              uuid('id').defaultRandom().primaryKey(),
    organisationId:  uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId:    uuid('subaccount_id').references(() => subaccounts.id),
    runId:           uuid('run_id').notNull().references(() => agentRuns.id),
    ieeRunId:        uuid('iee_run_id').notNull().references(() => ieeRuns.id),
    modelId:         text('model_id').notNull(),
    costCents:       integer('cost_cents').notNull().default(0),
    latencyMs:       integer('latency_ms').notNull(),
    imageSizeBytes:  bigint('image_size_bytes', { mode: 'number' }).notNull(),
    actionType:      text('action_type').notNull(),
    fallbackTrigger: boolean('fallback_trigger').notNull().default(false),
    stepIndex:       integer('step_index').notNull(),
    callIndex:       integer('call_index').notNull(),
    createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    ieeRunStepCallUniq: uniqueIndex('vision_inference_calls_iee_run_step_call_uniq')
      .on(table.ieeRunId, table.stepIndex, table.callIndex),
    orgCreatedIdx:      index('vision_inference_calls_org_created_idx')
      .on(table.organisationId, table.createdAt),
    runIdx:             index('vision_inference_calls_run_idx').on(table.runId),
  }),
);

export type VisionInferenceCall = typeof visionInferenceCalls.$inferSelect;
export type NewVisionInferenceCall = typeof visionInferenceCalls.$inferInsert;
```

**`migrations/0378_vision_inference_calls.sql`:**

```sql
-- 0378_vision_inference_calls.sql
-- browser-vision-grounding spec §8.5, §9, §12.6.
--
-- Per-call ledger for browser vision grounding. Harvested by
-- visionGroundingService.harvestVisionCalls() at IEE finalisation; rolled up
-- by visionInferenceCostRollupJob into cost_aggregates.
--
-- RLS: FORCE ROW LEVEL SECURITY with two-argument current_setting form
-- (fails closed when GUC unset — returns no rows instead of throwing).

CREATE TABLE IF NOT EXISTS vision_inference_calls (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL REFERENCES organisations(id),
  subaccount_id      uuid REFERENCES subaccounts(id),
  run_id             uuid NOT NULL REFERENCES agent_runs(id),
  iee_run_id         uuid NOT NULL REFERENCES iee_runs(id),
  model_id           text NOT NULL,
  cost_cents         integer NOT NULL DEFAULT 0,
  latency_ms         integer NOT NULL,
  image_size_bytes   bigint  NOT NULL,
  action_type        text NOT NULL,
  fallback_trigger   boolean NOT NULL DEFAULT false,
  step_index         integer NOT NULL,
  call_index         integer NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vision_inference_calls_iee_run_step_call_uniq
  ON vision_inference_calls (iee_run_id, step_index, call_index);

CREATE INDEX IF NOT EXISTS vision_inference_calls_org_created_idx
  ON vision_inference_calls (organisation_id, created_at);

CREATE INDEX IF NOT EXISTS vision_inference_calls_run_idx
  ON vision_inference_calls (run_id);

ALTER TABLE vision_inference_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE vision_inference_calls FORCE ROW LEVEL SECURITY;

CREATE POLICY vision_inference_calls_org_isolation ON vision_inference_calls
  FOR ALL
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);
```

**`migrations/0378_vision_inference_calls.down.sql`:**

```sql
DROP TABLE IF EXISTS vision_inference_calls;
```

**`server/db/schema/index.ts`** — insert next to IEE block (around L106):

```typescript
// browser-vision-grounding (migration 0378)
export * from './visionInferenceCalls';
```

**`server/config/rlsProtectedTables.ts`** — append a single entry (sorted by migration number near the end of the array):

```typescript
// 0378 — browser-vision-grounding: per-call vision inference ledger
{
  tableName: 'vision_inference_calls',
  schemaFile: 'visionInferenceCalls.ts',
  policyMigration: '0378_vision_inference_calls.sql',
  rationale: 'Per-call ledger for browser vision grounding (vLLM cost + latency + action type per inference). Cross-tenant leak would expose another org\'s GUI automation patterns and inference cost telemetry.',
},
```

**Error handling:** none (schema).

**Test considerations:**
- Static gate: `verify-rls-coverage.sh` (CI) verifies the manifest entry matches a `CREATE POLICY` in the named migration. No new test authored in this chunk.
- Static gate: `verify-rls-contract-compliance.sh` (CI) verifies FORCE RLS + canonical policy shape. No new test.
- Manual smoke: `npm run db:generate` after the migration must not produce any drizzle-kit diff for `vision_inference_calls` (i.e. the Drizzle schema is in sync with the SQL CREATE TABLE).

**Dependencies:** none (other than the existing `agentRuns`, `ieeRuns`, `organisations`, `subaccounts` tables which already exist).

**Verification commands:**

```
npm run lint
npm run typecheck
npm run db:generate
```

**Acceptance criteria:**
- Migration file numbered exactly `0378`, both `.sql` and `.down.sql`.
- Schema file follows `ieeRuns.ts` style (header comment with spec section, column types, index naming).
- Manifest entry sorted near the end of `RLS_PROTECTED_TABLES`.
- Two-argument `current_setting('app.organisation_id', true)::uuid` form used (NOT the single-argument form).
- `FOR ALL` policy with both `USING` and `WITH CHECK` clauses.
- `verify-rls-coverage.sh` would pass in CI (assertable by reading the script's expectations).

---

### Chunk C4 — `shared/types/sandbox.ts` extension

**spec_sections:** §8.2 (`SandboxRunTaskInput` extension)

**Files to modify:**
- `shared/types/sandbox.ts` — add four optional fields to `SandboxRunTaskInput`.

**Module shape:**
- *Public interface:* `SandboxRunTaskInput` gains four optional `string | null` fields and one optional `VisionDecisionMode | null` field. Backwards-compatible — all callers can omit the new fields.
- *What stays hidden:* the source-of-truth contract (server-side `_ieeShared.ts` is the only field populator; harness is the only consumer).

**Contracts (append after the existing `humanize?:` field at L259):**

```typescript
/**
 * Decision-mode for IEE-browser tasks (spec docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md §8.2).
 *
 * Absent = 'dom' (existing DOM-selector execution; behaviour byte-identical to V1 baseline).
 * 'vision' = every step calls the vLLM endpoint.
 * 'hybrid' = DOM-first; falls back to vision after 1 DOM selector failure + 1 retry.
 *
 * Source-of-truth: server/services/executionBackends/_ieeShared.ts populates these
 * from visionGroundingService.resolveEndpointConfig(). Never written to any DB column;
 * exists only in the in-flight task envelope.
 */
decisionMode?: import('./visionActions.js').VisionDecisionMode | null;
/** Required when decisionMode != 'dom'. HTTPS endpoint URL of the managed vLLM service. */
visionEndpointUrl?: string | null;
/**
 * Optional bearer token for the vLLM endpoint. Short-lived; never persisted.
 * Redaction obligations: harness MUST NOT log this value, MUST NOT include it
 * in failure payloads or artefacts. See spec §8.3.
 */
visionEndpointToken?: string | null;
/** Resolved model id (e.g. 'ui-tars-7b'); required when decisionMode != 'dom'. */
visionModelId?: string | null;
```

**Error handling:** N/A (types only).

**Test considerations:**
- Type-level only. Downstream chunks (C6 service, C7 dispatch wiring, C8 harness stub) exercise the fields in runtime.
- The four new fields are validated at dispatch time by `visionGroundingService.resolveEndpointConfig()`; no Zod schema added in this chunk.

**Dependencies:** C1 (`VisionDecisionMode` type).

**Verification commands:**

```
npm run typecheck
npm run lint
```

**Acceptance criteria:**
- Type-only `import` of `VisionDecisionMode` (`import type` semantics via the `import('./visionActions.js')` form — keeps `shared/types/sandbox.ts` runtime-import-free, matching the existing `import('./humanize.js').HumanizeOptions` pattern at L259).
- JSDoc cites spec §8.2 and §8.3 (redaction).
- No other fields touched; no field removed or reordered.
- `tsc --noEmit` clean across the entire workspace (this type is widely imported).

---

### Chunk C10 — `server/services/skillParserServicePure.ts` (`iee_decision_mode` surface)

**spec_sections:** §8.9 (skill YAML frontmatter extension), §7 (file inventory)

**Files to modify:**
- `server/services/skillParserServicePure.ts` — add `ieeDecisionMode` to `ParsedSkill`; surface from frontmatter.

**Module shape:**
- *Public interface:* `ParsedSkill` interface gains one optional field. `parseMarkdownFile` and `parseJsonFile` populate it.
- *What stays hidden:* the YAML key→TS field mapping; the unknown-value tolerance posture.

**Contracts:**

Add field to `ParsedSkill` interface at L8-15:

```typescript
export interface ParsedSkill {
  name: string;
  slug: string;
  description: string;
  definition: object | null;
  instructions: string | null;
  rawSource: string;
  /**
   * Optional IEE decision-mode declaration from skill YAML frontmatter
   * (spec docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md §8.9).
   * 'dom' | 'vision' | 'hybrid'. Absent means the skill does not declare;
   * the IEE dispatch path treats absent as 'dom'.
   *
   * Unknown / typo values (e.g. 'domm') are silently discarded — the parser
   * returns `undefined` for any value not in the allowed union (see §2.6 lenient
   * parser posture). The dispatch path treats `undefined` as 'dom', so typos
   * silently fall back to DOM mode in V1. This is intentional: the parser is
   * forgiving; strict YAML validation is a V2 option. Note: the dispatch path
   * CANNOT distinguish "field absent" from "typo value" — both produce `undefined`.
   */
  ieeDecisionMode?: 'dom' | 'vision' | 'hybrid';
}
```

Populate in `parseMarkdownFile` (around L130, after `description` extraction):

```typescript
const rawDecisionMode = frontmatter['iee_decision_mode'];
const ieeDecisionMode = (rawDecisionMode === 'dom' || rawDecisionMode === 'vision' || rawDecisionMode === 'hybrid')
  ? rawDecisionMode
  : undefined;
```

Add `ieeDecisionMode` to the return object at L186-194.

Populate in `parseJsonFile` similarly (around L204-216): read `parsed['iee_decision_mode']` as string, narrow to the union, add to return.

**Error handling:** none — unknown values become `undefined` (lenient). The IEE dispatch path is responsible for validating and rejecting unknown values per spec §8.9.

**Test considerations:**
- Existing parser tests must continue to pass. The new field is optional; existing skill .md files do not declare it, so `ieeDecisionMode` is `undefined` for all 101 built-in skills.
- No new test added in this chunk. C12 docs chunk will reference the YAML field; a Vitest test for the parser's handling of the new key is **optional** and may be added if the builder finds value in it, but is not gate-required by the spec's testing posture (static_gates_primary).

**Dependencies:** none (no internal deps; spec §11).

**Verification commands:**

```
npm run lint
npm run typecheck
```

**Acceptance criteria:**
- `ParsedSkill` interface unchanged in field order; new field appended.
- Both parser entry points populate the new field consistently.
- Unknown YAML values (e.g. `iee_decision_mode: typo`) produce `undefined`, NOT a throw.
- JSDoc cites spec §8.9.
- All existing skill .md files still parse to identical `ParsedSkill` shape (verified by re-running any existing parser tests if present).

---

### Chunk C2 — `server/services/visionActionParserPure.ts` + Vitest

**spec_sections:** §8.1 (parser input grammar — UI-TARS native action text format)

**Files to create:**
- `server/services/visionActionParserPure.ts` — pure text parser.
- `server/services/__tests__/visionActionParserPure.test.ts` — Vitest.

**Files to modify:** none.

**Module shape:**
- *Public interface:* `parseVisionAction(line: string): VisionAction` (throws on invalid), `tryParseVisionAction(line: string): VisionAction | null` (returns null on invalid). The harness will use `tryParse...` and emit `vision_inference_unavailable` if it returns null on a non-screenshot action.
- *What stays hidden:* the per-verb regex set; the integer coercion + range checks; the whitespace normalisation; the quoted-string parser with escape handling.

**Contracts:**

Grammar (spec §8.1, the 9-verb table):

```
click(x, y)               x, y non-negative integers
double_click(x, y)        x, y non-negative integers
right_click(x, y)         x, y non-negative integers
type("text")              text is a quoted string; escape sequences allowed
scroll(dx, dy)            dx, dy signed integers
hotkey("ctrl+c")          combo is a quoted string of "+"-joined modifier+key tokens
wait(1500)                ms positive integer
screenshot()              no args
done()                    no args
```

Parser behaviour:
- Trim leading/trailing whitespace on the input line.
- Collapse internal whitespace runs to single spaces (spec §8.1 normalisation rule).
- Tolerate optional trailing whitespace inside parens.
- Reject: unknown verbs, missing required args, non-integer coords, negative `x`/`y`/`ms`, malformed `combo`, missing closing paren, missing closing quote.
- Quoted-string parsing for `type(...)` and `hotkey(...)`: support standard backslash escapes; reject embedded newlines.

```typescript
import type { VisionAction } from '../../shared/types/visionActions.js';

/**
 * Parse one UI-TARS native action text line into a typed VisionAction.
 *
 * Grammar pinned to spec §8.1 (browser-vision-grounding 2026-05-18), versioned
 * against bytedance/UI-TARS HEAD@2026-05-18. The 9-verb table in the spec is
 * authoritative; upstream README mutations do NOT change this parser without
 * a spec amendment.
 *
 * @throws if the line is not a valid action.
 */
export function parseVisionAction(line: string): VisionAction;

/**
 * Non-throwing variant. Returns null for any invalid input; the caller (harness)
 * decides whether to treat null as a soft retry or a hard failure.
 */
export function tryParseVisionAction(line: string): VisionAction | null;
```

**Error handling:**
- `parseVisionAction` throws `Error` with messages that name the violated rule (e.g. `'unknown verb: foo'`, `'click: x must be a non-negative integer'`).
- `tryParseVisionAction` returns `null` for all invalid input. Never throws.

**Test considerations (`visionActionParserPure.test.ts`):**
- **Happy path:** one test per verb (9 tests), each asserting the parsed `VisionAction` matches the spec §8.1 expected output (e.g. `click(340, 220)` → `{ type: 'click', x: 340, y: 220 }`).
- **Negative path:** at least one test per rejection case named in spec §8.1: unknown verb, missing required arg, non-integer coordinate, negative `x`/`y`/`ms`, malformed `combo`. Total ≥ 6 negative tests.
- **Normalisation:** test that `  click(340,  220)  ` (extra whitespace) parses the same as `click(340, 220)`.
- **`tryParseVisionAction` parity:** for each negative case, assert `tryParseVisionAction` returns `null` AND `parseVisionAction` throws.
- **Pure function:** no DB, no env, no network. Vitest-only.

Minimum 18 test cases. Use `describe` blocks per verb.

**Dependencies:** C1 (`VisionAction` type).

**Verification commands:**

```
npm run lint
npm run typecheck
npx vitest run server/services/__tests__/visionActionParserPure.test.ts
```

**Acceptance criteria:**
- All ≥ 18 tests pass.
- File ≤ 250 lines (pure function; mechanical).
- Zero non-shared imports.
- Header JSDoc cites spec §8.1 and the grammar pin `HEAD@2026-05-18`.
- Output type matches `VisionAction` exactly (no extra fields).

---

### Chunk C6 — `server/services/visionGroundingService.ts`

**spec_sections:** §8.6 (config contract), §8.7 (network policy), §10 (execution model — `resolveEndpointConfig` + `harvestVisionCalls`), §12.1 (harvest idempotency), §9 (RLS — service-layer subaccount filtering)

**Files to create:**
- `server/services/visionGroundingService.ts`

**Files to modify:** none.

**Module shape:**
- *Public interface:*
  - `resolveEndpointConfig(): { endpointUrl: string; apiKey: string | null; modelId: string }` — synchronous env-var read + validation. Throws `FailureError(failure('vision_inference_not_configured', ...))` if URL absent or non-HTTPS.
  - `harvestVisionCalls(tx: Transaction, ieeRun: IeeRun): Promise<{ harvested: number }>` — reads `vision_calls.json` artefact for the run (from object storage via existing artefact pointer), validates each record's `costCents` against `computeCostCents()` for parity, INSERTs into `vision_inference_calls` with `ON CONFLICT (iee_run_id, step_index, call_index) DO NOTHING`. Returns count of new rows inserted. **Calls `setOrgGUC(tx, ieeRun.organisationId)` as its first statement** so RLS WITH CHECK passes.
  - `parseVisionEndpointHostPort(endpointUrl: string): { host: string; port: number }` — pure helper exported for `_ieeShared.ts` to construct the allowlist entry. Throws on non-HTTPS URL.
- *What stays hidden:* env-var names, the artefact-read mechanism (object storage download), the parity-validation logic, the unknown-model handling (delegated to `computeCostCents`).

**Contracts:**

```typescript
import type { Transaction } from '../db/index.js';
import type { IeeRun } from '../db/schema/ieeRuns.js';
import { visionInferenceCalls } from '../db/schema/visionInferenceCalls.js';
import { setOrgGUC } from '../lib/orgScoping.js';
import { env } from '../lib/env.js';
import { FailureError, failure } from '../../shared/iee/failure.js';
import { computeCostCents } from '../../shared/visionInferencePricing.js';
import { logger } from '../lib/logger.js';

export interface VisionEndpointConfig {
  endpointUrl: string;
  apiKey: string | null;
  modelId: string;
}

/**
 * Resolve managed vLLM endpoint config from env vars. Synchronous;
 * called inline within IEE dispatch.
 *
 * Throws FailureError(vision_inference_not_configured) if:
 *   - VISION_INFERENCE_ENDPOINT_URL is absent
 *   - the URL is not HTTPS
 *
 * Returns endpointUrl, apiKey (nullable), modelId (default 'ui-tars-7b').
 *
 * Spec §8.6.
 */
export function resolveEndpointConfig(): VisionEndpointConfig;

/**
 * Parse the host:port from VISION_INFERENCE_ENDPOINT_URL for the sandbox
 * network allowlist entry. Throws if URL is not HTTPS.
 *
 * Exported for _ieeShared.ts dispatch-time allowlist construction (spec §8.7).
 */
export function parseVisionEndpointHostPort(endpointUrl: string): { host: string; port: number };

/**
 * Harvest vision_calls.json artefact into vision_inference_calls ledger.
 *
 * Called inline within ieeFinalise(tx, ...), immediately before the parent
 * agent_runs terminal UPDATE. Shares the orchestrator's transaction so
 * harvest failure prevents the terminal write (spec §12.1).
 *
 * Idempotent via UNIQUE (iee_run_id, step_index, call_index); uses
 * INSERT ... ON CONFLICT DO NOTHING.
 *
 * Sets app.organisation_id GUC at entry so RLS WITH CHECK passes on INSERT.
 *
 * Returns { harvested: count of new rows inserted }. Zero is valid (the run
 * was DOM-mode or the artefact is absent).
 *
 * Spec §10 execution model, §12.1 idempotency.
 */
export async function harvestVisionCalls(
  tx: Transaction,
  ieeRun: IeeRun,
): Promise<{ harvested: number }>;
```

**Internal logic (harvestVisionCalls):**
1. `await setOrgGUC(tx, ieeRun.organisationId)`.
2. Look up the `vision_calls.json` artefact pointer. In V1 the harness is a stub and will not have written the file, so the pointer is absent → return `{ harvested: 0 }`. Implementation: query `iee_artifacts WHERE iee_run_id = ieeRun.id AND path LIKE '%vision_calls.json'` LIMIT 1; if no row, return `{ harvested: 0 }`.
3. Download the artefact bytes from object storage. The exact API call goes through the existing artefact-read path (see `server/services/sandboxHarvestService.ts` for the precedent). For V1 stub: the path will never be exercised; implement the function but mark it with a clear `// V1: not reachable — harness is stub. Wired for the follow-up build.` comment block.
4. Parse the JSON as `VisionCallRecord[]` (spec §8.4).
5. For each record:
   - Parity-validate: compute `expectedCostCents = computeCostCents({ modelId: rec.modelId, imageSizeBytes: rec.imageSizeBytes, latencyMs: rec.latencyMs, outputTokens: 0 })`. If `expectedCostCents !== rec.costCents`, log a warning (`vision.harvest.cost_parity_mismatch`) but use `rec.costCents` as-is — the harness is the source of truth; the parity check is a tripwire for drift between harness and server.
   - INSERT one row using `tx.insert(visionInferenceCalls).values({...}).onConflictDoNothing()`.
6. Return `{ harvested: insertedCount }`.

**Error handling:**
- `resolveEndpointConfig()`: missing or non-HTTPS URL → `throw new FailureError(failure('vision_inference_not_configured', 'VISION_INFERENCE_ENDPOINT_URL missing or non-HTTPS'))`.
- `parseVisionEndpointHostPort()`: non-HTTPS → throws `Error('VISION_INFERENCE_ENDPOINT_URL must be HTTPS')`. Caller (`_ieeShared.ts`) should not invoke this for DOM-mode tasks.
- `harvestVisionCalls()`: object-storage read failure → throws (propagates out of `ieeFinalise` `tx` → transaction rolls back → worker retries). JSON parse failure → throws. INSERT ON CONFLICT DO NOTHING → no error on duplicate (idempotent).

**Test considerations:**
- Per spec §15 testing posture (`testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`), **no integration tests for this service are authored in this chunk.** The function `parseVisionEndpointHostPort` is pure and CAN have a targeted Vitest test (verifies URL parsing and the HTTPS guard) — recommended but not gate-required. The harness/dispatch wiring is verified end-to-end in CI gates that the build does not author here.
- If the builder authors `parseVisionEndpointHostPort` tests: 3 cases — valid HTTPS URL with explicit port, valid HTTPS URL without port (defaults to 443), non-HTTPS URL throws.

**Dependencies:** C1, C3, C4, C5, C11.

**Verification commands:**

```
npm run lint
npm run typecheck
```

Optional (if `parseVisionEndpointHostPort` tests are authored):

```
npx vitest run server/services/__tests__/visionGroundingService.test.ts
```

**Acceptance criteria:**
- File < 250 lines.
- `resolveEndpointConfig` and `parseVisionEndpointHostPort` are pure (no I/O, no DB).
- `harvestVisionCalls` is the ONLY function in the file that touches DB.
- First line of `harvestVisionCalls` is `await setOrgGUC(tx, ieeRun.organisationId);`.
- Parity-validation warning is logged via `logger.warn`, not an exception.
- ON CONFLICT DO NOTHING used for the INSERT (spec §12.1).
- JSDoc cites spec §8.6, §8.7, §10, §12.1.

---

### Chunk C8 — Harness stub (`HarnessInput` extension + `visionDecisionLoop.ts`)

**spec_sections:** §8.3 (`HarnessInput` extension + token redaction contract), §8.4 (`vision_calls.json` shape), §8.8 (failure-reason raises), §12.5 (no-silent-partial-success)

**Files to create:**
- `infra/sandbox-templates/iee-browser/harness/visionDecisionLoop.ts` — stub.

**Files to modify:**
- `infra/sandbox-templates/iee-browser/harness/index.ts` — extend `HarnessInput`; route to `visionDecisionLoop` when `decisionMode !== 'dom'`.

**Module shape:**
- *Public interface (`visionDecisionLoop.ts`):* `export async function visionDecisionLoop(input: HarnessInput): Promise<HarnessOutput>` — entrypoint invoked by `index.ts` when `decisionMode` is `'vision'` or `'hybrid'`. In V1, returns `{ status: 'failed', reason: 'visionDecisionLoop: stub — e2b SDK not wired. ...' }` without writing any artefact.
- *What stays hidden:* the future Playwright wiring, the screenshot capture, the vLLM HTTP call, the `vision_calls.json` accumulator. The follow-up build will fill these in without changing the public signature.

**Contracts:**

**`index.ts` — extend `HarnessInput`** (around L18-49):

```typescript
interface HarnessInput {
  taskPayload: unknown | null;
  profileMount: { userDataDirInSandbox: string };
  artefactsDir: string;
  proxyAlignment?: ProxyAlignment | null;
  proxyUrlEnvKey?: string | null;
  humanize?: HumanizeOptions | null;

  // browser-vision-grounding spec §8.3.
  // When decisionMode is 'vision' or 'hybrid', main() routes to visionDecisionLoop().
  // Absent or 'dom' = existing DOM-selector path.
  // visionEndpointToken is a short-lived secret — MUST NOT be logged or
  // included in any artefact / failure payload (spec §8.3 redaction contract).
  decisionMode?: 'dom' | 'vision' | 'hybrid' | null;
  visionEndpointUrl?: string | null;
  visionEndpointToken?: string | null;
  visionModelId?: string | null;
}
```

**`index.ts` — route in `main()`** (around L74, after `mkdir(artefactsDir)`):

```typescript
// browser-vision-grounding spec §8.3.
// When decisionMode is non-'dom', route to the vision loop. V1 is a stub —
// fails loudly. The DOM-mode branch (current behaviour) is unchanged.
const decisionMode = input.decisionMode ?? 'dom';
if (decisionMode === 'vision' || decisionMode === 'hybrid') {
  const { visionDecisionLoop } = await import('./visionDecisionLoop.js');
  const result = await visionDecisionLoop(input);
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(result));
  process.exit(result.status === 'completed' ? 0 : 1);
}
// Existing dom-mode flow continues unchanged from here.
```

**`visionDecisionLoop.ts` (stub):**

```typescript
// browser-vision-grounding spec §3 (framing assumptions), §8.3, §8.8, §12.5.
// V1: stub. Fails loudly — never writes status:'completed'.
// Follow-up build wires screenshot capture, vLLM HTTP call, Playwright execution,
// vision_calls.json accumulator, and the DOM-first-then-vision orchestration for
// hybrid mode (see spec §13 deferred items, "Full harness wiring").
//
// Token redaction (spec §8.3): when implementing the follow-up wiring, the
// visionEndpointToken MUST be treated as a masked secret. NEVER interpolate it
// into log lines, error messages, or vision_calls.json. The audit checklist:
//   - logger calls scrub the token before formatting
//   - failure-payload constructors omit the token field
//   - artefact JSON files omit the token field
//   - sandbox stdout / stderr never echo it

import type { computeCostCents as ComputeCostCentsFn } from '../../../../shared/visionInferencePricing.js';

interface HarnessInput {
  decisionMode?: 'dom' | 'vision' | 'hybrid' | null;
  visionEndpointUrl?: string | null;
  visionEndpointToken?: string | null;
  visionModelId?: string | null;
  // ... other fields from index.ts not needed in the stub
}

interface HarnessOutput {
  status: 'completed' | 'failed';
  reason?: string;
}

// Type-only import keeps the cost helper signature visible for the follow-up
// build without pulling its runtime into the stub. Suppresses unused-symbol
// lint in V1; the follow-up wiring will value-import it.
type _ComputeCostCentsFn = typeof ComputeCostCentsFn;

export async function visionDecisionLoop(input: HarnessInput): Promise<HarnessOutput> {
  const mode = input.decisionMode ?? 'dom';
  return {
    status: 'failed',
    reason:
      `visionDecisionLoop: V1 stub — the e2b SDK is not installed yet, so the ` +
      `screenshot+vLLM+Playwright loop is not wired. decisionMode=${mode}. ` +
      `Mapped to FailureReason='vision_inference_unavailable' by the IEE finalisation ` +
      `path on harness exit. See spec §13 deferred items, "Full harness wiring".`,
  };
  // Do NOT include input.visionEndpointToken in the reason string — token-redaction
  // contract (spec §8.3) applies even in the stub.
}
```

**Note on the `import type` line:** the stub uses `import type` for `computeCostCents` so the harness binary doesn't depend on the shared module at runtime in V1. The follow-up build will switch to a value `import` once the loop is wired.

**Error handling:**
- The stub returns `{ status: 'failed', reason: ... }` — never throws. The outer `index.ts` writes the output and exits 1.
- The `reason` string does NOT contain `input.visionEndpointToken`. The redaction contract (spec §8.3) is enforced at code-review time and via the explicit JSDoc reminder.

**Test considerations:**
- Static-gates posture (spec §15). No runtime test for the stub. The harness's stub-loud-failure behaviour is verified by the existing CI gates that check `status: 'completed'` is never written for unwired execution paths (see `infra/sandbox-templates/iee-browser/harness/index.ts:120-129` for the existing stub pattern).

**Dependencies:** C1 (decisionMode union), C3 (failure reason names), C4 (envelope fields), C11 (`computeCostCents` type for the future-proof `import type`).

**Verification commands:**

```
npm run lint
npm run typecheck
```

**Acceptance criteria:**
- `HarnessInput` interface gains 4 new optional fields, matching `SandboxRunTaskInput` exactly in name and type.
- `main()` routes to `visionDecisionLoop` when `decisionMode === 'vision' | 'hybrid'`.
- `visionDecisionLoop` returns `{ status: 'failed', reason: '...' }` with no DOM-mode side effects.
- The `reason` string does NOT contain the token value.
- `import type` for `computeCostCents` (no runtime dep on shared module in V1 stub).
- JSDoc cites spec §8.3 redaction contract.

---

### Chunk C13 — `decisionMode` thread audit + IeeTask wiring

**spec_sections:** §8.9 (skill YAML → dispatch path), §8.2 (`SandboxRunTaskInput.decisionMode` source-of-truth)

*Added in chatgpt-plan-review Round 1 (F2) — R8 promoted to its own chunk so C7 consumes a proven field rather than a type-assertion cast.*

**Files to modify:**
- Whichever file(s) construct the `IeeTask` payload from a `ParsedSkill` — identified by the builder at audit time (see audit steps below).

**Module shape:**
- *Public interface:* `IeeTask` gains one optional field `decisionMode?: 'dom' | 'vision' | 'hybrid'` (if not already present). All callers that build `IeeTask` objects from a `ParsedSkill` populate `decisionMode: parsedSkill.ieeDecisionMode ?? 'dom'`.
- *What stays hidden:* the audit grep steps; the file-path list is confirmed at build time.

**Audit steps the builder MUST run:**

1. Grep for `IeeTask` type definition:
   ```bash
   grep -r "IeeTask" server/ shared/ --include="*.ts" -l
   ```
   Read the type file to check if `decisionMode` is already present.

2. If `decisionMode` is absent from `IeeTask`, add it:
   ```typescript
   decisionMode?: 'dom' | 'vision' | 'hybrid';
   ```

3. Grep for `IeeTask` construction sites:
   ```bash
   grep -r "IeeTask\b" server/ --include="*.ts" -n | grep -v "import\|type\|interface\|declare"
   ```
   For each site that constructs an `IeeTask` literal from a `ParsedSkill`, add:
   ```typescript
   decisionMode: parsedSkill.ieeDecisionMode ?? 'dom',
   ```
   (Use `?? 'dom'` — treat absent/unknown as DOM mode per spec §8.9.)

4. Verify that `_ieeShared.ts` `ieeDispatchBrowser` can now read `opts.ieeTask?.decisionMode` with the proper type (no type-assertion cast needed after C13).

5. If more than 2 IeeTask construction sites require the new field, or if the `IeeTask` type lives in a file with wide surface area (> 10 callers), **STOP and escalate** — the scope exceeds the chunk boundary.

**Error handling:** N/A — type additions only; no runtime logic in this chunk.

**Test considerations:** None new — the field is optional and all existing callers omit it (defaults to `'dom'` at C7 read time).

**Dependencies:** C10 (supplies `ParsedSkill.ieeDecisionMode`).

**Verification commands:**

```
npm run lint
npm run typecheck
```

**Acceptance criteria:**
- `IeeTask` type has `decisionMode?: 'dom' | 'vision' | 'hybrid'`.
- All IeeTask construction sites from a `ParsedSkill` populate `decisionMode`.
- `_ieeShared.ts` can read `opts.ieeTask?.decisionMode` with proper TS type (no `as` cast on the decisionMode read).
- `tsc --noEmit` clean workspace-wide.

---

### Chunk C7 — `server/services/executionBackends/_ieeShared.ts` (dispatch + finalise)

**spec_sections:** §3 (framing assumptions), §7 (`_ieeShared.ts` modified), §8.7 (network policy merge), §10 (execution model — dispatch threading + harvest hook), §12.1 (harvest atomicity)

**Files to modify:**
- `server/services/executionBackends/_ieeShared.ts` — two changes:
  1. **Dispatch (inside `ieeDispatchBrowser`):** read `decisionMode` from the task payload, call `visionGroundingService.resolveEndpointConfig()` for vision-mode tasks, thread four fields into `SandboxRunTaskInput`, merge the vision allowlist entry into `policy.network`.
  2. **Finalisation (inside `ieeFinalise`):** call `visionGroundingService.harvestVisionCalls(tx, ieeRun)` immediately before the `agent_runs` terminal UPDATE.

**Module shape:**
- *Public interface:* unchanged. `ieeDispatch` and `ieeFinalise` signatures remain identical.
- *What stays hidden:* the source-of-decisionMode (skill YAML → IeeTask → ieeDispatchBrowser); the network-allowlist merge construction; the harvest call.

**Contracts:**

**Change 1 — `ieeDispatchBrowser` (around L156-313):**

Insert after `sessionKey` derivation at L215, before `profile` resolve at L217:

```typescript
// browser-vision-grounding spec §8.2, §8.6, §8.7.
// decisionMode is sourced from opts.ieeTask.decisionMode — typed correctly
// after C13 adds the field to IeeTask and wires it from ParsedSkill.
// No cast needed here; if TS still requires one, C13 was incomplete — escalate.
const decisionMode: 'dom' | 'vision' | 'hybrid' = opts.ieeTask?.decisionMode ?? 'dom';

let visionEndpointUrl: string | null = null;
let visionEndpointToken: string | null = null;
let visionModelId: string | null = null;
let visionAllowlistEntry: { host: string; port: number; protocol: 'https' } | null = null;

if (decisionMode === 'vision' || decisionMode === 'hybrid') {
  // Throws FailureError(vision_inference_not_configured) when env is missing
  // or non-HTTPS — fails dispatch BEFORE sandbox creation (spec §12.5).
  const config = visionGroundingService.resolveEndpointConfig();
  visionEndpointUrl = config.endpointUrl;
  visionEndpointToken = config.apiKey;
  visionModelId = config.modelId;
  const { host, port } = visionGroundingService.parseVisionEndpointHostPort(config.endpointUrl);
  visionAllowlistEntry = { host, port, protocol: 'https' };
}
```

Modify the `policy` construction at L229-241. Replace:

```typescript
network: { mode: 'none' },
```

with:

```typescript
// browser-vision-grounding spec §8.7: merge — never replace — when adding the
// vision allowlist entry. Preserves any future broader allowlist (IEE-DEF-7)
// the dispatch layer wires in for production browser navigation.
// baseNetwork reflects TODAY'S dom-mode default ('none'). When IEE-DEF-7 lands
// and introduces a production browser-navigation policy, replace this hard-coded
// literal with the actual policy derived at dispatch time (e.g. from the task
// template or org config). Do NOT introduce another hard-coded { mode: 'none' }
// at that point — the merge below ensures the vision entry is additive regardless
// of what baseNetwork contains.
const baseNetwork: SandboxNetworkPolicy = { mode: 'none' };
const taskNetwork: SandboxNetworkPolicy = visionAllowlistEntry === null
  ? baseNetwork
  : {
      mode: 'allowlist',
      allowlist: [
        ...(baseNetwork.mode === 'allowlist' ? (baseNetwork.allowlist ?? []) : []),
        visionAllowlistEntry,
      ],
    };
// Use taskNetwork in the policy object:
// network: taskNetwork,
```

**Note on existing TODO IEE-DEF-7:** the comment block at L223-227 about `network.mode = 'none'` being the V1 stub posture is still true for DOM-mode tasks. Update the TODO comment to acknowledge the new vision-mode branch:

```typescript
// TODO IEE-DEF-7: dom-mode tasks still use network.mode='none'; production
// browser navigation for dom-mode requires a broader allowlist (per skill, per
// subaccount, or per template). When IEE-DEF-7 lands, the merge in the
// vision-mode branch below ensures the vision entry stays additive — do not
// regress the merge to a replace.
```

Add the four new fields to the `sandboxRunTask` call at L251-271 (alongside `humanize` and `proxyAlignment`):

```typescript
decisionMode,
visionEndpointUrl,
visionEndpointToken,
visionModelId,
```

**Change 2 — `ieeFinalise` (around L510-711):**

Inside the `if (!parentAlreadyTerminal) { ... }` block (L597-647), immediately BEFORE the `assertValidTransition` call at L598:

```typescript
// browser-vision-grounding spec §12.1: harvest vision_calls.json artefact
// into vision_inference_calls ledger inside this transaction. Harvest failure
// throws → tx rolls back → parent agent_runs terminal UPDATE never commits →
// worker retries → harvest re-runs idempotently (ON CONFLICT DO NOTHING on
// (iee_run_id, step_index, call_index)).
//
// Browser-only: dev IEE tasks never write vision_calls.json. Gated by
// ieeRun.type to skip the artefact lookup for dev tasks.
if (ieeRun.type === 'browser') {
  await visionGroundingService.harvestVisionCalls(tx, ieeRun);
}
```

**Imports:** add at the top of `_ieeShared.ts`:

```typescript
import * as visionGroundingService from '../visionGroundingService.js';
```

(Wildcard import to expose `resolveEndpointConfig`, `parseVisionEndpointHostPort`, and `harvestVisionCalls` without three separate named imports.)

**Error handling:**
- Dispatch-time `resolveEndpointConfig()` throw → propagates as `FailureError(vision_inference_not_configured)` → caller's existing `try/catch` in `ieeDispatchBrowser` (currently the `try { ... } finally { ... }` at L204-292) handles cleanup of any mounted profile / warm session lease. **The throw happens BEFORE `mounted = await ...` (L218), so the `finally` block sees `mounted = null` and does not attempt unmount.** Acceptable.
- Harvest-time throw → propagates out of `ieeFinalise`'s `tx` → orchestrator's `db.transaction` callback rejects → transaction rolls back → orchestrator logs the error and pg-boss retries (existing path; no new error handling needed).

**Test considerations:**
- Static-gates posture (spec §15). No new runtime test in this chunk.
- The builder should manually verify by reading the diff that:
  - `decisionMode` is sourced from `opts.ieeTask?.decisionMode`, not from any other location.
  - `visionEndpointToken` value is never logged.
  - `policy.network` merge preserves any future broader allowlist (no replace).
  - Harvest call is INSIDE the `if (!parentAlreadyTerminal)` block (so it does not re-run for race-loser finalisations) AND BEFORE `assertValidTransition` (so a harvest failure does not let the terminal write happen).

**Dependencies:** C3, C4, C6, C13.

**Verification commands:**

```
npm run lint
npm run typecheck
```

**Acceptance criteria:**
- `decisionMode` resolved exactly once per dispatch, defaults to `'dom'` when absent on the task payload.
- `resolveEndpointConfig()` is called ONLY when `decisionMode !== 'dom'` (avoids unnecessary env-var validation on DOM-mode tasks).
- `policy.network` is merged, not replaced (`mode: 'allowlist'` only when `visionAllowlistEntry !== null`; otherwise `mode: 'none'` is preserved).
- Four new fields appear in the `sandboxRunTask({...})` call in the documented order.
- `harvestVisionCalls(tx, ieeRun)` is called inside `ieeFinalise` BEFORE the `assertValidTransition` and the `tx.update(agentRuns)` terminal write.
- Harvest is gated on `ieeRun.type === 'browser'` (dev IEE tasks skip).
- The TODO IEE-DEF-7 comment is updated to reference the merge contract.
- No `visionEndpointToken` interpolation into any log call inside this file.

---

### Chunk C9 — `server/jobs/visionInferenceCostRollupJob.ts` + boot registration

**spec_sections:** §10 (execution model — async pg-boss rollup), §1 Goal 6 + §3 framing assumption (mid-run enforcement deferred), §13 (deferred items)

**Files to create:**
- `server/jobs/visionInferenceCostRollupJob.ts`

**Files to modify:**
- `server/index.ts` — append a boot-time registration block alongside the existing IEE rollup at L807-816.

**Module shape:**
- *Public interface:* `runVisionInferenceCostRollup(): Promise<{ durationMs: number }>` (exposed for targeted testing + manual `boss.send(...)`), `registerVisionInferenceCostRollupJob(): Promise<void>` (boot registration).
- *What stays hidden:* the two SQL upserts, the UTC day-boundary handling, the per-org grouping.

**Contracts:**

```typescript
/**
 * visionInferenceCostRollupJob.ts — daily rollup of vision_inference_calls into cost_aggregates.
 *
 * Spec: docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md §10, §13.
 *
 * Mirrors server/jobs/ieeCostRollupDailyJob.ts:
 *   - withAdminConnection + SET LOCAL ROLE admin_role for cross-tenant aggregation.
 *   - UTC day boundary: `created_at AT TIME ZONE 'UTC'` before date_trunc.
 *   - Look-back: 2 days.
 *   - Two upserts:
 *       (a) entity_type='source_type', entity_id='vision_inference' — platform aggregate.
 *       (b) entity_type='run', entity_id=run_id::text — per-run aggregate consumed
 *           by runCostBreaker. Enforcement applies from the FOLLOWING run onward
 *           (spec §1 Goal 6; mid-run enforcement deferred — spec §13).
 *   - ON CONFLICT (entity_type, entity_id, period_type, period_key) DO UPDATE.
 *   - Schedule: '15 2 * * *' UTC (5-minute offset from IEE rollup at '10 2 * * *').
 *
 * Schedule-registration invariant: pg-boss boss.schedule(name, cron, ...) is
 * idempotent by name (matches ieeCostRollupDailyJob).
 */
import { sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import { getPgBoss } from '../lib/pgBossInstance.js';

const QUEUE_NAME = 'vision-inference-cost-rollup-daily';
const SCHEDULE_CRON = '15 2 * * *';

export async function runVisionInferenceCostRollup(): Promise<{ durationMs: number }>;
export async function registerVisionInferenceCostRollupJob(): Promise<void>;
```

**SQL — first upsert (platform aggregate):**

```sql
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
```

**SQL — second upsert (per-run aggregate):**

```sql
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
GROUP BY organisation_id, run_id, date_trunc('day', created_at AT TIME ZONE 'UTC')
ON CONFLICT (entity_type, entity_id, period_type, period_key)
DO UPDATE SET
  total_cost_cents = EXCLUDED.total_cost_cents,
  request_count    = EXCLUDED.request_count,
  updated_at       = now();
```

**Boot registration in `server/index.ts`** (append after the IEE rollup block at L816):

```typescript
// browser-vision-grounding spec §10 — daily rollup of vision_inference_calls
// into cost_aggregates. Runs at 02:15 UTC, 5 minutes after the IEE rollup,
// to spread DB load.
if (env.JOB_QUEUE_BACKEND === 'pg-boss') {
  try {
    const { registerVisionInferenceCostRollupJob } = await import('./jobs/visionInferenceCostRollupJob.js');
    await registerVisionInferenceCostRollupJob();
  } catch (err) {
    console.error('[boot] failed to register vision-inference-cost-rollup-daily job', err);
  }
}
```

**Error handling:**
- SQL errors propagate out of `withAdminConnection` → caught by pg-boss retry machinery (same posture as `ieeCostRollupDailyJob`).
- Boot-time registration failure → logged to stderr; server continues (matches existing IEE rollup pattern).

**Test considerations:**
- Static-gates posture. No new test authored. The SQL structure mirrors a tested precedent (`ieeCostRollupDailyJob.ts` has a test at `server/jobs/__tests__/ieeCostRollupDailyJob.test.ts`); the builder may optionally author a similar parity test, but it is not gate-required.

**Dependencies:** C5 (`vision_inference_calls` table exists).

**Verification commands:**

```
npm run lint
npm run typecheck
npm run build:server
```

**Acceptance criteria:**
- File mirrors `ieeCostRollupDailyJob.ts` structurally (header comment, queue constant, SCHEDULE_CRON, exported functions).
- Both upserts use `created_at AT TIME ZONE 'UTC'` before date_trunc (UTC day-boundary discipline).
- Per-run upsert uses `entity_type='run'` (not `'iee_run'` or anything else) so `runCostBreaker` picks up the rows via its existing per-run lookup.
- Boot registration appended in the documented location; no other block re-ordered.
- `vision_inference.costrollup.scheduled` log line emitted on successful registration.

---

### Chunk C12 — Documentation update (`docs/iee-development-spec.md`)

**spec_sections:** §7 (file inventory), §8.9 (skill YAML extension)

**Files to modify:**
- `docs/iee-development-spec.md` — add a subsection documenting `iee_decision_mode` skill YAML frontmatter, the three modes (dom/vision/hybrid), and a pointer to the browser-vision-grounding spec.

**Module shape:**
- *Public interface:* readers of `iee-development-spec.md` find the new subsection. Single source of truth for behavior; the new spec is referenced rather than duplicated.
- *What stays hidden:* implementation details (those live in the browser-vision-grounding spec).

**Contracts (content to add):**

Insert a new subsection inside Part 6 (Browser Execution Handler) — recommend `### 6.7 Skill YAML extension: iee_decision_mode`. Body (concise per CLAUDE.md §13 doc style):

```markdown
### 6.7 Skill YAML extension: iee_decision_mode

(Added 2026-05-18 — browser-vision-grounding build.)

Skills that target IEE browser execution may declare a decision mode in YAML frontmatter:

`iee_decision_mode: dom | vision | hybrid   # optional; default: dom`

- **dom** (default when absent): existing DOM-selector execution. No vision calls.
- **vision**: every action step calls a self-hosted UI-TARS vLLM endpoint. Screenshot is sent; the model returns a typed `VisionAction` (click / type / scroll / hotkey / wait / screenshot / done / double_click / right_click).
- **hybrid**: DOM-first; after 1 DOM selector failure + 1 retry, falls back to vision for that step. Counter resets per-step.

The parser surfaces this as `ParsedSkill.ieeDecisionMode` (`server/services/skillParserServicePure.ts`). The IEE dispatch path (`_ieeShared.ts::ieeDispatchBrowser`) reads it from the task payload and threads `decisionMode`, `visionEndpointUrl`, `visionEndpointToken`, `visionModelId` into `SandboxRunTaskInput`. Cost is logged per call to `vision_inference_calls` and rolled up daily to `cost_aggregates`.

Full spec: [browser-vision-grounding](superpowers/specs/2026-05-18-browser-vision-grounding-spec.md).

In V1 the harness `visionDecisionLoop.ts` is a loud-failure stub pending e2b SDK installation — vision-mode and hybrid-mode tasks fail loudly until the follow-up build wires the screenshot + vLLM HTTP + Playwright loop.
```

**Error handling:** N/A (docs).

**Test considerations:**
- None. Doc-only change.
- The doc-sync gate (`docs/doc-sync.md`) is informational for this build — no automated check fails if the doc is not updated, but the spec mandates the update.

**Dependencies:** C1 (the union shape is what the doc names), C10 (the parser is what surfaces the YAML key).

**Verification commands:**

```
npm run lint
```

**Acceptance criteria:**
- New subsection ≤ 30 lines (agent-facing dense style per CLAUDE.md §13).
- References the browser-vision-grounding spec by relative path.
- Names the three modes with their behaviour.
- Mentions the V1 stub posture so future maintainers understand the harness is incomplete.
- No duplication of spec §8.9 (link instead of restate).

---

## 8. Risks & mitigations

### R1 — Harvest RLS WITH CHECK failure
**Risk:** If `harvestVisionCalls` is called without `setOrgGUC` first, the INSERTs fail under FORCE RLS because the `vision_inference_calls_org_isolation` policy's `WITH CHECK` requires `current_setting('app.organisation_id', true)::uuid = organisation_id`. The orchestrator transaction does NOT set this GUC for IEE backends.
**Mitigation:** `setOrgGUC(tx, ieeRun.organisationId)` is the first statement of `harvestVisionCalls` (documented in C6 acceptance criteria). The builder MUST verify this is in place before declaring C6 complete.
**Tripwire:** If a future contributor moves the harvest call out of `ieeFinalise` and into a different transaction, the GUC contract must be preserved. The acceptance criterion is explicit.

### R2 — Network policy silently regressed by merge
**Risk:** If a future contributor "fixes" the merge to a replace ("simpler"), any broader allowlist that IEE-DEF-7 wires in later would be silently overwritten by the vision allowlist. The platform would dispatch a vision-mode task with ONLY the vLLM host reachable — browser navigation to the target site would fail with a non-obvious "DNS not in allowlist" error.
**Mitigation:** The updated TODO IEE-DEF-7 comment explicitly states the merge contract. The acceptance criterion for C7 requires the merge form. A targeted unit test on the merge logic is OPTIONAL but would harden this — recommend the builder author a tiny pure-function helper for the merge and test it.

### R3 — Token leakage via log lines
**Risk:** `visionEndpointToken` is a short-lived secret. A hand-rolled `logger.info('dispatch', input)` anywhere in `_ieeShared.ts` or `visionDecisionLoop.ts` would dump the token into stdout / structured logs.
**Mitigation:** Spec §8.3 redaction contract is repeated verbatim in the JSDoc of `visionDecisionLoop.ts` AND in the JSDoc of `SandboxRunTaskInput.visionEndpointToken` (Chunk C4). The acceptance criterion for C7 explicitly bans `visionEndpointToken` interpolation. The acceptance criterion for C8 explicitly bans the token in the `reason` string.
**Tripwire:** Future ChatGPT/PR review should grep `visionEndpointToken` and verify no `logger.*` call references it.

### R4 — `0378` migration number collision (unlikely but cheap to guard)
**Risk:** Another concurrent build (e.g. a sister branch) lands a migration `0378` first.
**Mitigation:** Verified at plan time — last existing migration is `0377` (`migrations\0377_rename_fast_path_decisions_brief_id_to_task_id.sql`). If a collision is detected at build time, the builder re-numbers to the next available integer in both `.sql` and `.down.sql` and updates `RLS_PROTECTED_TABLES` entry's `policyMigration` field accordingly. No other code reference depends on the specific migration number.

### R5 — Pricing rate drift between harness and server
**Risk:** The harness computes `costCents` and writes it to `vision_calls.json`. The server's `harvestVisionCalls` parity-checks against `computeCostCents()`. If `shared/visionInferencePricing.ts` is updated server-side without redeploying the harness template image, the two diverge.
**Mitigation:** The harness imports `computeCostCents` from `shared/visionInferencePricing.ts` (same file, same source-of-truth). Both consume the same constants. Drift requires either two simultaneous code paths to forget the update, or the template image to lag — the latter is caught by the parity warning (`vision.harvest.cost_parity_mismatch`) which logs the diff. Note: V1 is a stub so the parity check is dormant until the follow-up build wires the harness loop.

### R6 — `iee_runs.type` gate missed for dev tasks
**Risk:** If C7's harvest call is not gated on `ieeRun.type === 'browser'`, dev IEE tasks (`type === 'dev'`) would attempt to read `vision_calls.json` and find no artefact every time — wasted DB query, but functionally harmless.
**Mitigation:** Spec §8.4 makes it clear that `vision_calls.json` is browser-only. The C7 acceptance criterion explicitly requires the `if (ieeRun.type === 'browser')` gate.

### R7 — Mid-run cost-breaker gap (deferred, documented)
**Risk:** V1's vision-cost enforcement applies from the FOLLOWING run onward (per spec §3 framing assumption). A runaway vision task in V1 could exceed the per-run ceiling without the breaker tripping mid-run.
**Mitigation:** This is explicitly deferred per spec §13 ("Mid-run vision cost-breaker enforcement"). V1 ships a stub harness, so no vision calls actually happen in V1 — the gap is theoretical until the follow-up wiring lands. The plan introduces no new code that depends on mid-run enforcement.

### R8 — `decisionMode` not threaded through `IeeTask` payload upstream
**Risk:** C7's dispatch reads `opts.ieeTask?.decisionMode`. C13 (the new chunk added in chatgpt-plan-review R1) performs the upstream wiring audit and ensures `parsedSkill.ieeDecisionMode` is copied into `ieeTask.decisionMode` at all IeeTask construction sites before C7 runs. This risk is now mitigated by C13 being a first-class build chunk.
**Mitigation:** **This is a real plan gap that the builder MUST handle.** Adding it to Chunk C7's "Files to modify" would explode the chunk past its single-responsibility scope. **Resolution:** The builder identifies the upstream `IeeTask` construction site (likely in `server/services/ieeExecutionService.ts` or `server/services/skillExecutor/handlers/`) and threads `decisionMode` through. This is an in-scope follow-up that this plan documents but does not pre-resolve, because the construction site varies by handler and a static plan-time resolution would be brittle.
**Plan instruction to builder:** at the end of Chunk C7, the builder runs a targeted grep for IEE task construction (`enqueueIEETask`, `ieeTask:`, `IeeTask`) and traces the `decisionMode` thread from `ParsedSkill.ieeDecisionMode` (C10) down to `opts.ieeTask.decisionMode` (C7). Any missing link is a one-line field addition; the builder appends a brief "decisionMode thread audit" subsection to `tasks/builds/browser-vision-grounding/progress.md` listing the call sites touched. If the audit reveals more than two missing links, **STOP and escalate** — that signals an IEE-DEF design gap that needs a separate spec amendment.

---

## 9. Self-consistency pass

- **Goals vs Implementation:** Goal 4 (harness loop stub) is honoured by Chunk C8. Goals 5 (server service), 6 (cost ledger + rollup), 7 (no DOM regression) are honoured by Chunks C6, C5+C9, and the byte-identical default behaviour for `decisionMode === 'dom'` respectively. Success criteria split (V1 vs follow-up) per spec §1 Goal 8 is preserved — V1 tests cover the parser and pricing, follow-up tests cover the loop.
- **Chunk verdicts:** All 13 chunks are `BUILD` (spec §6 has 12; C13 was added in chatgpt-plan-review R1 to promote R8 from a C7 audit note to a first-class chunk). No chunk is deferred. All deferred work (full harness wiring, 72B model, alerting, mid-run breaker) lives in spec §13.
- **Source-of-truth:** `VISION_INFERENCE_ENDPOINT_URL` is the single config source (not DB). `vision_calls.json` is the single per-call source; `vision_inference_calls` is derived via harvest. `shared/visionInferencePricing.ts::VISION_PRICING_RATES` is the single rate source for both harness and server (R5 mitigation).
- **Non-functional goals vs execution model:** p95 ≤ 6 s target (spec §1 Goal 8 follow-up) is preserved by the inline-loop design — `visionDecisionLoop` runs in-process inside the harness; no round-trip per step. V1's stub does not violate any non-functional commitment because no vision calls happen.
- **Load-bearing claims backed by mechanism:**
  - Idempotency: `vision_inference_calls_iee_run_step_call_uniq` UNIQUE INDEX (C5) + `ON CONFLICT DO NOTHING` (C6) + idempotent pg-boss schedule by queue name (C9).
  - Atomicity: harvest shares the orchestrator `tx` (C7).
  - RLS: FORCE RLS + canonical two-arg policy (C5) + `setOrgGUC` (C6).
  - Token redaction: explicit JSDoc contracts (C4, C8) + acceptance criteria (C7, C8).
- **Numeric-count reconciliation:** 11 new files (matches spec §14) + 9 modified files (matches spec §14 — `server/jobs/index.ts` in spec §7 is `server/index.ts` in this plan; flagged as adjustment, total still 9) = 20 file entries.
- **Plan vs spec divergences (explicit):**
  - `server/index.ts` (not `server/jobs/index.ts`) is the boot registration site. Verified by reading the existing `registerIeeCostRollupDailyJob` registration at L807-816.
  - Harvest uses the orchestrator `tx` (not `withAdminConnection`). Spec §9 step 3 refers to ROLLUP writes; spec §12.1 requires harvest atomicity. The two are consistent; the plan resolves the apparent split by reading both clauses together.
  - `harvestVisionCalls` calls `setOrgGUC(tx, ieeRun.organisationId)` as its first statement. The spec's RLS posture (§9) does not name this mechanism; the plan adds it because the orchestrator transaction does NOT set the GUC for IEE backends (architect-verified by reading `agentRunFinalizationService.ts:195-197`). Without this, harvest INSERTs would fail under FORCE RLS (the `WITH CHECK` clause causes an error, not a silent no-op). Documented in §2.1 Architecture decision and R1.
  - Risk R8 (`decisionMode` thread from `ParsedSkill` to `IeeTask`) is fully resolved by C13, a first-class chunk added in chatgpt-plan-review R1. C7 now consumes `opts.ieeTask?.decisionMode` with proper typing — no `as` cast.

---

## 10. Executor notes

**Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

Allowed local commands per chunk: `npm run lint`, `npm run typecheck` (or `npx tsc --noEmit`), `npm run build:server` / `npm run build:client` when relevant, and targeted `npx vitest run <path-to-test>` for tests authored within this plan (C2 parser tests, C11 pricing tests, plus any optional tests the builder chooses to author in C6 / C9).

Recommended chunk order (forward-only, matches §6 graph):

1. C1 — `shared/types/visionActions.ts`
2. C3 — `shared/iee/failureReason.ts`
3. C11 — `shared/visionInferencePricing.ts` + Vitest
4. C5 — schema + migration + RLS manifest
5. C4 — `shared/types/sandbox.ts` extension
6. C10 — `skillParserServicePure.ts`
7. C2 — `visionActionParserPure.ts` + Vitest
8. C6 — `visionGroundingService.ts`
9. C8 — harness stub
10. C13 — `decisionMode` thread audit + IeeTask wiring (added chatgpt-plan-review R1; ensures C7 reads typed field, no cast)
11. C7 — `_ieeShared.ts` (dispatch + finalise)
12. C9 — rollup job + boot registration
13. C12 — docs

C13 (the preceding chunk) performs the R8 audit and proves the `decisionMode` thread is complete before C7 runs. C7 can therefore use the typed `ieeTask.decisionMode` field directly rather than a type-assertion cast. If C13 found and fixed any IeeTask construction sites, C7 should verify the field is present at its call site.

Capability registration: this build adds a new product capability (Browser vision grounding) to the Agent Runtime cluster. The Capability Registration verdict is emitted by `finalisation-coordinator` Step 6 — out of scope for this plan.

---

## 11. Files this plan creates / modifies — final inventory

**Create (11):**
1. `shared/types/visionActions.ts`
2. `server/services/visionActionParserPure.ts`
3. `server/services/__tests__/visionActionParserPure.test.ts`
4. `server/services/visionGroundingService.ts`
5. `infra/sandbox-templates/iee-browser/harness/visionDecisionLoop.ts`
6. `server/db/schema/visionInferenceCalls.ts`
7. `migrations/0378_vision_inference_calls.sql`
8. `migrations/0378_vision_inference_calls.down.sql`
9. `server/jobs/visionInferenceCostRollupJob.ts`
10. `shared/visionInferencePricing.ts`
11. `shared/__tests__/visionInferencePricing.test.ts`

**Modify (9):**
1. `shared/types/sandbox.ts`
2. `server/services/skillParserServicePure.ts`
3. `shared/iee/failureReason.ts`
4. `infra/sandbox-templates/iee-browser/harness/index.ts`
5. `server/services/executionBackends/_ieeShared.ts`
6. `server/db/schema/index.ts`
7. `server/index.ts` (spec §7 says `server/jobs/index.ts`; the actual registration site is `server/index.ts` — see plan §5 file inventory note)
8. `server/config/rlsProtectedTables.ts`
9. `docs/iee-development-spec.md`

End of plan.

# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md`
**Spec commit at check:** `c3baaa6accb8402cd905a41f2f5bcb4ed1efcbaa`
**Branch:** `main`
**Base:** `6cd4da6091bb4a300bbc63b96e50d66948b802f7` (merge-base with origin/main)
**HEAD at check:** `6ddbe91b897cf8f00ce8090e0c85fe6eef1e6b78`
**Scope:** All 13 chunks (C1–C13), caller-confirmed full-spec coverage
**Changed-code set:** 20 files (11 new + 9 modified, per spec §7)
**Run at:** 2026-05-18T13:46:08Z

---

## Summary

- Requirements extracted:     64
- PASS:                       64
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 0
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** CONFORMANT — no gaps. Proceed to `pr-reviewer`.

Three documented architect deviations from the literal spec text were reviewed
and confirmed pre-approved at plan time (see "Documented deviations" below);
none constitute conformance gaps.

---

## Contents

1. Requirements extracted (per chunk)
2. Documented architect deviations from literal spec text
3. Mechanical fixes applied
4. Directional / ambiguous gaps
5. Files modified by this run
6. Next step

---

## 1. Requirements extracted (full checklist)

### C1 — `shared/types/visionActions.ts` (spec §8.1, §8.9)

| REQ | Category | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 1 | export | `VisionDecisionMode = 'dom' \| 'vision' \| 'hybrid'` | PASS | `shared/types/visionActions.ts:14` |
| 2 | export | `VisionAction` discriminated union — 9 variants (click, double_click, right_click, type, scroll, hotkey, wait, screenshot, done) | PASS | `shared/types/visionActions.ts:27-36` |
| 3 | invariant | Field constraints (x/y non-negative int, dx/dy signed int, ms positive int) documented as JSDoc | PASS | `shared/types/visionActions.ts:20-25` |

### C2 — Parser + tests (spec §8.1, §15)

| REQ | Category | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 4 | file | `server/services/visionActionParserPure.ts` exists | PASS | file present |
| 5 | export | `parseVisionAction(line): VisionAction` throws on invalid | PASS | `visionActionParserPure.ts:195` |
| 6 | export | `tryParseVisionAction(line): VisionAction \| null` non-throwing variant | PASS | `visionActionParserPure.ts:203` |
| 7 | behavior | Parses each of the 9 UI-TARS verbs to matching discriminant | PASS | `visionActionParserPure.ts:120-181` |
| 8 | behavior | Rejects unknown verbs, missing args, negative x/y, non-integer coords, malformed combo | PASS | switch arms 121-181 throw on each rejection class |
| 9 | behavior | Whitespace normalisation (leading/trailing strip, internal runs collapsed) | PASS | `visionActionParserPure.ts:16-18` |
| 10 | test | `__tests__/visionActionParserPure.test.ts` covers 9 action types + invalid-input cases | PASS | 34 `it()` blocks; happy + rejection + tryParse parity |

### C3 — FailureReason additions (spec §8.8)

| REQ | Category | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 11 | enum | `vision_inference_not_configured` added to `FailureReason` z.enum | PASS | `shared/iee/failureReason.ts:98` |
| 12 | enum | `vision_inference_unavailable` added to `FailureReason` z.enum | PASS | `shared/iee/failureReason.ts:99` |

### C4 — `SandboxRunTaskInput` extension (spec §8.2)

| REQ | Category | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 13 | field | `decisionMode?: VisionDecisionMode \| null` on `SandboxRunTaskInput` | PASS | `shared/types/sandbox.ts:271` |
| 14 | field | `visionEndpointUrl?: string \| null` | PASS | `shared/types/sandbox.ts:273` |
| 15 | field | `visionEndpointToken?: string \| null` (with redaction-obligation JSDoc) | PASS | `shared/types/sandbox.ts:279` |
| 16 | field | `visionModelId?: string \| null` | PASS | `shared/types/sandbox.ts:281` |

### C5 — Schema + migration + RLS (spec §8.5, §9, §12.6)

| REQ | Category | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 17 | file | `server/db/schema/visionInferenceCalls.ts` Drizzle table definition | PASS | file present |
| 18 | schema | 14 columns matching spec §8.5 row shape | PASS | `visionInferenceCalls.ts:22-35` |
| 19 | schema | `image_size_bytes` typed as bigint NOT NULL | PASS | `visionInferenceCalls.ts:30` (bigint is a superset of spec's integer; accommodates larger screenshots) |
| 20 | schema | UNIQUE (iee_run_id, step_index, call_index) idempotent harvest key | PASS | `visionInferenceCalls.ts:38-39` |
| 21 | file | `migrations/0378_vision_inference_calls.sql` SQL migration | PASS | file present |
| 22 | sql | `ALTER TABLE ... FORCE ROW LEVEL SECURITY` | PASS | `0378_vision_inference_calls.sql:38` |
| 23 | sql | `CREATE POLICY ... USING (organisation_id = current_setting('app.organisation_id', true)::uuid)` — two-argument form | PASS | `0378_vision_inference_calls.sql:42-43` (WITH CHECK additive) |
| 24 | file | `migrations/0378_vision_inference_calls.down.sql` idempotent DROP | PASS | `DROP TABLE IF EXISTS vision_inference_calls` |
| 25 | export | `visionInferenceCalls` re-exported from `server/db/schema/index.ts` | PASS | `schema/index.ts:109` |
| 26 | config | `vision_inference_calls` entry in `RLS_PROTECTED_TABLES` with `policyMigration: '0378_vision_inference_calls.sql'` | PASS | `rlsProtectedTables.ts:1450-1455` |

### C6 — `visionGroundingService.ts` (spec §6, §8.6, §8.7, §10, §12.1)

| REQ | Category | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 27 | file | `server/services/visionGroundingService.ts` exists | PASS | file present |
| 28 | export | `resolveEndpointConfig(): { endpointUrl, apiKey, modelId }` | PASS | `visionGroundingService.ts:67` |
| 29 | behavior | Throws `vision_inference_not_configured` on missing URL or non-HTTPS scheme | PASS | `visionGroundingService.ts:69-78` |
| 30 | behavior | Reads `VISION_INFERENCE_ENDPOINT_URL`, `VISION_INFERENCE_API_KEY` (optional), `VISION_INFERENCE_MODEL_ID` (default `ui-tars-7b`) | PASS | `visionGroundingService.ts:68, 81-82` |
| 31 | export | `parseVisionEndpointHostPort(url): { host, port }` for §8.7 allowlist construction | PASS | `visionGroundingService.ts:96-103` |
| 32 | export | `harvestVisionCalls(tx, ieeRun)` — async, runs inside ieeFinalise transaction | PASS | `visionGroundingService.ts:124-218` |
| 33 | behavior | `setOrgGUC(tx, ieeRun.organisationId)` is FIRST statement of harvest (RLS WITH CHECK requirement, plan §2.1) | PASS | `visionGroundingService.ts:128` |
| 34 | behavior | Idempotent INSERT via `.onConflictDoNothing()` on unique key | PASS | `visionGroundingService.ts:209` |
| 35 | behavior | Cost parity check via `computeCostCents` — warn-log on drift | PASS | `visionGroundingService.ts:168-191` |

### C7 — `_ieeShared.ts` dispatch threading + harvest hook (spec §8.7, §12.1)

| REQ | Category | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 36 | behavior | Reads `opts.ieeTask?.decisionMode`; resolves config when non-DOM | PASS | `_ieeShared.ts:258-278` |
| 37 | behavior | Threads `decisionMode`, `visionEndpointUrl`, `visionEndpointToken`, `visionModelId` into `sandboxRunTask` | PASS | `_ieeShared.ts:335-338` |
| 38 | behavior | Vision allowlist entry MERGED (not replaced) into existing network policy via `buildVisionAwarePolicy` | PASS | `_ieeShared.ts:168-189, 294` |
| 39 | behavior | `harvestVisionCalls(tx, ieeRun)` called inside `ieeFinalise` before parent `agent_runs` terminal UPDATE; gated to `ieeRun.type === 'browser'` | PASS | `_ieeShared.ts:665-676` |
| 40 | test | `buildVisionAwarePolicy` pure-helper tested for dom passthrough + allowlist merge + unknown-mode fail-closed | PASS | `__tests__/buildVisionAwarePolicyPure.test.ts` (9 it blocks) |

### C8 — Harness stub (spec §3, §8.3, §13)

| REQ | Category | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 41 | field | `HarnessInput` in `harness/index.ts` gains the 4 vision fields | PASS | `harness/index.ts:55-58` |
| 42 | behavior | Harness routes to `visionDecisionLoop()` when `decisionMode === 'vision' \| 'hybrid'` | PASS | `harness/index.ts:95-100` |
| 43 | file | `visionDecisionLoop.ts` stub exists; fails loudly; never writes `status: 'completed'` | PASS | `visionDecisionLoop.ts:44-56` returns `status: 'failed'` unconditionally |
| 44 | behavior | Token redaction contract honoured in stub (`visionEndpointToken` not in reason string or logs) | PASS | `visionDecisionLoop.ts:49-52` (mode echoed; token deliberately excluded) |
| 45 | behavior | `computeCostCents` symbol referenced from `shared/visionInferencePricing.ts` for follow-up wiring | PASS | `visionDecisionLoop.ts:15, 34` (type-only import keeps signature visible) |

### C9 — Rollup job + boot registration (spec §10)

| REQ | Category | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 46 | file | `server/jobs/visionInferenceCostRollupJob.ts` exists | PASS | file present |
| 47 | export | `runVisionInferenceCostRollup()` core rollup logic | PASS | `visionInferenceCostRollupJob.ts:39` |
| 48 | export | `registerVisionInferenceCostRollupJob()` pg-boss work + schedule | PASS | `visionInferenceCostRollupJob.ts:130` |
| 49 | behavior | Two upserts: `source_type/vision_inference` platform aggregate + `run/<run_id>` per-run aggregate | PASS | `visionInferenceCostRollupJob.ts:57-115` |
| 50 | behavior | `withAdminConnection` + `SET LOCAL ROLE admin_role` for cross-tenant aggregation | PASS | `visionInferenceCostRollupJob.ts:42-48` |
| 51 | boot | `server/index.ts` registers the job on boot, gated by `JOB_QUEUE_BACKEND === 'pg-boss'` | PASS | `server/index.ts:820-826` |

### C10 — Skill parser surface (spec §8.9)

| REQ | Category | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 52 | field | `ParsedSkill.ieeDecisionMode?: 'dom' \| 'vision' \| 'hybrid'` exposed | PASS | `skillParserServicePure.ts:28` |
| 53 | behavior | Markdown frontmatter parser surfaces `iee_decision_mode` (lenient — unknown values → `undefined`) | PASS | `skillParserServicePure.ts:150-153, 212` |
| 54 | behavior | JSON parser also surfaces field with same union-narrowing | PASS | `skillParserServicePure.ts:237-240, 249` |

### C11 — Pricing module + tests (spec §8.4)

| REQ | Category | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 55 | file | `shared/visionInferencePricing.ts` exists | PASS | file present |
| 56 | export | `VISION_PRICING_RATES` table keyed by modelId (ui-tars-7b placeholder rates) | PASS | `visionInferencePricing.ts:10-18` |
| 57 | export | `computeCostCents({ modelId, imageSizeBytes, latencyMs, outputTokens })` — `Math.round` rounding | PASS | `visionInferencePricing.ts:38-45` |
| 58 | behavior | Throws `Error('Unknown vision model: <modelId>')` on unknown id (never returns 0 silently) | PASS | `visionInferencePricing.ts:40-42` |
| 59 | behavior | Sub-cent results round to 0 (floor of 0 per spec §8.4) | PASS | Math.round on non-negative raw sum |
| 60 | test | `shared/__tests__/visionInferencePricing.test.ts` covers correct lookup, Math.round boundary, throw-on-unknown, sub-cent 0-floor | PASS | 6 `it()` blocks covering all four §8.4 commitments |

### C12 — Docs (spec §7 modified files)

| REQ | Category | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 61 | docs | `docs/iee-development-spec.md` documents `iee_decision_mode` skill YAML field + three-mode behaviour | PASS | `iee-development-spec.md` §6.7 (lines 829-851) + §13.9 (harvest ordering) |
| 62 | docs | Links back to canonical spec | PASS | `iee-development-spec.md:849, 851` |

### C13 — Dispatch envelope typing (architect-added per progress.md)

| REQ | Category | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| 63 | field | `BrowserTaskPayload.decisionMode: z.enum(['dom','vision','hybrid']).optional()` in `shared/iee/jobPayload.ts` | PASS | `shared/iee/jobPayload.ts:89` |
| 64 | field | `AgentRunRequest.ieeTask.decisionMode?: 'dom' \| 'vision' \| 'hybrid'` in `agentExecutionService/types.ts` | PASS | `agentExecutionService/types.ts:84` |

---

## 2. Documented architect deviations from literal spec text — reviewed and accepted

These three items diverge from the literal spec wording but are pre-approved in
`tasks/builds/browser-vision-grounding/plan.md` §2.1 / §2.3 and the per-chunk
notes in `progress.md`. They do not constitute conformance gaps.

| Item | Spec literal | Implementation | Approval site | Rationale |
|---|---|---|---|---|
| harvestVisionCalls placement | Spec §12.1 "immediately before the `UPDATE iee_runs SET status = $terminal`" | Called inside `ieeFinalise()`'s `!parentAlreadyTerminal` branch, gated on `ieeRun.type === 'browser'`, before the parent `agent_runs` terminal UPDATE | `plan.md` §2.1 | `iee_runs.status` is already terminal when ieeFinalise runs (worker writes it earlier). Sharing the orchestrator tx with the `agent_runs` UPDATE preserves the §12.1 atomicity intent: harvest failure → tx rollback → retry replays. Functionally equivalent. |
| Artefact lookup uses `ieeArtifacts` table | Spec §10 "Reads `/workspace/artefacts/vision_calls.json`, upserts via `withAdminConnection`" | Harvest looks up the artefact via `ieeArtifacts` table (path LIKE '%vision_calls.json') and uses the orchestrator's tx (NOT `withAdminConnection`) | `plan.md` §2.1 | V1 codebase tracks artefacts in `ieeArtifacts` rather than direct sandbox-filesystem read. `withAdminConnection` deliberately rejected for atomicity with parent UPDATE. V1 stub harness never writes the artefact so path is exercised but returns `{ harvested: 0 }`. |
| `VISION_INFERENCE_*` env vars use `process.env` directly | Spec §8.6 names env vars; spec does not literally mandate Zod schema in `env.ts` | `resolveEndpointConfig()` reads `process.env.VISION_INFERENCE_*` directly | `progress.md` C6 builder notes | No spec requirement for typed env schema; matches established pattern for vendor-specific endpoint env vars. Routed to V1 non-blocker todo. |

---

## 3. Mechanical fixes applied

None — implementation matches spec end-to-end.

---

## 4. Directional / ambiguous gaps (routed to tasks/todo.md)

None — all spec subcomponents present and correctly shaped.

---

## 5. Files modified by this run

None.

---

## 6. Next step

CONFORMANT — proceed to `pr-reviewer` on the branch's full changed-code set
(20 files per spec §7). No re-run needed; this conformance pass made no edits.

Per the GRADED review posture for a Major task class:
1. `pr-reviewer` — mandatory.
2. `adversarial-reviewer` — applies (new tenant table + RLS, cross-tenant rollup,
   new network egress allowlist, server-side env-resolved bearer token).
3. `reality-checker` — mandatory; caller must supply success-criteria evidence.
4. `dual-reviewer` — mandatory (skippable with `REVIEW_GAP`).

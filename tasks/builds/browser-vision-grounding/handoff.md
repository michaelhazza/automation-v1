# Handoff — browser-vision-grounding

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md
**Branch:** main
**Build slug:** browser-vision-grounding
**UI-touching:** no
**Mockup paths:** n/a
**Spec-reviewer iterations used:** 2 / 5
**ChatGPT spec review log:** tasks/review-logs/chatgpt-spec-review-browser-vision-grounding-2026-05-18T11-11-14Z.md
**Open questions for Phase 2:** none — all resolved in grill-me (11 rounds, 2026-05-18)

**Decisions made in Phase 1:**

- Inference hosting: managed inference vendor (RunPod / Lambda Labs / Replicate) for V1. Architect picks specific vendor and confirms GPU class (A10G, 24 GB VRAM targeted).
- Decision mode surface: skill YAML frontmatter (`iee_decision_mode: dom | vision | hybrid`) → threaded into browser task envelope → `SandboxRunTaskInput.decisionMode` (new optional field, same pattern as `humanize`).
- Hybrid fallback: 1 DOM selector failure + 1 retry per step, then vision fallback. Counter resets per-step. Hard-coded in V1.
- Failure modes: `vision_inference_unavailable` and `vision_inference_not_configured` added to `FailureReason`. Both `vision` and `hybrid` modes fail the entire run on `vision_inference_unavailable` in V1 (multi-step recovery deferred).
- Loop architecture: vision decision loop runs inside the harness (`visionDecisionLoop.ts`); sandbox network allowlist populated for vision-mode tasks only with the inference endpoint host:port (merged, not replaced).
- Harness wiring: stub in V1 (loud-failure, never completes). Full wiring (screenshot → vLLM → parse → execute) is a targeted follow-up chunk once the e2b SDK is installed.
- Server-side split: `visionGroundingService.ts` owns config resolution (env vars), envelope threading, and `vision_calls.json` harvest into `vision_inference_calls` DB rows.
- Cost ledger: new `vision_inference_calls` table (migration `<next>` — number verified at plan time). pg-boss rollup to `cost_aggregates` with `source_type: vision_inference`. `runCostBreaker` enforces against post-run aggregates (mid-run enforcement deferred).
- Pricing module: `shared/visionInferencePricing.ts` — `computeCostCents()`, placeholder rate for `ui-tars-7b`, unknown-modelId throw, `Math.round` rounding, sub-cent floor 0. Architect pins exact rates at vendor selection.
- Action parser: native UI-TARS text format, `visionActionParserPure.ts`. Architect pins exact UI-TARS commit hash at plan time.
- Token redaction: `visionEndpointToken` never persisted; must be scrubbed from all artefacts, logs, failure payloads, and sandbox traces.
- RLS: `vision_inference_calls` uses `current_setting('app.organisation_id', true)::uuid` (two-argument safe form).
- Harvest ordering: `harvestVisionCalls()` called in `ieeFinalise()` BEFORE the terminal `iee_runs.status` UPDATE. Architect must add transaction boundary or document residual risk.

**Chunk plan (12 chunks, single phase/PR):**
C1 `shared/types/visionActions.ts` → C2 parser+tests → C3 FailureReason → C4 `SandboxRunTaskInput` ext → C5 schema+migration → C11 pricing → C6 `visionGroundingService` → C7 `_ieeShared` → C8 harness stub → C9 rollup job → C10 `skillParserServicePure` → C12 docs

**Key architect decisions required at plan authoring:**
1. Specific managed inference vendor + GPU class
2. Exact UI-TARS commit hash (grammar version for parser)
3. `VISION_PRICING_RATES` constants per vendor
4. Migration number (verify head — last known: 0375 from `closed-loop-skill-improvement` PR #353)
5. Exact `ieeFinalise()` transaction boundary for harvest ordering (§12.1 / §12.8 F8)

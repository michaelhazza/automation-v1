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

---

## Phase 2 (BUILD) — complete

**Plan path:** tasks/builds/browser-vision-grounding/plan.md
**Chunks built:** 13 (C1–C13). C13 added by parallel session for IeeTask wiring after ChatGPT plan-review Round 2.
**Branch HEAD at handoff:** d80e10e210c82aab40d98690841152d9b2e6bb5e
**G1 attempts (per chunk):** all 1 attempt except C6 (2/lint) and C8 (2/lint).
**G2 attempts:** 1 (PASS — 0 errors, 879 pre-existing baseline warnings, typecheck clean)

**Branch-level review pass:**
- **spec-conformance:** CONFORMANT (64/64 PASS) — `tasks/review-logs/spec-conformance-log-browser-vision-grounding-2026-05-18T13-46-08Z.md`
- **adversarial-reviewer:** HOLES_FOUND (1 confirmed + 2 likely) — ADV-1 (rollup cross-tenant collision) FIXED in commit `887219dc`; ADV-2 (subaccountId cross-org validation) + ADV-3 (token leakage path) + 2 observations routed to `tasks/todo.md` as V2-deferred (V1 harness is stub). Log: `tasks/review-logs/adversarial-review-log-browser-vision-grounding-2026-05-19T00-00-00Z.md`
- **pr-reviewer:** APPROVED after 3 rounds. R1 found 1 BLOCKER (e2bSandbox.ts dropping vision envelope fields) + 8 should-fix + 3 consider; R2 APPROVED after blocker + 6 should-fix closed in commit `fea13172`; R3 APPROVED after dual-reviewer changes (2 doc-sync items closed in `d80e10e2`). Log: `tasks/review-logs/pr-review-log-browser-vision-grounding-2026-05-19T00-00-00Z.md`
- **reality-checker:** READY (16/16 verified) after persisting evidence logs.
- **Fix-loop iterations:** 0 (no pr-reviewer fix-loop required — R1 blocker was fixed directly without re-loop)
- **dual-reviewer:** APPROVED — 2 fixes auto-applied (parser internal-whitespace preservation; runtime `actionType` narrowing via `VISION_ACTION_TYPES` ReadonlySet); 1 finding routed to V2 backlog (BVG-DR-1: per-run rollup `period_type='daily'` vs `runCostBreaker` query `period_type='run'` — V1 impact zero, naive fix collides with LLM additive pattern); 2 findings rejected with rationale (REPLACEMENT-race precedent, sentinel-vs-drop stylistic preference). Commits `5b656629` + `5d03199c`.
- **REVIEW_GAP entries:** none — all required reviewers ran.

**Doc-sync gate:** 16 verdicts recorded (see progress.md). Updated: `architecture.md` (cost-rollup section, vision-grounding parallel paragraph), `KNOWLEDGE.md` (2 entries). Capability registration deferred to Phase 3 (finalisation step 6) per process.

**Open issues for finalisation (Phase 3 / V2 backlog):**
- BVG-PR-S1: skill-YAML → ieeTask producer wiring (V2 — no V1 producer exists; one-off route-level callers can set decisionMode explicitly)
- BVG-PR-C1, BVG-PR-C2: HarnessInput consolidation and distinct error-class taxonomy in harvestVisionCalls (V2)
- BVG-ADV-2, BVG-ADV-3: subaccountId cross-org validation in harvest path + automated token-redaction enforcement (V2; V1 harness is stub)
- BVG-ADV-OBS-1, OBS-2: mid-transaction setOrgGUC pattern documentation + placeholder pricing gate (V2)
- BVG-DR-1: per-run rollup `period_type` mismatch (V2; V1 impact zero — harness writes no real records)
- Capability registration verdict for `docs/capabilities.md` per spec §6.2.1 — finalisation-coordinator step 6 writes the asset-register row

**Key architect deviations from spec literal (architect-approved at plan time):**
- harvestVisionCalls placement: first statement of `ieeFinalise()` (not "before iee_runs status update" — status is already terminal by then; invariant preserved by tx co-location with parent agent_runs update)
- Artefact lookup uses `ieeArtifacts` table (not sandboxArtefacts + S3) — matches actual codebase
- `VISION_INFERENCE_*` env vars use `process.env` directly (not Zod-typed env.ts schema) — non-blocker

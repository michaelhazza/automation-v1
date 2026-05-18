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
**Chunks built:** 13 (12 from spec §6 + C13 added during chatgpt-plan-review)
**Branch HEAD at handoff:** 64c1ffdc (post-doc-sync commit will advance HEAD)
**G1 attempts (per chunk):** C1:1, C3:1, C11:1, C5:1, C4:1, C10:1, C2:1, C6:2/lint, C8:2/lint, C13:1, C7:2/tc, C9:1, C12:1
**G2 attempts:** 1 (clean — 0 errors / 879 pre-existing warnings; typecheck clean)
**spec-conformance verdict:** CONFORMANT (tasks/review-logs/spec-conformance-log-browser-vision-grounding-2026-05-18T13-46-23Z.md) — 2 directional gaps BVG-SC-D1/D2 routed to tasks/todo.md as V1 follow-up
**adversarial-reviewer verdict:** HOLES_FOUND (tasks/review-logs/adversarial-review-log-browser-vision-grounding-2026-05-18T14-07-19Z.md) — F1 (medium, confirmed) FIXED in commit a9ed02e9 (PLATFORM_SENTINEL pattern for platform-grain cost aggregate); F2/F3/W3/W4 routed to tasks/todo.md as V1-unreachable backlog
**pr-reviewer verdict:** APPROVED (R3 final after fix-loops) — R1: CHANGES_REQUESTED 1 blocker + 3 should-fix; R2: APPROVED after fix commit d9aebb4b; R3: APPROVED after dual-reviewer fixes. Logs: tasks/review-logs/pr-review-log-browser-vision-grounding-r2-2026-05-19T00-19-00Z.md, tasks/review-logs/pr-review-log-browser-vision-grounding-r3-2026-05-19T00-55-00Z.md
**reality-checker verdict:** READY (R2 — tasks/review-logs/reality-check-log-browser-vision-grounding-r2-2026-05-19T00-25-00Z.md) — all 9 V1 success criteria verified; R1 NEEDS_WORK on G2 evidence resolved by appending tasks/builds/browser-vision-grounding/g2-log.txt
**Fix-loop iterations:** 3 (pr-reviewer R1→R2 fix; reality-checker R1→R2 evidence supply; dual-reviewer 2 substantive fixes → pr-reviewer R3 re-review)
**dual-reviewer verdict:** APPROVED (2 iterations; tasks/review-logs/dual-review-log-browser-vision-grounding-2026-05-19T00-50-00Z.md) — Codex caught 2 real issues both ACCEPTED: (1) CRITICAL envelope serialization gap in `e2bSandbox.ts:373-394` — the 4 vision fields added to `SandboxRunTaskInput` weren't propagated to `harnessInput` JSON, making the entire vision dispatch path dead-code at the boundary; (2) parser whitespace bug — `\s+` collapse inside quoted args. Both fixed in commits 71a12df6, 64c1ffdc.
**REVIEW_GAP entries:** none (all required reviewers ran; Codex was available)
**Doc-sync gate:**
- architecture.md updated: yes (Key files per domain — new "vision-based browser grounding" row; IEE-worker-retirement table — sibling rollup line)
- capabilities.md updated: yes: create new capability record (Sandboxed Runtime → Vision-based browser grounding bullet, Inception lifecycle preview language)
- integration-reference.md updated: n/a — no integration scope (vLLM is internal infra, not an external integration)
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: n/a — no convention or build-discipline change
- CONTRIBUTING.md updated: n/a — no lint-suppression policy change (the eslint-disable in visionDecisionLoop.ts was REMOVED in this build)
- frontend-design-principles.md updated: n/a — no UI change (spec §2 non-goal: "no user-facing UI surface in V1")
- KNOWLEDGE.md updated: yes (4 entries — constant-`entity_id` cross-tenant clobber pattern; defence-in-depth org filter even with GUC; boundary-layer envelope serialisation gap reality-checker misses; quote-aware `\s+` collapse in text parsers)
- spec-context.md updated: n/a — feature pipeline, not spec review
- docs/decisions/ updated: n/a — durable choices already captured in spec.md; no new policy decision warranting standalone ADR
- docs/context-packs/ updated: n/a — no anchor referenced by context packs changed
- references/test-gate-policy.md updated: n/a — no test-gate posture change
- references/spec-review-directional-signals.md updated: n/a — no new directional signal
- docs/incident-response.md updated: n/a — no incident-response change
- docs/testing-transition-plan.md updated: n/a — no testing-transition change
- .claude/FRAMEWORK_VERSION + CHANGELOG.md updated: n/a — no framework-level change
- scripts/verify-* updated: n/a — no gate change
**Open issues for finalisation:**
- BVG-SC-D1: ParsedSkill.ieeDecisionMode → IeeTask.decisionMode upstream wiring not in place — pair with follow-up full-harness-wiring build (§13). Spec §1 V1 success criteria still hold because the harness is a stub.
- BVG-SC-D2: vision_inference_calls.image_size_bytes is bigint not integer per spec §8.5 — functionally compatible; fold into follow-up build migration.
- BVG-ADV-F2: subaccountId cross-tenant validation at harvest (V1-unreachable; address with full-harness-wiring).
- BVG-ADV-F3: VisionCallRecord[] parsed without Zod (V1-unreachable; address with full-harness-wiring).
- BVG-ADV-W3: confirm sandboxExecutionService does not log full options struct (token redaction sanity check before follow-up wiring).
- BVG-ADV-W4: per-tenant vision-call frequency cap (add before follow-up wiring).
- Capability registration: Phase 3 finalisation Step 6 to formalise the new "Vision-based browser grounding (preview)" capability record per docs/capabilities.md §6.2.1.

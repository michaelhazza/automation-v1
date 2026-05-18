# Progress — browser-vision-grounding

## Phase 1 status

| Field | Value |
|---|---|
| Phase | SPEC (Phase 1) |
| Slug | browser-vision-grounding |
| Branch | main |
| Started | 2026-05-18 |
| Status | IN PROGRESS |

---

## Session log

### 2026-05-18 — spec-coordinator Phase 1

- Context loaded (CLAUDE.md, architecture.md, spec-context.md, spec-authoring-checklist.md)
- PLANNING lock acquired in tasks/current-focus.md
- S0 branch sync: 0 commits behind main — green, no merge
- Brief classified: **Major** (new ML inference subsystem, cross-cutting decision layer, infra deployment, new cost source, new workflow mode surface)
- UI-touch detection: **false** — no new UI surfaces; mockup loop skipped
- Provisional slug ratified: `browser-vision-grounding` (matches existing directory)
- `intent.md` authored
- Step 3a duplication check: `clear` / `clear` / `proceed` for Agent Runtime and Billing clusters
- Step 3b grill-me: 11 questions, all resolved. Key decisions locked:
  1. Inference hosting: managed vendor (V1)
  2. Mode surface: skill YAML `iee_decision_mode` → task envelope → `SandboxRunTaskInput.decisionMode`
  3. Hybrid fallback: 1 retry per step then vision
  4. Failure modes: `vision_inference_unavailable` / `vision_inference_not_configured` FailureReasons
  5. Loop architecture: inside harness, network allowlist for vision-mode tasks
  6. Vision logic split: harness `visionDecisionLoop.ts` (loop) + server `visionGroundingService.ts` (config/harvest)
  7. Cost ledger: new `vision_inference_calls` table + pg-boss rollup
  8. Action parser: native text format, `visionActionParserPure.ts`
  9. Missing endpoint: fail at first vision call (not at boot)
  10. e2b SDK: harness wiring scaffolded as stub; server-side service built now

---

## Spec authoring status

Spec file: `docs/superpowers/specs/2026-05-18-browser-vision-grounding-spec.md`
Status: IN PROGRESS

---

## Review log

| Reviewer | Status | Notes |
|---|---|---|
| spec-reviewer | pending | |
| chatgpt-spec-review | pending | |

---

## Skipped steps

- Step 5 (mockup loop): skipped — `ui_touch = false`

---

## Step 3b grill-me

Step 3b grill-me: completed. 11 rounds. No re-run of Step 3a required.

---

## Phase 2 (BUILD) — in progress

### Chunk status

| Chunk | Status | Commit | G1 attempts |
|---|---|---|---|
| C1 — visionActions.ts | done | 46af84ee | 1 |
| C3 — FailureReason additions | done | d7767fa1 | 1 |
| C11 — visionInferencePricing + Vitest | done | 27068f68 | 1 |
| C5 — schema + migration 0378 + RLS | done | 1937b01d | 1 |
| C4 — SandboxRunTaskInput extension | done | 2bccecd7 | 1 |
| C10 — skillParserServicePure | done | 224ecbf7 | 1 |
| C2 — visionActionParserPure + Vitest | done | d4ec0adb | 1 |
| C6 — visionGroundingService | done | ca0f35ab | 2/lint |
| C8 — harness stub | done | 814eec80 | 2/lint |
| C13 — decisionMode thread audit | done | 72c47c84 | 1 |
| C7 — _ieeShared dispatch + harvest | **pending** | — | — |
| C9 — rollup job + boot registration | **pending** | — | — |
| C12 — docs | **pending** | — | — |

### Next chunk
**C7** — `server/services/executionBackends/_ieeShared.ts` (dispatch + finalise harvest hook)

Key notes for C7:
- Read `opts.ieeTask?.decisionMode` directly (typed via C13 — `BrowserTaskPayload` in `shared/iee/jobPayload.ts` now has `decisionMode`)
- Line 214 has a pre-existing loose cast `(opts as { ieeTask?: { skillId?: string } })` — C13 surfaced this; C7 should refactor to proper type narrowing
- Use `baseNetwork`/`taskNetwork` merge pattern from plan §7 C7 (not replace)
- `harvestVisionCalls(tx, ieeRun)` call inside `if (ieeRun.type === 'browser')` block, before `assertValidTransition`
- Import: `import * as visionGroundingService from '../visionGroundingService.js'`

### Builder notes carried forward
- C6: `VISION_INFERENCE_ENDPOINT_URL`, `VISION_INFERENCE_API_KEY`, `VISION_INFERENCE_MODEL_ID` not in typed `env` Zod schema — uses `process.env` directly (established pattern). Routed to todo as V1 non-blocker.
- C8: `_ComputeCostCentsFn` type alias requires `eslint-disable-next-line` due to `@typescript-eslint/no-unused-vars` — surgical, per spec requirement.
- Concurrent commits from other branches (oss-pattern-lifts-bundle spec-reviewer) rebased over cleanly each time.

## Environment snapshot
- last_chunk_committed: C13
- head: 72c47c846836343ab97c948ba127889a4a5db946
- package_lock_md5: 1fa84d77b2ed10d665849cc70a34b52b
- migration_count: 503
- captured_at: 2026-05-18T12:30:00Z

---

## Doc Sync gate (Phase 2 D.5)

| Doc | Verdict |
|---|---|
| architecture.md | yes (Phase 2 — IEE worker retirement: added vision-grounding parallel paragraph at the cost-rollup row) |
| docs/capabilities.md | yes: create new capability record — vision-based browser grounding (UI-TARS 7B VLM decision layer) is a new capability under Agent Runtime cluster. **Actual asset register row write deferred to finalisation-coordinator step 6 per process** |
| docs/integration-reference.md | no — VISION_INFERENCE_* is a self-hosted vLLM endpoint, not a third-party OAuth/MCP integration; no integration slug applies |
| CLAUDE.md / DEVELOPMENT_GUIDELINES.md | no — no convention / agent-fleet / locked-rule / §8 development discipline changes |
| CONTRIBUTING.md | no — no lint-suppression grammar changes; one eslint-disable removed (no new pattern introduced) |
| docs/frontend-design-principles.md | n/a — no UI / page / screen / surface changes |
| KNOWLEDGE.md | yes (2 entries: cross-tenant aggregate leak with shared entity_id; sandbox provider envelope drops new fields silently) |
| docs/spec-context.md | n/a — spec-review sessions only; this is Phase 2 build pipeline |
| docs/decisions/ | no — durable architectural choices (RunPod A10G vendor, UI-TARS@bc25e5f pin, harvest-as-first-statement-of-ieeFinalise placement) are all documented in `tasks/builds/browser-vision-grounding/plan.md §2`; ADR-worthy candidates can be promoted in a follow-up if any of these prove load-bearing for future builds |
| docs/context-packs/ | n/a — no architecture.md section anchors renamed |
| references/test-gate-policy.md | n/a — no test-gate posture changes |
| references/spec-review-directional-signals.md | n/a |
| docs/incident-response.md | n/a |
| docs/testing-transition-plan.md | n/a |
| .claude/FRAMEWORK_VERSION + CHANGELOG.md | n/a — no framework changes |
| scripts/verify-* | n/a — no gates added / removed / renamed |

---

## Phase 3 (FINALISATION) — complete

**S2 branch sync:** 11 commits behind origin/main (yellow), 8 conflicted files. Resolution strategy: take remote for all code files (parallel session's review pass converged); merge documentation. Final S2 commit: `180088e7`.

**G4 regression guard:** PASS — 0 errors, 879 pre-existing baseline warnings, typecheck clean.

**PR existence check (Step 4):** N/A — this build was developed and pushed directly to `main` by both sessions (branch protection has bypass permission). No feature branch, no PR.

**chatgpt-pr-review (Step 5):** SKIPPED — REVIEW_GAP recorded.
```
REVIEW_GAP: chatgpt-pr-review | task-class: Major | reason: build pushed directly to main (no PR); 7+ review touches already across two sessions (spec-conformance + adversarial-reviewer + pr-reviewer ×3 rounds + reality-checker + dual-reviewer per session) | operator-override: yes-2026-05-19T01-15-00Z | remediation: accept — coverage saturation
```

**Doc-sync sweep (Step 6):**

| Doc | Verdict |
|---|---|
| architecture.md | yes (IEE worker retirement table: vision-grounding parallel rollup row with REPLACEMENT semantics + entity_type/entity_id detail) |
| docs/capabilities.md | yes: update existing capability record — Sandboxed Runtime (IEE) asset register row updated (Description includes vision-based browser grounding; Last review 2026-05-19; Carry notes references vision-grounding preview spec; Related docs cites spec path) |
| docs/integration-reference.md | n/a — VISION_INFERENCE_* is self-hosted vLLM infra, not a third-party integration |
| CLAUDE.md / DEVELOPMENT_GUIDELINES.md | n/a — no convention / locked-rule changes |
| CONTRIBUTING.md | n/a — eslint-disable removed (no new lint-suppression policy) |
| docs/frontend-design-principles.md | n/a — no UI changes |
| KNOWLEDGE.md | yes (4 entries — PLATFORM_SENTINEL constant entity_id pattern, defence-in-depth org filter even with GUC, boundary-layer envelope serialisation gap, quote-aware whitespace collapse in text parsers) |
| docs/spec-context.md | n/a — feature pipeline, not spec review |
| docs/decisions/ | n/a — durable choices already in spec.md / plan.md; no standalone ADR needed |
| docs/context-packs/ | n/a — no architecture.md anchor changes |
| references/test-gate-policy.md | n/a — no test-gate posture changes |
| references/spec-review-directional-signals.md | n/a |
| docs/incident-response.md | n/a |
| docs/testing-transition-plan.md | n/a |
| .claude/FRAMEWORK_VERSION + CHANGELOG.md | n/a — no framework changes |
| scripts/verify-* | n/a — no gates added/removed/renamed |

**Compound Learning Feedback (Step 7a):** Two patterns extracted to KNOWLEDGE.md by parallel session (entries 1+2 above); two additional patterns extracted by this session (entries 3+4). Net: 4 KNOWLEDGE.md entries from a single feature build, driven by cross-session adversarial + dual-reviewer findings. Compound learning proposal: institutionalise the boundary-layer envelope check (entry 3) as a dedicated CI gate — `scripts/verify-envelope-serialisation.sh` — to catch the class of bug Codex/dual-reviewer caught here that no other reviewer found.

**tasks/todo.md cleanup (Step 8):** Deferred items recorded (12 entries across spec-conformance, adversarial, pr-reviewer, dual-reviewer findings):
- BVG-SC-D1, BVG-SC-D2 (spec-conformance)
- BVG-ADV-2, BVG-ADV-3, BVG-ADV-OBS-1/2/3, BVG-ADV-F2, BVG-ADV-F3, BVG-ADV-W3, BVG-ADV-W4 (adversarial)
- BVG-PR-S1, BVG-PR-C1, BVG-PR-C2 (pr-reviewer)
- BVG-DR-1 (dual-reviewer)

All routed to V2 backlog; V1 impact zero (harness is stub). No backlog items closed by this build (the build was greenfield).

**Final HEAD:** 180088e7 (S2 merge commit).
**Branch on remote:** main.
**Merge status:** already on main via direct push (no PR existed).

**Status:** Phase 3 complete. current-focus.md transitions to MERGED.

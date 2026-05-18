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

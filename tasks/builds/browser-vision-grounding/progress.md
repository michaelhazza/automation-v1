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
| chatgpt-plan-review Round 1 | CHANGES_APPLIED | 2026-05-18 — 10 findings triaged; 7 applied to plan.md (1 HIGH x2, 1 MEDIUM x4, 1 LOW); 3 informational, no action. See §Plan fixes below. |
| chatgpt-plan-review Round 2 | APPROVED (after fix) | 2026-05-18 — 2 findings: 1 CHANGES_REQUESTED (C10 file inventory incomplete), 1 INFO (C9 sequencing). C10 fix applied (see §Plan fixes Round 2). Session APPROVED. |

---

## Skipped steps

- Step 5 (mockup loop): skipped — `ui_touch = false`

---

## Step 3b grill-me

Step 3b grill-me: completed. 11 rounds. No re-run of Step 3a required.

---

## Plan fixes — ChatGPT Round 2 (2026-05-18)

| # | Severity | Finding | Action |
|---|---|---|---|
| 1 | CHANGES_REQUESTED | §C10 "Files to modify" listed only `skillParserServicePure.ts`; dispatch envelope (`BrowserTaskPayload`, `AgentRunRequest.ieeTask`) missing | Applied: added `shared/iee/jobPayload.ts` and `server/services/agentExecutionService/types.ts` to C10 file list; added Zod + TS contract snippets for both; acceptance criterion updated to require verified dispatch-envelope wiring before C7 reads it |
| 2 | INFO | C9 does not need to move relative to C10; C9 depends only on C5 | No action — sequencing confirmed correct |

---

## Phase 2 — chunk build status (2026-05-18)

| Chunk | Status | Notes |
|---|---|---|
| C1 — visionActions.ts | done | commit e44a963e (our session) + 46af84ee (parallel session; conflict resolved — richer version kept) |
| C2 — visionActionParserPure + tests | done | commit d4ec0adb (parallel session) |
| C3 — FailureReason additions | done | commit d7767fa1 (parallel session) |
| C4 — SandboxRunTaskInput extension | done | commit 2bccecd7 (parallel session) |
| C5 — vision_inference_calls schema + migration 0378 | done | commit 1937b01d (parallel session) |
| C11 — visionInferencePricing + tests | done | commit 27068f68 (parallel session) |
| C10 — skillParserServicePure + dispatch wiring | done | commit 224ecbf7 (parallel session) |
| C6 — visionGroundingService | done | commit 180a7151 (our session) + remote session parallel; conflict resolved — remote version kept (uses ieeArtifacts, parseVisionEndpointHostPort export) |
| C8 — harness stub + visionDecisionLoop | done | commit 814eec80 (parallel session) |
| C9 — visionInferenceCostRollupJob | pending | |
| C7 — _ieeShared dispatch + harvest hook | pending | |
| C12 — docs update | pending | |

**Paused after C6 merge at operator request (2026-05-18). Remaining: C9 → C7 → C12.**

## Environment snapshot
- last_chunk_committed: C6 (merge)
- head: f95ee13f
- captured_at: 2026-05-18T00:00:00Z

---

## Plan fixes — ChatGPT Round 1 (2026-05-18)

All findings were technical (architecture/contract/sequencing). Auto-applied per CLAUDE.md policy.

| # | Severity | Finding | Action |
|---|---|---|---|
| 1 | HIGH | Missing C10 -> C7 dependency for skill-parser dispatch threading | Applied: §3 graph updated, §6.5 updated, §6.7 updated, C7 Dependencies updated, C10 acceptance criterion expanded |
| 2 | MEDIUM | `ieeTask?.decisionMode` type cast unsafe | Applied: C7 dispatch code replaced with runtime guard (allowlist: dom/vision/hybrid; else null) |
| 3 | HIGH | `ieeRun.agentRunId` nullability conflicts with non-null DB run_id | Applied: C6 `harvestVisionCalls` semantics updated with explicit null-assert before insert, named throw `vision.harvest.missing_agent_run_id` |
| 4 | MEDIUM | C9 per-run rollup semantics hedge is conditional | Applied: committed to REPLACEMENT semantics unconditionally; removed "if existing uses ADDITIVE, switch" hedge |
| 5 | MEDIUM | `cost_aggregates` ON CONFLICT target may be incomplete | Applied: C9 acceptance criteria updated — builder must verify actual unique constraint columns before commit |
| 6 | MEDIUM | `buildVisionAwarePolicy` non-exhaustive mode handling | Applied: C7 helper rewritten with explicit `switch` on `existing.mode` (allowlist, none, default-throws); test cases expanded from 4 to 6 |
| 7 | INFO | Harvest ordering deviation is sound | No action |
| 8 | INFO | `imageSizeBytes` forward-compat is correctly documented | No action |
| 9 | INFO | Cost-parity drift posture is correct | No action |
| 10 | LOW | C8 redaction follow-up should be acceptance criterion | Applied: §5.1 mitigation upgraded from "tracked follow-up" to C8 acceptance criterion; explicit check-off required in progress.md |

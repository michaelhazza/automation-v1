# Intent — Vision-based browser grounding via self-hosted UI-TARS

**Author:** Michael (operator) + spec-coordinator
**Date captured:** 2026-05-18
**Source brief:** `tasks/builds/browser-vision-grounding/brief.md` (DRAFT v1, 2026-05-17)
**Provisional slug:** `browser-vision-grounding`
**Scope class:** Major (new ML inference subsystem, new action schema, new decision layer on top of browser stack, infra deployment shape, new cost source, new workflow mode surface)

---

## Problem Statement

The IEE browser loop is driven by DOM selectors. This fails on three common real-world cases: (1) selector-fragile single-page apps with dynamic IDs or anti-automation obfuscation where the agent hits "selector not found" and gives up; (2) legacy desktop apps or any surface where no DOM exists, making such workflows entirely out of scope today; (3) sites where the visible UI and the DOM disagree — overlays, modals, virtualised lists — where the element a human would click is not the element a selector resolves to. Vision-language models (VLMs) that operate directly on screenshots can handle all three cases. The UI-TARS family (Apache-2.0, self-hostable weights) is state-of-the-art on screen-control benchmarks and emits a typed action schema compatible with our Playwright execution layer.

## Desired Outcome

Add a vision-based decision layer above the existing IEE browser stack. Agents opt in to vision-grounded action selection when DOM-based actions fail or when a workflow declares vision as the primary mode. The VLM is self-hosted (UI-TARS 7B on an OpenAI-compatible vLLM endpoint); no ByteDance API calls or binaries ship. Existing DOM-script-driven workflows continue to work unchanged. Vision calls are costed and capped using the existing cost-ledger primitives. A new `mode` field on workflow/skill definitions controls which decision path executes.

## Non-Goals

- Shipping ByteDance-branded binaries, Electron apps, or calling ByteDance/Volcengine API endpoints
- Replacing Playwright as the action execution plane (UI-TARS sits above it)
- Making vision the default for existing workflows
- Mobile / Android automation
- Custom fine-tuning of UI-TARS on tenant data
- A user-facing real-time screenshot viewer (V1 run logs are sufficient)
- Multi-monitor or multi-window desktop control
- OCR pre-processing of screenshots
- The 72B model size (7B is V1 default)
- Accessibility-tree fallback in V1

## Affected Capability Area

Agent Runtime, Billing

## User / Operator Impact

Operators gain the ability to mark specific workflows as `mode: vision` or `mode: hybrid`. Selector-hostile and legacy-desktop workflows that currently fail become viable. Per-task vision cost appears in the existing cost ledger with a new `source_type: 'vision_inference'`. Existing workflows are behaviourally unchanged. No new operator-facing configuration UI is required in V1 — mode is declared in workflow/skill definition YAML.

## Risk Surface

server/db/schema, agent runtime

## Assumptions

- The `worker/src/browser/` directory no longer exists — it was deleted in PR #345 (`iee-worker-retirement`). The current browser execution surface is the e2b sandbox harness at `infra/sandbox-templates/iee-browser/harness/index.ts` (stub awaiting e2b SDK). File references in the brief to `worker/src/browser/executor.ts` and `worker/src/browser/captureStreamingVideo.ts` are obsolete. Architect remaps all touch points to the e2b harness layer.
- UI-TARS 7B at FP16 requires ~16–24 GB VRAM. The architect confirms the inference hosting target (managed inference vendor vs self-hosted GPU node).
- The existing `cost_aggregates` ledger (and its ceiling primitives) can absorb a new `source_type` without schema changes beyond adding the enum value.
- The OpenAI-compatible vLLM endpoint surface is stable enough to define a typed client contract at spec authoring.
- `browser-hardening-primitives` (PR #349, merged 2026-05-18) has landed. The e2b harness surface is therefore its final shape going into this build.

## Open Questions

- **Inference hosting target** — managed inference vendor (e.g. RunPod, Lambda Labs) vs self-hosted GPU node vs both tiers. Architect picks and confirms GPU class and VRAM budget.
- **Mode surface** — where does the `mode: dom | vision | hybrid` field live? Workflow YAML? Skill frontmatter? Runtime flag on the IEE task envelope? Architect picks the single surface.
- **Screenshot capture mechanism** — `captureStreamingVideo.ts` is gone. What is the current screenshot API from within the e2b harness? Architect confirms.
- **Hybrid fallback threshold** — in `mode: hybrid`, how many DOM selector failures trigger vision fallback? Architect defines the retry policy.
- **Cost ceiling integration** — does the vision per-call cost slot into `runCostBreaker` using the existing `sandbox_compute` ceiling, or does it need its own named ceiling? Architect picks.
- **Action schema surface** — does the typed action schema live in `shared/types/` (accessible to both server and harness) or in `infra/sandbox-templates/iee-browser/harness/`? Architect picks the canonical location.

## Duplication / Strategy Check

| Output | Value |
|---|---|
| Duplication assessment | clear |
| Strategic fit | clear |
| Recommendation | proceed |

Supplementary per-cluster rows (multi-cluster Affected Capability Area):

| Output | Value |
|---|---|
| Agent Runtime — Duplication | clear (closest match: `sandboxed-runtime-iee` (Growth) covers the IEE substrate; `browser-hardening-primitives` (Inception) adds behaviour primitives. Neither describes a vision-based decision layer using a VLM. In-flight `iee-browser-on-e2b` spec (LOCKED) built the e2b execution runtime that this build sits above — not a duplicate.) |
| Agent Runtime — Strategic fit | clear (cluster has Mature `execution-infrastructure` and Growth `sandboxed-runtime-iee` / `persistent-agent-workspace` / `subscription-driven-long-task-execution` — all active. Extends an active cluster.) |
| Billing — Duplication | clear (closest match: `llm-spend-observability` (Growth) covers LLM cost observability; `agent-spending` (Growth) covers money movement. Neither describes a vision-inference cost source type on the cost ledger.) |
| Billing — Strategic fit | clear (cluster has Growth-state rows; no Declining / Sunset entries.) |

---

## Grill-me Q&A

Grill run 2026-05-18 by spec-coordinator inline. Termination: all 11 questions resolved. No re-run of Step 3a required — locked decisions do not alter Problem Statement, Desired Outcome, Affected Capability Area, Non-Goals, Risk Surface, or Assumptions.

### Q1 — Inference hosting target

**Question:** Managed inference vendor, self-hosted GPU node, or both tiers?

**Recommended answer:** Managed vendor (RunPod / Lambda Labs / Replicate) for V1. De-risks V1 by avoiding concurrent GPU infra ownership alongside an unfinished e2b integration. Architecture validated before committing to infra ownership. 7B FP16 on a managed A10G (24 GB VRAM) targets the p95 ≤ 6s budget.

**Operator decision:** accept.

### Q2 — Mode surface

**Question:** Where is `dom | vision | hybrid` declared — per-task in the browser task envelope, per-skill in YAML frontmatter, or per-workflow step?

**Recommended answer:** Skill YAML frontmatter declares `iee_decision_mode: dom | vision | hybrid`. The IEE skill executor reads this at dispatch and threads it into the browser task envelope, which flows as a new top-level optional field `decisionMode` on `SandboxRunTaskInput` (same pattern as `humanize`, `proxyAlignment`). Default `dom` when absent.

**Operator decision:** accept.

### Q3 — Hybrid fallback threshold

**Question:** How many DOM selector failures per step before falling back to vision?

**Recommended answer:** 1 retry then fall back. After a DOM selector failure, retry the same selector once (absorbs transient re-renders). Second failure hands the step to vision. Counter resets per-step. No configurable threshold in V1.

**Operator decision:** accept.

### Q4 — Failure modes when inference endpoint is unavailable

**Question:** Silent DOM fallback, fail the step with a named reason, or fail the run entirely?

**Recommended answer:** Named failure reason `vision_inference_unavailable`. `vision` mode: fail the run. `hybrid` mode: fail the step (DOM already consumed its retry budget). No silent fallbacks.

**Operator decision:** accept.

### Q5 — e2b SDK dependency / harness wiring

**Question:** Should harness screenshot capture and action execution be wired in this build, or scaffolded as a stub pending e2b SDK installation?

**Recommended answer:** Server-side `visionGroundingService.ts` and `visionActionParserPure.ts` built now (fully testable without e2b SDK). Harness `visionDecisionLoop.ts` scaffolded as a stub — same pattern as current `humanize` and `proxyAlignment` stubs. Harness wiring is a targeted follow-up chunk when the e2b SDK lands.

**Operator decision:** accept.

### Q6 — Loop architecture (inside harness vs server-side orchestration)

**Question:** Should the vision decision loop run inside the harness (harness calls vLLM directly, needs network allowlist) or as server-side orchestration (screenshot artefacts harvested and re-dispatched each step)?

**Recommended answer:** Loop inside the harness. Option B's per-step latency (harvest + re-dispatch) blows the p95 ≤ 6s budget before inference runs. vLLM endpoint is internal (not a third-party API key) — lower egress risk. Sandbox network policy for vision-mode tasks adds the inference host:port to the allowlist; deny-all remains the default for all other task types.

**Operator decision:** accept.

### Q7 — Operator surface (mode declaration)

**Question:** Skill YAML frontmatter (per-skill, once) or per-invocation workflow step parameter?

**Recommended answer:** Skill YAML frontmatter. Skills already carry behavioural declarations. Knowledge of which mode works for a site belongs at the skill level, not re-specified per workflow invocation.

**Operator decision:** accept.

### Q8 — Cost ledger model

**Question:** New per-call ledger table (like `llm_requests`) or write directly to `cost_aggregates`?

**Recommended answer:** New `vision_inference_calls` ledger table. Columns: `id`, `organisation_id`, `subaccount_id`, `run_id`, `iee_run_id`, `model`, `cost_cents`, `latency_ms`, `image_bytes`, `action_type`, `created_at`. pg-boss rollup job writes `source_type: vision_inference` rows to `cost_aggregates`. `runCostBreaker` picks these up automatically.

**Operator decision:** accept.

### Q9 — Action response format

**Question:** Parse UI-TARS native text format, or request structured JSON via system-prompt engineering?

**Recommended answer:** Native text parser (`visionActionParserPure.ts`). UI-TARS was trained on this format; JSON system-prompt engineering fights the model's priors and introduces a new failure mode. Parser is the right seam for contract enforcement and is the only file that changes if a future model emits JSON natively.

**Operator decision:** accept.

### Q10 — Vision logic location

**Question:** Given the loop runs inside the harness — where does vision grounding logic live?

**Recommended answer:** Split. **Harness** (`infra/sandbox-templates/iee-browser/harness/visionDecisionLoop.ts`): screenshot capture, vLLM HTTP call, action parsing, action execution, writes per-call records to `/workspace/artefacts/vision_calls.json`. **Server-side** (`server/services/visionGroundingService.ts`): resolves vLLM endpoint URL + short-lived token from env, threads into task envelope, harvests `vision_calls.json` at run end into `vision_inference_calls` DB rows. Credentials never enter the sandbox.

**Operator decision:** accept.

### Q11 — Missing endpoint boot behaviour

**Question:** Fail at server boot (env vars absent) or at first vision call?

**Recommended answer:** Fail at first vision call with `vision_inference_not_configured` FailureReason. Vision inference is an optional capability (like a credential broker integration), not a core server dependency. DOM-mode workflows unaffected. Surfaces cleanly in the run log for the operator.

**Operator decision:** accept.

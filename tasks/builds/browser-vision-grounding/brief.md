# Brief — Vision-based browser grounding via self-hosted UI-TARS

**Status:** DRAFT v1 (2026-05-17) — operator-captured from external repo analysis
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `browser-vision-grounding`
**Class:** Major (architect confirms at spec authoring)
**Source pattern:** [bytedance/UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop) (Apache-2.0 model weights, pattern + model adoption; no ByteDance binaries shipped)

## Problem

Our IEE browser loop (`server/services/sandbox/`, `worker/src/browser/`) is Playwright-script-driven with no vision-based understanding. The agent decides actions from DOM selectors. This fails on three common cases:

1. **Selector-fragile sites** — single-page apps with dynamic IDs, JavaScript-heavy UIs that re-render on every action, login pages with anti-automation selector obfuscation. Today the agent hits "selector not found" and gives up.
2. **Legacy desktop apps** — there is no DOM at all. Today these workflows are entirely out of scope.
3. **Sites where the visible UI and the DOM disagree** — overlays, modals, virtualised lists where the element the human would click is not the element a selector resolves to.

The UI-TARS family of open-weight vision-language models (Apache-2.0, weights on HuggingFace, 2B / 7B / 72B parameter sizes) is currently state-of-the-art on screen-control benchmarks (OSWorld 42.5%, ScreenSpot-V2 94.2%, AndroidWorld 64.2%). The model takes a screenshot and emits a typed action (click x y, type, scroll, hotkey). Self-hosted, fully offline, no telemetry to ByteDance.

## Goal

Add a vision-based decision layer ABOVE our existing Playwright stack. Agents can opt in to vision-grounded action selection when DOM-based actions fail or when the workflow declares vision as the primary mode. Existing DOM-script-driven workflows continue to work unchanged.

## Proposed approach (for the architect to evaluate)

### Tier 1: Inference layer

Self-host the UI-TARS 7B model behind a vLLM inference endpoint (or equivalent). Default deployment shape: a dedicated inference service alongside our existing sandbox infrastructure. The model serves an OpenAI-compatible chat endpoint that accepts a screenshot + task prompt and returns a typed action.

GPU sizing: 7B at FP16 needs ~16-24 GB VRAM. Architect confirms hosting target (managed inference vendor vs self-hosted GPU node vs both).

### Tier 2: Action schema

Adopt UI-TARS's typed action schema (`click x y`, `double_click x y`, `type "text"`, `scroll dx dy`, `hotkey "<combo>"`, `wait <ms>`, `done`). Coordinates are strict-typed integers in pixel space, not percentages. Architect locks the exact schema during spec authoring and confirms it slots into our existing `worker/src/browser/executor.ts` action vocabulary.

### Tier 3: Vision-decision service

New service `server/services/visionGroundingService.ts` (name to be confirmed) that:
1. Captures a screenshot via the existing `worker/src/browser/captureStreamingVideo.ts` pipeline.
2. Sends screenshot + task prompt to the inference endpoint.
3. Parses the typed action response.
4. Hands the action to the existing executor for input injection.
5. Captures the post-action screenshot for the next loop iteration.

### Tier 4: Mode opt-in

A workflow declares its decision mode at definition time:
- `mode: "dom"` (default; today's behaviour)
- `mode: "vision"` (vision-only; for legacy apps or selector-hostile sites)
- `mode: "hybrid"` (DOM-first; vision fallback on selector failure)

The architect confirms the surface (workflow YAML, skill frontmatter, or runtime flag).

### Tier 5: Cost + latency model

Vision inference is materially more expensive per step than DOM scripting (model call + screenshot encoding + bigger context). Cost row written per vision call into the existing `cost_aggregates` ledger with a new `source_type: 'vision_inference'`. Per-task and per-subaccount cost ceilings apply (same primitive as `sandbox_compute` ceilings).

## Constraints / non-goals

- **DO NOT** ship ByteDance-branded binaries to tenants. We self-host weights only; no UI-TARS-desktop Electron app, no ByteDance telemetry endpoints.
- **DO NOT** call out to ByteDance API endpoints (Volcengine). Self-hosted inference only.
- **DO NOT** replace the Playwright control plane. UI-TARS sits above Playwright in the decision layer; Playwright still executes the actions.
- **DO NOT** make vision the default for existing workflows. Opt-in by workflow mode; existing DOM workflows unchanged.
- **DO NOT** integrate accessibility-tree fallback in V1. Vision-only or DOM-only; the hybrid mode in tier 4 is the closest we ship.

## Files in scope (architect locks at spec authoring)

- New service: `server/services/visionGroundingService.ts` (or equivalent)
- New inference infrastructure (vLLM deployment): `infra/inference/ui-tars/` (template + deployment manifest)
- New schema: typed action types in `shared/types/visionActions.ts` (or equivalent)
- `worker/src/browser/executor.ts` — extend to accept and execute vision-emitted typed actions
- `server/services/sandbox/browserWarmPool.ts` — minor: screenshot capture timing if vision mode requires pre-action capture
- `server/db/schema/ieeRuns.ts` — possibly add `decision_mode` column to track per-run mode
- `server/db/schema/costAggregates.ts` — possibly add `vision_inference` source_type
- Workflow / skill definition surface for `mode` declaration (architect picks the right place)
- Tests: action schema parsing (pure), screenshot-to-action loop integration (sandbox)

## Out of scope

- Mobile / Android automation (UI-TARS supports it; we do not have the surface)
- Custom fine-tuning of the UI-TARS model on our tenant data
- A user-facing UI to watch the agent's screenshots in real time (existing run logs are sufficient for V1)
- Multi-monitor or multi-window desktop control
- OCR pre-processing of screenshots
- Replacement of any existing DOM-script-driven workflow
- The 72B model size (7B is the V1 default; architect may justify 72B later)

## Success criteria

1. A curated test set of 10 workflows that fail on the current DOM-only stack succeed under vision mode (architect defines the set during spec authoring).
2. Existing DOM workflows produce identical run logs before and after the change (no regression).
3. Per-task cost stays within an alarm threshold the operator approves at spec lock (rough estimate: vision calls ~5-10x cost of equivalent DOM steps).
4. Inference latency p95 ≤ 6 seconds per action on the chosen GPU class.
5. No ByteDance domain ever appears in outbound network calls from production sandboxes.

## What unblocks when this ships

- Workflows on selector-hostile sites (banks, ticketing, anti-bot-protected portals) become viable.
- Legacy desktop-app workflows for customers with no API surface become viable.
- A foundation for any future capability that needs the agent to "see" — visual QA, layout verification, screenshot-based proof of work delivery.

## Concurrent safety note

Minor overlap with `browser-hardening-primitives` in `worker/src/browser/` (executor action extension) and possibly `server/services/sandbox/browserWarmPool.ts`. Recommend sequencing: browser-hardening lands first (smaller, lower-level primitives), then this build adds the decision layer above. If concurrent, expect minor merge cleanup in `executor.ts` and `browserWarmPool.ts`. Isolated from `memory-tiered-consolidation` and `task-preview-mode`.

## Provenance

External repo deep-dive 2026-05-17 surfaced UI-TARS as the highest-leverage browser/desktop pattern from the weekly trend roundup. Operator-ratified: self-host weights only, no ByteDance binaries (Sheets row 2, column D records the decision).

## How to start (paste into a new Claude Code session)

```
launch spec-coordinator from tasks/builds/browser-vision-grounding/brief.md
```

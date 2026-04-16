# Workflow Recording Feature — Investigation Report

**Author:** Claude Code
**Branch:** `claude/browser-process-recording-Wu8vF`
**Date:** 2026-04-16
**Source brief:** *Workflow recording brief* (pasted into session — not checked into the repo)

This report completes the investigation tasks specified in Section 6 of the workflow recording brief. It is a read-and-report deliverable. No implementation code has been written. No implementation plans are proposed beyond the level of detail necessary to answer the questions in the brief.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Section 6.1 — Scraper Element-Matching Logic](#2-section-61--scraper-element-matching-logic)
3. [Section 6.2 — Reusability Assessment for the Recording Feature](#3-section-62--reusability-assessment-for-the-recording-feature)
4. [Section 6.3 — Existing Infrastructure Map](#4-section-63--existing-infrastructure-map)
5. [Recommended Directory Structure for the Extension](#5-recommended-directory-structure-for-the-extension)
6. [Architecture Concerns and Open Questions](#6-architecture-concerns-and-open-questions)

---

## 1. Executive Summary

**Headline finding.** The platform already contains a production-grade element fingerprinting and self-healing match engine in `server/services/scrapingEngine/adaptiveSelector.ts`. It is pure, well-designed, and covers nine fingerprint features with weighted similarity scoring. It is genuinely reusable for the recording feature. The recording extension should not reimplement this — it should share the fingerprint shape with the scraper so a recorded action log can be resolved against a live page using the same engine the scraper uses today.

**What exists vs. what needs building:**

| Area | State | Notes |
|------|-------|-------|
| Element fingerprinting | **Reusable as-is** | `buildFingerprint()` in `adaptiveSelector.ts` runs on a standard DOM `Element`. Works identically in a browser extension and in server-side jsdom. |
| Similarity scoring | **Reusable as-is** | `scoreSimilarity()` and `adaptiveScan()` are pure functions over two fingerprints or a fingerprint + Document. No DB, no network. |
| Fingerprint schema | **Relocate to `shared/`** | `ElementFingerprint` currently lives in `server/db/schema/scrapingSelectors.ts`. Needs to move to `shared/` for a clean import from the extension. |
| Action registry | **Reusable pattern** | 88 actions already registered. Recording-related actions (`record_workflow_start`, `process_recorded_workflow`, etc.) fit the existing gate/retry/MCP model cleanly. |
| HITL gate system | **Reusable as-is** | `hitlService.ts` + `request_approval` pattern is the right substrate for the variable-confirmation step in Phase 2. |
| pg-boss job queue | **Reusable as-is** | Adding a `workflow-recording-normalise` job type is additive — pattern is well-trodden. |
| Adaptive LLM router | **Reusable as-is** | `llmRouter.ts` already supports `{ stablePrefix, dynamicSuffix }` for prompt caching and economy/frontier routing. Phase 2 synthesis plugs in cleanly. |
| IEE browser infrastructure | **Partially relevant** | Server-side Playwright, not an extension. Useful for *replay* (Phase 3), not *capture*. |
| Browser extension infrastructure | **Does not exist** | No extension code, no manifest, no Chrome Web Store scaffolding. Full greenfield for this piece. |

**Directory recommendation (headline).** Create a new top-level `extension/` sibling to `server/` and `worker/`. Promote the fingerprint schema and a new action-log schema to `shared/recording/`. Both the extension and the server import from `shared/` — no package-manager indirection, no workspaces config churn. This matches the existing convention (`shared/iee/` is already consumed by both `server/` and `worker/` via relative imports).

**One concern flagged to the user.** The fingerprint engine was designed for the scraper's execution context (server-side jsdom, single "find this element on a freshly-rendered page" call). The recording extension calls it in a different shape — capture hundreds of elements during a live user session, store the fingerprints, then much later resolve them against a live DOM in a headless browser on replay. The scoring logic ports cleanly, but the capture-time ergonomics need one small addition (a deterministic selector-builder that prefers semantic attributes — see §3.3). This is not a blocker; it is a 1–2 day enhancement to `adaptiveSelector.ts`.

**Bottom line.** The recording feature has more reusable substrate than the brief assumed. The brief estimated 10–12 weeks for Phase 1 without knowing the fingerprint engine already existed. With it as a shared utility, the Phase 1 engineering effort drops meaningfully — probably to 6–8 weeks — because the hardest piece of the normalisation layer (robust element references) is 80% built.

---

## 2. Section 6.1 — Scraper Element-Matching Logic

### 2.1 Where it lives

| File | Role | Lines |
|------|------|-------|
| `server/services/scrapingEngine/adaptiveSelector.ts` | Fingerprint + similarity + adaptive scan | ~365 |
| `server/services/scrapingEngine/selectorStore.ts` | Persistence wrapper (save/load/hit/miss/update) | ~205 |
| `server/db/schema/scrapingSelectors.ts` | DB schema + `ElementFingerprint` TypeScript interface | ~48 |
| `server/services/scrapingEngine/index.ts` | Orchestrator (Tier 1/2/3 fetch, robots.txt, rate limiting — not directly part of matching but wires selectors into scraping flow) | ~400 |
| `server/skills/scrape_structured.md` | Skill prompt that agents use to trigger adaptive scraping | ~46 |

### 2.2 What it captures per element (the `ElementFingerprint` shape)

From `server/db/schema/scrapingSelectors.ts:5`:

```typescript
interface ElementFingerprint {
  tagName: string;                        // "button", "input", "div", …
  id: string | null;                      // el.id or null
  classList: string[];                    // Array of class names
  attributes: Record<string, string>;     // All attrs except class/id/style
  textContentHash: string;                // sha256 of trimmed textContent
  textPreview: string;                    // First 100 chars of textContent
  domPath: string[];                      // Ancestor chain: ["div.container", "form.login", "fieldset"]
  parentTag: string;                      // "div.login-form" (tag + up to 2 classes)
  siblingTags: string[];                  // Dedup'd tag names of parent's other children
  childTags: string[];                    // Dedup'd tag names of direct children
  position: { index: number; total: number }; // nth-of-type among same-tag siblings
}
```

This is a rich fingerprint. It captures structural context (domPath, parent, siblings, children), semantic identity (tag, id, class, attributes, text), and positional fallback. Nine separate signals in total.

### 2.3 How matching works

Three layered functions in `adaptiveSelector.ts`:

**`buildFingerprint(el: Element): ElementFingerprint`** — pure function, walks the DOM around a single element to build the structure above. Uses native DOM APIs only (jsdom-compatible; works in a browser extension without change).

**`scoreSimilarity(stored, candidate): number`** — nine-feature weighted similarity between two fingerprints. Returns 0.0–1.0. Weights:

```
tagName    0.15   (exact match or 0)
id         0.10   (exact match or 0, unless both null → 1.0)
classList  0.15   (Jaccard over sets)
attributes 0.10   (ratio of keys where both sides have identical values)
textSim    0.15   (token Jaccard on textPreview — not the hash, because hashes are too strict after minor copy edits)
domPath    0.15   (longest-common-subsequence ratio over ancestor chains)
parentTag  0.10   (exact match or 0)
siblings   0.05   (Jaccard over tag-name sets)
children   0.05   (Jaccard over tag-name sets)
```

**`adaptiveScan(document: Document, stored): AdaptiveScanResult`** — O(n) scan of every element on the page, scoring each against the stored fingerprint. Pre-filters by `tagName` when the page exceeds 5,000 elements (keeps it fast on large pages — typical pages complete in under 10ms per the header comment).

**`resolveSelector(document, cssSelector, storedFingerprint)`** — the integration wrapper. Tries the original CSS selector first; if that match scores ≥ 0.85 against the stored fingerprint, done. Otherwise falls through to `adaptiveScan`. This two-path design is exactly what a replay engine for the recording feature will want.

### 2.4 Confidence thresholds

```
>= 0.85  → confident match
0.6–0.85 → uncertain (agent may ask for human confirmation — surfaced as selector_uncertain: true)
< 0.6    → no match found
```

These thresholds are exported as constants (`CONFIDENT_THRESHOLD`, `UNCERTAIN_THRESHOLD`). They drive the three-tier outcome in `AdaptiveScanResult`: `{ found, score, cssSelector, fingerprint, uncertain }`.

### 2.5 CSS selector generation (`buildCssSelector`)

The engine also emits fresh CSS selectors after a successful adaptive re-match. Preference order:
1. If the element has an id → `tagName#id` (id is escaped against CSS-special characters)
2. Else if it has class names → `tagName.class1.class2.class3` (first 3 only)
3. Else → `parentSelector > tagName:nth-of-type(N)` recursive, capped at 15 levels of depth

The depth cap matters — it prevents pathological deeply-nested DOMs (some SPAs hit 40+ levels) from generating selectors that are themselves fragile.

### 2.6 Documented accuracy and failure modes

There is no benchmark file or documented accuracy suite. The only accuracy signal in-code is the `hitCount`/`missCount` columns on `scraping_selectors`, updated by `incrementHit` / `incrementMiss` in `selectorStore.ts`. The thresholds themselves (0.85 / 0.6) appear to be hand-tuned — no comments cite benchmarks.

Known failure modes implied by the code (not explicitly documented):
- **Text-heavy elements that change copy frequently** — textPreview token Jaccard handles minor copy edits (hence using the preview, not the hash), but wholesale rewrites will drop the textSim score.
- **Pages with many visually-similar buttons** (e.g. a list of "Edit" buttons) — the fingerprint for each is near-identical; matching relies on `position.index` + `domPath` to disambiguate. Not bulletproof in lists where rows reorder.
- **SPAs that rebuild DOM on navigation** — since the scraper is invoked once per URL fetch (not across navigations), this is not a scraper problem. For the recording feature, it *will* be a problem.

### 2.7 Coupling / reusability posture today

**Pure functions.** `buildFingerprint`, `scoreSimilarity`, `adaptiveScan`, `resolveSelector`, `buildCssSelector`, `computeTextHash` — all pure. No imports from `../db`, no network calls, no side effects. They take DOM objects in and return fingerprint/score/result objects. This is the ideal shape for cross-context reuse.

**Persistence is cleanly separated.** `selectorStore.ts` is the only file that imports `db` and touches the `scraping_selectors` table. `adaptiveSelector.ts` knows nothing about the database.

**One import dependency.** `adaptiveSelector.ts:21` imports the `ElementFingerprint` type from `server/db/schema/scrapingSelectors.ts`. This is the only obstacle to cross-context reuse — the type needs to move to `shared/` before the extension can import it without reaching into `server/`.

---

## 3. Section 6.2 — Reusability Assessment for the Recording Feature

### 3.1 The feasibility verdict

**Extraction is feasible and cheap.** The element-matching logic is already 90% shaped for cross-context reuse. The remaining 10% is mechanical: move the `ElementFingerprint` type to `shared/`, update the two importers (`adaptiveSelector.ts` and `selectorStore.ts`), and add one new utility function (a semantic-first CSS selector builder — see §3.3 below).

**Estimated effort for the extraction itself: 1–2 days.** Separate from the rest of the recording feature.

### 3.2 Context differences the extension introduces

The scraper and the recording extension use the fingerprint engine in genuinely different shapes. Understanding the differences matters because some of them require small additions to the engine, not just code relocation.

| Dimension | Scraper (today) | Recording extension (new) |
|-----------|-----------------|---------------------------|
| DOM runtime | Server-side jsdom | Real Chrome DOM inside an extension content script |
| Invocation | Once per scrape call, per URL | Many times per user session (one fingerprint per interacted element) |
| When to fingerprint | On demand, for elements the LLM asked about | Proactively, at capture time, for every click / input target |
| Performance budget | 10ms per scan is fine (server-side, async) | Must be <1ms per fingerprint call (blocks the user's click event handler) |
| Matching direction | Stored fingerprint → find it on this page | Stored fingerprint → find it on a *future* rendered page in a replay worker |
| Confidence handling | Fall back to `selector_uncertain: true`, ask agent to re-prompt | Fall back to HITL review (the variable-confirmation UI), ask user to re-confirm or re-record |
| Matching frequency | One element at a time | Potentially all elements from a 30-step workflow, resolved in sequence during replay |

None of these differences invalidate the existing engine. The scoring math ports. The fingerprint shape ports. The threshold constants port. What changes is the *wrapping*:

- **Capture-time path (extension):** `buildFingerprint(el)` — identical to today. Just called in a different process.
- **Replay-time path (server-side IEE worker):** `resolveSelector(document, cssSelector, storedFingerprint)` — identical to today. Just called with fingerprints that were captured in the extension rather than captured in a previous scrape.

### 3.3 The one enhancement needed — semantic-first selector priority

The brief calls out Playwright codegen's locator strategy as the reference: prioritise role, aria-label, visible text, and data-testid over coordinate or index-based selectors. The current `buildCssSelector` does not match this.

**Current `buildCssSelector` preference order (per `adaptiveSelector.ts:129–152`):**
1. `tagName#id`
2. `tagName.class1.class2.class3`
3. Recursive `parent > tagName:nth-of-type(N)` (capped at 15 levels)

**What the recording feature needs in addition:**
1. `[data-testid="..."]` (most stable — widely used for test hooks, rarely changes)
2. `[role="..."][aria-label="..."]` (semantic — framework-agnostic)
3. `tagName:has-text("...")` or equivalent visible-text match (Playwright idiom)
4. `tagName#id` (id — current #1)
5. `tagName.class1.class2.class3` (class — current #2)
6. `parent > tagName:nth-of-type(N)` (positional fallback — current #3)

The change is additive. The existing `buildCssSelector` does not need to be modified — it just needs to be superseded for recording by a new `buildRecordingSelector()` function that tries semantic attributes first and falls back to `buildCssSelector()` for the positional case. Both functions share the fingerprint shape, so there is no divergence between what the scraper and the extension understand.

**This enhancement also benefits the scraper.** Today, scrape_structured has no preference for `data-testid` or semantic attributes. Sites that expose them would be more stable against redesigns if the scraper used them too. This is a drive-by improvement — worth mentioning but not required for the recording feature to proceed.

### 3.4 Risks specific to reuse

**Coupling risk 1: `selectorStore.ts` is the scraper's persistence layer, not the recording feature's.** The recording feature needs its own table (`recorded_workflows` or similar with action log + fingerprints per step). It should NOT write into `scraping_selectors` — that table is scoped to scraping's concept of `urlPattern` + `selectorGroup` + `selectorName`, which is not the right shape for a per-workflow step-ordered action log. Claude Code implementing the recording feature should build a new persistence layer — reusing only `adaptiveSelector.ts`, not `selectorStore.ts`.

**Coupling risk 2: tight coupling to jsdom Element types.** `adaptiveSelector.ts` uses the DOM `Element` interface generically, which works across jsdom and Chrome DOM. But if a future change to the scraper introduced a jsdom-specific call (e.g., `el.outerHTML` via a Node-specific API), it would silently break the extension. A test suite that exercises the pure functions in a DOM-agnostic harness (happy-dom or jsdom) would catch this regression. No such test suite exists today for `adaptiveSelector.ts` — it's only tested indirectly via the scraping engine's integration tests.

**Coupling risk 3: performance under extension constraints.** The scraper's O(n) scan over 5,000 elements is fine at 10ms when it's one-shot and async. The extension will call `buildFingerprint(el)` synchronously inside a click event handler. At fingerprint-per-click scale (one element, not 5,000), this is very cheap — buildFingerprint walks only the target element's ancestors, siblings, and direct children, not the whole page. So there is no perf risk at *capture* time. There *is* perf risk at *replay* time on large pages (e.g., a Salesforce list view with thousands of rows), but that happens server-side where the 10ms budget is fine.

**Coupling risk 4: shadow DOM and iframes.** Neither the scraper nor the extension handles these uniformly today. The scraper rarely hits shadow DOM because jsdom doesn't fully support it. The extension will hit both constantly — GoHighLevel uses iframes for form builders; many admin UIs use shadow DOM for custom components. This is not a coupling risk per se, but it's a known gap the recording feature will need to address with extension-specific code (injecting the content script into each frame, walking shadow roots). That work does not invalidate the fingerprint engine — fingerprints inside a shadow root are still valid fingerprints — it's an orthogonal capture concern.

### 3.5 Summary: what to promote, what to keep, what to build new

**Promote to `shared/recording/` (or `shared/dom/`):**
- `ElementFingerprint` type (currently in `server/db/schema/scrapingSelectors.ts`)
- `buildFingerprint()`, `scoreSimilarity()`, `adaptiveScan()`, `resolveSelector()`, `buildCssSelector()`, `computeTextHash()`, `CONFIDENT_THRESHOLD`, `UNCERTAIN_THRESHOLD` (currently in `adaptiveSelector.ts`)

**Keep where it is:**
- `selectorStore.ts` (scraping-specific persistence — do not reuse)
- `scraping_selectors` table (scraping-specific — do not reuse)
- The rest of `scrapingEngine/` (tier 1/2/3 fetch orchestration — unrelated)

**Build new (for the recording feature):**
- `buildRecordingSelector()` — Playwright-style semantic-first selector builder (see §3.3)
- A new `recorded_workflows` / `recorded_workflow_steps` schema (not using `scraping_selectors`)
- Extension-side adapters for shadow DOM and iframe traversal
- A DOM-agnostic test harness for the shared fingerprint utilities

---

## 4. Section 6.3 — Existing Infrastructure Map

### 4.1 Action registry — ready to extend

**File:** `server/config/actionRegistry.ts` (~2,253 lines, 88 registered action types)

The registry is the single source of truth for tool definitions, HITL gating, retry policy, MCP annotations, and idempotency strategy. Every recording-related action (capture start, finalise, normalise, synthesise config, save automation) fits this shape without any schema changes to the registry itself.

**Relevant registered actions that the recording feature can draw on:**

| Action | Gate | Why relevant |
|--------|------|--------------|
| `request_approval` | `review` | Substrate for the variable-confirmation HITL step in Phase 2 |
| `scrape_url`, `scrape_structured`, `monitor_webpage` | `auto` | Existing uses of `adaptiveSelector` — shows the integration pattern |
| `run_playwright_test` | `auto` | Closest existing "replay browser actions" action — worth studying for how the platform handles browser jobs already |
| `configure_integration` | `review` | Pattern for any recording-generated automation that needs OAuth |
| `create_task` | `auto` | If the recording produces a multi-step automation, the pattern for seeding sub-tasks exists |

**New actions the recording feature will need (Phase 2+):**

- `record_workflow_start` (read-only — issues a recording session token to the extension)
- `record_workflow_finalize` (keyed-write — receives the event log and fingerprints)
- `normalise_recorded_workflow` (keyed-write — async job; raw rrweb events → canonical action log)
- `synthesise_automation_from_recording` (keyed-write — calls Claude to propose agent+skills+integrations config)
- `confirm_workflow_variables` (review — HITL step)
- `save_recorded_automation` (keyed-write — writes final config to the automation registry)

All follow existing conventions. No architectural surprises.

### 4.2 HITL review system — ready to use

**File:** `server/services/hitlService.ts`

Promise-based, event-driven gate using the HumanLayer pattern. An agent tool call blocks on `awaitDecision(actionId, timeoutMs)` until `resolveDecision(actionId, { approved, result? })` is called from the review queue. Timeouts fall back to rejection with a comment.

**Two features of `hitlService` are directly useful for the recording feature:**
1. **Edited args on approval** — `HitlDecision.editedArgs` lets the human adjust the proposal before it's accepted. This maps exactly to the variable-confirmation UI: the user sees the proposed variables, can edit the ticked/unticked state, and submits a modified args object back. The server-side validation pattern is already in place.
2. **Pre-resolved decisions** — if the approval arrives before the agent registers `awaitDecision` (fast human, slow agent), the decision is cached for up to 5 minutes. This eliminates the common race condition in approval workflows.

**DB-side tables:** `review_items`, `review_audit_records`. Already support the full lifecycle (pending → approved / rejected / expired) with audit trail. The recording feature writes its approval rows into these tables — no new schema needed.

### 4.3 pg-boss job queue — pattern ready, jobs need defining

**File:** `server/config/jobConfig.ts` (31 named job types across 4 tiers)

Every job type declares:
- `retryLimit`, `retryDelay`, `retryBackoff`, `expireInSeconds`, `deadLetter` (DLQ queue name)
- `idempotencyStrategy`: `singleton-key` / `payload-key` / `one-shot` / `fifo`

**Most relevant existing job:** `iee-browser-task` (line 267) — used by the scraper's Tier 2 fetch to run server-side Playwright through the dedicated `worker/` process. If the recording feature replays captured workflows (Phase 3), this is the queue it uses. Retry limit 3, expire 600s, `payload-key` idempotency.

**New jobs the recording feature will need:**
- `workflow-recording-normalise` (payload-key — the normalisation pipeline runs async after the extension uploads)
- `workflow-recording-synthesise` (payload-key — calls the LLM to build a config proposal)
- `workflow-replay` (payload-key — future Phase 3; runs a saved automation via IEE)

The `verify-job-idempotency-keys.sh` build gate requires every new job to declare its strategy. This is a well-trodden path — 31 existing entries to pattern-match against.

### 4.4 OAuth / connector catalog — thin but functional

**File:** `server/config/oauthProviders.ts` + `server/adapters/`

**Providers with OAuth configured** (5): `gmail`, `hubspot`, `slack`, `ghl`, `teamwork`. `teamwork` scopes are TODO-marked, so effectively 4 production-ready.

**Providers with dedicated adapter files** (4): `slack`, `ghl`, `stripe`, `teamwork`. GitHub uses the GitHub App installation model instead of OAuth.

**Implication for the recording feature.** The brief assumes the UI-to-API mapping layer (Phase 2) can substitute API calls for UI replay on "the top platforms" (GHL, HubSpot, Salesforce, Xero, Google Workspace). Today, only GHL and HubSpot have OAuth connections. Salesforce, Xero, and Google Workspace (beyond Gmail) are **not** currently configured. This is not a blocker for Phase 1 (capture + display), but it constrains Phase 2's reliability promise — "green" API-backed steps will only be achievable for the 4 already-configured providers until more connectors are built.

**Recommendation.** Before Phase 2 commits to the UI-to-API mapping, the connector catalog needs a deliberate expansion plan. The brief should flag this as a Phase 2 dependency, not a Phase 1 one.

### 4.5 Adaptive LLM router — ready to use, with prompt caching already modelled

**Files:** `server/services/llmRouter.ts` (~759 lines), `server/services/llmResolver.ts`, `server/config/modelRegistry.ts`

**Already supported:**
- **Prompt caching** — every `modelRegistry` entry declares `supportsPromptCaching: true` for Anthropic/OpenAI/Gemini models that do. The router accepts `system: { stablePrefix: string; dynamicSuffix: string }` as a first-class param type — the stable prefix is cacheable. Perfect fit for the normalisation/synthesis prompts, where the instructions are stable and only the recorded action log varies.
- **Phase routing** — `phase: 'planning' | 'execution'` maps `planning → frontier`, `execution → economy`. The recording feature's Phase 2 synthesis call is a "planning" call (it structures a new automation from scratch), so it defaults to frontier. For normalisation (a more mechanical transform), `execution` / economy is appropriate — cheaper model for straightforward action logs.
- **Budget reservation** — atomic pre-call reservation against the org's budget, so out-of-budget calls fail loudly instead of silently being billed.
- **Provider fallback chain** — automatic failover between providers with per-provider cooldown if a call fails.
- **Full billing ledger** — one row per LLM call, joined to the agent run and org, used by the `llm_usage` reporting routes.

The recording feature's Phase 2 synthesis pass is a clean fit for all of this — no router-side changes needed. Claude Code will just pass the right `phase` and `{ stablePrefix, dynamicSuffix }` shape.

### 4.6 IEE worker — relevant for replay, not for capture

**Directory:** `worker/` (separate pg-boss worker process, top-level sibling to `server/`)
**Browser infrastructure:** `worker/src/browser/` — `playwrightContext.ts`, `executor.ts`, `observe.ts`, `login.ts`, `contractEnforcedPage.ts`, `artifactValidator.ts`, `captureStreamingVideo.ts`.

This is a server-side headless Playwright runtime. It handles the Tier 2 scraper fetch, the reporting agent's paywall logins, and the planned IEE execution loop for browser-based agent actions.

**Relevant for recording in two specific ways:**

1. **Phase 3 replay engine.** When a saved recording is triggered as an automation, it runs here — open Playwright, navigate to the start URL, iterate the action log, use `resolveSelector()` against each step's stored fingerprint. The existing `BrowserStepExecutor` in `executor.ts` already handles `click`, `type`, `navigate`, `extract`, `download` actions with a selector+fallbackText contract. The recording feature's replay is the same shape.
2. **Web login integration.** `server/services/webLoginConnectionService.ts` + `worker/src/browser/login.ts` handle credentialed logins to paywalled sites. If a recording starts behind a login, the replay can reuse this. Today it's scoped to the reporting agent's paywall workflow, but the primitive is generic.

**Not relevant for capture.** The worker is not a browser extension. The capture-time code (rrweb, fingerprinting) all runs in the user's actual Chrome browser. The worker only matters on replay.

### 4.7 Existing browser extension infrastructure

**None.** There is no `extension/` directory, no `manifest.json`, no Chrome Web Store tooling, no extension build scripts. This is full greenfield.

**Useful existing patterns to borrow from.** The `worker/` workspace has its own `package.json`, its own `tsconfig.json`, and its own build process. The extension should follow the same pattern — top-level `extension/` with its own `package.json`, own `tsconfig.json`, own build tooling (likely `vite` with the existing `@crxjs/vite-plugin` or equivalent).

### 4.8 Workflow engine existence check

The user asked whether there's a workflow engine that recorded automations would feed into. Based on exploring the code:

- **Playbook engine** (`server/services/playbookEngineService.ts`) — multi-step automation runner with HITL gates, cost tracking, and output publishing. This looks like the natural destination for a recorded workflow once it's synthesised into a config. The recording feature's Phase 2 `save_recorded_automation` action should target the playbook table, not invent a new one.
- **Scheduled tasks** (`server/routes/scheduledTasks.ts`) — cron + rrule scheduler used for recurring agent invocations. If a saved recording needs to run on a schedule, this is the substrate.
- **Skills** — the unit of agent capability. Each of the 139 skills is a markdown file under `server/skills/`, registered through the action registry. A recorded automation that simply calls an API could theoretically be exposed as a new skill, but this is probably overkill — playbook is the right fit.

### 4.9 Repository conventions discovered

- **Workspace layout:** `server/`, `client/`, `worker/`, `shared/` (type-only shared code), `scripts/`, `tests/`, `migrations/`, `docs/`, `tasks/`. No `packages/` — not a monorepo with workspace packages; `shared/` is consumed via relative imports (e.g., `worker/` imports via `../../shared/iee/...`).
- **TypeScript config:** one `tsconfig.json` per workspace (server, worker, client). The root `tsconfig.json` covers client-only (`include: ["client/src"]`).
- **Path aliases:** `@/*` → `./client/src/*`. No aliases for `shared/` — it's accessed by relative path from each workspace.
- **Test suites:** 50 test files, mostly `*Pure.test.ts` pattern under `server/services/__tests__/`. Integration tests are thin. Trajectory tests live under `tests/trajectories/`.
- **Build gates:** multiple `scripts/verify-*.sh` checks are run by `scripts/run-all-gates.sh`. Every new action requires `verify-idempotency-strategy-declared.sh` to pass. Every new job requires `verify-job-idempotency-keys.sh` to pass.

---

## 5. Recommended Directory Structure for the Extension

### 5.1 Top-level layout

Create a new top-level `extension/` directory, sibling to `server/`, `worker/`, `client/`, and `shared/`. This matches the existing workspace convention (worker/ already does exactly this).

```
automation-v1/
├── client/                    existing — main React SPA
├── server/                    existing — Express API + services
├── worker/                    existing — pg-boss IEE worker
├── shared/                    existing — cross-workspace types and pure code
│   ├── iee/                   existing
│   ├── recording/             NEW — action log schema, fingerprint shared utils
│   │   ├── actionLogSchema.ts         Canonical action log Zod schema
│   │   ├── elementFingerprint.ts      Moved from server/db/schema/scrapingSelectors.ts
│   │   ├── adaptiveSelector.ts        Moved from server/services/scrapingEngine/adaptiveSelector.ts
│   │   └── buildRecordingSelector.ts  NEW — semantic-first selector builder
│   └── skillParameters.ts     existing
├── extension/                 NEW — Chrome extension workspace
│   ├── package.json           Its own deps (rrweb, vite, @crxjs/vite-plugin)
│   ├── tsconfig.json          Extends root tsconfig
│   ├── vite.config.ts         CRX plugin for MV3 bundling
│   ├── manifest.json          Chrome MV3 manifest (service worker, content scripts)
│   ├── src/
│   │   ├── background/        Service worker (extension lifecycle, API uploads)
│   │   │   └── index.ts
│   │   ├── content/           Injected into each tab — captures events
│   │   │   ├── index.ts
│   │   │   ├── rrwebCapture.ts        rrweb wrapper with Layer 1 config
│   │   │   └── sanitiser.ts           Layer 2 deny-by-default sanitiser
│   │   ├── popup/             Toolbar popup UI (start/stop, step counter)
│   │   │   ├── index.html
│   │   │   └── Popup.tsx
│   │   ├── buffer/            Local storage buffer + upload retry
│   │   │   └── eventBuffer.ts
│   │   ├── api/               Platform API client (upload + session tokens)
│   │   │   └── platformClient.ts
│   │   └── lib/               Extension-internal helpers only
│   └── tests/                 Vitest + happy-dom
└── ...
```

### 5.2 What goes where — non-obvious decisions

**Shared fingerprint code lives in `shared/recording/`, not `shared/dom/` or `shared/scraper/`.** The scraper will import it from `shared/recording/` post-move. The naming reflects the new primary use case (recording) — scraping continues to work, it just imports from a common location. If the scraper predates recording and re-namespacing feels awkward, `shared/dom/` is also defensible. Either way, **do not leave it under `server/`**.

**The action log schema lives in `shared/recording/actionLogSchema.ts`, not `extension/src/types/` or `server/types/`.** This is the single most important architectural boundary in the recording feature. The brief's critical design constraint — "the action log schema is the contract between capture and processing" — requires the schema to be owned by neither the extension nor the server. It lives in `shared/`, both sides import it, and the video fallback (if ever built) produces the same schema.

**The extension does not depend on `server/` directly.** All communication with the backend goes through HTTP API calls against endpoints defined by the main server. This matches browser-extension sandboxing constraints anyway (the extension runs in a different process, doesn't share filesystem access) and avoids coupling that would break the independent deployment cycles (Chrome Web Store releases vs. server releases).

**The extension DOES depend on `shared/`.** This is safe because `shared/` is type-only and pure-function code — no database, no Node-specific APIs, no Express imports. The existing `shared/iee/` directory proves the pattern works from `worker/`; from `extension/` it's the same relative-import story.

### 5.3 Build tooling recommendation

**Vite + `@crxjs/vite-plugin`.** This is the current standard for Chrome MV3 extension development in 2026. It handles manifest-driven bundle generation, HMR during development, and produces a ready-to-upload Chrome Web Store package. It also plays well with the existing Vite setup used by `client/`.

The extension's `vite.config.ts` should NOT share config with `client/vite.config.ts`. They have different entry points, different module graphs, different asset handling. Keep them independent.

### 5.4 TypeScript configuration

The extension needs its own `tsconfig.json` with:
- `lib: ["ES2022", "DOM", "DOM.Iterable", "WebWorker"]` — service workers need the WebWorker types
- `target: "ES2022"` — Chrome MV3 supports modern syntax
- `paths` for `shared/*` → `../shared/*`
- `types: ["chrome"]` — the `@types/chrome` package for extension APIs

This keeps it completely independent from the root tsconfig, which is client-scoped.

### 5.5 Testing approach

- **Unit tests (fingerprint + sanitiser):** Vitest + happy-dom. These run in Node and exercise the pure functions directly. Shared fingerprint utilities should get their own test suite here — this closes the coupling risk flagged in §3.4 (risk 2).
- **Extension integration tests:** Playwright's built-in Chrome extension loading mode — launch a headed Chrome with the built extension, run real workflows against a fixture page, assert on uploaded event logs. One or two smoke tests in Phase 1.
- **End-to-end tests:** Deferred to Phase 2/3 when there's a full capture-to-replay loop to verify.

### 5.6 Migration path for the shared code move

The fingerprint extraction (`ElementFingerprint` + `adaptiveSelector.ts`) from `server/` to `shared/` is a prerequisite for the extension. Claude Code implementing Phase 1 should do this in a single dedicated PR before any extension code is written:

1. Move `ElementFingerprint` type from `server/db/schema/scrapingSelectors.ts` to `shared/recording/elementFingerprint.ts` (re-export from the old location to avoid breaking the schema file)
2. Move `adaptiveSelector.ts` from `server/services/scrapingEngine/` to `shared/recording/`
3. Update `server/services/scrapingEngine/selectorStore.ts` to import from the new location
4. Update `server/services/scrapingEngine/index.ts` if it imports from `adaptiveSelector` directly
5. Run `npm test` and `npm run typecheck` to confirm no regressions

This is mechanical. It should be its own merge-able PR before any extension work begins.

---

## 6. Architecture Concerns and Open Questions

### 6.1 Concerns the brief did not anticipate

**C1. The connector catalog is thin.** Only 4–5 providers have OAuth configured (Gmail, HubSpot, Slack, GHL, Teamwork-pending). The brief's Phase 2 premise — that the recording feature can substitute API calls for UI replay on "the top platforms (GHL, HubSpot, Salesforce, Xero, Google Workspace)" — assumes a larger catalog than exists. Salesforce, Xero, and most of Google Workspace are not wired up. This does not block Phase 1, but it substantially changes Phase 2's reliability promise. The brief should call this out explicitly.

**C2. No shadow DOM or iframe traversal anywhere in the codebase.** The scraper largely avoids the problem because jsdom doesn't fully support shadow DOM. The IEE worker's Playwright runtime handles iframes on a per-action basis but not recursively. The recording extension will hit both constantly (GHL form builders use iframes; many admin UIs use shadow-DOM web components). This is not a coupling risk — it's just new work that's not reflected in any existing substrate.

**C3. The extension's update cadence will outpace the server's.** Chrome Web Store reviews take 1–7 days. If the extension breaks in the wild (e.g., rrweb mis-handles a new SaaS platform's DOM structure), the fix cycle is longer than a normal server deploy. The brief's "keep the extension thin" principle is correct, but even a thin extension will need to be updated occasionally, and the user experience during the review window matters. The extension should display its version prominently and check against a platform endpoint at session-start to warn the user if the server considers their extension too old.

**C4. Test coverage for `adaptiveSelector.ts` is non-existent today.** The engine is used in production via the scraping engine, but there's no direct unit test suite. Promoting it to `shared/` and having two consumers (scraper + recording) elevates the cost of a regression. Phase 1 should include a dedicated test file at `shared/recording/__tests__/adaptiveSelector.test.ts` that exercises `buildFingerprint`, `scoreSimilarity`, and `adaptiveScan` against happy-dom fixtures, including the known failure modes (visually-similar buttons, reordered lists, copy edits).

**C5. The action registry is 2,253 lines.** Adding 6+ new recording-related actions to it nudges it further. No architectural issue — just noting that the brief's Phase 2+3 footprint inside the registry will be meaningful, and the file should probably be split into domain groups at some point. Not urgent; flagging for awareness.

### 6.2 Questions to answer before Phase 1 implementation starts

**Q1. Does the extension authenticate as a user, or as the extension itself?**
The brief does not specify. Two models are viable:
- *User-session model.* The extension relies on the user being logged into Automation OS in another tab; it reads the auth cookie from that session. Simpler for users (no separate login flow) but tightly coupled to the main web app's cookie config.
- *Extension-token model.* The extension generates a pairing code, the user pastes it into the Automation OS settings page, and the extension gets a dedicated long-lived token. More work, but cleaner separation and survives Chrome cookie-policy changes.
The token model is probably the right long-term choice. The user-session model is faster for internal testing (Phase 1). This is a decision the user should make explicitly before Claude Code starts building — it changes the auth surface area.

**Q2. Where do captured recordings land in the workflow engine?**
My working assumption is that Phase 2's synthesised config should target the existing **playbook engine** (`server/services/playbookEngineService.ts`) rather than inventing a new "recorded automation" entity. Playbooks already handle multi-step execution with HITL gates, cost tracking, and output publishing. A recording is just a pre-authored playbook. The user should confirm this framing before Phase 2 design, because it determines the shape of the Phase 2 config-synthesis prompt.

**Q3. Does the scraper move to the semantic-first selector strategy at the same time?**
The scraper would benefit from the new `buildRecordingSelector()` (data-testid > role+aria > visible text > id > class > positional) because sites that expose test hooks are more stable. But changing the scraper's selector preference would affect every currently-stored scraping selector — they'd all score lower on re-validation and potentially trigger adaptive re-matches. Recommended: the recording feature uses the new builder; the scraper stays on the old builder unless/until a separate decision to migrate is made. Leaving both builders available in `shared/recording/` makes this easy.

**Q4. Client-side PII redaction — full Presidio port, or the subset the brief assumes?**
The brief specifies Presidio on the server (Layer 3). Layer 2 is a custom client-side sanitiser built into the extension. The brief implies ~400–1,200 lines and ~10 engineering days for Layer 2. Before Phase 1 starts, the user should confirm whether Layer 2 should try to detect PII (email, phone, address, SSN, credit card patterns in captured text) or only suppress known sensitive DOM regions (hidden inputs, contenteditable, HTML attributes, autofill gaps). The latter is substantially simpler. The brief's §3.3 language leans toward the former; worth an explicit confirmation.

**Q5. Scope of the initial internal testing.**
The brief's Phase 1 is framed as internal-only. The success criteria mention a 10-step HubSpot workflow. But the team presumably wants to test against other platforms too — GHL, Xero, maybe Gmail/Google Workspace for admin tasks. The brief should list a concrete set of ~3 target workflows for Phase 1 so Claude Code knows what "correctly triaged" means in practice and what edge cases to anticipate in the normalisation pipeline.

### 6.3 Risks I'd flag before committing to Phase 1

**R1. Chrome Web Store publication friction.** First-time extension publication requires a developer account ($5 one-time fee), identity verification, and initial review (typically 3–7 days). This should be started early — parallel to Phase 1 dev — not at the end when the build is ready.

**R2. Manifest V3 service worker lifecycle.** Service workers in MV3 can be terminated by Chrome at any time when idle. Any in-memory state in the background script is lost on termination. The extension must persist recording state to chrome.storage.local (or IndexedDB) on every meaningful event, not just periodically. This is a known footgun and a real cause of lost-recording bugs in production extensions.

**R3. rrweb upstream stability.** rrweb is well-maintained but its changelog shows frequent breaking changes between major versions. Pin a specific version (not a range) and audit the changelog before ever bumping. The known bugs flagged in the brief (rrweb-io/rrweb #1385, #1609) may or may not be patched in a future release — track them.

**R4. Cost visibility for Phase 2.** The synthesis call per recording is modest individually (~$0.01–0.05 per recording with prompt caching), but if agencies record 50–100 workflows as part of onboarding, the cumulative cost is real. The existing `llm_usage` + budget reservation layer handles the accounting, but there's no UI today that shows per-feature cost attribution. Worth adding a "recording" feature label to the LLM call metadata so the cost can be tracked distinctly.

### 6.4 Recommendations — what to do next

**Do before writing any extension code:**

1. **Answer Q1–Q5 above.** These are design decisions that need user input, not things Claude Code can resolve.
2. **Do the shared-code move in its own PR.** Step §5.6 — extract fingerprinting to `shared/recording/`, update the two existing importers, add unit tests. This is mechanical and cheap (1–2 days) and de-risks everything downstream.
3. **Plan the connector catalog expansion for Phase 2.** The brief's UI-to-API reliability story depends on having Salesforce, Xero, Google Workspace connectors — none of which exist today. This is potentially a larger effort than the recording feature itself and needs to be surfaced before Phase 2 commits.
4. **Start the Chrome Web Store developer enrolment now.** It's a 3–7 day review wait — no reason not to begin it in parallel.

**Do at the start of Phase 1:**

1. Set up the `extension/` workspace with its own `package.json`, `tsconfig.json`, Vite + CRX plugin.
2. Write the rrweb integration with Layer 1 native config first — nothing else. Verify event capture works against a real HubSpot page.
3. Add Layer 2 sanitiser (deny-by-default, explicit allowlist). Verify no hidden-input values, no autofill leaks, no sensitive attributes in the upload payload.
4. Implement local buffering + resilient upload. Confirm that a deliberate network-off scenario recovers cleanly.
5. Build the normalisation pipeline as a new pg-boss job (`workflow-recording-normalise`), using `shared/recording/elementFingerprint` and `adaptiveSelector` for selector enrichment.
6. Build the step-review UI as an internal-only Admin page (no customer-facing surface per the brief).

**Defer explicitly:**

- Phase 2 config synthesis (depends on connector catalog expansion decision)
- Phase 3 replay engine (depends on Phase 1 + Phase 2 being stable)
- Video fallback (already out of scope per the brief, confirmed)
- Customer-facing onboarding of the extension (Phase 2+ only)

### 6.5 Summary of the main recommendation

**The recording feature is more feasible than the brief assumed** because the element fingerprinting engine already exists and is high quality. But Phase 2's reliability promise (API-backed steps on top platforms) is **less feasible than the brief assumed** because the connector catalog is thin. These two findings partially cancel out: the technical substrate for capture is stronger than expected, and the platform-coverage substrate for replay-via-API is weaker.

The net of those two: **Phase 1 is a clearer win than the brief implied, Phase 2 needs a dependency plan (connector expansion) before committing.** I'd recommend proceeding with the shared-code extraction PR immediately (it's mechanical and has independent value to the scraper), and treating Phase 1 as a focused 6–8 week build once Q1–Q5 are answered.

---

*End of investigation report.*


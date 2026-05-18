# Intent — Browser hardening primitives

**Author:** Michael (operator) + spec-coordinator
**Date captured:** 2026-05-18
**Source brief:** `tasks/builds/browser-hardening-primitives/brief.md` (v3 spec-ready, 2026-05-18)
**Provisional slug:** `browser-hardening-primitives`
**Scope class:** Significant (three Standard sub-features bundled under one spec)

---

## Problem Statement

Our stock Playwright browser stack fails three classes of legitimate operator workflow: (1) sites running fingerprint-based bot detection (Cloudflare Turnstile, FingerprintJS) sometimes block our Playwright workers on legitimate scraping / form-fill / lead-enrichment tasks, and we have no signal when the stack regresses on a previously-working site; (2) our agent injects keystrokes and mouse moves at machine speed, so sites that watch for unnatural input rhythm soft-block (CAPTCHA) or hard-block (account flagging) the session; (3) tenants who configure proxies for geo-targeted workflows see "the proxy works but the site still knows my real location" because timezone, locale, and WebRTC ICE candidates do not align with the proxy exit IP. CloakBrowser ships solutions but its Chromium-fork distribution is wrong for us (CVE-patching, binary size, brand association). We need the underlying patterns in our stock Playwright stack without the fork.

## Desired Outcome

Three independent, opt-in primitives added to the existing browser layer: (1) a detection-test harness as a CI regression gate that surfaces score drift over time, not as a pass/fail safety guarantee; (2) a `humanize()` API as a behaviour primitive on browser actions (mouse curves, typing variance, scroll momentum) with tiered profiles and seeded deterministic replay; (3) GeoIP-driven timezone / locale / language auto-detection plus WebRTC IP alignment for proxy sessions, with tenant-configured fields always winning. Each primitive ships independently behind its own feature flag, gracefully degrades when disabled or unsupported, and uses neutral reliability-framed vocabulary (no "stealth", "evade", "cloak"). Stock Playwright behaviour is unchanged by default.

## Non-Goals

- Adopting the CloakBrowser Chromium fork or any forked Chromium binary
- CAPTCHA solving, reCAPTCHA scoring manipulation, or TLS / JA3 / JA4 / HTTP-2 fingerprint manipulation
- Per-tenant fingerprint randomisation (canvas / WebGL / audio variance)
- Behavioural-cloning ML models or AI-driven evasion that picks input rhythm to dodge a specific detector
- Residential proxy procurement (tenants bring their own)
- A user-facing "stealth mode" toggle in tenant settings or any stealth-framed product surface
- Firefox / WebKit parity (V1 is Chromium-only; deferred until workflow demand justifies it)
- Account-pool management for sites requiring multi-account access
- Continuously defeating new detection systems (the harness detects regressions in OUR stack; it does not pursue an anti-detection arms race)

## Affected Capability Area

Agent Runtime, Audit & Governance

## User / Operator Impact

Existing workflows are behaviourally unchanged unless explicitly opted into a primitive. New surface area for operators: a per-workflow `humanize` flag (and an optional session-level default), a per-primitive feature flag for tenant rollout, and a tenant-facing disclosure explaining what each primitive changes in plain reliability-framed language. CI surfaces detection-regression signals to engineering on every Playwright bump or browser-layer change; the harness publishes historical scores so trends are visible over time. Detection-site baseline tightening is a routine commit; baseline weakening requires explicit approval (commit-message trailer or labelled PR) enforced by a new static gate. No tenant-visible workflow changes by default; tenants who opt in see human-paced input timing, proxy-aligned locale / timezone / WebRTC behaviour, and the same execution semantics they had before.

## Risk Surface

server/db/schema, server/routes, agent runtime, RLS migrations

## Assumptions

- Stock Playwright Chromium remains the canonical browser runtime; no fork is adopted.
- GeoIP providers are commodity infrastructure — architect picks managed vs embedded, but `proxyAlignmentService` owns the schema translation so swapping providers does not touch caller code.
- Warm browser pools already exist in `server/services/sandbox/browserWarmPool.ts`; alignment applies at task dispatch when a proxy is configured, and any session state mutated by alignment is reset before return to the pool (or the session is destroyed rather than recycled — architect picks).
- External detection sites are unstable dependencies; site removal / replacement / score-scheme change is harness maintenance, not product regression, unless our own benchmark workflows also regress.
- Tenant remains responsible for compliance with target-site ToS, rate limits, authentication boundaries, and applicable law. The platform provides reliability tooling.
- `worker/src/browser/executor.ts` and `playwrightContext.ts` are extensible action vocabulary + launch options surfaces (concurrent overlap with the `browser-vision-grounding` build is minor; this build lands first per the brief's concurrent safety note).
- Tier-1 CI runtime budget for the harness has not been measured; architect defines the per-PR cap and a separate nightly cap.

## Open Questions

- **Execution model for the harness** — live external execution every run vs cached replay fixtures vs internal mirror pages vs hybrid PR/nightly. Brief recommends cached on PR + live on nightly with diff alerts; architect ratifies.
- **Humanize surface shape** — per-call flag (`page.click(selector, { humanize: true })`) vs session-level `launchHumanized()` vs both. Brief leaves to architect.
- **Tiered humanize profiles** — `light` / `balanced` / `heavy` naming and exact latency budgets per profile. Brief states the shape; architect picks names + numbers.
- **GeoIP provider choice** — managed (paid API) vs embedded (MaxMind GeoLite2 local DB). Architect picks; vendor isolation invariant means the choice is reversible.
- **Warm-pool reset vs destroy** — when a proxy-aligned session returns to the pool, is alignment-mutated state reset in place or is the session destroyed and a fresh one minted? Architect picks the cheaper of the two.
- **CI harness cadence** — exact per-PR vs nightly split. Brief recommends cached PR + live nightly; architect ratifies and defines the budget cap.
- **Baseline ownership cadence** — quarterly review vs three-strikes-then-recalibrate. Brief offers both as a suggestion.
- **Telemetry event names** — exact event vocabulary (`browser.humanize.applied`, `browser.proxy.alignment.resolved` etc.) — architect picks and locks in the canonical telemetry registry.
- **End-to-end latency regression threshold for `humanize()`** — brief requires the architect to define this and have review reject beyond it.

## Duplication / Strategy Check

| Output | Value |
|---|---|
| Duplication assessment | clear |
| Strategic fit | clear |
| Recommendation | proceed |

Supplementary per-cluster rows (multi-cluster Affected Capability Area):

| Output | Value |
|---|---|
| Agent Runtime — Duplication | clear (closest match: `sandboxed-runtime-iee` (Growth) covers IEE substrate; this build adds behaviour primitives above it. In-flight `browser-vision-grounding` and `iee-browser-on-e2b` share file surfaces — `worker/src/browser/executor.ts`, `server/services/sandbox/browserWarmPool.ts` — but distinct outcomes. Brief sequences this build to land first.) |
| Agent Runtime — Strategic fit | clear (cluster has Mature `execution-infrastructure` and Growth `sandboxed-runtime-iee` / `persistent-agent-workspace` / `subscription-driven-long-task-execution` — all active states. Extends an active cluster with new reliability primitives.) |
| Audit & Governance — Duplication | clear (closest match: `trust-verification-layer` (Growth) covers skill verification + scorecards + operator correction. Detection-regression harness for browser-layer drift is a distinct outcome — verifies OUR stack against external sites, not skill quality.) |
| Audit & Governance — Strategic fit | clear (cluster has Mature `live-execution-log` and Growth `trust-verification-layer` / `dev-lifecycle-governance` — all active states.) |

Decision rationale: no Asset Register row or in-flight spec produces the three target outcomes (CI detection-regression gate, humanize input-timing primitive, GeoIP + WebRTC proxy alignment). File-level overlap with `browser-vision-grounding` and `iee-browser-on-e2b` is acknowledged in the brief's "Concurrent safety note" — sequenced to land this build first.

---

## Grill-me Q&A

Grill run 2026-05-18 by spec-coordinator inline. Termination: operator stated "go for it. I'll go with your recommendations" after Q2 — remaining decisions locked en bloc with recommended answers. All decisions binding for spec authoring.

### Q1 — File-inventory grounding fix (high-priority)

**Problem surfaced:** Brief's "Files in scope" references `worker/src/browser/executor.ts` and `worker/src/browser/playwrightContext.ts`. Both files no longer exist. PR #345 (`iee-worker-retirement`, merged 2026-05-17) deleted the entire `worker/` directory. PR #297 (`iee-browser-on-e2b`) redirected browser execution to e2b sandboxes. Current Playwright executor is a STUB at `infra/sandbox-templates/iee-browser/harness/index.ts` ("executor not yet wired" until e2b SDK lands).

**Recommended answer (accepted):** Land the three primitives at the e2b sandbox layer:
- `humanize()` input timing → integrated into `infra/sandbox-templates/iee-browser/harness/index.ts` as a wrapper around Playwright action calls. New deterministic seeded pure module e.g. `infra/sandbox-templates/iee-browser/harness/humanizeInputsPure.ts`.
- Proxy alignment → new `server/services/sandbox/proxyAlignmentService.ts` resolves proxy exit IP, translates to internal `{ timezone, locale, language }`, passed through e2b task envelope into harness which sets Chromium flags (`--lang`, `--timezone`, `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`) + `playwright.newContext({ locale, timezoneId, extraHTTPHeaders })`.
- Detection harness → CI suite at `server/tests/browser-detection-harness/` runs against real e2b sandbox using the same iee-browser template version. Baselines as JSON fixtures under `server/tests/browser-detection-harness/baselines/`.
- Warm-pool reset/destroy applies at the e2b warm-session layer (`server/services/sandbox/browserWarmPool.ts`).
- Brief's concurrent-safety note on `executor.ts` is MOOT (file gone). Real overlap with `browser-vision-grounding` is at the harness layer — still minor.

**Operator decision:** accept.

### Q2 — Phasing order within one build

**Recommended answer (accepted):** Three primitives ship in one build / one spec / one PR, phased across chunks:
1. Detection-test harness FIRST — CI-only, no runtime behaviour change, establishes regression baseline.
2. Proxy alignment SECOND — proxy-conditional opt-in, narrow user base, warm-pool reset semantics validated against real harness signal.
3. `humanize()` THIRD — broadest behavioural reach; detection harness gates its merge.

Each primitive carries its own feature flag (`detection-harness-gating`, `proxy-alignment`, `humanize`) — independently toggleable per brief's rollout posture.

**Operator decision:** accept. Explicit instruction: "do it all in this one development pass, just in different steps or phases if required."

### Q3 — Humanize API surface shape

**Recommended answer (locked):** BOTH per-call and session-level. Per-call form: `page.click(sel, { humanize: 'balanced', seed: 42 })`. Session-level default: `launchHumanized({ profile: 'balanced', seed: 42 })` sets default for all subsequent calls in that session. Per-call always overrides session-level. Mirrors Playwright's locator/strict-selector default-override pattern.

**Operator decision:** accept en bloc.

### Q4 — Tiered humanize profiles + per-profile latency budgets

**Recommended answer (locked):** Four-bucket policy: `off | light | balanced | heavy`.

| Profile | Per-action p99 latency budget |
|---|---|
| `off` | pass-through (no humanize) |
| `light` | <100 ms |
| `balanced` | <300 ms (default opt-in) |
| `heavy` | <750 ms |

Numbers are architect-tunable; the four-bucket shape and the documented-budget policy are binding. Profile budgets are validated by the harness against a synthetic action-replay benchmark.

**Operator decision:** accept en bloc.

### Q5 — GeoIP provider choice

**Recommended answer (locked):** Embedded — MaxMind GeoLite2 free DB (or equivalent open-source IP-to-geo DB) as a local file. Refreshed weekly via a pg-boss job. Vendor isolation invariant (`proxyAlignmentService` owns schema translation) means switching to a managed provider later requires no caller code changes. Zero external runtime dependency. Coarse precision (timezone/locale) is fine for the use case. Architect can flip to managed if production data shows accuracy gaps.

**Operator decision:** accept en bloc.

### Q6 — Warm-pool reset vs destroy

**Recommended answer (locked):** Destroy. Reset-in-place requires reverting every alignment-mutated Chromium flag, Accept-Language header, and WebRTC policy — easy to leak state. Destroy is simpler and provably correct. Cost: a fresh sandbox boot per proxy-aligned session. Mitigation: only proxy-aligned sessions pay the cost; standard sessions still benefit from warm-pool reuse. Reset-in-place is a post-V1 optimisation if cost becomes meaningful.

**Operator decision:** accept en bloc.

### Q7 — CI harness cadence (per-PR vs nightly)

**Recommended answer (locked):** Hybrid.
- **Per-PR blocking:** 5–10 most-stable detection sites against cached replay fixtures. <2 min runtime budget. Failure blocks merge.
- **Nightly advisory:** full 30-site suite against live external sites. <15 min runtime budget. Failure surfaces via Slack alert + commit comment; does not block existing PR CI.
- **Per-site flag:** `blocking | nightly | advisory | disabled`. Flaky sites move out of blocking tier without re-opening the spec; downgrade is logged.

**Operator decision:** accept en bloc.

### Q8 — Baseline ownership trigger

**Recommended answer (locked):** Three-strikes-without-code-change as primary trigger (three consecutive harness failures on the same site without any browser-layer code change → route to owner for recalibration). Quarterly health check as safety net (90 days no-failure → owner reviews).

**Operator decision:** accept en bloc.

### Q9 — Telemetry event names (canonical)

**Recommended answer (locked):**
- `browser.humanize.applied`
- `browser.humanize.skipped` (unsupported action fallback to standard path)
- `browser.proxy.alignment.resolved`
- `browser.proxy.alignment.failed`
- `browser.proxy.alignment.partial`
- `browser.detection.harness.run.completed`
- `browser.detection.harness.run.regression`
- `browser.detection.harness.baseline.updated`

All vocab neutral and reliability-framed. Registry entry lands in the canonical telemetry types file in the same chunk that emits the event.

**Operator decision:** accept en bloc.

### Q10 — Humanize end-to-end latency rejection threshold

**Recommended answer (locked):** +30% p95 latency over baseline on the architect-defined benchmark workflow is the rejection threshold for code review. Per-profile budgets (Q4) apply at the action level; this threshold applies at the workflow level. Architect picks the benchmark workflow at spec authoring.

**Operator decision:** accept en bloc.

### Q11 — Internal-staff harness-history UI

**Recommended answer (locked):** Defer. V1 ships CI alerts + a `harness_run_history` DB table that engineers can query directly. No dashboard UI in V1. Honours frontend-design principle (no internal observability UI on primary user journey; no admin dashboards until a real user workflow demands them). V2 backlog item if demand emerges.

**Operator decision:** accept en bloc.

### Q12 — Baseline weakening gate UX

**Recommended answer (locked):** Commit-message trailer — `Baseline-Weakening-Approved-By: <reviewer-handle>` required when any diff increases tolerance or lowers threshold on a baseline file under `server/tests/browser-detection-harness/baselines/`. Static gate `scripts/gates/verify-baseline-weakening-approval.sh` (follows established `verify-*.sh` convention) detects baseline diffs, scans commit history for the trailer, fails if missing. PR labels rejected (mutable post-merge, fragile).

**Operator decision:** accept en bloc.

### Q13 — Tenant-facing disclosure copy (locked)

- **Humanize (workflow config toggle):** "Human-paced input timing. When enabled, this workflow types and clicks with realistic human pauses. Slower per action; helps on sites that flag machine-speed automation."
- **Proxy alignment (informational, automatic):** "When you configure a proxy for this workflow, browser locale, timezone, and language are aligned with the proxy region by default. Override in workflow settings if needed."
- **Detection harness (internal-only banner, not tenant-facing):** "Synthetos browser-layer regression testing. Surfaces drift in detection-site scores when our stack changes."

All copy reliability-framed; no stealth/evade/cloak vocabulary. Architect can refine wording at spec authoring as long as positioning is preserved.

**Operator decision:** accept en bloc.

---

### Grill termination

Operator terminated grill after Q2 with "go for it. I'll go with your recommendations." Remaining decisions (Q3–Q13) locked en bloc with the recommended answers above. No re-run of Step 3a required — the locked decisions do not alter Problem Statement, Desired Outcome, Affected Capability Area, Non-Goals, Risk Surface, or Assumptions.

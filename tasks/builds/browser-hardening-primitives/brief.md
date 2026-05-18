# Brief — Browser hardening primitives (detection harness, humanize API, proxy-leak prevention)

**Status:** DRAFT v3 spec-ready (2026-05-18) — operator-evolved from v1 external repo capture
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `browser-hardening-primitives`
**Class:** Significant (three Standard sub-features bundled under one spec)
**Source pattern:** [CloakHQ/CloakBrowser](https://github.com/CloakHQ/CloakBrowser) (MIT, pattern lift only — Chromium fork NOT adopted)

## Problem

Our stock Playwright browser stack fails three classes of legitimate operator workflow:

1. **Anti-bot false positives.** Sites running Cloudflare Turnstile, FingerprintJS, or similar fingerprint-based detection occasionally block our Playwright workers even on legitimate scraping / form-filling / lead-enrichment tasks. We have no way to detect when our stack regresses on a previously-working site.
2. **Robotic input rhythm.** Our agent injects keystrokes and mouse moves at machine speed. Sites that watch for unnatural input rhythm flag the session, leading to soft-blocks (CAPTCHA challenges) or hard-blocks (account flagging).
3. **Proxy leak misconfig.** Tenants who configure a proxy for geo-targeted workflows often see "the proxy works but the site still knows my real location." The cause is usually timezone, locale, or WebRTC ICE candidates not aligned with the proxy exit IP.

CloakBrowser ships solutions to all three, but its Chromium-fork distribution model is wrong for us (we would inherit CVE-patching cadence, 200 MB binary per worker, single-org bus-factor risk, and brand association with CAPTCHA-bypass marketing). The three primitives, lifted into our stock Playwright stack, capture most of the operational reliability benefits without those costs.

## Goal

Add three independent primitives to our existing browser layer:
1. A detection-test harness as a CI regression gate.
2. A `humanize()` API as a behaviour primitive on browser actions.
3. GeoIP-driven timezone / locale auto-detection + WebRTC IP alignment for proxy sessions.

Each is opt-in or opt-out at the workflow / tenant level. Stock Playwright behaviour is unchanged by default.

## Product positioning

These primitives improve behavioural realism and configuration consistency for legitimate browser automation. They are **reliability and compatibility features, not anonymity or anti-detection tooling**.

The goal is reducing false-positive bot classification caused by unrealistic automation defaults, not defeating site security controls. Product copy, internal documentation, telemetry event names, and code comments must all reflect this positioning. If a reviewer can read a line of code or doc and reasonably interpret it as "stealth browser," rewrite it.

**Strategic note.** Modern anti-bot systems increasingly score long-session behavioural consistency rather than isolated browser fingerprints. Behavioural realism + configuration coherence (what this build delivers) is therefore more durable than fingerprint spoofing — sites that adopt session-level scoring will continue to flag spoofed fingerprints but tolerate consistent, plausible behaviour. This is the strategic reason for the chosen direction.

## Governance invariants

These are non-negotiable for the lifetime of the build:

1. Browser hardening primitives exist to improve reliability and reduce false positives on legitimate automation workloads, not to bypass security systems.
2. The platform MUST NOT impersonate specific devices, users, or commercial browser fingerprints.
3. The platform MUST NOT manipulate CAPTCHA scores, challenge outcomes, TLS fingerprints, or authentication trust signals.
4. All primitives MUST degrade gracefully and preserve standard Playwright execution semantics when disabled or unsupported.
5. Detection-harness baselines are advisory quality signals, not guarantees of undetectability.
6. Humanize behaviour MUST remain bounded and support seeded deterministic replay for debugging, testing, and incident reproduction. Given the same seed and the same action sequence, output must be reproducible.
7. GeoIP alignment MUST NOT silently override explicitly user-configured locale, timezone, or language preferences. User configuration always wins; alignment fills only when configuration is absent.
8. These primitives do not override tenant responsibility to comply with target-site terms of service, rate limits, authentication boundaries, or applicable law. The platform provides reliability tooling; the tenant remains responsible for how it is used.
9. The platform has no obligation to continuously defeat new detection systems. The harness exists to detect regressions in our own browser layer, not to pursue an anti-detection arms race. If a detection site evolves and starts flagging our sessions, the default response is to investigate whether OUR stack regressed — not to chase the detector.

## Compliance posture

This feature set IS intended for:

- QA automation
- Accessibility tooling
- Workflow automation
- Public web interaction
- Geo-localised testing
- Operator-assisted browsing

This feature set is NOT intended for:

- Credential abuse
- Account farming
- Fraud evasion
- Ban circumvention
- Access-control bypass

Tenant-facing surfaces (settings UI, docs, error messages) must reinforce the intended uses. The architect should consider whether any guardrail (rate limit, allowlist, telemetry signal) makes the unintended uses operationally harder without burdening the intended ones.

**Abuse escalation path.** If browser-hardening telemetry suggests credential abuse, account farming, fraud evasion, ban circumvention, or access-control bypass, the platform should surface this through the normal risk / abuse review pathway. This build does not introduce automated enforcement decisions (e.g. auto-suspending tenants) unless separately specified — escalation is "raise the signal," not "act on the signal."

## Proposed approach (for the architect to evaluate)

### Sub-feature 1: Detection-test harness

Lift CloakBrowser's 30-site test methodology into our CI. Each test:
1. Launches our standard Playwright browser stack.
2. Visits a detection-test site (BrowserScan, FingerprintJS, bot.incolumitas, deviceandbrowserinfo, and roughly 26 others).
3. Asserts the site's bot-detection score / flag against a baseline.
4. Fails CI if our score regresses.

Architect picks: which subset of sites to gate on (some are flaky and not worth blocking on), which run on every PR vs nightly, where the baseline lives, and the CI runtime budget cap.

**Execution model — architect to evaluate:** live external execution; cached replay fixtures; internal mirror pages; or a hybrid PR/nightly split (e.g. cached on PR, live nightly). Bias toward deterministic CI and low external dependency coupling — live-only-every-run will become flaky, slow, rate-limited, or legally awkward. Recommended default: cached fixtures on PR, live on nightly with diff alerts.

### Sub-feature 2: humanize() API

A wrapper around Playwright actions that swaps machine-speed inputs for human-paced equivalents:
- Mouse movement: straight-line trajectory replaced with Bezier-curve path, per-segment delays.
- Typing: instant per-character input replaced with per-character timing variance (mean 80 ms, stddev 30 ms; tunable).
- Scroll: instant jump replaced with momentum-curve scroll over N frames.

Surface: a single flag at the action call site (`page.click(selector, { humanize: true })` or equivalent), or a session-level default (`launchHumanized()`). Architect picks.

The API MUST support tiered policies (e.g. `light` / `balanced` / `heavy` or equivalent) so workflows can trade latency for plausibility. Default is plausibility, not indistinguishable human mimicry.

The API MUST accept a seed parameter (per session or per action call) so that humanized runs are reproducible — given the same seed and action sequence, mouse paths, typing intervals, and scroll curves emit identical values. This is required for incident reproduction and flaky-test debugging.

### Sub-feature 3: GeoIP + WebRTC alignment

When a tenant configures a proxy:
1. Resolve the proxy exit IP at session start.
2. Look up timezone, locale, language preference from the IP (using a lightweight GeoIP service; architect picks managed vs embedded).
3. Set Chromium launch flags: `--lang`, `--timezone`, and matching `Accept-Language` headers — only for fields the tenant has not explicitly configured.
4. Configure WebRTC to suppress ICE candidates leaking the real interface IP (Chromium flag `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`).

Surface: automatic when a proxy is configured; no per-workflow opt-in needed. Workflow-level override available for tenants who want the unaligned default (rare).

**Vendor isolation.** GeoIP providers are replaceable infrastructure dependencies. Provider-specific payload formats MUST NOT leak beyond the alignment boundary — `proxyAlignmentService` owns the schema translation, and callers see only the normalised internal shape (timezone, locale, language). Swapping providers must not touch caller code.

**Retention posture.** GeoIP-derived metadata is ephemeral session-scoped configuration, not durable tenant profiling data. It lives only as long as the session that consumed it, unless an explicit downstream feature later justifies persistence (which would require its own privacy review).

## Constraints / non-goals

- **DO NOT** adopt the CloakBrowser Chromium fork or any forked Chromium binary. Stock Playwright Chromium only.
- **DO NOT** adopt CloakBrowser's stealth / anti-detection marketing language anywhere in our product, docs, or commit messages.
- **DO NOT** implement CAPTCHA bypass, reCAPTCHA scoring manipulation, or any pattern that crosses the line from "behave reasonably" into "actively defeat security controls."
- **DO NOT** enable humanize() or GeoIP alignment by default for existing workflows. Opt-in (humanize) or proxy-conditional (GeoIP) only.
- **DO NOT** ship any sub-feature without it gracefully degrading. If GeoIP lookup fails, the session continues with defaults. If humanize() encounters an unsupported action, it falls back to the standard path.
- **DO NOT** train or import behavioural-cloning models on human cursor / typing telemetry.
- **DO NOT** ship dynamic fingerprint spoofing intended to impersonate specific consumer hardware profiles.
- **DO NOT** integrate AI-generated anti-fraud evasion strategies (e.g. an LLM that chooses input rhythm to dodge a specific detector).
- **DO NOT** use stealth-framed names for modules, classes, functions, flags, telemetry events, or config keys. Forbidden vocabulary includes (but is not limited to): `stealth`, `evade`, `bypassDetection`, `antiFingerprint`, `undetectedBrowser`, `cloak`, `ghost`. Naming drift starts in helpers and propagates outward — block it at the source. Neutral reliability-framed names only (e.g. `humanizeInputs`, `proxyAlignmentService`, `detectionRegressionHarness`).

## Performance guardrails

- Humanization overhead MUST remain bounded and configurable per session.
- Session-level humanization policies MUST support tiered profiles (`light` / `balanced` / `heavy` or equivalent), each with documented expected latency overhead.
- Default profile targets plausibility, not indistinguishable human mimicry. Workflows opt into heavier profiles when needed.
- Detection harness CI runtime budget MUST remain capped (architect defines the threshold; suggest a per-PR cap and a separate nightly cap).
- Architect MUST define a regression threshold for end-to-end workflow latency caused by humanize() — beyond that threshold, the change is rejected at review.

## Observability requirements

- Humanized actions emit telemetry markers distinguishing them from standard actions, so post-hoc analysis can attribute slowdowns or behaviour to the primitive.
- Proxy-aligned sessions record derived locale / timezone decisions and whether alignment succeeded, failed, or partially degraded.
- Detection-harness runs persist historical scores so regression trends are visible over time, not only at the moment of failure.
- No raw proxy credentials, IPs, or GeoIP provider payloads are written to logs. Hashed or coarse-grained identifiers only.
- Telemetry event names use neutral, reliability-framed vocabulary (e.g. `browser.humanize.applied`, `browser.proxy.alignment.resolved`) — not stealth-framed.
- Harness history stores site name, run metadata, browser / runtime version, and normalised score only. It MUST NOT store screenshots, page HTML, cookies, headers, or challenge tokens unless separately approved for debugging with an explicit retention limit.

## Runtime isolation invariant

Warm browser pools MUST NOT leak locale, timezone, language, WebRTC, or proxy-derived state between tenants or sessions. Warm sessions are alignment-agnostic at pool entry; alignment applies at task dispatch when a proxy is configured, and any session state mutated by alignment MUST be reset before the session returns to the pool — or the session is destroyed rather than recycled. The architect picks the cheaper of the two and documents the choice in the spec.

## Operational ownership

- Detection-site baselines drift over time and require periodic recalibration. Define an owner and cadence (suggest: a quarterly review, or whenever the harness fails three times in a row on the same site without a code change).
- Browser-version upgrades (Playwright bumps, Chromium bumps) MUST run the harness before merge.
- Flaky detection sites may be downgraded from merge-blocking to advisory / nightly status without re-opening the spec — but the downgrade is logged.
- The harness is a regression detector, not a pass/fail proof of browser legitimacy. The spec must say this in plain language, so a future operator does not over-interpret a green run as a safety guarantee.
- **Baseline change approval.** Tightening a baseline (making the gate stricter) can be a routine commit. Weakening a baseline (relaxing the gate so previously-failing scores now pass) requires explicit approval and a logged rationale in the change — silent baseline weakening is a policy violation.
- **Third-party dependency posture.** External detection sites are unstable dependencies. Site removal, replacement, downgrade, or score-scheme change must be treated as **harness maintenance**, not product regression — unless our own benchmark workflows also regress, in which case it's a real signal.

## Browser support scope

V1 targets Playwright Chromium only. Firefox / WebKit parity is explicitly deferred unless later justified by workflow demand. The architect should ensure no Chromium-only assumption (launch flags, fingerprint surface, WebRTC flag names) leaks into a layer that would be expensive to re-shape for other browsers later — but is not required to actually implement parity.

## Rollout posture

This build touches browser execution behaviour for every workflow, so rollback agility matters:

- Feature-flagged rollout per primitive (`humanize`, `proxy-alignment`, `detection-harness-gating`) — each independently toggleable.
- Internal-only enablement first; benchmark workflows pass before any tenant exposure.
- Gradual tenant enablement (architect picks: per-tenant allowlist, percentage rollout, or opt-in workflow flag).
- Ability to globally disable any primitive without code change, via runtime config.
- A documented rollback path for each primitive — what gets reverted, how long it takes, and what signals trigger it.
- **Tenant-facing disclosure.** Any tenant-facing control (settings UI, workflow toggle, API field) explains what the primitive changes in plain language — e.g. "human-paced input timing", "proxy locale alignment", "browser detection regression testing". Avoid vague labels that imply invisibility, undetectability, or stealth.

## Files in scope (architect locks at spec authoring)

- New CI test file: `server/tests/browser-detection-harness/` (suite of detection-site tests)
- New CI workflow: `.github/workflows/browser-detection-harness.yml` (gated PR or nightly cadence per architect's call)
- New module: `server/services/sandbox/humanizeInputs.ts` (humanize() implementation)
- `worker/src/browser/executor.ts` — extend action vocabulary to accept the humanize flag
- `worker/src/browser/playwrightContext.ts` — extend launch options to accept GeoIP alignment config
- New service: `server/services/sandbox/proxyAlignmentService.ts` (GeoIP lookup + Chromium flag assembly)
- `server/services/sandbox/browserWarmPool.ts` — warm sessions are alignment-agnostic; alignment applies at task dispatch when proxy is configured; pool reset/destroy logic per the runtime isolation invariant
- Telemetry: new event types in the canonical telemetry registry, neutral naming
- Tests: pure functions for input timing curves, GeoIP-to-launch-flags translation, harness baseline parsing, pool state-reset behaviour
- New static gate: `scripts/verify-baseline-weakening-approval.sh` (or equivalent under `scripts/gates/`) — follows the established repo pattern (~90 `verify-*.sh` gates already in `scripts/`). Architect to decide detection mechanism: detect diffs that increase the numeric tolerance / lower the threshold on any harness baseline file under `server/tests/browser-detection-harness/baselines/`, and require an explicit approval marker (commit-message trailer, e.g. `Baseline-Weakening-Approved-By: <reviewer>`, or a labelled PR). Tightening passes silently; weakening fails the gate without the marker.

## Out of scope

- The CloakBrowser Chromium fork itself
- Per-tenant fingerprint randomisation (different canvas / WebGL / audio fingerprints per session)
- Residential proxy procurement (tenants bring their own)
- CAPTCHA solving (out of scope as a product capability)
- A user-facing "stealth mode" toggle in tenant settings
- TLS fingerprint manipulation (JA3, JA4 spoofing)
- HTTP/2 / HTTP/3 fingerprint manipulation
- Account-pool management for sites requiring multi-account access
- Behavioural-cloning ML models, dynamic hardware-profile spoofing, AI-driven evasion (also listed in Constraints — repeated here because future scope creep typically reaches for these first)

## Success criteria

1. **Reliability lift, bounded abuse surface.** Browser automation reliability measurably improves on a curated benchmark of workflows (architect defines the benchmark and the headline metric — e.g. reduced CAPTCHA challenge frequency, reduced soft-block rate, improved scripted-flow completion rate) without materially increasing abuse capability per the governance invariants.
2. **Drift surfaced automatically.** Detection regressions caused by Playwright or browser-layer upgrades are surfaced through CI / nightly benchmarking, with historical score persistence so trends are visible.
3. **Humanize is bounded and reproducible.** humanize() improves interaction plausibility on benchmark sites while preserving (a) reproducibility for debugging / replay, (b) bounded latency within the documented profile budget, and (c) deterministic fallback when an action is unsupported.
4. **Proxy coherence.** Proxy-configured sessions exhibit coherent locale, timezone, language, and WebRTC behaviour aligned to the proxy exit region — verified against browser fingerprint sites with a proxy configured — without overriding tenant-specified preferences.
5. **No silent regression on existing workflows.** Existing workflows remain backward-compatible and behaviourally unchanged unless explicitly opted into hardening primitives. Pool sessions do not leak alignment state between tenants.
6. **Positioning preserved.** Product copy, documentation, telemetry vocabulary, and runtime semantics remain aligned with "reliability hardening" framing rather than "stealth browser" framing. CTO security review confirms no red flag on positioning.

**Acceptance independence (spec-author instruction).** Because this brief bundles three sub-features, the spec MUST define independent acceptance gates for (a) detection harness, (b) humanize(), and (c) proxy alignment — so one primitive can ship, roll back, or pause without forcing the others. A single combined acceptance path that requires all three to land together is rejected at spec review.

## What unblocks when this ships

- Lead-enrichment, form-filling, and public-data-scraping workflows succeed on a wider set of sites without per-site babysitting.
- Tenants with geo-restricted use cases (regional pricing checks, locale-specific QA) actually get the geo behaviour they configured.
- We have a CI regression signal whenever a Playwright upgrade or our own browser-layer change breaks detection-site behaviour.
- The humanize() primitive becomes reusable for any future browser-using feature (Personal Assistant browser tasks, ClientPulse polling).

## Concurrent safety note

Minor overlap with `browser-vision-grounding` in `worker/src/browser/executor.ts` (both extend action vocabulary) and possibly `server/services/sandbox/browserWarmPool.ts`. Recommend this build lands first (smaller, lower-level primitives), then `browser-vision-grounding` adds the decision layer above. If concurrent, expect minor merge cleanup in `executor.ts`. Isolated from `memory-tiered-consolidation` and `task-preview-mode`.

Per the runtime isolation invariant, the warm-pool changes here set the contract that `browser-vision-grounding` must honour — vision grounding cannot bypass pool state reset.

## Provenance

External repo deep-dive 2026-05-17 surfaced CloakBrowser patterns from the weekly trend roundup. Operator-ratified: pattern lift only, NO Chromium fork, NO stealth language adoption (Sheets row 4, column D records the decision). Brief v2 pass 1 (2026-05-18) added governance invariants, product positioning, compliance posture, performance guardrails, observability requirements, runtime isolation invariant, operational ownership, and rewrote success criteria as measurable outcomes. Brief v2 pass 2 (2026-05-18) added: ToS-respect invariant (#8), seeded-replay requirement for humanize() (invariant #6 + sub-feature 2), detection-harness execution-model architect note, GeoIP vendor-isolation + retention posture, neutral-naming forbidden vocabulary in constraints, Browser support scope (Chromium-only V1), Rollout posture with per-primitive feature flags, strategic note on long-session behavioural scoring, and tightened "80% of upside" wording. Brief v2 pass 3 (2026-05-18) added: anti-arms-race invariant (#9), abuse escalation path (Compliance posture), harness-history retention boundary (Observability), baseline-change approval + third-party dependency posture (Operational ownership), tenant-facing disclosure rule (Rollout posture), and acceptance-independence spec-author instruction (Success criteria). Brief promoted to v3 spec-ready (2026-05-18) with `verify-baseline-weakening-approval` static gate suggestion added to Files in scope (follows the established `scripts/verify-*.sh` repo convention).

## How to start (paste into a new Claude Code session)

```
launch spec-coordinator from tasks/builds/browser-hardening-primitives/brief.md
```

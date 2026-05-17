# Brief — Browser hardening primitives (detection harness, humanize API, proxy-leak prevention)

**Status:** DRAFT v1 (2026-05-17) — operator-captured from external repo analysis
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `browser-hardening-primitives`
**Class:** Significant (three Standard sub-features bundled under one spec)
**Source pattern:** [CloakHQ/CloakBrowser](https://github.com/CloakHQ/CloakBrowser) (MIT, pattern lift only — Chromium fork NOT adopted)

## Problem

Our stock Playwright browser stack fails three classes of legitimate operator workflow:

1. **Anti-bot false positives.** Sites running Cloudflare Turnstile, FingerprintJS, or similar fingerprint-based detection occasionally block our Playwright workers even on legitimate scraping / form-filling / lead-enrichment tasks. We have no way to detect when our stack regresses on a previously-working site.
2. **Robotic input rhythm.** Our agent injects keystrokes and mouse moves at machine speed. Sites that watch for unnatural input rhythm flag the session, leading to soft-blocks (CAPTCHA challenges) or hard-blocks (account flagging).
3. **Proxy leak misconfig.** Tenants who configure a proxy for geo-targeted workflows often see "the proxy works but the site still knows my real location." The cause is usually timezone, locale, or WebRTC ICE candidates not aligned with the proxy exit IP.

CloakBrowser ships solutions to all three, but its Chromium-fork distribution model is wrong for us (we would inherit CVE-patching cadence, 200 MB binary per worker, single-org bus-factor risk, and brand association with CAPTCHA-bypass marketing). The three primitives, lifted into our stock Playwright stack, give 80% of the upside without those costs.

## Goal

Add three independent primitives to our existing browser layer:
1. A detection-test harness as a CI regression gate.
2. A `humanize()` API as a behaviour primitive on browser actions.
3. GeoIP-driven timezone / locale auto-detection + WebRTC IP alignment for proxy sessions.

Each is opt-in or opt-out at the workflow / tenant level. Stock Playwright behaviour is unchanged by default.

## Proposed approach (for the architect to evaluate)

### Sub-feature 1: Detection-test harness

Lift CloakBrowser's 30-site test methodology into our CI. Each test:
1. Launches our standard Playwright browser stack.
2. Visits a detection-test site (BrowserScan, FingerprintJS, bot.incolumitas, deviceandbrowserinfo, and roughly 26 others).
3. Asserts the site's bot-detection score / flag against a baseline.
4. Fails CI if our score regresses.

Architect picks: which subset of sites to gate on (some are flaky and not worth blocking on), which run on every PR vs nightly, and where the baseline lives.

### Sub-feature 2: humanize() API

A wrapper around Playwright actions that swaps machine-speed inputs for human-paced equivalents:
- Mouse movement: straight-line trajectory replaced with Bezier-curve path, per-segment delays.
- Typing: instant per-character input replaced with per-character timing variance (mean 80 ms, stddev 30 ms; tunable).
- Scroll: instant jump replaced with momentum-curve scroll over N frames.

Surface: a single flag at the action call site (`page.click(selector, { humanize: true })` or equivalent), or a session-level default (`launchHumanized()`). Architect picks.

### Sub-feature 3: GeoIP + WebRTC alignment

When a tenant configures a proxy:
1. Resolve the proxy exit IP at session start.
2. Look up timezone, locale, language preference from the IP (using a lightweight GeoIP service; architect picks managed vs embedded).
3. Set Chromium launch flags: `--lang`, `--timezone`, and matching `Accept-Language` headers.
4. Configure WebRTC to suppress ICE candidates leaking the real interface IP (Chromium flag `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`).

Surface: automatic when a proxy is configured; no per-workflow opt-in needed. Workflow-level override available for tenants who want the unaligned default (rare).

## Constraints / non-goals

- **DO NOT** adopt the CloakBrowser Chromium fork or any forked Chromium binary. Stock Playwright Chromium only.
- **DO NOT** adopt CloakBrowser's stealth / anti-detection marketing language anywhere in our product, docs, or commit messages.
- **DO NOT** implement CAPTCHA bypass, reCAPTCHA scoring manipulation, or any pattern that crosses the line from "behave reasonably" into "actively defeat security controls."
- **DO NOT** enable humanize() or GeoIP alignment by default for existing workflows. Opt-in (humanize) or proxy-conditional (GeoIP) only.
- **DO NOT** ship any sub-feature without it gracefully degrading. If GeoIP lookup fails, the session continues with defaults. If humanize() encounters an unsupported action, it falls back to the standard path.

## Files in scope (architect locks at spec authoring)

- New CI test file: `server/tests/browser-detection-harness/` (suite of detection-site tests)
- New CI workflow: `.github/workflows/browser-detection-harness.yml` (gated PR or nightly cadence per architect's call)
- New module: `server/services/sandbox/humanizeInputs.ts` (humanize() implementation)
- `worker/src/browser/executor.ts` — extend action vocabulary to accept the humanize flag
- `worker/src/browser/playwrightContext.ts` — extend launch options to accept GeoIP alignment config
- New service: `server/services/sandbox/proxyAlignmentService.ts` (GeoIP lookup + Chromium flag assembly)
- `server/services/sandbox/browserWarmPool.ts` — warm sessions are alignment-agnostic; alignment applies at task dispatch when proxy is configured
- Tests: pure functions for input timing curves, GeoIP-to-launch-flags translation, harness baseline parsing

## Out of scope

- The CloakBrowser Chromium fork itself
- Per-tenant fingerprint randomisation (different canvas / WebGL / audio fingerprints per session)
- Residential proxy procurement (tenants bring their own)
- CAPTCHA solving (out of scope as a product capability)
- A user-facing "stealth mode" toggle in tenant settings
- TLS fingerprint manipulation (JA3, JA4 spoofing)
- HTTP/2 / HTTP/3 fingerprint manipulation
- Account-pool management for sites requiring multi-account access

## Success criteria

1. The detection harness gates CI on at least 10 detection sites with a defined baseline; regressions on those sites block PR merges.
2. humanize() reduces machine-rhythm flagging on a curated test set of 5 sites (architect defines the set; success = sites that flag without humanize() do not flag with it).
3. GeoIP alignment eliminates timezone / locale / WebRTC IP leaks on a manual proxy test (verified against browser fingerprint sites with proxy configured).
4. Existing workflows show zero regression — opt-in primitives stay off by default, proxy alignment activates only when a proxy is configured.
5. No security-review red flag from the CTO on positioning: nothing in the codebase or docs reads as "stealth browser" or "anti-detection."

## What unblocks when this ships

- Lead-enrichment, form-filling, and public-data-scraping workflows succeed on a wider set of sites without per-site babysitting.
- Tenants with geo-restricted use cases (regional pricing checks, locale-specific QA) actually get the geo behaviour they configured.
- We have a CI regression signal whenever a Playwright upgrade or our own browser-layer change breaks detection-site behaviour.
- The humanize() primitive becomes reusable for any future browser-using feature (Personal Assistant browser tasks, ClientPulse polling).

## Concurrent safety note

Minor overlap with `browser-vision-grounding` in `worker/src/browser/executor.ts` (both extend action vocabulary) and possibly `server/services/sandbox/browserWarmPool.ts`. Recommend this build lands first (smaller, lower-level primitives), then `browser-vision-grounding` adds the decision layer above. If concurrent, expect minor merge cleanup in `executor.ts`. Isolated from `memory-tiered-consolidation` and `task-preview-mode`.

## Provenance

External repo deep-dive 2026-05-17 surfaced CloakBrowser patterns from the weekly trend roundup. Operator-ratified: pattern lift only, NO Chromium fork, NO stealth language adoption (Sheets row 4, column D records the decision).

## How to start (paste into a new Claude Code session)

```
launch spec-coordinator from tasks/builds/browser-hardening-primitives/brief.md
```

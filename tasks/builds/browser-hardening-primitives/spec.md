# Spec — Browser hardening primitives (detection harness, humanize API, proxy alignment)

**Status:** accepted
**Spec date:** 2026-05-18
**Last updated:** 2026-05-18 (chatgpt-spec-review R3 — locked)
**Author:** spec-coordinator (inline, this session)
**Build slug:** browser-hardening-primitives

---

## Lifecycle Declaration

| Field | Value |
|---|---|
| Capability cluster | Agent Runtime, Audit & Governance |
| Capability owner | platform (placeholder — re-resolves at first review) |
| Lifecycle state on launch | Inception |
| Risk surface | server/db/schema, server/routes, agent runtime, RLS migrations |
| Review cadence | quarterly, plus three-strikes-then-recalibrate trigger for baseline drift |

---

## ABCd Lifecycle Estimate

| Dimension | Sizing | Notes |
|---|---|---|
| Acquire | L | Externally-licensable equivalents (commercial stealth-browser SaaS, managed Playwright cloud) are expensive ongoing subscriptions with vendor lock-in. Embedded primitives are the cheaper acquire path. |
| Build | M | Three sub-features bundled. Detection harness is the largest cost driver (CI infra + 30-site baseline + per-site stability vetting). Humanize and proxy alignment are pure modules plus thin glue. |
| Carry | M | Detection-site baseline drift (three-strikes-or-quarterly cadence), GeoIP DB weekly refresh, Playwright bump regression checks. Documented owners; no on-call burden. |
| decommission | S | Three feature flags toggle off; templates/files removable without schema migration. Telemetry stream retires with normal deprecation. |

---

## Table of contents

1. Goals
2. Non-goals
3. Framing assumptions
4. Phase plan
5. File inventory lock
6. Contracts
7. Permissions / RLS checklist
8. Execution model
9. Phase sequencing (dependency graph)
10. Execution-safety contracts
11. Testing posture
12. Telemetry registry (locked vocabulary)
13. Rollout posture
14. Operational ownership
15. Tenant-facing UI surfaces
16. Deferred items
17. Open questions (for architect)
18. Self-consistency pass result
19. Acceptance criteria
20. Migration / cross-cutting notes

Appendix — Provenance

---

## 1. Goals

1. **Detection-test harness.** Lift CloakBrowser's 30-site test methodology into our CI. Per-PR runs hit cached replay fixtures for a small stable subset (5–10 sites); they are blocking-capable from day one but ship in advisory mode initially and flip to blocking per site only after two consecutive nightly runs show a stable baseline (see §13 rollout posture). Nightly runs hit live external sites for the full 30-site suite as advisory signal. Historical scores persist so regression trends are visible over time.
2. **`humanize()` API.** Provide a behaviour primitive on browser actions that swaps machine-speed inputs for human-paced equivalents (Bezier mouse curves, per-character typing variance, momentum scroll). Four-bucket profile policy (off / `light` / `balanced` / `heavy`, where off is represented by a `null` persisted config — see §6.2); workflow-level opt-in (one `humanize` config per workflow, applied to every action in that workflow's session); seeded deterministic replay; graceful fallback when an action is unsupported.
3. **Proxy alignment.** When a tenant has a proxy configured, auto-detect timezone, locale, and language from the proxy exit IP via an embedded GeoIP DB, set the matching Chromium launch flags, configure WebRTC to suppress non-proxied UDP — but never override tenant-configured fields. Warm-pool sessions are alignment-agnostic at pool entry; alignment applies at task dispatch; the session is destroyed (not reset) before returning to the pool.

All three ship in one build / one spec / one PR, phased across chunks. Each carries its own feature flag and is independently toggleable. Stock Playwright behaviour is unchanged by default.

## 2. Non-goals

- Adopting the CloakBrowser Chromium fork or any forked Chromium binary.
- CAPTCHA solving, reCAPTCHA scoring manipulation, TLS / JA3 / JA4 fingerprint manipulation, HTTP/2 or HTTP/3 fingerprint manipulation.
- Per-tenant fingerprint randomisation (canvas / WebGL / audio variance) or dynamic hardware-profile spoofing.
- Behavioural-cloning ML models or AI-driven evasion that picks input rhythm to dodge a specific detector.
- Residential proxy procurement (tenants bring their own).
- A user-facing "stealth mode" toggle or any stealth-framed product surface, including in module names, classes, functions, flags, telemetry events, or config keys.
- Account-pool management for sites requiring multi-account access.
- Continuously defeating new detection systems (the harness detects regressions in OUR stack; it does not pursue an anti-detection arms race).
- Firefox / WebKit parity (V1 is Chromium-only; deferred until workflow demand justifies it).
- Tenant-facing harness-history dashboard UI (defer; CI alerts + DB table sufficient for V1).
- Reset-in-place warm-pool sessions for proxy-aligned tasks (defer; destroy-and-recreate is the V1 choice).

## 3. Framing assumptions

Per `docs/spec-context.md` (deployment context: pre-production, rapid evolution, static gates primary). Departures from framing flagged explicitly below.

- Stock Playwright Chromium remains the canonical browser runtime; no fork is adopted.
- Browser execution lives inside e2b sandboxes (post-PR #297 `iee-browser-on-e2b` substrate migration). The Playwright executor is currently a stub at `infra/sandbox-templates/iee-browser/harness/index.ts`; this build assumes the real executor will be wired in by the iee-browser template build pipeline when the e2b SDK is installed. All harness-layer primitives in this spec ship as **harness modules** that the real executor consumes; they exercise their pure-module surface immediately (deterministic seeded curves, pure flag-assembly logic) and integrate behind the stub boundary.
- `server/services/sandbox/browserWarmPool.ts` exists and manages warm e2b sandbox sessions; alignment applies at task dispatch when a proxy is configured.
- GeoIP providers are commodity infrastructure; the embedded MaxMind GeoLite2 DB ships as a local file, refreshed weekly. `proxyAlignmentService` owns schema translation so swapping providers does not touch caller code.
- External detection sites are unstable dependencies. Site removal / replacement / score-scheme change is harness maintenance, not product regression, unless our own benchmark workflows also regress.
- Tenants remain responsible for compliance with target-site ToS, rate limits, authentication boundaries, and applicable law. The platform provides reliability tooling.
- Pure-function tests only per repo testing posture; no E2E / frontend / API-contract tests added for this build. Detection harness IS a runtime test, but it tests an EXTERNAL surface (the rendered browser fingerprint), not our own app — distinct from the "no E2E of own app" framing rule. Documented as an explicit departure if `spec-reviewer` flags it.

## 4. Phase plan

Three chunks, phased by risk (lowest to highest). All chunks ship under one branch / one PR.

### 4.1 Phase 1 — Detection-test harness

Lowest blast radius. CI-only. No runtime behaviour change. Establishes the regression baseline before any behaviour change lands.

**Outputs:**
- `server/tests/browser-detection-harness/` test suite (per-site test file)
- `server/tests/browser-detection-harness/baselines/` JSON fixtures (one per site)
- `server/tests/browser-detection-harness/fixtures/` cached replay HTML (one per per-PR site)
- `.github/workflows/browser-detection-harness.yml` CI workflow (per-PR blocking + nightly advisory split)
- New table `harness_run_history` (system-scoped, not tenant-scoped) + migration
- `scripts/gates/verify-baseline-weakening-approval.sh` — static gate, scans commit history for `Baseline-Weakening-Approved-By:` trailer when baseline diffs widen tolerance / lower threshold
- Telemetry: `browser.detection.harness.run.completed`, `browser.detection.harness.run.regression`, `browser.detection.harness.baseline.updated`

**Independent feature flag:** `detection-harness-gating` (toggles whether per-PR harness failures block merge or warn only).

### 4.2 Phase 2 — Proxy alignment

Proxy-conditional opt-in. Narrow user base (only tenants with a configured proxy). Warm-pool reset semantics validated against the now-live detection harness.

**Outputs:**
- `server/services/sandbox/proxyAlignmentService.ts` — GeoIP lookup + Chromium flag assembly + WebRTC config
- `server/services/sandbox/proxyAlignmentServicePure.ts` — pure module: IP → `{ timezone, locale, language }` translation, vendor-isolation boundary
- `infra/geoip/` — embedded GeoLite2 DB + weekly refresh `geoipDbRefreshJob.ts` (pg-boss)
- `server/services/sandbox/browserWarmPool.ts` — extended with destroy-on-alignment-mutation semantics
- e2b task envelope extension carrying `{ timezone, locale, language, webrtcPolicy }` into the harness
- `infra/sandbox-templates/iee-browser/harness/index.ts` — applies envelope fields via Playwright `newContext({ locale, timezoneId, extraHTTPHeaders: { 'Accept-Language': language } })` + Chromium launch flags (`--lang`, `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`). Timezone is applied through Playwright context (`timezoneId`), not a Chromium launch flag.
- Telemetry: `browser.proxy.alignment.resolved`, `browser.proxy.alignment.failed`, `browser.proxy.alignment.partial`

**Independent feature flag:** `proxy-alignment` (toggles whether alignment auto-applies when a proxy is configured).

### 4.3 Phase 3 — humanize() API

Broadest behavioural reach. Workflow-level opt-in. Detection harness from Phase 1 gates the merge — humanize must not regress detection scores on the per-PR site subset.

**Outputs:**
- `infra/sandbox-templates/iee-browser/harness/humanizeInputsPure.ts` — pure module: Bezier mouse-path curves, per-character typing intervals, scroll momentum curves; all deterministic from seed + action sequence
- `infra/sandbox-templates/iee-browser/harness/humanizeInputs.ts` — consumer-side wrapper; integrates with Playwright action calls in the harness
- E2B task envelope extension carrying `{ humanize: { profile, seed } | null }`
- `shared/types/humanize.ts` — `HumanizeProfile = 'light' | 'balanced' | 'heavy'`, `HumanizeOptions = { profile: HumanizeProfile, seed: number }`, `PersistedHumanize = HumanizeOptions | null` (the workflow column shape; null = off)
- Per-workflow humanize persistence (location depends on §5.2 architect-pick path: per-template column, per-run column, or code-level `defineWorkflow()` field). Persisted shape: nullable, default `null`. `null` means "off / standard Playwright behaviour"; non-null `{ profile, seed }` activates humanize. The string `'off'` is never persisted — absence (null) is the canonical "off" representation. Under path (c) the "persistence" is the workflow code definition itself; under paths (a)/(b) it's a JSONB column.
- `client/src/components/HumanizeToggle.tsx` — workflow config UI (single dropdown + seed input behind Advanced expander), rendered from the existing `WorkflowStudioPage.tsx`
- Telemetry: `browser.humanize.applied`, `browser.humanize.skipped`

**Independent feature flag:** `humanize` (toggles whether the workflow-level field is read at task dispatch).

## 5. File inventory lock

Every file the spec touches. Drift = blocking review finding. Migration numbers placeholder-allocated; architect renumbers to next-free at build time.

### 5.1 New files

| Path | Purpose | Phase |
|---|---|---|
| `server/tests/browser-detection-harness/runHarness.ts` | Entrypoint that boots an e2b sandbox, runs each enabled site test, writes results | 1 |
| `server/tests/browser-detection-harness/sites/<site-slug>.test.ts` | One per detection site (5–10 per-PR + ~20 nightly); each exports `{ slug, mode: 'blocking'\|'nightly'\|'advisory'\|'disabled', test: async (page) => score }` | 1 |
| `server/tests/browser-detection-harness/baselines/<site-slug>.baseline.json` | Per-site baseline score + tolerance | 1 |
| `server/tests/browser-detection-harness/fixtures/<site-slug>.html` | Cached replay HTML for per-PR sites | 1 |
| `server/tests/browser-detection-harness/harnessHistoryWriter.ts` | Persists per-run scores to `harness_run_history` | 1 |
| `server/tests/browser-detection-harness/harnessHistoryWriterPure.ts` | Pure normalisation of run result → DB row shape | 1 |
| `.github/workflows/browser-detection-harness.yml` | CI workflow; per-PR blocking job (cached fixtures, <2 min budget) + nightly advisory cron (live sites, <15 min budget) + **path-filter trigger that runs the FULL nightly-style harness on any PR that touches `package-lock.json`, `package.json`, or the Playwright dependency line** (per §14 Playwright-bump operational ownership). **Invokes `scripts/gates/verify-baseline-weakening-approval.sh` as a pre-step on the per-PR job** so a baseline-tolerance diff without the required commit trailer fails before any harness run executes. | 1 |
| `scripts/gates/verify-baseline-weakening-approval.sh` | Static gate: detects (a) baseline-file diffs that widen tolerance / lower threshold AND (b) per-site `mode` field downgrades (`blocking → nightly`, `blocking → advisory`, `blocking → disabled`, `nightly → advisory`, `nightly → disabled`, `advisory → disabled`). Both classes scan commit history for `Baseline-Weakening-Approved-By:` trailer; fail when missing. Mode upgrades (e.g. `advisory → blocking`) pass silently. Invoked from the per-PR CI workflow per the row above and runnable as a standalone gate. | 1 |
| `server/services/sandbox/proxyAlignmentService.ts` | GeoIP lookup, schema translation to `{ timezone, locale, language }`, Chromium launch-flag assembly | 2 |
| `server/services/sandbox/proxyAlignmentServicePure.ts` | Pure IP-to-geo translation, flag-assembly logic | 2 |
| `infra/geoip/geolite2-city.mmdb` | **Bundled fallback** MaxMind GeoLite2 City DB (binary; checked into repo for first-boot / offline fallback). The runtime DB lives at the env-configured path `process.env.GEOIP_RUNTIME_DIR / geolite2-city.mmdb` (default `/var/lib/synthetos/geoip/geolite2-city.mmdb`, architect overrides per environment). `proxyAlignmentService` reads from runtime path if it exists and is newer than the bundled fallback; otherwise falls back to the bundled copy. The pg-boss refresh job writes to runtime path only (never modifies the repo file). | 2 |
| `infra/geoip/LICENSE.txt` | MaxMind GeoLite2 attribution per their licence terms | 2 |
| `server/jobs/geoipDbRefreshJob.ts` | pg-boss weekly job: fetch latest GeoLite2 DB, validate, atomic swap | 2 |
| `infra/sandbox-templates/iee-browser/harness/humanizeInputsPure.ts` | Pure module: seeded Bezier curves, typing intervals, scroll momentum | 3 |
| `infra/sandbox-templates/iee-browser/harness/humanizeInputs.ts` | Consumer-side wrapper around Playwright action calls | 3 |
| `shared/types/humanize.ts` | `HumanizeProfile`, `HumanizeOptions` types | 3 |
| `shared/types/proxyAlignment.ts` | `ProxyAlignment = { timezone, locale, language, webrtcPolicy } \| null` envelope shape | 2 |
| `client/src/components/HumanizeToggle.tsx` (new top-level component, consumed from the existing `WorkflowStudioPage.tsx` workflow-edit page; the page is modified to render the toggle within its existing Advanced expander surface) | Workflow config UI (dropdown + Advanced expander for seed). If the architect picks code-level path (c) for humanize persistence in §5.2, this UI is not built in V1 — the field is set in code per-workflow and the run-trigger UI does not expose it. | 3 |
| `client/src/lib/copy/browserHardening.ts` | Tenant-facing disclosure copy strings (Q13 vocabulary locked) | 2, 3 |
| `server/db/schema/harnessRunHistory.ts` | New Drizzle schema for `harness_run_history` table (system-scoped, not tenant-scoped — does not appear in `RLS_PROTECTED_TABLES`) | 1 |
| `server/tests/browser-detection-harness/__tests__/harnessHistoryWriterPure.test.ts` | Pure-function tests for `HarnessRunResult` → DB row shape normalisation | 1 |
| `server/services/sandbox/__tests__/proxyAlignmentServicePure.test.ts` | Pure-function tests: IP-to-geo translation fixtures, tenant-override precedence, partial-fallback shape | 2 |
| `infra/sandbox-templates/iee-browser/harness/__tests__/humanizeInputsPure.test.ts` | Pure-function tests: seeded-replay determinism, per-profile latency bounds, unsupported-action fallback. Architect verifies the project vitest config covers this directory (it currently does via the `harness/**/*.test.ts` glob; if not, the architect adds the glob in the same chunk). | 3 |

### 5.2 Modified files

| Path | Change | Phase |
|---|---|---|
| `server/services/sandbox/browserWarmPool.ts` | Add destroy-on-alignment-mutation semantics: after a proxy-aligned session completes, the warm-pool session is terminated (not returned to pool). Standard sessions unchanged. | 2 |
| `server/services/sandbox/e2bSandbox.ts` | Task envelope extends with `proxyAlignment` and `humanize` optional fields; threading into harness input via `/workspace/input.json` | 2, 3 |
| `infra/sandbox-templates/iee-browser/harness/index.ts` | Reads `taskPayload.proxyAlignment` and `taskPayload.humanize` from envelope; applies Chromium launch flags + `playwright.newContext({ timezoneId, locale, extraHTTPHeaders })` at boot; wraps Playwright action calls with `humanizeInputs.ts` when the humanize envelope is non-null. Stub-mode behaviour preserved when the real executor is not yet wired in. | 2, 3 |
| Workflow-config persistence target — architect picks ONE: (a) extend `server/db/schema/workflowTemplates.ts` (per-template config), (b) extend `server/db/schema/workflowRuns.ts` (per-run override), or (c) declare humanize as a code-level field on `defineWorkflow()` in `server/lib/workflow/defineWorkflow.ts` and consume it via the per-workflow `.workflow.ts` definition files. The choice is locked at chunk authoring; the migration in §5.3 is conditional on (a) or (b). | 3 |
| `shared/types/telemetryEvents.ts` (or canonical telemetry registry — architect locates) | Register 10 new event names (Q9 vocabulary + 2 GeoIP-job events) | 1, 2, 3 |
| `client/src/pages/WorkflowStudioPage.tsx` | If §5.2 path (a) or (b) is chosen for humanize persistence: render `HumanizeToggle.tsx` inside the existing Advanced expander on the workflow-edit surface; wire its onChange to the chosen persistence path. If path (c), no change needed. | 3 |
| existing tenant proxy-settings component | Per §15: the brief assumes a tenant proxy-configuration UI exists. At time of spec authoring, the codebase has no proxy-config UI surface. Architect verifies at build time: if a proxy-config surface lands as part of Phase 2 (or has shipped in a parallel build), the disclosure copy from `client/src/lib/copy/browserHardening.ts` is rendered beneath the proxy input there. If no proxy-config UI exists at Phase 2 implementation time, the disclosure copy is deferred to a follow-up build per §16. See also Open Question Q8 in §17. | 2 |
| `server/db/schema/subaccountSettings.ts` (or the equivalent existing tenant-settings schema file — architect locates) | **Conditional on §17 Q10 default path** (extend `subaccountSettings`): add `proxyConfig JSONB` column (shape `{ url, username?, password? }` — architect picks exact shape) and `proxyLocaleOverrides JSONB` column (shape `{ timezone?: string, locale?: string, language?: string }`). Both default null. If the architect deviates from the §17 Q10 default to path (ii) `workflowRuns` or path (iii) `e2bSandbox.ts` launch options, this row is replaced with the equivalent modification target — see §17 Q10 for deviation contract. | 2 |
| `architecture.md` § Key files per domain | Add `proxyAlignmentService`, `humanizeInputs`, `browser-detection-harness` rows | doc-sync |
| `docs/capabilities.md` | Asset Register: add `browser-hardening-primitives` row (cluster: Agent Runtime, Audit & Governance; lifecycle: Inception); Product Capabilities prose section (optional, architect picks if surface warrants it) | doc-sync |
| `docs/doc-sync.md` | Add row for this build's doc-sync surfaces | doc-sync |
| `server/config/rlsProtectedTables.ts` | No change — `harness_run_history` is system-scoped; opt-out documented in §7 below | 1 |

### 5.3 Migrations

| Migration | Purpose | Phase |
|---|---|---|
| `<next-free>_create_harness_run_history.sql` | Create `harness_run_history` table (system-scoped) | 1 |
| `<next-free>_<target>_add_humanize.sql` (conditional: only if architect picks DB-column path (a) or (b) in §5.2; not emitted if path (c) — code-level field on `defineWorkflow()`) | Add `humanize` JSONB column (default null; null = off) to the chosen target table (`workflow_templates` or `workflow_runs`). CHECK constraint: `humanize IS NULL` OR ( `jsonb_typeof(humanize) = 'object'` AND `(humanize->>'profile') IN ('light','balanced','heavy')` AND `jsonb_typeof(humanize->'seed') = 'number'` AND `(humanize->>'seed')::numeric = floor((humanize->>'seed')::numeric)` AND `(humanize->>'seed')::numeric >= 0` ). This validates: object shape, closed profile enum, seed is a JSON number, seed is an integer (no fractional part), seed is non-negative. | 3 |
| `<next-free>_subaccount_settings_add_proxy_config.sql` (**conditional on §17 Q10 default path**: emitted only if the architect picks the recommended default `subaccountSettings` extension. If the architect deviates to per-run override or e2bSandbox launch options, this migration is replaced with the equivalent target migration or omitted — see §17 Q10.) | Add `proxy_config JSONB` and `proxy_locale_overrides JSONB` columns to the chosen subaccount-settings target table, both default `NULL`. CHECK constraints: <br><br>1. `proxy_config IS NULL OR jsonb_typeof(proxy_config) = 'object'` (architect tightens the exact per-key shape at build time — `url` required string, `username`/`password` optional strings).<br><br>2. `proxy_locale_overrides IS NULL OR ( jsonb_typeof(proxy_locale_overrides) = 'object' AND (proxy_locale_overrides - 'timezone' - 'locale' - 'language') = '{}'::jsonb AND (NOT proxy_locale_overrides ? 'timezone' OR jsonb_typeof(proxy_locale_overrides->'timezone') = 'string') AND (NOT proxy_locale_overrides ? 'locale' OR jsonb_typeof(proxy_locale_overrides->'locale') = 'string') AND (NOT proxy_locale_overrides ? 'language' OR jsonb_typeof(proxy_locale_overrides->'language') = 'string') )`. This enforces: object shape, no extra keys beyond the allowed set `{timezone, locale, language}`, and each present key's value is a string. Architect MAY tighten further at build time (e.g. validating IANA timezone format via a CHECK function or by adding application-layer Zod validation), but the CHECK above is the binding minimum. | 2 |

No tenant-scoped tables added. No RLS migrations. (Note: extending `subaccountSettings` inherits the existing tenant RLS posture on that table — see §7.5.)

## 6. Contracts

### 6.1 `ProxyAlignment` (e2b task envelope field)

**Name:** `ProxyAlignment`
**Type:** TypeScript discriminated nullable: `ProxyAlignment | null`
**Location:** `shared/types/proxyAlignment.ts`
**Example instance:**

```json
{
  "timezone": "America/Los_Angeles",
  "locale": "en-US",
  "language": "en-US,en;q=0.9",
  "webrtcPolicy": "disable_non_proxied_udp"
}
```

**Nullability:**
- The envelope field itself is `null` when no proxy is configured OR `proxy-alignment` feature flag is disabled.
- When non-null, all four sub-fields are required (no partial envelope ships; partial resolution is logged via `browser.proxy.alignment.partial` and the envelope still ships with sensible fallbacks per-field).
- `timezone` falls back to `UTC`; `locale` falls back to `en-US`; `language` falls back to `en-US,en;q=0.9`; `webrtcPolicy` is always `disable_non_proxied_udp` when alignment is active.

**Producer:** `server/services/sandbox/proxyAlignmentService.ts`
**Consumer:** `infra/sandbox-templates/iee-browser/harness/index.ts` (applied to `playwright.newContext` and Chromium launch flags)

**Tenant-override precedence:** if the tenant has explicitly configured `timezone`, `locale`, or `language` on the workflow or subaccount level, those values override the GeoIP-derived values for the affected field only. `proxyAlignmentService` reads the tenant config and returns the tenant value (not the GeoIP value) for any explicitly-set field.

**Tenant-config source surface (architect-pick at Phase 2 chunk authoring):** the spec assumes a `proxyConfig` (proxy URL/credentials) source and tenant override fields (`timezone`, `locale`, `language`) exist somewhere the dispatch layer can read. At spec authoring time the codebase has no `proxyConfig` schema column or `workflow.locale` / `workflow.timezone` / `subaccount.language` field. The architect picks the actual source at Phase 2 chunk authoring — likely one of: (i) extend `subaccountSettings` schema with `proxyConfig` + locale-override fields, (ii) extend `workflowRuns` task-input schema with per-run proxy fields, or (iii) make proxy fields part of the e2b sandbox launch options consumed by `e2bSandbox.ts` directly (no tenant-facing override). The chosen surface is added to the file inventory at chunk authoring time. See Open Question Q10 in §17 (the data-source question; Q8 is the disclosure-UI question and is related).

### 6.2 `HumanizeOptions` (e2b task envelope field)

**Name:** `HumanizeOptions`
**Type:** TypeScript struct: `{ profile: HumanizeProfile, seed: number }`
**Location:** `shared/types/humanize.ts`
**Example instance:**

```json
{ "profile": "balanced", "seed": 42 }
```

**Nullability:**
- The envelope field is `null` when the persisted humanize value is `null` (regardless of where it's persisted per §5.2 architect-pick: column-null under paths (a)/(b), or field-absent under path (c)) OR the `humanize` feature flag is disabled. Null = pass-through standard Playwright behaviour.
- When non-null, both `profile` (one of `'light' | 'balanced' | 'heavy'` — `'off'` is never carried in the non-null shape; absence is the off representation) and `seed` (non-negative integer) are required.
- `HumanizeProfile` is therefore defined as `'light' | 'balanced' | 'heavy'`; the four-bucket policy uses absence (null envelope) as the fourth bucket.

**Producer:** task dispatch layer (reads workflow config; emits envelope)
**Consumer:** `infra/sandbox-templates/iee-browser/harness/humanizeInputs.ts`

**Deterministic replay invariant:** Given the same `seed` and the same action sequence, `humanizeInputsPure.ts` MUST produce identical Bezier paths, typing intervals, and scroll curves. Pure-function tests verify this (snapshot-based seed-replay test).

**Unsupported-action fallback:** When humanize encounters an action it does not support (e.g. a custom Playwright extension), it falls back to the standard path AND emits `browser.humanize.skipped` with `{ action_type, profile }`. The action still executes; humanize never throws.

### 6.3 `HarnessRunResult` (CI runtime + DB writer)

**Name:** `HarnessRunResult`
**Type:** TypeScript struct
**Location:** `server/tests/browser-detection-harness/harnessHistoryWriterPure.ts`
**Example instance:**

```json
{
  "siteSlug": "browserscan",
  "mode": "blocking",
  "score": 0.97,
  "baselineScore": 0.95,
  "baselineTolerance": 0.05,
  "outcome": "pass",
  "browserVersion": "Chromium/124.0.6367.91",
  "playwrightVersion": "1.43.0",
  "templateDigest": "local-dev-iee-browser:abc123",
  "runAt": "2026-05-18T12:00:00Z"
}
```

**Nullability:**
- `baselineScore` and `baselineTolerance` are `null` when this is a brand-new site with no baseline yet (first run establishes the baseline; outcome is `'baseline_established'`).
- `score` is a normalised float in `[0, 1]` where higher = better (less likely to be flagged as bot). Per-site mapping from raw detection-site output to this normalised score lives in the per-site test file.

**Producer:** `server/tests/browser-detection-harness/runHarness.ts`
**Consumer (1):** CI step that compares `score` against `baselineScore - baselineTolerance` and fails the job if below (blocking mode only).
**Consumer (2):** `server/tests/browser-detection-harness/harnessHistoryWriter.ts` (persists every run to `harness_run_history`).

**Outcome enum (closed):** `'pass' | 'fail' | 'baseline_established' | 'site_unavailable' | 'parse_error'`. Adding a new value requires a spec amendment.

### 6.4 Source-of-truth precedence

When the same fact is represented in multiple places, the winner is declared here.

- **Detection harness outcome:** the CI job status is computed from the in-memory `HarnessRunResult` produced by `runHarness.ts` for the current run; the job's exit code is set BEFORE the writer commits. `harness_run_history` is the durable telemetry record (best-effort persistence for historical comparison and dashboards). If the writer fails to commit a row, the CI job status is still authoritative for that run — no row replay reconciles with the live signal. This avoids the need for an enforced unique constraint on the table.
- **Baseline values:** the JSON fixture under `server/tests/browser-detection-harness/baselines/<site-slug>.baseline.json` is the source of truth. The `harness_run_history.baselineScore` column is a snapshot at run time for historical comparison; on conflict, the fixture wins.
- **Workflow `humanize` config:** the persisted humanize value (either a DB column per §5.2 paths (a)/(b), or a code-level field per path (c)) is the source of truth. Task dispatch reads from it; e2b envelope is an immutable transport copy. Source-of-truth precedence is enforced **only at the dispatch layer, before sandbox launch** — on a dispatch retry, the dispatch layer re-reads the persisted value and regenerates the envelope from current state. The sandbox itself never re-reads source and never reconciles source-vs-envelope conflicts; whatever is in `/workspace/input.json` is authoritative for the duration of that sandbox boot.
- **Tenant locale / timezone overrides:** the tenant's explicit config (workflow.locale, workflow.timezone, subaccount.language) wins over GeoIP-derived values. `proxyAlignmentService` reads tenant config first and overlays GeoIP only for unset fields.

## 7. Permissions / RLS checklist

### 7.1 `harness_run_history` — system-scoped (RLS opt-out, documented)

Not tenant-scoped. Records harness run results for internal engineering signal. No `organisation_id` or `subaccount_id` column. Does NOT appear in `RLS_PROTECTED_TABLES`.

**Opt-out rationale:** harness results are operational telemetry about OUR browser stack, not tenant data. No tenant can see another tenant's data because no tenant data is in the table at all. Reads are admin-only (engineering query against the table directly; no HTTP endpoint exposed in V1). If V2 adds a tenant-facing surface, RLS posture revisits.

### 7.2 humanize persistence — RLS posture inherits from chosen target

If the architect picks DB-column path (a) `workflow_templates` or path (b) `workflow_runs` (§5.2), the existing table's tenant RLS posture is inherited — adding a `humanize` JSONB column does not change the posture; the column is subject to the same row-level policy. No new RLS migration needed.

If the architect picks code-level path (c) `defineWorkflow()`, the humanize value is part of the immutable code-defined workflow definition and is not tenant-scoped data at all — no RLS concern arises.

### 7.3 No new HTTP routes in V1

This build adds no new HTTP routes. All control surfaces are:
- Workflow config UI (existing routes; column-level extension)
- Tenant settings disclosure (existing pages; copy added)
- CI workflow (GitHub Actions; no HTTP exposure)
- Engineer-direct DB query against `harness_run_history` (no route)

If a V2 admin UI for harness history is added, that's a separate spec.

### 7.4 RLS posture sentence (canonical)

For the tenant-scoped column added in Phase 3: RLS enforces the organisation boundary; subaccount filtering is service-layer. No change from the existing workflows-table posture.

### 7.5 `subaccountSettings.proxyConfig` + `proxyLocaleOverrides` — conditional on §17 Q10 default path

If the architect adopts the §17 Q10 recommended default (extend `subaccountSettings`), the new `proxy_config` and `proxy_locale_overrides` JSONB columns inherit the existing tenant RLS posture on that table. No new RLS migration needed. If the architect deviates to per-run override or e2bSandbox launch options, the RLS posture for the chosen surface applies and is documented in `progress.md`.

## 8. Execution model

Per `docs/spec-context.md` framing — pick one explicitly, keep prose consistent.

### 8.1 Detection harness — async / queued (CI)

CI workflow runs the harness as a GitHub Actions job. Per-PR: blocking-capable, initially advisory (see §13 rollout). Nightly: cron `0 3 * * *` UTC, advisory. The CI runner shells out to `npx tsx server/tests/browser-detection-harness/runHarness.ts --mode=blocking` (per-PR) or `--mode=full` (nightly). The runHarness script boots e2b sandboxes inline, runs each site test sequentially, computes the in-memory `HarnessRunResult` set, persists results best-effort to `harness_run_history`, and exits with status code derived **from the in-memory result set**, not from a re-read of the DB.

**Exit-code contract (precise):** `runHarness` exits **nonzero (1)** if and only if ALL three conditions are true: (i) the `detection-harness-gating` feature flag is enabled at run time, (ii) at least one site whose per-site `mode` field is currently `'blocking'` produced an outcome from the **failure set** `{ 'fail', 'parse_error' }`, and (iii) the CLI was invoked with `--mode=blocking` (per-PR mode). In every other case — including `mode: 'advisory' | 'nightly' | 'disabled'`, gating-flag disabled, `--mode=full` nightly runs, or any other outcome (`pass | baseline_established | site_unavailable`) — exit code is **0** and any failures surface via Slack/commit-comment advisory.

**Why `parse_error` is in the blocking failure set:** for cached-fixture per-PR runs, `parse_error` indicates a harness/detector parser breakage in OUR code (the cached fixture is deterministic, so a parser failure on cached input is an integration bug, not site flakiness). Treating it as `outcome: pass` would silently mask parser regressions. `site_unavailable` stays non-failing because it can legitimately fire on live nightly runs without indicating an issue in our stack; for per-PR cached fixtures, `site_unavailable` should be near-impossible (cached fixture is on disk), so seeing it on per-PR is itself a signal but does not block CI — investigate via advisory channel.

The `harnessHistoryWriter` writes to the DB inline (the same Node process as runHarness). Idempotency posture: append-only telemetry; no DB unique constraint, no logical-key collision handling. If a writer error occurs, runHarness logs the failure but the exit code is still determined by the in-memory results — DB persistence is not a CI gate.

### 8.2 Proxy alignment — sync / inline (task dispatch)

When the task dispatch layer prepares an e2b sandbox launch:
1. Inline: read `proxyConfig` from the workflow / subaccount.
2. Inline: if a proxy is configured AND `proxy-alignment` flag is on, call `proxyAlignmentService.resolve(proxyConfig)`.
3. Inline: that service performs an embedded GeoLite2 lookup (no network call at task time; the DB is local).
4. Inline: the assembled `ProxyAlignment` envelope is attached to the e2b task payload.
5. The harness consumes the envelope when booting Playwright.

No queue, no async deferred resolution. The GeoLite2 lookup is microsecond-scale; doing it inline at dispatch keeps the contract simple.

### 8.3 humanize — sync / inline (harness consumes envelope)

humanize is a pure function inside the e2b harness. The dispatch layer reads the persisted humanize value (location determined by the §5.2 architect-pick path: per-template column, per-run column, or code-level `defineWorkflow()` field — in all three paths the read produces either `null` or `{ profile, seed }`), packages it into the envelope, and the harness wraps Playwright action calls with `humanizeInputs.ts` when the envelope is non-null. No queueing; no async; deterministic given seed.

### 8.4 GeoLite2 DB refresh — async / queued

`geoipDbRefreshJob.ts` is a pg-boss job scheduled weekly (`0 4 * * 0` UTC) on queue `geoip-db-refresh` with `singletonKey: 'geoip-db-refresh-active'`, `singletonMinutes: 60`, and worker concurrency `1` so concurrent enqueues coalesce. It:
1. Fetches latest GeoLite2 City DB from MaxMind's update URL (architect picks exact URL + auth token; managed via the standard secrets system).
2. Validates the file (size sanity, signature if available, basic format check).
3. **Resolves the runtime data path** from `process.env.GEOIP_RUNTIME_DIR` (default `/var/lib/synthetos/geoip`); creates the directory with `mkdir -p` if missing; writes to `${GEOIP_RUNTIME_DIR}/geolite2-city.mmdb.new`, fsyncs, atomic-renames over `${GEOIP_RUNTIME_DIR}/geolite2-city.mmdb`. **Never writes inside the repo source tree** — the bundled `infra/geoip/geolite2-city.mmdb` is read-only first-boot fallback, not a write target. If `GEOIP_RUNTIME_DIR` is unwritable (e.g. read-only filesystem, missing permissions), the job fails with `geoip.db.refresh.failed { step: 'runtime_dir_unwritable' }` and `proxyAlignmentService` continues reading the bundled fallback until the env is corrected.
4. Emits `geoip.db.refreshed { previousVersion, newVersion, sizeBytes }` (or `geoip.db.refresh.failed { step, reason }` on any step). The `proxyAlignmentService` separately emits `geoip.db.source.selected { source: 'runtime' | 'bundled' }` on each session start so observability can distinguish which DB was actually read without leaking the runtime filesystem path.

Idempotency posture: state-based — the job is safe to re-run (just downloads the latest again). Retry classification: safe (atomic swap is the only durable side effect; re-run replaces with the latest).

## 9. Phase sequencing (dependency graph)

```
Phase 1 (Detection harness) ─────► no upstream dependency on Phase 2/3
   │
   ├─► creates harness_run_history table + writer
   ├─► creates baseline fixtures + per-site tests
   └─► establishes CI gate (per-PR blocking subset)

Phase 2 (Proxy alignment) ────────► depends on Phase 1 harness being e2b-backed (harness verifies no regression on live browser fingerprint)
   │
   ├─► creates proxyAlignmentService + pure module + GeoLite2 DB + refresh job
   ├─► extends e2b task envelope with proxyAlignment
   ├─► extends harness/index.ts to consume envelope
   └─► extends browserWarmPool with destroy-on-alignment-mutation

Phase 3 (humanize) ───────────────► depends on Phase 1 harness being e2b-backed (harness verifies no regression on live browser fingerprint)
   │
   ├─► creates humanizeInputsPure + humanizeInputs + types
   ├─► extends e2b task envelope with humanize
   ├─► extends harness/index.ts to wrap action calls
   ├─► persists humanize via §5.2 architect-pick path (template-column / run-column / code-level field)
   └─► adds HumanizeToggle workflow config UI (conditional on §5.2 path (a)/(b); skipped under (c))
```

No backward references. No orphaned deferrals. Phase 1 ships standalone; Phases 2 and 3 each ship standalone but depend on Phase 1's gate. Within a single PR, build chunks land in the order 1 → 2 → 3.

## 10. Execution-safety contracts

### 10.1 Idempotency posture

- **`harnessHistoryWriter` insert:** append-only, non-idempotent (intentional). No DB unique constraint. The writer is telemetry, not a CI gate (see §6.4). Caller (`runHarness`) catches writer errors, logs them, and proceeds — CI exit code is driven by the in-memory `HarnessRunResult` set, never by a DB re-read.
- **`geoipDbRefreshJob`:** state-based. The atomic file swap leaves the system in a known state regardless of how many times the job runs.
- **humanize persistence writes:** depends on §5.2 architect-pick path. Under path (a) per-template column: key-based via existing `workflow_templates` row update (existing optimistic-concurrency posture inherited). Under path (b) per-run column: key-based via existing `workflow_runs` row write (existing terminal-state guard inherited). Under path (c) code-level field: not a runtime write; humanize is part of the immutable workflow code definition and changes through code-review-gated PR merges, not runtime calls.
- **e2b task envelope dispatch:** state-based — the envelope IS the input to a fresh sandbox boot; idempotency is per-task at the dispatch layer (existing posture).

### 10.2 Retry classification

- `geoipDbRefreshJob`: **safe** — pg-boss can retry without harm; atomic swap is the only durable side effect.
- `harnessHistoryWriter` insert: **safe** — append-only, no terminal state to corrupt.
- `proxyAlignmentService.resolve`: **safe** — pure function over local GeoLite2 DB; no external call at execution time.
- Task dispatch with envelope: **guarded** — relies on existing task dispatch idempotency (per-task ID).

### 10.3 Concurrency guard for racing writes

- **GeoLite2 DB swap:** the job is dispatched on queue `geoip-db-refresh` with `singletonKey: 'geoip-db-refresh-active'` and a singleton window (`singletonMinutes`) of 60 minutes (longer than any plausible download + validate + swap cycle). The job worker registers with concurrency `1`, so even within a single worker process only one instance runs at a time. The atomic file rename guarantees no torn reads. If a second invocation is enqueued while one is in flight, pg-boss coalesces it inside the singleton window; no two refreshers can race to download conflicting versions.
- **Workflow `humanize` config writes:** existing workflow optimistic-concurrency posture applies (workflows table has the existing row-version pattern; humanize column reads/writes inherit it).
- **Harness baseline updates:** baselines are checked into git; merge conflicts on the same baseline file are resolved by git, not by application logic. The static gate ensures the resolved file carries the required `Baseline-Weakening-Approved-By:` trailer when tolerance widens.

### 10.4 Terminal event guarantee

Each chain has exactly one terminal event:

- **Detection harness run:** terminal event is `browser.detection.harness.run.completed` per site per run; its `outcome` payload field carries the closed enum from §6.3 (`pass | fail | baseline_established | site_unavailable | parse_error`). Exactly one terminal event per (site, run) pair.
- **Proxy alignment chain:** terminal event is `browser.proxy.alignment.resolved` OR `browser.proxy.alignment.failed` OR `browser.proxy.alignment.partial` — mutually exclusive per session.
- **humanize action:** humanize is a per-action wrapper, not a chain. The two events are emitted **after the wrapped Playwright call returns** (whether it resolves or throws): `browser.humanize.applied` is emitted when humanize wrapped the action and the call returned (success or failure of the wrapped action is reported via existing action telemetry; `applied` carries the humanize wrapper's own `durationMs` only); `browser.humanize.skipped` is emitted when humanize fell back to the standard path because the action is unsupported. Exactly one of the two events fires per attempted action. If a non-action error occurs in humanize's own logic before the wrapped call is dispatched, the wrapper falls back to the standard path and emits `skipped` with a `reason` of `'wrapper_error'` (architect names the existing telemetry channel for the underlying error).
- **GeoLite2 refresh:** terminal event is `geoip.db.refreshed` OR `geoip.db.refresh.failed`.

### 10.5 No-silent-partial-success

- **Detection harness:** when the runHarness loop encounters a site that times out or returns a malformed score, it emits `browser.detection.harness.run.completed { outcome: 'site_unavailable' | 'parse_error' }` and continues to the next site. The final CI exit code reflects `blocking`-mode sites with any outcome in the failure set `{ 'fail', 'parse_error' }` (see §8.1). `site_unavailable` never blocks CI; it surfaces via Slack alert + commit comment. Advisory and nightly outcomes never block CI regardless of outcome.
- **Proxy alignment:** when GeoLite2 returns partial fields (rare — only edge case is IPv6 ranges not in the DB), the envelope is still assembled with fallbacks and emits `browser.proxy.alignment.partial`. Session continues.

### 10.6 Unique-constraint-to-HTTP mapping

No new HTTP routes. No new unique constraints that map to user-facing surfaces. If §5.2 architect picks path (a) or (b), the humanize CHECK constraint (per §5.3 migration) is enforced server-side and surfaces as a 400 on any direct DB write that violates it (via the existing workflow-templates-update or workflow-runs-write route surface). Under path (c) code-level field, the constraint is enforced at definition load time and a violating definition fails CI on the existing workflow-validation pass.

### 10.7 State machine closure

No new state machines. Existing workflows / task-dispatch / e2b-sandbox state machines extend with new payload fields, not new states.

## 11. Testing posture

Per `docs/spec-context.md` (`testing_posture: static_gates_primary`, `runtime_tests: pure_function_only`).

### 11.1 Pure-function tests (allowed; ship in V1)

- `humanizeInputsPure.test.ts` — seeded-replay determinism (same seed → identical curves), per-profile bound checks (light p99 < balanced p99 < heavy p99), unsupported-action fallback returns the standard-path signal.
- `proxyAlignmentServicePure.test.ts` — IP-to-geo translation for known fixture IPs (US, UK, JP, AU), tenant-override precedence (explicit timezone overrides GeoIP), partial-fallback shape.
- `harnessHistoryWriterPure.test.ts` — `HarnessRunResult` → DB row shape normalisation.

### 11.2 Static gates (allowed; ship in V1)

- `scripts/gates/verify-baseline-weakening-approval.sh` — new gate. Invoked from `.github/workflows/browser-detection-harness.yml` as a pre-step on the per-PR job (see §5.1 row).
- Existing gates (`verify-no-do-references.sh`, `verify-rls-coverage.sh`, `verify-sandbox-minimum-events.sh`, etc.) — re-run unchanged; this build does not extend their scope.

### 11.3 Detection harness — runtime test of EXTERNAL surface

Per `docs/spec-context.md` framing: `e2e_tests_of_own_app: none_for_now`. The detection harness IS a runtime test, but it tests an EXTERNAL surface — the fingerprint our browser stack produces when rendering a third-party detection page. This is distinct from "E2E tests of our own app." The harness validates that our browser layer continues to produce the expected fingerprint shape; it does NOT verify our application routes / UI / business logic.

**Framing departure flagged:** if `spec-reviewer` raises this as a directional finding, the rationale above is the answer. The harness is the product, not a test of the product.

### 11.4 Forbidden test types (per framing)

No supertest API-contract tests, no vitest/jest frontend unit tests, no playwright tests of our own app pages, no performance-baseline tests against our own app. These remain deferred per `docs/spec-context.md`.

## 12. Telemetry registry (locked vocabulary)

All event names register in the canonical telemetry types file. Neutral, reliability-framed vocabulary only.

| Event name | Emitted at | Payload (minimum) |
|---|---|---|
| `browser.humanize.applied` | After each humanize-wrapped action completes | `{ action_type, profile, durationMs }` |
| `browser.humanize.skipped` | When humanize encounters unsupported action | `{ action_type, profile, reason: 'unsupported_action' }` |
| `browser.proxy.alignment.resolved` | Session boot with proxy + alignment | `{ region, timezone, locale }` (no raw IP) |
| `browser.proxy.alignment.failed` | GeoLite2 lookup fails entirely | `{ reason }` (no raw IP) |
| `browser.proxy.alignment.partial` | Some fields resolved, some fell back | `{ resolvedFields, fallbackFields }` |
| `browser.detection.harness.run.completed` | After per-site test finishes | `{ siteSlug, outcome, score, baselineScore }` |
| `browser.detection.harness.run.regression` | When outcome is in the failure set `{ 'fail', 'parse_error' }` AND mode is `blocking` | `{ siteSlug, outcome, score, baselineScore, baselineTolerance }` — `score`/`baselineScore`/`baselineTolerance` may be `null` when `outcome: 'parse_error'` (no parseable score). The `outcome` field distinguishes score regression from parser breakage. |
| `browser.detection.harness.baseline.updated` | After a baseline-file diff lands with the approval trailer | `{ siteSlug, oldBaselineScore, newBaselineScore, approvedBy }` |
| `geoip.db.refreshed` | Successful GeoLite2 refresh | `{ previousVersion, newVersion, sizeBytes }` — no filesystem path leaked |
| `geoip.db.refresh.failed` | Any step of refresh failed | `{ step, reason }` |
| `geoip.db.source.selected` | Once per session boot (when proxy alignment fires) | `{ source: 'runtime' \| 'bundled' }` — coarse signal so engineers can verify the refresh job is taking effect without exposing the actual path |

**No raw IPs, no raw GeoIP payloads, no proxy credentials in any event.** Hashed or coarse-grained (region-level) identifiers only.

## 13. Rollout posture

Per brief — feature-flagged per primitive, internal-first, gradual tenant enablement.

- **Feature flags (independent):** `detection-harness-gating`, `proxy-alignment`, `humanize`. Each toggleable via runtime config without code change.
- **Internal enablement first:** harness ships in `advisory` mode on all sites for the first PR-cycle; flip to `blocking` on the chosen 5–10 stable subset only after baselines stabilise across two consecutive nightly runs.
- **Tenant enablement (humanize, proxy-alignment):** per-workflow opt-in (humanize) and proxy-conditional (proxy-alignment). No percentage rollout or allowlist needed because both are opt-in surfaces.
- **Runtime kill switch:** all three flags can be disabled at runtime; the harness gate becomes advisory-only, proxy alignment becomes no-op (envelope ships `null`), humanize becomes pass-through. No code deploy required to disable.
- **Rollback path per primitive:** harness — flip `detection-harness-gating` off. Proxy alignment — flip `proxy-alignment` off; existing proxy-configured sessions revert to unaligned defaults. Humanize — flip `humanize` off; workflow `humanize` values are ignored. Each rollback is non-destructive (no schema rollback needed).

## 14. Operational ownership

- **Detection-site baselines:** owner is platform team (placeholder; re-resolves at first review). Trigger: three consecutive failures on the same site without a code change → recalibrate; OR 90 days no failure → quarterly health check. Baseline updates land via PR with the required commit-message trailer.
- **Flaky sites:** downgraded from `blocking` → `nightly` → `advisory` → `disabled` without re-opening the spec. Downgrade is logged in the per-site test file's mode field (which lives in the file itself) and the `Last updated` field of this spec is bumped. **Mode downgrades require the same `Baseline-Weakening-Approved-By:` commit trailer** as tolerance widening — the static gate at `scripts/gates/verify-baseline-weakening-approval.sh` enforces both classes (see §5.1).
- **Playwright bumps:** the harness MUST run on the branch that bumps Playwright before merge. CI workflow includes a path-trigger that auto-runs the full harness when `package-lock.json` or `playwright` package versions change.
- **GeoLite2 DB drift:** weekly refresh job is the canonical maintenance. Job failures emit `geoip.db.refresh.failed` and route to engineering Slack channel.
- **Baseline weakening approval:** the `Baseline-Weakening-Approved-By:` trailer must reference a reviewer with explicit approval authority for the harness (architect locks the exact reviewer list at build time; default = platform team leads).
- **Disclosure copy:** locked at Q13 in `intent.md § Grill-me Q&A`. Architect can refine wording during spec authoring; the reliability-framed positioning is non-negotiable.

## 15. Tenant-facing UI surfaces (extends existing patterns)

Per operator decision (Step 3, mockups skipped), UI surfaces slot into existing patterns.

- **Workflow config — `HumanizeToggle.tsx`:** new component rendered from `WorkflowStudioPage.tsx`'s existing Advanced expander surface (applies when §5.2 humanize persistence path is (a) or (b); if path (c) is chosen, no UI ships in V1). Default dropdown shows `Off (default)`; `Light`, `Balanced`, `Heavy` options revealed in a collapsed "Advanced: human-paced input timing" expander per `docs/frontend-design-principles.md § Modal advanced expanders`. Selecting `Off` persists `humanize: null`; selecting `Light/Balanced/Heavy` persists `humanize: { profile, seed }`. Seed input nested inside the expander (number input). **Seed lifecycle:** when the operator does not set a seed at workflow save time, the workflow save/update server route assigns one (a fixed-per-workflow integer) and persists it alongside the chosen profile. Dispatch only ever reads the persisted humanize value and packages it into the envelope — dispatch never assigns or mutates a seed. This pins reproducibility: the same workflow definition with the same seed produces the same humanize curves on every dispatch.
- **Proxy settings disclosure:** copy lives on the existing tenant proxy-config settings panel (architect locates the existing component). Plain-language line below the proxy input: "When a proxy is configured, browser locale, timezone, and language are aligned with the proxy region by default. Override in workflow settings if needed." No new component, no new toggle.
- **No harness-history UI:** V1 ships nothing tenant-facing. Engineers query `harness_run_history` directly.

All copy follows the canonical disclosure wording in Q13. No em-dashes. No stealth vocabulary.

## 16. Deferred items

- **Internal-staff harness-history dashboard UI.** V1 ships CI alerts + DB table only. Defer until a real engineering workflow demands a dashboard. V2 backlog.
- **Tenant-facing baseline-trend view.** Deferred indefinitely — tenants do not need to see our internal regression scores; the rollout-posture invariant explicitly says "the harness is a regression detector, not a pass/fail proof of browser legitimacy."
- **Firefox / WebKit parity.** Chromium-only V1 per brief. Defer until workflow demand justifies. Architect ensures no Chromium-specific assumption leaks into a layer that would be expensive to reshape later.
- **Reset-in-place warm-pool sessions.** V1 destroys proxy-aligned sessions on return to pool. Reset-in-place is a post-V1 optimisation if the boot-cost-per-session becomes operationally meaningful.
- **Managed GeoIP provider.** V1 ships embedded GeoLite2. Vendor isolation invariant means switching to a managed provider later requires no caller code changes. Defer unless GeoLite2 accuracy proves insufficient.
- **Real-Playwright executor wiring.** This spec assumes the e2b harness STUB at `infra/sandbox-templates/iee-browser/harness/index.ts` is replaced with the real Playwright executor by the CI template build pipeline (per `tasks/builds/sandbox-safety-batch/req-57-decision.md`). All harness-side primitives in this spec implement against the contract; integration with the real executor is not in scope for this build. The primitives EXERCISE their pure-module surface; their consumer-side wrappers ship behind the harness stub boundary.
- **REQ #57 credential value-threading.** Out of scope (separate v2-deferred backlog item).
- **Sandboxed test runner.** The detection harness boots e2b sandboxes. If CI cannot easily access e2b at PR time (auth, quota), the architect MAY ship the per-PR job in `advisory` mode on cached fixtures only, with nightly running against real e2b. This is an architect call at build time, not a deferral. **Note:** Phases 2 and 3 of this build depend on the Phase 1 harness running against real e2b sandboxes (cached-fixture replay does not exercise the live browser fingerprint that proxy alignment and humanize affect). If at build time only cached-fixture per-PR runs are feasible, Phases 2 and 3 ship with the explicit caveat that the nightly e2b harness is their primary regression gate, and merging them while nightly is red blocks Phase 2/3 acceptance. The architect documents the chosen posture in `progress.md`.

## 17. Open questions (for architect)

These are architect-pick at build time; not operator-blocking.

1. **Per-PR detection-site subset (5–10 sites).** Brief recommends a small stable subset; architect picks the exact list during chunk authoring. Likely candidates: `browserscan`, `bot.incolumitas`, `deviceandbrowserinfo`, `fingerprint-com` (with paid API only if reasonable), `whoer`. Verify each against the per-PR runtime budget (<2 min total).
2. **Exact per-profile latency budget calibration.** Spec locks the four-bucket policy and the ceiling values (<100ms / <300ms / <750ms per action p99); architect calibrates the exact numeric outputs of `humanizeInputsPure` to fit within those ceilings.
3. **Benchmark workflow for end-to-end latency rejection threshold.** Brief requires `+30% p95 over baseline` as the rejection threshold; architect picks the canonical benchmark workflow at chunk authoring (likely lead-enrichment public-data scrape).
4. **Cron schedule for GeoLite2 refresh.** Spec recommends `0 4 * * 0 UTC` (Sunday 4am UTC); architect verifies no conflict with existing pg-boss jobs.
5. **MaxMind GeoLite2 update URL + auth.** Architect picks the exact MaxMind account / API key / download URL; standard secrets system.
6. **Exact reviewer list for `Baseline-Weakening-Approved-By:` trailer.** Spec defaults to platform team leads; architect can broaden / narrow at build time.
7. **e2b SDK availability.** This build assumes the e2b SDK CAN be installed when the harness needs to boot real sandboxes. If e2b is not installable in CI at PR time, the architect ships per-PR in cached-fixtures-only advisory mode and nightly against e2b. Documented as an architect call.
8. **Tenant proxy-configuration UI.** The brief assumes tenants can configure a proxy on a settings surface. At time of spec authoring, the codebase has no proxy-config UI surface (no `client/src/components/settings/*Proxy*`, no `proxyConfig` schema column). The architect verifies at Phase 2 chunk authoring whether the proxy-config surface (a) lands in this build, (b) lands in a parallel build, or (c) the disclosure copy is deferred to a follow-up build. The proxy alignment primitive itself does not depend on the UI — it reads from whatever proxy-config source the architect points it at.
9. **Humanize persistence target.** The architect picks ONE of three persistence paths (see §5.2 Workflow-config persistence target row) at Phase 3 chunk authoring: (a) per-template DB column, (b) per-run DB column, or (c) code-level field on `defineWorkflow()`. The choice cascades through §5.3 (migration conditional) and §15 (UI conditional).
10. **Tenant-config source for proxyConfig + locale/timezone overrides.** Per §6.1 Tenant-config source surface, the architect picks where the `proxyConfig` and per-field overrides (`timezone`, `locale`, `language`) read from at Phase 2 chunk authoring. **Recommended default:** extend `subaccountSettings` schema with a `proxyConfig JSONB` column AND `proxyLocaleOverrides JSONB` column (shape `{ timezone?: string, locale?: string, language?: string }`). Rationale: subaccount-level proxy is the natural unit (one proxy per tenant region), the JSONB-column pattern is already used for tenant config, RLS posture inherits from `subaccountSettings`, and the architect can override at Phase 2 chunk authoring with documented rationale (e.g. picking per-run override if multi-region-per-tenant workflows emerge). Architect deviates from this default ONLY if there is a specific reason documented in `progress.md`. The chosen surface is added to the file inventory at chunk authoring time.

## 18. Self-consistency pass result

Self-consistency pass complete. Items checked:

- Goals (§1) ↔ Phase plan (§4) ↔ File inventory (§5) ↔ Contracts (§6): all three primitives traced through every section with consistent shape.
- File inventory lock (§5) ↔ phase tags: every new file has a phase tag matching its dependency-graph position (§9).
- Execution model (§8) ↔ Goals (§1): no cache-efficiency claim, no latency budget contradiction (§10.2 ceilings match §4.3 phase outputs).
- Phase sequencing (§9): no backward references; Phases 2 and 3 both depend on Phase 1's gate; chunk-order locked.
- Deferred items (§16): every "later" / "defer" / "future" prose mention reconciled.
- Numeric-count reconciliation: 23 new files (§5.1), 12 modified-file rows (§5.2; includes doc-sync rows, one no-change row for `rlsProtectedTables.ts`, the architect-picks-target row for the humanize persistence layer, and the conditional `subaccountSettings` extension row added in chatgpt-spec-review R2), 3 migrations (§5.3; two of which are conditional — the humanize column on §5.2 humanize-persistence path, and the proxy-config columns on §17 Q10 default path), 11 telemetry events (§12; includes the `geoip.db.source.selected` event added in R2), 3 profile names (`light | balanced | heavy`; off is `null` per §6.2), 5 outcome enum values (§6.3), 3 phases (§4), 3 feature flags (§13), 10 open questions for architect (§17). All counts cross-referenced within the spec.
- Tenant disclosure copy (§15) ↔ grill Q13 (`intent.md`): wording matches verbatim.
- Telemetry vocabulary (§12) ↔ grill Q9 (`intent.md`): event names match verbatim.

No backward references. No orphaned deferrals. No phase-boundary contradictions.

## 19. Acceptance criteria

Per brief §"Success criteria" — acceptance independence enforced. Three independent gates:

### 19.1 Detection harness acceptance

- Per-PR job (blocking-capable, initially advisory per §13) runs in <2 min against cached fixtures for the architect-chosen 5–10 site subset.
- Nightly advisory job runs in <15 min against the full 30-site live suite.
- `harness_run_history` table accumulates one row per (site, run) best-effort; missing rows do not break CI (per §6.4 source-of-truth precedence).
- A deliberate baseline-weakening commit fails the static gate WITHOUT the trailer and passes WITH it.
- Once a site has been flipped from advisory → blocking (after the two-stable-nightly-runs trigger in §13), a deliberate detection-score regression on that site fails the per-PR CI job.
- A deliberate parser breakage simulated on a `blocking`-mode site (cached fixture, parser change produces unparseable output) fails the per-PR CI job with `outcome: 'parse_error'` (per §8.1 failure set `{ fail, parse_error }`).

### 19.2 Proxy alignment acceptance

- A workflow with a configured proxy (US-East) launches Playwright with `newContext({ timezoneId: 'America/New_York', locale: 'en-US', extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' } })` and Chromium with `--lang=en-US` plus `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`.
- An identical workflow with an explicitly-tenant-configured `timezone=Europe/London` overrides the GeoIP value; only the unset fields (locale, language) are GeoIP-derived.
- A proxy-aligned warm-pool session is destroyed (not reset) on return to pool; the next task receives a fresh sandbox.
- A simulated GeoLite2 partial-fallback (IPv6 not in DB) emits `browser.proxy.alignment.partial` and the session still launches with sensible defaults.

### 19.3 humanize acceptance

- A workflow with `humanize: { profile: 'balanced', seed: 42 }` produces identical mouse paths / typing intervals / scroll curves on two separate runs.
- An action humanize does not support falls back to standard Playwright path and emits `browser.humanize.skipped`.
- The `light` profile measured p99 per-action latency is under 100ms on the local pure-module calibration suite; `balanced` under 300ms; `heavy` under 750ms. (Gating: this is verifiable via pure-function tests over `humanizeInputsPure` timing, so it ships as the actual acceptance gate.)
- End-to-end workflow latency under `balanced` should not exceed +30% p95 over baseline on the architect-defined benchmark workflow. (Non-gating advisory: per `docs/spec-context.md` framing, performance-baseline tests against the app's own surfaces are deferred. The architect runs this benchmark **manually** at build time as a sanity check; CI does not gate on it.)

Any primitive can ship, roll back, or pause without forcing the others. Bundled in one PR but feature-flagged independently.

## 20. Migration / cross-cutting notes

- **No tenant data migration.** If §5.2 architect picks path (a) or (b), the new humanize JSONB column defaults to null; existing rows are unaffected. Under path (c) code-level field, no migration runs.
- **No incompatible schema change.** Both new tables and the new column are additive.
- **No incompatible API change.** Existing routes and services are unchanged in their public contracts; new fields are additive in the e2b task envelope.
- **Doc-sync surfaces:** `architecture.md` § Key files per domain (add 3 rows), `docs/capabilities.md` Asset Register (add 1 row), `docs/doc-sync.md` (add doc-sync row for this build). `KNOWLEDGE.md` updates remain a session-activity decision per the standard convention and are not pre-prescribed by this spec.
- **Architecture rules touched:** none. No new service layer. Existing primitives (`pg-boss` for jobs, e2b task envelope for sandbox config, workflow JSONB columns for per-workflow config) are reused.

## Appendix — Provenance

- Brief: `tasks/builds/browser-hardening-primitives/brief.md` (v3 spec-ready, 2026-05-18)
- Intent: `tasks/builds/browser-hardening-primitives/intent.md` (2026-05-18, with full grill log)
- Grill: 13 questions, operator approved Q1 + Q2 individually, Q3–Q13 locked en bloc
- Duplication / Strategy Check: clear / clear / proceed
- Mockups: skipped per operator decision (thin UI surface)
- Source pattern: CloakHQ/CloakBrowser (MIT, pattern lift only — Chromium fork NOT adopted)
- Sequenced before: `browser-vision-grounding` (decision layer above), `iee-browser-on-e2b` (substrate, already merged 2026-05-17)

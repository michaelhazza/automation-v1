# Spec Conformance Log

**Spec:** `tasks/builds/browser-hardening-primitives/spec.md`
**Spec commit at check:** locked at `d68a654d` (Phase 1 spec-coordinator complete); plan `17820345`
**Branch:** `browser-hardening-primitives`
**Base (merge-base with main):** `9fdcabd7`
**HEAD:** `ae0d76e6`
**Scope:** all 11 chunks built (Phase 2 G2 branch-level review pass — full spec coverage minus two pre-ratified deviations)
**Changed-code set:** 51 BHP-attributable files (commits `81f2425d..HEAD`; excludes merge-from-main carry-over)
**Run at:** 2026-05-18T04:17:52Z
**Commit at finish:** `528eced4`

---

## Summary

- Requirements extracted:     52
- PASS:                       50
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 2
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     1

**Verdict:** CONFORMANT (0 mechanical fixes applied; 2 non-blocking directional gaps routed to `tasks/todo.md`; 1 out-of-scope item — doc-sync — is finalisation-coordinator's responsibility per plan)

---

## Pre-ratified deviations (acknowledged, NOT reported as gaps)

1. **BHP-2 framing departure.** V1 nightly harness uses cached fixtures only; live e2b run deferred until the e2b SDK is installed.
2. **`subaccountSettings → subaccount_iee_browser_settings`.** Spec named a non-existent table; plan extends the existing IEE-browser settings table at architect-pick item 10. Migration 0371 lands the columns on the actual target table.

---

## Requirements extracted — Phase 1 (Detection harness, Chunks 1–4)

| # | Spec ref | Requirement | Verdict |
|---|---|---|---|
| 1 | §5.1, plan chunk 2 | `server/tests/browser-detection-harness/runHarness.ts` CLI entrypoint with `--mode=blocking|full` | PASS |
| 2 | §5.1, plan chunk 3 | Per-site test files for 5 sites: browserscan, bot-incolumitas, deviceandbrowserinfo, whoer, pixelscan | PASS |
| 3 | §5.1 | Per-site baseline JSONs `<slug>.baseline.json` | PASS — all 5 present |
| 4 | §5.1 | Cached fixture HTMLs per site | PASS — all 5 present (316–597 bytes each) |
| 5 | §5.1, §6.3 | `harnessHistoryWriter.ts` + Pure module with `toRow()` | PASS |
| 6 | §5.1, plan chunk 4 | `.github/workflows/browser-detection-harness.yml` with per-PR + nightly + Playwright-bump path-trigger; baseline-weakening gate as pre-step; `actions/checkout@v4` with `fetch-depth: 0` | PASS |
| 7 | §5.1, §7.1, §5.3 | `harness_run_history` table (system-scoped) + migration 0370 with `-- system-scoped:` header referencing §7.1 | PASS |
| 8 | §5.1, plan chunk 2 | `verify-baseline-weakening-approval.sh` — detects both weakening classes; V1 allowlist `{ '@michaelhazza', 'michaelhazza' }`; self-test cases i–viii | PASS — all 8 cases present incl. case (viii) trailer-in-non-tip |
| 9 | §12 | 3 harness telemetry events registered in canonical registry | PASS — `HarnessRunEventType` in `shared/types/sandbox.ts:303-306` |
| 10 | §13 | Feature flag `detection-harness-gating` | PASS — `DETECTION_HARNESS_GATING_FLAG` exported; env-var consumed in `runHarness:145` |
| 11 | §6.3 | `HarnessRunResult` shape per spec (siteSlug, mode, score, baselineScore, baselineTolerance, outcome, browserVersion, playwrightVersion, templateDigest) | PASS |
| 12 | §6.3, §8.1 | Closed outcome enum: `'pass' | 'fail' | 'baseline_established' | 'site_unavailable' | 'parse_error'` | PASS |
| 13 | §8.1 | Exit-code precise contract (gating+blocking+failure-set+--mode=blocking → 1; else 0) | PASS — `runHarnessExitCodePure` pure helper per plan risk mitigation |
| 14 | §8.1 + §12 | `parse_error` triggers both `…run.completed` and `…run.regression` events | PASS |
| 15 | §8.1, §13 | First-run baseline establishment writes `<slug>.baseline.json` + emits `baseline_established` | PASS |
| 16 | plan chunk 1 | `harness_run_history` columns + types match: numeric(4,3) score fields, text mode+outcome with CHECK constraints, index on (site_slug, run_at DESC) | PASS |
| 17 | §5.1 | `harnessHistoryWriterPure.test.ts` — field mapping + outcome enum + validation tests | PASS |
| 18 | §10.1 | Append-only telemetry; CI exit driven by in-memory results, not DB re-read | PASS — `writeResultSafe` swallows writer errors |

---

## Requirements extracted — Phase 2 (Proxy alignment, Chunks 5–8)

| # | Spec ref | Requirement | Verdict |
|---|---|---|---|
| 19 | §6.1, §5.1 | `shared/types/proxyAlignment.ts` with `ProxyAlignment` shape | PASS |
| 20 | §5.2 (adapted per Q10) | `subaccount_iee_browser_settings` adds `proxyConfig` + `proxyLocaleOverrides` JSONB columns | PASS — Drizzle schema typed via `ProxyConfig | null` and `ProxyLocaleOverrides | null` |
| 21 | §5.3 (adapted) + R2 finding 4 | Migration 0371 CHECK constraints: no `username`/`password`/`secret` keys; `url` required; locale-overrides limited to `{timezone, locale, language}` with string values | PASS — both constraints present |
| 22 | §5.1 | `proxyAlignmentService.ts` + `proxyAlignmentServicePure.ts` | PASS |
| 23 | §6.1 | Per-field fallback defaults (UTC, en-US, `en-US,en;q=0.9`, `disable_non_proxied_udp`) | PASS |
| 24 | §6.1, §6.4 | Tenant-override precedence: overrides → GeoIP → default | PASS — `resolveField` correctly ordered |
| 25 | §12 | Proxy alignment telemetry events (resolved/partial/failed) | PASS — `ProxyAlignmentEventType` registered; service emits correct event per branch |
| 26 | §5.1 (revised at R2 finding 5) | `infra/geoip/` — NO bundled binary; `.gitignore` blocks `*.mmdb`/`*.tar.gz`; `README.md` documents deploy-time bootstrap | PASS |
| 27 | §5.1 (revised) | `scripts/bootstrap-geoip-db.sh` deploy-time download with idempotent skip + exit 0/1/2 codes | PASS |
| 28 | §5.1 (revised) | `infra/geoip/geoipReader.ts` mmdb-lib concrete reader; null-from-lookup when file absent; emits `geoip.db.source.selected` once per session | PASS |
| 29 | §8.4 | `geoipDbRefreshJob.ts`: queue `geoip-db-refresh`, singletonKey `geoip-db-refresh-active`, 60-min window, cron `0 4 * * 0` UTC, concurrency=1 | PASS — pure test asserts all four constants |
| 30 | §12 | GeoIP telemetry events (refreshed / refresh.failed / source.selected) | PASS — `GeoIpEventType` registered |
| 31 | §5.2, plan chunk 8 | `browserWarmPool.terminate` reason union extended with `'alignment_mutated'` | PASS |
| 32 | plan chunk 8 | `browserWarmPoolPure.shouldDestroyOnReturn` decision helper extracted for pure testing | PASS |
| 33 | §5.2 | `e2bSandbox.ts` task envelope extended with `proxyAlignment` + `proxyUrlEnvKey` (additive optional) | PASS |
| 34 | §5.2 | `harness/index.ts` reads `taskPayload.proxyAlignment` + `proxyUrlEnvKey`; documents Chromium flag + newContext apply pattern; stub-failure path preserved | PASS — apply pattern documented in comments; stub still emits `status: 'failed'` |
| 35 | §15, plan chunk 8 | `client/src/lib/copy/browserHardening.ts` with 3 verbatim Q13 disclosure strings | PASS — humanize / proxyAlignment / detectionHarness match spec §15 byte-for-byte |
| 36 | §11.1 | `proxyAlignmentServicePure.test.ts` — US/UK/JP/AU IPs, tenant override, partial fallback, redaction | PASS — 8 describe blocks incl. redaction |
| 37 | §10.3, plan chunk 7 | pg-boss singleton config validated by pure test | PASS |

---

## Requirements extracted — Phase 3 (humanize, Chunks 9–11)

| # | Spec ref | Requirement | Verdict |
|---|---|---|---|
| 38 | §6.2, §5.1 | `shared/types/humanize.ts` exports `HumanizeProfile`, `HumanizeOptions`, `PersistedHumanize` | PASS |
| 39 | §5.1, §6.2 | `humanizeInputsPure.ts` — `generateMouseCurve`, `generateTypingIntervals`, `generateScrollMomentum`; deterministic from seed via mulberry32 + Bezier | PASS |
| 40 | §5.1 | `humanizeInputs.ts` — `wrapClick`, `wrapType`, `wrapScroll` | PASS |
| 41 | §19.3, §11.1 | Pure tests: seed-replay determinism, per-profile latency bounds (light p99<100ms, balanced p99<300ms, heavy p99<750ms), unsupported-action fallback | PASS — bounds asserted over 1000-sample p99 |
| 42 | §5.2 | e2b envelope `humanize: HumanizeOptions | null` field added | PASS — `SandboxRunTaskInput:259` |
| 43 | §13 | Feature flag `humanize` — envelope null when off regardless of workflow value | PASS — `HUMANIZE_ENABLED` env-var check in `e2bSandbox.ts:371` |
| 44 | §5.2 | `harness/index.ts` reads `taskPayload.humanize`; documents wrap pattern; stub path preserved | PASS |
| 45 | §5.2 path (c), plan chunk 11 | `WorkflowDefinition.humanize?: PersistedHumanize` field added to `server/lib/workflow/types.ts` | PASS — optional field with JSDoc referencing BHP §4.3 / architect-pick item 9 |
| 46 | plan chunk 11 | `defineWorkflow.ts` JSDoc example demonstrates the humanize field | PASS |
| 47 | §10.6, plan chunk 11 | `validator.ts` rejects malformed humanize at workflow load time; `humanize_invalid` ValidationRule emitted | PASS — validator.ts:536-551 |
| 48 | §6.2 | `'off'` never persisted; absence (null) is the canonical off representation | PASS — `validateOptions` rejects `'off'` (test 'throws for invalid profile') |
| 49 | §6.2 | Unsupported-action fallback emits `browser.humanize.skipped` and never throws | PASS — all three `wrap*` helpers catch errors, emit skipped with `reason: 'wrapper_error'`, never rethrow |
| 50 | §12 | Humanize telemetry events (applied/skipped) | PASS — `HumanizeEventType` registered |

---

## Requirements extracted — Cross-cutting

| # | Spec ref | Requirement | Verdict |
|---|---|---|---|
| 51 | §12, §5.2 | All 11 telemetry event types registered in canonical registry `shared/types/sandbox.ts` | PASS — Harness (3) + ProxyAlignment (3) + GeoIp (3) + Humanize (2) = 11 |
| 52 | §13 | Three independent feature flags toggleable at runtime | PARTIAL — 2 of 3 wired at envelope layer (DETECTION_HARNESS_GATING, HUMANIZE_ENABLED); PROXY_ALIGNMENT documented in comments as the dispatch-layer responsibility, deferred-with-BHP-1 → see Directional Gap A |

---

## Mechanical fixes applied

None. Every concrete spec-named requirement was satisfied by the existing implementation.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

Both routed under `## Deferred from spec-conformance review — browser-hardening-primitives (2026-05-18)` in `tasks/todo.md`.

### Directional Gap A — PROXY_ALIGNMENT runtime flag check location

Plan chunk 8 explicitly assigns the `proxy-alignment` feature-flag check to the dispatch layer that calls `proxyAlignmentService.resolve`. At G2 the dispatch-layer wiring is intentionally deferred (BHP-1: no proxy-config UI in codebase) — `e2bSandbox.ts` ships envelope `null` by default with no flag check applied at the e2bSandbox layer. Consistent with chunk-8 architecture but should be revisited at the BHP-1 follow-up build to confirm the flag check lands at the resolve-call site. Non-blocking.

### Directional Gap B — Telemetry events declared as TS literal-union types only

REQs 9, 25, 30, 50 are PASS in that event names are registered as TypeScript literal-type unions in `shared/types/sandbox.ts` and emitted via `logger.info`/`console.log` JSON payloads. Spec §12 names the "canonical telemetry registry" but does not pin the registration mechanism (Zod schema, central emit map, etc.). Current posture is literal-union type + untyped emit sites — same as the rest of `shared/types/sandbox.ts`. Surfacing so a future audit can decide whether to harden into a typed emit helper. Non-blocking.

---

## Out-of-scope

- **Doc-sync surfaces** (`architecture.md § Key files per domain`, `docs/capabilities.md` Asset Register, `docs/doc-sync.md`). Spec §5.2 tags these `doc-sync` phase. Plan chunk-11 risks row 11: "the chunk-11 builder does NOT touch architecture.md". Handled by `finalisation-coordinator` Step 9.

---

## Files modified by this run

None.

---

## Next step

CONFORMANT — proceed to the next reviewer per Phase 2 GRADED-posture canonical order (adversarial if §5.1.2 surface → pr-reviewer → reality-checker → dual-reviewer). The two directional gaps are non-blocking follow-ups tied to deferred items (BHP-1, post-V1 hardening); no pre-merge action required.

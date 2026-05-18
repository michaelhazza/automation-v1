# Handoff — browser-hardening-primitives

**Phase complete:** SPEC
**Next phase:** BUILD (run `feature-coordinator` in a new session)
**Spec path:** tasks/builds/browser-hardening-primitives/spec.md
**Spec status:** accepted (LOCKED 2026-05-18 after chatgpt-spec-review R3)
**Branch:** browser-hardening-primitives
**Build slug:** browser-hardening-primitives
**Class:** Significant (three Standard sub-features bundled under one spec)
**UI-touching:** yes (thin — workflow config toggle + tenant proxy-config disclosure copy)
**Mockup paths:** n/a (operator skipped mockups; thin UI surface slots into existing settings/workflow patterns)
**Spec-reviewer iterations used:** 4 / 5 (stopped early on two-consecutive-clean-rounds; verdict READY_FOR_BUILD)
**ChatGPT spec review log:** tasks/review-logs/chatgpt-spec-review-browser-hardening-primitives-2026-05-18T01-00-00Z.md (3 rounds, 9 findings auto-applied, 100% closure)
**PR (spec-review draft):** [#349](https://github.com/michaelhazza/automation-v1/pull/349)

---

## Decisions made in Phase 1

### Operator-decided (grill or chat)

- **Lock override (S0):** prior wave-6 `MERGE_READY` lock overridden; PLANNING acquired for this build.
- **Mockups skipped:** thin UI surface (workflow toggle + tenant disclosure copy) slots into existing settings/workflow patterns; architect pins exact surface in spec citing existing components.
- **Build size:** three primitives ship in ONE build / ONE spec / ONE PR, phased across chunks. Operator instruction verbatim: "do it all in this one development pass, just in different steps or phases if required."
- **Phasing order:** detection harness FIRST (lowest blast radius, CI-only) → proxy alignment SECOND (proxy-conditional opt-in) → humanize THIRD (broadest behavioural reach; gated by Phase 1 harness).
- **Q3 humanize surface:** BOTH per-call (`page.click(sel, { humanize: 'balanced', seed: 42 })`) AND session-level default (`launchHumanized({ profile, seed })`); per-call overrides session-level.
- **Q4 profile policy:** `off | light | balanced | heavy`; per-action p99 latency ceilings <100ms / <300ms / <750ms.
- **Q5 GeoIP provider:** embedded MaxMind GeoLite2 (open-source, weekly refresh); vendor isolation invariant keeps it reversible.
- **Q6 warm-pool reset vs destroy:** **destroy** (simpler, provably correct; only proxy-aligned sessions pay boot cost).
- **Q7 CI harness cadence:** hybrid — per-PR blocking (5–10 stable sites against cached fixtures, <2 min) + nightly advisory (full 30-site live, <15 min); per-site flag `blocking | nightly | advisory | disabled`.
- **Q8 baseline ownership trigger:** three-strikes-without-code-change → recalibrate; quarterly health check as safety net.
- **Q9 telemetry vocabulary:** 11 events locked (humanize.applied/skipped; proxy.alignment.resolved/failed/partial; detection.harness.run.completed/regression; detection.harness.baseline.updated; geoip.db.refreshed/refresh.failed/source.selected).
- **Q10 humanize latency rejection threshold:** +30% p95 over baseline on architect-defined benchmark workflow (non-gating advisory; manual sanity check at build time per framing).
- **Q11 internal harness-history UI:** defer; V1 ships CI alerts + `harness_run_history` DB table only.
- **Q12 baseline weakening gate:** commit-message trailer `Baseline-Weakening-Approved-By: <reviewer>`; PR labels rejected (fragile post-merge). Gate also covers mode downgrades (R1 finding 3).
- **Q13 tenant disclosure copy:** locked reliability-framed wording for humanize toggle, proxy alignment, detection harness.

### Auto-decided (technical, no operator escalation)

- **Q1 file-inventory grounding fix (CRITICAL):** the brief's `worker/src/browser/executor.ts` and `playwrightContext.ts` references are STALE — PR #345 (iee-worker-retirement, merged 2026-05-17) deleted the entire `worker/` directory. PR #297 (iee-browser-on-e2b) redirected browser execution to e2b sandboxes. Spec lands all primitives at the e2b harness layer (`infra/sandbox-templates/iee-browser/harness/`) + e2b SDK shim (`server/services/sandbox/e2bSandbox.ts`) + warm-pool layer (`server/services/sandbox/browserWarmPool.ts`). The real Playwright executor is currently a STUB at `infra/sandbox-templates/iee-browser/harness/index.ts` — all primitives implement against the contract behind the stub boundary; integration with the real executor lands when the e2b SDK is wired in (per `tasks/builds/sandbox-safety-batch/req-57-decision.md`).
- **9 ChatGPT findings (R1+R2+R3)** auto-applied per the chatgpt-spec-review log above. No user-facing escalations.

## Open questions for Phase 2 (for `architect` to resolve at chunk authoring)

All 10 architect-pick items are documented in `spec.md §17`. They are NOT operator-blocking. The architect resolves at chunk authoring with rationale documented in `progress.md`.

1. Per-PR detection-site subset (5–10 sites)
2. Exact per-profile latency budget calibration (within the locked <100/<300/<750ms ceilings)
3. Benchmark workflow for end-to-end latency threshold
4. Cron schedule for GeoLite2 refresh (`0 4 * * 0 UTC` recommended)
5. MaxMind GeoLite2 update URL + auth (standard secrets system)
6. Exact reviewer list for `Baseline-Weakening-Approved-By:` trailer
7. e2b SDK availability for per-PR vs nightly
8. Tenant proxy-configuration UI (does it land here, in parallel build, or defer?)
9. Humanize persistence target — per-template column / per-run column / code-level `defineWorkflow()` field
10. Tenant-config source for proxyConfig + locale/timezone/language overrides — **RECOMMENDED DEFAULT** extends `subaccountSettings` with `proxyConfig JSONB` + `proxyLocaleOverrides JSONB`; architect deviates only with documented rationale

## Build-side notes for `feature-coordinator`

### Phase order (chunks)

1. **Phase 1 — Detection harness:** harness suite, baselines, fixtures, CI workflow, `harness_run_history` table + writer, `verify-baseline-weakening-approval.sh` gate (covers tolerance widening AND mode downgrades).
2. **Phase 2 — Proxy alignment:** `proxyAlignmentService` + pure module + GeoLite2 bundled-fallback + env-configured runtime path + `geoipDbRefreshJob` (pg-boss, singleton key), e2b envelope extension, warm-pool destroy-on-alignment-mutation, `subaccountSettings` proxyConfig + proxyLocaleOverrides columns (conditional on §17 Q10 default).
3. **Phase 3 — humanize:** `humanizeInputsPure` + `humanizeInputs` consumer wrapper, e2b envelope extension, harness wraps Playwright action calls, workflow-config persistence + UI (conditional on §17 Q9 path).

### Feature flags (independent, runtime-togglable)

- `detection-harness-gating` — blocking vs advisory
- `proxy-alignment` — auto-applies when proxy configured
- `humanize` — workflow-level humanize field is read at dispatch

### Acceptance independence

Per brief §"Success criteria" — each primitive ships, rolls back, or pauses without forcing the others. Three independent gates in §19.1, §19.2, §19.3 of the spec.

### Critical contracts (don't drift)

- `ProxyAlignment` envelope shape: `{ timezone, locale, language, webrtcPolicy } | null` (§6.1)
- `HumanizeOptions`: `{ profile, seed } | null` where null = off (§6.2)
- `HarnessRunResult` outcome enum: `'pass' | 'fail' | 'baseline_established' | 'site_unavailable' | 'parse_error'` (§6.3 — closed enum, requires spec amendment to extend)
- **Blocking failure set for CI:** `{ 'fail', 'parse_error' }` (§8.1) — `site_unavailable` never blocks; advisory/nightly never blocks
- **No raw IPs, no raw GeoIP payloads, no proxy credentials in telemetry events** (§12) — hashed / coarse identifiers only
- **`proxyConfig` JSONB shape:** `{ url: string, credentialId?: string }` — NEVER `{ username, password }` (locked at chatgpt-plan-review R2 finding 4). Credentials live in `credentialBrokerService`; the JSONB column only carries the opaque broker ref. Migration CHECK constraint enforces this at the DB layer.
- **Credential injection mechanism:** `credentialBrokerService.injectIntoEnvironment` at sandbox-launch time, NEVER in `taskPayload` body. Envelope carries only `proxyUrlEnvKey` (env-var name); harness reads `process.env[taskPayload.proxyUrlEnvKey]`.
- **No bundled GeoLite2 binary** (locked at chatgpt-plan-review R2 finding 5). `infra/geoip/.gitignore` blocks `*.mmdb`; deploy-time `scripts/bootstrap-geoip-db.sh` is the only path to acquiring the DB; `GEOIP_LICENCE_KEY` unset = graceful no-GeoIP degradation (proxy still works at network layer, alignment skipped).

### Static gates expected to land

- `scripts/gates/verify-baseline-weakening-approval.sh` — detects baseline tolerance widening AND per-site mode downgrades; requires `Baseline-Weakening-Approved-By:` trailer

### Doc-sync surfaces (to update at finalisation)

- `architecture.md § Key files per domain` — add `proxyAlignmentService`, `humanizeInputs`, `browser-detection-harness` rows
- `docs/capabilities.md` — Asset Register: add `browser-hardening-primitives` row (cluster: Agent Runtime, Audit & Governance; lifecycle: Inception)
- `docs/doc-sync.md` — add row for this build's doc-sync surfaces
- `KNOWLEDGE.md` — session-activity decision (any new patterns surfaced during build)

### Forbidden vocabulary (drift check)

NO `stealth`, `evade`, `bypassDetection`, `antiFingerprint`, `undetectedBrowser`, `cloak`, `ghost` anywhere — module names, classes, functions, flags, telemetry events, config keys, copy. Reliability-framed names only.

---

## Spec deviations (framing departures ratified at plan-gate)

- **BHP-2 (chatgpt-plan-review R1 finding 1, ratified 2026-05-18):** spec §3 + §4.1 + §8.1 require nightly harness to hit live external sites via real e2b ("Nightly runs hit live external sites for the full 30-site suite as advisory signal"). V1 ships with **cached-fixture-only nightly** because the e2b SDK is not installed (per `tasks/builds/sandbox-safety-batch/req-57-decision.md`). Phase 2 (proxy alignment) and Phase 3 (humanize) ship without a live-browser-fingerprint regression gate in V1; they still benefit from the cached-fixture harness for code-side regression detection. Operator decision: "Ship V1 with cached-only + framing departure". Live-e2b nightly wiring is tracked as `BHP-2` in `tasks/todo.md` and is the first post-V1 follow-up for this build. Phase 3 chatgpt-pr-review re-validates this departure at finalisation.

---

## Deferred items routed to tasks/todo.md or post-merge backlog

- **BHP-1** (`tasks/todo.md`): tenant proxy-configuration UI doesn't exist in codebase yet. Architect addresses at Phase 2 via Q8/Q9/Q10 in §17.
- **Real-Playwright executor wiring** (§16 spec): pending e2b SDK installation per `tasks/builds/sandbox-safety-batch/req-57-decision.md`. Primitives ship behind harness stub; wire-up is separate build.
- **Internal-staff harness-history dashboard UI** (§16 spec): defer to V2.
- **Firefox / WebKit parity** (§16 spec): defer until workflow demand justifies.
- **Reset-in-place warm-pool sessions** (§16 spec): defer post-V1 if boot cost becomes meaningful.
- **Managed GeoIP provider** (§16 spec): defer unless GeoLite2 accuracy proves insufficient.
- **REQ #57 credential value-threading** (§16 spec): out of scope (separate v2-deferred backlog).

---

## Provenance

- Brief: `tasks/builds/browser-hardening-primitives/brief.md` (v3 spec-ready, 2026-05-18)
- Intent: `tasks/builds/browser-hardening-primitives/intent.md` (2026-05-18, includes 13-question grill log)
- Source pattern: CloakHQ/CloakBrowser (MIT, pattern lift only — Chromium fork NOT adopted, no stealth language)
- Duplication / Strategy Check: clear / clear / proceed
- Sequenced before: `browser-vision-grounding` (decision layer above); `iee-browser-on-e2b` (substrate, already merged 2026-05-17)

---

## Phase 2 launch instruction

To start Phase 2 (BUILD), open a new Claude Code session and type:

```
launch feature coordinator
```

The new session reads this handoff, invokes `architect` to decompose the locked spec into chunks, runs the plan gate, then drives per-chunk `builder` runs with G1 gate per chunk.

---

## Phase 2 (BUILD) — complete

**Phase complete:** BUILD
**Next phase:** FINALISATION (run `launch finalisation` in a new session OR continue inline)
**Plan path:** `tasks/builds/browser-hardening-primitives/plan.md` (LOCKED — 11 chunks across 3 phases; chatgpt-plan-review R1+R2 closed 5 findings)
**Branch HEAD at handoff:** `5f0ebfd5`
**Task class:** Significant
**Chunks built:** 11 of 11 (commits `99d0fc31`…`f34a743e`). G1 attempts: 1 for chunks 1-8, 11; 2 for chunk 9; 3 for chunk 10.
**G2 verdict:** PASS — lint 0 errors / 872 pre-existing warnings; typecheck clean; build:server clean; build:client clean.
**Migrations added:** 0370 (`harness_run_history`), 0371 (`subaccount_iee_browser_settings_add_proxy_config`). Both ship `.down.sql` companions (added during pr-reviewer fix-loop).
**New npm dep:** `mmdb-lib@3.0.2` (GeoIP reader).

### Phase 2 branch-level review pass

**spec-conformance:** CONFORMANT (50/52 spec requirements pass; 2 non-blocking directional gaps routed to backlog as `BHP-CONF-A` flag-read-site, `BHP-CONF-B` typecheck-binding-of-telemetry-registry; both pre-ratified spec deviations acknowledged in log). Log: `tasks/review-logs/spec-conformance-log-browser-hardening-primitives-2026-05-18T04-17-52Z.md` (commit `df0218ec`).

**pr-reviewer Round 1:** CHANGES_REQUESTED (3 Blocking / 4 Should-fix / 3 Consider). Fix commit `1100de60` closed all 3 Blockers:
- Added `.down.sql` companions for migrations 0370 and 0371 (rollback path; matches 0361-0369 convention).
- Migration 0371 `chk_proxy_locale_overrides_shape` now includes the binding-minimum `(proxy_locale_overrides - 'timezone' - 'locale' - 'language') = '{}'::jsonb` predicate per spec §5.3.
- Migration 0371 `chk_proxy_config_no_raw_credentials` switched from deny-list to closed-set allow-list `(proxy_config - 'url' - 'credentialId') = '{}'::jsonb` (strictly stronger; future credential-shaped keys cannot leak).
- New `server/tests/browser-detection-harness/__tests__/runHarnessExitCodePure.test.ts` — 12 cases covering the spec §8.1 truth table; 12/12 pass.
- `runHarness.ts` CLI-entry import-guard so the pure test can import the helper without triggering main().
- Workflow `push.branches` trigger removed (was branch-pinned; would never fire post-merge).

**pr-reviewer Round 2:** APPROVED (0 / 0 / 0). All R1 Blockers verified closed.

**reality-checker:** READY (6/6 stated criteria verified — all locked critical contracts honoured: forbidden vocab absent, HarnessRunResult enum closed, proxyConfig closed-set CHECK, credentials never serialised in envelope, no bundled GeoLite2, allowlist + fetch-depth on gate).

**adversarial-reviewer:** HOLES_FOUND (2 likely-holes, 3 worth-confirming). Log: `tasks/review-logs/adversarial-review-log-browser-hardening-primitives-2026-05-18T05-30-00Z.md` (commit `2d8c4bb3`). Resolution:
- T1 (workflow_dispatch bypass) — **fixed**: removed `workflow_dispatch` from `per_pr_blocking` job (gate is meaningful only on PR events).
- F1 (no concurrency group) — **fixed**: added concurrency group with `cancel-in-progress`.
- D1 (licence-key leak via subprocess stderr) — **fixed**: redact `license_key=…` from `error.message` before logging.
- D2 (env vars missing from manifest) — **fixed**: registered `GEOIP_LICENCE_KEY` and `GEOIP_RUNTIME_DIR` in `docs/env-manifest.json`.
- S1 (trailer-handle not author-validated) — **backlogged as `BHP-ADV-S1`** pending operator design decision on GitHub-API author check vs branch-protection dependency. Non-blocking.

**dual-reviewer:** APPROVED (2 iterations, 0 production-code fixes accepted, 1 backlog routed). Log: `tasks/review-logs/dual-review-log-browser-hardening-primitives-2026-05-18T05-12-59Z.md` (commit `0dbbd330`). Three Codex findings all rejected after adjudication:
- P1 — Vitest collection of `sites/*.test.ts` (FP: restrictive `include` allowlist; empirical Vitest run confirms exclusion).
- P2 — `geoipDbRefreshJob` not wired into pg-boss startup (real gap, but the downstream real-Playwright executor is itself unwired per BHP-2; would touch 4 files for zero V1 benefit). Routed as `BHP-DR-1`.
- P3 — `boss.schedule` missing `{ tz: 'UTC' }` (FP: pg-boss source defaults `tz = 'UTC'`; 40+ existing call sites omit it).

**Fix-loop iterations (pr-reviewer):** 1 (R1 → fix → R2 APPROVED).
**Fix-loop iterations (adversarial-reviewer):** 0 (4 fixes applied inline in the adversarial commit; 2 routed to backlog).
**Fix-loop iterations (dual-reviewer):** 0 (Codex findings adjudicated rejected/backlog; no production-code changes).

**REVIEW_GAP entries:** none — every required reviewer ran end-to-end against the GRADED Significant-class matrix.

### Spec deviations (carry forward to finalisation chatgpt-pr-review)

1. **BHP-2 framing departure** — V1 nightly harness uses CACHED FIXTURES ONLY. Spec §3 + §4.1 + §8.1 envisioned live-e2b nightly runs. Departure ratified at plan-gate (chatgpt-plan-review R1 finding F1). The live-flip lands when the e2b SDK install build ships. Tracked in `tasks/todo.md` as `BHP-2`.
2. **subaccountSettings → subaccount_iee_browser_settings** — spec named a non-existent table; plan extends the existing IEE-browser settings table. Locked at plan-gate. RLS posture inherited from migration 0347 (FORCE RLS + dual-GUC org+subaccount policy).
3. **No bundled GeoLite2 binary** — spec §10.2 + §15 described a bundled fallback `.mmdb`. Plan-review R2 finding F5 removed the bundled binary entirely; deploy-time-only acquisition via `scripts/bootstrap-geoip-db.sh`. `infra/geoip/.gitignore` blocks the binary.
4. **`proxyConfig` JSONB shape** — spec §5.3 row 3 described `{ url, username?, password? }`. The locked contract is `{ url, credentialId? }` with a closed-set CHECK; credentials NEVER in proxyConfig.
5. **Credential injection wiring deferred** — `credentialBrokerService.injectIntoEnvironment` is named in the spec but its proxy-specific wiring did not ship in V1 (no proxy-config UI exists; nothing currently triggers it). The `proxyUrlEnvKey` envelope field is plumbed; the broker call site is a placeholder. Wiring lands with the BHP-1 follow-up build.

### Open issues for finalisation (surface to operator before merge)

1. **8 deferred items in `tasks/todo.md`** (none blocking V1): BHP-1, BHP-2, BHP-CONF-A, BHP-CONF-B, BHP-ADV-S1, BHP-ADV-N1, BHP-DR-1.
2. **No new tenant-facing UI** — all three primitives ship at the data + CI + envelope layer. UX surfaces deferred per the plan's path (c) for humanize, BHP-1 for proxy-config UI.
3. **Doc-sync work for Phase 3 finalisation:**
   - `architecture.md § Key files per domain` — add rows for `proxyAlignmentService`, `geoipDbRefreshJob`, `geoipReader`, `runHarness` (browser-detection-harness), `verify-baseline-weakening-approval.sh`, `humanizeInputsPure`.
   - `docs/capabilities.md` — Asset Register row for `browser-hardening-primitives` (cluster: Agent Runtime; lifecycle: Inception). Capability Registration verdict: `yes: create new capability record`.
   - `docs/doc-sync.md` — add row for this build's doc-sync surfaces.
   - `KNOWLEDGE.md` — pattern candidates: closed-set CHECK over deny-list for credential-shaped JSONB; CLI-entry guard for testable runHarness modules; `workflow_dispatch` triggers an empty diff against default branch (gate bypass class); MaxMind licence-key redaction in subprocess stderr logs.

### Critical contracts (locked — do not drift)

- No forbidden vocabulary anywhere: `stealth | evade | bypassDetection | antiFingerprint | undetectedBrowser | cloak | ghost`.
- `HarnessRunResult` outcome enum CLOSED: `'pass' | 'fail' | 'baseline_established' | 'site_unavailable' | 'parse_error'`. Blocking failure set: `{ 'fail', 'parse_error' }`. Migration CHECK and TS type must match.
- `proxyConfig` JSONB closed-set: `{ url, credentialId? }`. CHECK enforces `(proxy_config - 'url' - 'credentialId') = '{}'::jsonb`. No raw credentials of any kind.
- Credentials NEVER in `taskPayload`, telemetry, `/workspace/input.json`. Only env-var NAMES (`proxyUrlEnvKey`) travel through the envelope.
- No bundled GeoLite2 binary. `infra/geoip/.gitignore` blocks; deploy-time-only acquisition via `scripts/bootstrap-geoip-db.sh`. `GEOIP_LICENCE_KEY` unset = graceful degradation.
- Baseline-weakening gate scans `git log origin/main..HEAD --format=%B`; CI uses `fetch-depth: 0`. V1 allowlist `{ '@michaelhazza', 'michaelhazza' }` (string-match; commit-author validation deferred as `BHP-ADV-S1`).
- RLS on `subaccount_iee_browser_settings` inherited from migration 0347 (FORCE RLS + dual-GUC). New columns inherit. `harness_run_history` is system-scoped (NOT in `rlsProtectedTables.ts`); writer uses `withAdminConnection({ skipAudit: true })`.

---

**Phase 2 closed:** 2026-05-18. Branch ready for `launch finalisation` (Phase 3).

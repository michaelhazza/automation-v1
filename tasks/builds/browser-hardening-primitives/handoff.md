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

# Plan — browser-hardening-primitives

**Author:** architect (sub-agent, this session)
**Plan date:** 2026-05-18
**Build slug:** browser-hardening-primitives
**Source spec:** [`tasks/builds/browser-hardening-primitives/spec.md`](./spec.md) (LOCKED 2026-05-18, status: accepted)
**Source handoff:** [`tasks/builds/browser-hardening-primitives/handoff.md`](./handoff.md)
**Total chunk count:** 11 (Phase 1: 4 chunks; Phase 2: 4 chunks; Phase 3: 3 chunks)

---

## Table of contents

- Model-collapse check
- Section 1 — Architecture notes
- Section 2 — Chunk plan
  - Chunk 1 — `harness-history-table-and-writer`
  - Chunk 2 — `harness-runner-and-baseline-gate`
  - Chunk 3 — `harness-baseline-corpus-expansion`
  - Chunk 4 — `harness-ci-workflow-and-feature-flag`
  - Chunk 5 — `proxy-alignment-types-and-schema`
  - Chunk 6 — `proxy-alignment-service-pure-and-consumer`
  - Chunk 7 — `geoip-db-and-refresh-job`
  - Chunk 8 — `proxy-alignment-envelope-warmpool-and-flag`
  - Chunk 9 — `humanize-pure-module-and-types`
  - Chunk 10 — `humanize-envelope-and-harness-consumer`
  - Chunk 11 — `humanize-workflow-config-and-flag`
- Section 3 — Risks and mitigations (per-chunk)
- Section 4 — Open architect notes for the operator
- Appendix — Provenance

---

## Model-collapse check

The three primitives are: (1) deterministic seeded curve generation for input timing (pure math: bezier evaluation, seeded RNG), (2) GeoIP DB lookup (binary-file query), (3) HTML-page detection-score harness (runtime Chromium test against external sites). None decompose into ingest→extract→transform→render, and none are LLM-collapsable: seed→curve is closed-form arithmetic that must be deterministic (LLMs are non-deterministic by construction); GeoIP is a binary-DB lookup with no semantic reasoning; the harness boots a real Chromium against real detection sites and inspects fingerprint output that no LLM can synthesise. Model collapse is **rejected** — wrong tool class for the problem. The spec's three-primitive shape is correct.

---

## Section 1 — Architecture notes

### Layered landing

- **Detection harness** lives entirely under `server/tests/browser-detection-harness/` (TS test files, baselines, fixtures, runner) plus a CI workflow file at `.github/workflows/browser-detection-harness.yml` plus a static gate at `scripts/gates/verify-baseline-weakening-approval.sh` plus a new DB table at `harness_run_history` (system-scoped, RLS opt-out documented). No service-layer surface; no routes.
- **Proxy alignment** lives at three layers: pure module + consumer service at `server/services/sandbox/proxyAlignment{Service,ServicePure}.ts`; GeoLite2 DB + pg-boss refresh job at `infra/geoip/` + `server/jobs/geoipDbRefreshJob.ts`; e2b envelope extension at `server/services/sandbox/e2bSandbox.ts`; harness consumer at `infra/sandbox-templates/iee-browser/harness/index.ts`; warm-pool destroy semantics at `server/services/sandbox/browserWarmPool.ts`; tenant-config source via extension of the existing `subaccount_iee_browser_settings` table (NOT a new `subaccountSettings` table — see §17 Q10 resolution below).
- **humanize** lives at the harness layer: pure module + consumer at `infra/sandbox-templates/iee-browser/harness/humanizeInputs{Pure,}.ts`; shared types at `shared/types/humanize.ts`; envelope extension at `server/services/sandbox/e2bSandbox.ts`; per-workflow config as a code-level field on `defineWorkflow()` (§17 Q9 resolution: path (c) — no UI, no migration).

This exactly matches the handoff Q1 file-inventory-grounding decision: every primitive lands at the e2b harness layer + e2b SDK shim + warm-pool layer, behind the executor stub boundary.

### Resolutions for the 10 architect-pick items (handoff §"Open questions for Phase 2")

| # | Item | Resolution |
|---|---|---|
| 1 | Per-PR detection-site subset | RESOLVE: 5 sites — `browserscan`, `bot.incolumitas`, `deviceandbrowserinfo`, `whoer`, `pixelscan`. Cached-fixture-friendly; each known-stable in industry harness literature. |
| 2 | Per-profile latency calibration | RESOLVE: `light` 50ms median / 90ms p99; `balanced` 150ms / 280ms; `heavy` 380ms / 700ms. All under the locked ceilings (<100/<300/<750ms). |
| 3 | Benchmark workflow for end-to-end latency | RESOLVE: lead-enrichment public-data scrape (5-step workflow). Run manually at build time as the non-gating advisory check per spec §19.3. |
| 4 | Cron for GeoLite2 refresh | RESOLVE: `0 4 * * 0 UTC` (Sunday 4am UTC) per handoff recommendation. |
| 5 | MaxMind URL + auth | RESOLVE: secret `GEOIP_LICENCE_KEY`; URL `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${KEY}&suffix=tar.gz`. |
| 6 | Reviewer list for trailer | RESOLVE: gate validates the trailer's handle against an **allowlist**. V1 allowlist is `@michaelhazza` only (matches spec §14 "approved reviewer" requirement; ratified at plan-gate after chatgpt-plan-review R1 finding 3). Adding a reviewer is a one-line edit in the gate script, scope-controlled by the same gate (gate-script changes are not baseline-weakening so do not require their own trailer). Per spec §14, the architect locks the list at build time; this resolution locks it to a single handle. |
| 7 | e2b SDK availability | PUNT (documented as a **framing departure from spec §3 + §4.1 + §8.1 nightly-live posture**): e2b SDK is NOT installed (per `tasks/builds/sandbox-safety-batch/req-57-decision.md`). Per-PR AND nightly jobs run against cached fixtures only in V1. Live-e2b nightly run deferred to the e2b SDK install build. Ratified at plan-gate after chatgpt-plan-review R1 finding 1; operator decision = "Ship V1 with cached-only + framing departure". Departure recorded in handoff.md `spec_deviations:` field and surfaced at Phase 3 finalisation (chatgpt-pr-review). Post-V1 follow-up item added to `tasks/todo.md`: `BHP-2 — Wire live e2b nightly run once e2b SDK lands`. |
| 8 | Tenant proxy-config UI | PUNT (documented per BHP-1): no proxy-config UI exists in the codebase. Disclosure copy file `client/src/lib/copy/browserHardening.ts` ships in this build for later use; UI integration deferred to a follow-up build. Spec §15 "existing tenant proxy-settings component" row becomes a no-op for V1. |
| 9 | Humanize persistence target | RESOLVE: path (c) — code-level field on `defineWorkflow()`. Rationale: workflows are already code-defined; no UI saves V1 from `HumanizeToggle.tsx` + `WorkflowStudioPage.tsx` change; no migration; cleanest. Skips spec §5.2 migration (`<NNNN>_<target>_add_humanize.sql` not emitted) and spec §15 UI component. |
| 10 | Tenant-config source for proxyConfig | RESOLVE (deviation from spec recommended default): extend the existing `subaccount_iee_browser_settings` table — NOT a new `subaccountSettings` table. Rationale: (a) `subaccountSettings` does not exist in the codebase (spec author error — see Section 4); (b) `subaccount_iee_browser_settings` is the natural IEE-browser-scoped tenant settings table, already in `RLS_PROTECTED_TABLES`, already dual-GUC. Adding `proxyConfig JSONB` + `proxyLocaleOverrides JSONB` columns inherits the existing RLS posture. Documented in progress.md per spec §17 Q10 deviation contract. |

### Risks and mitigations (architectural)

- **e2b SDK stub boundary:** real Chromium execution does not happen yet (stub at `infra/sandbox-templates/iee-browser/harness/index.ts` exits with `status: 'failed'`). All three primitives implement against the stub-side contract: the pure modules + envelope field plumbing land behind the stub. Phase 2 and 3 harness-side wiring is dead code at runtime until the SDK lands, but exercises full type checking and pure-function tests now. Mitigation: every harness-layer change preserves the "executor not yet wired" failure path; the stub must continue to emit `status: 'failed'` for any input lacking a wired executor.
- **Vendor isolation on `proxyAlignmentService`:** the pure module owns schema translation (IP → `{ timezone, locale, language }`); the consumer service owns the GeoLite2 file IO. Swapping vendors later touches only the consumer service, never callers. Mitigation: the GeoIP DB layer (chunk 7) and the alignment service (chunk 6) ship as **separate chunks** so the boundary is proven by file-level isolation, not just by convention.
- **Forbidden-vocabulary drift:** any module/class/function/flag/event named with `stealth | evade | bypassDetection | antiFingerprint | undetectedBrowser | cloak | ghost` fails review. Mitigation: every chunk's identifier list is reviewed against the forbidden set before commit; a one-line grep check `git diff --name-only | xargs grep -i -E '(stealth|evade|bypass[Dd]etection|antiFingerprint|undetectedBrowser|cloak|ghost)'` returning empty is the local pre-flight.
- **Baseline-weakening gate runs PRE-merge:** the gate is invoked as a CI pre-step on the per-PR job (per spec §5.1 CI workflow row). At gate-run time the squash commit does NOT exist yet — only the PR's branch commits exist. The gate must scan branch commits, not the merge commit. (Corrected at chatgpt-plan-review R1 finding 2.) Mitigation: gate greps `git log origin/main..HEAD --format=%B` for the `Baseline-Weakening-Approved-By:` trailer (any branch commit qualifies). Self-test fixture proves the branch-commit case passes and the no-trailer case fails. Squash-merge behaviour is incidental: GitHub copies the PR description (which by convention includes branch commit messages) into the squash commit, but the gate never depends on that copying happening — the gate runs before merge.
- **pg-boss singleton enforcement for `geoipDbRefreshJob`:** if `singletonKey` is misconfigured or worker concurrency >1, two refresh jobs can race the atomic file swap. Mitigation: job is registered with `singletonKey: 'geoip-db-refresh-active'`, `singletonMinutes: 60`, worker concurrency `1`; the chunk's pure-function tests assert the registration shape (queue name + singleton key + concurrency = 1).

---

## Section 2 — Chunk plan

Phase order strictly follows the handoff §"Build-side notes for `feature-coordinator` → Phase order (chunks)". Within each phase, chunks are forward-only — no later chunk's contract depends on a chunk that lands after it.

---

### Chunk 1 — `harness-history-table-and-writer`

**spec_sections:** §4.1, §5.1 (4 rows), §5.3 (migration 1), §6.3, §6.4 first bullet, §7.1, §8.1 (writer behaviour), §10.1 (writer idempotency posture), §10.4 (terminal event), §12 (3 harness events + `harness_run_history` writer event), §19.1 (third bullet)

**Files:**
- CREATE `server/db/schema/harnessRunHistory.ts`
- CREATE `migrations/0370_create_harness_run_history.sql`
- CREATE `server/tests/browser-detection-harness/harnessHistoryWriterPure.ts`
- CREATE `server/tests/browser-detection-harness/harnessHistoryWriter.ts`
- CREATE `server/tests/browser-detection-harness/__tests__/harnessHistoryWriterPure.test.ts`

**Module shape:**
- *Public interface:* `harnessHistoryWriter.write(result: HarnessRunResult): Promise<void>` (best-effort, throws-on-DB-error so caller can log + proceed); `harnessHistoryWriterPure.toRow(result: HarnessRunResult): NewHarnessRunHistory`; the `HarnessRunResult` TS type itself (closed outcome enum per §6.3); the `harnessRunHistory` Drizzle table.
- *What stays hidden:* DB connection acquisition (uses `withAdminConnection` because the table is system-scoped, NOT `getOrgScopedDb`); column-default handling; the per-site mapping from raw detection-site output to normalised `score` (lives in chunk 2's per-site files); the closed outcome enum's TS literal-type assembly.

**Contracts:**
- `HarnessRunResult` (per spec §6.3): closed enum `'pass' | 'fail' | 'baseline_established' | 'site_unavailable' | 'parse_error'`. `baselineScore`, `baselineTolerance` nullable when `outcome: 'baseline_established'`.
- `harness_run_history` Drizzle table: columns `id uuid pk default gen_random_uuid()`, `site_slug text not null`, `mode text not null` (CHECK `mode IN ('blocking','nightly','advisory','disabled')`), `score numeric(4,3)`, `baseline_score numeric(4,3)`, `baseline_tolerance numeric(4,3)`, `outcome text not null` (CHECK `outcome IN ('pass','fail','baseline_established','site_unavailable','parse_error')`), `browser_version text not null`, `playwright_version text not null`, `template_digest text not null`, `run_at timestamptz not null default now()`. No `organisation_id` column. Index on `(site_slug, run_at DESC)`.
- Migration `0370_create_harness_run_history.sql` includes the canonical header comment `-- system-scoped: harness operational telemetry, not tenant data; documented opt-out in spec §7.1` per DEVELOPMENT_GUIDELINES §6.3.
- Telemetry registry: events `browser.detection.harness.run.completed`, `browser.detection.harness.run.regression`, `browser.detection.harness.baseline.updated` registered in `shared/types/sandbox.ts` (the canonical sandbox-telemetry types file — confirmed in primitives-reuse search).

**Error-handling strategy:**
- DB write error: writer logs `harness.history.write_failed { siteSlug, err.code }` and **throws** (caller `runHarness` swallows). Append-only; no unique-constraint collision possible.
- Malformed `HarnessRunResult` (missing required field): pure module throws `Error('harnessHistoryWriterPure: invalid result shape: ' + JSON.stringify(missingFields))` before DB call.
- `withAdminConnection` failure: bubbles up (writer cannot proceed; CI exit code is in-memory-driven per §6.4 so writer failure does not change CI status).

**Dependencies:** none.

**Acceptance signals (for next chunk):**
- Table `harness_run_history` exists in latest migration set and is queryable.
- Writer can be imported and called with a `HarnessRunResult`; pure tests prove shape normalisation.
- Telemetry registry recognises the 3 harness events (typecheck pass on `shared/types/sandbox.ts`).

**Verification commands (chunk-local only):**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/tests/browser-detection-harness/__tests__/harnessHistoryWriterPure.test.ts`
- `npm run db:generate` (verify migration shape)

---

### Chunk 2 — `harness-runner-and-baseline-gate`

**spec_sections:** §4.1, §5.1 (6 rows: `runHarness.ts`, 1 reference site test + baseline + fixture, gate script; CI workflow ROW deferred to chunk 4), §6.3, §8.1, §10.5 first bullet, §12 (events emit), §19.1 (gate behaviour bullets 4 and 5)

**Files:**
- CREATE `server/tests/browser-detection-harness/runHarness.ts`
- CREATE `server/tests/browser-detection-harness/sites/browserscan.test.ts` (reference site; first to ship)
- CREATE `server/tests/browser-detection-harness/baselines/browserscan.baseline.json`
- CREATE `server/tests/browser-detection-harness/fixtures/browserscan.html`
- CREATE `scripts/gates/verify-baseline-weakening-approval.sh`

**Module shape:**
- *Public interface:* CLI `npx tsx server/tests/browser-detection-harness/runHarness.ts --mode=blocking|full` (per §8.1); per-site contract `{ slug, mode: 'blocking'|'nightly'|'advisory'|'disabled', test: async (page) => score }`; gate script CLI `bash scripts/gates/verify-baseline-weakening-approval.sh` (exit 0 = pass, exit 1 = blocking violation found, exit 2 = environment error).
- *What stays hidden:* per-site Playwright assertion mechanics; the cached-fixture loader (reads `fixtures/<slug>.html` and serves it via a local data URL or file:// scheme); the exit-code calculator (computes from in-memory `HarnessRunResult[]` per §8.1 precise contract); the gate's commit-history walker (uses `git log --format=%B` from `origin/main..HEAD`) and trailer regex.

**Contracts:**
- `runHarness` exit code per spec §8.1 EXACTLY: nonzero (1) iff `(detection-harness-gating` flag on) AND (≥1 `blocking` site with outcome in `{ 'fail', 'parse_error' }`) AND (CLI invoked with `--mode=blocking`). All other cases exit 0.
- Per-site test file exports default `{ slug: 'browserscan', mode: 'blocking', test: async (page) => number /* normalised [0,1] */ }`.
- Baseline JSON shape: `{ score: number, tolerance: number }`. First-time write happens when `runHarness` sees no baseline file for an enabled site (emits `baseline_established` outcome; gate ALLOWS file creation — establishment is not weakening).
- Gate detects two violation classes per spec §5.1 gate row: (a) `tolerance` increased OR `score` decreased on existing baseline file (tolerance-widening); (b) per-site `mode` field downgraded along the chain `blocking > nightly > advisory > disabled`. Both classes require a `Baseline-Weakening-Approved-By: <handle>` trailer in **any of the PR's branch commit messages** (gate runs PRE-merge as a CI pre-step; squash commit does not exist yet at gate-run time — see chunk 2 risks). The gate walks `git log origin/main..HEAD --format=%B` and matches the trailer regex `^Baseline-Weakening-Approved-By:[[:space:]]+(@?[A-Za-z0-9-]+)[[:space:]]*$`. (Corrected at chatgpt-plan-review R1 finding 2.)
- **Allowlist enforcement (per spec §14 + chatgpt-plan-review R1 finding 3):** the captured handle is matched against the V1 allowlist `{ '@michaelhazza', 'michaelhazza' }` (both `@`-prefixed and bare). Non-matching handle → gate exits 1 with diagnostic "Baseline-Weakening-Approved-By handle '<handle>' is not in the allowlist. V1 allowlist: @michaelhazza." Allowlist lives as a Bash array at the top of the gate script; expanding it is a one-line edit, not itself a baseline-weakening event (gate-script changes do not require their own trailer).
- Gate self-test fixture: a Bash function inside the script (or sibling `__test_fixtures__/` directory) covering: (i) tolerance widening WITHOUT trailer → exit 1; (ii) tolerance widening WITH trailer matching allowlist (`@michaelhazza`) in a branch commit → exit 0; (iii) mode downgrade `blocking → nightly` WITHOUT trailer → exit 1; (iv) baseline file CREATION (first-time) → exit 0 (not a weakening); (v) tolerance TIGHTENING (decrease) → exit 0; (vi) mode UPGRADE `advisory → blocking` → exit 0; (vii) tolerance widening WITH trailer but **handle not in allowlist** (e.g. `@some-other-user`) → exit 1; (viii) trailer present in a branch commit (not just the tip) is sufficient → exit 0.

**Error-handling strategy:**
- Site test throws: `runHarness` catches, emits `browser.detection.harness.run.completed { outcome: 'site_unavailable' }`, continues to next site. `site_unavailable` is NEVER in the blocking failure set.
- Cached fixture parse error (unparseable score from a `blocking`-mode site against deterministic cached fixture): emits `browser.detection.harness.run.completed { outcome: 'parse_error' }`, then `browser.detection.harness.run.regression` (per §12 row 7) with `score: null, baselineScore: null, baselineTolerance: null`. `parse_error` IS in the blocking failure set (per §8.1 rationale).
- Gate script: missing trailer → exit 1 with human-readable message naming the file, the diff direction, and the required trailer format. Trailer present but handle not in allowlist → exit 1 with diagnostic naming the offending handle and the V1 allowlist. Git history walk failure (detached HEAD, no `origin/main`, empty `origin/main..HEAD` range): exit 2 with diagnostic. In CI, the gate runs after `actions/checkout` with `fetch-depth: 0` (the gate documents this checkout requirement in its header comment).
- Writer call (chunk 1) throws: caught and logged `harness.history.write_skipped`; CI exit code unaffected.

**Dependencies:** chunk 1 (`harnessHistoryWriter` is imported).

**Acceptance signals:**
- `runHarness` runnable locally against `browserscan.html` cached fixture; produces a `HarnessRunResult` and inserts a row into `harness_run_history`.
- `verify-baseline-weakening-approval.sh` lives at the canonical gates path and self-test cases (i–vi) pass.
- Baseline-fixture corpus exists for 1 site; gate is live the moment baselines exist (handoff ordering invariant satisfied).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `bash scripts/gates/verify-baseline-weakening-approval.sh` (with the chunk's self-test fixtures only — NOT the full repo gate sweep)

---

### Chunk 3 — `harness-baseline-corpus-expansion`

**spec_sections:** §4.1, §5.1 (4 additional sites), §13 (rollout posture — all initial sites ship in `advisory` mode), §14 (operational ownership for baseline drift)

**Files (file count > 5; deviates from the ≤5 file rule but satisfies ≤1 logical responsibility per the plan-time deviation contract):**
- CREATE `server/tests/browser-detection-harness/sites/bot-incolumitas.test.ts`
- CREATE `server/tests/browser-detection-harness/sites/deviceandbrowserinfo.test.ts`
- CREATE `server/tests/browser-detection-harness/sites/whoer.test.ts`
- CREATE `server/tests/browser-detection-harness/sites/pixelscan.test.ts`
- CREATE 4 × `server/tests/browser-detection-harness/baselines/<slug>.baseline.json`
- CREATE 4 × `server/tests/browser-detection-harness/fixtures/<slug>.html`

Total: 12 files. **Deviation justification:** all 12 files are uniform per-site repetitions of the chunk-2 reference pattern (one test file + one baseline + one fixture per site); they encode no new contract, no new module shape, no new error handling — they expand the baseline corpus and nothing else. Splitting into 4 mini-chunks would create 4 identical-shape chunks that each pass / fail together and add no review value. The handoff's ≤5 file rule is a deep-module signal; here the deep module IS the harness, and corpus expansion is its dataset, not its interface. Documented per the handoff §"Chunk-sizing requirements (HARD)" deviation contract.

**Module shape:**
- *Public interface:* 4 additional `{ slug, mode, test }` exports consumed by `runHarness` via the existing dynamic-import loop in chunk 2.
- *What stays hidden:* per-site fingerprint-extraction selectors; per-site normalised-score formulas; cached HTML fixture contents.

**Contracts:**
- Each new per-site file conforms to the chunk-2 site contract.
- All 4 new sites ship in `mode: 'advisory'` initially per spec §13 ("ships in advisory mode initially"); flip to `blocking` is a follow-up commit after two-stable-nightly-runs trigger, gated by chunk 2's `verify-baseline-weakening-approval.sh` (mode upgrade `advisory → blocking` passes silently per gate contract).
- Each baseline JSON is first-write (no prior file to compare against); gate allows baseline establishment without trailer per chunk 2 contract case (iv).

**Error-handling strategy:** inherits chunk 2's runtime error handling (no new failure modes). One per-site fixture file is intentionally bot-detection-content-heavy; the test must not depend on live external state — only the cached fixture.

**Dependencies:** chunks 1 and 2.

**Acceptance signals:**
- 5 total per-PR sites available to `runHarness`. CI workflow (chunk 4) can advertise all 5 in `--mode=blocking` (though by §13 only `browserscan` starts in blocking; the others start advisory).
- All 5 baselines establishable from a clean state (`runHarness` first run produces 5 `baseline_established` rows in `harness_run_history`).

**Verification commands:**
- `npm run lint`
- `npm run typecheck` (per-site test files are typed)

---

### Chunk 4 — `harness-ci-workflow-and-feature-flag`

**spec_sections:** §4.1, §5.1 (CI workflow row), §8.1 (CI invocation), §13 (`detection-harness-gating` feature flag), §14 (Playwright-bump path-trigger), §19.1 (full Phase 1 acceptance)

**Files:**
- CREATE `.github/workflows/browser-detection-harness.yml`
- MODIFY `shared/types/sandbox.ts` (add `detection-harness-gating` feature-flag literal type if a flag registry exists; otherwise document the runtime-config key)
- CREATE (if no runtime feature-flag registry exists) `server/config/featureFlags.ts` (skeleton) OR document the existing flag mechanism the chunk uses

**Module shape:**
- *Public interface:* GitHub Actions workflow with two jobs: `per_pr_blocking` (runs `npx tsx server/tests/browser-detection-harness/runHarness.ts --mode=blocking`; <2 min budget; pre-step invokes `verify-baseline-weakening-approval.sh`); `nightly_advisory` (cron `0 3 * * *` UTC; `--mode=full`; <15 min budget). Plus a third path-trigger rule: any PR touching `package-lock.json` OR `package.json` OR the `playwright` dependency line auto-runs the full nightly-style harness even at PR time (per §14).
- *What stays hidden:* the YAML's exact step orchestration; the artefact-upload steps for harness-run logs; the secrets it consumes (`GEOIP_LICENCE_KEY` is NOT needed here — harness V1 ships without GeoIP per chunk-7 deferral note).

**Contracts:**
- Workflow file is named exactly `browser-detection-harness.yml` (the spec §5.1 row pins the name; downstream tooling may reference it).
- Per-PR job invokes `scripts/gates/verify-baseline-weakening-approval.sh` as a `pre-step` (per §5.1 CI workflow row) BEFORE running the harness. Gate exit 1 fails the whole job before any harness run. **`actions/checkout` step MUST use `fetch-depth: 0`** so the gate's `git log origin/main..HEAD` walk has the full branch commit history available (added at chatgpt-plan-review R1 finding 2).
- CI exit code from harness step is propagated to the job status; no swallowing.
- Feature flag `detection-harness-gating` (per spec §13 rollout) gates whether per-PR harness failures BLOCK merge or only warn. Default V1 value: `false` (advisory only, per spec §13 "ships in advisory mode initially"). Flip to `true` per-site after two stable nightly runs.

**Error-handling strategy:**
- Gate pre-step exit 1 (baseline weakening without trailer): fail the workflow job with the gate's diagnostic.
- `runHarness` exit 1 (per spec §8.1 blocking-failure conditions met AND gating flag on): fail the workflow job.
- e2b SDK not installed (per architect-pick item 7): harness runs against cached fixtures only; the YAML does NOT attempt to call out to e2b in V1. Documented as a single-line comment in the YAML header.
- Nightly job failure: surfaces via Slack alert + commit comment (per §13); never blocks per-PR CI.

**Dependencies:** chunks 1, 2, 3 (CI cannot start until baselines + runner + gate exist).

**Acceptance signals:**
- CI workflow visible on a fresh PR; `per_pr_blocking` job runs and produces a result.
- `nightly_advisory` cron scheduled (visible in GitHub Actions UI).
- A deliberate baseline-weakening commit WITHOUT the trailer fails the per-PR job at the pre-step (gate); WITH the trailer passes.
- `detection-harness-gating` flag default = `false` so the initial PR does not block on any harness failure.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- YAML lint via `npx js-yaml .github/workflows/browser-detection-harness.yml` (the chunk's local YAML-syntax check)

**END OF PHASE 1.** Acceptance gate per spec §19.1 satisfied. Phases 2 and 3 may begin.

---

### Chunk 5 — `proxy-alignment-types-and-schema`

**spec_sections:** §4.2, §5.1 (`shared/types/proxyAlignment.ts` row), §5.2 (`subaccount_iee_browser_settings` row — adapted per §17 Q10 resolution), §5.3 (migration 3 — adapted), §6.1, §7.5, §12 (proxy alignment + GeoIP events registry; events emitted in chunks 6/7)

**Files:**
- CREATE `shared/types/proxyAlignment.ts`
- MODIFY `server/db/schema/subaccountIeeBrowserSettings.ts` (add `proxyConfig`, `proxyLocaleOverrides` JSONB columns)
- CREATE `migrations/0371_subaccount_iee_browser_settings_add_proxy_config.sql`
- MODIFY `shared/types/sandbox.ts` (register 6 events: 3 proxy alignment + 3 GeoIP — `browser.proxy.alignment.resolved`, `…failed`, `…partial`, `geoip.db.refreshed`, `geoip.db.refresh.failed`, `geoip.db.source.selected`)

**Module shape:**
- *Public interface:* `ProxyAlignment` type (per spec §6.1 — discriminated nullable with exact shape `{ timezone, locale, language, webrtcPolicy } | null`); `subaccount_iee_browser_settings.proxyConfig` JSONB column (shape `{ url: string, credentialId?: string }` — **never stores raw username/password**; credentials live in `credentialBrokerService` and the JSONB only carries the opaque broker credential ID; corrected at chatgpt-plan-review R2 finding 4); `subaccount_iee_browser_settings.proxyLocaleOverrides` JSONB column (shape `{ timezone?: string, locale?: string, language?: string }`); 6 event-type literals added to the canonical telemetry registry.
- *What stays hidden:* none — this chunk is intentionally interface-only.

**Contracts:**
- `ProxyAlignment` type matches spec §6.1 example instance exactly (`webrtcPolicy: 'disable_non_proxied_udp'` literal).
- Migration `0371_subaccount_iee_browser_settings_add_proxy_config.sql` adds both columns with `NULL` default and CHECK constraints per spec §5.3 (proxy_config row), tightened at chatgpt-plan-review R2 finding 4 to **forbid raw credential fields**: `proxy_config IS NULL OR ( jsonb_typeof(proxy_config) = 'object' AND (NOT proxy_config ? 'username') AND (NOT proxy_config ? 'password') AND (NOT proxy_config ? 'secret') AND (proxy_config ? 'url') AND jsonb_typeof(proxy_config->'url') = 'string' AND (NOT proxy_config ? 'credentialId' OR jsonb_typeof(proxy_config->'credentialId') = 'string') )`; `proxy_locale_overrides IS NULL OR (jsonb_typeof(...) = 'object' AND no extra keys beyond {timezone,locale,language} AND each present key is a string)`. The username/password forbid-list is enforced at the database layer so any direct INSERT/UPDATE attempting to inline credentials fails with PG error `23514` (check_violation).
- `subaccount_iee_browser_settings` is already in `RLS_PROTECTED_TABLES` (line 1318 of `server/config/rlsProtectedTables.ts` per primitives-reuse search); no manifest change needed. RLS posture inherits.
- Event registry additions in `shared/types/sandbox.ts` — telemetry registry entries land in the same chunk as the type and schema, per the handoff "telemetry registry lands in the same chunk as the emitter" rule applied at the registry side; actual emit calls land in chunks 6 and 7. **This is the deliberate variation:** registry entries are added once (chunk 5), then chunks 6 and 7 emit against the registered types. Registration without emitter is fine — emitters import the registered literal.

**Error-handling strategy:**
- Migration CHECK constraint violation on any direct INSERT/UPDATE with malformed JSONB: surfaces as PG error `23514` (check_violation) to the caller. No Zod validation added at this chunk; consumer service (chunk 6) parses via Zod with safer error messages.
- Type-only TS errors caught by `npm run typecheck`.

**Dependencies:** none on chunks 1–4 (Phase 2 is feature-flag-independent of Phase 1 — both are spec §13 independent flags).

**Acceptance signals:**
- Migration 0371 applies cleanly against the latest baseline DB; columns visible.
- `ProxyAlignment` importable from `shared/types/proxyAlignment.ts` with the locked shape.
- 6 telemetry events registered (typecheck of `shared/types/sandbox.ts` passes).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run db:generate` (verify migration file)

---

### Chunk 6 — `proxy-alignment-service-pure-and-consumer`

**spec_sections:** §4.2, §5.1 (`proxyAlignmentService.ts` + `proxyAlignmentServicePure.ts` rows), §5.1 (`proxyAlignmentServicePure.test.ts` row), §6.1 (tenant-override precedence), §6.4 (fourth bullet — tenant overrides win), §8.2, §10.2 (proxyAlignmentService.resolve safe), §11.1 (pure tests), §19.2 (acceptance bullets 1, 2, 4)

**Files:**
- CREATE `server/services/sandbox/proxyAlignmentServicePure.ts`
- CREATE `server/services/sandbox/proxyAlignmentService.ts`
- CREATE `server/services/sandbox/__tests__/proxyAlignmentServicePure.test.ts`

**Module shape:**
- *Public interface:* `proxyAlignmentService.resolve(proxyConfig: ProxyConfig, overrides: ProxyLocaleOverrides | null, geoipReader: GeoipReader): ProxyAlignment | null` — sync at the alignment-shape layer (no DB or network; GeoLite2 file is local). **Credential resolution lives in chunk 8 (envelope assembly), NOT here** — `proxyAlignmentService` only needs the proxy URL's hostname (for GeoIP lookup), never the credentials themselves. Pure module exports `translateIpToGeo(ip: string, geoipReader: GeoipReader): { timezone, locale, language } | Partial<...>` and `assembleAlignment(geo: ..., overrides: ProxyLocaleOverrides | null): ProxyAlignment` (deterministic from inputs). The pure-test suite includes a **redaction test** (corrected at chatgpt-plan-review R2 finding 4): given a `proxyConfig` with a `credentialId`, the assembled `ProxyAlignment` MUST NOT contain the credentialId or any decrypted material; only resolved locale/timezone/language/webrtcPolicy fields are returned.
- *What stays hidden:* the `GeoipReader` adapter interface (lives in chunk 7 — chunk 6 declares the interface and depends on it via injection); fallback semantics (UTC, en-US per spec §6.1); the partial-fallback detection (emits `browser.proxy.alignment.partial`).

**Contracts:**
- `ProxyAlignment` envelope shape exactly per spec §6.1; non-null = all 4 fields required.
- Tenant override precedence per spec §6.4: any field set in `proxyLocaleOverrides` wins over GeoIP-derived value.
- Per-field fallbacks per spec §6.1: `timezone` → `UTC`, `locale` → `en-US`, `language` → `en-US,en;q=0.9`, `webrtcPolicy` → always `disable_non_proxied_udp`.
- Telemetry emission: `browser.proxy.alignment.resolved` (full resolution from GeoIP, no fallbacks); `browser.proxy.alignment.partial` (some fields fell back to defaults — coarse-grained `resolvedFields[]` / `fallbackFields[]` payload per §12); `browser.proxy.alignment.failed` (GeoLite2 lookup throws entirely — alignment returns `null`, envelope omits the field).
- No raw IPs or GeoIP payloads in any event (§12 redaction rule); only region-level (`region: 'US-East'`-style) coarse identifier.

**Error-handling strategy:**
- Invalid IPv4/IPv6 input: pure module returns `null` (no partial); service emits `browser.proxy.alignment.failed { reason: 'invalid_ip' }`.
- `GeoipReader` throws: service catches, emits `failed { reason: 'geoip_lookup_error' }`, returns `null`. Caller (chunk 8 dispatch layer) omits envelope field.
- Partial GeoLite2 response (timezone resolved, locale unknown): assembled envelope contains GeoIP timezone + default locale; service emits `partial { resolvedFields: ['timezone'], fallbackFields: ['locale','language'] }`.
- Pure-function tests: IP→geo fixtures for US (192.0.2.0), UK (203.0.113.0), JP (198.51.100.0), AU; tenant-override-wins case; partial-fallback shape.

**Dependencies:** chunk 5 (`ProxyAlignment` type + telemetry registry). Chunk 7 lands `GeoipReader` concrete implementation — chunk 6 declares the interface via dependency injection (the interface is small: `interface GeoipReader { lookup(ip: string): { timezone?: string, locale?: string, language?: string } | null }`).

**Acceptance signals:**
- `proxyAlignmentService.resolve` callable with a stub `GeoipReader`; produces correct `ProxyAlignment` for fixtures.
- Pure tests pass: known IP → known geo, tenant override wins, partial fallback shape.
- Vendor-isolation boundary holds: this chunk has zero imports from `infra/geoip/`.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/sandbox/__tests__/proxyAlignmentServicePure.test.ts`

---

### Chunk 7 — `geoip-db-and-refresh-job`

**spec_sections:** §4.2, §5.1 (`infra/geoip/geolite2-city.mmdb`, `infra/geoip/LICENSE.txt`, `server/jobs/geoipDbRefreshJob.ts`), §8.4, §10.1 (job idempotency), §10.2 (retry safe), §10.3 (singleton concurrency), §10.4 (terminal events), §12 (`geoip.db.refreshed`, `geoip.db.refresh.failed`, `geoip.db.source.selected`)

**Files (revised at chatgpt-plan-review R2 finding 5 — NO bundled binary in repo; download-at-deploy only):**
- CREATE `infra/geoip/README.md` (operator-facing: documents the deploy-time bootstrap fetch contract + licensing posture; the directory itself stays in the repo as the runtime mount point)
- CREATE `infra/geoip/.gitignore` (`*.mmdb`, `*.mmdb.gz`, `*.tar.gz` — prevents accidental binary commits)
- CREATE `scripts/bootstrap-geoip-db.sh` (deploy/CI-time download script; fetches GeoLite2-City via `GEOIP_LICENCE_KEY` to `${GEOIP_RUNTIME_DIR}/geolite2-city.mmdb`; idempotent — skips if already present; exits 0 on success, 2 on missing key, 1 on download/network failure)
- CREATE `infra/geoip/geoipReader.ts` (concrete `GeoipReader` implementation reading the `.mmdb` file via the `mmdb-lib` npm package — **runtime-path only**, no bundled fallback; reader returns `null` from every lookup when the file is absent)
- CREATE `server/jobs/geoipDbRefreshJob.ts`
- CREATE `server/jobs/__tests__/geoipDbRefreshJobPure.test.ts` (pure test for: queue name, singleton key, concurrency = 1; missing-key / missing-file behaviour; emits correct `db.source.selected` event)

**Module shape:**
- *Public interface:* the concrete `GeoipReader` (consumed by chunk 6 service); the pg-boss job module exporting `register(boss: PgBoss): Promise<void>` and `handler(job): Promise<void>` per the existing pg-boss-job convention (mirrors `sandboxCeilingMonitorJob.ts`); the `bootstrap-geoip-db.sh` deploy-time script.
- *What stays hidden:* the `mmdb-lib` adapter; the atomic file-swap mechanism (`.new` → fsync → rename); the MaxMind download URL assembly + auth-token threading; the runtime-path-existence check (`stat` runtime path; if absent OR `GEOIP_LICENCE_KEY` env unset, reader returns `null` from all lookups and emits `geoip.db.source.selected { source: 'unavailable' }` once per session).

**Contracts:**
- Job registration per spec §8.4: queue `geoip-db-refresh`, `singletonKey: 'geoip-db-refresh-active'`, `singletonMinutes: 60`, worker concurrency `1`, cron `0 4 * * 0 UTC` (resolved architect-pick item 4).
- Runtime DB path: `process.env.GEOIP_RUNTIME_DIR / geolite2-city.mmdb` (default `/var/lib/synthetos/geoip/geolite2-city.mmdb`). Job writes here only; **no bundled fallback** (revised at chatgpt-plan-review R2 finding 5 — MaxMind GeoLite2 EULA requires updates within 30 days and may require commercial redistribution licence; shipping a binary in the repo creates compliance risk).
- Reader runtime-path-only selection: if runtime path exists and is readable → load; else reader returns `null` from all lookups (chunk 6 service handles as a `failed { reason: 'geoip_db_unavailable' }` alignment, returns null envelope, proxy still works at the network level but locale/timezone alignment is skipped).
- Atomic swap: write to `${RUNTIME_DIR}/geolite2-city.mmdb.new`, `fsync`, `rename` over `${RUNTIME_DIR}/geolite2-city.mmdb`.
- **Deploy-time bootstrap:** `scripts/bootstrap-geoip-db.sh` is invoked by the Dockerfile entrypoint (or equivalent deploy pipeline step — operator confirms at chunk-7 build time) BEFORE the server starts. The script downloads the current GeoLite2-City DB using `GEOIP_LICENCE_KEY` and writes to `${GEOIP_RUNTIME_DIR}/geolite2-city.mmdb`. If `GEOIP_LICENCE_KEY` is unset, the script exits 2 with a warning ("GeoIP unavailable — proxy alignment will skip locale/timezone resolution") and the server boots normally without GeoIP. Idempotent: re-running the script when the file is fresh (<7 days old) is a no-op.
- Telemetry emission: `geoip.db.refreshed { previousVersion, newVersion, sizeBytes }` (no filesystem path leaked per §12 redaction); `geoip.db.refresh.failed { step, reason }`; `geoip.db.source.selected { source: 'runtime' | 'unavailable' }` emitted by the **reader** (not the job) once per session boot when `proxyAlignmentService` first calls `geoipReader.lookup`.
- MaxMind download URL: `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${GEOIP_LICENCE_KEY}&suffix=tar.gz` (resolved architect-pick item 5). Secret `GEOIP_LICENCE_KEY` documented in `docs/env-manifest.json` as part of doc-sync at finalisation.
- **Licensing posture (corrected at chatgpt-plan-review R2 finding 5):** the repo never holds a copy of the GeoLite2 binary. MaxMind EULA's 30-day update obligation and redistribution licence ambiguity do not apply to environments that download fresh on every deploy. `infra/geoip/README.md` documents this posture for operators. `infra/geoip/.gitignore` blocks accidental binary commits.

**Error-handling strategy:**
- `GEOIP_LICENCE_KEY` unset at job-run time: emit `geoip.db.refresh.failed { step: 'precheck', reason: 'licence_key_missing' }`; job exits successfully (cannot do better without the key); reader continues with whatever DB is currently on disk (last-successful-runtime, or nothing → all lookups return null).
- Download failure (network, 4xx, 5xx): emit `geoip.db.refresh.failed { step: 'download', reason: <http-status-or-error-name> }`; job exits successfully (no retry storm — pg-boss singleton + weekly schedule means next attempt is next Sunday); reader continues with whichever DB is currently on disk.
- Validation failure (file size sanity / format check): emit `geoip.db.refresh.failed { step: 'validation', reason }`; do NOT swap; existing runtime DB unchanged.
- Runtime-dir unwritable: emit `geoip.db.refresh.failed { step: 'runtime_dir_unwritable' }` per spec §8.4; reader unaffected (still serves the existing DB if any).
- Runtime DB absent entirely (deploy bootstrap never ran OR ran without licence key): reader returns `null` from every lookup; emits `geoip.db.source.selected { source: 'unavailable' }` once per session; chunk 6 service emits `browser.proxy.alignment.failed { reason: 'geoip_db_unavailable' }`; proxy alignment returns null; proxy still works at the network layer but locale/timezone/language alignment is skipped (graceful degradation per spec §10).
- `mmdb-lib` parse failure on lookup: reader returns `null` for that lookup (chunk 6 service handles as a partial/failed alignment).
- Job throws unhandled: pg-boss retries per its default policy; idempotency is state-based (atomic swap), so retry is safe.

**Dependencies:** chunk 6 (declares the `GeoipReader` interface that chunk 7 implements). Chunk 5 (telemetry registry).

**Acceptance signals:**
- `scripts/bootstrap-geoip-db.sh` is invokable; with `GEOIP_LICENCE_KEY` set, downloads + extracts + atomically swaps a fresh `geolite2-city.mmdb` into `${GEOIP_RUNTIME_DIR}`; with the key unset, exits 2 cleanly.
- `geoipDbRefreshJob` registered against pg-boss with exact contract (queue name, singleton key, concurrency 1) — pure test asserts the registration shape.
- `GeoipReader` callable from chunk 6's service tests with a runtime-path-stub; produces deterministic results for known fixture IPs when the file is present; returns null for every lookup when the file is absent.
- Vendor-isolation invariant holds: chunk 7 is the ONLY file that imports from `infra/geoip/` or `mmdb-lib`. Chunk 6 imports only the `GeoipReader` interface.
- `infra/geoip/.gitignore` blocks `*.mmdb` from being committed; `infra/geoip/README.md` documents the deploy-time bootstrap posture.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/jobs/__tests__/geoipDbRefreshJobPure.test.ts`

---

### Chunk 8 — `proxy-alignment-envelope-warmpool-and-flag`

**spec_sections:** §4.2, §5.2 (`browserWarmPool.ts`, `e2bSandbox.ts`, `harness/index.ts` rows), §6.1 (consumer side), §8.2, §10.3 (warm-pool concurrency), §13 (`proxy-alignment` feature flag), §15 (proxy settings disclosure copy), §19.2 (full Phase 2 acceptance)

**Files:**
- MODIFY `server/services/sandbox/e2bSandbox.ts` (extend task envelope with `proxyAlignment: ProxyAlignment | null` field; thread into `/workspace/input.json`)
- MODIFY `infra/sandbox-templates/iee-browser/harness/index.ts` (read `taskPayload.proxyAlignment` from envelope; apply Chromium launch flags `--lang=${locale}`, `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`, and Playwright `newContext({ timezoneId, locale, extraHTTPHeaders: { 'Accept-Language': language } })` when non-null; preserve stub failure path when executor not wired)
- MODIFY `server/services/sandbox/browserWarmPool.ts` (extend `terminate` reason union with `'alignment_mutated'`; add destroy-on-alignment-mutation decision logic; standard sessions unchanged)
- CREATE `client/src/lib/copy/browserHardening.ts` (Q13 locked disclosure copy strings: humanize toggle, proxy alignment, detection harness)
- CREATE `server/services/sandbox/__tests__/browserWarmPoolPure.test.ts` (pure-function test for the destroy-on-alignment-mutation decision logic — extracted into a pure helper in `browserWarmPoolPure.ts` so it's testable)

**Module shape:**
- *Public interface:* extended `e2bSandbox` task envelope (new optional `proxyAlignment` field + new optional `proxyUrlEnvKey` field naming the env-var name the harness reads the credential-resolved proxy URL from; both additive); extended `harness/index.ts` (consumes new fields; stub-failure path preserved); extended `browserWarmPool.terminate` (new `'alignment_mutated'` reason); `browserHardeningCopy` namespace exporting the 3 Q13 disclosure strings as named exports.
- *What stays hidden:* the dispatch-layer wiring that READS `proxyConfig` + `proxyLocaleOverrides` from `subaccount_iee_browser_settings`, invokes `proxyAlignmentService.resolve`, and attaches to envelope (lives in `e2bSandbox.ts` per spec §5.2; this is internal to the chunk); the warm-pool destroy mechanics (mirrors existing `_terminateAndWriteCostRow` pattern); **the credential injection** — when `proxyConfig.credentialId` is non-null, dispatch invokes `credentialBrokerService.injectIntoEnvironment` to inject the credential-resolved proxy URL (with embedded auth) into the sandbox environment under a known env-var key (e.g. `IEE_BROWSER_PROXY_URL`); the harness reads this env var rather than receiving credentials in the JSON envelope. Credentials never appear in `taskPayload`, never appear in `/workspace/input.json`, never appear in telemetry. (Added at chatgpt-plan-review R2 finding 4.)

**Contracts:**
- Envelope contract per spec §6.1: `taskPayload.proxyAlignment` is `ProxyAlignment | null`; harness only applies fields when non-null. Sibling field `taskPayload.proxyUrlEnvKey: string | null` names the env var the harness reads the credential-resolved proxy URL from (e.g. `'IEE_BROWSER_PROXY_URL'`); the env var itself is set by `credentialBrokerService.injectIntoEnvironment` at sandbox-launch time, not by `taskPayload`. Harness reads `process.env[taskPayload.proxyUrlEnvKey]` when assembling the Chromium `--proxy-server` flag. If `proxyUrlEnvKey` is null OR the named env var is missing, no proxy is configured (alignment fields, if present, still apply for locale/timezone/language).
- Feature flag `proxy-alignment` (per spec §13): when `false`, dispatch SKIPS the `proxyAlignmentService.resolve` call and sets `proxyAlignment: null` in envelope. When `true` AND proxy is configured on the subaccount, dispatch calls `resolve`. When `true` AND no proxy is configured, envelope stays `null` (no-op).
- Warm-pool destroy-on-alignment-mutation: when a session's task envelope had non-null `proxyAlignment` AND the session is being returned to pool, the session is `terminate`'d with reason `'alignment_mutated'` instead of being returned to the available pool. Standard (non-proxy) sessions follow the existing return-to-pool path unchanged.
- Disclosure copy strings (per spec §15 + intent Q13 verbatim):
  - `humanize`: `"Human-paced input timing. When enabled, this workflow types and clicks with realistic human pauses. Slower per action; helps on sites that flag machine-speed automation."`
  - `proxyAlignment`: `"When you configure a proxy for this workflow, browser locale, timezone, and language are aligned with the proxy region by default. Override in workflow settings if needed."`
  - `detectionHarness`: `"Synthetos browser-layer regression testing. Surfaces drift in detection-site scores when our stack changes."`
- Stub-mode preservation: if the harness reads a non-null `proxyAlignment` but the real Playwright executor is not yet wired, the stub continues to emit `status: 'failed', reason: 'harness: executor not yet wired'` per the existing contract in `infra/sandbox-templates/iee-browser/harness/index.ts`.

**Error-handling strategy:**
- `proxyAlignmentService.resolve` throws / returns `null`: dispatch emits the appropriate alignment event (handled in chunk 6); envelope sets `proxyAlignment: null`; harness runs unaligned (default Playwright behaviour). Workflow does not fail.
- Subaccount has no `proxyConfig`: envelope `proxyAlignment: null`; no event emitted (no proxy, no alignment needed); harness runs as default.
- Warm-pool destroy fails (terminate throws): logged via existing `iee_browser.warm_pool.terminate_*` channel; does NOT block the next task dispatch (next dispatch acquires a fresh sandbox via the standard checkout path).
- Harness receives malformed envelope (non-string `timezone` etc.): emit `harness: malformed proxyAlignment` via the existing harness logger; ignore the field; continue with default Playwright launch. Never throws into Playwright.

**Dependencies:** chunks 5, 6, 7. (Chunk 6 provides the service; chunk 7 provides the `GeoipReader`; chunk 5 provides the type + schema columns + telemetry registry.)

**Acceptance signals (full Phase 2 per spec §19.2):**
- US-East proxy workflow launches Playwright with `newContext({ timezoneId: 'America/New_York', locale: 'en-US', extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' } })` + Chromium flags `--lang=en-US`, `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`. (Verifiable when e2b SDK wired; behind stub in V1.)
- Explicit `timezoneId: 'Europe/London'` tenant override beats GeoIP US value; other fields stay GeoIP-derived.
- Proxy-aligned warm-pool session destroyed (not reset) on return to pool; next task gets a fresh sandbox.
- IPv6-not-in-DB simulated → `browser.proxy.alignment.partial` event; session still launches with fallback defaults.
- Disclosure copy file is importable but NOT rendered anywhere (per architect-pick item 8 PUNT: no proxy-config UI exists; integration deferred).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/services/sandbox/__tests__/browserWarmPoolPure.test.ts`
- `npm run build:server` (envelope shape change touches the build surface)

**END OF PHASE 2.** Phase 3 may begin in parallel with Phase 2 ship if needed; the spec allows independence.

---

### Chunk 9 — `humanize-pure-module-and-types`

**spec_sections:** §4.3, §5.1 (`humanizeInputsPure.ts`, `shared/types/humanize.ts`, `humanizeInputsPure.test.ts` rows), §6.2 (nullability, profiles), §6.4 (third bullet — source-of-truth precedence at dispatch), §11.1 (pure tests), §12 (`browser.humanize.applied`, `browser.humanize.skipped` registry), §19.3 (third bullet — per-profile latency bounds)

**Files:**
- CREATE `shared/types/humanize.ts`
- CREATE `infra/sandbox-templates/iee-browser/harness/humanizeInputsPure.ts`
- CREATE `infra/sandbox-templates/iee-browser/harness/__tests__/humanizeInputsPure.test.ts`
- MODIFY `shared/types/sandbox.ts` (register 2 humanize events)
- MODIFY (only if needed) project `vitest.config.ts` — verify `harness/**/*.test.ts` glob coverage per spec §5.1 architect-verification note

**Module shape:**
- *Public interface:* `HumanizeProfile = 'light' | 'balanced' | 'heavy'`, `HumanizeOptions = { profile: HumanizeProfile, seed: number }`, `PersistedHumanize = HumanizeOptions | null`; pure functions `generateMouseCurve(from, to, profile, seed): Point[]`, `generateTypingIntervals(text, profile, seed): number[]`, `generateScrollMomentum(delta, profile, seed): number[]`. 2 event-type literals added to `shared/types/sandbox.ts`.
- *What stays hidden:* Bezier evaluation; seeded RNG (mulberry32 or similar deterministic 32-bit seedable); per-profile latency-budget constants (calibrated to architect-pick item 2: light 50/90, balanced 150/280, heavy 380/700).

**Contracts:**
- `HumanizeProfile`/`HumanizeOptions`/`PersistedHumanize` shape exactly per spec §6.2.
- `'off'` is never a profile value — absence (null `PersistedHumanize`) is the canonical off representation (spec §6.2).
- Deterministic-replay invariant per spec §6.2: same `(profile, seed, action-sequence)` produces identical curve / interval / momentum output. Pure tests use a snapshot-style assertion: serialise output, compare against canonical fixtures.
- Per-profile latency bounds per spec §19.3: pure-function tests assert `light` p99 < 100ms, `balanced` p99 < 300ms, `heavy` p99 < 750ms over a synthetic 10k-action calibration suite (the pure module reports its per-action computation time; the test asserts the 99th percentile).
- 2 telemetry events registered: `browser.humanize.applied { action_type, profile, durationMs }`, `browser.humanize.skipped { action_type, profile, reason }` per spec §12.

**Error-handling strategy:**
- Invalid profile / invalid seed (negative, non-integer): pure module throws `Error('humanizeInputsPure: invalid options: ' + ...)`. Caller (chunk 10 consumer) validates first.
- Empty `from`/`to` for mouse curve: pure module returns single-point path; no throw.
- Unsupported action sequence (e.g. zero-length text for typing): returns empty interval array; no throw.

**Dependencies:** none (pure module ships standalone; can be tested without chunks 1–8).

**Acceptance signals:**
- `humanizeInputsPure` callable from a Node script; produces deterministic output for `(profile, seed, input)` triples.
- Pure tests pass: seed-replay determinism, per-profile latency bounds, unsupported-action shape.
- 2 telemetry events registered.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run infra/sandbox-templates/iee-browser/harness/__tests__/humanizeInputsPure.test.ts`

---

### Chunk 10 — `humanize-envelope-and-harness-consumer`

**spec_sections:** §4.3, §5.1 (`humanizeInputs.ts` row), §5.2 (`e2bSandbox.ts`, `harness/index.ts` rows for humanize fields), §6.2 (envelope contract), §6.4 (sandbox immutability of envelope), §8.3, §10.4 (per-action terminal events), §13 (`humanize` feature flag), §19.3 (first two bullets — deterministic replay + skipped fallback)

**Files:**
- CREATE `infra/sandbox-templates/iee-browser/harness/humanizeInputs.ts`
- MODIFY `server/services/sandbox/e2bSandbox.ts` (extend task envelope with `humanize: HumanizeOptions | null` field — additive to the chunk 8 `proxyAlignment` extension)
- MODIFY `infra/sandbox-templates/iee-browser/harness/index.ts` (read `taskPayload.humanize` from envelope; when non-null, wrap Playwright action calls with `humanizeInputs.ts`; stub-failure path preserved)

**Module shape:**
- *Public interface:* `humanizeInputs.wrapClick(page, selector, options, humanizeOpts): Promise<void>`, `wrapType(page, selector, text, options, humanizeOpts): Promise<void>`, `wrapScroll(page, delta, humanizeOpts): Promise<void>`; consumer-side adapter that consumes `humanizeInputsPure` output and dispatches the actual Playwright calls; harness envelope reader (internal to `harness/index.ts`).
- *What stays hidden:* Playwright timing-API choice (`page.mouse.move` step-frame loop vs raw bezier); action dispatch ordering; the `'wrapper_error'` fallback path detection.

**Contracts:**
- Envelope: `taskPayload.humanize: HumanizeOptions | null`. Null = pass-through standard Playwright.
- Feature flag `humanize` (per spec §13): when `false`, dispatch IGNORES the workflow's humanize field and sets envelope `humanize: null`. When `true`, dispatch reads the workflow's persisted `humanize` value (chunk 11 provides the persistence + read path) and threads to envelope.
- Per-action telemetry per spec §10.4: exactly one of `browser.humanize.applied` (after wrapped call returns success or failure) or `browser.humanize.skipped` (unsupported action) fires per attempted action. `applied` payload: `{ action_type, profile, durationMs }` (the wrapper's own timing only). `skipped` payload: `{ action_type, profile, reason: 'unsupported_action' | 'wrapper_error' }`.
- Source-of-truth precedence per spec §6.4 third bullet: dispatch re-reads the persisted humanize value on retry; sandbox never reconciles source-vs-envelope (envelope is authoritative for the boot duration).
- Stub-mode preservation: harness with humanize envelope but no wired executor still emits `status: 'failed'` per existing stub contract.

**Error-handling strategy:**
- Unsupported action (e.g. custom Playwright extension method not in the wrap table): emit `browser.humanize.skipped { reason: 'unsupported_action' }`, fall back to standard Playwright call. Action still executes; humanize never throws.
- Wrapper-internal error (humanize-pure module throws on bad seed, etc.): emit `browser.humanize.skipped { reason: 'wrapper_error' }`, fall back to standard. Wrapper does not propagate the error.
- The wrapped Playwright call itself throws: existing Playwright error semantics; the humanize wrapper still emits `applied` (per spec §10.4 — `applied` fires after the wrapped call returns whether success OR failure of the wrapped action).
- Malformed envelope (non-object humanize, missing profile / seed): harness ignores the field with a `harness: malformed humanize envelope` log; runs Playwright unwrapped.

**Dependencies:** chunk 9 (pure module + types + telemetry registry).

**Acceptance signals (spec §19.3 bullets 1–2):**
- A workflow with `humanize: { profile: 'balanced', seed: 42 }` produces identical mouse paths / typing intervals / scroll curves on two runs.
- Unsupported action falls back to standard path, emits `browser.humanize.skipped`.
- Stub-mode harness still emits `status: 'failed'` for non-null humanize envelopes (executor not yet wired).

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npm run build:server` (envelope shape change)

---

### Chunk 11 — `humanize-workflow-config-and-flag`

**spec_sections:** §4.3, §5.2 (workflow-config persistence row — architect-pick path (c) per §17 Q9 resolution), §6.4 (third bullet — dispatch reads persisted value), §9 (Phase 3 dependency on Phase 1 harness gate), §13 (`humanize` feature flag wiring point), §15 (NO UI per path (c)), §19.3 (full Phase 3 acceptance)

**Files:**
- MODIFY `server/lib/workflow/types.ts` (add optional `humanize?: PersistedHumanize` field to `WorkflowDefinition` interface)
- MODIFY `server/lib/workflow/defineWorkflow.ts` (no logic change; the identity helper passes the new field through — change is documenting the field in the JSDoc authoring example)
- MODIFY `server/lib/workflow/validator.ts` (add Zod validation for the optional humanize field; reject malformed at workflow load time per spec §10.6 last sentence)
- MODIFY `server/services/sandbox/e2bSandbox.ts` (dispatch layer: when a workflow's `humanize` field is non-null AND `humanize` feature flag is on, read the field at sandbox boot and pass into the envelope — extends the chunk 10 envelope plumbing with the actual READ-FROM-WORKFLOW path)

**Module shape:**
- *Public interface:* `WorkflowDefinition.humanize?: PersistedHumanize` (optional field; null/absent = off); dispatch-layer read at envelope construction time.
- *What stays hidden:* the dispatch layer's per-task envelope assembly (lives in `e2bSandbox.ts`); the validator's Zod schema for the humanize field.

**Contracts:**
- `WorkflowDefinition.humanize` is optional and typed `PersistedHumanize` (from chunk 9). Absence = null = off.
- `validator.ts` schema rejects malformed humanize values at workflow load time (spec §10.6: "Under path (c) code-level field, the constraint is enforced at definition load time and a violating definition fails CI on the existing workflow-validation pass"). The existing `playbookRunService.startRun()` defence-in-depth validation re-checks.
- Dispatch read: when constructing the e2b task envelope (in `e2bSandbox.ts`), the dispatch layer reads `workflowDefinition.humanize` and copies into `taskPayload.humanize` (subject to `humanize` feature flag — flag off ⇒ envelope null regardless).
- No UI component ships in V1 (per architect-pick item 9 path (c) decision); spec §15 `HumanizeToggle.tsx` and `WorkflowStudioPage.tsx` change are NOT in scope.
- No migration ships in V1 (per spec §5.3 conditional clause — migration `_add_humanize.sql` is NOT emitted under path (c)).
- Feature flag `humanize` wiring: chunk 10 introduced the flag check at envelope construction; this chunk wires the flag value to the runtime config source (whichever mechanism the repo uses — chunk 10 left a TODO for the flag-source lookup; chunk 11 fills it).

**Error-handling strategy:**
- Workflow definition with malformed `humanize` (invalid profile, fractional seed): validator throws at load time; existing workflow-validation CI gate catches per spec §10.6.
- Workflow with no `humanize` field: dispatch sets envelope `humanize: null` (per chunk 10 contract); harness runs unwrapped.
- Feature flag source unavailable: defaults to flag = `false` (safe default — humanize stays disabled, no behaviour change).

**Dependencies:** chunks 9, 10. (Chunk 9 provides the type; chunk 10 provides the envelope read.)

**Acceptance signals (full Phase 3 per spec §19.3):**
- Workflow author can add `humanize: { profile: 'balanced', seed: 42 }` to a `defineWorkflow` call; validator accepts; dispatch reads the field and threads to envelope.
- All 4 §19.3 bullets demonstrable (1+2 inherited from chunk 10; 3 from chunk 9 pure tests; 4 advisory-only per architect-pick item 3 — run manually at build time).
- Phase 1 harness gate (chunks 1–4) is the merge gate for Phase 3 (per spec §9): humanize must not regress detection scores on the per-PR site subset. CI workflow runs the gate; humanize-affected harness runs are visible in `harness_run_history`.

**Verification commands:**
- `npm run lint`
- `npm run typecheck`
- `npx vitest run server/lib/workflow/__tests__/workflow.test.ts` (the existing workflow validator test; chunk 11 extends the validator and should not regress existing cases)
- `npm run build:server`

**END OF PHASE 3.** All three acceptance gates in spec §19 satisfied.

---

## Section 3 — Risks and mitigations (per-chunk)

| Chunk | Risk | Mitigation |
|---|---|---|
| 1 | New system-scoped table without RLS could trip RLS-coverage gate if header comment omitted | Migration header MUST include `-- system-scoped: <reason>` per DEVELOPMENT_GUIDELINES §6.3; gate `verify-rls-coverage.sh` reads this comment |
| 2 | Gate runs as a CI pre-step BEFORE squash merge → squash commit does not exist yet; gate that targets the merge commit is broken-by-design | Gate scans `git log origin/main..HEAD --format=%B` (branch commits only); requires `actions/checkout` with `fetch-depth: 0` in chunk 4's CI workflow; self-test case (viii) covers the trailer-in-branch-commit-not-tip case (corrected at chatgpt-plan-review R1 finding 2) |
| 2 | Reviewer allowlist not enforced ⇒ any handle in the trailer passes gate, contradicting spec §14 governance posture | Allowlist `{ '@michaelhazza', 'michaelhazza' }` is a Bash array at the top of the gate script; self-test case (vii) covers the wrong-handle-rejected case (corrected at chatgpt-plan-review R1 finding 3) |
| 2 | `runHarness` exit-code logic complex (3 ANDed conditions per §8.1); easy to get wrong | Extract exit-code computation into a pure helper `runHarnessExitCodePure` with a focused unit test of the truth-table |
| 3 | File count > 5 deviates from chunk-sizing rule; commit-integrity invariant requires every file pre-declared in chunk scope | Chunk's "Files" list enumerates all 12 files; builder must verify it modifies only this set |
| 4 | CI workflow YAML lint not enforced by repo gates; bad YAML silently breaks CI | Chunk-local verification command `js-yaml` parse; builder runs before commit |
| 5 | Spec named non-existent `subaccountSettings` table; using `subaccount_iee_browser_settings` is a documented deviation | Architect-pick item 10 resolution documents the deviation; finalisation `progress.md` carries the rationale |
| 5 | Telemetry registry entries land 1–2 chunks before the emitters; risk of dead registry entries if chunks 6/7 slip | Registry entries are typed literals; typecheck enforces they are used by chunks 6 and 7; absence triggers a `noUnusedLocals`-style warning at chunk 6/7 build |
| 6 | Vendor-isolation invariant could break if a careless import from `infra/geoip/` lands in `proxyAlignmentService.ts` | Chunk-6 verification: explicit grep `grep -E "infra/geoip|mmdb-lib" server/services/sandbox/proxyAlignmentService.ts` returns empty |
| 5 | Plain JSONB credentials in tenant settings ⇒ stored unencrypted, leakable via any settings dump | `proxyConfig` schema forbids `username`/`password`/`secret` keys at the DB CHECK level; credentials live in `credentialBrokerService`; JSONB only carries `credentialId` opaque ref (added at chatgpt-plan-review R2 finding 4) |
| 6 | Service or pure module could accidentally pass credentials into `ProxyAlignment` envelope or logs | Pure test suite includes an explicit redaction test asserting the assembled `ProxyAlignment` contains zero credential material; chunk 8 injection is via env var, never via `taskPayload` (added at R2 finding 4) |
| 7 | `mmdb-lib` is a new npm dependency; supply-chain review required | New `package.json` line added in chunk 7; finalisation doc-sync includes the dependency note |
| 7 | pg-boss singleton misconfigured ⇒ two refreshers race the atomic swap | Pure test asserts the registration object literal includes `singletonKey: 'geoip-db-refresh-active'` AND `singletonMinutes: 60` AND worker concurrency = `1` |
| 7 | MaxMind GeoLite2 EULA: 30-day update obligation + redistribution licence ambiguity ⇒ bundled binary in repo creates compliance risk | NO bundled binary; `infra/geoip/.gitignore` blocks accidental commits; deploy-time `scripts/bootstrap-geoip-db.sh` downloads fresh; graceful no-GeoIP degradation when `GEOIP_LICENCE_KEY` is unset (added at R2 finding 5) |
| 8 | Credential injection at sandbox-launch ⇒ env-var leakage risk if logs capture full env or if `proxyUrlEnvKey` is logged | Reuse existing `credentialBrokerService.injectIntoEnvironment` discipline (already proven on Slack / Calendar paths); never log the env-var value, only the key name; chunk 8 redaction follows the existing credential-broker convention (added at R2 finding 4) |
| 8 | Envelope shape change at `e2bSandbox.ts` could break the existing harness stub if envelope schema not preserved-additive | Additive-only: `proxyAlignment` field is OPTIONAL; existing call sites continue to omit it; stub's input-parse contract is preserved |
| 8 | Disclosure copy file landing without a renderer creates apparently-unused export — could trip a knip-style dead-code gate | Named-export-only per CLAUDE.md, with a `// CONSUMER: tenant proxy-config UI (deferred per BHP-1)` header comment so a knip allowlist understands the intent |
| 9 | Per-profile latency bound test (`p99 < 100ms`) flaky under CI runner load | Run the calibration suite on a synthetic CPU-time clock (not wall-clock) or with a high statistical margin (p99 < ceiling × 0.7) |
| 10 | Envelope change touches `e2bSandbox.ts` again (chunk 8 also touched it); merge conflict risk inside the build | Chunk 10 lands after chunk 8 within the same branch; no parallel work on this file |
| 11 | Adding optional `humanize` field to `WorkflowDefinition` could touch many existing `defineWorkflow` callers if the type narrowing is wrong | Field is OPTIONAL (`humanize?: PersistedHumanize`); no existing caller needs to change; only the validator adds a check for the new field |
| 11 | Doc-sync at finalisation must update `architecture.md § Key files per domain` (3 rows per handoff); easy to miss under chunk-sizing pressure | Doc-sync runs in `feature-coordinator` Step 9; this plan's Section 4 reminds the operator; the chunk-11 builder does NOT touch architecture.md (per handoff: doc-sync surfaces are not chunks) |

---

## Section 4 — Open architect notes for the operator

**Executor notes:** Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.

**Decisions resolved vs punted (10 architect-pick items):**

- 8 of 10 RESOLVED inline in Section 1 (items 1, 2, 3, 4, 5, 6, 9, 10).
- 2 PUNTED with documented rationale:
  - **Item 7 (e2b SDK availability) — framing departure from spec:** SDK not installed; per-PR AND nightly both run cached-fixtures only. Spec §3 + §4.1 + §8.1 expect nightly to hit live external sites via real e2b — V1 ships cached-only as a documented framing departure (ratified at plan-gate after chatgpt-plan-review R1 finding 1). Live-e2b nightly run deferred to the e2b SDK install build per `tasks/builds/sandbox-safety-batch/req-57-decision.md`. Departure surfaces in handoff.md `spec_deviations:` field; post-V1 follow-up logged as `BHP-2` in `tasks/todo.md`; Phase 3 chatgpt-pr-review re-validates the framing departure at finalisation.
  - **Item 8 (tenant proxy-config UI):** no proxy-config UI exists in the codebase. Disclosure copy file ships in chunk 8 for later use; UI integration deferred to a follow-up build per BHP-1 in `tasks/todo.md`.

**chatgpt-plan-review Round 1 outcomes (2026-05-18):**

- Finding 1 (BLOCKING — nightly cached-only): operator ratified as framing departure (option "Ship V1 with cached-only + framing departure"). Architect-pick item 7 rationale strengthened; departure recorded in handoff.md.
- Finding 2 (BLOCKING — gate pre-merge timing): TECHNICAL fix auto-applied. Gate now scans `git log origin/main..HEAD --format=%B` (branch commits only); chunk 4 CI workflow requires `actions/checkout fetch-depth: 0`; self-test fixture extended with case (viii) trailer-in-non-tip-branch-commit.
- Finding 3 (SHOULD-FIX — approval-authority weakening): TECHNICAL fix auto-applied. Gate now enforces V1 allowlist `{ '@michaelhazza', 'michaelhazza' }`; architect-pick item 6 resolution updated; self-test fixture extended with case (vii) wrong-handle-rejected.

**chatgpt-plan-review Round 2 outcomes (2026-05-18) — operator instructed "lock after this":**

- Finding 4 (BLOCKING — proxy credentials in plain JSONB): TECHNICAL fix auto-applied. `proxyConfig` JSONB shape changed from `{ url, username?, password? }` to `{ url: string, credentialId?: string }`; migration CHECK constraint now forbids `username`/`password`/`secret` keys at the database layer; credentials live in `credentialBrokerService` (the existing canonical pattern proven on Slack / Calendar / OAuth paths); chunk 6 pure-test suite adds a redaction test asserting `ProxyAlignment` carries zero credential material; chunk 8 credential injection happens via `credentialBrokerService.injectIntoEnvironment` at sandbox-launch time using a `proxyUrlEnvKey` envelope field that names the env var, never via `taskPayload` body.
- Finding 5 (SHOULD-FIX — bundled GeoLite2 licensing risk): TECHNICAL fix auto-applied. Repo no longer holds the `.mmdb` binary at all (MaxMind EULA's 30-day update obligation + redistribution licence ambiguity → fresh-download-per-deploy is the compliant pattern). `infra/geoip/.gitignore` blocks accidental commits; `scripts/bootstrap-geoip-db.sh` is the deploy-time fetcher; `GEOIP_LICENCE_KEY` unset = graceful degradation (no GeoIP, proxy still works at the network layer); reader returns null from every lookup when the runtime file is absent; chunk 6 service emits `browser.proxy.alignment.failed { reason: 'geoip_db_unavailable' }` and proxy alignment cleanly returns null.

**Plan status: LOCKED for build (2026-05-18).** All 5 chatgpt-plan-review findings closed; no further plan-review rounds requested. Next: `feature-coordinator` plan-gate → per-chunk `builder` loop.

**Spec-inconsistency findings surfaced (one):**

- **Spec §5.2 + §17 Q10 + §7.5 + §5.3 reference a `subaccountSettings` schema file / table.** This file does not exist in the codebase. The closest existing table is `subaccount_iee_browser_settings` (already RLS-protected, dual-GUC, IEE-browser-scoped). Architect-pick item 10 resolves this by extending `subaccount_iee_browser_settings` instead — documented deviation. Surfacing this so the operator can confirm the deviation is acceptable before chunk 5 commits the schema change.

**One overall ask:** confirm at plan-gate that (a) the path-(c) humanize persistence decision is correct (no UI in V1), and (b) extending `subaccount_iee_browser_settings` rather than creating a new `subaccountSettings` table is acceptable. Everything else is mechanical execution against the locked spec.

---

## Appendix — Provenance

- Spec (LOCKED): `tasks/builds/browser-hardening-primitives/spec.md` (status: accepted, 2026-05-18)
- Handoff: `tasks/builds/browser-hardening-primitives/handoff.md`
- Intent: `tasks/builds/browser-hardening-primitives/intent.md` (13-question grill log)
- Referenced decision: `tasks/builds/sandbox-safety-batch/req-57-decision.md` (e2b SDK stub boundary)
- Primitives-reuse search this session: confirmed `subaccount_iee_browser_settings` exists and is RLS-protected; `subaccountSettings` does not; `defineWorkflow` is a pass-through identity helper; pg-boss singleton pattern exists at `sandboxCeilingMonitorJob.ts`; latest migration number is `0369` (next-free: `0370`+); `infra/geoip/` does not exist; no canonical telemetry registry single-source file exists — `shared/types/sandbox.ts` is the natural extension point.

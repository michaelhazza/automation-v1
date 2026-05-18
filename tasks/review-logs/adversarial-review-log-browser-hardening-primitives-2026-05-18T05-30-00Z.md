# Adversarial Review Log — browser-hardening-primitives

**Branch:** browser-hardening-primitives (HEAD `1100de60`)
**Reviewed by:** adversarial-reviewer
**Timestamp:** 2026-05-18T05:30:00Z
**§5.1.2 trigger:** YES — sandbox launch path, RLS table extension, credential injection envelope, new pg-boss job, new CI workflow with secrets.

**Files reviewed:**
- `server/tests/browser-detection-harness/runHarness.ts`
- `server/tests/browser-detection-harness/harnessHistoryWriter.ts`
- `server/tests/browser-detection-harness/harnessHistoryWriterPure.ts`
- `server/db/schema/harnessRunHistory.ts`
- `migrations/0370_create_harness_run_history.sql` (+ `.down.sql`)
- `migrations/0371_subaccount_iee_browser_settings_add_proxy_config.sql` (+ `.down.sql`)
- `server/db/schema/subaccountIeeBrowserSettings.ts`
- `server/services/sandbox/proxyAlignmentService.ts` / `…Pure.ts`
- `server/services/sandbox/e2bSandbox.ts`
- `server/routes/subaccountIeeBrowserSettings.ts`
- `server/services/subaccountIeeBrowserSettingsService.ts` / `…Pure.ts`
- `server/jobs/geoipDbRefreshJob.ts`
- `scripts/bootstrap-geoip-db.sh`
- `scripts/gates/verify-baseline-weakening-approval.sh`
- `.github/workflows/browser-detection-harness.yml`
- `infra/geoip/geoipReader.ts`
- `infra/geoip/.gitignore`
- `infra/sandbox-templates/iee-browser/harness/index.ts`
- `infra/sandbox-templates/iee-browser/harness/humanizeInputsPure.ts`
- `shared/types/proxyAlignment.ts`
- `shared/types/humanize.ts`
- `server/config/rlsProtectedTables.ts` (grep — confirmed harness_run_history absent, expected)

---

**Verdict:** HOLES_FOUND (2 likely-holes, 3 worth-confirming)

---

## Locked contract verification

1. **Forbidden vocabulary** — PASS. No `stealth|evade|bypassDetection|antiFingerprint|undetectedBrowser|cloak` in any BHP-touched file.
2. **`HarnessRunResult` outcome enum CLOSED** — PASS. TS type / migration CHECK / writer / test all use exactly 5 values.
3. **`proxy_config` closed-set CHECK** — PASS. `(proxy_config - 'url' - 'credentialId') = '{}'::jsonb` with full sub-predicates.
4. **Credentials never in taskPayload / telemetry / `/workspace/input.json`** — PASS for this diff. Only env var NAMES travel; values injected at sandbox-launch via `credentialBrokerService` (wiring deferred).
5. **No bundled GeoLite2 binary** — PASS. `.gitignore` blocks `*.mmdb`/`*.tar.gz`; no binary found.
6. **Baseline gate `fetch-depth: 0`** — PASS on both CI jobs.
7. **RLS posture on `subaccount_iee_browser_settings`** — PASS. New columns inherit dual-GUC policy from migration 0347. All reads/writes via `getOrgScopedDb()`.
8. **`harness_run_history` system-scoped opt-out** — PASS. Absent from `rlsProtectedTables.ts`; writer uses `withAdminConnection({ skipAudit: true })`.

---

## Findings

### S1 — likely-hole — gate trailer NOT author-validated

**File:line:** `scripts/gates/verify-baseline-weakening-approval.sh:73-88`

The gate extracts the trailer handle and string-matches it against the V1 allowlist `("@michaelhazza" "michaelhazza")`. There is NO verification that the commit containing the trailer was authored by the `@michaelhazza` GitHub account.

**Attack scenario:** Any contributor with push access embeds `Baseline-Weakening-Approved-By: @michaelhazza` in their own commit message and passes the gate without the owner's actual review.

**Mitigation choice:** Either (a) call `gh api /repos/:owner/:repo/commits/:sha` in CI to verify the GitHub-resolved author login against the allowlist, or (b) rely on branch-protection rules preventing non-owner pushes (V1 design choice — document the dependency in the gate's header comment). Routing as `BHP-ADV-S1` to backlog pending operator design decision.

### T1 — likely-hole — `workflow_dispatch` bypasses the gate

**File:line:** `.github/workflows/browser-detection-harness.yml:22`

When `workflow_dispatch` is triggered without a ref, GitHub checks out the default branch. `git log origin/main..HEAD` is empty; the gate finds zero changed baseline files and exits 0 unconditionally.

**Mitigation:** Remove `workflow_dispatch` from the `per_pr_blocking` job's `if:` condition — gate is meaningful only on `pull_request` events. **Applied in this commit.**

### F1 — worth-confirming — no concurrency group on workflow

**File:line:** `.github/workflows/browser-detection-harness.yml:11-22`

No `concurrency:` block. Rapid `workflow_dispatch` triggers can flood CI minutes.

**Mitigation:** Add `concurrency: { group: 'browser-detection-harness-${{ github.event_name }}', cancel-in-progress: true }` at workflow level. **Applied in this commit.**

### D1 — worth-confirming — geoipDbRefreshJob may log curl stderr containing licence key

**File:line:** `server/jobs/geoipDbRefreshJob.ts:54-57`

`error.message` from `execFileAsync` is logged verbatim. On certain curl error modes the request URL (embedding `license_key=`) could appear in stderr.

**Mitigation:** Redact `license_key=…` from the reason string before logging. **Applied in this commit.**

### D2 — worth-confirming — `GEOIP_LICENCE_KEY` and `GEOIP_RUNTIME_DIR` absent from env-manifest.json

**File:line:** `server/jobs/geoipDbRefreshJob.ts:40`, `infra/geoip/geoipReader.ts:19`

New env vars referenced in code but not registered in the canonical manifest. Operators provisioning new environments would miss them, causing silent GeoIP degradation.

**Mitigation:** Add both vars to `docs/env-manifest.json`. **Applied in this commit.**

---

## Additional observations (non-blocking)

- `geoipReader.ts:48` uses `console.log` rather than the project's structured `logger`. Inconsistent with codebase convention; the emitted payload `{ event, source }` is safe. Routing to backlog as `BHP-ADV-N1`.
- `spec.md:162` references a "bundled fallback" `.mmdb` file. Post chatgpt-plan-review R2, no bundled binary exists. Spec text is stale; `progress.md` documents the deviation. Doc-sync task — covered by Phase 3 doc-sync sweep.
- `proxyConfig`/`proxyLocaleOverrides` columns are in the schema and migration but not exposed via PATCH route (`.strict()`) or GET response — intentional V1 deferral, write-only state. Note for the deferred wiring build: Zod schema + route response must update in lockstep.

---

## Resolution summary

| Finding | Severity | Action this commit |
|---|---|---|
| S1 trailer not author-validated | likely-hole | Backlog `BHP-ADV-S1` — design decision needed |
| T1 workflow_dispatch bypasses gate | likely-hole | **Fixed:** removed `workflow_dispatch` from `per_pr_blocking` job |
| F1 no concurrency group | worth-confirming | **Fixed:** added concurrency group + cancel-in-progress |
| D1 licence key leak in error log | worth-confirming | **Fixed:** redact `license_key=…` before logging |
| D2 env vars missing from manifest | worth-confirming | **Fixed:** added `GEOIP_LICENCE_KEY` + `GEOIP_RUNTIME_DIR` to `docs/env-manifest.json` |
| N1 geoipReader uses console.log | observation | Backlog `BHP-ADV-N1` |

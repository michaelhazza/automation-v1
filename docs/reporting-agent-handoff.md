# Reporting Agent — implementation handoff

This document tracks what has been built on `claude/agent-paywall-video-workflow-OQTMA` against the spec, what still needs to land, and how to verify each piece.

Read this **alongside** `docs/reporting-agent-paywall-workflow-spec.md` (v3.4) — the spec is the source of truth for what the system should do; this doc is the source of truth for what currently exists in code.

---

## Status snapshot

| Phase | Status | Commit(s) | Notes |
|---|---|---|---|
| Foundation helpers | ✅ Done | `06ba479` | failure(), withBackoff(), writeWithLimit(), canonicaliseUrl(), extended FailureReason enum |
| Code Change A — `contentsVisible` flag | ✅ Done | `00d7ef2` | Schema, migration, service helpers, route decoration. Client UI deferred. |
| Code Change D1 — schemas + payload | ✅ Done | `1b1c57f` | providerType + authType extended, fingerprint column, T12 inline-text columns, BrowserTaskContract zod schema, BrowserTaskPayload extension |
| Code Change D2 — server service + routes | ✅ Done | `b17ef5c` | webLoginConnectionService + 9 routes (subaccount + org). /test endpoints return 501 until D7. |
| Code Change D3 — worker repo (T8/T14) | ✅ Done | `4cbf4ec` | getWebLoginConnectionForRun, single-purpose, tenant-isolated, branded Plaintext password |
| Code Change D4 — performLogin (T20) | ✅ Done | `7b6c05d` | 3-tier success detection, screenshot capture, structured LoginFailedError |
| Code Change D5 — ContractEnforcedPage (T9) | ✅ Done | `be20fea` | Deny-by-default proxy with domain + redirect + download checks |
| Code Change D6 — artifact validator + stall guard (T17/T24) | ✅ Done | `c85e931` | Magic-bytes MIME re-check, sha256 stream hash, 3-condition stall guard |
| Code Change D7 — runHandler integration | ⏳ **Not yet wired** | — | See "Outstanding work" below |
| Code Change D8 — smoke test script | ✅ Done | (this commit) | `worker/scripts/smoke-paywall.ts` |
| Code Change B — `transcribe_audio` | ✅ Done | `42cbf36` | Whisper API client + content-hash cache (T22) + sanity floor (T27). End-to-end via skillExecutor case. |
| Code Change C — `send_to_slack` | ✅ Done | `2cbb2e1` | Slack API client + persist-before-post (T18) + post-hash dedup (T11) + verification ping (T26). End-to-end via skillExecutor case. |
| Wire-up helpers — T25 + T23 | ✅ Done | `fa3fec3` | reportingAgentInvariant + runCostBreaker. Standalone, unit-testable. Not yet imported by runHandler — that's part of the D7 follow-up integration. |
| Fingerprint logic | ⏳ Pending | — | Read + compare + persist via canonicaliseUrl + sha256 of file bytes. Belongs in the D7 runHandler integration. |
| pr-reviewer | ⏳ Pending | — | Final step |

---

## Run the smoke test FIRST

Per spec §11.8, the manual Playwright smoke test against the real paywall is the highest-priority gate before merging anything in D. Run it before reviewing the rest of the branch:

```bash
cd worker
SMOKE_LOGIN_URL=https://42macro.com/login \
SMOKE_USERNAME=reports@breakoutsolutions.com \
SMOKE_PASSWORD='real-password-here' \
SMOKE_CONTENT_URL=https://42macro.com/members/videos \
tsx scripts/smoke-paywall.ts
```

Add `SMOKE_HEADLESS=0` to run headed if you want to watch the flow.

What it does:
1. Launches Playwright Chromium
2. Calls `performLogin()` against the real site
3. Validates which of the three success-detection tiers wins
4. Optionally navigates to the content URL
5. Captures a screenshot at `/tmp/smoke-paywall-<timestamp>.png`

What to confirm before approving D for merge:
- [ ] Login succeeds with the default selectors (or document overrides in the SMOKE_*_SELECTOR env vars)
- [ ] Which detection tier wins (`selector` / `url_change` / `session_cookie`) — record this in the §7.2 walkthrough
- [ ] No hidden redirects to disallowed domains (would surface as a navigation chain in the script's logs)
- [ ] The members video page renders server-side (downloads aren't behind a JS hydration that blocks Playwright)
- [ ] No 2FA / captcha prompts (spec §6.8 — out of scope for v1)

If the smoke test fails, capture the resulting screenshot and the script logs and decide whether to (a) update the default selectors, (b) require operators to set selectors via the Advanced section, or (c) defer the workflow until session-cookie credential mode is built (v2).

---

## Outstanding work — Code Change D7 (runHandler integration)

The D1–D6 commits added the **building blocks** (zod schemas, worker repo, performLogin, ContractEnforcedPage, artifact validator, stall guard). They are not yet **wired into the existing runHandler / executor** in `worker/src/handlers/runHandler.ts` and `worker/src/browser/executor.ts`.

What needs to happen:

### 1. `worker/src/handlers/runHandler.ts`

The handler currently calls `markRunning()` → `buildBrowserExecutor()` → `runExecutionLoop()`. It needs a new branch:

```ts
if (payload.task.type === 'browser' && payload.task.webLoginConnectionId) {
  // Fetch credentials via the single-purpose worker repo (T8 / T14)
  const creds = await getWebLoginConnectionForRun(
    { organisationId: payload.organisationId, subaccountId: payload.subaccountId, runId: payload.runId },
    payload.task.webLoginConnectionId,
  );
  // Run performLogin BEFORE the LLM loop is entered
  const page = await context.newPage();
  await performLogin(page, creds, {
    runId: payload.runId,
    correlationId: payload.correlationId,
    screenshotPath: pathFor(payload.executionRunId, 'login-failure.png'),
  });
  // T2 — login_test mode short-circuits here
  if (payload.task.mode === 'login_test') {
    // capture success screenshot, finalizeRun({ status: 'completed' }), return
    return;
  }
  // Discard the credentials reference before handing the page to the loop
  // (the password string is also wiped via Buffer.fill on a closure scope)
}
```

### 2. `worker/src/browser/executor.ts`

`buildBrowserExecutor` currently returns a `StepExecutor` with `observe()` and `execute()` that call into a raw `Page`. They need to:

- Receive a `ContractEnforcedPage` instance (built in runHandler from `payload.task.browserTaskContract`)
- Pass that wrapper to `buildBrowserObservation()` and the action dispatcher
- After every step, call `wrapper.getViolations()` and call `failure()` if any are present (deny-by-default termination)
- For download actions, attach the `createDownloadStallGuard()` to the in-flight download stream
- After download completes, call `validateDownloadedArtifact()` and persist the artifact only if validation succeeds

### 3. `worker/src/browser/observe.ts`

Currently takes `(page: Page)`. Change to take `(page: ContractEnforcedPage)` — it only uses `page.url()`, `page.evaluate()`, and a few other methods that are already exposed by the wrapper.

### 4. Lint rule

Add to `eslint.config.js` (flat config) a `files: ['worker/**/*.{ts,cjs,js}']` block with a `no-restricted-imports` rule that bans `import { integrationConnections }` outside `worker/src/persistence/`. Per T8 the worker connection access must go through `getWebLoginConnectionForRun` and nothing else. *(Implemented in PR #249 — the rule was originally in the legacy `worker/.eslintrc.cjs`, which ESLint v10 flat config does not auto-load; the file has been deleted and the rule lives in `eslint.config.js` only.)*

### 5. Tenant isolation tests

Per T14, add a test file (e.g. `worker/test/persistence/integrationConnections.test.ts`) that asserts the four resolution cases:

- Run with `subaccountId = A` + connection ID belonging to subaccount B → `WebLoginConnectionNotFound`
- Run with `subaccountId = A` + connection ID belonging to org-wide (null subaccount) → returns the row
- Run with `subaccountId = null` + connection ID belonging to subaccount A → `WebLoginConnectionNotFound`
- Run with `subaccountId = null` + connection ID belonging to org-wide (null subaccount) → returns the row

The `worker/` directory does not currently have a test runner configured (`package.json` has no test script). When wiring this in, add vitest to the root `package.json` and a `worker/vitest.config.ts`.

---

## Outstanding work — Code Changes B, C, and wire-up

### Code Change B — `transcribe_audio`

Per spec §4. New skill md + executor case + Whisper API client + cache (T22) + sanity floor (T27). Server-side only — no worker dependency.

### Code Change C — `send_to_slack`

Per spec §5. Slack integration is already in the providerType enum. New skill md + executor case + slackApi wrapper + persist-before-post (T18) + verification ping (T26). Server-side only.

### Wire-up phase

Per spec §8. Once D7 + B + C are in:
- Fingerprint logic (read + compare + persist) at the end of a successful Reporting Agent run
- T25 end-of-run invariant in `agentExecutionService.ts` before status flips to `completed`
- T23 cost circuit breaker (reuses existing `subaccount_agents.maxCostPerRunCents` column) called from the cost-recording boundaries

---

## What is safe to merge today (without D7 + B + C)

The current branch is **safe to land as a series of small commits** even without the full integration:

- The skill `contentsVisible` flag is fully working at the API level (Code Change A is end-to-end)
- The migration is forward-only and adds only nullable / defaulted columns
- The `webLoginConnectionService` + routes are functional for managing credentials via the API. The /test endpoints return 501 with a clear "wired in D7" message — the front end can integrate against the real shape without the test feature being live.
- The worker helpers (performLogin, ContractEnforcedPage, artifactValidator, stall guard) compile and typecheck cleanly. They are not yet imported by the runHandler, so they have no production effect, but they are unit-testable in isolation.
- The smoke test script lets you verify performLogin against the real paywall before any further integration.

---

## Spec deviations to flag in PR review

These are intentional deviations from the spec text — call them out in the PR description:

1. **No new `ENCRYPTION_KEY` env var.** Reuses the existing `TOKEN_ENCRYPTION_KEY` (AES-256-GCM, key versioning) from `connectionTokenService.ts`. The spec's intent (mandatory boot-time enforced encryption for integration secrets) is met by the existing helper. Adding a parallel `ENCRYPTION_KEY` would have created two encryption surfaces with no benefit.

2. **Client UI changes for Code Change A deferred.** The schema, services, and routes are end-to-end. The spec calls for a lock icon on the skills list page and a placeholder on the skill detail page. The agent runtime is unaffected and the API is correct; the UI changes are a small follow-up.

3. **The `web_login` integration form (D2 UI) is deferred.** Routes and service are functional and zod-validated; an operator can create connections via direct API call today. The IntegrationsPage form component and the Test Connection button are a small follow-up that can land alongside D7.

4. **Worker test directory not yet created.** No vitest yet. Tenant isolation tests (T14) and unit tests for performLogin / ContractEnforcedPage / artifact validator are listed as outstanding work above.

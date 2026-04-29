# CI Readiness Report

Read-only audit of the Automation OS repo, produced as input to the GitHub Actions CI implementation prompt. Captures the exact commands, paths, env vars, and gotchas a follow-up implementation pass needs.

Scope of the audit: the entire repository as of branch `claude/add-github-actions-ci-1Ldda`, no files modified except this report.

## Table of contents

1. Test runner and commands
2. Database setup
3. Existing workflows
4. Required environment variables for CI
5. Node version to use
6. Repository structure notes
7. Risks and recommendations

---

## 1. Test runner and commands

### Runner

There is no test framework installed. No Vitest, no Jest, no Mocha. Test files use one of two patterns, both run via `tsx`:

1. A handwritten `test()` / `assert()` helper at the top of each file, with a per-file pass/fail tally printed at the bottom. This is the dominant pattern, codified in `docs/testing-conventions.md`.
2. Node's built-in test runner (`import test from 'node:test'`, `import assert from 'node:assert/strict'`). Used by 50 of the 245 `.test.ts` files. Compatible with `tsx` because each file is invoked directly.

Both patterns are runnable via `npx tsx <path-to-test-file>`. The `scripts/run-all-unit-tests.sh` discovery loop uses exactly that invocation.

### Three test layers

The repo has three layers per `docs/testing-conventions.md`. CI must run all three.

| Layer | Script | What it does |
|-------|--------|--------------|
| Static gates | `scripts/run-all-gates.sh` | 50+ `verify-*.sh` scripts that grep the codebase for structural invariants. Sub-second each. |
| QA spec checks | `scripts/run-all-qa-tests.sh` | Bash check-list asserting file existence, schema fields, route presence. |
| Runtime unit tests | `scripts/run-all-unit-tests.sh` | Discovers every `**/__tests__/*.test.ts` and runs each via `npx tsx`. |

### Exact `package.json` script entries

```json
"test": "npm run test:gates && npm run test:qa && npm run test:unit",
"test:gates": "bash scripts/run-all-gates.sh",
"test:qa": "bash scripts/run-all-qa-tests.sh",
"test:unit": "bash scripts/run-all-unit-tests.sh",
"playbooks:test": "tsx server/lib/workflow/__tests__/workflow.test.ts",
"test:trajectories": "tsx scripts/run-trajectory-tests.ts"
```

`CLAUDE.md` § "Test gates are CI-only" explicitly states these are not to be run in local dev sessions. CI is the intended consumer.

### Recommended CI test command

```bash
npm test
```

This chains `test:gates && test:qa && test:unit` and exits non-zero on the first failure. Equivalent to running the three sub-scripts in order. No flag is needed for excluding integration tests, because they self-skip (see § 7).

### Test file inventory

| Pattern | Count | Location |
|---------|-------|----------|
| `**/__tests__/*.test.ts` | 275 | All under `server/`, `shared/`, `worker/scripts/` |
| `*.integration.test.ts` (subset of above) | 10 | Under `server/services/__tests__/`, `server/jobs/__tests__/`, `server/routes/__tests__/`, `server/services/crmQueryPlanner/__tests__/`, `server/services/systemMonitor/triage/__tests__/`, `server/lib/__tests__/` |
| Test files outside `__tests__/` | 2 | `shared/lib/parseContextSwitchCommand.test.ts`, `server/services/scopeResolutionService.test.ts` (NOT discovered by `run-all-unit-tests.sh`, which requires the `__tests__/` segment) |
| Trajectory fixtures | 5 JSON files in `tests/trajectories/` | Run via `npm run test:trajectories`, not part of `npm test`. |

### Real external API calls in tests

None found. The only matches for hardcoded external hostnames in `**/*.test.ts` are:

- `'https://hooks.slack.com/services/...'` in `server/services/__tests__/notifyOperatorFanoutServicePure.test.ts`. Static string fixture, not invoked.
- `fetch(...)` calls in `server/services/__tests__/fixtures/__tests__/fakeWebhookReceiver.test.ts`. These hit a locally started fake webhook server (`startFakeWebhookReceiver()`), not a real URL.

No tests import HubSpot, Stripe, GHL (`leadconnectorhq.com`), Gmail, OpenAI, Anthropic, SendGrid, or Resend SDKs at the test boundary.

### Playwright

Playwright is installed (`playwright`, `@playwright/test`) but only consumed by the IEE worker runtime under `worker/src/browser/*`, not by the test suite. Zero `*.test.ts` files import `@playwright/test`. CI does not need to install browsers.

### pg-boss

Zero `*.test.ts` files import `pg-boss`. The 10 integration tests that touch queue behaviour use the real `db` module via the integration gate (`NODE_ENV=integration` + `DATABASE_URL`), but no test boots a pg-boss worker.

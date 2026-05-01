# PR Reviewer Log — lint-typecheck-post-merge-tasks

**Branch:** `lint-typecheck-post-merge-tasks` (PR #249)
**HEAD reviewed:** `3a30d34a`
**Spec:** `docs/superpowers/specs/2026-05-01-lint-typecheck-post-merge-spec.md`
**Spec-conformance verdict (preceding):** CONFORMANT_AFTER_FIXES
**Reviewer mode:** read-only; main session persisted this log on the agent's behalf
**Timestamp:** 2026-05-01T07:36:42Z

---

## Verdict

**APPROVED** — 0 blocking, 1 strong, 4 non-blocking.

The spec is implemented faithfully. Production fixes (`req.user!.id`, drizzle `.rows` drift, null coercion) all land on correct shapes. S1/S2/S3/N1/N3/N4 are addressed. CI workflow correctly gated unconditionally. The `'system'` policy in `visibilityPredicatePure.ts` is consistent with `assertSystemAdminContext` and `getSystemPrincipal()` semantics — the org gate at line 12 still applies, and `case 'system': return true` only fires post-org-check. The exhaustiveness `default` with `_exhaustive: never` is correctly placed.

---

## Files reviewed

~208 files / +45k / -631 (full branch diff vs `main`); spot-focus on `eslint.config.js`, `.github/workflows/ci.yml`, `server/services/principal/visibilityPredicatePure.ts`, `server/services/incidentIngestorPure.ts`, `server/config/actionRegistry.ts`, `server/services/llmRouter.ts`, `server/services/systemAgentRegistryValidator.ts`, `server/routes/workspace.ts`, `server/routes/suggestedActions.ts`, `server/adapters/workspace/googleWorkspaceAdapter.ts`, ~10 representative test files with `!` sweeps, agent definitions, plan/spec doc updates.

---

## Blocking Issues

None.

---

## Strong Recommendations

### S-1. Worker T8 security rule is dormant under the new flat-config; PR's ignore-line entrenches it

**Files:** `eslint.config.js:8`, `worker/.eslintrc.cjs` (entire file)

Adding `'worker/.eslintrc.cjs'` to the ignores list is a drive-by addition that the spec did not request (the spec only asked for the `server/db/migrations/**` → `migrations/**` change in §4.8). More importantly, ESLint v10 (in `package.json` deps) does **not auto-load `.eslintrc.cjs` legacy configs** — flat config is the only source of rules. The T8 rule (`no-restricted-imports` blocking direct imports of `server/db/schema/integrationConnections` from `worker/**`) lives only in this legacy file and is therefore **not enforced anywhere** by the current lint pipeline.

**Empirical confirmation:** `ESLint.calculateConfigForFile('worker/src/loop/executionLoop.ts')` returns `rules['no-restricted-imports']: undefined`.

This is a pre-existing condition (the worker-rule migration was never done when flat config was introduced), but the PR's addition of the ignore line silences the only signal that would have surfaced it (lint complaining about parsing `.cjs` legacy config).

The T8 rule is security-critical: it blocks any future contributor from bypassing the tenant-isolated single-purpose connection fetch path documented in `docs/reporting-agent-paywall-workflow-spec.md` §6.6.2.

**Proposed fix (port the rule into flat config):**
```js
// in eslint.config.js, add a worker-scoped block:
{
  files: ['worker/**/*.{ts,cjs,js}'],
  ignores: ['worker/src/persistence/integrationConnections.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: [
          '**/server/db/schema/integrationConnections',
          '**/server/db/schema/integrationConnections.js',
        ],
        message:
          'Worker code must not import the integrationConnections table directly. ' +
          'Use getWebLoginConnectionForRun() in worker/src/persistence/integrationConnections.ts. ' +
          'Spec: T8 / docs/reporting-agent-paywall-workflow-spec.md §6.6.2.',
      }],
    }],
  },
},
```

After porting, delete `worker/.eslintrc.cjs` and remove the corresponding `ignores` entry from `eslint.config.js:8`.

---

## Non-Blocking Improvements

### N-1. `IdempotencyContract` is declared but not wired into `ActionDefinition`

**File:** `server/config/actionRegistry.ts:62-71`

S1 added `keyShape`, `scope`, `ttlClass`, `reclaimEligibility` to the `IdempotencyContract` interface. The interface is referenced by `server/services/skillIdempotencyKeysPure.ts` for `ttlClassToExpiresAt`, but `ActionDefinition` itself has no `idempotencyContract?: IdempotencyContract` field — the interface is not yet plumbed through any action definition. This is consistent with the spec's scope ("add the three missing fields to the interface") and intentional per the spec's §5.1, but flagging here so a future session knows the contract is type-only and not yet caller-validated. No fix required for this PR.

### N-2. `await await expect(...)` double-await typo

**Files:** `server/services/__tests__/llmRouterTimeoutPure.test.ts:70`, `server/services/__tests__/canonicalDataService.principalContext.test.ts` (occurrence)

Pre-existing (not introduced by this branch), and harmless — the inner `await expect(...).rejects.toThrow()` already returns a Promise that resolves; the outer `await` is redundant. Fix in any future session that touches these files: drop the extra `await`.

### N-3. Spec said `req.user?.id` (optional chain); implementation chose `req.user!.id` (non-null assertion)

**File:** `server/routes/workspace.ts:180,255,500,531,576,607,654`, `server/routes/suggestedActions.ts:25`

Spec §2.1 prescribed `sed 's/req\.userId/req.user?.id/g'`. Implementation used `req.user!.id`. The `!` is the correct choice because every route is gated by `authenticate` middleware (`server/middleware/auth.ts:76` always sets `req.user = payload`), so `req.user` is provably defined at handler entry. The `?.id` prescribed in the spec would silently propagate `undefined` as `userId` into downstream services — a degradation. Implementation made the right call; flagging as a deviation from spec literal text. No fix needed; consider a one-line note in the spec self-review section that this deviation was intentional.

### N-4. `void _b;` pattern in `dropZoneService.ts`

**File:** `server/services/dropZoneService.ts:280`

The `const { buffer: _b, ...rest } = cached; void _b;` is an unusual pattern — the `void _b` is added to satisfy `no-unused-vars` despite `_` prefix. The eslint config at `eslint.config.js:26` already specifies `varsIgnorePattern: '^_'`, so `_b` should already be excluded. The `void _b` is dead-code noise. Consider dropping it in a future cleanup. Non-blocking.

### N-5. Drive-by addition of `'worker/.eslintrc.cjs'` to ignores not in spec

**File:** `eslint.config.js:8`

The spec §4.8 only requested replacing `server/db/migrations/**` with `migrations/**`. Adding `'worker/.eslintrc.cjs'` is a drive-by change — see S-1 for the deeper rule-dormancy concern this masks. Per `CLAUDE.md` §6 "no drive-by reformatting", this should have been called out in the spec. (S-1 is the substantive issue; this is the discipline violation.)

---

## Summary

The spec was implemented well: production typecheck fixes are the right shape, the test-file `!` sweep was applied with pre-condition guards in every spot-checked location, S1-S4/N1-N4 review findings closed cleanly, the `'system'` visibility policy is consistent with the rest of the codebase, and the CI workflow is correctly unconditional and triggered on the right event types. The unit_tests/integration_tests jobs short-circuit on the `ready-to-merge` label, so the trigger broadening doesn't unintentionally fire heavy jobs.

The single load-bearing finding (S-1) is the worker T8 rule dormancy. It is pre-existing — the rule was never migrated when flat config was introduced — but this PR's drive-by addition of the worker config file to the ignores list silences the one remaining signal of it. The right fix is to port the rule into `eslint.config.js`'s flat-config block-form and delete the legacy `.eslintrc.cjs`. This is Strong, not Blocking, because the rule encodes a defensive boundary that other layers (RLS, runtime integration-connection service) also enforce.

No test gates were run locally per CLAUDE.md §"Test gates are CI-only — never run locally". CI on PR #249 carries the gate signal.

---

## Caller routing (handled by main session)

- **S-1** — fix in this branch (port T8 rule into flat config; delete legacy file; remove ignore line).
- **N-1, N-2, N-3, N-4, N-5** — route to `tasks/todo.md § PR Review deferred items` per spec §8.3 contract.

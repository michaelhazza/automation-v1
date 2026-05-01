# Lint + Typecheck Post-Merge — Implementation Spec

> **For agentic workers:** use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to execute this spec task-by-task. Steps use checkbox syntax for tracking.

**Branch:** `lint-typecheck-post-merge-tasks`  
**Authored:** 2026-05-01  
**Prerequisite:** PR #246 (lint-typecheck-baseline) merged to main — ESLint installed, scripts exist, infrastructure is ready.  
**Goal:** Drive `npm run typecheck` and `npm run lint` to exit 0 on main in a single session, wire the CI gate, address all open review findings, and route deferred test items to `tasks/todo.md`. All 8 tasks are designed to be executed sequentially in one pass.

**Reference docs:**
- Error inventory with exact line numbers: `tasks/builds/lint-typecheck-baseline/remaining-work.md`
- Post-merge brief (task summary): `docs/superpowers/plans/2026-05-01-lint-typecheck-post-merge.md`

---

## Contents

1. [Task 1 — Pre-flight](#task-1--pre-flight)
2. [Task 2 — Fix production typecheck errors](#task-2--fix-production-typecheck-errors)
3. [Task 3 — Fix test file typecheck errors](#task-3--fix-test-file-typecheck-errors)
4. [Task 4 — Fix lint errors](#task-4--fix-lint-errors)
5. [Task 5 — Address pr-reviewer findings](#task-5--address-pr-reviewer-findings)
6. [Task 6 — CI gate and doc updates](#task-6--ci-gate-and-doc-updates)
7. [Task 7 — Deferred tests (F14 + F28) — route to `tasks/todo.md`](#task-7--deferred-tests-f14--f28--out-of-scope-route-to-taskstodomd)
8. [Task 8 — Doc alignment and final review](#task-8--doc-alignment-and-final-review)
9. [Verification](#verification)
10. [Self-review against brief](#self-review-against-brief)

---

## Task 1 — Pre-flight

**Goal:** confirm the environment is clean and baseline error counts before touching code.

- [ ] `git status --short` — must return empty output. A dirty tree is a stop condition; either commit/stash/discard before proceeding or the `git pull` below will fail or interleave unrelated state with this session.
- [ ] `git checkout lint-typecheck-post-merge-tasks && git pull` — confirm on correct branch.
- [ ] `npm install` — always first; vitest and other deps may not be in node_modules after a fresh clone. Do not skip even if node_modules exists.
- [ ] Run `npm run typecheck 2>&1 | grep "error TS" | wc -l` and record count. Expected: ~138. If materially higher, read new errors before proceeding.
- [ ] Run `npm run lint 2>&1 | grep " error " | wc -l` and record count. Expected: 283.
- [ ] Confirm both scripts exist: `npm run typecheck` and `npm run lint` should not exit with "missing script".

**Success condition:** error counts recorded, environment verified, no surprises.


## Task 2 — Fix production typecheck errors

**Goal:** clear all 11 TypeScript errors in production code (routes and services, not tests). Fix these first — they may cascade into test file errors.

### 2.1 — `req.userId` does not exist (8 errors, 2 files)

Both files arrived via the main merge and were never patched.

- [ ] Fix `server/routes/workspace.ts` (7 occurrences — lines 180, 255, 500, 531, 576, 607, 654):
  ```bash
  sed -i 's/req\.userId/req.user?.id/g' server/routes/workspace.ts
  ```
- [ ] Fix `server/routes/suggestedActions.ts` (1 occurrence — line 25):
  ```bash
  sed -i 's/req\.userId/req.user?.id/g' server/routes/suggestedActions.ts
  ```
- [ ] Verify: `npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "workspace.ts\|suggestedActions.ts"` — must return 0 lines.

### 2.2 — `systemAgentRegistryValidator.ts` Drizzle API drift (2 errors)

`db.execute()` returns an iterable; `.rows` property does not exist on the result type.

File: `server/services/systemAgentRegistryValidator.ts:45`

- [ ] Read the file around line 45.
- [ ] Replace the `.rows.map(...)` access:
  ```typescript
  // Before
  const dbSlugs = rows.rows.map((r) => r.slug);
  // After
  const dbSlugs = [...rows].map((r) => (r as { slug: string }).slug);
  ```
- [ ] Verify: `npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "systemAgentRegistryValidator"` — 0 lines.

### 2.3 — `googleWorkspaceAdapter.ts` null coercion (1 error)

File: `server/adapters/workspace/googleWorkspaceAdapter.ts:287`

Error: `Type 'string | null | undefined' is not assignable to type 'string | null'`

- [ ] Read the file around line 287.
- [ ] Append `?? null` to coerce `undefined` → `null`:
  ```typescript
  // Before: someField: result.maybeUndefined
  someField: result.maybeUndefined ?? null,
  ```
- [ ] Verify: `npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "googleWorkspaceAdapter"` — 0 lines.

### 2.4 — Confirm all production errors cleared

- [ ] Run `npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "error TS" | grep -v "__tests__\|\.test\.\|\.spec\."` — must return 0 lines. **If non-zero, stop — do not proceed to Task 3.** Fix remaining production errors first.


## Task 3 — Fix test file typecheck errors

**Pre-condition (hard stop):** Before starting any step in this task, confirm production errors are fully cleared:
```bash
npm run typecheck 2>&1 | grep "error TS" | grep -v "__tests__\|\.test\.\|\.spec\." | wc -l
```
Must return **0**. If non-zero, return to Task 2 and resolve the remaining production errors first. Applying `!` fixes on top of unfixed production errors is wasted work.

**Goal:** clear all ~127 TypeScript errors in test files. These are mechanical — use `!` assertions where test setup guarantees the value. Do not add runtime `if` guards in tests; they hide broken setup.

**Fail-fast rule:** If any TypeScript error code outside `TS18047`, `TS18048`, or `TS2722` appears in a test file, **stop**. Do not apply `!` to that error — it indicates a real type mismatch in the fixture or source type. Fix the root cause instead.

**Pattern A** (`TS18047`/`TS18048` — value is possibly null/undefined): add `!` after the variable at its access site.
**Pattern B** (`TS2722` — cannot invoke a possibly-undefined object): add `!` before `()` on the call (e.g. `fn!()` or `obj.method!(arg)`).

Work the largest clusters first to clear error count fastest.

### 3.1 — `fakeProviderAdapter.test.ts` (46 errors, Pattern B)

- [ ] Read `server/services/__tests__/fixtures/__tests__/fakeProviderAdapter.test.ts`.
- [ ] For each TS2722 error: add `!` before `()` on the flagged call site.
- [ ] Verify: `npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "fakeProviderAdapter"` — 0 errors.

### 3.2 — `ghlWebhookMutationsPure.test.ts` (26 errors, Pattern A)

- [ ] Add `!` after each variable flagged as possibly null/undefined.
- [ ] Verify: `npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "ghlWebhookMutations"` — 0 errors.

### 3.3 — `loggerBufferAdapterPure.test.ts` (13 errors, Pattern A)

- [ ] Apply Pattern A. Verify: 0 errors on this file.

### 3.4 — `llmInflightPayloadStorePure.test.ts` (10 errors, Pattern A+B)

- [ ] Apply both patterns per error type. Verify: 0 errors on this file.

### 3.5 — `delegationOutcomeServicePure.test.ts` (5 errors, Pattern A)

- [ ] Apply Pattern A. Verify: 0 errors.

### 3.6 — `llmRouterTimeoutPure.test.ts` (4 errors, Pattern A)

- [ ] Apply Pattern A. Verify: 0 errors.

### 3.7 — `derivedDataMissingLog.test.ts` and `agentRunEditPermissionMaskPure.test.ts` (4 errors each, Pattern A)

- [ ] Apply Pattern A to both files. Verify: 0 errors on each.

### 3.8 — Remaining small clusters (1–2 errors each, Pattern A)

Files: `skillIdempotencyKeysPure.test.ts`, `logger.integration.test.ts`, `jobConfigInvariant.test.ts`, `stateMachineGuardsPure.test.ts`, `dlqMonitorRoundTrip.integration.test.ts`, `agentRunVisibilityPure.test.ts`, `skillAnalyzerJobIncidentEmission.integration.test.ts`, `llmStartedRowSweepJobPure.test.ts`.

- [ ] Run `npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "error TS18047\|error TS18048\|error TS2722"` to get the current remaining list (may differ slightly from inventory after earlier fixes).
- [ ] Fix each flagged line with `!`. Work file by file.

### 3.9 — Confirm all typecheck errors cleared

- [ ] Run `npm run typecheck 2>&1 | grep "error TS" | wc -l` — must be **0**.
- [ ] If non-zero: read remaining errors and fix before moving to Task 4.


## Task 4 — Fix lint errors

**Goal:** drive `npm run lint` to exit 0. **Execution order:** run §4.2 (no-undef root-cause fix) first, then §4.1 (auto-fix pass), then §4.3 onward. Fixing the root cause before the auto-fix pass reduces output noise — the `no-undef` rule alone accounts for ~44% of all errors.

### 4.1 — Auto-fix pass

- [ ] Run `npm run lint:fix` — clears ~11 errors automatically (prefer-const, trivial no-useless-escape).
- [ ] Record new error count: `npm run lint 2>&1 | grep " error " | wc -l`.

### 4.2 — Fix `no-undef` root cause (125 errors)

**Root cause:** `eslint.config.js` already disables `'no-undef': 'off'` inside the `server/**` + `shared/**` block (line 19) and the `client/**` block (line 34). Files outside both globs — `scripts/*.ts`, root-level TS files, `tools/*.ts`, anything not matched by either `files:` selector — fall through to `js.configs.recommended` defaults where `no-undef` is `error`. TypeScript already enforces undefined references; this rule is redundant across the whole codebase. This suppression is **intentional and permanent** — not temporary cleanup.

- [ ] Open `eslint.config.js`.
- [ ] **Insertion point matters.** Place the global rules object AFTER `js.configs.recommended` and `...tseslint.configs.recommended` but BEFORE the `files:`-scoped overrides for `server/**`/`shared/**` and `client/**`. Inserting before `js.configs.recommended` would be silently overridden, since that recommended config sets `'no-undef': 'error'`. The intended end state of `tseslint.config(...)` is:
  ```javascript
  export default tseslint.config(
    {
      ignores: ['dist/**', 'node_modules/**', 'client/dist/**', 'coverage/**', 'server/db/migrations/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    // NEW — global suppression for files outside server/**/client/** globs (scripts/**, tools/**, root-level TS).
    {
      rules: {
        'no-undef': 'off',
      },
    },
    {
      files: ['server/**/*.ts', 'shared/**/*.ts'],
      // ... existing block unchanged ...
    },
    {
      files: ['client/**/*.{ts,tsx}'],
      // ... existing block unchanged ...
    },
  );
  ```
- [ ] Run `npm run lint 2>&1 | grep " error " | wc -l` — should drop by ~125.
- [ ] Verify the config placement took effect — pick any file under `scripts/` and run:
  ```bash
  npx eslint --print-config scripts/chatgpt-review.ts | grep '"no-undef"'
  ```
  Must output `"no-undef": ["off"]`. If it still shows `"error"`, the global rules object is in the wrong position in `eslint.config.js`.

### 4.3 — Fix `no-useless-assignment` (53 errors)

Variables assigned a value that is immediately overwritten or never read.

- [ ] Run `npm run lint 2>&1 | grep "no-useless-assignment"` to list files.
- [ ] For each: collapse to a single `const` declaration, or remove the dead intermediate assignment.
- [ ] Common pattern in jobs: `let result = undefined; result = await query()` → `const result = await query()`.

### 4.4 — Fix `@typescript-eslint/no-unused-vars` errors (32 errors)

- [ ] Run `npm run lint 2>&1 | grep "no-unused-vars" | grep "error"` to identify.
- [ ] Prefix each unused variable or parameter with `_`. Do not delete destructured fields needed for type inference.
  For destructured bindings (e.g. `const { a, b } = obj`), prefer **removing** the unused binding entirely rather than `_`-prefixing — renaming inside a destructure can affect type narrowing in edge cases. Only retain `_b` if `b` is required for the type to be inferred correctly.

### 4.5 — Fix `no-empty` (21 errors)

- [ ] Run `npm run lint 2>&1 | grep "no-empty"` to list.
- [ ] For intentionally swallowed catch blocks: add `// intentional` inside.
- [ ] For dead empty blocks: remove entirely.

### 4.6 — Fix `no-useless-escape` (14 errors — if any remain after lint:fix)

- [ ] Run `npm run lint 2>&1 | grep "no-useless-escape"`.
- [ ] Remove the backslash from each flagged character (e.g. `'\/'` → `'/'`).

### 4.7 — Fix `prefer-const` remaining (after lint:fix)

- [ ] Run `npm run lint 2>&1 | grep "prefer-const"`.
- [ ] Change `let` → `const` for each flagged never-reassigned variable.

### 4.8 — Fix eslint ignore path (N4 — finding from PR #246 review)

The ignore entry `server/db/migrations/**` matches nothing; migrations live at `migrations/`.

- [ ] In `eslint.config.js`, change `'server/db/migrations/**'` → `'migrations/**'`.

### 4.9 — Fix any remaining rules

- [ ] Run `npm run lint 2>&1 | grep " error "` — read any rules not covered above.
- [ ] Fix each. If a rule has >5 violations, address by rule pattern. If 1–2, fix inline.

### 4.10 — Confirm lint clean

- [ ] Run `npm run lint` — must exit 0 with 0 error lines. Warnings are acceptable.


## Task 5 — Address pr-reviewer findings

**Goal:** close the 3 strong findings (S1/S2/S3) and 3 non-blocking findings (N1/N3/N4) from the PR #246 pr-reviewer pass. N4 was handled in Task 4.8.

**Source log:** `tasks/builds/lint-typecheck-baseline/remaining-work.md` §6 (the table where S1/S2/S3/N1/N3/N4 are enumerated). The `chatgpt-pr-review-lint-typecheck-baseline-2026-05-01T00-21-37Z.md` log is a separate ChatGPT review pass that uses F1–F29 numbering and is NOT the source for the S/N IDs referenced here.

### 5.1 — S1: `IdempotencyContract` stub is incomplete

File: `server/config/actionRegistry.ts` (~line 55)

**Source contract:** `docs/superpowers/specs/2026-04-26-system-agents-v7-1-migration-spec.md` §588 — defines `IdempotencyContract` with four fields: `keyShape: string[]`, `scope: 'subaccount' | 'org'`, `ttlClass: 'permanent' | 'long' | 'short'`, `reclaimEligibility: 'eligible' | 'disabled'`.

The current stub at `actionRegistry.ts:55–57` only declares `ttlClass`. The other three (`keyShape`, `scope`, `reclaimEligibility`) are missing.

- [ ] Read `server/config/actionRegistry.ts` around line 55 to confirm the current stub shape.
- [ ] Read the v7.1 spec lines 588–665 to confirm field types and JSDoc are still as documented above.
- [ ] Add the three missing fields to the `IdempotencyContract` interface, matching the v7.1 spec types verbatim. Include a brief JSDoc on each field that points at v7.1 spec §588 for the canonical semantics — do not duplicate the full prose.
- [ ] No comment-only fallback — a Strong-priority finding must close the contract drift, not paper over it.
- [ ] **Verification (postcondition):** `grep -nE "keyShape:|scope:|reclaimEligibility:" server/config/actionRegistry.ts` must return at least one match for each of the three field names, alongside the pre-existing `ttlClass:` row. Then run `npx tsc --noEmit -p server/tsconfig.json` and confirm no new errors are introduced.

### 5.2 — S2: `visibilityPredicatePure.ts` switch not exhaustive after `SystemPrincipal`

File: `server/services/principal/visibilityPredicatePure.ts:14`

`SystemPrincipal` was added to the `PrincipalContext` union but the switch in `isVisibleTo` has no `'system'` case — it falls through to `return false` silently.

**Policy decision (pinned, not implementer judgment):** the `'system'` case returns `true` unconditionally. Rationale: `SystemPrincipal` (defined at `server/services/principal/types.ts:30`) is constructed only via `getSystemPrincipal()` / `withSystemPrincipal()` (`server/services/principal/systemPrincipal.ts`), which exist precisely so background workers and system-initiated operations bypass tenant scoping. Every other tenant boundary in the codebase already treats system principals as unscoped; `isVisibleTo` must match that contract. The early `row.organisationId !== principal.organisationId` check at line 12 still applies — system principals carry an `organisationId` and are still org-scoped at that gate; the `case 'system': return true` is the visibility-scope decision *after* the org gate has passed.

- [ ] Read the full switch statement.
- [ ] Add the `'system'` case implementing the pinned policy:
  ```typescript
  case 'system':
    // SystemPrincipal bypasses visibility scoping by design — see
    // server/services/principal/systemPrincipal.ts and the policy note
    // in the spec for this task.
    return true;
  ```
- [ ] Add a `default` exhaustiveness guard at the end of the switch:
  ```typescript
  default: {
    const _exhaustive: never = principal;
    return false;
  }
  ```
- [ ] Run typecheck to confirm the `never` guard catches any future unhandled union member.

### 5.3 — S3: No test coverage for `SystemPrincipal` in `isVisibleTo`

File: `server/services/__tests__/visibilityPredicatePure.test.ts`

The existing test file imports `buildUserPrincipal`, `buildServicePrincipal`, `buildDelegatedPrincipal` from `server/services/principal/principalContext.ts`. There is **no** `buildSystemPrincipal` builder — the runtime helper is `getSystemPrincipal()` in `server/services/principal/systemPrincipal.ts` and it returns a `Promise<SystemPrincipal>`, which is unsuitable for a synchronous test fixture. Construct a `SystemPrincipal` literal directly per the type at `server/services/principal/types.ts:30-37`.

`SystemPrincipal` requires all of: `type: 'system'`, `id: string`, `organisationId: string`, `subaccountId: null`, `teamIds: string[]`, `isSystemPrincipal: true`. Omitting any field is a type error.

- [ ] Read the existing test file to confirm the fixture pattern. Note: the file imports `expect, test` from `vitest` (line 11) and is runnable via `npx tsx server/services/__tests__/visibilityPredicatePure.test.ts` per the file's header comment.
- [ ] Add a test that asserts the policy pinned in S2 (system principal returns `true` for any visibility scope when org matches; returns `false` when org mismatches — covering the org gate at line 12 as well as the new `case 'system'`):
  ```typescript
  import type { SystemPrincipal } from '../principal/types.js';

  test('system principal granted visibility when org matches', () => {
    const principal: SystemPrincipal = {
      type: 'system',
      id: 'system-principal',
      organisationId: ORG_A,
      subaccountId: null,
      teamIds: [],
      isSystemPrincipal: true,
    };
    expect(isVisibleTo(row({ visibilityScope: 'private', ownerUserId: USER_2 }), principal)).toBe(true);
    expect(isVisibleTo(row({ visibilityScope: 'shared_subaccount' }), principal)).toBe(true);
  });

  test('system principal denied when org mismatches', () => {
    const principal: SystemPrincipal = {
      type: 'system',
      id: 'system-principal',
      organisationId: ORG_B,
      subaccountId: null,
      teamIds: [],
      isSystemPrincipal: true,
    };
    expect(isVisibleTo(row({ visibilityScope: 'shared_org' /* row org = ORG_A */ }), principal)).toBe(false);
  });
  ```
- [ ] Adapt to the actual constant names (`ORG_A`/`ORG_B`/`USER_2`) and the `row()` helper already in the file.
- [ ] Run the test file via `npx tsx server/services/__tests__/visibilityPredicatePure.test.ts` to confirm both cases pass.

### 5.4 — N1: Dead branch comment in `llmRouter.ts`

File: `server/services/llmRouter.ts` (~line 1289)

The comment implies `if (capturedProviderResponse !== null)` is reachable; it is not given current control flow.

- [ ] Read the block around line 1289.
- [ ] Option A (preferred): rewrite the comment to accurately describe it as a defensive guard:
  ```typescript
  // defensive dead branch — capturedProviderResponse is always null here; kept as a
  // guard against future refactors that might make this path reachable
  ```
- [ ] Option B: if the branch adds confusion with no protective value, remove it entirely.
- [ ] Do not leave the misleading comment as-is.
- [ ] **Verification (postcondition):** `grep -n "capturedProviderResponse" server/services/llmRouter.ts` should show either (a) the new "defensive dead branch" comment at the original line, or (b) no occurrences at all if Option B was chosen. The pre-edit "implies reachable" wording must be gone.

### 5.5 — N3: `idempotencyKey` on `IncidentInput` is never consumed

File: `server/services/incidentIngestorPure.ts` (~line 37)

`idempotencyKey` is set by callers but `computeFingerprint` ignores it — it is a no-op field.

- [ ] Read `incidentIngestorPure.ts` and the `computeFingerprint` function.
- [ ] Choose one option and implement it. **Prefer Option A** — removing a field that callers may rely on for dedup behaviour creates a silent regression risk. Only choose Option B if you confirm via `grep -rn "idempotencyKey" server/` that no caller depends on it providing dedup semantics:
  - **Option A — Wire it in.** Update `computeFingerprint` so it uses `idempotencyKey` as a fallback seed when no `fingerprintOverride` is set. Pin the precedence as documented in code: `fingerprintOverride` (explicit override; wins outright) → `idempotencyKey` (caller-supplied dedup seed) → derived stack/message hash (default). Add a JSDoc to `computeFingerprint` listing the three sources in priority order, and a one-line inline comment at the branch implementing the fallback.
  - **Option B — Remove it.** Delete `idempotencyKey` from `IncidentInput`. Grep for callers (`grep -rn "idempotencyKey" server/`) and migrate any caller that relied on it to `fingerprintOverride`. Update the comment at line 35-37 to remove the field documentation.
- [ ] Add a comment documenting the decision so future sessions don't re-discover the same confusion.
- [ ] **Verification (postcondition):** `grep -rn "idempotencyKey" server/services/incidentIngestorPure.ts server/lib/ server/jobs/ server/routes/` must show the field is consistently used (Option A) OR completely absent (Option B). No mixed state — every caller must agree.


## Task 6 — CI gate and doc updates

**Goal:** make `npm run lint` and `npm run typecheck` mandatory blocking checks on every PR, and update documentation to reflect that these scripts are now operational.

**Scope boundary.** "Mandatory blocking" here means: an unconditional CI job that fails the workflow run when either script exits non-zero. Branch-protection rules / required-status-check configuration on the GitHub repo are a separate repo-admin concern and are **out of scope** for this spec — they are not a code change and require repo-owner permissions. The policy intent is: CI failure on this job = PR cannot be merged; branch protection is the enforcement mechanism, configured by a repo admin separately.

### 6.1 — Add `lint_and_typecheck` job to CI

File: `.github/workflows/ci.yml`

- [ ] Read the current `ci.yml` to understand existing job structure (runner, node version, cache strategy).
- [ ] **Extend the workflow trigger.** The current top of the file is:
  ```yaml
  on:
    pull_request:
      types: [labeled, synchronize]
  ```
  Update it to:
  ```yaml
  on:
    pull_request:
      types: [opened, reopened, ready_for_review, labeled, synchronize]
  ```
  Without these additions, the new job would not fire on `opened` / `reopened` (so a freshly opened PR has no lint/typecheck signal until the next push or label) or on `ready_for_review` (so a draft PR transitioning to ready without a new push slips the gate). All four event types are needed for "mandatory on every PR" to actually hold.
- [ ] Add the following job (node 20, ubuntu-latest, matches existing CI jobs):
  ```yaml
  lint_and_typecheck:
    name: Lint + Typecheck
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
  ```
- [ ] Do NOT add an `if:` label gate — this job must run unconditionally on every PR event the workflow triggers on.
- [ ] Do NOT add `continue-on-error: true` — the job must be blocking.
- [ ] Validate YAML using the installed `yaml` dep (NOT `js-yaml` — not in `package.json`):
  ```bash
  node -e "const fs=require('fs');const yaml=require('yaml');try{yaml.parse(fs.readFileSync('.github/workflows/ci.yml','utf8'));console.log('valid');}catch(e){console.error(e.message);process.exit(1);}"
  ```
- [ ] After pushing the branch and opening a PR, confirm the `lint_and_typecheck` job appears in the GitHub Actions UI and both `npm run lint` and `npm run typecheck` steps execute. A syntactically valid YAML that silently never triggers is a silent failure.

### 6.2 — Update CLAUDE.md verification table

- [ ] Read the verification commands table in `CLAUDE.md` (search for "npm run typecheck").
- [ ] Change the typecheck row: `npm run typecheck (or npx tsc --noEmit)` → `npm run typecheck`.
  The `npx tsc --noEmit` fallback is no longer needed; the script is confirmed working post-PR #246.

### 6.3 — Update agent definitions

Read each agent file first; add checks to the relevant verification/post-implementation section.

- [ ] `.claude/agents/pr-reviewer.md` — add a note that the reviewer should flag any new lint errors or typecheck failures in the changed files, and that the author must run `npm run lint && npm run typecheck` before marking done.
- [ ] `.claude/agents/spec-conformance.md` — add `npm run lint && npm run typecheck` to the verification commands to run after auto-fixes (alongside any existing checks).
- [ ] `.claude/agents/dual-reviewer.md` — add both commands to the per-round verification step; do not duplicate if they are already present.


## Task 7 — Deferred tests (F14 + F28) — out of scope, route to `tasks/todo.md`

**Status:** the original draft of this task proposed two DB-backed integration tests (F14 — migration compatibility for null `agentDiagnosis` rows; F28 — idempotency double-tap on `executeWriteDiagnosis`). Both violate the project's testing posture in `docs/spec-context.md` (`runtime_tests: pure_function_only`, `e2e_tests_of_own_app: none_for_now`). They are deferred out of this spec rather than re-shaped into pure-function tests, because the value of both tests is exactly the DB round-trip behaviour they assert — a pure-function rewrite would not exercise what F14/F28 were raised to catch.

- [ ] **Verify** the heading and rows exist exactly once. Run:
  ```bash
  grep -nE "^## Deferred — testing posture \(lint-typecheck-post-merge spec\)$" tasks/todo.md
  ```
  Expect exactly one match. Then verify the two checkbox rows beneath it (one for F14, one for F28) are present.
- [ ] **Verify** the older PR #246 section is already deduped — i.e. it shows a single pointer line `- F14 + F28: see ## Deferred — testing posture (lint-typecheck-post-merge spec) near the bottom of this file …` rather than separate `[ ] F14:` and `[ ] F28:` checkbox rows. (The spec-reviewer agent already collapsed those during Iteration 2.) Run:
  ```bash
  grep -nE "^- \[ \] F(14|28):" tasks/todo.md
  ```
  Expect zero matches.
- [ ] If either check fails, restore the canonical state: heading + two checkbox rows under it (the richer Iter 1 entry); single pointer line in the PR #246 section. Idempotency is the rule — never two copies.
- [ ] No code is written for F14 or F28 in this spec. Mark this task complete once both verify steps pass.

**Why this is the right call:** the testing-posture deferral is the canonical pattern in this codebase (see `docs/spec-context.md` — `composition_tests: defer_until_stabilisation`, `migration_safety_tests: defer_until_live_data_exists`). When live data exists or the testing posture matures, F14 + F28 are picked up from `tasks/todo.md` together with whatever other deferred tests have accumulated.

## Task 8 — Doc alignment and final review

**Goal:** close the two low-priority plan doc alignment items from the ChatGPT review, then do a final pr-reviewer pass on all changed files.

### 8.1 — F5: Document `sideEffectClass: 'none'` in the plan

File: `docs/superpowers/plans/2026-05-01-lint-typecheck-baseline.md`

- [ ] Find the section covering `ActionDefinition` fields or `sideEffectClass` (Task 9 of that plan).
- [ ] Append a note:
  > `'none'` was added as a third valid class alongside `'read'` and `'write'`. Downstream logic (`managerGuardPure`) only gates on `'write'`, so `'none'` passes through identically to `'read'`. The plan's original `'read' | 'write'` union was incomplete.

### 8.2 — F7: Document `agentDiagnosis` as `jsonb` in the plan

Same file: `docs/superpowers/plans/2026-05-01-lint-typecheck-baseline.md`

- [ ] Find the Task 6 section (diagnosis columns + migration).
- [ ] Append a note:
  > `agentDiagnosis` is stored as `jsonb`, not the plan's original `text`. JSONB is correct for structured diagnosis data (queryable, validates JSON). The type decision was made after the plan was written.

### 8.3 — Final `pr-reviewer` pass

- [ ] Invoke `pr-reviewer`: `"pr-reviewer: review all changes on branch lint-typecheck-post-merge-tasks vs main"`.
- [ ] Address any **strong** findings raised before marking this spec complete.
- [ ] Route **non-blocking** findings to `tasks/todo.md` using the literal heading shape already in use in that file:
  ```markdown
  ## PR Review deferred items

  ### PR #<N> — <branch-slug> (<YYYY-MM-DD>)

  - [ ] <one-line finding> [auto] | [user]
  ```
  Do NOT use `## PR Review deferred items / PR #<N>` as a single heading line — that pattern is not used anywhere in the file and creates an inconsistent section shape.


## Verification

Run all checks before marking this spec complete. Every item must pass.

| Check | Command | Required result |
|-------|---------|----------------|
| TypeScript clean | `npm run typecheck` | Exit 0, 0 error lines |
| Lint clean | `npm run lint` | Exit 0, 0 error lines (warnings ok) |
| CI YAML valid | `node -e "const fs=require('fs');const yaml=require('yaml');yaml.parse(fs.readFileSync('.github/workflows/ci.yml','utf8'));console.log('valid');"` | Prints `valid` |
| S2 switch exhaustive | `npm run typecheck` | No `TS2322` on `never` in visibilityPredicatePure |
| S3 test passes | Run visibilityPredicatePure test file | All tests pass |
| F14 + F28 deferred | `grep -nE "^## Deferred — testing posture \(lint-typecheck-post-merge spec\)$" tasks/todo.md` and `grep -nE "^- \[ \] F(14\|28):" tasks/todo.md` | Heading line returns exactly one match; checkbox-row grep returns zero matches (only the deferred-testing-posture rows beneath the heading exist) |

---

## Self-review against brief

| Brief item | Task | Covered |
|------------|------|---------|
| `npm install` pre-flight | Task 1 | ✓ |
| Fix `req.userId` (workspace.ts, suggestedActions.ts) | Task 2.1 | ✓ |
| Fix Drizzle `.rows` in systemAgentRegistryValidator | Task 2.2 | ✓ |
| Fix null coercion in googleWorkspaceAdapter | Task 2.3 | ✓ |
| Test file `!` sweep — Pattern A + B (127 errors, 35 files) | Task 3 | ✓ |
| `npm run lint:fix` auto-pass | Task 4.1 | ✓ |
| Fix `no-undef` root cause in eslint.config.js | Task 4.2 | ✓ |
| Fix `no-useless-assignment` (53) | Task 4.3 | ✓ |
| Fix `no-unused-vars` errors (32) | Task 4.4 | ✓ |
| Fix `no-empty` (21) | Task 4.5 | ✓ |
| Fix `no-useless-escape` (14) | Task 4.6 | ✓ |
| Fix `prefer-const` remaining | Task 4.7 | ✓ |
| Fix eslint ignore path (N4) | Task 4.8 | ✓ |
| S1 IdempotencyContract — add the three missing fields per v7.1 spec §588 (no comment-only fallback) | Task 5.1 | ✓ |
| S2 SystemPrincipal switch + exhaustiveness | Task 5.2 | ✓ |
| S3 SystemPrincipal test | Task 5.3 | ✓ |
| N1 dead branch comment in llmRouter | Task 5.4 | ✓ |
| N3 idempotencyKey wiring or removal | Task 5.5 | ✓ |
| CI lint_and_typecheck job | Task 6.1 | ✓ |
| CLAUDE.md typecheck script update | Task 6.2 | ✓ |
| Agent definition updates (pr-reviewer, spec-conformance, dual-reviewer) | Task 6.3 | ✓ |
| F14 migration compatibility test (null diagnosis) | Task 7 | deferred — routed to `tasks/todo.md` (testing posture) |
| F28 idempotency double-tap test | Task 7 | deferred — routed to `tasks/todo.md` (testing posture) |
| F5 sideEffectClass doc alignment | Task 8.1 | ✓ |
| F7 agentDiagnosis jsonb doc alignment | Task 8.2 | ✓ |
| pr-reviewer final pass | Task 8.3 | ✓ |

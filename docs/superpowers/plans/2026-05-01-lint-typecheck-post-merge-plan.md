# Lint + Typecheck Post-Merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive `npm run typecheck` and `npm run lint` to exit 0 on branch `lint-typecheck-post-merge-tasks`, wire the CI gate, address all open review findings (S1/S2/S3/N1/N3/N4), and route deferred test items to `tasks/todo.md`.

**Architecture:** All changes are mechanical error-clearance — no new subsystems. Production typecheck errors first (may cascade into test errors), then test `!`-assertion sweep, then lint rule-by-rule, then three strong PR-reviewer findings, then CI + doc wiring. Commits are frequent and scoped to one cluster at a time.

**Tech Stack:** TypeScript 5, ESLint 10 + typescript-eslint 8, Vitest, GitHub Actions YAML, Drizzle ORM, Node 20.

---

## Contents

1. [File Structure](#file-structure)
2. [Task 1 — Pre-flight](#task-1--pre-flight)
3. [Task 2 — Fix production typecheck errors](#task-2--fix-production-typecheck-errors)
4. [Task 3 — Fix test file typecheck errors](#task-3--fix-test-file-typecheck-errors)
5. [Task 4 — Fix lint errors](#task-4--fix-lint-errors)
6. [Task 5 — Address pr-reviewer findings](#task-5--address-pr-reviewer-findings)
7. [Task 6 — CI gate and doc updates](#task-6--ci-gate-and-doc-updates)
8. [Task 7 — Verify deferred tests](#task-7--verify-deferred-tests-f14--f28-in-taskstodomd)
9. [Task 8 — Doc alignment and final review](#task-8--doc-alignment-and-final-review)
10. [Verification](#verification)

---

## File Structure

| File | Change |
|------|--------|
| `server/routes/workspace.ts` | `req.userId` → `req.user?.id` (7 occurrences) |
| `server/routes/suggestedActions.ts` | `req.userId` → `req.user?.id` (1 occurrence) |
| `server/services/systemAgentRegistryValidator.ts` | Drizzle `.rows.map` → `[...rows].map` |
| `server/adapters/workspace/googleWorkspaceAdapter.ts` | `?? null` coercion on line 287 |
| `server/services/__tests__/fixtures/__tests__/fakeProviderAdapter.test.ts` | 46 × `!` (Pattern B) |
| `server/services/__tests__/ghlWebhookMutationsPure.test.ts` | 26 × `!` (Pattern A) |
| `server/lib/__tests__/loggerBufferAdapterPure.test.ts` | 13 × `!` (Pattern A) |
| `server/services/__tests__/llmInflightPayloadStorePure.test.ts` | 10 × `!` (Pattern A+B) |
| `server/services/__tests__/delegationOutcomeServicePure.test.ts` | 5 × `!` |
| `server/services/__tests__/llmRouterTimeoutPure.test.ts` | 4 × `!` |
| `server/services/__tests__/derivedDataMissingLog.test.ts` | 4 × `!` |
| `server/services/__tests__/agentRunEditPermissionMaskPure.test.ts` | 4 × `!` |
| Small test clusters (8 files) | ≤2 × `!` each |
| `eslint.config.js` | Global `no-undef: off` block; fix `server/db/migrations/**` → `migrations/**` |
| Multiple files across `server/`, `scripts/`, `tools/` | Lint rule fixes |
| `server/config/actionRegistry.ts` | Add `keyShape`, `scope`, `reclaimEligibility` to `IdempotencyContract` |
| `server/services/principal/visibilityPredicatePure.ts` | Add `case 'system': return true` + `default: never` guard |
| `server/services/__tests__/visibilityPredicatePure.test.ts` | Add 2 SystemPrincipal tests |
| `server/services/llmRouter.ts` | Rewrite dead-branch comment at line ~1289 |
| `server/services/incidentIngestorPure.ts` | Wire `idempotencyKey` into `computeFingerprint` or remove |
| `.github/workflows/ci.yml` | Add `lint_and_typecheck` job; extend `on.pull_request.types` |
| `CLAUDE.md` | Remove `npx tsc --noEmit` fallback from typecheck row |
| `.claude/agents/pr-reviewer.md` | Add lint + typecheck pre-done check |
| `.claude/agents/spec-conformance.md` | Add lint + typecheck to verification commands |
| `.claude/agents/dual-reviewer.md` | Add lint + typecheck to per-round verification |
| `docs/superpowers/plans/2026-05-01-lint-typecheck-baseline.md` | F5 + F7 doc alignment notes |
| `tasks/todo.md` | Verify F14 + F28 deferred entries (restore if missing) |

---

## Task 1 — Pre-flight

**Files:** none modified

- [ ] **Step 1: Verify clean working tree**

  ```bash
  git status --short
  ```
  Expected: empty output. A dirty tree is a stop condition — commit/stash/discard before proceeding.

- [ ] **Step 2: Confirm correct branch and pull**

  ```bash
  git checkout lint-typecheck-post-merge-tasks && git pull
  ```

- [ ] **Step 3: Install dependencies**

  ```bash
  npm install
  ```
  Mandatory even if `node_modules` exists — vitest and other deps from `main` may be absent.

- [ ] **Step 4: Record typecheck baseline**

  ```bash
  npm run typecheck 2>&1 | grep "error TS" | wc -l
  ```
  Expected: ~138. If materially higher, read new errors before proceeding.

- [ ] **Step 5: Record lint baseline**

  ```bash
  npm run lint 2>&1 | grep " error " | wc -l
  ```
  Expected: 283.

- [ ] **Step 6: Confirm both scripts exist (neither exits with "missing script")**

  ```bash
  npm run typecheck 2>&1 | head -1 && npm run lint 2>&1 | head -1
  ```

---

## Task 2 — Fix production typecheck errors

**Files:** `server/routes/workspace.ts`, `server/routes/suggestedActions.ts`, `server/services/systemAgentRegistryValidator.ts`, `server/adapters/workspace/googleWorkspaceAdapter.ts`

### 2.1 — `req.userId` → `req.user?.id` (8 errors, 2 files)

Both files arrived via the `main` merge and were never patched.

- [ ] **Step 1: Fix workspace.ts (7 occurrences — lines 180, 255, 500, 531, 576, 607, 654)**

  ```bash
  sed -i 's/req\.userId/req.user?.id/g' server/routes/workspace.ts
  ```

- [ ] **Step 2: Fix suggestedActions.ts (1 occurrence — line 25)**

  ```bash
  sed -i 's/req\.userId/req.user?.id/g' server/routes/suggestedActions.ts
  ```

- [ ] **Step 3: Verify both files clear**

  ```bash
  npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "workspace.ts\|suggestedActions.ts"
  ```
  Expected: 0 lines.

### 2.2 — `systemAgentRegistryValidator.ts` Drizzle API drift (2 errors)

`db.execute()` returns an iterable; `.rows` property does not exist on the result type.

- [ ] **Step 4: Read file around line 45**

  ```bash
  npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "systemAgentRegistryValidator"
  ```
  Confirms 2 errors at line 45.

- [ ] **Step 5: Fix the `.rows.map` access**

  In `server/services/systemAgentRegistryValidator.ts` at line 45, replace:
  ```typescript
  const dbSlugs = rows.rows.map((r) => r.slug);
  ```
  with:
  ```typescript
  const dbSlugs = [...rows].map((r) => (r as { slug: string }).slug);
  ```

- [ ] **Step 6: Verify**

  ```bash
  npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "systemAgentRegistryValidator"
  ```
  Expected: 0 lines.

### 2.3 — `googleWorkspaceAdapter.ts` null coercion (1 error, line 287)

Error: `Type 'string | null | undefined' is not assignable to type 'string | null'`

- [ ] **Step 7: Read the file around line 287**

  Open `server/adapters/workspace/googleWorkspaceAdapter.ts` to identify the field returning `string | null | undefined`.

- [ ] **Step 8: Append `?? null` to coerce `undefined` → `null`**

  ```typescript
  // Before
  someField: result.maybeUndefinedValue,
  // After
  someField: result.maybeUndefinedValue ?? null,
  ```

- [ ] **Step 9: Verify**

  ```bash
  npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "googleWorkspaceAdapter"
  ```
  Expected: 0 lines.

### 2.4 — Hard stop gate: confirm all production errors cleared

- [ ] **Step 10: Production-only typecheck gate**

  ```bash
  npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "error TS" | grep -v "__tests__\|\.test\.\|\.spec\." | wc -l
  ```
  **Must be 0.** If non-zero, fix remaining production errors before Task 3.

- [ ] **Step 11: Commit**

  ```bash
  git add server/routes/workspace.ts server/routes/suggestedActions.ts \
    server/services/systemAgentRegistryValidator.ts \
    server/adapters/workspace/googleWorkspaceAdapter.ts
  git commit -m "fix(typecheck): resolve 11 production TS errors (req.userId, Drizzle .rows, null coercion)"
  ```

---

## Task 3 — Fix test file typecheck errors

**Pre-condition (hard stop):**
```bash
npm run typecheck 2>&1 | grep "error TS" | grep -v "__tests__\|\.test\.\|\.spec\." | wc -l
```
Must return **0** before starting this task.

**Pattern A** (`TS18047`/`TS18048` — value is possibly null/undefined): add `!` after the variable at its access site.
**Pattern B** (`TS2722` — cannot invoke a possibly-undefined object): add `!` before `()` on the call (e.g. `obj.method!(arg)`).

**Fail-fast rule:** If any error code outside `TS18047`, `TS18048`, `TS2722` appears in a test file, **stop**. Do not apply `!` — fix the root cause instead.

### 3.1 — `fakeProviderAdapter.test.ts` (46 errors, Pattern B)

**File:** `server/services/__tests__/fixtures/__tests__/fakeProviderAdapter.test.ts`

- [ ] **Step 1: Get the full error list for this file**

  ```bash
  npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "fakeProviderAdapter"
  ```

- [ ] **Step 2: Apply Pattern B to all 46 call sites**

  For each `TS2722` line, add `!` before `()`:
  ```typescript
  // Before: obj.maybeUndefinedMethod(arg)
  // After:  obj.maybeUndefinedMethod!(arg)
  ```

- [ ] **Step 3: Verify**

  ```bash
  npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "fakeProviderAdapter"
  ```
  Expected: 0 lines.

### 3.2 — `ghlWebhookMutationsPure.test.ts` (26 errors, Pattern A)

**File:** `server/services/__tests__/ghlWebhookMutationsPure.test.ts`

- [ ] **Step 4: Apply Pattern A**

  ```bash
  npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "ghlWebhookMutations"
  ```
  For each `TS18047`/`TS18048` line, add `!` after the variable at the flagged line.

- [ ] **Step 5: Verify — 0 lines on `ghlWebhookMutations`**

### 3.3 — `loggerBufferAdapterPure.test.ts` (13 errors, Pattern A)

**File:** `server/lib/__tests__/loggerBufferAdapterPure.test.ts`

- [ ] **Step 6: Apply Pattern A**

  ```bash
  npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "loggerBufferAdapterPure"
  ```
  Add `!` at each flagged line. Verify 0 errors.

### 3.4 — `llmInflightPayloadStorePure.test.ts` (10 errors, Pattern A+B)

**File:** `server/services/__tests__/llmInflightPayloadStorePure.test.ts`

- [ ] **Step 7: Apply Pattern A for TS18047/TS18048, Pattern B for TS2722**

  ```bash
  npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "llmInflightPayloadStorePure"
  ```
  Fix each by error code. Verify 0 errors.

### 3.5 — Medium clusters (4–5 errors each, Pattern A)

**Files:**
- `server/services/__tests__/delegationOutcomeServicePure.test.ts` (5 errors)
- `server/services/__tests__/llmRouterTimeoutPure.test.ts` (4 errors)
- `server/services/__tests__/derivedDataMissingLog.test.ts` (4 errors)
- `server/services/__tests__/agentRunEditPermissionMaskPure.test.ts` (4 errors)

- [ ] **Step 8: Process each file**

  For each, run:
  ```bash
  npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "<filename-without-extension>"
  ```
  Add `!` at each flagged access site. Verify 0 after each file before moving on.

### 3.6 — Small clusters (1–2 errors each, Pattern A)

**Files:** `skillIdempotencyKeysPure.test.ts`, `logger.integration.test.ts`, `jobConfigInvariant.test.ts`, `stateMachineGuardsPure.test.ts`, `dlqMonitorRoundTrip.integration.test.ts`, `agentRunVisibilityPure.test.ts`, `skillAnalyzerJobIncidentEmission.integration.test.ts`, `llmStartedRowSweepJobPure.test.ts`

- [ ] **Step 9: Get the current remaining list (may differ slightly after earlier fixes)**

  ```bash
  npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "error TS18047\|error TS18048\|error TS2722"
  ```
  Work file by file, adding `!` at each flagged site.

### 3.7 — Confirm all typecheck errors cleared

- [ ] **Step 10: Full typecheck gate**

  ```bash
  npm run typecheck 2>&1 | grep "error TS" | wc -l
  ```
  Must be **0**. If not, read remaining errors and fix before Task 4.

- [ ] **Step 11: Commit**

  ```bash
  git add server/services/__tests__/ server/lib/__tests__/ server/tests/
  git commit -m "fix(typecheck): clear all test-file TS errors with ! assertions (~127 errors)"
  ```

---

## Task 4 — Fix lint errors

**Execution order:** §4.1 (`no-undef` root cause) → §4.2 (auto-fix pass) → §4.3 onward. Fixing root cause first reduces noise.

**Files:** `eslint.config.js` + multiple files across `server/`, `scripts/`, `tools/`

### 4.1 — Fix `no-undef` root cause in `eslint.config.js` (125 errors)

**Root cause:** Files outside the `server/**` and `client/**` `files:` globs (e.g. `scripts/*.ts`, root-level TS, `tools/*.ts`) fall through to `js.configs.recommended` where `no-undef` defaults to `error`. TypeScript enforces undefined references; this rule is **permanently redundant** across the whole codebase.

Current `eslint.config.js` structure (the full file is 39 lines):
```javascript
export default tseslint.config(
  { ignores: ['dist/**', ..., 'server/db/migrations/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['server/**/*.ts', 'shared/**/*.ts'], rules: { 'no-undef': 'off', ... } },
  { files: ['client/**/*.{ts,tsx}'], rules: { 'no-undef': 'off', ... } },
);
```

- [ ] **Step 1: Insert global `no-undef: off` block after `tseslint.configs.recommended`**

  The new object must land AFTER `...tseslint.configs.recommended` and BEFORE the first `files:` block:
  ```javascript
  export default tseslint.config(
    {
      ignores: ['dist/**', 'node_modules/**', 'client/dist/**', 'coverage/**', 'migrations/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    // Global suppression: scripts/**, tools/**, root-level TS files not covered by files: globs.
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

- [ ] **Step 2: Fix ignore path — `server/db/migrations/**` → `migrations/**`**

  In the same `ignores` array, change:
  ```
  'server/db/migrations/**'
  ```
  to:
  ```
  'migrations/**'
  ```
  (N4 finding — migrations live at root-level `migrations/`, not `server/db/migrations/`.)

- [ ] **Step 3: Verify config placement took effect**

  ```bash
  npx eslint --print-config scripts/chatgpt-review.ts | grep '"no-undef"'
  ```
  Must output `"no-undef": ["off"]`. If still shows `"error"`, the global block is in the wrong position.

- [ ] **Step 4: Verify error count dropped**

  ```bash
  npm run lint 2>&1 | grep " error " | wc -l
  ```
  Expected: ~158 (283 − 125).

### 4.2 — Auto-fix pass

- [ ] **Step 5: Run auto-fixer**

  ```bash
  npm run lint:fix
  ```
  Clears ~11 errors automatically (prefer-const, trivial no-useless-escape).

- [ ] **Step 6: Record new error count**

  ```bash
  npm run lint 2>&1 | grep " error " | wc -l
  ```

### 4.3 — Fix `no-useless-assignment` (53 errors)

Variables assigned a value that is immediately overwritten or never read.

- [ ] **Step 7: List affected files**

  ```bash
  npm run lint 2>&1 | grep "no-useless-assignment" | sed 's/:.*//' | sort -u
  ```

- [ ] **Step 8: Collapse dead intermediate assignments**

  Common pattern in jobs:
  ```typescript
  // Before
  let result = undefined;
  result = await query();
  // After
  const result = await query();
  ```
  Work file by file; collapse each useless initial assignment and change `let` → `const` where never reassigned.

- [ ] **Step 9: Verify**

  ```bash
  npm run lint 2>&1 | grep "no-useless-assignment" | wc -l
  ```
  Expected: 0.

### 4.4 — Fix `@typescript-eslint/no-unused-vars` errors (32 errors)

- [ ] **Step 10: List affected files**

  ```bash
  npm run lint 2>&1 | grep "no-unused-vars" | grep " error " | sed 's/:.*//' | sort -u
  ```

- [ ] **Step 11: Prefix unused vars/params with `_`**

  ```typescript
  // Before: function handler(req, res, next) { ... }
  // After:  function handler(_req, res, next) { ... }
  ```
  For destructured bindings entirely unused: **remove** the binding rather than `_`-prefixing where possible. Only retain `_b` if `b` is required for type inference.

- [ ] **Step 12: Verify**

  ```bash
  npm run lint 2>&1 | grep "no-unused-vars" | grep " error " | wc -l
  ```
  Expected: 0.

### 4.5 — Fix `no-empty` (21 errors)

- [ ] **Step 13: List affected files**

  ```bash
  npm run lint 2>&1 | grep "no-empty" | sed 's/:.*//' | sort -u
  ```

- [ ] **Step 14: Fix each empty block**

  Intentionally swallowed catch block:
  ```typescript
  // Before: } catch (e) {}
  // After:  } catch (e) { /* intentional */ }
  ```
  Dead empty block with no intended purpose: remove entirely.

- [ ] **Step 15: Verify**

  ```bash
  npm run lint 2>&1 | grep "no-empty" | wc -l
  ```
  Expected: 0.

### 4.6 — Fix remaining `no-useless-escape` and `prefer-const` (if any after lint:fix)

- [ ] **Step 16: Check for remaining violations**

  ```bash
  npm run lint 2>&1 | grep "no-useless-escape\|prefer-const"
  ```

- [ ] **Step 17: Fix `no-useless-escape`** — remove the backslash (e.g. `'\/'` → `'/'`).

- [ ] **Step 18: Fix `prefer-const`** — change `let` → `const` for each never-reassigned variable.

### 4.7 — Catch-all sweep

- [ ] **Step 19: Check for any rules not covered above**

  ```bash
  npm run lint 2>&1 | grep " error "
  ```
  Fix inline (1–2 violations) or by rule pattern (>5 violations).

### 4.8 — Confirm lint clean

- [ ] **Step 20: Full lint gate**

  ```bash
  npm run lint
  ```
  Must exit 0 with 0 error lines. Warnings are acceptable.

- [ ] **Step 21: Commit**

  ```bash
  git add eslint.config.js
  git add -p  # stage lint fixes across affected files
  git commit -m "fix(lint): drive lint to exit 0 — no-undef root cause, no-useless-assignment, no-unused-vars, no-empty"
  ```

---

## Task 5 — Address pr-reviewer findings

**Source:** `tasks/builds/lint-typecheck-baseline/remaining-work.md` §6 for the S1/S2/S3/N1/N3/N4 IDs.

### 5.1 — S1: `IdempotencyContract` stub is incomplete (Strong)

**File:** `server/config/actionRegistry.ts` (lines 55–57)

Current stub:
```typescript
export interface IdempotencyContract {
  ttlClass: 'permanent' | 'long' | 'short';
}
```

**Required fields** per `docs/superpowers/specs/2026-04-26-system-agents-v7-1-migration-spec.md` §588:
- `keyShape: string[]` — ordered list of `ActionContext` fields that form the idempotency key
- `scope: 'subaccount' | 'org'` — the dedup boundary
- `reclaimEligibility: 'eligible' | 'disabled'` — whether the lock record can be reclaimed after TTL

- [ ] **Step 1: Read `server/config/actionRegistry.ts` around line 55 to confirm current stub shape**

- [ ] **Step 2: Replace the stub with the complete interface**

  ```typescript
  export interface IdempotencyContract {
    /** Ordered ActionContext field names that together form the idempotency key. See v7.1 spec §588. */
    keyShape: string[];
    /** Dedup boundary. See v7.1 spec §588. */
    scope: 'subaccount' | 'org';
    /** Retention class before expiry. See v7.1 spec §588. */
    ttlClass: 'permanent' | 'long' | 'short';
    /** Whether the lock record may be reclaimed after TTL. See v7.1 spec §588. */
    reclaimEligibility: 'eligible' | 'disabled';
  }
  ```

- [ ] **Step 3: Verify postcondition**

  ```bash
  grep -nE "keyShape:|scope:|reclaimEligibility:" server/config/actionRegistry.ts
  ```
  Must return at least one match for each of the three new field names alongside `ttlClass:`.

- [ ] **Step 4: Verify no new TS errors**

  ```bash
  npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "actionRegistry"
  ```
  Expected: 0 lines.

### 5.2 — S2: `visibilityPredicatePure.ts` switch not exhaustive (Strong)

**File:** `server/services/principal/visibilityPredicatePure.ts`

Current switch (lines 14–38) covers `'service'`, `'user'`, `'delegated'` but not `'system'`. The `SystemPrincipal` type was added to the `PrincipalContext` union but the switch never got a case — it falls through to `return false` silently.

**Pinned policy:** `case 'system': return true` — system principals bypass visibility scoping by design. The org gate at line 12 (`row.organisationId !== principal.organisationId`) still applies; this case fires after that gate.

- [ ] **Step 5: Read the full switch statement (lines 11–41)**

- [ ] **Step 6: Add the `'system'` case and replace the trailing `return false` with a `default` guard**

  The switch currently ends with a bare `return false` at line 40. Replace that with:
  ```typescript
    case 'system':
      // SystemPrincipal bypasses visibility scoping by design.
      // Org gate at line 12 still applies. See S2 policy note in
      // docs/superpowers/specs/2026-05-01-lint-typecheck-post-merge-spec.md.
      return true;

    default: {
      const _exhaustive: never = principal;
      return false;
    }
  ```

- [ ] **Step 7: Verify — exhaustiveness check fires for future union additions**

  ```bash
  npx tsc --noEmit -p server/tsconfig.json 2>&1 | grep "visibilityPredicatePure"
  ```
  Expected: 0 lines. If a new principal type is added later without a case, the `never` assignment produces `TS2322`.

### 5.3 — S3: Add `SystemPrincipal` test coverage (Strong)

**File:** `server/services/__tests__/visibilityPredicatePure.test.ts`

The existing file uses constants `ORG_A = 'org-aaa'`, `ORG_B = 'org-bbb'`, `USER_2 = 'user-222'` and a `row()` helper defaulting to `organisationId: ORG_A`. Construct `SystemPrincipal` as a literal (not via `getSystemPrincipal()` which returns a `Promise`).

`SystemPrincipal` requires all six fields (from `server/services/principal/types.ts:30–37`):
```typescript
{ type: 'system', id: string, organisationId: string, subaccountId: null, teamIds: string[], isSystemPrincipal: true }
```

- [ ] **Step 8: Run the test file to see its current passing state**

  ```bash
  npx tsx server/services/__tests__/visibilityPredicatePure.test.ts 2>&1 | tail -5
  ```

- [ ] **Step 9: Append two failing tests to the file**

  ```typescript
  import type { SystemPrincipal } from '../principal/types.js';

  console.log('');
  console.log('system principal');

  test('system principal granted visibility when org matches', () => {
    const principal: SystemPrincipal = {
      type: 'system',
      id: 'system-principal',
      organisationId: ORG_A,
      subaccountId: null,
      teamIds: [],
      isSystemPrincipal: true,
    };
    // private row, different owner — system bypasses ownership scoping
    expect(isVisibleTo(row({ visibilityScope: 'private', ownerUserId: USER_2 }), principal)).toBe(true);
    // subaccount-scoped row — system bypasses subaccount scoping
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
    // row belongs to ORG_A; system principal is from ORG_B — org gate must fire
    expect(isVisibleTo(row({ visibilityScope: 'shared_org' }), principal)).toBe(false);
  });
  ```

- [ ] **Step 10: Run to verify the two new tests fail (before S2 fix)**

  ```bash
  npx tsx server/services/__tests__/visibilityPredicatePure.test.ts 2>&1 | tail -10
  ```
  Expected: 2 failures in the `system principal` group.

- [ ] **Step 11: Apply S2 fix (step 6 above), then re-run**

  ```bash
  npx tsx server/services/__tests__/visibilityPredicatePure.test.ts 2>&1 | tail -5
  ```
  Expected: all tests pass.

- [ ] **Step 12: Commit S1 + S2 + S3 together**

  ```bash
  git add server/config/actionRegistry.ts \
    server/services/principal/visibilityPredicatePure.ts \
    server/services/__tests__/visibilityPredicatePure.test.ts
  git commit -m "fix(review): S1 IdempotencyContract fields, S2 system principal switch + exhaustive guard, S3 system principal tests"
  ```

### 5.4 — N1: Dead branch comment in `llmRouter.ts` (Non-blocking)

**File:** `server/services/llmRouter.ts` (~line 1289)

The comment implies `if (capturedProviderResponse !== null)` is reachable; it is not given current control flow.

- [ ] **Step 13: Locate the comment**

  ```bash
  grep -n "capturedProviderResponse" server/services/llmRouter.ts
  ```

- [ ] **Step 14: Rewrite the comment (Option A — preferred)**

  Replace the misleading comment with:
  ```typescript
  // defensive dead branch — capturedProviderResponse is always null here;
  // kept as a guard against future refactors that might make this path reachable
  ```

- [ ] **Step 15: Verify postcondition**

  ```bash
  grep -n "capturedProviderResponse" server/services/llmRouter.ts
  ```
  Must show the new "defensive dead branch" wording. The "implies reachable" wording must be gone.

### 5.5 — N3: `idempotencyKey` on `IncidentInput` is never consumed (Non-blocking)

**File:** `server/services/incidentIngestorPure.ts` (~line 37)

`idempotencyKey` is set by callers but `computeFingerprint` ignores it — it is a silent no-op field.

- [ ] **Step 16: Read `incidentIngestorPure.ts` and the `computeFingerprint` function**

- [ ] **Step 17: Check all callers**

  ```bash
  grep -rn "idempotencyKey" server/
  ```

- [ ] **Step 18: Implement Option A (preferred) — wire as a fallback seed**

  Priority chain in `computeFingerprint`: `fingerprintOverride` (wins outright) → `idempotencyKey` (caller-supplied dedup seed) → derived stack/message hash (default).

  ```typescript
  /**
   * Priority: fingerprintOverride → idempotencyKey → derived stack/message hash.
   */
  function computeFingerprint(input: IncidentInput): string {
    if (input.fingerprintOverride) return input.fingerprintOverride;
    if (input.idempotencyKey) return input.idempotencyKey; // caller-supplied dedup seed
    // ... existing derived hash logic ...
  }
  ```

  If callers provably never rely on `idempotencyKey` for dedup (grep returns only setter-not-reader patterns), use **Option B**: remove the field from `IncidentInput` and migrate callers to `fingerprintOverride`.

- [ ] **Step 19: Verify consistency**

  ```bash
  grep -rn "idempotencyKey" server/services/incidentIngestorPure.ts server/lib/ server/jobs/ server/routes/
  ```
  Must show field consistently used (Option A) OR completely absent (Option B). No mixed state.

- [ ] **Step 20: Commit N1 + N3**

  ```bash
  git add server/services/llmRouter.ts server/services/incidentIngestorPure.ts
  git commit -m "fix(review): N1 dead branch comment, N3 idempotencyKey wired into computeFingerprint"
  ```

---

## Task 6 — CI gate and doc updates

### 6.1 — Add `lint_and_typecheck` job to `.github/workflows/ci.yml`

**File:** `.github/workflows/ci.yml`

Current `on:` trigger (lines 3–5):
```yaml
on:
  pull_request:
    types: [labeled, synchronize]
```

- [ ] **Step 1: Read the current `ci.yml` for job structure (runner, node version, cache strategy)**

- [ ] **Step 2: Extend the workflow trigger**

  ```yaml
  on:
    pull_request:
      types: [opened, reopened, ready_for_review, labeled, synchronize]
  ```
  Without `opened`/`reopened`/`ready_for_review`, a freshly opened PR or draft transitioning to ready slips the gate until the next push.

- [ ] **Step 3: Add the `lint_and_typecheck` job to the `jobs:` section**

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
  **Do NOT add `if:` label gate** — this job must run unconditionally.
  **Do NOT add `continue-on-error: true`** — must be blocking.

- [ ] **Step 4: Validate YAML**

  ```bash
  node -e "const fs=require('fs');const yaml=require('yaml');try{yaml.parse(fs.readFileSync('.github/workflows/ci.yml','utf8'));console.log('valid');}catch(e){console.error(e.message);process.exit(1);}"
  ```
  Expected: prints `valid`.

### 6.2 — Update CLAUDE.md verification table

**File:** `CLAUDE.md`

- [ ] **Step 5: Locate the typecheck row**

  ```bash
  grep -n "npm run typecheck" CLAUDE.md
  ```

- [ ] **Step 6: Remove the `npx tsc --noEmit` fallback**

  Change:
  ```
  npm run typecheck (or npx tsc --noEmit)
  ```
  to:
  ```
  npm run typecheck
  ```

### 6.3 — Update agent definitions

**Files:** `.claude/agents/pr-reviewer.md`, `.claude/agents/spec-conformance.md`, `.claude/agents/dual-reviewer.md`

- [ ] **Step 7: Read each agent file to locate the verification/post-implementation section**

- [ ] **Step 8: Update `pr-reviewer.md`**

  Add in the pre-done check section:
  ```
  - The author must run `npm run lint && npm run typecheck` before marking done.
    Flag any new lint errors or typecheck failures in changed files as blocking issues.
  ```

- [ ] **Step 9: Update `spec-conformance.md`**

  Add `npm run lint && npm run typecheck` to the verification commands run after auto-fixes (alongside existing checks).

- [ ] **Step 10: Update `dual-reviewer.md`**

  Add both commands to the per-round verification step. Skip if already present.

- [ ] **Step 11: Commit**

  ```bash
  git add .github/workflows/ci.yml CLAUDE.md \
    .claude/agents/pr-reviewer.md .claude/agents/spec-conformance.md .claude/agents/dual-reviewer.md
  git commit -m "ci: add lint_and_typecheck gate; update CLAUDE.md and agent definitions"
  ```

---

## Task 7 — Verify deferred tests (F14 + F28) in `tasks/todo.md`

**No code written.** Verification-only task.

- [ ] **Step 1: Verify the deferred-testing-posture heading exists exactly once**

  ```bash
  grep -nE "^## Deferred — testing posture \(lint-typecheck-post-merge spec\)$" tasks/todo.md
  ```
  Expected: exactly one match.

- [ ] **Step 2: Verify F14 and F28 are NOT present as bare checkbox rows**

  ```bash
  grep -nE "^- \[ \] F(14|28):" tasks/todo.md
  ```
  Expected: **zero** matches (they exist only under the deferred-testing-posture heading, not as bare `- [ ] F14:` rows elsewhere).

- [ ] **Step 3: Restore canonical state if either check failed**

  If step 1 returned 0 matches: add the heading `## Deferred — testing posture (lint-typecheck-post-merge spec)` near the bottom of `tasks/todo.md` with the F14 and F28 checkbox rows beneath it.

  If step 2 returned >0 matches: replace the bare checkbox rows in the PR #246 section with a single pointer line pointing at the deferred-testing-posture section.

  **F14 canonical text:**
  ```
  - [ ] **F14 — migration compatibility test for null `agentDiagnosis` rows.** Originating file (when written): `server/services/systemMonitor/skills/__tests__/writeDiagnosisLegacyRows.test.ts`. Asserts that `agentDiagnosisRunId` and `agentDiagnosis` read as `null` for legacy pre-migration rows. DB-backed integration test — deferred under `runtime_tests: pure_function_only` posture. [auto - spec-reviewer]
  ```

  **F28 canonical text:**
  ```
  - [ ] **F28 — idempotency double-tap for `executeWriteDiagnosis`.** Originating file (when written): `server/services/systemMonitor/skills/__tests__/writeDiagnosis.test.ts`. Second call returns `{ success: true, suppressed: false }` per actual implementation at `writeDiagnosis.ts:62-63, 124-127`. DB-backed integration test — deferred. [auto - spec-reviewer]
  ```

---

## Task 8 — Doc alignment and final review

### 8.1 — F5: Document `sideEffectClass: 'none'` in the baseline plan

**File:** `docs/superpowers/plans/2026-05-01-lint-typecheck-baseline.md`

- [ ] **Step 1: Locate the `ActionDefinition` / `sideEffectClass` section (Task 9 of that plan)**

- [ ] **Step 2: Append note**

  ```
  > `'none'` was added as a third valid class alongside `'read'` and `'write'`.
  > Downstream logic (`managerGuardPure`) only gates on `'write'`, so `'none'` passes
  > through identically to `'read'`. The plan's original `'read' | 'write'` union was incomplete.
  ```

### 8.2 — F7: Document `agentDiagnosis` as `jsonb` in the baseline plan

**File:** `docs/superpowers/plans/2026-05-01-lint-typecheck-baseline.md`

- [ ] **Step 3: Locate the Task 6 section (diagnosis columns + migration)**

- [ ] **Step 4: Append note**

  ```
  > `agentDiagnosis` is stored as `jsonb`, not the plan's original `text`. JSONB is correct
  > for structured diagnosis data (queryable, validates JSON). The type decision was made
  > after the plan was written.
  ```

- [ ] **Step 5: Commit doc alignment**

  ```bash
  git add docs/superpowers/plans/2026-05-01-lint-typecheck-baseline.md
  git commit -m "docs: F5 sideEffectClass none, F7 agentDiagnosis jsonb — plan alignment notes"
  ```

### 8.3 — Final `pr-reviewer` pass

- [ ] **Step 6: Invoke pr-reviewer**

  ```
  pr-reviewer: review all changes on branch lint-typecheck-post-merge-tasks vs main
  ```

- [ ] **Step 7: Address any strong findings before marking complete**

- [ ] **Step 8: Route non-blocking findings to `tasks/todo.md`**

  Use this exact heading shape (matches the existing pattern):
  ```markdown
  ## PR Review deferred items

  ### PR #<N> — lint-typecheck-post-merge-tasks (<YYYY-MM-DD>)

  - [ ] <one-line finding> [auto] | [user]
  ```

---

## Verification

Run all checks before marking this plan complete.

| Check | Command | Required result |
|-------|---------|----------------|
| TypeScript clean | `npm run typecheck` | Exit 0, 0 error lines |
| Lint clean | `npm run lint` | Exit 0, 0 error lines (warnings ok) |
| CI YAML valid | `node -e "const fs=require('fs');const yaml=require('yaml');yaml.parse(fs.readFileSync('.github/workflows/ci.yml','utf8'));console.log('valid');"` | Prints `valid` |
| S2 switch exhaustive | `npm run typecheck` | No `TS2322` on `never` in `visibilityPredicatePure` |
| S3 tests pass | `npx tsx server/services/__tests__/visibilityPredicatePure.test.ts` | All tests pass |
| F14 + F28 deferred | `grep -nE "^## Deferred — testing posture \(lint-typecheck-post-merge spec\)$" tasks/todo.md` | Exactly 1 match |
| F14 + F28 not bare checkboxes | `grep -nE "^- \[ \] F(14\|28):" tasks/todo.md` | 0 matches |

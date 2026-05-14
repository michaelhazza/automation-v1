# Lint + Typecheck Baseline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install ESLint, fix all 183 server TypeScript errors, make `npm run lint` and `npm run typecheck` both exit 0, then promote both as mandatory CI gates on every PR.

**Architecture:** Four root-cause clusters drive almost all 183 errors — missing schema re-exports, missing/incomplete type interface definitions, tsconfig `lib` too old for ES2021/ES2022 features already in use, and test-file null-narrowing gaps. Fix the root causes first; cascading errors clear themselves. ESLint is separate: install → configure flat config → triage by rule count → fix or downgrade per brief policy.

**Tech Stack:** TypeScript 5.x (strict), ESLint 9 flat config, typescript-eslint, react-hooks plugin, Drizzle ORM, GitHub Actions

**Branch:** `lint-typecheck-baseline` (already created off `main`)

---

## Contents

1. [Error inventory](#error-inventory)
2. [File map](#file-map)
3. [Task 1 — npm install + ESLint installation](#task-1--npm-install--eslint-installation)
4. [Task 2 — Create eslint.config.js](#task-2--create-eslintconfigjs)
5. [Task 3 — Fix tsconfig lib](#task-3--fix-tsconfig-lib)
6. [Task 4 — Fix schema index exports](#task-4--fix-schema-index-exports)
7. [Task 5 — Fix SystemIncidentEventType union](#task-5--fix-systemincidenteventtype-union)
8. [Task 6 — Add diagnosis columns + migration](#task-6--add-diagnosis-columns--migration)
9. [Task 7 — Add idempotencyKey to IncidentInput](#task-7--add-idempotencykey-to-incidentinput)
10. [Task 8 — Add SystemPrincipal to types.ts](#task-8--add-systemprincipal-to-typests)
11. [Task 9 — Add IdempotencyContract + ActionDefinition fields](#task-9--add-idempotencycontract--actiondefinition-fields)
12. [Task 10 — Fix scattered production code errors](#task-10--fix-scattered-production-code-errors)
13. [Task 11 — Fix googleWorkspaceAdapter](#task-11--fix-googleworkspaceadapter)
14. [Task 12 — Fix test file null-narrowing errors](#task-12--fix-test-file-null-narrowing-errors)
15. [Task 13 — Triage lint violations](#task-13--triage-lint-violations)
16. [Task 14 — Fix or downgrade remaining lint violations](#task-14--fix-or-downgrade-remaining-lint-violations)
17. [Task 15 — Add CI job](#task-15--add-ci-job)
18. [Task 16 — Update CLAUDE.md and agent definitions](#task-16--update-claudemd-and-agent-definitions)
19. [Task 17 — Final verification](#task-17--final-verification)
20. [Self-review against brief](#self-review-against-brief)

---

## Error inventory

| Cluster | Files | Count | Fix strategy |
|---------|-------|-------|--------------|
| Missing schema index exports | `writeHeuristicFire.ts`, `baselineReader.ts` | 2 | Add 2 `export *` lines to `schema/index.ts` |
| Missing event types in union | `triageHandler.ts`, `rateLimit.ts`, `writeEvent.ts` | ~6 | Extend `SystemIncidentEventType` |
| Missing schema columns | `writeDiagnosis.ts` | 2 | Add columns + migration |
| Missing `idempotencyKey` on `IncidentInput` | `sweepHandler.ts`, `syntheticChecksTickHandler.ts` | 2 | Add optional field to interface |
| Missing `SystemPrincipal` type | `systemPrincipal.ts`, `assertSystemAdminContext.ts` | 2 | Add interface + update union |
| Missing `IdempotencyContract` | `skillIdempotencyKeysPure.ts` | 2 | Add interface to `actionRegistry.ts` |
| Missing `ActionDefinition` fields | `managerGuardPure.ts` | 3 | Add 3 optional fields to interface |
| tsconfig lib too old | `workspaceEmailPipelinePure.ts`, `incidentIngestor.ts` | 3 | Bump `lib` to ES2021+ES2022 |
| `req.userId` API drift | `workspace.ts` | 7 | `req.userId` → `req.user?.id` |
| `parent.organisationId` scoping | `agentRunFinalizationService.ts` | 1 | Capture in outer-scope `let` |
| `rows.rows` Drizzle API drift | `systemAgentRegistryValidator.ts` | 2 | `rows.rows` → `rows` |
| `providerResponse` narrowed to `never` | `llmRouter.ts` | 3 | Snapshot to `const` before inner `if` |
| `Job<unknown>` double-cast | `index.ts` | 1 | Cast via `unknown` intermediary |
| `FastPathDecision` index sig | `conversations.ts` | 1 | Cast `as unknown as ...` |
| `CheckRow` constraint | `inboundRateLimiter.ts` | 1 | `extends Record<string,unknown>` |
| `googleapis` not installed | `googleWorkspaceAdapter.ts` | 1 | `npm install` (in package.json, missing from node_modules) |
| `googleWorkspaceAdapter` implicit any | `googleWorkspaceAdapter.ts` | 9 | Explicit param types |
| **Test file null-narrowing (TS18047 / TS2722)** | 18 test files | ~134 | `!` assertions / `?.` narrowing |

**Production total: ~49 errors. Test total: ~134. Grand total: 183.**

---

## File map

### Created
- `server/db/migrations/<next>.sql` — `agentDiagnosisRunId` + `agentDiagnosis` columns (auto-generated)
- `eslint.config.js` — flat ESLint config

### Modified
| File | What changes |
|------|-------------|
| `server/tsconfig.json` | Add `"lib": ["ES2020","ES2021","ES2022"]` |
| `server/db/schema/index.ts` | Add 2 `export *` lines |
| `server/db/schema/systemIncidentEvents.ts` | Extend `SystemIncidentEventType` union |
| `server/db/schema/systemIncidents.ts` | Add `agentDiagnosisRunId`, `agentDiagnosis` |
| `server/services/incidentIngestorPure.ts` | Add `idempotencyKey?: string` to `IncidentInput` |
| `server/services/principal/types.ts` | Add `SystemPrincipal`, update `PrincipalContext` |
| `server/config/actionRegistry.ts` | Add `IdempotencyContract`, extend `ActionDefinition` |
| `server/routes/workspace.ts` | `req.userId` → `req.user?.id` (7 spots) |
| `server/services/agentRunFinalizationService.ts` | Capture `parentOrganisationId` before tx |
| `server/services/systemAgentRegistryValidator.ts` | `rows.rows` → `rows`, fix `r` type |
| `server/services/llmRouter.ts` | Snapshot `providerResponse` before inner `if` |
| `server/index.ts` | Cast `job` via `unknown` |
| `server/routes/conversations.ts` | Cast `fastPathDecision as unknown as ...` |
| `server/lib/inboundRateLimiter.ts` | `CheckRow extends Record<string,unknown>` |
| `server/adapters/workspace/googleWorkspaceAdapter.ts` | Explicit param types + `undefined` narrowing |
| 18 test files | `!` / `?.` to satisfy strict null checks |
| `.github/workflows/ci.yml` | Add `lint_and_typecheck` job |
| `CLAUDE.md` | Update verification table |
| `.claude/agents/pr-reviewer.md` | Add lint+typecheck to verification phase |
| `.claude/agents/spec-conformance.md` | Same |
| `.claude/agents/dual-reviewer.md` | Same |

---

## Task 1 — npm install + ESLint installation

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Install missing production dep (googleapis in package.json but not node_modules)**

```bash
npm install
```

Expected: exits 0, `node_modules/googleapis` now present.

- [ ] **Step 2: Install ESLint devDeps**

```bash
npm install --save-dev eslint typescript-eslint eslint-plugin-react-hooks globals
```

Expected: exits 0. Verify: `cat package.json | grep eslint` shows 3+ entries.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install eslint + typescript-eslint + react-hooks plugin"
```

---

## Task 2 — Create eslint.config.js

**Files:** Create `eslint.config.js`

- [ ] **Step 1: Create the config**

```javascript
// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'client/dist/**', 'coverage/**', 'server/db/migrations/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['server/**/*.ts', 'shared/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { project: './server/tsconfig.json' },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['client/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { project: './tsconfig.json' },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
```

- [ ] **Step 2: Run lint and capture violation count by rule (this is the Phase 2b baseline)**

```bash
npm run lint 2>&1 | tail -5
```

Save the summary line. If the config fails to parse, fix the error before continuing.

- [ ] **Step 3: Commit**

```bash
git add eslint.config.js
git commit -m "chore: add eslint flat config (typescript-eslint recommended + react-hooks)"
```

---

## Task 3 — Fix tsconfig lib

**Files:** `server/tsconfig.json`

`target: ES2020` sets the output syntax but doesn't auto-include runtime APIs. `replaceAll` is ES2021, `Error.cause` is ES2022. Adding them to `lib` is a type-check signal only — Node 20 has both at runtime.

- [ ] **Step 1: Add lib to server/tsconfig.json**

Open `server/tsconfig.json`. In `compilerOptions`, add after `"target": "ES2020"`:
```json
"lib": ["ES2020", "ES2021", "ES2022"],
```

- [ ] **Step 2: Verify the two target errors are gone**

```bash
npm run typecheck:server 2>&1 | grep -E "replaceAll|cause"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add server/tsconfig.json
git commit -m "fix(tsconfig): add ES2021+ES2022 lib for replaceAll and Error.cause"
```

---

## Task 4 — Fix schema index exports

**Files:** `server/db/schema/index.ts`

`systemMonitorHeuristicFires.ts` and `systemMonitorBaselines.ts` both exist in `server/db/schema/` but are not re-exported from the index. The services that import them get a "no exported member" error.

- [ ] **Step 1: Add the two missing exports**

In `server/db/schema/index.ts`, find the System Monitoring section:
```typescript
// System Monitoring Foundation — incident sink + audit log + suppressions (migration 0224)
// BYPASSES RLS — all readers must be sysadmin-gated; see rlsProtectedTables.ts commentary.
export * from './systemIncidents.js';
export * from './systemIncidentEvents.js';
export * from './systemIncidentSuppressions.js';
```

Append two lines after `systemIncidentSuppressions.js`:
```typescript
export * from './systemMonitorHeuristicFires.js';
export * from './systemMonitorBaselines.js';
```

- [ ] **Step 2: Verify those two errors clear**

```bash
npm run typecheck:server 2>&1 | grep -E "systemMonitorHeuristic|systemMonitorBaselines"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add server/db/schema/index.ts
git commit -m "fix(schema): export systemMonitorHeuristicFires and systemMonitorBaselines from schema index"
```

---

## Task 5 — Fix SystemIncidentEventType union

**Files:** `server/db/schema/systemIncidentEvents.ts`

The triage and escalation services emit four event types missing from the union: `agent_triage_skipped`, `agent_triage_failed`, `agent_triage_timed_out`, `agent_auto_escalated`. These are real events produced by active code paths — schema-debt, not dead code.

- [ ] **Step 1: Extend the union**

In `server/db/schema/systemIncidentEvents.ts`, find `export type SystemIncidentEventType`. It currently ends with `| 'note';`.

Replace the closing `| 'note';` with:
```typescript
  | 'note'
  // Triage agent lifecycle events (system monitor triage flow)
  | 'agent_triage_skipped'
  | 'agent_triage_failed'
  | 'agent_triage_timed_out'
  | 'agent_auto_escalated';
```

- [ ] **Step 2: Verify triage event-type errors clear**

```bash
npm run typecheck:server 2>&1 | grep "agent_triage\|agent_auto_escalated"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add server/db/schema/systemIncidentEvents.ts
git commit -m "fix(schema): add triage lifecycle event types to SystemIncidentEventType union"
```

---

## Task 6 — Add diagnosis columns + migration

**Files:** `server/db/schema/systemIncidents.ts`, `server/db/migrations/<next>.sql`

`writeDiagnosis.ts` selects and updates `agentDiagnosisRunId` and `agentDiagnosis` on `system_incidents`. Neither column exists in the Drizzle schema. Both are real — the diagnosis agent writes them after a triage run.

- [ ] **Step 1: Check existing imports in systemIncidents.ts**

```bash
head -10 server/db/schema/systemIncidents.ts
```

Note whether `agentRuns` is already imported. If not, you'll need to add the import.

- [ ] **Step 2: Add columns to the Drizzle schema**

In `server/db/schema/systemIncidents.ts`, find `lastTriageJobId: text('last_triage_job_id'),` and add after it (before `createdAt`):

```typescript
    // Diagnosis agent output — populated after an agent completes a diagnosis pass
    agentDiagnosisRunId: uuid('agent_diagnosis_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    agentDiagnosis: text('agent_diagnosis'),
```

> `agentDiagnosis` is stored as `jsonb`, not the plan's original `text`. JSONB is correct
> for structured diagnosis data (queryable, validates JSON). The type decision was made
> after the plan was written.

If `agentRuns` is not imported at the top, add:
```typescript
import { agentRuns } from './agentRuns.js';
```

- [ ] **Step 3: Generate the migration**

```bash
npm run db:generate
```

Expected: a new `.sql` file appears in `server/db/migrations/`. Review it — it should contain only two `ALTER TABLE system_incidents ADD COLUMN` statements. If it generates more, investigate before proceeding.

- [ ] **Step 4: Verify writeDiagnosis errors clear**

```bash
npm run typecheck:server 2>&1 | grep "writeDiagnosis"
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add server/db/schema/systemIncidents.ts server/db/migrations/
git commit -m "fix(schema): add agentDiagnosisRunId and agentDiagnosis columns to system_incidents"
```

---

## Task 7 — Add idempotencyKey to IncidentInput

**Files:** `server/services/incidentIngestorPure.ts`

Both `sweepHandler.ts` and `syntheticChecksTickHandler.ts` pass `idempotencyKey` in the `IncidentInput` object. The field is absent from the interface.

- [ ] **Step 1: Add the field**

In `server/services/incidentIngestorPure.ts`, find the `IncidentInput` interface. After `fingerprintOverride?: string;`, add:

```typescript
  // Caller-supplied deduplication key; overrides stack-derived fingerprinting
  // for sweep and synthetic check callers that have domain-stable identifiers.
  idempotencyKey?: string;
```

- [ ] **Step 2: Verify sweep/synthetic errors clear**

```bash
npm run typecheck:server 2>&1 | grep -E "sweepHandler|syntheticChecks|idempotencyKey"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add server/services/incidentIngestorPure.ts
git commit -m "fix(types): add optional idempotencyKey to IncidentInput interface"
```

---

## Task 8 — Add SystemPrincipal to types.ts

**Files:** `server/services/principal/types.ts`

`systemPrincipal.ts` imports `SystemPrincipal` and produces an object that `satisfies SystemPrincipal`. `assertSystemAdminContext.ts` checks `ctx.principal?.type === 'system'`. Neither works because `SystemPrincipal` is not defined and not in `PrincipalContext`.

- [ ] **Step 1: Read the current types.ts**

```bash
cat server/services/principal/types.ts
```

Note the shape of the existing interfaces — match the pattern for the new one.

- [ ] **Step 2: Add SystemPrincipal and update PrincipalContext**

After the last existing interface, add:

```typescript
export interface SystemPrincipal {
  type: 'system';
  id: string;
  organisationId: string;
  subaccountId: null;
  teamIds: string[];
  isSystemPrincipal: true;
}
```

Then update `PrincipalContext` to include it:
```typescript
export type PrincipalContext = UserPrincipal | ServicePrincipal | DelegatedPrincipal | SystemPrincipal;
```

- [ ] **Step 3: Verify systemPrincipal + assertSystemAdminContext errors clear**

```bash
npm run typecheck:server 2>&1 | grep -E "systemPrincipal|assertSystemAdminContext"
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add server/services/principal/types.ts
git commit -m "fix(types): add SystemPrincipal interface and include in PrincipalContext union"
```

---

## Task 9 — Add IdempotencyContract + ActionDefinition fields

**Files:** `server/config/actionRegistry.ts`

Two gaps in this file:
1. `IdempotencyContract` is imported in `skillIdempotencyKeysPure.ts` but not defined — it needs a `ttlClass` property.
2. `ActionDefinition` is missing `managerAllowlistMember`, `directExternalSideEffect`, `sideEffectClass` — all accessed in `managerGuardPure.ts`.

- [ ] **Step 1: Add IdempotencyContract**

Find `export type IdempotencyStrategy = 'read_only' | 'keyed_write' | 'locked';` and add immediately after:

```typescript
export interface IdempotencyContract {
  ttlClass: 'permanent' | 'long' | 'short';
}
```

- [ ] **Step 2: Add optional fields to ActionDefinition**

Find the `ActionDefinition` interface. Near the `idempotencyStrategy` property, add:

```typescript
  // Manager-role guard — spec §9.4
  managerAllowlistMember?: boolean;
  directExternalSideEffect?: boolean;
  sideEffectClass?: 'read' | 'write';
```

> `'none'` was added as a third valid class alongside `'read'` and `'write'`.
> Downstream logic (`managerGuardPure`) only gates on `'write'`, so `'none'` passes
> through identically to `'read'`. The plan's original `'read' | 'write'` union was incomplete.

- [ ] **Step 3: Verify skillIdempotencyKeysPure + managerGuardPure errors clear**

```bash
npm run typecheck:server 2>&1 | grep -E "skillIdempotency|managerGuard|IdempotencyContract"
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add server/config/actionRegistry.ts
git commit -m "fix(types): add IdempotencyContract and manager-guard fields to actionRegistry"
```

---

## Task 10 — Fix scattered production code errors

**Files:** `server/routes/workspace.ts`, `server/services/agentRunFinalizationService.ts`, `server/services/systemAgentRegistryValidator.ts`, `server/index.ts`, `server/routes/conversations.ts`, `server/lib/inboundRateLimiter.ts`, `server/services/llmRouter.ts`

### 10a — workspace.ts: req.userId → req.user?.id (7 occurrences)

The Express `Request` object does not have a `userId` property. Passport attaches the authenticated user as `req.user`; the id is `req.user.id`.

- [ ] **Step 1: Patch all 7 occurrences**

```bash
sed -i 's/req\.userId/req.user?.id/g' server/routes/workspace.ts
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck:server 2>&1 | grep "workspace.ts"
```

Expected: no output.

### 10b — agentRunFinalizationService.ts: capture parentOrganisationId before transaction

`parent` is declared inside the `db.transaction` callback but `parent.organisationId` is accessed after the transaction closes. TypeScript resolves the outer `parent` to the global `Window.parent`, giving `organisationId` does not exist.

- [ ] **Step 3: Add captured variable and assignment**

Near the other captured `let` declarations (around line 193), add:
```typescript
let parentOrganisationId: string | null = null;
```

Inside the transaction, after the `const [parent]` query and the null guard, add:
```typescript
parentOrganisationId = parent.organisationId ?? null;
```

After the transaction (around line 397), replace `parent.organisationId` with `parentOrganisationId`.

- [ ] **Step 4: Verify**

```bash
npm run typecheck:server 2>&1 | grep "agentRunFinalizationService"
```

Expected: no output.

### 10c — systemAgentRegistryValidator.ts: rows.rows → rows

Drizzle's `db.execute` returns an iterable directly — not an object with a `.rows` property.

- [ ] **Step 5: Fix the access**

Find:
```typescript
const dbSlugs = rows.rows.map((r) => r.slug);
```

Replace with:
```typescript
const dbSlugs = [...rows].map((r) => (r as { slug: string }).slug);
```

- [ ] **Step 6: Verify**

```bash
npm run typecheck:server 2>&1 | grep "systemAgentRegistryValidator"
```

Expected: no output.

### 10d — index.ts: Job cast via unknown

- [ ] **Step 7: Add unknown intermediary**

Find:
```typescript
const retryCount = getRetryCount(job as { retrycount?: number } & Record<string, unknown>);
```

Replace with:
```typescript
const retryCount = getRetryCount(job as unknown as { retrycount?: number } & Record<string, unknown>);
```

- [ ] **Step 8: Verify**

```bash
npm run typecheck:server 2>&1 | grep "server/index.ts"
```

Expected: no output.

### 10e — conversations.ts: FastPathDecision index signature

`FastPathDecision` (a Drizzle inferred row type) has properties that don't satisfy the `{ [k: string]: unknown; route: string }` index signature because some of its properties have narrower types.

- [ ] **Step 9: Cast through unknown**

Find the call to `buildConversationFollowUpResponseExtras` that passes `result.fastPathDecision`. Change it to:
```typescript
fastPathDecision: result.fastPathDecision as unknown as { route: string; [k: string]: unknown }
```

- [ ] **Step 10: Verify**

```bash
npm run typecheck:server 2>&1 | grep "conversations.ts"
```

Expected: no output.

### 10f — inboundRateLimiter.ts: CheckRow constraint

`db.execute<T>` requires `T extends Record<string, unknown>`. `CheckRow` has `Date` properties which TypeScript's index constraint doesn't automatically accept.

- [ ] **Step 11: Extend Record**

Change:
```typescript
interface CheckRow {
```
to:
```typescript
interface CheckRow extends Record<string, unknown> {
```

- [ ] **Step 12: Verify**

```bash
npm run typecheck:server 2>&1 | grep "inboundRateLimiter"
```

Expected: no output.

### 10g — llmRouter.ts: providerResponse narrowed to never

Inside the `shouldEmitLaelLifecycle` block, TypeScript narrows `providerResponse` to `never` within the second `if (providerResponse !== null)` check — likely because of control-flow interaction with the preceding ternary cast. Snapshotting to a `const` before the ternary breaks the narrowing chain.

- [ ] **Step 13: Add const snapshot**

Find the block (around line 1288):
```typescript
const partialResponse: Record<string, unknown> | null =
  providerResponse !== null
    ? (providerResponse as unknown as Record<string, unknown>)
    : null;

let failureTokensIn = 0;
let failureTokensOut = 0;
let failureCostCents = 0;
if (providerResponse !== null) {
  failureTokensIn = providerResponse.tokensIn ?? 0;
  failureTokensOut = providerResponse.tokensOut ?? 0;
```

Insert `const capturedProviderResponse = providerResponse;` before `const partialResponse`, then replace all uses of `providerResponse` within this block (the `partialResponse` ternary and the `if` block) with `capturedProviderResponse`.

- [ ] **Step 14: Verify**

```bash
npm run typecheck:server 2>&1 | grep "llmRouter.ts"
```

Expected: no output.

- [ ] **Step 15: Commit all 10a–10g**

```bash
git add server/routes/workspace.ts server/services/agentRunFinalizationService.ts server/services/systemAgentRegistryValidator.ts server/index.ts server/routes/conversations.ts server/lib/inboundRateLimiter.ts server/services/llmRouter.ts
git commit -m "fix(types): scattered production type errors — workspace userId, finalization scope, registry rows, Job cast, FastPathDecision, CheckRow, llmRouter narrowing"
```

---

## Task 11 — Fix googleWorkspaceAdapter

**Files:** `server/adapters/workspace/googleWorkspaceAdapter.ts`

After Task 1's `npm install`, the `googleapis` module resolves. Remaining errors are implicit `any` callback parameters and one `string | null | undefined` assignment.

- [ ] **Step 1: Confirm googleapis module resolves**

```bash
npm run typecheck:server 2>&1 | grep "googleWorkspaceAdapter.ts" | grep "Cannot find module"
```

Expected: no output. If still present, run `npm install` again.

- [ ] **Step 2: Check remaining errors**

```bash
npm run typecheck:server 2>&1 | grep "googleWorkspaceAdapter.ts"
```

Note each line number and error type. All remaining should be `TS7006` (implicit any) or `TS2322` (type mismatch).

- [ ] **Step 3: Fix implicit any parameters**

For each `Parameter 'x' implicitly has an 'any' type` error, read the surrounding code to infer the correct type, then add an explicit annotation. Common patterns in googleapis callbacks:
- String map/filter callbacks: `(s: string) => ...`
- Array reduce accumulators: look at the initial value's type
- Object entry callbacks: `(item: SomeGoogleType) => ...` — import the type from `googleapis`

- [ ] **Step 4: Fix string | null | undefined → string | null**

Find line 287. Add `?? null` to coerce `undefined` to `null`:
```typescript
someField: value ?? null,
```

- [ ] **Step 5: Verify all googleWorkspaceAdapter errors clear**

```bash
npm run typecheck:server 2>&1 | grep "googleWorkspaceAdapter"
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add server/adapters/workspace/googleWorkspaceAdapter.ts
git commit -m "fix(types): explicit parameter types in googleWorkspaceAdapter"
```

---

## Task 12 — Fix test file null-narrowing errors

**Files:** 18 test files, ~134 errors total

All errors are one of two patterns:
- `TS18047: 'x' is possibly 'null'` — value from `regex.exec()`, array access, or nullable function return. Fix with `!`.
- `TS2722: Cannot invoke an object which is possibly 'undefined'` — optional method called without `!`. Fix with `method!(args)`.

In tests, `!` is the right tool. The test setup guarantees the value — using `?.` would silently swallow a test failure instead of surfacing it.

Work file-by-file from largest cluster to smallest.

### fakeProviderAdapter.test.ts — 46 errors (all TS2722)

- [ ] **Step 1: Fix fakeProviderAdapter.test.ts**

```bash
npm run typecheck:server 2>&1 | grep "fakeProviderAdapter.test.ts" | head -10
```

For each `Cannot invoke an object which is possibly 'undefined'` on a method, add `!` before the `(`:
```typescript
// Before
obj.registerProviderAdapter(args)
// After
obj.registerProviderAdapter!(args)
```

### ghlWebhookMutationsPure.test.ts — 26 errors (all TS18047)

- [ ] **Step 2: Fix ghlWebhookMutationsPure.test.ts**

`result` is `T | null`. Add `!` after `result` at each property access:
```typescript
// Before
result.someField
// After
result!.someField
```

### loggerBufferAdapterPure.test.ts — 13 errors (all TS18047)

- [ ] **Step 3: Fix loggerBufferAdapterPure.test.ts**

`line` comes from `regex.exec()` returning `RegExpExecArray | null`. Add `!`:
```typescript
line![1]  // instead of line[1]
```

### managerGuardPure.test.ts — 10 errors

- [ ] **Step 4: Re-check managerGuardPure.test.ts first**

```bash
npm run typecheck:server 2>&1 | grep "managerGuardPure.test.ts"
```

Some of these will be cleared by Task 9's ActionDefinition fix. Only fix what remains.

### llmInflightPayloadStorePure.test.ts — 10 errors

- [ ] **Step 5: Fix llmInflightPayloadStorePure.test.ts**

Same pattern — `!` on nullable values from array access or function returns.

### Remaining test files (1–5 errors each)

- [ ] **Step 6: Fix in one pass**

Files to fix:
- `server/services/__tests__/delegationOutcomeServicePure.test.ts` (5)
- `server/services/__tests__/llmRouterTimeoutPure.test.ts` (4)
- `server/lib/__tests__/derivedDataMissingLog.test.ts` (4)
- `server/lib/__tests__/agentRunEditPermissionMaskPure.test.ts` (4)
- `server/services/__tests__/skillIdempotencyKeysPure.test.ts` (2)
- `server/lib/__tests__/logger.integration.test.ts` (2)
- `server/config/__tests__/jobConfigInvariant.test.ts` (2)
- `shared/__tests__/stateMachineGuardsPure.test.ts` (1)
- `server/tests/services/agentRunCancelService.unit.ts` (1) — compares `'cancelling'` against `'pending' | 'running' | 'delegated'`; read the actual state machine type and either widen the type or remove the stale comparison
- `server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts` (1)
- `server/lib/__tests__/agentRunVisibilityPure.test.ts` (1)
- `server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts` (1)
- `server/jobs/__tests__/llmStartedRowSweepJobPure.test.ts` (1)

- [ ] **Step 7: Full typecheck gate — both projects must exit 0**

```bash
npm run typecheck
echo "Exit: $?"
```

Expected: `Exit: 0`. If any errors remain, fix them before continuing.

- [ ] **Step 8: Commit**

```bash
git add server/ shared/
git commit -m "fix(tests): non-null assertions for strict null check compliance in test files"
```

---

## Task 13 — Triage lint violations

- [ ] **Step 1: Run lint and count violations by rule**

```bash
npm run lint 2>&1 | grep -E "^\s+[0-9]+" | sort | head -30
```

Or with json formatter if available:
```bash
npx eslint . --format=json 2>/dev/null | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const j=JSON.parse(d); const rules={}; j.forEach(f=>f.messages.forEach(m=>{rules[m.ruleId]=(rules[m.ruleId]||0)+1})); Object.entries(rules).sort((a,b)=>b[1]-a[1]).forEach(([r,c])=>console.log(c,r));" 2>/dev/null || npm run lint 2>&1 | tail -5
```

- [ ] **Step 2: Apply auto-fix**

```bash
npm run lint:fix
```

- [ ] **Step 3: Re-check count**

```bash
npm run lint 2>&1 | tail -3
```

Note the remaining error/warning counts. Any rule with >50 remaining errors → triage decision required (see Task 14).

---

## Task 14 — Fix or downgrade remaining lint violations

Policy from the brief:
- Rule with **<50 violations** → fix in this PR
- Rule with **>50 violations, cosmetic** → downgrade to `warn` in `eslint.config.js` with a count comment
- Rule with **>50 violations, likely-bug** (`react-hooks/rules-of-hooks`, `no-floating-promises`, `no-case-declarations`) → never downgrade; fix or open a separate cleanup PR

- [ ] **Step 1: Fix sub-50 rules**

Work rule-by-rule. Fix the violations, verify the rule clears:
```bash
npm run lint 2>&1 | grep "<rule-name>"
```

- [ ] **Step 2: Downgrade noisy cosmetic rules in eslint.config.js**

For each rule you downgrade, add a count comment:
```javascript
// ~NNN violations as of 2026-05-01 — cleanup tracked separately
'@typescript-eslint/some-rule': 'warn',
```

- [ ] **Step 3: Verify lint exits 0 (errors = 0, warnings OK)**

```bash
npm run lint
echo "Exit: $?"
```

Expected: `Exit: 0`

- [ ] **Step 4: Commit**

```bash
git add eslint.config.js server/ client/ shared/
git commit -m "fix(lint): resolve all ESLint errors; downgrade noisy cosmetic rules to warn per brief policy"
```

---

## Task 15 — Add CI job

**Files:** `.github/workflows/ci.yml`

The current workflow has a single `test` job that is label-gated (`ready-to-merge`). The new `lint_and_typecheck` job runs on every PR push — no label gate, no `continue-on-error`.

- [ ] **Step 1: Add the job**

Open `.github/workflows/ci.yml`. After the `on:` block or after the `test` job, add:

```yaml
  lint_and_typecheck:
    name: lint + typecheck
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck
```

No `if:` condition. No `continue-on-error`. Blocking from day one.

- [ ] **Step 2: Validate the YAML**

```bash
npx js-yaml .github/workflows/ci.yml > /dev/null && echo "YAML valid"
```

Expected: `YAML valid`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add lint_and_typecheck job — blocking on every PR push"
```

---

## Task 16 — Update CLAUDE.md and agent definitions

**Files:** `CLAUDE.md`, `.claude/agents/pr-reviewer.md`, `.claude/agents/spec-conformance.md`, `.claude/agents/dual-reviewer.md`

- [ ] **Step 1: Update CLAUDE.md verification table**

Find the row:
```
| Any TypeScript change | `npm run typecheck` (or `npx tsc --noEmit`) | 3 |
```

Replace with:
```
| Any TypeScript change | `npm run typecheck` | 3 |
```

Remove the `(or \`npx tsc --noEmit\`)` fallback — the script now exists.

- [ ] **Step 2: Update pr-reviewer.md**

Find the verification section. Ensure it explicitly states both checks as blocking:
```
- `npm run lint` — must exit 0; any errors are blocking
- `npm run typecheck` — must exit 0; any errors are blocking
```

- [ ] **Step 3: Update spec-conformance.md and dual-reviewer.md**

Same addition as Step 2.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md .claude/agents/pr-reviewer.md .claude/agents/spec-conformance.md .claude/agents/dual-reviewer.md
git commit -m "docs: update CLAUDE.md and agent definitions — lint + typecheck are mandatory blocking checks"
```

---

## Task 17 — Final verification

- [ ] **Step 1: Full typecheck**

```bash
npm run typecheck
echo "typecheck exit: $?"
```

Expected: `typecheck exit: 0`

- [ ] **Step 2: Full lint**

```bash
npm run lint
echo "lint exit: $?"
```

Expected: `lint exit: 0`

- [ ] **Step 3: Review git diff main — no unrelated changes**

```bash
git diff main --stat
```

All changed files must trace to a task in this plan.

- [ ] **Step 4: Run pr-reviewer**

```
pr-reviewer: review the lint/typecheck/CI baseline changes on branch lint-typecheck-baseline
```

---

## Self-review against brief

| Brief requirement | Task | Covered |
|-------------------|------|---------|
| `npm run lint` script exists | Pre-existing in package.json | ✓ |
| `npm run typecheck` script exists | Pre-existing in package.json | ✓ |
| ESLint installed | Task 1 | ✓ |
| `eslint.config.js` created | Task 2 | ✓ |
| Lint baseline measured | Task 2 step 2 | ✓ |
| `npm run lint` exits 0 | Tasks 13–14 | ✓ |
| `npm run typecheck` exits 0 | Tasks 3–12 | ✓ |
| CI job runs on every PR push | Task 15 (no `if:` gate) | ✓ |
| CI job is blocking | Task 15 (no `continue-on-error`) | ✓ |
| CLAUDE.md updated | Task 16 | ✓ |
| Agent definitions updated | Task 16 | ✓ |
| Schema-debt decision documented | Tasks 5–6 (real events/columns, not dead code) | ✓ |
| No pre-commit hooks | Not added | ✓ |
| No Prettier | Not added | ✓ |
| No tsconfig tightening | Deferred | ✓ |

## Post-merge work

- [ ] **Migration compatibility test** — add `it('handles null agentDiagnosis for legacy rows')` covering the case where `agentDiagnosisRunId` / `agentDiagnosis` are null (pre-migration rows). Verifies that read paths and join logic don't silently exclude historical incidents. Surfaced by ChatGPT PR review round 2 (F14).
- [ ] **Idempotency double-tap test for writeDiagnosis** — run the same `(incidentId, agentRunId)` pair twice and verify: no duplicate rows, second call returns `{ success: true }` via the no-op path, state is identical. Surfaced by ChatGPT PR review round 4 (F28).

# lint-typecheck-baseline — Remaining Work Brief

**Branch:** `lint-typecheck-baseline`
**Authored:** 2026-05-01
**Status:** Infrastructure complete; error clearance incomplete. Ready for a new session.

---

## Contents

1. [What this branch already did](#1-what-this-branch-already-did)
2. [Current state](#2-current-state)
3. [Remaining typecheck errors — production code](#3-remaining-typecheck-errors--production-code)
4. [Remaining typecheck errors — test files](#4-remaining-typecheck-errors--test-files)
5. [Remaining lint errors](#5-remaining-lint-errors)
6. [pr-reviewer findings to address](#6-pr-reviewer-findings-to-address)
7. [Still to do after errors clear](#7-still-to-do-after-errors-clear)
8. [Recommended session sequence](#8-recommended-session-sequence)

---

## 1. What this branch already did

Do not redo any of this in the next session.

- Installed ESLint 10 + typescript-eslint 8 + react-hooks plugin + @eslint/js + globals
- Added `npm run lint`, `npm run lint:fix`, `npm run typecheck`, `npm run typecheck:client`, `npm run typecheck:server` scripts to `package.json`
- Created `eslint.config.js` (flat config, permissive — errors for likely-bugs, warnings for cosmetic)
- `server/tsconfig.json` — `"lib": ["ES2020","ES2021","ES2022"]` (fixes `replaceAll`, `Error.cause`)
- `server/db/schema/systemIncidents.ts` — added all triage/diagnosis columns from migrations 0233/0237/0239 that were missing from main's schema file. Added `SystemIncidentTriageStatus`, `SystemIncidentDiagnosisStatus` types.
- `server/db/schema/systemIncidentEvents.ts` — extended `SystemIncidentEventType` with all triage agent events
- `server/db/schema/index.ts` — exported `systemMonitorHeuristicFires` and `systemMonitorBaselines`
- `server/services/principal/types.ts` — added `SystemPrincipal`; updated `PrincipalContext` union
- `server/config/actionRegistry.ts` — added `IdempotencyContract`; added manager-guard fields to `ActionDefinition`
- `server/services/incidentIngestorPure.ts` — added `idempotencyKey?: string` to `IncidentInput`
- `server/lib/inboundRateLimiter.ts`, `server/index.ts`, `server/routes/conversations.ts`, `server/services/agentRunFinalizationService.ts`, `server/services/llmRouter.ts`, `server/services/systemMonitor/triage/rateLimit.ts`, `server/services/systemMonitor/skills/writeDiagnosis.ts`, `server/tests/services/agentRunCancelService.unit.ts`, `server/services/__tests__/reviewServiceIdempotency.test.ts` — various targeted production fixes
- Merged `main` and resolved conflicts

---

## 2. Current state

Measured 2026-05-01 after `npm install`:

| Check | Count |
|-------|-------|
| `npm run typecheck:server` errors | **134** |
| `npm run typecheck:client` errors | **0** |
| `npm run lint` errors | **283** |
| `npm run lint` warnings | **707** |

**First step in the next session: run `npm install`** — vitest and other deps from main may not be present in node_modules if the session starts fresh. This alone drops the typecheck error count from ~399 to 134.

---

## 3. Remaining typecheck errors — production code (11 errors, 4 files)

Fix these first — they're in real routes/services, not tests.

### req.userId → req.user?.id (8 errors, 2 files)

Both files came from the `main` merge and were never patched.

- `server/routes/workspace.ts` lines 180, 255, 500, 531, 576, 607, 654 (7 occurrences)
- `server/routes/suggestedActions.ts` line 25 (1 occurrence)

Fix: `sed -i 's/req\.userId/req.user?.id/g' server/routes/workspace.ts server/routes/suggestedActions.ts`

### systemAgentRegistryValidator.ts — Drizzle API drift (2 errors)

`db.execute()` returns an iterable; `.rows` does not exist on it.

File: `server/services/systemAgentRegistryValidator.ts:45`

Fix:
```typescript
// Before
const dbSlugs = rows.rows.map((r) => r.slug);
// After
const dbSlugs = [...rows].map((r) => (r as { slug: string }).slug);
```

### googleWorkspaceAdapter.ts — null coercion (1 error)

File: `server/adapters/workspace/googleWorkspaceAdapter.ts:287`

Error: `Type 'string | null | undefined' is not assignable to type 'string | null'`

Fix: add `?? null` to the assignment that produces `undefined`.

---

## 4. Remaining typecheck errors — test files (123 errors, ~35 files)

All are one of two mechanical patterns. **Do not add conditional checks — use `!` in tests where setup guarantees the value.**

**Pattern A — TS18047/TS18048: value is possibly null/undefined** → add `!` after the variable.

**Pattern B — TS2722: cannot invoke a possibly-undefined object** → add `!` before `()`.

| File | Errors | Pattern |
|------|--------|---------|
| `server/services/__tests__/fixtures/__tests__/fakeProviderAdapter.test.ts` | 46 | B |
| `server/services/__tests__/ghlWebhookMutationsPure.test.ts` | 26 | A |
| `server/lib/__tests__/loggerBufferAdapterPure.test.ts` | 13 | A |
| `server/services/__tests__/llmInflightPayloadStorePure.test.ts` | 10 | A+B |
| `server/services/__tests__/delegationOutcomeServicePure.test.ts` | 5 | A |
| `server/services/__tests__/llmRouterTimeoutPure.test.ts` | 4 | A |
| `server/lib/__tests__/derivedDataMissingLog.test.ts` | 4 | A |
| `server/lib/__tests__/agentRunEditPermissionMaskPure.test.ts` | 4 | A |
| `server/services/__tests__/skillIdempotencyKeysPure.test.ts` | 2 | A |
| `server/lib/__tests__/logger.integration.test.ts` | 2 | A |
| `server/config/__tests__/jobConfigInvariant.test.ts` | 2 | A |
| `shared/__tests__/stateMachineGuardsPure.test.ts` | 1 | A |
| `server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts` | 1 | A |
| `server/lib/__tests__/agentRunVisibilityPure.test.ts` | 1 | A |
| `server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts` | 1 | A |
| `server/jobs/__tests__/llmStartedRowSweepJobPure.test.ts` | 1 | A |

---

## 5. Remaining lint errors (283 errors)

Run `npm run lint:fix` first — clears ~11 errors automatically. Then by rule:

| Rule | Count | Action |
|------|-------|--------|
| `no-undef` | 125 | **Root cause:** the `files: ['server/**/*.ts', 'shared/**/*.ts']` glob in `eslint.config.js` doesn't cover `scripts/*.ts` and any other top-level TS files, so they hit the global config without the `no-undef: 'off'` override. Fix: add `'no-undef': 'off'` globally (TS makes this rule redundant across the whole codebase), or widen the server `files` block to also include `scripts/**/*.ts`. |
| `no-useless-assignment` | 53 | Remove unused variable assignments or prefix with `_` |
| `@typescript-eslint/no-unused-vars` | 32 | Already set to `warn` — if showing as errors, prefix with `_` |
| `no-empty` | 21 | Add `// intentional` comment inside empty catch/block |
| `no-useless-escape` | 14 | Remove unnecessary backslashes in strings/regex |
| `prefer-const` | 11 | Change `let` → `const` for never-reassigned variables |
| Others | <10 each | Fix individually |

---

## 6. pr-reviewer findings to address

From the review session on 2026-05-01:

| ID | Priority | File | Finding | Fix |
|----|----------|------|---------|-----|
| S1 | Strong | `server/config/actionRegistry.ts:55` | `IdempotencyContract` is a partial stub — missing `keyShape`, `scope`, `reclaimEligibility` per spec §588 | Add the 3 fields or add a comment marking it a typecheck-only stub |
| S2 | Strong | `server/services/principal/visibilityPredicatePure.ts:14` | Switch not exhaustive after `SystemPrincipal` joins union — `'system'` case falls through to `return false` silently | Add `case 'system':` with documented policy; add `default: never` exhaustiveness check |
| S3 | Strong | `server/services/__tests__/visibilityPredicatePure.test.ts` | No test coverage for `SystemPrincipal` in `isVisibleTo` | Add a fixture for system principal and assert the documented policy |
| N1 | Non-blocking | `server/services/llmRouter.ts:1289` | Comment misrepresents the cast — the `if (capturedProviderResponse !== null)` branch is currently unreachable | Rewrite comment to "defensive dead branch" or remove the dead inner `if` block |
| N3 | Non-blocking | `server/services/incidentIngestorPure.ts:37` | `idempotencyKey` on `IncidentInput` is never consumed — callers set it, `computeFingerprint` ignores it | Either wire it into `computeFingerprint` as a fallback, or remove and have callers use `fingerprintOverride` |
| N4 | Non-blocking | `eslint.config.js:8` | Ignore path `server/db/migrations/**` matches nothing (migrations are at `migrations/`) | Change to `migrations/**` or drop the entry |

---

## 7. Still to do after errors clear

1. **Add CI job** (`.github/workflows/ci.yml`) — new `lint_and_typecheck` job, runs on every PR push (no label gate), blocking, 10-min timeout. Steps: `actions/checkout@v4`, `actions/setup-node@v4` (node 20, npm cache), `npm ci`, `npm run lint`, `npm run typecheck`.

2. **Update CLAUDE.md** — in the verification table, change `npm run typecheck (or npx tsc --noEmit)` → `npm run typecheck` (drop the fallback).

3. **Update agent definitions** — `.claude/agents/pr-reviewer.md`, `.claude/agents/spec-conformance.md`, `.claude/agents/dual-reviewer.md`: add `npm run lint` and `npm run typecheck` as explicit blocking checks in their verification steps.

---

## 8. Recommended session sequence

1. `npm install` — first command, always (syncs vitest + other main deps)
2. Fix 4 production files (workspace.ts, suggestedActions.ts, systemAgentRegistryValidator.ts, googleWorkspaceAdapter.ts) — ~15 min
3. Fix test files by pattern — work largest cluster first, then sweep remaining with `!` — ~30 min
4. Fix `no-undef` root cause in `eslint.config.js`; run `npm run lint:fix`; fix remaining sub-50 lint rules manually — ~25 min
5. Verify: `npm run typecheck && npm run lint` both exit 0
6. Add CI job; update CLAUDE.md; update agent defs — ~15 min
7. Address S1/S2/S3/N1/N3/N4 from pr-reviewer — ~30 min
8. `pr-reviewer` pass on the completed diff

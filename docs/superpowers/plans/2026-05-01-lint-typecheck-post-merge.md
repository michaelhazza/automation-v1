# Lint + Typecheck — Post-Merge Work Brief

**Authored:** 2026-05-01  
**Prerequisite:** PR #246 (lint-typecheck-baseline) merged to main  
**Goal:** drive `npm run typecheck` and `npm run lint` to exit 0 on main, wire the CI gate, and close out deferred review items.

> **Detailed error inventory:** `tasks/builds/lint-typecheck-baseline/remaining-work.md` — covers exact line numbers, patterns, and sed-fixable clusters. Read it before the session starts. This brief is the authoritative task list; that file is the error reference.

---

## Current state (measured 2026-05-01 post-merge)

| Check | Count |
|-------|-------|
| `npm run typecheck` errors | **138** |
| `npm run lint` errors | **283** |
| `npm run lint` warnings | **707** (acceptable, not blocking) |

**First command every session:** `npm install` — vitest and other deps from main may not be in node_modules after a fresh clone or branch switch.

---

## Work items

### A — Production typecheck errors (11 errors, 4 files) — fix first

| File | Error | Fix |
|------|-------|-----|
| `server/routes/workspace.ts` (7 occurrences) | `req.userId` does not exist | `s/req\.userId/req.user?.id/g` |
| `server/routes/suggestedActions.ts:25` | `req.userId` does not exist | same sed |
| `server/services/systemAgentRegistryValidator.ts:45` | `.rows` does not exist on Drizzle execute result | `const dbSlugs = [...rows].map((r) => (r as { slug: string }).slug)` |
| `server/adapters/workspace/googleWorkspaceAdapter.ts:287` | `string \| null \| undefined` not assignable to `string \| null` | append `?? null` to the expression |

### B — Test file typecheck errors (127 errors, ~35 files) — mechanical sweep

All are Pattern A (`value is possibly null/undefined` → add `!`) or Pattern B (`cannot invoke possibly-undefined` → add `!` before `()`). **Do not add conditional checks in tests — use `!` where setup guarantees the value.**

Largest clusters (work these first):

| File | Errors | Pattern |
|------|--------|---------|
| `server/services/__tests__/fixtures/__tests__/fakeProviderAdapter.test.ts` | 46 | B |
| `server/services/__tests__/ghlWebhookMutationsPure.test.ts` | 26 | A |
| `server/lib/__tests__/loggerBufferAdapterPure.test.ts` | 13 | A |
| `server/services/__tests__/llmInflightPayloadStorePure.test.ts` | 10 | A+B |
| Remaining ~25 files | <6 each | A |

### C — Lint errors (283 errors) — after typecheck is clean

1. `npm run lint:fix` first — auto-clears ~11 errors.
2. Fix `no-undef` root cause (125 errors): add `'no-undef': 'off'` to the global block in `eslint.config.js` (TypeScript makes this rule redundant; the server/client `files` globs don't cover `scripts/*.ts` and other top-level files, so they hit the global config without the override).
3. Sweep remaining by rule — see `remaining-work.md §5` for the full rule-count table:
   - `no-useless-assignment` (53): remove unused assignments or prefix with `_`
   - `@typescript-eslint/no-unused-vars` (32): prefix unused vars/args with `_`
   - `no-empty` (21): add `// intentional` inside empty catch/blocks
   - `no-useless-escape` (14): remove unnecessary backslashes
   - `prefer-const` (11): `let` → `const` for never-reassigned vars

### D — pr-reviewer findings from PR #246

From the review session log `tasks/review-logs/chatgpt-pr-review-lint-typecheck-baseline-2026-05-01T00-21-37Z.md`:

| ID | Priority | Location | Finding | Action |
|----|----------|----------|---------|--------|
| S1 | Strong | `server/config/actionRegistry.ts:55` | `IdempotencyContract` missing `keyShape`, `scope`, `reclaimEligibility` per spec §588 | Add the 3 fields or mark with `// typecheck-only stub — see spec §588` |
| S2 | Strong | `server/services/principal/visibilityPredicatePure.ts:14` | Switch not exhaustive after `SystemPrincipal` joins union; `'system'` case falls through to `return false` silently | Add `case 'system':` with documented policy; add `default:` exhaustiveness check |
| S3 | Strong | `server/services/__tests__/visibilityPredicatePure.test.ts` | No test for `SystemPrincipal` in `isVisibleTo` | Add fixture + assertion for system principal |
| N1 | Non-blocking | `server/services/llmRouter.ts:1289` | Comment misrepresents a dead branch | Rewrite as "defensive dead branch" or remove |
| N3 | Non-blocking | `server/services/incidentIngestorPure.ts:37` | `idempotencyKey` on `IncidentInput` set by callers but never consumed by `computeFingerprint` | Wire into `computeFingerprint` as fallback, or remove and use `fingerprintOverride` instead |
| N4 | Non-blocking | `eslint.config.js:8` | Ignore path `server/db/migrations/**` matches nothing (migrations live at `migrations/`) | Change to `migrations/**` or drop the entry |

### E — CI gate and doc updates (after A+B+C exit 0)

1. **CI job** — add `lint_and_typecheck` job to `.github/workflows/ci.yml`. Runs on every PR push (no label gate), blocking, 10-min timeout. Steps: `actions/checkout@v4`, `actions/setup-node@v4` (node 20, npm cache), `npm ci`, `npm run lint`, `npm run typecheck`.

2. **CLAUDE.md** — verification table: change `npm run typecheck (or npx tsc --noEmit)` → `npm run typecheck` (drop the fallback now the script is confirmed working).

3. **Agent definitions** — add `npm run lint` and `npm run typecheck` as explicit blocking checks in `.claude/agents/pr-reviewer.md`, `.claude/agents/spec-conformance.md`, `.claude/agents/dual-reviewer.md`.

### F — ChatGPT-deferred tests (from review session)

- **F14:** `it('handles null agentDiagnosis for legacy rows')` — covers `agentDiagnosisRunId` / `agentDiagnosis` being null. Verifies read paths don't silently exclude historical incidents.
- **F28:** Idempotency double-tap for `writeDiagnosis` — run same `(incidentId, agentRunId)` twice; assert second call is a no-op (`success: true, suppressed: true`), no duplicate rows, no state divergence.

### G — Plan doc alignment (low priority, doc-only)

- **F5:** Update `docs/superpowers/plans/2026-05-01-lint-typecheck-baseline.md` to document `sideEffectClass: 'none'` as a valid third class (already safe at runtime; plan just says `'read' | 'write'`).
- **F7:** Same plan doc: note that `agentDiagnosis` column is `jsonb` not `text` (implementation was correct; plan was written before the type decision).

---

## Recommended session sequence

| Step | Action | Estimated time |
|------|--------|----------------|
| 1 | `npm install` | 2 min |
| 2 | Fix A (4 production files) | 10 min |
| 3 | Fix B (test file sweep, largest clusters first) | 30 min |
| 4 | Verify `npm run typecheck` exits 0 | — |
| 5 | Fix C (`eslint.config.js` no-undef root cause, then `lint:fix`, then manual sweep) | 25 min |
| 6 | Verify `npm run lint` exits 0 | — |
| 7 | Address D (S1/S2/S3 strong findings; N1/N3/N4 if time allows) | 20 min |
| 8 | Add CI job + update CLAUDE.md + update agent defs (E) | 15 min |
| 9 | Write F14 + F28 tests | 20 min |
| 10 | G (doc-only alignment, 2 lines each) | 5 min |
| 11 | `pr-reviewer` pass on the completed diff | — |

**Total estimate:** ~2 hours of focused session work.

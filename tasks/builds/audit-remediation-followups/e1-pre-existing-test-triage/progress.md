# E1 — Pre-existing unit test failures triage

**Date:** 2026-04-26
**Branch:** claude/deferred-quality-fixes-ZKgVV
**Spec:** docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md §E1

---

## Per-file results

### 1. `server/services/__tests__/referenceDocumentServicePure.test.ts`

**Failure observed:** Test 7 ("serializeDocument embeds the content after the metadata separator") failed because `out.split('---\n')` was used to isolate the content section. The serialized format is `---DOC_START---\n...\n---\n<content>\n---DOC_END---\n`; splitting on `'---\n'` also matches `---DOC_START---\n`, so `parts[1]` returned the metadata section rather than the content section.

**Disposition:** Test-only bug.

**Fix applied:** Changed `out.split('---\n')[1]` to `out.split('\n---\n')[1]`. The `\n---\n` separator only matches the YAML front-matter separator between metadata and content, not the DOC_START delimiter.

**Re-run result:** 15/15 pass.

---

### 2. `server/services/__tests__/skillAnalyzerServicePureFallbackAndTables.test.ts`

**Failure observed:** Test "remediateTables: recovers missing row with [SOURCE: library] marker" failed because it asserted `out.instructions.includes('[SOURCE: library]')` (bare form). The `withSourceMarker` function in `skillAnalyzerServicePure.ts` was updated to always include the `sourceKey` (heading-qualified headerKey) argument, producing extended annotations like `[SOURCE: library "specs>platform | limit |"]` rather than the bare `[SOURCE: library]`.

**Disposition:** Test-only bug — the implementation was intentionally extended; the test assertion was left stale.

**Fix applied:** Changed assertion from `includes('[SOURCE: library]')` to `includes('[SOURCE: library')` (prefix match). This correctly accepts both bare and extended marker forms.

**Re-run result:** 21/21 pass.

---

### 3. `server/services/__tests__/skillHandlerRegistryEquivalence.test.ts`

**Failure observed:** Two tests failed:
- "SKILL_HANDLERS does not contain any unexpected keys" — 3 unexpected keys: `crm.query`, `ask_clarifying_questions`, `challenge_assumptions`
- "SKILL_HANDLERS has exactly 163 keys" — actual count was 166

These 3 handlers were added to `SKILL_HANDLERS` in `skillExecutor.ts` after the test's baseline of 163 was set. The test is an anti-drift gate that must mirror the registry exactly.

**Disposition:** Test-only bug — the registry grew intentionally; the mirror list was not updated.

**Fix applied:**
- Added `crm.query`, `ask_clarifying_questions`, `challenge_assumptions` to `CANONICAL_HANDLER_KEYS`
- Updated comment header and exact-count assertion from 163 to 166

**Re-run result:** 4/4 pass.

---

### 4. `server/services/crmQueryPlanner/__tests__/crmQueryPlannerService.test.ts`

**Failure observed:** Test file crashed at module load time with a ZodError for `DATABASE_URL`, `JWT_SECRET`, `EMAIL_FROM`. `crmQueryPlannerService.ts` transitively imports `server/db/index.ts` (via `systemSettingsService` and `withPrincipalContext`), which validates env vars via zod on import. Without env-seeding, any environment lacking a `.env` file (CI, ephemeral sandboxes) fails before any test runs.

**Disposition:** Test-only bug — the test is a pure orchestration test (never touches DB), but lacked the env-seeding preamble. The sister test `skillHandlerRegistryEquivalence.test.ts` has the identical pattern and already applies this fix.

**Fix applied:**
- Added `await import('dotenv/config')` + `process.env.DATABASE_URL ??= ...` / `JWT_SECRET` / `EMAIL_FROM` placeholder seeding at the top of the file, matching the pattern in `skillHandlerRegistryEquivalence.test.ts`
- Converted the static `import { runQuery }` to a dynamic `const { runQuery } = await import(...)` placed after the env-seeding block, so the service module initialises after env vars are set (static imports are hoisted before any code in ESM)

**Re-run result:** 13/13 pass.

---

## Summary

All 4 files: test-only bugs. No service logic was touched.

| File | Failure | Disposition | Fix |
|------|---------|-------------|-----|
| referenceDocumentServicePure | split `'---\n'` matched DOC_START delimiter | test-only bug | split on `'\n---\n'` |
| skillAnalyzerServicePureFallbackAndTables | bare `[SOURCE: library]` assertion stale after extended-marker change | test-only bug | prefix match `'[SOURCE: library'` |
| skillHandlerRegistryEquivalence | 3 new handlers not in CANONICAL_HANDLER_KEYS; count stale | test-only bug | add 3 keys; update count to 166 |
| crmQueryPlannerService | no env-seeding preamble; crashed on zod DB_URL validation | test-only bug | add dotenv + placeholder env seed; convert static import to dynamic |

## Final re-run counts

- referenceDocumentServicePure: 15 pass, 0 fail
- skillAnalyzerServicePureFallbackAndTables: 21 pass, 0 fail
- skillHandlerRegistryEquivalence: 4 pass, 0 fail
- crmQueryPlannerService: 13 pass, 0 fail

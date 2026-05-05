# F1 — findAccountBySubaccountId progress

**Spec item:** F1 — targeted `findAccountBySubaccountId` method
**Branch:** claude/deferred-quality-fixes-ZKgVV
**Completed:** 2026-04-26

## Call site audit

Three `getAccountsByOrg` call sites exist outside tests:

| File | Line | Pattern | Migrated? |
|------|------|---------|-----------|
| `server/jobs/measureInterventionOutcomeJob.ts` | 215–216 | `getAccountsByOrg(org)` then `.find(a => a.subaccountId === id)` — single-subaccount filter | Yes |
| `server/services/intelligenceSkillExecutor.ts` | 163–164 | `getAccountsByOrg(org)` then `.filter(a => subaccountIds.includes(a.subaccountId))` — multi-subaccount filter (list) | Not migrated — different shape; would require `findAccountsBySubaccountIds` (plural), out of F1 scope |
| `server/services/intelligenceSkillExecutor.ts` | 643 | `getAccountsByOrg(org)` — all accounts for portfolio report, no filter | Not migrated — intentional full fetch |

## Deferred call sites

The two `intelligenceSkillExecutor.ts` call sites are not candidates for F1:
- Line 163: filters by a _list_ of subaccountIds (`includes()`), not a single one. A `findAccountsBySubaccountIds` bulk method would be the right fix but is out of this spec's scope.
- Line 643: fetches all accounts intentionally for an org-level portfolio report; no per-subaccount filter.

Both deferred call sites are noted here; no `tasks/todo.md` entry added because they are not bugs — the full-fetch is correct for their use case.

## Changes

- `server/services/canonicalDataService.ts`: added `findAccountBySubaccountId(orgId, subaccountId)` — targeted single-row SELECT with WHERE on both `organisationId` and `subaccountId`, `.limit(1)`.
- `server/jobs/measureInterventionOutcomeJob.ts`: `resolveAccountIdForSubaccount` migrated from `getAccountsByOrg` + `.find()` to `findAccountBySubaccountId`.
- `server/services/__tests__/canonicalDataService.findAccountBySubaccountId.test.ts`: 5 `node:test` tests asserting WHERE conditions, `.limit(1)`, found/not-found/cross-org-scoping.

## Verification

- 5/5 tests pass: `npx tsx --test server/services/__tests__/canonicalDataService.findAccountBySubaccountId.test.ts`
- TypeScript build clean: `npm run build:server`

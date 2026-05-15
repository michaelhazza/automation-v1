# PR Review Log — pa-v1-cleanup-batch (Round 1)

**Reviewer:** pr-reviewer (Claude Opus 4.7, 1M)
**Branch:** claude/pa-v1-cleanup-batch
**Round:** 1 of 2
**Timestamp:** 2026-05-15T18:30:00Z
**Files reviewed:**
- `migrations/0360_voice_profiles_schema_align.sql` + `.down.sql` (CREATE)
- `server/db/schema/voiceProfiles.ts` (MODIFY)
- `shared/types/voiceProfile.ts` (MODIFY)
- `server/services/voiceProfile/voiceProfileService.ts` (MODIFY)
- `server/jobs/voiceProfileRefreshJob.ts` (MODIFY)
- `server/services/agentExecutionServicePure.ts` (MODIFY)
- `server/services/operatorSessionInitialContextBundler.ts` (MODIFY)
- `client/src/config/sidebar.ts` (MODIFY)
- `client/src/config/__tests__/buildNavItems.test.ts` (MODIFY)
- `server/services/voiceProfile/__tests__/voiceProfileColumnAlignment.test.ts` (CREATE)
- `tasks/review-logs/spec-conformance-log-personal-assistant-v1-2026-05-12T13-15-07Z.md` (close-out)
- `tasks/todo.md` (flip integrity)
- `tasks/builds/pa-v1-cleanup-batch/{spec.md,plan.md,progress.md}` (context)

---

## Verdict: CHANGES_REQUESTED

REQ-C4 close-out is incomplete — the schema half is correct and aligned, but the provisioning half of the contract (spec §13.4 step 6) was missed despite being called out as a known risk in plan §2.7 row 4. The conformance log close-out asserts REQ-C4 is fully closed; the code disagrees with the spec.

---

## Blocking — must be fixed before merge

[🔴] `server/services/eaProvisioningService.ts:128-140` — REQ-C4 provisioning shape diverges from spec §13.4 step 6 line 1174.

Why: spec explicitly requires `refreshPolicy: 'periodic'` + `refreshConfig: { days: 30 }` + `sourceConfig: { gmail_sent_sampler: { lastN: 50, sinceDays: 90 } }` at wizard provisioning, but the code writes `refreshPolicy: 'manual'` and omits both jsonb values. Behavioural consequence: `voiceProfileRefreshJob.ts:28` filters by `refreshPolicy='periodic'`, so wizard-provisioned profiles never auto-refresh, which contradicts spec §13.4's "profile derives asynchronously, typically <1 minute" + periodic 30-day refresh contract. The conformance log close-out at line 118 asserts REQ-C4 is closed by migration 0360 + Drizzle/Zod/service alignment — that claim is unsupported until provisioning is fixed. Plan §2.7 row 4 explicitly flagged this exact risk.

Fix: change `.values({...})` block to write `refreshPolicy: 'periodic'`, `sourceConfig: { gmail_sent_sampler: { lastN: 50, sinceDays: 90 } }`, `refreshConfig: { days: 30 }`. Add a unit test asserting the persisted shape.

---

## Should-fix — non-blocking but expected to be addressed in-PR

[🟡] `server/services/voiceProfile/voiceProfileService.ts:118` — `sampleSize: 0` hardcoded at row update; spec §1009 says deriveProfile "writes `profileJson` + `sampleSize` + `lastDerivedAt`" with the actual sample count.

Why: the column rename `sample_count → sample_size` was driven by REQ-C4 to align with spec semantics; persisting `0` defeats the rename's purpose. The samplers return `result.sampleSize`/`result.samples.length`, but `deriveProfile` discards it. Current code comment says "sample count intentionally zeroed — samples not retained" which conflates "we don't keep the sample text" with "we don't record how many we processed". They're separate concerns. Also breaks the spec §1092 trace event `voice.profile.refreshed { profileId, sampleSize, durationMs }`.

[🟡] `server/services/eaProvisioningService.ts` — missing test for the provisioning row shape after the BLOCKING fix.

[🟡] Plan-gap audit note in `progress.md:46` is correct but understated. Recommend adding a one-line rule to KNOWLEDGE.md: "When planning a column rename, grep BOTH camelCase Drizzle field names AND any snake_case literals in select projections / SQL templates."

---

## Consider — taste / future-proofing

[💭] `server/services/voiceProfile/voiceProfileServicePure.ts:128` — JSDoc references old column names.
[💭] `server/jobs/voiceProfileRefreshJob.ts:15` — JSDoc could mention `refresh_config.days` is read via `shouldRefresh` post-query.
[💭] `migrations/0360_voice_profiles_schema_align.sql` — index re-create `IF NOT EXISTS` guard semantics across down-then-up cycles. No fix needed; awareness.
[💭] `tasks/review-logs/spec-conformance-log-...md:118,127` — close-out cites commit SHAs that won't match post-rebase. Cosmetic.

---

## Specific checks

- Migration paired with .down.sql: yes
- Migration uses IF EXISTS / IF NOT EXISTS guards: yes
- Migration ordering safe (drop index → rename → add → recreate): yes
- Drizzle schema matches migration columns: yes (jsonb defaults compatible)
- RLS policy unaffected by column renames: yes
- Service-layer column-name fan-out complete: no (provisioning shape gap)
- Zod field renames complete: yes
- New test follows Vitest conventions: yes
- Sidebar nav reorder matches spec §14.1: yes
- Sidebar test assertions verify new order + conditional rendering: yes
- `tasks/todo.md` flips: 13/13 items flipped with markers — integrity confirmed
- Conformance log close-out covers all 13 items with resolution path: yes

---

Blocking: 1 / Should-fix: 3 / Consider: 4
**Verdict:** CHANGES_REQUESTED

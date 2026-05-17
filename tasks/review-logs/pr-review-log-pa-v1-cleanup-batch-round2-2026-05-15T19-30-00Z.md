# PR Review Log — pa-v1-cleanup-batch (Round 2)

**Reviewer:** pr-reviewer (Claude Opus 4.7, 1M)
**Branch:** claude/pa-v1-cleanup-batch
**Round:** 2 of 2
**Timestamp:** 2026-05-15T19:30:00Z
**Files reviewed:**
- `server/services/eaProvisioningService.ts` (BLOCKING fix + helper extraction)
- `server/services/__tests__/eaProvisioningService.test.ts` (new — shape-pin tests)
- Supporting: `server/db/schema/voiceProfiles.ts`, `migrations/0328_voice_profiles.sql`, `server/services/voiceProfile/samplers/gmailSentSampler.ts`, `tasks/builds/personal-assistant-v1/brief.md` (spec source)

---

## Verdict: APPROVED

The Round 1 BLOCKING issue (`refreshPolicy: 'manual'` + missing `sourceConfig`/`refreshConfig`) is fully resolved at `server/services/eaProvisioningService.ts:25-37`.

---

## Blocking — must be fixed before merge

No blocking issues found.

- `refreshPolicy: 'periodic' as const` matches spec §13.4 step 6.
- `sourceConfig: { gmail_sent_sampler: { lastN: 50, sinceDays: 90 } }` matches spec.
- `refreshConfig: { days: 30 }` matches spec.
- `state: 'pending'`, `sources: ['gmail_sent_sampler']`, `organisationId`, `ownerUserId` all per spec.
- Scope CHECK constraint at `migrations/0328_voice_profiles.sql:20-22` satisfied.

---

## Should-fix — non-blocking but expected in-PR

No should-fix items found.

Test coverage is complete and well-structured. The dedicated test at line 53-57 (`expect(values.refreshPolicy).toBe('periodic'); expect(values.refreshPolicy).not.toBe('manual')`) directly guards against regression to the Round 1 bug. The full-shape `toMatchObject` assertion pins the entire spec §13.4 step 6 contract. Helper `buildVoiceProfileInsertValues` (line 25-37) is a deliberate testability seam, used at the single internal call site.

---

## Consider — taste / future-proofing / nice-to-have

[💭] `server/services/eaProvisioningService.ts:34-35` — `createdAt`/`updatedAt: new Date()` is set inside the pure helper. Optional: omit and let the schema `defaultNow()` fire. Not required; matches surrounding code style.

---

## Out-of-scope items confirmed deferred (not re-flagged)

- PA-CLEANUP-DEF-1 through PA-CLEANUP-DEF-6 (state-flip UPDATE org predicates, bundler app-layer predicate, nightly refresh audit row, `sampleSize: 0` semantic, column-rename-grep KNOWLEDGE entry, stale doc comments) — all routed to `tasks/todo.md`.
- 11 already-conformant REQs (REQ-C1, C3, CAL2, CAL3-naming, T8, EA1, EA3, M9, EA4, EA5, adversarial atomicity) — verified by spec-conformance Round 1.

---

Blocking: 0 / Should-fix: 0 / Consider: 1
**Verdict:** APPROVED

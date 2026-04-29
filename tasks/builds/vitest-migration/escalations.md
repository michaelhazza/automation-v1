# Phase 2/3 escalations (migration-fatigue friction point)

Per spec § 4 Phase 2 deliverable 7's "migration-fatigue rule": any batch
that introduces a WHITELISTED DELTA in test-count parity OR an unresolved
dual-run mismatch MUST stop and surface to the user before the next batch.

**Hard cap: 5 entries combined across Phases 2 and 3.** If this file
exceeds 5 entries, the executing session pauses and surfaces the running
list to the user with the systemic question: "is the conversion plan
sound, or is something repeatedly going wrong?"

Format per entry:
- Date, batch ID
- File(s) affected
- What was whitelisted or what mismatched
- Why
- User acknowledgement (timestamp + decision)

(empty)

- 2026-04-30, phase2-batch-00
  File: server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts
  What: bash:pass → vitest:skip (dual-run mismatch)
  Why: Integration test uses test.skipIf(SKIP) where SKIP = NODE_ENV !== 'integration'.
       The bash runner ran it with NODE_ENV=test and reported PASS (node:test exits 0 for
       skipped tests). Vitest correctly reports it as "skipped". This is the expected
       behavior after converting { skip: SKIP } to test.skipIf(SKIP). Not a bug.
  Decision: WHITELISTED. All integration tests with skip gates will show this pattern.

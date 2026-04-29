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

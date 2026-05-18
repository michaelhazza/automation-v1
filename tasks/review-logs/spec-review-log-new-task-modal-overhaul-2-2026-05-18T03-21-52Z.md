# Iteration 2 — Classification + Adjudication Log

**Spec:** `docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md`
**Codex output:** `tasks/review-logs/_codex_new-task-modal-overhaul_iter2_2026-05-18T03-21-52Z.txt` (22 findings)
**Spec commit at start:** `3cc591a6`

## Classification summary

- 21 mechanical (auto-applied): #1 ABCd Build note → "5 migrations"; #2 §6.3 ordering / §12 alignment; #3 conditional Migration F for permission strings; #4 §11 Migrations A–E; #5 idempotency wording (migration-runner tracking, not SQL-idempotent); #6 Rollback wording aligned with Migration D no-op; #7 `brief_chat` removed from Deferred Items, sweep declared exhaustive inline; #8 §10 RLS policy preservation clarified; #9 §9.2 FK claim corrected (polymorphic — no FK on conversations.scope_id) — transactional write boundary is the consistency mechanism; #10 Title-required-by-API clarified per endpoint; #11 in-flight cancel housekeeping softened; #12 orchestrator behavior unified (always-enqueue + handler-eligibility-check); #13 due-date conversion helper named (architect-confirms); #14 agent-listing hook added to §8 as a category; #15 §8.2 `priority` added to route change line; #16 source enum closure rule added (unknown values → 400); #17 §13 intro split into automated vs manual gates; #18 grep commands rewritten with proper `:(exclude)` pathspecs; #19 pure helper modules (`*Pure.ts`) added to §8.3 for testable logic per §15; #20 Chunk 2 / Chunk 5 ownership of brief_chat clarified; #22 idempotencyKey "per file row, not per attempt".
- 1 mechanical-rejected (false positive): #21 mojibake — verified clean UTF-8 again; Codex's terminal locale issue.
- 0 directional findings
- 0 ambiguous findings
- 0 reclassifications

## Spec edits applied

- ABCd Lifecycle Estimate: Build sizing note now says "5 schema/data migrations (A–E)"
- §6.1: Conditional Migration F documented for DB-stored permission strings
- §6.3: ordering language fixed; rollback wording aligned with Migration D's no-op
- §7.1: Title-required split per endpoint (modal UX, task-intake API, subaccount-tasks API)
- §7.3: orchestrator behavior unified — job always enqueued, handler's three-condition eligibility check is the routing gate
- §7.4: in-flight cancel housekeeping softened; cancel/remove table now accurately reflects existing transactional commit
- §7.7: due-date conversion helper context added
- §8.1: Migration E row added; B constraint rename noted; D no-op down noted
- §8.2: `priority` added to taskIntake route changes
- §8.3: pure helper modules added; agent-listing hook category added
- §8.5: tests now point at the `*Pure.ts` modules
- §9.1: source enum closure rule (unknown → 400) added
- §9.2: FK claim corrected — application-level linkage; transactional write is the mechanism
- §10: RLS policy preservation clarified (policies preserved, policy names cosmetic)
- §11: Migrations A–E declared; idempotency wording fixed to "applied once by migration-runner tracking"
- §12: Chunk 2 owns type declaration / Chunk 5 owns value sweep for `brief_chat`
- §13: intro split into automated vs manual gates; grep commands now use proper git pathspecs
- §14: `brief_chat` deferred entry removed; `conversations.scope_type` enum value `'brief'` removal deferred
- §16.2: idempotencyKey "per file row, not per attempt"
- §16.3: idempotency wording aligned with migration-runner tracking

## Counters

| Bucket | Count |
|---|---|
| Mechanical findings accepted | 21 |
| Mechanical findings rejected | 1 |
| Directional findings | 0 |
| Reclassified → directional | 0 |
| AUTO-REJECT (framing) | 0 |
| AUTO-REJECT (convention) | 0 |
| AUTO-DECIDED (best-judgment) | 0 |

## Stopping-heuristic inputs

- mechanical_accepted = 21
- mechanical_rejected = 1
- directional_or_ambiguous = 0
- No reclassifications

**This iteration is mechanical-only.** Iteration 1 was NOT mechanical-only (3 directional). Continue to iteration 3 to check the two-consecutive-mechanical-only condition.

# Spec Review Iteration 3 Log — routines-response-dev-spec

**Spec:** `docs/routines-response-dev-spec.md`
**Spec commit at start of iteration:** `16925715879d765a127bdafda43c738031e2bafd`
**Iteration:** 3 of 5
**Timestamp:** 2026-04-16T10:35:00Z

---

## Pre-iteration: HITL decisions from iteration 2 applied

- Finding 2.1 (apply): §4.2 — skill_simulate note added
- Finding 2.2 (apply): §4.3 — toggle removed, always-on indicator
- Finding 2.3 (apply-with-modification): §3.5 — "(stretch)" removed

---

## Codex run details

- Model: gpt-5.4
- Mode: codex exec --sandbox=read-only --ephemeral
- Output: 12 distinct findings

---

## Classification log (Part 1 — C1 through C6)

FINDING #C1 | §1 | mechanical | Contradiction: "config assistant" vs "Playbook Studio chat"
  Disposition: auto-apply
  [ACCEPT] Fix: Replace "config assistant" with "Playbook Studio chat" in §1 north-star text.

FINDING #C2 | §3.3 vs §3.7 | mechanical | Contradiction: out-of-range window returns 400 (§3.3) vs empty array (§3.7 test)
  Disposition: auto-apply
  [ACCEPT] Fix: §3.7 second integration test corrected to assert 400; separate bullet for valid-window-no-occurrences (200 + empty array).

FINDING #C3 | §3.3 | mechanical | Contradiction: optional vs nullable on estimatedTokens/estimatedCost
  Disposition: auto-apply
  [ACCEPT] Fix: Change to `estimatedTokens: number | null` and `estimatedCost: number | null`.

FINDING #C4 | §4.2 vs §4.7 | directional | Scope signal: SystemAgentEditPage in scope but system agents disallowed
  Disposition: HITL-checkpoint
  Reasoning: Deciding whether system-agent inline testing is supported anywhere is a scope/interface call.

FINDING #C5 | §4.6 | mechanical | Load-bearing claim without safe contract: epochSeconds idempotency key collides within same second
  Disposition: auto-apply
  [ACCEPT] Fix: Change key format to `test:{linkId}:{userId}:{epochMilliseconds}`.

FINDING #C6 | §4.7 vs §3.6 | mechanical | Invariant not enforced: test runs excluded from aggregates (§4.7) but cost backfill reads all agent_runs (§3.6)
  Disposition: auto-apply
  [ACCEPT] Fix: §3.6 step 6 updated to add WHERE is_test_run = false to backfill query.

## Classification log (Part 2 — C7 through R1)

FINDING #C7 | §4.4 | ambiguous | "RLS identical to org-scoped tables" under-specified for polymorphic table with optional subaccount_id
  Disposition: HITL-checkpoint
  Reasoning: Could be mechanical clarification or scope change depending on intended access model.

FINDING #C8 | §5.4 | mechanical | Contradiction: normalization strips n8n-nodes-langchain. prefix → lmAnthropicClaude, but table lists anthropicClaude
  Disposition: auto-apply
  [ACCEPT] Fix: Short key in mapping table corrected to lmAnthropicClaude.

FINDING #C9 | §5.7 | mechanical | Load-bearing claim: "tool endpoint" is not a REST route — skill invocation goes through skill_simulate path
  Disposition: auto-apply
  [ACCEPT] Fix: Integration test clarified to reference skill_simulate path with slug import_n8n_workflow.

FINDING #C10 | §5.3/§5.5 | mechanical | Load-bearing claim without contract: step types not anchored to existing playbook schema
  Disposition: auto-apply
  [ACCEPT] Fix: §5.3 note added — step types match existing playbook_validate primitives.

FINDING #C11 | §3/§4/header | mechanical | Self-stated invariant violated: header claims all files enumerated, but Features 1 and 2 lack inventory tables
  Disposition: auto-apply
  [ACCEPT] Fix: File inventory tables added to §3 and §4.

FINDING #C12 | §6.2/§7.2/closing | mechanical | Stale language: "this commit," "same commit as this spec," "while it is being implemented"
  Disposition: auto-apply
  [ACCEPT] Fix: Relative temporal phrases replaced with §8 commit-sequence labels.

FINDING #R1 | §3.3 | mechanical | Load-bearing claim: totals.estimatedTokens/estimatedCost typed number (non-nullable) but per-occurrence can be null — aggregation rule unstated
  Disposition: auto-apply
  [ACCEPT] Fix: Comment added — null values treated as zero in totals aggregation.

---

## Iteration 3 counts

- mechanical_accepted: 11 (C1, C2, C3, C5, C6, C8, C9, C10, C11, C12, R1)
- mechanical_rejected: 0
- directional_or_ambiguous: 2 (C4 directional, C7 ambiguous)
- reclassified: 0
- HITL checkpoint path: tasks/spec-review-checkpoint-routines-response-dev-spec-3-20260416T103500Z.md
- HITL status: pending

## Iteration 3 Summary

- Mechanical findings accepted:  11
- Mechanical findings rejected:  0
- Directional findings:          1 (C4)
- Ambiguous findings:            1 (C7)
- Reclassified → directional:    0
- HITL checkpoint path:          tasks/spec-review-checkpoint-routines-response-dev-spec-3-20260416T103500Z.md
- HITL status:                   pending
- Spec commit after iteration:   working tree modified from 16925715879d765a127bdafda43c738031e2bafd

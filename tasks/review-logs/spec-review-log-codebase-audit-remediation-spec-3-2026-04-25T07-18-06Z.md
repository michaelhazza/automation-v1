# Spec Review Iteration 3 — codebase-audit-remediation-spec

**Spec commit at start:** e32a3c73 (after iter2)
**Iteration:** 3 of MAX_ITERATIONS=5
**Codex output:** tasks/review-logs/_spec-review-codebase-audit-remediation-iter3-codex-output.txt

## Codex findings (6 — all tertiary cascades from iter2)

### iter3-FINDING #1 — §0 / §3.5 / §4.1 stale 0202/0203 carry-over
- Mechanical. Iter2 fixed the math but missed three downstream references: §0 still said "+8 historical-noise entries", §3.5 verify-rls-coverage row listed 0202/0203 as part of the violation set, §4.1 verification-comment said "0202–0208/0212 noise still present".
- Fixed: §0 reconciliation rewritten to "47 + 8 routes + 2 migration gaps + 6 historical-noise entries + 2 §4.5 deliverables − 2 dedupe = 63"; §3.5 row now decomposes "19 raw matches → 12 distinct issues, of which 4+2+6 split"; §4.1 SQL comment now says "0204–0208 + 0212" with explicit 0202/0203 carve-out.

### iter3-FINDING #2 — Stale "next available number at PR-open time" wording
- Mechanical. Iter2's §2.5 added the "merge-time renumber" rule, but §8.1 step 1, §8.4 P3-M6, §12.1 still said "at PR-open time". Conflict.
- Fixed: All three references updated to "Number assigned at merge time per §2.5".

### iter3-FINDING #3 — `systemAutomationsService` plural inconsistency
- Mechanical. Iter1 set the singular-noun convention but I missed converting `systemAutomationsService` (plural). Confirmed against repo: similar services are `systemAgentService`, `systemPnlService`, `systemSkillService` — all singular.
- Fixed: replaced systemAutomationsService → systemAutomationService throughout the spec.

### iter3-FINDING #4 — §5 Phase 2 goal overclaim
- Mechanical. The Phase 2 goal said "every architectural-contract gate that currently fails or warns returns clean exit", but §5.7 / §5.8 / §13.2 explicitly allow warning-level gates to remain as warnings. Internal contradiction.
- Fixed: Goal softened to "every blocking gate returns clean exit; warning gates do not regress" — matches the actual ship-gate criteria.

### iter3-FINDING #5 — §3.5 verify-skill-read-paths stale diagnosis
- Mechanical. §3.5 row carried the inferred "5 actions missing readPath" diagnosis even though §5.5 (post-iter1) corrected the diagnosis to "ambiguous, enumerate first".
- Fixed: §3.5 row reports raw mismatch only; defers diagnosis to §5.5.

### iter3-FINDING #6 — §9.2 cleanup job "read-only" wording inconsistent
- Mechanical. §9.2 (post-iter2) said the cleanup job is "read-only against the table; deletes rows older than 1 hour" — internally inconsistent (delete is not read-only).
- Fixed: rewrote to "performs DELETE FROM rate_limit_buckets WHERE window_start < now() - interval '1 hour' and does not read or update other rows".

## Iteration 3 classification summary

- Codex findings: 6
- Rubric findings: 0
- Total: 6
- All mechanical. All auto-applied.
- mechanical_accepted: 6
- mechanical_rejected: 0
- directional: 0
- ambiguous: 0
- reclassified -> directional: 0

## Iteration 3 Summary

- Mechanical findings accepted:    6
- Mechanical findings rejected:    0
- Directional findings:            0
- Ambiguous findings:              0
- Reclassified -> directional:     0
- Autonomous decisions:            0


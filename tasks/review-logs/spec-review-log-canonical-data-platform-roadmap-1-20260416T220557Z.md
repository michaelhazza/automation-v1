# Spec Review Log — Iteration 1

**Spec:** `docs/canonical-data-platform-roadmap.md`
**Spec commit:** `0f2d7d8b1f0109a5d5ae3d82f4aebe6cda34e38a`
**Iteration:** 1

## Codex status

Codex CLI v0.118.0 is designed for code-diff review (`--uncommitted`, `--commit`, `--base`). It has no `--file` or `--stdin` flag for reviewing arbitrary document content; the PROMPT argument is "custom review instructions", not the document. Piping the spec as the prompt hangs indefinitely because Codex has no diff to process. Iteration 1 proceeds on rubric-only findings.

---

## Findings

### FINDING #1
  Source: Rubric-contradiction (duplicate section)
  Section: Lines 1625–1628 — second "Deferred items with rationale" heading
  Description: Full "Deferred items with rationale" content is at lines 1579–1623; a residual chunk-placeholder heading + one-liner at lines 1625–1628 is a duplicate.
  Codex's suggested fix: n/a (rubric finding)
  Classification: mechanical
  Reasoning: Plainly a leftover chunk placeholder from the doc's chunked-write workflow. Content is present above; the duplicate adds only a stale placeholder. No scope change; "obviously just cleaning up an oversight."
  Disposition: auto-apply

### FINDING #2
  Source: Rubric-contradiction (duplicate section)
  Section: Lines 1714–1716 — second "Glossary" heading with chunk placeholder
  Description: Full Glossary content is at lines 1669–1692; a second Glossary heading + "*Chunk placeholder — written in chunk 8.*" at lines 1714–1716 is a duplicate.
  Classification: mechanical
  Reasoning: Same chunked-write artifact pattern as Finding #1.
  Disposition: auto-apply

### FINDING #3
  Source: Rubric-contradiction (duplicate section)
  Section: Lines 1720–1722 — second "Appendix: Phase entry/exit criteria" with chunk placeholder
  Description: Full Appendix content is at lines 1695–1710; a second heading + "*Chunk placeholder — written in chunk 8.*" at lines 1720–1722 is a duplicate.
  Classification: mechanical
  Reasoning: Same chunked-write artifact pattern.
  Disposition: auto-apply

### FINDING #4
  Source: Rubric-sequencing (file inventory drift)
  Section: Appendix table, row for P6 (line 1707)
  Description: P6's entry-criteria text (line 1464–1466) lists P2B as an explicit dependency ("P2B landed — dictionary provides the planner's table/column context"), but the appendix table lists only "P3, P4, P5" for P6's entry.
  Classification: mechanical
  Reasoning: The P6 section body is authoritative; the appendix is a convenience summary that drifted. Adding P2B to the appendix row exactly matches the already-decided entry criteria stated in the body. No scope change.
  Disposition: auto-apply

### FINDING #5
  Source: Rubric-unnamed-delivery (load-bearing claim without phase assignment)
  Section: D8 — Bundled-tier pricing (line 261)
  Description: D8 names an `integration_ingestion_stats` table ("Every ingestion run records approximate API-call count and row-count ingested, written to an integration_ingestion_stats table") but no phase in the spec introduces or creates this table.
  Classification: ambiguous
  Reasoning: Fixing this requires either assigning the table's creation to a specific phase (P1 is the natural home, since that's when ingestion scheduling first runs) or explicitly scoping it out. Either option changes phase deliverables — a scope/sequencing signal. However, D8 says it is "documented for the record, not for a phase deliverable," which conflicts with the later statement that the table is written to. This internal tension makes it ambiguous, not cleanly mechanical.
  Disposition: HITL-checkpoint

### FINDING #6
  Source: Rubric-load-bearing-claim (missing column in required columns / RLS policy references undeclared field)
  Section: Canonical data model conventions (lines 408–420) vs. P3B RLS policy (line 934)
  Description: The P3B representative RLS policy for canonical_contacts uses `shared_team_ids && current_setting('app.current_team_ids', true)::uuid[]`, implying a `shared_team_ids uuid[]` column on canonical rows. This column does not appear in the required columns table, no index is specified for it, and no phase explicitly adds it to canonical tables.
  Classification: ambiguous
  Reasoning: The fix requires either (a) adding `shared_team_ids` to the canonical required columns and index list, or (b) changing the RLS policy to express team-visibility through a join on `team_members` instead. Option (a) extends the required column convention; option (b) changes the RLS policy design. Both are more than consistency fixes. The open-questions section calls out the `shared_team_ids` shape question for connections but not for canonical rows, making the canonical-row case an unresolved architectural question.
  Disposition: HITL-checkpoint

### FINDING #7
  Source: Rubric-contradiction (naming convention inconsistency)
  Section: Canonical data model conventions required columns (lines 408–420) vs. P4 canonical_emails schema (lines 1111–1145) and P5 canonical_calendar_events schema (lines 1297–1338)
  Description: Required columns include `external_id text nullable` with a required unique partial index on `(source_connection_id, external_id)`. P4 uses `provider_message_id` and P5 uses `provider_event_id` — neither schema has an `external_id` column or the prescribed index. The unique constraints use the provider-specific names instead.
  Classification: ambiguous
  Reasoning: Could be intentional specialization (provider-specific names are clearer than a generic `external_id`), in which case the conventions section should be updated to say "or a provider-specific equivalent". Or it could be an oversight where the conventions must be satisfied literally, requiring an `external_id` alias. Choosing between these two interpretations requires a naming decision that touches the conventions document's binding force over implementation specs — directional in character.
  Disposition: HITL-checkpoint

### FINDING #8
  Source: Rubric-invariant (visibility rules table vs. RLS policy contradiction)
  Section: Principal model visibility rules table (lines 348–356) vs. P3B example RLS policy (lines 940–943)
  Description: The visibility rules table says delegated principals can see rows with `visibility_scope = shared-subaccount` and `visibility_scope = shared-org`. The representative P3B RLS policy only grants delegated principals access to `visibility_scope = 'private'` rows where they are the owner. If RLS enforces this policy, delegated principals cannot see shared-scope rows even though the visibility rules say they should.
  Classification: ambiguous
  Reasoning: The comment "validated further at service layer" suggests the policy may be intentionally narrow (service layer widens it). But RLS is the last line of defence — if the policy blocks a query, the service layer never sees the rows. The tension between the policy and the rules table could be intentional design (delegated principals are intentionally restricted beyond what the rules table shows) or an oversight. Resolving requires deciding whether the policy or the rules table is authoritative — a directional call.
  Disposition: HITL-checkpoint

### FINDING #9
  Source: Rubric-contradiction (missing exception in required indexes for multi-scoped tables)
  Section: Canonical data model conventions, required indexes (lines 427–429)
  Description: Required indexes include `(organisation_id, subaccount_id)` for "Subaccount-scoped queries". However, multi-subaccount-scoped tables (canonical_emails, canonical_calendar_events) have `subaccount_id` always null — the index would always be over a null column and is meaningless for those tables. Neither the conventions section nor the P4/P5 schemas explain this exception; P4/P5 silently omit the index.
  Classification: mechanical
  Reasoning: The conventions already decided (lines 436–442) that multi-scoped tables keep `subaccount_id` as always-null and use the linkage table for scope. The missing index is a consistent implication of that decision. Adding a note to the required indexes section ("Multi-subaccount-scoped tables skip this index because `subaccount_id` is always null; scope queries go through the linkage table") is a consistency fix, not a scope change.
  Disposition: auto-apply

---

## Applied changes

[ACCEPT] Required indexes section — Added exception note for multi-scoped tables skipping `(organisation_id, subaccount_id)` index
  Fix applied: Added paragraph below index table noting multi-scoped tables omit this index because `subaccount_id` is always null on those rows.

[ACCEPT] Appendix P6 row — P2B missing from entry dependencies
  Fix applied: Changed `| P6 | P3, P4, P5 |` to `| P6 | P3, P2B, P4, P5 |`.

[REJECT] Findings 1, 2, 3 — Chunk placeholder duplicate sections
  Reason: Already resolved by user's commit `00a67e9` before this log was written. No action needed.

## Iteration summary

- Mechanical findings accepted:  2
- Mechanical findings rejected:  0 (3 pre-resolved by user commit)
- Ambiguous findings:            4 (Findings 1.1–1.4)
- Directional findings:          0
- HITL checkpoint path:          tasks/spec-review-checkpoint-canonical-data-platform-roadmap-1-20260416T220557Z.md
- HITL status:                   pending
- Spec commit after iteration:   (unchanged — mechanical fixes not committed yet)

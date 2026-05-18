# Spec Review — Iteration 2 — closed-loop-skill-improvement

**Spec:** `docs/superpowers/specs/2026-05-18-closed-loop-skill-improvement-spec.md`
**Iteration:** 2 of 5 lifetime.
**Started:** 2026-05-18T03:33:47Z.

## Codex output

`tasks/review-logs/_codex_closed-loop-skill-improvement_iter2_2026-05-18T03-33-47Z.txt`. 11 distinct new findings, verdict "Needs revision". These are NEW issues — none repeat iteration 1's findings; several are downstream consequences of iteration 1's `review_required`-via-freeze decision and wrapper/pure-step split.

## Findings and dispositions

### #1 — §17 Step 1 contradicts §7.5 / §14 on RLS for `amendment_proposer_metrics`

- **Classification:** MECHANICAL — contradiction; §7.5/§14 canonical.
- **Disposition:** ACCEPT. Rewrote §17 Step 1 migration list to say "seven org-scoped tables with RLS" and explicitly except `amendment_proposer_metrics`.

### #2 — `rca_record_id` "FK to JSONB" is unimplementable

- **Classification:** MECHANICAL — load-bearing claim with impossible mechanism.
- **Disposition:** ACCEPT. Changed §7.1 to describe `rca_record_id` as a plain provenance UUID (NOT an FK), copied from `rca_json.record_id`. Updated §15.2 RCA contract to include `record_id` field.

### #3 — §7.2 documents null-amendment regression rows but §9.1 never creates them

- **Classification:** MECHANICAL — contradiction; §7.2 documents semantics that the proposer doesn't implement.
- **Disposition:** ACCEPT. Updated §9.1 step 10 to write a `skill_regression_cases` row with `amendment_id = NULL`, `tag = 'unresolved'` on peer-review drops before exiting.

### #4 — §9.1 freeze check excludes `review_required` freeze_type

- **Classification:** MECHANICAL — downstream consequence of iteration 1's `review_required`-via-freeze decision.
- **Disposition:** ACCEPT. Updated §9.1 step 1 freeze predicate to `freeze_type IN ('proposal_generation', 'review_required')`.

### #5 — §8.1 pure/wrapper boundary still unclear

- **Classification:** MECHANICAL — clarification of the §8.1 step list to disambiguate which steps are inside `composeAmendmentsPure` and which are in the `resolveSkillsForAgent` wrapper.
- **Disposition:** ACCEPT. Rewrote §8.1 with explicit "wrapper I/O steps" prefix; added `server/services/skillServicePure.ts` (new file) for the pure function. DB reads (amendments query, freeze query) and DB writes (freeze insert on truncation, snapshot insert) are explicitly wrapper-side.

### #6 — "system base text" wording wrong for org-tier inherited skills

- **Classification:** MECHANICAL — wording bug.
- **Disposition:** ACCEPT. Replaced "system base text" with "resolved-base body" in §6.7 and §8.1.

### #7 — §9.1 step 4 has no fallback for missing snapshot

- **Classification:** MECHANICAL — gap with materials already in the spec to fill (re-resolve is deterministic).
- **Disposition:** ACCEPT. Added fallback to §9.1 step 4: if no snapshot, re-resolve by calling `resolveSkillsForAgent` (deterministic). No new terminal event needed since the fallback path is non-failing under normal conditions.

### #8 — §18.1 omits `acceptAfterEdit` idempotency posture

- **Classification:** MECHANICAL — state-machine completeness.
- **Disposition:** ACCEPT. Added a row to §18.1 describing the compound transaction (UPDATE original to retired + INSERT new accepted, both inside `withOrgTx`). Added concurrency guards for double-acceptAfterEdit, accept+acceptAfterEdit, and double-thaw races to §18.3.

### #9 — §12 duplicate-accept HTTP mapping references nonexistent `23505`

- **Classification:** MECHANICAL — contradiction; §18.1 is canonical (state-based).
- **Disposition:** ACCEPT. Replaced §12 HTTP mapping with state-based predicate description; added freeze + post-mortem variants.

### #10 — `org` and `org_global` scopes overlap after iteration 1's rename

- **Classification:** MECHANICAL — terminology redundancy.
- **Disposition:** ACCEPT. Dropped `org_global` from enum. Org-wide freezes use `scope = 'org'` with `scope_id = NULL` (`org_id` column already pins the tenant). Updated §7.8 description.

### #11 — §9.2 step 5 replay metadata fields have no storage target

- **Classification:** MECHANICAL — load-bearing claim without target. Conservative minimum-additive fix: add 4 columns to `skill_amendment_effectiveness` (most-recent replay only). Per-verdict history deferred.
- **Disposition:** ACCEPT. Added `last_replay_judge_version`, `last_replay_resolver_version`, `last_replay_model_version`, `last_replay_at` columns to §7.4; updated §9.2 step 5 to write them.

## Iteration 2 Summary

- Mechanical findings accepted: 11
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration: untracked working tree

Stopping heuristic check: this iteration was MECHANICAL-ONLY (0 directional, 0 ambiguous). Iteration 1 had 2 directional findings. Per heuristic #2 ("two consecutive mechanical-only rounds"), we need ANOTHER mechanical-only round to exit. Iteration 3 will be run.

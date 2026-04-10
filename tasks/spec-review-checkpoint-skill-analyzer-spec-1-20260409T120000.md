# Spec Review HITL Checkpoint — Iteration 1

**Spec:** `docs/skill-analyzer-spec.md`
**Spec commit:** `b57fccd39eb0889e913fc527c4f32f6adb0aaac9`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 1 of 5
**Timestamp:** 2026-04-09T12:00:00Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 2 until every finding below is resolved by the human. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

---

## Finding 1.1 — System skill IMPROVEMENT execution path undefined

**Classification:** directional
**Signal matched:** Architecture signals: "Change the interface of X" / Scope signals: "Add this item to the roadmap"
**Source:** Codex (#1)
**Spec section:** API Design — Execution logic / Database Schema — skill_analyzer_results

### Codex's finding (verbatim)

> The spec says the feature works against the "existing skill library" including both system and org skills, but execution only defines `skillService.createSkill()` / `updateSkill()` operations on org skills. There is no contract for what happens when an `IMPROVEMENT` matches a system skill (`matched_system_skill_slug` exists specifically for that case). `skill_analyzer_results` can point at either `matched_skill_id` or `matched_system_skill_slug`, but `POST /execute` only describes updating a DB skill row. This is a blocking ambiguity.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would add an execution rule: "IMPROVEMENT against a system skill creates a new org-level skill with the improved content (does not modify the system skill). The org skill effectively shadows the system skill for that org." This preserves the system skill immutability principle from architecture.md while still allowing the improvement to be applied.

### Reasoning

System skills are file-based platform IP with `isSystemManaged: true` semantics. Modifying them via a user-facing import tool would violate the three-tier agent model. But the spec clearly envisions comparing against system skills (the schema has `matched_system_skill_slug`). The decision about what happens when an improvement matches a system skill is a product-direction question: shadow with org skill, skip, or flag for platform admin. This is directional because it affects the execution contract and potentially the data model.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`. If `apply-with-modification`, add the modification inline. If `reject`, add a one-sentence reason. If `stop-loop`, the review loop exits and the spec stays in its current state for the human to rethink.

```
Decision: apply-with-modification
Modification (if apply-with-modification): IMPROVEMENT against a system skill updates the system skill `.md` file on disk at `server/skills/{slug}.md`. After writing, call `systemSkillService.invalidateCache()` (or equivalent) to force the in-memory cache to reload. System skills are inherited to orgs and subaccounts automatically, so the update propagates without additional steps. Note: this modifies git-tracked source files at runtime — in pre-production this is expected (changes are committed manually). Add a pure-function test for the file-path resolution logic in `skillAnalyzerServicePure.test.ts`.
Reject reason (if reject): <edit here>
```

---

## Finding 1.2 — Single best match per candidate vs multi-match for PARTIAL_OVERLAP

**Classification:** directional
**Signal matched:** Scope signals: "Add this item to the roadmap"
**Source:** Codex (#6)
**Spec section:** Processing Pipeline Stage 4 / Database Schema — skill_analyzer_results

### Codex's finding (verbatim)

> The results table stores exactly one comparison result per candidate, but the product language repeatedly says "compare incoming skills against the existing skill library" and supports `PARTIAL_OVERLAP`. Returning only the single best match discards second-best overlaps that could be implementation-relevant, especially for merge decisions. This is a schema/product mismatch, not just an optimization detail.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would clarify that single-best-match is the intentional v1 design choice and add a note: "v1 returns only the best match per candidate. If a candidate partially overlaps multiple library skills, only the highest-similarity match is shown. Multi-match comparison is deferred to a future iteration." This makes the limitation explicit without changing the design.

### Reasoning

Returning multiple matches per candidate would change the data model (results become a many-to-many relationship), the UI (results step needs to show multiple matches per candidate), the pipeline (Stage 4 returns top-N instead of top-1), and the execution logic (which match does the user act on?). This is a scope decision, not a mechanical fix. The current single-match design is simpler and may be sufficient for v1.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Expand to multi-match for PARTIAL_OVERLAP candidates. Stage 4 returns top-N matches (up to 3) per candidate where similarity >= 0.60. The `skill_analyzer_results` table stores one row per candidate-match pair, so a candidate with 3 partial overlaps produces 3 result rows. The UI groups these under the candidate name. The user can approve/reject each match independently. For DUPLICATE and IMPROVEMENT classifications, keep single best match (top-1) — multi-match only applies to PARTIAL_OVERLAP.
Reject reason (if reject): <edit here>
```

---

## Finding 1.3 — No tests specified for IMPROVEMENT against system skills

**Classification:** directional
**Signal matched:** Testing posture signals: test coverage for undefined behavior path
**Source:** Codex (#30)
**Spec section:** Testing Strategy

### Codex's finding (verbatim)

> There are no specified tests for the most dangerous branch: `IMPROVEMENT` against system skills, or any test covering execute-time behavior when `matched_system_skill_slug` is populated. Given the earlier ambiguity, this is a blocking test gap.

### Tentative recommendation (non-authoritative)

This finding is dependent on Finding 1.1 — once the system skill IMPROVEMENT execution path is defined, a pure-function unit test should be added to `skillAnalyzerServicePure.test.ts` covering the decision logic. No integration test needed per project testing conventions.

### Reasoning

Cannot define tests for behavior that hasn't been specified yet. This is blocked by Finding 1.1. Additionally, suggesting integration tests or expanded test coverage would conflict with the project's pure-function-only testing posture.

### Decision

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## Finding 1.4 — Intra-batch deduplication not defined

**Classification:** directional
**Signal matched:** Scope signals: "Add this item to the roadmap"
**Source:** Codex (#31)
**Spec section:** Overview / Processing Pipeline

### Codex's finding (verbatim)

> "Import, compare, and deduplicate skills from external sources" implies deduplicating within the incoming batch too, not only against the existing library. The spec never defines whether two imported candidates that duplicate each other should collapse into one, both be shown, or be independently processed. Because parsing supports bulk paste/upload/zip, this missing contract will affect counts, hashing, results, and execution.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would add a note to Stage 2: "Intra-batch deduplication: if two candidates produce the same content hash, keep only the first occurrence and increment `exact_duplicate_count`. The duplicate candidate is not shown in results." This is the simplest approach that handles the obvious case.

### Reasoning

This is a scope decision. Options range from "ignore intra-batch duplicates entirely" (simplest) to "detect and flag them as a special case in the UI" (most informative) to "collapse them silently" (least surprising). The choice affects the candidate count, result count, UI expectations, and the execution step. The spec currently says nothing, which means implementers will make their own choice — a recipe for inconsistency.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Detect intra-batch duplicates during Stage 2 (hashing). Candidates with the same content hash are collapsed into a single candidate with a note "appeared N times in import batch" stored in `source_metadata`. Only the unique set proceeds through embedding/classification. The collapsed duplicates count toward `exact_duplicate_count`. This reuses the existing hashing infrastructure with zero additional complexity.
Reject reason (if reject): <edit here>
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (apply, apply-with-modification, reject, or stop-loop), and continue to iteration 2.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.

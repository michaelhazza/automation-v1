# Spec Review HITL Checkpoint — Iteration 2

**Spec:** `docs/skill-analyzer-v2-spec.md`
**Spec commit:** untracked (working-tree only; HEAD = 9b75c17)
**Spec-context commit:** 7cc51443210f4dab6a7b407f7605a151980d2efc (2026-04-08)
**Iteration:** 2 of 5
**Timestamp:** 2026-04-11T10:05:57Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 3 until every finding below is resolved by the human. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

Iteration 2 ran a fresh Codex pass plus a rubric pass. Codex produced 5 distinct findings; the rubric pass added 2 more. Six of the seven were auto-applied as mechanical fixes (see `tasks/spec-review-log-skill-analyzer-v2-spec-2-2026-04-11T10-05-57Z.md` for the per-finding log). The one finding below is ambiguous — it touches a question the human explicitly chose to defer to the architect during iteration 1's self-review, so I will not auto-resolve it.

---

## Finding 2.1 — Phase 0 visibility-vs-isActive mapping is still open, which means Phase 0 is not strictly "implementation ready"

**Classification:** ambiguous
**Signal matched (if directional):** Architecture signals: "Change the interface of X" (picking the visibility contract for the new DB-backed `systemSkillService` is an API shape decision)
**Source:** Codex (important)
**Spec section:** §10 Phase 0 / §11 open items #5

### Codex's finding (verbatim)

> **Spec section:** §10 Phase 0 / §11 Open items for the implementation plan
> **Short description:** The Phase 0 DB rewrite depends on unresolved visibility semantics, so a prerequisite phase is not actually implementation-ready.
> **Severity:** important
> **Suggested fix:** Resolve the mapping in the spec now: either state that markdown `visibility` maps onto an added DB `visibility` column, or state that `isActive` replaces it and update every affected method contract accordingly.
> **Why:** Phase 0 says it will rewrite:
> > "`listSkills`, `getSkill`, `getSkillBySlug`, `listVisibleSkills`, `updateSkillVisibility`, `resolveSystemSkills`"
> but §11 still leaves this open:
> > "Phase 0 needs to either (a) map `visible` → `isActive` ... or (b) add a separate `visible` column..."
> That is not a detail; it changes the schema, the service API behavior, and whether the analyzer/library read should include hidden skills. The prerequisite phase should not leave that invariant undecided.

### Independently verified facts about the current codebase

- The current in-memory `SystemSkill` interface (`server/services/systemSkillService.ts` lines 16–32) has a **three-state `visibility` cascade** (`'none' | 'basic' | 'full'`) in addition to a boolean `isActive`. These are TWO separate flags, not one.
- `listActiveSkills()` filters on `isActive` only.
- `listVisibleSkills()` filters on `isActive === true AND visibility !== 'none'`.
- The dormant `system_skills` DB schema (`server/db/schema/systemSkills.ts`) has **only `isActive`**, no `visibility` column at all.
- `updateSkillVisibility(slug, visibility: SkillVisibility)` is a public method on the service that writes the three-state visibility back to the markdown frontmatter.
- The Phase 0 backfill from markdown to DB will therefore lose the three-state visibility unless a `visibility` column is added to `system_skills` in the same migration.

So the reality is **not** a simple "is visible == is active" mapping. The markdown source has two separate, orthogonal flags (`isActive` and `visibility`). If the Phase 0 migration goes ahead with only the current schema, every backfilled row will lose its visibility state.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would apply the following change: in Phase 0's Drizzle migration, **add a `visibility` column to `system_skills`** of type `text` with a check constraint `visibility IN ('none', 'basic', 'full')` and default `'none'`. The backfill script reads the `visibility` value from each markdown file's frontmatter and writes it into the new column. `listVisibleSkills()` becomes a DB query `WHERE isActive = true AND visibility != 'none'`. `updateSkillVisibility(slug, visibility)` becomes a DB UPDATE against that column. `isActive` stays as-is and means "skill is enabled / not retired". `visibility` stays as-is and means "which tier can see this skill".

This is NOT the resolution the spec §11 #5 bullet anticipates. §11 #5 frames the question as a binary ("map visible → isActive" or "add a separate visible column") and the first option is provably wrong because the current markdown code uses both flags separately. Only the second option is correct, and within "the second option" I still need to pick between a new boolean `visible` column and a new `text` column preserving the three-state cascade. The correct answer is the three-state text column, because the existing `stripBodyForBasic()` helper and the `'basic'` vs `'full'` distinction is load-bearing for the three-tier agent model (see architecture.md).

### Reasoning

This finding is ambiguous for two separate reasons:

1. **The iteration-1 self-review explicitly deferred this.** The caller's note in the handoff message says they "Added a visibility-vs-isActive mapping question to §11 open items" as a self-review improvement. That was a deliberate decision to defer to the architect agent rather than resolve in-spec. The spec-reviewer is not in a position to override a human deferral, even if the correct resolution is visible from the code.

2. **Resolving it picks an API / schema direction.** The tentative recommendation adds a new column to `system_skills` (schema change), adds a new frontmatter → DB mapping step to the backfill script (contract change), and commits the Phase 0 migration to a three-state visibility model rather than a two-state one. All three are directional calls that the human may prefer the architect to make.

On the other hand, leaving Phase 0 with a known-underspecified migration contract is a legitimate implementation-readiness gap — Phase 0 is the prerequisite phase for everything else, and "the architect will figure it out" is not a Phase 0 contract. Codex's severity rating ("important") is defensible.

Downstream impact of each option:

- **Apply (resolve now):** Phase 0's migration gains a new column, the backfill script gains a frontmatter-read step, the `listVisibleSkills` / `updateSkillVisibility` contracts become concrete. §11 #5 is removed. Phase 0 is fully implementation-ready. Risk: locks in a schema decision the architect might have wanted to revisit.
- **Apply-with-modification (resolve a different way):** The human picks a different resolution, e.g. "drop the three-state cascade and collapse to a binary `visible` boolean because the tri-state is historical baggage". This is a bigger scope change.
- **Reject (keep deferred):** §11 #5 stays. Phase 0 ships with a known-underspecified visibility contract that the architect resolves before writing the migration. The downside is that Phase 0 is no longer strictly implementation-ready by the spec's own standard.
- **Stop-loop:** The spec stays as-is and the human takes it from here without further review rounds.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`. If `apply-with-modification`, add the modification inline. If `reject`, add a one-sentence reason. If `stop-loop`, the review loop exits and the spec stays in its current state for the human to rethink.

```
Decision: apply
Modification (if apply-with-modification): n/a
Reject reason (if reject): n/a
```

### Applied changes (by caller, not the spec-reviewer agent)

- §10 Phase 0 migration bullet: added `visibility text` column to `system_skills` with CHECK constraint `IN ('none', 'basic', 'full')` and default `'none'`. Explained that `isActive` and `visibility` are two orthogonal flags.
- §10 Phase 0 backfill bullet: backfill reads `visibility` from each markdown file's frontmatter and writes it into the new column; defaults to `'none'` if absent.
- §10 Phase 0 service rewrite bullet: `updateSkillVisibility`, `listVisibleSkills`, `listActiveSkills`, `listSkills` queries spelled out concretely against `isActive` and `visibility` columns.
- §10 Phase 0 analyzer library read bullet: removed the "assumption revisited once §11 item #5 is resolved" caveat since the item is now resolved.
- §11 open items: removed the visibility-semantic-mapping bullet entirely (resolved). Tightened the analyzer-library-read bullet to confirm `listSkills()` returns all rows and only flag the "should the analyzer filter `isActive = false`" sub-question.

---

## How to resume the loop

After editing the `Decision:` line above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour the decision (`apply`, `apply-with-modification`, `reject`, or `stop-loop`), and continue to iteration 3.

If you want to stop the loop entirely without resolving the finding, set the decision to `stop-loop` and the loop will exit immediately after honouring any findings that have been marked `apply` or `apply-with-modification`.

## Iteration 2 stopping-heuristic note

Iteration 2 surfaced 7 findings total: 6 auto-applied mechanical, 1 HITL. Iteration 1 had 5 directional findings (all auto-applied via human HITL as `apply-with-modification`). **Neither iteration 1 nor iteration 2 was a mechanical-only round**, so the "two consecutive mechanical-only rounds" stopping heuristic has not started a streak. If the human resolves finding 2.1 as `reject` (keep deferred), iteration 3 would need to run unless another stopping condition applies (iteration cap, zero findings, zero acceptance drought, or explicit stop-loop). The human may also choose `stop-loop` to exit early.

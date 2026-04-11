# Spec Review HITL Checkpoint — Iteration 1

**Spec:** `docs/skill-analyzer-v2-spec.md`
**Spec commit:** untracked (working-tree only; HEAD = 9b75c17)
**Spec-context commit:** 7cc51443210f4dab6a7b407f7605a151980d2efc (2026-04-08)
**Iteration:** 1 of 5
**Timestamp:** 2026-04-11T09:32:16Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 2 until every finding below is resolved by the human. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

Iteration 1 produced 8 Codex findings plus 1 rubric finding. Four mechanical findings (Codex #6, #7, #8, plus the rubric "unnamed new primitives" absorbed into the testing-posture edit) were auto-applied to the spec — see the iteration log file for details. The five findings below could not be auto-applied because they are directional or ambiguous.

## Findings

- Finding 1.1 — Authoritative source for system skills is unresolved (directional, critical)
- Finding 1.2 — `matchedSkillId` semantics conflict with existing `matchedSystemSkillSlug` (ambiguous)
- Finding 1.3 — `agentProposals` uses slug as identity key, slug mutates on rename (ambiguous)
- Finding 1.4 — Agent-propose selection rules contradict each other (ambiguous)
- Finding 1.5 — Bulk-approve-partial-overlaps flow under-specified (ambiguous)

---

## Finding 1.1 — Authoritative source for system skills is unresolved, and the spec assumes DB-backed writes that the current codebase does not support

**Classification:** directional
**Signal matched:** Architecture signals: "Introduce a new abstraction / service / pattern" AND Scope signals: "Split this item into two"
**Source:** Codex (critical)
**Spec section:** §1 Summary, §4 Goals, §5.3 matchedSkillId semantics, §6 Pipeline, §8 Execute step, §11 Open items (item 4)

### Codex's finding (verbatim)

> **Authoritative source unresolved** — The spec treats `system_skills` as the write target in sections 1, 4, 5, 6, and 8, but section 11 reopens that as an undecided question. In the current codebase, `server/services/systemSkillService.ts` explicitly says `server/skills/*.md` is the source of truth and exposes no DB CRUD for system skills, so implementation cannot safely proceed as written.
>
> **Suggested fix:** Remove this from "open items" and make a hard decision in the spec. If DB-backed, add a prerequisite phase that converts `systemSkillService` to read/write `system_skills` and defines migration/backfill from markdown. If markdown-backed, rewrite every `system_skills` read/write reference in the spec to a filesystem-based flow and drop the DB-write assumptions.

### Independently verified facts about the current codebase

- `server/services/systemSkillService.ts` is a file-based reader that loads from `server/skills/*.md` into an in-memory cache. It exports `listSkills`, `getSkill`, `getSkillBySlug`, `listVisibleSkills`, `updateSkillVisibility` (rewrites markdown frontmatter), and `resolveSystemSkills`. **It has no `createSystemSkill` or `updateSystemSkill` method.**
- `server/routes/systemSkills.ts` explicitly returns HTTP 405 on `POST /api/system/skills` and `DELETE /api/system/skills/:id` with the message "System skills are managed as files in server/skills/. Use the codebase to add or modify skills."
- `server/db/schema/systemSkills.ts` defines a `system_skills` DB table, but a grep across `server/` shows no code reads from or writes to that table. It appears to be a dormant schema definition.
- The spec's §8 calls `systemSkillService.createSystemSkill(candidate)` and `systemSkillService.updateSystemSkill(matchedSkillId, proposedMergedContent)` — **these methods do not exist in the current codebase.**
- The spec's §4 Goals claim "Skill write + agent assignment either both happen or both roll back per result" and §8 says "Wrap the whole thing in a DB transaction per result". If the authoritative source ends up being the filesystem, a single Postgres transaction cannot atomically cover both a filesystem write and a `system_agents` DB update — the transactional guarantee becomes impossible.

### Tentative recommendation (non-authoritative)

Three concrete options — none of them is mechanical because each fundamentally reshapes the spec:

**Option A — DB-backed (adds a new phase 0):** Add a new Phase 0 before Phase 1 that (1) backfills every `server/skills/*.md` into the `system_skills` DB table (adding `instructions` and `definition` if they're not already present), (2) rewrites `systemSkillService` to become DB-backed with `createSystemSkill`, `updateSystemSkill`, `getSystemSkillById`, `listSystemSkills`, plus the existing visibility path, (3) removes the `notSupported` 405 handlers in `server/routes/systemSkills.ts`, (4) retains file-based loading only as a seed path for fresh environments. Phase 1 of this spec then depends on Phase 0. §11 Open item #4 is removed. §5.3 is resolved to "points at `system_skills.id` (the DB PK)". §8's transactional guarantee is preserved.

**Option B — File-based writes (rewrites §5–§8):** The analyzer writes to `server/skills/*.md` by generating or patching markdown files. §8 switches from "DB transaction per result" to a filesystem sequence with an explicit failure mode ("if skill write succeeds but agent attach fails, log and continue; no rollback"). §5.3's `matchedSkillId` loses its meaning because the file-based service keys by slug, not UUID. §8 gains a "write .md file" step and loses the transaction promise. The spec grows a new "file generation" section describing frontmatter shape, parameter section formatting, and line-ending handling.

**Option C — Defer the rescope:** Remove the "system-only rescope" goal from this spec. Scope the spec to agent proposals + three-column merge view against the org `skills` table only. Open a separate spec for the DB migration and system-skill rescope.

All three options change what gets built, the phase count, and the transactional contract. Only the human can make this call.

### Reasoning

This is the single biggest directional question in the spec. Every other finding that touches "`system_skills` the table" is downstream of this decision. The spec's §11 Open items #4 correctly identifies the question but allows the rest of the spec to proceed as if the DB-backed answer is already chosen — that choice is the directional call. Classified as directional per the "Architecture signals" (introduce a new CRUD service layer) and "Cross-cutting signals" (affects every item in the spec).

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`. If `apply-with-modification`, add the modification inline. If `reject`, add a one-sentence reason. If `stop-loop`, the review loop exits and the spec stays in its current state for the human to rethink.

```
Decision: apply-with-modification
Modification (if apply-with-modification): Option A (DB-backed). Add Phase 0 before current Phase 1 that (a) backfills every server/skills/*.md into the system_skills DB table including instructions and definition, (b) rewrites systemSkillService to be DB-backed exporting createSystemSkill/updateSystemSkill/getSystemSkillById/listSystemSkills plus the existing visibility path, (c) removes the 405 handlers in server/routes/systemSkills.ts, (d) retains file-based loading only as a seed path for fresh environments. Phase 1 depends on Phase 0. The §8 transactional guarantee is preserved. §11 open item #4 is removed. §5.3 matchedSkillId resolves to system_skills.id (DB PK). Applied by caller via full spec rewrite.
Reject reason (if reject): n/a
```

---

## Finding 1.2 — `matchedSkillId` semantics conflict with existing `matchedSystemSkillSlug` column

**Classification:** ambiguous
**Source:** Codex (important)
**Spec section:** §5.3 `skill_analyzer_results.matchedSkillId` semantics

### Codex's finding (verbatim)

> **Match identity drift** — This section says `matchedSkillId` now points at `system_skills.id`, but the current analyzer still distinguishes org matches via `matchedSkillId` and system matches via `matchedSystemSkillSlug` in `server/db/schema/skillAnalyzerResults.ts`, `server/jobs/skillAnalyzerJob.ts`, and the client types in `client/src/components/skill-analyzer/SkillAnalyzerWizard.tsx`. The spec never states whether `matchedSystemSkillSlug` is removed, retained for compatibility, or how old rows are interpreted.
>
> **Suggested fix:** Declare one canonical match identifier model. Either keep both fields and document exact semantics for each, or replace them with a single system-skill ID field plus an explicit migration/response-contract update that removes `matchedSystemSkillSlug` everywhere.

### Independently verified facts

- `server/db/schema/skillAnalyzerResults.ts` lines 32–34 contain BOTH `matchedSkillId: uuid('matched_skill_id')` AND `matchedSystemSkillSlug: text('matched_system_skill_slug')` AND `matchedSkillName: text('matched_skill_name')`. These three are the current match-pointer model.
- The spec's §5.3 only mentions `matchedSkillId` and does not address `matchedSystemSkillSlug`.

### Tentative recommendation (non-authoritative)

Likely mechanical action: add a bullet to §5.3 saying "Drop the `matchedSystemSkillSlug` and `matchedSkillName` columns in the same migration — system-only means there is only one match-identifier path, keyed on `system_skills.id` (or `system_skills.slug`, per the resolution of Finding 1.1). The new response shape (§7.4) provides the full `matchedSkillContent` at read time, so `matchedSkillName` is redundant."

But this is ambiguous because:
1. The right identifier (`id` vs `slug`) depends on the resolution of Finding 1.1 (DB-backed vs file-based).
2. Dropping columns in the same migration as creating new ones is a schema-drop decision — fine for a pre-production codebase, but not something to auto-apply without the human confirming they actually want the column removed rather than kept as a transitional redundancy.

### Reasoning

Dependent on Finding 1.1. The cleanest resolution requires knowing whether the match points at a DB UUID or a filesystem slug. Classifying as ambiguous per the spec-reviewer rubric's "bias to HITL" rule. Once Finding 1.1 is resolved, this becomes straightforward — either drop `matchedSystemSkillSlug` (DB-backed answer) or drop `matchedSkillId` instead (file-based answer).

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Following the Option A resolution of Finding 1.1 (DB-backed), drop both matchedSystemSkillSlug and matchedSkillName columns in the same migration. Keep matchedSkillId pointing at system_skills.id (DB PK). The matchedSkillContent field in the GET jobs response (§7.4) provides the name at read time, so matchedSkillName is redundant. Applied by caller via full spec rewrite.
Reject reason (if reject): n/a
```

---

## Finding 1.3 — `agentProposals` uses slug as the identity key, but slug mutates when agents are renamed

**Classification:** ambiguous
**Source:** Codex (important)
**Spec section:** §5.2 (`agentProposals` column), §7.3 (`PATCH .../results/:resultId/agents`), §8 Execute step

### Codex's finding (verbatim)

> **Agent proposals use unstable keys** — `agentProposals` stores only `{ slug, score, selected }`, and the new endpoints in 7.3 also mutate by `slug`. In the current code, `systemAgentService.updateAgent()` rewrites the slug when an agent name changes, so a proposal captured at analysis time can drift before execute even if the agent still exists.
>
> **Suggested fix:** Store agent identity by immutable `systemAgentId`, with `slug`/`name` as display-only snapshots. Change the proposal schema and the `/agents` endpoint to use `systemAgentId`, and resolve current slug/name when reading.

### Independently verified facts

- `server/services/systemAgentService.ts` lines 109–112: `if (data.name !== undefined) { update.name = data.name; update.slug = slugify(data.name); }` — slug is rewritten whenever name is updated.
- §8 of the spec says "for each selected agent slug, append the new skill slug to that system agent's `defaultSystemSkillSlugs` via `systemAgentService.updateAgent()`". If the agent's slug changed between analysis and execute, this lookup silently fails or attaches to the wrong agent.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would change the §5.2 shape from `{ slug: string, score: number, selected: boolean }` to `{ systemAgentId: uuid, slugSnapshot: string, nameSnapshot: string, score: number, selected: boolean }`. The §7.3 PATCH endpoint would accept `{ systemAgentId, selected }` and `{ systemAgentId, remove: true }`. §8 would call `systemAgentService.getAgentById(systemAgentId)` and read the *current* slug off the returned row before appending to `defaultSystemSkillSlugs`. The Review UI chips would render `slugSnapshot` / `nameSnapshot` at analysis time but the execute path would use live lookups.

### Reasoning

Classifying as ambiguous because an alternative fix — prevent `systemAgentService.updateAgent` from rewriting slugs on rename — is a different, equally valid directional call that the spec author may prefer. That alternative has its own trade-offs (breaks the existing "slug is derived from name" invariant, touches other areas of the codebase). The slug-mutation behavior is an existing-codebase concern outside this spec's nominal scope, so I do not want to impose a schema change on `agentProposals` without confirmation.

Also, both paths introduce a new concept to the jsonb shape (either `systemAgentId` as a new required field, or an `agent-rename-freeze` invariant elsewhere). Per the rubric, introducing a new concept → directional.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Apply the tentative recommendation as described. agentProposals shape becomes { systemAgentId: uuid, slugSnapshot: string, nameSnapshot: string, score: number, selected: boolean }. The PATCH /results/:resultId/agents endpoint accepts { systemAgentId, selected } or { systemAgentId, remove: true }. Execute step calls systemAgentService.getAgentById(systemAgentId) and reads the live slug off the returned row before appending to defaultSystemSkillSlugs. Review UI chips render slugSnapshot/nameSnapshot at analysis time; execute path uses live lookups. Applied by caller via full spec rewrite.
Reject reason (if reject): n/a
```

---

## Finding 1.4 — Agent-propose selection rules contradict each other; manual-add score source undefined

**Classification:** ambiguous
**Source:** Codex (important) + rubric (contradiction class)
**Spec section:** §6.2 Agent-propose edge cases, §7.1 Per-card layout (example rendering), §7.3 PATCH endpoint shape

### Codex's finding (verbatim)

> **Selection rules contradict each other** — The pipeline says "take top 3 with score `>= 0.50`, write to `agentProposals` with `selected: true`," but the UI example in 7.1 shows an unchecked `52%` chip, and 6.2 also says a single below-threshold agent should still appear unchecked. The manual-add flow is also underspecified because it appends `{ slug, score, selected: false }` without saying how `score` is obtained.
>
> **Suggested fix:** Choose one consistent rule and state it explicitly: either persist top-K regardless of threshold and set `selected = score >= threshold`, or persist only threshold-passing proposals and allow manual additions with `score: null`. Update the example and endpoint contract to match.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would pick **Option A (persist top-K always, pre-select by threshold)**:

> §6 Agent-propose stage: For each DISTINCT result, compute cosine similarity against every system agent embedding, take the top-K=3 by score (regardless of threshold), and write them to `agentProposals` with `selected: score >= AGENT_PROPOSAL_THRESHOLD`. The UI shows all top-K chips; pre-checked ones are at or above threshold, unchecked ones are below.
>
> Manual-add flow (§7.1): when the user picks an agent that is not already in `agentProposals`, the server looks up the stored agent embedding (refreshing it if stale), computes its cosine similarity against the candidate embedding, and appends `{ systemAgentId, slugSnapshot, nameSnapshot, score: computedScore, selected: true }`. Score is always real — never null.

But Option B (persist only threshold-passers, manual-add with `score: null`) is also defensible and has less compute cost on large fleets. The two options produce different UIs and different PATCH contracts.

### Reasoning

The UI example in §7.1 implies Option A (showing a 52% chip means top-K is persisted even below threshold). §6.2 bullet 2 also implies Option A ("One system agent → still run. It either scores ≥ 0.50 and gets pre-selected, or it scores below and appears unchecked."). But §6.2 bullet 1 says "take top 3 **with score ≥ 0.50**" which is Option B. The spec explicitly states both rules and they cannot both be true.

This is a contradiction in the rubric sense, which would normally be mechanical. But resolving it picks a product behavior (what the reviewer sees on a DISTINCT candidate when no agent scores ≥ 0.50 — nothing at all, or the top 3 unchecked). That is a UX call the human should make. Bias to HITL.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Option A — persist top-K always, pre-select by threshold. Agent-propose stage computes cosine similarity for every system agent, takes the top-K=3 by score (regardless of threshold), and writes them to agentProposals with selected: (score >= AGENT_PROPOSAL_THRESHOLD). The UI shows all top-K chips; pre-checked ones are at or above threshold, unchecked ones are below. Manual-add flow: when the user picks an agent not already in agentProposals, the server refreshes the agent embedding if stale, computes live similarity against the candidate, and appends { systemAgentId, slugSnapshot, nameSnapshot, score: computedScore, selected: true }. Score is always real, never null. Applied by caller via full spec rewrite.
Reject reason (if reject): n/a
```

---

## Finding 1.5 — Bulk-approve-partial-overlaps flow is under-specified (endpoint, button, skipped-row persistence)

**Classification:** ambiguous
**Source:** Codex (important)
**Spec section:** §7.2 "Approve all new" behaviour (second paragraph) + §7.3 endpoints

### Codex's finding (verbatim)

> **Bulk partial-overlap flow undefined** — The section says bulk-approving partial overlaps skips rows with `proposedMergedContent === null` and shows a count, but there is no defined bulk action for partial overlaps in the current UI, and the spec does not say whether skipped rows become `actionTaken = 'skipped'` or are merely omitted from the request. That ambiguity will leak into both client behavior and execute semantics.
>
> **Suggested fix:** Add an explicit bulk-approve-partial-overlaps contract: which button triggers it, which endpoint it calls, what rows are included, and whether unavailable rows are persisted as `skipped` or left unchanged.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would:
1. Add an "Approve all partial overlaps (with proposal)" button spec to §7.2.
2. Point it at the existing `POST /api/system/skill-analyser/jobs/:jobId/results/bulk-action` endpoint with `action: 'approved'` and `resultIds: [rows where classification in {PARTIAL_OVERLAP, IMPROVEMENT} AND proposedMergedContent IS NOT NULL]`.
3. State explicitly that rows with null `proposedMergedContent` are filtered client-side before the request is sent — they remain with `actionTaken = null` and are NOT set to `skipped`. The "2 skipped" in the user-visible count is a client-side tally, not a DB state change.
4. Add an "info banner" spec to §7.2 showing the skipped count.

### Reasoning

This is a load-bearing claim without a contract (rubric category). The fix is adding detail, which is normally mechanical — BUT it introduces a new button, new client filtering logic, and makes a semantic call about whether "skipped for proposal unavailability" is the same as `actionTaken = 'skipped'`. The latter is especially not something to auto-decide: the current `actionTaken` enum has a `'skipped'` value, and conflating "user explicitly skipped" with "skipped because the LLM failed" is a schema/semantics call.

Bias to HITL.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Apply the tentative recommendation. Add an "Approve all partial overlaps (with proposal)" button spec to §7.2. It calls the existing POST /jobs/:jobId/results/bulk-action endpoint with action: 'approved' and resultIds filtered to rows where classification is in {PARTIAL_OVERLAP, IMPROVEMENT} AND proposedMergedContent IS NOT NULL. Rows with null proposedMergedContent are filtered client-side before the request is sent — they remain with actionTaken = null and are NOT set to 'skipped' in the DB. The "N skipped" count is a client-side tally shown in an info banner, not a DB state change. Applied by caller via full spec rewrite.
Reject reason (if reject): n/a
```

---

## How to resume the loop

After editing all `Decision:` lines below:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (`apply`, `apply-with-modification`, `reject`, or `stop-loop`), and continue to iteration 2.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.

Finding 1.1 is the root directional call. Findings 1.2 and 1.4 are partially dependent on it. If you resolve 1.1 first, 1.2 should usually follow the same resolution.

---

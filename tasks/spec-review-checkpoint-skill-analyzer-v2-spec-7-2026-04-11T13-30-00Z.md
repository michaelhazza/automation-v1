# Spec Review HITL Checkpoint — Iteration 7

**Spec:** `docs/skill-analyzer-v2-spec.md`
**Spec commit:** untracked working-tree (repo HEAD = `9b75c17`)
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 7 (post iteration-6 HITL resolution; all six iteration-6 decisions verified applied to the spec before this iteration ran)
**Timestamp:** 2026-04-11T13:30:00Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 8 until every finding below is resolved by the human. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

Iteration 7's mechanical findings (7.2, 7.3, 7.4, 7.5, 7.8, 7.9) have already been applied to the spec in-place. The three findings below are the directional/ambiguous residue that must be resolved before iteration 8 can start.

---

## Iteration 7 — Codex + Rubric pass summary

- Codex findings surfaced: 9 (numbered 7.1..7.9)
- Rubric findings surfaced: 0 net-new (all rubric hits are also Codex hits)
- Mechanical accepted: 6 (7.2, 7.3, 7.4, 7.5, 7.8, 7.9)
- Mechanical rejected: 0
- Directional: 2 (7.1, 7.7)
- Ambiguous: 1 (7.6)

Mechanical fixes applied to the spec before writing this checkpoint:

- **7.2** — §10 Phase 0 `createSystemSkill` now enforces `input.handlerKey === input.slug` in addition to `handlerKey ∈ SKILL_HANDLERS`. Closes the §5.5-invariant / §10-Phase-0-enforcement drift.
- **7.3** — §8.1 rewritten to resolve the internal contradiction. Phase 1 is now explicitly the first PR that opens a transaction (skill-create-only); Phase 2 is the first PR where the transaction protects more than one statement.
- **7.4** — §7.3 `PATCH .../merge` wire contract tightened: `definition` is a parsed object on the wire, never a string; client parses on blur; server returns 400 for non-object bodies.
- **7.5** — §7.1 stale "open question — see HITL checkpoint from iteration 6 finding 7b" replaced with a concrete reference to §8's normative execute-time handler-check behaviour.
- **7.8** — §3 "What this feature adds" extended with the Phase 0 load-bearing artifacts (backfill script, startup validator, handler-registry refactor, bootstrap wiring, 405-handler replacement, README, `visibility` / `handlerKey` columns).
- **7.9** — §8 now opens with a "Note on handler identity" paragraph that cross-references the §5.5 `handlerKey = slug` invariant.

---

## Table of contents

- Finding 7.1 — Manual-add candidate-embedding retrieval mechanism is undefined
- Finding 7.6 — `proposedMerge` parser repair contract is load-bearing but under-specified
- Finding 7.7 — Agent attachment outcomes have no persisted per-proposal record
- How to resume the loop
- Note on resolution ordering

---

## Finding 7.1 — Manual-add candidate-embedding retrieval mechanism is undefined

**Classification:** directional
**Signal matched (if directional):** Architecture signals — "Introduce a new abstraction / service / pattern" AND "Change the interface of X" (manual-add flow); Load-bearing claim without a concrete mechanism (rubric)
**Source:** Codex (finding 1, severity: high)
**Spec section:** §6.2 manual-add flow, §7.3 PATCH /agents addIfMissing mode, §10 Phase 4 manual-add bullet

### Codex's finding (verbatim)

> `PATCH .../agents` is supposed to refresh one agent embedding and then compute live cosine similarity against "the candidate embedding (which the job already has from the Compare stage)" (§7.3, Phase 4). But the v2 data model never introduces any persisted candidate-embedding field, any job-local embedding cache, or any service API for reloading a candidate embedding at PATCH time (§5, §6, Phase 2). This is a load-bearing mechanism gap: Phase 4 cannot implement manual-add deterministically from the spec as written.

### Tentative recommendation (non-authoritative)

Verified at spec-review time: `server/db/schema/skillEmbeddings.ts` already defines a content-addressed `skill_embeddings` table (keyed by `contentHash`, with `sourceType ∈ { system, org, candidate }`). Candidate embeddings ARE already persisted during the Embed pipeline stage under `sourceType = 'candidate'`. But `skill_analyzer_results` has no `candidateContentHash` or `candidateEmbedding` column, and the spec does not specify how the PATCH endpoint navigates from a `resultId` to the candidate's embedding row in `skill_embeddings`.

Three coherent options:

**Option A — Persist `candidateContentHash` on `skill_analyzer_results`.** Add a `candidateContentHash text not null` column alongside the other columns added in §5.2, set during the Write stage. At PATCH time, the server reads `candidateContentHash` from the result row and looks up `skill_embeddings` by that hash. Deterministic and cheap. Requires one new column in the same §5.2 / Phase 1 migration. Propagates into §5.2 columns table, §6 Write stage, Phase 1 migration contract, and §10 Phase 4 manual-add flow prose.

**Option B — Recompute the candidate embedding at PATCH time from stored candidate content.** Extend `skill_analyzer_results` to store the candidate's parsed content, re-normalise at PATCH time, SHA-256 it, look up `skill_embeddings` by hash, and re-embed via OpenAI if absent. Avoids the `candidateContentHash` column but moves an OpenAI embed call onto the PATCH endpoint's synchronous path. Incompatible with §4's "keeps cost flat" non-goal.

**Option C — Job-local in-memory embedding cache in the worker process.** Does not work in this codebase's process topology: the PATCH endpoint lives in the Express server process, which is a different process from the pg-boss worker that ran the job. Straw-man option, included for completeness.

Option A is the only option that matches the framing. Minimum surface area: one column added to the migration the spec already defines, one lookup path added to the manual-add handler, no new service, no new hot-path LLM call. But adding a column is a directional scope call — the human must sign off.

### Reasoning

Directional because the fix either (a) adds a new column to a load-bearing table (Option A), (b) puts an OpenAI embed call on a hot path and violates §4 non-goals (Option B), or (c) requires a cross-process cache the topology does not support (Option C, invalid). Bias-to-HITL: the scope change is small but lands in §5.2's column table which the rest of the spec references.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`. If `apply-with-modification`, add the modification inline.

```
Decision: apply-with-modification
Preferred option 7.1 (A, B, or C): A
Modification (if apply-with-modification): Option A. Add candidateContentHash text not null column to skill_analyzer_results in the §5.2 / Phase 1 migration. Set during the Write stage from the hash computed in the Hash stage (pipeline step 2). At PATCH /agents addIfMissing time, the server reads candidateContentHash from the result row and looks up skill_embeddings by that hash (sourceType = 'candidate'). Propagate into §5.2 columns table, §6 Write stage (already hashes candidates — just persist the hash), Phase 1 migration contract, and §10 Phase 4 manual-add flow prose.
Reject reason (if reject): n/a
```

---

## Finding 7.6 — `proposedMerge` parser repair contract is load-bearing but under-specified

**Classification:** ambiguous
**Signal matched (if directional):** possibly Architecture — "Change the interface of X" (the parser); possibly Rubric — load-bearing claim without mechanism
**Source:** Codex (finding 6, severity: medium)
**Spec section:** §6.1 classify prompt, §9 edge cases ("parser fills missing fields from the library skill"), §10 Phase 3 parser contract

### Codex's finding (verbatim)

> The only place that says "missing fields are filled from the library skill, not the incoming candidate" is the edge-cases section (§9). The actual parser contract in §6.1 / Phase 3 never defines that merge algorithm, field precedence, or where the parser gets the library row when repairing malformed output. That is a behavioural invariant with real write-path impact, but it is not specified where the implementation would actually enforce it.

### Tentative recommendation (non-authoritative)

Three coherent options:

**Option A — Delete the §9 edge-case claim.** Acknowledge that the spec makes no guarantee about what happens when the LLM returns a `proposedMerge` with fewer fields than expected. Fall back to the existing `proposedMergedContent` null path (§6.3 LLM fallback): a malformed merge is indistinguishable from a missing merge, `proposedMergedContent` is set to null, the UI shows "Proposal unavailable", execute rejects. Simplest — no parser change, no library-row access, just drop the claim that says something the parser doesn't actually do.

**Option B — Specify the repair algorithm in §6.1 / Phase 3.** Extend `parseClassificationResponseWithMerge()`'s contract: "If the LLM returns a `proposedMerge` with missing fields (`name`, `description`, `definition`, or `instructions`), the parser fills the missing fields from the matched library row's current content. The parser receives the library row as an input argument (`parseClassificationResponseWithMerge(response, { librarySkill })`). If any field is missing from BOTH the LLM response AND the library row, the parser returns null." Enforceable but changes the parser signature and introduces a new dependency from the parser into the library-row source.

**Option C — Defer to §11 open items.** Move "parser repair semantics for malformed `proposedMerge`" to §11 and delete the §9 claim that implies it is already specified. Locks nothing, but the §9 claim becomes consistent with §11's intent.

Option A is cleanest and matches the §6.3 fallback path. Option B is more defensive but changes the parser signature. Option C defers.

### Reasoning

Ambiguous because any of the three is coherent and the choice affects the Phase 3 parser signature (B) or the §9 edge-case list (A, C). Closest directional signal is "Architecture signals — change the interface of X" for Option B. Bias-to-HITL: the human should pick — cost of a wrong auto-apply (locking a parser signature, or silently deleting an edge case the human cared about) outweighs 30 seconds of HITL.

### Decision

```
Decision: apply-with-modification
Preferred option 7.6 (A, B, or C): A
Modification (if apply-with-modification): Option A. Delete the §9 edge-case bullet that claims "LLM returns proposedMerge with fewer fields than expected → the parser fills missing fields from the library skill". Replace with: "LLM returns proposedMerge with fewer fields than expected → the parser rejects the response as malformed, proposedMergedContent stays null, the row follows the §6.3 LLM-fallback path (UI shows 'Proposal unavailable', execute rejects with 'merge proposal unavailable — re-run analysis')." Aligns the §9 edge case with the existing null-fallback semantics. No parser signature change; no library-row dependency in parseClassificationResponseWithMerge.
Reject reason (if reject): n/a
```

---

## Finding 7.7 — Agent attachment outcomes have no persisted per-proposal record

**Classification:** directional
**Signal matched (if directional):** Architecture signals — "Introduce a new abstraction" (new persisted outcome model); Scope signals — "Add this item to the roadmap" (new column / new contract)
**Source:** Codex (finding 7, severity: medium)
**Spec section:** §4 atomicity invariant, §5.2 agentProposals column, §8 DISTINCT agent-attach loop, §9 edge cases

### Codex's finding (verbatim)

> The result row has one `executionResult`, but DISTINCT execute can fan out into N selected agent attachments (§8). The spec says deleted agents are "logged and silently skipped" and the row still succeeds (§4, §8, §9), but there is no persisted per-proposal outcome such as attached/skipped/missing. That leaves the execution record mechanically incomplete for the new multi-item side effect the feature introduces.

### Tentative recommendation (non-authoritative)

Three coherent options:

**Option A — Persist per-proposal outcomes on the existing `agentProposals` column.** Extend the `agentProposals` jsonb shape (defined in §5.2) with an optional `outcome: 'attached' | 'skipped-missing' | 'skipped-unselected' | null` field. Null before execute runs. Populated during `executeApproved()` per selected proposal. Zero new columns — a shape extension on a column already in the spec. Downside: mixes analysis-time proposal state with execute-time outcome state in one column. Also loses the ability to record repeat executions cleanly, since re-execution would overwrite the outcome field.

**Option B — Add a separate `agentAttachmentOutcomes` jsonb column on `skill_analyzer_results`.** `[{ systemAgentId, outcome: 'attached' | 'skipped-missing', attachedAt: timestamptz }]`. Cleanly separates proposal state (in `agentProposals`) from execution state (in `agentAttachmentOutcomes`). Requires one more column in the §5.2 migration.

**Option C — Rely on structured logging only.** Document in §8 that per-proposal success/skip is written to the structured logger (`logger.info({ resultId, systemAgentId, outcome })`) and the DB does not persist per-proposal outcomes. The `executionResult` column on the row still reflects overall success. Matches the spec's current "log and drop silently" framing. Downside: no operational way to answer "which agents did result X end up attached to?" without scraping logs — in pre-production this is probably fine.

Option C is most conservative and matches current framing. Option A is a one-shape tweak. Option B is the most defensive but adds a column.

### Reasoning

Directional because all three options affect either the spec's data model (A, B) or the execute contract's framing (C). The baked-in framing assumption "pre-production, no live users, rapid evolution" tilts toward Option C — logging is almost always enough pre-production — but the human owns this framing application.

### Decision

```
Decision: apply-with-modification
Preferred option 7.7 (A, B, or C): C
Modification (if apply-with-modification): Option C. Structured logging only. No new column, no shape extension on agentProposals. Add a clarifying paragraph to §8 DISTINCT branch (just before the "Wrap the entire per-result sequence in a single Postgres transaction" sentence) stating: "Per-proposal outcomes — `attached` (slug appended successfully) and `skipped-missing` (agent no longer exists in system_agents) — are emitted to the structured logger via `logger.info({ resultId, systemAgentId, outcome })` inside the transaction block. The DB does not persist per-proposal outcomes; the row-level `executionResult` reflects overall transaction success. This matches the pre-production framing (`docs/spec-context.md`) where log scraping is an acceptable audit path; if post-first-agency operations need persisted per-proposal outcomes, that is a follow-on schema migration, not a prerequisite for this feature." Add one bullet to §9 edge cases: "Agent attachment outcomes are logged, not persisted. A DISTINCT result with 3 selected proposals where 1 agent was deleted between analysis and execute will still succeed overall (executionResult = 'created') with 2 attached + 1 logged as skipped-missing."
Reject reason (if reject): n/a
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (apply, apply-with-modification, reject, or stop-loop), apply all resolved changes, and continue to iteration 8.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings marked `apply` or `apply-with-modification`.

---

## Note on resolution ordering

All three findings are independent — 7.1 affects `skill_analyzer_results` columns, 7.6 affects the `parseClassificationResponseWithMerge` parser contract, 7.7 affects either the `agentProposals` column shape or adds a new `agentAttachmentOutcomes` column. None blocks another. Resolve in any order.

7.1 is the highest-impact because it fixes a concrete implementation blocker: Phase 4 cannot ship without a candidate-embedding retrieval path. 7.7 is the lowest-impact because Option C ("logging only") matches the spec's existing framing and requires only a one-line prose clarification. 7.6 is middle — deleting the §9 claim (Option A) is cheapest; specifying the repair algorithm (Option B) is most defensive.

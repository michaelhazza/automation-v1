# Spec Review HITL Checkpoint — Iteration 6

**Spec:** `docs/skill-analyzer-v2-spec.md`
**Spec commit:** untracked working-tree (repo HEAD = `9b75c17`)
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 6 of 5 cap (iterations 1–5 completed previously; this is a post-final-report re-invocation covering the human's post-final-report Model 1 edits — see caller brief)
**Timestamp:** 2026-04-11T12:00:00Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 7 until every finding below is resolved by the human. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

Iteration 6's mechanical findings (5, 6, 7a mechanical part, 8, 9) have already been applied to the spec in-place. The six findings below are the directional/ambiguous residue that must be resolved before iteration 7 can start.

---

## Table of contents

- Finding 6.1 — handlerKey is not actually used at runtime dispatch
- Finding 6.2 — handlerKey uniqueness is not specified
- Finding 6.3 — handlerKey / slug divergence rules are not specified
- Finding 6.4 — Circular-dependency risk from `SKILL_HANDLERS` import
- Finding 6.7b — Partial-overlap matches against inactive rows with unregistered `handlerKey`
- Finding 6.10 — Manual-add endpoint wire contract is inconsistent between §7.3 and §10 Phase 4
- How to resume the loop
- Note on resolution ordering

---

## Finding 6.1 — handlerKey is not actually used at runtime dispatch

**Classification:** directional
**Signal matched (if directional):** Architecture signals — "Change the interface of X"; load-bearing contract that the spec under-specifies
**Source:** Codex (finding 1, severity: critical)
**Spec section:** §5.5, §8 DISTINCT branch, §10 Phase 0 "Handler registry refactor"

### Codex's finding (verbatim)

> `handlerKey` is introduced as the row-to-code binding, but the runtime dispatch contract still shows `skillExecutor.execute()` looking up `SKILL_HANDLERS[skillName]`, so the new column is not actually enforced on execution.
>
> Fix: Amend the spec to make one source of truth explicit. Preferred verbatim change: "`handlerKey` is the runtime dispatch key. Any code path that executes a system skill must read `handlerKey` from the resolved `system_skills` row and call `SKILL_HANDLERS[handlerKey]`; `slug` is not used for dispatch." If `handlerKey` is validation-only instead, say that explicitly and remove "pairs this skill row with a TypeScript handler function" language.

### Tentative recommendation (non-authoritative)

Two coherent resolutions exist and the spec must pick one:

**Option A — Validation-only posture (probably what the human intended).** `handlerKey` exists so that (a) the Phase 0 backfill can fail-fast on missing pairings, (b) `createSystemSkill` can reject unpaired rows at write time, (c) `validateSystemSkillHandlers()` can fail-fast at boot, and (d) the analyzer's `executeApproved()` DISTINCT branch can fail-fast before opening the transaction. Runtime invocation (`skillExecutor.execute()`) continues to dispatch on the slug an agent passes in, unchanged from today. The invariant `handlerKey = slug` is maintained at row-create time and `updateSystemSkill` is not allowed to diverge it (see Finding 6.3). Under this model, §5.5's "pairs this skill row with a TypeScript handler function" language is accurate in a validation sense but is not a runtime dispatch claim; the spec should say so explicitly, e.g. *"`handlerKey` is a write-time and boot-time validation key, not a runtime dispatch key. Runtime dispatch in `skillExecutor.execute()` continues to key on the `skillName` (slug) the agent passes. The validation-time invariant `handlerKey = slug` — preserved by the backfill, the `createSystemSkill` contract, and the `updateSystemSkill` immutability rule in Finding 6.3 — ensures the two keys never diverge in practice."*

**Option B — Dispatch-key posture.** `skillExecutor.execute()` is rewritten to first resolve the `system_skills` row by slug (new DB read per invocation), read its `handlerKey`, then dispatch on `SKILL_HANDLERS[handlerKey]`. This adds a DB read to every skill invocation on the hot path (every agent tool call), which is a runtime cost change, and turns `skillExecutor` into a consumer of the DB layer rather than a pure dispatcher. It also requires that §10 Phase 0's refactor ship with a caching layer for the slug→handlerKey lookup, or accept the per-call DB cost.

Option A is materially cheaper, matches the framing assumptions (pre-production, rapid evolution, prefer-existing-primitives), and requires only a prose tightening, not a code-path change. But it is still a directional product decision the human must own.

### Reasoning

This is the first thing I would flag: the spec introduced `handlerKey` as a contract column without ever stating where in the runtime call graph it participates. Codex caught it correctly. The resolution affects §5.5, §7.1 (the Approve gate predicate), §7.4 (the `unregisteredHandlerSlugs` computation — is it `slug NOT IN SKILL_HANDLERS` or `handlerKey NOT IN SKILL_HANDLERS`?), §8 DISTINCT branch, §10 Phase 0 validator contract, §10 Phase 1 handler gate, and by implication the "data refers to code" framing the human added in the first place. A decision here cascades into Finding 6.3 (handlerKey/slug divergence rules) and Finding 6.7b (inactive rows with unregistered handlerKey). I cannot apply this mechanically because a false negative here invalidates every other handler-gate-related section of the spec.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`. If `apply-with-modification`, add the modification inline.

```
Decision: apply-with-modification
Preferred option (A or B): A
Modification (if apply-with-modification): Option A (validation-only posture). handlerKey is a write-time + boot-time validation key, not a runtime dispatch key. Runtime dispatch in skillExecutor.execute() continues to key on the slug the agent passes, unchanged from today. The handlerKey = slug invariant is enforced at write time (backfill, createSystemSkill, analyzer execute gate) and at boot time (validateSystemSkillHandlers). §5.5 is updated to state this explicitly. §8 DISTINCT gate and §7.4 unregisteredHandlerSlugs continue to use slug because the invariant makes slug and handlerKey provably identical.
Reject reason (if reject): n/a
```

---

## Finding 6.2 — handlerKey uniqueness is not specified

**Classification:** ambiguous
**Signal matched (if directional):** Under-specified schema contract (rubric)
**Source:** Codex (finding 2, severity: important)
**Spec section:** §5.5, §10 Phase 0 `createSystemSkill` / `updateSystemSkill` contracts

### Codex's finding (verbatim)

> The spec never states whether `handlerKey` is one-to-one with a skill row or intentionally many-to-one, so the schema leaves a load-bearing ambiguity around duplicate `handlerKey` values.
>
> Fix: Pick one and encode it. If one handler per skill row is intended, add: "`handlerKey` has a UNIQUE constraint." If shared handlers are intended, add: "`handlerKey` is intentionally non-unique; multiple `system_skills` rows may dispatch to the same handler, and `slug` remains the unique skill identity."

### Tentative recommendation (non-authoritative)

Two options:

**Option A — UNIQUE constraint.** Add `UNIQUE` on `handlerKey`. This is consistent with the "one handler per skill" mental model and with the implicit `handlerKey = slug` invariant (slug is already unique). Downside: a future use case where two skills want to alias a single handler (e.g. `fetch_url` and `fetch_page` both wired to the same implementation) is blocked.

**Option B — Non-unique, declare slug as the skill identity.** Add a sentence: "`handlerKey` is intentionally non-unique; `slug` is the unique skill identity. Multiple rows may dispatch to the same handler (alias pattern)." Downside: under Finding 6.1 Option A, non-uniqueness is moot because runtime dispatch never uses `handlerKey` — so why allow non-unique values at all? It becomes dead flexibility.

My best guess is Option A is simpler and matches the human's stated "data refers to code" framing. But the decision belongs to the human because it locks a schema constraint.

This finding is **downstream of Finding 6.1**: if 6.1 resolves as Option A (validation-only), uniqueness is mostly bookkeeping; if 6.1 resolves as Option B (dispatch-key), uniqueness is load-bearing.

### Reasoning

Classified as ambiguous not directional because the uniqueness question does not obviously match any directional signal on the hardcoded list — it is closer to "unnamed new primitive without a concrete constraint" from the rubric. But bias-to-HITL says this is still the human's call; a UNIQUE constraint added mechanically could invalidate a future alias use case, and a non-unique default added mechanically could leak through into a silent bug if the dispatch-key posture is later adopted.

### Decision

```
Decision: apply-with-modification
Preferred option 6.2 (A or B): A
Modification (if apply-with-modification): Option A (UNIQUE constraint on handlerKey). Matches the handlerKey = slug invariant (slug is already unique). No current alias use case; if aliasing is needed later, drop the constraint in a follow-up migration. §5.5 and §10 Phase 0 migration are updated to state UNIQUE on handlerKey.
Reject reason (if reject): n/a
```

---

## Finding 6.3 — handlerKey / slug divergence rules are not specified

**Classification:** directional
**Signal matched (if directional):** Architecture signals — "Change the interface of X"; load-bearing contract that affects `updateSystemSkill` semantics
**Source:** Codex (finding 3, severity: important)
**Spec section:** §5.5, §10 Phase 0 `createSystemSkill` / `updateSystemSkill`, §7.1, §7.4, §8, §10 Phase 1

### Codex's finding (verbatim)

> These sections are only internally consistent if `candidate.slug === handlerKey` for all analyzer-created skills, but the spec also makes `handlerKey` independently patchable later, without a source-of-truth statement explaining when divergence from `slug` is allowed.
>
> Fix: Add a rule in §5.5 or §10 Phase 0: "For analyzer-created skills, `handlerKey` is permanently set to `slug`; `updateSystemSkill` must reject `handlerKey` changes on rows created by the analyzer." If divergence is allowed, then `unregisteredHandlerSlugs` and the execute gate must be redefined in terms of `handlerKey`, not slug.

### Tentative recommendation (non-authoritative)

§10 Phase 0 currently says `updateSystemSkill`'s `patch` object can include `handlerKey`, and the method throws if the new `handlerKey` is not registered in `SKILL_HANDLERS`. It does not say whether divergence from `slug` is allowed.

**Option A — Immutable after create.** Drop `handlerKey` from the `updateSystemSkill` patch signature entirely. `handlerKey` is set at create time and cannot be changed. The `handlerKey = slug` invariant for analyzer-created rows holds forever. `unregisteredHandlerSlugs` and the execute gate can continue to use `slug` because the two keys are provably identical. Simple, closes the drift door.

**Option B — Immutable only for analyzer-created rows.** `handlerKey` is patchable, but `updateSystemSkill` rejects `handlerKey` changes on rows whose `source = 'analyzer'` (or equivalent provenance marker). Requires a new provenance column on `system_skills` that the spec does not currently define. This is "introduce a new column" which is directional on its own.

**Option C — Fully patchable, redefine gates in terms of handlerKey.** `handlerKey` is freely patchable; `unregisteredHandlerSlugs` becomes "the set of `handlerKey` values on the job's results that are not keys in `SKILL_HANDLERS`"; the execute gate reads `handlerKey` off the candidate rather than deriving it from `slug`. Requires rewriting §7.1, §7.4, §8, and §10 Phase 1 in terms of `handlerKey`.

Option A is dramatically simpler and matches the human's stated framing. But it is a contract narrowing that the human must sign off on.

This finding is **coupled to Finding 6.1**. Resolution order: decide 6.1 first, then 6.3.

### Reasoning

Directional because it changes the interface of `updateSystemSkill` and affects the dispatch-key contract across five sections. I can prepare any of the three resolutions mechanically once the human picks, but I cannot pick — the false-negative cost is a misshapen contract.

### Decision

```
Decision: apply-with-modification
Preferred option 6.3 (A, B, or C): A
Modification (if apply-with-modification): Option A (immutable after create). Drop handlerKey from the updateSystemSkill patch signature entirely. handlerKey is set at create time and cannot be changed. With 6.1 Option A, this preserves the handlerKey = slug invariant forever and allows the existing gates to keep using slug. §10 Phase 0 updateSystemSkill signature is updated to remove handlerKey from the Partial<> type.
Reject reason (if reject): n/a
```

---

## Finding 6.4 — Circular-dependency risk: `SKILL_HANDLERS` imported into `skillAnalyzerService.ts`

**Classification:** ambiguous
**Signal matched (if directional):** Architecture signals — possibly "Introduce a new abstraction" if the resolution is to extract a new file
**Source:** Codex (finding 4, severity: important)
**Spec section:** §10 Phase 1 handler-gate bullet, §7.4 `unregisteredHandlerSlugs` computation

### Codex's finding (verbatim)

> The spec introduces a direct import from `skillAnalyzerService.ts`/route code into `skillExecutor.ts` but never proves that `skillExecutor.ts` is a leaf module, so it leaves a circular-dependency risk unaddressed.
>
> Fix: Replace those imports with a leaf-module contract. Verbatim change: "`SKILL_HANDLERS` is exported from `server/services/skillHandlerRegistry.ts`; `skillExecutor.ts`, `skillAnalyzerService.ts`, and the startup validator all import from that file, and `skillHandlerRegistry.ts` must not import from analyzer services."

### Tentative recommendation (non-authoritative)

I verified today's state: `skillExecutor.ts` does **not** import from `skillAnalyzerService.ts` or `skillAnalyzer*` at all (grep-confirmed). So there is **no actual circular dependency today**. The spec's proposed Phase 1 import of `SKILL_HANDLERS` from `skillExecutor.ts` into `skillAnalyzerService.ts` is a new one-way edge that does not create a cycle.

**Option A — Assert the existing invariant.** Add a sentence to §10 Phase 0: "`skillExecutor.ts` is and must remain a leaf from the perspective of the analyzer subsystem — it must not import from `skillAnalyzerService.ts`, `skillAnalyzerServicePure.ts`, `skillAnalyzerJob.ts`, or `server/routes/skillAnalyzer.ts`. This invariant is preserved today (grep-verified at spec-review time) and must be preserved by the Phase 0 handler-registry refactor." Mechanical in spirit, only adds one paragraph of prose. No new file. **Lowest cost.**

**Option B — Extract `SKILL_HANDLERS` to a new leaf module `server/services/skillHandlerRegistry.ts`.** Per Codex's verbatim suggestion. This introduces a new file the spec did not originally name, which matches the "Architecture signals — introduce a new abstraction" directional signal. It is also more defensive against future churn — someone could later add an import in `skillExecutor.ts` that accidentally creates a cycle, and this extraction makes that impossible. **Higher cost, stronger guarantee.**

**Option C — Hybrid.** Keep `SKILL_HANDLERS` in `skillExecutor.ts` (Phase 0 refactor as written), but add a static-gate script `scripts/verify-skill-executor-leaf.sh` that greps `skillExecutor.ts` for any `from '../services/skillAnalyzer` import and fails if found. Adds a new static gate. Mechanical in spirit — this codebase already uses static gates for this pattern class. **Middle cost.**

### Reasoning

Ambiguous because Option A is mechanical (just prose tightening, no file move), but Options B and C touch the file inventory or add a new gate, which crosses into "introduce a new X" territory. Bias-to-HITL says the human should decide whether prose-only is enough or whether the defensive extraction is worth the churn.

### Decision

```
Decision: apply-with-modification
Preferred option 6.4 (A, B, or C): A
Modification (if apply-with-modification): Option A (assert existing leaf invariant in prose). No actual cycle today (grep-verified at spec-review time). A one-paragraph assertion in §10 Phase 0 states that skillExecutor.ts must remain a leaf from the perspective of the analyzer subsystem — must not import from skillAnalyzerService.ts, skillAnalyzerServicePure.ts, skillAnalyzerJob.ts, or server/routes/skillAnalyzer.ts. Invariant is preserved today and must be preserved by the Phase 0 refactor. No new file, no new static gate.
Reject reason (if reject): n/a
```

---

## Finding 6.7b — Partial-overlap matches against inactive rows with unregistered `handlerKey`

**Classification:** directional
**Signal matched (if directional):** Scope signals — decides what the partial-overlap UI does in an edge case not covered today; affects product behaviour
**Source:** Codex (finding 7, severity: important) — mechanical part already applied, directional residue remains
**Spec section:** §7.1, §10 Phase 0 validator bullet

### Codex's finding (verbatim)

> That invariant [that partial-overlap cards never need the handler warning] is false as written, because the startup validator checks only `isActive = true` rows, while the analyzer compares against all rows via `listSkills()`, including inactive rows that may have unregistered `handlerKey`s.
>
> Fix: Change the sentence to: "A running server implies every active existing row is paired." Then add one of: "The analyzer must exclude inactive matched skills with unregistered `handlerKey`s from partial-overlap approval," or "Partial-overlap cards show the same handler warning when `matchedSkillContent` resolves to an inactive row whose `handlerKey` is unregistered."

### Tentative recommendation (non-authoritative)

Iteration 6 applied Codex's first mechanical suggestion (tighten the §7.1 invariant to "every **active** existing row"). That closed the immediate contradiction with §10 Phase 0. The residue is the product question: **what should the Review UI do when a partial-overlap match resolves to an inactive row whose `handlerKey` is unregistered?**

Three coherent options:

**Option A — Show the handler warning on partial-overlap cards too.** Extend §7.1's handler-status block to partial-overlap cards. Same red warning, same disabled Approve button. Changes §7.1 from "handler warning is New Skill cards only" to "handler warning is any card whose matched handler is unregistered". Consistent UX, slightly more work on the client.

**Option B — Filter inactive-unregistered matches out of the analyzer pipeline.** The Compare stage (§6 Pipeline, stage 4) skips library rows with `isActive = false AND handlerKey NOT IN SKILL_HANDLERS` so they never become a matched row in the first place. Incoming candidates that would have matched an inactive-unregistered row fall through to DISTINCT classification. Preserves §7.1's current "handler warning on New Skill cards only" rule. Trades one edge case for another: an inactive-unregistered row becomes invisible to the analyzer, which may itself be surprising.

**Option C — Server-side rejection at execute time only, no UI change.** The partial-overlap execute path (§8 PARTIAL_OVERLAP branch) adds a `handlerKey NOT IN SKILL_HANDLERS` check in the same position as the existing `matchedSkillId == null` and `proposedMergedContent == null` checks, fails with a clear error, and the reviewer discovers the problem at execute time rather than approve time. Parallel to the Phase 1→4 window for DISTINCT cards, which the iteration-6 Phase 1 scope note now covers explicitly. Cheapest, but the UX is "click Approve, see red error banner".

My guess is Option A is the most consistent with the handler-gate's "show the problem at approve time" design intent, and Option C is the most consistent with the "keep the spec scope small" framing. But both are defensible.

### Reasoning

Directional because it adds a new rule that propagates across §7.1, potentially §6 (pipeline filtering), and §8. Any of the three is coherent; the human picks which matches the project's framing.

### Decision

```
Decision: apply-with-modification
Preferred option 6.7b (A, B, or C): C
Modification (if apply-with-modification): Option C (server-side rejection at execute time, no UI change). The partial-overlap execute path (§8 PARTIAL_OVERLAP branch) adds a handler-key check in the same position as the existing matchedSkillId == null and proposedMergedContent == null checks. If matchedSkillContent's slug is not a key in SKILL_HANDLERS (which can only happen when matching an inactive library row, since the startup validator guarantees every active row is paired), fail with executionError: "matched library skill has no registered handler — this is an inactive row; reactivation requires an engineer to add a handler to SKILL_HANDLERS in server/services/skillExecutor.ts". This mirrors the Phase 1→4 scope note pattern already in the spec.
Reject reason (if reject): n/a
```

---

## Finding 6.10 — Manual-add endpoint wire contract is inconsistent between §7.3 and §10 Phase 4

**Classification:** ambiguous
**Signal matched (if directional):** Architecture signals — "Change the interface of X" (the §7.3 PATCH endpoint)
**Source:** Codex (finding 10, severity: minor)
**Spec section:** §7.3 new `/agents` endpoint, §6.2 manual-add flow, §10 Phase 4

### Codex's finding (verbatim)

> The manual-add primitive is underspecified and internally inconsistent: §7.3 defines one concrete PATCH endpoint, but Phase 4 re-opens whether manual-add uses that endpoint or a different POST.
>
> Fix: Choose one wire contract now. Example verbatim change: "Manual-add uses the existing `PATCH .../agents` endpoint with body `{ systemAgentId, selected: true, addIfMissing: true }`; no sibling POST is introduced."

### Tentative recommendation (non-authoritative)

§7.3 specifies `PATCH .../agents` body as either `{ systemAgentId, selected: boolean }` (toggle an existing proposal) or `{ systemAgentId, remove: true }` (drop a proposal). It does not cover the manual-add case where the reviewer picks a system agent that is not yet in `agentProposals`, triggering a server-side embedding refresh and live similarity computation (§6.2 manual-add flow).

§10 Phase 4 then says: *"Manual-add flow endpoint (integrated into the same PATCH or a sibling POST — architect to decide)"*. That "architect to decide" re-opens a contract §7.3 appeared to close.

**Option A — Lock on the existing PATCH with an `addIfMissing` flag.** Extend §7.3's PATCH body to `{ systemAgentId: uuid, selected?: boolean, remove?: true, addIfMissing?: true }`. When `addIfMissing: true` and the proposal is not in `agentProposals`, the server runs the manual-add flow (refresh embedding, compute live score, insert with `selected: true`, re-sort). When the proposal exists, `addIfMissing` is ignored and `selected` is applied normally. Remove the "architect to decide" from §10 Phase 4. Matches Codex's verbatim suggestion.

**Option B — Add a sibling `POST .../agents` endpoint.** Define a new endpoint `POST /api/system/skill-analyser/jobs/:jobId/results/:resultId/agents` with body `{ systemAgentId: uuid }` for the manual-add case, keep the `PATCH .../agents` endpoint for toggle/remove. Remove the "architect to decide" from §10 Phase 4. Cleaner REST semantics (POST to append, PATCH to modify), one more endpoint.

**Option C — Defer via §11 Open items.** Move the "architect to decide" from §10 Phase 4 to §11 Open items, where the pattern is permitted. Locks nothing, but at least the inconsistency is resolved — §7.3 documents only the toggle/remove contract, and §11 flags manual-add as an open implementation question. Minimal change; least commitment.

Option A is the most mechanical-feeling but adds an unusual flag shape to a PATCH. Option B is cleanest but adds an endpoint. Option C defers — which is defensible but leaves the Phase 4 bullet hand-wavy.

### Reasoning

Ambiguous. The §7.3 contract is genuinely incomplete for the manual-add case, and any of the three resolutions is coherent. Bias-to-HITL — a false auto-apply here locks a wire contract the human may regret.

### Decision

```
Decision: apply-with-modification
Preferred option 6.10 (A, B, or C): A
Modification (if apply-with-modification): Option A (lock on existing PATCH with addIfMissing flag). §7.3 PATCH body is extended to { systemAgentId: uuid, selected?: boolean, remove?: true, addIfMissing?: true }. When addIfMissing=true and the proposal is not in agentProposals, the server runs the manual-add flow (refresh embedding, compute live score, insert with selected=true, re-sort). When the proposal already exists, addIfMissing is ignored and selected is applied normally. Remove the "architect to decide" hand-wave from §10 Phase 4; state clearly that manual-add uses this PATCH endpoint, no sibling POST.
Reject reason (if reject): n/a
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (apply, apply-with-modification, reject, or stop-loop), apply all resolved changes, and continue to iteration 7.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings marked `apply` or `apply-with-modification`.

---

## Note on resolution ordering

Findings 6.1, 6.2, and 6.3 are tightly coupled — they all concern the `handlerKey` contract. Recommended resolution order: decide 6.1 first (validation-only vs dispatch-key posture), then 6.3 (immutability of `handlerKey`), then 6.2 (UNIQUE vs non-unique). 6.4 (circular-dep) is independent. 6.7b (inactive-row UX) is partly downstream of 6.1 — if 6.1 picks Option A, the `handlerKey = slug` invariant means 6.7b reduces to a slug-lookup question. 6.10 (manual-add endpoint) is independent of all the others.

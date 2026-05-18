# ChatGPT Spec Review Session — memory-tiered-consolidation — 2026-05-18T01-22-31Z

## Session Info
- Spec: docs/superpowers/specs/2026-05-18-memory-tiered-consolidation-spec.md
- Branch: memory-tiered-consolidation
- PR: #351 — https://github.com/michaelhazza/automation-v1/pull/351
- Mode: manual
- Started: 2026-05-18T01:22:31Z

---

## Round 1 — 2026-05-18T01-22-31Z

### ChatGPT Feedback (raw)

> Spec is strong, but I see 4 findings before implementation planning.
>
> Blocking
> 1. Phase 3 dependency contradiction: queryIntent.ts says both modified and not modified
>
> §7 says Phase 3 output includes "tierMultipliers on RETRIEVAL_PROFILES", and §18 repeats "queryIntent.ts modification". But §6 Phase 3 and §8 explicitly say server/lib/queryIntent.ts is not modified and multipliers live only in memoryConsolidationConfig.ts.
>
> Fix: remove the Phase 3 / §18 references to modifying queryIntent.ts or adding tierMultipliers to RETRIEVAL_PROFILES.
>
> Should-fix
> 2. Down migration ordering bug
>
> The Phase 1 down migration says:
>
> ALTER TABLE memory_blocks DROP COLUMN ...; DROP INDEX ...
>
> If the index depends on consolidation_tier, dropping the column first may implicitly drop the index or error depending on syntax/execution.
>
> Fix: drop the index first, then drop columns.
>
> 3. Invalid transition reason mismatch
>
> §14.7 says routes approve handler returns 400 on invalid transition, but §9.4 says PromotionVerdict.reason includes invalid_transition for evaluatePromotion, and elsewhere auto path aborts/logs. The behaviours are close, but not consistently framed.
>
> Fix: standardise invalid transition handling:
>
> pure evaluator returns invalid_transition
> job logs/skips
> HTTP approve returns 400
> audit treats any persisted invalid transition as fail
>
> 4. "Flag-OFF byte-identical" is still slightly overclaimed
>
> The spec narrows this to behaviour, not payload, which is good. But Phase 1 still changes retrieve.ts plumbing and emitted event schema even when flag is OFF.
>
> Fix: replace "byte-identical" with:
>
> Flag-OFF retrieval ordering, scoring, selected memory IDs, and prompt inputs are identical to pre-build fixture outputs. Observability payload shape may differ by additive nullable fields.
>
> After those fixes, I'd send it to spec-reviewer.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1 — Phase 3 / §18 references queryIntent.ts modification or tierMultipliers on RETRIEVAL_PROFILES (stale references not swept by earlier spec-reviewer fix) | technical | apply | auto (apply) | high | Genuine internal contradiction. Three sites (§3 Goal 4, §7 Phase 3 row, §18 Goal 4 match line) still claim modification or field-on-profile while §6 Phase 3 + §8 + §9.2 say `queryIntent.ts` unchanged and multipliers live in `MemoryConsolidationConfig.tierMultipliersByProfile`. High severity per `feedback_review_triage.md` rule "auto-apply technical findings (incl. critical/architectural)" — internal-only contradiction with no user-facing surface, default-to-auto-apply confirmed. |
| F2 — Down migration drops column before index | technical | apply | auto (apply) | medium | Real Postgres ordering hazard. Partial index `memory_blocks_consolidation_tier_idx` is defined on `consolidation_tier`; dropping the column first triggers an implicit index drop with non-deterministic ordering vs the explicit later `DROP INDEX IF EXISTS`. Idempotent down migrations should drop dependents first. |
| F3 — invalid_transition handling not consistently framed across the four call sites | technical | apply | auto (apply) | medium | `PromotionVerdict.reason` enum already has `invalid_transition`; §14.7 already names four call sites; but the four behaviours were scattered across §6 Phase 4 prose, §9.4 reason semantics, §14.5 partial-success log, and §14.7 bullets. Consolidating into a single table in §14.7 + matching audit sub-check in §13 Check 2 + new counter in §14.5 makes the single-rule, four-context contract explicit. |
| F4 — "byte-identical" overclaim in §11.4 / §12 G1 / §18 load-bearing claim | technical | apply | auto (apply) | low | Wording precision. Phase 1 plumbing through `retrieve.ts` changes the candidate-shape forwarded to `tryEmitAgentEvent` and the §9.6 event payload gains additive nullable fields — so payload shape is not byte-identical even when flag is OFF. The ChatGPT-recommended wording (ordering / scoring / selected IDs / prompt inputs identical; observability payload may differ by additive nullable fields) is more precise. |

### Applied (auto-applied technical + user-approved user-facing)

- [auto] F1 §3 Goal 4 — rewrote to "Source tier multipliers from `MemoryConsolidationConfig.tierMultipliersByProfile` (single source of truth per §9.2); `server/lib/queryIntent.ts` and its `RETRIEVAL_PROFILES` struct are unchanged."
- [auto] F1 §7 Phase 3 row — rewrote to "Versioned `memoryConsolidationConfig.ts` with `tierMultipliersByProfile` (sole source of truth per §9.2; `queryIntent.ts` unchanged) + post-fusion multiplier in `hybridRetrieval.ts` + config-version recording on retrieval traces"
- [auto] F1 §18 Goal 4 match line — rewrote to "`memoryConsolidationConfig.ts` `tierMultipliersByProfile` (sole source of truth per §9.2; `queryIntent.ts` unchanged per §8) + post-fusion lookup in `hybridRetrieval.ts` + retrieval-trace config-version recording"
- [auto] F2 §8 schema-files table — reordered down migration to "`DROP INDEX IF EXISTS memory_blocks_consolidation_tier_idx;` then `ALTER TABLE memory_blocks DROP COLUMN IF EXISTS consolidation_tier, DROP COLUMN IF EXISTS last_accessed_at;`" with rationale comment
- [auto] F3 §14.7 — replaced the bullet list with a single canonical table of four call sites × four behaviours (pure evaluator returns reason, auto job aborts+logs, HTTP returns 400, audit treats persisted invalid as fail) with framing prose that calls out "one rule, four contexts"
- [auto] F3 §13 Check 2 — added new "Persisted-invalid-transition sub-check" that evaluates `isValidPromotionTransition(old_tier_at_capture, tier_at_capture)` against every promotion-version row in the audit window; any false → `fail` with block id and version id in evidence; evidence list extended
- [auto] F3 §14.5 — added new counter `invalid_transition_skipped` to the per-cycle terminal log line `memory.consolidation.promotion_job.completed`
- [auto] F4 §12 G1 — replaced "byte-identical" claim with "Flag-OFF retrieval ordering, scoring, selected memory IDs, and prompt inputs derived from retrieval are identical to pre-build fixture outputs. ... observability payload shape may therefore differ by additive nullable fields, but the behavioural surface ... does not."
- [auto] F4 §11.4 spec-conformance verification — replaced "byte-identical" wording with the more precise four-axes wording; explicitly notes payload shape is NOT byte-identical
- [auto] F4 §18 load-bearing claims line — replaced the byte-identical bullet text with the four-axes phrasing

### Integrity check

Integrity check: 0 new issues found this round (auto: 0, escalated: 0). Cross-grepped `queryIntent.ts`, `tierMultipliers on RETRIEVAL_PROFILES`, `tierMultipliers field`, and `invalid_transition` — all surviving references are consistent with the new single-rule, four-context framing. The §14.5 counter list addition makes the new `invalid_transition_skipped` counter referenced in the §14.7 table a valid forward reference. The §13 Check 2 "Persisted-invalid-transition sub-check" cross-reference to §14.7 audit row is forward-then-backward consistent.

---

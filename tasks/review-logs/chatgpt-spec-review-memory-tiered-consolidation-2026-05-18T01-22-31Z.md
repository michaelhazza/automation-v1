# ChatGPT Spec Review Session — memory-tiered-consolidation — 2026-05-18T01-22-31Z

## Session Info
- Spec: docs/superpowers/specs/2026-05-18-memory-tiered-consolidation-spec.md
- Branch: memory-tiered-consolidation
- PR: #351 — https://github.com/michaelhazza/automation-v1/pull/351
- Mode: manual
- Started: 2026-05-18T01:22:31Z
- **Verdict:** APPROVED_AFTER_FIXES (2 rounds)

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

## Round 2 — 2026-05-18T02-15-00Z

### ChatGPT Feedback (raw)

> Yes. 2 more should-fix items, both consistency issues, not architecture blockers.
>
> 🟡 1. Phase 4 line says "abort transaction" for invalid transition, but §14.7 says log + skip
>
> In Phase 4 auto-promotion step 1, it still says invalid transition should "abort the transaction." Later §14.7 standardises this as: evaluator returns reason, auto job logs/skips, HTTP returns 400, audit fails persisted invalid rows.
>
> Fix: Change Phase 4 step 1 to "skip this candidate, log promotion.invalid_transition.skipped, and do not open/write the promotion transaction."
>
> 🟡 2. G2 observability list omits lastAccessedAtAtRetrieval
>
> G2 item 1 lists the memory.retrieved extension fields but omits lastAccessedAtAtRetrieval, while §9.6 includes it and audit Check 4 depends on it.
>
> Fix: Add lastAccessedAtAtRetrieval to G2 item 1.
>
> After those, I'd call the spec clean for spec-reviewer.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1 — §6 Phase 4 step 1 said "abort the transaction" — implies the transaction was opened. §14.7 row 2 had matching "Aborts the transaction" wording. Both contradicted the intended "skip; do not open/write the promotion transaction" semantics. | technical | apply | auto (apply) | medium | Real one-voice drift. Fix updates both §6 Phase 4 step 1 AND §14.7 row 2 so the four-call-site rule (evaluator returns reason / auto job skips without opening txn / HTTP returns 400 / audit fails persisted invalid) is consistent across every spec site. Phase 4 step 2 race-loss "abort the transaction" wording is intentionally left untouched — that path has already opened the txn. |
| F2 — §12 G2 item 1 listed 4 of 5 §9.6 fields; `lastAccessedAtAtRetrieval` was missing despite being present in §9.6 contract, §8 file-inventory plumbing row, §11.4 flag-off-behaviour line, and audit Check 4 evidence dependency. | technical | apply | auto (apply) | low | Single-site omission. Adds the missing field plus a short note pointing back to audit Check 4 so the dependency is explicit in the G2 contract. |

### Applied (auto-applied technical + user-approved user-facing)

- [auto] F1 §6 Phase 4 step 1 — rewrote to "if false: skip this candidate, log `promotion.invalid_transition.skipped` with `{ blockId, oldTier, newTier, configVersion }`, and do NOT open or write the promotion transaction. Increment the per-cycle `invalid_transition_skipped` counter per §14.5."
- [auto] F1 §14.7 row 2 (`memoryConsolidationPromotionDispatcher.ts` row) — replaced "Aborts the transaction;" lede with "Skips this candidate and does NOT open or write the promotion transaction;" so the table row matches the new Phase 4 wording.
- [auto] F2 §12 G2 item 1 — added `lastAccessedAtAtRetrieval` to the listed fields and added parenthetical "(full set per §9.6; audit Check 4 depends on `lastAccessedAtAtRetrieval` to recompute decay against trace-time state)".

### Integrity check

Integrity check: 0 new issues found this round (auto: 0, escalated: 0). Cross-grepped `abort.{0,30}transaction.*invalid` — no surviving stale references. Cross-grepped the five `memory.retrieved` field list across §8 plumbing (line 132), §8 schema-files row (line 306), §8 retrieve.ts row (line 322), §11.4 flag-off invariant (line 758), §12 G2 item 1 (line 766), §9.6 contract (lines 600-604) — all six call sites now name the same five fields. §14.7 four-call-site rule remains internally consistent: pure evaluator returns reason / auto job skips without opening txn / HTTP returns 400 / audit treats persisted invalid as fail.

---

## Final Summary

- Rounds: 2
- Auto-accepted (technical): 6 applied | 0 rejected | 0 deferred
- User-decided: 0 applied | 0 rejected | 0 deferred
- Index write failures: 0
- Deferred to tasks/todo.md § Spec Review deferred items / memory-tiered-consolidation: none
- KNOWLEDGE.md updated: no — both rounds were spec-internal consistency cleanup; no new reusable rule surfaced that isn't already covered by feedback_review_triage.md
- architecture.md updated: n/a — no architectural pattern changed
- capabilities.md updated: n/a — capability registration handled at finalisation by finalisation-coordinator, not by spec review
- integration-reference.md updated: n/a — no integration surface touched
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated: n/a — no policy change
- spec-context.md updated: n/a — no spec-authoring convention change
- frontend-design-principles.md updated: n/a — no UI surface
- doc-sync.md sweep: n/a for all rows in this session (scope: spec-internal consistency; no cross-doc fanout)
- Implementation readiness checklist: PASS (inputs defined; outputs defined; failure modes covered including the one-rule-four-contexts invalid-transition contract; ordering guarantees explicit in §14.7 and §14.4; no unresolved forward references)
- PR: #351 — spec changes ready at https://github.com/michaelhazza/automation-v1/pull/351

# Spec Review HITL Checkpoint — Iteration 1

**Spec:** `tasks/llm-observability-ledger-generalisation-spec.md`
**Spec commit:** untracked (HEAD `d469871`)
**Spec-context commit:** `d469871`
**Iteration:** 1 of 5
**Timestamp:** 2026-04-20T05:43:19Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 2 until every finding below is resolved. Resolve by editing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

---

## Summary

| # | Finding | Question | Recommendation | Why |
|---|---------|----------|----------------|-----|
| 1.1 | A1 falsified by 4th direct-adapter site | Migrate `server/services/skillAnalyzerService.ts:2063` in this spec, or narrow A1 to the three jobs-file sites? | **Expand P3** — migrate all four sites | Four sites in two files is still one subsystem; widening P3 tightens A1 without a scope blow-up |
| 1.2 | `By Source Type` tab: 5 rows or 4? | Render `analyzer` as its own row or fold into `system`? | **Own row (5 total)** | Schema already splits them; rolling up for display hides analyzer spend behind a single System line |
| 1.3 | Adapter parity: 2 of 4 or all 4? | Do AbortController / 499 / parse-failure changes land on gemini + openrouter too? | **All 4 adapters** | §1.1 says "universal observability"; leaving 2 adapters out weakens the gate and the claim |

---

## Finding 1.1 — A1 falsified by `skillAnalyzerService.ts:2063`

**Classification:** ambiguous (scope/sequencing — matches **Scope signals: "Add this item to the roadmap"**)
**Source:** Codex (finding #1, severity critical)
**Spec section:** §1.2 A1, §9.2, §15.3 (P3), §17 (last bullet)

### Finding (verbatim)

> 1. `A1 cannot pass under the spec's own scope`
> Sections: §1.2 "A1 — No dark LLM calls", §9.2 "Known hits", §15.3 "P3 — Skill-analyzer migration", §17 "Deferred items".
> Description: The spec says P3 makes A1 verifiable, but the repo still has a direct adapter call in `server/services/skillAnalyzerService.ts:2063` in addition to `server/jobs/skillAnalyzerJob.ts:768,1321,1459`. §17 also defers remaining non-analyzer callers to a follow-up spec, which makes the "final tree has no direct adapter callers" assertion impossible.
> Suggested fix: Add `server/services/skillAnalyzerService.ts` to §9/§14 and migrate it in this spec, or narrow A1/P3 to only the three `skillAnalyzerJob.ts` sites and leave the gate whitelisted until every confirmed caller is migrated.

### Recommendation

Expand P3 to migrate **all four** direct-adapter sites:

- `server/jobs/skillAnalyzerJob.ts:768` — classify call
- `server/jobs/skillAnalyzerJob.ts:1321` — Haiku agent-match
- `server/jobs/skillAnalyzerJob.ts:1459` — Sonnet cluster-recommend
- `server/services/skillAnalyzerService.ts:2063` — newly identified

Concrete edits:

- §9.2 "Known hits" — add the 4th row.
- §10 — add a new §10.4 describing the migration of the service-layer site in the same pattern as §10.1–§10.3.
- §14.3 — add `server/services/skillAnalyzerService.ts` with the change description "Replace direct `anthropicAdapter.call()` at :2063 with `llmRouter.routeCall()`".
- §15.3 P3 — update the services-modified list.
- §17 last bullet — clarify "non-analyzer" wording so readers don't confuse `skillAnalyzerService.ts` with out-of-scope callers like workspace-memory.

### Why

A1 is the keystone static-gate guarantee of the entire spec. Landing P3 with one of four analyzer-subsystem sites still dark means the gate either whitelists `skillAnalyzerService.ts` indefinitely or A1 is technically false. Expanding to 4 sites is cheap (migration pattern per §9.3 is mechanical) and keeps the analyzer subsystem fully covered in one phase. Narrowing A1 preserves the phase boundary but leaves a permanent asterisk on the assertion.

### Classification reasoning

This is a scope decision the author owns — widening a phase's work is directional.

### Decision

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## Finding 1.2 — `By Source Type` tab: analyzer row treatment

**Classification:** ambiguous (UI/taxonomy — matches **Architecture signals** at the presentation layer)
**Source:** Codex (finding #13, severity important)
**Spec section:** §6.1 sourceType additions, §11.2 `getBySourceType`, §11.5 columns, §19.5 `SourceTypeRow`

### Finding (verbatim)

> 13. `Source-type taxonomy drifts between analyzer and system`
> Sections: §6.1 sourceType additions, §11.2 `getBySourceType`, §19.5 `SourceTypeRow`.
> Description: The spec introduces `sourceType='analyzer'` as a distinct value, but §11.2 describes "4 rows (agent_run / process_execution / iee / system + analyzer)", and the §19.5 system-row example labels `system` as "Analyzers · memory compile · orchestration". The UI grouping and taxonomy are not aligned.
> Suggested fix: Decide whether analyzer is its own row or folded into system, then align §6, §11, and §19 to one rule.

### Recommendation

**Render `analyzer` as its own row on the `By Source Type` tab — 5 rows total.**

Concrete edits:

- §11.2 `getBySourceType` — change docstring to "5 rows (agent_run / process_execution / iee / system / analyzer)".
- §19.5 — update the `system` row's description from `"Analyzers · memory compile · orchestration"` to `"Memory compile · orchestration · miscellaneous system work"` (drop "Analyzers"), add a separate worked example for the `analyzer` row.
- `prototypes/system-costs-page.html` — update the "By Source Type" tab mockup to show 5 rows.

### Why

The schema-level split (adding `'analyzer'` in §6.1) is load-bearing for attribution, idempotency-key composition, and budget bypass. If the P&L page folds analyzer back into a single "System" line, the operator loses the ability to see analyzer spend at a glance — the observability goal stated in §2.1. Rendering as a separate row is the cheap, consistent move: the schema already distinguishes them, one extra row on one tab, and `system` becomes an honest label (memory-compile + orchestration + catch-all).

### Classification reasoning

The UI presentation affects the caller-facing artifact (`prototypes/system-costs-page.html`), which the caller declared part of the spec surface. Product-direction choice the reviewer should not make unilaterally.

### Decision

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## Finding 1.3 — Adapter parity across 2 vs 4 providers

**Classification:** ambiguous (coverage/scope — cross-cutting scope expansion)
**Source:** Codex (finding #14, severity important)
**Spec section:** §1.1 (point 2), §8.4, §9.1 grep, §9.4 static gate

### Finding (verbatim)

> 14. `Adapter parity and the gate ignore two registered providers`
> Sections: §1.1, §8.4, §9.1, §9.4.
> Description: The repo registers `anthropic`, `openai`, `gemini`, and `openrouter` in `server/services/providers/registry.ts`, but the parity work and the no-direct-import gate only cover `anthropicAdapter` and `openaiAdapter`. That conflicts with the spec's "universal" observability claim.
> Suggested fix: Expand the adapter and gate language to every registered provider adapter, or narrow the universal claim to the two adapters this phase actually updates.

### Recommendation

**Expand parity work and the gate to cover all four adapters.** Confirmed adapter files:

- `server/services/providers/anthropicAdapter.ts`
- `server/services/providers/openaiAdapter.ts`
- `server/services/providers/geminiAdapter.ts`
- `server/services/providers/openrouterAdapter.ts`

Concrete edits:

- §8.4 — rewrite to cover all four adapters. If any adapter has no separate error-mapping seam today, add one as part of P1.
- §9.1 and §9.4 — extend the grep patterns / gate patterns to include `geminiAdapter` and `openrouterAdapter`; whitelist unchanged (`llmRouter.ts` + `providers/*.ts` + `*.test.ts`).
- §14.3 — add rows for `geminiAdapter.ts` and `openrouterAdapter.ts`.
- §15.1 P1 — update "Services modified" to list all four adapters.

### Why

§1.1 opens with "universal, P&L-grade record of every LLM call." Two adapters covered and two not is incompatible with that framing. The gate at §9.4 is the only mechanism preventing regression — if gemini and openrouter aren't gated, a future consumer can silently route through them without a ledger row. Marginal cost per adapter is ~20 LoC of the same mechanical pattern.

### Classification reasoning

Cross-cutting coverage decision affecting gate scope, §8 ambition, and P1 work estimate. Both options legitimate; §1.1's "universal observability" language strongly implies all four but the spec stopped at two.

### Decision

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint, honour each decision, and continue to iteration 2.

If you want to stop the loop entirely, set any decision to `stop-loop` and the loop exits after honouring already-resolved `apply` / `apply-with-modification` decisions.

---

## Mechanical findings being applied this iteration (for reference)

The following 14 findings are being auto-applied in parallel with this checkpoint. Detail available in `tasks/spec-review-log-llm-observability-1-20260420T054319Z.md`.

- **C2** — P&L page data source per endpoint corrected (`cost_aggregates` vs `llm_requests`).
- **C3** — `AbortSignal.reason` threaded through adapter + router to preserve `caller_cancel` vs `caller_timeout`.
- **C4** — §6.1 CHECK constraint tightened to match §5.1 truth table.
- **C5** — §19.1 contract corrected: `sourceId` nullability on `system` rows aligned with §5.1.
- **C6** — `budgetService.checkAndReserve()` documented as `string | null`; §5.4 prose aligned with §7.2.
- **C7** — "contract test" wording replaced with manual-verification in §1.2 A3/A4.
- **C8** — §14 paths corrected: drop `server/routes/index.ts` (doesn't exist), drop `server/jobs/index.ts` (doesn't exist), add `shared/types/systemPnl.ts` to inventory as a new file, correct `withAdminConnection` path.
- **C9** — retention-job SQL rewritten to valid Postgres (ID-subquery pattern); migration 0184 dropped.
- **C10** — §6.6 `NOT VALID`/`VALIDATE` hedge removed; migration asserts immediate validation.
- **C11** — §4.3 extension language removed; new router in `systemPnl.ts` only.
- **C12** — `logger.ts` file-transport and MCP-non-LLM removed from §17 (remain in §3.2 as rejected).
- **C15** — §19.2 examples corrected: idempotency-key format + client_disconnected status match §6.4/§6.5.
- **R1** — `sourceType` column default `'agent_run'` dropped in migration 0180 so callers must specify explicitly.
- **R2** — margin-multiplier mechanism added: router sets `marginMultiplier = 1.0` for `sourceType ∈ {'system', 'analyzer'}`.

# Spec Review Log — llm-observability-ledger-generalisation — Iteration 2

**Spec:** `tasks/llm-observability-ledger-generalisation-spec.md`
**Spec-context commit:** `d469871` (unchanged since iteration 1)
**Codex output:** `tasks/_spec-review-llmobs-iter2-codex-output.txt`
**Codex prompt:** `tasks/_spec-review-llmobs-iter2-prompt.txt`
**Timestamp:** 2026-04-20T06:00:00Z

## HITL decisions honoured from iteration 1

| Finding | Decision | Applied |
|---|---|---|
| 1.1 — A1 falsified by `skillAnalyzerService.ts:2063` | apply | Yes — §9.2 row added; new §10.4 for service-layer migration; §10.5 verification list expanded; §14.3/§14.5 inventory updated; §15.3 P3 expanded; §17 non-analyzer clarified |
| 1.2 — By Source Type analyzer row | apply | Yes — §11.2 docstring updated to "5 rows"; §19.5 expanded with both examples; §11.5 overhead row treatment covers both; `prototypes/system-costs-page.html` updated (new analyzer row, KPI caption, other tab captions, tab-status string) |
| 1.3 — Adapter parity across 4 providers | apply | Yes — §8 intro rewrites to cover 4 adapters; §8.4 parity matrix; §8.5 "existing two" language dropped; §9.1 grep expanded; §9.4 gate covers 4 adapters with extensible array; §14.3 lists 4 adapters; §15.1 P1 services-modified lists 4 adapters |

## Iteration 2 findings classified

| ID | Label | Class | Disposition |
|----|-------|-------|-------------|
| C2.1 | Four-provider scope still described as two-provider in §1.2/§3.1/§4.2/§8 TOC/§8.5/§16.1 | Mechanical | Apply |
| C2.2 | Analyzer `sourceId` ambiguous — §10.4 drifts from §6.3 invariant | Mechanical | Apply |
| C2.3 | Overhead row behavior conflicts across prose, contracts, mockup | Mechanical | Apply |
| C2.4 | Top-calls ranking defined "by revenue" but mockup includes system rows | Ambiguous | HITL |
| C2.5 | `DailyTrendRow` used but never contracted | Mechanical | Apply |
| C2.6 | Mockup internally inconsistent (tab-status "4 source types", tab-total drifts) | Mechanical (partial) | Apply partial (tab-status only) |
| C2.7 | Authoritative UI controls (Refresh, Export CSV, View all, footer links, 60s auto-refresh) have no contract | Ambiguous | HITL |
| C2.8 | "Zero rows today" for sourceType='system' factually wrong; "no behavioural changes" in P1 stale | Mechanical | Apply |

## Counts

- Mechanical to apply: 6 (one partial)
- Ambiguous → HITL: 2 (C2.4, C2.7)
- Directional: 0
- Rejected: 0

## Mechanical edits applied

- **C2.1** — §1.2 A1 wording widened to "any registered provider adapter" listing all four and noting registry drives the set; §3.1 point 2 widened to all four adapters with §8.4 pointer; §4.2 Services audit row widened; §8 TOC entry renamed to "Adapter parity across every registered provider (anthropic / openai / gemini / openrouter)"; §8.5 "existing two" replaced with "four adapters already registered in providers/registry.ts"; §16.1 gate description widened.
- **C2.2** — §10.4 service-layer migration now requires `sourceId = skill_analyzer_jobs.id` with a note that the job id must be threaded through from the job that invokes the service (every call path into `skillAnalyzerService.ts:2063` originates in a `skillAnalyzerJob.ts` run). Drops the previous "subaccountId or analyzer operation id" waffle which contradicted §6.3.
- **C2.3** — §11.5 rewritten with a per-tab matrix that aligns prose to `prototypes/system-costs-page.html`: overhead row appears only on By Organisation (synthetic aggregated) and By Source Type (split system + analyzer). Subaccount and Provider/Model tabs explicitly render no overhead row. Added `OverheadRow` contract in §19.4; widened `getByOrganisation()` return shape in §11.2 to `{ orgs: OrgRow[]; overhead: OverheadRow }`; `/by-organisation` endpoint shape updated in §11.3; `shared/types/systemPnl.ts` list updated in §14.3.
- **C2.5** — new §19.5a `DailyTrendRow` contract added with field definitions, nullability, ordering, and chart-series meanings. `overheadCents` field documented; shared-types list in §14.3 already includes `DailyTrendRow`.
- **C2.6** — `prototypes/system-costs-page.html` line 1156 tab-status updated from `4 source types · system row pulled out as pure overhead` to `5 source types · system and analyzer pulled out as pure overhead`. Broader tab-total cross-consistency (KPI total vs By Source Type total vs By Provider total demo data differing) is narrower than iteration 1's scope; leaving pre-existing demo-data drift alone — a prototype is illustrative, not numerical truth. (If the user wants a full reconciliation pass, that is a separate mockup-update task.)
- **C2.8** — §2.4 rewritten to acknowledge existing `sourceType='system'` callers (`workspaceMemoryService`, `agentBriefingService`, `skillEmbeddingService`, `outcomeLearningService`, `skillExecutor`) and reframe P3's change as adding an `analyzer` sibling taxonomy rather than filling a previously-empty column. §15.1 P1 goal updated to acknowledge the margin-multiplier behaviour change for `sourceType ∈ {'system','analyzer'}` rows introduced by §7.4. §15.4 P4 data-readiness paragraph rewritten to drop the "$0 overhead" / "strategically hollow" framing.

## HITL findings (full text in iteration 2 checkpoint)

- **C2.4** — Top-calls ranking semantic: "by revenue" is the stated title but the mockup shows system/analyzer rows with em-dash revenue. Two legitimate resolutions that represent different product narratives (exclude non-billable vs rename to cost/profit-based).
- **C2.7** — Unimplemented-looking UI controls in mockup (Refresh, Export CSV, View all, footer links, "updated every 60 seconds" auto-refresh). Decision between "mark decorative/remove" and "spec real behaviour" is a feature-scope call.

Checkpoint file: `tasks/spec-review-checkpoint-llm-observability-2-20260420T060000Z.md`

## Iteration 2 Summary

- Mechanical findings accepted: 6
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 2 (C2.4, C2.7 — sent to HITL)
- Reclassified → directional: 0
- HITL checkpoint path: `tasks/spec-review-checkpoint-llm-observability-2-20260420T060000Z.md`
- HITL status: pending
- Spec commit after iteration: untracked (edits applied in-place on the working copy)

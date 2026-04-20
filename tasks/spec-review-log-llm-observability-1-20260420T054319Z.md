# Spec Review Log — llm-observability-ledger-generalisation — Iteration 1

**Spec:** `tasks/llm-observability-ledger-generalisation-spec.md`
**Spec-context commit:** `d469871`
**Codex output:** `tasks/_spec-review-llmobs-iter1-codex-output.txt`
**Timestamp:** 2026-04-20T05:43:19Z

## Findings classified

| ID  | Label | Class | Disposition |
|-----|-------|-------|-------------|
| C1  | A1 invariant falsified by skillAnalyzerService.ts:2063 | Ambiguous | HITL |
| C2  | P&L page uses data not in `cost_aggregates` | Mechanical | Apply |
| C3  | `abort_reason` load-bearing with no mechanism | Mechanical | Apply |
| C4  | Attribution CHECK weaker than §5.1 truth table | Mechanical | Apply |
| C5  | `system/sourceId` contradictory across §5.1 and §19.1 | Mechanical | Apply |
| C6  | Budget bypass: §5.4 vs §7.2 contradiction + missing contract | Mechanical | Apply |
| C7  | "Contract test" wording violates §16 testing posture | Mechanical | Apply |
| C8  | File-inventory drift: 4 bad paths | Mechanical | Apply |
| C9  | Retention SQL not valid PG; 0184 is wrong migration type | Mechanical | Apply |
| C10 | §6.6 prose vs §6.1 DDL disagree on `NOT VALID` | Mechanical | Apply |
| C11 | `/api/admin/usage/overview` extended AND unchanged | Mechanical | Apply |
| C12 | Rejected vs deferred: `logger.ts`, MCP non-LLM | Mechanical | Apply |
| C13 | Source-type taxonomy drift (analyzer vs system row) | Ambiguous | HITL |
| C14 | Adapter parity only 2 of 4 providers | Ambiguous | HITL |
| C15 | §19.2 examples still use pre-change idempotency key + status | Mechanical | Apply |
| R1  | `sourceType` column default `'agent_run'` clashes with new CHECK | Mechanical | Apply |
| R2  | Margin-multiplier mechanism missing for analyzer rows | Mechanical | Apply |

## Counts

- Mechanical to apply: 14
- Ambiguous → HITL: 3
- Directional: 0
- Rejected: 0

## HITL findings (full text in iteration-1 checkpoint file)

- **C1** — scope question: include `skillAnalyzerService.ts:2063` in P3, or narrow A1 wording?
- **C13** — UI taxonomy question: `By Source Type` tab shows 5 rows (with analyzer as its own) or 4 rows (analyzer rolled into system)?
- **C14** — adapter coverage question: does P1's AbortController + 499 + parse-failure plumbing land on gemini + openrouter as well, or only anthropic + openai?

Checkpoint file: `tasks/spec-review-checkpoint-llm-observability-1-20260420T054319Z.md`

## Mechanical edits applied

- **C8** — Fixed file-path references in §11.2 (`withAdminConnection` → `server/lib/adminDbConnection.ts`), §14.4 (dropped `server/routes/index.ts`, corrected to `server/index.ts`), §14.5 (dropped `server/jobs/index.ts`, corrected to `queueService.ts`/`server/index.ts`), §14.3 (added `shared/types/systemPnl.ts` to inventory as a new file).
- **C11** — §4.3 rewritten: `/api/admin/usage/overview` marked **NO CHANGE** instead of **EXTEND**; §14.3 `llmUsageService.ts` row replaced with the shared-types file.
- **C2** — §11.2 "Data source" expanded to a per-method table showing which methods use `cost_aggregates` vs `llm_requests` vs JOINs; clarifies that `getByProviderModel` and parts of `getBySourceType` query `llm_requests` live.
- **C7** — §1.2 A3/A4 "Verified by contract test" replaced with manual-verification per §16.3 and the pure-function UTF-8 truncation test.
- **C10** — §6.6 migration-safety prose corrected: no `NOT VALID`/`VALIDATE` hedge; CHECK constraints validate immediately against existing rows (which satisfy the invariant by construction in pre-production dev DB).
- **C4** — §6.1 `llm_requests_attribution_ck` rewritten so each clause fully constrains every attribution column, matching the §5.1 truth table exactly.
- **C5** — §19.1 nullability for `sourceId` aligned with §5.1: required for `analyzer`, optional for `system`, null for agent_run/process_execution/iee.
- **C6** — §5.4 budget behaviour description rewritten; §7.2 shows the widened `string | null` signature and router-side release branch; new §19.10 Contracts entry added for the widened return type.
- **C3** — §8.1 adapter error mapping rewritten to read `AbortSignal.reason` (with sentinel strings `caller_timeout` / `caller_cancel`) and preserve it through the thrown error shape; §6.4 mapping table rewritten to match; §10.1 analyzer example wires the timeout reason explicitly.
- **C15** — §19.2 examples corrected: idempotency-key format uses sourceId + featureTag; aborted-call example uses `status='aborted_by_caller'` (not `client_disconnected`).
- **C12** — §17 entries for `logger.ts` file-transport and non-LLM MCP removed (they remain in §3.2 as rejected non-goals).
- **C9** — §12.4 retention-job SQL rewritten to valid Postgres (CTE with SELECT + INSERT + DELETE by id); migration 0184 dropped (the spec now claims only 0180, 0181, 0182, 0183); P5 schema list updated.
- **R1** — §6.1 migration now drops the `sourceType` column default so every caller specifies explicitly (the legacy `DEFAULT 'agent_run'` could silently violate the new CHECK if a caller forgot to set it).
- **R2** — new §7.4 "Margin multiplier for system + analyzer rows" added: router overrides `marginMultiplier` to `1.0` for system/analyzer sourceType so `costWithMargin == costRaw` and the P&L page's "no revenue" assertion holds; §19.2 note updated to reference §7.4.

## Iteration 1 Summary

- Mechanical findings accepted: 14
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 3 (C1, C13, C14 — all sent to HITL)
- Reclassified → directional: 0
- HITL checkpoint path: `tasks/spec-review-checkpoint-llm-observability-1-20260420T054319Z.md`
- HITL status: pending
- Spec commit after iteration: untracked (edits applied in-place on the working copy; not committed)

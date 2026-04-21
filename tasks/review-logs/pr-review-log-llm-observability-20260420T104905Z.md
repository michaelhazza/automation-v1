# PR Review Log — LLM Observability & Ledger Generalisation
## Branch: claude/build-llm-observability-ledger-iiTcC
## Commit range: fb23ae2^..HEAD (P1–P5 + docs + 6-gap fix)
## Reviewer: pr-reviewer (Claude Sonnet 4.6)
## Timestamp: 2026-04-20T10:49:05Z (persisted)

### Files reviewed
- server/services/llmRouter.ts
- server/services/providers/{anthropicAdapter.ts,openaiAdapter.ts,geminiAdapter.ts,openrouterAdapter.ts,adapterErrors.ts,callerAssert.ts,types.ts}
- server/services/systemPnlService.ts + systemPnlServicePure.ts
- server/routes/systemPnl.ts
- server/jobs/llmLedgerArchiveJob.ts + llmLedgerArchiveJobPure.ts
- shared/types/systemPnl.ts
- client/src/pages/SystemPnlPage.tsx
- scripts/verify-no-direct-adapter-calls.sh
- migrations/0185_llm_requests_generalisation.sql, 0186_cost_aggregates_source_type_dimension.sql, 0187_llm_requests_new_status_values.sql, 0188_llm_requests_archive.sql
- server/services/skillAnalyzerService.ts (P3 migration)
- server/jobs/skillAnalyzerJob.ts (P3 migration)
- server/services/queueService.ts (new job registration)

## Sections

1. Blocking Issues (B1–B6)
2. Strong Recommendations (S1–S7)
3. Non-Blocking Improvements (N1–N6)
4. Verdict

---

## 1. Blocking Issues

### B1 — Archive atomicity silent loss when ON CONFLICT fires
**File:** server/jobs/llmLedgerArchiveJob.ts, line 99 / line 103
**Severity:** P0 — correctness / financial audit integrity

CTE chain:

```
inserted  → INSERT … ON CONFLICT (idempotency_key) DO NOTHING  RETURNING id
DELETE    → WHERE id IN (SELECT id FROM inserted)
```

`ON CONFLICT DO NOTHING` means a row that already exists in the archive silently drops from `inserted`. Because the DELETE only fires for `id IN (SELECT id FROM inserted)`, the source row stays in `llm_requests` forever. On the next nightly run the same row re-enters `doomed`, re-fails the conflict, stays put again, and the live table never shrinks.

**Fix:** Change conflict target to `ON CONFLICT (id) DO NOTHING` (archive PK). DELETE should join against `doomed` rather than `inserted`:

```sql
DELETE FROM llm_requests WHERE id IN (SELECT id FROM doomed)
```

### B2 — Withdrawn
Gross-profit math was initially flagged as double-counting overhead. On re-examination the formula `revenue − total_cost + overhead = revenue − billable_cost` is correct. Variable naming is confusing but math is sound.

### B3 — `getTopCalls` leaks error/failed rows into the top-cost ranking
**File:** server/services/systemPnlService.ts, lines 537–538
**Severity:** P1 — correctness

No status filter. Budget-blocked, error, parse-failure, and aborted rows compete in the top-N ranking. A `client_disconnected` row with non-zero partial cost could appear in the "Top calls by cost" table misleadingly.

**Fix:** Add `AND r.status IN ('success', 'partial')` consistent with every other query in the file.

### B4 — `month` query parameter unsanitised
**File:** server/routes/systemPnl.ts, lines 39, 50, 62, 74, 85, 107
**Severity:** P1 — correctness

No injection risk (Drizzle parameterises), but no format validation. `month=notamonth` or `month=2026-99` silently returns empty result sets. `previousMonth()` applies `split('-').map(Number)` → NaN → invalid Date → invalid period key.

**Fix:** Add a regex guard at the top of each handler:
```ts
if (!/^\d{4}-\d{2}$/.test(month)) {
  res.status(400).json({ statusCode: 400, message: 'month must be in YYYY-MM format' });
  return;
}
```

### B5 — `platformTotals` does not include archived rows
**File:** server/services/systemPnlService.ts, lines 97–116
**Severity:** P1 — correctness

`platformTotals`, `getByOrganisation`, `getBySubaccount`, `getBySourceType`, `getByProviderModel`, and `getDailyTrend` query only `llm_requests`. `getCallDetail` correctly UNIONs the archive. Queries crossing the retention boundary silently underreport.

**Fix (target):** UNION ALL the two tables in every query (or a `llm_requests_all` view). `getCallDetail` already proves the pattern.

### B6 — legacy `callAnthropic` still exported — not caught by static gate
**File:** server/services/llmService.ts, line 210 + 384
**Severity:** P1 — router discipline / spec assertion A1

Gate scans for `*Adapter` imports / calls. `llmService.callAnthropic` is the pre-router wrapper that calls `anthropicAdapter` internally — anything that imports it bypasses the ledger and is invisible to the gate.

**Fix:** Delete `callAnthropic` (if no callers) or mark `@deprecated` + add it to the gate pattern list.

---

## 2. Strong Recommendations

### S1 — N+1 query in `getByOrganisation` sparkline loop
**File:** server/services/systemPnlService.ts, lines 234–256
**Severity:** P2

One SQL query per organisation in sequence. 50 orgs → 50 queries. Comment defers to §17 — should be fixed now.

**Fix:** Batch using `entity_id = ANY($1::text[])` + group in app code.

### S2 — `getTopCalls` missing `top-calls-section` anchor id
**File:** client/src/pages/SystemPnlPage.tsx, lines 125, 221
**Severity:** P2 — UX

`getElementById('top-calls-section')` returns null; scroll silently no-ops.

**Fix:** Add `id="top-calls-section"` to the containing `<div>` at line 221.

### S3 — `SystemPnlPage` has no error state
**File:** client/src/pages/SystemPnlPage.tsx, lines 74–97
**Severity:** P2 — UX

`try/finally` with no `catch`. A 403, 500, or network error silences every KPI card and table without explanation.

**Fix:** Add `catch` + `error` state + error banner.

### S4 — Archive CTE loop termination bug (complement to B1)
**File:** server/jobs/llmLedgerArchiveJob.ts, lines 98–104
**Severity:** P1

With conflict-skip + `moved = rowList.length`, the `for(;;)` loop can exit prematurely when skipped rows still exist in `doomed`. Fixed together with B1 by switching DELETE target to `doomed`.

### S5 — `executionPhase` semantics for `iee` source type
**File:** server/services/llmRouter.ts, lines 279–289
**Severity:** P2 — spec conformance

Confirm `'execution'` is a valid value for `executionPhase` when `sourceType='iee'`. Not a bug today but worth nailing down before the next IEE consumer.

### S6 — Archive cutoff test leaves the day unasserted
**File:** server/jobs/__tests__/ledgerArchivePure.test.ts, lines 62–71
**Severity:** P2 — test completeness

Jan 31 − 1 month asserts year/month but not day — a future stdlib change wouldn't flag.

**Fix:** Add `assert(cutoff.getUTCDate() === 31, 'day preserved')`.

### S7 — `getByOrganisation` missing soft-delete filter on `organisations`
**File:** server/services/systemPnlService.ts, line 193
**Severity:** P2

Admin context runs with `BYPASSRLS` — the usual RLS-layer soft-delete guard doesn't apply, so the filter must be explicit.

**Fix:** Add `AND o.deleted_at IS NULL`.

---

## 3. Non-Blocking Improvements

### N1 — `previousMonth` belongs in the pure module
File: server/services/systemPnlService.ts, lines 66–70. Move to `systemPnlServicePure.ts` + add tests.

### N2 — `ledgerRowsScanned: 0` placeholder is misleading
File: server/routes/systemPnl.ts, line 29. Either populate it or remove it from `shared/types/systemPnl.ts`.

### N3 — `callStatus` default initialisation comment
File: server/services/llmRouter.ts, line 504. Add a brief comment clarifying the default flows through the success path.

### N4 — Stale path in gate script comment
File: scripts/verify-no-direct-adapter-calls.sh, line 9. Mentions `scripts/gates/` which does not exist.

### N5 — `geminiAdapter.providerRequestId = ''`
File: server/services/providers/geminiAdapter.ts, line 177. Consider reading `x-goog-request-id` on next touch.

### N6 — Potential revenue double-count via `cost_aggregates` for system/analyzer rows
File: server/services/systemPnlService.ts, lines 200–210. Verify system/analyzer rows aren't org-attributed in `cost_aggregates`.

---

## 4. Verdict

Architecturally sound and spec-conformant. Three issues must land before marking done:
- **B1/S4** — archive CTE data-loss
- **B3** — unfiltered top-calls query
- **B4** — unsanitised month param

**B5** (archive UNION) and **B6** (legacy `callAnthropic`) should also be closed to fully satisfy spec assertions A1 and A7. **S1** (sparkline N+1) and **S3** (missing error state) are strong recs that will cause observable issues in production.

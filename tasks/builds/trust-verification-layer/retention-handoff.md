# Trust & Verification Layer — Stage-2-GA Ship-Blocker: Retention Handoff

**Spec reference:** §17 M1 — deferred item, Stage-2-GA ship-blocker.
**Date pinned:** 2026-05-08

---

## Target retention windows (working assumption)

| Table | Proposed retention | Rationale |
|-------|-------------------|-----------|
| `runtime_check_results` | 90 days | Per-run diagnostic data; not referenced after investigation window |
| `scorecard_judgements` | 90 days | Per-run quality grades; trend data rolls up to summaries |
| `bench_results` | 365 days | Bench results are referenced for regression comparison across model/prompt changes |

These are working assumptions. Final values must be confirmed by the operator before Stage-2-GA based on growth telemetry from the first weeks of production.

---

## Measurement plan (before Stage-2-GA confirmation)

Before pinning final retention windows, measure:

1. **Row growth rate** — instrument a Grafana query (or equivalent) on each table's row count daily for the first 2–4 weeks of production traffic.
2. **Per-row size** — `SELECT avg(pg_column_size(t.*)) FROM <table> AS t` sampled weekly.
3. **Cost model** — `row_rate × per_row_size × cost_per_GB_per_month` at the expected steady-state row rate. At ≤ 1 USD/month/table, keep the 90d/90d/365d defaults. Above 5 USD/month, revisit.
4. **Query patterns** — identify whether any dashboard or report queries span > 30 days of `runtime_check_results` or `scorecard_judgements` (if not, 30d retention is sufficient and cheaper).

---

## Environment variables to introduce (before Stage-2-GA)

| Var | Default | Scope |
|-----|---------|-------|
| `RUNTIME_CHECK_RESULTS_RETENTION_DAYS` | `90` | Server; read by prune job |
| `SCORECARD_JUDGEMENTS_RETENTION_DAYS` | `90` | Server; read by prune job |
| `BENCH_RESULTS_RETENTION_DAYS` | `365` | Server; read by prune job |

Prune jobs to register in `queueService.ts` as daily cron workers (pattern: existing `maintenance:llm-ledger-archive` or `maintenance:memory-decay`). Each job: `DELETE FROM <table> WHERE created_at < NOW() - INTERVAL '<N> days'` inside a `LIMIT`-batched loop to avoid lock contention.

---

## Archival strategy options

| Option | Description | Tradeoff |
|--------|-------------|---------|
| **Hard delete** | Rows beyond retention window are deleted permanently | Simplest; no recovery path; sufficient for non-audit tables |
| **Cold storage export** | Rows exported to S3/GCS before deletion; accessible via ad-hoc query tool | Recoverable; adds infrastructure dependency |
| **Partition pruning** | Range-partitioned tables by `created_at`; older partitions detached and dropped | Best for very high-volume tables; requires schema migration |

**Recommended:** hard delete for all three tables at Stage-2-GA. Revisit if audit/compliance requirements emerge post-GA. `bench_results` is the strongest candidate for cold-storage export because it contains comparative model quality data that may have retrospective value.

---

## Open for operator confirmation

1. Confirm or adjust the 90d / 90d / 365d defaults after 2–4 weeks of production data.
2. Confirm whether any compliance requirement mandates longer retention for `scorecard_judgements`.
3. Confirm archival strategy (hard delete vs cold storage).

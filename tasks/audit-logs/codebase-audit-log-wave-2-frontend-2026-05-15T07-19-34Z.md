# Wave 2 — Hotspot frontend audit

**Verdict:** PASS_WITH_DEFERRED
**Scope:** `client/src/pages/**/*.tsx` (101 top-level pages, 180 incl. subpaths) against `docs/frontend-design-principles.md` five hard rules.
**Branch:** `claude/wave-2-audit-sweep`
**Captured:** 2026-05-15T07-19-34Z
**Mode:** Findings-only (Wave 2 read-only — concurrent Sessions B/C editing code).

## Reconnaissance Map

- 101 top-level page components, 180 including subpath pages.
- Tooling: `grep -cE "<Stat|KPI|Metric|Tile|Spark|Chart"` per file; `wc -l` for size; targeted Read on the highest-density violations.
- Concurrent audits: Sessions B (code edits), C (todo closures). No file overlap — this audit only reads `client/`.

## Pass 1 Findings

| ID | File | Severity | Confidence | Finding |
|---|---|---|---|---|
| FE1 | `client/src/pages/operate/HomePage.tsx` | medium | high | 4× `MetricCard` KPI tiles in the operator's primary Home surface (`Pending Approval`, `Clients Needing Attention`, `Active Agents`, `Runs 7d`) + 1× Cost MTD tile (org_admin only) + `RunActivityChart` hero chart. The doc header (lines 6-21) lists what was already CUT but the surviving four-tile row is the textbook anti-pattern called out in `frontend-design-principles.md` § *Complexity budget per screen* (`KPI tiles: 0 by default`). The page passes the "monitoring is the primary task" exception narrowly — Home IS overview by design — but the four-tile row + chart trips the cap. Worth a re-check vs the §*Visuals as simplicity* "is each tile load-bearing for the primary task" test. The Cost MTD tile is admin-gated, which is correct; the operator-visible four are the editorial question. |
| FE2 | `client/src/pages/SystemPnlPage.tsx` | low | high | 10 chart/stat patterns in 405 LOC. Admin-only system P&L — falls under §*Admin-only views* relaxed budget (5 panels, 2 sidebars, charts/KPIs permitted). No action required; flagged for completeness. |
| FE3 | `client/src/pages/AgentRunLivePage.tsx` | low | high | 6 chart/stat-tile patterns in 333 LOC. Live execution log — chart elements are load-bearing for the primary task ("watch the run unfold"). Acceptable per §*Visuals as simplicity* — single-hero-trend pattern on a drilldown where understanding trajectory IS the task. No action. |
| FE4 | `client/src/pages/SystemIncidentsPage.tsx` | low | medium | 491 LOC + 2 chart patterns. Above the long-page heuristic (>400 LOC suggests progressive disclosure opportunity). System-admin page so budget is relaxed, but length suggests embedded modal logic or sub-component extraction would help maintainability. No 5-hard-rule violation. |
| FE5 | `client/src/pages/ClientPulseDashboardPage.tsx` (298 LOC) and `ClientPulseDrilldownPage.tsx` (222 LOC) | low | low | Dashboard-named pages with NO `Card`/`Panel`/`Stat`/`KPI`/`Chart` literals detected by structural grep — suggests they delegate to a sub-component layer or use a non-canonical naming convention (e.g. inline JSX). Cannot confirm 5-hard-rule conformance without deeper Read; flagged for spot-check during Wave 3. The "Dashboard" naming pattern itself is the concern — `frontend-design-principles.md` § *What to defer by default* explicitly cuts metric dashboards from v1 unless a specific user workflow needs them. Whether these pages are dashboards-as-decoration or dashboards-as-primary-task needs a manual read. |
| FE6 | `client/src/pages/JobQueueDashboardPage.tsx` (222 LOC), `SpendLedgerPage.tsx` (317 LOC) | low | low | Same pattern as FE5 — dashboard/ledger naming, no canonical Card/Stat literals on the surface. Admin-tier surfaces; relaxed budget applies. Spot-check during Wave 3 to confirm. |
| FE7 | All 101 top-level pages | n/a | n/a | **No widespread violation of "one primary action per screen" detected via grep.** Page sizes mostly under 400 LOC indicating reasonable scope discipline post the page-splits batch (PR #313). |

## Prevention Proposals

| ID | Target | Proposal | Closes |
|---|---|---|---|
| PP-FE1 | `docs/frontend-design-principles.md` | Add a per-page checklist gate: a `<Page>` wrapper component (or eslint rule) that counts inline `<MetricCard>` / `<Card>` direct children and fails build at >2 in non-admin pages. Currently the budget cap (`KPI tiles: 0 by default`) is text-only — no machine-enforced check exists. Leverage tier 1. | FE1 |
| PP-FE2 | `gate` | New gate `verify-page-complexity-budget.sh` walking `client/src/pages/*.tsx` (top-level only) and flagging files with > N chart/stat-tile JSX elements where N is configurable per role (operator/admin/system-admin). | FE1, FE2 |

## Post-audit actions required

Manual deep-read pass during Wave 3 on FE5/FE6 (dashboard-named pages) to confirm whether the dashboard naming is editorial or load-bearing.

Findings count: 7 (1 medium, 1 low/high admin-OK, 1 low/high load-bearing, 1 low/medium, 3 low/low needing deeper read).

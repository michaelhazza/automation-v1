# Spec Review HITL Checkpoint — Iteration 2

**Spec:** `tasks/llm-observability-ledger-generalisation-spec.md`
**Spec commit:** untracked (HEAD `feac1d3`)
**Spec-context commit:** `d469871`
**Iteration:** 2 of 5
**Timestamp:** 2026-04-20T06:00:00Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 3 until every finding below is resolved. Resolve by editing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

---

## Summary

| # | Finding | Question | Recommendation | Why |
|---|---------|----------|----------------|-----|
| 2.1 | "Top calls by revenue" includes non-billable rows | Filter out system/analyzer or rename to cost/profit-based ranking? | **Rename to "by cost"** + keep system rows in the list | Matches mockup; operators lose the biggest non-billable spend if it's hidden |
| 2.2 | Mockup UI controls (Refresh, Export CSV, View all, footer links, 60s auto-refresh) have no contract | Spec real behaviour, or mark decorative? | **Spec minimally**: refetchInterval 60s, CSV stub endpoint; View all + footer links decorative for P4 | Prevents P4 slipping on features that weren't scoped; doesn't lose the mockup intent |

---

## Finding 2.1 — Top-calls ranking is "by revenue" but mockup includes non-billable rows

**Classification:** ambiguous (product semantics — matches **Architecture signals** at the presentation layer, intersects **Scope signals** for what this list surfaces)
**Source:** Codex iteration 2 (finding #4, severity important)
**Spec section:** §11.2 `getTopCalls`, §11.3 `/top-calls` endpoint, §11.6 detail drawer, `prototypes/system-costs-page.html` lines 986-1133

### Finding (verbatim)

> 4. `Top-calls ranking is defined by revenue but includes rows with no revenue`
> Sections affected: `§11.2` lines 1101-1102, `§11.3` line 1138, `§11.6` line 1207, `prototypes/system-costs-page.html` lines 990-1129.
> Description: The service, endpoint, and section title all say "Top individual calls by revenue," but the mockup includes system/analyzer rows whose revenue cell is an em dash. That leaves ranking semantics undefined for non-billable rows.
> Suggested fix: Either exclude non-billable rows from this list entirely, or rename and re-contract the list/API as cost-based or profit-based and update the mockup copy to match.

### Recommendation

**Rename to "Top individual calls by cost" and keep non-billable rows in the list.**

Concrete edits:

- §11.2 `getTopCalls` docstring — "Top N individual calls by **cost** in the period." Underlying ORDER BY: `cost_raw DESC`.
- §11.3 endpoint row — rename description if needed; path stays `/top-calls`.
- §11.6 detail drawer — "Opens on: clicking any row in 'Top calls by cost'."
- §19.6 `TopCallRow` — no structural change; the `revenueCents` field stays but is nullable (`number | null`) to accommodate system/analyzer rows. Update the contract.
- `prototypes/system-costs-page.html` lines 986-996 — change the heading to "Top individual calls by cost" and the subhead to "Highest-cost LLM calls this period · click any row for full detail."

### Why

The P&L page's observability goal is "where did the money go?" Exclusion would hide the biggest single-call cost centres (a rogue analyzer run, a runaway memory-compile) behind the overhead KPI aggregate, which is exactly the debug surface the operator needs when costs spike. Revenue-ranking is a less useful question — high-revenue calls are almost all agent-run Sonnet calls on the highest margin tier and tell the operator nothing they can't see from the By Organisation tab. Cost-ranking is the natural ranking for a platform-overhead debugging surface. The mockup already shows system rows in this list, so this matches authorial intent in §11 (mockup is authoritative).

Alternative "exclude non-billable" hides the highest-overhead single calls — worse for debuggability. Alternative "rank by profit" is strange for system rows (profit = -cost is trivially bottom) and doesn't solve the question.

### Classification reasoning

Product-semantics decision about what the page primarily surfaces. The spec currently says "by revenue" but the mockup contradicts that with em-dash rows. Either resolution is a directional call the human owns — not a mechanical cleanup.

### Decision

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## Finding 2.2 — Authoritative UI controls have no implementation contract

**Classification:** ambiguous (scope/architecture — matches **Architecture signals** for what the page must actually do)
**Source:** Codex iteration 2 (finding #7, severity important)
**Spec section:** §11.3, §11.4, `prototypes/system-costs-page.html` lines 133-156, 994, 1141-1145

### Finding (verbatim)

> 7. `Several authoritative UI controls have no implementation contract`
> Sections affected: `§11.3` lines 1130-1139, `§11.4` lines 1163-1175, `prototypes/system-costs-page.html` lines 133-156, 994, 1141-1145.
> Description: The mockup includes `Refresh`, `Export CSV`, `View all`, and footer links for `Margin policies`, `Retention`, and `Billing rules`, plus copy that says the page is "updated every 60 seconds." The spec defines only eight JSON endpoints and a React Query `staleTime`; that does not specify auto-refresh or any handler/destination for those controls.
> Suggested fix: Either mark these controls as non-functional/decorative in `§11` and the mockup, or add concrete contracts for them: `refetchInterval: 60000`, CSV export behavior, the "View all" interaction, and explicit destinations or removal for the footer links.

### Recommendation

**Spec the minimal set that is actually in scope for P4; mark the rest decorative.**

Concrete edits to §11.4:

- **Refresh / auto-refresh.** In scope for P4. Add: `React Query uses refetchInterval: 60_000` for all `/api/admin/llm-pnl/*` queries. The "updated every 60 seconds" footer copy matches real behaviour. The Refresh button is a manual `queryClient.invalidateQueries(['systemPnl'])`.
- **Export CSV.** In scope for P4 as a minimal stub only: clicking the button downloads the currently-visible tab's rows as a CSV (client-side serialisation of the React Query cache; no new endpoint). This is a ~30-line client-side helper; the mockup's Export CSV affordance lights up without adding backend work.
- **View all** (in Top individual calls header). In scope for P4 as a navigation stub: clicking it sets the month filter to the current one and scrolls to the top of the list with `limit=50`. No new page. The mockup's affordance lights up; the "all" means "up to 50 in period", not "every row ever".
- **Footer links** (`Margin policies`, `Retention`, `Billing rules`). **Decorative** for P4. Mark each as a `<span>` styled like a link but with no href. Add a §17 Deferred Items entry for "real destinations for P&L page footer links — candidates: admin policy pages once those exist."

Add a new §11.4.1 "Controls implemented in P4" with the above specs, and flag the footer links as decorative in the same subsection.

### Why

The mockup makes visible commitments to the operator about what the page does. If Refresh doesn't refresh and Export CSV doesn't export, P4 ships a broken-feeling surface. But adding real destinations for admin-only policy pages that don't yet exist would balloon P4 scope. The middle path — refetchInterval, client-side CSV, navigation stub for View all, decorative footer — is the cheapest way to honour the mockup's visible promises without P4 growing into a multi-page admin suite.

The alternative "mark all decorative" ships a page where visible buttons don't work — uniformly bad UX. The alternative "spec everything fully" grows P4 by a week for controls that aren't load-bearing for the core P&L observability goal.

### Classification reasoning

P4 scope question. Each control can legitimately go either way (decorative or real), and the combined decision is a feature-set call the human owns — not a mechanical cleanup.

### Decision

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## How to resume the loop

After editing both `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint, honour each decision, and continue to iteration 3.

If you want to stop the loop entirely, set any decision to `stop-loop` and the loop exits after honouring already-resolved `apply` / `apply-with-modification` decisions.

---

## Mechanical findings being applied this iteration (for reference)

The following 6 findings are being auto-applied in parallel with this checkpoint. Detail available in `tasks/spec-review-log-llm-observability-2-20260420T060000Z.md`.

- **C2.1** — Two-provider references in §1.2 A1 / §3.1 point 2 / §4.2 / §8 TOC / §8.5 / §16.1 widened to four-adapter registry-driven language.
- **C2.2** — §10.4 analyzer-service `sourceId` tightened to `skill_analyzer_jobs.id` per §6.3 invariant; dropped the "subaccountId or analyzer operation id" waffle.
- **C2.3** — §11.5 rewritten with a per-tab overhead-row matrix aligned to mockup; added `OverheadRow` contract at §19.4; widened `getByOrganisation()` shape in §11.2 and §11.3; shared-types list updated.
- **C2.5** — new §19.5a `DailyTrendRow` contract added.
- **C2.6** — mockup tab-status string updated from "4 source types" to "5 source types · system and analyzer pulled out as pure overhead." Broader mockup demo-data reconciliation left alone (out of mechanical scope).
- **C2.8** — §2.4 factual claim "zero rows today" replaced with enumeration of existing system callers; §15.1 P1 goal acknowledges §7.4 margin-multiplier behaviour change; §15.4 P4 readiness paragraph dropped the "$0 overhead / strategically hollow" framing.

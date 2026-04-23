# Frontend Design Principles

Durable rules for any UI artifact built in this repo — mockups, components, pages, modals, empty states. This is the long-form companion to the short ruleset in [`CLAUDE.md` § Frontend Design Principles](../CLAUDE.md). Read both before generating any UI.

---

## Why this document exists

Automation OS positions as **consumer-simple on enterprise-grade backend**. The product sells to agency operators, solo founders, and non-technical knowledge workers — the same audience that finds tools like HubSpot and Salesforce overwhelming. The backend needs to be powerful (router, cost ledger, HITL gates, cached-context infrastructure, policy engine); the frontend needs to be invisible where possible and obvious everywhere else. These two stay decoupled.

The trap this doc prevents: **treating the spec's exposed capability surface as the UI surface.** A spec that adds `pack_utilization`, `prefix_hash`, `cache_creation_tokens`, `run_outcome = 'completed' | 'degraded' | 'failed'`, and per-tenant cache-cost rollups does not imply a pack-utilization dashboard, a prefix-hash inspector, a cache-cost explorer, and a per-tenant financial breakdown. Backend spec → full coverage. Frontend design → strict editorial filter.

---

## Contents

- [The primary rule](#the-primary-rule)
- [Pre-design checklist](#pre-design-checklist)
- [What to ship by default](#what-to-ship-by-default)
- [What to defer by default](#what-to-defer-by-default)
- [Complexity budget per screen](#complexity-budget-per-screen)
- [Progressive disclosure patterns](#progressive-disclosure-patterns)
- [Worked example — cached-context infrastructure](#worked-example--cached-context-infrastructure)
- [Re-check before delivery](#re-check-before-delivery)
- [When to break these rules](#when-to-break-these-rules)

---

## The primary rule

**Start with the user's primary task, not the data model.** Before sketching any screen, component, or mockup, answer the pre-design checklist below. If you can't, stop and ask — do not design speculatively off the data model.

---

## Pre-design checklist

Work through these in order. An unchecked box is a design finding; every unchecked box means the artifact is under-specified and not ready to build.

- [ ] **Who is the primary user of this screen?** Roles: agency operator / solo founder / tenant admin / internal staff / Synthetos admin. Different users tolerate different complexity ceilings. Agency operator = lowest tolerance. Internal staff = highest.
- [ ] **What single task are they here to complete?** One sentence. Example: *"Attach a document pack to this scheduled task."* NOT *"Manage document packs and monitor utilization and review run history."* If the answer is a list, you have multiple screens, not one.
- [ ] **What is the minimum information needed to complete that task?** List it. Example: pack name, pack document count, an attach button. NOT utilization-per-tier, cache-hit-rate, prefix-hash preview, attach button.
- [ ] **What would happen if I removed X?** For every candidate element (panel, metric, chart, table, sidebar card), ask this. If the answer is *"the user would still complete the primary task"*, the element is deferred.
- [ ] **Where does everything else go?** Every deferred element goes to exactly one of: (a) progressive disclosure on this screen (collapsed "Advanced" section), (b) a dedicated page the primary user rarely visits, (c) admin-only view, (d) deferred out of v1 entirely. Name the destination per element.
- [ ] **The re-check.** Imagine a non-technical operator landing on this screen for the first time. Do they know what to do within 3 seconds? If not, cut more.

---

## What to ship by default

- **The primary action** — prominent, obvious, one button or one drop zone.
- **The minimum state needed to complete the action** — current value inline, not in a separate panel.
- **The result of the last action taken** — inline confirmation (e.g. "attached · 2m ago"), not a history table.
- **One sidebar callout at most** — only if it's load-bearing for completing the primary task (e.g. a required field's help text).
- **Empty states with one next action** — "No packs yet. [Create pack]". Not a tour, not tips, not a chart of nothing.

---

## What to defer by default

Everything below is **deferred out of v1 unless explicitly requested for a specific user workflow**. Not "maybe v2" — actively cut from the v1 artifact.

- Metric dashboards, KPI boards, tile rows of numbers.
- Trend charts over time windows (7-day / 30-day / 90-day).
- Diagnostic panels that expose internal identifiers (prefix hashes, snapshot IDs, idempotency keys, correlation IDs).
- Aggregated cost rollups, per-tenant financial breakdowns, spend-saved calculations, cost-split donuts.
- Observability explorers ("Usage Explorer", "Pack Lens", "Model Lens", "Feature Lens").
- Ranking tables ("packs by utilization", "tenants by spend", "features by cost").
- Run-history tables on per-entity pages — runs live in the existing run log, not on every page that has a run.
- Three-tier / four-tier comparison views (e.g. "Sonnet vs Opus vs Haiku side-by-side").
- "Cost saved vs. first run" or any other counterfactual-comparison framing.

These all represent **real backend capability** the spec legitimately covers. The capability ships. The UI surface for it does not ship until a specific user workflow needs it. If they're truly needed, they go on a dedicated admin page that the average user never opens — not inline on the primary user journey.

---

## Complexity budget per screen

Hard caps. A screen exceeding these is a design finding; cut before shipping.

| Element | Cap | Notes |
|---|---|---|
| Primary actions | 1 | Buttons that commit state. A "Save" and a "Cancel" count as one primary action (the save). |
| Panels (distinct bordered sections) | 3 | Header, primary body, one sidebar. More than that = compose multiple screens. |
| KPI tiles | 0 by default | Add only when the primary task is *monitoring* (not operating). |
| Charts | 0 by default | Same rule. A spark-line on an inline card is not a chart. |
| Table columns | 4 | Name, 1 key state column, 1 timestamp, 1 action. More columns → collapse into secondary state / progressive disclosure. |
| Sidebar cards | 1 | Only if load-bearing. A second sidebar is a design finding. |
| Hash / ID exposures | 0 by default | Internal identifiers never surface to the primary user. Admin view only. |
| Tier / model / variant comparisons | 0 | The user does not care what model runs under the hood. If they do, it's an admin concern. |

Admin-only views (accessed via an explicit toggle, hidden from the primary nav) operate under a relaxed budget: 5 panels, 2 sidebars, charts and KPIs permitted. These exist to serve Synthetos internal staff and advanced tenant admins — never the default operator.

---

## Progressive disclosure patterns

When information is genuinely needed but not for the primary task, use these — in preference order:

1. **Inline badge or dot.** A coloured status dot next to a name. A "· 2m ago" trailing line. Lowest visual weight, zero clicks to see.
2. **Hover tooltip.** For informational copy that doesn't need to be scanned — "why this is disabled", "what this count means".
3. **Collapsed "Advanced" section.** A single expandable section at the bottom of the primary body. Labelled clearly. Defaults collapsed. Contains the internal-detail fields (hashes, IDs, raw config).
4. **"Details →" link to a dedicated page.** For rich diagnostic content that a user will visit deliberately. Separate URL, not inline.
5. **Admin-only page.** For content that should not surface to primary users at all. Gated behind a role check.

Pick the lowest-weight pattern that works. Do not mix three patterns on one screen.

---

## Worked example — cached-context infrastructure

The cached-context spec exposes these backend capabilities: reference document CRUD, document pack CRUD, pack resolution snapshots, prefix-hash identity, cache read/write attribution, three-way run-outcome classification, pack utilization per model tier, per-tenant cache-cost rollups, HITL budget-breach block payload.

### What the v1 UI should ship

The primary user task is **attach documents to automations**. That's the whole feature from the user's POV. Everything else is invisible infrastructure.

- **Documents page** — a simple list of uploaded reference documents (name, size, updated). One primary action: upload. Standard primitive.
- **Pack creation** — name + add documents. One primary action: save. Standard primitive.
- **Pack attachment control** — reused inline on agent / task / scheduled-task config pages. One drop-down or multi-select. One primary action: attach. Shows currently attached packs as chips with a remove (x).
- **One inline signal on the pack list row** — a dot/label: `healthy` / `near cap` / `at cap`. Drives user attention to trim when needed. No tier-by-tier breakdown visible by default.
- **One inline signal on the task / scheduled-task row** — last run outcome (`completed` / `degraded` / `failed`) as a dot. Runs live in the existing run log.

That's it. Three new screens (documents, pack detail, pack attachment control) + two inline signals on existing pages. No new dashboards, no new explorers, no charts, no tiles.

### What the v1 UI should NOT ship

- Pack utilization dashboard with green/amber/red radial rings per tier.
- Scheduled-task detail with 7-day run-calendar, detailed run table, sidebar pack utilization.
- Run-detail page exposing prefix hashes, components JSON, snapshot integrity checks, cache-read-vs-write tokens, cost-saved counterfactual.
- Usage Explorer with per-pack hit-rate trend lines, cost-split donut, pack ranking, per-tenant breakdown.
- Any comparison view of Sonnet vs Opus vs Haiku.
- Any exposure of `prefix_hash`, `packSnapshotId`, `idempotencyKey`, or other internal identifiers to the primary user.

All of these represent real backend signals that can and should be computed. They surface (if at all) on an admin-only observability page gated behind an explicit role, never on the primary user journey. Most will be deferred out of v1 entirely — **shipping them is optional; the feature works without them**.

### The mockups in `prototypes/cached-context/`

The five mockups in [`prototypes/cached-context/`](../prototypes/cached-context/) were generated before this doc existed. They violate rules 1, 2, 3, 4 — most of them represent "what the backend could surface if we exposed every column", not "what the user needs to complete the task".

- **`mockup-budget-breach-block.html`** — valid. Renders the `HitlBudgetBlockPayload` shape the spec commits to (§4.5). Safety-critical screen that legitimately has to surface WHY a run is blocked. Keep.
- **`mockup-pack-utilization.html`** — reduce to a single inline badge on the pack list row. The tier-by-tier radial dashboard is the anti-pattern.
- **`mockup-scheduled-task-with-pack.html`** — replace with an inline attachment control on the existing scheduled-task config page. Run-history lives in the run log, not here.
- **`mockup-run-detail-cached.html`** — delete from v1. Runs open the existing run-detail page. Prefix-hash / cache attribution surfaces there as a collapsed "Advanced" section, not as its own screen.
- **`mockup-usage-explorer-packs.html`** — delete from v1. The observability story is a valid admin concern but not a v1 deliverable.

Build the replacement v1 mockup set focused on the attach workflow before implementation begins.

---

## Re-check before delivery

Before committing any UI artifact (mockup, PR, component), run through this quickly:

- [ ] Did I start from the user's task, not the data model?
- [ ] Is there exactly one primary action on this screen?
- [ ] Is every element load-bearing for the primary task?
- [ ] Have I deferred every monitoring / observability / diagnostic element that the task doesn't need?
- [ ] If a non-technical operator landed here, would they know what to do in 3 seconds?
- [ ] Am I under the complexity-budget caps?

If any answer is "no" or "not sure", cut before shipping. Shipping a fatter UI "just in case someone wants it" is how this product loses the consumer-simple positioning.

---

## When to break these rules

Almost never. The two legitimate exceptions:

1. **Admin-only views.** Operate under the relaxed budget above. Gated behind an explicit role check, hidden from the primary nav, discoverable only via direct URL or an admin settings page. Every Automation OS user is NOT an admin.
2. **Safety-critical information-dense screens.** Payload-rendering screens where the complexity exists to prevent harm — HITL block payloads, terminal-failure review queues, dry-run diff previews. Even here, the rule is "surface only what's needed to make the decision", not "surface everything the backend knows".

Everything else obeys the rules. If you find yourself arguing for a third exception during a design, you're almost certainly rationalising a data-model-first mistake — go back to the primary task and start over.

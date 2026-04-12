# Dev Brief: Robust Scraping Engine

**Date:** 2026-04-12
**Status:** Approved direction — dev spec pending
**Depends on:** Org Subaccount Refactor (for org-level scraping to work seamlessly)
**Session:** https://claude.ai/code/session_01MPgWmCKMHoWvBWkfAwhrVB

---

## Problem

Automation OS agents can fetch URLs (`fetch_url` — basic HTTP GET/POST with 10KB truncation) and search the web (`web_search` — Tavily API). But they cannot:

- **Scrape JavaScript-rendered pages** — `fetch_url` gets raw HTML, misses content rendered by JS
- **Handle anti-bot protection** — Cloudflare, Turnstile, TLS fingerprinting checks all block naive HTTP requests
- **Extract structured data reliably** — no schema-based extraction, no CSS/XPath selection
- **Survive site redesigns** — if a monitored site changes its layout, extraction breaks and stays broken until a human intervenes
- **Monitor pages for changes** — no diffing, no baseline comparison, no recurring check infrastructure

These gaps block high-value agent workflows: competitor monitoring, market research, pricing intelligence, regulatory tracking, content aggregation.

---

## Solution: Tiered Scraping Engine + Scrapling MCP Sidecar

### Architecture

The agent calls `scrape_url` or `scrape_structured`. The engine tries tiers in order:

**Tier 1: Native HTTP fetch** — Fast, free, handles ~70% of sites. TLS fingerprint impersonation via curl-impersonate. Falls back to standard fetch for simple sites.

**Tier 2: Native stealth Playwright** — Uses existing IEE/Playwright worker infrastructure. `playwright-extra` + stealth plugins for anti-detection. Handles JS-rendered SPAs, dynamic content. Falls back here when Tier 1 gets 403 or a challenge page.

**Tier 3: Scrapling MCP sidecar** — Python-based MCP server (Scrapling framework, BSD-3 license, 36k GitHub stars, actively maintained). Best-in-class Cloudflare Turnstile bypass. Isolated process — crashes don't affect the main server. Clean exit path: if Scrapling ever goes unmaintained, swap for a commercial proxy API as Tier 3 replacement.

### Adaptive Selector Engine (the moat)

When an agent extracts data from a page, the engine fingerprints each target element — tag name, attributes, text, DOM path, parent/sibling context. On subsequent scrapes, if the original CSS selector fails (site redesigned), the engine runs a similarity search across the current DOM to relocate the element.

**Scrapers self-heal when sites change.** No human intervention. No 2am pages.

Algorithm: weighted multi-feature similarity scoring (tag match, text similarity, attribute overlap, DOM path comparison). Implemented in TypeScript. Selectors persisted per org/subaccount in Postgres.

---

## User Experience: Zero Configuration

**The user never configures scraping.** They create a task in plain English:

> "Monitor competitor-a.com/pricing weekly. Track plan names and prices. Alert me if anything changes."

The Orchestrator routes this to the **Strategic Intelligence Agent** (which already handles competitive intelligence). The agent calls the scraping skills, extracts data, compares to previous baseline, and reports changes as deliverables on the task.

### What makes this work without user configuration

1. **Skills are pre-attached** to the Strategic Intelligence Agent via seed data. They flow automatically to org agents and subaccount agent links. The user never assigns skills.
2. **The agent determines what to scrape** from the task description. Skill parameters accept natural language (`extract: "pricing table"`) — the agent translates intent into parameters.
3. **Tier selection is automatic.** The engine starts cheap and escalates only when needed.
4. **Adaptive selectors learn automatically.** First scrape memorises elements. Subsequent scrapes use them.
5. **The Orchestrator handles routing.** Scraping-related keywords route to the Strategic Intelligence Agent (existing pattern, just add scraping keywords to the Orchestrator's prompt).

### Power user escape hatch

Users who want control can add `customInstructions` on the subaccount agent link (existing UI: Subaccounts > Agent > Instructions tab). This is optional — the default is the agent figures it out.

## New Skills

### `scrape_url` — Tiered single-page scrape

Parameters: `url` (required), `extract` (natural language — e.g., "pricing table", "all article text"), `output_format` (text | markdown | json, default: markdown).

No tier selection parameter — auto-detected. No selector configuration — adaptive engine handles it.

### `scrape_structured` — Adaptive structured extraction

Parameters: `url` (required), `fields` (natural language — e.g., "plan name, monthly price, annual price, features list"), `remember` (boolean, default: true — learn selectors for next time).

Returns clean JSON matching requested fields. First call learns which DOM elements correspond to each field. Subsequent calls use adaptive matching to find them even if the site changed.

### `monitor_webpage` — Change detection with auto-scheduling

Parameters: `url` (required), `watch_for` (e.g., "pricing changes", "new blog posts"), `frequency` (e.g., "daily", "weekly").

Creates a scheduled task automatically. Persists baseline to `scraping_cache`. On each run, compares new content to baseline and surfaces changes as task deliverables. Silent when nothing changed.

---

## Agent Integration

### Strategic Intelligence Agent (seed change)

Add `scrape_url`, `scrape_structured`, and `monitor_webpage` to the agent's skill list in `companies/automation-os/agents/strategic-intelligence-agent/AGENTS.md`. These flow automatically to org and subaccount agent links via the existing skill inheritance chain.

### Orchestrator routing (prompt change)

Add scraping-related routing patterns to the Orchestrator's prompt:

- `monitor / track / watch / alert` + URL → Strategic Intelligence Agent
- `scrape / extract / pull data from` + URL → Strategic Intelligence Agent
- `competitor + pricing / features / changes` → Strategic Intelligence Agent

---

## Scrapling MCP Integration

One new entry in `server/config/mcpPresets.ts`:

```typescript
{
  slug: 'scrapling',
  name: 'Scrapling',
  description: 'Anti-bot web scraping with Cloudflare bypass and stealth browsing',
  category: 'browser',
  transport: 'stdio',
  command: 'uvx',
  args: ['scrapling', 'mcp'],
  requiresConnection: false,
  recommendedGateLevel: 'auto',
  toolCount: 10,
  toolHighlights: ['get', 'stealthy_fetch', 'bulk_get', 'open_session'],
}
```

The scraping engine calls Scrapling's MCP tools as Tier 3 fallback. Existing MCP infrastructure handles lifecycle, circuit breakers, timeouts, and credential scoping.

## Database Additions

### `scraping_selectors` — Learned element fingerprints

Scoped by `organisation_id` + optional `subaccount_id`. Stores: `url_pattern` (regex/glob), `selector_name` (human label like "price"), `css_selector` (current best), `element_fingerprint` (JSONB DOM fingerprint for re-matching), `hit_count` / `miss_count` (reliability tracking), `last_matched_at`.

### `scraping_cache` — Content baseline for change detection

Scoped by `organisation_id`. Stores: `url`, `content_hash` (SHA-256), `extracted_data` (JSONB), `fetched_at`, `ttl_seconds`.

---

## Phased Delivery

| Phase | Scope | Unlocks |
|-------|-------|---------|
| **1** | `scrape_url` with tiered fetching (native HTTP + existing Playwright). Content extraction via Readability. Scrapling MCP preset. | Agents can scrape any URL with auto-escalation. |
| **2** | Adaptive selector engine + `scrape_structured`. `scraping_selectors` table. | Self-healing scrapers that survive site redesigns. |
| **3** | Anti-detection hardening: TLS fingerprinting (curl-impersonate), stealth Playwright plugins, proxy rotation. | Bypass Cloudflare and common anti-bot on Tiers 1-2 before needing Tier 3. |
| **4** | `monitor_webpage` + auto-scheduling + `scraping_cache` + change detection. | Continuous monitoring: competitor pricing, regulatory changes, news alerts. |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Scrapling maintainer goes inactive | Tier 3 is a swappable sidecar. Replace with commercial proxy API (one preset change). Tiers 1-2 are fully native. |
| Adaptive selectors false-match after major redesign | Confidence threshold (0.85). Below threshold, return `selector_uncertain` — agent asks for human confirmation. |
| Legal/ethical scraping concerns | Respect `robots.txt` by default. Rate limiting per domain. Org-level domain allowlist/blocklist. |
| Anti-bot arms race on Tiers 1-2 | Tier 3 (Scrapling) handles the hard cases. We handle the easy 85% natively. |
| Performance at scale | HTTP tier handles 90% in <100ms. Browser tiers enforce cost via existing `runCostBreaker`. Cache via `scraping_cache`. |

---

## Competitive Advantage

1. **Self-healing scrapers** — no other agent platform has adaptive selectors in the skill layer
2. **Tiered cost optimisation** — cheapest method that works, automatically
3. **Native integration** — full audit trail, permission gates, cost tracking, org scoping
4. **Zero-config UX** — user writes a task, agent handles the rest

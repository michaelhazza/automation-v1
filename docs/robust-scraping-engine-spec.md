# Robust Scraping Engine — Development Specification

**Date:** 2026-04-12
**Status:** Draft
**Brief:** `tasks/robust-scraping-engine-brief.md`
**Depends on:** Org Subaccount Refactor (merged — PR #117)
**Migration:** `0108_scraping_engine.sql`

---

## Table of Contents

1. Context & Problem
2. Architecture: Tiered Scraping Engine
3. Adaptive Selector Engine
4. Content Extraction
5. Skill Definitions
6. Action Registry Entries
7. Skill Handlers
8. Scrapling MCP Integration
9. Database Schema
10. Migration SQL
11. Agent Integration & Seed Changes
12. User Experience Flow
13. Rate Limiting & Safety
14. Verification Plan
15. Phased Delivery
16. Risks & Mitigations

---

## 1. Context & Problem

Automation OS agents currently have two web-access skills:

- **`fetch_url`** — Basic HTTP GET/POST. Returns raw HTML truncated at 10KB. No JS rendering, no anti-bot handling, no structured extraction. Works for simple API calls and static pages.
- **`web_search`** — Tavily AI search API. Returns search results, not page content. Good for discovery, not extraction.

**What agents cannot do today:**

| Gap | Impact |
|-----|--------|
| No JS rendering | SPAs, React/Next.js sites return empty shells |
| No anti-bot bypass | Cloudflare, Turnstile, DataDome block naive HTTP requests |
| No structured extraction | Agent gets raw HTML, must parse it via LLM (expensive, unreliable) |
| No selector persistence | Every scrape starts from scratch — no learning across runs |
| No change detection | No baseline comparison, no "alert me when this changes" |
| 10KB response truncation | Large pages lose critical data below the fold |

These gaps block the highest-value agent workflows: competitor monitoring, market research, pricing intelligence, regulatory tracking, and content aggregation.

**Existing infrastructure we leverage:**

| Component | Location | How it's used |
|-----------|----------|---------------|
| IEE Playwright worker | `worker/src/browser/` | Tier 2 — stealth browser rendering |
| MCP client manager | `server/services/mcpClientManager.ts` | Tier 3 — Scrapling sidecar lifecycle |
| Skill system | `server/services/skillExecutor.ts` | Skill handlers for new scraping skills |
| Action registry | `server/config/actionRegistry.ts` | Zod schemas + gate levels for new actions |
| pg-boss job queue | `server/services/queueService.ts` | Async scraping jobs with retry |
| Scheduled tasks | `server/db/schema/scheduledTasks.ts` | Recurring monitoring via `monitor_webpage` |
| Agent briefings | `server/services/agentBriefingService.ts` | Cross-run context for scraping history |
| Workspace memory | `server/services/workspaceMemoryService.ts` | Persistent scraped data across runs |

---

## 2. Architecture: Tiered Scraping Engine

### 2a. Overview

**File:** `server/services/scrapingEngine/index.ts` (new)

The scraping engine is a service that accepts a URL and extraction intent, then tries progressively more capable (and expensive) fetching strategies until one succeeds.

```
Agent calls scrape_url({ url, extract })
  ↓
scrapingEngine.scrape(url, options)
  ↓
Tier 1: HTTP fetch (fast, free)
  → Success? Return content
  → 403 / challenge page / empty body? Escalate
  ↓
Tier 2: Stealth Playwright (IEE worker)
  → Success? Return content
  → Still blocked? Escalate
  ↓
Tier 3: Scrapling MCP sidecar (anti-bot bypass)
  → Success? Return content
  → Failed? Return error with tier exhaustion detail
```

### 2b. File structure

```
server/services/scrapingEngine/
  ├── index.ts                  # Public API — orchestrates tiers
  ├── types.ts                  # ScrapeRequest, ScrapeResult, TierResult types
  ├── httpFetcher.ts            # Tier 1: HTTP with optional TLS fingerprinting
  ├── browserFetcher.ts         # Tier 2: Stealth Playwright via IEE
  ├── scraplingFetcher.ts       # Tier 3: Scrapling MCP sidecar
  ├── adaptiveSelector.ts       # Adaptive element matching engine
  ├── selectorStore.ts          # Postgres persistence for learned selectors
  ├── contentExtractor.ts       # HTML → structured data extraction
  └── rateLimiter.ts            # Per-domain rate limiting
```

### 2c. Tier 1: HTTP Fetcher

**File:** `server/services/scrapingEngine/httpFetcher.ts`

Enhances the existing `executeFetchUrl` pattern with:
- **No 10KB truncation** — full page content (capped at 1MB to prevent memory issues)
- **Challenge detection** — identifies Cloudflare challenge pages, CAPTCHAs, and 403/429 responses as "blocked" signals that trigger tier escalation
- **Readability extraction** — uses `@mozilla/readability` to extract article content when `extract` parameter requests text/article content
- **Response metadata** — returns `statusCode`, `contentType`, `contentLength`, `wasBlocked`, `tierUsed`

> **Phase note:** TLS fingerprint impersonation (`curl-impersonate`) is a Phase 3 enhancement. Phase 1 uses standard HTTPS without fingerprint impersonation.

**Challenge detection heuristic:**
```typescript
function isBlockedResponse(status: number, body: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  if (body.includes('challenge-platform') || body.includes('cf-turnstile')) return true;
  if (body.includes('Just a moment') && body.includes('cloudflare')) return true;
  if (body.length < 1000 && !body.includes('<body')) return true; // empty shell
  return false;
}
```

### 2d. Tier 2: Browser Fetcher

**File:** `server/services/scrapingEngine/browserFetcher.ts`

Uses the existing IEE Playwright worker infrastructure:
- Enqueues an IEE browser task via `ieeExecutionService.enqueueIEETask()`
- Polls `iee_runs` table until completion (existing pattern from `fetch_paywalled_content`)
- Browser task contract: allowed domains = `[new URL(url).hostname]`, timeout = 30s
- Returns fully rendered HTML after JS execution + network idle

**When to use:** Tier 1 returned a blocked or empty response (status 403/429/503, challenge page, or body < 1KB with no `<body>` tag).

> **Phase note:** `playwright-extra` stealth plugin integration (passing `stealth: true` in task metadata) is a Phase 3 enhancement. Phase 1 uses the existing IEE Playwright worker without stealth plugins. No changes to worker files are required for Phase 1. Whether Phase 3 requires worker changes will be verified at Phase 3 start — the IEE task contract may or may not support `stealth: true` metadata passthrough without modification.

### 2e. Tier 3: Scrapling MCP Sidecar

**File:** `server/services/scrapingEngine/scraplingFetcher.ts`

Calls the Scrapling MCP server's `stealthy_fetch` tool via the existing MCP client manager:
- Resolves the `scrapling` MCP server config for the org
- Calls `mcpClientManager.callTool('scrapling', 'stealthy_fetch', { url, ... })`
- Returns the content as markdown (Scrapling extracts before returning, reducing token usage)
- Falls back to `get` tool (HTTP-only) if `stealthy_fetch` fails

**When to use:** Tier 2 was blocked (Cloudflare Turnstile, advanced anti-bot). This is the last resort before returning an error.

**Tier 3 limitation:** Because Scrapling returns pre-extracted markdown (not raw HTML), **Tier 3 cannot support `scrape_structured` or adaptive selector learning**. If `scrape_structured` escalates and Tier 1 and Tier 2 both fail, the engine returns an error — it does not attempt Tier 3. Tier 3 is only used by `scrape_url`.

**Tier 3 capability boundary for `scrape_url`:** When `scrape_url` is called with `output_format: 'json'` or with `css_selectors`, the engine caps escalation at **Tier 2** (`maxTier: 2`). If Tier 2 also fails, the engine returns an error rather than escalating to Tier 3. Reason: Scrapling returns pre-extracted markdown, making CSS selector queries and structured JSON extraction against raw DOM impossible. Tier 3 is only attempted when `output_format` is `'text'` or `'markdown'` AND no `css_selectors` are provided.

### 2f. Tier orchestration logic

```typescript
interface ScrapeOptions {
  url: string;
  extract?: string;          // natural language extraction intent
  outputFormat?: 'text' | 'markdown' | 'json';
  maxTier?: 1 | 2 | 3;      // cap escalation (default: 3)
  selectors?: string[];      // optional CSS selectors
  adaptive?: boolean;        // use adaptive selector engine (default: true)
  selectorGroup?: string;    // named selector group for persistence
  timeout?: number;          // overall timeout in ms (default: 60000)
  orgId: string;             // required — org-scoped rate limits, settings, and selector/cache persistence
  subaccountId?: string;     // optional — subaccount-scoped selector isolation
}

interface ScrapeResult {
  success: boolean;
  content: string;            // extracted content in requested format
  rawHtml?: string;           // full HTML (only if needed for adaptive selectors)
  tierUsed: 1 | 2 | 3;
  url: string;
  statusCode?: number;
  contentHash: string;        // SHA-256 for change detection
  extractedData?: Record<string, unknown>;  // structured data if json format
  selectorConfidence?: number; // 0-1 adaptive selector match score (present when adaptive selectors used)
  selectorUncertain?: boolean; // true when 0.6 <= selectorConfidence < 0.85 (agent should request human confirmation)
  adaptiveMatchUsed?: boolean; // true when adaptive re-matching relocated elements after selector failure
  metadata: {
    fetchDurationMs: number;
    contentLength: number;
    wasEscalated: boolean;
    blockedTiers: number[];
  };
}
```

---

## 3. Adaptive Selector Engine

**File:** `server/services/scrapingEngine/adaptiveSelector.ts`

Instead of hardcoding CSS selectors that break on site redesigns, the engine remembers what elements look like and relocates them even after DOM changes.

### 3a. How it works

**First scrape (learning):**
1. Agent calls `scrape_structured({ url, fields: "plan name, price, features" })`
2. Engine fetches the page, LLM identifies which DOM elements match each field
3. For each matched element, the engine computes a **fingerprint**:

```typescript
interface ElementFingerprint {
  tagName: string;                    // 'div', 'span', 'td'
  id: string | null;                  // id attribute if present
  classList: string[];                // class names
  attributes: Record<string, string>; // all attributes
  textContentHash: string;            // SHA-256 of trimmed text
  textPreview: string;                // first 100 chars of text
  domPath: string[];                  // ancestor chain: ['html', 'body', 'div.main', ...]
  parentTag: string;                  // parent tag + key attributes
  siblingTags: string[];              // adjacent sibling tags
  childTags: string[];                // direct child tags
  position: { index: number; total: number }; // nth-of-type
}
```

4. Fingerprints are persisted to `scraping_selectors` table (see section 9)

**Subsequent scrapes (matching):**
1. Engine fetches the page and tries the original CSS selector
2. If selector matches and fingerprint similarity > 0.85 → return match
3. If selector fails or fingerprint mismatch → run **adaptive scan**

### 3b. Adaptive scan algorithm

Score every candidate element on the page against the stored fingerprint:

```typescript
function scoreSimilarity(stored: ElementFingerprint, candidate: ElementFingerprint): number {
  const weights = {
    tagName:    0.15,  // exact match: 1.0, mismatch: 0.0
    id:         0.10,  // exact match or both null
    classList:  0.15,  // Jaccard similarity of class sets
    attributes: 0.10,  // key overlap ratio (exclude class/id/style)
    textSim:    0.15,  // token-level Jaccard of text content
    domPath:    0.15,  // longest common subsequence ratio
    parentTag:  0.10,  // exact match of parent descriptor
    siblings:   0.05,  // overlap ratio of sibling tags
    children:   0.05,  // overlap ratio of child tags
  };
  // ... weighted sum of dimension scores
  return score; // 0.0 to 1.0
}
```

**Thresholds:**
- Score >= 0.85 → confident match, auto-update stored selector
- Score 0.6–0.85 → `selector_uncertain`, agent can request human confirmation
- Score < 0.6 → no match found

### 3c. Performance

Candidate scan is O(n) over all page elements. Typical pages (1000–5000 elements) complete in <10ms. For pages with >10,000 elements, pre-filter by `tagName` match. All operations are pure string/set comparisons — no LLM calls, no network.

### 3d. Selector store

**File:** `server/services/scrapingEngine/selectorStore.ts`

Persistence wrapper for `scraping_selectors` table:
- `save(orgId, subaccountId, urlPattern, selectorGroup, selectorName, cssSelector, fingerprint)` — upsert. `selectorGroup` is the source of truth for separating independent structured extractions on the same site; pass `null` for ungrouped one-off saves.
- `load(orgId, subaccountId, urlPattern, selectorGroup)` — all selectors for a URL pattern within the given group. `selectorGroup` must match the group used in `save()` — pass `null` to load ungrouped selectors.
- `recordHit(selectorId)` / `recordMiss(selectorId)` — reliability tracking
- `updateSelector(selectorId, newCssSelector, newFingerprint)` — after adaptive re-match

URL matching uses glob patterns (e.g., `competitor-a.com/pricing*`) so selectors work across pagination and URL variants.

**Key semantics — `urlPattern` vs `selectorGroup`:** `urlPattern` is a site-scope filter (which pages does this selector apply to). `selectorGroup` is an extraction-scope key (which field-set on those pages). Together they form the composite selector identity: `urlPattern` scopes to a site or URL family, `selectorGroup` scopes to a specific structured extraction on that site. The unique index enforces that `(orgId, subaccountId, urlPattern, selectorGroup, selectorName)` is the full key — two extractions on the same site with different `selectorGroup` values are completely independent and do not share selectors.

---

## 4. Content Extraction

**File:** `server/services/scrapingEngine/contentExtractor.ts`

### 4a. Extraction modes

| Mode | When | How |
|------|------|-----|
| **markdown** (default) | `scrape_url` general extraction | Mozilla Readability for articles; `turndown` HTML→markdown for other pages |
| **text** | `output_format: 'text'` | Strip HTML, normalize whitespace, preserve structure via newlines |
| **json (one-off)** | `scrape_url` with `output_format: 'json'` | LLM-assisted extraction without selector learning. Use when you need JSON once and do not plan to repeat the scrape. No selectors are stored. |
| **json (recurring)** | `scrape_structured` (`remember: true` by default; pass `remember: false` to skip selector persistence) | LLM-assisted on first scrape; pure DOM queries on every subsequent scrape using stored adaptive selectors. Use for recurring extraction where speed and zero-LLM cost on repeat runs matter. |
| **selectors** | CSS/adaptive selectors provided | Direct DOM query via `cheerio`, return matched elements |

> **Decision boundary:** use `scrape_url(output_format='json')` for one-off structured extraction with no intent to repeat. Use `scrape_structured` for any recurring extraction — it stores selectors and avoids LLM calls on all subsequent runs.

### 4b. LLM-assisted extraction (json mode)

When the agent requests structured data via `scrape_structured`:

1. Fetch the page via tiered engine
2. If adaptive selectors exist for this URL pattern → extract directly via DOM queries (**zero LLM calls**)
3. If no selectors → send focused DOM excerpt (~4000 tokens) to LLM with the field schema
4. LLM returns structured JSON + the CSS selectors it used. **Output shape convention:** each requested field maps to an array of values — always an array, even for single-record pages (e.g., `{ "plan_name": ["Starter", "Pro", "Enterprise"], "price": ["$9", "$29", "$99"] }`). Multi-record pages produce parallel arrays where index N of each field array corresponds to the same record.

   **Field-key canonicalization:** before sending the field schema to the LLM and before saving or comparing extracted data, field names are normalized using `canonicalizeFieldKey(field: string): string`, defined in `server/services/scrapingEngine/contentExtractor.ts`:
   - Split on commas (for multi-field strings)
   - Trim whitespace
   - Lowercase
   - Replace spaces and hyphens with underscores
   - Strip any characters that are not `[a-z0-9_]`
   - Example: `"Plan Name"` → `plan_name`, `"monthly-price"` → `monthly_price`

   The LLM is prompted to emit JSON using these canonical keys (the prompt includes the pre-normalized key list). DOM extraction paths use the same canonical keys. Monitoring comparison uses canonical keys on both sides. This ensures key stability across first-run LLM extraction, subsequent DOM extraction, and monitor reruns.

5. Engine saves the selectors as adaptive fingerprints for next time, **only when `remember !== false`**. When `remember` is explicitly `false`, the LLM extraction result is returned but no selectors are persisted.

**First scrape** of a new site (with `remember: true`): one LLM call. **Every subsequent scrape**: zero LLM calls.

### 4c. Dependencies

- `@mozilla/readability` — article content extraction
- `cheerio` — server-side DOM parsing and CSS selector queries
- `turndown` — HTML to markdown conversion

---

## 5. Skill Definitions

### 5a. `server/skills/scrape_url.md`

```markdown
---
name: Scrape URL
description: Fetch and extract content from any web page using a tiered scraping engine with automatic anti-bot escalation.
isActive: true
visibility: basic
---

## Parameters

- url: string (required) — The full URL to scrape (must start with http:// or https://)
- extract: string — What to extract, in natural language (e.g., "pricing table", "all article text", "product listings with prices"). If omitted, returns the full page content.
- output_format: string — Output format: text, markdown, or json (default: markdown)
- css_selectors: array of strings — CSS selectors to extract specific elements. Optional — if omitted, the engine auto-detects relevant content. Example: `["div.pricing-grid", "span.price"]`

## Instructions

Use `scrape_url` to extract content from a web page. Unlike `fetch_url`, this skill handles JavaScript-rendered pages, anti-bot protection, and content extraction automatically.

- For a known URL with specific data needs: use `scrape_url` with an `extract` description
- For discovery and research: use `web_search` first to find relevant URLs, then `scrape_url` to extract content
- For recurring data extraction with consistent structure: use `scrape_structured` instead

The engine automatically selects the best fetching strategy (HTTP, stealth browser, or anti-bot bypass) based on the target site's response. No configuration needed.

### Decision rules
- **Use scrape_url** when: you have a specific URL and need its content
- **Use scrape_structured** when: you need consistent field extraction across runs (prices, names, features)
- **Use fetch_url** when: calling a JSON API endpoint (not a web page)
- **Use web_search** when: you don't have a specific URL yet
```

### 5b. `server/skills/scrape_structured.md`

```markdown
---
name: Scrape Structured
description: Extract structured data from a web page with adaptive selectors that self-heal when the site changes layout.
isActive: true
visibility: basic
---

## Parameters

- url: string (required) — The full URL to scrape
- fields: string (required) — What to extract, in natural language (e.g., "plan name, monthly price, annual price, features list")
- remember: boolean — Learn selectors for next time so future scrapes are faster and don't require LLM extraction (default: true)
- selector_group: string — Named group for stored selectors (default: auto-generated as `<hostname>:<sha256(fields.trim().toLowerCase()).slice(0,8)>` — deterministic per site+field-set). Use the same group name across runs targeting the same site to benefit from learned selectors.

## Instructions

Use `scrape_structured` for recurring data extraction where you need consistent JSON output across multiple runs. The first extraction uses the LLM to identify data fields. Subsequent extractions use learned selectors — zero LLM calls, instant results.

The adaptive selector engine automatically handles site redesigns. If the original CSS selectors break, the engine relocates the elements using structural similarity matching. If confidence is below threshold, it returns `selector_uncertain: true` — ask the user to verify.

### Output format

Returns JSON with one key per requested field:
```json
{
  "plan_name": ["Starter", "Pro", "Enterprise"],
  "monthly_price": ["$9", "$29", "$99"],
  "annual_price": ["$7/mo", "$24/mo", "$79/mo"],
  "selector_confidence": 0.94,
  "adaptive_match_used": false
}
```
```

### 5c. `server/skills/monitor_webpage.md`

```markdown
---
name: Monitor Webpage
description: Set up recurring monitoring of a web page for changes, with automatic alerts when specified content changes.
isActive: true
visibility: basic
---

## Parameters

- url: string (required) — The URL to monitor
- watch_for: string (required) — What changes to watch for (e.g., "pricing changes", "new blog posts", "any content change")
- frequency: string (required) — How often to check (e.g., "daily", "weekly", "every 6 hours", "every Monday at 9am")
- fields: string — Optional specific fields to track (same as scrape_structured fields). If provided, uses structured extraction for precise change detection.

## Instructions

Use `monitor_webpage` to set up a recurring monitoring job. On first call, the skill:
1. Scrapes the page and establishes a content baseline
2. Creates a scheduled task with the specified frequency
3. On each subsequent run, scrapes again and compares to the baseline
4. If changes are detected matching the `watch_for` criteria, creates a deliverable with a change report
5. If nothing changed, stays silent (no deliverable, no noise)

Do not call `monitor_webpage` repeatedly for the same monitoring intent — it creates the recurring schedule automatically. Distinct monitors on the same URL are allowed when they track different criteria or schedules (each creates its own scheduled task and workspace memory baseline entry). Do not call it on every run.

### Change detection
- When `fields` is provided: compares structured JSON field-by-field (precise, catches price changes)
- When `fields` is omitted: compares content hash of the full extracted text (catches any change)

## Scheduled Run Instructions

> This section is injected by `runContextLoader.ts` into the agent's system context on every skill-typed scheduled run (`"type": "monitor_webpage_run"`). It is not shown to the user and does not appear in the agent's additionalPrompt. It is Phase 4 scope.

On each scheduled monitoring run, follow this protocol:

1. Call `parseMonitorBrief(brief)` on the task brief JSON to extract `url`, `watch_for`, `fields`, `selectorGroup`, and `scheduledTaskId`.
2. Call `scrape_structured({ url, fields, selectorGroup, remember: false })` to fetch the current page state. `remember: false` prevents redundant selector writes — the selectors were already learned on the first run.
3. Read the stored baseline from workspace memory using key `monitor:<scheduledTaskId>`.
4. Compare `contentHash` from the new scrape result against the stored baseline:
   - If `contentHash` is unchanged: stop. Note "no changes detected" internally. Do **not** call `add_deliverable`.
5. If `contentHash` has changed:
   a. Call `add_deliverable` with a summary of what changed (field-by-field diff if `fields` was provided; narrative summary otherwise).
   b. Call `write_workspace` to overwrite the `monitor:<scheduledTaskId>` baseline entry with the new `{ contentHash, extractedData }`.
```

---

## 6. Action Registry Entries

**File:** `server/config/actionRegistry.ts`

### 6a. `scrape_url`

```typescript
scrape_url: {
  actionType: 'scrape_url',
  description: 'Scrape content from a web page with automatic tier escalation and content extraction.',
  actionCategory: 'api',
  isExternal: true,
  defaultGateLevel: 'auto',
  createsBoardTask: false,
  payloadFields: ['url', 'extract', 'output_format', 'css_selectors'],
  parameterSchema: z.object({
    url: z.string().url().describe('The URL to scrape'),
    extract: z.string().optional().describe('What to extract (natural language)'),
    output_format: z.enum(['text', 'markdown', 'json']).optional().default('markdown').describe('Output format'),
    css_selectors: z.array(z.string()).optional().describe('Specific CSS selectors to extract'),
  }),
  retryPolicy: {
    maxRetries: 2,
    strategy: 'exponential',
    retryOn: ['timeout', 'network_error'],
    doNotRetryOn: ['validation_error'],
  },
  mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  idempotencyStrategy: 'read_only',
  topics: ['research', 'competitive_intelligence', 'data_gathering'],
},
```

### 6b. `scrape_structured`

```typescript
scrape_structured: {
  actionType: 'scrape_structured',
  description: 'Extract structured data from a web page with adaptive selectors that self-heal across site redesigns.',
  actionCategory: 'api',
  isExternal: true,
  defaultGateLevel: 'auto',
  createsBoardTask: false,
  payloadFields: ['url', 'fields', 'remember', 'selector_group'],
  parameterSchema: z.object({
    url: z.string().url().describe('The URL to scrape'),
    fields: z.string().describe('Fields to extract (natural language)'),
    remember: z.boolean().optional().default(true).describe('Learn selectors for future runs'),
    selector_group: z.string().optional().describe('Named selector group for persistence'),
  }),
  retryPolicy: {
    maxRetries: 2,
    strategy: 'exponential',
    retryOn: ['timeout', 'network_error'],
    doNotRetryOn: ['validation_error'],
  },
  mcp: { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
  idempotencyStrategy: 'keyed_write',
  topics: ['research', 'competitive_intelligence', 'data_gathering', 'monitoring'],
},
```

### 6c. `monitor_webpage`

```typescript
monitor_webpage: {
  actionType: 'monitor_webpage',
  description: 'Set up recurring web page monitoring with change detection and automatic alerts.',
  actionCategory: 'api',
  isExternal: true,
  defaultGateLevel: 'review',  // creates a scheduled task — user should approve
  createsBoardTask: false,     // creates a scheduledTask row, not a board task
  payloadFields: ['url', 'watch_for', 'frequency', 'fields'],
  parameterSchema: z.object({
    url: z.string().url().describe('The URL to monitor'),
    watch_for: z.string().describe('What changes to watch for'),
    frequency: z.string().describe('Check frequency (e.g., "daily", "weekly")'),
    fields: z.string().optional().describe('Specific fields to track for change detection'),
  }),
  retryPolicy: {
    maxRetries: 1,
    strategy: 'fixed',
    retryOn: ['timeout'],
    doNotRetryOn: ['validation_error', 'network_error'],
  },
  mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
  idempotencyStrategy: 'keyed_write',
  // Idempotency key: SHA-256 of normalised(organisationId + (subaccountId ?? 'org') + url + watch_for.toLowerCase().trim() + frequency.toLowerCase().trim() + (fields ?? '').toLowerCase().trim())
  // organisationId is always included so that two different orgs creating the same org-level monitor (subaccountId null)
  // do not collide on the same idempotency key. The (subaccountId ?? 'org') placeholder distinguishes null-subaccount
  // (org-level) calls from subaccount-level calls while keeping the key stable across invocations.
  // Duplicate monitor_webpage calls with identical parameters for the same org/subaccount are deduplicated —
  // the second call returns the existing scheduled task ID without creating a new row.
  // Distinct monitors on the same URL with different watch_for, frequency, or fields create separate scheduled tasks.
  topics: ['monitoring', 'competitive_intelligence'],
},
```

---

## 7. Skill Handlers

**File:** `server/services/skillExecutor.ts`

### 7a. Handler registration

Add to the `SKILL_HANDLERS` map (after the `fetch_url` handler ~line 478):

> **Phase note:** Add `scrape_url` handler in Phase 1, `scrape_structured` handler in Phase 2, and `monitor_webpage` handler in Phase 4. The three entries below are shown together for reference but must be added in separate commits matching their respective phases. Do not add a handler entry before its corresponding implementation function exists.

```typescript
// Phase 1 — add with scrape_url implementation
scrape_url: async (input, context) => {
  return executeWithActionAudit('scrape_url', input, context, () =>
    executeScrapeUrl(input, context));
},
// Phase 2 — add with scrape_structured implementation
scrape_structured: async (input, context) => {
  return executeWithActionAudit('scrape_structured', input, context, () =>
    executeScrapeStructured(input, context));
},
// Phase 4 — add with monitor_webpage implementation
monitor_webpage: async (input, context) => {
  return executeWithActionAudit('monitor_webpage', input, context, () =>
    executeMonitorWebpage(input, context));
},
```

### 7b. `executeScrapeUrl` implementation

```typescript
async function executeScrapeUrl(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const url = String(input.url ?? '');
  if (!url) return { success: false, error: 'url is required' };

  const result = await scrapingEngine.scrape({
    url,
    extract: input.extract ? String(input.extract) : undefined,
    outputFormat: (input.output_format as 'text' | 'markdown' | 'json') ?? 'markdown',
    selectors: input.css_selectors as string[] | undefined,
    adaptive: true,
    orgId: context.organisationId,
    subaccountId: context.subaccountId ?? undefined,
  });

  return {
    success: result.success,
    content: result.content,
    tier_used: result.tierUsed,
    content_hash: result.contentHash,
    extracted_data: result.extractedData,
    url: result.url,
    metadata: result.metadata,
  };
}
```

### 7c. `executeScrapeStructured` implementation

Follows the same `executeWithActionAudit` wrapper pattern as `executeScrapeUrl`. Invokes `selectorStore.load()` to check for existing adaptive selectors, then either runs a pure DOM extraction (selectors exist — regardless of `remember`) or calls the LLM extraction path in `contentExtractor` (no selectors stored). `remember` controls writes only: when `remember` is `false`, no selectors are persisted after a new LLM extraction, but any already-stored selectors are still used for DOM extraction. Returns a response with all extracted field values as top-level keys, plus selector metadata:

```typescript
{
  success: boolean;
  // One key per requested field, value is always an array (parallel arrays model):
  [fieldName: string]: unknown[];  // e.g. plan_name: ["Starter", "Pro", "Enterprise"]
  selector_confidence: number;        // 0-1 match score from adaptive selector
  adaptive_match_used: boolean;       // true when selectors were re-matched after DOM change
  selector_uncertain: boolean;        // true when confidence is 0.6–0.85
  content_hash: string;               // SHA-256 of extracted content (pre-truncation)
  url: string;
}
```

Uses LLM extraction on first scrape when no selectors exist; pure DOM queries on all subsequent scrapes (zero LLM cost) when stored selectors match.

### 7d. `executeMonitorWebpage` implementation

1. **Idempotency:** `monitor_webpage` uses `idempotencyStrategy: 'keyed_write'`. Deduplication is enforced at the action layer by `executeWithActionAudit` — the `actions` table unique index on `(subaccount_id, idempotency_key)` ensures that a second `monitor_webpage` call with identical parameters (same subaccountId + url + watch_for + frequency + fields, normalized and hashed as defined in §6c) returns the previously-stored action result without re-executing this handler. **The handler does not need to perform its own duplicate check.** The idempotency contract is: if `executeWithActionAudit` detects a previously-completed action with the same key, it returns the cached result and the handler body is not invoked.
2. Establishes the content baseline:
   - If `fields` is provided: calls `executeScrapeStructured` (the same path used by `scrape_structured`) to perform LLM-assisted structured extraction and learn adaptive selectors. The structured JSON result is the baseline.
   - If `fields` is omitted: calls `scrapingEngine.scrape()` with `outputFormat: 'markdown'`. The full content hash is the baseline.
3. Converts `frequency` (natural language string) to an rrule string using `parseFrequencyToRRule(frequency: string): string` — a new helper in `server/services/scrapingEngine/index.ts`. Supported values: `"daily"`, `"weekly"`, `"every N hours"`, `"every [weekday] at [time]"`. Unknown values throw a validation error. All schedules are stored and fired in UTC; local-time expressions (e.g. "every Monday at 9am") are interpreted as UTC.
4. Derives `selectorGroup` for selector storage and lookup. When `fields` is provided: `selectorGroup = "<normalised-hostname>:<sha256(fields.trim().toLowerCase()).slice(0,8)>"` (deterministic per site+field-set). When `fields` is omitted: `selectorGroup = null` (no selector storage needed for hash-based monitoring).
5. Creates a `scheduledTasks` row with all required fields:
   - `title`: `"Monitor: <hostname> — <watch_for truncated to 50 chars>"`
   - `rrule`: result of step 3
   - `timezone`: `'UTC'`
   - `scheduleTime`: extracted from the rrule (e.g. `"09:00"` for daily-at-9am; defaults to `"00:00"` for frequency-only values like "daily")
   - `assignedAgentId`: the Strategic Intelligence Agent's ID (resolved from the org's agent list via the existing agent lookup)
   - `subaccountId`: `context.subaccountId`
   - `brief`: **Configuration only** — carries the values the agent needs to re-execute the scrape. The run protocol (parse → scrape → compare → write) is **not** embedded here; it is injected by `runContextLoader.ts` from the skill file's `## Scheduled Run Instructions` section at execution time. **Exact format (produced by `serializeMonitorBrief(config)` and parsed by `parseMonitorBrief(brief)` — both helpers defined in `server/services/scrapingEngine/index.ts`):**

     The brief is a **JSON string** embedded as the entire `brief` field value. This avoids ambiguity from periods, colons, or special characters in URLs or `watch_for` text. The canonical payload shape:
     ```json
     {
       "type": "monitor_webpage_run",
       "monitorUrl": "<url>",
       "watchFor": "<watch_for>",
       "fields": "<fields or null>",
       "selectorGroup": "<selectorGroup or null>",
       "scheduledTaskId": "<scheduledTaskId>"
     }
     ```
     The `"type"` field is what `runContextLoader.ts` uses to identify this as a skill-typed scheduled task brief and look up the matching skill file. `serializeMonitorBrief(config)` calls `JSON.stringify(config)`. `parseMonitorBrief(brief)` calls `JSON.parse(brief)` and validates that `monitorUrl` and `watchFor` are non-empty strings; if validation fails, the agent logs an error (`"monitor_webpage brief could not be parsed: <scheduledTaskId>"`) and skips the run without creating a deliverable. The `brief` field is the only place the monitor config is persisted — the `scheduledTasks` schema has no `metadata` or `taskType` column. `selectorGroup` is included here so subsequent `scrape_structured` calls can target the exact same selector group learned on the first run. `scheduledTaskId` is included so the agent can construct the workspace memory key `monitor:<scheduledTaskId>` without needing to look it up from the task card.
   > **Note:** No new runtime file is required for scheduled-run comparison logic. `scheduledTaskService.fireOccurrence()` is fully generic — it fires the assigned agent with the task card (including the `brief`) and calls `agentExecutionService.executeRun()`. The agent reads the `brief` to recover monitoring config and calls `scrape_structured` accordingly. No new `taskType` case or job handler is needed.
6. Stores the baseline in workspace memory using `workspaceMemoryService.write()` with key `"monitor:<scheduledTaskId>"` where `scheduledTaskId` is the ID from step 5. The stored value is `{ contentHash, extractedData }` — the same fields previously computed in step 2. Workspace memory persists across agent runs and is not subject to TTL expiry, making it the correct primitive for durable monitoring baselines. (`scraping_cache` is a pure dedup cache with TTL semantics and is not used for baselines.)
7. Returns confirmation with the scheduled task ID
8. **On each subsequent scheduled run:** the Strategic Intelligence Agent reads the scheduled task `brief` to recover `url`, `watch_for`, `fields`, and `selectorGroup`. The recurring scrape path branches on `fields`:
   - **`fields` provided (structured monitoring):** agent calls `scrape_structured` (not `monitor_webpage`) targeting the same `selectorGroup`. Returns JSON with extracted field values.
   - **`fields` omitted (hash-based monitoring):** agent calls `scrape_url` with `outputFormat: 'markdown'`. Reads `contentHash` from the result.
   
   In both branches, the agent reads the baseline from workspace memory using key `"monitor:<scheduledTaskId>"` (the `scheduledTaskId` is available from the task card brief returned by `scheduledTaskService.fireOccurrence()`). It compares the new result to the stored `{ contentHash, extractedData }` baseline. For structured monitoring, comparison is field-by-field; for hash-based monitoring, comparison is `contentHash` equality. The agent calls `add_deliverable` if changes are detected, then calls `write_workspace` to overwrite the `"monitor:<scheduledTaskId>"` entry with the new `{ contentHash, extractedData }`.

---

## 8. Scrapling MCP Integration

### 8a. MCP Preset

**File:** `server/config/mcpPresets.ts`

Add one new entry to `MCP_PRESETS` array:

```typescript
{
  slug: 'scrapling',
  name: 'Scrapling',
  description: 'Anti-bot web scraping with Cloudflare bypass and stealth browsing.',
  category: 'browser' as McpPresetCategory,
  integrationType: 'mcp_server' as const,
  transport: 'stdio' as const,
  command: 'uvx',
  args: ['scrapling', 'mcp'],
  requiresConnection: false,
  recommendedGateLevel: 'auto' as const,
  toolCount: 10,
  toolHighlights: ['get', 'stealthy_fetch', 'bulk_get', 'open_session'],
  setupNotes: 'Requires Python 3.10+ and uvx. Automatically installs Scrapling and browser binaries on first run.',
},
```

### 8b. How the scraping engine calls Scrapling

The `scraplingFetcher.ts` module:

1. Checks if a `scrapling` MCP server is configured for the org
2. If not configured, Tier 3 is unavailable — returns `{ available: false }`
3. If configured, calls the MCP tool via the existing `mcpClientManager`:

```typescript
const result = await mcpClientManager.callTool(
  orgId,
  'scrapling',
  'stealthy_fetch',
  { url, main_content_only: true }
);
```

4. Existing MCP infrastructure handles: process lifecycle, circuit breakers (`MCP_CIRCUIT_BREAKER_THRESHOLD = 3`), timeouts (`MCP_CALL_TIMEOUT_MS = 30000`), lazy connections, error recovery.

### 8c. Scrapling availability

Scrapling MCP server is **optional**. The scraping engine works with Tier 1 + Tier 2 alone. Tier 3 activates only when an org admin adds the Scrapling preset via the MCP integration UI (existing flow — same as adding Gmail or Slack MCP servers).

For the org subaccount (org-level agents), the MCP server config is org-scoped — automatically available to all agents in the org.

---

## 9. Database Schema

### 9a. `scraping_selectors` table

**File:** `server/db/schema/scrapingSelectors.ts` (new)

```typescript
export const scrapingSelectors = pgTable(
  'scraping_selectors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    urlPattern: text('url_pattern').notNull(),        // glob pattern for URL matching
    selectorName: text('selector_name').notNull(),     // human label: "price", "title"
    selectorGroup: text('selector_group'),              // named group for batch operations
    cssSelector: text('css_selector').notNull(),        // current best CSS selector
    elementFingerprint: jsonb('element_fingerprint').notNull()
      .$type<ElementFingerprint>(),                    // DOM fingerprint for re-matching
    hitCount: integer('hit_count').notNull().default(0),
    missCount: integer('miss_count').notNull().default(0),
    lastMatchedAt: timestamp('last_matched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('scraping_selectors_org_idx').on(table.organisationId),
    urlPatternIdx: index('scraping_selectors_url_pattern_idx')
      .on(table.organisationId, table.urlPattern),
    groupIdx: index('scraping_selectors_group_idx')
      .on(table.organisationId, table.selectorGroup),
    // Unique constraint enforces upsert semantics in selectorStore.save()
    // subaccount_id and selector_group are nullable — NULLS NOT DISTINCT treats NULL as a
    // concrete unique key value (two NULLs in the same key column collide correctly).
    upsertKey: uniqueIndex('scraping_selectors_upsert_key')
      .on(table.organisationId, table.subaccountId, table.urlPattern, table.selectorGroup, table.selectorName)
      .nullsNotDistinct(),
  })
);
```

### 9b. `scraping_cache` table

**File:** `server/db/schema/scrapingCache.ts` (new)

> **Cache contract deferred to Phase 4.** The read/write contract — lookup query, write-on-miss upsert, TTL eviction query, and bypass rules — is deferred to Phase 4. It will be specified at Phase 4 start alongside the first handler that uses the cache. No contract is defined here. The table is created in Phase 1 (migration 0108) so the schema is stable before the first handler lands.

```typescript
export const scrapingCache = pgTable(
  'scraping_cache',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
    subaccountId: uuid('subaccount_id').references(() => subaccounts.id),
    url: text('url').notNull(),
    contentHash: text('content_hash').notNull(),       // SHA-256 of extracted content
    extractedData: jsonb('extracted_data'),              // cached structured extraction
    rawContentPreview: text('raw_content_preview'),     // first 2000 chars for debugging
    ttlSeconds: integer('ttl_seconds').notNull().default(3600),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // NULLS NOT DISTINCT on subaccount_id: two rows with NULL subaccount_id and the same
    // org+url collide correctly. scraping_cache is a pure dedup cache — monitoring baselines
    // are stored in workspace memory (workspaceMemoryService), not here.
    orgUrlIdx: uniqueIndex('scraping_cache_org_url_idx')
      .on(table.organisationId, table.subaccountId, table.url)
      .nullsNotDistinct(),
    fetchedAtIdx: index('scraping_cache_fetched_at_idx')
      .on(table.fetchedAt),
  })
);
```

### 9c. Export from schema index

**File:** `server/db/schema/index.ts` — add:
```typescript
export { scrapingSelectors } from './scrapingSelectors.js';
export { scrapingCache } from './scrapingCache.js';
```

---

## 10. Migration SQL

**File:** `migrations/0108_scraping_engine.sql`

```sql
-- ═══════════════════════════════════════════════════════════════
-- 0108 — Scraping Engine: selectors + cache tables
-- ═══════════════════════════════════════════════════════════════

-- 1. Scraping selectors — learned element fingerprints
CREATE TABLE scraping_selectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id UUID REFERENCES subaccounts(id),
  url_pattern TEXT NOT NULL,
  selector_name TEXT NOT NULL,
  selector_group TEXT,
  css_selector TEXT NOT NULL,
  element_fingerprint JSONB NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  miss_count INTEGER NOT NULL DEFAULT 0,
  last_matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX scraping_selectors_org_idx
  ON scraping_selectors (organisation_id);
CREATE INDEX scraping_selectors_url_pattern_idx
  ON scraping_selectors (organisation_id, url_pattern);
CREATE INDEX scraping_selectors_group_idx
  ON scraping_selectors (organisation_id, selector_group);
-- Unique constraint for upsert semantics in selectorStore.save()
-- NULLS NOT DISTINCT: two rows with NULL subaccount_id and the same other key columns collide correctly
CREATE UNIQUE INDEX scraping_selectors_upsert_key
  ON scraping_selectors (organisation_id, subaccount_id, url_pattern, selector_group, selector_name)
  NULLS NOT DISTINCT;

-- 2. Scraping cache — pure dedup cache (monitoring baselines stored in workspace memory)
CREATE TABLE scraping_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id UUID REFERENCES subaccounts(id),
  url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  extracted_data JSONB,
  raw_content_preview TEXT,
  ttl_seconds INTEGER NOT NULL DEFAULT 3600,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NULLS NOT DISTINCT on subaccount_id: two rows with NULL subaccount_id and the same
-- org+url collide correctly. Pure dedup cache — one row per org+subaccount+url.
CREATE UNIQUE INDEX scraping_cache_org_url_idx
  ON scraping_cache (organisation_id, subaccount_id, url)
  NULLS NOT DISTINCT;
CREATE INDEX scraping_cache_fetched_at_idx
  ON scraping_cache (fetched_at);

-- 3. RLS policies (standard org-scoped isolation)
ALTER TABLE scraping_selectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraping_selectors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scraping_selectors_org_isolation ON scraping_selectors;
CREATE POLICY scraping_selectors_org_isolation ON scraping_selectors
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

ALTER TABLE scraping_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraping_cache FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scraping_cache_org_isolation ON scraping_cache;
CREATE POLICY scraping_cache_org_isolation ON scraping_cache
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- 4. Cleanup job index — for TTL-based cache expiry
CREATE INDEX scraping_cache_expiry_idx
  ON scraping_cache (fetched_at, ttl_seconds);
```

---

## 11. Agent Integration & Seed Changes

### 11a. Strategic Intelligence Agent — add scraping skills

**File:** `companies/automation-os/agents/strategic-intelligence-agent/AGENTS.md`

Update the skills list in the YAML frontmatter:

```yaml
skills:
  - read_workspace
  - write_workspace
  - web_search
  - request_approval
  - generate_competitor_brief
  - synthesise_voc
  - move_task
  - update_task
  - add_deliverable
  - scrape_url            # NEW — Phase 1
  - scrape_structured     # NEW — Phase 2
  - monitor_webpage       # NEW — Phase 4
```

> **Phase note:** Add `scrape_url` to the AGENTS.md skills list in Phase 1. Add `scrape_structured` in Phase 2. Add `monitor_webpage` in Phase 4. Do not add all three at once — the skill handlers and action registry entries ship in phases, and listing a skill before its handler is wired will cause skill execution errors.

Add a new section to the agent's prompt body:

```markdown
### Web Scraping & Monitoring

When a task requires extracting data from a specific URL, use the scraping skills:

1. **Single page data extraction** — use `scrape_url` with an `extract` description matching the task requirements
2. **Recurring structured extraction** — use `scrape_structured` with `fields` matching the data points needed. Set `remember: true` so future runs use learned selectors (faster, no LLM cost)
3. **Change monitoring** — use `monitor_webpage` ONCE to set up a recurring check. Do not call it on every run.

Prefer `scrape_structured` over `scrape_url` when the task involves recurring data gathering (competitor pricing, feature tracking) — the adaptive selectors make subsequent runs instant.

For competitive intelligence tasks, the typical workflow is:
1. `web_search` to discover competitor URLs
2. `scrape_structured` on each competitor's pricing/features page
3. Compare extracted data to workspace memory (previous findings)
4. `add_deliverable` with a change report if differences found
5. `write_workspace` to update workspace memory with the latest data snapshot
```

### 11a-i. Scheduled Run Instructions — skill-managed run protocol (Phase 4)

Skill markdown files may include a `## Scheduled Run Instructions` section. This section is code-managed (authored in the skill file by developers) — it is **not** user-managed and does not live in the agent's `additionalPrompt`.

When `runContextLoader.ts` builds the system context for a scheduled agent run, it inspects the task brief. If the brief matches the pattern `"type": "<skill>_run"` (a skill-typed scheduled task brief), `runContextLoader` resolves the corresponding skill file, extracts its `## Scheduled Run Instructions` section, and prepends it to the agent's system context for that run. This gives the agent a deterministic, versioned run protocol without polluting the agent prompt or requiring the user to manually configure instructions.

For `monitor_webpage`, this means the step-by-step monitoring protocol (parse brief, scrape, compare, write back) lives in `server/skills/monitor_webpage.md` under `## Scheduled Run Instructions`. The brief JSON (produced by `serializeMonitorBrief`) carries only configuration values — not the protocol. The protocol is injected by `runContextLoader.ts` at execution time.

This pattern is Phase 4 scope. `runContextLoader.ts` is a modified existing file.

### 11b. Orchestrator — add routing keywords

**File:** `companies/automation-os/agents/orchestrator/AGENTS.md`

Add to the routing rules section (after existing keyword rules):

```markdown
- scrape / extract / pull data from + URL → Strategic Intelligence Agent  ← Phase 1
- competitor + pricing / features / changes / analysis → Strategic Intelligence Agent  ← Phase 1
- research + market / industry / trends + URL → Strategic Intelligence Agent  ← Phase 1
- monitor / track / watch / alert + URL → Strategic Intelligence Agent  ← Phase 4 (add when monitor_webpage ships)
```

> **Phase note:** Add the first three routing rules in Phase 1. Add the `monitor` routing rule in Phase 4 alongside `monitor_webpage`.

### 11c. Seed script

**File:** `scripts/seed.ts`

No code changes to the seed script itself — it already parses `skills:` from AGENTS.md frontmatter and writes to `system_agents.defaultOrgSkillSlugs`. The new skills flow through the existing inheritance chain:

```
AGENTS.md → seed → system_agents.defaultOrgSkillSlugs
  → installToOrg → agents.defaultSkillSlugs
  → linkToSubaccount → subaccount_agents.skillSlugs
```

The only requirement is that the skill markdown files (`scrape_url.md`, `scrape_structured.md`, `monitor_webpage.md`) exist in `server/skills/` before the seed runs, and the action registry entries exist in `actionRegistry.ts`.

---

## 12. User Experience Flow

### 12a. Zero-config scenario: competitor monitoring

**What the user does:** Creates a task in the workspace:
> "Monitor competitor-a.com/pricing weekly. Track plan names and prices. Alert me if anything changes."

**What happens invisibly:**

```
Step 1: Orchestrator runs (next scheduled cycle)
  → Reads task from board
  → Keyword match: "monitor" + URL → Strategic Intelligence Agent
  → Calls reassign_task → Strategic Intelligence Agent

Step 2: Strategic Intelligence Agent runs
  → Reads task: "Monitor competitor-a.com/pricing weekly..."
  → Calls monitor_webpage({
      url: "https://competitor-a.com/pricing",
      watch_for: "pricing changes — plan names and prices",
      frequency: "weekly",
      fields: "plan name, monthly price, annual price"
    })

Step 3: monitor_webpage skill executes
  → fields is provided → calls executeScrapeStructured internally
    → Tier 1 HTTP fetch succeeds (pricing page is static HTML)
    → No existing selectors → LLM extracts: plan name, monthly price, annual price → JSON
    → Saves adaptive selectors in scraping_selectors (selectorGroup derived from host+fields hash)
  → Creates scheduledTask with rrule for weekly execution (scheduledTaskId returned)
  → Stores baseline in workspace memory: key "monitor:<scheduledTaskId>", value { contentHash, extractedData }

Step 4: One week later — scheduled task fires
  → Strategic Intelligence Agent runs again
  → Agent calls scrape_structured (not monitor_webpage — already set up)
    → Tier 1 HTTP fetch
    → Adaptive selectors find elements (zero LLM calls)
  → Reads baseline from workspace memory using key "monitor:<scheduledTaskId>"
  → Compares new extractedData to stored baseline
  → Detects: Pro plan price changed $29 → $39
  → Calls add_deliverable({
      title: "Price Change: competitor-a.com",
      description: "Pro plan increased from $29 to $39/mo (34% increase)..."
    })
  → Calls write_workspace to update "monitor:<scheduledTaskId>" with new { contentHash, extractedData }

Step 5: User sees deliverable on their task board
```

### 12b. One-off research scenario

**User task:** "Get me the pricing info from competitor-b.com/pricing"

```
→ Orchestrator routes to Strategic Intelligence Agent
→ Agent calls scrape_url({
    url: "https://competitor-b.com/pricing",
    extract: "plan name, price, features, limits",
    output_format: "json"
  })
→ Engine fetches → LLM extracts → returns JSON (no selectors stored — one-off)
→ Agent calls add_deliverable with formatted pricing table
→ Done — no recurring schedule, no monitoring
```

### 12c. Power user scenario: custom instructions

A user adds custom instructions on the subaccount agent link:

> "When scraping competitor-a.com, always extract from the div.pricing-grid element. Include the 'most popular' badge status for each plan."

The Strategic Intelligence Agent receives this in Layer 3 of its system prompt. When it calls `scrape_url`, it includes `css_selectors: ['div.pricing-grid']` and `extract: "plan names, prices, and most popular badge status"`. If it then calls `scrape_structured`, the `fields` parameter includes "most popular badge status". The adaptive engine learns the matching selectors on the first `scrape_structured` run via LLM extraction; subsequent runs use those learned selectors without manual specification.

---

## 13. Rate Limiting & Safety

### 13a. Per-domain rate limiting

**File:** `server/services/scrapingEngine/rateLimiter.ts`

In-memory rate limiter (per domain, per org) to prevent overwhelming target sites:

```typescript
const DEFAULT_RATE_LIMIT = {
  maxRequestsPerMinute: 10,  // per domain per org
  maxRequestsPerHour: 100,
  cooldownOnRateLimitMs: 60_000,
};
```

> **Single-instance scope:** This rate limiter is best-effort and per-process only. In a multi-process deployment, limits apply independently per process rather than globally. A shared backing store (Redis or Postgres) for global rate-limit counters is deferred to a future phase when horizontal scaling is needed.

When a domain hits the rate limit, subsequent scrape requests for that domain return:
```json
{ "success": false, "error": "rate_limited", "retryAfterMs": 45000 }
```

### 13b. robots.txt respect

Default behaviour: **respect robots.txt**. The robots.txt check is performed in **`scrapingEngine/index.ts`** before any tier dispatch — it is a pre-flight gate, not a Tier 1 internal check. This ensures the check applies to all tiers, not only Tier 1. The robots.txt rules are cached for 24 hours in an in-process `Map<string, { rules: RobotsRules; expiresAt: number }>` maintained in `scrapingEngine/index.ts`. If the path is disallowed, the engine returns immediately without attempting any tier:
```json
{ "success": false, "error": "robots_txt_disallowed", "path": "/pricing" }
```

The agent prompt instructs: "If scraping is blocked by robots.txt, inform the user and suggest alternative data sources."

Opt-out: An org admin can set `scraping.respectRobotsTxt: false` in org settings to bypass robots.txt for the org. This is an org-wide setting, not a per-domain override. It is an admin-level decision, not an agent-level decision.

### 13c. Domain allowlist/blocklist

Org-level settings (stored in `organisations.settings` JSONB):
- `scraping.blockedDomains: string[]` — never scrape these domains
- `scraping.allowedDomains: string[]` — if set, ONLY scrape these domains (whitelist mode)
- `scraping.respectRobotsTxt: boolean` — defaults to `true`; set `false` to bypass robots.txt for all domains in this org

**Enforcement location:** Domain allowlist/blocklist checks are performed in `scrapingEngine/index.ts` as part of the same pre-flight gate as robots.txt — before any tier is dispatched. Blocked/non-allowlisted domains are rejected without attempting any fetch tier.

**Typed settings contract** (defined in `server/services/scrapingEngine/types.ts` alongside the other engine types):

```typescript
interface OrgScrapingSettings {
  respectRobotsTxt?: boolean;    // default true
  blockedDomains?: string[];     // exact domain matches (e.g., "example.com")
  allowedDomains?: string[];     // if non-empty, only these domains are scraped
}
```

**Read path:** `scrapingEngine/index.ts` reads `org.settings?.scraping` at the start of each scrape call. The `organisations.settings` JSONB field is already populated for every org (defaulting to `{}`). No migration is needed — this is an additive JSONB key. The `OrgScrapingSettings` type is local to the scraping engine and does not extend or require changes to any existing settings service (`orgSettingsService.ts`). No admin UI changes are required — these settings are configured directly via the org settings JSONB.

Default: no restrictions (all domains allowed, robots.txt respected).

### 13d. Cost tracking

Scraping actions are tracked via the existing `executeWithActionAudit` wrapper. The `runCostBreaker` circuit enforces `maxCostPerRunCents` — browser-tier scrapes (Tier 2/3) are more expensive and count toward the per-run cost budget.

### 13e. Content size limits

- Tier 1 HTTP: 1MB max response body
- Tier 2 Browser: 2MB max rendered HTML
- Tier 3 Scrapling: governed by MCP response size limit (`MAX_MCP_RESPONSE_SIZE = 100_000` bytes)
- Extracted content returned to agent: truncated at 50KB to prevent prompt bloat

**Hashing always uses the full extracted payload (before the 50KB agent truncation).** `contentHash` in `ScrapeResult` and `scraping_cache` is computed from the complete extracted content. Only the agent-facing `content` field is truncated. This ensures change detection (via workspace memory baselines) catches modifications anywhere in the page, not just the first 50KB.

---

## 14. Verification Plan

### 14a. Unit tests

- [ ] `httpFetcher.test.ts` — HTTP fetch with response parsing, challenge detection, size limits
- [ ] `adaptiveSelector.test.ts` — fingerprint creation, similarity scoring, threshold behaviour, re-match after DOM changes
- [ ] `contentExtractor.test.ts` — Readability extraction, markdown conversion, JSON extraction
- [ ] `selectorStore.test.ts` — upsert, load by pattern, hit/miss recording
- [ ] `rateLimiter.test.ts` — rate limit enforcement, cooldown, per-domain isolation

### 14b. Integration tests

- [ ] `scrapingEngine.test.ts` — tier escalation (mock Tier 1 failure → Tier 2 → Tier 3)
- [ ] `scrapeUrlSkill.test.ts` — full skill handler execution with mocked engine
- [ ] `scrapeStructuredSkill.test.ts` — first scrape (LLM extraction) + second scrape (selector reuse)
- [ ] `monitorWebpageSkill.test.ts` — baseline creation and scheduled task creation (first call only; re-run comparison is handled by the agent calling `scrape_structured`, not by this skill)

### 14c. End-to-end verification

- [ ] Agent calls `scrape_url` on a known public page → returns markdown content
- [ ] Agent calls `scrape_structured` on a pricing page → returns structured JSON → second call uses adaptive selectors (zero LLM)
- [ ] Agent calls `monitor_webpage` → scheduled task created → manual re-trigger detects content change
- [ ] Tier escalation: mock Tier 1 returning 403 → verify Tier 2 is attempted
- [ ] Scrapling MCP preset: add to org → verify `stealthy_fetch` tool is discoverable
- [ ] Strategic Intelligence Agent has scraping skills in its skill list (post-seed)
- [ ] Orchestrator routes "monitor competitor-x.com/pricing" to Strategic Intelligence Agent
- [ ] Works identically in org subaccount and regular subaccounts

### 14d. Gate checks

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (all existing + new tests)
- [ ] `npm run build` passes (client build unaffected)
- [ ] `npm run db:generate` produces clean migration

---

## 15. Phased Delivery

### Phase 1: Core scraping (`scrape_url`)

**Scope:**
- Scraping engine service with Tier 1 (HTTP) + Tier 2 (Playwright via IEE)
- Content extraction (Readability + turndown + cheerio)
- `scrape_url` skill definition, action registry entry, handler
- Scrapling MCP preset (Tier 3 available when admin configures it)
- Rate limiter, robots.txt, domain allowlist/blocklist
- Migration 0108: `scraping_selectors` + `scraping_cache` tables (created but unused until Phase 2)
- Strategic Intelligence Agent seed update (add `scrape_url`)
- Orchestrator routing update

**Unlocks:** Agents can scrape any URL with auto-escalation through tiers. JS-rendered pages work. Anti-bot sites escalate to Scrapling.

**Dependencies:** `@mozilla/readability`, `cheerio`, `turndown` (npm packages)

### Phase 2: Adaptive selectors (`scrape_structured`)

**Scope:**
- Adaptive selector engine (`adaptiveSelector.ts`, `selectorStore.ts`)
- LLM-assisted first-scrape extraction (json mode in `contentExtractor.ts`)
- `scrape_structured` skill definition, action registry entry, handler
- `scraping_selectors` table fully wired
- Strategic Intelligence Agent seed update (add `scrape_structured`)

**Unlocks:** Self-healing scrapers. First scrape learns selectors via LLM. Subsequent scrapes use pure DOM queries (zero LLM cost). Site redesigns handled automatically.

### Phase 3: Anti-detection hardening

**Scope:**
- Tier 1 TLS fingerprint impersonation (`curl-impersonate` integration)
- Tier 2 stealth plugins (`playwright-extra` + `puppeteer-extra-plugin-stealth`) enabled via `stealth: true` in IEE task metadata. **Phase 3 start: verify that the IEE worker contract (`worker/src/browser/`) accepts and applies `stealth: true` task metadata before committing to the no-worker-changes assumption. Worker changes may be required if the existing task contract does not support this passthrough.**
- Proxy rotation support in HTTP fetcher (when org provides proxy config — config source, schema, and auth contract to be spec'd at Phase 3 start)

**Unlocks:** Higher success rate on Tier 1 and 2 before needing Tier 3 (Scrapling). Reduces dependency on the MCP sidecar for moderately protected sites.

**Dependencies:** `curl-impersonate` binary or npm equivalent, `playwright-extra`, `puppeteer-extra-plugin-stealth`

### Phase 4: Monitoring (`monitor_webpage`)

**Scope:**
- `monitor_webpage` skill definition, action registry entry, handler
- Auto-creation of `scheduledTasks` from skill parameters
- `scraping_cache` table fully wired for dedup caching; workspace memory (`workspaceMemoryService`) used for monitoring baselines
- Content diffing (hash-based for general, field-by-field for structured)
- Strategic Intelligence Agent seed update (add `monitor_webpage`)
- Cache cleanup job (expire entries past TTL) — register in `queueService.ts`
- Define and document `scraping_cache` read/write contract (lookup query, write-on-miss upsert, TTL eviction query, bypass rules)
- `runContextLoader.ts` — detect skill-typed scheduled task briefs (`"type": "<skill>_run"`), extract `## Scheduled Run Instructions` from the matching skill file, inject into agent system context for that run
- Add `## Scheduled Run Instructions` section to `server/skills/monitor_webpage.md` with the step-by-step monitoring protocol

**Unlocks:** Continuous monitoring: competitor pricing, regulatory changes, news alerts. Agent creates the schedule once, runs silently, reports only when something changes.

---

## 16. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Scrapling maintainer goes inactive** | Medium | Tier 3 is a swappable MCP sidecar. Replace with commercial proxy API preset (ScrapingBee, BrightData) — one entry change in `mcpPresets.ts`. Tiers 1-2 are fully native. |
| **Adaptive selectors false-match** | Low | Confidence threshold at 0.85. Below threshold, `selector_uncertain` returned — agent requests human verification. `hit_count`/`miss_count` tracking provides observability. |
| **Legal/ethical scraping concerns** | Medium | robots.txt respected by default. Rate limiting per domain. Org-level allowlist/blocklist. Scraping disclaimer in terms of service. |
| **Anti-bot arms race** | Low | We don't try to win the arms race on Tiers 1-2. Tier 3 (Scrapling, actively maintained) handles the hard cases. If Scrapling fails, commercial proxy services are the fallback. |
| **LLM cost on first structured scrape** | Low | One LLM call per new site/field-set. All subsequent scrapes use adaptive selectors — zero LLM cost. Cost tracked via `runCostBreaker`. |
| **Performance at scale** | Low | HTTP tier: <100ms for 90% of requests. Adaptive selector scan: <10ms for typical pages. Browser tier: 5-15s per page (existing IEE performance). Phase 4+: cache prevents redundant scrapes within TTL. |
| **Memory bloat from large pages** | Low | Response size capped per tier (1MB HTTP, 2MB browser, 100KB MCP). Extracted content truncated at 50KB before returning to agent. |
| **Scheduled task proliferation from monitor_webpage** | Low | `monitor_webpage` action is review-gated (`defaultGateLevel: 'review'`). Human approves each monitoring setup. Scheduled tasks have standard cleanup policies. |

---

## Summary of Files Changed/Created

### New files

| File | Type | Phase |
|------|------|-------|
| `server/services/scrapingEngine/index.ts` | Service | 1 |
| `server/services/scrapingEngine/types.ts` | Types | 1 |
| `server/services/scrapingEngine/httpFetcher.ts` | Service | 1 |
| `server/services/scrapingEngine/browserFetcher.ts` | Service | 1 |
| `server/services/scrapingEngine/scraplingFetcher.ts` | Service | 1 |
| `server/services/scrapingEngine/contentExtractor.ts` | Service | 1 |
| `server/services/scrapingEngine/rateLimiter.ts` | Service | 1 |
| `server/services/scrapingEngine/adaptiveSelector.ts` | Service | 2 |
| `server/services/scrapingEngine/selectorStore.ts` | Service | 2 |
| `server/db/schema/scrapingSelectors.ts` | Schema | 1 |
| `server/db/schema/scrapingCache.ts` | Schema | 1 |
| `server/skills/scrape_url.md` | Skill def | 1 |
| `server/skills/scrape_structured.md` | Skill def | 2 |
| `server/skills/monitor_webpage.md` | Skill def | 4 |
| `migrations/0108_scraping_engine.sql` | Migration | 1 |

### Modified files

| File | Change | Phase |
|------|--------|-------|
| `server/services/skillExecutor.ts` | Add 3 handler entries | 1-4 |
| `server/config/actionRegistry.ts` | Add 3 action definitions | 1-4 |
| `server/config/mcpPresets.ts` | Add Scrapling preset | 1 |
| `server/db/schema/index.ts` | Export new tables | 1 |
| `server/services/queueService.ts` | Register cache cleanup job | 4 |
| `server/services/runContextLoader.ts` | Add skill-typed scheduled run instructions injection (detect `"type": "<skill>_run"` brief, extract `## Scheduled Run Instructions` from skill file, prepend to agent system context) | 4 |
| `companies/automation-os/agents/strategic-intelligence-agent/AGENTS.md` | Add scraping skills + prompt section | 1-4 |
| `companies/automation-os/agents/orchestrator/AGENTS.md` | Add routing keywords | 1, 4 |
| `package.json` | Add `@mozilla/readability`, `cheerio`, `turndown` deps | 1 |

**Worker files:** No changes to `worker/src/browser/` are required. The existing IEE task contract is already sufficient for Tier 2 browser fetching. Phase 3 will add stealth plugin configuration but this does not require worker file changes — it will be passed via task metadata.

**Test files:** Unit and integration test files named in section 14 are intentionally excluded from this inventory. They are created alongside their corresponding implementation files and follow the `*Pure.ts` + `*.test.ts` convention.

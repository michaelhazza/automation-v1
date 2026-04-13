# Spec Review HITL Checkpoint — Iteration 1

**Spec:** `docs/geo-seo-spec.md`
**Spec commit:** `d3401cab3ba36b0813a1172c249bfd3a8a1f2775`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 1 of 5
**Timestamp:** 2026-04-13T05:30:00Z

This checkpoint blocks the review loop. Resolve by editing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

---

## Finding 1.1 — read-only contract vs processOutputStep side effect

**Classification:** directional
**Signal matched:** Architecture signals: "Change the interface of X" / Framing: spec claims no side effects but ships a write path
**Source:** Codex
**Spec section:** §1 Design philosophy (lines 39-41), §4 Properties table (`idempotencyStrategy`), §8.3 Score persistence

### Codex's finding (verbatim)

> the spec contradicts its own "methodology/read-only" contract. §1 says GEO skills are "pure prompt scaffolds" with "no programmatic side effects" and "no custom TypeScript handler logic" (lines 39-41). §4 then declares `idempotencyStrategy: 'read_only'` and "No side effects" (line 580), but §8.3 adds a `processOutputStep` hook that writes to `geo_audit_scores` via `geoAuditService.saveScore()`. That is a side effect and makes `audit_geo` no longer read-only in practice.

### Tentative recommendation (non-authoritative)

Change `audit_geo`'s `idempotencyStrategy` to `'write'` (or similar) and split it out of the shared methodology batch into its own action registry entry. Update §1 "Design philosophy" to say "7 of the 8 GEO skills are pure read-only methodology skills; `audit_geo` additionally triggers score persistence via a post-output hook." This is marked tentative — it changes the `audit_geo` action registry contract and the §1 framing.

### Reasoning

§1 and §4 both say all 8 skills are pure read-only methodology skills, but §8.3 explicitly wires a DB-write side effect on `audit_geo`. These are incompatible: either `audit_geo` needs its own non-read-only action registry entry, or the persistence needs a different mechanism (e.g. a separate post-run job not tied to the methodology skill pipeline). This is an architecture decision the human must own.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Give `audit_geo` its own standalone action registry entry (outside the methodology batch) with `idempotencyStrategy: 'write'` and `isMethodology: false`. The 7 sub-skills (geo_citability, geo_crawlers, geo_schema, geo_platform_optimizer, geo_brand_authority, geo_llmstxt, geo_compare) remain in the methodology batch with `read_only`. Update §1 design philosophy to clarify: "The 7 sub-skills are pure read-only methodology skills. `audit_geo` is the orchestrator — it runs the audit AND triggers score persistence via a processOutputStep hook, making it a write-path action." Update §4 to move `audit_geo` out of the shared batch properties table and give it its own ActionDefinition entry with the corrected properties. Keep SKILL_HANDLERS mapping `audit_geo: SKILL_HANDLERS.generic_methodology` (the handler handles execution; idempotency is a registry-level concern). Equivalence test count stays at 113 — all 8 slugs still need SKILL_HANDLERS entries.
```

## Finding 1.2 — missing machine-readable score output contract

**Classification:** directional
**Signal matched:** Architecture signals: "Add a new cross-cutting contract" / Load-bearing claim without a contract
**Source:** Codex
**Spec section:** §3.1 `audit_geo` output format, §8.3 Score persistence (processOutputStep)

### Codex's finding (verbatim)

> score persistence depends on a missing machine contract. §3.1 defines `audit_geo` output as human-readable markdown tables and sections, but §8.3 says a processor will "parse dimension scores from the agent's structured output." There is no JSON schema, fenced payload, field naming map, or nullability contract for `platformScoresJson`, `crawlerAccessJson`, `llmsTxtExists`, `schemaTypesFound`, or `traditionalSeoScore`. This is the main missing contract in the document.

### Tentative recommendation (non-authoritative)

Add a machine-readable payload block to the `audit_geo` output format — a JSON fenced section the agent must emit, e.g.:

```
<!-- GEO_SCORE_PAYLOAD
{ "compositeScore": 72, "dimensions": { "citability": 80, "brandAuthority": 65, ... },
  "platformScores": {...}, "crawlerAccess": {"allowed": [...], "blocked": [...]},
  "llmsTxtExists": false, "schemaTypesFound": [...], "traditionalSeoScore": 68 }
-->
```

The `processOutputStep` parser extracts this block. This is tentative because: (a) the payload format is a product decision; (b) a hidden-comment approach vs a dedicated section are both valid; (c) this interacts with Finding 1.1 — if the processOutputStep approach is rejected, this contract becomes moot.

### Reasoning

Without a machine-readable contract, the `processOutputStep` has no stable parsing target. The §3.1 output is a human-readable markdown report — no reliable extraction is possible without a defined format. Resolving Finding 1.1 first is recommended: if the persistence approach changes (e.g. moves to a post-run job instead of a processOutputStep hook), the machine-readable format contract changes too.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Add a mandatory `GEO_SCORE_PAYLOAD` JSON block to the `audit_geo` output format in §3.1. Append it after the "30-Day Improvement Roadmap" section. The block must use this exact format and field names (matching the §5 Drizzle schema columns exactly):

```json
<!-- GEO_SCORE_PAYLOAD
{
  "dimensions": {
    "citability": <0-100 or null>,
    "brandAuthority": <0-100 or null>,
    "contentQuality": <0-100 or null>,
    "technicalInfra": <0-100 or null>,
    "structuredData": <0-100 or null>,
    "platformSpecific": <0-100 or null>
  },
  "platformScores": {
    "googleAio": <0-100 or null>,
    "chatgpt": <0-100 or null>,
    "perplexity": <0-100 or null>,
    "gemini": <0-100 or null>,
    "bingCopilot": <0-100 or null>
  },
  "crawlerAccess": {
    "allowed": ["GPTBot", "ClaudeBot", ...],
    "blocked": ["PerplexityBot", ...]
  },
  "llmsTxtExists": <true|false|null>,
  "schemaTypesFound": ["Organization", "Article", ...],
  "traditionalSeoScore": <0-100 or null>
}
-->
```

Add a parser contract note to §8.3: "The processOutputStep extracts the `GEO_SCORE_PAYLOAD` HTML comment block from the output. Field names map 1:1 to the Drizzle schema columns in §5. Missing or null dimension scores are stored as NULL in the DB and excluded from composite score weighting via the redistribution logic in `computeCompositeScore`."
```

## Finding 1.3 — route params vs implementation drift (from/to, subaccount_ids)

**Classification:** ambiguous
**Source:** Codex
**Spec section:** §8.1 Routes — query parameters table, route code samples

### Codex's finding (verbatim)

> the routes section documents filters the sample implementation does not implement. §8.1 says the list endpoint accepts `from` / `to` and the portfolio endpoint accepts `subaccount_ids`, but the sample code only reads `site_url` and `limit`, and `getOrgScores()` takes no filter args. That is contract drift in the same section. `getSubaccountScores()` also exists in the service but no route uses it.

### Tentative recommendation (non-authoritative)

Remove `from` / `to` from the list endpoint's query parameters table and `subaccount_ids` from the portfolio endpoint's query parameters table, since neither is implemented in the route code or service signatures. Add a Phase 2 note that date-range filtering and per-subaccount filtering will be added when the GEO dashboard is built. This is tentative — the human may prefer to implement these in Phase 1 instead, in which case the route sample code needs updating rather than the docs table.

### Reasoning

Either the API docs table is over-specified (remove the unimplemented params) or the route implementation is under-built (add the params). Ambiguous because either fix is reasonable and the trade-off affects Phase 1 scope.

### Decision

```
Decision: apply
```

---

## Finding 1.4 — site_url canonicalisation under-specified

**Classification:** ambiguous
**Source:** Codex
**Spec section:** §5 Schema Design (`site_url` column), §6.1 geoAuditService.ts (saveScore, getScoreHistory, getLatestScore)

### Codex's finding (verbatim)

> `site_url` storage/query is under-specified and likely to fragment history. The spec stores raw `site_url` in the table, saves it as-is, and queries by exact equality. There is no canonicalisation rule for scheme, trailing slash, lowercase host, homepage path, or redirects, so `https://example.com`, `https://example.com/`, and `http://example.com` can become separate histories.

### Tentative recommendation (non-authoritative)

Add a brief caller-responsibility note to §6.1: "Callers must normalise `siteUrl` before passing to service methods: lowercase scheme + host, strip trailing slash, use `https://` if scheme omitted. The service stores and queries the value as-is." This is tentative — the human may prefer the normalisation to live in the service itself, or may want to accept URL fragmentation as a known limitation for Phase 1.

### Reasoning

Without a canonicalisation rule, history queries will silently fail to find prior audits when URLs differ by trailing slash or scheme. Whether normalisation belongs at the service layer, route layer, or caller is ambiguous. A simple caller-note is the minimum fix; adding a helper to the service is slightly more scope.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Put canonicalisation in `geoAuditServicePure.ts` as an exported helper `canonicaliseSiteUrl(url: string): string` — lowercase scheme+host, strip trailing slash, strip default ports, enforce https. Call it at the top of `saveScore`, `getScoreHistory`, and `getLatestScore` before the DB operation. Add the helper to §6.2 (pure helper) and note its use in §6.1. This is preferable to a caller-note because it's an invariant the service should own — callers shouldn't need to know the storage format. Also add the pure helper to `server/services/__tests__/geoAuditServicePure.test.ts` with 4-5 test cases.
```

## Finding 1.4 — site_url canonicalisation under-specified (duplicate heading — see above)

## Finding 1.5 — scoring dimension overlap / double-counting

**Classification:** directional
**Signal matched:** Architecture signals: "Change the interface of X" (the scoring methodology)
**Source:** Codex
**Spec section:** §3.1 Scoring Framework table, §3.4 geo_schema, §3.5 geo_platform_optimizer, §7.2 Master prompt dimensions

### Codex's finding (verbatim)

> scoring boundaries overlap and will double-count the same evidence. `geo_schema` scores `author`, `datePublished`, `dateModified`, and `speakable`. `geo_platform_optimizer` also scores `speakable`, author/date attribution, and topical authority. `Content Quality / E-E-A-T` is inline but also covers authoritativeness/trust signals. `Brand Authority` uses `sameAs`, Knowledge Panel, and citation density. Without explicit demarcation rules, the same author/date/entity evidence can inflate multiple dimensions.

### Tentative recommendation (non-authoritative)

Add a "Dimension demarcation rules" subsection to §3.1: "Structured Data (`geo_schema`) owns JSON-LD property presence/validity. Platform-Specific (`geo_platform_optimizer`) owns each engine's programmatic requirements. Signals that appear in both dimensions are scored once in the dimension that owns the canonical check; the other dimension notes the dependency without re-scoring." This is tentative — it may require revising individual skill instructions (§3.3–3.6) and the master prompt (§7.2).

### Reasoning

Whether to add demarcation rules, restructure skill boundaries, or accept deliberate overlap as a design choice (dimensions aren't meant to be orthogonal) is a product decision about the scoring methodology. This is directional.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Reject rigid demarcation rules — the overlap is intentional and matches the source reference implementation (github.com/zubair-trabzada/geo-seo-claude), where dimensions deliberately reward depth of compliance across multiple axes. A site with good `speakable` JSON-LD gets credit both in Structured Data (correctly implemented schema) and Platform-Specific (Google AI Overviews readiness) — these are genuinely distinct assessments. Instead, add a brief note to §3.1 under the Scoring Framework table: "Dimension scores are independent assessments — some signals (e.g. `speakable`, author attribution) intentionally appear in multiple dimensions because they satisfy distinct criteria in each. This rewards depth of compliance and is by design." No skill instructions or master prompt changes needed.
```

## Finding 1.6 — Technical Infrastructure dimension vs geo_crawlers scope

**Classification:** directional
**Signal matched:** Scope signals: "Add this item to the roadmap" (CWV) / "Remove this item" (narrow dimension name)
**Source:** Codex
**Spec section:** §3.1 Scoring Framework table (Technical Infrastructure row), §3.3 geo_crawlers.md

### Codex's finding (verbatim)

> "Technical Infrastructure" is broader than the only shipped skill for that dimension. The scorecard defines it as "AI crawler access, Core Web Vitals indicators, crawlability" (line 153), but `geo_crawlers.md` only specifies robots.txt, headers, meta robots, and sitemap checks. There is no contract for where CWV or crawlability signals actually come from.

### Tentative recommendation (non-authoritative)

Either: (a) rename the dimension from "Technical Infrastructure" to "AI Crawler Access" everywhere it appears (§3.1 table, §5 schema field `technicalInfraScore`, §5 Drizzle schema field `technical_infra_score`, §7.2 master prompt item 4), or (b) add an explicit note to §3.3 `geo_crawlers` that CWV signals are inferred from page response indicators when the agent fetches pages. This is tentative — option (a) is a rename across multiple spec sections and the DB schema field name; option (b) expands the skill scope to include CWV analysis.

### Reasoning

The dimension name promises something the spec doesn't deliver. Renaming to match the shipped scope is mechanical in isolation but propagates across many spec sections and the DB schema — making it a scope-touch concern. The human should decide: narrow the name or expand the skill.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Expand `geo_crawlers` scope in §3.3 to include page speed and Core Web Vitals indicators — consistent with the source reference implementation (geo-technical skill in the GitHub repo) which explicitly includes "page speed, server-side rendering, and Core Web Vitals." Add a new scoring section to §3.3: "Page Speed Indicators (assessed from HTTP response time and HTML signals — no RUM data): response time >3s: -10, no viewport meta: -5, no HTTPS: -15." Keep the "Technical Infrastructure" dimension name and `technicalInfraScore` / `technical_infra_score` field names unchanged. Do NOT rename the DB column — it would require a schema migration change on top of Phase 1. The expanded skill scope closes the gap between the dimension name and the actual skill coverage.
```

## Finding 1.7 — parentSystemAgentId topology unresolved

**Classification:** directional
**Signal matched:** Architecture signals: three-tier model topology decision
**Source:** Rubric (unresolved decisions)
**Spec section:** §7.1 System agent definition (`parentSystemAgentId` row)

### Codex's finding (verbatim)

> §7.1 leaves `parentSystemAgentId` as "(set to the Content/SEO agent if one exists, else null)." Implementation-ready specs should not leave identity and seeding topology as open choices.

### Tentative recommendation (non-authoritative)

Set `parentSystemAgentId` to `null`. The GEO-SEO agent is a standalone specialist; connecting it to an unnamed "Content/SEO agent if one exists" introduces a conditional dependency on a parent agent whose existence and ID aren't known at spec time. Leaving it null is safe and doesn't prevent a human from linking it later. This is tentative — the human may want it connected to a specific parent.

### Reasoning

`parentSystemAgentId` affects where the agent appears in the system agent hierarchy and how orchestrators hand off to it. A conditional "if one exists" is not resolvable at implementation time without checking the live DB state. Setting it to `null` explicitly is the safe default; the human should confirm.

### Decision

```
Decision: apply
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path: `docs/geo-seo-spec.md`
3. The agent will read this checkpoint file as its first action, honour each decision (apply, apply-with-modification, reject, or stop-loop), and continue to iteration 2.

If you want to stop the loop entirely, set any decision to `stop-loop` and the loop will exit after honouring already-resolved decisions.

**Note:** Findings 1.1 and 1.2 are coupled — the score output contract (1.2) depends on the persistence mechanism chosen in 1.1. Resolve 1.1 first, then 1.2.

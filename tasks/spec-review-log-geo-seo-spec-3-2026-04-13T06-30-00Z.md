# Spec Review Log — geo-seo-spec — Iteration 3

**Spec:** `docs/geo-seo-spec.md`
**Iteration:** 3
**Timestamp:** 2026-04-13T06:30:00Z
**Spec commit at start of iteration:** d3401cab3ba36b0813a1172c249bfd3a8a1f2775 (uncommitted changes from iteration 2 applied)

---

## Codex Findings (12 total)

All 12 findings from Codex iteration 3 were classified as mechanical. No directional or ambiguous findings.

---

## Mechanical Findings — Decisions

[ACCEPT] §3.1 instructions — step 1 still reads as if agent calls getLatestScore() directly
  Fix applied: Rewrote step 1 to clarify the platform injects `previousScore` into the run context; the agent reads it, not calls the service.

[ACCEPT] §2 Q3 — "per-org override column reserved in schema" is false for Phase 1
  Fix applied: Clarified that no column is reserved in the Phase 1 schema; Phase 2 adds a column to the `organisations` table.

[ACCEPT] §6.1 `saveScore` — `platformScores` param typed as `Record<string, number>` but payload has named keys with null values
  Fix applied: Changed type to explicit named-key object (`googleAio?`, `chatgpt?`, `perplexity?`, `gemini?`, `bingCopilot?`) all typed as `number | null`.

[ACCEPT] §6.1 `getSubaccountScores` / `getOrgScores` — `db.execute()` result not typed correctly
  Fix applied: Added `result.rows as GeoAuditScore[]` extraction pattern to both methods. Added `GeoAuditScore` type import.

[ACCEPT] §8.1 `/latest` route — no 404 vs null contract documented
  Fix applied: Added explicit not-found contract: `res.json(score ?? null)` with comment "return 200 with null (not 404) — absence of a score is a normal state."

[ACCEPT] §3.8 `geo_compare` — Composite column has no formula; unclear which dimensions are included
  Fix applied: Added note under Composite row: formula is weighted average of the 5 directly-assessed dimensions (AI Citability 25%, Crawlers 20%, Structured Data 20%, Brand Authority 20%, llms.txt boolean 15%). Content Quality/E-E-A-T and Platform-Specific excluded with rationale.

[ACCEPT] §3.5 `geo_platform_optimizer` — "Dimension score: Average of per-platform scores" does not address null platforms
  Fix applied: Replaced with explicit rule: "Average of non-null per-platform scores. Platforms that cannot be assessed should be scored null and excluded from the average rather than scored 0."

[ACCEPT] §3.2 `geo_citability` / §3.4 `geo_schema` — no constraint on page_url vs page_content mutual exclusivity
  Fix applied: Added constraint note to both skills: at least one of `page_url` or `page_content` must be supplied; if both, `page_content` takes precedence; if neither, return error result.

[ACCEPT] §9 Phase 1 table — Step 12 (routes) missing Step 2 (pure helper + constants) as dependency (routes use `canonicaliseSiteUrl` and `GEO_SCORE_HISTORY_DEFAULT_LIMIT`)
  Fix applied: Added "Step 2" to Step 12's Depends-on column (now "Steps 2, 4").

[ACCEPT] §7.4 Dev fixtures — "Phase 5" reference is dangling (spec only defines Phases 1, 2, 3)
  Fix applied: Changed to "Phase 1, Step 15 or a dedicated dev-data pass after Step 11."

[ACCEPT] §3.3 `geo_crawlers` — no rule for `unknown` state when robots.txt is missing or inaccessible
  Fix applied: Added three-state definitions (allowed / blocked / unknown) with explicit unknown semantics: -10 inaccessible penalty, no crawler-blocked deductions applied. Added "robots.txt inaccessible" row to deductions table.

[ACCEPT] §3.1 `audit_geo` — `competitor_urls` handoff to `geo_compare` is under-specified (no dedup, max count, or minimum count rule)
  Fix applied: Added handoff contract note under `competitor_urls` parameter: trim, deduplicate (case-insensitive), cap at 3, skip `geo_compare` entirely if fewer than 2 remain.

---

## Rejected Findings

None.

---

## Rubric Pass (own findings)

No additional rubric findings beyond what Codex surfaced. Iteration 3 rubric pass found the same issues (all now applied above).

---

## Iteration 3 Summary

- Mechanical findings accepted:  12 (all Codex findings)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          none this iteration
- HITL status:                   none
- Spec commit after iteration:   d3401cab3ba36b0813a1172c249bfd3a8a1f2775 (uncommitted changes in working tree)

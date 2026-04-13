# Spec Review Log — geo-seo-spec — Iteration 2

**Spec:** `docs/geo-seo-spec.md`
**Iteration:** 2
**Timestamp:** 2026-04-13T06:00:00Z
**Spec commit at start of iteration:** d3401cab3ba36b0813a1172c249bfd3a8a1f2775 (uncommitted changes from iteration 1 HITL resolution applied)

---

## Codex Findings (7 total)

All 7 findings from Codex iteration 2 were classified as mechanical. No directional or ambiguous findings.

---

## Mechanical Findings — Decisions

[ACCEPT] §3 intro (line 118) + §11 KNOWLEDGE.md draft — stale "All 8 skills are methodology skills" text contradicts §1/§4 decisions
  Fix applied: Updated §3 intro to clarify `audit_geo` is `isMethodology: false` and 7 sub-skills are `isMethodology: true`. Rewrote KNOWLEDGE.md draft entry in §11 to accurately reflect the `audit_geo` distinction.

[ACCEPT] §3.1 output format note + §8.3 parser contract — "1:1" mapping claim is misleading (payload is nested, schema is flat)
  Fix applied: Replaced "Field names match 1:1" with accurate description of nested-to-flat mapping. Added explicit field mapping table to §8.3 parser contract.

[ACCEPT] §3.1 instructions — audit workflow missing step to fetch previous score for trend indicator
  Fix applied: Added step 1 to `audit_geo` instructions: "call `geoAuditService.getLatestScore()` before fetching pages to retrieve previous score for trend indicator." Renumbered steps accordingly.

[ACCEPT] §3.7 `geo_llmstxt` — "Generate recommended llms.txt content" contradicts §2 Q6 read-only decision
  Fix applied: Changed §3.7 wording from "Generate recommended `llms.txt` content" to "Produce a recommended `llms.txt` template in the skill output for the agency to implement (read-only)." Also updated §4 action registry description to remove ambiguous "Analyse or recommend."

[ACCEPT] §9 Phase 1 table — Step 11 (seed script) missing Step 9 (skill backfill) as dependency
  Fix applied: Added "Step 9" to Step 11's Depends-on column.

[ACCEPT] §8.1 route code — missing input validation for `limit` (NaN) and `site_url` (canonicaliseSiteUrl throws)
  Fix applied: Added explicit validation for both inputs in list and latest endpoints. Added `canonicaliseSiteUrl` and `GEO_SCORE_HISTORY_DEFAULT_LIMIT` imports. Added try-catch around `canonicaliseSiteUrl` call for 400 response on malformed URL.

[ACCEPT] §5 schema + §3.1 payload — crawlerAccess values are ambiguous (human labels vs User-Agent strings)
  Fix applied: Added comment to Drizzle schema `crawlerAccessJson` specifying values must be User-Agent strings from §3.3 table. Added note to `GEO_SCORE_PAYLOAD` comment block. (FacebookBot row in §3.3 clarifies: human label = FacebookBot, User-Agent = FacebookExternalHit.)

---

## Rejected Findings

None.

---

## Rubric Pass (own findings)

No additional rubric findings beyond what Codex surfaced. Iteration 2 rubric pass found the same issues (all now applied above).

---

## Iteration 2 Summary

- Mechanical findings accepted:  7 (all Codex findings)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          none this iteration
- HITL status:                   none
- Spec commit after iteration:   d3401cab3ba36b0813a1172c249bfd3a8a1f2775 (uncommitted changes in working tree)

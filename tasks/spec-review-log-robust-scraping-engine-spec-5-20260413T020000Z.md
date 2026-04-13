# Spec Review Log — Iteration 5

**Spec:** `docs/robust-scraping-engine-spec.md`
**Iteration:** 5 of 5
**Timestamp:** 2026-04-13T02:00:00Z

---

## Pre-iteration HITL Application

Spec commit at start: 71ce9477d60b24a88cde7a332258934ed413f9a8 (working tree modified)
Spec-context commit: 7cc51443210f4dab6a7b407f7605a151980d2efc

**Finding 4.4 — apply-with-modification:** Applied. (1) Deferral note added to §9b. (2) Bullet added to §15 Phase 4. (3) §16 risk row updated to "Phase 4+: cache prevents redundant scrapes within TTL."

**Finding 4.5 — reject:** No changes. URL-level cache key is acceptable for 3600s best-effort dedup guard; extraction-key disambiguation is over-engineering for pre-production.

## Codex Findings Classification

Codex returned 8 findings (output duplicated in CLI; deduplicated here).

[ACCEPT] §7c — `remember: false` read/write semantics contradiction with §4b
  Fix: Updated §7c to state `remember` controls writes only; existing selectors always used for DOM extraction regardless of `remember`.

[ACCEPT] §2e — Tier 3 capability boundary for DOM-dependent scrape_url modes
  Fix: Added explicit boundary note — json/css_selectors modes cap escalation at Tier 2; Tier 3 only attempted for text/markdown modes without explicit selectors.

[ACCEPT] §6c — monitor_webpage idempotency key missing organisationId
  Fix: Key now includes organisationId + (subaccountId ?? 'org') to prevent cross-org collision when subaccountId is null.

[ACCEPT] §7d step 5 — brief format parse-unsafe for URLs and free-form text
  Fix: Brief format changed from prose Key: value. to JSON string. serializeMonitorBrief/parseMonitorBrief contract updated to JSON.stringify/JSON.parse.

[DIRECTIONAL → final report] §7d step 5, §11a, §12a — recurring monitoring relies on emergent agent behavior
  Signal: Architecture signals — "Introduce a new abstraction / service / pattern", "This should be its own service."
  Not auto-applied. Spec explicitly chose agent-driven execution. Recorded in final report for human review.

[ACCEPT] §13b, §13c — robots.txt and allowlist enforcement scoped to Tier 1 only
  Fix: Updated §13b to specify check lives in scrapingEngine/index.ts as pre-flight gate. §13c enforcement-location note added.

[ACCEPT] §4b — missing field-key canonicalization contract
  Fix: Added canonicalizeFieldKey spec (split, trim, lowercase, snake_case). LLM prompted with pre-normalized keys; DOM extraction and monitor comparison use same canonical keys.

[ACCEPT] §2d Phase note, §15 Phase 3 — unverified "no worker changes required" claim
  Fix: Downgraded to Phase 3 verification item. "Verify IEE worker accepts stealth: true metadata; worker changes may be required."

## Rubric Pass

Own rubric pass found no additional findings beyond the 8 Codex raised.
- Contradictions: Finding 5.1 covered.
- Stale retired language: none.
- Load-bearing claims without contracts: Findings 5.2, 5.4, 5.7, 5.8 covered.
- File inventory drift: none.
- Schema overlaps: none new.
- Sequencing bugs: none.
- Invariants not enforced: Finding 5.6 covered.
- Missing verdicts: all phases have verdicts.
- Unnamed primitives: canonicalizeFieldKey added and named.

## Iteration 5 Summary

- Mechanical findings accepted:  7
- Mechanical findings rejected:  0
- Directional findings:          1 (deferred to final report — final iteration, no loop continues)
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          none (final iteration)
- HITL status:                   none
- Spec commit after iteration:   working tree modified (not yet committed)

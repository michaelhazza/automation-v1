# Spec Review Final Report

**Spec:** `docs/robust-scraping-engine-spec.md`
**Spec commit at start:** `71ce9477d60b24a88cde7a332258934ed413f9a8`
**Spec commit at finish:** working tree modified (not yet committed)
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iterations run:** 5 of 5
**Exit condition:** iteration-cap

---

## Iteration Summary Table

| # | Codex findings | Rubric findings | Accepted | Rejected | Directional | Ambiguous | HITL status |
|---|---|---|---|---|---|---|---|
| 1 | ~6 | 2 | 5 | 2 | 1 | 0 | resolved |
| 2 | ~5 | 1 | 4 | 2 | 0 | 0 | none |
| 3 | ~4 | 1 | 3 | 1 | 1 | 0 | resolved |
| 4 | 2 | 0 | 0 | 0 | 2 | 0 | resolved |
| 5 | 8 | 0 | 7 | 0 | 1 | 0 | none (final iteration) |

*Iterations 1–3 counts are approximate from prior session logs. Iteration 4 and 5 counts are exact.*

## Mechanical Changes Applied

Changes are listed by iteration and spec section. Earlier iterations (1–3) are summarised from prior session; iterations 4–5 are exact.

### Iterations 1–3 (prior session — summary)

Changes across iterations 1–3 addressed: phase sequencing in §15, file inventory alignment, stale language in §2e, contradiction between §3b and §9a on upsert semantics, under-specified `selectorGroup` semantics in §3d, missing `monitor_webpage` gating rationale in §6c, clarification of `executeWithActionAudit` idempotency contract in §7d, cache vs workspace memory source-of-truth statement in §7d step 6.

### Iteration 4 — HITL decisions applied at iteration 5 start

**§9b — scraping_cache deferral note:**
- Added explicit deferral block: "The cache read/write contract (lookup query, write-on-miss upsert, TTL eviction query, and bypass rules) is deferred to Phase 4."

**§15 Phase 4 — cache contract bullet:**
- Added: "Define and document `scraping_cache` read/write contract (lookup query, write-on-miss upsert, TTL eviction query, bypass rules)"

**§16 performance-at-scale risk row:**
- Changed "Cache prevents redundant scrapes within TTL" → "Phase 4+: cache prevents redundant scrapes within TTL"

### Iteration 5

**§7c — `remember` read/write semantics clarification:**
- Updated handler description: `remember` controls writes only; existing selectors always used for DOM extraction regardless of `remember` value. Removes contradiction with §4b.

**§2e — Tier 3 capability boundary for DOM-dependent modes:**
- Added explicit boundary: `scrape_url` with `output_format: 'json'` or `css_selectors` caps escalation at Tier 2. Tier 3 only attempted for text/markdown modes without explicit selectors.

**§6c — monitor_webpage idempotency key scoped to organisation:**
- Key formula updated to include `organisationId + (subaccountId ?? 'org')`, preventing cross-org collision when subaccountId is null.

**§7d step 5 — monitor brief format changed to JSON:**
- Brief format changed from prose `Key: value.` (parse-unsafe for URLs and free-form text) to JSON string. `serializeMonitorBrief` uses `JSON.stringify`; `parseMonitorBrief` uses `JSON.parse` with validation.

**§13b — robots.txt enforcement location:**
- Updated to specify check lives in `scrapingEngine/index.ts` as a pre-flight gate before any tier dispatch (not inside `httpFetcher.ts` only).

**§13c — domain allowlist/blocklist enforcement location:**
- Added enforcement-location note: checks performed in `scrapingEngine/index.ts` pre-flight, before any tier dispatch.

**§4b — field-key canonicalization contract:**
- Added `canonicalizeFieldKey` specification: split on commas, trim, lowercase, replace spaces/hyphens with underscores, strip non-`[a-z0-9_]`. LLM prompted with pre-normalized keys. DOM extraction and monitor comparison use same canonical keys.

**§2d Phase note and §15 Phase 3 — IEE stealth plugin claim downgraded:**
- Changed from unverified claim ("no worker changes required — the existing IEE task contract already handles this") to Phase 3 verification item ("verify IEE worker accepts stealth: true metadata at Phase 3 start; worker changes may be required").

## Rejected Findings

**Iteration 4 — Finding 4.5: scraping_cache key `(org, subaccount, url)` doesn't distinguish extraction intents**
- Section: §9b, §10
- Description: Codex suggested adding an `extraction_key` column to disambiguate different extraction intents on the same URL.
- Rejection reason: scraping_cache is a 3600s best-effort dedup guard. The worst-case collision (same URL, different extraction intent within 1 hour) results in a cache miss and fresh fetch — no data loss, self-healing. Adding an extraction_key column is over-engineering for pre-production. Also deferred to Phase 4 scope alongside the cache contract.

No other findings were rejected across all 5 iterations. (Some findings from iterations 1–3 were rejected; exact records are in the prior session's log files.)

## Directional and Ambiguous Findings (resolved via HITL)

### Iteration 1 — Finding resolved via HITL (prior session)
Details in prior session checkpoint file. Resolution: applied.

### Iteration 3 — Finding resolved via HITL (prior session)
Details in prior session checkpoint file. Resolution: applied.

### Iteration 4 — Finding 4.4: scraping_cache has no runtime contract
- Classification: directional
- Signal: Scope signal — bring contract forward to Phase 1 scope or defer explicitly.
- Human's decision: apply-with-modification
- Modification applied: (1) Deferral note added to §9b. (2) Phase 4 bullet added. (3) §16 risk row updated to "Phase 4+."

### Iteration 4 — Finding 4.5: scraping_cache key ambiguity
- Classification: directional
- Signal: Architecture signal — schema/interface change.
- Human's decision: reject
- Reason: 3600s best-effort dedup cache; collisions are self-healing; over-engineering for pre-production.

## Directional Finding at Final Iteration (not resolvable via loop)

### Finding 5.5 — Recurring monitoring depends on emergent agent behavior

**Classification:** directional
**Signal matched:** Architecture signals: "Introduce a new abstraction / service / pattern", "This should be its own service"
**Source:** Codex
**Spec section:** §7d step 5, §11a, §12a

**Codex's finding:** The recurring monitoring execution path (agent reads brief, calls correct skills, compares to baseline, writes updated baseline, creates deliverable) is not backed by a deterministic implementation contract. §7d step 5 explicitly says no new runtime file or job handler is needed. §12a describes the agent performing comparison and deliverable creation. §11a only adds high-level skill guidance. Without a deterministic handler or versioned prompt contract, monitoring correctness depends on the agent reliably interpreting natural language config across prompt changes.

**Why not auto-applied:** The spec deliberately chose agent-driven execution for the monitoring loop. Codex's suggestion (new service or versioned prompt contract) would add a new service or change the implementation model. This is a product/architecture decision.

**Action required from human:** Review whether agent-driven monitoring execution is acceptable given correctness requirements. If reliability concerns are significant (e.g., prompt changes silently breaking active monitors), consider adding a deterministic job handler for the scheduled-run comparison path. This is the main open question for the spec before implementation begins on Phase 4.

## Mechanically Tight — Verify Directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review across 5 iterations. Every directional finding that surfaced in iterations 1–4 has been resolved by the human via HITL. One directional finding surfaced in the final iteration (Finding 5.5 above) and could not go back to HITL — it is recorded above for human review.

However:

- The review did not re-verify the framing assumptions in `docs/spec-context.md`. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's Architecture and Phased Delivery sections before calling it implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. The review converges on known classes of problem; it does not generate product insight.
- Sprint sequencing, scope trade-offs, and priority decisions are still the human's job.

**One open question before Phase 4 implementation:** See Finding 5.5 above — the monitoring execution model (agent-driven vs. deterministic handler). Decide before starting Phase 4.

**Recommended next step:** Read §7d (executeMonitorWebpage), §12a (UX flow), and §11a (agent prompt guidance) together. Confirm the agent-driven monitoring execution model is acceptable for your reliability requirements. Then start Phase 1 implementation.

**Key spec files for implementors:**

- Spec: `docs/robust-scraping-engine-spec.md`
- Spec-context: `docs/spec-context.md`
- Review final report: `tasks/spec-review-final-robust-scraping-engine-spec-20260413T020000Z.md`
- Iteration 4 checkpoint: `tasks/spec-review-checkpoint-robust-scraping-engine-spec-4-20260413T010000Z.md`
- Iteration 5 log: `tasks/spec-review-log-robust-scraping-engine-spec-5-20260413T020000Z.md`

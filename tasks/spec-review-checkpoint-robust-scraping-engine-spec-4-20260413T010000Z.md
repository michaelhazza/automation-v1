# Spec Review HITL Checkpoint — Iteration 4

**Spec:** `docs/robust-scraping-engine-spec.md`
**Spec commit:** `71ce9477d60b24a88cde7a332258934ed413f9a8` (working tree modified — iteration 3 and 4 mechanical changes not yet committed)
**Spec-context commit:** `2c7400b8542857fb5b630ae6ed9960b7d9bd6a7d`
**Iteration:** 4 of 5
**Timestamp:** 2026-04-13T01:00:00Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 5 until every finding below is resolved by the human. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

---

## Finding 4.4 — scraping_cache has no runtime contract (read/write/eviction undefined)

**Classification:** directional
**Signal matched (if directional):** Scope signals: "Bring this forward to an earlier phase" — the cache contract would need to be specified now but the cache is Phase 4 scope
**Source:** Codex
**Spec section:** §9b, §2, §4, §7, §15 Phase 1 and Phase 4

### Codex's finding (verbatim)

> `scraping_cache` is specified as important runtime behavior, but the spec never defines how the engine actually uses it. The doc claims cache-backed dedup prevents redundant scrapes and that Phase 4 "fully wires" `scraping_cache`, but no read path, write path, cache key derivation step, TTL eviction query, or bypass rules are described in §2, §4, or §7. That is a second load-bearing claim without an implementation contract.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would add to §9b or a new §9d: "The scraping engine checks `scraping_cache` before fetching. Cache lookup: `SELECT * FROM scraping_cache WHERE organisation_id = $orgId AND subaccount_id = $subaccountId AND url = $url AND fetched_at > NOW() - ttl_seconds * interval '1 second'`. On cache hit, return cached `contentHash` and `extractedData` without fetching. On cache miss, fetch, then upsert into `scraping_cache` with the result. Cache key is `(organisation_id, subaccount_id, url)` — one row per URL, regardless of extraction intent." However, this would add a non-trivial read/write path to Phase 1 scope for the dedup cache, and also exposes the key-ambiguity problem of Finding 4.5 (one URL can have different extraction intents).

### Reasoning

The spec creates the `scraping_cache` table in Phase 1 but says it's "unused until Phase 2" (§15 Phase 1 scope). Phase 4 says it will be "fully wired." But the spec never defines what "fully wired" means — there's no read path, write path, TTL eviction logic, or key derivation anywhere. The §16 risk table mentions "Cache prevents redundant scrapes within TTL" as a performance-at-scale mitigation, which is a load-bearing claim. Two options: (1) accept this as intentional Phase 4 deferral and add a note explicitly deferring the cache contract; or (2) add the cache contract now. Option 2 also requires resolving Finding 4.5 (cache key ambiguity). Option 1 is the lower-risk path.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`. If `apply-with-modification`, add the modification inline. If `reject`, add a one-sentence reason. If `stop-loop`, the review loop exits and the spec stays in its current state for the human to rethink.

```
Decision: apply-with-modification
Modification (if apply-with-modification): (1) Add an explicit deferral note to §9b (scraping_cache schema section) stating: "The cache read/write contract — lookup query, write-on-miss upsert, TTL eviction query, and bypass rules — is deferred to Phase 4. It will be specified at Phase 4 start alongside the first handler that uses the cache. No contract is defined here." (2) In §15 Phase 4, add a bullet: "Define and document scraping_cache read/write contract." (3) In §16 the performance-at-scale risk row, change "Cache prevents redundant scrapes within TTL" to "Phase 4+: cache prevents redundant scrapes within TTL." This removes a load-bearing claim that describes Phase 4 functionality as if it were already shipped.
Reject reason (if reject): <edit here>
```

---

## Finding 4.5 — scraping_cache key `(org, subaccount, url)` doesn't distinguish extraction intents

**Classification:** directional
**Signal matched (if directional):** Architecture signals: "Change the interface of X" — changing the unique index key is a schema change with migration implications
**Source:** Codex
**Spec section:** §9b cache key, §10 migration

### Codex's finding (verbatim)

> `scraping_cache`'s schema overlaps with monitor baselines and also has an unclear source-of-truth boundary for extraction outputs. `workspaceMemory` stores `{ contentHash, extractedData }` per monitor, while `scraping_cache` stores `contentHash` and `extractedData` per org/subaccount/url. Those are adjacent persistence models for nearly the same data. The spec says cache is "not used for baselines," but it does not explain which store is authoritative when the same URL is monitored multiple ways, nor how `scraping_cache` distinguishes different `fields`, `extract`, `output_format`, or selector sets. As written, one URL can map to multiple extraction intents, but the cache key has only `url`.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would change the `scraping_cache` unique index to include `output_format` or a hash of the `extract` + `selectorGroup` parameters: e.g., `(organisation_id, subaccount_id, url, extraction_key)` where `extraction_key = sha256(outputFormat + ':' + (extract ?? '') + ':' + (selectorGroup ?? ''))`. This would require adding an `extraction_key TEXT` column to both the schema and migration. However this is a non-trivial schema change with sequencing implications.

### Reasoning

The current cache key `(org, subaccount, url)` means that two agents scraping the same URL with different extraction intents (one fetching markdown, one fetching structured JSON for a specific field-set) will evict each other's cache entries. This may be acceptable if the cache is purely a short-TTL dedup guard (not a long-term cache), since the TTL is 3600s by default. However, if two monitors target the same URL with different fields, they would interfere. The interaction between the cache and monitoring is unclear. Options: (a) accept the ambiguity as acceptable for a 3600s TTL cache (collisions are rare and self-healing); (b) add an `extraction_key` column to disambiguate. This also relates to Finding 4.4 — if the cache contract is deferred to Phase 4, this schema question can be deferred too.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`. If `apply-with-modification`, add the modification inline. If `reject`, add a one-sentence reason. If `stop-loop`, the review loop exits and the spec stays in its current state for the human to rethink.

```
Decision: reject
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): scraping_cache is a 3600s best-effort dedup guard; the worst-case collision (same URL, different extraction intent within 1 hour) is a cache miss and fresh fetch — no data loss, self-healing, and this is Phase 4 scope anyway. Adding an extraction_key column is over-engineering for pre-production.
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (apply, apply-with-modification, reject, or stop-loop), and continue to iteration 5.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.

**Note:** 1 iteration remains after this (iteration 5). If both findings are rejected or accepted as-is, iteration 5 will be a clean Codex pass on the final spec state.

# Spec Review Log — Iteration 4

**Spec:** `docs/robust-scraping-engine-spec.md`
**Spec commit at start:** `71ce9477d60b24a88cde7a332258934ed413f9a8` (working tree modified)
**Spec-context commit:** `2c7400b8542857fb5b630ae6ed9960b7d9bd6a7d`
**Timestamp:** 2026-04-13T01:00:00Z

---

## Pre-iteration: HITL decisions applied from iteration 3 checkpoint

### Finding 3.1 — apply-with-modification
Applied: Replaced scraping_cache baseline storage with workspace memory (`workspaceMemoryService`) in §7d, §9b, §10, §12a, §13e, §15 Phase 4, §5c. Removed `scheduledTaskId` FK from scraping_cache schema and migration. Reverted unique index to `(organisation_id, subaccount_id, url) NULLS NOT DISTINCT`. scraping_cache is now a pure dedup cache.

### Finding 3.7 — apply
Applied: Added best-effort single-instance scoping note to §13a.

---

## Codex findings — Iteration 4

### FINDING 4.1
  Source: Codex
  Section: §7d step 7, §5c Change detection
  Description: hash-only monitoring (`fields` omitted) has no recurring execution path — §7d step 7 only named `scrape_structured` which requires `fields`.
  Codex's suggested fix: define the recurring path for hash-only monitoring
  Classification: mechanical
  Reasoning: contradiction between §5c (which documents hash-only monitoring) and §7d step 7 (which only named one branch). Fix adds the missing `scrape_url` branch.
  Disposition: auto-apply

[ACCEPT] §7d step 7 — hash-only monitoring had no recurring path
  Fix applied: Added explicit two-branch description: `fields` provided → `scrape_structured`, `fields` omitted → `scrape_url`. Step renumbered to 8 after idempotency step was inserted (see 4.3).

---

### FINDING 4.2
  Source: Codex
  Section: §4a extraction modes table
  Description: "always stores selectors" in the `json (recurring)` row contradicts §4b/5b/6b which document `remember: false` as a valid opt-out.
  Codex's suggested fix: update §4a to match actual `remember` semantics
  Classification: mechanical
  Reasoning: stale language that materially changes the documented contract.
  Disposition: auto-apply

[ACCEPT] §4a — stale "always stores selectors" language
  Fix applied: Updated table cell to "(`remember: true` by default; pass `remember: false` to skip selector persistence)".

---

### FINDING 4.3
  Source: Codex
  Section: §6c idempotency comments, §7d
  Description: `monitor_webpage` dedup is asserted in §6c but no enforcement contract is described in §7d.
  Codex's suggested fix: add a lookup step in §7d
  Classification: mechanical
  Reasoning: load-bearing claim without contract. The correct mechanism is the existing action-layer `keyed_write` dedup via `executeWithActionAudit`.
  Disposition: auto-apply

[ACCEPT] §7d — idempotency enforcement contract missing
  Fix applied: Added step 1 clarifying that dedup is handled by `executeWithActionAudit` at the action layer via the `actions` table `(subaccount_id, idempotency_key)` unique index — the handler does not perform its own check.

**Rubric self-correction:** Initial mechanical fix incorrectly specified querying `scheduledTasks` for an `idempotencyKey` column that doesn't exist. Corrected to reference the actual action-layer mechanism.

---

### FINDING 4.4
  Source: Codex
  Section: §9b, §2, §4, §7
  Description: scraping_cache is claimed to prevent redundant scrapes but no read path, write path, cache key derivation, TTL eviction query, or bypass rules are defined.
  Codex's suggested fix: add runtime contract for scraping_cache usage
  Classification: **directional**
  Reasoning: Requires deciding read path (where in the engine to check), write path, key derivation (url only? url+outputFormat?), and eviction query. These are scope decisions, not oversights. The cache is Phase 4 scope and expanding it to Phase 1 would change scope.
  Signal matched: Scope signals — "Bring this forward to an earlier phase"
  Disposition: HITL

---

### FINDING 4.5
  Source: Codex
  Section: §9b cache key, §7d step 5
  Description: scraping_cache unique key `(org, subaccount, url)` doesn't distinguish different extraction intents on the same URL.
  Codex's suggested fix: add extraction intent or format to cache key
  Classification: **directional**
  Reasoning: Changing the cache key changes the migration schema. This is an architecture decision that also affects how the cache interacts with different scraping modes.
  Signal matched: Architecture signals — "Change the interface of X"
  Disposition: HITL

---

### FINDING 4.6
  Source: Codex
  Section: §3d, §9a
  Description: `selectorGroup` and `urlPattern` both appear to be partition keys for learned selectors, with no clear semantics statement explaining their relationship.
  Codex's suggested fix: add a clarifying statement about combined semantics
  Classification: mechanical
  Reasoning: §3d already states `selectorGroup` is "the source of truth for separating independent structured extractions." Codex is pointing at missing prose. Adding a semantic clarification paragraph.
  Disposition: auto-apply

[ACCEPT] §3d — selectorGroup vs urlPattern semantics unstated
  Fix applied: Added a "Key semantics" paragraph explaining urlPattern is site-scope, selectorGroup is extraction-scope, and the composite key is `(orgId, subaccountId, urlPattern, selectorGroup, selectorName)`.

---

### FINDING 4.7
  Source: Codex
  Section: §2d phase note, §15 Phase 3, Summary worker-files note
  Description: §15 Phase 3 says stealth plugins "wired into IEE worker" but §2d and the worker-files note both say task metadata passthrough requires no worker file changes. Internal contradiction.
  Codex's suggested fix: align Phase 3 scope with §2d
  Classification: mechanical
  Reasoning: §2d and worker-files note are more specific and accurate. Phase 3 scope bullet used imprecise language.
  Disposition: auto-apply

[ACCEPT] §15 Phase 3 — "wired into IEE worker" contradicts §2d and worker-files note
  Fix applied: Updated Phase 3 bullet to say stealth plugins are enabled via "task metadata passthrough (no worker source file changes required)".

---

### FINDING 4.8
  Source: Codex
  Section: §13c
  Description: OrgScrapingSettings is introduced as a typed contract but no file location, existing-service relationship, or admin UI impact is stated.
  Codex's suggested fix: name the file and state ownership
  Classification: mechanical
  Reasoning: rubric "unnamed new primitives." Fix names the file and clarifies no UI/service changes needed.
  Disposition: auto-apply

[ACCEPT] §13c — OrgScrapingSettings has no named file location
  Fix applied: Named `server/services/scrapingEngine/types.ts` as the home. Added that it does not extend orgSettingsService and no admin UI changes are required.

---

### FINDING 4.9
  Source: Codex
  Section: §7d step 4, step 7
  Description: monitoring brief serializer/parser is unnamed, format contract is prose-only (no exact spec), parsing failure behavior undefined.
  Codex's suggested fix: name a concrete helper and exact format contract
  Classification: mechanical
  Reasoning: rubric "unnamed new primitives." Named helpers `serializeMonitorBrief` and `parseMonitorBrief` in `server/services/scrapingEngine/index.ts`, specified exact key-value format, and added failure behavior.
  Disposition: auto-apply

[ACCEPT] §7d step 5 (now step 5 brief bullet) — brief format and parser unnamed
  Fix applied: Named `serializeMonitorBrief` / `parseMonitorBrief` helpers in `index.ts`. Specified exact format (`Key: value.` pattern). Added parse failure behavior (log error, skip run).

---

### FINDING 4.10
  Source: Codex
  Section: §15 Phase 3 scope
  Description: "Proxy rotation support in HTTP fetcher" is a new capability with no named config primitive.
  Codex's suggested fix: name the primitive or mark as TBD
  Classification: mechanical
  Reasoning: rubric "unnamed new primitives." Minimal fix: add "(to be spec'd at Phase 3 start)".
  Disposition: auto-apply

[ACCEPT] §15 Phase 3 — proxy support has no named primitive
  Fix applied: Added "(config source, schema, and auth contract to be spec'd at Phase 3 start)".

---

### FINDING 4.11
  Source: Codex
  Section: Title block, §3 opening
  Description: Session URL and "competitive moat" sentence are editorial residue.
  Codex's suggested fix: remove them
  Classification: mechanical
  Reasoning: rubric "stale retired language."
  Disposition: auto-apply

[ACCEPT] Title block and §3 — editorial residue
  Fix applied: Removed `Session:` line from title block. Removed "This is the competitive moat." sentence from §3.

---

## Rubric self-findings (not from Codex)

### RUBRIC-4.A — Idempotency mechanism references non-existent column
  Section: §7d step 1 (as initially written)
  Description: Initial draft of Finding 4.3 fix incorrectly said to query `scheduledTasks` for an `idempotencyKey` column — that column does not exist in `scheduledTasks`. The correct mechanism is action-layer dedup.
  Classification: mechanical (self-correction)
  Disposition: auto-apply (corrected inline with Finding 4.3)

[ACCEPT] §7d step 1 — corrected to action-layer mechanism after verifying scheduledTasks schema

---

## Iteration 4 Summary

- Mechanical findings accepted:  9 (4.1, 4.2, 4.3/rubric-4A, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11)
- Mechanical findings rejected:  0
- Directional findings:          2 (4.4, 4.5)
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          tasks/spec-review-checkpoint-robust-scraping-engine-spec-4-20260413T010000Z.md
- HITL status:                   pending
- Spec commit after iteration:   working tree (uncommitted changes on top of 71ce947)

# Spec Review Log — Iteration 1
**Spec:** `docs/robust-scraping-engine-spec.md`
**Timestamp:** 2026-04-12T22:27:21Z

---

## Classification Decisions

[ACCEPT] §2c/2d/15 — Phase 1 architecture describes TLS fingerprinting and Playwright stealth plugins but Phase 3 ships these
  Fix applied: Clarified Phase 1 sections that TLS/stealth are Phase 3 hooks, not Phase 1 deliverables

[ACCEPT] §2e/2f/4b — Tier 3 (Scrapling) returns markdown but scrape_structured/adaptive selectors require HTML
  Fix applied: Added explicit statement that Tier 3 is unsupported for scrape_structured/adaptive selectors; Tiers 1-2 are used for those paths

[ACCEPT] §2f/5b/12c/6b — §12c shows scrape_structured accepting css_selectors but skill def and registry don't include it
  Fix applied: Removed inconsistent css_selectors reference from §12c; scrape_structured uses only internally-learned selectors

[ACCEPT] §5a vs 6a — css_selectors type mismatch: skill says JSON string, registry says z.array(z.string())
  Fix applied: Updated skill definition to match registry (array, not JSON string)

[REJECT] §4a/4b/5a/5b — scrape_url json mode overlaps with scrape_structured (classified as AMBIGUOUS → HITL)
  Reason: Scope question about whether json mode should be removed from scrape_url — sent to HITL

[ACCEPT] §3d/4b/9a/10 — scraping_selectors has no unique constraint for the upsert selectorStore.save()
  Fix applied: Added unique constraint (organisation_id, subaccount_id, url_pattern, selector_group, selector_name) to schema

[ACCEPT] §3b/5b/2f/7c — selector_uncertain and adaptive_match_used referenced in prose/examples but not in ScrapeResult
  Fix applied: Added selector_uncertain and adaptive_match_used fields to ScrapeResult interface in §2f

[RECLASSIFIED → DIRECTIONAL] §7d/9b/10/13e/15 — scraping_cache mixes short-lived TTL and durable monitoring baseline
  Reason: "Split into separate cache vs monitor-baseline storage" is an architecture change — sent to HITL

[RECLASSIFIED → DIRECTIONAL] §7d/9b — cache key can't support multiple monitors per URL (batched with #8)
  Reason: Intertwined with #8 schema redesign — sent to HITL

[ACCEPT] §5c/7d/12a/15 — monitor_webpage uses natural language frequency but scheduledTaskService requires rrule; no parser named
  Fix applied: Named the frequency parser as a step in §7d handler implementation

[ACCEPT] §7d/12a — recurring monitor runs have no persisted execution contract
  Fix applied: Added specification for monitor config payload stored on scheduledTask.metadata

[ACCEPT] §6c/7d — monitor_webpage createsBoardTask: true doesn't match handler (no board task created)
  Fix applied: Changed createsBoardTask to false in §6c

[ACCEPT] §11a/11b/15 — §11a adds all three skills at once; §11b adds monitor routing; but Phase 2/4 ship later
  Fix applied: Added phase annotations to §11a skill list and §11b routing additions

[ACCEPT] §2d/15/Summary — Tier 2 depends on worker/src/browser/ but no worker files in Files tables
  Fix applied: Added explicit note that no worker files need modification (existing IEE task contract already supports this)

[ACCEPT] §15 Phase 4 vs Summary — queueService.ts mentioned in prose but missing from Modified files table
  Fix applied: Added queueService.ts to Modified files table with Phase 4 annotation

[ACCEPT] §14 vs Summary — test files named in verification plan absent from Files tables
  Fix applied: Added note to Files table that test files are intentionally excluded from the inventory

[ACCEPT] §13b/13c — org-level scraping settings (blockedDomains, allowedDomains, respectRobotsTxt) uncontracted
  Fix applied: Added typed settings interface reference and named httpFetcher.ts as the read path

[ACCEPT] §2d — "known to require JS rendering" Tier 2 escalation trigger has no source of truth
  Fix applied: Removed the "known to require" clause; stated Tier 2 triggers only on blocked/empty Tier 1 response

[RECLASSIFIED → DIRECTIONAL] §14/15 — missing per-phase ship/no-ship criteria
  Reason: Whether to add exit criteria per phase is a process/scope decision — sent to HITL

[ACCEPT] Rubric/§5c/7d/12a — monitoring execution model contradiction: §12a says agent calls scrape_structured; §7d says skill handles re-scraping
  Fix applied: Clarified §7d: monitor_webpage stores config and creates scheduledTask; on each scheduled run, the orchestrated agent calls scrape_structured (not a re-invocation of monitor_webpage)

[ACCEPT] Rubric/§9b/10 — nullable subaccount_id in UNIQUE index won't enforce deduplication when NULL
  Fix applied: Added NULLS NOT DISTINCT clause to the unique index in §10 migration SQL

[ACCEPT] Rubric/§13b — robots.txt caching has no named implementation file
  Fix applied: Stated robots.txt cache lives in httpFetcher.ts using an in-process Map with 24-hour TTL

---

## Iteration 1 Summary

- Mechanical findings accepted:  15
- Mechanical findings rejected:  0
- Directional findings:          3 (findings #8, #9, #19)
- Ambiguous findings:            1 (finding #5)
- Reclassified → directional:    0
- HITL checkpoint path:          tasks/spec-review-checkpoint-robust-scraping-engine-spec-1-20260412T222721Z.md
- HITL status:                   resolved (2026-04-13)
- Spec commit after iteration:   71ce9477d60b24a88cde7a332258934ed413f9a8 (uncommitted changes pending)

---

## HITL Resolution (resumed 2026-04-13)

Finding 1.1 — apply:
  Applied differentiator note to §4a extraction modes table. Split "json" row into "json (one-off)" and "json (recurring)" with explicit decision boundary note distinguishing scrape_url(output_format='json') (no selector storage) from scrape_structured (stores selectors, zero-LLM on repeat runs).

Finding 1.2 — apply-with-modification:
  Added `scheduled_task_id INTEGER REFERENCES scheduled_tasks(id)` as nullable FK to `scraping_cache` in §9b schema (Drizzle) and §10 migration SQL. Added comment that TTL cleanup job MUST skip rows where scheduled_task_id IS NOT NULL. Also updated §7d handler spec to reorder steps so scheduledTaskId is available before the cache upsert (step 3 creates scheduled task, step 4 upserts cache with scheduledTaskId set).

Finding 1.3 — apply-with-modification:
  Changed unique index to cover (organisation_id, subaccount_id, url, scheduled_task_id) with NULLS NOT DISTINCT in both §9b and §10. Regular cache rows (scheduled_task_id IS NULL) remain unique per URL per org. Monitor rows are unique per task per URL, supporting multiple monitors on the same URL without overwriting each other's baselines.

Finding 1.4 — reject:
  No change applied. Human rejected: global §14 verification checklist is sufficient at this stage; per-phase exit criteria are process overhead not suited to a single-developer pre-production build.

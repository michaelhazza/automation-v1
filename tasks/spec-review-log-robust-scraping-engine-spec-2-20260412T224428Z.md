# Spec Review Log — Iteration 2
**Spec:** `docs/robust-scraping-engine-spec.md`
**Timestamp:** 2026-04-13T (resumed from HITL; iteration 2 started after applying checkpoint decisions)

---

## Classification Decisions

FINDING #2.1
  Source: Codex
  Section: §2f (ScrapeOptions), §7b (executeScrapeUrl)
  Description: ScrapeOptions interface is missing orgId and subaccountId, but §7b passes both into scrapingEngine.scrape(), creating an internally inconsistent contract.
  Codex's suggested fix: Add orgId: string and subaccountId?: string to ScrapeOptions.
  Classification: mechanical
  Reasoning: Contradiction between a defined interface (§2f) and its call site (§7b) — the call site already passes the fields, the interface just needs to declare them.
  Disposition: auto-apply

FINDING #2.2
  Source: Codex
  Section: §9a (Drizzle schema), §10 (migration SQL)
  Description: scraping_selectors_upsert_key in the Drizzle schema (§9a) omits .nullsNotDistinct() while the migration SQL (§10) includes NULLS NOT DISTINCT, so they define different uniqueness behavior.
  Codex's suggested fix: Add .nullsNotDistinct() to the Drizzle uniqueIndex in §9a.
  Classification: mechanical
  Reasoning: Schema/migration drift — a consistency problem the spec already resolved in the SQL but failed to mirror in the Drizzle definition.
  Disposition: auto-apply

FINDING #2.3
  Source: Codex
  Section: §3d (selectorStore.load()), §9a (unique key includes selectorGroup)
  Description: selectorStore.load() signature is load(orgId, subaccountId, urlPattern) but the unique key includes selectorGroup, so the function cannot correctly scope selector lookups to a group.
  Codex's suggested fix: Change load() to accept selectorGroup as a fourth parameter.
  Classification: mechanical
  Reasoning: Under-specified contract — the table key includes a column the API doesn't expose, so the API cannot correctly target the right rows.
  Disposition: auto-apply

FINDING #2.R1
  Source: Rubric — load-bearing claims without contracts
  Section: §3d (selectorStore.save())
  Description: selectorStore.save() signature omits selectorGroup but the unique upsert key includes it, so save() cannot correctly address the upsert key.
  Classification: mechanical
  Reasoning: Same class of problem as Finding 2.3 — the upsert key requires selectorGroup but the write API doesn't accept it.
  Disposition: auto-apply

FINDING #2.4
  Source: Codex
  Section: §4b (LLM-assisted extraction, step 5), §5b (remember parameter), §6b (action registry)
  Description: §4b step 5 says the engine always saves selectors but doesn't gate on the remember parameter defined in §5b and §6b.
  Codex's suggested fix: Add "only when remember !== false" condition to step 5.
  Classification: mechanical
  Reasoning: The remember toggle is a declared parameter (§5b/6b) but §4b's extraction flow ignores it — internal inconsistency in the spec's own rules.
  Disposition: auto-apply

FINDING #2.5
  Source: Codex
  Section: §5c (monitor_webpage skill instructions)
  Description: §5c says "Only call monitor_webpage once per URL" but the schema (updated in HITL round 1) explicitly supports multiple monitors per URL via scheduled_task_id.
  Codex's suggested fix: Replace that sentence with language allowing distinct monitors on the same URL for different criteria/schedules.
  Classification: mechanical
  Reasoning: Stale language — the instruction was valid before the cache schema was updated (Finding 1.3), but now contradicts the schema design.
  Disposition: auto-apply

FINDING #2.6
  Source: Codex
  Section: §7d (executeMonitorWebpage step 1), §12a (step 3)
  Description: §7d step 1 calls scrapingEngine.scrape() generically, but §12a example shows structured JSON extraction and selector learning when fields is provided — behavior scrape() alone doesn't define.
  Codex's suggested fix: Update §7d step 1 to call executeScrapeStructured when fields is provided.
  Classification: mechanical
  Reasoning: Contradiction between the handler spec (§7d) and the UX example (§12a) — the example depends on behavior not described by the handler.
  Disposition: auto-apply

FINDING #2.7
  Source: Codex
  Section: §7d (metadata stores selectorGroup), §5c (monitor_webpage parameters)
  Description: §7d metadata stores selectorGroup but monitor_webpage has no selector_group parameter and no rule for deriving one, so scheduled runs depend on data that's never defined.
  Codex's suggested fix: Add a derivation rule for selectorGroup in §7d.
  Classification: mechanical
  Reasoning: Load-bearing claim without enforcement — the spec stores selectorGroup in metadata but doesn't specify how it's populated.
  Disposition: auto-apply

FINDING #2.8
  Source: Codex
  Section: §11a (Strategic Intelligence Agent prompt body)
  Description: The prompt body example calls update_memory_block but that skill is not listed in the YAML skills additions for this spec (and not in the agent's existing skill list).
  Codex's suggested fix: Either add update_memory_block to the skills list or replace the reference with write_workspace.
  Classification: mechanical
  Reasoning: The skill update_memory_block.md exists in server/skills/ but is not in the SIA's current or planned skills list. The prompt reference is an inconsistency. Since adding a new skill to the agent would be a scope expansion, the fix is to replace the specific skill call in the example with write_workspace (already listed) — this is a documentation consistency fix, not a feature change.
  Disposition: auto-apply

FINDING #2.9
  Source: Codex
  Section: §12b (one-off research example), §4a (decision boundary)
  Description: §12b "one-off research" example uses scrape_structured, but the decision boundary added in §4a (Finding 1.1 from iteration 1) says one-off extraction should use scrape_url(output_format='json').
  Codex's suggested fix: Change §12b example to use scrape_url with output_format='json'.
  Classification: mechanical
  Reasoning: Contradiction between §4a (just updated) and §12b — §12b was not updated to match the clarified decision boundary.
  Disposition: auto-apply

FINDING #2.10
  Source: Codex
  Section: §13b (robots.txt opt-out prose), §13c (OrgScrapingSettings typed contract)
  Description: §13b says opt-out can be set "for specific domains" but §13c only defines a single org-wide boolean respectRobotsTxt — no domain-scoped override exists.
  Codex's suggested fix: Change "for specific domains" to "for the org" in §13b.
  Classification: mechanical
  Reasoning: Prose description doesn't match the actual typed contract — the contract is the source of truth, the prose is stale.
  Disposition: auto-apply

FINDING #2.11
  Source: Codex
  Section: §14b (integration test list)
  Description: monitorWebpageSkill.test.ts description includes "change detection on re-run" but §7d says re-runs call scrape_structured (not monitor_webpage), so the test covers the wrong behavior.
  Codex's suggested fix: Update test description to cover only baseline creation and scheduled task creation.
  Classification: mechanical
  Reasoning: Stale test description — it reflects an earlier model where monitor_webpage handled re-runs, which §7d now explicitly contradicts.
  Disposition: auto-apply

FINDING #2.12
  Source: Codex
  Section: §7d, Summary of Files Changed
  Description: The spec assigns recurring-run comparison logic to the Strategic Intelligence Agent but names no concrete file where the scheduled-task execution hook or baseline comparison code lives.
  Codex's suggested fix: Name the file for scheduled-task execution and add it to the modified files table.
  Classification: directional
  Reasoning: Deciding which file handles the monitor_webpage scheduled-task execution (a new job type) requires an architecture decision — it could be a new pg-boss job handler, an extension to the existing scheduledTaskExecutor, or handled inside the agent execution path. This is "Introduce a new primitive / this should be its own service" territory.
  Disposition: HITL-checkpoint

---

## Iteration 2 Summary

- Mechanical findings accepted:  12 (2.1, 2.2, 2.3, 2.R1, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11)
- Mechanical findings rejected:  0
- Directional findings:          1 (2.12)
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          tasks/spec-review-checkpoint-robust-scraping-engine-spec-2-20260412T224428Z.md
- HITL status:                   pending
- Spec commit after iteration:   71ce9477d60b24a88cde7a332258934ed413f9a8 (uncommitted changes)

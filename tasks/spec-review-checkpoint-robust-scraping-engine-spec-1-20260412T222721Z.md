# Spec Review HITL Checkpoint — Iteration 1

**Spec:** `docs/robust-scraping-engine-spec.md`
**Spec commit:** `71ce9477d60b24a88cde7a332258934ed413f9a8`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 1 of 5
**Timestamp:** 2026-04-12T22:27:21Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 2 until every finding below is resolved by the human. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

---

## Finding 1.1 — scrape_url json mode vs scrape_structured overlap

**Classification:** ambiguous
**Signal matched (if directional):** Ambiguous — could be mechanical clarification or scope change (removing json from scrape_url)
**Source:** Codex
**Spec section:** §4a (Extraction modes table), §4b (LLM-assisted extraction), §5a (scrape_url skill), §5b (scrape_structured skill)

### Codex's finding (verbatim)

> `scrape_url(output_format='json')` overlaps unclearly with `scrape_structured`. The spec gives both actions structured extraction behavior, but their boundaries differ only in prose.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would add an explicit differentiator note to the extraction modes table in §4a, clarifying: "`json` mode in `scrape_url` — one-off structured extraction with no selector learning. Use when you need JSON once and don't plan to repeat the scrape. `scrape_structured` — always stores selectors (`remember: true` by default); use for recurring extraction." I would NOT remove `json` from `scrape_url`, as that would be a scope change. This tentative fix keeps the boundaries clear without removing any feature.

### Reasoning

The spec does describe both features separately in §5a and §5b, but the extraction modes table (§4a) doesn't distinguish the one-off vs. recurring semantics. A reader looking only at §4a would not know which to use. If the answer is "just add a note", this is mechanical. If the answer is "json shouldn't be in scrape_url at all", this is directional. I'm classifying as ambiguous because the right call (add a note vs. change the feature boundary) is a product judgement call, not a documentation clean-up.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`. If `apply-with-modification`, add the modification inline. If `reject`, add a one-sentence reason.

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## Finding 1.2 — scraping_cache dual-use: short-lived TTL vs durable monitoring baseline

**Classification:** directional
**Signal matched (if directional):** Architecture signals: "Split this item into two" — deciding whether to have one table or two tables is an architecture decision
**Source:** Codex
**Spec section:** §7d (executeMonitorWebpage), §9b (scraping_cache schema), §10 (migration SQL), §13e (content size limits), §15 Phase 4

### Codex's finding (verbatim)

> `scraping_cache` mixes short-lived cache and long-lived monitoring baseline semantics. The table has TTL defaults and cleanup behavior, but it is also used as the durable baseline for weekly monitoring; a 1-hour TTL would delete the baseline before the next run. Split this into separate cache vs monitor-baseline storage, or add a durable baseline mode with no TTL expiry.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would add a `baselineTtlOverride: null` flag or similar field to `scraping_cache` that, when set, bypasses the TTL cleanup job — effectively making the row durable. The cleanup job would skip rows with `baselineTtlOverride IS NULL` (applying TTL only to regular cache rows). This avoids a new table and stays within the current schema. The alternative (splitting into `scraping_baselines` and `scraping_cache` tables) would require a new migration and a new schema file.

### Reasoning

A 1-hour default TTL on the only baseline storage for a weekly monitoring job is a real bug — the monitoring system would break silently. The question is whether to fix it by adding a field to the existing table (less disruptive) or splitting into two tables (cleaner separation). Both are architecturally valid but the choice changes the schema, migration, and Phase 4 implementation plan. This is a design decision, not a documentation clean-up.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`.

```
Decision: apply-with-modification
Modification (if apply-with-modification): Add `scheduled_task_id INTEGER REFERENCES scheduled_tasks(id)` as a nullable FK column to `scraping_cache`. The cleanup job must skip rows where `scheduled_task_id IS NOT NULL`. Do not use a boolean `is_baseline` flag.
Reject reason (if reject): <edit here>
```

---

## Finding 1.3 — cache key can't support multiple monitors per URL

**Classification:** directional
**Signal matched (if directional):** Architecture signals: tied to Finding 1.2 — the resolution of the table structure determines the correct key design
**Source:** Codex
**Spec section:** §7d, §9b

### Codex's finding (verbatim)

> The cache key cannot support multiple monitors on the same URL. `scraping_cache` is unique on `(organisation_id, subaccount_id, url)`, so two monitoring jobs with different fields/watch criteria for the same page would overwrite each other. Key baselines by `scheduledTaskId`/monitor ID (or include `fields`/watch profile hash).

### Tentative recommendation (non-authoritative)

If this were mechanical (and if Finding 1.2 resolved by adding a durable flag to the existing table), I would change the unique index to include `scheduled_task_id` as an additional key column for monitoring rows. Non-monitoring cache rows would have `scheduled_task_id = NULL`. This would support multiple monitors per URL. If Finding 1.2 resolved by splitting tables, this finding would be addressed naturally by the monitoring table's own primary key.

### Reasoning

This finding's resolution depends on how Finding 1.2 is resolved. It is also a schema key decision with implications for the migration and the handler implementation. Batching it with Finding 1.2 for HITL.

### Decision

Edit the line below. This finding should be resolved together with Finding 1.2.

```
Decision: apply-with-modification
Modification (if apply-with-modification): Change the unique index to cover `(organisation_id, subaccount_id, url, scheduled_task_id)` with NULLS NOT DISTINCT on `scheduled_task_id`. Regular cache rows (scheduled_task_id IS NULL) remain unique per URL per org. Monitor rows are unique per task per URL.
Reject reason (if reject): <edit here>
```

---

## Finding 1.4 — Missing per-phase ship/no-ship criteria

**Classification:** directional
**Signal matched (if directional):** Cross-cutting signals: "Add a new cross-cutting contract" — per-phase exit criteria would be a new structural contract across all phases
**Source:** Codex
**Spec section:** §14 (Verification Plan), §15 (Phased Delivery)

### Codex's finding (verbatim)

> The verification checklist is global, but phases do not define concrete ship/no-ship criteria, so there is no per-phase readiness verdict. Add explicit acceptance criteria and exit checks for each phase, including what must be verified before the phase is considered complete.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would add a brief "Exit criteria" subsection to each Phase in §15 that references the relevant items from the §14 checklist. For Phase 1: "`npm run typecheck` passes, `scrape_url` skill executes against a real URL in dev environment, Tier 2 escalation verified with mock Tier 1 failure." This would make the spec actionable phase-by-phase.

### Reasoning

The spec currently has a global verification checklist (§14) and a phased delivery plan (§15), but they are not cross-linked. Whether to add per-phase exit criteria is a process/workflow decision — some teams prefer a global checklist, others prefer per-phase gates. This affects how the implementation is validated and could change how the phases are coordinated. It is a scope addition (new content) rather than a consistency fix.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`.

```
Decision: reject
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): The global §14 verification checklist is sufficient at this stage; per-phase exit criteria are process overhead not suited to a single-developer pre-production build.
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (apply, apply-with-modification, reject, or stop-loop), and continue to iteration 2.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.

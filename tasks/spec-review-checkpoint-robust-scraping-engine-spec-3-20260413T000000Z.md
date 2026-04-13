# Spec Review HITL Checkpoint — Iteration 3

**Spec:** `docs/robust-scraping-engine-spec.md`
**Spec commit:** `71ce9477d60b24a88cde7a332258934ed413f9a8`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 3 of 5
**Timestamp:** 2026-04-13T00:00:00Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 4 until every finding below is resolved by the human. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

---

## Finding 3.1 — Agent has no mechanism to read scraping_cache baseline on scheduled runs (RESOLVED)

**Classification:** directional
**Signal matched (if directional):** Architecture signals: "This should be its own service" / "Introduce a new abstraction / service / pattern"
**Source:** Codex
**Spec section:** §7d step 7, §12a step 4

### Codex's finding (verbatim)

> The spec says scheduled runs will have the agent read the monitor config, load the baseline from `scraping_cache`, diff it, and update the baseline, but it never defines any skill/service/API that exposes `scraping_cache` to the agent or how the agent receives the `scheduledTaskId` needed to address the correct row. Suggested fix: move comparison/baseline updates into a server-side monitor runner (preferred), or add explicit monitor-baseline read/write primitives and include `scheduledTaskId` in the scheduled-run execution context.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would add to §7d step 7: "The agent receives the `scheduledTaskId` via the task card's brief (already stored in step 4). It passes `scheduledTaskId` as a parameter to a new `read_monitoring_baseline` skill that returns the stored `contentHash` and `extractedData` from `scraping_cache`. After comparison, it calls `update_monitoring_baseline` with the new hash." However this would add two new skills to the spec's scope — a non-trivial change. The alternative (server-side runner) moves the comparison out of agent context entirely and removes the baseline-access problem, but changes the execution model.

### Reasoning

The spec at §7d step 7 and §12a step 4 describes the agent doing the comparison — but to do this, the agent needs: (a) the `scheduledTaskId` from the task brief, and (b) a way to read and update the `scraping_cache` row for that ID. Currently neither is provided. This could be resolved three ways: (1) the comparison happens server-side (no agent skills needed), (2) a new skill exposes cache read/write, or (3) the agent uses `write_workspace` to store the baseline (instead of `scraping_cache`) and compares against that. Each option has different scope implications. This is clearly a product direction decision.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Use workspace memory (write_workspace / workspaceMemoryService) for monitoring baselines instead of scraping_cache. The agent stores the baseline on first run as a workspace memory entry keyed by "monitor:<scheduledTaskId>" containing { contentHash, extractedData }. On each subsequent scheduled run, it reads that entry, compares, updates if changed, and calls add_deliverable if a diff is detected. This uses an existing primitive (write_workspace is already in the agent skill set), requires no new skills, and requires no changes to fireOccurrence. As a cascade: remove the scheduled_task_id FK column from scraping_cache in §9b and §10 — that column was added in HITL 1.2 specifically for durable baseline storage, which is now handled by workspace memory instead. Revert the unique index on scraping_cache to (organisation_id, subaccount_id, url) with NULLS NOT DISTINCT. The scraping_cache table is now a pure dedup cache with standard TTL semantics. Update §7d to reflect this flow.
Reject reason (if reject): <edit here>
```

---

## Finding 3.7 — In-memory rate limiter not valid for multi-process deployments

**Classification:** directional
**Signal matched (if directional):** Architecture signals: "Introduce a new abstraction / service / pattern" (shared backing store); Production-caution signals: "Add rate limiting to X"
**Source:** Codex
**Spec section:** §13a

### Codex's finding (verbatim)

> The rate limiter is not implementation-ready for multi-instance deployments. An in-memory per-domain limiter only works within one process, so horizontally scaled API/workers would exceed the intended global limits. Suggested fix: specify a shared backing store (Redis/Postgres) for rate-limit counters, or explicitly scope the feature to single-instance best-effort behavior.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would add a note to §13a: "This rate limiter is best-effort, single-instance only. In a multi-process deployment, limits apply per-process, not globally. A shared backing store (Redis or Postgres) is deferred to a future phase when horizontal scaling is needed." This scoping note would explicitly document the known limitation without requiring a new dependency, and would resolve the ambiguity without changing the design.

### Reasoning

The spec intentionally uses an in-memory rate limiter. Codex is correct that this doesn't work globally in a multi-process deployment, but this project is pre-production with no horizontal scaling requirement. The framing assumptions (pre_production: yes, rapid_evolution) support deferring Redis. However, a scoping note might be all that's needed — it's ambiguous whether this is "add a note" (mechanical) or "decide the rate limiting architecture" (directional). I classified it as directional because the human should decide whether to document the limitation or address it now.

### Decision

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (apply, apply-with-modification, reject, or stop-loop), and continue to iteration 4.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.

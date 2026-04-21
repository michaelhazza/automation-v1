# Spec Review HITL Checkpoint — Iteration 4

**Spec:** `tasks/builds/clientpulse/session-1-foundation-spec.md`
**Spec commit:** working-tree (iter-3 checkpoint edits applied, iter-4 mechanical edits applied)
**Spec-context commit:** `00a67e9bec29554f6ca9cb10d1387e7f5eeca73f`
**Iteration:** 4 of 5 (hard lifetime cap)
**Timestamp:** 2026-04-20T03:45:00Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 5 until the finding below is resolved.

## Iter-4 mechanical findings already applied

Codex surfaced 10 findings; 9 were mechanical and have been applied directly to the spec:

- **Finding 1** — §1.1 first bullet + §1.3(h) tightened to reflect the two-layer deep-merge chain and NULL override semantics under Option A.
- **Finding 2** — §2.5 schema-change row now explicitly lists `appliedSystemTemplateId` alongside `operationalConfigOverride` (matches §2.4 migration + §9.3 inventory).
- **Finding 3** — §2.4 `COMMENT ON COLUMN hierarchy_templates.operational_config_seed` rewritten; stale "copied into override on adoption" language removed.
- **Finding 4** — §4.5 response shape: `systemDefaults` is now `OperationalConfig | null` with explicit UI fallback behaviour for legacy orgs with no adopted template.
- **Finding 5** — §4.1 error-code union adds `INVALID_BODY` to match the §4.4 route example.
- **Finding 6** — §4.5 `differsFromTemplate(path)` now uses deep-equal (JS `!==` was reference equality and mechanically wrong for array/object leaves); added chunk-6 audit for the helper choice.
- **Finding 8** — §7.3 screen 3 now explicitly says only dirty fields are POSTed, preserving the Option A NULL-until-first-edit lock.
- **Finding 9** — §8.3 `organisationServiceCreateFromTemplate.test` description updated — test now asserts the override stays NULL (Option A lifecycle).
- **Finding 10** — §2.2 / §6.5 / §7.2 step 3 / S1-5.2 all standardised to "inherit via `orgConfigService.getOperationalConfig(orgId)`"; §10.8 got two new audit items.

The one remaining finding (below) is directional — a small audit-trail shape decision.

---

## Summary

| # | Finding | Question | Recommendation | Why |
|---|---------|----------|----------------|-----|
| 4.1 | §7.2 step 6 config_history row under Option A | Under Option A no override write happens at create-time. Should `createFromTemplate` still write a `config_history` row, and if so, what goes in `snapshot_after`? | **Keep step 6 as audit marker with `entity_type='organisation_operational_config'`, `entity_id=organisation.id`, `snapshot_after=NULL`.** | A small-but-real product call about whether org creation is itself a timeline-worthy event. Keep-with-NULL preserves a clean creation marker; remove is cleaner under strict "log writes only" reading. |

---

## Finding 4.1 — §7.2 step 6 `config_history` row semantics under Option A

**Classification:** directional (reclassified from ambiguous)
**Signal matched:** "Change the interface of X" — what does `config_history` represent? An event log of config changes, or a timeline of config-related org milestones? The answer determines the creation-event row's existence.
**Source:** Codex (Finding 7)
**Spec section:** §7.2 step 6 (current language: "Write a `config_history` row with `change_source='system_sync'` and `change_summary='Organisation created from template <template-slug>'`."), with dependency on §4.8's entity-type contract.

### Finding (verbatim)

> `§7.2` step 6, `§4.8`
> Problem: `createFromTemplate` is told to write a `config_history` row even though Option A performs no override write at org creation, but the spec never defines what entity/type/version/snapshot that row should use.
> Fix: either remove step 6, or add an explicit contract such as `entity_type='organisation_operational_config'`, `entity_id=organisation.id`, and what `snapshot_after` / version mean when the override row is still `NULL`.

Verified by spec-reviewer:

- §4.8 locks the entity_type for new writes to `organisation_operational_config` and entity_id to the organisation id. That contract is stable.
- §7.2 step 6 in the current spec says the row gets `change_source='system_sync'` and a human-readable `change_summary`, but doesn't specify the entity_type, entity_id, or `snapshot_after`.
- Under Option A, no override write has happened at org creation. `organisations.operational_config_override` is NULL. `snapshot_after` in every other `config_history` row is the post-write state of the config — here, there is no write and no state delta.
- Two defensible options:
  - **Option A-keep: Audit row with `snapshot_after=NULL`.** Entity_type/entity_id per §4.8 contract. Represents "org was created at time T adopting template X; no explicit overrides yet." Preserves a clean creation-event marker at the start of the org's config-history timeline.
  - **Option A-remove: Drop step 6 entirely.** Under a strict "log config writes only" reading, no write happened at create-time, so no history row. The org's `created_at` timestamp and `applied_system_template_id` already mark the creation event. `config_history` stays pure.

### Recommendation

**Option A-keep.** Concrete edits to apply if Decision = `apply`:

- **§7.2 step 6:** replace with: "Write a `config_history` row marking the creation event: `entity_type='organisation_operational_config'`, `entity_id=<new organisation id>`, `change_source='system_sync'`, `change_summary='Organisation created from template <template-slug>'`, `snapshot_after=NULL` (representing 'no explicit overrides yet — effective config is the adopted template's current defaults'). This is an audit-trail marker for the creation event, not a config-change record; the `snapshot_after=NULL` value is the signal that no override write has happened."
- **§4.8:** add one sentence to the end of "Entity type change" bullet: "Creation-event rows written by §7.2 step 6 carry `snapshot_after=NULL` — downstream history readers must treat NULL as 'no explicit overrides yet' and render the effective config from `system_hierarchy_templates.operational_defaults` for that timestamp."
- **Add a line to §10.1 decisions log:** "Org-creation config_history row | Keep as audit-trail marker with `snapshot_after=NULL` (represents no-override-yet state) | §7.2 step 6, §4.8"

**Alternative option to consider (do NOT apply unless the Decision explicitly picks it):**

- **Option A-remove.** Drop §7.2 step 6 entirely. Edits: remove the "6. Write a `config_history` row..." line from §7.2; update §7.2's step count (5 total); add decision to §10.1 ("Org-creation config_history row | Not written — `config_history` logs config writes only, and Option A performs no write at create-time | §7.2"). Cost: no first-row marker in the config timeline; the first history row for an org becomes whatever the first operator edit is (potentially much later).

### Why

Option A-keep is recommended because:

- The spec already wrote step 6 into §7.2 at iter-1 — the intent of having a creation-event marker predates Option A, and nothing in Option A specifically retires that audit row.
- `config_history` is the primary "what happened to this org's config and when" timeline operators see in the UI (per §4.8's history-viewer prose). A creation marker there gives operators a clean "Organisation created on <date> adopting <template>" entry as the start of the timeline.
- `snapshot_after=NULL` is unambiguous — it says "no override write happened at this timestamp" — and readers can easily distinguish creation-event rows (NULL snapshot) from actual config-change rows (non-NULL snapshot).

Option A-remove is defensible under a strict reading of `config_history` as "log of config writes only", and the `organisations.created_at` column already records when the org was created. But the audit trail loses a small-but-useful signal.

### Classification reasoning

This matches the "Change the interface of X" signal — specifically, the semantic contract of what `config_history` means (event log vs. write log). Both options change the semantic contract in different ways. The human owns the call because either option can be defended and neither is a clear mechanical consequence of Option A.

### Decision

Edit the line below to one of: `apply` (adopt recommendation — Option A-keep), `apply-with-modification`, `reject` (pick Option A-remove — drop step 6), `stop-loop`.

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## How to resume the loop

After editing the `Decision:` line in the finding body:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour the decision, and continue to iteration 5 — the final iteration under the 5-lifetime cap.

If you want to stop the loop without resolving this finding, set the decision to `stop-loop`; the 9 mechanical findings already applied stay in place.

---

## Iteration 4 Summary (for context)

- Mechanical findings accepted:  9
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            1 (reclassified to directional — this checkpoint)
- Reclassified → directional:    1
- HITL checkpoint path:          this file
- HITL status:                   pending

**Stopping-heuristic status:** iter-3 had 1 directional, iter-4 has 1 directional. The two-consecutive-mechanical-only rule does not fire. Next iteration (iter-5) is the hard lifetime cap — the loop will exit after iter-5 regardless of outcome.

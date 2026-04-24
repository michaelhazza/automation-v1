# Spec Review HITL Checkpoint — Iteration 3

**Spec:** `tasks/builds/clientpulse/session-1-foundation-spec.md`
**Spec commit:** working-tree (iter-2 mechanical changes applied, iter-3 mechanical changes applied)
**Spec-context commit:** `00a67e9bec29554f6ca9cb10d1387e7f5eeca73f`
**Iteration:** 3 of 5
**Timestamp:** 2026-04-20T02:45:00Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 4 until the finding below is resolved. Resolve by editing the `Decision:` line, then re-invoking the spec-reviewer agent.

Context: iteration 3 also applied 5 mechanical findings directly to the spec (Codex #2 reset-to-default derived states, Codex #3 §8.8 data-loss caveat scoped to pre-production framing, Codex #4 subaccount-seeding source alignment, Codex #5 operationalConfigRegistry folded into sensitiveConfigPathsRegistry, Codex #6 §3.5/§9.3 touch-list cleanup). The one finding below is directional — it's a product-semantic choice about what `organisations.operational_config_override` contains on the day an org is created, and the knock-on effect is whether orgs inherit future system-template default changes or are frozen on create.

---

## Summary

| # | Finding | Question | Recommendation | Why |
|---|---------|----------|----------------|-----|
| 3.1 | `createFromTemplate` override-row contents | Should a newly-created org's `operational_config_override` start as `NULL` (effective = system defaults, follows platform changes), as a full eager copy of `operational_defaults` (frozen on create), or as an empty `{}`? | Start with `NULL`; orgs inherit future system-template default changes by default. Operators can override any path at any time via the Settings page or Configuration Assistant. | §4.5's iter-1 locked semantic makes eager copy surface "manually set" on every field on day one, which defeats iter-3's two-derived-states cleanup. Leaving it NULL lets the derived states surface genuine operator intent. |

---

## Finding 3.1 — `createFromTemplate` override-row contents on org creation

**Classification:** directional
**Signal matched:** Architecture signals — "Change the interface of X" (the semantic contract of what `organisations.operational_config_override` contains at create-time is a product decision with downstream behaviour)
**Source:** Codex
**Spec section:** §7.2 step 2 (current language: "Copy `systemHierarchyTemplates.operational_defaults` → `organisations.operational_config_override` (fresh copy, operator can diverge from the template from day one)"), with knock-ons in §7.1 preview text and §8.4 manual verification step 5

### Finding (verbatim)

> **§7.2 — `createFromTemplate` seeds the override row with full defaults.** Step 2 says `systemHierarchyTemplates.operational_defaults` is copied wholesale into `organisations.operational_config_override`, but §2/§4/§6 treat that column as sparse org overrides whose path presence drives override badges and reset affordances. A full copy would mark every field as overridden on day one and shadow future system-template default changes. Suggested fix: edit §7.2 step 2 so create-org sets `applied_system_template_id` and leaves `operational_config_override` `NULL` (or writes only true org-specific deltas), then update §7.1/§8.4 verification text to match.

Verified by spec-reviewer:

- §4.5 iter-1 locked: `hasExplicitOverride(path)` = "path is present in overrides"; `differsFromTemplate(path)` = "effective leaf differs from system default." (These two derived states landed in iteration 3 as finding #2's mechanical fix.)
- §6.4 iter-3 locked: "manually set" indicator + reset-button logic both depend on these derived states.
- §7.2 current step 2: `organisations.operational_config_override` = full copy of `operational_defaults`. Under the locked §4.5 semantic, this marks EVERY leaf as `hasExplicitOverride = true` on day one.
- §2.2 rationale: "stop reading [seed] after initial adopt; all runtime reads go through the org column." Under eager seeding, "all runtime reads go through the org column" is technically true, but every read returns a frozen snapshot of defaults rather than following the live system-template column — which is the opposite of what a "template" is usually expected to provide.
- The existing `orgConfigService.getOperationalConfig` deep-merge is `deepMerge(systemDefaults, overrides)`. When overrides is NULL, effective = systemDefaults. When overrides is an eager copy, effective = (frozen) systemDefaults and future changes to `operational_defaults` never reach the org.

### Recommendation

**Apply Option A — `operational_config_override` starts as `NULL`; orgs inherit future system-template default changes by default.** Concrete edits to apply if Decision = `apply`:

- **§7.2 step 2:** replace with: "Set `applied_system_template_id = systemTemplateId`. Leave `operational_config_override` as `NULL`. The effective config for the new org is provided by `systemHierarchyTemplates.operational_defaults` deep-merged with `NULL`, which resolves to the platform's current defaults. Any subsequent edit via the Settings page or Configuration Assistant writes the first entry into the override column, initialising the row; before that the org inherits every platform-level default change automatically."
- **§7.1 "Live preview" text:** replace "Operational defaults: <summary bullets>" with "Operational defaults: inherited from the template (no org-specific overrides until the operator edits settings)."
- **§7.1 "Confirm button" description:** replace "copies the template's `operational_defaults` into the new `organisations.operational_config_override`" with "links the new org to the template via `applied_system_template_id`; the override column stays NULL until first edit."
- **§8.4 manual verification step 5:** replace "operational config override populated" with "operational config override stays NULL (org inherits the template's defaults via the applied-system-template FK)."
- **Add a line to §10.1 decisions log:** "Create-org override-row posture | NULL (orgs inherit future system-template default changes; first override write initialises the row) | §7.2"

**Alternative options to consider (do NOT apply these unless the Decision explicitly picks one):**

- **Option B — eager copy (current spec language).** Orgs are frozen to defaults-at-create; future system-template changes never propagate. Operators must manually re-reset every path if they want platform updates. Sold: "Phase-0 agencies want stable defaults they don't need to re-accept." Cost: loses the two-derived-states cleanup's value — every field shows "manually set" on day one.
- **Option C — hybrid: NULL at create, but Settings page offers a "re-adopt template" button.** Orgs inherit live platform changes by default; operators who want the frozen-snapshot semantics opt in explicitly. Higher scope (adds a new action path to Session 1); more UI surface to build.
- **Option D — eager copy BUT keep the two-derived-states UX by diffing the override row against `operational_defaults` on read.** `differsFromTemplate` works regardless of whether the override row is eagerly populated. The issue is `hasExplicitOverride` — under eager copy, every leaf reports "manually set" even though nobody set it manually. Could be worked around by recording the set-at-create timestamp per-leaf, but that's a much bigger schema change.

### Why

Option A is the minimum-viable change that makes §4.5's locked derived-states semantic meaningful for a just-created org. It is also the option most consistent with a product-buyer's mental model of "Organisation Template" — templates define defaults; orgs inherit them until they diverge.

Option B is what the spec currently says, but it is demonstrably inconsistent with §4.5's locked semantic now that iteration 3 has tightened the derived states. Leaving Option B in place means the "manually set" indicator surfaces a false signal on day one for every org, and the reset button requires the effective-value-vs-system-default comparison (differsFromTemplate), which would evaluate `false` immediately after create even though hasExplicitOverride would evaluate `true` — a surface-level inconsistency that the iter-3 cleanup was supposed to eliminate.

Option C is a superset of A, but the "re-adopt template" button is out of scope for Session 1 per §10.7 ("Template-switch flow for existing orgs"). If the recommendation is A, opening template-switch-back-to-inherit is a Session 2+ follow-up, not a blocker.

Option D preserves the current spec's behaviour but adds schema state to track per-leaf "set-at-create" vs "explicitly-touched-by-operator." Too much scope for Session 1; the work is not justified by the problem it solves.

### Classification reasoning

This matches the "Change the interface of X" signal. The question "what does `organisations.operational_config_override` contain immediately after org creation?" is a semantic-contract choice that determines both UI surfacing and runtime behaviour. The spec's original §7.2 step 2 (eager copy) predates iter-3's two-derived-states cleanup; the cleanup exposed the contradiction but did not by itself pick a resolution. The human owns the choice between inherit-live-platform-changes (A), freeze-on-create (B), hybrid (C), and schema-level workaround (D).

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`.

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
3. The agent will read this checkpoint file as its first action, honour the decision (apply, apply-with-modification, reject, or stop-loop), and continue to iteration 4.

If you want to stop the loop entirely without resolving this finding, set the decision to `stop-loop` and the loop will exit immediately.

---

## Iteration 3 Summary (for context)

- Mechanical findings accepted:  5 (Codex #2 derived states, #3 §8.8 data-loss, #4 subaccount-seeding, #5 config registry fold, #6 touch-list cleanup)
- Mechanical findings rejected:  0
- Directional findings:          1 (this checkpoint)
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          this file
- HITL status:                   pending

**Stopping-heuristic status:** iteration 2 was mechanical-only; iteration 3 has 1 directional finding. The two-consecutive-mechanical-only-rounds rule does not yet fire. The loop continues until either two consecutive mechanical-only rounds land or the lifetime cap of 5 iterations is hit.

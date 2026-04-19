# Spec Review HITL Checkpoint — Iteration 1

**Spec:** `tasks/clientpulse-ghl-gap-analysis.md`
**Spec commit:** `b9c2939e7a745233340186097f0d3c87f48ae690`
**Spec-context commit:** `00a67e9bec29554f6ca9cb10d1387e7f5eeca73f`
**Iteration:** 1 of 5
**Timestamp:** 2026-04-18T00:00:00Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 2 until every finding below is resolved. Resolve by editing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

---

## Summary

| # | Finding | Question | Recommendation | Why |
|---|---------|----------|----------------|-----|
| 1.1 | Auto-proposer scope contradiction | Is the intervention proposer **automatic** (fires after every churn assessment) or **manual** (operator triggers surfacing) in V1? | Keep V1 as **manual** (per §21.1). Delete `proposeClientPulseInterventionsJob` from §§6.4, 9.8, 10 Phase 4; replace with an operator-triggered surfacing flow on the dashboard that reads `client_pulse_churn_assessments` on demand. | §21 was added later (2026-04-18) and is the most recent product decision. §6 wasn't updated when §21 landed. |
| 1.2 | Intervention source-of-truth duplication | Is the intervention record `actions` (existing) or `client_pulse_interventions` (proposed in Phase 4)? | Keep `actions` + `reviewItems` + `interventionOutcomes` as the intervention record. Drop `client_pulse_interventions`. Put ClientPulse-specific metadata inside `actions.parameters`. | §6.2 says the existing triad is "the right substrate"; adding a parallel table contradicts §6.2 and the spec-context preference for existing primitives. |
| 1.3 | Primitive slugs collide with existing registered actions | Two of the 5 primitive slugs (`send_email`, `create_task`) already exist in `actionRegistry.ts` with different, CRM-unaware schemas. `trigger_account_intervention` also exists as a wrapper. Which slugs does ClientPulse use? | **Option A (preferred):** keep `trigger_account_intervention` as the top-level action; nest `primitive: 'fire_automation' \| 'send_email' \| 'send_sms' \| 'create_task' \| 'operator_alert'` inside its payload. **Option B:** prefix new slugs with `client_pulse.`. | Overloading existing action-type slugs with different schemas breaks existing callers and static gates. |
| 1.4 | Tier source-of-truth overlap | Is ClientPulse tiering expressed as a new `org_subscriptions.tier` column, or as entries in the existing `subscriptions` catalogue? | Use the existing `subscriptions` catalogue. Add `client_pulse_monitor` and `client_pulse_operate` rows. Derive tier-gated behaviour from the active subscription. | Matches accepted_primitives rule "prefer existing primitives" and avoids a second entitlement surface. |
| 1.5 | `organisations.timezone` field does not exist | §§7.2 / 13 / 19 assume `organisations.timezone` is the source of Monday-email time zone. The column is not in `server/db/schema/organisations.ts`. Where does the briefing schedule read its timezone from? | Add the `timezone` column to `organisations` in Phase 0 (single source of truth for org-level scheduling). | Adding the column is a one-time migration; threading an existing subordinate field creates a bespoke resolution rule. |
| 1.6 | `config_changes` audit table duplicates `config_history` | §17.2.6 introduces `config_changes`. `config_history` + `configHistoryService` already exist. Create a second audit store or extend the existing one? | Extend `config_history` / `configHistoryService`. If missing columns (per-path diffs, `reverted_at`, `reverted_by`), add them. Drop `config_changes`. | Two parallel audit stores split history queries and undo flows. spec-context lists "prefer existing primitives" as a directional rejection rule. |
| 1.7 | `client_pulse_intervention_templates` — retired or narrowed? | §10 Phase 4 says templates-plan is superseded (D7), but §§6.4, 8.4, 9.4, 10 Phase 6, 13.5 still reference the table as a live storage surface. What is its V1 status? | **Option A (preferred):** keep the table but narrow it to *proposer trigger hints* only. Rename to `client_pulse_proposer_templates`. Drop `proposedActionParamsTemplate` (no pre-composed content). Keep `triggerCondition` + `suggestedPrimitive` + `cooldown*`. **Option B:** retire entirely, inline the trigger hints in skill config. | Leaving the table contradictorily-scoped produces two incompatible implementations. |

---

## Finding 1.1 — Auto-proposer scope is unresolved

**Classification:** directional
**Signal matched:** Scope signals — "Remove this item from the roadmap" / "Bring this forward to an earlier phase"
**Source:** Codex
**Spec section:** §§6, 10 Phase 4, 11.3 D3, 21.1

### Finding (verbatim)

> `§6` and Phase 4 define an automatic proposer job that creates review items after each churn assessment, but `§21.1` says V1 is "manual proposer only" and "no auto-proposer." Those are materially different products, affecting jobs, quotas, review-queue volume, and ship criteria.

### Recommendation

Record a single V1 verdict. Strongly prefer **manual-only in V1**:

- Delete `proposeClientPulseInterventionsJob` from §6.4 (fourth bullet), §9.8 and §10 Phase 4 build list.
- Rewrite §6.4 "Intervention proposer job" paragraph to describe an operator-triggered surfacing flow: the dashboard reads `client_pulse_churn_assessments` on demand; when the operator clicks "Propose intervention" on a row, a draft review item is created for the operator to configure via the primitive editors.
- Rewrite §11.3 D3 to say "DFY and SaaS VAs use the manual proposer queue as a work surface in V1; auto-proposer reserved for V2."
- Leave §21.1 "Manual proposer only — operator surfaces scenarios, operator triggers action. No auto-proposer" as-is; this becomes the canonical statement.

The alternative (auto-proposer in V1) requires designing quota enforcement, review-item fan-out logic, cooldown scheduling against multiple concurrent assessments, and operator-signalled "disable for this sub-account" controls — all material additions. V1 explicitly aimed to keep scope tight.

### Why

§21 was added 2026-04-18 as the *scope-tightening pass* for V1 vs V2. §6 was written before that pass and never updated. Leaving both in the spec produces two incompatible build plans.

### Classification reasoning

This is a scope decision (remove an item from the roadmap) — explicitly on the "directional" signal list.

### Decision

```
Decision: PENDING
Modification (if apply-with-modification):
Reject reason (if reject):
```

## Finding 1.2 — Intervention source-of-truth duplicates

**Classification:** directional
**Signal matched:** Architecture signals — "Introduce a new abstraction / service / pattern"
**Source:** Codex
**Spec section:** §§6.2, 6.4, 10 Phase 4, 9.4

### Finding (verbatim)

> `§6` says `actions` + `reviewItems` + `interventionOutcomes` are already the right substrate, but Phase 4 introduces a new `client_pulse_interventions` table that appears to store the same proposal/payload/status/outcome lifecycle. Without a source-of-truth statement, implementers will duplicate state and drift the queue from execution records.

### Recommendation

Drop the `client_pulse_interventions` table entirely. Keep `actions` (proposal/status/approval) + `reviewItems` (approval queue projection) + `interventionOutcomes` (14-day band-change measurement) as the three-table substrate.

Concrete edits:

- §10 Phase 4: delete the bullet "Migration: `client_pulse_interventions` (proposal record + chosen primitive + configured payload + status + outcome)." Replace with: "Extend `actions.parameters` JSONB schema to carry the ClientPulse payload (primitive choice + resolved merge-field content + target contact + target subaccount). No new table."
- §9.4 (canonical taxonomy tables): remove `client_pulse_interventions` from the derived-tables list. Add a note "The intervention record is `actions` — same substrate every other HITL action uses."
- If typed access is needed for reporting, add a narrow sidecar view (not a table), e.g. `vw_client_pulse_interventions`, that projects from `actions` + `interventionOutcomes`.

### Why

`actions` already has `actionType`, `actionCategory`, `gateLevel`, `status`, `idempotencyKey`, `suspendCount`, `suspendUntil`, `approvedBy`, `approvedAt`, `rejectionComment`. `reviewItems` projects pending ones. `interventionOutcomes` tracks before/after health score + measurement window. Every field the proposed `client_pulse_interventions` would carry is either already in that triad or belongs in `actions.parameters`. A parallel table drifts from the existing audit/queue/approval paths.

### Classification reasoning

Introducing a new table that duplicates existing primitives is an architecture-level decision — matches "Introduce a new abstraction" in the directional signals list.

### Decision

```
Decision: PENDING
Modification (if apply-with-modification):
Reject reason (if reject):
```

## Finding 1.3 — Primitive slugs collide with existing actions

**Classification:** directional
**Signal matched:** Architecture signals — "Change the interface of X"
**Source:** Codex (fact-check confirmed — `server/config/actionRegistry.ts` lines 273, 324, 1170)
**Spec section:** §§15.1, 10 Phase 4, 9.3

### Finding (verbatim)

> The spec repurposes `send_email` and `create_task` as CRM-dispatched intervention primitives, but those slugs already exist with different schemas and semantics in `server/config/actionRegistry.ts`: `send_email` is generic provider email (`to/subject/body/provider`) and `create_task` creates an internal board task. Reusing the same names would break existing callers or require a silent contract change.

### Recommendation

**Option A (preferred):** route every ClientPulse intervention through the existing `trigger_account_intervention` action (`actionRegistry.ts:1170`). The 5-primitive choice moves *inside* its payload as `payload.primitive: 'fire_automation' | 'send_email' | 'send_sms' | 'create_task' | 'operator_alert'`.

Concrete spec edits for Option A:

- §15.1 table: rename the "V1 config contract" column header to "Payload shape inside `trigger_account_intervention`". Replace each row's `action: 'send_email'` with `primitive: 'send_email'` etc.
- §10 Phase 4 first bullet: replace "Register the 5 action-type primitives in `actionRegistry.ts`" with "Extend the existing `trigger_account_intervention` action schema in `actionRegistry.ts` to accept a `primitive` enum + primitive-specific payload shape. No new top-level action types."
- §9.3 (new action types): drop the list entirely; state that no new action types are registered — ClientPulse reuses `trigger_account_intervention`.

**Option B:** introduce net-new slugs prefixed `client_pulse.` (e.g. `client_pulse.send_email`, `client_pulse.fire_automation`). Keeps the 5-primitive surface flat at the registry level but adds 5 new slugs. Worse than A because it introduces 5 new action types where 0 are needed.

### Why

Overloading existing action-type slugs with different schemas silently breaks existing callers (any route, job, or agent that constructs `send_email` or `create_task` with the old shape). Static gates might not catch it if the new schema is a superset of the old. The `trigger_account_intervention` wrapper already exists exactly for this pattern.

### Classification reasoning

Changing the interface (schema) of existing registered action types is an architecture-level decision.

### Decision

```
Decision: PENDING
Modification (if apply-with-modification):
Reject reason (if reject):
```

## Finding 1.4 — Tier source-of-truth overlaps

**Classification:** directional
**Signal matched:** Architecture signals — "Introduce a new abstraction / service / pattern"
**Source:** Codex
**Spec section:** §§12.4, 11.3 D6

### Finding (verbatim)

> `§12.4` proposes adding `org_subscriptions.tier = monitor|operate`, but the repo already models product access through `subscriptions`, `org_subscriptions.subscription_id`, and `modules`. Adding a separate tier column creates two entitlement systems unless the precedence and sync rules are specified.

### Recommendation

Use the existing `subscriptions` catalogue as the single source of truth. Concrete edits to §12.4:

- Replace "We extend it with a `tier` column on `orgSubscriptions` (enum: `'monitor'` | `'operate'`)" with "Add two `subscriptions` catalogue rows: `client_pulse_monitor` and `client_pulse_operate`. `org_subscriptions.subscription_id` points at one of them per org. Tier-gated behaviour derives from the active subscription via `moduleService.getActiveSubscription(orgId, 'client_pulse')`, not a parallel column."
- Replace the accessor `getClientPulseTier(orgId)` with `moduleService.getActiveSubscription(orgId, 'client_pulse')` returning `'monitor' | 'operate' | null`.

### Why

Two entitlement systems (a `subscriptions` row *and* a parallel `tier` column) split product-access logic across two query paths. The existing `subscriptions` table is already a catalogue of SKU-shaped rows — adding two more rows is the minimum-schema-change move.

### Classification reasoning

Introducing a parallel entitlement store is an architecture decision.

### Decision

```
Decision: PENDING
Modification (if apply-with-modification):
Reject reason (if reject):
```

## Finding 1.5 — Timezone field is unspecified

**Classification:** directional (schema decision)
**Signal matched:** Architecture signals — "Change the interface of X"
**Source:** Codex (fact-check confirmed: `organisations.ts` has no `timezone`; `scheduledTasks` / `subaccountAgents` / `orgAgentConfigs` do)
**Spec section:** §§7.2, 13.1, 13.6, 19

### Finding (verbatim)

> The Monday email requirements reference `organisations.timezone`, but `server/db/schema/organisations.ts` has no such column. The scheduling system already has timezone fields elsewhere, so the spec currently points at a field that does not exist and does not name the actual source of truth.

### Recommendation

Add `timezone` as a new column on `organisations` in the Phase 0 migration. All org-level scheduled work (briefings, digests, Monday email, health-scan windows) reads from `organisations.timezone`. Sub-account and scheduled-task timezones remain as they are (they are override points, not the default).

Spec edits:

- §9.5: add `organisations.timezone` to the "existing tables extended" list.
- §7.2: change "editable in `ClientPulseConfigPage`" to "editable on the org settings page; column added in Phase 0".
- Phase 0 ship gate: add "New `organisations.timezone` column migrated; existing orgs default to `'UTC'` — org admin can override on the settings page."

### Why

The schedule-level timezone fields are per-job, not per-org. Threading one of them as the "org timezone" (e.g. always read from `scheduledTasks`) creates a bespoke resolution rule, and the rule breaks when an org has zero or multiple scheduled tasks. A dedicated `organisations.timezone` column is one table, one query, one truth.

### Classification reasoning

Adding a column to a core table is a schema-interface decision — matches "Change the interface of X".

### Decision

```
Decision: PENDING
Modification (if apply-with-modification):
Reject reason (if reject):
```

## Finding 1.6 — Audit table duplicates existing config history

**Classification:** directional
**Signal matched:** Architecture signals — "Introduce a new abstraction / service / pattern"; spec-context `prefer_existing_primitives_over_new_ones: yes`
**Source:** Codex (fact-check confirmed: `server/db/schema/configHistory.ts` + `server/services/configHistoryService.ts` exist)
**Spec section:** §17.2.6, §18.3

### Finding (verbatim)

> `§17` introduces a new `config_changes` table and new audit flow, but the repo already has `config_history`, `configHistoryService`, and config-history routes. A second audit store would split change history across two tables and complicate rollback/history UI.

### Recommendation

Reuse `config_history` + `configHistoryService` for ClientPulse config changes. Concrete edits to §17.2.6:

- Delete the `config_changes` table definition.
- Replace the "New table: `config_changes` (audit log)" section with: "ClientPulse config changes write to the existing `config_history` table via `configHistoryService.recordChange(...)`. If per-path diffing, `source`, or `reverted_by` are not already on `config_history`, add them to that table in the Phase 0 migration."
- §17.3 (bidirectional flow): replace `config_changes (audit)` with `config_history (audit)`.
- §18.3: change "one `config_changes` row per path changed" to "one `config_history` row per path changed".

### Why

Two parallel audit stores split every downstream query (change log UI, undo button, audit reports) between tables. The cleanest move is extending the existing service rather than creating a second one. spec-context explicitly lists "prefer existing primitives" as a directional rejection rule for new services.

### Classification reasoning

Introducing a parallel audit store duplicates an existing primitive. Matches the directional "Introduce a new abstraction" signal.

### Decision

```
Decision: PENDING
Modification (if apply-with-modification):
Reject reason (if reject):
```

## Finding 1.7 — `client_pulse_intervention_templates` — retired or narrowed?

**Classification:** ambiguous
**Signal matched:** Cross-cutting signals — "Add a new cross-cutting contract"
**Source:** Rubric-contradiction
**Spec section:** §§6.4, 8.4, 9.4, 10 Phase 4, 10 Phase 6, 13.5, 11.4 Q5

### Finding

§10 Phase 4 header says the spec "Supersedes the earlier 'six hardcoded intervention templates' plan" (per D7). §15 reframes interventions as "pick one of 5 CRM-agnostic primitives, not hardcoded templates." But:

- §6.4 still defines the `client_pulse_intervention_templates` table as the canonical storage of trigger conditions + cooldown + measurement windows.
- §8.4 reuses the same table for trial-milestone nudges.
- §9.4 lists it in the configuration-library tables.
- §13.5 Digest joins it in the pattern-learnings query.
- §10 Phase 6 explicitly says "Reuse `client_pulse_intervention_templates` for milestone-stalled nudges."
- §11.4 Q5 still asks Kel about the "default library of six intervention templates".

So is the table retired, kept as a trigger-metadata store only, or kept in full?

### Recommendation

**Option A (preferred):** keep the table but narrow its role to *proposer trigger hints* only. Rename to `client_pulse_proposer_templates`. Drop the `proposedActionParamsTemplate` JSONB column (no pre-composed content in v1 — the operator composes per-proposal via the primitive editors). Keep `triggerSignalSlug`, `triggerCondition`, `suggestedPrimitive`, `cooldownHours`, `cooldownScope`, `measurementWindowHours`. Phase 6 trial-nudges seed rows with `suggestedPrimitive='send_email'` etc.

Spec edits if Option A:
- §6.4: rewrite the `client_pulse_intervention_templates` schema to the narrowed column set and rename.
- §10 Phase 4: state explicitly that the table ships in this phase as *proposer trigger hints*, not as a content library.
- §11.4 Q5: retire the question (D7 already answered "no default content library").

**Option B:** retire the table entirely in v1. Move trigger-hint metadata inline into the proposer skill's config block. Phase 6 trial-milestone nudges use the same inline config.

### Why

Leaving the table defined but contradictorily-scoped produces two incompatible implementations: one engineer reads §6 and builds a full template storage with pre-composed content; another reads §15 and builds primitive-only proposals. Both can't ship.

### Classification reasoning

This is a cross-cutting question about what a table carries — it sits on the boundary of directional (architecture) and mechanical (cleanup). Biasing to HITL because the narrowing direction has scope implications in §§6, 8, 10, 13.

### Decision

```
Decision: PENDING
Modification (if apply-with-modification):
Reject reason (if reject):
```

---

## How to resume the loop

After editing all `Decision:` lines below:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (`apply`, `apply-with-modification`, `reject`, or `stop-loop`), and continue to iteration 2.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.

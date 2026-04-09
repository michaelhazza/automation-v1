# Spec Review HITL Checkpoint — Iteration 4

**Spec:** `docs/improvements-roadmap-spec.md`
**HEAD commit at review start:** `6a8e48b33d88c1218cac7a694f746ffc8c011abd`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 4 of 5
**Timestamp:** 2026-04-09T00:30:00Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 5 until every finding below is resolved by the human. Resolve by editing this file in place, changing each `Decision:` line to `apply` / `apply-with-modification` / `reject` / `stop-loop`, then re-invoking the spec-reviewer agent.

Iteration 4 applied 6 mechanical findings in parallel with this checkpoint being written. See the "Iteration 4 Summary" section at the bottom for the list.

## Table of contents

- Finding 4.1 — P3.1 / I3 bulk-run contract: parent_run_id / target_subaccount_id / `partial` status are unspecified (directional)
- Finding 4.2 — P4.3 replanning: `plan_json` revision envelope vs overwrite-latest (directional)

---

## Finding 4.1 — P3.1 / I3 bulk-run contract: parent_run_id / target_subaccount_id / `partial` status are unspecified

**Classification:** directional
**Signal matched:** Architecture signals — "Introduce a new abstraction" / "Change the interface of X". The bulk-run contract introduces new schema fields (`parent_run_id`, `target_subaccount_id` on `playbook_runs`) and a new status value (`partial`). This is a schema-shape decision that affects the migration inventory for P3.1.
**Source:** Codex (iteration 4 finding #4)
**Spec section:** P3.1 Design / Testing strategy I3 (`playbookBulk.parent-child-idempotency.test.ts`)

### Codex's finding (verbatim)

> 4. Section: `P3.1` / `Testing strategy I3` — Bulk-mode idempotency and failure semantics rely on `(parent_run_id, target_subaccount_id)` and parent status `partial`, but no source-of-truth contract defines where those fields/status live or how they are persisted. Suggested fix: Add an explicit bulk-run contract naming the authoritative fields/statuses and the file/schema that owns them, or remove those claims from I3 until specified. Severity: High.

### Tentative recommendation (non-authoritative)

Two coherent options:

**Option A — add the contract to P3.1 now.** Extend migration 0086 (or add 0086b) to also add `parent_run_id uuid REFERENCES playbook_runs(id)` and `target_subaccount_id uuid REFERENCES subaccounts(id)` nullable columns on `playbook_runs`, plus widen the `status` CHECK constraint to include `'partial'`. Mirror in `server/db/schema/playbookRuns.ts`. Update P3.1 Files to change and migration 0086 description. Honours "prefer existing primitives" by extending `playbook_runs` rather than introducing a new `playbook_bulk_runs` table.

**Option B — strip the claims from I3.** Remove the `(parent_run_id, target_subaccount_id)` keying language and the `partial` status assertions from I3 test cases 2, 3, and 5. Rewrite them to test only fan-out, retry dedup via pg-boss singletonKey, concurrency cap, and failure propagation without asserting a specific parent-status or key shape. This is cheaper but leaves P3.1 under-specified — the bulk branch has to invent its own durable state.

### Reasoning

The choice is a schema-shape call: does bulk mode get first-class parent/child relationships and a `partial` completion status on `playbook_runs`, or does it store that state somewhere else (e.g. `contextJson.bulkResults`) without a typed column? Option A matches what I3's test cases already assume; Option B matches iteration 3's decision to keep bulk mode fully inline in the engine without new processors/jobs. Both options are internally consistent but they commit to different persistence shapes. Pre-production framing doesn't obviously push either way. The human owns this call because it shapes how the engine persists parent/child relationships and how the admin UI will surface bulk runs.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Option A — extend migration 0086 to add parent_run_id uuid REFERENCES playbook_runs(id) and target_subaccount_id uuid REFERENCES subaccounts(id) nullable columns on playbook_runs, plus widen the status CHECK constraint to include 'partial'. Mirror in server/db/schema/playbookRuns.ts. Update P3.1 Files to change and the migration 0086 description accordingly. Rationale: I3 test cases already depend on this shape, and iteration 3's inline-engine decision makes durable parent-child columns more important, not less (engine needs crash-resume survivability without inventing an invisible contextJson schema).
Reject reason (if reject): 
```

---

## Finding 4.2 — P4.3 replanning: `plan_json` revision envelope vs overwrite-latest

**Classification:** directional
**Signal matched:** Architecture signals — "Change the interface of X". The shape of `plan_json` (single object vs versioned envelope) is a schema contract decision that affects every downstream reader (run detail UI, trajectory comparison, regression replay).
**Source:** Codex (iteration 4 finding #5)
**Spec section:** P4.3 Design ("Replanning on failure") / Files to change (migration 0089)

### Codex's finding (verbatim)

> 5. Section: `P4.3 — Design` / `Files to change` — The design says replanning persists "a new version", but the only storage declared is a single `agent_runs.plan_json` column, so revision source-of-truth is undefined. Suggested fix: Specify that `plan_json` stores a versioned envelope (for example `{ current, revisions[] }`) or change the prose to "overwrite the latest plan" instead of "new version". Severity: High.

### Tentative recommendation (non-authoritative)

Two coherent options:

**Option A — versioned envelope.** `plan_json` stores `{ current: Plan, revisions: Plan[] }` where `revisions` is append-only and `current` is the active plan. Replanning pushes the previous `current` onto `revisions` and replaces it. The "Plan" panel in the run detail page shows `current` with a "Revisions (N)" toggle. Preserves audit history of replans at the cost of slightly fatter rows.

**Option B — overwrite-latest.** Change the prose in P4.3 Design / Replanning on failure from "The revised plan is persisted as a new version" to "The revised plan overwrites `plan_json` with a new timestamp; the previous plan is discarded." The `parsePlan()` helper returns a single plan object. No revisions array, no history preserved. Simpler shape but loses audit trail for replans.

### Reasoning

Both options are internally consistent. Option A is more honest about what "replanning" means (you can see what changed); Option B is simpler and matches the current single-column schema without any prose or helper changes. The trade-off is audit value vs simplicity. Pre-production framing argues mildly for Option B (less code, no envelope parser, no UI toggle), but the audit value of keeping the previous plan around is non-trivial when P2.2's reflection loop is expected to critique replans in a later phase. Human owns this call.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Option B — rewrite the P4.3 Design / Replanning on failure prose from "The revised plan is persisted as a new version" to "The revised plan overwrites plan_json with a new timestamp; the previous plan is discarded." parsePlan() returns a single plan object. No revisions array, no versioned envelope, no UI toggle. Rationale: no downstream consumer currently reads replan history; framing assumptions 3 and 4 argue against pre-production dead weight; additive envelope migration is cheap to add later if P2.2's reflection loop ever needs it.
Reject reason (if reject): 
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path (`docs/improvements-roadmap-spec.md`).
3. The agent will read this checkpoint file as its first action, honour each decision (`apply`, `apply-with-modification`, `reject`, or `stop-loop`), and continue to iteration 5.

If you want to stop the loop entirely without resolving every finding, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.

---

## Iteration 4 Summary

- Mechanical findings accepted:  6
- Mechanical findings rejected:  0
- Directional findings:          2 (Findings 4.1, 4.2)
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          `tasks/spec-review-checkpoint-improvements-roadmap-spec-4-20260409T003000Z.md` (this file)
- HITL status:                   pending

### Mechanical findings applied in iteration 4

1. **[Retention and pruning policies]** Fixed contradiction — "All retention configs live on `organisations`" rewritten to reflect that `regressionCaseCap` lives on `agents` while day-based retention lives on `organisations`.
2. **[Job idempotency keys]** Added missing `security-events-cleanup` row (sprint 2, singletonKey `prune-security:${date}`) — previously referenced in P1.1 Files and Retention sections but missing from the table that claims to list every new pg-boss job.
3. **[P3.1 Risk]** Removed stale "ship `auto`/`supervised`/`background` first, then `bulk` separately" mitigation — contradicted the Verdict section, which ships all four modes together. Replaced with an I3-based mitigation consistent with the ship-together story.
4. **[P4.3 Files to change]** Added `server/services/playbookEngineService.ts` and `server/services/playbookStepReviewService.ts` rows to cover the "Integrate with playbook supervised mode" / plan-approval coupling that was described in prose but missing from the Files table.
5. **[P4.4 Files to change]** Added `server/config/actionRegistry.ts` row naming the 3-5 high-stakes actions (`send_email`, `write_patch`, `create_pr`, `trigger_account_intervention`) tagged with `requiresCritiqueGate: true` — previously described in Verdict prose but missing from Files table.
6. **[Sprint 5 summary row for P4.1]** Clarified stale "29 entries" count — now reads "29 pre-change entries (30 total after this item also adds the new `ask_clarifying_question` entry)" matching the P4.1 Verdict clarification from iteration 3.

### Spec file at end of iteration 4

Working tree has uncommitted edits against `docs/improvements-roadmap-spec.md` (stacked on top of iteration 3's edits). The human should review the full diff alongside this checkpoint before resolving the pending decisions. No commit is created by the spec-reviewer.

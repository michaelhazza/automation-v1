# Playbook `agent_decision` Step Type — Implementation Spec

**Status:** Draft
**Related:** `architecture.md` (Playbooks section), `server/services/playbookEngineService.ts`, `server/lib/playbook/validator.ts`, `server/lib/playbook/templating.ts`
**Phase:** proposed for Phase 2 of `docs/improvements-roadmap.md`
**Date:** 2026-04-11

This spec defines a new step type for the Playbook DAG engine: `agent_decision`. The step asks an agent to pick between predeclared downstream branches, records the choice and rationale, and lets the engine skip the non-chosen branches.

It is the playbook-native expression of "graduated autonomy" — deterministic DAG structure with agent-driven branching at explicit decision points, rather than a single big autonomous loop.

---

## Table of contents

1. Overview & motivation
2. Scope & non-goals
3. Terminology
4. Step definition shape
5. DAG semantics — branches, convergence, skipped paths
6. Execution flow inside `playbookEngineService`
7. Agent decision contract — prompt, output schema, validation
8. Run mode interaction
9. Validation rules (`playbookTemplateService` publish path)
10. Observability & telemetry
11. Error handling & edge cases
12. Pure helper contract
13. File inventory — what changes, where
14. Testing approach
15. Non-negotiable invariants

---

## 1. Overview & motivation

Today, a `PlaybookStep` is one of five types: `prompt`, `agent_call`, `user_input`, `approval`, `conditional`. The branching type (`conditional`) evaluates a JSONLogic expression synchronously against `run.contextJson` — it is deterministic, cheap, and used where the branching rule is known at authoring time.

That leaves a gap: the author wants the playbook to branch but cannot write the rule upfront because the rule depends on judgment. "If the audit findings are material, go through the remediation branch; if they are cosmetic, go through the cleanup branch." The determination is not a boolean formula over context — it is a call an agent should make after inspecting the upstream output.

The current workaround is to add an `agent_call` step that writes a branching hint into `run.contextJson` and then follow it with a `conditional`. This works but is three concepts where one will do: a decision, the branches it chooses between, and the rationale for the choice. Splitting it across steps loses the structure and makes the UI awkward (the approval queue cannot show "the agent chose X because Y" as a single record; the side-effect classification for the decision is spread across two steps; the pure helper for invalidation cascades has to stitch the two steps back together).

`agent_decision` is the first-class expression of this pattern. It is a step whose job is exactly "look at the current run context, pick one of these N named branches, and explain why." The engine treats the choice as the step output, marks the non-chosen branches as skipped, and carries on.

**Why this is worth building now:**

- It is a small, additive extension to the existing DAG engine. No new infrastructure. No changes to the agent execution service beyond what `agent_call` already uses.
- It replaces the most common "author wanted an agent-driven branch" workaround with a single step, making playbooks simpler to author and easier to audit.
- It is the minimum-viable expression of the "graduated autonomy" story in the research brief — structured workflow with agent judgment at explicit decision points — without introducing autonomous self-direction.
- It reuses every existing governance primitive: policy engine, budget breaker, HITL gate in `supervised` run mode, cost attribution, regression capture. Nothing in the safety stack gets bypassed.

**What this is not:**

- Not a general planner. The agent cannot emit new steps or mutate the DAG. It picks from branches that the author predeclared.
- Not multi-choice. The agent picks exactly one branch (for phase 1). Multi-select is a later extension; see §2.
- Not a goal-directed loop. The agent gets one call per decision step. No retry, no self-critique, no sub-agent spawning inside the decision itself (though the branches themselves can use `agent_call` steps freely).

---

## 2. Scope & non-goals

### In scope (phase 1)

- A new `type: 'agent_decision'` variant of `PlaybookStep`.
- A new `branches` field on the step definition declaring the candidate branches.
- Execution inside `playbookEngineService.tick()` that invokes an agent, validates the chosen branch, and records the decision to `playbook_step_runs`.
- Skip-set computation for non-chosen branches — downstream steps in unchosen branches transition to `skipped`, not `pending`.
- Convergence handling — steps that depend on converging branches proceed when *any* parent branch completes (see §5).
- Side-effect classification for the decision step itself: always `none`.
- `run_mode: supervised` integration — the decision is routed through the approval queue before its outcome is applied.
- `run_mode: replay` integration — deterministic replay of a prior decision from snapshot rather than re-invoking the agent.
- Validation in `playbookTemplateService.publish()` — reject templates with malformed decision steps.
- Observability hooks — the decision, its rationale, and the agent run id are visible in the Playbook Studio UI and in `PlaybookRunDetailPage`.

### Explicit non-goals (phase 1)

- **Multi-branch selection.** The agent picks exactly one branch. If the author wants "run A and B in parallel, skip C", that is two decision steps or a conditional further downstream.
- **Dynamic branch generation.** The agent cannot add a branch at runtime. Authorship is the only source of branches.
- **Decision chains within a single step.** One agent call per decision step. Critique / reflection loops are out of scope; the author can add a follow-up `agent_call` step if they want a second opinion.
- **New model routing.** Decision steps use the same LLM router path as `agent_call` steps. No per-decision model overrides in phase 1.
- **Cross-run learning.** A decision in run A does not influence a decision in run B. The regression capture system can still capture rejected decisions and replay them, but that is orthogonal to this spec.

### Deferred to a later phase

- Multi-select (the author marks the step `selectMode: 'one' | 'many'` and the agent emits an array of branch ids).
- Branch weights or cost-aware selection (the author attaches a cost estimate to each branch and the agent factors it in).
- Interactive refinement (the supervised-mode reviewer edits the decision before accepting).
- Native support for "agent explores the DAG" — out of scope and deliberately so. Adding that would make `agent_decision` a planner, which we do not want.

---

## 3. Terminology

| Term | Meaning |
|------|---------|
| **Decision step** | A playbook step with `type: 'agent_decision'`. |
| **Branch** | A named successor path in the DAG, rooted at one or more entry steps. Declared on the decision step's `branches` array. |
| **Entry steps** | The step ids that are the heads of a branch. Multiple entry steps in one branch are allowed — they all run if the branch is chosen. |
| **Chosen branch** | The branch id the agent selects. Exactly one per decision step. |
| **Skipped branch** | A branch not chosen. Its transitive descendants transition to status `skipped`, not `pending`. |
| **Convergence step** | A downstream step that `dependsOn` multiple branches. It proceeds when any chosen ancestor branch completes. See §5 for the convergence semantics. |
| **Decision output** | The JSON object the agent emits: `{ chosenBranchId, rationale, confidence? }`. Validated against a fixed output schema defined in this spec. |
| **Decision agent run** | The `agentRuns` row created when the decision step dispatches its LLM call. Linked via `playbook_step_runs.agentRunId` as with `agent_call` steps. |

---

## 4. Step definition shape

The new step type extends the existing `PlaybookStep` discriminated union declared in `server/lib/playbook/definePlaybook.ts` (or wherever the step shape is canonically defined in the DB-backed version). The new variant:

```typescript
interface AgentDecisionStep {
  id: string;                       // stable within template version
  name: string;
  type: 'agent_decision';
  dependsOn: string[];              // prior steps, same as every other step type
  sideEffectType: 'none';           // ALWAYS none for decision steps — see §5
  humanReviewRequired?: boolean;    // if true, decision routes through the approval queue

  // Which agent makes the decision
  agentId: string;                  // org or system agent id (same semantics as agent_call)
  agentRole?: string;               // optional role tag for agents that inflect on role

  // What the agent is asked
  decisionPrompt: string;           // templated like every other prompt field
  inputs?: Record<string, string>;  // map of paramName -> template expression, same as agent_call

  // The candidate branches
  branches: AgentDecisionBranch[];  // minimum 2, maximum 8 for phase 1

  // How to handle ambiguity
  defaultBranchId?: string;         // fallback if the agent output is invalid and retries fail
  minConfidence?: number;           // 0-1; below this, escalate to HITL via confidence-escape middleware

  // Optional output schema extension
  // The base output shape { chosenBranchId, rationale, confidence? } is fixed;
  // authors can require additional fields for observability but cannot change the base shape.
  extraOutputSchema?: JSONSchema;
}

interface AgentDecisionBranch {
  id: string;                       // stable within the step definition
  label: string;                    // short human-readable name, shown in UI
  description: string;              // the line the agent reads when deciding
  entrySteps: string[];             // step ids that are the heads of this branch
                                    // each entry step's dependsOn MUST include the decision step id
}
```

The `sideEffectType` for a decision step is **always** `none`. This is enforced by the validator (see §9). A decision step itself cannot have side effects — its only output is the branch choice. The side effects live in the branches themselves, each of which is a regular step with its own classification.

The `outputSchema` field that other step types carry is **not** author-controlled for decision steps. The shape is fixed:

```typescript
interface AgentDecisionOutput {
  chosenBranchId: string;           // must match one of branches[].id
  rationale: string;                // one-paragraph explanation, surfaced in UI
  confidence?: number;              // 0-1; present if the agent is prompted to emit it
  // ...plus any fields declared in extraOutputSchema
}
```

Fixing the base shape guarantees that the engine's branch-selection logic, the UI rendering, the pure helper, and the replay mechanism all agree on the same interface. Authors who need richer observability use `extraOutputSchema` to append fields; they cannot rename or remove the base fields.

---

## 5. DAG semantics — branches, convergence, skipped paths

### Branch topology

A decision step's successors are the union of `branches[*].entrySteps`. Every entry step **must** declare the decision step id in its own `dependsOn` array — the validator enforces this. That means the DAG structure is still a standard DAG; the decision step is just a node whose successors are partitioned into labelled branches.

```
           ┌── B1a ──┐
           │         │
  D ──────▶├── B1b ──┤
           │         ├──▶ Conv
           └── B2 ───┘
```

Here, `D` is a decision step with two branches: `branch1` with entry steps `[B1a, B1b]` and `branch2` with entry steps `[B2]`. `Conv` depends on `[B1a, B1b, B2]`. If the decision chooses `branch1`, `B1a` and `B1b` run, `B2` is skipped. If the decision chooses `branch2`, `B2` runs, `B1a` and `B1b` are skipped.

### Skip-set computation

When the decision step completes with `chosenBranchId: branch1`, the engine computes the **skip set**:

1. Collect the entry steps of every non-chosen branch: `S = ⋃ branches[i].entrySteps for i ≠ chosenBranchId`
2. Compute the transitive descendants of `S`, stopping at any step that has at least one non-skipped ancestor (i.e. a convergence step).
3. Transition every step in the computed set to status `skipped`.

Convergence is the tricky part. If a downstream step `Conv` has `dependsOn: [B1a, B1b, B2]` and `B2` is in the skip set but `B1a` and `B1b` are not, `Conv` must **not** be skipped — it has live ancestors. The rule: **a step is skipped only if every branch-descended ancestor is in the skip set.** Steps with at least one live ancestor continue normally.

The skip-set computation is the responsibility of a pure helper (§12) so it can be unit-tested exhaustively.

### Convergence step readiness

The existing engine computes a step's ready-to-dispatch condition as "all `dependsOn` entries are `completed`". That rule changes slightly with decision steps:

**New readiness rule:** a step is ready when every `dependsOn` entry is in a terminal state (`completed` or `skipped`) AND at least one `dependsOn` entry is `completed`.

A step whose every ancestor is `skipped` is itself skipped (transitively propagated from the decision). A step with a mix of `completed` and `skipped` ancestors is ready when all entries have resolved. A step with any `pending` / `running` ancestors waits.

This generalises the current "all dependsOn completed" rule; non-decision DAGs behave identically because they never produce `skipped` states.

### Side-effect classification propagation

The decision step itself is `sideEffectType: 'none'`. Each branch's steps keep their own classification. If a branch is skipped, its `irreversible` steps never run — which is the entire point. This means `agent_decision` does not introduce a new risk around side effects; if anything, it gives authors a tool for deferring irreversible work behind an explicit decision gate.

### Mid-run editing

The existing Playbook engine supports mid-run editing of a completed step's output. For a decision step, "editing the output" means "changing which branch was chosen." The cascade:

1. If the new `chosenBranchId` matches the current one, no-op (output-hash firewall catches this for free).
2. If the new choice differs, the engine computes a new skip set.
3. Any step that was previously `completed` but is now in the new skip set transitions to `invalidated` — same mechanism as the standard mid-run edit cascade. `irreversible` steps block pending user confirmation, as today.
4. Any step that was previously `skipped` but is now outside the new skip set transitions to `pending` and the engine re-ticks.

This reuses the existing invalidation cascade with no new primitives. The output-hash firewall still applies — if editing the decision produces a byte-identical `chosenBranchId`, invalidation stops.

---

## 6. Execution flow inside `playbookEngineService`

The decision step slots into the existing per-tick algorithm with a new dispatch branch and a new completion branch.

### Per-tick dispatch (new clause)

When the tick algorithm's step 4 enumerates ready steps, any step with `type: 'agent_decision'` goes through a new dispatch clause:

```
for each ready agent_decision step:
  1. Resolve the decisionPrompt and inputs via run.contextJson templating.
  2. Assemble the decision context:
       - rendered decisionPrompt
       - branches list ({ id, label, description })
       - the output schema the agent must emit
       - (optional) minConfidence threshold
  3. Enqueue an agentRun with:
       - runType: 'playbook_decision'        (new enum variant on agent_runs.runType)
       - playbookStepRunId: stepRun.id       (existing column added alongside migration 0076)
       - agentId: step.agentId
       - systemPromptAddendum: the decision context
       - idempotencyKey: playbook:{runId}:{stepId}:{attempt}
       - budget: reserved from the run's remaining budget (same as agent_call)
  4. Mark stepRun.status = 'running'.
  5. Return — the tick is done; completion happens on the agent run's post-hook.
```

The dispatch path reuses `playbookAgentRunHook` with a small routing difference: when the post-hook fires for an agent run with `runType: 'playbook_decision'`, it routes through `handleDecisionStepCompletion` instead of `handleAgentCallStepCompletion`.

### Completion handling (new post-hook branch)

```
handleDecisionStepCompletion(agentRun):
  1. Load the stepRun and its step definition.
  2. Parse agentRun.finalOutput as AgentDecisionOutput (Zod / valibot schema, strict).
     - If parsing fails: see §11, retry up to MAX_DECISION_RETRIES then fall back to defaultBranchId.
  3. Validate chosenBranchId is one of step.branches[*].id.
     - If invalid: same retry path, same fallback.
  4. Validate confidence against minConfidence if set.
     - If confidence below threshold: route through confidence-escape middleware — the decision becomes a HITL item and the engine waits.
  5. Compute the skip set via agentDecisionStepPure.computeSkipSet(step, chosenBranchId).
  6. In a single DB transaction:
     a. Write stepRun.outputJson = { chosenBranchId, rationale, confidence, ...extra }.
     b. Mark stepRun.status = 'completed'.
     c. For every step in the skip set: mark its stepRun status = 'skipped' (create pending stepRun rows if they don't exist yet).
     d. Merge the decision output into run.contextJson under steps.{stepId}.output.
     e. Enqueue a tick.
  7. Emit the playbook-run:step-completed WebSocket event with the decision rationale.
```

Every DB write happens inside `withOrgTx(...)` and uses the same advisory-lock convention as the rest of the engine. The pure helper is called between the transaction boundaries so it cannot accidentally touch the DB.

### Dispatch fast-path for replay mode

When `run.runMode === 'replay'` and a prior snapshot contains a decision for this step id, the engine skips the agent call entirely and replays the recorded output via `handleDecisionStepCompletion` as if the agent had just emitted it. Replay mode is hard-blocked from dispatching new decisions — this is consistent with the existing replay-mode invariant for irreversible steps.

---

## 7. Agent decision contract — prompt, output schema, validation

### The prompt envelope

The decision agent receives a standard agent system prompt **plus** a decision envelope appended as a `## Decision Required` block:

```
## Decision Required

You are being asked to pick between N predeclared branches in a playbook workflow.

### The question
{{rendered decisionPrompt}}

### Available branches

For each branch:
  - id: {{branch.id}}
  - label: {{branch.label}}
  - description: {{branch.description}}

### Your response

Emit a single JSON object matching this schema. Do not add prose before or after.

{
  "chosenBranchId": "<one of the branch ids above>",
  "rationale": "<one paragraph explaining your choice>",
  "confidence": <number between 0 and 1>
}

### Constraints

- You must pick exactly one branch.
- You must not invent branch ids that were not listed.
- Your rationale must reference specific evidence from the run context.
- If you cannot confidently choose, set confidence below {{minConfidence}} and explain why in the rationale — the system will escalate to a human.
```

The envelope is templated from the step definition at dispatch time. The template itself lives alongside other playbook agent prompts (`server/prompts/playbook/agent-decision-envelope.md` or equivalent).

### Output schema enforcement

The fixed base schema:

```typescript
const agentDecisionOutputSchema = z.object({
  chosenBranchId: z.string().min(1),
  rationale: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
}).passthrough();  // allows extraOutputSchema fields
```

If the step defines an `extraOutputSchema`, the engine merges it into the validation at load time and uses the merged schema.

### Structured output mode

The LLM call uses the same structured-output mechanism as other typed playbook steps. If the provider supports native JSON mode (Anthropic tool use / OpenAI structured outputs), use it. Otherwise fall back to parse-and-validate with a retry envelope. The retry policy is scoped to the decision step, not the playbook engine.

### Validation order (matters)

1. **Parse** the raw agent output against the base Zod schema.
2. **Validate** `chosenBranchId` against the declared branch ids.
3. **Validate** `confidence` against `minConfidence`, if set.
4. **Merge** the decision into context only after all three pass.

Validation failures do not mutate `run.contextJson`. A rejected decision is retried as a new agent call with feedback appended to the envelope (see §11 for retry semantics).

---

## 8. Run mode interaction

The four playbook run modes (`auto` / `supervised` / `background` / `bulk`) all interact with `agent_decision` predictably, but each has its own behaviour.

### `auto` mode

The decision step dispatches the agent call immediately, trusts the output once validated, applies the skip set, and continues. This is the common case.

### `supervised` mode

The engine dispatches the agent call, receives the validated decision, but **does not apply it immediately**. Instead:

1. A `reviewItems` row is created with the decision payload attached: chosen branch, rationale, confidence, the list of steps that would be skipped if approved, and the list of steps that would run.
2. The step run transitions to `awaiting_approval`.
3. A WebSocket event fires to the subaccount room and to `playbook-run:{runId}`.
4. The reviewer sees the decision in the Inbox / Playbook Run Detail page and can:
   - **Approve**: the skip set is applied, the step run moves to `completed`, and the tick continues.
   - **Reject**: the step run moves to `failed`. The author can restart the run or retry the step manually.
   - **Edit**: the reviewer changes `chosenBranchId` (from a dropdown of valid branches) and optionally the rationale, then approves the edited version. This uses the existing `playbook_runs/:runId/steps/:stepRunId/output` edit endpoint with the decision-specific schema.

Supervised mode gives the reviewer the exact same control they have over any other approval step, and the output-hash firewall applies — an edit that produces the same `chosenBranchId` as the agent's original choice is a no-op.

### `background` mode

Identical to `auto` mode at the engine layer — the decision runs autonomously without live WebSocket updates. The difference is purely in how the client surfaces the run, not in execution semantics.

### `bulk` mode

Every fan-out run executes its own decision step independently. There is **no** cross-run coordination of decisions in phase 1 — if you run the same playbook against 40 subaccounts, you get 40 independent decisions. Authors who want a "same decision applied to all" pattern should lift the decision out of the playbook and into a pre-run config step (or into an `agent_call` step that runs once and feeds its output into the bulk dispatcher).

### `replay` mode

Already covered in §6. The decision is replayed from snapshot; no new agent call fires. This is how the regression capture system can replay rejected decisions against a new agent configuration to measure drift — the captured decision's chosen branch becomes the deterministic input, and any downstream behaviour change is attributable to the rest of the config, not the decision.

---

## 9. Validation rules (publish path)

The `playbookTemplateService.publish()` path already runs DAG validation (no cycles, dependsOn resolvable, output schemas valid). Decision steps add the following checks in `server/lib/playbook/validator.ts`:

| Check | Failure code |
|-------|--------------|
| `type: 'agent_decision'` requires `branches.length >= 2` | `decision_too_few_branches` |
| `type: 'agent_decision'` requires `branches.length <= 8` (phase 1 cap) | `decision_too_many_branches` |
| Every `branches[i].id` must be unique within the step | `decision_duplicate_branch_id` |
| Every `branches[i].entrySteps` must be non-empty | `decision_branch_no_entry` |
| Every entry step must exist in the DAG | `decision_entry_step_not_found` |
| Every entry step must list the decision step id in its own `dependsOn` | `decision_entry_step_missing_dep` |
| No two branches may share an entry step | `decision_branch_entry_collision` |
| `sideEffectType` must be `'none'` | `decision_illegal_side_effect` |
| `agentId` must resolve to an org or system agent the template owner has permission to use | `decision_agent_not_authorised` |
| `defaultBranchId`, if set, must match one of the declared branches | `decision_default_branch_invalid` |
| `minConfidence`, if set, must be in `[0, 1]` | `decision_min_confidence_out_of_range` |
| `extraOutputSchema`, if set, must not redeclare base fields (`chosenBranchId`, `rationale`, `confidence`) | `decision_extra_schema_collision` |
| No cycle through the decision step's branches (standard DAG cycle check) | `decision_cycle_detected` |

All checks run at publish time on the immutable version. Once a version is published, its decision steps cannot drift.

**CI gate:** add `verify-playbook-decision-shape.sh` to `scripts/run-all-gates.sh` that lints every seeded playbook file (`server/playbooks/*.playbook.ts`) for decision step shape. Same pattern as the existing playbook validation CI.

---

## 10. Observability & telemetry

### Data surfaces

- **`playbookStepRuns.outputJson`** captures `{ chosenBranchId, rationale, confidence }` plus any `extraOutputSchema` fields. This is the canonical record of what the agent decided.
- **`playbookStepRuns.agentRunId`** links to the agent run that made the decision, so the full prompt, tool calls (none, for a decision), and LLM response are inspectable via the run trace viewer.
- **`agent_runs.runType = 'playbook_decision'`** is the filter that lets usage reports segment decision calls from regular agent calls. This matters for cost attribution — decisions are usually cheap but high-cardinality.

### UI rendering

The Playbook Run Detail page (`client/src/pages/PlaybookRunDetailPage.tsx`) renders decision steps with a distinct card variant:

- The chosen branch label is prominent ("Chose: **Remediate**").
- The rationale is expandable.
- The skipped branches are listed with a muted style and a `skipped` chip on their downstream steps.
- A "View agent reasoning" link jumps to the decision agent's run trace.

In `supervised` mode, the same card shows an approval panel with the reviewer's action buttons.

### Metrics

New counters emitted via the existing telemetry pipeline:

- `playbook.decision.dispatched` — per template / per branch count
- `playbook.decision.confidence` — histogram of emitted confidence values
- `playbook.decision.retry_count` — distribution of retries before accept
- `playbook.decision.escalated_to_hitl` — count of confidence-escape-triggered escalations
- `playbook.decision.reviewer_override` — count of supervised-mode reviewers who edited the branch vs. accepted it unchanged

The override metric is the most valuable one — it measures how often the reviewer disagrees with the agent, which is the signal the regression capture system feeds on. Track it from day one.

### Audit events

Every decision emits an audit event via the existing audit pipeline:

- `playbook.decision.dispatched` on dispatch
- `playbook.decision.completed` on completion (includes `chosenBranchId` and anonymised rationale length)
- `playbook.decision.rejected` when a reviewer rejects in supervised mode
- `playbook.decision.edited` when a reviewer changes the chosen branch before approving

Same audit table, same retention, same query surface as existing playbook events.

---

## 11. Error handling & edge cases

### Agent output parsing failure

The agent emits JSON that fails the base schema. Retry policy:

1. **First failure:** re-invoke the agent with the original envelope plus an appended error block: "Your previous response failed validation because: {reason}. Please emit a valid response matching the schema."
2. **Second failure:** re-invoke once more with a stricter envelope and, if the provider supports it, force structured output mode.
3. **Third failure:** fall back to `defaultBranchId` if set; otherwise mark the step run `failed` with `failureReason: 'decision_parse_failure'`.

`MAX_DECISION_RETRIES = 3` lives in `server/config/limits.ts`. Each retry is a new agent run, linked via the existing retry chain on `agent_runs`. Budget is debited from the playbook run's remaining allowance on each retry; if the playbook run's budget is exhausted mid-retry, the step fails with `failureReason: 'budget_exceeded'`.

### Unknown branch id

The agent emits valid JSON but `chosenBranchId` does not match any declared branch. Same retry policy as parse failure, same fallback. The retry envelope explicitly lists the valid branch ids in the error block.

### Below-threshold confidence

The agent emits a valid response but `confidence < minConfidence`. This is **not** a failure — it is a deliberate escalation signal. The step run transitions to `awaiting_hitl`, a review item is created, and the reviewer sees the agent's tentative choice plus the confidence value. The reviewer can approve, reject, or edit. This rides on the confidence-escape middleware that already exists in the `preTool` pipeline; `agent_decision` is just a new trigger for it.

### Agent run failure

The agent run itself fails before emitting any output (LLM timeout, budget exceeded, policy violation, etc.). The post-hook receives a failed agent run and:

1. Marks the decision step run `failed` with the same `failureReason` as the underlying agent run.
2. If `defaultBranchId` is set and the failure is `parse_failure` or `validation_failure`, apply the default and continue.
3. Otherwise the playbook run fails at this step. The watchdog sweep catches any orphaned state.

Agent run failures are **not** retried at the playbook layer — the agent execution service has its own retry logic via `withBackoff`. The decision step retries only when the agent succeeds but the output is invalid.

### Skip set collision

In principle, a skipped step might already be in `running` or `completed` state because of a race (the skip set computation is inside a transaction, but a badly-configured DAG could have a branch's entry step that is also reachable via a non-branch path). The pure helper treats this as a validation bug at publish time — it's why `verify-playbook-decision-shape.sh` and the runtime validator both reject "two branches share an entry step" and "an entry step is reachable from elsewhere in the DAG." If the validator misses it and the race happens at runtime:

- `running` or `completed` steps are **not** reverted to `skipped`. They stay in whatever state they reached.
- Their downstream steps follow the normal `dependsOn` rules — they see `completed` ancestors and proceed.
- The skip set computation logs a warning and the engine emits a `playbook.decision.skip_set_collision` metric so the class of bug is visible.

### Mid-run edit race

A reviewer edits the decision output while a downstream step in the chosen branch is already running. The edit path:

1. Validates that the edit's `chosenBranchId` is different from the original.
2. Computes the new skip set and the invalidation cascade as in the standard mid-run edit flow.
3. In-flight downstream steps receive an `AbortController.abort()` signal via the existing agent run cancellation path.
4. If the in-flight step is `irreversible`, the engine blocks pending user confirmation (standard cascade).

No new invalidation machinery — this rides on the existing `server/services/playbookEngineService` cascade.

---

## 12. Pure helper contract

The decision-related logic that can be pure lives in `server/lib/playbook/agentDecisionPure.ts` (new file) alongside the other pure playbook helpers (`templating.ts`, `validator.ts`, `renderer.ts`, `hash.ts`). The helper exports:

```typescript
// Compute the set of step ids that should be skipped given a chosen branch.
// Walks the DAG from the non-chosen branch entry points forward,
// stopping at any step that has a non-skipped ancestor.
//
// Pure: no DB, no async, no side effects.
// Deterministic: same input always produces the same output.
// O(V+E) in the DAG size.
export function computeSkipSet(
  definition: PlaybookDefinition,
  decisionStepId: string,
  chosenBranchId: string,
): Set<string>;

// Validate a decision step in isolation. Called by the publish-path validator
// and by the runtime dispatcher as a belt-and-braces check.
export function validateDecisionStep(
  step: AgentDecisionStep,
  definition: PlaybookDefinition,
): ValidationResult;

// Parse a raw agent response into a structured decision output,
// returning a Result type rather than throwing.
export function parseDecisionOutput(
  raw: string,
  step: AgentDecisionStep,
): Result<AgentDecisionOutput, DecisionParseError>;

// Compute the successor readiness state given mixed completed/skipped ancestors.
// Used by the engine's per-tick dispatch for any step that has decision-step
// ancestors.
export function computeStepReadiness(
  step: PlaybookStep,
  stepRunStatusesByStepId: Map<string, PlaybookStepRunStatus>,
): 'ready' | 'waiting' | 'skipped';
```

Every function is unit-tested with fixture DAGs. The test suite must cover:

- Linear DAG with one decision step (2-branch, 3-branch, 8-branch)
- Nested decisions (one decision's branch contains another decision)
- Convergence step after the decision with mixed skip/run ancestors
- Convergence step where all ancestors are in the skip set (transitively skipped)
- Mid-run edit that changes the chosen branch (invalidation cascade inputs)
- Malformed agent outputs (missing fields, invalid branch ids, extra fields)
- Edge cases: single-branch decision (should fail validation), zero-branch decision (should fail validation), decision with `defaultBranchId` that references a nonexistent branch (should fail validation)

The pure helper is the single most important piece of this spec to get right. Every other piece is either orchestration glue or UI work — this is where the algorithmic correctness lives.

---

## 13. File inventory — what changes, where

New files:

| File | Purpose |
|------|---------|
| `server/lib/playbook/agentDecisionPure.ts` | Pure helper (§12) |
| `server/lib/playbook/__tests__/agentDecisionPure.test.ts` | Unit tests for the pure helper |
| `server/prompts/playbook/agent-decision-envelope.md` | The system-prompt envelope template |
| `scripts/verify-playbook-decision-shape.sh` | CI gate for seeded playbook decision shape |
| `docs/playbook-agent-decision-step-spec.md` | This document |

Modified files:

| File | Change |
|------|--------|
| `server/lib/playbook/definePlaybook.ts` | Extend `PlaybookStep` discriminated union with `AgentDecisionStep` variant. |
| `server/lib/playbook/validator.ts` | Add validation rules from §9; call `agentDecisionPure.validateDecisionStep` for each decision step. |
| `server/lib/playbook/renderer.ts` | Render decision steps when generating `.playbook.ts` files via Playbook Studio. |
| `server/services/playbookEngineService.ts` | Add dispatch clause in the tick algorithm (§6); call `agentDecisionPure.computeSkipSet` on completion. |
| `server/services/playbookAgentRunHook.ts` | Route `runType: 'playbook_decision'` completions through `handleDecisionStepCompletion`. |
| `server/db/schema/agentRuns.ts` | Add `'playbook_decision'` to the `runType` enum (migration). |
| `server/db/schema/playbookStepRuns.ts` | Confirm existing `outputJson` / `agentRunId` columns are sufficient (should be — no schema change expected). |
| `server/config/limits.ts` | Add `MAX_DECISION_RETRIES = 3` constant. |
| `server/services/middleware/index.ts` | Wire confidence-escape middleware to handle decision-step confidence values (reuse the existing hook). |
| `client/src/pages/PlaybookRunDetailPage.tsx` | Render `agent_decision` step cards with chosen branch, rationale, confidence, skipped-branch list. |
| `client/src/components/playbook/StepCard.tsx` (or equivalent) | New variant for decision steps. |
| `scripts/run-all-gates.sh` | Add `verify-playbook-decision-shape.sh` to the gate list. |
| `architecture.md` | Add a subsection under Playbooks describing the new step type. |
| `server/playbooks/event-creation.playbook.ts` (or a new reference playbook) | Add at least one seeded playbook that uses `agent_decision` as a reference implementation. |

Migration:

| Migration | Change |
|-----------|--------|
| `0091_agent_decision_run_type.sql` | Add `'playbook_decision'` to the `runType` enum on `agent_runs`. No data migration needed — existing rows are unaffected. Forward-only. |

---

## 14. Testing approach

Consistent with the project's **static-gates-over-runtime-tests** posture, the test surface is weighted toward the pure helper and the validator, with a small number of integration-level assertions against the engine.

### Pure helper tests (primary)

`server/lib/playbook/__tests__/agentDecisionPure.test.ts` — follows the existing pure helper test convention (no DB imports, fixture-driven, fully deterministic). Cases:

| Test | What it covers |
|------|---------------|
| `computeSkipSet — two branches, chooses branch A` | Basic skip set for the simpler case |
| `computeSkipSet — three branches, nested convergence` | Skip set where a convergence step has mixed ancestry |
| `computeSkipSet — convergence step with all ancestors skipped` | Transitive skip propagation stops correctly |
| `computeSkipSet — eight branches (max phase-1 count)` | Upper bound works |
| `computeSkipSet — nested decision inside a chosen branch` | Recursive decision handling |
| `validateDecisionStep — rejects fewer than 2 branches` | Validator catches minimum |
| `validateDecisionStep — rejects duplicate branch ids` | Validator catches collision |
| `validateDecisionStep — rejects entry step missing decision-step dependency` | Validator catches malformed DAG |
| `validateDecisionStep — accepts well-formed step with 2 branches` | Happy path |
| `parseDecisionOutput — valid base schema` | Happy path |
| `parseDecisionOutput — missing chosenBranchId` | Returns DecisionParseError with `missing_chosen_branch` |
| `parseDecisionOutput — unknown branch id` | Returns DecisionParseError with `unknown_branch` |
| `parseDecisionOutput — extra fields via extraOutputSchema` | Passthrough works |
| `computeStepReadiness — mixed completed/skipped ancestors` | New readiness rule |
| `computeStepReadiness — all ancestors skipped → skipped` | Transitive propagation |
| `computeStepReadiness — one pending ancestor → waiting` | Unchanged |

### Engine integration tests (secondary)

A small number of tests in `server/services/__tests__/playbookEngine.decision.test.ts` exercising the full dispatch → complete → skip-set path with a stubbed LLM router:

- End-to-end happy path: fire a playbook run with a decision step, stub the agent to pick branch A, verify branch A runs and branch B is marked `skipped`.
- Supervised mode: same playbook, `runMode: 'supervised'`, verify the decision routes through the review queue and the engine waits.
- Confidence-below-threshold: stub the agent to emit `confidence: 0.3` with `minConfidence: 0.8`, verify the decision routes through the HITL escape.
- Default branch fallback: stub the agent to emit an unknown branch id three times, verify the engine falls back to `defaultBranchId`.
- Replay mode: run a playbook with a recorded decision in the snapshot, verify the engine replays the stored choice without invoking the LLM.

Uses the existing `server/lib/__tests__/llmStub.ts` shared LLM mock.

### CI gate

`scripts/verify-playbook-decision-shape.sh` runs at CI time against every seeded `server/playbooks/*.playbook.ts` file. It loads each playbook, calls `validateDecisionStep` on every decision step, and fails the build if any step is malformed. Tier 1 gate — blocks CI.

### What is explicitly **not** tested at this layer

- Full end-to-end playbook runs against a real LLM (covered by existing playbook smoke tests).
- UI rendering of decision cards (the project has no frontend test surface in the current phase per `docs/spec-context.md`).
- Human approval latency / queue SLA (out of scope; depends on operator behaviour).

---

## 15. Non-negotiable invariants

These are the invariants every implementation round must preserve. A violation of any of them is a blocking issue in code review.

1. **`sideEffectType` of a decision step is always `'none'`.** Enforced at validation time; also hard-coded in the engine's side-effect classification path so that even a bypassed validator cannot produce a decision with side effects.
2. **Exactly one branch is chosen per decision.** The output schema allows only a single string in `chosenBranchId`; multi-select is deferred to phase 2.
3. **Skip set is computed deterministically from the pure helper.** The engine never computes its own skip set — it always delegates to `agentDecisionPure.computeSkipSet`. This is the single source of truth.
4. **A skipped step never dispatches.** Once a step is in `skipped`, it cannot transition to `pending` except via an explicit mid-run edit that invalidates the decision.
5. **Entry steps are validated at publish time.** Every entry step must list the decision step id in its `dependsOn`. No exceptions — the validator rejects missing or incorrect dependencies with `decision_entry_step_missing_dep`.
6. **No two branches share an entry step.** Enforced by the validator; prevents ambiguous skip sets and the skip-set collision edge case from being reachable through a valid template.
7. **Decision step output schema is fixed at the base level.** `chosenBranchId`, `rationale`, and `confidence` cannot be renamed or removed. `extraOutputSchema` appends fields only.
8. **The decision step respects the run's budget and cost breaker.** The agent call for a decision flows through the existing cost accounting path; it cannot bypass `runCostBreaker`.
9. **Supervised-mode decisions route through the existing review queue.** No separate queue, no separate approval mechanism — the `reviewItems` table handles decision approvals the same way it handles `approval` step approvals.
10. **Replay mode is hard-blocked from invoking new LLM calls for decisions.** In replay, the engine replays the stored choice from the snapshot. If no snapshot exists for a decision, the step fails with `failureReason: 'replay_snapshot_missing'` rather than fall back to a live call.
11. **Confidence-escape-to-HITL is the only path for low-confidence decisions.** The engine never silently applies a low-confidence decision in auto mode. Either the confidence threshold is unset (trust all outputs) or the threshold is set and low-confidence decisions escalate.
12. **Regression capture applies to decision steps.** When a supervised reviewer rejects or edits a decision, the `regression_cases` pipeline captures it the same way it captures rejected `agent_call` outputs. The agent learns from its decision mistakes like any other skill failure.
13. **Audit events fire on every state transition.** Dispatch, complete, reject, edit — each emits a structured audit event via the existing `auditEvents` pipeline. No silent state changes.

---

## Appendix — worked example

A 5-step playbook that uses `agent_decision` to branch between remediation and cleanup, based on an audit agent's judgment.

```typescript
const auditPlaybook: PlaybookDefinition = {
  initialInputSchema: { /* ... */ },
  steps: [
    {
      id: 'run_audit',
      name: 'Run audit agent',
      type: 'agent_call',
      dependsOn: [],
      sideEffectType: 'none',
      agentId: 'audit-agent',
      inputs: { /* ... */ },
      outputSchema: { /* audit findings shape */ },
    },
    {
      id: 'classify_findings',
      name: 'Classify audit severity',
      type: 'agent_decision',
      dependsOn: ['run_audit'],
      sideEffectType: 'none',
      agentId: 'classifier-agent',
      decisionPrompt: 'Review the audit findings from the previous step. Classify as material or cosmetic.',
      inputs: { findings: '{{ steps.run_audit.output.findings }}' },
      branches: [
        {
          id: 'material',
          label: 'Material findings — remediate',
          description: 'Pick this when the audit surfaced issues that require corrective action.',
          entrySteps: ['remediate'],
        },
        {
          id: 'cosmetic',
          label: 'Cosmetic findings — cleanup only',
          description: 'Pick this when the findings are minor or purely informational.',
          entrySteps: ['cleanup'],
        },
      ],
      defaultBranchId: 'material',  // safe fallback
      minConfidence: 0.75,
      humanReviewRequired: false,
    },
    {
      id: 'remediate',
      name: 'Run remediation playbook',
      type: 'agent_call',
      dependsOn: ['classify_findings'],
      sideEffectType: 'irreversible',
      agentId: 'remediation-agent',
      outputSchema: { /* ... */ },
    },
    {
      id: 'cleanup',
      name: 'Run cleanup agent',
      type: 'agent_call',
      dependsOn: ['classify_findings'],
      sideEffectType: 'reversible',
      agentId: 'cleanup-agent',
      outputSchema: { /* ... */ },
    },
    {
      id: 'report',
      name: 'Generate final report',
      type: 'agent_call',
      dependsOn: ['remediate', 'cleanup'],  // convergence
      sideEffectType: 'none',
      agentId: 'reporter-agent',
      outputSchema: { /* ... */ },
    },
  ],
};
```

Execution:

1. `run_audit` dispatches and completes.
2. `classify_findings` dispatches a decision call. Agent emits `{ chosenBranchId: 'cosmetic', rationale: '...', confidence: 0.9 }`.
3. Engine computes skip set: `{ remediate }` (and any transitive descendants of `remediate` that do not have non-skipped ancestors — in this case, `report` has `cleanup` as a live ancestor, so it stays live).
4. `remediate` is marked `skipped`. `cleanup` transitions to `pending` and dispatches.
5. `cleanup` completes. `report` becomes ready (one of its two ancestors is `completed`, the other is `skipped`, both are terminal) and dispatches.
6. `report` completes. Run finishes.

The `irreversible` classification on `remediate` is never triggered because the step never ran — exactly the value this step type provides. The agent's decision to skip the irreversible path is recorded, auditable, and reviewable.

# Playbook `agent_decision` Step Type — Implementation Spec

**Status:** Draft
**Related:** `architecture.md` (Playbooks section), `server/services/playbookEngineService.ts`, `server/lib/playbook/validator.ts`, `server/lib/playbook/templating.ts`
**Phase:** proposed for Phase 2 of `docs/improvements-roadmap.md`
**Date:** 2026-04-11

This spec defines a new step type for the Playbook DAG engine: `agent_decision`. The step asks an agent to pick between predeclared downstream branches, records the choice and rationale, and lets the engine skip the non-chosen branches.

It is the playbook-native expression of "graduated autonomy" — deterministic DAG structure with agent-driven branching at explicit decision points, rather than a single big autonomous loop.

---

## Table of contents

### Part A — Conceptual spec

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

### Part B — Implementation reference

*Everything in Part B is implementation-level detail. Read Part A to review the design; read Part B to build it.*

16. Complete TypeScript type definitions
17. Prompt envelope template (verbatim)
18. Tool use during decisions — explicitly disallowed
19. Permission model & API contract changes
20. State machine & sequence diagrams
21. Failure reason catalogue
22. Security considerations
23. Performance considerations
24. Full pure helper implementations
25. Database migration (SQL)
26. Implementation phasing plan
27. Acceptance criteria / definition of done

### Appendix

- Worked example — 5-step audit playbook

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

# Part B — Implementation reference

## 16. Complete TypeScript type definitions

This is the canonical type surface. All types live in `shared/playbook/agentDecisionTypes.ts` (new file) so they can be imported by server, worker, and client without duplication. Existing playbook types in `server/lib/playbook/definePlaybook.ts` import and re-export from the shared file.

### 16.1 Step definition types

```typescript
// shared/playbook/agentDecisionTypes.ts

import type { JSONSchema7 } from 'json-schema';

/**
 * A single branch the decision agent may select.
 * Branches are author-declared at template publish time and are immutable
 * for the lifetime of a template version.
 */
export interface AgentDecisionBranch {
  /** Stable id within the decision step. Used as chosenBranchId. */
  readonly id: string;

  /** Short human-readable name shown in UI. Max 80 chars. */
  readonly label: string;

  /**
   * Description the agent reads when deciding. This is the primary
   * signal to the model about when each branch applies. Keep it focused
   * — one to two sentences. Max 500 chars.
   */
  readonly description: string;

  /**
   * Step ids that are the heads of this branch. Each entry step's
   * own dependsOn[] MUST contain the decision step id — validated at
   * publish time. Every entry step runs if the branch is chosen.
   *
   * Phase 1 constraint: entry steps are ALWAYS direct successors.
   * Indirect branch roots (entry step → fan-out → real work) are
   * allowed but considered authoring hygiene, not engine semantics.
   */
  readonly entrySteps: readonly string[];
}

/**
 * The agent_decision step definition, stored in
 * playbookTemplateVersions.definitionJson under the canonical
 * PlaybookStep discriminated union.
 */
export interface AgentDecisionStep {
  /** Stable id within the template version. */
  readonly id: string;

  readonly name: string;

  readonly type: 'agent_decision';

  readonly dependsOn: readonly string[];

  /**
   * ALWAYS 'none' for decision steps. Enforced by the validator; also
   * hard-coded in the engine's side-effect classification path. A
   * decision step cannot have side effects — its only output is the
   * branch choice. Side effects belong to the branches themselves.
   */
  readonly sideEffectType: 'none';

  /** If true, decision routes through the approval queue in supervised mode. */
  readonly humanReviewRequired?: boolean;

  // Agent dispatch config
  /** Org or system agent id. Same resolution as agent_call steps. */
  readonly agentId: string;

  /** Optional role tag; inherited from agent_call semantics. */
  readonly agentRole?: string;

  // Decision prompt + inputs
  /**
   * Author-supplied question the agent is asked. Templated against
   * run.contextJson via the standard templating.ts resolver.
   * Rendered into the envelope's ### The question section.
   */
  readonly decisionPrompt: string;

  /**
   * Map of inputName -> template expression. Same semantics as
   * agent_call step inputs. Resolved at dispatch time and passed
   * to the agent as part of the run context.
   */
  readonly inputs?: Readonly<Record<string, string>>;

  // Branch configuration
  /** Minimum 2, maximum 8 branches. Enforced at publish time. */
  readonly branches: readonly AgentDecisionBranch[];

  // Behaviour knobs
  /**
   * Fallback branch id used when the agent output fails validation
   * MAX_DECISION_RETRIES times in a row. Must match one of branches[].id
   * if set. If unset and retries exhaust, the step fails hard.
   */
  readonly defaultBranchId?: string;

  /**
   * Confidence threshold in [0, 1]. If the agent emits a confidence
   * below this value, the decision is escalated via confidence-escape
   * middleware instead of being applied. If unset, all outputs are
   * trusted regardless of confidence.
   */
  readonly minConfidence?: number;

  /**
   * Optional schema extension for author-specific observability fields.
   * MUST NOT redeclare base fields (chosenBranchId, rationale, confidence).
   * Validated at publish time against the base schema.
   */
  readonly extraOutputSchema?: JSONSchema7;

  /**
   * Per-step timeout in seconds. Defaults to
   * DEFAULT_DECISION_STEP_TIMEOUT_SECONDS (60). Hard ceiling on how
   * long the decision agent run may take before the step times out.
   */
  readonly timeoutSeconds?: number;
}

/**
 * The fixed base output shape for every decision step. Extension fields
 * declared via extraOutputSchema are merged on top via the Zod
 * .passthrough() path at validation time, but the base fields are
 * non-negotiable.
 */
export interface AgentDecisionOutput {
  readonly chosenBranchId: string;
  readonly rationale: string;
  readonly confidence?: number;
  /** Any additional author-declared fields land here. */
  readonly [key: string]: unknown;
}

/**
 * Shape stored in playbookStepRuns.outputJson for decision steps.
 * Superset of AgentDecisionOutput plus engine-tracked metadata.
 */
export interface DecisionStepRunOutput extends AgentDecisionOutput {
  /**
   * The deterministic skip set this decision produced, as computed by
   * agentDecisionPure.computeSkipSet. Frozen at completion time for
   * replay consistency.
   */
  readonly skippedStepIds: readonly string[];

  /** Number of retries before the output was accepted. */
  readonly retryCount: number;

  /**
   * Whether the output was selected by the agent (false means
   * defaultBranchId fallback was applied after retries exhausted).
   */
  readonly chosenByAgent: boolean;
}
```

### 16.2 Zod schemas

```typescript
// server/lib/playbook/agentDecisionSchemas.ts

import { z } from 'zod';

/** Base Zod schema for parsing raw agent output. */
export const agentDecisionOutputBaseSchema = z.object({
  chosenBranchId: z.string().min(1, 'chosenBranchId is required'),
  rationale: z.string().min(1, 'rationale is required'),
  confidence: z.number().min(0).max(1).optional(),
}).passthrough(); // allows extraOutputSchema fields through

/** Branch definition schema (publish-time validation). */
export const agentDecisionBranchSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/, 'ids must be lowercase alphanumeric with hyphens or underscores'),
  label: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  entrySteps: z.array(z.string().min(1)).min(1, 'every branch needs at least one entry step'),
});

/** Full step definition schema (publish-time validation). */
export const agentDecisionStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.literal('agent_decision'),
  dependsOn: z.array(z.string()),
  sideEffectType: z.literal('none'),
  humanReviewRequired: z.boolean().optional(),
  agentId: z.string().min(1),
  agentRole: z.string().optional(),
  decisionPrompt: z.string().min(1),
  inputs: z.record(z.string()).optional(),
  branches: z.array(agentDecisionBranchSchema)
    .min(2, 'agent_decision requires at least 2 branches')
    .max(8, 'phase 1 caps branches at 8'),
  defaultBranchId: z.string().optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  extraOutputSchema: z.record(z.unknown()).optional(),
  timeoutSeconds: z.number().int().positive().max(600).optional(),
}).refine(
  (step) => !step.defaultBranchId || step.branches.some((b) => b.id === step.defaultBranchId),
  { message: 'defaultBranchId must reference an existing branch', path: ['defaultBranchId'] },
).refine(
  (step) => {
    const ids = step.branches.map((b) => b.id);
    return new Set(ids).size === ids.length;
  },
  { message: 'branch ids must be unique within the step', path: ['branches'] },
);
```

### 16.3 Engine-side types

```typescript
// server/lib/playbook/agentDecisionPureTypes.ts

export type StepReadiness = 'ready' | 'waiting' | 'skipped';

export type StepRunTerminalStatus = 'completed' | 'skipped' | 'failed' | 'cancelled';

export type StepRunStatus = 'pending' | 'running' | 'awaiting_input' | 'awaiting_approval' | 'awaiting_hitl' | StepRunTerminalStatus;

/** Result of the pure parser — discriminated union, never throws. */
export type DecisionParseResult =
  | { ok: true; output: AgentDecisionOutput }
  | { ok: false; error: DecisionParseError };

export interface DecisionParseError {
  readonly code:
    | 'invalid_json'
    | 'schema_violation'
    | 'unknown_branch'
    | 'extra_schema_violation';
  readonly message: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

/** Result of the pure validator — also never throws. */
export interface ValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}

export interface ValidationIssue {
  readonly code: DecisionValidationCode;
  readonly stepId: string;
  readonly message: string;
  readonly path?: readonly string[];
}

export type DecisionValidationCode =
  | 'decision_too_few_branches'
  | 'decision_too_many_branches'
  | 'decision_duplicate_branch_id'
  | 'decision_branch_no_entry'
  | 'decision_entry_step_not_found'
  | 'decision_entry_step_missing_dep'
  | 'decision_branch_entry_collision'
  | 'decision_illegal_side_effect'
  | 'decision_agent_not_authorised'
  | 'decision_default_branch_invalid'
  | 'decision_min_confidence_out_of_range'
  | 'decision_extra_schema_collision'
  | 'decision_cycle_detected';
```

---

## 17. Prompt envelope template (verbatim)

The envelope is a fixed template checked into `server/prompts/playbook/agent-decision-envelope.md`. The engine renders it with a deterministic templating helper — **not** the same templating resolver used for `run.contextJson` references (that one allows arbitrary expressions, which would be unsafe inside a system prompt). The envelope template uses a minimal, whitelisted placeholder set and nothing else.

### 17.1 Whitelisted placeholders

| Placeholder | Meaning | Source |
|-------------|---------|--------|
| `{{DECISION_PROMPT}}` | The author-supplied question, already templated against `run.contextJson` at the outer layer | `step.decisionPrompt` after templating.ts resolution |
| `{{BRANCHES_TABLE}}` | Rendered markdown list of branches | computed from `step.branches` |
| `{{MIN_CONFIDENCE_CLAUSE}}` | Optional confidence instruction, present only if `minConfidence` is set | computed from `step.minConfidence` |
| `{{RETRY_ERROR_BLOCK}}` | Optional error feedback from a prior failed attempt, present only on retry | computed from the retry context |

No other placeholders. No arbitrary expression evaluation inside the envelope. Attempting to embed anything else in the template is a CI failure via `verify-playbook-decision-envelope.sh`.

### 17.2 The template

~~~markdown
## Decision Required

You are being asked to select one of a fixed set of predeclared branches in a playbook workflow. Your job is to read the context that preceded this step, pick the single most appropriate branch, and explain your reasoning.

You do not have tools available in this step. You cannot take actions, call functions, or read external sources. Make the decision using only the information already provided in this conversation.

### The question

{{DECISION_PROMPT}}

### Available branches

You must pick exactly one of the following. Use the branch `id` as written — do not rename, reformat, or abbreviate.

{{BRANCHES_TABLE}}

### Your response

Respond with a single JSON object matching exactly this schema, and nothing else. Do not add prose before or after the JSON. Do not wrap it in a code block.

```json
{
  "chosenBranchId": "<one of the branch ids above>",
  "rationale": "<one to three sentences explaining your choice, referencing specific evidence from the context>",
  "confidence": <number between 0 and 1>
}
```

### Constraints on your response

- `chosenBranchId` must be one of the ids shown above — no new branches, no combinations.
- `rationale` must reference specific evidence from the prior steps or the question above. Generic reasoning is not acceptable.
- `confidence` must be a number in [0, 1]. Use 1.0 only when the evidence is overwhelming; use 0.5 or below when the evidence is mixed or ambiguous.
- You must pick a branch even if none feels perfect. If the evidence is too weak to justify any branch with reasonable confidence, set `confidence` below the threshold below and explain why in the `rationale` — the system will escalate to a human.

{{MIN_CONFIDENCE_CLAUSE}}

{{RETRY_ERROR_BLOCK}}
~~~

### 17.3 Rendered branches table

`BRANCHES_TABLE` is rendered as a markdown bullet list, one entry per branch, with a blank line between entries:

```
- **id:** `material`
  **label:** Material findings — remediate
  **description:** Pick this when the audit surfaced issues that require corrective action.

- **id:** `cosmetic`
  **label:** Cosmetic findings — cleanup only
  **description:** Pick this when the findings are minor or purely informational.
```

The rendering helper is pure (`agentDecisionPure.renderBranchesTable(branches)`) and unit-tested.

### 17.4 Conditional clauses

**`MIN_CONFIDENCE_CLAUSE`** is inserted only if `step.minConfidence` is set. The rendered text:

```
### Confidence threshold

The confidence threshold for this decision is {{value}}. If your confidence is below {{value}}, the system will pause and ask a human to confirm or override your choice. Do not artificially inflate your confidence to avoid escalation — low confidence is a valid signal and the right thing to do when the evidence is weak.
```

If `minConfidence` is unset, the clause is omitted entirely (empty string, no blank line).

**`RETRY_ERROR_BLOCK`** is inserted only on retry attempts. On the first attempt, it is the empty string. On retries, it contains the prior attempt's failure:

```
### Your previous response failed validation

Your previous response failed validation for this reason:

> {{prior_error_message}}

Your previous response was:

{{prior_raw_output_truncated_to_1000_chars}}

Please fix the issue and respond again. Do not repeat the same mistake.
```

### 17.5 Envelope rendering API

```typescript
// server/prompts/playbook/renderAgentDecisionEnvelope.ts

export interface EnvelopeRenderContext {
  decisionPrompt: string;     // already resolved via templating.ts against run.contextJson
  branches: readonly AgentDecisionBranch[];
  minConfidence?: number;
  priorAttempt?: {
    errorMessage: string;
    rawOutput: string;
  };
}

/**
 * Pure, deterministic envelope renderer. No DB, no LLM, no side effects.
 * Given the same context, always produces the same string.
 */
export function renderAgentDecisionEnvelope(ctx: EnvelopeRenderContext): string;
```

### 17.6 How the envelope is attached to the agent run

The rendered envelope is passed to the agent execution service as a `systemPromptAddendum`. It is appended to the end of the agent's normal system prompt (after the agent's masterPrompt, additionalPrompt, and team roster) so the model sees it in the place it expects instructions to land. The addendum is **not** part of the agent's stored configuration — it is per-run, disposable, and reconstructed on replay.

---

## 18. Tool use during decisions — explicitly disallowed

The decision agent runs with **an empty tool allowlist**. It cannot call any skills, invoke any integrations, or spawn sub-agents. The only output it produces is the JSON decision object. This is a deliberate design decision, not an oversight — phase 1 constrains decisions to a single-shot classification.

### 18.1 Why no tools

Three reasons, in order of importance:

1. **Cost and latency predictability.** A decision step with tool access can turn into an open-ended investigation: the agent fetches data, calls another skill, reads a file, decides it needs more information, fetches again. The cost bound collapses. A single-shot classifier with a fixed prompt and structured output has a tight, predictable latency and cost profile — roughly one LLM call, ~1-3 seconds, a few cents. That predictability is what lets us put decisions inside a DAG with confidence.

2. **Testability and determinism.** A tool-free decision is trivially replayable — given the same input context and the same model, the decision is (as close to) deterministic (as the model allows). A tool-wielding decision introduces tool side-effects into the decision trace, which makes regression capture and replay mode much harder to reason about. Keeping decisions tool-free keeps replay mode cheap and honest.

3. **Containment of failure modes.** A tool call in a decision step could fail, retry, cascade into a policy engine decision, escalate to HITL, etc. — all before the branching logic even runs. That's a lot of failure surface for a step whose job is "pick a branch." Making decisions tool-free means the only failure mode is "invalid output" (retried via the envelope feedback loop) or "agent run failed entirely" (standard failure cascade).

### 18.2 How the prohibition is enforced

At **four** layers, belt-and-braces:

| Layer | Enforcement |
|-------|-------------|
| **Envelope instruction** | The system prompt addendum in §17.2 explicitly tells the agent it has no tools. This is the softest layer — relies on the model's instruction-following. |
| **Tool allowlist override** | The decision step dispatches with `allowedToolSlugs: []` (empty array) passed to the agent execution service. The existing `toolRestrictionMiddleware` enforces this — any tool call with an empty allowlist is blocked at the `preTool` gate. |
| **Topic filter override** | The `topicFilterMiddleware` receives a `forceTopic: 'playbook_decision'` flag for decision runs, which maps to an empty tool list. Universal skills that normally get re-injected (ask_clarifying_question, read_workspace, web_search, read_codebase) are **also** excluded for decision runs. The middleware exports a helper `mutateActiveToolsForDecisionRun()` that returns an empty array unconditionally. |
| **Agent run type guard** | `agentExecutionService` checks `runType === 'playbook_decision'` at the top of the tool dispatch path and throws if any tool call is attempted. The throw aborts the run with `FailureReason: 'decision_tool_call_blocked'`. |

### 18.3 Explicit exceptions

None. There are no "safe tools" that a decision agent may call. If an author legitimately needs the decision to consult external data, they should:

- Add an `agent_call` step **before** the decision step that fetches the data and writes it into `run.contextJson`.
- Reference the fetched data in the decision step's `decisionPrompt` via the standard templating (`{{ steps.fetch_data.output.xyz }}`).

This keeps the fetch and the decision as separate audit records, separate cost lines, and separate failure surfaces.

### 18.4 Interaction with the middleware pipeline

Because decision runs have no tool calls, the `preTool` and `postTool` middleware phases never execute. Only the `preCall` phase runs, which is:

1. **contextPressureMiddleware** — monitors context window usage; compaction is irrelevant for a single-call run but the middleware still runs for consistency.
2. **budgetCheckMiddleware** — enforces the playbook run's remaining token/cost budget. If the budget is exhausted before the LLM call fires, the decision fails with `FailureReason: 'budget_exceeded'`.
3. **topicFilterMiddleware** — receives `forceTopic: 'playbook_decision'`; returns an empty active tools list, which is then overridden by the tool allowlist in the dispatch config to `[]` anyway.

No `confidenceEscapeMiddleware` at the tool layer — confidence handling for decisions happens in the completion handler (§6), not the preTool pipeline. The decision output is the carrier of confidence, not an intermediate tool call.

### 18.5 Phase 2 consideration (informational, not in scope)

A later phase might introduce a `decision_with_lookup` variant that allows a narrow read-only tool list (e.g. `read_data_source` only) so the decision can pull additional context inline. This is **explicitly out of scope for phase 1** and should not be designed around. The cleaner pattern is "fetch step → decision step" and it should be the default authoring guidance even after a lookup-enabled variant exists.

---

## 19. Permission model & API contract changes

### 19.1 No new permission keys

Authoring a decision step, executing a decision step, and reviewing a decision step all ride on existing permission keys. The rationale: a decision step is structurally a Playbook step, not a new entity, so the existing Playbook permission surface covers everything.

| Operation | Required permission | Notes |
|-----------|---------------------|-------|
| Author a playbook template containing a decision step | `org.playbook_templates.write` | Existing |
| Publish a template version containing decision steps | `org.playbook_templates.publish` | Existing |
| Run a playbook containing decision steps | `subaccount.playbook_runs.start` | Existing |
| Approve / reject a supervised-mode decision | `subaccount.playbook_runs.approve` | Existing — same path used by `approval` step type |
| Edit a completed decision's `chosenBranchId` (mid-run edit) | `subaccount.playbook_runs.edit_output` | Existing |
| Read decision step output / rationale | `subaccount.playbook_runs.read` | Existing |

**Implicit guard on `agentId`:** the template publish-path validator must verify that the author's org has permission to use the referenced agent (org agent, system agent, or system-managed agent). Validation code `decision_agent_not_authorised` fires if the agent is not permitted. This is the same check `agent_call` steps already do — the decision step validator calls the same helper (`playbookTemplateService.assertAgentAccessible(orgId, agentId)`).

### 19.2 API endpoint changes

**No new endpoints.** Every existing playbook endpoint that accepts or emits a `PlaybookStep` extends transparently to the new `agent_decision` variant via the discriminated union.

Endpoints affected (in terms of what they now serialise / deserialise):

| Endpoint | Change |
|----------|--------|
| `POST /api/playbook-templates` | Body now accepts `agent_decision` steps in `definition.steps[]`. Existing Zod validator gets extended with the new variant. |
| `PATCH /api/playbook-templates/:id` | Same. |
| `POST /api/playbook-templates/:id/publish` | Validator runs the new §9 checks as part of its existing DAG validation. Rejects with the validation code list from §9 on failure. |
| `GET /api/playbook-templates/:id/versions/:versionId` | Returns decision steps in the same shape as other step types — no extra fields on the envelope. |
| `GET /api/playbook-runs/:runId` | The run's step runs now include `agent_decision` entries with `outputJson` shaped as `DecisionStepRunOutput`. |
| `POST /api/playbook-runs/:runId/steps/:stepRunId/output` (edit) | New body variant: when the underlying step type is `agent_decision`, the body must match `{ chosenBranchId: string, rationale?: string }`. The endpoint's existing Zod validator dispatches on the step type stored in the template version and applies the right body shape. Reviewer-provided rationale overrides the agent's rationale if present; otherwise the agent's rationale is preserved. |
| `POST /api/playbook-runs/:runId/steps/:stepRunId/approve` | Works unchanged — supervised-mode decisions create a review item and this endpoint approves or rejects it. Approval body optionally carries an edited `chosenBranchId` (same mechanism as the edit path). |
| `GET /api/playbook-studio/render` | Renders decision steps in the generated `.playbook.ts` source via the new `renderer.ts` branch for `type: 'agent_decision'`. |
| `POST /api/playbook-studio/validate` | Runs the new validator on candidate playbooks. |
| `POST /api/playbook-studio/simulate` | The simulator treats decision steps as always producing the first branch (lexical order) for simulation purposes. Simulation does not call an LLM. |
| `POST /api/playbook-studio/estimate` | Adds a per-decision-step cost estimate equal to `IEE_AVG_LLM_COST_CENTS_PER_STEP` × 1 (single LLM call per decision). Worst-case estimate multiplies by `MAX_DECISION_RETRIES`. |

### 19.3 WebSocket event additions

Two new event types on the existing `playbook-run:{runId}` room:

| Event | Payload | Emitted when |
|-------|---------|--------------|
| `playbook.decision.dispatched` | `{ stepRunId, stepId, agentRunId, branchesCount }` | Decision step enters `running` state |
| `playbook.decision.completed` | `{ stepRunId, stepId, chosenBranchId, confidence?, retryCount, chosenByAgent, skippedStepIds }` | Decision step enters `completed` state |

The existing generic `playbook.step.*` events (`dispatched`, `completed`, `failed`, `skipped`) continue to fire as well — decision steps do not bypass the generic stream. The specific events above are for clients that want to render decision-specific UI without inspecting the step type on every generic event.

### 19.4 Studio chat-authoring tool additions

The Playbook Studio uses a set of chat-authoring tools (`playbook_read_existing`, `playbook_validate`, `playbook_simulate`, `playbook_estimate_cost`, `playbook_propose_save`). These are extended — not added to — to handle the new step type:

- `playbook_validate` returns validation issues keyed on `DecisionValidationCode` (§16.3).
- `playbook_simulate` emits a simulated decision output per decision step using lexical branch order.
- `playbook_propose_save` accepts playbooks with decision steps via the existing `definition` payload shape.

No new Studio tools. The author can ask the chat agent to "add a decision step" and the existing tools handle it.

### 19.5 Permission edge case — system agents as decision agents

System agents have `isSystemManaged: true` and hidden master prompts. A decision step that references a system agent works the same way an `agent_call` step does: the envelope addendum is appended to the (hidden) system prompt at dispatch time, the agent run logs the addendum, and the run trace viewer redacts the master prompt for non-system-admin viewers. The decision output and rationale are visible to the org regardless of agent IP status — they are run outputs, not agent configuration.

---

## 20. State machine & sequence diagrams

### 20.1 `playbookStepRuns.status` transitions for decision steps

Decision steps use the same `playbookStepRuns.status` enum as every other step type. The transitions specific to decision steps are shown below. States that do not apply to decision steps (e.g. `awaiting_input`) are omitted; transitions that differ from `agent_call` steps are marked with **[D]**.

```
         ┌─────────┐
         │ pending │
         └────┬────┘
              │
              │ ready (all dependsOn terminal, at least one completed)
              ▼
         ┌─────────┐
         │ running │──────────────────────┐
         └────┬────┘                      │
              │                           │ run cancelled / timeout
              │ agent emits output        │
              ▼                           │
         ┌────────────────┐               │
         │ output received│               │
         └────┬─────┬─────┘               │
              │     │                     │
      valid   │     │ invalid /           │
              │     │ retries exhausted   │
              │     ▼                     │
              │   ┌─────────────┐         │
              │   │ retry loop  │         │
              │   │ (≤3 times)  │         │
              │   └──┬──────────┘         │
              │      │ still invalid      │
              │      │ AND defaultBranchId│
              │      │ is set             │
              │      ▼                    │
              │   ┌──────────┐            │
              │   │ fallback │            │
              │   └────┬─────┘            │
              │        │                  │
              ▼        ▼                  ▼
         ┌───────────────────┐      ┌────────┐
         │ awaiting_hitl [D] │      │ failed │
         └────┬──────────────┘      └────────┘
              │
              │ (only if confidence < minConfidence)
              │
              │ reviewer approves    reviewer rejects
              ├───────────┐          ├────────────┐
              ▼           │          ▼            │
         ┌──────────────┐ │     ┌────────┐        │
         │ running again│ │     │ failed │        │
         │ (supervised) │ │     └────────┘        │
         └──────┬───────┘ │                       │
                │         │                       │
                │         │ reviewer edits        │
                │         │ chosenBranchId        │
                │         ▼                       │
                │    ┌───────────────┐            │
                │    │ completed     │            │
                │    │ (edited flag) │            │
                │    └───────────────┘            │
                │                                 │
                ▼                                 │
         ┌───────────────────┐                    │
         │ awaiting_approval │──────────→─────────┤
         │ (supervised only) │                    │
         └────┬──────────────┘                    │
              │                                   │
              │ approved                          │
              ▼                                   │
         ┌───────────┐                            │
         │ completed │                            │
         └───────────┘                            │
```

Key points:
- **[D]** `awaiting_hitl` is reached only via the confidence-escape path. Parse/validation failures go straight to retry or fallback or `failed`, not HITL.
- `awaiting_approval` is reached only in supervised mode, after the decision has been validated. A reviewer can approve, reject, or approve-with-edit in one atomic operation.
- `completed` is terminal. `failed` is terminal. `skipped` is a status downstream steps reach via the skip-set computation, not the decision step itself.

### 20.2 Downstream step transitions after skip-set computation

When a decision step transitions to `completed`, the engine computes the skip set and applies transitions to the downstream step runs:

```
for each step in skipSet:
  ┌─────────┐             ┌─────────┐
  │ pending │ ─────────→  │ skipped │
  └─────────┘             └─────────┘

for each step in chosen branch (not yet dispatched):
  ┌─────────┐             ┌─────────┐
  │ pending │ ─────────→  │ pending │   (unchanged; dispatched by next tick)
  └─────────┘             └─────────┘

for each convergence step (at least one live ancestor):
  (no transition; waits until all dependsOn are terminal)
```

A step run that is already `running` or `completed` is **never** transitioned to `skipped`. See §5 and §11 for the collision semantics.

### 20.3 Sequence diagram — auto mode, happy path

```
Author    Engine           pg-boss     AgentExec    LLM     DB
  │          │                │           │         │       │
  │──publish─▶                │           │         │       │
  │          │──validate──────────────────────────────▶     │
  │          │◀─ok─────────────────────────────────────     │
  │◀─ok──────│                │           │         │       │
  │          │                │           │         │       │
  │──start──▶│                │           │         │       │
  │          │──enqueue tick──▶           │         │       │
  │          │                │──handle──▶           │       │
  │          │                │           │──load───▶       │
  │          │                │           │◀─run────        │
  │          │                │           │                 │
  │          │      (prior steps complete, decision ready)  │
  │          │                │           │                 │
  │          │                │──handle──▶│                 │
  │          │                │           │──dispatch       │
  │          │                │           │  decision       │
  │          │                │           │  agent run      │
  │          │                │           │       │         │
  │          │                │           │       │──call──▶│ (LLM)
  │          │                │           │       │         │
  │          │                │           │       │◀─JSON───│
  │          │                │           │◀─output         │
  │          │                │           │                 │
  │          │                │           │ parseDecisionOutput
  │          │                │           │ computeSkipSet  │
  │          │                │           │                 │
  │          │                │           │──write          │
  │          │                │           │  completed──▶   │
  │          │                │           │  skipped──▶     │
  │          │                │           │  (txn)          │
  │          │                │           │                 │
  │          │                │           │──re-enqueue     │
  │          │                │           │  tick──▶        │
  │          │                │           │                 │
  │          │                │─────────  tick continues    │
  │          │                │           with chosen       │
  │          │                │           branch entry      │
  │          │                │           steps             │
  │          │                │                             │
  │──watch───│                │                             │
  │  WS      │                │                             │
  │◀─step────│ playbook.decision.dispatched                 │
  │  events  │ playbook.decision.completed                  │
  │          │ playbook.step.dispatched (entry step)        │
  │          │ ...                                          │
```

### 20.4 Sequence diagram — supervised mode, reviewer edits the choice

```
Engine             AgentExec       LLM      Reviewer        DB
  │                    │            │          │             │
  │──dispatch decision ▶            │          │             │
  │                    │──LLM call──▶          │             │
  │                    │◀─JSON──────           │             │
  │                    │                       │             │
  │                    │ parse + validate ok   │             │
  │                    │                       │             │
  │◀─completion hook──┐                        │             │
  │                   │                        │             │
  │ supervised mode → create reviewItem,       │             │
  │                   set stepRun = awaiting_approval        │
  │                                            │             │
  │─────────────────────────────create review item ──────────▶
  │─────────────────────────────write stepRun status─────────▶
  │                                            │             │
  │◀──WS: awaiting_approval────────────────────                │
  │                                            │             │
  │                                            │──GET──▶     │
  │                                            │◀─detail─    │
  │                                            │             │
  │                                            │ (human reviews,
  │                                            │  changes branch
  │                                            │  from "material"
  │                                            │  to "cosmetic")
  │                                            │             │
  │                                            │──POST       │
  │                                            │  /approve   │
  │                                            │  with edit──▶
  │                                            │             │
  │◀──approval handler──                       │             │
  │                                            │             │
  │ validate edited chosenBranchId is valid    │             │
  │ recompute skipSet against NEW branch       │             │
  │                                            │             │
  │─────write stepRun completed (edited flag)──────────────▶ │
  │─────write skip-set transitions──────────────────────────▶ │
  │                                            │             │
  │──regression capture: original=material, edited=cosmetic ▶│
  │                                            │             │
  │──re-enqueue tick──▶                        │             │
  │                                            │             │
  │◀──WS: decision.completed (chosenByAgent=false,           │
  │                          editedBy=reviewer)              │
```

### 20.5 Sequence diagram — confidence-escape-to-HITL

```
Engine             AgentExec       LLM      Reviewer        DB
  │                    │            │          │             │
  │──dispatch decision ▶            │          │             │
  │                    │            │          │             │
  │                    │ (envelope carries minConfidence=0.8)│
  │                    │──LLM call──▶          │             │
  │                    │                       │             │
  │                    │◀─JSON (conf: 0.4)     │             │
  │                    │                       │             │
  │                    │ parse ok               │             │
  │                    │ validate ok            │             │
  │                    │ confidence < threshold │             │
  │                    │                        │            │
  │◀─completion hook──┐                         │            │
  │                   │                         │            │
  │ confidence-escape:                           │            │
  │   create reviewItem with type=low_confidence │            │
  │   stepRun → awaiting_hitl                    │            │
  │                                              │            │
  │────────── create reviewItem ─────────────────────────────▶│
  │────────── write stepRun status ──────────────────────────▶│
  │                                              │            │
  │◀── WS: decision.escalated (confidence=0.4) ──               │
  │                                              │            │
  │                                              │──GET──▶    │
  │                                              │◀─detail─   │
  │                                              │            │
  │                                              │ (reviewer  │
  │                                              │  approves  │
  │                                              │  agent's   │
  │                                              │  choice)   │
  │                                              │            │
  │                                              │──POST      │
  │                                              │  /approve──▶
  │                                              │            │
  │ apply original skipSet                       │            │
  │────── write stepRun completed ──────────────────────────▶ │
  │────── write skip-set transitions ───────────────────────▶ │
```

### 20.6 Sequence diagram — replay mode

```
Engine             AgentExec     LLM       DB
  │                    │          │         │
  │ (run.runMode = 'replay')      │         │
  │                    │          │         │
  │──handle decision───▶          │         │
  │                    │──load    │         │
  │                    │  snapshot──────────▶
  │                    │◀─snapshot──────────
  │                    │                    │
  │                    │ find recorded      │
  │                    │ decision output    │
  │                    │ for this stepId    │
  │                    │                    │
  │                    │ DO NOT call LLM    │
  │                    │                    │
  │                    │ replay:            │
  │                    │   parse recorded   │
  │                    │   chosenBranchId   │
  │                    │   recompute skipSet│
  │                    │   (deterministic)  │
  │                    │                    │
  │◀─completion hook──┐                     │
  │                   │                     │
  │ apply skipSet (same as auto mode)       │
  │── write stepRun completed ─────────────▶│
  │── write skip-set transitions ──────────▶│
  │                                         │
  │ (if no snapshot exists for this step:   │
  │  FAIL with failureReason=               │
  │  'replay_snapshot_missing')             │
```

### 20.7 Sequence diagram — mid-run edit cascade

The author of a completed decision edits the chosen branch while the chosen branch's downstream steps are running. This reuses the existing invalidation cascade.

```
Reviewer       Engine            DB
   │              │               │
   │──POST edit──▶│               │
   │              │               │
   │              │ load step + definition
   │              │ parse new chosenBranchId
   │              │ computeSkipSet(new)
   │              │ diff against old skipSet
   │              │                │
   │              │ in-flight downstream steps:
   │              │   AbortController.abort() for each
   │              │                │
   │              │ newly-skipped steps (were running/completed):
   │              │   mark as 'invalidated' (standard cascade)
   │              │   block if any are irreversible (pending confirmation)
   │              │                │
   │              │ newly-live steps (were skipped):
   │              │   mark as 'pending'
   │              │                │
   │              │── write all transitions in single txn ──▶
   │              │                │
   │              │── re-enqueue tick ──▶
   │              │                │
   │◀─ok──────────│                │
```

The output-hash firewall applies: if the edited `chosenBranchId` is byte-identical to the current one, the engine short-circuits and does nothing.

---

## 21. Failure reason catalogue

Every failure mode a decision step can produce, what triggers it, whether it retries, what the UI shows, and what cascades downstream. Every row maps to a member of the `FailureReason` closed enum in `shared/iee/failureReason.ts` — **new enum members must be added in the same commit as this feature** (see §25 for the migration ordering).

| Code | Trigger | Retries? | User-visible message | Playbook run effect | Metric |
|------|---------|----------|----------------------|---------------------|--------|
| `decision_parse_failure` | Agent emitted output that fails the base Zod schema (e.g. missing `chosenBranchId`, wrong type, invalid JSON) | Up to `MAX_DECISION_RETRIES` with retry envelope; then fallback to `defaultBranchId` if set | "The decision agent returned an invalid response and could not be retried successfully." | Step fails; if `defaultBranchId` set and failure is parse/validation, apply default instead; otherwise run fails at this step | `playbook.decision.parse_failure` |
| `decision_unknown_branch` | Output parses but `chosenBranchId` is not in the declared branches | Same as parse failure — retried with the retry envelope explicitly listing valid ids; then fallback | "The decision agent chose a branch that doesn't exist in this playbook." | Same as parse failure | `playbook.decision.unknown_branch` |
| `decision_extra_schema_violation` | Base schema passes but a field declared in `extraOutputSchema` is missing or wrong | Same as parse failure | "The decision agent did not include required additional fields." | Same as parse failure | `playbook.decision.extra_schema_violation` |
| `decision_tool_call_blocked` | The decision agent attempted to call a tool — caught by the `runType === 'playbook_decision'` guard in `agentExecutionService` | No | "The decision agent attempted to use a tool, which is not allowed in decision steps. This is a model policy violation, not a user error." | Step fails hard; no fallback (this indicates the agent is not honouring the envelope constraints, which is a bug that should be investigated manually) | `playbook.decision.tool_call_blocked` |
| `decision_budget_exceeded` | The playbook run's remaining token/cost budget is insufficient to dispatch the decision | No — budget is exhausted | "The playbook run's budget is exhausted. Decision step could not run." | Step fails; run fails (no fallback — no budget to try) | `playbook.decision.budget_exceeded` |
| `decision_agent_run_failed` | The underlying agent run failed before emitting any output (LLM timeout, provider error, circuit breaker trip, etc.) | No — the agent execution service has its own retry via `withBackoff`; the playbook layer does not double-retry | "The decision agent could not complete its run." (carries the inner failure reason as detail) | Step fails; if `defaultBranchId` set AND inner reason is `llm_timeout` or `transient_provider_error`, apply default; otherwise run fails | `playbook.decision.agent_run_failed` |
| `decision_step_timeout` | The decision step's `timeoutSeconds` elapsed before the agent run returned | No | "The decision agent did not respond within the step's timeout." | Step fails; fallback to `defaultBranchId` if set | `playbook.decision.step_timeout` |
| `decision_replay_snapshot_missing` | Run is in `replay` mode but no snapshot exists for this step id | No — replay mode is hard-blocked from invoking new LLM calls for decisions | "Replay mode cannot execute a decision step that was not present in the original run." | Step fails; run fails | `playbook.decision.replay_snapshot_missing` |
| `decision_reviewer_rejected` | Supervised-mode reviewer explicitly rejected the decision | No (reviewer decision is final) | "A reviewer rejected the decision. Restart the run or retry the step manually to try again." | Step fails; run fails (the author can restart from scratch or cancel) | `playbook.decision.reviewer_rejected` |
| `decision_cancelled` | Run was cancelled while the decision step was in `running` or `awaiting_*` state | No | "Playbook run was cancelled while the decision step was in progress." | Step terminates as `cancelled`; run terminates as `cancelled` | `playbook.decision.cancelled` |
| `decision_invalid_edit` | Mid-run editor provided a `chosenBranchId` that doesn't exist or that would create an invalid skip set | No — returns a 400 to the API caller | "The edited branch id is not valid for this decision step." | No state change; the edit is rejected and the existing state stands | `playbook.decision.invalid_edit` |
| `decision_skip_set_collision` | A downstream step was found in `running` / `completed` state when it should have been `skipped` — indicates a DAG authoring bug that the validator missed | No | "A downstream step was in an unexpected state when the decision resolved. This is a DAG configuration issue." | Warning logged, metric emitted, run continues without transitioning the collided step | `playbook.decision.skip_set_collision` |

### 21.1 Retry envelope details

When a failure is retryable, the next retry uses the same `renderAgentDecisionEnvelope()` with a populated `priorAttempt`:

```typescript
renderAgentDecisionEnvelope({
  decisionPrompt: originalPrompt,
  branches: originalBranches,
  minConfidence: originalMinConfidence,
  priorAttempt: {
    errorMessage: humanReadableErrorMessage, // e.g. "chosenBranchId 'unknown' is not one of [material, cosmetic]"
    rawOutput: truncate(agentRawOutput, 1000),
  },
});
```

The retry creates a **new** agent run linked to the original via the existing retry chain on `agent_runs.retry_of_id`. The playbook step run stays the same; `retryCount` increments. Budget is debited from the playbook run on every retry, and a retry that exhausts the budget fails as `decision_budget_exceeded` mid-retry.

### 21.2 Fallback policy (defaultBranchId)

When `defaultBranchId` is set and the retry loop exhausts, the engine falls back:

1. Record the agent's last attempted output (even if invalid) in the step run's metadata as `lastFailedOutput` for debugging.
2. Synthesise a decision output: `{ chosenBranchId: step.defaultBranchId, rationale: 'Fallback: agent failed after N retries (<reason>)', confidence: 0 }`.
3. Set `chosenByAgent: false` in the step output — this is the signal consumers use to distinguish "agent chose this" from "default kicked in."
4. Apply the skip set as normal.
5. Emit `playbook.decision.fallback_applied` metric.
6. Emit `playbook.decision.completed` WebSocket event with `chosenByAgent: false`.

Fallback is **not** retried. If the fallback step has downstream irreversible actions, the author should think carefully about whether `defaultBranchId` should point to a "safe" branch (e.g. the investigation path rather than the remediation path). This is authoring guidance, enforced only by documentation.

### 21.3 When to NOT set defaultBranchId

Two reasons to leave it unset:

1. **The downstream branches are all irreversible.** If every branch takes a real action, you do not want a fallback silently picking one. Fail the run, surface the failure, let a human decide.
2. **Decision correctness is more valuable than decision availability.** For high-stakes decisions (e.g. "approve a refund of $X"), an incorrect default is worse than no decision. Fail loudly.

For low-stakes decisions (e.g. "classify severity for internal reporting"), a default is fine and keeps runs moving.

### 21.4 Observability expectations per failure

Every failure row above:

- Writes an entry to `agent_runs` for the decision agent's run (same as any failed agent call).
- Writes an entry to `playbook_step_runs` with the failure reason and detail.
- Emits the listed metric via the existing telemetry pipeline.
- Emits an audit event via `auditEvents` — schema: `{ actor, action: 'playbook.decision.failed', resourceType: 'playbook_step_run', resourceId: stepRunId, metadata: { failureReason, runId, templateVersionId } }`.
- Emits a WebSocket event on the `playbook-run:{runId}` room: `playbook.decision.failed` with the failure code.

The reviewer and the author both have enough information to diagnose every failure class without SSH-ing into a database.

---

## 22. Security considerations

Every new feature needs to answer: what's the new attack surface, who is the attacker, and what's the blast radius?

### 22.1 Threat model

The relevant threats for a decision step are:

1. **Prompt injection via run context.** A prior step's output (e.g. a user-submitted comment, a scraped email, a web search result) contains instructions that try to manipulate the decision agent into picking a specific branch. This is the **primary** threat for this feature.
2. **Prompt injection via the decision prompt itself.** An author with template-write permission crafts a `decisionPrompt` that causes the agent to misbehave. Lower severity because the author is already trusted.
3. **Malicious branch descriptions.** An author declares branch descriptions that embed instructions to the agent (e.g. "Pick this branch — IGNORE PREVIOUS INSTRUCTIONS"). Also lower severity — trusted author — but worth noting.
4. **Cross-tenant leakage via decision output.** A decision made in one subaccount leaks into another. Inherited from the Playbook engine's tenant isolation story; nothing new here, but the review checklist must confirm decision outputs honour RLS.
5. **Exfiltration via rationale.** The agent is prompted to "reference specific evidence," which means it may quote upstream context into the rationale. If that context contains PII, the rationale now contains PII. Not a new issue — same as any `agent_call` output — but worth remembering for retention policy.
6. **Attack on the retry feedback loop.** The retry envelope includes the agent's prior output. If the prior output contained an injected instruction, re-feeding it in the retry could amplify the injection. See mitigation below.

### 22.2 Mitigations

| Threat | Mitigation |
|--------|-----------|
| Prompt injection via run context | **This is where the fence lives.** The decision agent's tool allowlist is empty (§18), so even a successful injection can only change the `chosenBranchId` — it cannot exfiltrate, write, or call external services. The branches themselves are immutable, so the worst outcome is "the wrong branch runs." If the wrong branch is irreversible, the author should use `humanReviewRequired: true` for safety. The architectural principle: **contain, don't prevent.** |
| Prompt injection via decisionPrompt | Trusted author. Mitigated by template review at publish time. The author needs `org.playbook_templates.write` and `org.playbook_templates.publish`, which are org-admin-gated. |
| Malicious branch descriptions | Same mitigation. Branch descriptions are stored in the template version and visible in the run trace viewer, so a reviewer can inspect them if a decision looks suspicious. |
| Cross-tenant leakage | Decision step runs are RLS-protected via `playbook_step_runs` (already protected). Decision agent runs are RLS-protected via `agent_runs` (already protected). The three-layer isolation story applies unchanged. The review checklist must confirm every decision-related query passes through `withOrgTx`. |
| Exfiltration via rationale | The rationale field is part of `outputJson`, which is stored under the same retention policy as any other step run output. Soft-delete cascade removes rationale along with the step run. No new leakage surface. |
| Retry feedback loop amplification | The retry envelope **truncates** the prior output to 1000 characters (§17.4), which limits how much injected content can re-enter the conversation. The retry count is capped at `MAX_DECISION_RETRIES = 3`, so an injection cannot create an infinite amplification loop. |

### 22.3 Additional security invariants

1. **Decision step runs MUST pass through `withOrgTx`.** Every read and write on `playbook_step_runs` for a decision step happens inside a transaction that has `app.organisation_id` set. This is a consequence of the existing RLS posture; the review checklist must confirm no decision code path bypasses it.

2. **Decision agent runs inherit the parent playbook run's `organisationId`.** The `agent_runs` row created for a decision dispatch is keyed on the same `organisationId` as the playbook run. Enforced at dispatch time in the engine.

3. **The envelope renderer MUST escape the decision prompt.** The rendered envelope is a markdown string interpolated into a system prompt. If the decision prompt contains triple-backticks or other markdown-breaking content, the envelope renderer must not let it break out of the ## The question section. The renderer uses a simple escaping pass: replace triple-backticks with ``` `⋅`⋅` ``` (zero-width joiner) and strip any `## ` headings from user-controlled strings. Unit-tested.

4. **The retry envelope's `rawOutput` MUST NOT be interpreted as markdown.** It is inserted into a fenced code block so the model sees it as literal text, not as instructions. Unit-tested.

5. **The reviewer's edit payload MUST be validated against the step's declared branches.** An attacker with reviewer credentials could otherwise POST an edit with `chosenBranchId: 'arbitrary'` and cause the engine to apply a skip set for a nonexistent branch. The API handler calls `validateDecisionStep` and `computeSkipSet` against the edit before applying it; any failure returns 400.

6. **Regression capture MUST redact PII in rationale if redaction is enabled.** If the org has enabled PII redaction on `regression_cases`, the existing redaction pipeline applies to decision outputs the same way it applies to any other captured step.

### 22.4 What we are explicitly NOT defending against

- **A model that ignores its constraints.** The envelope says "no tools." If the model tries to call a tool anyway, the agent execution service blocks it (§18.2 layer 4) and the step fails. We rely on the existing `toolRestrictionMiddleware` to catch the violation, which is exactly what it's there for.
- **A compromised reviewer.** A reviewer with approval permission can edit a decision to pick any declared branch. This is not a new attack surface — it's the same risk every `approval` step already carries. If the org's threat model needs dual review, that is a separate feature (Phase 2 consideration).
- **A byzantine LLM provider.** If the provider returns a response that looks valid but is fabricated, the engine trusts it. Regression capture + supervised mode are the defences.

---

## 23. Performance considerations

### 23.1 Expected latency profile

A decision step fires one LLM call per attempt. With retries capped at `MAX_DECISION_RETRIES = 3` and an expected happy-path attempt count of 1, the expected latency is:

| Phase | Target | Notes |
|-------|--------|-------|
| Dispatch (engine → pg-boss → worker) | < 200ms | Existing pg-boss dispatch latency; unchanged. |
| LLM call (single decision) | 800ms – 3000ms | Depends on provider, model tier, and prompt size. |
| Parse + validate | < 5ms | Pure helper, O(branches count). |
| Skip set computation | < 2ms | Pure helper, O(V+E). |
| DB write (step run + skip cascade) | < 50ms | Single transaction, small cardinality (≤8 branches × small DAG). |
| Re-enqueue tick | < 50ms | Existing pg-boss enqueue. |
| **Total happy-path target** | **< 3.5 seconds** | End-to-end from dispatch to downstream tick. |

Retry worst case (3 failed attempts + successful retry): ~12 seconds. Fallback worst case (3 failed attempts → default): ~9 seconds (no extra LLM call for the fallback itself).

### 23.2 DAG size bounds

The skip set algorithm is O(V + E) where V is the number of playbook steps and E is the number of dependency edges. For a reasonable playbook (≤50 steps, ≤200 edges), this is well under a millisecond.

Phase 1 enforces:

| Limit | Value | Rationale |
|-------|-------|-----------|
| Max branches per decision step | 8 | Keeps prompt size bounded (the branches table is included in every envelope) and keeps the skip set computation fast. |
| Max decision steps per playbook | No explicit limit in phase 1 | Bounded indirectly by the existing max steps per playbook (no formal limit in the current engine, but in practice templates are under 50 steps). |
| Max playbook steps | No explicit limit | Inherited from existing engine. |

If we see playbooks with more than 8 branches per decision in practice, phase 2 can lift the cap — nothing in the pure helper requires it. The cap exists to prevent accidental prompt bloat.

### 23.3 Parallel decisions

If a playbook has two decision steps that do not depend on each other, both dispatch in parallel in the same tick. Each dispatches its own agent run. The skip set computations run independently on completion. No cross-decision coordination.

This is the same concurrency model every step type already uses (parallel dispatch up to `MAX_PARALLEL_STEPS_DEFAULT = 8`). Decisions do not consume extra parallelism slots beyond their share.

### 23.4 Cost bounds

A decision step's cost is bounded by:

- **Token cost** of one LLM call per attempt (up to `MAX_DECISION_RETRIES + 1` attempts).
- **Zero tool call cost** (no tools).
- **No worker-side cost** (no IEE execution).

The `runCostBreaker` applies unchanged. A decision step cannot cost more than its share of the playbook run's remaining budget. If the budget would be exceeded by dispatching the decision, the step fails with `decision_budget_exceeded` before the LLM call fires.

### 23.5 Cache opportunities

The envelope renderer is pure and its output is deterministic given the context. In principle we could memoise the rendered envelope per `(stepId, decisionPrompt, branches, minConfidence)` tuple — but:

- Decision steps rarely fire more than once per run (unless retried).
- Retries generate a different envelope (with `priorAttempt` populated), so the cache hit rate for retries is zero.
- Memory cost of caching is not trivial if we're running many playbook runs in parallel.

**Decision:** no envelope caching in phase 1. Revisit only if profiling shows envelope rendering as a hot path (extremely unlikely).

### 23.6 Database write amplification on skip set

Applying the skip set involves writing one row per newly-skipped step. For a playbook with 2 branches of 5 steps each, choosing one branch writes 5 `skipped` rows in a single transaction — a small, bounded write. No batching concerns.

For a pathological playbook with many nested decisions, the cumulative write amplification is still bounded by the total number of steps in the DAG, and the `computeSkipSet` helper walks the DAG exactly once regardless of depth. Worst case: a decision whose branches cover every other step in the DAG, resulting in O(V) writes. Still well under single-transaction limits.

### 23.7 What we will measure after launch

Three metrics will tell us whether the performance model holds:

1. `playbook.decision.total_latency_ms` (histogram) — actual end-to-end latency per decision step. Alert if p95 > 8 seconds.
2. `playbook.decision.retry_count` (histogram) — retries per step. Alert if p95 > 1 (i.e. half of decisions are failing first attempt).
3. `playbook.decision.parse_failure_rate` (counter) — per-template parse failure rate. Alert if any template exceeds 5%.

If retry rates are high, investigate the envelope and the model — something is systematically confusing the model.

---

## 24. Full pure helper implementations

The pure helper lives at `server/lib/playbook/agentDecisionPure.ts`. Every function is synchronous, deterministic, side-effect-free, and has no imports from `server/db/`, `server/services/`, or anything else with runtime state. This is the single source of truth for decision logic — the engine delegates, never re-implements.

### 24.1 `computeSkipSet`

```typescript
import type {
  PlaybookDefinition,
  AgentDecisionStep,
  PlaybookStep,
} from '../../../shared/playbook/agentDecisionTypes.js';

/**
 * Compute the set of step ids that should be transitioned to `skipped`
 * given a chosen branch on a decision step.
 *
 * Algorithm:
 *   1. Collect the entry steps of every non-chosen branch (the "skip seeds").
 *   2. BFS forward from the skip seeds, adding each visited step to the
 *      skip set IF and only IF every one of its branch-descended ancestors
 *      is already in the skip set. This is the "live ancestor short-circuit"
 *      that keeps convergence steps alive.
 *   3. Return the frozen set.
 *
 * Complexity: O(V + E) in the number of steps and dependency edges.
 * Purity: no DB, no async, no side effects. Same input → same output.
 *
 * Invariants:
 *   - The decision step itself is NEVER in the returned set.
 *   - A step that is reachable via the chosen branch is NEVER in the set,
 *     even if it is also reachable via a non-chosen branch (convergence).
 *   - Steps whose ancestors are entirely non-branch (i.e. they come from
 *     outside the decision's subgraph) are NEVER in the set.
 */
export function computeSkipSet(
  definition: PlaybookDefinition,
  decisionStepId: string,
  chosenBranchId: string,
): ReadonlySet<string> {
  const decisionStep = definition.steps.find(
    (s): s is AgentDecisionStep =>
      s.id === decisionStepId && s.type === 'agent_decision',
  );
  if (!decisionStep) {
    throw new Error(
      `computeSkipSet: decision step ${decisionStepId} not found or wrong type`,
    );
  }

  const chosenBranch = decisionStep.branches.find(
    (b) => b.id === chosenBranchId,
  );
  if (!chosenBranch) {
    throw new Error(
      `computeSkipSet: branch ${chosenBranchId} not found on decision step ${decisionStepId}`,
    );
  }

  // Build an adjacency index once: stepId -> downstream step ids.
  const downstream = buildDownstreamIndex(definition);

  // Entry steps of the chosen branch form the "live" set's initial seed.
  const liveSeeds = new Set<string>(chosenBranch.entrySteps);

  // Entry steps of the NON-chosen branches form the initial skip candidates.
  const skipCandidates: string[] = [];
  for (const branch of decisionStep.branches) {
    if (branch.id === chosenBranchId) continue;
    for (const entryStepId of branch.entrySteps) {
      skipCandidates.push(entryStepId);
    }
  }

  // BFS forward from the skip candidates, checking live ancestry at each step.
  const skipSet = new Set<string>();
  const queue: string[] = [...skipCandidates];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const stepId = queue.shift()!;
    if (visited.has(stepId)) continue;
    visited.add(stepId);

    // A step is skipped only if EVERY branch-descended ancestor is in the skip set.
    // "Branch-descended" means "reachable from the decision step's branches."
    // Non-branch ancestors (e.g. a step that depends on both the decision
    // subgraph and something outside it) keep the step live.
    if (!isStepFullyOccludedByNonChosenBranches(
      stepId,
      definition,
      decisionStep,
      chosenBranchId,
      skipSet,
      liveSeeds,
    )) {
      // This step has at least one live ancestor path. Do not skip it.
      continue;
    }

    skipSet.add(stepId);

    // Enqueue descendants for the same check.
    const children = downstream.get(stepId) ?? [];
    for (const childId of children) {
      if (!visited.has(childId)) queue.push(childId);
    }
  }

  return skipSet;
}

/**
 * Returns true if every branch-descended ancestor of `stepId` is either in
 * the skip set or is itself the decision step. False if any branch-descended
 * ancestor is outside the skip set (i.e. reachable via the chosen branch).
 *
 * "Branch-descended" is determined by starting from the decision step's
 * branch entry points and walking forward. A step is branch-descended if
 * it is transitively reachable from any branch entry step.
 */
function isStepFullyOccludedByNonChosenBranches(
  stepId: string,
  definition: PlaybookDefinition,
  decisionStep: AgentDecisionStep,
  chosenBranchId: string,
  skipSet: ReadonlySet<string>,
  liveSeeds: ReadonlySet<string>,
): boolean {
  const step = definition.steps.find((s) => s.id === stepId);
  if (!step) return false;

  // Collect the set of steps reachable FROM this step backward,
  // i.e. this step's ancestors, restricted to steps that are themselves
  // branch-descended from the decision.
  const ancestors = collectBranchDescendedAncestors(
    stepId,
    definition,
    decisionStep,
  );

  // If ANY ancestor is in the live seed set or transitively from it,
  // this step is live. Otherwise, if all branch-descended ancestors are
  // in the skip set, this step is occluded.
  const liveBranchAncestors = computeBranchLiveSet(
    definition,
    decisionStep,
    chosenBranchId,
  );

  for (const ancId of ancestors) {
    if (liveBranchAncestors.has(ancId)) {
      return false; // this step has at least one live ancestor → not skipped
    }
  }
  return true;
}

/** Build the set of step ids reachable from the chosen branch's entry steps. */
function computeBranchLiveSet(
  definition: PlaybookDefinition,
  decisionStep: AgentDecisionStep,
  chosenBranchId: string,
): ReadonlySet<string> {
  const chosen = decisionStep.branches.find((b) => b.id === chosenBranchId);
  if (!chosen) return new Set();

  const downstream = buildDownstreamIndex(definition);
  const live = new Set<string>();
  const queue: string[] = [...chosen.entrySteps];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (live.has(id)) continue;
    live.add(id);
    const kids = downstream.get(id) ?? [];
    for (const k of kids) {
      if (!live.has(k)) queue.push(k);
    }
  }
  return live;
}

/** Collect ancestor step ids that are branch-descended from the decision. */
function collectBranchDescendedAncestors(
  stepId: string,
  definition: PlaybookDefinition,
  decisionStep: AgentDecisionStep,
): ReadonlySet<string> {
  const upstream = buildUpstreamIndex(definition);
  const allBranchDescended = new Set<string>();

  // Seed with every branch's entry step, then walk forward.
  for (const branch of decisionStep.branches) {
    for (const entryId of branch.entrySteps) {
      allBranchDescended.add(entryId);
    }
  }
  const downstream = buildDownstreamIndex(definition);
  const queue: string[] = Array.from(allBranchDescended);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const kids = downstream.get(id) ?? [];
    for (const k of kids) {
      if (!allBranchDescended.has(k)) {
        allBranchDescended.add(k);
        queue.push(k);
      }
    }
  }

  // Now walk upstream from stepId collecting ancestors that are in allBranchDescended.
  const ancestors = new Set<string>();
  const q: string[] = [stepId];
  while (q.length > 0) {
    const id = q.shift()!;
    const parents = upstream.get(id) ?? [];
    for (const p of parents) {
      if (allBranchDescended.has(p) && !ancestors.has(p)) {
        ancestors.add(p);
        q.push(p);
      }
    }
  }
  return ancestors;
}

/** stepId -> direct descendants (from dependsOn) */
function buildDownstreamIndex(
  definition: PlaybookDefinition,
): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const step of definition.steps) {
    for (const dep of step.dependsOn) {
      const list = index.get(dep) ?? [];
      list.push(step.id);
      index.set(dep, list);
    }
  }
  return index;
}

/** stepId -> direct ancestors (from dependsOn) */
function buildUpstreamIndex(
  definition: PlaybookDefinition,
): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const step of definition.steps) {
    index.set(step.id, [...step.dependsOn]);
  }
  return index;
}
```

### 24.2 `computeStepReadiness`

```typescript
import type { StepReadiness, StepRunStatus } from './agentDecisionPureTypes.js';

/**
 * Determine whether a step is ready to dispatch, waiting, or permanently skipped,
 * given the current status of its direct ancestors.
 *
 * Rules:
 *   - If the step itself is already terminal, return its status.
 *   - If any ancestor is pending / running / awaiting_*, return 'waiting'.
 *   - If every ancestor is 'skipped', return 'skipped'.
 *   - If every ancestor is in a terminal state AND at least one is 'completed',
 *     return 'ready'.
 *   - If every ancestor is in a terminal state but one is 'failed' or 'cancelled',
 *     the engine's existing failure propagation handles it. This helper returns
 *     'waiting' and lets the engine's main loop handle the failure state.
 */
export function computeStepReadiness(
  step: PlaybookStep,
  stepRunStatusesByStepId: ReadonlyMap<string, StepRunStatus>,
): StepReadiness {
  if (step.dependsOn.length === 0) {
    // Root step. Always ready at dispatch time.
    return 'ready';
  }

  let allSkipped = true;
  let anyCompleted = false;
  let allTerminal = true;

  for (const ancId of step.dependsOn) {
    const status = stepRunStatusesByStepId.get(ancId);
    if (status === undefined) {
      // Ancestor stepRun not yet created → still pending
      allTerminal = false;
      allSkipped = false;
      continue;
    }
    if (status === 'pending' || status === 'running' ||
        status === 'awaiting_input' || status === 'awaiting_approval' ||
        status === 'awaiting_hitl') {
      allTerminal = false;
      allSkipped = false;
    }
    if (status !== 'skipped') {
      allSkipped = false;
    }
    if (status === 'completed') {
      anyCompleted = true;
    }
  }

  if (!allTerminal) return 'waiting';
  if (allSkipped) return 'skipped';
  if (anyCompleted) return 'ready';
  return 'waiting'; // failure propagation handled elsewhere
}
```

### 24.3 `parseDecisionOutput`

```typescript
import type {
  AgentDecisionStep,
  AgentDecisionOutput,
} from '../../../shared/playbook/agentDecisionTypes.js';
import type { DecisionParseResult } from './agentDecisionPureTypes.js';
import { agentDecisionOutputBaseSchema } from './agentDecisionSchemas.js';

/**
 * Parse a raw LLM output string into a validated AgentDecisionOutput.
 * Returns a discriminated result — never throws.
 *
 * Validation order:
 *   1. Strip leading/trailing whitespace and common wrapping (code blocks, prose preamble).
 *   2. Parse JSON. Fail with 'invalid_json' if malformed.
 *   3. Validate against the base Zod schema. Fail with 'schema_violation' if mismatched.
 *   4. Validate chosenBranchId is one of step.branches[*].id. Fail with 'unknown_branch' if not.
 *   5. If step.extraOutputSchema is set, validate extra fields. Fail with 'extra_schema_violation' if not.
 *   6. Return { ok: true, output }.
 */
export function parseDecisionOutput(
  raw: string,
  step: AgentDecisionStep,
): DecisionParseResult {
  const stripped = stripJsonWrapping(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'invalid_json',
        message: `Failed to parse JSON: ${(err as Error).message}`,
        detail: { raw: truncate(raw, 500) },
      },
    };
  }

  const baseResult = agentDecisionOutputBaseSchema.safeParse(parsed);
  if (!baseResult.success) {
    return {
      ok: false,
      error: {
        code: 'schema_violation',
        message: baseResult.error.issues.map((i) => i.message).join('; '),
        detail: { issues: baseResult.error.issues },
      },
    };
  }

  const output = baseResult.data as AgentDecisionOutput;

  const validBranchIds = new Set(step.branches.map((b) => b.id));
  if (!validBranchIds.has(output.chosenBranchId)) {
    return {
      ok: false,
      error: {
        code: 'unknown_branch',
        message: `chosenBranchId '${output.chosenBranchId}' is not one of [${
          step.branches.map((b) => b.id).join(', ')
        }]`,
        detail: { validBranchIds: Array.from(validBranchIds) },
      },
    };
  }

  // extraOutputSchema validation deferred to the engine layer since Zod
  // can't be constructed from a JSONSchema7 literal without a runtime helper.
  // The engine imports the compiled Zod schema and re-validates if needed.

  return { ok: true, output };
}

/**
 * Strip common LLM output wrapping patterns before JSON parsing.
 * - Remove leading / trailing whitespace.
 * - Remove a single wrapping ```json ... ``` or ``` ... ``` fence.
 * - Remove a leading "Here's my response:" style preamble.
 */
function stripJsonWrapping(raw: string): string {
  let s = raw.trim();

  // Strip code fences
  const fenceMatch = s.match(/^```(?:json)?\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) s = fenceMatch[1]!.trim();

  // Strip leading prose before the first '{'
  const firstBrace = s.indexOf('{');
  if (firstBrace > 0) s = s.slice(firstBrace);

  // Strip trailing prose after the last '}'
  const lastBrace = s.lastIndexOf('}');
  if (lastBrace !== -1 && lastBrace < s.length - 1) {
    s = s.slice(0, lastBrace + 1);
  }

  return s;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}
```

### 24.4 `validateDecisionStep`

```typescript
import type {
  PlaybookDefinition,
  AgentDecisionStep,
} from '../../../shared/playbook/agentDecisionTypes.js';
import type {
  ValidationResult,
  ValidationIssue,
} from './agentDecisionPureTypes.js';

/**
 * Validate a single decision step in the context of the full playbook.
 * Pure, no DB access. Called by the publish-path validator and by the
 * runtime dispatcher as a belt-and-braces check.
 */
export function validateDecisionStep(
  step: AgentDecisionStep,
  definition: PlaybookDefinition,
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Branch count
  if (step.branches.length < 2) {
    issues.push({
      code: 'decision_too_few_branches',
      stepId: step.id,
      message: `Decision step requires at least 2 branches; has ${step.branches.length}`,
      path: ['branches'],
    });
  }
  if (step.branches.length > 8) {
    issues.push({
      code: 'decision_too_many_branches',
      stepId: step.id,
      message: `Phase 1 caps branches at 8; has ${step.branches.length}`,
      path: ['branches'],
    });
  }

  // Branch ids unique
  const branchIds = new Set<string>();
  for (const branch of step.branches) {
    if (branchIds.has(branch.id)) {
      issues.push({
        code: 'decision_duplicate_branch_id',
        stepId: step.id,
        message: `Duplicate branch id: ${branch.id}`,
        path: ['branches', branch.id],
      });
    }
    branchIds.add(branch.id);
  }

  // Side effect type
  if (step.sideEffectType !== 'none') {
    issues.push({
      code: 'decision_illegal_side_effect',
      stepId: step.id,
      message: `Decision steps MUST have sideEffectType='none'`,
      path: ['sideEffectType'],
    });
  }

  // defaultBranchId validation
  if (step.defaultBranchId !== undefined && !branchIds.has(step.defaultBranchId)) {
    issues.push({
      code: 'decision_default_branch_invalid',
      stepId: step.id,
      message: `defaultBranchId '${step.defaultBranchId}' does not match any branch`,
      path: ['defaultBranchId'],
    });
  }

  // minConfidence range
  if (step.minConfidence !== undefined &&
      (step.minConfidence < 0 || step.minConfidence > 1)) {
    issues.push({
      code: 'decision_min_confidence_out_of_range',
      stepId: step.id,
      message: `minConfidence must be in [0, 1]; got ${step.minConfidence}`,
      path: ['minConfidence'],
    });
  }

  // Entry step existence + dependsOn correctness + collision
  const allStepsById = new Map(definition.steps.map((s) => [s.id, s]));
  const entryStepOwnership = new Map<string, string>(); // entryStepId -> owning branch id

  for (const branch of step.branches) {
    if (branch.entrySteps.length === 0) {
      issues.push({
        code: 'decision_branch_no_entry',
        stepId: step.id,
        message: `Branch '${branch.id}' has no entry steps`,
        path: ['branches', branch.id, 'entrySteps'],
      });
      continue;
    }
    for (const entryStepId of branch.entrySteps) {
      const entry = allStepsById.get(entryStepId);
      if (!entry) {
        issues.push({
          code: 'decision_entry_step_not_found',
          stepId: step.id,
          message: `Entry step '${entryStepId}' does not exist in the playbook`,
          path: ['branches', branch.id, 'entrySteps'],
        });
        continue;
      }
      if (!entry.dependsOn.includes(step.id)) {
        issues.push({
          code: 'decision_entry_step_missing_dep',
          stepId: step.id,
          message: `Entry step '${entryStepId}' must include '${step.id}' in its dependsOn`,
          path: ['branches', branch.id, 'entrySteps'],
        });
      }
      if (entryStepOwnership.has(entryStepId)) {
        issues.push({
          code: 'decision_branch_entry_collision',
          stepId: step.id,
          message: `Entry step '${entryStepId}' is claimed by both '${
            entryStepOwnership.get(entryStepId)
          }' and '${branch.id}'`,
          path: ['branches', branch.id, 'entrySteps'],
        });
      } else {
        entryStepOwnership.set(entryStepId, branch.id);
      }
    }
  }

  // extraOutputSchema base field collision
  if (step.extraOutputSchema !== undefined) {
    const extraFields = extractTopLevelPropertyNames(step.extraOutputSchema);
    const baseFields = new Set(['chosenBranchId', 'rationale', 'confidence']);
    for (const field of extraFields) {
      if (baseFields.has(field)) {
        issues.push({
          code: 'decision_extra_schema_collision',
          stepId: step.id,
          message: `extraOutputSchema cannot redeclare base field '${field}'`,
          path: ['extraOutputSchema', field],
        });
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

function extractTopLevelPropertyNames(schema: unknown): readonly string[] {
  if (typeof schema !== 'object' || schema === null) return [];
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  if (typeof props !== 'object' || props === null) return [];
  return Object.keys(props);
}
```

### 24.5 `renderBranchesTable`

```typescript
import type { AgentDecisionBranch } from '../../../shared/playbook/agentDecisionTypes.js';

/**
 * Render the branches as a markdown bullet list for inclusion in the envelope.
 * Pure, deterministic.
 */
export function renderBranchesTable(
  branches: readonly AgentDecisionBranch[],
): string {
  return branches
    .map((b) =>
      `- **id:** \`${escapeMarkdownInline(b.id)}\`\n` +
      `  **label:** ${escapeMarkdownInline(b.label)}\n` +
      `  **description:** ${escapeMarkdownInline(b.description)}`
    )
    .join('\n\n');
}

/**
 * Escape inline markdown-breaking characters. This is not a full sanitiser —
 * it protects against accidental formatting breaks, not against deliberately
 * malicious input. Authors are trusted (see §22.2).
 */
function escapeMarkdownInline(s: string): string {
  return s
    .replace(/```/g, '``\u200b`') // zero-width joiner between backticks
    .replace(/^## /gm, '\\## ');  // escape level-2 headings
}
```

### 24.6 Complexity summary

| Function | Complexity | Notes |
|----------|------------|-------|
| `computeSkipSet` | O(V + E) | Single forward BFS + occlusion check. V ≤ playbook step count (≤50 typical), E ≤ dependency edge count (≤200 typical). |
| `computeStepReadiness` | O(k) where k = dependsOn count | Single-step read. Called per step per tick. |
| `parseDecisionOutput` | O(raw.length + branches.length) | JSON parse dominates. |
| `validateDecisionStep` | O(V × B) where B = branches count | Validator walks the full step list once per branch. Acceptable because it runs at publish time, not per tick. |
| `renderBranchesTable` | O(B × avg description length) | Pure string concatenation. |

All functions are < 1ms for any realistic input. None requires memoisation in phase 1.

---

## 25. Database migration (SQL)

Two migrations land together in a single sprint. Numbering assumes the next free migration numbers are `0091` and `0092` as of this spec. Reconcile against the actual next free number in `migrations/` before committing.

### 25.1 `0091_playbook_decision_run_type.sql`

```sql
-- Migration: add 'playbook_decision' to the agent_runs run_type enum
--
-- Adds a new run_type enum value for decision agent runs. Decision runs
-- differ from 'playbook_step' (agent_call) runs in that they dispatch
-- with an empty tool allowlist and their output is parsed as a structured
-- decision rather than as a generic agent output.
--
-- Forward-only. No data migration needed — existing rows are unaffected.

BEGIN;

-- PostgreSQL cannot add enum values inside a transaction that also uses
-- them, so we add the value first and let any dependent DDL run in a
-- later transaction. This migration contains only the enum change.
ALTER TYPE agent_run_type ADD VALUE IF NOT EXISTS 'playbook_decision';

COMMIT;
```

Down migration (`0091_playbook_decision_run_type.down.sql`):

```sql
-- Down: removing an enum value in Postgres requires rebuilding the type,
-- which is a much bigger operation than the forward migration.
-- Phase 1 leaves this as a no-op and relies on the forward-only runner.
-- If this must be reverted in a local dev environment, use:
--
-- BEGIN;
--   CREATE TYPE agent_run_type_new AS ENUM (...existing values without 'playbook_decision'...);
--   ALTER TABLE agent_runs ALTER COLUMN run_type TYPE agent_run_type_new
--     USING run_type::text::agent_run_type_new;
--   DROP TYPE agent_run_type;
--   ALTER TYPE agent_run_type_new RENAME TO agent_run_type;
-- COMMIT;
--
-- Do NOT run this against a database that has live 'playbook_decision' rows.

SELECT 1;
```

### 25.2 `0092_playbook_decision_metadata.sql`

```sql
-- Migration: add optional decision-specific columns to agent_runs and
-- playbook_step_runs for observability and replay correctness.
--
-- agent_runs gains:
--   - decision_parent_step_run_id: links the decision agent run back to its
--     playbook step run (redundant with playbook_step_run_id but typed,
--     indexed, and constrained).
--
-- playbook_step_runs gains no new columns — the DecisionStepRunOutput shape
-- fits inside the existing outputJson column.
--
-- Indexes added to support the observability queries:
--   - partial index on agent_runs (decision_parent_step_run_id)
--     WHERE run_type = 'playbook_decision' — keeps the index small.

BEGIN;

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS decision_parent_step_run_id uuid
    REFERENCES playbook_step_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_decision_parent_step_run_id
  ON agent_runs (decision_parent_step_run_id)
  WHERE run_type = 'playbook_decision';

-- RLS: inherit from the existing agent_runs policy, which already filters
-- by organisation_id. No policy change needed because the new column is
-- a reference, not a tenant discriminator.

COMMIT;
```

Down migration (`0092_playbook_decision_metadata.down.sql`):

```sql
BEGIN;

DROP INDEX IF EXISTS idx_agent_runs_decision_parent_step_run_id;

ALTER TABLE agent_runs
  DROP COLUMN IF EXISTS decision_parent_step_run_id;

COMMIT;
```

### 25.3 Migration ordering and runner notes

- Migration `0091` runs before `0092`. The forward-only runner (`scripts/migrate.ts`) applies them in filename order, so the numeric prefix guarantees ordering.
- Both migrations are idempotent (`IF NOT EXISTS` everywhere) so re-running them is safe.
- Neither migration touches RLS policies. The new enum value `playbook_decision` is subject to the existing `agent_runs` RLS policy, which filters on `organisation_id = current_setting('app.organisation_id')`.
- No data migration. Existing playbooks without decision steps are unchanged; new playbooks that include decision steps take effect only after the template version is republished.

### 25.4 `FailureReason` enum additions

The failure reasons listed in §21 must be added to `shared/iee/failureReason.ts` in the same commit as the feature code. The enum is a closed TypeScript type plus a Zod schema; both need updating.

```typescript
// shared/iee/failureReason.ts (diff)

export const FAILURE_REASONS = [
  // ... existing values ...
  'decision_parse_failure',
  'decision_unknown_branch',
  'decision_extra_schema_violation',
  'decision_tool_call_blocked',
  'decision_budget_exceeded',
  'decision_agent_run_failed',
  'decision_step_timeout',
  'decision_replay_snapshot_missing',
  'decision_reviewer_rejected',
  'decision_cancelled',
  'decision_invalid_edit',
  'decision_skip_set_collision',
] as const;
```

The `verify-failure-reason-closed-enum.sh` CI gate will catch any code path that tries to emit a reason not in this list.

### 25.5 New config constants

`server/config/limits.ts` gains:

```typescript
export const MAX_DECISION_RETRIES = 3;
export const DEFAULT_DECISION_STEP_TIMEOUT_SECONDS = 60;
export const MAX_DECISION_BRANCHES_PER_STEP = 8;
export const DECISION_RETRY_RAW_OUTPUT_TRUNCATE_CHARS = 1000;
```

All four are used by the engine and the pure helper. None is tenant-configurable in phase 1.

---

## 26. Implementation phasing plan

Implementing this feature as a single-PR big-bang is risky — too many touchpoints across engine, services, client, tests, and seed data. The work should be sliced into four discrete PRs, each independently reviewable and each leaving the system in a working state. No slice depends on future slices being ready.

### 26.1 Slice 1 — Types, schemas, pure helper, tests

**Goal:** land all the pure, side-effect-free code with 100% test coverage. Nothing behavioural changes in the running system.

**Deliverables:**

- `shared/playbook/agentDecisionTypes.ts` — type definitions (§16)
- `server/lib/playbook/agentDecisionSchemas.ts` — Zod schemas (§16.2)
- `server/lib/playbook/agentDecisionPureTypes.ts` — helper types (§16.3)
- `server/lib/playbook/agentDecisionPure.ts` — full pure helper (§24)
- `server/lib/playbook/__tests__/agentDecisionPure.test.ts` — comprehensive unit tests (§14)
- `server/config/limits.ts` — new constants (§25.5)
- `shared/iee/failureReason.ts` — new enum members (§25.4)
- `docs/playbook-agent-decision-step-spec.md` — this spec (already shipped)

**Acceptance for slice 1:**
- All unit tests pass.
- `verify-failure-reason-closed-enum.sh` passes with the new enum members.
- `verify-pure-helper-convention.sh` passes for `agentDecisionPure.ts` (no impure imports).
- `npm run typecheck` passes across the whole monorepo.
- No engine, route, or client changes yet.

**Risk:** very low. Pure code, no runtime behaviour change. Can be merged and left dormant while slice 2 is in progress.

### 26.2 Slice 2 — Template validator, renderer, Studio tooling

**Goal:** authors can declare `agent_decision` steps in template JSON and publish them without errors. Runs that encounter decision steps still fail (engine doesn't know about them yet) — but publish and studio flows work.

**Deliverables:**

- `server/lib/playbook/definePlaybook.ts` — extend the `PlaybookStep` discriminated union.
- `server/lib/playbook/validator.ts` — call `validateDecisionStep` for each decision step.
- `server/lib/playbook/renderer.ts` — render decision steps in generated `.playbook.ts` files.
- `server/services/playbookTemplateService.ts` — accept decision steps in the publish path.
- `server/routes/playbookTemplates.ts` — Zod body validators extended (§19.2).
- `server/services/playbookStudioService.ts` — `validate`, `simulate`, `estimate`, `render` tools handle decision steps.
- Test fixture: a reference playbook `server/playbooks/__tests__/fixtures/decision-reference.playbook.ts` used by slice 3 and 4.
- `scripts/verify-playbook-decision-shape.sh` — CI gate on seeded playbooks.

**Acceptance for slice 2:**
- A published template containing a well-formed decision step round-trips through publish → read → render without error.
- A malformed decision step (each failure case in §9) is rejected at publish time with the correct code.
- `playbook_validate` Studio tool returns the new `DecisionValidationCode` values.
- `playbook_simulate` produces a simulated decision output using lexical branch order.
- `playbook_estimate_cost` includes decision cost in its per-step breakdown.
- Running a playbook with a decision step still fails at runtime (expected) with a clear message: "decision step execution not yet implemented."

**Risk:** low. No engine changes. The worst-case regression is a publish-path bug, caught by unit tests.

### 26.3 Slice 3 — Engine execution, middleware wiring, observability

**Goal:** decision steps actually run end-to-end in `auto` mode. Supervised mode and replay mode are stubbed (existing behaviour).

**Deliverables:**

- `migrations/0091_playbook_decision_run_type.sql` + `.down.sql`
- `migrations/0092_playbook_decision_metadata.sql` + `.down.sql`
- `server/db/schema/agentRuns.ts` — add `'playbook_decision'` to the enum and the new `decision_parent_step_run_id` column.
- `server/services/playbookEngineService.ts` — dispatch and completion branches for `agent_decision` (§6).
- `server/services/playbookAgentRunHook.ts` — route `runType: 'playbook_decision'` completions through `handleDecisionStepCompletion`.
- `server/prompts/playbook/agent-decision-envelope.md` — verbatim template (§17.2).
- `server/prompts/playbook/renderAgentDecisionEnvelope.ts` — envelope renderer.
- `server/services/middleware/topicFilterMiddleware.ts` — `mutateActiveToolsForDecisionRun` helper.
- `server/services/middleware/agentExecutionRunTypeGuard.ts` — or wherever the `runType === 'playbook_decision'` tool guard lives; belt-and-braces layer 4 enforcement (§18.2).
- Metrics wiring for every metric in §§10, 21, 23.
- Audit event wiring for every state transition (§15 invariant 13).
- Integration test: `server/services/__tests__/playbookEngine.decision.test.ts` — happy path + confidence-escape + fallback + replay (§14).

**Acceptance for slice 3:**
- A decision step in `auto` mode dispatches, validates its output, applies the skip set, and the run continues along the chosen branch.
- Downstream steps in non-chosen branches are marked `skipped` in the DB.
- Convergence steps with at least one live ancestor still run correctly.
- The confidence-escape path triggers a review item when the agent emits below-threshold confidence.
- The fallback path applies `defaultBranchId` after `MAX_DECISION_RETRIES` failures.
- Replay mode replays a recorded decision from snapshot without invoking the LLM.
- All metrics and audit events fire as specified.
- `verify-rls-contract-compliance.sh` passes (all new DB access paths use `withOrgTx`).
- No change to existing playbooks (backward compatibility check).

**Risk:** medium. This is the core engine change. Heavy integration test coverage is the mitigation. Ship behind a feature flag if any concern about regression risk on existing `agent_call` / `approval` step flows.

### 26.4 Slice 4 — Client UI, supervised-mode review, mid-run editing

**Goal:** human reviewers can see, approve, reject, and edit decision steps. The feature is end-user-visible and supervised mode is fully functional.

**Deliverables:**

- `client/src/pages/PlaybookRunDetailPage.tsx` — decision step card variant with chosen branch, rationale, confidence, skipped-branch list, agent reasoning link.
- `client/src/components/playbook/DecisionStepCard.tsx` — new component.
- `client/src/components/playbook/DecisionApprovalPanel.tsx` — supervised-mode review UI with edit-before-approve.
- `client/src/lib/api.ts` — helpers for the decision edit and approve endpoints.
- `client/src/components/Inbox.tsx` (or equivalent) — show decision review items with "needs branch selection" framing.
- Visual regression / snapshot tests for the decision card variants — manual screenshots only for phase 1 per the existing client testing posture.
- `server/routes/playbookRuns.ts` — extend `/output` edit and `/approve` endpoints to validate decision edits (§19.2).
- Regression capture integration — decision reviewer edits flow into `regression_cases` (§15 invariant 12).
- Documentation update to `architecture.md` under the Playbooks section (per `CLAUDE.md` rule about keeping docs in sync).

**Acceptance for slice 4:**
- Reviewer in supervised mode sees a decision step, can approve as-is, edit the branch and approve, or reject.
- An edit in the approval flow produces the same state as a post-hoc mid-run edit (single code path).
- Regression capture fires on every reviewer override.
- Visual inspection confirms the decision card is clear about which branch was chosen, which were skipped, and why.
- `architecture.md` contains the new Playbooks subsection describing decision steps.

**Risk:** low-medium. Client changes are bounded; the state machine is already tested server-side.

### 26.5 Total engineering estimate

Phased estimates (senior engineer, familiar with the codebase):

| Slice | Estimate (working days) |
|-------|------------------------|
| 1 — Types, schemas, pure helper, tests | 1.5 |
| 2 — Template validator, renderer, Studio tooling | 1.5 |
| 3 — Engine execution, middleware, observability | 2.5 |
| 4 — Client UI, supervised mode, editing | 2 |
| **Total** | **7.5 days** |

Engineering contingency: +2 days for integration surprises (realistic for feature work touching the engine, middleware, and DB simultaneously). Total realistic: **9–10 days**.

### 26.6 What happens if a slice is blocked

- **Slice 1 blocked:** unlikely. Pure code, no external dependencies. If blocked, unblock by simplifying the pure helper signature — nothing downstream depends on internal helper details.
- **Slice 2 blocked:** the validator changes are the most likely sticking point. If a validation case turns out to be ambiguous, resolve by writing a failing test first and letting the test drive the resolution.
- **Slice 3 blocked:** the highest risk of blockage is in the engine's skip-set cascade or the completion-hook routing. If blocked, split slice 3 into 3a (happy path only, no confidence-escape, no replay) and 3b (escape + replay). 3a is shippable on its own.
- **Slice 4 blocked:** ship 3 without 4 in auto mode only. Supervised mode is a feature delta, not a regression.

### 26.7 Feature flag guidance

The project's `docs/spec-context.md` says feature flags are `only_for_behaviour_modes`. A new step type is a behaviour mode, so a feature flag is appropriate here. Proposed flag:

```typescript
export const ENABLE_PLAYBOOK_AGENT_DECISION_STEP = process.env.ENABLE_PLAYBOOK_AGENT_DECISION_STEP === 'true';
```

- **At the validator:** if the flag is off, reject decision steps at publish time with a clear error.
- **At the engine dispatcher:** if the flag is off, a decision step in an already-published template fails immediately with `decision_feature_disabled`.
- **At the client:** if the flag is off, decision step cards render as a "not enabled" placeholder with a link to the feature toggle.

Default OFF until slice 3 is merged and at least one internal dogfood playbook has run end-to-end. Flip ON once green. Remove the flag entirely after one sprint of green running.

---

## 27. Acceptance criteria / definition of done

The feature is "done" when every criterion below is satisfied. This is the checklist the implementing engineer brings to PR review and the reviewer uses to sign off. Nothing is left to interpretation.

### 27.1 Functional acceptance

- [ ] A well-formed `agent_decision` step with 2, 3, or 8 branches can be authored, published, and executed in a running playbook.
- [ ] A malformed decision step (each failure case in §9) is rejected at publish time with the correct `DecisionValidationCode`.
- [ ] An author cannot publish a template with a decision step whose entry steps don't declare the decision in their `dependsOn`.
- [ ] An author cannot publish a template with a decision step whose `sideEffectType` is anything other than `'none'`.
- [ ] An author cannot publish a template with a decision step whose `defaultBranchId` references a nonexistent branch.
- [ ] In `auto` mode, a valid decision dispatches one LLM call, applies the correct skip set on completion, and allows the run to continue.
- [ ] In `auto` mode, the chosen branch's entry steps transition from `pending` to `running` on the next tick after the decision completes.
- [ ] In `auto` mode, non-chosen branches' entry steps (and their transitive descendants with no live ancestors) transition from `pending` to `skipped`.
- [ ] Convergence steps with at least one live ancestor continue to run normally; the new "all dependsOn terminal + at least one completed" readiness rule works.
- [ ] In `supervised` mode, a decision creates a review item, pauses execution, and resumes only after reviewer approval.
- [ ] In `supervised` mode, a reviewer can edit the `chosenBranchId` before approving; the engine recomputes the skip set against the edited value.
- [ ] In `supervised` mode, a reviewer's rejection fails the step with `decision_reviewer_rejected`.
- [ ] In `replay` mode, a decision replays from snapshot without invoking the LLM.
- [ ] In `replay` mode, a decision step with no matching snapshot fails with `decision_replay_snapshot_missing`.
- [ ] A decision with `minConfidence` set and an agent output below the threshold escalates via confidence-escape and routes to HITL.
- [ ] A decision whose agent output fails parsing or validation retries up to `MAX_DECISION_RETRIES` with the retry envelope populated.
- [ ] A decision that exhausts retries falls back to `defaultBranchId` if set, marking the step output with `chosenByAgent: false`.
- [ ] A decision that exhausts retries and has no `defaultBranchId` fails the run with the correct failure reason.
- [ ] A decision agent's attempt to call a tool is blocked at the agent execution service with `decision_tool_call_blocked`.
- [ ] A mid-run edit to a completed decision recomputes the skip set and triggers the standard invalidation cascade, including output-hash firewall short-circuit.
- [ ] Two decision steps in the same tick (neither depends on the other) dispatch in parallel.
- [ ] A nested decision step inside a branch of another decision step works correctly.

### 27.2 Test acceptance

- [ ] Every pure helper function (§24) has a test covering at least: happy path, each failure mode, and at least one edge case (empty input, max input, boundary condition).
- [ ] `agentDecisionPure.test.ts` has at least 30 test cases covering the scenarios listed in §14.1.
- [ ] `playbookEngine.decision.test.ts` has end-to-end tests covering: auto happy path, supervised approve, supervised edit, supervised reject, confidence-escape, fallback, replay, retry-exhausted, tool-call-blocked.
- [ ] `npm run test:unit` passes.
- [ ] `npm run test:gates` passes (all 34+ static gates green, including the new `verify-playbook-decision-shape.sh` and `verify-playbook-decision-envelope.sh`).
- [ ] `npm run typecheck` passes across the monorepo.
- [ ] `npm run lint` passes.

### 27.3 Observability acceptance

- [ ] Every metric listed in §§10, 21, 23 is emitted and visible via the existing telemetry pipeline.
- [ ] Every audit event listed in §10 and §21.4 is written to `auditEvents`.
- [ ] Every WebSocket event listed in §19.3 is emitted on the correct room.
- [ ] A decision step's agent run is linked from the Playbook Run Detail page via the existing run trace viewer.
- [ ] A supervised-mode reviewer override is captured in `regression_cases` with the original and edited branch ids.

### 27.4 Security acceptance

- [ ] Every mitigation listed in §22.2 is implemented.
- [ ] Every invariant listed in §22.3 has a corresponding code path and at least one unit test.
- [ ] `verify-rls-contract-compliance.sh` passes — all new DB access paths use `withOrgTx`.
- [ ] The envelope renderer correctly escapes triple-backticks and `## ` headings in user-supplied strings (unit-tested).
- [ ] The retry envelope's `rawOutput` is fenced as literal text, not markdown (unit-tested).
- [ ] The mid-run edit endpoint rejects invalid `chosenBranchId` values before applying any state change (unit-tested via the engine integration tests).

### 27.5 Performance acceptance

- [ ] A decision step's happy-path end-to-end latency is under 4 seconds at the 95th percentile against the project's default model tier.
- [ ] `computeSkipSet` runs in under 1ms on a DAG with 50 steps and 200 edges (unit-tested with a benchmark assertion).
- [ ] A playbook run with 5 decision steps in parallel does not exhaust the existing parallel-dispatch budget.
- [ ] No performance regression in existing playbooks that do not use decision steps — measured by running the existing playbook smoke tests and confirming no latency change in the 95th percentile.

### 27.6 Documentation acceptance

- [ ] `architecture.md` has a new subsection under Playbooks describing the `agent_decision` step type with a one-paragraph summary and a link to this spec.
- [ ] The seeded `server/playbooks/event-creation.playbook.ts` (or a new reference playbook) contains at least one `agent_decision` step as an end-to-end example.
- [ ] `docs/improvements-roadmap.md` has the decision step work marked complete with a commit reference.
- [ ] Any `architecture.md` references to Playbook step types now include `agent_decision` in the enumeration.
- [ ] The Playbook Studio chat agent's system prompt has been updated to know about the new step type so it can author decision steps in response to user requests.

### 27.7 Review sign-off

- [ ] `pr-reviewer` agent has reviewed the PR and surfaced no blocking issues.
- [ ] `dual-reviewer` agent has run and Codex is satisfied with the implementation.
- [ ] At least one human reviewer other than the implementer has approved the PR.
- [ ] The feature flag `ENABLE_PLAYBOOK_AGENT_DECISION_STEP` is OFF in production and ON in at least one staging / dogfood environment.
- [ ] At least one dogfood playbook has run end-to-end with a decision step in each of `auto` and `supervised` modes.

### 27.8 Post-merge follow-ups (tracked, not blocking)

- [ ] First-week observability review: check that `playbook.decision.retry_count` p95 ≤ 1. If not, inspect the envelope and the failing runs.
- [ ] First-week observability review: check that `playbook.decision.parse_failure_rate` per template ≤ 5%. If higher for any template, open a spec issue.
- [ ] After first-month dogfood: if no regression issues surfaced, remove the feature flag entirely.
- [ ] Phase 2 design brief for: multi-select branches, decision steps with narrow read-only tool access, decision chains.

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

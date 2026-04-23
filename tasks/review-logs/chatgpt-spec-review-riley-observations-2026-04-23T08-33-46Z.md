# ChatGPT Spec Review Session — riley-observations — 2026-04-23T08-33-46Z

## Session Info
- Spec: `docs/riley-observations-dev-spec.md`
- Branch: `claude/analyze-automation-insights-GCoq3`
- PR: #179 — https://github.com/michaelhazza/automation-v1/pull/179
- Started: 2026-04-23T08:33:46Z

---

## Round 1 — 2026-04-23T08-33-46Z

### ChatGPT Feedback (raw)

Executive Summary

This is a strong, well-reasoned spec. The separation between Workflows and Automations is architecturally sound and future-proof. The composition model is the right call.

The only real gap is not in the model, but in enforcement and UX contract clarity. Without tightening a few rules, you risk drift, duplication, and the exact confusion you're trying to avoid.

What's Working Well

1. Clear separation of execution models (Automations = external black box; Workflows = internal glass box).
2. Composition model is correct (Workflows orchestrate, Automations are invoked inside them).
3. Avoided premature unification.

Gaps That Will Cause Problems Later

1. Missing hard boundary: "Where logic is allowed to live" — Automations must not contain business logic that affects control flow. All control flow must exist at the Workflow layer.
2. No capability contract for Automations — input schema, output schema, side-effect guarantees, idempotency expectations.
3. No failure semantics between Workflow ↔ Automation — failure types, retry policy ownership (Workflow only), required error surface.
4. Observability gap across boundary — what visibility is guaranteed when a Workflow calls an Automation: execution status, duration, error payload, optional logs. Standardise the surface.
5. No lifecycle ownership clarity — versioning, updates, breaking changes; versioned Automations, immutable execution versions, opt-in upgrade paths.
6. UX contract is implied, not defined — "Workflows are the primary user construct. Automations are supporting capabilities and are not presented as alternative solutions to workflows."

Strategic Improvements

1. Introduce "Capability Layer" framing — internally: Automations = capabilities, Workflows = orchestration.
2. Enforce "derive, don't duplicate" — Workflows reference Automations, do not copy logic/config.
3. Add composition constraints — max nesting depth (Workflow → Automation → external only); no recursive Workflow calls (unless explicitly designed later).
4. Future-proofing for marketplace / partner-provided capabilities / BYO execution engines — requires strict contracts, versioning, isolation.

Final Verdict: Architecture strong, scalable, correct. Missing: hard rules around logic placement, automation contract definition, failure + retry semantics, observability guarantees, UX enforcement.

### Recommendations and Decisions

| # | Finding | Recommendation | User Decision | Severity | Rationale |
|---|---|---|---|---|---|
| 1 | Hard boundary — logic placement (Automations must not contain control flow; control flow lives at Workflow layer) | apply | apply | high | Durable architectural rule; prevents the "black box with hidden logic" failure mode; cheap to state now. |
| 2 | Capability contract for Automations — input schema, output schema, side-effects, idempotency | apply (partial — side-effects + idempotency at Automation level; input/output schema already covered by §5.4/§5.5) | apply (partial — side-effects + idempotency at Automation level) | high | Input/output schema already pinned in §5.4/§5.5; the real gap is side-effect classification and idempotency expectation. Add those as capability-contract columns. |
| 3 | Failure semantics between Workflow ↔ Automation (failure types, retry policy ownership, error surface) | reject | reject | medium | §5.7 already defines error codes and §5.8 covers pre-dispatch rejection; retry ownership is stated. Scope expansion with no concrete gap. |
| 4 | Observability gap across boundary (standardised surface for exec status, duration, error payload, logs) | reject | reject | medium | §5.9 + §9a Contracts table already define the dispatched/completed events with every terminal status enumerated. No actionable gap. |
| 5 | Lifecycle ownership clarity — versioning, updates, breaking changes; immutable execution versions, opt-in upgrades | defer | defer | medium | Valid but out of scope for v1 (pre-launch, no live consumers, §2). Pairs with item 10 in Deferred Items. |
| 6 | UX contract — Workflows are the primary user construct; Automations are supporting capabilities, not presented as alternatives | apply | apply | high | Product positioning rule; prevents future UI drift where Automations get elevated to workflow-equivalents. §3a already pushes this direction but it needs to be explicitly stated. |
| 7 | Introduce "Capability Layer" framing internally | reject | reject | low | Stylistic preference — reframing in terminology already captured by §1.5 principle 1. Additional abstraction adds no clarity. |
| 8 | Enforce "derive, don't duplicate" — Workflows reference Automations, don't copy logic/config | apply (minimal — one-line principle) | apply (minimal — one-line principle) | medium | Natural extension of the reference-by-ID model; one line to prevent future "embed the config into the workflow" anti-patterns. |
| 9 | Composition constraints — max nesting depth, no recursive Workflow calls (unless explicitly designed later) | apply | apply | high | Real forward-compatibility concern; cheap to state as hard rules now (§5.10 edge 4 already hints at this; promote to first-class constraints). |
| 10 | Future-proofing for marketplace / partner-provided capabilities / BYO execution engines | defer | defer | medium | Valid but correctly out of scope for v1 pre-launch posture. Pairs with item 5. |

### Applied (only items the user approved as "apply")

- **§1.5 Architectural principles (new).** Added binding architectural principles for every Part: (1) capability-layer boundary — control flow lives at Workflow layer, Automations are leaf external calls; (2) derive, don't duplicate — Workflows reference Automations by ID; (3) Workflows are the primary user construct, Automations are supporting capabilities (UX-contract rule). Covers items 1, 6, 8.
- **§5.2 Scope.** Added "Automation capability-contract fields (§5.4a)" and "Composition constraints (§5.10a)" to the in-scope list.
- **§5.3 InvokeAutomationStep.** Updated inline comments on `retryPolicy` and `gateLevel` so the declared defaults align with §5.4a (driven by `side_effects` / `idempotent`), not a fixed `'review'` / Workflow-default.
- **§5.4a Automation capability contract (new).** Added `automations.side_effects` (`read_only | mutating | unknown`, default `unknown`) and `automations.idempotent` (bool, default `false`) columns (introduced by migration `0203` as part of the rename). Defined gate-resolution defaults, Explore-Mode override semantics, retry posture, and the distinction between Automation `side_effects` and skill `side_effects`. Covers item 2 (partial scope).
- **§5.6 HITL gate semantics.** Reconciled with §5.4a — default is driven by `side_effects`, not a blanket `'review'`.
- **§5.7 Error propagation.** Retry bullet now references `idempotent` gating per §5.4a rule 3.
- **§5.9 Telemetry status enum.** Added `automation_composition_invalid` terminal status for §5.10a rule 4 (dispatch-time composition violation). Noted that `workflow_composition_invalid` is authoring-time only and never reaches the telemetry path.
- **§5.10a Composition constraints (new).** Max composition depth = 1; no recursive Workflow calls (no `invoke_workflow` step type in v1); no callback-based composition; dispatcher defence-in-depth rule (one step → one webhook). Two new error codes: `workflow_composition_invalid` (authoring-time) and `automation_composition_invalid` (dispatch-time). Covers item 9.
- **§9a Contracts table.** Updated `workflow.step.automation.completed` row to note the `automation_composition_invalid` status and the authoring-time-only posture of `workflow_composition_invalid`. Added a new row for the `automations.side_effects` / `automations.idempotent` capability-contract columns.
- **§9b Deferred Items.** Added single cross-cutting entry covering items 5 + 10: "Automation + Workflow versioning and marketplace-readiness" — notes that §5.10a's composition constraints are the forward-compatible foundation and re-evaluation triggers.

### Rejected

- Item 3 (failure semantics) — already covered by §5.7 + §5.8.
- Item 4 (observability standardisation) — already covered by §5.9 + §9a.
- Item 7 (Capability Layer framing) — stylistic duplication of §1.5 principle 1.

### Deferred

Items 5 and 10 folded into a single §9b entry ("Automation + Workflow versioning and marketplace-readiness"). Will promote to `tasks/todo.md` at session finalization.

### Integrity check

1 issue found this round:
- **Contradiction between §5.6 default (`'review'` for any `invoke_automation`) and §5.4a default (driven by `side_effects` class).** Mechanically reconciled by updating §5.6 to derive the default from `side_effects` (matching §5.4a rule 1), and aligning §5.3 inline comments + §5.7 retry bullet to the same contract.

Post-integrity sanity: all forward references resolve (§1.5 → §3a, §5.4a → §5.6/§6.2/§6.4/§6.5, §5.10a → §1.5/§5.2/§5.7/§9b, §9b marketplace → §2/§1.5/§5.4a/§5.10a). No sections left empty. No broken heading links.

Top themes: architectural principles / capability contract / composition constraints / defer marketplace-readiness.

---

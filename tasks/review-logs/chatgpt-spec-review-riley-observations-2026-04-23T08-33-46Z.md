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

## Round 2 — 2026-04-23T08-55-59Z

### ChatGPT Feedback (parsed)

Six findings raised in round 2, framed via the user's per-item decisions (user message conveys the complete finding set):

1. `automations.deterministic` flag — declare whether the Automation is a pure function of its inputs. (Relates to future caching / memoisation.)
2. Tighten §5.4a rule 3 + §5.7 to **name** the engine-enforced retry behaviour on `idempotent`, with explicit `retryPolicy.overrideNonIdempotentGuard: true` opt-in for authors who know what they're doing.
3. `automations.expected_duration_class` flag — declare typical latency band for queue prioritisation / SLA routing.
4. Standardised error shape `{ code, type, message, retryable }` with `type` enum `'validation' | 'execution' | 'timeout' | 'external'`, mapping existing `status` values to `type` buckets; extend §5.7 + §5.9 + §9a.
5. §5.10a — one-line additive clause stating that future relaxation of rules 1–3 requires an orchestration-model upgrade spec, not in-place edits.
6. §5.4a enum work — (a) add one-line definitions for each existing enum value (`read_only` / `mutating` / `unknown`); (b) extend the enum with an `irreversible` class.

### Recommendations and Decisions

| # | Finding | Recommendation | User Decision | Severity | Rationale |
|---|---|---|---|---|---|
| 1 | `automations.deterministic` flag | defer | defer | medium | Valid but no v1 subsystem keys on it; reconsider when response caching / memoisation lands. Fold into §9b cross-cutting entry. |
| 2 | Engine-enforced non-idempotent retry guard + explicit `overrideNonIdempotentGuard` opt-in | apply | apply | high | Round 1 left enforcement ambiguous ("the dispatcher does not auto-retry ... unless the author has explicitly overridden"); round 2 pins the mechanism, names it, and defines the override field. Clear contract for both author UI and dispatcher. |
| 3 | `automations.expected_duration_class` flag | defer | defer | medium | No queue-prioritisation layer in v1; per-row `timeout_ms` override is the related concern already in §9b Workflow-composition deferrals. Reconsider with queue prio / SLA routing. |
| 4 | Standardised error shape `{ code, type, message, retryable }` with `type` enum | apply | apply | high | Real gap — error handlers currently pattern-match on string codes only. A bucketed `type` enables coarse dashboards + error-handler branches without enumerating every code. Extends §5.7 (code→type mapping), §5.9 (event.error field), §9a (new `AutomationStepError` row). |
| 5 | §5.10a future-relaxation clause | apply | apply | medium | Prevents silent rule-erosion across future specs; explicit "rules 1–3 are not edited in place" preserves historical record of the v1 constraint posture. |
| 6a | Definitions for each §5.4a enum value (`read_only` / `mutating` / `unknown`) | apply | apply | medium | Cheap clarity — operators auditing Automations need unambiguous definitions; round 1 only named the enum values, not what they mean. |
| 6b | Add `irreversible` as third side-effects enum value | defer | defer | medium | Not needed while Execute Mode keeps `mutating` = review by default; reconsider if auto-gate-bypass posture changes post-launch. Fold into §9b cross-cutting entry. |

### Applied (only items the user approved as "apply")

- **§5.4a rule 3 — engine-enforced non-idempotent retry guard.** Tightened to name the mechanism explicitly, state that dispatcher enforcement overrides authored `retryPolicy`, and define the `retryPolicy.overrideNonIdempotentGuard: true` opt-in (logged on step record, second-tier authoring-time warning). Covers item 2.
- **§5.7 Error propagation — full rewrite.** Added the standardised `AutomationStepError` TypeScript interface with `{ code, type, message, retryable }`. Added the `type`-bucket mapping table (`validation` / `execution` / `timeout` / `external`) with rationale for each bucket. Updated per-error-class behaviour to surface `code` + `type`. Updated the retry bullet to name the engine-enforced guard, cite the `retryable` field's derivation (`retryable: true` iff transient-class AND the guard doesn't apply OR has been overridden), and explicitly route the `AutomationStepError` to error-handler branches. Covers items 2 + 4.
- **§5.3 `InvokeAutomationStep` inline comment.** Updated the `retryPolicy?` comment to reference the engine-enforced guard and the `overrideNonIdempotentGuard` override field. Covers item 2.
- **§5.9 `workflow.step.automation.completed` event.** Added `error?: AutomationStepError` field to the event shape, present iff `status !== 'ok'`. Added inline mapping table showing the status↔code 1:1 correspondence (short-form vs full-qualified). Covers item 4.
- **§5.10a Composition constraints — future relaxation clause.** Appended a final paragraph stating that relaxation of rules 1–3 requires an orchestration-model upgrade spec and that rules 1–3 are not edited in place — a superseding section replaces them. Covers item 5.
- **§5.4a `side_effects` column definition.** Added one-line definitions for each enum value: `read_only` (reads, writes nothing), `mutating` (writes to systems of record, review required), `unknown` (undeclared; treated as `mutating` until reclassified). Covers item 6a.
- **§9a Contracts table.** Updated `workflow.step.automation.completed` row to note the new `error` field, the 1:1 status↔code mapping via §5.9, and added a new row for `AutomationStepError` with producer/consumer/nullability/example. Covers item 4.
- **§9b Deferred Items — cross-cutting entry extended.** Added a sub-bullet block "Capability-contract extensions — reconsider per trigger, not in v1" under the existing Automation-versioning / marketplace-readiness entry, covering all three deferred items with explicit re-evaluation triggers: `deterministic` (caching / memoisation), `expected_duration_class` (queue prioritisation / SLA routing, with cross-ref to existing per-row `timeout_ms` override), `irreversible` enum value (auto-gate-bypass posture change). Covers items 1, 3, 6b.

### Rejected

None this round.

### Deferred

Items 1, 3, 6b folded into the existing §9b cross-cutting entry "Automation + Workflow versioning and marketplace-readiness" as a sub-block with three bullets and explicit re-evaluation triggers. Will promote to `tasks/todo.md` at session finalization.

### Integrity check

1 issue found this round:

- **Naming mismatch between §5.9 `status` enum (short-form — `'http_error'`, `'timeout'`, `'network_error'`, `'input_validation_failed'`, `'output_validation_failed'`, `'missing_connection'`) and §5.7 error-code vocabulary (full-qualified — `'automation_http_error'`, `'automation_timeout'`, etc.).** The round-2 §9a edit initially claimed "`error.code` always corresponds to `status` (1:1)", but the literal strings differ. Mechanically reconciled by inlining an explicit status→code mapping table in the §5.9 `error?` field comment and updating the §9a row phrasing to cite "short-form telemetry label" vs "full §5.7 error-code string" with 1:1 per the inlined mapping. Pre-existing mismatch (predates round 2) — round 2 surfaced it by requiring a standardised error shape that named `code` explicitly.

Post-integrity sanity: all forward references resolve. §5.4a rule 3 (new override field) ↔ §5.3 comment ↔ §5.7 retry bullet ↔ §9a `InvokeAutomationStep` row — all consistent. §5.9 status enum ↔ §5.7 code enum ↔ §5.9 mapping table — all consistent. §5.10a future-relaxation clause has no back-references. §5.4a enum definitions ↔ gate-resolution rule ↔ §5.6 — consistent (`unknown` is treated as `mutating` for gate purposes in both the rule and the new enum definition). No sections left empty. No broken heading links.

Top themes: standardised error shape / engine-enforced retry guard / future-proofing composition / capability-contract definitions / three deferred capability-contract extensions.

---

## Round 3 — 2026-04-23T09-12-00Z

### ChatGPT Feedback (parsed — conveyed via user per-item decisions)

ChatGPT raised seven findings in round 3 framed as cross-cutting hardening items. User decision for the whole round: `all: as recommended` (all 7 items applied).

1. §1.5 — new principle 4: unknown-safe default (missing contract fields → most restrictive behaviour: no retry, require review, no composition).
2. §5.4a rule 3 — new clause: hard retry ceiling `maxAttempts ≤ 3` engine-enforced, not author-configurable above; cross-ref in §5.3 inline comment.
3. §5.7 bucketing table + `AutomationStepError` TypeScript type + §9a row — extend `type` enum with `'unknown'` + "no code maps here in v1" note + rule that unknown must not crash orchestration.
4. §5.10a — one-line consolidating statement at the top: composition constraints enforced at both authoring-time validation AND runtime execution guards.
5. §1.5 — new cross-cutting rule (principle 5): side_effects classification drives default UX behaviour and cannot be downgraded without explicit user action. Covers both Automation-level (§5.4a) and skill-level (§6.4).
6. §1.5 principle 2 — extend with "contract is source of truth" paragraph: Automation capability contract is authoritative; Workflow logic must not duplicate or override its values.
7. §5.9 `workflow.step.automation.completed` event — add `retry_attempt` field; matching row in §9a.

### Recommendations and Decisions

| # | Finding | Recommendation | User Decision | Severity | Rationale |
|---|---|---|---|---|---|
| 1 | §1.5 principle 4 — unknown-safe default | apply | apply | high | First-class rule locks down a pattern already implicit in §5.4a `unknown` → `'review'`; makes every subsystem derive the same posture from the same principle rather than re-deriving per section. |
| 2 | §5.4a rule 3 — hard retry ceiling `maxAttempts ≤ 3` engine-enforced | apply | apply | high | External-blast-radius protection; runaway retry loops against third-party webhooks are worse than a clean failure; 3 matches the defence-in-depth posture already established by §5.10a composition constraints. |
| 3 | §5.7 — `type: 'unknown'` + orchestration-safety contract | apply | apply | medium | Cheap additive safety-net bucket; pairs with principle 4; no v1 codes map to it but ensures a future unclassifiable failure surfaces cleanly rather than crashing the dispatcher. |
| 4 | §5.10a — consolidating statement at top: both authoring AND runtime enforcement | apply | apply | medium | Already true in the existing prose (rules 1–3 authoring-time, rule 4 dispatch-time) but not stated as a principle up-front; one-line hoist makes the enforcement surface obvious to spec readers. |
| 5 | §1.5 principle 5 — side_effects drives UX, no silent downgrades | apply | apply | high | Unifies §5.4a + §6.4 under a single cross-cutting rule; prevents future spec drift where mode-transitions silently change classification semantics. |
| 6 | §1.5 principle 2 — "contract is source of truth" paragraph | apply | apply | medium | Natural extension of the reference-by-ID rule; closes the "step-level override of contract values" authoring anti-pattern before it starts. |
| 7 | §5.9 — `retryAttempt` field on completed event | apply | apply | medium | Required for operators to reconstruct the attempt timeline under the new §5.4a rule 3 retry semantics; without it, the `(runId, stepId)` pivot is ambiguous when multiple events fire. |

### Applied (all 7 items — user approved the full round)

- **Pre-rate-limit (working-tree-only at resumption):** Items 1, 5, 6 were already applied in the working tree before the previous agent hit a rate limit — §1.5 principle 4 (unknown-safe default), principle 5 (side_effects drives UX, no silent downgrades), and the "Contract is the source of truth" paragraph extending principle 2. Kept as-is; no re-application.
- **§5.4a rule 3 — hard retry ceiling.** Extended rule 3 with the **engine-enforced `maxAttempts ≤ 3` hard ceiling** clause: dispatcher clamps any persisted `retryPolicy.maxAttempts > 3` to 3 at dispatch time, regardless of `idempotent` value or `overrideNonIdempotentGuard` setting; authoring-time validator surfaces a second-tier warning but does not block save (the clamp is the canonical enforcement); rationale cites external-blast-radius of runaway retries. Covers item 2.
- **§5.3 `InvokeAutomationStep` inline comment.** Extended the `retryPolicy?` comment with the `maxAttempts ≤ 3` cross-ref so authors reading the step-type definition see the ceiling at the authoring surface, not just in §5.4a. Covers item 2.
- **§5.7 `AutomationStepError` type — `type` enum extended to `'unknown'`.** Added `'unknown'` to the enum. Added a new row `| unknown | *(no codes map here in v1 — reserved bucket)* |` to the bucketing table. Added an **orchestration-safety contract** paragraph below the rationale: the dispatcher never deliberately emits `type: 'unknown'` in v1; the bucket exists for future / third-party / genuinely unclassifiable failures; any error surfacing with `type: 'unknown'` is treated as non-retryable, non-composable, and visible (still fires `completed` event) per §1.5 principle 4; engine invariant that dispatcher must always populate `type` with one of the five values. Covers item 3.
- **§5.10a — consolidating statement at top.** Added an **Enforcement surface** paragraph as the opener of §5.10a: composition constraints are enforced at both authoring-time validation (Workflow-definition validator on save) and runtime execution guards (step dispatcher at dispatch as defence-in-depth); neither surface is sufficient alone; runtime catches mutated / imported / race-condition / storage-corruption states that bypass the authoring UI. Covers item 4.
- **§5.9 `workflow.step.automation.completed` event — `retryAttempt` field.** Added `retryAttempt: number` as a **required** (non-optional) field: 1-indexed counter (1 = initial, 2 = first retry, 3 = final per §5.4a rule 3 hard ceiling); one event per attempt so a successful-on-second-try step produces two events; pre-dispatch failures always carry `retryAttempt: 1` because they are never retried; operator dashboards pivot on `(runId, stepId, retryAttempt)` to reconstruct the attempt timeline. Covers item 7.
- **§9a Contracts table — `AutomationStepError` row updated.** Extended the `type` enum mention to `{validation, execution, timeout, external, unknown}`; added inline note that no v1 codes map to `unknown` (reserved safety-net); added cross-ref to §1.5 principle 4 orchestration-safety contract; extended `retryable` advisory note to mention the hard `maxAttempts ≤ 3` ceiling. Covers item 3.
- **§9a Contracts table — `workflow.step.automation.completed` row updated.** Added `retryAttempt` field description (required; 1-indexed; 1 = initial, 2 = first retry, 3 = final per §5.4a rule 3 hard ceiling; one event per attempt; pre-dispatch failures always `retryAttempt: 1`). Updated both success and failure example fragments to show the field. Covers item 7.

### Rejected

None this round.

### Deferred

None this round.

### Integrity check

0 issues found this round. All three user-flagged risk areas verified clean:

- **(a) retry-ceiling clash.** `grep` over the spec for `maxAttempts | retry count | attempts [0-9]`: no pre-existing `maxAttempts` value above 3, no implicit or explicit retry-count contradicting the new ceiling. Clean.
- **(b) unknown-safe-default clash.** `grep` over the spec for "default …" rules on `auto | review | continue | retry`: every pre-existing default is already the most-restrictive option for its domain (`side_effects = 'unknown'` → `'review'`, missing skill `side_effects` frontmatter → `true`, etc.). The new principle 4 canonicalises a pattern that was already consistent across §5.4a, §5.6, and §6.4. No contradiction.
- **(c) new `type: 'unknown'` breaking existing status→code→type mapping.** The §5.9 `status` enum (10 terminal outcomes) and the §5.7 error-code vocab (10 codes) map 1:1 as before; every code in the §5.7 mapping table still lands in one of the four non-`unknown` buckets (`validation` / `execution` / `timeout` / `external`). The new `unknown` bucket has no v1 codes mapping to it by design — it is a reserved safety-net, not a new mapping row. The authoring-time-only posture of `workflow_composition_invalid` is preserved (still in `type: 'validation'` via §5.7 table, still annotated as authoring-time-only in §5.9 status-enum comment). No existing mapping edge broken.

Post-integrity sanity: all new cross-references resolve — §1.5 principle 4 → §5.4a rules 1 + 3, §5.7, §5.10a (all exist); §1.5 principle 5 → §5.4a, §6.4, §5.6, §6.5, §6.2 (all exist); §5.4a rule 3 hard ceiling → §5.3 comment (added) + §5.7 retry bullet (existing reference to rule 3 still valid); §5.7 `type: 'unknown'` bucket → §1.5 principle 4 (exists); §5.9 `retryAttempt` → §5.4a rule 3 hard ceiling (exists); §9a rows → all new fields/enums reflected. No sections left empty. No broken heading links. No section references to headings that were renamed this round (none were).

Top themes: unknown-safe default (principle 4) / hard retry ceiling (`maxAttempts ≤ 3`) / `type: 'unknown'` orchestration-safety bucket / composition-enforcement-surface hoist / side-effects-classification cross-cutting rule (principle 5) / contract-source-of-truth (principle 2 extension) / retry-attempt telemetry.

§1.5 principle count after round 3: **5 principles**.

---

## Round 4 — 2026-04-23T (closing) — ChatGPT verdict

### ChatGPT Feedback (raw closing remarks)

> **Strategic note (not a blocker).** As you move into implementation, watch for this: the biggest failure mode now is engine drift from contract, not spec gaps. Keep enforcement centralised. Avoid "just this one exception" logic in workflows. Don't let execution logic reintroduce implicit behaviour. If you hold that line, this system scales cleanly.

> **Highest-leverage next step after this PR:** Define a thin execution test harness that validates contract behaviour before full build-out.

### Recommendations and Decisions

| # | Finding | Recommendation | User Decision | Severity | Rationale |
|---|---|---|---|---|---|
| 1 | Strategic watchout — "engine drift from contract" (centralise enforcement; avoid in-workflow exceptions) | route to KNOWLEDGE.md | route to KNOWLEDGE.md | n/a | Durable, cross-feature pattern that outlives this spec; correct home is the project-wide knowledge base, not the spec itself. |
| 2 | Implementation-time follow-up — thin execution test harness validating §5.4a + §5.10a contract behaviour before full build-out | route to tasks/todo.md | route to tasks/todo.md | n/a | Build-phase deliverable, not a spec edit; correct home is the backlog with a direct cross-ref to the capability contract + composition constraints it validates. |

### Applied (spec edits this round)

None. Round 4 was the closing verdict — no spec edits. All strategic output routed per user decision.

### Rejected

None.

### Deferred

None directly — both closing items were routed per user instruction (watchout → KNOWLEDGE.md; test harness → tasks/todo.md).

### Integrity check

Skipped — no spec edits this round.

Top themes: closing verdict / centralise enforcement / thin execution test harness.

---

## Final Summary

**Rounds:** 3 substantive review rounds + 1 closing verdict round = 4 total.

**Findings processed across rounds 1–3:** 24 total (10 round 1 + 7 round 2 + 7 round 3).

- **Accepted + applied:** 17 (round 1: 6 applied; round 2: 5 applied; round 3: 7 applied — full "all: as recommended" approval).
- **Rejected:** 3 (round 1 items 3, 4, 7 — already covered or stylistic duplication).
- **Deferred:** 4 (round 1 items 5 + 10 folded into one §9b entry; round 2 items 1, 3, 6b folded into the same §9b entry as a sub-block with explicit re-evaluation triggers).

**Round 4 closing verdict:** 2 items — both strategic, both routed per user instruction (1 to `KNOWLEDGE.md`, 1 to `tasks/todo.md`). Zero spec edits in round 4.

**Final spec state — paths + sections changed:**

Single file: `docs/riley-observations-dev-spec.md` — 1973 lines.

Sections materially changed across the arc:

- **§1.5 Architectural principles (new section, round 1; extended through rounds 2–3).** Five binding principles — capability-layer boundary, derive-don't-duplicate + contract-source-of-truth, Workflows-primary UX contract, unknown-safe default, side-effects-classification-drives-UX-no-silent-downgrades.
- **§5.2 Scope.** Added §5.4a + §5.10a references to the in-scope list (round 1).
- **§5.3 `InvokeAutomationStep` inline comments.** `retryPolicy` + `gateLevel` comments now cross-reference §5.4a capability contract, `overrideNonIdempotentGuard` override field, and the `maxAttempts ≤ 3` hard ceiling (rounds 1–3).
- **§5.4a Automation capability contract (new section, round 1; rule 3 tightened rounds 2–3).** New columns `automations.side_effects` (enum `read_only | mutating | unknown`) and `automations.idempotent` (bool) introduced by migration `0203`. Gate-resolution defaults, Explore-Mode override, retry posture, engine-enforced non-idempotent guard, `overrideNonIdempotentGuard` opt-in, hard `maxAttempts ≤ 3` ceiling with dispatcher-clamp semantics, audit expectation, enum-value definitions (rounds 1–3).
- **§5.6 HITL gate semantics.** Reconciled with §5.4a — default gate is driven by `side_effects`, not a blanket `'review'` (round 1).
- **§5.7 Error propagation — full rewrite (round 2; `'unknown'` bucket + orchestration-safety contract added round 3).** Standardised `AutomationStepError` TypeScript shape `{ code, type, message, retryable }`. Five-value `type` bucketing table (`validation | execution | timeout | external | unknown`). `unknown`-bucket orchestration-safety contract (engine invariant, non-retryable, non-composable, still visible). Per-error-class behaviour updated to surface `code` + `type`. Retry bullet references engine-enforced guard + `retryable` derivation.
- **§5.9 Telemetry emissions.** Added `automation_composition_invalid` terminal status (round 1). Added required `retryAttempt` field with full usage contract (round 3). Added optional `error?: AutomationStepError` field with inline status→code 1:1 mapping table (round 2).
- **§5.10a Composition constraints (new section, round 1; enforcement-surface hoist + future-relaxation clause added rounds 2–3).** Opener paragraph codifies dual-surface enforcement (authoring-time validator + runtime dispatcher defence-in-depth). Max composition depth = 1, no `invoke_workflow` step type in v1, no callback-based composition, dispatcher one-step-one-webhook rule. Two new error codes: `workflow_composition_invalid` (authoring) + `automation_composition_invalid` (dispatch). Future-relaxation clause — rules 1–3 not edited in place; a later change replaces them with a superseding section.
- **§9a Contracts table.** Updated `workflow.step.automation.completed` row to note `automation_composition_invalid` status, `retryAttempt` required field, optional `error` field, and authoring-time-only posture of `workflow_composition_invalid`. Added new row for `automations.side_effects` + `automations.idempotent` capability-contract columns. Added new row for `AutomationStepError` with `type` enum `{validation, execution, timeout, external, unknown}`, no-v1-codes-map-to-unknown note, and hard-ceiling cross-ref.
- **§9b Deferred Items — single cross-cutting entry.** "Automation + Workflow versioning and marketplace-readiness" — folded round 1 items 5 + 10 (versioning + marketplace). Extended with sub-block "Capability-contract extensions — reconsider per trigger, not in v1" covering three round-2 deferred items (`deterministic`, `expected_duration_class`, `irreversible`) with explicit re-evaluation triggers for each.

**Reviewer's "ready to merge" verdict:** ChatGPT declared merge / finalise / proceed to implementation on round 4, with two non-blocking strategic notes (engine-drift watchout → KNOWLEDGE.md pattern; thin execution test harness → `tasks/todo.md` backlog). No architectural concerns outstanding. Every finding across all 4 rounds has a final decision + rationale logged.

**Implementation-readiness checklist — final pass:**

- **Inputs defined.** Yes. `InvokeAutomationStep` (§5.3), `automations.side_effects` + `automations.idempotent` (§5.4a), `input_schema` / `output_schema` (§5.4 / §5.5), telemetry event payload shapes (§5.9), `AutomationStepError` interface (§5.7).
- **Outputs defined.** Yes. Output mapping contract (§5.5), telemetry completion event (§5.9), `AutomationStepError` surface shape (§5.7), `workflow.step.automation.dispatched` + `.completed` events registered in `server/lib/tracing.ts` (§5.9).
- **Failure modes covered.** Yes. Ten terminal statuses enumerated in §5.9. Ten error codes in §5.7 vocabulary. Five-value `type` bucketing table. `unknown`-bucket orchestration-safety contract. Retry ceiling (`maxAttempts ≤ 3`). Engine-enforced non-idempotent guard + override. Authoring vs dispatch-time error-code surface split.
- **Ordering guarantees explicit.** Yes. Migration order 1–5 (§10.1 / §10.2). Part 1 step order (§4.2). Pre-dispatch vs post-dispatch phases (§5.9). `retryAttempt` emission order per attempt (§5.9 field comment).
- **No unresolved forward references.** Yes. Round-3 integrity-check verified. §1.5 principle 4 → §5.4a rules 1 + 3, §5.7, §5.10a (all exist). §1.5 principle 5 → §5.4a, §6.4, §5.6, §6.5, §6.2 (all exist). §5.4a rule 3 hard ceiling → §5.3 comment + §5.7 retry bullet (both exist). §5.7 `type: 'unknown'` bucket → §1.5 principle 4 (exists). §5.9 `retryAttempt` → §5.4a rule 3 (exists). §9a rows → all new fields/enums reflected. §9b cross-cutting entry → §2, §1.5, §5.4a, §5.10a (all exist).

**Checklist verdict:** all five pass. Spec is implementation-ready.

**Consistency-check across rounds:** no contradictions between round decisions. Each round's applied edits preserve earlier-round decisions. Integrity-check ran clean in round 3 (0 issues) after surfacing and resolving 1 issue per round in rounds 1 and 2. Round 4 had no spec edits.

**Deferred backlog routed to `tasks/todo.md` § "Spec Review deferred items" / `### riley-observations-dev-spec (2026-04-23)`:**

1. **Automation + Workflow versioning and marketplace-readiness.** Versioning, immutable execution versions, opt-in upgrade paths, cross-tenant isolation, partner-provided capability ingestion. Re-evaluation triggers: (a) external party needs to publish capabilities, OR (b) in-place upgrade causes customer-visible break. (§9b main entry.)
2. **`automations.deterministic` flag.** Reconsider per trigger when/if Automation-response caching or memoisation lands. (§9b sub-block.)
3. **`automations.expected_duration_class` flag.** Reconsider per trigger when queue prioritisation / SLA routing lands. Related: per-row `timeout_ms` override column (already in §9b Workflow-composition Part 2 deferrals). (§9b sub-block.)
4. **`irreversible` as third `side_effects` enum value.** Reconsider per trigger if platform's auto-gate-bypass posture changes post-launch. (§9b sub-block.)
5. **Thin execution test harness (ChatGPT closing-verdict recommendation).** Validates the §5.4a capability contract + §5.10a composition constraints at runtime before full build-out. Implementation-phase deliverable — not a spec edit.

**KNOWLEDGE.md entries added:** 2 (see next section).

**Index write failures:** 0.

**PR:** #179 — https://github.com/michaelhazza/automation-v1/pull/179 — spec changes ready at this URL.

---

# Spec Review HITL Checkpoint — Iteration 1

**Spec:** `docs/memory-and-briefings-spec.md`
**Spec commit:** `a5b192cf67c8994213adb8a14f2e23cd1a699d37`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 1 of 5
**Timestamp:** 2026-04-16T03:08:47Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 2 until every finding below is resolved by the human. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

---

## Finding 1.1 — Trust mechanism direction contradicts stated goal (RESOLVED)

**Classification:** ambiguous
**Signal matched (if directional):** N/A — ambiguous (logic error vs unresolved product question)
**Source:** Codex
**Spec section:** Section 5.3, line 269 ("Trust-builds-over-time mechanism")

### Codex's finding (verbatim)

> The trust mechanism currently says to `raise` the auto-apply threshold after successful validations, but with the tiering defined above that makes auto-application *harder* and increases the medium-review band. As written, an agent that earns trust will generate **more** review items, which is the opposite of the stated goal that the queue shrinks over time.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would apply one of two fixes: (a) Change "raise that agent's auto-threshold by 0.05" to "lower that agent's auto-threshold by 0.05" — so the threshold falls from 0.85 toward 0.80, meaning more items qualify for auto-apply and the review queue shrinks. (b) If the intended behavior is different — e.g., the threshold being raised refers to the *lower boundary* of the medium band (0.6 raises toward 0.65, shrinking the medium band from below) — then the wording needs to describe which boundary moves and in which direction. This is marked as tentative because the finding is ambiguous.

### Reasoning

"Raise that agent's auto-threshold" (from 0.85 toward 0.95) makes it harder to auto-apply — items at 0.87 that previously auto-applied now go to medium review. This contradicts "the review queue shrinks every week." Ambiguous because two interpretations exist: (a) word-choice error and should say "lower," or (b) the spec intends a different boundary to move. Downstream impact: if "lower" is the fix, trust reduces friction over time. If spec intended something else, implementing "lower" would build the wrong behavior.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Change "raise that agent's auto-threshold by 0.05" to "lower that agent's auto-threshold by 0.05" — so the threshold falls from 0.85 toward 0.80, meaning more items qualify for auto-apply and the review queue shrinks.
Reject reason (if reject): <edit here>
```

## Finding 1.2 — Portal upload approval policy conflicts between body and open question (RESOLVED)

**Classification:** directional
**Signal matched (if directional):** Scope signals — two incompatible behaviors described for the same feature; picking one constrains implementation scope and UX design.
**Source:** Codex
**Spec section:** Section 5.5 (line ~311) vs Open Question 7 (line ~808)

### Codex's finding (verbatim)

> Section 5.5 says collaborative-portal uploads always require agency approval before filing, but Open Question 7 recommends switching to auto-file after the first five uploads. Those are materially different behaviours with different audit and UX implications, so leaving both in the spec will cause backend and UI work to implement incompatible approval flows.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would apply the Open Question 7 recommended default (trust-builds-over-time: agency approval for first 5 uploads from a new client, then auto-file with notification) and update Section 5.5 to reflect this — removing the "always require agency approval" implication and adding the 5-upload threshold. This is marked tentative because choosing between these two behaviors is a product decision.

### Reasoning

Section 5.5 says "Routing proposals are shown to the agency staffer for approval (the client does not self-file)" with no qualification. Q7 recommends a different model with a 5-upload trust threshold. These are incompatible defaults — an implementer cannot follow both. An approval-always model requires a persistent approval queue and UI; a trust-builds model requires tracking upload count and a state transition. This is directional because the choice constrains backend and UX scope.

### Decision

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

## Finding 1.3 — Onboarding resume state storage conflicts with existing table (RESOLVED)

**Classification:** ambiguous
**Signal matched (if directional):** N/A — ambiguous (prefer-existing-primitives vs genuinely different concern)
**Source:** Codex
**Spec section:** Section 8.6, line 535

### Codex's finding (verbatim)

> This paragraph asks the implementer to choose between a new `onboarding_state` JSONB column and a new `onboarding_sessions` table, but the repo already has `subaccount_onboarding_state` plus helper/service code for onboarding progress. Introducing another persistence primitive here would fork the source of truth for resume/completion state and make the existing onboarding helpers drift immediately.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would update Section 8.6 to say: "State is stored using the existing `subaccount_onboarding_state` table (`server/db/schema/subaccountOnboardingState.ts`). The current schema tracks completion per playbook slug — to support mid-conversation resume (which step of the 9-step arc was last completed and what answers were already collected), add a `resumeState` JSONB column to this table rather than introducing a new table." This is marked tentative because the existing table may not be a fit for mid-conversation state.

### Reasoning

The existing `subaccount_onboarding_state` table tracks *per-playbook-slug completion status* (in_progress / completed / failed), not *mid-conversation step state* within a 9-step conversational arc. The question is whether a `resumeState` JSONB column can be added to extend the existing table for this purpose, or whether the conversational resume state genuinely needs its own model. Ambiguous because extending is the prefer-existing-primitives answer, but may not fit the existing table's purpose. Wrong choice either forks the source of truth or introduces a table that's too narrow for the use case.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Extend the existing subaccount_onboarding_state table with a resumeState JSONB column rather than creating a new table. Update Section 8.6 to reference this table and column explicitly.
Reject reason (if reject): <edit here>
```

## Finding 1.4 — S14 health digest has three incompatible framings (RESOLVED)

**Classification:** directional
**Signal matched (if directional):** Scope signals — "Pick one source of truth for health digest delivery" — the choice between standalone artefact, data-source-for-weekly-digest, and full-merge determines whether there is one background job or two, one inbox item or two, one set of DeliveryChannels settings or two.
**Source:** Codex (partial) + Rubric (contradiction + missing verdict)
**Spec section:** Section 5.10, Section 7.2, Open Question 6

### Codex's finding (verbatim)

> Section 5.10 scopes S14 as its own weekly digest artefact, but Open Question 6 already recommends merging it into `weekly-digest` and only offering a standalone version later if requested. Those two decisions imply different jobs, delivery settings, and inbox counts, so the spec needs one final verdict before implementation starts.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would apply the Open Question 6 recommended default: merge S14 into the weekly digest as Section 5 (Memory health summary) rather than implementing it as a separate delivery job. Section 5.10 would be updated to "Memory health data is generated as a section within the Weekly Digest (Section 7.2, step 5). A standalone delivery mode is deferred until agencies request it explicitly." The reference "from S14 data" in Section 7.2 line 453 would be updated accordingly. This is marked tentative because the standalone vs merged framing is a product-scope decision.

### Reasoning

Three framings coexist: (1) Section 5.10 describes S14 as a standalone weekly artefact delivered via DeliveryChannels; (2) Section 7.2 refers to "from S14 data" — implying S14 generates data that feeds the weekly digest, making them peers; (3) Q6 recommends merging S14 fully into the weekly digest. These are incompatible implementation paths. (1) and (2) are also internally contradictory — if S14 is a standalone artefact, the weekly digest should not reference "S14 data" as a source. This is directional because it determines the number of delivery jobs, inbox items, and DeliveryChannels configurations.

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
3. The agent will read this checkpoint file as its first action, honour each decision (apply, apply-with-modification, reject, or stop-loop), and continue to iteration 2.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.

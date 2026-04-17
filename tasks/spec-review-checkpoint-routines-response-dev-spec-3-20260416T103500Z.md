# Spec Review HITL Checkpoint — Iteration 3

**Spec:** `docs/routines-response-dev-spec.md`
**Spec commit:** `16925715879d765a127bdafda43c738031e2bafd` (working tree modified — iter 2 HITL decisions applied + 11 mechanical fixes from iter 3)
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 3 of 5
**Timestamp:** 2026-04-16T10:35:00Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 4 until every finding below is resolved by the human. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

**Mechanical findings already applied this iteration (no human action needed):**
- C1: §1 north-star — "config assistant" replaced with "Playbook Studio chat"
- C2: §3.7 — out-of-range window test corrected to assert 400; separate bullet added for valid-window-no-occurrences (200 + empty array)
- C3: §3.3 — `estimatedTokens` and `estimatedCost` changed from optional to `number | null`
- C5: §4.6 — idempotency key format changed from epochSeconds to epochMilliseconds
- C6: §3.6 — step 6 updated to use `WHERE is_test_run = false` in cost backfill
- C8: §5.4 — LLM mapping table short key corrected from `anthropicClaude` to `lmAnthropicClaude`
- C9: §5.7 — integration test clarified to use skill_simulate path
- C10: §5.3 — step-type primitives anchored to existing playbook_validate schema
- C11: §3 + §4 — file inventory tables added for Features 1 and 2
- C12: §6.2, §7.2, §7.4, closing note — relative temporal language replaced with §8 commit-sequence labels
- R1: §3.3 — null-aggregation rule added to totals field comment

---

## Finding 3.1 — SystemAgentEditPage in scope but system-agent test runs disallowed

**Classification:** directional
**Signal matched (if directional):** Scope signals — "Remove this item from the roadmap" / deciding whether system-agent test runs are in scope changes Feature 2 implementation scope; also Architecture signals — "Change the interface of X" (a system-admin surface would require a new route + permission contract)
**Source:** Codex
**Spec section:** §4.2, §4.7

### Codex's finding (verbatim)

> §4.2 includes `SystemAgentEditPage.tsx` in scope for the inline test panel, but §4.7 says test runs on system agents are disallowed from the org surface and only system admins have a separate surface. The spec does not say whether system-agent inline testing is supported anywhere.
> Suggested fix: Either remove `SystemAgentEditPage.tsx` from Feature 2 scope, or add the exact allowed system-admin surface, route, and permission contract for system-agent test runs.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would remove `SystemAgentEditPage.tsx` from the §4.2 scope list, leaving the scope as `AdminAgentEditPage.tsx` and `SubaccountAgentEditPage.tsx` plus Skill Studio. This is the simpler resolution: system agent editing is a platform concern and the inline test panel is an authoring surface for org/subaccount administrators. This is marked tentative because the human may instead want the system-admin interface to have a test panel — but that would require defining a separate system-admin route (not covered in §4.6), a permission (`system.agents.test_run` or similar), and the surface itself.

### Reasoning

§4.2 lists three agent edit pages including `SystemAgentEditPage.tsx`. §4.7 is unambiguous: "Test runs on system agents are disallowed from the org surface (system agent editing is a platform concern; system admins have a separate surface)." The current text creates an unsolvable contradiction for the implementer: the page is in scope but the runs it would produce are not allowed. Resolving this either (a) removes the page from scope (simplest, no new work), or (b) defines the system-admin surface and route (adds scope). This is a product/scope decision.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`.

```
Decision: apply
Modification (if apply-with-modification): Remove `SystemAgentEditPage.tsx` from §4.2 scope. Feature 2 applies to org/subaccount authoring pages only.
Reject reason (if reject): <edit here>
```

---

## Finding 3.2 — RLS policy under-specified for polymorphic agent_test_fixtures table

**Classification:** ambiguous
**Signal matched (if directional):** N/A — ambiguous (could be mechanical clarification or scope/interface change depending on intended access model)
**Source:** Codex
**Spec section:** §4.4

### Codex's finding (verbatim)

> "RLS policy identical to other org-scoped tables" is too vague for a new polymorphic table that also carries optional `subaccount_id`. The access contract is not implementation-ready: who can read/write fixtures at org scope, subaccount scope, and across agent vs skill targets is unspecified.
> Suggested fix: Add the exact read/write rules in spec language, tied to existing permission keys and scope checks, and state whether org users can see subaccount fixtures and vice versa.

### Tentative recommendation (non-authoritative)

If this were mechanical, I would add the following access note to §4.4:

> RLS policy: org admins can read/write all fixtures within their `organisation_id`. Subaccount users (including `client_user`) can read/write fixtures where `subaccount_id` matches their subaccount — they cannot see org-level fixtures (where `subaccount_id IS NULL`) or fixtures for other subaccounts. This mirrors the pattern used on `agent_runs` and other subaccount-scoped tables. Enforced via `assertScope()` in `agentTestFixturesService`.

This is marked tentative because the human may intend a different model — for example, org admins may not need to write subaccount-scoped fixtures, or `client_user` may be excluded entirely from this table.

### Reasoning

The statement "RLS policy identical to other org-scoped tables" is ambiguous because `agent_test_fixtures` is not a standard org-scoped table — it has an optional `subaccount_id`, making it polymorphic (org-level fixture when null, subaccount-level when set). Standard org-scoped tables in this codebase typically allow org admins full read/write within the org, and subaccount users can only see their subaccount's rows. But the spec doesn't confirm this. An implementer writing the RLS migration needs this answer. The finding is ambiguous rather than directional because the likely answer (mirror the existing subaccount-scoped pattern) is probably mechanical — but "probably" isn't certainty, and a wrong RLS policy is a security concern.

### Decision

Edit the line below to one of: `apply`, `apply-with-modification`, `reject`, `stop-loop`. If `apply-with-modification`, add the modification inline. If `reject`, add a one-sentence reason.

```
Decision: apply-with-modification
Modification (if apply-with-modification): Add explicit access matrix to §4.4: org admins read/write all fixtures within their `organisation_id`; subaccount users read/write only fixtures where `subaccount_id` matches their own — cannot see org-level fixtures (`subaccount_id IS NULL`) or other subaccounts' fixtures; `client_user` excluded (no access). Enforced via `assertScope()` in `agentTestFixturesService`. Mirrors the pattern on `agent_runs`.
Reject reason (if reject): <edit here>
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (apply, apply-with-modification, reject, or stop-loop), and continue to iteration 4.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring the findings that have been marked `apply` or `apply-with-modification`.

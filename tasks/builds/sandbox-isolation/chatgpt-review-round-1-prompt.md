# ChatGPT Spec Review — Round 1 Prompt (paste into chatgpt.com)

Copy the block between the `=====` markers below and paste it into a fresh ChatGPT-web conversation. When ChatGPT responds, copy the entire response back into Claude Code.

## Copy from here ⬇

=====

You are reviewing a draft architecture specification for a multi-tenant SaaS product. Your job is to surface directional / framing / product-fit issues that a mechanical-rigor reviewer (Codex) would miss. Be specific, terse, and skeptical. Don't flatter the spec.

## Project framing (ground truth — do not contradict)

Stage: pre-production, no live users, no live agencies, rapid evolution, breaking changes expected.
Testing posture: static gates primary; pure-function unit tests only; no vitest/jest/playwright for the own-app surface; no E2E or API-contract tests yet.
Rollout model: commit-and-revert; feature flags ONLY for behaviour modes (shadow vs active, dev vs prod), not for rollout gates.
Architecture preference: reuse existing primitives over inventing new ones. Accepted primitives include `withBackoff`, `failure() + FailureReason`, `runCostBreaker`, `RLS_PROTECTED_TABLES`, `withOrgTx / getOrgScopedDb / withAdminConnection`, `redactValue` + DEFAULT_REDACTION_PATTERNS, `credentialBrokerService`, `createWorker`, S3 object-storage client.

Spec B sits inside the SynthetOS master architecture v1.2:
- Layer 1: SynthetOS Control Plane (governance, policy, identity, memory, approvals, audit, billing).
- Layer 2: Router & Execution Planner (Capability-Aware Orchestrator, paths A/B/C/D — already implemented).
- Layer 3: Controllers (Native, Operator — controllerStyle field on agent_runs shipped via PR #279 migration 0308).
- Layer 4: Execution Environments / Capabilities — Browser, Sandbox (THIS SPEC), Terminal/Repo, API/Tool, Model Invocation, Local/BYO.
- Layer 5: IEE Execution Plane — session manager, worker scheduler, runtime isolation, credential injection mechanics, artefact store, telemetry. **SandboxExecutionService lives in IEE.**
- Layer 6: Model Access & Identity Layer (Platform OpenAI/Anthropic/Gemini, BYO keys, ChatGPT OAuth as Operator Session Identity).
- Risk Tiers 0-6 (Tier 4 = sandboxed code execution — THIS SPEC's domain).
- Policy Envelope: per-run JSONB snapshot on agent_runs.policy_envelope_snapshot (PR #279 migration 0309).
- Run Trace: Phase 1 virtual view over decision ledgers (agent_execution_events, routing_outcomes, delegation_outcomes, tool_call_security_events, reviewAuditRecords, actions, llm_requests).
- Three-tier agent model: system_agents / agents / subaccount_agents.

Anchoring brief: `docs/synthetos-governed-agentic-os-brief-v1.2.md`.

## Spec under review

The full spec is below. It is 1559 lines. Read it end-to-end before responding.

[PASTE THE FULL CONTENT OF `tasks/builds/sandbox-isolation/spec.md` HERE]

## Review focus

Spec already passed mechanical review (Codex, 4 iterations, 36 mechanical fixes applied, READY_FOR_BUILD). Architecture alignment to the v1.2 master brief was applied AFTER that mechanical review (§4.1 layer mapping, §6 primitives table additions, §7.2 controller-agnostic + system-agent notes, §14.4a Run Trace virtual view integration, §22 IEE delegation lifecycle note).

Your job is NOT to re-do mechanical review. Your job is to surface:

1. **Directional / framing issues.** Is the spec aiming at the right thing? Is anything ambitious in the wrong direction? Is there an obviously better cut?
2. **Product-fit issues.** Does the customer-facing surface area (failure modes, retention, deletion behaviour, observability semantics) match what end users / operators will actually need?
3. **Gaps a fresh pair of eyes catches.** Anything the spec implicitly assumes but should make explicit. Anything that will surprise the Phase 2 builder. Anything that may bite at scale.
4. **Master architecture alignment correctness.** Are the §4.1 layer mappings correct? Is anything misclassified? Is there a layer-boundary violation that slipped in?
5. **Concurrency / race conditions / failure modes** beyond what's in §24. The spec covers the obvious ones; check for less-obvious ones.
6. **Anything you'd push back on at a senior engineering review.** Be skeptical. Don't be polite. We want findings.

Avoid:
- Re-litigating decisions already locked by the brief (§6 of the brief lists 25 non-negotiable invariants).
- Suggesting feature flags, staged rollouts, frontend tests, E2E tests, supertest, performance baselines (against framing).
- Suggesting new primitives where existing ones could be extended (against framing).
- Marking already-deferred items (§27) as missing.

## Response format

Use this exact structure:

```
## Verdict
APPROVED | CHANGES_REQUESTED | NEEDS_DISCUSSION

## Findings

### F1. [Short title]
**Severity:** Blocker | Strong | Recommendation | Polish
**Category:** Directional | Product-fit | Layer-boundary | Concurrency | Other
**Section:** §<spec-section-number>
**Issue:** <2-4 sentences on what's wrong / missing / unclear>
**Suggested resolution:** <concrete proposal, terse>
**Why this matters:** <one sentence on consequence if unaddressed>

### F2. ...
(repeat per finding)

## Strengths (optional, brief)
What the spec gets right that should NOT be changed.
```

Reply with the verdict + findings only. No preamble.

=====

## ⬆ Paste up to here

---

## Operator instructions

1. Open chatgpt.com in a new tab. Use any model (GPT-4 / GPT-5 / o1 / o3 — your call).
2. Paste the block above between the `=====` markers into the chat.
3. **Important:** in the prompt above, you'll see a placeholder `[PASTE THE FULL CONTENT OF `tasks/builds/sandbox-isolation/spec.md` HERE]`. Replace that placeholder with the actual content of `tasks/builds/sandbox-isolation/spec.md` (1559 lines). The easiest path: open the spec file in VS Code, select-all, copy, paste in place of the placeholder line.
4. Send. Wait for ChatGPT's full response.
5. Copy ChatGPT's entire response (including the verdict, all findings, strengths section if present).
6. Paste the response back to me in Claude Code chat.

I'll triage each finding, auto-apply the technical ones, and surface user-facing ones to you for approval. Then we go to Round 2 (or conclude if APPROVED).

---

## Log path

`tasks/review-logs/chatgpt-spec-review-sandbox-isolation-2026-05-11T02-09-36Z.md` (will be written by Claude as the loop progresses).

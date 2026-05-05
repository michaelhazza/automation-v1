# Spec Review Iteration 1 — agentic-commerce

**Spec:** `tasks/builds/agentic-commerce/spec.md`
**Iteration:** 1 of 5
**Started:** 2026-05-03T05-22-16Z
**Reviewer:** Claude Opus 4.7 (1M context) + Codex (`codex exec --sandbox read-only`)

## Codex output

Codex iteration 1 produced 15 distinct findings (`_codex_iter1_agentic.txt`). All 15 land in the mechanical bucket — they are all consistency / contradiction / under-specified-invariant fixes that the spec already implicitly resolved elsewhere. No directional findings, no ambiguous findings.

## Findings 1-5

### FINDING #1 — Spending Budget vs Spending Policy ownership of limits/mode

- Source: Codex (#1)
- Section: §2 lines 70-72; §3 lines 113-114
- Description: Glossary and Domain Model both attribute Spending Limits and Spending Mode to the Spending Budget, but the schema in §5.1 places them on `spending_policies`.
- Codex's suggested fix: "Spending Budget stores ownership/currency/alerting/kill-switch metadata only; Spending Limits and Spending Mode live exclusively on spending_policies."
- Classification: mechanical
- Reasoning: Schema is the load-bearing decision; prose drifted.
- Disposition: auto-apply

[ACCEPT] §2 + §3 — Glossary and Domain Model now state Spending Budget holds only ownership/currency/alert-threshold/kill-switch metadata; limits/mode/allowlist/threshold live exclusively on Spending Policy.

### FINDING #2 — Sub-account budget cardinality contradiction

- Source: Codex (#2)
- Section: §3 line 113; §9.5 line 826
- Description: Domain Model says "one per sub-account"; §9.5 allows multiple per currency.
- Codex's suggested fix: "Sub-accounts may have multiple Spending Budgets, but at most one per currency."
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §3 + §5.1 + §9.5 — §3 + spending_budgets table now state "per sub-account (one per currency)". §9.5 grew an explicit `(organisation_id, subaccount_id, currency)` partial unique constraint row.

### FINDING #3 — Conservative defaults `0` ambiguity

- Source: Codex (#3)
- Section: §5.1 line 207; §14 lines 982-986; §4 lines 144-146
- Description: Conservative defaults set limits to 0 claiming "everything goes to HITL", but §4 limit-exceeded transition would block. `0` was double-meaning.
- Codex's suggested fix: "0 means disabled/unset for spend limits; do not use 0 to mean both 'no capacity' and 'force HITL'."
- Classification: mechanical
- Reasoning: Pick one semantic and apply it everywhere. Settled on "0 = unset (no cap)" for limits; threshold's "0 = everything to HITL" preserved. Evaluation order made explicit.
- Disposition: auto-apply

[ACCEPT] §4 + §5.1 + §14 — Limit columns documented as "0 = unset (no cap)"; threshold preserved as "0 routes every charge to HITL"; §4 now states the gate evaluation order (Kill Switch → Allowlist → Limits → Threshold); §14 conservative-defaults block now states the actual blocking behaviour (empty allowlist) and that the one-click template populates working values.

### FINDING #4 — Shadow approved post-HITL state

- Source: Codex (#4)
- Section: §4 lines 147-150; §14 line 960
- Description: §14 ambiguously said "shadow_settled (on auto-approval) or HITL-resolved state".
- Codex's suggested fix: "Any shadow-mode charge that is approved, whether auto or HITL, transitions to shadow_settled."
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §14 — HITL-approved shadow charges go pending_approval → approved → shadow_settled; HITL-denied land at denied. Aligned with §4.

### FINDING #5 — `disputed` terminal/non-terminal contradiction

- Source: Codex (#5)
- Section: §4 line 139; §9.4 line 804; §10 line 844
- Description: §4 says non-terminal; §9.4 excludes from terminal list; §10 invariant 9 included it in terminal list. Inconsistent.
- Codex's suggested fix: "disputed is non-terminal — update §4, §9.4, and §10 to match."
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §10 invariant 9 — disputed removed from terminal list; now listed alongside pending_approval and executed as non-terminal states that hold reserved capacity until they reach a terminal state.

## Findings 6-10

### FINDING #6 — Append-only invariant vs late-bound fields

- Source: Codex (#6)
- Section: §5.1 line 233; §6.1 lines 382-388; §16.8 line 1047
- Description: agent_charges rows must update late-bound columns. §16.8 "no other field mutations" rule was too strict.
- Codex's suggested fix: "Define the exact mutable columns allowed during a valid state transition."
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §5.1 + §16.8 — Mutable-on-transition allowlist now lists 10 columns the BEFORE UPDATE trigger permits during state transitions (status, action_id, provider_charge_id, spt_connection_id, decision_path, failure_reason, approved_at, executed_at, settled_at, updated_at). All other columns explicitly enumerated as immutable post-insert. §16.8 references the allowlist.

### FINDING #7 — Worker holds SPT contradiction

- Source: Codex (#7)
- Section: §7.2 lines 506, 512; §10 line 838; §14 line 965
- Description: Invariant 3 said "Workers carry no SPT credentials" but §7.2 step 5 returns SPT to worker for payment-form fill.
- Codex's suggested fix: "Choose one architecture."
- Classification: mechanical
- Reasoning: Actual model is "no persistent credentials, no DB access; ephemeral single-use SPT for in-flight use only". Invariant text just read more absolute than the actual behaviour.
- Disposition: auto-apply

[ACCEPT] §10 invariant 3 + §7.2 — Invariant 3 now says workers hold no persistent SPT credentials, no DB access to integration_connections; main app returns ephemeral single-use SPT in response payload for live-mode auto-approval cases. §7.2 lead-in matches.

### FINDING #8 — Timeout path: who writes the ledger row

- Source: Codex (#8)
- Section: §7.2 line 511; §8.4 line 711; §10 line 836
- Description: §7.2 step 4 said "worker writes failed charge row" on timeout. Invariant 1 reserves all ledger writes for chargeRouterService.
- Codex's suggested fix: "Main app updates the ledger row on timeout; worker only records local execution state."
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §7.2 step 4 + §8.4 — Worker now records timeout locally and abandons; main app's execution-window timeout job reconciles orphaned row to failed once expires_at passes (per invariant 1).

### FINDING #9 — Single cross-reference event vs full `spend.*` event chain

- Source: Codex (#9)
- Section: §7.9 lines 613-616; §9.4 lines 806-814; §6.1 line 388
- Description: §7.9 says single cross-reference event per attempt; §9.4 lists 9 separate spend.* events. Unclear whether the latter are real event rows.
- Codex's suggested fix: "State explicitly whether agent_execution_events gets one cross-reference event only, or full lifecycle stream."
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §9.4 — Lead-in now states the spend.* labels are logical state-machine event names used in audit reasoning, dashboards, and decision_path JSON — NOT separate rows on agent_execution_events. Per-state-transition history lives on agent_charges itself.

### FINDING #10 — `WorkerSpendResponse` missing `blocked` outcome

- Source: Codex (#10)
- Section: §8.2 lines 663-666; §7.2 line 510; §8.4 line 704; §10 line 845
- Description: WorkerSpendResponse decision union collapsed blocked into denied. Invariant 10 distinguishes them.
- Codex's suggested fix: "WorkerSpendResponse.decision must include blocked as a distinct value."
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §7.2 step 3 + §8.4 — Decision union now includes 'blocked'. §8.4 carries explicit reminder that blocked and denied stay distinct on the wire per invariant 10.

## Findings 11-15

### FINDING #11 — Route file inventory missing files

- Source: Codex (#11)
- Section: §11.3 lines 881-891; §18.1 lines 1253-1256
- Description: §11.3 has guards for /spending-budgets, /approval-channels, promote-to-live, but §18.1 missed the corresponding route files.
- Codex's suggested fix: "Add concrete route files for spending budgets, promotion, and approval-channel CRUD."
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §18.1 + §17 Chunk 13 — §18.1 now lists spendingBudgets.ts, spendingPolicies.ts, agentCharges.ts, approvalChannels.ts, webhooks/stripeAgentWebhook.ts. Chunk 13 file list extended to match.

### FINDING #12 — `merchant_allowlist` shape inconsistency

- Source: Codex (#12)
- Section: §5.1 line 211; §8.5 lines 727-729
- Description: §5.1 schema used `{ id, name, source }`; §8.5 contract uses `{ id, descriptor, source }` with nullability. §8.5 aligns with §8.1 ChargeRouterRequest.
- Codex's suggested fix: "Choose one field set."
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §5.1 — Schema now uses `{ id: string | null, descriptor: string, source: ... }` matching §8.5 and §8.1. Cross-reference note added.

### FINDING #13 — Aggregate updates missing for refund/dispute

- Source: Codex (#13)
- Section: §7.5 line 564; §12 line 902; §16.7 line 1043; §17 line 1200
- Description: §7.5 only triggered aggregateService on succeeded; net-spend invariant + Chunk 13 require refunds.
- Codex's suggested fix: "Specify aggregate updates for refunded and dispute-resolution transitions."
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §7.5 + §7.6 — Webhook service now calls agentSpendAggregateService on refunded (both succeeded → refunded and disputed → refunded) as a net-spend reduction. §7.6 explains the add/subtract direction-aware semantics. Disputes themselves don't touch aggregates; only the final → refunded outcome does.

### FINDING #14 — Approver authority underspecified

- Source: Codex (#14)
- Section: §11.1 lines 859-865; §5.1 lines 306-312; §2 line 85
- Description: Both global spend_approver permission and per-budget spending_budget_approvers table existed without stated boolean combination.
- Codex's suggested fix: "(has spend_approver) AND (in scope by default OR explicit row)."
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §11.1 — Authority rule now stated explicitly: (holds spend_approver) AND (in scope by role default OR explicit spending_budget_approvers row). Default-grant section clarifies both are granted atomically.

### FINDING #15 — Retention configuration primitive unnamed

- Source: Codex (#15)
- Section: §14 line 977; §17 line 1222
- Description: Per-org shadow retention left as "organisations table or config row".
- Codex's suggested fix: "Name the primitive: organisations.shadow_charge_retention_days integer not null default 90."
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §14 + §17 Chunk 16 + §5.2 + §18.2 + §18.3 + §17 Chunk 2 — `organisations.shadow_charge_retention_days integer NOT NULL DEFAULT 90` is now the named primitive. Added to §5.2 schema mods, §18.2 modified files, §18.3 migration scope (in `<NNNN+1>_agentic_commerce_schema.sql`), §17 Chunk 2 + Chunk 16. §14 retention purge job uses `settled_at + shadow_charge_retention_days < NOW()`.

## Iteration 1 Summary

- Mechanical findings accepted:  15
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   (set by commit step)

Stopping heuristic check: this iteration was mechanical-only (no directional/ambiguous/reclassified). N-1 does not exist. Continue to iteration 2 to confirm convergence.

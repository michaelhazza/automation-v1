# Spec Review Iteration 2 — agentic-commerce

**Spec:** `tasks/builds/agentic-commerce/spec.md`
**Iteration:** 2 of 5
**Started:** 2026-05-03T05-39-51Z
**Reviewer:** Claude Opus 4.7 (1M context) + Codex (`codex exec --sandbox read-only`)

## Codex output

12 distinct findings. All 12 land in the mechanical bucket. No directional. Notable: finding #5 surfaced a regression I introduced in iter 1's §7.6 fix (refund double-subtract risk).

## Findings 1-6

### FINDING #2.1 — `per_txn_limit_minor = 0` semantic drift in §8.5

- Source: Codex (#1)
- Section: §5.1 vs §8.5
- Description: §8.5 still carried iter-1 stale comment "0 = everything to HITL" while §5.1 was updated to "0 = unset (no per-txn cap)".
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §8.5 — Comments updated to "0 = unset (no per-txn / daily / monthly cap)" for limits, "0 = every positive charge routes to HITL" for threshold. Aligned with §5.1.

### FINDING #2.2 — Idempotency contract drift between worker and direct paths

- Source: Codex (#2)
- Section: §6.1, §8.1, §8.3, §9.1
- Description: Pure layer claims to build the key; worker pre-builds it; WorkerSpendRequest didn't carry toolCallId/args; ChargeRouterRequest had no idempotencyKey field.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §8.3 + §9.1 — WorkerSpendRequest now carries toolCallId, args, AND the pre-built idempotencyKey. §9.1 specifies that the main app rebuilds the key from those fields via the same `chargeRouterServicePure.buildChargeIdempotencyKey` and rejects on mismatch.

### FINDING #2.3 — Reserved-capacity disagreement (§4 vs §16.2 vs §9.3)

- Source: Codex (#3)
- Section: §4 Rules, §9.3, §16.2
- Description: §4 said pending_approval+executed reserve; §16.2 said approved+executed; §9.3 said non-terminal.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §4 + §9.3 + §16.2 — Unified to "all non-terminal states (pending_approval, approved, executed, disputed) reserve amount_minor against limits until terminal". §9.3 + §16.2 prose match.

### FINDING #2.4 — §7.2 30s timeout vs HITL pause contradiction

- Source: Codex (#4)
- Section: §7.2 step 4 vs step 6
- Description: Step 4 says timeout at 30s; step 6 says pending_approval waits for resolution which is much longer than 30s.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §7.2 — Steps 3-6 now make explicit that the 30s deadline applies to the IMMEDIATE-decision response only. The main app emits its decision (approved/blocked/denied/pending_approval) within 30s; pending_approval responses arrive within that window with the worker / its enclosing workflow then pausing. Eventual approve/deny outcome is delivered later via the workflow-resume channel, not via a long-deadlined agent-spend-response reply.

### FINDING #2.5 — Refund double-subtract risk (regression from iter 1)

- Source: Codex (#5)
- Section: §7.5, §7.6, §4, §8.1
- Description: My iter-1 fix to §7.6 said both inbound_refund row settlement AND outbound succeeded → refunded transitions trigger subtraction; could double-count.
- Classification: mechanical
- Reasoning: My iter-1 fix conflated two paths. The two paths are mutually exclusive per row: operator-issued refunds via `issue_refund` create a NEW inbound_refund row (parent stays succeeded); dispute-loss refunds transition the original outbound row to refunded (no separate inbound_refund row). Each path runs against a different row.
- Disposition: auto-apply

[ACCEPT] §7.5 + §7.6 — §7.6 now explicitly enumerates the three mutually-exclusive aggregate write paths (outbound succeeded; inbound_refund-row succeeded; outbound → refunded via dispute) and notes that they cannot double-count because each runs against a different row/transition. §7.5's webhook handler list updated to match.

### FINDING #2.6 — Single-use SPT enforcement under-specified

- Source: Codex (#6)
- Section: §10 invariant 3, §7.2 step 5, §8.4
- Description: Invariant 3 said "single-use, scoped to that one charge" without an enforcement mechanism.
- Codex's suggested fix: introduce a server-minted `workerSpendToken` wrapper.
- Classification: mechanical
- Reasoning: Codex's suggested fix would introduce a new abstraction. Per the framing rules (prefer existing primitives) the cleanest mechanical fix is to tone the invariant prose to match the actual implementable mechanism: the SPT is supplied to the worker bound to a ledgerRowId; "single-use at the protocol level" means the chargeToken is delivered exactly once per correlationId and the worker's payment call carries the charge idempotency_key as Stripe's idempotency-key header (so any reuse against the same merchant call collapses to the original outcome) and the agent_charges.idempotency_key UNIQUE constraint blocks duplicate ledger rows. The stronger server-minted single-use wrapper is added to §20 as a deferred hardening item.
- Disposition: auto-apply

[ACCEPT] §10 invariant 3 + §20 — Invariant 3 prose tightened to specify the actual three-layer enforcement (one-shot delivery + Stripe idempotency-key + DB UNIQUE) rather than asserting an unenforceable "single-use" property. §20 adds a deferred item for the server-minted wrapper if v1 evidence suggests stronger enforcement is needed.

## Findings 7-12

### FINDING #2.7 — Webhook signature verification: connection ID source missing

- Source: Codex (#7)
- Section: §7.5
- Description: The route had to "verify against integrationConnections.configJson.webhookSecret for the matching sub-account connection" but never said where the connection ID comes from.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §7.5 + §11.3 — Webhook now mounts at `/api/webhooks/stripe-agent/:connectionId`. The connection ID is encoded in the path (Stripe is configured at SPT issuance time with the per-connection URL). The route loads the connection row by ID via `withAdminConnection` BEFORE signature verification, then verifies the stripe-signature header against that row's webhookSecret, then resolves tenant context from the verified row. §11.3 route guard table updated.

### FINDING #2.8 — `spend_approver` default-grant logic sequenced too late

- Source: Codex (#8)
- Section: §17 Chunk 13 vs Chunk 16
- Description: Default-grant logic was scheduled in Chunk 16, but Chunk 13 ships the budget-creation route — budgets could be created without the permission grant landing.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §17 Chunks 13 + 16 — Default-grant logic moved to Chunk 13 alongside the budget-creation endpoint, so the grant happens atomically with budget creation. Chunk 16 retains the conservative-defaults template, retention config UI, and SPT onboarding flow. Cross-reference note added to Chunk 16.

### FINDING #2.9 — `agent-spend-response` listed as server-side handler

- Source: Codex (#9)
- Section: §18.1
- Description: §18.1 listed a server-side handler for `agent-spend-response` queue, but §7.2 / §8.4 define the queue as main-app-produces / worker-consumes.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §18.1 — Removed the server-side `agent-spend-response` handler entry. Note added clarifying that the worker-side consumer lives in `worker/src/persistence/runs.ts`.

### FINDING #2.10 — Items duplicated between §20 Deferred and §21 Out of Scope

- Source: Codex (#10)
- Section: §20, §21
- Description: Machine Payments Protocol, Customer-facing SPT issuance, Sales Autopilot Playbook spending, Auto-refund on workflow rollback all appeared in both sections.
- Classification: mechanical
- Reasoning: Per the brief addendum these are durable product stances (not deferrals). §21 is the authoritative home.
- Disposition: auto-apply

[ACCEPT] §20 — Removed the four duplicate items from §20. They now live in §21 only. Note added in §20 explaining the move and citing the brief-addendum decision.

### FINDING #2.11 — Skill file naming convention drift

- Source: Codex (#11)
- Section: §7.1, §17 Chunk 6, §18.1
- Description: §7.1 + Chunk 6 said "SKILL.md frontmatter / SKILL.md files" but §18.1 lists `pay_invoice.md`, `purchase_resource.md`, etc.
- Classification: mechanical
- Reasoning: The codebase convention (verified via `ls server/skills/`) is `<slug>.md` per skill, not SKILL.md per directory.
- Disposition: auto-apply

[ACCEPT] §7.1 + §17 Chunk 6 — Updated prose to "Skills ship as `server/skills/<slug>.md` files with the standard skill-file frontmatter (matching the `add_deliverable.md` / `book_meeting.md` precedent)". File inventory was already correct.

### FINDING #2.12 — Mutable-column allowlist + superseded/reconnect metadata storage

- Source: Codex (#12)
- Section: §5.1, §16.3, §16.9
- Description: The mutable-column allowlist on agent_charges omitted any field for "superseded" approval responses or SPT-reconnect metadata, but §9.3 / §16.3 / §16.9 reference these.
- Classification: mechanical
- Disposition: auto-apply

[ACCEPT] §9.3 + §16.3 — Both sections now state these facts live on `actions` rows (using the existing `actions.responseStatus` and response metadata fields) and `iee_steps`, NEVER on `agent_charges`. The ledger row stays narrowly scoped to the charge state machine.

## Iteration 2 Summary

- Mechanical findings accepted:  12
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
- Spec commit after iteration:   (set by commit step)

Stopping heuristic check: this iteration was mechanical-only (no directional/ambiguous/reclassified). N-1 iteration was also mechanical-only — that's two consecutive mechanical-only rounds and would normally trigger early exit. However, iter 2 surfaced a regression I introduced in iter 1 plus several new substantive findings (idempotency contract drift, webhook routing, sequencing, refund double-subtract). Those were genuine new issues, not Codex re-stating already-fixed problems. Continue to iteration 3 to verify the regression-free convergence — only if iter 3 surfaces nothing substantive will we accept the early exit.

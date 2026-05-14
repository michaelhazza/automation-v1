# Spec Review Final Report — agentic-commerce

**Spec:** `tasks/builds/agentic-commerce/spec.md`
**Spec commit at start:** `bd8920c3`
**Spec commit at finish:** `9595837a`
**Spec-context commit:** `03cf8188`
**Iterations run:** 5 of 5
**Exit condition:** iteration-cap (Codex closed iter 5 with explicit convergence signal: "I would not add more beyond these")

**Verdict:** READY_FOR_BUILD (5 iterations, 51 mechanical fixes applied, 0 directional findings, 0 items routed to tasks/todo.md)

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 15 | 0 | 15 | 0 | 0 | 0 | none |
| 2 | 12 | 0 | 12 | 0 | 0 | 0 | none |
| 3 | 10 | 0 | 10 | 0 | 0 | 0 | none |
| 4 | 9 | 0 | 9 | 0 | 0 | 0 | none |
| 5 | 5 | 0 | 5 | 0 | 0 | 0 | none |
| **Totals** | **51** | **0** | **51** | **0** | **0** | **0** | **0** |

Notable pattern: zero directional findings across all five rounds. The spec was already well-aligned with the framing assumptions (pre-production, rapid evolution, no feature flags, prefer existing primitives) — every Codex finding was a mechanical consistency / under-specification / drift fix. Several iter 4 + iter 5 findings were regressions from my own iter 3 edits, which Codex caught reliably each round.

## Mechanical changes applied

Grouped by spec section.

### §2 Glossary
- Spending Budget glossary entry tightened to ownership/currency/alert-threshold/kill-switch metadata only (iter 1 #1).
- Spending Policy glossary entry: sole owner of limits/mode/allowlist/threshold (iter 1 #1).

### §3 Domain Model
- Spending Budget vs Spending Policy ownership clarified (iter 1 #1).
- Sub-account budget cardinality: "per sub-account (one per currency)" (iter 1 #2).
- Portfolio Health Agent SPT resolution: live execution resolves SPT from `agent_charges.subaccount_id`; charge `blocked` with `reason = 'spt_unavailable'` if recipient has no active connection (iter 5 #2).

### §4 Charge Lifecycle
- Evaluation order made explicit: Kill Switch → Allowlist → Limits → Threshold (iter 1 #3).
- Limits at 0 = "unset (no cap)" (iter 1 #3).
- `disputed` reclassified non-terminal (iter 1 #5); `succeeded` reclassified non-terminal (iter 5 #1).
- Truly-terminal set: blocked, denied, failed, shadow_settled, refunded (iter 5 #1).
- Reserved-capacity scope: pending_approval, approved, executed only (iter 5 #1).
- Carved-out post-terminal `failed → succeeded` override gated on `stripeAgentWebhookService` (iter 3 #3).
- Execution-timeout job scope narrowed to `approved` rows only (iter 4 #2).
- `EXECUTION_TIMEOUT_MINUTES` named in `server/config/spendConstants.ts` (iter 3 #6).

### §5 Data Model
- Mutable-on-transition allowlist enumerated explicitly (iter 1 #6); `expires_at` / `approval_expires_at` moved into allowlist (iter 4 #3); `provider_charge_id` non-status-update on `executed` whitelisted (iter 4 #4).
- `merchant_allowlist` shape aligned with §8.5: `{ id: string|null, descriptor: string, source }` (iter 1 #12).
- `organisations.shadow_charge_retention_days` named primitive (iter 1 #15).
- `shared/iee/actionSchema.ts` adds both `spend_request` AND `spend_completion` (iter 4 #7).

### §6 Service Architecture
- Two live execution paths: `main_app_stripe` vs `worker_hosted_form` (iter 3 #1).
- `executionPath` per-skill discriminator on ActionDefinition (iter 3 #1).
- Shadow response shape: distinct `{ outcome: 'shadow_settled' }` per §8.2 (iter 4 #6).

### §7 Integration Boundaries
- §7.1 per-skill `executionPath` column added; `<slug>.md` skill file convention (iter 3 #1, iter 2 #11).
- §7.2 30s deadline scope clarified to immediate response only (iter 2 #4); worker no longer writes ledger rows on timeout (iter 1 #8); `WorkerSpendCompletion` queue defined (iter 3 #2); ephemeral SPT semantics tightened (iter 1 #7).
- §7.5 webhook route `/api/webhooks/stripe-agent/:connectionId` (iter 2 #7); strict ordering of route responsibilities with dedupe before enqueue (iter 3 #7); aggregate updates on refund / dispute paths (iter 1 #13, iter 2 #5).
- §7.6 three mutually-exclusive aggregate write paths spelled out (iter 2 #5).

### §8 Contracts
- §8.2 `executionPath` + `providerChargeId`/`chargeToken` discriminators (iter 3 #1).
- §8.3 `skillRunId` (renamed from `agentRunId`) + `toolCallId` + `args` for idempotency-key recompute (iter 4 #5, iter 2 #2).
- §8.4 decision union `'approved' | 'blocked' | 'pending_approval'` — `denied` reserved for workflow-resume channel (iter 3 #4).
- §8.4a (new) `WorkerSpendCompletion` contract (iter 3 #2).
- §8.5 limit comments aligned with §5.1 (iter 2 #1).

### §9 Execution Safety
- §9.1 main app rebuilds idempotency key, rejects on mismatch (iter 2 #2).
- §9.3 reserved-capacity math: settled-bucket vs reserved-bucket (iter 2 #3, iter 5 #1); approval channels submit via `chargeRouterService.resolveApproval` (iter 3 #5).
- §9.4 `spend.*` events labeled as logical state-machine names not separate event rows (iter 1 #9).
- §9.5 added `(organisation_id, subaccount_id, currency)` partial unique constraint (iter 1 #2).

### §10 System Invariants
- Invariant 3 operational-discipline framing replaces cryptographic-binding overclaim (iter 5 #5, iter 1 #7).
- Invariant 9 truly-terminal set narrowed (iter 5 #1, iter 1 #5).
- Invariant 10 (blocked vs denied) reflected in worker response distinction (iter 1 #10).

### §11 Permissions and RLS
- §11.1 authority rule explicit: (holds spend_approver) AND (in scope by current role OR explicit row) (iter 1 #14).
- Default-grant cardinality: ALL admins for that scope (iter 3 #9).
- Ex-admin authority resolution: scope evaluated against CURRENT role (iter 4 #8).
- §11.3 webhook route guard updated for `:connectionId` (iter 2 #7).

### §13 Approval Channels
- §13.2 step 4 routes through `chargeRouterService.resolveApproval` (iter 3 #5).

### §14 Shadow Mode
- HITL-approved shadow charges land at `shadow_settled` (iter 1 #4).
- Conservative-defaults block: actual blocking behaviour at empty allowlist documented; one-click template merchant entries spelled out as concrete `{ id, descriptor, source }` array (iter 3 #8).
- Per-execution-path shadow behaviour spelled out (iter 4 #6).
- Retention: `organisations.shadow_charge_retention_days` (iter 1 #15).

### §16 Edge Cases
- §16.2 reserved-capacity math (iter 2 #3, iter 5 #1).
- §16.3 superseded responses live on `actions` rows (iter 2 #12).
- §16.6 webhook reconciliation owns `executed` rows lifecycle (iter 4 #2).
- §16.8 references the §5.1 mutable-on-transition allowlist (iter 1 #6).
- §16.9 reconnect metadata on actions/iee_steps not agent_charges (iter 2 #12).

### §17 Chunk Plan
- Chunk 2: `organisations.shadow_charge_retention_days` add; mutable-column allowlist + DB-side state-machine validation in trigger (iter 1 #15, iter 3 #10).
- Chunk 6: skill files use `<slug>.md` (iter 2 #11).
- Chunk 11: `agent-spend-completion` queue + `spend_completion` action type + completion-emit branches (iter 3 #2, iter 4 #7).
- Chunk 12: webhook route path with `:connectionId` (iter 4 #9).
- Chunk 13: `spend_approver` default-grant logic moved here from Chunk 16 (iter 2 #8); promote-to-live route ships as 501 stub (iter 5 #4).
- Chunk 15: replaces Chunk 13 stub with working promote-to-live (iter 5 #4).
- Chunk 16: cross-reference notes for moved items (iter 2 #8, iter 5 #4).

### §18 File Inventory
- §18.1 added `spendingBudgets.ts`, `approvalChannels.ts` (iter 1 #11).
- §18.1 removed spurious server-side `agent-spend-response` handler (iter 2 #9).
- §18.1 added `agent-spend-completion` queue handler (iter 3 #2).
- §18.1 added `server/config/spendConstants.ts` (iter 3 #6).
- §18.2 `organisations.ts` schema modification entry (iter 1 #15).
- §18.2 `actionSchema.ts`, `executionLoop.ts`, `runs.ts` cover both `spend_request` AND `spend_completion` (iter 5 #3).
- §18.3 SQL migrations cleaned to schema-only scope; state-machine guards stay in §18.2 (iter 3 #10).

### §20 Deferred / §21 Out of Scope
- Removed §20/§21 duplicates (Machine Payments Protocol, Customer-facing SPT, Auto-refund, Sales Autopilot Playbook spending) — they live in §21 only as durable product stances (iter 2 #10).
- Added "Server-minted single-use chargeToken wrapper" as deferred hardening item (iter 2 #6, iter 5 #5).

## Rejected / directional / autonomously decided findings

**Rejected findings:** None. All 51 findings across 5 iterations were classified mechanical and accepted.

**Directional / ambiguous findings:** None. Codex did not surface any pre-production-vs-staged-rollout, testing-posture, feature-flag, or architectural-direction findings across all five rounds. The spec was already aligned with the framing in `docs/spec-context.md`.

**AUTO-DECIDED items:** None. No items routed to `tasks/todo.md`.

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review across 5 iterations (the lifetime cap). However:

- The review did not re-verify the framing assumptions at the top of the spec (pre-production, rapid evolution, no feature flags, no staged rollout). If the product context has shifted since the spec was written, re-read the spec's framing sections (§19 Testing Posture is the explicit framing anchor) before calling it implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement. The agentic-commerce build is the largest product surface in the recent backlog (16 chunks, 7 new tables, 5 new skills, dual execution paths) — there may be unobvious product-design questions that only a human reading the brief alongside the spec will surface.
- The review did not prescribe what to build next. Sprint sequencing within the chunk plan, scope trade-offs (e.g. whether `worker_hosted_form` should ship in v1 or be deferred), and priority decisions are still the human's job.

**Recommended next step:** the next phase per the spec-coordinator workflow is `chatgpt-spec-review`. Run that pass to surface any remaining directional concerns from a fresh reviewer. The 5-iteration `spec-reviewer` lifetime cap has been reached — no further `spec-reviewer` runs available without human override.

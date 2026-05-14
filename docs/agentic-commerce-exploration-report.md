# Agentic Commerce Codebase Exploration Report

**Branch investigated:** `claude/stripe-agent-payments-9Og9n` @ `cd6a21a` (one commit ahead of main: the v1 brief itself)
**Date:** 2026-05-03
**Brief version:** v2 (provided alongside this exploration prompt; on-disk `docs/agentic-commerce-brief.md` is still v1 at the time of writing)

## Summary

The codebase is structurally **ready** to absorb agent-spending cleanly. Five existing primitives line up almost 1:1 with the v2 brief's needs — `integrationConnections` (encrypted secrets, OAuth lifecycle, revoke), the `actions` + policy-engine + HITL queue (gate resolution, idempotency, review surface), the workflow engine (first-class pause/resume on `pending_approval`), `costAggregates` (polymorphic-by-design, just needs new `entityType` values), and the canonical RLS pattern. Three things need real design work, not just adoption: (1) **the Stripe webhook surface does not exist yet** — the codebase has zero Stripe webhook handlers and reconciliation today is polling-only; the new build adds this from scratch; (2) **the IEE worker bypasses RLS entirely and has no charge-routing capability** — every worker-initiated charge must round-trip back to the main app via a new request/reply pg-boss queue (or HTTP callback) with explicit tenant context at the boundary; (3) **`cost_aggregates` has no RLS policy** despite being the surface the spend dashboard will query — the spend dimension is a forcing function to retrofit RLS in the same migration, otherwise agent spend leaks across orgs at the read layer. Two surprises: there is an existing `budgetReservations` table that is **purely LLM-cost reservation** (the name `Budget` is taken in this codebase to mean LLM cost ceiling — naming-conflict risk), and `slackConversationService.postReviewItemToSlack` is **a stub** (logs intent, returns), so Slack one-tap approval is multi-day work, not a free reuse.

## Key risks for the spec author

If these are missed in the spec, expect rework:

1. **Worker RLS hole.** `worker/src/` has zero RLS context propagation (`grep -rn "RLS\|set_config" worker/src/` returns nothing). All worker queries run as the unscoped pool owner. The spec must be explicit that charge requests crossing from worker to main app establish org/subaccount context at the main-app boundary via `actionService.proposeAction`'s tenant args — not via DB GUCs that the worker doesn't set.
2. **`cost_aggregates` has no RLS.** The spend build must retrofit RLS in the same migration that adds the new `entityType` values, otherwise per-subaccount margin transparency leaks across orgs at the read layer.
3. **No Stripe webhook handler exists.** Brief option (a) for §8.5 ("modify existing handler") is invalid. The build adds a new `stripeAgentWebhook.ts` route from scratch — body-parser registration order, signature verification, dedupe, and `withAdminConnection` resolution all need spec coverage.
4. **`Budget` is taken.** `budgetReservations` is the LLM cost reservation system. Calling the spend ceiling "agent budget" or "spending budget" in the spec will collide with `BudgetExceededError`, `BudgetContext`, `orgBudgets`. Use `SpendingPolicy`, `Charge`, `AgentSpend`.
5. **Slack one-tap is unimplemented.** `slackConversationService.postReviewItemToSlack` is a stub. Either scope spend approval to in-app for v1 or budget Block Kit + `/slack/interactive` callback as a separate chunk (~3-5 days).
6. **`ReviewQueuePage` has no plug-in renderer.** Adding spend means a hand-coded sibling branch in `renderProposedPayload()` keyed on `actionType` — not a registry. Spec must name the spend `actionType` strings the renderer keys on.
7. **`(skillRunId, intent)` from the brief is insufficient as the idempotency key.** Multi-charge runs and shadow→live promotion both create collision risks. Use `${VERSION}:${skillRunId}:${toolCallId}:${intent}:${sha256(canonicaliseJson(args))}` mirroring `buildActionIdempotencyKey`. UNIQUE constraint at DB layer + `ON CONFLICT DO UPDATE` (precedent: `budget_reservations`).
8. **Worker→app round-trip semantics.** pg-boss is fire-and-forget today. Spend round-trip needs request/reply — open question whether to extend pg-boss or add a sync HTTP callback. Spec must pick one.
9. **`ACTION_REGISTRY` ↔ `SKILL_HANDLERS` dual registration.** Every new spend skill must be registered in both. Orphans don't fail at compile time — they just don't dispatch.
10. **Pure/impure split is enforced.** Charge router decisions must live in `chargeRouterServicePure.ts`; the Stripe call + DB write in `chargeRouterService.ts`. Spec must structure the chunk plan around this split — otherwise no unit tests can land per the pre-prod testing posture.

---

## 8.1 Skill registry integration

**Files investigated:** `server/services/skillExecutor.ts:2069-2118, 2204-2251`, `server/services/skillParserService.ts:39-64`, `server/services/actionService.ts:128, 555-613`, `server/services/policyEngineService.ts:25, 36, 144-183`, `server/services/policyEngineServicePure.ts` (`applyConfidenceUpgrade`), `server/services/middleware/proposeAction.ts:294-322`, `server/config/actionRegistry.ts:48-117`, `server/db/schema/actions.ts:33-72`, representative SKILL.md (`server/skills/send_invoice.md`, `chase_overdue.md`, `process_bill.md`).

**What I found.** Gate level is *not* declared in SKILL.md frontmatter — the markdown describes intent in prose only and the parser at `skillParserService.ts:39-64` never reads a gate field. The single source of truth for gate values is `defaultGateLevel: 'auto' | 'review' | 'block'` on `ActionDefinition` (`actionRegistry.ts:78`), mirrored in the `actions.gate_level` column (`actions.ts:35`). At runtime the effective gate is computed in exactly one place — `actionService.resolveGateLevel()` (`actionService.ts:572-613`) — which reads (1) `policyEngineService.evaluatePolicy()`, then (2) explicit gateOverride, (3) task-level escalation, (4) agent-metadata escalation, with a "highest restriction wins" merge via the `GATE_PRIORITY` map at `actionService.ts:555`. The pre-tool middleware (`proposeAction.ts:294-322`) and the executor wrappers (`skillExecutor.ts:2069-2118, 2204-2251`) consume the resolved status (`approved | pending_approval | blocked`) — they never run policy themselves. PolicyContext already accepts arbitrary input fields for condition matching; the inline comment at `policyEngineService.ts:25` literally cites `amount_usd` as an example.

**Recommendation: option (b) — spend as an orthogonal dimension on every gate type.** Add a `spendDecision` field to the `PolicyDecision` shape (`policyEngineService.ts:36`), evaluated when the `ActionDefinition` declares a new `spendsMoney: true` flag plus a payload-field path resolver, then `higherGate()` it into the existing `decision` inside `evaluatePolicy()`. `estimatedCostMinor` already exists on both `actions` (`actions.ts:72`) and `ProposeActionInput` (`actionService.ts:128`), so the persistence path is wired. Option (a) (new gate type `spend`) breaks the closed enum at `actionRegistry.ts:78` / `actions.ts:35`, breaks the `GATE_PRIORITY` map, and conflates "what triage outcome is required" with "what triggered it" — those are two different axes today. Option (c) (executor-side check) bypasses every audit/HITL/idempotency property the gate path provides — a denial routed only through the executor would be invisible to the operator review queue.

**Open question for stakeholder:** Should a spend denial be expressible as a distinct audit reason code (`reason: 'spend_block'` on the security event written at `proposeAction.ts:307-316`) so operators can distinguish spend-policy holds from generic policy holds? Recommend yes; one-line spec decision.

---

## 8.2 IEE worker integration

**Files investigated:** `worker/src/index.ts:16-46`, `worker/src/loop/executionLoop.ts:92-258`, `worker/src/handlers/runHandler.ts`, `worker/src/handlers/browserTask.ts`, `worker/src/persistence/runs.ts:90-181, 188-261`, `worker/src/persistence/integrationConnections.ts:139-142`, `worker/src/persistence/steps.ts`, `worker/src/db.ts:11-16`, `shared/iee/actionSchema.ts:101-135`, `server/services/ieeExecutionService.ts`, `server/services/ieeUsageService.ts`, `server/services/actionService.ts:143-230`, `server/jobs/ieeRunCompletedHandler.ts`.

**What I found.** The IEE worker is a separate Node process (`worker/src/index.ts:16-46`) that consumes pg-boss jobs from `iee-browser-task` / `iee-dev-task` and runs an LLM-driven Playwright loop. It shares the Drizzle schema with the main app via its own pg pool (`worker/src/db.ts:11-16`) and writes terminal state directly to `iee_runs` + releases the `budget_reservations` row in a single tx (`worker/src/persistence/runs.ts:90-137`). The execution-action vocabulary is fixed and deliberately low-level: `navigate / click / type / extract / download / done / failed` (`shared/iee/actionSchema.ts:101-135`). There is **no** `purchase`, `charge`, `pay`, or `spend` action, and no `actionService` / chargeRouter import anywhere under `worker/src/`. **The worker bypasses RLS entirely** — `grep -rn "RLS\|set_config" worker/src/` returns nothing; all worker queries run as the unscoped pool owner. The worker's only outbound signal back to the main app is the `iee-run-completed` pg-boss event from `finalizeRun` (`worker/src/persistence/runs.ts:151-181`), consumed by `server/jobs/ieeRunCompletedHandler.ts`.

**Recommendation: option (a) — call back to the main app's `chargeRouterService` via the existing pg-boss boundary.** When the LLM in the loop decides "I need to checkout for $X at merchant Y," the worker emits a new `iee-spend-request` pg-boss job (mirroring the `iee-run-completed` pattern at `worker/src/persistence/runs.ts:151-169`) carrying `{ ieeRunId, agentRunId, organisationId, subaccountId, agentId, intent, amountMinor, merchant, idempotencyKey }`. The main-app handler resolves to `chargeRouterService` → `actionService.proposeAction` (already returning `approved | pending_approval | blocked` and already wired into HITL via the `pending_approval` queue at `actionService.ts:208-225`). Auto-approved charges return an SPT-bearing `chargeToken`; the worker fills the merchant's payment form with the token and observes the success page. Option (b) (worker-local chargeRouter) is rejected because it duplicates Stripe SDK + RLS context + policy table + HITL queue across two processes, and grants the worker direct read of `integrationConnections.secretsRef` for SPTs (the worker already does this for web-login passwords at `worker/src/persistence/integrationConnections.ts:139-142` and audits each read, but each new secret class doubles the blast radius). Option (c) (pre-minted permits) breaks the brief's hard rule that "No code path may charge without a ledger row" (v2 §6).

**Architectural gotchas.** (1) The worker's pg-boss event is fire-and-forget with retry on NULL `event_emitted_at` (`worker/src/persistence/runs.ts:188-240`); a spend round-trip needs **request/reply** semantics — either a synchronous HTTP callback to the main app, or a per-request reply queue with a deadline + the `assertWorkerOwnership` pattern (`runs.ts:249-261`) extended to "assert this charge is still mine." (2) RLS context propagation is the biggest hole — the worker has no Express middleware to populate RLS GUCs, so a charge request crossing into the main app must establish org/subaccount GUCs at the boundary (use `actionService.proposeAction`'s tenant args, not RLS). (3) `iee_steps` already records every loop action (`worker/src/persistence/steps.ts`); a `spend_request` action should be added to `actionSchema.ts` so the audit trail is uniform.

**Open question for stakeholder:** Sync HTTP callback vs pg-boss request/reply queue for the worker→app charge round-trip. pg-boss is internally consistent (one transport); HTTP is simpler to author and easier to timeout.

---

## 8.3 Workflow engine integration

**Files investigated:** `server/services/workflowEngineService.ts:24-32, 907, 1032-1036, 1066-1076, 1414-1425, 1632-1633, 1741-1779, 2538`, `server/services/workflowRunService.ts`, `server/services/workflowStudioService.ts`, `server/services/flowExecutorService.ts`, `server/services/workflowActionCallExecutor.ts:98-125`, `server/lib/workflow/types.ts:18-26, 225, 230-238, 254-282`, `server/lib/workflow/actionCallAllowlist.ts:24-65`, `server/db/schema/workflowRuns.ts:117-203`, `migrations/0221_rename_playbooks_to_workflows.sql:9-27`.

**What I found.** Migration `0221_rename_playbooks_to_workflows.sql` renamed all playbook_* tables/columns to workflow_*, and the rename is clean in code (residual `playbook` references live only in skill markdown, assistant prompts, and one comment in `server/lib/workflow/types.ts:3` — non-blocking but worth a sweep). The engine is tick-driven (`workflowEngineService.ts:24-32`) and step types are a closed union: `prompt | agent_call | user_input | approval | conditional | agent_decision | action_call | invoke_automation` (`types.ts:18-26`, mirrored in DB at `workflowRuns.ts:117-125`). The pause/resume primitive is **first-class and battle-tested**: `WorkflowStepRunStatus` includes `awaiting_input` and `awaiting_approval` (`workflowRuns.ts:127-135`), the engine drives the run-level aggregate from those states (`workflowEngineService.ts:907`), and `action_call` steps already integrate with HITL via `WorkflowStepReviewService.requireApproval` (`workflowEngineService.ts:1032-1036, 1418-1425`) and `actionService.proposeAction` (`workflowActionCallExecutor.ts:98-125`). Resumption goes through `completeStepRunFromReview` → `completeStepRunInternal` → `enqueueTick`. `action_call` is allowlist-gated by `ACTION_CALL_ALLOWED_SLUGS` (`actionCallAllowlist.ts:24-65`).

**Recommendation: option (b) — any skill step (`action_call` or `invoke_automation`) can spend if its underlying skill is spend-enabled. NO new `spend` step type.** The brief frames spending as **skill primitives** (`purchase_resource`, `pay_invoice`, `subscribe_to_service`, `top_up_balance`, "each a thin shell over chargeRouterService" per v2 §2). These are skill-layer verbs, not workflow control-flow. `action_call` already enforces a closed allowlist, already routes through `actionService.proposeAction` (which already does policy + HITL gating), and the engine already pauses on `pending_approval` (`workflowEngineService.ts:1414-1425`) and resumes on review completion (`:1741-1779`). Idempotency is already keyed via `idempotencyScope: 'run' | 'entity'` (`types.ts:230-238`) which dovetails with the `(skillRunId, intent)` requirement in v2 §6. `invoke_automation` (`types.ts:254-282`) already has a `gateLevel: 'auto' | 'review'` resolved from the Automation's declared `side_effects` — spending automations declare `side_effects: 'mutating'` and naturally land at `'review'` until policy promotes them. Option (a) (new step type) duplicates a parallel propose/approve/execute state machine. Option (c) (hybrid step that delegates to skills) adds a step type with no semantic content beyond what `action_call` already provides.

**Open question for stakeholder:** Should `purchase_resource` etc. be added to the existing `ACTION_CALL_ALLOWED_SLUGS` constant or its own `SPEND_ACTION_ALLOWED_SLUGS` namespace? Brief implies the latter; minor architectural call.

---

## 8.4 Per-tenant secret storage for SPT

**Files investigated:** `server/db/schema/integrationConnections.ts:13-78`, `server/services/connectionTokenService.ts:21-23, 30-38, 55-62, 132-176, 186-245`, `server/services/integrationConnectionService.ts:192-209, 453-590`, `server/adapters/stripeAdapter.ts:11-50`, `migrations/0168_p3b_canonical_rls.sql:319-371`.

**What I found.** The `integrationConnections` schema is well suited for SPT storage with one new `providerType` union member. The schema already has `accessToken` (line 33), `refreshToken` (line 34), `tokenExpiresAt` (line 35), `claimedAt` / `expiresIn` (lines 40-41, Activepieces-style to avoid clock drift), `oauthStatus` enum including `'expired'` and `'disconnected'` (lines 45-46), `connectionStatus` including `'revoked'` (line 26), and per-tenant scoping via `organisationId` / `subaccountId` (lines 17-21). Encryption-at-rest is real: `connectionTokenService.encryptToken` (`connectionTokenService.ts:55-62`) uses AES-256-GCM with a versioned key prefix (`k1:iv:authTag:ciphertext`), and the `KEY_REGISTRY` (lines 30-38) supports rotation. Revocation is a first-class operation: `revokeOrgConnection` (`integrationConnectionService.ts:192-209`) sets `connectionStatus: 'revoked'` and nulls both tokens. RLS is forced on the table — see migration `0168_p3b_canonical_rls.sql:328-329` (`ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`) with per-command policies at lines 335-371 (split because a `FOR ALL USING` would `OR` with the principal_read policy and leak).

**Recommendation.** Add `'stripe_agent'` to the `providerType` union at `integrationConnections.ts:22` and reuse the OAuth2 lifecycle columns directly: store the SPT in `accessToken` (encrypted), the refresh handle in `refreshToken`, the Stripe-issued expiry in `tokenExpiresAt` plus `claimedAt`+`expiresIn`, and treat `'oauth2'` as the SPT `authType`. Implement a new `case 'stripe_agent':` in `connectionTokenService.performTokenRefresh` (`:186-245`) that calls Stripe's token rotation endpoint. The advisory-lock-protected `refreshWithLock` flow (`integrationConnectionService.ts:453-590`) already prevents double-spend on rotation. Kill switch is already wired via `revokeOrgConnection`.

**Gaps to resolve in spec.** (1) `connectionTokenService.refreshIfExpired` (lines 132-176) hard-codes a 5-minute buffer — Stripe SPT rotation cadence may need longer pre-roll; parameterise per provider. (2) `integrationConnectionService.refreshWithLock` (lines 517-528) expects `clientIdEnc` / `clientSecretEnc` / `tokenUrl` — Stripe SPT rotation likely uses platform-level keys instead of per-connection client creds, so the refresh path needs a `stripe_agent` branch that bypasses those reads. (3) `revokeOrgConnection` (lines 192-209) only handles org-scoped (subaccountId IS NULL) revocations — needs a sibling `revokeSubaccountConnection` for SPTs scoped to a single sub-account, since v2 §7 chose one SPT per sub-account. (4) Adapter-side decryption (`stripeAdapter.ts:20`) currently reads the raw API key from `secretsRef`, not `accessToken` — the new agent flow needs to read `accessToken` via `connectionTokenService.getAccessToken(conn)` so the auto-refresh path runs.

**Open question for stakeholder:** None blocking — the four gaps above are mechanical spec items.

---

## 8.5 Stripe webhook ingestion architecture

**Files investigated:** `server/routes/webhooks/ghlWebhook.ts:9, 25, 71-78, 81-89, 104`, `server/routes/webhooks/slackWebhook.ts`, `server/routes/webhooks/teamworkWebhook.ts`, `server/routes/webhooks.ts`, `server/routes/webhookAdapter.ts`, `server/services/paymentReconciliationJob.ts:21, 125, 135-144`, `server/services/adminOpsService.ts`, `server/services/routerJobService.ts`, `server/db/schema/connectorConfigs.ts:20`, `server/adapters/stripeAdapter.ts:71`.

**What I found.** **No Stripe webhook handler exists anywhere in the codebase.** `server/routes/webhooks/` contains only `ghlWebhook.ts`, `slackWebhook.ts`, `teamworkWebhook.ts`. `server/routes/webhooks.ts` is a generic `/api/webhooks/callback/:executionId` endpoint for n8n/Make/Zapier callbacks (unrelated to Stripe). `server/routes/webhookAdapter.ts` is the agent-callback config CRUD (also unrelated). `grep -ril "stripe" server/services/ server/jobs/` returns only `adminOpsService.ts`, `routerJobService.ts` (LLM router, unrelated), and `paymentReconciliationJob.ts`. The reconciliation job (`paymentReconciliationJob.ts`) is **strictly polling** — every 15 minutes (line 21) it pulls `checkout_started` events from `conversionEvents` and calls `stripeAdapter.payments.getPaymentStatus(connection, sessionId)` (line 125), hitting Stripe's REST `/checkout/sessions/{id}` (`stripeAdapter.ts:71`). There are zero references to a Stripe signature header, `stripe-signature`, or Stripe webhook secrets in the entire `server/` tree. The `connectorConfigs.webhookSecret` column (`connectorConfigs.ts:20`) exists but is only populated for GHL today.

**Recommendation.** Brief option (a) is **invalid** — there is no existing handler to modify. Adopt option (b) (charge router subscribes to its own webhook stream) as the starting point because it isolates the agent-spend surface from a future general-purpose Stripe handler. Add `server/routes/webhooks/stripeAgentWebhook.ts` modelled on `ghlWebhook.ts`: use `raw({ type: 'application/json' })` (ghlWebhook.ts:25) so the raw body is available for HMAC, verify the `stripe-signature` header against a per-connection secret stored in `integrationConnections.configJson` (or a new `webhookSecret` column on the row), ack with 200 immediately (ghlWebhook.ts:104), then process asynchronously. Use the existing `webhookDedupeStore` (imported in ghlWebhook.ts:9) keyed on Stripe's event `id`. Wire incident reporting via `recordIncident` (ghlWebhook.ts:71-78). When a generic Stripe handler is added later, refactor to option (c) (shared handler with internal routing on `metadata.agent_initiated`) — but doing it now creates coupling burden for a non-existent consumer.

**Gaps to resolve in spec.** (1) Stripe signature verification needs the raw body — confirm Express's global JSON parser registration order doesn't consume the body before the new route runs (precedent: GitHub webhook uses a custom raw collector for this exact reason). (2) No existing pattern for per-connection Stripe webhook secrets — need to extend `integrationConnections.configJson` schema or add a column. (3) `paymentReconciliationJob` will need to deduplicate against webhook-delivered terminal events to avoid double-counting — its current dedupe relies only on `conversionEvents` rows, so both surfaces must write to the same conversion-event stream OR the new flow lives entirely in `agent_charges` and `paymentReconciliationJob` is excluded from agent-initiated rows.

**Open question for stakeholder:** Does the agent-spend webhook share a route prefix (`/api/webhooks/stripe`) with a future generic Stripe handler, or stay scoped (`/api/webhooks/stripe-agent`)? The latter is safer for shadow mode and easier to reason about; recommend that.

---

## 8.6 Cost-aggregation surface integration

**Files investigated:** `server/services/costAggregateService.ts:19-170, 177-248`, `server/db/schema/costAggregates.ts:12-19, 39`, `migrations/0024_*.sql:115, 135`, `migrations/0059_*.sql:22-24`, `migrations/0186_cost_aggregates_source_type_dimension.sql:1-16`, `migrations/0189_*.sql:79`, `migrations/0168_p3b_canonical_rls.sql` (does NOT touch `cost_aggregates`).

**What I found.** `cost_aggregates` is **polymorphic by design**: `entityType` is a free `text` column (`costAggregates.ts:15-19`), and the unique upsert key is `(entity_type, entity_id, period_type, period_key)` (line 39). New dimensions are added without DDL — migration `0186_cost_aggregates_source_type_dimension.sql:1-16` literally adds two new dimension values (`source_type`, `feature_tag`) by only updating a comment. The upsert path `costAggregateService.upsertAggregates` (`:19-170`) is hard-bound to `LlmRequest` rows: it reads `request.costWithMarginCents`, `request.tokensIn/Out`, `request.sourceType`, `request.featureTag` (lines 22-23, 81, 101, 115). Per-subaccount LLM cost is already first-class — see lines 50-53 (subaccount monthly + daily) and lines 125-131 (minute + hour rate-limit windows). **Critically: `cost_aggregates` has NO RLS policy.** `grep` across all migrations shows only `CREATE TABLE`, an `entity_idx`, a `project_id` column add, the comment-only update, and a `GRANT SELECT … TO admin_role`. Migration `0168_p3b_canonical_rls.sql` does not touch it. Today's reads rely on app-layer `WHERE entityType=…` filters (e.g. `costAggregateService.ts:194-201`).

**Recommendation: option 1 — reuse the table with new entityType values.** Add `'agent_spend_subaccount'`, `'agent_spend_org'`, and `'agent_spend_run'` as new `entityType` values in `costAggregateService` and document them in the entityType comment (mirror migration `0186` pattern). Build a parallel writer (e.g. `agentSpendAggregateService.upsertAgentSpend`) that takes a `chargeRecord` instead of `LlmRequest` and upserts the same shape — keep `totalCostCents` for spend, set `totalTokensIn/Out` to 0, reuse `requestCount` for charge count. Non-commingling because dashboards filter by `entityType`; per-subaccount filters work identically (same `entityId = subaccountId`, same `periodKey`). The new aggregate writer **must not** be invoked from `upsertAggregates` directly — the brief is explicit about not folding into LLM rollups. Option 2 (new `agent_spend_aggregates` table) is cleaner separation but loses the unified rollup query surface and requires more dashboard work.

**Gaps to resolve in spec.** (1) **The RLS gap on `cost_aggregates` is the largest finding from this slice.** The new agent-spend dimension is a forcing function to add an RLS policy in the same migration — model on `0168_p3b_canonical_rls.sql:335-350`. Without this, agent spend leaks across orgs at the read layer despite per-tenant `entityId` partitioning. (2) `costAggregateService.checkAlertThresholds` (`:177-248`) reads `workspaceLimits.monthlyCostLimitCents` and `orgBudgets.monthlyCostLimitCents` — decide whether agent spend triggers the same alerts (probably yes, but a separate cap column may be needed). (3) For per-(subaccount, agent) rollups, follow the existing `agent` dimension pattern at `costAggregateService.ts:67` — `${subaccountId}:${agentName}` composite entityId.

**Open question for stakeholder:** Confirm: does adding RLS to `cost_aggregates` ship in this build (recommended — the spend dimension is the forcing function), or as a separate hardening PR? The former is simpler; the latter unblocks the spend build if RLS retrofit on a non-tenant-scoped column shape proves harder than expected.

---

## 8.7 HITL queue category support

**Files investigated:** `server/services/hitlService.ts:55-129`, `server/services/briefApprovalService.ts:281-294`, `server/services/reviewService.ts:35-75, 230-246`, `server/services/resolveApprovalDispatchActionPure.ts:1-22`, `server/services/slackConversationService.ts:90-99` (stub), `server/db/schema/actions.ts:33`, `server/db/schema/reviewItems.ts:27-30`, `server/db/schema/policyRules.ts:1-65`, `client/src/pages/ReviewQueuePage.tsx:68-73, 370-387, 416-489`, `client/src/components/dashboard/PendingApprovalCard.tsx:10-88`, `client/src/components/brief-artefacts/ApprovalCard.tsx:20-80`, `docs/hitl-platform-dev-brief-v3.md:289-297, 419-500`, `docs/agent-orchestration-hitl-reference.md:104-111, 168-179`.

**What I found.** Two parallel HITL surfaces, neither has a first-class `category` column today: (1) the `actions` / `review_items` queue — `actions.actionCategory` exists (`actions.ts:33`) but its enum is execution-adapter-typed (`'api' | 'worker' | 'browser' | 'devops' | 'mcp'`), not user-facing taxonomy. `reviewItems.reviewPayloadJson` is a fully open jsonb blob (`reviewItems.ts:27-30`). The HITL dev brief at `docs/hitl-platform-dev-brief-v3.md:297` explicitly reserves `actions.metadata_json` as the place for "category, priority, reasoning", and existing code already reads from it (`reviewService.ts:230-232` peeks at `metadataJson.source` to branch on `'workflow_action_call'`). (2) The `BriefApprovalCard` artefact path lives inside `conversation_messages.artefacts` JSONB and carries `riskLevel`, `confidence`, `affectedRecordIds`, `actionSlug`, `actionArgs` already. **UI templating reality:** `ReviewQueuePage.tsx:370-387` renders a generic JSON `<pre>` for unknown action types with a hand-coded special case for `send_email`. The `ACTION_BADGE` map (`:68-73`) is keyed on `actionType`. There's no plug-in renderer registry — adding a `spend` shape means adding a sibling branch in `renderProposedPayload()`. `PendingApprovalCard.tsx:30-88` has Approve/Reject/Open buttons but renders `item.title` + `item.reasoning` only — no merchant/amount slots. **Slack one-tap is a stub:** `slackConversationService.postReviewItemToSlack` at `:90-99` logs intent and returns; the actual Block Kit interactive message + approve/reject callback handler is unimplemented.

**Recommendation.** Extend the existing `review_items` surface; do not add a parallel one. Concretely: (a) write `metadata_json.category: 'spend'` at write time in the spend skill handler — no DB migration required. (b) Add a new `'charge_payment_method'` (or `purchase_resource` etc.) entry to `actionRegistry.ts` so the existing gate-resolution + idempotency + retry plumbing handles it. (c) Add a `renderSpendPayload(item)` branch in `ReviewQueuePage.tsx:370` keyed on `item.reviewPayloadJson.actionType === '<spend slug>'`. Render merchant / amount minor-units / justification / shared-token last4 as inline fields. The Ads agent's `update_bid` action (`agent-orchestration-hitl-reference.md:106-111`) is the existing precedent for "spend-shaped action through review_items" — spend is just another action_type on the same machinery.

**Open question for stakeholder:** Three real blockers. (1) Should spend appear in `PendingApprovalCard` (dashboard widget) as a fourth lane alongside `client | major | internal`, or only inside `ReviewQueuePage`? (2) **Slack one-tap: blocker for v1 or follow-up?** Implementing Block Kit + the `/slack/interactive` callback is multi-day work; if scoped out, spend approval is in-app only at launch. (3) The `BriefApprovalCard` path emits an `approval_decision` artefact AND calls `proposeAction` — for spend, do we want both surfaces (in-conversation card + queue row), or queue-only?

---

## 8.8 RLS coverage audit

**Files investigated:** `architecture.md:1428-1535` (canonical RLS section), `DEVELOPMENT_GUIDELINES.md:26-91` (RLS rules + migration discipline), `server/config/rlsProtectedTables.ts`, `server/db/rlsExclusions.ts`, `server/db/withPrincipalContext.ts`, `migrations/0245_all_tenant_tables_rls.sql` (canonical batch — 217 statements across 55 tables), `migrations/0267_agent_recommendations.sql:50-66` (cleanest single-table example), `migrations/0168_p3b_canonical_rls.sql:319-371` (integration_connections principal-scoped split policies), representative existing tables: `agentRuns.ts`, `integrationConnections.ts`, `auditEvents.ts`, `costAggregates.ts`, `budgetReservations.ts`.

**Canonical RLS pattern for new tenant-scoped tables.** Codified by gate `scripts/gates/verify-rls-coverage.sh`. Every new tenant-owned table ships, in the same migration: (1) columns `organisation_id uuid NOT NULL REFERENCES organisations(id)` and `subaccount_id uuid NULL REFERENCES subaccounts(id)` — nullability is the explicit signal for "org-level" vs "subaccount-level" rows; (2) the canonical org-isolation policy from `migrations/0267_agent_recommendations.sql:50-66`:
```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS <t>_org_isolation ON <t>;
CREATE POLICY <t>_org_isolation ON <t>
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (...same...);
```
(3) a manifest entry in `server/config/rlsProtectedTables.ts` pointing at the policy migration; (4) app-level defence-in-depth via `eq(table.organisationId, ctx.organisationId)` on every read/write — gated by `verify-org-scoped-writes.sh`; (5) **`subaccount_id NULL` = org-scoped row** — predicate is org-only at the RLS layer, subaccount visibility is enforced in app code; (6) session var canon: only `app.organisation_id` (no `current_` prefix), ban enforced by `verify-rls-session-var-canon.sh`.

**Pattern-fit table for new build:**

| Table | Tenant-scoping | Pattern | Notes |
|---|---|---|---|
| `spending_policies` | `organisation_id NOT NULL`, `subaccount_id NULL`-able for org-level defaults | Canonical org-isolation, 1:1 fit | Add to `rlsProtectedTables.ts`. App code resolves subaccount visibility — do not push it into RLS. |
| `agent_charges` | `organisation_id NOT NULL`, `subaccount_id NULL`-able | Canonical org-isolation, 1:1 fit | Append-only at app level. Postgres RLS gives no native append-only enforcement; `WITH CHECK` only validates row tenancy. To enforce at the DB, use a `BEFORE UPDATE` / `BEFORE DELETE` trigger that raises, OR a separate `chrgs_writer` role with `GRANT INSERT ONLY` (mirrors the `canonical_writer` precedent in migration 0168). The codebase precedent for append-only is **app-level** — `llm_requests` and `audit_events` follow this. Recommend matching the precedent. |
| `integration_connections` (new `providerType: 'stripe_agent'`) | already protected | No new RLS work | Schema enum value addition only — existing principal-aware policy applies (`migrations/0168_p3b_canonical_rls.sql:319-371`). |
| `cost_aggregates` (new `entity_type` values) | **NOT RLS-protected today** | **Forcing function to add RLS in this build** | Polymorphic `entity_type`+`entity_id` text columns; no `organisation_id` column. Adding spend without retrofitting RLS leaks across orgs. Add `organisation_id` column + canonical org-isolation policy in same migration as the spend writer. |
| `audit_events` (new spend-related action types) | already protected | No DDL work | Just emit rows with `actorType: 'agent'` and `action: 'agent_charge.created'`-style strings. |
| `skill_idempotency_keys` (if charge router reuses it) | already protected | No work | Migration `0238_system_agents_v7_1.sql`. |
| (`agent_execution_events` LinkedEntityType extension — see §8.12) | already protected | No DDL work | Add `'spend_ledger'` to the type union in `shared/types/agentExecutionLog.ts`. |

**Deviations / flags.** (1) **Append-only at the RLS layer is not the prevailing pattern** — other ledgers (`llm_requests`, `audit_events`, `mcp_tool_invocations`, `action_events`) enforce append-only at the app layer. Going further (trigger-based `RAISE EXCEPTION ON UPDATE/DELETE`) would be a new pattern; default to following precedent. (2) **No canonical "scoped to org and subaccount in RLS" pattern exists.** The few subaccount-aware policies (P3B principal-scoped) use `app.current_subaccount_id` as part of an OR predicate, not a hard equality. If `spending_policies` rows must be invisible across subaccounts even within the same org, that is app-layer enforcement — flag for spec.

**Open question for stakeholder:** Append-only enforcement on `agent_charges` — match precedent (app-level) or upgrade to trigger-based DB enforcement for financial integrity? Recommend trigger-based for the ledger specifically, even if it deviates from precedent — financial records are a stronger durability case than debug events.

---

## 8.9 Idempotency-key conventions

**Files investigated:** `server/services/actionService.ts:60-100, 150-165, 377-398`, `server/services/skillIdempotencyKeysPure.ts`, `server/db/schema/skillIdempotencyKeys.ts`, `server/services/budgetService.ts:381-389` (the "H-1" pattern), `server/config/actionRegistry.ts:53-71, 90`, `server/lib/pgBossInstance.ts`, `migrations/0185_*.sql` (`replay_of_action_id` column).

**What I found.** Three coexisting idempotency patterns: (1) `actions.idempotencyKey` text column, key built by `buildActionIdempotencyKey(runId, toolCallId, args)` (`actionService.ts:90-100`) with shape `${IDEMPOTENCY_KEY_VERSION}:${runId}:${toolCallId}:${sha256(canonicaliseJson(args))}`. Matched on insert with explicit org-scope (`:150-165`); duplicate detected → returns existing row with `isNew: false`. (2) `skill_idempotency_keys` table — different mechanism, PK `(subaccountId, skillSlug, keyHash)` where `keyHash` is derived from a declarative `IdempotencyContract.keyShape: string[]` (dot-paths into `ActionContext`) declared per action in `actionRegistry.ts:62-71`. Three TTL classes (`permanent` / `long` / `short`) and three strategies (`read_only` / `keyed_write` / `locked`). (3) `budget_reservations.idempotency_key` — true UNIQUE column, `ON CONFLICT DO UPDATE` returns the winning row (the "H-1" pattern at `budgetService.ts:381-389`). Used by the LLM router to dedupe concurrent reservations.

The retry-vs-replay contract is non-negotiable (`actionService.ts:76-89`): retry = same `runId`+`toolCallId`+`args` → same key → row reused, `retryCount += 1`; replay = new `runId` or new `toolCallId` → new key → new row, with `replay_of_action_id` (column in migration 0185) pointing back. Retries trigger app-layer (`markFailed` bumps `retry_count` + emits `retry_scheduled`; pg-boss handles transport-level retries with stable payloads).

**Recommendation.** `(skillRunId, intent)` from the brief is **insufficient on its own** — collisions on multi-charge runs, and shadow→live promotion semantics get confused. Mirror the `actions` precedent: `${CHARGE_KEY_VERSION}:${skillRunId}:${toolCallId}:${intent}:${sha256(canonicaliseJson(args))}` where `CHARGE_KEY_VERSION` is a new prefix constant. `toolCallId` ensures distinctness for multi-charge runs; `args`-hash catches argument drift between attempts. If shadow→live promotion is a deliberately-new charge, encode the mode into `intent` (`charge:live`, `charge:shadow`) so promotion produces a fresh key by design. **Where it lives:** mirror `budget_reservations` — UNIQUE constraint on `agent_charges.idempotency_key` at the DB layer with `INSERT ... ON CONFLICT DO UPDATE` returning the winner (`budgetService.ts:381-389` H-1 precedent). Don't rely on app-level "check then insert" — that races. Declare `idempotencyStrategy: 'keyed_write'` on the new ACTION_REGISTRY entries (`actionRegistry.ts:53,90`) — gate `verify-idempotency-strategy-declared.sh` enforces this.

**Open question for stakeholder:** Is the shadow→live transition a new charge or a status flip on an existing charge row? If status flip, the key shouldn't include intent. Recommend: shadow charges write a real ledger row with `mode: 'shadow'` and `status: 'shadow_settled'`; promoting "shadow→live" for the policy itself does not retroactively re-issue past charges — it only changes what happens for future charges. So the key includes mode and shadow→live promotion is policy-level, not charge-level.

---

## 8.10 Existing skills that mention money

**Files investigated:** all 18 candidate skill markdown files matched by `grep -l -iE "payment|invoice|refund|charge|subscrip|billing|spend|purchase|stripe" server/skills/*.md`.

**Audit table:**

| Skill | File path | Money behaviour today | Recommendation |
|---|---|---|---|
| `analyse_performance` | `server/skills/analyse_performance.md` | Pure analytics — reads campaign metrics + spend, recommends downstream actions; no money movement. | Leave unchanged. Informs spend skills but never spends. |
| `chase_overdue` | `server/skills/chase_overdue.md` | Drafts dunning text only ("Do not send — that requires human review", line 16). No write. | Leave unchanged. |
| `detect_churn_risk` | `server/skills/detect_churn_risk.md` | Read-only signal scoring; references payment status as a churn signal but does not transact. | Leave unchanged. |
| `increase_budget` | `server/skills/increase_budget.md` | Block-gated proposal that increases ad-platform daily budget — *indirect* spend authorisation. Currently MVP-stub (`pending_integration`). | **Retrofit (primary candidate).** When the platform write API lands, this is the prototype "scoped policy" customer: spend cap = projected weekly delta. Wire spend dimension. |
| `process_bill` | `server/skills/process_bill.md` | Records inbound bill + creates review item; no outbound payment. | Leave the recording step unchanged; this is the natural feeder for the new `pay_invoice` primitive. |
| `generate_invoice` | `server/skills/generate_invoice.md` | Builds invoice object only. No transaction. | Leave unchanged. |
| `read_revenue` | `server/skills/read_revenue.md` | Read-only stub. | Leave unchanged. |
| `pause_campaign` | `server/skills/pause_campaign.md` | Block-gated proposal that *stops* spend — risk surface is opposite (lost opportunity, not over-spend). | Leave unchanged. Spend policy is for outflows; pausing is the wrong axis. |
| `reconcile_transactions` | `server/skills/reconcile_transactions.md` | Read + diff between Stripe payouts and ledger. No write. | Leave unchanged. |
| `send_invoice` | `server/skills/send_invoice.md` | Delivers an invoice via Stripe/email. Triggers a *receivable* — money flows *to* the org. | Leave unchanged. Spend policy governs outflows; AR delivery is out of scope. |
| `track_subscriptions` | `server/skills/track_subscriptions.md` | Read-only portfolio fetch + flagging. | Leave unchanged. |
| `update_bid` | `server/skills/update_bid.md` | Review-gated proposal; bid changes alter spend velocity but do not directly authorise a charge. MVP stub. | **Retrofit (lower priority than `increase_budget`).** Bid changes alter daily-spend rate; spend policy could cap projected delta. |
| `classify_email`, `draft_reply`, `draft_requirements`, `read_campaigns`, `search_knowledge_base`, `weekly_digest_gather` | various | Money-mention is incidental text; no money-axis behaviour. | Leave unchanged. |

**Slotting the new primitives.** All four are net-new — none of the existing skills should be renamed/repurposed. Each lands in `actionRegistry.ts` with `actionCategory: 'api'`, `directExternalSideEffect: true`, `idempotencyStrategy: 'locked'` (Stripe SPTs are exactly the "no native dedupe story" case described at `actionRegistry.ts:48-51`), and `requiredIntegration: 'stripe_agent'` (a new slug to add to `REQUIRED_INTEGRATION_SLUGS` at `actionRegistry.ts:58`):
- **`pay_invoice`** — outbound disbursement primitive. `process_bill` is the feeder. `defaultGateLevel: 'review'` initially.
- **`subscribe_to_service`** — vendor signup primitive. `track_subscriptions` is the read-side mirror.
- **`purchase_resource`** — one-shot purchase primitive. No existing analogue.
- **`top_up_balance`** — prepaid-balance top-up primitive. Closest existing semantic is `increase_budget`, but that's *provider-side cap* (ad-platform budget), not cash movement. Distinct concept; ship as a new skill.

**Open question for stakeholder:** None — the table is a recommendation; spec author can adopt as-is.

---

## 8.11 Adaptive Intelligence Routing impact

**Files investigated:** `server/services/agentExecutionService.ts:2360-2424, 2538`, `server/services/agentExecutionServicePure.ts:43-63, 485-520, 532-542`, `server/services/intelligenceSkillExecutor.ts`, `server/services/llmRouter.ts:374-402`.

**What I found.** The three "tiers" the brief mentions are not separate agents — they are phases on a single agent loop selected by the pure helper `selectExecutionPhase(iteration, previousResponseHadToolCalls, totalToolCalls)` at `agentExecutionServicePure.ts:43-63`, which returns `'planning' | 'execution' | 'synthesis'`. The phase is consumed by `runAgenticLoop` at `agentExecutionService.ts:2538` and passed to `routeCall(...)` (`llmRouter.ts:374-402`) where it drives model-tier selection (`'frontier' | 'economy'`). A *literal* planning prelude does run for "complex" runs (`isComplexRun()` at `agentExecutionServicePure.ts:532-542`) — `agentExecutionService.ts:2360-2424` issues a tools-disabled planning call, parses the resulting JSON plan via `parsePlan()` (`agentExecutionServicePure.ts:485-520`), persists it to `agentRuns.planJson`, and re-injects it as a `<system-reminder>`. **Crucially, the policy-gate hook (`proposeActionMiddleware`) only fires on actual tool calls** — `planning` mode passes `tools: undefined` (`:2381`), so no `proposeAction()` is called and the policy engine never sees the plan.

**Recommendation: planning-phase pre-check, ADVISORY-only.** Run a spend-policy preview against each `tool` named in the parsed plan and feed the result back into the same `<system-reminder>` block injected at `agentExecutionService.ts:2411-2414`. Do not block — the planner is offline-thinking and the live policy engine still runs at execution time via `proposeAction.ts:294-322` (the only place that creates the audit row, the suspend window, and the review-queue entry). Authoritative gating must stay at execution time. The plan-parse step already swallows failure non-fatally (`:2419-2421`), so an advisory check fits the same fail-open posture. A pure helper `previewSpendForPlan(plan, definitions, policyRules)` would return per-action `'would_auto' | 'would_review' | 'would_block' | 'over_budget'` and the planner revises *before* burning execution-tier tokens on a doomed plan.

**Open question for stakeholder:** The current planner runs with `routingMode: 'ceiling'` (`agentExecutionService.ts:2391`) — frontier tier always. Should the spend preview run on the same tier, or always on a deterministic non-LLM evaluator? Recommend deterministic — `policyEngineService.evaluatePolicy` is already deterministic + DB-backed and needs no LLM for the preview.

---

## 8.12 Audit log cross-reference

**Files investigated:** `server/services/auditService.ts:4-21`, `server/db/schema/auditEvents.ts:1-41`, `server/services/agentActivityService.ts`, `server/services/agentExecutionEventService.ts:113-178`, `server/db/schema/agentExecutionEvents.ts:1-67`, `server/db/schema/workspaceMemories.ts:74-196`, `shared/types/agentExecutionLog.ts:64-81`.

**What I found.** Three observability streams exist; they overlap in coverage but serve very different consumers: (1) **`agent_execution_events`** — per-run typed event log with discriminated-union payloads enumerated in `shared/types/agentExecutionLog.ts:64-81` (`run.started`, `prompt.assembled`, `skill.invoked`, `skill.completed`, `llm.requested`, `llm.completed`, `tool.error`, `run.completed`, etc.). Has `linkedEntityType` + `linkedEntityId` for cross-references, sequence numbers per run, critical-vs-noncritical retry tier, capped at `AGENT_EXECUTION_LOG_MAX_EVENTS_PER_RUN` per run. Scoped to a single `runId` — emphatically a debugging trace, not a financial record. (2) **`workspace_memories` / `workspace_memory_entries`** — LLM-curated insights ("observation", "decision", "preference", "issue", "pattern") extracted from runs, scored, embedded, summarised. Subject to soft-delete, decay, utility re-scoring — explicitly mutable. Wrong shape for an immutable financial record. (3) **`audit_events`** — lightweight polymorphic security log (`actorId / actorType / action / entityType / entityId / metadata jsonb / correlationId`). Service is **fire-and-forget** (`auditService.ts:17-19` — `try/catch + console.error`, no throw). Used at ~16 sites across `agentService`, `inboxService`, `webhookAdapterService`, `orgSettingsService`, `portalConfigService`, `scheduledTaskService`, `reviewService`. Semantically a "who did what to which entity" trail — no money-typing, no minor-unit columns, no provider IDs, no reconciliation hooks. Today, a charge attempt would land nowhere coherently — `skill.invoked` + `skill.completed` (transient, run-scoped, cap-droppable) plus probably an `auditService.log({ action: 'spend.charged' })` row (best-effort, fire-and-forget) — exactly the "effectively useless" failure mode the v2 brief warns against.

**Recommendation: independent ledger, with a single cross-reference event in `agent_execution_events`.** The spend ledger is a dedicated table with strict columns (`amount_minor, currency, merchant, status, provider_charge_id, idempotency_key, shared_token_id, run_id, action_id, policy_rule_id, decision_path, mode`) and DB-enforced invariants. **Throws on insert failure** — opposite of `auditService.log`'s swallow contract. Emit a single event per attempt — extend `LinkedEntityType` in `shared/types/agentExecutionLog.ts` with `'spend_ledger'` and emit a `skill.completed`-class event with `linkedEntityType: 'spend_ledger'` + `linkedEntityId: <ledger_row_id>`. This gives the live run-timeline UI a "charge attempted → see ledger row" link without conflating the streams. **Do NOT also write to `audit_events`** — two cross-refs creates exactly the silo-multiplication risk; `audit_events`' fire-and-forget contract is the wrong durability guarantee for financial records. Do NOT route through `workspace_memory_entries` — its decay/utility/soft-delete machinery would corrupt the ledger.

**Open question for stakeholder:** Confirm the new `LinkedEntityType` value — `'spend_ledger'`, `'charge'`, or `'payment_attempt'`? Recommend `'spend_ledger'` (matches table name).

---

## 8.13 Branch and migration audit

**Files investigated:** `git log main..HEAD --oneline`, `git diff main...HEAD --stat`.

**Branch state.** `claude/stripe-agent-payments-9Og9n` is **one commit ahead of main**: `cd6a21a docs: add agentic commerce development brief` (the v1 brief itself, +176 lines, single file `docs/agentic-commerce-brief.md`). No other commits, no in-progress code, no migrations. Nothing on the branch needs to be incorporated or superseded by the new build.

**Recommendation.** Per the v2 brief §10, rename the branch to `claude/agentic-commerce-spending` before spec-coordinator runs (the v1 commit can carry over via cherry-pick or a clean checkout — the rename has no merge risk because the branch is one commit). The v1 brief on disk should be replaced with v2 content in the same commit that this report lands on the renamed branch, so the spec-coordinator handoff is internally consistent.

**Open question for stakeholder:** None.

---

## 8.14 Additional findings (Claude Code judgement)

**Naming-conflict warning — `Budget`.** `server/db/schema/budgetReservations.ts` and `server/services/budgetService.ts` already exist and are **purely the LLM-cost reservation system** (header comment is explicit: "Created before each LLM call. Budget checks include active reservations so two concurrent requests each see each other and block correctly"). Unit is `estimated_cost_cents` (LLM cost based on `llmPricing` × token estimates), not real money. Used by `llmRouter.ts:590`, `routerJobService.ts`, `queueService.ts`, `ieeExecutionService.ts`. The hierarchy in `budgetService.ts:17-26` lists 8 cost caps — all of them LLM/agent-call caps. No real-money / Stripe path touches it. **Implication:** the name `Budget` is taken in this codebase to mean "LLM cost ceiling." A spec that says "agent budget" or "spending budget" without qualifier will collide with `BudgetExceededError`, `BudgetContext`, `orgBudgets`, `workspaceLimits.monthlyCostLimitCents`. Mention this explicitly in the spec glossary. The two-phase reservation pattern (reserve → commit/release with idempotency_key UNIQUE, advisory-lock on `acquireOrgBudgetLock`) is a **strong precedent worth borrowing** for `agent_charges` mid-flight rows — handles racing concurrent requests cleanly.

**Pure / impure split convention.** `xxxService.ts` = impure (Drizzle, network, env). `xxxServicePure.ts` = pure decisions, plain inputs/outputs, fully unit-tested via Vitest. Enforced by `verify-pure-helper-convention.sh` — `*Pure.ts` files cannot transitively import DB. **Charge router decisions (policy match, cap math, intent normalisation) belong in `chargeRouterServicePure.ts`; the Stripe call + DB write goes in `chargeRouterService.ts`.** Without this split, no unit tests can land per the testing posture (`DEVELOPMENT_GUIDELINES.md:100-102`).

**Money columns convention.** All monetary values are `integer ('xxx_cents')` (e.g. `estimated_cost_cents`) — no Decimal/numeric for money in the existing precedent. `cost_aggregates.totalCostRaw` is the only `numeric(12,8)` and that's for sub-cent LLM token math. Charge ledger: `amount_minor INTEGER NOT NULL` + `currency TEXT NOT NULL`.

**British spelling — `organisation_id`.** Always. Mixing `organization_id` breaks RLS predicates and the gates won't catch it.

**Schema files are leaves.** May only import from `drizzle-orm`, `shared/types/**`, and other schema files. Never from `services/`, `lib/`, `routes/`, `middleware/` (`DEVELOPMENT_GUIDELINES.md:51`). One violation drove 175 circular cycles per the doc.

**Migration discipline.** Append-only. Numbers assigned at merge time — use `<NNNN>_<name>.sql` placeholder during PR, rename to next available before merge. Migration + Drizzle schema file land in the **same PR**. Down migration as `<NNNN>_<name>.down.sql`. Every new table must either appear in `RLS_PROTECTED_TABLES` with full policy, OR carry a `-- system-scoped: <reason>` header comment. Neither = gate failure.

**Service-layer access patterns.** Routes and `server/lib/**` **never import `db` directly** — go through a service (gate `verify-rls-contract-compliance.sh`). For Stripe webhook ingestion (no auth context): use `withAdminConnection` + immediately resolve the org from the connection ID, then call services with that org ID. Precedent: `paymentReconciliationJob.ts`.

**External-call ordering.** Two rules pull opposite ways: §8.10 says "persist state-claim first, then trigger side effect"; §8.12 says "run external calls that can fail before persisting rows that depend on them." Codebase resolution (used by `paymentReconciliationJob` and `budgetService.checkAndReserve`): **claim a reservation row, call out, then commit or release.** Apply directly to charging: `INSERT agent_charges (status='pending')` → call Stripe → `UPDATE status='succeeded'|'failed'`. Webhook reconciliation closes the loop for missed responses.

**Subaccount param resolution.** Any route with `:subaccountId` URL param **must** call `resolveSubaccount(req.params.subaccountId, req.orgId!)` before consuming it (gate `verify-subaccount-resolution.sh`). Skipping it allows horizontal privilege escalation even with RLS in place.

**State-machine guard pattern.** Every code path that writes a terminal status to a state-machine row calls `shared/stateMachineGuards.ts::assertValidTransition` immediately before the UPDATE. `agent_charges` should be wired into this — `pending → succeeded | failed | refunded | disputed | shadow_settled`.

**Test posture.** Pre-production phase: **Vitest unit tests only**, on pure helpers. No Jest/Playwright/supertest/E2E until `docs/spec-context.md` flips. So `chargeRouterServicePure.ts` gets thorough coverage (policy resolution, cap math, intent normalisation, mode discrimination); `chargeRouterService.ts` gets the gates only.

**ACTION_REGISTRY ↔ SKILL_HANDLERS dual registration.** Every entry in `ACTION_REGISTRY` (`actionRegistry.ts`) **must** also be registered in `SKILL_HANDLERS` in `skillExecutor.ts` (rule §8.23, `DEVELOPMENT_GUIDELINES.md:200-202`). Orphaned registrations don't error at compile time — they just don't dispatch. Spec must call this out explicitly when introducing the four new spend skills.

**Workflow rename residuals.** Migration `0221_rename_playbooks_to_workflows.sql` cleaned the engine, but residual `playbook` references remain in skill markdown (`server/skills/*.md`), assistant prompts (`server/config/configAssistantPrompts/*`), and one comment in `server/lib/workflow/types.ts:3`. Non-blocking, but a sweep before this build commits would be hygienic.

---

## Recommended naming and structure

These are concrete proposals the spec author should be able to take as-is. All names follow the conventions in §8.14.

**New tables (Drizzle schema files in `server/db/schema/`):**
- `spending_policies` (`spendingPolicies.ts`) — per agent / per skill / per subaccount, version-tracked, mode flag (`shadow | live`).
- `agent_charges` (`agentCharges.ts`) — the spend ledger, append-only, denormalised with `organisation_id NOT NULL` + `subaccount_id NULL`, UNIQUE on `idempotency_key`.

**Schema modifications:**
- `integration_connections.providerType`: add `'stripe_agent'` to the union (`integrationConnections.ts:22`).
- `cost_aggregates.entityType`: add three new dimension values via comment-only migration (precedent: `0186_cost_aggregates_source_type_dimension.sql`) — `'agent_spend_subaccount'`, `'agent_spend_org'`, `'agent_spend_run'`. **Add `organisation_id` column + canonical RLS policy in the same migration.**
- `actions`: no schema change — use `metadata_json.category: 'spend'` discriminator (precedent: `reviewService.ts:230-232`).
- `shared/types/agentExecutionLog.ts`: add `'spend_ledger'` to `LinkedEntityType` union.

**New services:**
- `chargeRouterService.ts` + `chargeRouterServicePure.ts` (mandatory pure/impure split).
- `agentSpendAggregateService.ts` (parallel writer to `costAggregateService`, separate file so it cannot accidentally fold into LLM rollups).
- `spendingPolicyService.ts` + `spendingPolicyServicePure.ts` (CRUD + policy resolution).
- `sptVaultService.ts` (extends `connectionTokenService` rather than parallel; SPT lifecycle helpers).
- `stripeAgentWebhookService.ts` (new file in `server/services/`, called from the new route).

**New routes:**
- `server/routes/webhooks/stripeAgentWebhook.ts` — modelled on `ghlWebhook.ts`, mounted at `/api/webhooks/stripe-agent` (scoped path keeps it disambiguated from any future general-purpose Stripe handler).
- `server/routes/spendingPolicies.ts` — CRUD for the policy admin UI.
- `server/routes/agentCharges.ts` — read-only ledger queries for the spend dashboard.

**New `actionRegistry.ts` entries (4 skills):**
- `purchase_resource`, `pay_invoice`, `subscribe_to_service`, `top_up_balance` — all `actionCategory: 'api'`, `directExternalSideEffect: true`, `idempotencyStrategy: 'locked'`, `requiredIntegration: 'stripe_agent'`, `defaultGateLevel: 'review'` initially. Plus a new `spendsMoney: true` flag on `ActionDefinition`.

**New `ACTION_CALL_ALLOWED_SLUGS` entries.** The four spend slugs above. Recommend a sibling constant `SPEND_ACTION_ALLOWED_SLUGS` so the spend surface is filterable for review-tooling, then concat into `ACTION_CALL_ALLOWED_SLUGS`.

**HITL / review changes:**
- New `category: 'spend'` written to `metadata_json` at action creation.
- New `reviewKind: 'spend_approval'` (existing field at `workflowEngineService.ts:1033, 1632-1633`) for the workflow-engine resume path.
- New `renderSpendPayload(item)` branch in `client/src/pages/ReviewQueuePage.tsx:370` keyed on `actionType`.

**pg-boss queues (worker round-trip):**
- `iee-spend-request` — worker → main app, payload `{ ieeRunId, agentRunId, organisationId, subaccountId, agentId, intent, amountMinor, merchant, idempotencyKey }`.
- Reply mechanism: pg-boss request/reply queue pattern OR sync HTTP callback (open question — see §8.2).

**Glossary terms for the spec:**
- "Spending policy" — never "budget" (collides with LLM budget).
- "Charge" / "agent charge" — the unit row in `agent_charges`.
- "SPT" — Stripe Shared Payment Token, stored as the `accessToken` on a `stripe_agent` `integrationConnection`.
- "Shadow mode" — `spending_policies.mode = 'shadow'`; charge attempts produce ledger rows with `mode: 'shadow'` and `status: 'shadow_settled'`, no Stripe call.
- "Kill switch" — three-level revocation: per-policy (`spending_policies.disabled_at`), per-subaccount (revoke all `stripe_agent` connections in subaccount), per-org (revoke all `stripe_agent` connections in org).

---

## Estimated implementation surface

Rough, for spec-coordinator chunk sizing — not a commitment.

**New files (~14):**
- 2 schema files (`spendingPolicies.ts`, `agentCharges.ts`).
- 2 migration files (one for both tables + RLS; one for `cost_aggregates` RLS retrofit + new entityType comment).
- 5 service files (chargeRouter + Pure, spendingPolicy + Pure, agentSpendAggregate, sptVault, stripeAgentWebhookService).
- 1 webhook route (`stripeAgentWebhook.ts`).
- 2 admin routes (spendingPolicies, agentCharges).
- 4 skill markdown files (`pay_invoice.md`, `purchase_resource.md`, `subscribe_to_service.md`, `top_up_balance.md`).
- ~6 client-side files for the spend dashboard + policy editor + review-card branch (depends on UX design).

**Modified files (~12):**
- `server/db/schema/integrationConnections.ts` (+1 enum value).
- `server/services/connectionTokenService.ts` (+`stripe_agent` refresh case).
- `server/services/integrationConnectionService.ts` (+`revokeSubaccountConnection`).
- `server/adapters/stripeAdapter.ts` (read `accessToken`, not `secretsRef`, when `stripe_agent`).
- `server/services/policyEngineService.ts` (+ `spendDecision` field on `PolicyDecision`).
- `server/services/policyEngineServicePure.ts` (+ pure spend evaluator).
- `server/services/actionService.ts` (`resolveGateLevel` consumes spendDecision in higherGate merge).
- `server/services/middleware/proposeAction.ts` (+ `spend_block` audit reason path).
- `server/services/agentExecutionService.ts` (+ advisory spend preview in planning prelude).
- `server/config/actionRegistry.ts` (+ 4 new skills, + `spendsMoney` flag, + `stripe_agent` integration slug).
- `server/services/skillExecutor.ts` (+ 4 new SKILL_HANDLERS entries).
- `server/lib/workflow/actionCallAllowlist.ts` (+ 4 new allowed slugs OR new `SPEND_ACTION_ALLOWED_SLUGS` constant).
- `server/services/costAggregateService.ts` (+ entityType comment update).
- `server/services/agentExecutionEventService.ts` + `shared/types/agentExecutionLog.ts` (+ `'spend_ledger'` LinkedEntityType).
- `server/config/rlsProtectedTables.ts` (+ `spending_policies`, `agent_charges`, `cost_aggregates`).
- `worker/src/loop/executionLoop.ts` (+ spend-request emit branch).
- `worker/src/persistence/runs.ts` (+ `iee-spend-request` event helper, mirroring `iee-run-completed`).
- `shared/iee/actionSchema.ts` (+ `spend_request` action).
- `shared/stateMachineGuards.ts` (+ `agent_charges` state machine).
- `client/src/pages/ReviewQueuePage.tsx` (+ `renderSpendPayload` branch + ACTION_BADGE entries).
- (Optional) `client/src/components/dashboard/PendingApprovalCard.tsx` (+ spend lane).

**Migrations:** 2 minimum (one for `spending_policies` + `agent_charges` + RLS, one for `cost_aggregates` RLS retrofit + comment update). Possibly a third for `integration_connections.configJson` schema extension if a per-connection Stripe webhook secret column is needed instead of stuffing it in jsonb.

**Sizing for chunks.** Rough chunk plan for `architect` to refine:
1. Schema + RLS (both migrations, schema files, manifest entries).
2. SPT vault + connection lifecycle (`stripe_agent` providerType wiring, refresh, revoke variants).
3. Charge router pure (policy resolution, cap math, idempotency key build, mode discrimination) — heavy unit-test chunk.
4. Charge router impure (Stripe call, ledger insert, state-machine writes, `agent_execution_events` cross-ref).
5. Action registry + skill handlers (4 new skills + `spendsMoney` flag wire-through).
6. Policy engine extension (`spendDecision` + `higherGate` merge + planning-phase advisory preview).
7. HITL surface (metadata category, ReviewQueuePage render branch, optional Slack one-tap).
8. Workflow engine wire-up (allowlist additions, `reviewKind: 'spend_approval'`).
9. Worker round-trip (pg-boss queue, request/reply or HTTP callback, shared/iee/actionSchema extension).
10. Webhook ingestion (new route + service + signature verification + dedupe).
11. Cost-aggregation parallel writer + RLS retrofit on `cost_aggregates`.
12. Admin UI (policy editor + dashboard + ledger query routes).

Estimate: **3-4 weeks for a single experienced builder, or 2-3 weeks if chunks 3/4 + 11/12 parallelise.** Matches the v2 brief's effort estimate. Slack one-tap, if scoped in, adds ~3-5 days.

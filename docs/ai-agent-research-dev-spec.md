# AI Agent Research — Development Spec

**Version:** 1.1 (Complete)
**Date:** 2026-03-31
**Branch:** claude/research-ai-agent-repos-2iK2b
**Sources:** 10 repo deep-dives (HumanLayer, Windmill, Mastra, Activepieces, Composio, Langfuse, LangGraph, n8n, CrewAI, Mem0)
**Contracts:** See `docs/execution-contracts.md` — all types referenced here are defined there.

---

## Document Structure

This spec is written in implementation order. Each section maps to a discrete body of work that can be reviewed, planned into a sprint, and shipped independently.

| Section | Tier | Status in this doc |
|---|---|---|
| 1. HITL Wiring | Tier 1 — Immediate | ✅ Written |
| 2. Suspend/Resume DB Schema | Tier 1 — Immediate | ✅ Written |
| 3. Policy Engine | Tier 1 — Immediate | 🔜 Next |
| 4. Review Gate UX | Tier 1 — Immediate | 🔜 Next |
| 5. OAuth Integrations | Tier 2 | 🔜 Next |
| 6. Observability | Tier 2 | 🔜 Next |
| 7. Processor Guardrails | Tier 2 | 🔜 Next |
| 8. Memory Improvements | Tier 3 | 🔜 Later |
| 9. MCP Scaffolding | Tier 4 | 🔜 Later |
| 10. Phase 2: Orchestrator | Tier 5 | 🔜 Phase 2 |

---

## Section 1 — HITL Wiring

**Source repos:** HumanLayer, LangGraph, n8n
**Gap closed:** `skillExecutor.ts` currently has direct execution paths that bypass the action gate for some skills. The gate (auto/review/block) is defined in `actionRegistry.ts` but not consistently enforced before dispatch.

### The core insight from HumanLayer

HumanLayer's architecture evolved away from per-tool decorators to a session-boundary intercept — every tool call hits the gate before execution, enforced structurally rather than per-case. Their key lesson: **the gate must be a middleware wrapper above the dispatch, not a check inside each case**.

From n8n: the LLM never sees the approval step. A gated tool call that requires review simply returns a pending observation; on approval, a second request executes the real tool. Denial injects a message as the tool result — the agent loop stays alive and the model handles it.

### Current state

```
agentExecutionService.ts
  └── skillExecutor.execute(toolName, input)
        └── switch(toolName):
              case 'send_email': sendEmail(params)        ← direct, bypasses gate
              case 'create_task': proposeReviewGated(...)  ← gated ✓
              case 'web_search': webSearch(params)         ← direct, bypasses gate
```

The inconsistency is the bug. Some cases call `executeWithActionAudit()` or `proposeReviewGatedAction()`, others call the skill function directly.

### Target state

```
agentExecutionService.ts
  └── skillExecutor.execute(toolName, input, context)
        └── gateMiddleware(toolName, input, context)      ← single enforcement point
              ├── auto   → createAuditRecord() → dispatch()
              ├── review → createCheckpoint() → awaitApproval() → dispatch()
              └── block  → return refusal (never dispatches)
```

### Implementation

**File: `server/services/skillExecutor.ts`**

Replace the current switch statement dispatch with a gated wrapper. The switch still exists for routing, but no case executes directly — all flow through `executeWithGate`.

```typescript
// NEW: top-level execute function — replaces current switch entry point
export async function execute(
  toolName: string,
  input: unknown,
  context: SkillExecutorContext
): Promise<ToolResult> {
  // 1. Look up gate level from registry
  const gateLevel = actionRegistry.getGateLevel(toolName);

  // 2. Enforce gate — this is the single interception point
  return executeWithGate(toolName, input, context, gateLevel);
}

async function executeWithGate(
  toolName: string,
  input: unknown,
  context: SkillExecutorContext,
  gateLevel: 'auto' | 'review' | 'block'
): Promise<ToolResult> {
  const idempotencyKey = stableHash(`${context.agentRunId}:${toolName}:${JSON.stringify(input)}`);

  // BLOCK — never executes, return immediately
  if (gateLevel === 'block') {
    return {
      success: false,
      output: `This action (${toolName}) is not permitted in this workspace.`,
      blocked: true,
    };
  }

  // AUTO — create audit record, execute, close record
  if (gateLevel === 'auto') {
    const action = await actionService.createAndExecute({
      toolName,
      input,
      subaccountId: context.subaccountId,
      organisationId: context.organisationId,
      agentRunId: context.agentRunId,
      idempotencyKey,
    });
    return dispatch(toolName, input, context, action.id);
  }

  // REVIEW — create checkpoint, suspend, await approval, then execute
  const action = await actionService.proposeForReview({
    toolName,
    input,
    subaccountId: context.subaccountId,
    organisationId: context.organisationId,
    agentRunId: context.agentRunId,
    idempotencyKey,
    toolVersion: getToolVersion(toolName),
    inputHash: stableHash(JSON.stringify(input)),
  });

  // Suspend until approved or rejected — no polling, event-driven
  const decision = await reviewService.awaitDecision(action.id, {
    timeoutMs: action.timeoutMs,
    signal: context.abortSignal,
  });

  if (decision.status === 'rejected') {
    // Inject denial as tool output (n8n pattern) — agent loop stays alive
    return {
      success: false,
      output: buildDenialMessage(toolName, decision.comment),
      rejected: true,
    };
  }

  if (decision.status === 'timed_out') {
    return {
      success: false,
      output: `Approval for ${toolName} timed out. The action was not executed.`,
      timedOut: true,
    };
  }

  // Approved — validate checkpoint integrity before executing
  await actionService.validateResumeIntegrity(action.id, {
    inputHash: stableHash(JSON.stringify(input)),
    toolVersion: getToolVersion(toolName),
  });

  // Execute with approved context
  return dispatch(toolName, input, context, action.id);
}
```

**`reviewService.awaitDecision` — event-driven, no polling**

```typescript
// server/services/reviewService.ts

// In-memory map: actionId → { resolve, reject } pending promise
const pendingDecisions = new Map<string, {
  resolve: (decision: ReviewDecision) => void;
  reject: (err: Error) => void;
}>();

export async function awaitDecision(
  actionId: string,
  opts: { timeoutMs: number; signal?: AbortSignal }
): Promise<ReviewDecision> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingDecisions.delete(actionId);
      resolve({ status: 'timed_out' });
    }, opts.timeoutMs);

    opts.signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      pendingDecisions.delete(actionId);
      reject(new Error('Agent run aborted while awaiting approval'));
    });

    pendingDecisions.set(actionId, {
      resolve: (decision) => { clearTimeout(timer); resolve(decision); },
      reject: (err) => { clearTimeout(timer); reject(err); },
    });
  });
}

// Called by the approval API route when a reviewer approves/rejects
export function resolveDecision(actionId: string, decision: ReviewDecision): void {
  const pending = pendingDecisions.get(actionId);
  if (!pending) {
    // Guard: double-approve — action already resolved
    throw new AlreadyDecidedError(actionId);
  }
  pendingDecisions.delete(actionId);
  pending.resolve(decision);
}
```

**Denial message format (n8n pattern)**

```typescript
function buildDenialMessage(toolName: string, comment?: string): string {
  if (comment) {
    return `Your request to use ${toolName} was reviewed and declined. Feedback: "${comment}". The tool remains available if you'd like to try a different approach.`;
  }
  return `Your request to use ${toolName} was declined by a reviewer. STOP and wait for further instructions. The tool remains available if needed.`;
}
```

### Files to touch

| File | Change |
|---|---|
| `server/services/skillExecutor.ts` | Add `executeWithGate` wrapper; all cases route through it |
| `server/services/reviewService.ts` | Add `awaitDecision` / `resolveDecision` with `pendingDecisions` map |
| `server/services/actionService.ts` | Add `validateResumeIntegrity`, `createAndExecute`, `proposeForReview` |
| `server/routes/reviews.ts` (or existing approval route) | Call `reviewService.resolveDecision(actionId, decision)` on approval/rejection |
| `server/config/actionRegistry.ts` | Ensure `getGateLevel(toolName)` exists and covers all 20+ skills |

### Edge cases to handle

| Case | Handling |
|---|---|
| Double-approve | `AlreadyDecidedError` thrown by `resolveDecision` — caught at route level, return 409 |
| Agent run aborted mid-wait | `AbortSignal` rejects the promise cleanly |
| `actionId` not found in map (server restart) | `resolveDecision` throws — approval route should check action status in DB first |
| Approval arrives after timeout fired | `pendingDecisions.delete` already ran — `resolveDecision` throws `AlreadyDecidedError` |
| Same skill called twice in one run | Separate `action` records, separate `actionId` keys — no collision |

---

## Section 2 — Suspend/Resume DB Schema

**Source repos:** Windmill (primary), LangGraph (checkpoint types)
**Gap closed:** Paused approval states currently have no zero-resource mechanism. A pg-boss job holds state during wait. This section adds the PostgreSQL-native suspend/resume schema so paused actions consume no worker resources.

### The Windmill pattern (adapted)

Windmill uses `suspend_count` (integer, decrements to 0 = ready) + `suspend_until` (timestamp) on the job row. Suspended jobs keep `running = true` so they're invisible to the normal job pull query. A separate pull query targets `suspend_until IS NOT NULL AND (suspend_count <= 0 OR suspend_until <= now())`.

We adapt this for our `actions` table and add:
1. An `action_resume_events` table (the approval record)
2. An `organisation_secrets` table (per-org encryption keys for HMAC resume URLs)

### Migration: extend `actions` table

```sql
-- Migration: add suspend/resume columns to actions
ALTER TABLE actions
  ADD COLUMN suspend_count    INTEGER     DEFAULT 0,
  ADD COLUMN suspend_until    TIMESTAMPTZ,
  ADD COLUMN wac_checkpoint   JSONB;      -- serialized approval state for resume

-- Index for the suspended pull query
CREATE INDEX idx_actions_suspended
  ON actions (organisation_id, suspend_until)
  WHERE suspend_until IS NOT NULL;
```

### New table: `action_resume_events`

Stores the approval/rejection event. Decoupled from the action row for audit trail integrity (the action row's state changes; this table is append-only).

```sql
CREATE TABLE action_resume_events (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    action_id       UUID        NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
    resume_id       INTEGER     NOT NULL,   -- random nonce, part of HMAC URL
    organisation_id TEXT        NOT NULL,
    subaccount_id   TEXT        NOT NULL,
    decided_by      TEXT,                   -- user ID of approver/rejector
    decision        TEXT        NOT NULL,   -- 'approved' | 'rejected' | 'timed_out'
    comment         TEXT,                   -- required when decision = 'rejected'
    payload         JSONB       NOT NULL DEFAULT 'null'::jsonb,  -- reviewer-provided form data
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payload_size CHECK (length(payload::text) < 10240),
    CONSTRAINT comment_required CHECK (
      decision != 'rejected' OR (comment IS NOT NULL AND length(comment) > 0)
    )
);

CREATE INDEX idx_action_resume_events_action_id ON action_resume_events (action_id);
```

### New table: `organisation_secrets`

Per-org encryption key used for both credential encryption (AES-256-GCM) and HMAC signing of resume URLs. Same pattern as Windmill's `workspace_key` table.

```sql
CREATE TABLE organisation_secrets (
    organisation_id TEXT        PRIMARY KEY,
    key             TEXT        NOT NULL,   -- AES-256 key, hex-encoded, 32 bytes
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_at      TIMESTAMPTZ
);
```

> **Security note:** The same key is used for both credential encryption and HMAC resume URL signing (matching Windmill's pattern). Key rotation must re-encrypt all `integration_connections` for that org and invalidate all outstanding resume URLs.

### HMAC-signed resume URLs

Resume URLs must be unforgeable and single-use. Pattern from Windmill:

```typescript
// server/lib/resumeUrl.ts

import { createHmac } from 'crypto';

export function generateResumeUrl(params: {
  orgKey: string;     // from organisation_secrets.key
  actionId: string;
  resumeId: number;   // random u32 nonce
  approver?: string;  // optional: locks URL to specific approver
  baseUrl: string;
}): { url: string; secret: string } {
  const mac = createHmac('sha256', params.orgKey);
  mac.update(params.actionId);
  mac.update(Buffer.alloc(4).fill(0).writeUInt32BE(params.resumeId, 0) && Buffer.alloc(4)); // big-endian u32

  // Simpler approach that works in Node.js:
  const nonceBuf = Buffer.allocUnsafe(4);
  nonceBuf.writeUInt32BE(params.resumeId, 0);
  const mac2 = createHmac('sha256', params.orgKey);
  mac2.update(params.actionId);
  mac2.update(nonceBuf);
  if (params.approver) mac2.update(params.approver);
  const secret = mac2.digest('hex');

  const url = `${params.baseUrl}/api/actions/${params.actionId}/resume/${params.resumeId}/${secret}`;
  return { url, secret };
}

export function verifyResumeUrl(params: {
  orgKey: string;
  actionId: string;
  resumeId: number;
  secret: string;
  approver?: string;
}): boolean {
  const { url } = generateResumeUrl({ ...params, baseUrl: '' });
  const expectedSecret = url.split('/').pop()!;
  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(params.secret, 'hex'),
    Buffer.from(expectedSecret, 'hex')
  );
}
```

### Drizzle schema additions

```typescript
// server/db/schema/actions.ts — additions

export const actions = pgTable('actions', {
  // ... existing columns ...
  suspendCount:   integer('suspend_count').default(0),
  suspendUntil:   timestamp('suspend_until', { withTimezone: true }),
  wacCheckpoint:  jsonb('wac_checkpoint'),
});

// server/db/schema/actionResumeEvents.ts — new table

export const actionResumeEvents = pgTable('action_resume_events', {
  id:             uuid('id').primaryKey().defaultRandom(),
  actionId:       uuid('action_id').notNull().references(() => actions.id, { onDelete: 'cascade' }),
  resumeId:       integer('resume_id').notNull(),
  organisationId: text('organisation_id').notNull(),
  subaccountId:   text('subaccount_id').notNull(),
  decidedBy:      text('decided_by'),
  decision:       text('decision').notNull(),  // 'approved' | 'rejected' | 'timed_out'
  comment:        text('comment'),
  payload:        jsonb('payload').default(sql`'null'::jsonb`),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// server/db/schema/organisationSecrets.ts — new table

export const organisationSecrets = pgTable('organisation_secrets', {
  organisationId: text('organisation_id').primaryKey(),
  key:            text('key').notNull(),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  rotatedAt:      timestamp('rotated_at', { withTimezone: true }),
});
```

### Files to touch

| File | Change |
|---|---|
| `server/db/schema/actions.ts` | Add `suspendCount`, `suspendUntil`, `wacCheckpoint` columns |
| `server/db/schema/actionResumeEvents.ts` | New file — `actionResumeEvents` table |
| `server/db/schema/organisationSecrets.ts` | New file — `organisationSecrets` table |
| `server/db/schema/index.ts` | Export both new schemas |
| `server/lib/resumeUrl.ts` | New file — HMAC URL generation and verification |
| `server/migrations/XXXX_hitl_suspend_resume.sql` | Raw SQL migration |

---

---

## Section 3 — Policy Engine

**Source repos:** LangGraph (three-tier model), CrewAI (`@human_feedback` emit/routing), n8n (per-tool config)
**Gap closed:** Gate levels are currently hardcoded per action type in `actionRegistry.ts`. There is no runtime rules engine — nothing can make "auto-approve under $500 for manager role" decisions. Every review-gated action requires manual approval regardless of context.

### What needs to exist

A `PolicyEngine` that evaluates an ordered list of `PolicyRule` rows (first-match, ascending priority) and returns a `PolicyDecision`. The engine lives between `skillExecutor.ts` receiving a tool call and `executeWithGate` deciding which path to take.

### DB table: `policy_rules`

```sql
CREATE TABLE policy_rules (
    id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    organisation_id     TEXT        NOT NULL,
    subaccount_id       TEXT,                   -- NULL = applies to all subaccounts in org
    priority            INTEGER     NOT NULL,   -- lower = evaluated first
    tool_slug           TEXT        NOT NULL,   -- exact slug or '*' wildcard
    decision            TEXT        NOT NULL    CHECK (decision IN ('auto', 'review', 'block')),

    -- Conditions (all nullable — NULL = match any)
    cond_user_role      TEXT,                   -- 'org_admin' | 'manager' | 'user' | 'client_user'
    cond_amount_gt      NUMERIC,                -- match if action amount > this value
    cond_amount_lte     NUMERIC,                -- match if action amount <= this value
    cond_environment    TEXT,                   -- 'production' | 'staging'

    -- Reviewer UX config
    allow_ignore        BOOLEAN     NOT NULL DEFAULT false,
    allow_respond       BOOLEAN     NOT NULL DEFAULT true,
    allow_edit          BOOLEAN     NOT NULL DEFAULT false,
    allow_accept        BOOLEAN     NOT NULL DEFAULT true,
    allowed_decisions   TEXT[],                 -- ['approve','reject'] or ['approve','edit','reject']
    description_template TEXT,                  -- markdown, supports {{tool_slug}}, {{args}}

    -- Timeout
    timeout_seconds     INTEGER     NOT NULL DEFAULT 86400,  -- 24 hours default
    timeout_policy      TEXT        NOT NULL DEFAULT 'auto_reject'
                                    CHECK (timeout_policy IN ('auto_reject', 'auto_approve', 'escalate')),

    -- Audit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT,

    CONSTRAINT evaluation_mode CHECK (true)  -- first_match is the only mode; enforced by code
);

CREATE INDEX idx_policy_rules_org ON policy_rules (organisation_id, priority ASC);
CREATE INDEX idx_policy_rules_subaccount ON policy_rules (organisation_id, subaccount_id, priority ASC)
    WHERE subaccount_id IS NOT NULL;

-- The fallback rule for every org (inserted on org creation)
-- priority=9999, tool_slug='*', decision='review'
```

### Drizzle schema

```typescript
// server/db/schema/policyRules.ts
export const policyRules = pgTable('policy_rules', {
  id:                 text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  organisationId:     text('organisation_id').notNull(),
  subaccountId:       text('subaccount_id'),
  priority:           integer('priority').notNull(),
  toolSlug:           text('tool_slug').notNull(),
  decision:           text('decision').notNull(),

  condUserRole:       text('cond_user_role'),
  condAmountGt:       numeric('cond_amount_gt'),
  condAmountLte:      numeric('cond_amount_lte'),
  condEnvironment:    text('cond_environment'),

  allowIgnore:        boolean('allow_ignore').notNull().default(false),
  allowRespond:       boolean('allow_respond').notNull().default(true),
  allowEdit:          boolean('allow_edit').notNull().default(false),
  allowAccept:        boolean('allow_accept').notNull().default(true),
  allowedDecisions:   text('allowed_decisions').array(),
  descriptionTemplate: text('description_template'),

  timeoutSeconds:     integer('timeout_seconds').notNull().default(86400),
  timeoutPolicy:      text('timeout_policy').notNull().default('auto_reject'),

  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy:          text('created_by'),
});
```

### Policy engine service

```typescript
// server/services/policyEngineService.ts

export async function evaluatePolicy(
  toolSlug: string,
  context: PolicyContext
): Promise<PolicyDecision> {
  // Load rules for this org, ordered by priority ASC
  // Rules are cached in-process with a 60s TTL — policy changes take effect within 1 minute
  const rules = await getRulesForOrg(context.organisationId);

  for (const rule of rules) {
    if (matchesRule(rule, toolSlug, context)) {
      return buildDecision(rule, toolSlug, context);
    }
  }

  // Should never reach here if fallback rule exists for every org
  // but safe default just in case
  return { decision: 'review', matchedRule: SYSTEM_FALLBACK };
}

function matchesRule(rule: PolicyRule, toolSlug: string, ctx: PolicyContext): boolean {
  // Tool slug: exact match or wildcard
  if (rule.toolSlug !== '*' && rule.toolSlug !== toolSlug) return false;

  // Subaccount: if rule scoped to subaccount, must match
  if (rule.subaccountId && rule.subaccountId !== ctx.subaccountId) return false;

  // User role
  if (rule.condUserRole && rule.condUserRole !== ctx.userRole) return false;

  // Amount conditions (for financial tools like send_payment, update_record with value)
  if (rule.condAmountGt !== null && ctx.amountUsd !== undefined) {
    if (ctx.amountUsd <= rule.condAmountGt) return false;
  }
  if (rule.condAmountLte !== null && ctx.amountUsd !== undefined) {
    if (ctx.amountUsd > rule.condAmountLte) return false;
  }

  // Environment
  if (rule.condEnvironment && rule.condEnvironment !== ctx.environment) return false;

  return true;
}
```

### Wire into `executeWithGate`

Replace the current `actionRegistry.getGateLevel(toolName)` call with the policy engine:

```typescript
// In skillExecutor.ts executeWithGate — replace static gate lookup
const policyDecision = await policyEngineService.evaluatePolicy(toolName, {
  organisationId: context.organisationId,
  subaccountId: context.subaccountId,
  userRole: context.userRole,
  amountUsd: extractAmount(input),   // optional — only for tools with financial values
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'staging',
});

const gateLevel = policyDecision.decision;
// ... rest of executeWithGate unchanged, but pass policyDecision to createCheckpoint
```

### Bootstrap: seed fallback rule on org creation

```typescript
// In organisationService.ts, after creating org:
await db.insert(policyRules).values({
  organisationId: newOrg.id,
  priority: 9999,
  toolSlug: '*',
  decision: 'review',
  timeoutSeconds: 86400,
  timeoutPolicy: 'auto_reject',
  createdBy: 'system',
});
```

### Files to touch

| File | Change |
|---|---|
| `server/db/schema/policyRules.ts` | New file — Drizzle schema |
| `server/db/schema/index.ts` | Export `policyRules` |
| `server/services/policyEngineService.ts` | New file — evaluation logic + 60s cache |
| `server/services/skillExecutor.ts` | Replace `actionRegistry.getGateLevel()` with `policyEngineService.evaluatePolicy()` |
| `server/services/organisationService.ts` | Seed fallback rule on org creation |
| `server/routes/policyRules.ts` | New CRUD routes (org admin only) |
| `server/migrations/XXXX_policy_rules.sql` | Raw SQL migration |

---

## Section 4 — Review Gate UX

**Source repos:** n8n (denial-as-tool-output, interrupt_config), CrewAI (`HumanFeedbackResult` audit schema, outcome-collapse classifier), LangGraph (Agent Inbox data model)
**Gap closed:** The review queue UI (`ReviewQueuePage.tsx`) exists but: (1) reviewer options are binary approve/reject with no context about what options are available, (2) denial has no required comment field enforced at the API level, (3) there is no audit record of what the human decided and why, (4) the agent receives no structured feedback message on denial — it just times out or errors.

### 1. Enforce comment on rejection (API level)

```typescript
// server/routes/reviews.ts (or existing approval route)

app.post('/actions/:actionId/decide', async (req, res) => {
  const { decision, comment, editedArgs } = req.body;

  // Rejection requires a comment — no silent rejections (HumanLayer pattern)
  if (decision === 'rejected' && (!comment || comment.trim().length === 0)) {
    return res.status(400).json({
      error: 'A comment is required when rejecting an action.',
      code: 'COMMENT_REQUIRED',
    });
  }

  // Double-approve guard
  const action = await actionService.getById(req.params.actionId);
  if (action.status !== 'pending_approval') {
    return res.status(409).json({
      error: `Action is already in state: ${action.status}`,
      code: 'ALREADY_DECIDED',
    });
  }

  // Validate resume integrity before marking approved
  if (decision === 'approved') {
    await actionService.validateResumeIntegrity(req.params.actionId, {
      approvedBy: req.user.id,
      editedArgs,   // if reviewer edited the args (allow_edit = true on rule)
    });
  }

  // Write audit record
  await reviewAuditService.record({
    actionId: req.params.actionId,
    decidedBy: req.user.id,
    decision,
    comment,
    editedArgs,
    subaccountId: action.subaccountId,
    organisationId: action.organisationId,
  });

  // Resolve the pending promise in reviewService
  reviewService.resolveDecision(req.params.actionId, { status: decision, comment, editedArgs });

  return res.json({ ok: true });
});
```

### 2. `review_audit_records` table — HumanFeedbackResult schema

Modelled after CrewAI's `HumanFeedbackResult`. Append-only — never updated after insert.

```sql
CREATE TABLE review_audit_records (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    action_id       UUID        NOT NULL REFERENCES actions(id),
    organisation_id TEXT        NOT NULL,
    subaccount_id   TEXT        NOT NULL,
    agent_run_id    TEXT,
    tool_slug       TEXT        NOT NULL,

    -- What the agent proposed (snapshot at time of review)
    agent_output    JSONB       NOT NULL,   -- the args the agent passed to the tool

    -- What the human decided
    decided_by      TEXT        NOT NULL,
    decision        TEXT        NOT NULL    CHECK (decision IN ('approved', 'rejected', 'edited', 'timed_out')),
    raw_feedback    TEXT,                   -- verbatim comment from reviewer
    collapsed_outcome TEXT,                 -- LLM-collapsed: 'approved'|'rejected'|'needs_revision'
    edited_args     JSONB,                  -- populated only when decision = 'edited'

    -- Timing
    proposed_at     TIMESTAMPTZ NOT NULL,
    decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    wait_duration_ms INTEGER,               -- decided_at - proposed_at in ms

    CONSTRAINT feedback_required CHECK (
      decision != 'rejected' OR (raw_feedback IS NOT NULL AND length(raw_feedback) > 0)
    )
);

CREATE INDEX idx_review_audit_org ON review_audit_records (organisation_id, decided_at DESC);
CREATE INDEX idx_review_audit_subaccount ON review_audit_records (subaccount_id, decided_at DESC);
CREATE INDEX idx_review_audit_action ON review_audit_records (action_id);
```

### 3. Outcome-collapse classifier (CrewAI `emit` pattern)

When a reviewer types free-text feedback (e.g. "looks good but change the subject line"), the system uses a small LLM call to collapse it to a typed outcome. This makes routing deterministic.

```typescript
// server/services/reviewAuditService.ts

const OUTCOME_OPTIONS = ['approved', 'rejected', 'needs_revision'] as const;
type CollapsedOutcome = typeof OUTCOME_OPTIONS[number];

async function collapseToOutcome(
  rawFeedback: string,
  decision: string,
): Promise<CollapsedOutcome> {
  // Short-circuit: empty feedback or binary decision
  if (!rawFeedback || rawFeedback.trim().length === 0) {
    return decision === 'approved' ? 'approved' : 'rejected';
  }

  const response = await llmRouter.routeCall({
    model: 'claude-haiku-4-5-20251001',  // cheapest model, simple classification
    messages: [{
      role: 'user',
      content: `Classify this reviewer feedback into exactly one of: approved, rejected, needs_revision.

Feedback: "${rawFeedback}"
Initial decision: ${decision}

Rules:
- "approved" = reviewer is satisfied, proceed
- "rejected" = reviewer wants to stop this action entirely
- "needs_revision" = reviewer wants changes before proceeding

Return only the single word.`,
    }],
    maxTokens: 10,
  });

  const output = response.content[0].text.trim().toLowerCase() as CollapsedOutcome;
  return OUTCOME_OPTIONS.includes(output) ? output : (decision === 'approved' ? 'approved' : 'rejected');
}
```

### 4. Denial message injected as tool output (n8n pattern)

The agent loop should receive a structured denial message as the tool's return value — not an exception, not a timeout. The loop stays alive and the model can reason about what to do next.

```typescript
// server/services/skillExecutor.ts

function buildDenialMessage(toolSlug: string, collapsedOutcome: CollapsedOutcome, comment?: string): string {
  if (collapsedOutcome === 'needs_revision' && comment) {
    return `Your request to use ${toolSlug} was reviewed. The reviewer requests changes before proceeding: "${comment}". Please revise your approach and try again if appropriate.`;
  }
  if (comment) {
    return `Your request to use ${toolSlug} was declined. Reviewer feedback: "${comment}". The tool remains available if a different approach would be appropriate.`;
  }
  return `Your request to use ${toolSlug} was declined by a reviewer. Stop and wait for further instructions from the user.`;
}
```

### 5. Review queue UI — `interrupt_config` rendering

The `ReviewQueuePage.tsx` should surface the reviewer options from the matched `PolicyRule.interrupt_config`. This tells the UI which buttons to render.

```typescript
// Frontend: ReviewQueueItem component

interface ReviewQueueItemProps {
  action: {
    id: string;
    toolSlug: string;
    actionRequest: { action: string; args: Record<string, unknown> };
    interruptConfig: {
      allow_accept: boolean;
      allow_respond: boolean;   // show free-text field
      allow_edit: boolean;      // show args editor
      allow_ignore: boolean;
    };
    descriptionTemplate?: string;  // rendered markdown shown to reviewer
    proposedAt: string;
    timeoutAt: string;
  };
}

// Rendered buttons based on interruptConfig:
// allow_accept  → "Approve" button
// allow_respond → "Decline with feedback" (shows text input)
// allow_edit    → "Edit & Approve" (shows args editor, submits edited args)
// allow_ignore  → "Dismiss" (no resume, action times out naturally)
```

### Files to touch

| File | Change |
|---|---|
| `server/db/schema/reviewAuditRecords.ts` | New file — audit table |
| `server/db/schema/index.ts` | Export `reviewAuditRecords` |
| `server/services/reviewAuditService.ts` | New file — `record()`, `collapseToOutcome()` |
| `server/routes/reviews.ts` | Add comment enforcement, double-approve guard, audit write, `resolveDecision` call |
| `server/services/skillExecutor.ts` | Add `buildDenialMessage()`, pass `collapsedOutcome` to agent loop |
| `client/src/pages/ReviewQueuePage.tsx` | Render `interruptConfig` buttons, free-text field, args editor |
| `server/migrations/XXXX_review_audit.sql` | Raw SQL migration |

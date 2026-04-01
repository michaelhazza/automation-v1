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

---

## Section 5 — OAuth Integration Layer

**Source repos:** Activepieces (primary), Composio (evaluated, rejected as strategic dependency)
**Gap closed:** `integration_connections` table exists with correct columns but zero OAuth flow implementation — no auth URL generation, no callback handler, no token exchange, no auto-refresh. Agents with `send_email`, `update_record`, etc. cannot use connected external services.

**Strategic decision:** Build our own OAuth layer using Activepieces patterns. Composio was evaluated and fails two kill criteria: it owns the token vault (tokens never live in our DB) and all tool arguments transit their infrastructure. It may be used as a throwaway bridge behind a hard adapter boundary only, with an explicit replacement plan.

### Architecture overview

```
User clicks "Connect Gmail"
  → GET  /api/integrations/oauth2/auth-url?provider=gmail&subaccountId=...
  → returns { url, state }  (state = signed JWT binding provider+subaccountId)

Browser redirects to Google → user consents → Google redirects to:
  → GET  /api/integrations/oauth2/callback?code=...&state=...
  → server validates state JWT, exchanges code for tokens
  → encrypts tokens (AES-256-GCM), stores in integration_connections
  → redirects browser to success page

Agent calls tool with auth_context
  → integrationConnectionService.getConnection(subaccountId, provider)
  → auto-refreshes if expires within 15 minutes (distributed lock)
  → returns decrypted connection to tool handler
```

### Encryption (AES-256-GCM, upgraded from Activepieces' CBC)

Activepieces uses AES-256-CBC. We use AES-256-GCM (already established in our codebase per migration 0034) — adds authentication tag, prevents ciphertext tampering.

```typescript
// server/lib/integrationEncryption.ts
// Wraps the existing encryptText/decryptText helpers already in the codebase

export function encryptToken(plaintext: string, orgKey: string): string {
  // AES-256-GCM: random 12-byte IV, 16-byte auth tag
  // Returns: base64(iv + authTag + ciphertext)
  // Uses orgKey from organisation_secrets table (same key as HMAC resume URLs)
}

export function decryptToken(encrypted: string, orgKey: string): string {
  // Reverse of above
}
```

### DB changes to `integration_connections`

Add `claimed_at` (Unix seconds) + `expires_in` (seconds) following the Activepieces pattern. This is more reliable than storing `expires_at` directly because token responses give us `expires_in` — computing `expires_at` requires trusting the server clock at exchange time, which can drift.

```sql
ALTER TABLE integration_connections
  ADD COLUMN claimed_at   BIGINT,        -- Unix seconds when token was acquired
  ADD COLUMN expires_in   INTEGER,       -- seconds until expiry (from provider response)
  ADD COLUMN token_url    TEXT,          -- stored so refresh doesn't need provider config
  ADD COLUMN client_id    TEXT,          -- stored encrypted for refresh calls
  ADD COLUMN client_secret TEXT,         -- stored encrypted for refresh calls
  ADD COLUMN status       TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'expired', 'error', 'disconnected'));
```

### OAuth provider configs

Each provider's OAuth endpoints are defined once, referenced by slug:

```typescript
// server/config/oauthProviders.ts

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  gmail: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'],
    extra: { access_type: 'offline', prompt: 'consent' },  // forces refresh_token issuance
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:org'],
  },
  hubspot: {
    authUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    scopes: ['contacts', 'content', 'deals'],
  },
  slack: {
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['chat:write', 'channels:read', 'users:read'],
  },
  ghl: {
    authUrl: 'https://marketplace.leadconnectorhq.com/oauth/chooselocation',
    tokenUrl: 'https://services.leadconnectorhq.com/oauth/token',
    scopes: ['contacts.readonly', 'contacts.write', 'opportunities.readonly'],
  },
};

interface OAuthProviderConfig {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  extra?: Record<string, string>;  // appended to auth URL params
  pkce?: boolean;
}
```

### Auth URL generation endpoint

```typescript
// server/routes/integrations.ts

// GET /api/integrations/oauth2/auth-url
app.get('/oauth2/auth-url', requireAuth, async (req, res) => {
  const { provider, subaccountId } = req.query;

  const config = OAUTH_PROVIDERS[provider];
  if (!config) return res.status(400).json({ error: `Unknown provider: ${provider}` });

  // State JWT: signs provider + subaccountId + nonce, verified in callback
  // Prevents CSRF — callback will only accept state we issued
  const state = jwt.sign(
    { provider, subaccountId, nonce: crypto.randomUUID() },
    process.env.JWT_SECRET!,
    { expiresIn: '10m' }
  );

  const url = new URL(config.authUrl);
  url.searchParams.set('client_id', process.env[`OAUTH_${provider.toUpperCase()}_CLIENT_ID`]!);
  url.searchParams.set('redirect_uri', `${process.env.APP_URL}/api/integrations/oauth2/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', state);
  for (const [k, v] of Object.entries(config.extra ?? {})) url.searchParams.set(k, v);

  return res.json({ url: url.toString(), state });
});
```

### Callback handler (token exchange + encrypted storage)

```typescript
// GET /api/integrations/oauth2/callback
app.get('/oauth2/callback', async (req, res) => {
  const { code, state } = req.query;

  // Verify state JWT
  const payload = jwt.verify(state, process.env.JWT_SECRET!) as { provider: string; subaccountId: string };
  const config = OAUTH_PROVIDERS[payload.provider];

  // Exchange code for tokens
  const tokenResponse = await axios.post(config.tokenUrl, new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${process.env.APP_URL}/api/integrations/oauth2/callback`,
    client_id: process.env[`OAUTH_${payload.provider.toUpperCase()}_CLIENT_ID`]!,
    client_secret: process.env[`OAUTH_${payload.provider.toUpperCase()}_CLIENT_SECRET`]!,
  }), { headers: { Accept: 'application/json' } });

  const { access_token, refresh_token, expires_in, token_type, scope } = tokenResponse.data;
  const claimedAt = Math.floor(Date.now() / 1000);

  // Get org key for encryption
  const orgKey = await organisationSecretService.getKey(/* orgId from subaccount */);

  // Upsert into integration_connections
  await db.insert(integrationConnections).values({
    subaccountId: payload.subaccountId,
    provider: payload.provider,
    accessToken: encryptToken(access_token, orgKey),
    refreshToken: refresh_token ? encryptToken(refresh_token, orgKey) : null,
    claimedAt,
    expiresIn: expires_in ?? 3600,
    tokenUrl: config.tokenUrl,
    clientId: encryptToken(process.env[`OAUTH_${payload.provider.toUpperCase()}_CLIENT_ID`]!, orgKey),
    clientSecret: encryptToken(process.env[`OAUTH_${payload.provider.toUpperCase()}_CLIENT_SECRET`]!, orgKey),
    scopes: (scope ?? config.scopes.join(' ')).split(' '),
    status: 'active',
  }).onConflictDoUpdate({
    target: [integrationConnections.subaccountId, integrationConnections.provider],
    set: { accessToken: sql`excluded.access_token`, /* ... all token fields */ },
  });

  return res.redirect(`${process.env.APP_URL}/settings/integrations?connected=${payload.provider}`);
});
```

### Auto-refresh on access (Activepieces pattern)

```typescript
// server/services/integrationConnectionService.ts

export async function getDecryptedConnection(
  subaccountId: string,
  provider: string
): Promise<DecryptedConnection> {
  const conn = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.subaccountId, subaccountId),
      eq(integrationConnections.provider, provider),
      eq(integrationConnections.status, 'active')
    ),
  });
  if (!conn) throw new Error(`No active ${provider} connection for subaccount ${subaccountId}`);

  const orgKey = await organisationSecretService.getKey(conn.organisationId);

  // Check expiry: refresh 15 minutes early (Activepieces pattern)
  const nowSeconds = Math.floor(Date.now() / 1000);
  const REFRESH_BUFFER = 15 * 60;
  const needsRefresh = conn.claimedAt !== null &&
    conn.expiresIn !== null &&
    (nowSeconds + REFRESH_BUFFER >= conn.claimedAt + conn.expiresIn);

  if (needsRefresh && conn.refreshToken) {
    return refreshWithLock(conn, orgKey);
  }

  return {
    provider: conn.provider,
    access_token: decryptToken(conn.accessToken, orgKey),
    scopes: conn.scopes,
  };
}

async function refreshWithLock(conn: IntegrationConnection, orgKey: string): Promise<DecryptedConnection> {
  // pg-boss advisory lock keyed by subaccountId + provider
  // Prevents parallel refreshes from double-spending the refresh token
  const lockKey = `oauth_refresh:${conn.subaccountId}:${conn.provider}`;

  return withAdvisoryLock(lockKey, async () => {
    // Re-fetch after acquiring lock — another worker may have already refreshed
    const fresh = await db.query.integrationConnections.findFirst({ where: /* same */ });
    const freshNow = Math.floor(Date.now() / 1000);
    const REFRESH_BUFFER = 15 * 60;
    if (fresh!.claimedAt! + fresh!.expiresIn! > freshNow + REFRESH_BUFFER) {
      // Already refreshed by the other worker
      return decryptConnection(fresh!, orgKey);
    }

    const clientId = decryptToken(conn.clientId!, orgKey);
    const clientSecret = decryptToken(conn.clientSecret!, orgKey);
    const refreshToken = decryptToken(conn.refreshToken!, orgKey);

    const response = await axios.post(conn.tokenUrl!, new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }), { headers: { Accept: 'application/json' }, timeout: 20000 });

    const data = response.data;

    // mergeNonNull: preserve existing refresh_token if provider doesn't return a new one
    // (common with GitHub, HubSpot)
    const newRefreshToken = data.refresh_token
      ? encryptToken(data.refresh_token, orgKey)
      : conn.refreshToken;

    await db.update(integrationConnections)
      .set({
        accessToken: encryptToken(data.access_token, orgKey),
        refreshToken: newRefreshToken,
        claimedAt: Math.floor(Date.now() / 1000),
        expiresIn: data.expires_in ?? 3600,
        status: 'active',
      })
      .where(eq(integrationConnections.id, conn.id));

    return { provider: conn.provider, access_token: data.access_token, scopes: conn.scopes };
  });
}
```

### Files to touch

| File | Change |
|---|---|
| `server/config/oauthProviders.ts` | New file — provider config registry |
| `server/routes/integrations.ts` | New file — auth URL, callback, list/delete connection routes |
| `server/services/integrationConnectionService.ts` | New file — `getDecryptedConnection`, refresh-with-lock |
| `server/lib/integrationEncryption.ts` | New file — AES-256-GCM encrypt/decrypt wrappers |
| `server/services/organisationSecretService.ts` | New file — per-org key lookup with cache |
| `server/db/schema/integrationConnections.ts` | Add `claimedAt`, `expiresIn`, `tokenUrl`, `clientId`, `clientSecret`, `status` |
| `server/migrations/XXXX_integration_oauth.sql` | Raw SQL migration |
| `.env.example` | Add `OAUTH_{PROVIDER}_CLIENT_ID/SECRET` vars for all 5 providers |

---

## Section 6 — Observability (Langfuse Phase 1)

**Source repos:** Langfuse
**Gap closed:** `llm_requests` table is the billing ledger but provides no visual trace of what happened inside an agent run. Debugging agent failures requires reading raw DB rows. Per-tenant cost is not surfaced in the UI. There is no grouped view of a complete run.

**Infrastructure note:** Langfuse self-hosting requires ClickHouse (mandatory in v3+) in addition to PostgreSQL. This adds operational overhead. Two options:
- **Option A (recommended for now):** Use Langfuse Cloud (free tier: 50k observations/month) and point `LANGFUSE_BASE_URL` at their hosted instance. Zero infrastructure cost to start.
- **Option B:** Self-host with ClickHouse when observability volume justifies it or data residency requires it.

**Phase 1 scope — strictly these three things:**
1. Run-level trace per `agentRun` (session grouped by `agentRunId`)
2. Tool-level span per `skillExecutor` dispatch
3. LLM generation span per `llmRouter` call with token counts and USD cost

**Not in Phase 1:** prompt versioning, A/B testing, annotation queues, full analytics UI.

### Install

```bash
npm install @langfuse/tracing @langfuse/otel @opentelemetry/sdk-node
```

### New file: `server/instrumentation.ts`

Must be the **first import** in the server entry point.

```typescript
// server/instrumentation.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

export const langfuseProcessor = new LangfuseSpanProcessor();

const sdk = new NodeSDK({ spanProcessors: [langfuseProcessor] });
sdk.start();

// Call on graceful shutdown so spans flush before process exits
export async function shutdownTracing() {
  await langfuseProcessor.forceFlush();
  await sdk.shutdown();
}
```

```typescript
// server/index.ts — first line, before any other import
import './instrumentation';
```

### `agentExecutionService.ts` — wrap the agent loop

```typescript
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing';

export async function executeRun(agentRunId: string, subaccountId: string, organisationId: string, task: string) {
  return startActiveObservation('agent-run', async (rootSpan) => {
    await propagateAttributes({
      userId: subaccountId,        // per-tenant attribution — drives cost dashboards
      sessionId: agentRunId,       // groups all spans for this run into one session replay
      metadata: { organisationId, subaccountId, agentRunId },
      traceName: 'agent-run',
    }, async () => {
      rootSpan.update({ input: { task } });
      // ... existing agent loop logic unchanged ...
      rootSpan.update({ output: { result } });
    });
  });
}
```

### `skillExecutor.ts` — tool span

```typescript
import { startObservation } from '@langfuse/tracing';

// Inside executeWithGate, wrap the dispatch call:
const toolSpan = startObservation(toolName, { input }, { asType: 'tool' });
try {
  const result = await dispatch(toolName, input, context, actionId);
  toolSpan.update({ output: result });
  return result;
} finally {
  toolSpan.end();
}
```

### `llmRouter.ts` — generation span

```typescript
import { startObservation } from '@langfuse/tracing';

// OTel context propagation auto-parents this under the active agent-run trace
const generation = startObservation('llm-call', {
  model,
  input: messages,
  modelParameters: { temperature, maxTokens },
}, { asType: 'generation' });

// ... existing LLM call ...

generation.update({
  output: response.content,
  usageDetails: {
    input: response.usage.promptTokens,
    output: response.usage.completionTokens,
  },
  costDetails: {
    input: promptCost,
    output: completionCost,
  },
});
generation.end();

// Existing llm_requests ledger write is UNCHANGED — dual-write, not replacement
await db.insert(llmRequests).values({ /* ... existing ... */ });
```

### Environment variables

```env
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com   # or self-hosted URL
```

### What this gives you

| Capability | How |
|---|---|
| Per-run session replay | All spans share `sessionId = agentRunId` |
| Tool call sequence | Each `skillExecutor` dispatch = one span |
| LLM cost per run | `costDetails` on each generation span |
| Per-tenant cost filter | `userId = subaccountId` on every trace |
| Billing ledger unchanged | `llm_requests` table still the source of truth |

### Files to touch

| File | Change |
|---|---|
| `server/instrumentation.ts` | New file — OTel + Langfuse processor init |
| `server/index.ts` | Add `import './instrumentation'` as first line |
| `server/services/agentExecutionService.ts` | Wrap agent loop in `startActiveObservation` + `propagateAttributes` |
| `server/services/skillExecutor.ts` | Add tool span around `dispatch()` |
| `server/services/llmRouter.ts` | Add generation span, dual-write alongside existing ledger |
| `.env.example` | Add `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` |
| `package.json` | Add `@langfuse/tracing`, `@langfuse/otel`, `@opentelemetry/sdk-node` |

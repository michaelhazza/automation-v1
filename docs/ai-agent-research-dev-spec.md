# AI Agent Research — Development Spec

**Version:** 1.0 (First 10% — HITL Wiring + Suspend/Resume)
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

*Sections 3–10 to follow after review of this first 10%.*

# Pre-Launch Hardening — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 25 Phase 1 P0 items before any paying customer onboarding begins — no cross-tenant leaks, no broken primary buttons, no silent data loss on hot paths.

**Architecture:** Six sequential chunks on branch `claude/pre-launch-phase-1`. Chunks 1–2 (security primitives) must land before Chunk 3 (onboarding), which must land before Chunk 4 (customer-facing). Chunks 5–6 can run in parallel with Chunk 4 after Chunk 3 lands. Phase 1 exit gate requires adversarial-reviewer + pr-reviewer green before Phase 2 starts.

**Tech Stack:** Node 20 + Express + Drizzle ORM + PostgreSQL 15, React 18 + Vite, pg-boss v9 for queues, AsyncLocalStorage (`withOrgTx`) for org-context propagation, Zod for validation.

---

## Scope note

This plan covers **Phase 1 only** (25 P0 items, ~2 weeks).
Phase 2 plan (50 P1 items) written after Phase 1 exit gate.
Phase 3 plan (7 P2 items) written after Phase 2 exit gate.
Each phase runs on its own branch (`claude/pre-launch-phase-1`, `-phase-2`, `-phase-3`).

## Cross-cutting invariants (enforced across all chunks)

These rules apply globally. Violating them in any chunk is a blocking finding at the exit gate.

1. **DB time over app time.** Any timestamp that affects correctness (TTL, ordering, expiry, audit) must use `sql\`now()\`` (DB time), not `new Date()` (app time). Clock skew across nodes breaks expiry and ordering assumptions.
2. **Every external trigger is idempotent.** Webhooks, OAuth callbacks, and queue enqueues must be safe to replay. Enforce via singleton keys, `ON CONFLICT DO NOTHING`, or pre-insert existence checks.
3. **Emit after commit.** No socket or event emission inside an open transaction. Insert the row first; emit to sockets only after the transaction has committed. Clients may miss the notification — that is fine; the row is the source of truth.

---

## Pre-flight

- [ ] `git checkout main && git pull && git checkout -b claude/pre-launch-phase-1`
- [ ] **Verify S-P0-3 already closed:** open `server/routes/workflowDrafts.ts` lines ~42–50; confirm `userCanAccessSubaccount` check is present and returns 404 on cross-subaccount. If present, add a smoke test and mark closed.
- [ ] **Verify O-P0-4 already closed:** open `scripts/_reseed_restore_users.ts`; confirm `BEGIN`/`COMMIT`/`ROLLBACK` wraps the update loop. If present, add a comment and mark closed.
- [ ] **Note on O-P1-2 (axios timeout):** `client/src/lib/api.ts` already has `timeout: 30000`. Phase 2 spec says 15s — this is a Phase 2 item; note for Phase 2 plan.
- [ ] **Migration numbers:** 0277 and 0278 are estimates. Run `ls server/migrations/ | tail -5` to get the actual last migration number and use the next two sequential numbers instead.

---

## Chunk 1 — OAuth State Security (S-P0-2, S-P0-1)

**Items:** S-P0-2 (cluster-safe state store), S-P0-1 (state-nonce org binding)
**Dependencies:** none
**Target:** 1 PR, 1–2 days

### Files
- Create: `server/migrations/0277_oauth_state_nonces.sql`
- Add schema: `server/db/schema.ts` — `oauthStateNonces` table definition
- Rewrite: `server/lib/ghlOAuthStateStore.ts` — replace in-memory Map with Postgres
- Modify: `server/routes/oauthIntegrations.ts` — verify org on callback, return 403 on mismatch
- Create: `server/tests/oauth-state-security.test.ts`

### Task 1.1 — Migration: `oauth_state_nonces` table

- [ ] Create `server/migrations/0277_oauth_state_nonces.sql`:

```sql
CREATE TABLE oauth_state_nonces (
  nonce            text        PRIMARY KEY,
  organisation_id  uuid        NOT NULL,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_oauth_state_nonces_expires ON oauth_state_nonces (expires_at);
```

- [ ] Run `npm run db:generate` and confirm migration file appears.
- [ ] Add Drizzle schema entry to `server/db/schema.ts`:

```typescript
export const oauthStateNonces = pgTable('oauth_state_nonces', {
  nonce:          text('nonce').primaryKey(),
  organisationId: uuid('organisation_id').notNull(),
  expiresAt:      timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] Register a TTL cleanup (DELETE WHERE expires_at < now()) alongside other cleanup jobs in `server/lib/rateLimitCleanupJob.ts` or a new `server/lib/oauthStateCleanupJob.ts`. Register it in the server boot sequence.

### Task 1.2 — Replace in-memory Map with Postgres

- [ ] Open `server/lib/ghlOAuthStateStore.ts`. Replace the entire module body:

```typescript
import { db } from '../db';
import { oauthStateNonces } from '../db/schema';
import { and, eq, gt, sql } from 'drizzle-orm';

const TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function setGhlOAuthState(nonce: string, organisationId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.insert(oauthStateNonces).values({ nonce, organisationId, expiresAt });
}

// Nonce is single-use: DELETE ... RETURNING atomically guarantees consume-once.
// Expired AND unknown nonces both return null — callers cannot distinguish them.
export async function consumeGhlOAuthState(nonce: string): Promise<{ organisationId: string } | null> {
  const rows = await db
    .delete(oauthStateNonces)
    // Use DB time (sql`now()`) rather than new Date() to avoid clock-skew across nodes
    .where(and(eq(oauthStateNonces.nonce, nonce), gt(oauthStateNonces.expiresAt, sql`now()`)))
    .returning({ organisationId: oauthStateNonces.organisationId });
  return rows[0] ?? null;
}
```

- [ ] Find every call to `setGhlOAuthState(nonce, ...)` in `server/routes/ghl.ts` (and anywhere else). Confirm `organisationId` is passed. If not, add `req.user!.organisationId` as the second argument.
- [ ] `npm run typecheck` — fix any type errors before proceeding.

### Task 1.3 — Bind org verification on OAuth callback

- [ ] Open `server/routes/oauthIntegrations.ts`. Find the OAuth callback handler (`GET /api/oauth/callback`).
- [ ] Replace the existing `consumeGhlOAuthState(state)` call with:

```typescript
const stateData = await consumeGhlOAuthState(state);
if (!stateData) {
  res.status(400).json({ error: 'invalid_or_expired_state' });
  return;
}
if (stateData.organisationId !== req.user!.organisationId) {
  await auditService.log({
    organisationId: req.user!.organisationId,
    event: 'oauth_cross_org_state_mismatch',
    meta: { boundOrg: stateData.organisationId, callerOrg: req.user!.organisationId },
  });
  res.status(403).json({ error: 'cross_org_state_mismatch' });
  return;
}
// ... continue with normal flow
```

### Task 1.4 — Tests

- [ ] Create `server/tests/oauth-state-security.test.ts`:

```typescript
import { setGhlOAuthState, consumeGhlOAuthState } from '../lib/ghlOAuthStateStore';
import { db } from '../db';
import { oauthStateNonces } from '../db/schema';

describe('ghlOAuthStateStore', () => {
  afterEach(async () => {
    await db.delete(oauthStateNonces);
  });

  it('returns the bound org for a valid nonce', async () => {
    await setGhlOAuthState('nonce-abc', 'org-1');
    const result = await consumeGhlOAuthState('nonce-abc');
    expect(result?.organisationId).toBe('org-1');
  });

  it('returns null for an unknown nonce', async () => {
    expect(await consumeGhlOAuthState('bad-nonce')).toBeNull();
  });

  it('is one-shot — second consume returns null', async () => {
    await setGhlOAuthState('nonce-once', 'org-1');
    await consumeGhlOAuthState('nonce-once');
    expect(await consumeGhlOAuthState('nonce-once')).toBeNull();
  });

  it('concurrent consume — exactly one call returns the org, the other null', async () => {
    await setGhlOAuthState('nonce-race', 'org-1');
    const [r1, r2] = await Promise.all([
      consumeGhlOAuthState('nonce-race'),
      consumeGhlOAuthState('nonce-race'),
    ]);
    const results = [r1, r2];
    expect(results.filter(Boolean).length).toBe(1);
    expect(results.filter(r => r === null).length).toBe(1);
  });
});
```

- [ ] Run: `npx tsx server/tests/oauth-state-security.test.ts`
- [ ] Expected output: all 3 tests pass.

### Task 1.5 — Gate + commit

- [ ] `npm run typecheck && npm run lint && npm run build:server`

```bash
git add server/migrations/0277_oauth_state_nonces.sql \
        server/db/schema.ts \
        server/lib/ghlOAuthStateStore.ts \
        server/routes/ghl.ts \
        server/routes/oauthIntegrations.ts \
        server/tests/oauth-state-security.test.ts
git commit -m "security(oauth): replace in-memory state store with Postgres; bind org to nonce on callback (S-P0-1, S-P0-2)"
```

---

## Chunk 2 — Security Primitives (S-P0-3 verify, S-P0-5, S-P0-6, S-P0-7, S-P0-8, S-P0-9)

**Items:** S-P0-3 (verify), S-P0-5 (auth rate limit → DB), S-P0-6 (webhook HMAC boot assert), S-P0-7 (postMessage origin allowlist), S-P0-8 (multer cap 25MB), S-P0-9 (forgot/reset rate limit → DB)
**Dependencies:** S-P0-5 must complete before S-P0-9 (shared primitive)
**Target:** 1 PR, 1 day

### Files
- Verify: `server/routes/workflowDrafts.ts` (S-P0-3 — already done per pre-flight)
- Modify: `server/routes/auth.ts` — wire `inboundRateLimiter.check` to login, forgot-password, reset-password
- Modify: `server/index.ts` or `server/config/env.ts` — WEBHOOK_SECRET boot assertion
- Modify: `client/src/hooks/useOAuthPopup.ts` (or equivalent) — postMessage origin allowlist
- Modify: `server/middleware/validate.ts` — reduce multer limit to 25MB

### Task 2.1 — Verify S-P0-3 (workflow_drafts subaccount filter)

- [ ] Open `server/routes/workflowDrafts.ts`. Confirm the GET handler calls `userCanAccessSubaccount(req.user.id, req.user.role, draft.subaccountId)` and returns 404 on failure.
- [ ] If present: add comment `// S-P0-3: subaccount guard verified — returns 404 (not 403) on cross-subaccount access` and move on.
- [ ] If absent: add the check following the same pattern used in other routes that call `userCanAccessSubaccount`.

### Task 2.2 — Wire DB rate limiter to login (S-P0-5)

The DB-backed `inboundRateLimiter.ts` already exists with `check(key, limit, windowSec)`.

- [ ] Open `server/routes/auth.ts`. Find the `POST /api/auth/login` handler.
- [ ] Add at the top of the handler body, before credential lookup:

```typescript
import { check as rateLimitCheck, setRateLimitDeniedHeaders } from '../lib/inboundRateLimiter';

// Inside POST /api/auth/login:
// Compound key (IP + email) prevents both distributed-IP and credential-stuffing abuse
const rlLogin = await rateLimitCheck(
  `login:${req.ip ?? 'unknown'}:${(req.body.email as string | undefined) ?? 'unknown'}`,
  10,
  60
);
if (!rlLogin.allowed) {
  setRateLimitDeniedHeaders(res, rlLogin.resetAt, Date.now());
  res.status(429).json({ error: 'rate_limited' });
  return;
}
```

- [ ] `npm run typecheck` — confirm `check` return type aligns.

### Task 2.3 — Wire DB rate limiter to forgot/reset password (S-P0-9)

- [ ] In `server/routes/auth.ts`, find the forgot-password POST handler. Add:

```typescript
const rlFp = await rateLimitCheck(
  `forgot-password:${req.ip ?? 'unknown'}:${(req.body.email as string | undefined) ?? 'unknown'}`,
  5,
  300
);
if (!rlFp.allowed) {
  setRateLimitDeniedHeaders(res, rlFp.resetAt, Date.now());
  res.status(429).json({ error: 'rate_limited' });
  return;
}
```

- [ ] In the reset-password POST handler add the same pattern with key `reset-password:${req.ip ?? 'unknown'}:${req.body.email ?? 'unknown'}` at limit 5 per 300s.

### Task 2.4 — Webhook HMAC boot assertion (S-P0-6)

- [ ] Find where production env vars are validated at startup (search for `WEBHOOK_SECRET` or look at `server/config/env.ts`, `server/index.ts`).
- [ ] Add:

```typescript
if (process.env.NODE_ENV === 'production' && !process.env.WEBHOOK_SECRET) {
  throw new Error('FATAL: WEBHOOK_SECRET must be set in production. Refusing to start.');
}
```

- [ ] In `server/routes/webhooks/ghlWebhook.ts`, confirm that a missing/invalid HMAC always returns 401 in production (no "warn and continue" fallback). If the fallback exists, remove it for production.

### Task 2.5 — OAuth postMessage origin allowlist (S-P0-7)

- [ ] Search `client/src/` for `postMessage` — find the listener in `useOAuthPopup.ts` (or wherever the OAuth popup message is handled).
- [ ] Replace any `window.location.origin` comparison with an allowlist:

```typescript
const ALLOWED_ORIGINS = [
  window.location.origin,
  import.meta.env.VITE_API_ORIGIN,
].filter(Boolean) as string[];

window.addEventListener('message', (event) => {
  if (!ALLOWED_ORIGINS.includes(event.origin)) return;
  // ... existing handler
});
```

- [ ] Add `VITE_API_ORIGIN=` to `.env.example` with comment: `# Required when API host differs from app host (split-origin deploy)`.

### Task 2.6 — Reduce multer cap to 25MB (S-P0-8)

- [ ] Open `server/middleware/validate.ts`. Change the `limits.fileSize` value:

```typescript
// Before:
limits: { fileSize: 50 * 1024 * 1024 },
// After:
limits: { fileSize: 25 * 1024 * 1024 }, // 25MB cap — returns 413 on oversize (S-P0-8)
```

### Task 2.7 — Gate + commit

- [ ] `npm run typecheck && npm run lint && npm run build:server && npm run build:client`

```bash
git add server/routes/auth.ts \
        server/index.ts \
        server/middleware/validate.ts \
        client/src/hooks/useOAuthPopup.ts \
        .env.example
git commit -m "security: DB rate limiter on auth/forgot/reset, webhook HMAC boot assert, multer 25MB cap, postMessage allowlist (S-P0-3,5,6,7,8,9)"
```

---

## Chunk 3 — Auto-start Onboarding (S-P0-4, D-P0-1)

**Items:** S-P0-4 (GUC propagation on webhook/callback paths), D-P0-1 (pg-boss enqueue for onboarding)
**Dependencies:** Chunk 1 (Postgres-backed OAuth state store required; callback needs `withOrgTx`)
**Target:** 1 PR, 2–3 days

### Files
- Create: `server/jobs/ghlAutoStartOnboardingJob.ts`
- Modify: `server/routes/webhooks/ghlWebhook.ts` — replace inline sync onboarding with pg-boss enqueue; wrap in `withOrgTx`
- Modify: `server/routes/oauthIntegrations.ts` — ensure `withOrgTx` wraps all FORCE-RLS service calls in callback
- Create: `server/tests/ghl-auto-start-onboarding.test.ts`

### Task 3.1 — Create the pg-boss onboarding job

- [ ] Create `server/jobs/ghlAutoStartOnboardingJob.ts`:

```typescript
import { getPgBoss } from '../lib/pgBossInstance';

export const GHL_ONBOARD_JOB = 'ghl:autoStartOnboarding';

export interface GhlAutoStartOnboardingPayload {
  organisationId: string;
  locationId:     string;
  subaccountId:   string;
}

export async function enqueueGhlOnboarding(payload: GhlAutoStartOnboardingPayload): Promise<void> {
  const boss = await getPgBoss();
  await boss.send(GHL_ONBOARD_JOB, payload, {
    singletonKey: `onboard:${payload.organisationId}:${payload.locationId}`,
    singletonSeconds: 300, // deduplicate within 5-minute window
  });
}

export async function ghlAutoStartOnboardingWorker(
  job: { data: GhlAutoStartOnboardingPayload }
): Promise<void> {
  const { organisationId, locationId, subaccountId } = job.data;
  const { startOnboardingForLocation, isOnboardingStartedOrComplete } =
    await import('../services/onboardingWorkflowService');

  // Idempotency guard: pg-boss singleton prevents duplicate enqueue, but retries
  // can still fire. Skip silently if onboarding is already in progress or done.
  if (await isOnboardingStartedOrComplete({ organisationId, locationId })) {
    logger.info({ organisationId, locationId }, 'ghlAutoStartOnboarding: already started, skipping');
    return;
  }

  await startOnboardingForLocation({ organisationId, locationId, subaccountId });
}
```

- [ ] Register the worker in the server boot sequence (find where other `createWorker` calls live — likely `server/index.ts` or `server/jobs/index.ts`):

```typescript
import { GHL_ONBOARD_JOB, ghlAutoStartOnboardingWorker } from './jobs/ghlAutoStartOnboardingJob';
// ...
await createWorker(boss, GHL_ONBOARD_JOB, ghlAutoStartOnboardingWorker, {
  teamSize: 5,
  teamConcurrency: 5,
});
```

### Task 3.2 — Replace inline onboarding with enqueue; add `withOrgTx` (S-P0-4 + D-P0-1)

- [ ] Open `server/routes/webhooks/ghlWebhook.ts`. Find the `INSTALL_company` event handler where it currently loops through locations and starts onboarding inline.
- [ ] Replace the inline loop with pg-boss enqueue, wrapped in `withOrgTx`:

```typescript
import { enqueueGhlOnboarding } from '../../jobs/ghlAutoStartOnboardingJob';
import { withOrgTx } from '../../instrumentation';

// In the INSTALL_company handler, after resolving organisationId:
await withOrgTx(
  { tx: db, organisationId, source: 'webhook:ghl:INSTALL_company' },
  async () => {
    for (const location of locations) {
      await enqueueGhlOnboarding({
        organisationId,
        locationId:  location.id,
        subaccountId: location.subaccountId,
      });
    }
  }
);
res.status(200).json({ queued: locations.length });
return;
```

- [ ] In `server/routes/oauthIntegrations.ts`, find the OAuth callback flow. Any call to a FORCE-RLS service (e.g. onboarding service, subaccount service) must be inside a `withOrgTx` block. Wrap if not already:

```typescript
await withOrgTx(
  { tx: db, organisationId: stateData.organisationId, source: 'oauth:callback' },
  async () => {
    // ... existing service calls that touch FORCE-RLS tables
  }
);
```

### Task 3.3 — Test: deduplication on enqueue

- [ ] Create `server/tests/ghl-auto-start-onboarding.test.ts`:

```typescript
import { enqueueGhlOnboarding, GHL_ONBOARD_JOB } from '../jobs/ghlAutoStartOnboardingJob';
import { getPgBoss } from '../lib/pgBossInstance';

describe('GHL auto-start onboarding enqueue', () => {
  it('deduplicates identical org+location enqueue within the singleton window', async () => {
    const boss = await getPgBoss();
    await boss.deleteQueue(GHL_ONBOARD_JOB);

    const payload = { organisationId: 'org-t', locationId: 'loc-1', subaccountId: 'sub-1' };
    await enqueueGhlOnboarding(payload);
    await enqueueGhlOnboarding(payload); // duplicate — singletonKey should dedup

    const jobs = await boss.fetch(GHL_ONBOARD_JOB, { batchSize: 10 });
    expect(jobs?.length ?? 0).toBe(1);
  });
});
```

- [ ] Run: `npx tsx server/tests/ghl-auto-start-onboarding.test.ts`
- [ ] Expected: 1 job in queue after 2 identical enqueues.

### Task 3.4 — Gate + commit

- [ ] `npm run typecheck && npm run lint && npm run build:server`

```bash
git add server/jobs/ghlAutoStartOnboardingJob.ts \
        server/routes/webhooks/ghlWebhook.ts \
        server/routes/oauthIntegrations.ts \
        server/tests/ghl-auto-start-onboarding.test.ts
git commit -m "feat: replace inline onboarding with pg-boss queue; withOrgTx on webhook/callback (S-P0-4, D-P0-1)"
```

---

## Chunk 4 — Customer-Facing P0s (C-P0-1 through C-P0-8)

**Items:** C-P0-1 (integrationBlockService E-D4), C-P0-2 (OAuth resume restart), C-P0-3 (Universal Brief routes), C-P0-4 (thread-context injection), C-P0-5 (email tile), C-P0-6 (soft-delete sweep), C-P0-7 (mailbox/calendar shape), C-P0-8 (onboard CTA conditional)
**Dependencies:** Chunk 3 (OAuth callback restructured before wiring resume job)
**Target:** 2 PRs (4a: C-P0-1 + C-P0-2; 4b: remaining), 4–5 days

### Files (4a)
- Modify: `server/services/integrationBlockService.ts` — E-D4 unsafe-tool hard-block
- Create: `server/jobs/resumeRunAfterOAuthJob.ts`
- Modify: `server/routes/oauthIntegrations.ts` — enqueue resume job on successful OAuth

### Files (4b)
- Create/Modify: `server/routes/rules.ts` — draft-candidates + approve/reject routes
- Modify: run orchestrator (find via grep for `buildSystemPrompt`) — thread-context injection
- Modify: email tile component in `client/src/`
- Grep + fix: 17 soft-delete paths (from `tasks/todo.md:1543`)
- Modify: `client/src/pages/AgentMailboxPage.tsx`, `AgentCalendarPage.tsx` — shape fix
- Modify: onboard CTA component — conditional render

---

### Task 4.1 — integrationBlockService: E-D4 unsafe-tool hard-block (C-P0-1)

- [ ] Open `server/services/integrationBlockService.ts`. Find the TODO comment for E-D4 (~line 52).
- [ ] After the check that determines whether an integration is missing, add:

```typescript
const actionDef = ACTION_REGISTRY[toolName];
if (actionDef?.requiredIntegration?.strategy === 'unsafe') {
  // Unsafe tools cannot pause/resume — return a structured rejection the frontend can key on
  return {
    allowed: false,
    code: 'TOOL_NOT_RESUMABLE' as const,
    toolName,
    reason: `Tool "${toolName}" requires an integration that cannot be connected via OAuth pause/resume`,
  };
}
```

- [ ] Write test: call `checkRequiredIntegration` with a fixture tool that has `strategy: 'unsafe'` and the integration is missing; assert `result.code === 'TOOL_NOT_RESUMABLE'` and `result.toolName` is set. The frontend uses `result.code` to branch — tests must verify the structured shape, not just a thrown error.
- [ ] Run: `npx tsx server/tests/integration-block-service.test.ts`

### Task 4.2 — OAuth resume restart: enqueue resume job on successful OAuth (C-P0-2)

- [ ] Create `server/jobs/resumeRunAfterOAuthJob.ts`:

```typescript
import { getPgBoss } from '../lib/pgBossInstance';

export const RESUME_RUN_JOB = 'run:resumeAfterOAuth';

export interface ResumeRunPayload {
  runId:          string;
  organisationId: string;
}

export async function enqueueResumeAfterOAuth(payload: ResumeRunPayload): Promise<void> {
  const boss = await getPgBoss();
  await boss.send(RESUME_RUN_JOB, payload, {
    priority: 10,
    // Deduplication: if OAuth callback fires twice (retry/double-click), only one resume job runs
    singletonKey: `resume:${payload.runId}`,
    singletonSeconds: 60,
  });
}

export async function resumeRunAfterOAuthWorker(
  job: { data: ResumeRunPayload }
): Promise<void> {
  const { runId, organisationId } = job.data;
  const { resumeWorkflowRun } = await import('../services/workflowRunService');
  await resumeWorkflowRun(runId, organisationId);
}
```

- [ ] Register the worker in the server boot sequence alongside other workers.
- [ ] Persist `pendingRunId` durably. During the OAuth pause flow (where a run halts waiting for the user to connect an integration), write the `pendingRunId` to a DB column or a small table keyed by nonce — do not rely solely on in-memory state or the session cookie. Retrieve it in the callback by looking up the nonce record. Example column addition: `ALTER TABLE oauth_state_nonces ADD COLUMN pending_run_id uuid;` (or a separate `oauth_pending_resumes` table if the nonces table is immutable post-migration).

- [ ] In `server/routes/oauthIntegrations.ts`, after successful OAuth token exchange, retrieve and clear the pending run ID from the DB record, then enqueue:

```typescript
const pendingRunId = stateData.pendingRunId ?? null;
if (pendingRunId) {
  await enqueueResumeAfterOAuth({ runId: pendingRunId, organisationId: stateData.organisationId });
} else {
  logger.warn(
    { organisationId: stateData.organisationId, nonce },
    'oauth:callback — no pendingRunId found; run will not be auto-resumed'
  );
}
```

- [ ] Update any client UI copy that says "Connected! Continuing execution..." to only appear after the enqueue confirmation, not before.
- [ ] Write test: simulate OAuth callback with `pendingRunId` in state; assert `RESUME_RUN_JOB` job exists in queue.

### Task 4.3 — Universal Brief: approve/reject + draft-candidates routes (C-P0-3)

- [ ] Search `server/routes/` for `draft-candidates` or `rules`. Find the route file or confirm it needs to be created.
- [ ] Implement the three missing endpoints (the `BriefApprovalCard` expects them at `/api/rules/draft-candidates`):

```typescript
// GET /api/rules/draft-candidates
router.get('/draft-candidates', requirePermission('org.agents.view'), async (req, res) => {
  const candidates = await draftCandidatesService.list(req.user!.organisationId);
  res.json({ data: candidates });
});

// POST /api/rules/draft-candidates/:id/approve
router.post('/draft-candidates/:id/approve', requirePermission('org.agents.edit'), async (req, res) => {
  const result = await draftCandidatesService.approve(
    req.params.id, req.user!.organisationId, req.user!.id
  );
  res.json({ data: result });
});

// POST /api/rules/draft-candidates/:id/reject
router.post('/draft-candidates/:id/reject', requirePermission('org.agents.edit'), async (req, res) => {
  const result = await draftCandidatesService.reject(
    req.params.id, req.user!.organisationId, req.user!.id
  );
  res.json({ data: result });
});
```

- [ ] Implement `draftCandidatesService.approve` and `.reject` — transition state and emit an event via `appendAndEmitTaskEvent`.
- [ ] Write test: POST approve → assert state row transitions, event emitted.

### Task 4.4 — Thread context injection at run start and resume (C-P0-4)

- [ ] Search `server/` for `buildSystemPrompt` or `systemPrompt` construction before a run starts. Note the file and function name.
- [ ] In that function, add thread-context injection:

```typescript
import { threadContextService } from './threadContextService';

async function buildSystemPrompt(runCtx: RunContext): Promise<string> {
  const base = getBaseSystemPrompt(runCtx.agent);
  // Capture an immutable snapshot at run-start time, keyed by version.
  // Mid-run updates to thread context do NOT affect the active run's prompt —
  // re-reads would produce unpredictable prompt drift.
  const snapshot = await threadContextService.getContextSnapshot(
    runCtx.taskId, runCtx.organisationId
  );
  if (!snapshot) return base;
  // Store snapshot.version on runCtx so resume paths re-inject the same snapshot
  runCtx.threadContextVersion = snapshot.version;
  const ctxBlock = formatContextBlock(snapshot);
  return `${base}\n\n## Current task context\n${ctxBlock}`;
}
```

- [ ] Confirm the run-resume entry point calls the same `buildSystemPrompt` (or an equivalent that re-injects context) **using the version stored at run-start** (`runCtx.threadContextVersion`). Pass the stored version to `getContextSnapshot` so the resume path injects the identical snapshot. If the resume path takes a shortcut that skips prompt building entirely, add the injection call there too.
- [ ] Write test: insert a thread-context snapshot, start a mock run, assert the captured system prompt string contains the context text.

### Task 4.5 — Email tile config UI (C-P0-5)

- [ ] Search `client/src/` for `EmailChannelTile` or email-related tile components.
- [ ] In the component, replace the unconditional placeholder render with:

```tsx
if (!agent.channels?.includes('email')) return null;
if (!agent.emailConfig) {
  return <EmailConfigSetupCard agentId={agent.id} />;
}
return <EmailConfigEditor config={agent.emailConfig} agentId={agent.id} />;
```

- [ ] Verify the email config saves via the existing API route and persists across reload.
- [ ] Write test: render with `channels: ['email']` + no config → setup card; with config → editor; no email channel → null.

### Task 4.6 — Soft-delete sweep across 17 paths (C-P0-6)

- [ ] Run to find joins without `deleted_at IS NULL`:

```bash
grep -rn "\.from\|\.join\|\.where" server/services/ server/routes/ --include="*.ts" \
  | grep -v "deletedAt\|deleted_at" \
  | head -80
```

- [ ] Cross-reference with the 17 paths listed at `tasks/todo.md:1543`. For each path, add `isNull(table.deletedAt)` (Drizzle) or `deleted_at IS NULL` (raw SQL) to the WHERE clause.
- [ ] Create a shared helper in `server/lib/queryHelpers.ts` (or add to an existing helpers file):

```typescript
import { isNull } from 'drizzle-orm';

// Use instead of raw isNull(table.deletedAt) so future renames stay correct
export const isActive = <T extends { deletedAt: unknown }>(table: T) =>
  isNull(table.deletedAt);
```

Replace raw `isNull(table.deletedAt)` calls across the 17 paths with `isActive(table)`.

- [ ] Add a comment in `DEVELOPMENT_GUIDELINES.md` §8: "All joins on soft-deletable tables must use `isActive(table)` (from `server/lib/queryHelpers`). Raw `deletedAt` comparisons are a lint-waivable finding that must be explicitly justified."
- [ ] Write tests for the 3 highest-risk paths: agent routing, workspace health listing, org hierarchy. Soft-delete an entity; assert it is excluded from each path's result.

### Task 4.7 — AgentMailbox / AgentCalendar shape fix (C-P0-7)

- [ ] Open `client/src/pages/AgentMailboxPage.tsx`. Find where it reads `toAddress` (singular) from the API response. The route returns `toAddresses` (array).
- [ ] Update the consumer to use `toAddresses[0]` or render all addresses.
- [ ] Open `client/src/pages/AgentCalendarPage.tsx`. Apply the same pattern if a similar shape mismatch exists.
- [ ] Write test: mock API response with `toAddresses: ['a@b.com']`; confirm mailbox page renders `a@b.com`.

### Task 4.8 — Conditional "Onboard to workplace" CTA (C-P0-8)

- [ ] Search `client/src/` for the "Onboard to workplace" button text. Find the component.
- [ ] Wrap the CTA in a conditional:

```tsx
{(row.identityStatus === 'pending' || row.identityStatus === null) && (
  <Button onClick={() => handleOnboard(row)}>Onboard to workplace</Button>
)}
```

- [ ] Write test: render with `identityStatus: 'active'` → no CTA rendered; with `identityStatus: null` → CTA present.

### Task 4.9 — Gate + commit (split into 4a and 4b)

- [ ] `npm run typecheck && npm run lint && npm run build:client && npm run build:server`

```bash
# 4a PR:
git add server/services/integrationBlockService.ts \
        server/jobs/resumeRunAfterOAuthJob.ts \
        server/routes/oauthIntegrations.ts
git commit -m "feat: integration-block E-D4 hard-block; OAuth resume restart job (C-P0-1, C-P0-2)"

# 4b PR:
git add server/routes/rules.ts \
        server/services/draftCandidatesService.ts \
        server/services/agentRunOrchestrator.ts \
        client/src/components/EmailChannelTile.tsx \
        client/src/pages/AgentMailboxPage.tsx \
        client/src/pages/AgentCalendarPage.tsx
# ... plus all soft-delete path files
git commit -m "feat: Universal Brief routes, thread-context injection, email tile, soft-delete sweep, shape fixes, onboard CTA conditional (C-P0-3 through C-P0-8)"
```

---

## Chunk 5 — Data Integrity P0s (D-P0-2 through D-P0-7)

**Items:** D-P0-2 (step.approval_resolved), D-P0-3 (23505→409 on direct INSERT), D-P0-4 (version predicate), D-P0-5 (durable task event emission), D-P0-6 (resolver atomicity), D-P0-7 (run-depth fail-fast)
**Dependencies:** Chunk 3 (pg-boss running; `appendAndEmitTaskEvent` stable API)
**Target:** 1–2 PRs, 3–4 days
**Strategy:** D-P0-5 (schema migration) is the largest item. Do it last in this chunk — all other D-P0 items are incremental changes to existing services.

### Files
- Modify: approval-state transition service (grep for `resolveApproval` or `updateApprovalState`) — emit `step.approval_resolved`
- Modify: all direct `db.insert(workflowRuns)` calls outside helper — convert to helper
- Modify: `server/services/threadContextService.ts` — add `version` predicate
- Create: `server/lib/errors.ts` (or add to existing) — `OptimisticLockError`
- Create: `server/migrations/0278_task_events.sql` + add schema entry
- Modify: `server/services/taskEventService.ts` — persist events to DB before socket emit
- Modify: `server/services/externalDocumentResolver.ts` — wrap writes in single transaction
- Create: `server/lib/runDepthGuard.ts` + modify all run-entry points

---

### Task 5.1 — step.approval_resolved event emission (D-P0-2)

- [ ] Search `server/services/` for where approval state transitions out of `pending` (grep for `approved`, `rejected`, `resolveApproval`, or `updateApprovalState`). Note the file and function.
- [ ] In every transition path (both approve and reject), emit the event **in the same transaction as the state change**:

```typescript
import { appendAndEmitTaskEvent } from './taskEventService';

// Inside the same transaction that updates the approval row:
await appendAndEmitTaskEvent(
  { taskId, organisationId, subaccountId },
  'engine',
  {
    type: 'step.approval_resolved',
    stepId,
    decision,    // 'approved' | 'rejected'
    decidedBy:   userId,
    // Use DB time — avoids clock-skew across nodes affecting ordering/audit trails
    decidedAt:   sql`now()`,
  }
);
```

- [ ] Enforce "emitted exactly once per step" via a unique constraint (preferred) or a state-transition guard. Simplest approach — add to the migration a partial unique index:

```sql
CREATE UNIQUE INDEX uniq_approval_resolved_per_step
  ON task_events (task_id, payload->>'stepId')
  WHERE event_type = 'step.approval_resolved';
```

This prevents duplicate emission at the DB level regardless of retry paths.

- [ ] If there is a bulk-approval path (multiple steps at once), emit one event per step.
- [ ] Write test: attempt to emit two `step.approval_resolved` events for the same `(taskId, stepId)`; assert the second write is rejected by the unique index.

### Task 5.2 — workflow_runs direct INSERT → 409 conversion (D-P0-3)

- [ ] Add a partial unique index to the `workflow_runs` table via migration. This is the DB-level invariant that makes the 23505→409 conversion reliable across all insert paths:

```sql
-- In server/migrations/0277_oauth_state_nonces.sql or a new migration file
CREATE UNIQUE INDEX uniq_active_run_per_task
  ON workflow_runs(task_id)
  WHERE status NOT IN ('completed', 'failed', 'cancelled');
```

This ensures the "one active run per task" rule is enforced by the DB engine, not just application code.

- [ ] Find `server/lib/workflowRunHelper.ts` (or equivalent). Confirm it catches Postgres error code `23505` and throws `TaskAlreadyHasActiveRunError`.
- [ ] Search for `db.insert(workflowRuns)` or raw `INSERT INTO workflow_runs` calls outside the helper:

```bash
grep -rn "insert.*workflowRuns\|INSERT INTO workflow_runs" server/ --include="*.ts" \
  | grep -v workflowRunHelper
```

- [ ] For each hit: replace with the helper call, or wrap in a try/catch that converts `23505` to the same error.
- [ ] Write test: start two concurrent runs for the same task ID; assert the second call returns an error with code `task_already_has_active_run` (not a raw 500).

### Task 5.3 — Concurrency guard version predicate (D-P0-4)

- [ ] Open `server/services/threadContextService.ts`. Find the method that patches/updates a thread-context row.
- [ ] Add optimistic locking:

```typescript
import { OptimisticLockError } from '../lib/errors';

// In the patch method, replace the simple UPDATE with:
const updated = await tx
  .update(threadContexts)
  .set({ ...patch, version: sql`version + 1`, updatedAt: new Date() })
  .where(and(eq(threadContexts.id, id), eq(threadContexts.version, expectedVersion)))
  .returning({ id: threadContexts.id });

if (updated.length === 0) {
  throw new OptimisticLockError(`Thread context ${id} modified concurrently — retry`);
}
```

- [ ] Add to `server/lib/errors.ts`:

```typescript
export class OptimisticLockError extends Error {
  readonly code = 'optimistic_lock_conflict';
  constructor(message: string) { super(message); this.name = 'OptimisticLockError'; }
}
```

- [ ] **Retry strategy (caller responsibility):** Document that callers of the patch method own retry logic. Recommended: up to 3 retries with 50ms backoff; re-fetch the current version before each retry. Add a JSDoc comment on the method:

```typescript
/**
 * Updates a thread context row. Throws OptimisticLockError on concurrent modification.
 * Callers should retry with exponential backoff (≤3 attempts) after re-reading the
 * current version. Do NOT pass a stale version into a retry — always re-fetch first.
 */
```

- [ ] Write test: two concurrent updaters race against the same row version; assert one succeeds, one throws `OptimisticLockError`.

### Task 5.4 — Durable task event emission (D-P0-5)

This is the largest task in Chunk 5. It adds a `task_events` table and makes `appendAndEmitTaskEvent` write to it.

- [ ] Create `server/migrations/0278_task_events.sql`:

```sql
CREATE TABLE task_events (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id          uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  organisation_id  uuid        NOT NULL,
  subaccount_id    uuid,
  seq              integer     NOT NULL,
  event_type       text        NOT NULL,
  payload          jsonb       NOT NULL DEFAULT '{}',
  origin           text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, seq)
);
CREATE INDEX idx_task_events_task_seq  ON task_events (task_id, seq);
CREATE INDEX idx_task_events_org_time  ON task_events (organisation_id, created_at);
```

- [ ] Run `npm run db:generate`.
- [ ] Add Drizzle schema definition in `server/db/schema.ts`:

```typescript
export const taskEvents = pgTable('task_events', {
  id:             uuid('id').primaryKey().defaultRandom(),
  taskId:         uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  organisationId: uuid('organisation_id').notNull(),
  subaccountId:   uuid('subaccount_id'),
  seq:            integer('seq').notNull(),
  eventType:      text('event_type').notNull(),
  payload:        jsonb('payload').notNull().default({}),
  origin:         text('origin').notNull(),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniq: unique().on(t.taskId, t.seq) }));
```

- [ ] Confirm that `allocateEventSeq` is atomic. It must use a `SELECT ... FOR UPDATE` or advisory lock pattern, NOT a plain `MAX(seq) + 1` without locking:

```typescript
// CORRECT — atomic sequence allocation inside the same transaction
async function allocateEventSeq(tx: Tx, taskId: string): Promise<number> {
  const [row] = await tx
    .select({ seq: sql<number>`COALESCE(MAX(seq), 0) + 1` })
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .for('update'); // row-level lock prevents concurrent gap
  return row.seq;
}
```

If a dedicated `task_event_seqs` sequence table exists or is preferred, that is also acceptable — just ensure it is not subject to concurrent gaps.

- [ ] Open `server/services/taskEventService.ts`. In `appendAndEmitTaskEvent`, insert the row **inside** the transaction, then emit via socket **after** the transaction commits:

```typescript
let seq: number;
await db.transaction(async (tx) => {
  seq = await allocateEventSeq(tx, ctx.taskId);
  await tx.insert(taskEvents).values({
    taskId:         ctx.taskId,
    organisationId: ctx.organisationId,
    subaccountId:   ctx.subaccountId ?? null,
    seq,
    eventType:      event.type,
    payload:        event as Record<string, unknown>,
    origin:         eventOrigin,
  });
}); // tx committed here — only THEN emit to sockets

// Socket emit is a notification, NOT the source of truth.
// Emitting inside the tx would notify clients before the row is durable.
emitTaskEvent(ctx.taskId, buildEventEnvelope(event, seq!));
```

- [ ] Add a payload size guard in `appendAndEmitTaskEvent` before the insert:

```typescript
const payloadBytes = Buffer.byteLength(JSON.stringify(event));
if (payloadBytes > 64 * 1024) { // 64KB cap
  throw new Error(`task_events payload too large: ${payloadBytes} bytes for event type ${event.type}`);
}
```

Adjust the threshold if your largest legitimate payload is near that range.

- [ ] Write test: emit an event, then query `task_events` for `(taskId, seq)` — assert the row exists with correct `event_type` and `payload`. Simulate socket disconnect mid-test and confirm the row persists.

### Task 5.5 — Resolver write atomicity (D-P0-6)

- [ ] Open `server/services/externalDocumentResolver.ts`. Find where cache upsert, audit row, and state transition are written separately.
- [ ] Wrap all three writes in a single transaction:

```typescript
await db.transaction(async (tx) => {
  // Idempotency key on cache upsert: concurrent resolution of the same document
  // must not produce two cache rows — the onConflictDoUpdate makes this idempotent
  await tx.insert(documentCache)
    .values({ ...cachePayload, idempotencyKey: referenceId }) // referenceId is stable
    .onConflictDoUpdate({
      target: documentCache.idempotencyKey,
      set: cachePayload,
    });
  await tx.insert(auditEvents).values(auditPayload);
  await tx.update(documentReferences)
    // Use DB time to avoid clock-skew on resolvedAt ordering
    .set({ state: 'resolved', resolvedAt: sql`now()` })
    .where(eq(documentReferences.id, referenceId));
});
```

- [ ] Write test: inject a simulated failure after the first write (e.g. throw inside the transaction after inserting cache); assert neither the cache row nor the audit row persists (full rollback).

### Task 5.6 — Run-depth fail-fast at every entry point (D-P0-7)

- [ ] Create `server/lib/runDepthGuard.ts`:

```typescript
export const MAX_WORKFLOW_RUN_DEPTH = 10;

export class RunDepthExceededError extends Error {
  readonly code = 'run_depth_exceeded';
  constructor(depth: number) {
    super(`Workflow run depth ${depth} exceeds max ${MAX_WORKFLOW_RUN_DEPTH}`);
    this.name = 'RunDepthExceededError';
  }
}

export function assertRunDepth(currentDepth: number, context?: { runId?: string; taskId?: string }): void {
  if (currentDepth >= MAX_WORKFLOW_RUN_DEPTH) {
    // Log before throwing so the event appears in observability even if the caller
    // catches and swallows the error
    logger.warn(
      { currentDepth, maxDepth: MAX_WORKFLOW_RUN_DEPTH, ...context },
      'run_depth_exceeded: refusing to start nested workflow run'
    );
    throw new RunDepthExceededError(currentDepth);
  }
}
```

- [ ] Find all run-entry points (grep for `startRun`, `startWorkflowRun`, the pg-boss worker that processes runs, and the skill dispatcher). In each one, before any DB writes:

```typescript
import { assertRunDepth } from '../lib/runDepthGuard';

const currentDepth = runContext.metadata?.workflow_run_depth ?? 0;
assertRunDepth(currentDepth);
```

- [ ] Write test: submit a run with `metadata: { workflow_run_depth: 10 }` to each entry point; assert `RunDepthExceededError` is thrown with code `run_depth_exceeded` at each point.

### Task 5.7 — Gate + commit

- [ ] `npm run typecheck && npm run lint && npm run build:server`
- [ ] `npm run db:generate` — verify 0278 migration appears.

```bash
git add server/migrations/0278_task_events.sql \
        server/db/schema.ts \
        server/services/taskEventService.ts \
        server/services/threadContextService.ts \
        server/services/externalDocumentResolver.ts \
        server/lib/runDepthGuard.ts \
        server/lib/errors.ts
# Plus any modified approval-state service and workflowRuns insert sites
git commit -m "data-integrity: durable task events, approval_resolved, version predicate, 23505→409, resolver atomicity, run-depth fail-fast (D-P0-2 through D-P0-7)"
```

---

## Chunk 6 — Operational Readiness P0s (O-P0-1 through O-P0-5)

**Items:** O-P0-1 (CI verifier wiring), O-P0-2 (verifier sweep), O-P0-3 (backup/restore runbook + reseed env guard), O-P0-4 (verify reseed_restore_users transaction), O-P0-5 (skill-analyzer pipeline observability)
**Dependencies:** None — can start in parallel with Chunk 4 after Chunk 3 lands
**Target:** 1 PR, 1–2 days

### Files
- Create: `.github/workflows/workspace-actor-coverage.yml`
- Modify: `.github/workflows/*.yml` — flip verifier scripts from warning to failure after sweep
- Modify: `scripts/_reseed_drop_create.ts` — add production env guard
- Create: `docs/runbooks/backup-restore.md`
- Verify: `scripts/_reseed_restore_users.ts` — already transactional (pre-flight check)
- Modify: skill-analyzer pipeline files — replace `conversationId: ''` placeholders

---

### Task 6.1 — CI: wire workspace-actor-coverage verifier (O-P0-1)

- [ ] Confirm `scripts/verify-workspace-actor-coverage.ts` exists (it should per the pre-prod-boundary spec). If not, create a minimal version that exits non-zero when a route file lacks a workspace-actor declaration.
- [ ] Create `.github/workflows/workspace-actor-coverage.yml`:

```yaml
name: Workspace Actor Coverage

on:
  pull_request:
  push:
    branches: [main]   # also enforce on direct pushes to main

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npx tsx scripts/verify-workspace-actor-coverage.ts
```

- [ ] Introduce an intentional gap in a fixture route file. Push the branch and confirm CI is red. Remove the gap; confirm CI is green.

### Task 6.2 — Verifier sweep: resolve all warnings (O-P0-2)

- [ ] Run locally:

```bash
bash scripts/verify-input-validation.sh 2>&1 | head -100
bash scripts/verify-permission-scope.sh 2>&1 | head -100
```

- [ ] For each warning line, either:
  - Add Zod input schema + `requirePermission(...)` middleware to the route, or
  - Add a waiver comment explaining why the route is exempt:
    ```typescript
    // INPUT-VALIDATION-WAIVER: public health endpoint, no user input accepted
    // PERMISSION-SCOPE-WAIVER: read-only public pricing data, no auth required
    ```
- [ ] After resolving all warnings, change both scripts to exit with code 1 (not 0) when warnings remain. Confirm CI is green with all-clear.

### Task 6.3 — Reseed env guard (O-P0-3 part 1)

- [ ] Open `scripts/_reseed_drop_create.ts`. Add at the very top of the main block:

```typescript
if (process.env.NODE_ENV === 'production') {
  console.error('FATAL: _reseed_drop_create must not be run in production. Exiting.');
  process.exit(1);
}
```

- [ ] Test: `NODE_ENV=production npx tsx scripts/_reseed_drop_create.ts`
- [ ] Expected: exits with code 1 immediately, no DB changes.

### Task 6.4 — Backup/restore runbook (O-P0-3 part 2)

- [ ] Create `docs/runbooks/backup-restore.md`. Include:
  - **Automated backups:** how they are configured (Neon/Supabase/RDS — fill in the provider used), retention period.
  - **Point-in-time restore (PITR):** step-by-step console procedure to restore to a specific timestamp.
  - **Manual `pg_restore`:** command to restore from a `.dump` file to a target database.
  - **Restore drill procedure:** clone the DB, run restore, then run the following validation queries:
    ```sql
    -- 1. Row-count sanity
    SELECT COUNT(*) FROM organisations;
    SELECT COUNT(*) FROM agents;
    SELECT COUNT(*) FROM workflow_runs;

    -- 2. Orphaned rows check (task_events without a parent task)
    SELECT COUNT(*) FROM task_events te
    LEFT JOIN tasks t ON t.id = te.task_id
    WHERE t.id IS NULL;

    -- 3. FK integrity spot-check (workflow_runs → tasks)
    SELECT COUNT(*) FROM workflow_runs wr
    LEFT JOIN tasks t ON t.id = wr.task_id
    WHERE t.id IS NULL;

    -- 4. Recent-writes check (at least one workflow_run in the last backup window)
    SELECT MAX(created_at) FROM workflow_runs;
    ```
    All orphaned-row counts must be 0. `MAX(created_at)` must fall within the RPO window.
  - **RPO target:** e.g., 1 hour (backup frequency).
  - **RTO target:** e.g., 4 hours (time to restore and verify).
  - **Escalation path:** who to page and in what order.
- [ ] Conduct the restore drill against staging using a recent snapshot. Note any gaps in the runbook and fix them.

### Task 6.5 — Verify reseed_restore_users transaction (O-P0-4)

- [ ] Open `scripts/_reseed_restore_users.ts`. Confirm it wraps its update loop in `BEGIN`/`COMMIT`/`ROLLBACK` (per pre-flight check, it should already).
- [ ] If confirmed: add comment `// O-P0-4: verified — full transaction wrap; rollback on error`.
- [ ] If missing: wrap the update loop in a transaction using the existing `pg.Client`:

```typescript
await client.query('BEGIN');
try {
  for (const user of users) {
    // ... existing UPDATE statements
  }
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
}
```

### Task 6.6 — Skill-analyzer pipeline observability (O-P0-5)

- [ ] Run: `grep -rn "conversationId: ''" server/ --include="*.ts"` — find all TODO markers.
- [ ] For each hit: replace the empty string with the actual `conversationId` from the pipeline context object. Example:

```typescript
// Before:
logger.info({ conversationId: '', event: 'skill.resume' }, 'Resuming skill analyzer');

// After:
logger.info({ conversationId: ctx.conversationId, event: 'skill.resume' }, 'Resuming skill analyzer');
```

- [ ] In the retry path, add `retryCount` to the log:

```typescript
logger.warn({
  conversationId: ctx.conversationId,
  retryCount,
  event: 'skill.retry',
}, 'Retrying skill analyzer');
```

- [ ] Write test: run a fixture conversation through the pipeline; collect log output; assert all lines contain a non-empty `conversationId` and retry lines contain `retryCount`.

### Task 6.7 — Gate + commit

- [ ] `npm run typecheck && npm run lint && npm run build:server`

```bash
git add .github/workflows/workspace-actor-coverage.yml \
        scripts/_reseed_drop_create.ts \
        docs/runbooks/backup-restore.md \
        scripts/verify-input-validation.sh \
        scripts/verify-permission-scope.sh
# Plus all skill-analyzer pipeline files modified in 6.6
git commit -m "ops: CI workspace-actor-coverage, verifier sweep failure mode, reseed env-guard, backup/restore runbook, skill-analyzer observability (O-P0-1 through O-P0-5)"
```

---

## Phase 1 Exit Gate Checklist

Before merging `claude/pre-launch-phase-1` to main and starting Phase 2:

**Static checks (all must be clean)**
- [ ] `npm run lint` — zero errors
- [ ] `npm run typecheck` — zero errors
- [ ] `npm run build:server` — clean
- [ ] `npm run build:client` — clean

**Review pass**
- [ ] `spec-conformance` — returns CONFORMANT against `tasks/builds/pre-launch-hardening/spec.md`
- [ ] `pr-reviewer` — no must-fix findings
- [ ] `adversarial-reviewer` — no P0 findings

**Security tests**
- [ ] Cross-org nonce test: issue state as Org A, attempt callback as Org B → 403 `cross_org_state_mismatch`
- [ ] Second-instance state read: issue state on one process, consume via DB (simulate two processes) → succeeds
- [ ] Multi-process rate limit: 11 login attempts with shared DB bucket → 429 on 11th regardless of process routing
- [ ] Webhook with missing HMAC → 401; valid HMAC → 200
- [ ] `WEBHOOK_SECRET` unset in production env → startup refuses to boot
- [ ] Upload 26MB → 413; upload 1MB → 200

**Data integrity tests**
- [ ] Concurrent thread-context patch → one succeeds, one `OptimisticLockError`
- [ ] Two concurrent run-starts on same task → one 200, one 409 `task_already_has_active_run`
- [ ] Emit event, query `task_events` table, assert row exists and matches
- [ ] Resolver: inject failure mid-transaction, assert zero partial state
- [ ] Deep-recursion run at depth 10 → `run_depth_exceeded` at every entry point

**Customer-facing tests**
- [ ] Approve a Universal Brief → row transitions, event emitted, UI updates
- [ ] Soft-delete agent, run routing → deleted agent is not selected
- [ ] AgentMailboxPage renders `toAddresses[0]` correctly

**Operational tests**
- [ ] `NODE_ENV=production npx tsx scripts/_reseed_drop_create.ts` → exit 1, no DB changes
- [ ] Restore drill: restore staging from snapshot, verify row counts
- [ ] Skill-analyzer pipeline logs: all lines carry non-empty `conversationId`

**Event ordering test**
- [ ] Emit 3 events for the same `taskId` inside one transaction; query `task_events ORDER BY seq ASC`; assert `seq` values are `[1, 2, 3]` with no gaps.

**Idempotency replay tests**
- [ ] Replay the GHL INSTALL webhook twice with identical payload → assert only one onboarding job enqueued (pg-boss queue shows 1 job, not 2).
- [ ] Replay the OAuth callback twice with the same nonce → first returns 200, second returns 400 `invalid_or_expired_state` (nonce was consumed on first call).
- [ ] Call `enqueueGhlOnboarding` twice with identical `(organisationId, locationId)` → assert 1 job in queue.
- [ ] Call `enqueueResumeAfterOAuth` twice with the same `runId` → assert 1 resume job (singletonKey deduplication).

**Multi-node simulation (lightweight)**
- [ ] Using two concurrent pg-boss worker instances in the same test process, fire one `GHL_ONBOARD_JOB` → assert `startOnboardingForLocation` is called exactly once across both workers (idempotency guard prevents double-run even if pg-boss delivers to both briefly).
- [ ] Fire two concurrent `createWorkflowRun` calls for the same `taskId` → assert exactly one succeeds with 200 and the other returns 409.

**Smoke test (on staging)**
- [ ] Full onboarding flow: signup → OAuth install → pg-boss auto-start drains → first agent run → OAuth pause (missing integration) → reconnect → resume job queued → run completes

---

## What comes next

After Phase 1 exit gate passes, write the **Phase 2 plan** using spec §4.2, §5.1, §6.2, §7.2, §8.1 (the 50 P1 items). Phase 2 runs on `claude/pre-launch-phase-2`. Expect ~5–6 chunks covering: cross-cutting client foundations (ErrorBoundary, axios timeout, silent-catch sweep), centralised audit log, webhook 5xx incident coverage, soft-delete P1 sweep, schema indexes + scalability, customer-correctness P1s, compliance runbooks.

After Phase 2 exit gate passes, write the **Phase 3 plan** using spec §5.2, §6.3, §7.3 (the 7 P2 items). Phase 3 runs on `claude/pre-launch-phase-3`. P2 items are deferrable to immediately post-launch if calendar pressure forces a cut.

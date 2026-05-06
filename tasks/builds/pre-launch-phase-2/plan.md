# Pre-Launch Hardening — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close ~50 P1 items across 7 chunks before any paying-customer onboarding begins. Phase 1 closed all 25 P0 items (PR #261, merged 2026-05-05); Phase 2 closes the next-priority hardening surface — client foundations, centralised audit log, soft-delete coverage, schema scalability, deferred customer-correctness items, maintenance-job RLS, execution-path correctness, gate hygiene, and compliance runbooks.

**Architecture:** Seven sequential chunks on branch `claude/pre-launch-phase-2`. Chunks 1-2 (foundations + audit) ship first because every later chunk reuses the audit-log primitive. Chunks 3-4 (data hygiene) ship in parallel after Chunk 2 lands. Chunks 5-7 ship sequentially after Chunks 3-4. Phase 2 exit gate requires `pr-reviewer` + `adversarial-reviewer` + `chatgpt-pr-review` green before Phase 3 starts.

**Tech Stack:** Node 20 + Express + Drizzle ORM + PostgreSQL 15, React 18 + Vite, pg-boss v9 for queues, AsyncLocalStorage (`withOrgTx`) for org-context propagation, Zod for validation.

---

## Scope note

This plan covers **Phase 2 only** — 53 P1 items, ~16-18 dev-days.
Phase 3 plan (7 P2 items) written after Phase 2 exit gate.
Each phase runs on its own branch (`claude/pre-launch-phase-1` shipped, `-phase-2` is this plan, `-phase-3` follows).

---

## Model-collapse check

This work is mechanical multi-domain hardening (timeouts, indexes, soft-delete filters, audit logging, runbooks, RLS contract enforcement). It does not decompose into ingest → extract → transform → render. There is no LLM call in the operating loop of the work itself, and no candidate user-facing surface to collapse into a single structured-output model call. Rejected: not applicable to a hardening sweep.

---

## Table of contents

1. Cross-cutting invariants
2. Pre-flight
3. Chunk 1 — Client Foundations (ErrorBoundary expansion, axios timeout, OrgAdminGuard role gate, silent-catch sweep, TOKEN_ENCRYPTION_KEY validation)
4. Chunk 2 — Centralised Audit Log + Webhook 5xx Incident Coverage
5. Chunk 3 — Soft-Delete Sweep + RLS/Scoping Invariants
6. Chunk 4 — Schema Indexes + Auth Lifecycle Hardening
7. Chunk 5 — Customer Correctness P1s (deferred from Phase 1)
8. Chunk 6 — Maintenance Job RLS Contract + Execution-Path Correctness
9. Chunk 7 — Compliance Runbooks + Gate Hygiene
10. Phase 2 Exit Gate Checklist
11. Executor notes
12. What comes next
13. Deferred Items
14. Decisions locked in (operator-approved 2026-05-05)

---

## 1. Cross-cutting invariants

These rules apply globally. Violating them in any chunk is a blocking finding at the exit gate. Cite the per-chunk-relevant invariant numbers in chunk-level review logs.

The full invariant taxonomy is in [`docs/pre-launch-hardening-invariants.md`](../../../docs/pre-launch-hardening-invariants.md). The most load-bearing rules for Phase 2 are repeated below for the executor's convenience.

1. **DB time over app time** (Phase 1 invariant 1). Any timestamp affecting correctness (TTL, ordering, expiry, audit) uses `sql\`now()\``, not `new Date()`. Clock skew across nodes breaks expiry and ordering. Applies to: every audit-log write in Chunk 2, every soft-delete WHERE in Chunk 3, every index-backed range query in Chunk 4.
2. **Every external trigger is idempotent** (Phase 1 invariant 2). Webhooks, OAuth callbacks, queue enqueues are safe to replay. Enforce via singleton keys, `ON CONFLICT DO NOTHING`, or pre-insert existence checks. Applies to: webhook 5xx incident `recordIncident` in Chunk 2 (uses `fingerprintOverride`), OAuth resume wiring in Chunk 2, all maintenance jobs in Chunk 6.
3. **Emit after commit** (Phase 1 invariant 3). No socket or event emission inside an open transaction. Insert the row first; emit to sockets only after commit. Applies to: all audit-log emissions in Chunk 2, all run-state writes in Chunk 6.
4. **No `import { db }` in routes or lib against tenant tables** (invariants doc § 1.4). Routes and `server/lib/**` call services. Applies to: every silent-catch fix in Chunk 1 that changes a route handler, every audit-log write in Chunk 2, every soft-delete fix in Chunk 3.
5. **Always filter by `organisationId` in application code, even with RLS** (DEVELOPMENT_GUIDELINES § 1). Reads and writes by ID must include explicit `eq(table.organisationId, organisationId)`. Applies to: every soft-delete fix in Chunk 3, every job in Chunk 6.
6. **Soft-delete is two-layered: SQL filter is the rule, runtime assertion is defence-in-depth** (DEVELOPMENT_GUIDELINES § 3). Joins on soft-deletable tables (`agents`, `systemAgents`, `subaccounts`) carry `isNull(table.deletedAt)` in the join `ON` clause for outer joins (never in `WHERE` for `leftJoin`s — converts outer to inner). Applies to: all 22 fix sites in Chunk 3.
7. **Maintenance jobs follow admin/org tx contract** (invariants doc § 1.5). Background jobs that read/write tenant tables follow `server/jobs/memoryDedupJob.ts`: `withAdminConnection` to enumerate orgs, then `withOrgTx` per-org for actual work. Applies to: all three jobs in Chunk 6.
8. **Source-of-truth precedence is fixed** (invariants doc § 7.2). Execution records > state machine columns > artefacts > logs. When two artefacts disagree about an outcome, the execution record wins. Applies to: every audit-log write in Chunk 2, every soft-delete sweep in Chunk 3.
9. **Idempotency posture is classified per externally-triggered write** (invariants doc § 7.1). Every flow accepting external input declares one of: `key-based`, `state-based`, or `non-idempotent (intentional)`. Applies to: audit-log writes (state-based on `(action, actorId, targetId, eventTime)`), webhook 5xx incidents (key-based on `fingerprintOverride`).
10. **Status sets are closed** (invariants doc § 6.5). Terminal, in-flight, and awaiting status sets in `shared/runStatus.ts` are the single source of truth. New statuses require a spec amendment. Applies to: H3-PARTIAL-COUPLING fix in Chunk 6.

**Invariant Violation Protocol** (invariants doc § "Invariant Violation Protocol"). Silent violations are not permitted. If any invariant is violated during chunk implementation, the executor applies one of: (1) resolve in-line, (2) document and accept (directional tradeoff), (3) defer with a `tasks/todo.md` entry citing the invariant number, or (4) propose an amendment to the invariants doc. The fourth path requires a separate PR against `docs/pre-launch-hardening-invariants.md`.

## 2. Pre-flight

- [ ] `git checkout main && git pull && git checkout -b claude/pre-launch-phase-2`
- [ ] **Verify Phase 1 merged.** Confirm PR #261 is merged into main via `git log --oneline | grep "pre-launch"`. Phase 1 must be on main before Phase 2 starts; otherwise the audit-log primitive Chunk 2 builds is missing dependencies.
- [ ] **Verify migrations 0277-0279 are present.** `ls migrations/ | grep -E "0277|0278|0279"` should show: `0277_oauth_state_nonces.sql` (Phase 1), `0278_oauth_state_pending_run.sql` (Phase 1), `0279_task_events.sql` (Phase 1). If missing, Phase 1 has not landed — do not proceed.
- [ ] **Verify migration numbering ceiling.** Run `ls migrations/ | sort -t_ -k1,1n | tail -5` to find the highest assigned migration number. Operator-locked per § 12 decision 6: claim **0281+** for Phase 2. F3 sub-stream B reserved `0280-0282` (post-Phase-1 renumber); if F3 has already merged before Phase 2 starts, claim the next free integer above F3's last migration.
- [ ] **Verify `oauth_state_nonces.pending_run_id` column.** `psql -c "\\d oauth_state_nonces"` must show `pending_run_id uuid` — this column is written by Phase 1 migration 0278. The Chunk 2 OAuth resume wiring depends on it.
- [ ] **Verify `task_events` table.** `psql -c "\\d task_events"` must show columns `id, task_id, organisation_id, subaccount_id, seq, event_type, payload, origin, created_at` and the unique index on `(task_id, seq)`. Chunk 2's audit-log primitive extends the event-emission discipline established here.
- [ ] **Verify `inboundRateLimiter` exists.** `ls server/lib/inboundRateLimiter.ts` must succeed — Chunk 4 (signup rate-limit email dimension) reuses this primitive.
- [ ] **Verify `runDepthGuard.ts` exists.** `ls server/lib/runDepthGuard.ts` must succeed — Phase 1 D-P0-7 shipped this; Chunk 6 references it as the canonical pattern for fail-fast guards in execution paths.
- [ ] **Verify `refresh_tokens` table exists.** `psql -c "\d refresh_tokens"` must succeed. Chunk 4 Task 4.3 builds single-use rotation on top of this table per § 12 decision 1; if it is missing the operator's locked decision was wrong and the executor MUST stop here, not mid-Chunk-4. Escalation path: re-open § 12 decision 1, choose between (a) ship a `refresh_tokens` table creation migration as part of 0283, or (b) fall back to stateless-JWT + `password_changed_at`-only revocation (Task 4.4).
- [ ] **Verify `ErrorBoundary` already wraps root** in `client/src/App.tsx`. Phase 2 Chunk 1 expands its coverage to nested route surfaces. If the root wrap is missing, Phase 1 has regressed — do not proceed.
- [ ] **Confirm test gate posture.** Phase 2 follows the same per-chunk verification cadence as Phase 1: `npm run lint && npm run typecheck && npm run build:server` (and `build:client` when client files change). Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.

---

## 3. Chunk 1 — Client Foundations

**Items:** ErrorBoundary route-level expansion, axios timeout 30s→15s, OrgAdminGuard role gate, silent-catch sweep (76 sites across 47 files), TOKEN_ENCRYPTION_KEY boot validation, Inconsistent error throw format normalisation (#17), llmRouter budget reservation race (#18), JSON.parse safe-wrap in `executions.ts:54` (#10).

**Source IDs:** todo.md Important Findings #14 (OrgAdminGuard), #15 (axios timeout), #16 (silent catches), #13 (TOKEN_ENCRYPTION_KEY), #17 (error envelope), #18 (llmRouter race), #10 (unsafe JSON.parse). Lower Priority items: React ErrorBoundary already exists at root — this chunk expands it.

**Dependencies:** None — pure client + boot-time work.
**Target:** 1 PR, 3-4 days.

### Files
- Modify: `client/src/lib/api.ts` — change `timeout: 30000` → `15000`; add `Retry-After` header parsing on 429
- Modify: `client/src/App.tsx` — wrap each top-level route group in its own `<ErrorBoundary>` (auth boundary, app boundary, admin boundary); add role check to `OrgAdminGuard`
- Modify: 47 client files — replace `.catch(() => {})` with logged-but-swallowed `.catch((err) => { console.warn('<context>', err); })` or surface to user
- Create: `client/src/lib/silentCatchHelper.ts` — exports `logAndSwallow(context: string)` for the recurring pattern
- Modify: `server/services/connectionTokenService.ts` — add boot assertion `validateEncryptionKeyOrThrow()`
- Modify: `server/index.ts` (or `server/config/env.ts`) — call `validateEncryptionKeyOrThrow()` at boot; throw fatal in production if absent
- Create: `shared/errorEnvelope.ts` — canonical `ServiceError = { statusCode: number; message: string; errorCode?: string; details?: unknown }` shape; add `isServiceError(err)` type guard
- Modify: `server/services/llmRouter.ts` — wrap budget reservation read+update in single transaction
- Modify: `server/routes/executions.ts:54` — add try/catch around `JSON.parse`; return 400 on parse failure
- Create: `server/lib/__tests__/encryptionKeyValidator.test.ts`
- Create: `client/src/lib/__tests__/silentCatchHelper.test.ts` (pure-function only)

---

### Task 1.1 — Axios timeout: 30s → 15s + Retry-After honouring

- [ ] Open `client/src/lib/api.ts`. Change line 6:

```typescript
// Before
timeout: 30000,
// After
timeout: 15000, // Phase 2: 15s aligns with the Phase 2 spec hint and prevents UI-thread starvation when a backend route hangs
```

- [ ] In the response interceptor (after line 28), add 429 handling that reads `Retry-After`:

```typescript
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 429) {
      const retryAfterSec = Number(error.response.headers['retry-after'] ?? '60');
      // Tag the error so callers can surface a "wait N seconds" toast instead of a generic failure
      error.retryAfterSec = Number.isFinite(retryAfterSec) ? retryAfterSec : 60;
    }
    if (error.response?.status === 401) {
      // ... existing 401 handling unchanged
    }
    return Promise.reject(error);
  }
);
```

- [ ] Search `client/src/` for any place that constructs its own `axios.create({ timeout: ... })` outside `api.ts` and align them to 15000 (or 30000 for explicitly-long-running endpoints — comment why).

### Task 1.2 — ErrorBoundary route-level expansion

The root `ErrorBoundary` exists at `client/src/App.tsx:145-149`. It catches everything but produces a single full-page fallback. For Phase 2, scope per-route boundaries so a render failure in one route doesn't blank the entire app.

- [ ] In `client/src/App.tsx`, identify the four top-level route groups: auth routes, app routes, admin routes (OrgAdmin guard), system-admin routes (SystemAdmin guard).
- [ ] Wrap each group in its own `<ErrorBoundary>`:

```tsx
<Routes>
  <Route element={<ErrorBoundary><Outlet /></ErrorBoundary>}>
    {/* auth routes */}
  </Route>
  <Route element={<ErrorBoundary><AppLayout /></ErrorBoundary>}>
    {/* app routes */}
    <Route element={<ErrorBoundary><OrgAdminGuard user={user} /></ErrorBoundary>}>
      {/* org admin routes */}
    </Route>
    <Route element={<ErrorBoundary><SystemAdminGuard user={user} /></ErrorBoundary>}>
      {/* system admin routes */}
    </Route>
  </Route>
</Routes>
```

- [ ] Update `client/src/components/ErrorBoundary.tsx` `componentDidCatch` to POST a structured event to `/api/client-errors` (small new endpoint — see Task 1.6) so render failures surface in operator tooling. Suppress the POST in dev (`if (import.meta.env.DEV) return;`).
- [ ] Verify the existing root wrap is still in place — do not remove it; it remains the catch-all.

### Task 1.3 — OrgAdminGuard role check (#14)

Today `OrgAdminGuard` only checks `if (!user)`. The comment claims "API enforces permission-set checks" — true, but the guard exists to prevent UX dead-ends where a non-admin clicks an admin route and hits a generic 403.

- [ ] Open `client/src/App.tsx:194-197`. Replace the body:

```tsx
function OrgAdminGuard({ user }: { user: User | null }) {
  if (!user) return <Navigate to="/login" replace />;
  // Org-admin routes require either system_admin role OR an org permission-set that admits 'org.admin'
  // Server still enforces permission-set checks; this is UX guard rail, not security.
  const isAdminEligible = user.role === 'system_admin' || (user.permissions ?? []).includes('org.admin');
  if (!isAdminEligible) return <Navigate to="/" replace />;
  return <Outlet />;
}
```

- [ ] If `User.permissions` is not yet exposed via `/api/me`, extend the `/api/me` response shape to include `permissions: string[]` and update `User` type in `client/src/types/user.ts` (or wherever it lives). Add a one-line server-side change in `server/routes/auth.ts` `/me` handler.

### Task 1.4 — Silent-catch sweep (76 sites across 47 files) (#16)

The grep found 76 occurrences of `.catch(() => {})` across 47 files. Strategy: stratify by surface tier and apply tier-appropriate fixes. Do NOT do all 76 at once — split into three subtask passes.

- [ ] Create `client/src/lib/silentCatchHelper.ts`:

```typescript
/**
 * Logs an error to console with context but does not surface it to the user.
 * Used for fire-and-forget API calls where failure is not user-visible
 * (e.g. analytics, prefetches, background refetches).
 *
 * Pattern: replace `.catch(() => {})` with `.catch(logAndSwallow('<context>'))`.
 */
export function logAndSwallow(context: string): (err: unknown) => void {
  return (err: unknown) => {
    if (import.meta.env.DEV) {
      console.warn(`[silent-catch] ${context}:`, err);
    }
    // In production this is intentional — swallow without console noise to avoid log spam.
  };
}

/**
 * Surfaces an error via toast and re-throws so React Query can mark the query as errored.
 * Use for user-facing operations where the user must know it failed.
 */
export function surfaceAndRethrow(toast: (msg: string) => void, message: string): (err: unknown) => never {
  return (err: unknown) => {
    toast(message);
    throw err;
  };
}
```

- [ ] **Subtask 1.4a — Tier 1 (foreground user actions, ~12 sites).** Pages: `OnboardingWizardPage` (6 sites), `PortalPage` (3 sites), `WorkflowsLibraryPage` (3 sites), `AdminSubaccountDetailPage` (6 sites). These are user-initiated mutations; replace `.catch(() => {})` with `.catch(surfaceAndRethrow(toast, 'Failed to save'))` (or a more specific message). Add a toast import where missing.
- [ ] **Subtask 1.4b — Tier 2 (background refresh, ~30 sites).** Components like `Layout` (5 sites), `RunCostPanel` (1), `ProposeInterventionModal` (1), all the `xxxList` queries: replace with `.catch(logAndSwallow('Layout: org refresh'))` (one helper call per site, context string names the site).
- [ ] **Subtask 1.4c — Tier 3 (page hooks, the rest).** Same pattern as Tier 2 but with the page name in the context string.
- [ ] After each subtask, run `npm run lint && npm run typecheck && npm run build:client`. Commit per-subtask so partial regressions are bisectable.
- [ ] Final grep check: `grep -rn "\\.catch(() => {})" client/src` must return 0 matches.

### Task 1.5 — TOKEN_ENCRYPTION_KEY boot validation (#13)

`connectionTokenService` reads `TOKEN_ENCRYPTION_KEY` lazily; if it is absent or malformed, the failure surfaces only on first use (a connection-token decrypt) — too late to be a useful boot signal.

- [ ] Open `server/services/connectionTokenService.ts`. Add at the top:

```typescript
const TOKEN_ENCRYPTION_KEY_LENGTH = 32; // bytes — AES-256 key size

/**
 * Validates TOKEN_ENCRYPTION_KEY at boot. Throws if missing in production
 * or malformed in any environment. Idempotent — safe to call multiple times.
 */
export function validateEncryptionKeyOrThrow(): void {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: TOKEN_ENCRYPTION_KEY is required in production. Refusing to start.');
    }
    // Dev/test: allow startup but log a loud warning
    console.warn('[connectionTokenService] TOKEN_ENCRYPTION_KEY not set — connection tokens cannot be encrypted/decrypted');
    return;
  }
  // Accept hex, base64, or raw 32-byte strings — match the existing decode path's tolerance
  let decoded: Buffer;
  try {
    decoded = key.length === 64 ? Buffer.from(key, 'hex') : Buffer.from(key, 'base64');
  } catch {
    throw new Error('FATAL: TOKEN_ENCRYPTION_KEY must be hex or base64 encoded.');
  }
  if (decoded.length !== TOKEN_ENCRYPTION_KEY_LENGTH) {
    throw new Error(`FATAL: TOKEN_ENCRYPTION_KEY must decode to ${TOKEN_ENCRYPTION_KEY_LENGTH} bytes (got ${decoded.length}).`);
  }
}
```

- [ ] Open `server/index.ts`. Find the `WEBHOOK_SECRET` boot assertion added in Phase 1. Add immediately after:

```typescript
import { validateEncryptionKeyOrThrow } from './services/connectionTokenService';
validateEncryptionKeyOrThrow();
```

- [ ] Create `server/lib/__tests__/encryptionKeyValidator.test.ts`:

```typescript
import { validateEncryptionKeyOrThrow } from '../../services/connectionTokenService';

describe('validateEncryptionKeyOrThrow', () => {
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = originalKey;
    process.env.NODE_ENV = originalEnv;
  });

  it('throws in production when missing', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'production';
    expect(() => validateEncryptionKeyOrThrow()).toThrow(/required in production/);
  });

  it('warns in dev when missing', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'development';
    expect(() => validateEncryptionKeyOrThrow()).not.toThrow();
  });

  it('throws on malformed key', () => {
    process.env.TOKEN_ENCRYPTION_KEY = 'too-short';
    expect(() => validateEncryptionKeyOrThrow()).toThrow(/decode to 32 bytes/);
  });

  it('accepts a valid hex key', () => {
    process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes hex
    expect(() => validateEncryptionKeyOrThrow()).not.toThrow();
  });
});
```

- [ ] Run: `npx tsx server/lib/__tests__/encryptionKeyValidator.test.ts` — confirm all 4 tests pass.

### Task 1.6 — Client error reporting endpoint (supports Task 1.2)

- [ ] Create `server/routes/clientErrors.ts`:

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { check as rateLimitCheck } from '../lib/inboundRateLimiter';
import { logger } from '../lib/logger';

const router = Router();

const ClientErrorBody = z.object({
  message: z.string().max(2000),
  componentStack: z.string().max(8000).optional(),
  url: z.string().max(500).optional(),
  userAgent: z.string().max(500).optional(),
});

router.post(
  '/',
  authenticate, // require login so anonymous floods can't spam
  asyncHandler(async (req, res) => {
    // Rate-limit per user: 30 reports per 5 minutes
    const rl = await rateLimitCheck(`client-error:${req.user!.id}`, 30, 300);
    if (!rl.allowed) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    const body = ClientErrorBody.parse(req.body);
    logger.warn({
      organisationId: req.user!.organisationId,
      userId: req.user!.id,
      message: body.message,
      url: body.url,
      userAgent: body.userAgent,
      // componentStack at info-level only — verbose
      event: 'client_render_error',
    }, 'Client render error caught by ErrorBoundary');
    res.status(204).end();
  })
);

export default router;
```

- [ ] Wire into `server/index.ts` route table: `app.use('/api/client-errors', clientErrorsRouter)`.

### Task 1.7 — Canonical error envelope (#17)

Inconsistent error shapes across services break the ErrorBoundary's ability to render meaningful messages and force every consumer to write its own type-narrowing. Standardise on `ServiceError`.

- [ ] Create `shared/errorEnvelope.ts`:

```typescript
export interface ServiceError {
  statusCode: number;
  message: string;
  errorCode?: string;
  details?: unknown;
}

export function isServiceError(err: unknown): err is ServiceError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  return typeof e.statusCode === 'number' && typeof e.message === 'string';
}

export function toServiceError(err: unknown, fallbackStatus = 500): ServiceError {
  if (isServiceError(err)) return err;
  if (err instanceof Error) return { statusCode: fallbackStatus, message: err.message };
  return { statusCode: fallbackStatus, message: String(err) };
}
```

- [ ] Search `server/services/` for `throw {` (raw object throws): `grep -rn "^\\s*throw {" server/services/ --include="*.ts"`. Each hit must conform to `ServiceError` shape (has `statusCode` + `message`). If not, fix.
- [ ] In `server/middleware/asyncHandler.ts` (or wherever the central error handler lives), replace ad-hoc shape inspection with `toServiceError(err)`.
- [ ] Add a pure unit test in `shared/__tests__/errorEnvelope.test.ts` for `isServiceError` and `toServiceError` covering the four input shapes (Error, ServiceError, plain object, primitive).

### Task 1.8 — llmRouter budget reservation race (#18)

The audit identifies a read-then-update window in `llmRouter.ts` where two concurrent calls can both pass the budget check before either decrements. Phase 1 closed the related ledger-row race via `SELECT FOR UPDATE` inside the same transaction (KNOWLEDGE.md 2026-04-21 entries). Apply the same pattern to budget reservation.

- [ ] Open `server/services/llmRouter.ts`. Find the budget reservation read (likely a `SELECT remaining_cents FROM ...` followed by an UPDATE).
- [ ] Wrap the read+update in a single transaction with `SELECT ... FOR UPDATE`:

```typescript
await db.transaction(async (tx) => {
  const [budget] = await tx
    .select({ remainingCents: budgets.remainingCents })
    .from(budgets)
    .where(eq(budgets.id, budgetId))
    .for('update');

  if (!budget || budget.remainingCents < estimatedCostCents) {
    throw { statusCode: 429, message: 'budget_exceeded', errorCode: 'budget_exceeded' };
  }

  await tx
    .update(budgets)
    .set({ remainingCents: sql`${budgets.remainingCents} - ${estimatedCostCents}` })
    .where(eq(budgets.id, budgetId));
});
```

- [ ] Cite KNOWLEDGE.md (2026-04-21 SELECT FOR UPDATE entry) in the inline comment so future readers find the precedent.

### Task 1.9 — Unsafe JSON.parse in executions.ts (#10)

- [ ] Open `server/routes/executions.ts:54`. Wrap the `JSON.parse(...)` call:

```typescript
let parsed: unknown;
try {
  parsed = JSON.parse(rawInput);
} catch {
  res.status(400).json({ error: { code: 'invalid_json_input', message: 'Request body could not be parsed as JSON' } });
  return;
}
```

- [ ] Search `server/routes/` for other unguarded `JSON.parse` calls and apply the same pattern: `grep -rn "JSON.parse" server/routes/ --include="*.ts"`. Each hit must be inside a try/catch or be parsing a value from a known-safe source (e.g. an env var validated at boot — comment why).

### Task 1.10 — Verification commands + commit

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build:client`
- [ ] `npm run build:server`
- [ ] `npx tsx server/lib/__tests__/encryptionKeyValidator.test.ts`
- [ ] `npx vitest run shared/__tests__/errorEnvelope.test.ts` (uses Vitest per `docs/testing-conventions.md`)

```bash
git add client/src/lib/api.ts \
        client/src/App.tsx \
        client/src/components/ErrorBoundary.tsx \
        client/src/lib/silentCatchHelper.ts \
        client/src/lib/__tests__/silentCatchHelper.test.ts \
        client/src \
        server/services/connectionTokenService.ts \
        server/index.ts \
        server/routes/clientErrors.ts \
        server/routes/executions.ts \
        server/services/llmRouter.ts \
        server/lib/__tests__/encryptionKeyValidator.test.ts \
        shared/errorEnvelope.ts \
        shared/__tests__/errorEnvelope.test.ts
git commit -m "client+boot foundations: ErrorBoundary route-level expansion, axios 15s, OrgAdminGuard role gate, silent-catch sweep, TOKEN_ENCRYPTION_KEY validation, ServiceError envelope, llmRouter budget tx, JSON.parse safety"
```

### Acceptance criteria

- Zero `.catch(() => {})` in `client/src/`.
- Axios timeout is 15000 in `client/src/lib/api.ts`.
- `OrgAdminGuard` checks role/permission, not just presence of `user`.
- Boot in production with `TOKEN_ENCRYPTION_KEY` unset → process exits with the named error message.
- Render failure inside any top-level route group renders the boundary fallback for that group only — not the whole app.
- A render failure inside an authenticated route POSTs to `/api/client-errors` with the message + componentStack (verified by tailing server logs and triggering an intentional render error).

---

## 4. Chunk 2 — Centralised Audit Log + Webhook 5xx Incident Coverage

**Items:** #27 (centralised security audit trail for auth/permission events), webhook 5xx → `recordIncident` pattern for `slackWebhookHandler` and `teamworkWebhookHandler`, OAuth-resume `pendingRunId` wiring on agent-triggered GHL OAuth (deferred from Phase 1 chatgpt-pr-review), `withOrgTx({ tx: db })` callback fragility fix (AR-3.1 follow-up from Phase 1 adversarial-review).

**Source IDs:** todo.md Security Findings #27, todo.md "Follow-up: Remaining inline 500 paths in webhook handlers" (slack/teamwork webhook 5xx coverage), todo.md "Deferred from chatgpt-pr-review — pre-launch-phase-1 round 2" (agent-triggered GHL OAuth resume), todo.md "Deferred from adversarial-reviewer — pre-launch-phase-1" (AR-3.1 `withOrgTx({ tx: db })` fragility).

**Dependencies:** Phase 1 audit primitives (`auditService.log`), Phase 1 `oauth_state_nonces.pending_run_id` column, Phase 1 `enqueueResumeAfterOAuth`. Pre-flight verifies all of these.
**Target:** 1 PR, 2-3 days.

### Files
- Create: `migrations/0281_security_audit_events.sql` (+ `.down.sql`) — dedicated table (operator-locked decision; see § 12)
- Modify: `server/db/schema.ts` — Drizzle schema for the new/extended table
- Modify: `server/config/rlsProtectedTables.ts` — register the new table
- Create: `server/services/securityAuditService.ts` — typed wrapper around `auditService.log` for security events; pure-function helpers under `securityAuditServicePure.ts`
- Modify: `server/middleware/auth.ts` — emit `auth.login.success`, `auth.login.failure`, `auth.logout`, `auth.cross_org_access` (already partially done — extend), `auth.permission_denied` events
- Modify: `server/routes/auth.ts` — emit `auth.password_reset_requested`, `auth.password_reset_completed`, `auth.signup` events
- Modify: `server/middleware/permissionCheck.ts` (or wherever `requirePermission` lives) — emit `auth.permission_denied` on every 403
- Modify: `server/routes/webhooks/slackWebhookHandler.ts` — wrap inline 500 paths with `recordIncident({ fingerprintOverride: 'webhook:slack:handler_failed' })`
- Modify: `server/routes/webhooks/teamworkWebhookHandler.ts` — same pattern with `webhook:teamwork:handler_failed`
- Modify: `server/routes/ghl.ts:36` — pass `pendingRunId` to `setGhlOAuthState` when caller is an agent run
- Modify: `server/routes/oauthIntegrations.ts:424-425` — replace `withOrgTx({ tx: db })` with proper `db.transaction()` + GUC wrapper; call `enqueueResumeAfterOAuth({ runId: stateData.pendingRunId, organisationId: ghlOrgId })` when `stateData.pendingRunId` is non-null
- Create: `server/services/__tests__/securityAuditServicePure.test.ts`

---

### Task 2.1 — Schema: security_audit_events

Decision locked: dedicated `security_audit_events` table (per § 12 decision 3). Rationale: `audit_events` already carries unrelated event categories; a smaller heap keeps security queries fast.

- [ ] Create the dedicated table with the schema below:

```sql
-- migrations/0281_security_audit_events.sql
-- (Decision: dedicated table chosen because audit_events already carries
-- workspace-identity/cross-org/onboarding events and we want security
-- queries to scan a smaller heap.)

CREATE TABLE security_audit_events (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid          NOT NULL,
  subaccount_id   uuid,
  actor_user_id   uuid,
  actor_role      text,
  event_type      text          NOT NULL, -- e.g. 'auth.login.success', 'auth.permission_denied'
  target_type     text,
  target_id       text,
  ip              text,
  user_agent      text,
  meta            jsonb         NOT NULL DEFAULT '{}',
  occurred_at     timestamptz   NOT NULL DEFAULT now(),
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_security_audit_org_time   ON security_audit_events (organisation_id, occurred_at DESC);
CREATE INDEX idx_security_audit_event_time ON security_audit_events (event_type, occurred_at DESC);
CREATE INDEX idx_security_audit_actor_time ON security_audit_events (actor_user_id, occurred_at DESC) WHERE actor_user_id IS NOT NULL;

-- Tenant-scoped RLS (canonical policy from architecture.md)
ALTER TABLE security_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY security_audit_events_org_isolation ON security_audit_events
  USING (organisation_id::text = current_setting('app.organisation_id', true))
  WITH CHECK (organisation_id::text = current_setting('app.organisation_id', true));
```

- [ ] Create `migrations/0281_security_audit_events.down.sql`:

```sql
DROP TABLE IF EXISTS security_audit_events;
```

- [ ] Run `npm run db:generate` to confirm Drizzle picks up the table.
- [ ] Add Drizzle schema entry to `server/db/schema.ts`:

```typescript
export const securityAuditEvents = pgTable('security_audit_events', {
  id:             uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull(),
  subaccountId:   uuid('subaccount_id'),
  actorUserId:    uuid('actor_user_id'),
  actorRole:      text('actor_role'),
  eventType:      text('event_type').notNull(),
  targetType:     text('target_type'),
  targetId:       text('target_id'),
  ip:             text('ip'),
  userAgent:      text('user_agent'),
  meta:           jsonb('meta').notNull().default({}),
  occurredAt:     timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] Add the table to `server/config/rlsProtectedTables.ts`:

```typescript
{
  table: 'security_audit_events',
  scope: 'organisation',
  policyMigration: '0281_security_audit_events.sql',
  // Read paths require principal context; writes happen from middleware/services already inside withOrgTx
},
```

### Task 2.2 — securityAuditService

- [ ] Create `server/services/securityAuditServicePure.ts` (no DB):

```typescript
export type SecurityEventType =
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.logout'
  | 'auth.signup'
  | 'auth.password_reset_requested'
  | 'auth.password_reset_completed'
  | 'auth.permission_denied'
  | 'auth.cross_org_access'
  | 'auth.token_revoked'
  | 'oauth.cross_org_state_mismatch'
  | 'oauth.invalid_state';

export interface SecurityEventInput {
  organisationId: string;
  subaccountId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  eventType: SecurityEventType;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Pure normalisation: caps meta payload size, strips PII keys.
 * Tested in isolation; the DB-bound writer composes this with the insert.
 */
const META_MAX_BYTES = 16 * 1024;
const PII_BLACKLIST = new Set(['password', 'token', 'secret', 'authorization']);

export function normaliseSecurityEvent(input: SecurityEventInput): SecurityEventInput {
  const meta = { ...(input.meta ?? {}) };
  for (const k of Object.keys(meta)) {
    if (PII_BLACKLIST.has(k.toLowerCase())) {
      meta[k] = '[redacted]';
    }
  }
  const json = JSON.stringify(meta);
  if (Buffer.byteLength(json) > META_MAX_BYTES) {
    return { ...input, meta: { _truncated: true, originalBytes: Buffer.byteLength(json) } };
  }
  return { ...input, meta };
}
```

- [ ] Create `server/services/securityAuditService.ts`:

```typescript
import { db } from '../db';
import { securityAuditEvents } from '../db/schema';
import { sql } from 'drizzle-orm';
import { logger } from '../lib/logger';
import { normaliseSecurityEvent, type SecurityEventInput } from './securityAuditServicePure';

/**
 * Records a security audit event. Idempotency posture: non-idempotent (intentional) —
 * security events are time-stamped observations; replays are logically distinct events.
 *
 * Caller MUST be inside a withOrgTx for the supplied organisationId, OR pass the
 * org-scoped tx in. This function does not open its own transaction.
 *
 * Failure mode: log-and-swallow. A failed audit write never blocks the action it
 * was auditing — that would convert defence-in-depth telemetry into a single point
 * of failure. The breaker around this primitive lives in `softBreakerPure.ts`
 * (KNOWLEDGE.md 2026-04-21 entry).
 */
export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  try {
    const norm = normaliseSecurityEvent(input);
    await db.insert(securityAuditEvents).values({
      organisationId: norm.organisationId,
      subaccountId:   norm.subaccountId ?? null,
      actorUserId:    norm.actorUserId ?? null,
      actorRole:      norm.actorRole ?? null,
      eventType:      norm.eventType,
      targetType:     norm.targetType ?? null,
      targetId:       norm.targetId ?? null,
      ip:             norm.ip ?? null,
      userAgent:      norm.userAgent ?? null,
      meta:           norm.meta ?? {},
      // Use DB time so events from different nodes order correctly under clock skew
      occurredAt:     sql`now()`,
    });
  } catch (err) {
    // Critical: never let an audit failure propagate. Log and continue.
    logger.error({
      err,
      organisationId: input.organisationId,
      eventType: input.eventType,
    }, 'security_audit_write_failed');
  }
}
```

- [ ] Create `server/services/__tests__/securityAuditServicePure.test.ts`:

```typescript
import { normaliseSecurityEvent } from '../securityAuditServicePure';

describe('normaliseSecurityEvent', () => {
  const base = { organisationId: 'org-1', eventType: 'auth.login.success' as const };

  it('redacts password and token in meta', () => {
    const result = normaliseSecurityEvent({
      ...base,
      meta: { password: 'p4ss', token: 't', email: 'a@b.com' },
    });
    expect(result.meta).toEqual({ password: '[redacted]', token: '[redacted]', email: 'a@b.com' });
  });

  it('truncates oversized meta', () => {
    const big = { blob: 'x'.repeat(20_000) };
    const result = normaliseSecurityEvent({ ...base, meta: big });
    expect(result.meta._truncated).toBe(true);
    expect(typeof result.meta.originalBytes).toBe('number');
  });

  it('passes through small meta unchanged (after redaction)', () => {
    const result = normaliseSecurityEvent({ ...base, meta: { x: 1 } });
    expect(result.meta).toEqual({ x: 1 });
  });
});
```

- [ ] Run: `npx vitest run server/services/__tests__/securityAuditServicePure.test.ts`.

### Task 2.3 — Wire emission into auth middleware + routes

- [ ] In `server/middleware/auth.ts`, where the existing `auditService.log({ action: 'cross_org_access', ... })` call lives (around line 82-96 per todo.md), replace the call with:

```typescript
import { recordSecurityEvent } from '../services/securityAuditService';

await recordSecurityEvent({
  organisationId: req.user!.organisationId,
  actorUserId:    req.user!.id,
  actorRole:      req.user!.role,
  eventType:      'auth.cross_org_access',
  targetType:     'organisation',
  targetId:       targetOrgId,
  ip:             req.ip,
  userAgent:      req.get('user-agent') ?? null,
  meta:           { route: req.path, method: req.method },
});
```

- [ ] Find the central permission-deny path. Likely `server/middleware/permissionCheck.ts` or wherever `requirePermission(key)` issues a 403. Add:

```typescript
await recordSecurityEvent({
  organisationId: req.user!.organisationId,
  actorUserId:    req.user!.id,
  actorRole:      req.user!.role,
  eventType:      'auth.permission_denied',
  meta:           { route: req.path, method: req.method, requiredPermission: key },
});
```

- [ ] In `server/routes/auth.ts`:
  - On successful login, emit `auth.login.success` with the user's id + IP.
  - On failed login (wrong credentials), emit `auth.login.failure` with `meta: { emailHash }` (hashed, never raw email — feeds the redaction test).
  - On signup, emit `auth.signup`.
  - On password-reset request, emit `auth.password_reset_requested`.
  - On password-reset completion, emit `auth.password_reset_completed`.
  - On logout, emit `auth.logout`.
- [ ] In `server/routes/oauthIntegrations.ts`, the cross-org-state-mismatch path created in Phase 1 already calls `auditService.log({ event: 'oauth_cross_org_state_mismatch', ... })`. Replace with `recordSecurityEvent({ ..., eventType: 'oauth.cross_org_state_mismatch' })`.

### Task 2.4 — Webhook 5xx incident coverage

The Phase 1 deferred follow-up identifies `slackWebhookHandler` and `teamworkWebhookHandler` as still missing the `recordIncident` wrap. The `webhookService.recordIncident` primitive already exists.

- [ ] Open `server/routes/webhooks/slackWebhookHandler.ts`. Wrap each inline 500 path:

```typescript
import { recordIncident } from '../../services/webhookService';

try {
  // ... existing handler body
} catch (err) {
  await recordIncident({
    organisationId,
    fingerprintOverride: 'webhook:slack:handler_failed',
    severity: 'error',
    err,
    meta: { eventType: payload?.event?.type, channelId: payload?.event?.channel },
  });
  res.status(500).json({ error: 'webhook_handler_failed' });
  return;
}
```

- [ ] Same pattern for `server/routes/webhooks/teamworkWebhookHandler.ts` with `fingerprintOverride: 'webhook:teamwork:handler_failed'`.
- [ ] Verify `recordIncident` enforces dedup via the `fingerprintOverride` (idempotency posture: key-based). If it currently UPSERTs by `fingerprint`, no extra change needed; if it inserts unconditionally, add a unique index on `fingerprint` in a small additive migration (not in this chunk — file as a Phase 3 follow-up).

### Task 2.5 — OAuth `pendingRunId` wiring (agent-triggered path)

The Phase 1 chatgpt-pr-review round 2 deferred this. The infrastructure exists; only the call sites need to thread the runId through.

- [ ] Open `server/routes/ghl.ts:36`. Find `setGhlOAuthState(nonce, orgId)`. Identify whether the caller is an agent-run OAuth-pause path or a user-initiated settings flow:

```typescript
// New signature accepts pendingRunId; caller determines if applicable.
await setGhlOAuthState(nonce, orgId, agentTriggeredRunId ?? null);
```

- [ ] Verify `setGhlOAuthState` (in `server/lib/ghlOAuthStateStore.ts`) accepts the third parameter and writes `pending_run_id` into the nonce row. Phase 1 added the column; verify the store function passes it through.
- [ ] Open `server/routes/oauthIntegrations.ts`. After successful OAuth token exchange, the existing path enqueues resume only when `stateData.pendingRunId` is set. Confirm it does so for the agent-triggered case. If the path is JWT-based (alternate flow noted in the deferred entry), leave the JWT-based path untouched — it has its own `resumeFromIntegrationConnect`.

### Task 2.6 — `withOrgTx({ tx: db })` callback fragility (AR-3.1)

The Phase 1 deferred adversarial finding: passing module-level `db` as `tx` to `withOrgTx` fakes ALS context without setting a GUC. Today's code works because `autoEnrolAgencyLocations` opens its own `db.transaction()` with explicit GUC. Future refactors using `getOrgScopedDb()` in this chain would silently lose the GUC.

- [ ] Open `server/routes/oauthIntegrations.ts:424-425`. Replace the `withOrgTx({ tx: db })` call with a proper org-scoped transaction:

```typescript
// Before (fragile — fakes ALS context without GUC):
await withOrgTx({ tx: db, organisationId, source: 'oauth:callback' }, async () => {
  await autoEnrolAgencyLocations(...);
});

// After (proper GUC binding):
await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`);
  await withOrgTx({ tx, organisationId, source: 'oauth:callback' }, async () => {
    await autoEnrolAgencyLocations(...);
  });
});
```

- [ ] Cite KNOWLEDGE.md "2026-05-05 Gotcha — `withOrgTx({ tx: db })` in unauthenticated callbacks fakes ALS context without setting a GUC" inline.
- [ ] Apply the location-count cap deferred from AR-2 follow-up: add `MAX_GHL_LOCATIONS_TO_ENROL = 50` constant in `oauthIntegrations.ts`; if `locations.length > MAX_GHL_LOCATIONS_TO_ENROL`, slice to the first 50 and emit a security audit event noting the truncation. Prevents connection-pool burst on large agencies.

### Task 2.7 — Verification commands + commit

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build:server`
- [ ] `npm run db:generate` — confirm `0281_security_audit_events.sql` materialises in Drizzle metadata
- [ ] `npx vitest run server/services/__tests__/securityAuditServicePure.test.ts`

```bash
git add migrations/0281_security_audit_events.sql \
        migrations/0281_security_audit_events.down.sql \
        server/db/schema.ts \
        server/config/rlsProtectedTables.ts \
        server/services/securityAuditService.ts \
        server/services/securityAuditServicePure.ts \
        server/services/__tests__/securityAuditServicePure.test.ts \
        server/middleware/auth.ts \
        server/routes/auth.ts \
        server/routes/oauthIntegrations.ts \
        server/routes/ghl.ts \
        server/lib/ghlOAuthStateStore.ts \
        server/routes/webhooks/slackWebhookHandler.ts \
        server/routes/webhooks/teamworkWebhookHandler.ts \
        server/middleware/permissionCheck.ts
git commit -m "audit+webhooks: security_audit_events table + emission wiring (#27); webhook 5xx recordIncident coverage; OAuth pendingRunId resume wiring; withOrgTx GUC fragility fix (AR-3.1)"
```

### Acceptance criteria

- A failed login produces a `security_audit_events` row with `event_type='auth.login.failure'` and `meta.emailHash` set (no raw email).
- A 403 from `requirePermission` produces a `security_audit_events` row with `event_type='auth.permission_denied'` and `meta.requiredPermission` set.
- A Slack webhook 5xx produces an entry in the incident store with fingerprint `webhook:slack:handler_failed` (visible in `system_incidents` or equivalent).
- A re-issued OAuth nonce with `pending_run_id` set + a successful callback enqueues exactly one `RESUME_RUN_JOB` for that runId.
- Grep for `withOrgTx({ tx: db,` returns zero matches in `server/routes/oauthIntegrations.ts`.
- **Audit-stream invariant:** `auditService.log` is FORBIDDEN for any event whose `action` (or `eventType`) starts with `auth.` or `oauth.`. All such events go through `securityAuditService` exclusively. Phase 2 split exists precisely so security queries do not have to scan the `audit_events` heap. Enforced by Chunk 7 Task 7.16a grep gate (`scripts/verify-audit-stream-split.sh`).

---

## 5. Chunk 3 — Soft-Delete Sweep + RLS/Scoping Invariants

**Items:** 22 soft-delete gap fixes (8 WHERE-clause-only convention violations + 14 genuine missing-filter sites listed in todo.md "Follow-up: Remaining soft-delete join gaps"), `taskService.createTask` and `taskActivities` insert via module-level `db` (deferred from Phase 1 dual-reviewer), `skillService.getSkill`/`getSkillBySlug` org-scoping (#2), `fileService.downloadFile` org-scoping (#3), `taskService.activities` org-scoping (#4), `skillService` soft-delete filter (#5), reviewService transaction wrap (#9).

**Source IDs:** todo.md "Follow-up: Remaining soft-delete join gaps (fix-logical-deletes-2)", todo.md Important Findings #2/#3/#4/#5/#9, todo.md "Deferred from dual-reviewer — pre-launch-phase-1" (taskService module-level db).

**Dependencies:** Chunk 2 must land first so the audit-log primitive is available — every fix in this chunk that materially changes a service surface should emit a `data.scope_drift_detected` security audit event during the rollout window for observability. After Phase 2 closes, that emission can be removed (deferred to Phase 3 cleanup).
**Target:** 1 PR, 3-4 days.

### Files
- Modify: `server/services/skillService.ts` — add `organisationId` filter to `getSkill`, `getSkillBySlug`; add `isNull(skills.deletedAt)` to all reads
- Modify: `server/services/fileService.ts` — add `organisationId` filter to `downloadFile`
- Modify: `server/services/taskService.ts` — add `organisationId` filter to `activities`; replace module-level `db` with `getOrgScopedDb` in `createTask`, `taskActivities` insert
- Modify: `server/services/reviewService.ts` — wrap `actions` + `reviewItems` updates in single transaction
- Create: `server/lib/queryHelpers.ts` — exports `isActive(table)` helper for `isNull(table.deletedAt)`
- Modify: 8 files with WHERE-clause-only violations: `assignTask.ts`, `agentExecutionService.ts`, `agentScheduleService.ts`, `capabilityMapService.ts`, `scheduleCalendarService.ts`, `skillExecutor.ts` (3 sites)
- Modify: 14 files with genuine missing-filter sites: `subaccountAgentService.ts` (3 sites), `hierarchyRouteResolverService.ts`, `workspaceHealthService.ts` (2 sites), `explicitDelegationSkillsWithoutChildren.ts`, `proposeClientPulseInterventionsJob.ts`, `clientPulseInterventionContextService.ts`, `configUpdateOrganisationService.ts`, `workflowActionCallExecutor.ts`, `configSkillHandlers.ts`
- Update: `DEVELOPMENT_GUIDELINES.md` § 3 — add the `isActive(table)` convention rule
- Create: `server/lib/__tests__/queryHelpersPure.test.ts`
- Create: `server/services/__tests__/softDeleteRoutingPure.test.ts` — extract the 3 highest-risk routing predicates into pure functions and test them

---

### Task 3.1 — Create the `isActive` helper

- [ ] Create `server/lib/queryHelpers.ts`:

```typescript
import { isNull, type SQL } from 'drizzle-orm';

/**
 * Canonical soft-delete filter. Use in every join ON clause and every WHERE
 * against a soft-deletable table (any table with a `deletedAt` column).
 *
 * For leftJoins, this MUST appear in the join's ON clause — placing it in
 * WHERE converts outer-join semantics to inner-join semantics, dropping rows.
 *
 * Per DEVELOPMENT_GUIDELINES § 3 (soft-delete enforcement is two-layered):
 * SQL exclusion is the rule, runtime assertion is defence-in-depth.
 */
export function isActive<T extends { deletedAt: unknown }>(table: T): SQL<unknown> {
  // The `as never` cast is required because Drizzle's column type machinery
  // doesn't narrow `unknown` into a column reference. The runtime call is correct.
  return isNull((table as unknown as { deletedAt: { } }).deletedAt as never);
}
```

- [ ] Create `server/lib/__tests__/queryHelpersPure.test.ts` — pure-function test that asserts `isActive` returns a SQL fragment whose stringified form contains `is null`:

```typescript
import { isActive } from '../queryHelpers';
import { agents } from '../../db/schema';

describe('isActive', () => {
  it('returns a SQL fragment that filters by deletedAt IS NULL', () => {
    const filter = isActive(agents);
    // Drizzle SQL fragments stringify with their predicate; check the inspector form
    const repr = (filter as unknown as { queryChunks: unknown[] }).queryChunks?.map(String).join(' ') ?? String(filter);
    expect(repr.toLowerCase()).toContain('deleted_at');
    expect(repr.toLowerCase()).toContain('is null');
  });
});
```

- [ ] Run: `npx vitest run server/lib/__tests__/queryHelpersPure.test.ts`.

- [ ] In the same `server/lib/queryHelpers.ts`, add the runtime defence-in-depth assertion that complements the SQL filter (DEVELOPMENT_GUIDELINES § 3 second layer):

```typescript
export class EntityNotActiveError extends Error {
  readonly statusCode = 410; // Gone — entity exists but is logically deleted
  constructor(public entityType: string, public entityId: string) {
    super(`${entityType} ${entityId} is soft-deleted`);
    this.name = 'EntityNotActiveError';
  }
}

/**
 * Runtime assertion that an entity is not soft-deleted. Use at write-path
 * boundaries before attempting work against a parent row that may have been
 * deleted in a concurrent request. Throws EntityNotActiveError (statusCode 410)
 * when deletedAt is non-null.
 *
 * Use sites for Phase 2:
 *  - task creation (server/services/taskService.ts before insert)
 *  - workflow run start (server/services/workflowRunService.ts before insert)
 *  - routing decisions (server/services/subaccountAgentService.ts before assignment)
 */
export function assertActive<T extends { id: string; deletedAt: unknown }>(
  entity: T | null | undefined,
  entityType: string,
): asserts entity is T & { deletedAt: null } {
  if (!entity) {
    throw new EntityNotActiveError(entityType, '<missing>');
  }
  if (entity.deletedAt != null) {
    throw new EntityNotActiveError(entityType, entity.id);
  }
}
```

- [ ] Add `assertActive` test cases to `server/lib/__tests__/queryHelpersPure.test.ts` covering: (a) active entity returns silently; (b) `deletedAt: Date` throws `EntityNotActiveError` with `statusCode 410`; (c) `null`/`undefined` entity throws with id `'<missing>'`.
- [ ] Wire `assertActive` into the three Phase 2 use sites listed in the JSDoc above. Each call site is a single-line addition immediately after the parent-row fetch and before the dependent write. Cite this task ID in the commit message so reviewers can audit the wiring.

### Task 3.2 — Org-scoping fixes (#2, #3, #4)

- [ ] Open `server/services/skillService.ts`. Find `getSkill(skillId: string)` and `getSkillBySlug(slug: string)`. Both must accept `organisationId` as a required parameter and filter on it:

```typescript
async function getSkill(skillId: string, organisationId: string) {
  const [row] = await db
    .select()
    .from(skills)
    .where(and(
      eq(skills.id, skillId),
      eq(skills.organisationId, organisationId),
      isActive(skills),
    ))
    .limit(1);
  return row ?? null;
}
```

- [ ] Update every caller of `getSkill` / `getSkillBySlug` to pass the orgId. Use `req.orgId!` in route contexts; pass through service params in service-to-service contexts.
- [ ] Open `server/services/fileService.ts`. Find `downloadFile`. Same pattern — accept `organisationId`, filter the lookup.
- [ ] Open `server/services/taskService.ts`. Find the `activities` query (lists task_activities). Add `eq(taskActivities.organisationId, organisationId)` to the WHERE.
- [ ] For each modified service, search for callers that don't have an orgId in scope. Each one is a route or job context — confirm `req.orgId!` is available. If a caller is a maintenance job that legitimately spans orgs, fix per Chunk 6 contract (admin/org tx).

### Task 3.3 — Soft-delete filter in skillService (#5)

- [ ] Already covered by 3.2 — every modified read in `skillService.ts` now passes through `isActive(skills)`. Verify by grepping for `from(skills)` in the file and confirming each has an `isActive(skills)` predicate.

### Task 3.4 — Replace module-level `db` in `taskService` (Phase 1 deferred)

- [ ] Open `server/services/taskService.ts:158` and `:185`. The current code uses module-level `db.insert(tasks)` / `db.insert(taskActivities)`. Under FORCE RLS on `tasks` and `task_activities`, those writes silently no-op or fail policy.
- [ ] Replace with `getOrgScopedDb`:

```typescript
import { getOrgScopedDb } from '../lib/orgScopedDb';

export async function createTask(input: CreateTaskInput, organisationId: string) {
  const orgDb = await getOrgScopedDb(organisationId);
  const [row] = await orgDb.insert(tasks).values({ ...input, organisationId }).returning();
  await orgDb.insert(taskActivities).values({
    taskId:         row.id,
    organisationId,
    activityType:   'created',
    // ...
  });
  return row;
}
```

- [ ] If the function is currently called without an `organisationId` parameter, propagate it through every caller. Treat each caller-update as part of this task.
- [ ] Cite KNOWLEDGE.md "2026-05-05 Gotcha — `withOrgTx({ tx: db })` ... fakes ALS context without GUC" and the related entry on `db.transaction()` from module pool needing explicit GUC.

### Task 3.5 — reviewService transaction wrap (#9)

- [ ] Open `server/services/reviewService.ts`. Find the function that updates both `actions` and `reviewItems`. Wrap in a single transaction:

```typescript
await db.transaction(async (tx) => {
  await tx.update(actions).set({ ... }).where(...);
  await tx.update(reviewItems).set({ ... }).where(...);
});
```

- [ ] Acceptance: a partial failure (e.g. throw between the two updates) leaves zero changes in either table.

### Task 3.6 — Soft-delete sweep — Tier A (8 WHERE-clause violations)

These sites are functionally correct (they DO filter `deletedAt IS NULL`) but place the predicate in `WHERE` instead of the join `ON`. The hazard: any future change that converts an `innerJoin` to a `leftJoin` silently inverts semantics.

- [ ] For each of the 8 sites listed in todo.md `## Follow-up: Remaining soft-delete join gaps (fix-logical-deletes-2) — WHERE-clause only` section, move the `isNull(agents.deletedAt)` predicate from `WHERE` to the join's `ON` clause and replace the raw `isNull(...)` call with `isActive(agents)`:

```typescript
// Before
.from(tasks)
.innerJoin(agents, eq(agents.id, tasks.assignedAgentId))
.where(and(
  eq(tasks.organisationId, orgId),
  isNull(agents.deletedAt),
))

// After
.from(tasks)
.innerJoin(agents, and(
  eq(agents.id, tasks.assignedAgentId),
  isActive(agents),
))
.where(eq(tasks.organisationId, orgId))
```

- [ ] Sites: `server/tools/internal/assignTask.ts:55`, `server/services/agentExecutionService.ts:3057`, `server/services/agentScheduleService.ts:221`, `server/services/capabilityMapService.ts:203`, `server/services/scheduleCalendarService.ts:123`, `server/services/skillExecutor.ts:3375,3589,3839` (3 sites).

### Task 3.7 — Soft-delete sweep — Tier B (14 genuine gaps)

These sites have NO `deletedAt` filter at all — soft-deleted rows leak into routing, org-chart, workspace-health, and three jobs that propose ClientPulse interventions.

- [ ] For each of the 14 sites listed in todo.md `## Follow-up: Remaining soft-delete join gaps (fix-logical-deletes-2) — No deletedAt filter at all (genuine Category A gaps)`, add `isActive(table)` to the join `ON`:
  - `server/services/subaccountAgentService.ts:227` (`getLinkById`)
  - `server/services/subaccountAgentService.ts:390` (`getTree` — the org-chart-shape-bug pattern)
  - `server/services/subaccountAgentService.ts:499` (leftJoin systemAgents)
  - `server/services/hierarchyRouteResolverService.ts:58`
  - `server/services/workspaceHealth/workspaceHealthService.ts:266-267` (agents + subaccounts)
  - `server/services/workspaceHealth/workspaceHealthService.ts:317` (subaccounts)
  - `server/services/workspaceHealth/detectors/explicitDelegationSkillsWithoutChildren.ts:41`
  - `server/jobs/proposeClientPulseInterventionsJob.ts:309`
  - `server/services/clientPulseInterventionContextService.ts:366`
  - `server/services/configUpdateOrganisationService.ts:59`
  - `server/services/workflowActionCallExecutor.ts:74`
  - `server/tools/config/configSkillHandlers.ts:34`

- [ ] After every Tier B fix, emit a `security_audit_event` of type `data.scope_drift_detected` (use a new event type added to `securityAuditServicePure.ts`'s `SecurityEventType` union). Operator-locked per § 12 decision 5: emission ships for the rollout window only; Phase 3 cleanup removes it if no signal materialises.

### Task 3.8 — Routing-predicate pure tests

The three highest-risk paths (subaccount agent routing, workspace-health listing, hierarchy route resolution) are too coupled to test end-to-end without DB. Extract the soft-delete-aware filter logic into pure helpers and test those.

- [ ] Create `server/services/subaccountAgentServicePure.ts` if it does not exist. Move the routing-predicate computation (which agent IDs are eligible given a soft-delete state) into a pure function:

```typescript
export interface RoutingCandidate { id: string; deletedAt: Date | null; subaccountId: string; }

export function selectActiveRoutingCandidates(
  candidates: RoutingCandidate[],
  targetSubaccountId: string,
): RoutingCandidate[] {
  return candidates.filter(c => c.deletedAt === null && c.subaccountId === targetSubaccountId);
}
```

- [ ] Create `server/services/__tests__/softDeleteRoutingPure.test.ts`:

```typescript
import { selectActiveRoutingCandidates } from '../subaccountAgentServicePure';

describe('selectActiveRoutingCandidates', () => {
  it('excludes soft-deleted candidates', () => {
    const candidates = [
      { id: 'a', deletedAt: null, subaccountId: 'sub-1' },
      { id: 'b', deletedAt: new Date(), subaccountId: 'sub-1' },
    ];
    expect(selectActiveRoutingCandidates(candidates, 'sub-1')).toHaveLength(1);
    expect(selectActiveRoutingCandidates(candidates, 'sub-1')[0].id).toBe('a');
  });

  it('excludes candidates from other subaccounts', () => {
    const candidates = [
      { id: 'a', deletedAt: null, subaccountId: 'sub-1' },
      { id: 'b', deletedAt: null, subaccountId: 'sub-2' },
    ];
    expect(selectActiveRoutingCandidates(candidates, 'sub-1')).toHaveLength(1);
  });

  it('handles empty input', () => {
    expect(selectActiveRoutingCandidates([], 'sub-1')).toEqual([]);
  });
});
```

- [ ] Apply the same extraction to `workspaceHealth/workspaceHealthService.ts` and `hierarchyRouteResolverService.ts` if they have an in-line filter that's testable as a pure function. If the predicate is too entangled with DB queries to extract cleanly, document the limitation in a code comment and rely on the Tier A/B fixes alone.

### Task 3.9 — DEVELOPMENT_GUIDELINES update

- [ ] Add to `DEVELOPMENT_GUIDELINES.md` § 8 (development discipline) as a new bullet **8.27**:

> **8.27 Soft-delete filter goes through `isActive(table)`.** Every join on a soft-deletable table uses `isActive(table)` from `server/lib/queryHelpers`. Raw `isNull(table.deletedAt)` is a lint-waivable finding that must be explicitly justified inline. For leftJoin, the filter MUST live in the join's ON clause, never the WHERE — placing it in WHERE converts outer to inner semantics.

### Task 3.10 — Verification commands + commit

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build:server`
- [ ] `npx vitest run server/lib/__tests__/queryHelpersPure.test.ts`
- [ ] `npx vitest run server/services/__tests__/softDeleteRoutingPure.test.ts`
- [ ] Final grep check: `grep -rn "isNull(.*\\.deletedAt)" server/services/ server/jobs/ server/tools/ --include="*.ts" | grep -v "isActive("` should return only the sites flagged with a justification comment, plus the `isActive` helper itself.

```bash
git add server/lib/queryHelpers.ts \
        server/lib/__tests__/queryHelpersPure.test.ts \
        server/services/skillService.ts \
        server/services/fileService.ts \
        server/services/taskService.ts \
        server/services/reviewService.ts \
        server/services/subaccountAgentService.ts \
        server/services/subaccountAgentServicePure.ts \
        server/services/__tests__/softDeleteRoutingPure.test.ts \
        server/services/agentExecutionService.ts \
        server/services/agentScheduleService.ts \
        server/services/capabilityMapService.ts \
        server/services/scheduleCalendarService.ts \
        server/services/skillExecutor.ts \
        server/services/hierarchyRouteResolverService.ts \
        server/services/workspaceHealth/workspaceHealthService.ts \
        server/services/workspaceHealth/detectors/explicitDelegationSkillsWithoutChildren.ts \
        server/services/clientPulseInterventionContextService.ts \
        server/services/configUpdateOrganisationService.ts \
        server/services/workflowActionCallExecutor.ts \
        server/jobs/proposeClientPulseInterventionsJob.ts \
        server/tools/internal/assignTask.ts \
        server/tools/config/configSkillHandlers.ts \
        DEVELOPMENT_GUIDELINES.md
git commit -m "soft-delete sweep + RLS scoping: 22 join sites switched to isActive(); skillService/fileService/taskService org-scoping; reviewService tx wrap; taskService getOrgScopedDb; rule §8.27 added"
```

### Acceptance criteria

- Grep `isNull(.*\\.deletedAt)` outside `server/lib/queryHelpers.ts` returns only annotated sites.
- Soft-deleting an agent and running `getTree(subaccountId)` excludes that agent from the org chart.
- Soft-deleting an agent and dispatching a routing decision via `hierarchyRouteResolverService` does not select that agent.
- Calling `skillService.getSkill('id-from-org-A')` from an org-B context returns `null`.
- `reviewService` partial-failure leaves zero changes in `actions` and `reviewItems`.
- `taskService.createTask` writes succeed under FORCE RLS verified by inserting from a per-org tx and reading back via the same tx.

---

## 6. Chunk 4 — Schema Indexes + Auth Lifecycle Hardening

**Items:** Missing `organisationId` indexes on `agentTriggers`, `processConnectionMappings`, `processedResources`, `reviewItems` (#12); `processes.organisationId` NOT NULL (#6); refresh token rotation on OAuth integrations; OAuth state JWT window 10min → 5min; JWT forced-logout on password change; signup rate-limit email dimension (deferred from Phase 1 adversarial-reviewer); login rate-limit dual-bucket (deferred from Phase 1 dual-reviewer); login rate-limit ordering (validateBody before limiter — spec-review deferred item).

**Source IDs:** todo.md Important Findings #12 (indexes), #6 (processes notNull), todo.md "Lower Priority / Post-Testing" lines 62-64 (OAuth JWT window, refresh-token rotation, JWT forced logout), todo.md "Deferred from adversarial-reviewer" (signup IP-only key), todo.md "Deferred from dual-reviewer" (10/60s window), todo.md "Deferred from spec-reviewer review — pre-prod-boundary-and-brief-api" (login limiter ordering, windowSec key encoding).

**Dependencies:** Chunk 2 (audit-log primitive used to emit `auth.token_revoked` and `auth.token_rotated`).
**Target:** 1 PR, 2-3 days. Migrations: 0282 (indexes + processes notnull), 0283 (refresh_token_rotations).

### Files
- Create: `migrations/0282_phase2_indexes_and_processes_notnull.sql` (+ `.down.sql`)
- Create: `migrations/0283_refresh_token_rotation.sql` (+ `.down.sql`) — operator-locked: DB-backed refresh tokens + single-use rotation (see § 12). Build-time verification step in Task 4.3 confirms `refresh_tokens` table exists; if absent the executor escalates.
- Modify: `server/db/schema.ts` — add new index declarations; flip `processes.organisationId` to `notNull()`
- Modify: `server/services/oauthIntegrationService.ts` (or wherever refresh-token rotation is decided) — implement single-use refresh token rotation
- Modify: `server/lib/ghlOAuthStateStore.ts` — change `TTL_MS = 10 * 60 * 1000` → `5 * 60 * 1000`
- Modify: `server/middleware/auth.ts` — check `users.passwordChangedAt > jwt.iat` and reject the JWT (forced logout)
- Modify: `server/routes/auth.ts` — set `users.passwordChangedAt = sql\`now()\`` on password change/reset
- Modify: `server/routes/auth.ts` (signup limiter) — add `emailLower` to the rate-limit key
- Modify: `server/routes/auth.ts` (login limiter) — order: `validateBody(loginBody)` before `rateLimitCheck`; add second wider bucket for credential-stuffing
- Modify: `server/lib/inboundRateLimiter.ts` — encode `windowSec` in the key namespace per the spec-reviewer recommendation, OR add `windowSec` to the PK shape
- Create: `server/lib/__tests__/inboundRateLimiterPure.test.ts` (cover the windowSec-in-key contract)

---

### Task 4.1 — Index migration (0282)

- [ ] Verify the migration number is free at build time. Run `ls migrations/ | sort -t_ -k1,1n | tail -5` — if 0282 is taken, claim the next free integer.
- [ ] Create `migrations/0282_phase2_indexes_and_processes_notnull.sql`:

```sql
-- Phase 2 — index coverage for hot org-scoped tables (audit finding #12)
CREATE INDEX IF NOT EXISTS idx_agent_triggers_org              ON agent_triggers (organisation_id);
CREATE INDEX IF NOT EXISTS idx_process_connection_mappings_org ON process_connection_mappings (organisation_id);
CREATE INDEX IF NOT EXISTS idx_processed_resources_org         ON processed_resources (organisation_id);
CREATE INDEX IF NOT EXISTS idx_review_items_org                ON review_items (organisation_id);

-- Compound index for the most common review_items query (org + status + createdAt DESC)
CREATE INDEX IF NOT EXISTS idx_review_items_org_status_created ON review_items (organisation_id, status, created_at DESC);

-- processes.organisation_id NOT NULL (audit finding #6)
-- Hard-fail if any rows have a NULL organisation_id — placeholder UUIDs would
-- create invalid cross-tenant data and violate the always-filter-by-org invariant.
-- No rows are expected pre-launch; if this fires, manual triage is required.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM processes WHERE organisation_id IS NULL) THEN
    RAISE EXCEPTION 'processes.organisation_id contains NULLs - manual backfill required before NOT NULL constraint can be enforced';
  END IF;
END $$;

ALTER TABLE processes ALTER COLUMN organisation_id SET NOT NULL;
```

- [ ] Create `migrations/0282_phase2_indexes_and_processes_notnull.down.sql`:

```sql
ALTER TABLE processes ALTER COLUMN organisation_id DROP NOT NULL;
DROP INDEX IF EXISTS idx_review_items_org_status_created;
DROP INDEX IF EXISTS idx_review_items_org;
DROP INDEX IF EXISTS idx_processed_resources_org;
DROP INDEX IF EXISTS idx_process_connection_mappings_org;
DROP INDEX IF EXISTS idx_agent_triggers_org;
```

- [ ] Update Drizzle schema files for the four tables to declare the indexes (so Drizzle stays in sync). For example in `server/db/schema/agentTriggers.ts`:

```typescript
export const agentTriggers = pgTable('agent_triggers', {
  // ... existing columns
}, (t) => ({
  orgIdx: index('idx_agent_triggers_org').on(t.organisationId),
}));
```

- [ ] Flip `server/db/schema/processes.ts` `organisationId` from `.uuid('organisation_id')` to `.uuid('organisation_id').notNull()`.

### Task 4.2 — OAuth state JWT window 10min → 5min

- [ ] Open `server/lib/ghlOAuthStateStore.ts`. Change `TTL_MS`:

```typescript
const TTL_MS = 5 * 60 * 1000; // 5 minutes (was 10) — tighten the OAuth callback window
```

- [ ] Confirm the cleanup job (Phase 1's `oauthStateCleanupJob.ts`) still runs at a cadence ≤ TTL. If it runs every 10 minutes, change to every 5 minutes so expired rows clean before the next OAuth attempt could see them.

### Task 4.3 — Refresh-token rotation (DB-backed; operator-locked)

Decision locked: DB-backed refresh tokens + stateless access JWT (per § 12 decision 1). Ship migration 0283 with rotation columns. Task 4.4 (`password_changed_at`) ships in parallel as defence-in-depth.

- [ ] Verify `refresh_tokens` table exists. Run `psql -c "\d refresh_tokens"` and `grep -rn "refresh_tokens\|refreshTokens" server/ migrations/`. If absent, escalate to operator before proceeding (the operator-locked decision assumed the table exists).
- [ ] Create `migrations/0283_refresh_token_rotation.sql`:

```sql
-- Add fields to support single-use refresh-token rotation
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS rotated_at  timestamptz;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS replaced_by uuid REFERENCES refresh_tokens(id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active ON refresh_tokens (user_id, rotated_at) WHERE rotated_at IS NULL;
```

- [ ] In the refresh handler, on every refresh:
  1. `SELECT ... FOR UPDATE` on the presented refresh token.
  2. Reject if already rotated (replay attack — emit `auth.token_replay` security event, revoke the entire token chain).
  3. Insert a new refresh token, set `rotated_at = now(), replaced_by = newId` on the old.
  4. Return the new refresh token.

### Task 4.4 — JWT forced-logout on password change

- [ ] Add `password_changed_at` to `users` in migration 0283 alongside the refresh-token rotation columns:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz NOT NULL DEFAULT now();
```

- [ ] In `server/middleware/auth.ts`, after JWT verification, fetch the user's `passwordChangedAt` and reject the token if `jwt.iat * 1000 < passwordChangedAt`:

```typescript
const issuedAtMs = (jwtPayload.iat ?? 0) * 1000;
const user = await getUserById(jwtPayload.userId);
if (user.passwordChangedAt.getTime() > issuedAtMs) {
  await recordSecurityEvent({
    organisationId: user.organisationId,
    actorUserId:    user.id,
    eventType:      'auth.token_revoked',
    meta:           { reason: 'password_changed_after_token_issued' },
  });
  res.status(401).json({ error: 'token_revoked' });
  return;
}
```

- [ ] In `server/routes/auth.ts` password-reset and password-change handlers, set `users.passwordChangedAt = sql\`now()\`` in the same transaction as the password update. All previously-issued JWTs become invalid immediately.

### Task 4.5 — Signup rate-limit email dimension

- [ ] Open `server/routes/auth.ts` signup handler. The current rate-limit key uses only `req.ip`. NAT'd users share the bucket.
- [ ] Change to a compound key:

```typescript
const rlSignup = await rateLimitCheck(
  `signup:${req.ip ?? 'unknown'}:${(req.body.email as string | undefined)?.toLowerCase() ?? 'unknown'}`,
  10,
  900
);
```

### Task 4.6 — Login rate-limit ordering + dual-bucket (operator-locked sizing)

The Phase 1 dual-reviewer flagged that 10/60s is materially weaker than the prior 10/900s. The spec-reviewer flagged that the limiter runs before `validateBody`, so `email` may be undefined at the limiter site.

Decision locked per § 12 decision 2: short bucket 10/60s, long bucket 50/3600s. Tightening can come post-launch when real auth-failure rates are visible.

- [ ] Move `validateBody(loginBody)` before the rate-limit check in `server/routes/auth.ts` POST `/api/auth/login`.
- [ ] **Normalize the email exactly once after validation, before any downstream use** (rate-limit key, auth lookup, audit emission). Casing or whitespace variants would otherwise bypass the per-account bucket:

```typescript
const email = req.body.email.trim().toLowerCase();
// Use `email` for rate-limit keys, getUserByEmail, audit metadata.
// Do NOT reach back into req.body.email after this point.
```

- [ ] After normalization, run two rate-limit buckets:

```typescript
// Bucket 1 — UX bucket: prevents human accidental lockout
const rlShort = await rateLimitCheck(
  `login:short:${req.ip ?? 'unknown'}:${email}`,
  10,
  60
);
if (!rlShort.allowed) {
  setRateLimitDeniedHeaders(res, rlShort.resetAt, Date.now());
  res.status(429).json({ error: 'rate_limited', reason: 'short_window' });
  return;
}

// Bucket 2 — credential-stuffing bucket: prevents sustained-rate guessing
const rlLong = await rateLimitCheck(
  `login:long:${req.ip ?? 'unknown'}:${email}`,
  50,
  3600
);
if (!rlLong.allowed) {
  setRateLimitDeniedHeaders(res, rlLong.resetAt, Date.now());
  res.status(429).json({ error: 'rate_limited', reason: 'long_window' });
  return;
}
```

- [ ] Confirm the namespaces (`login:short:`, `login:long:`) prevent the windowSec-collision the spec-reviewer flagged. The two buckets share a key prefix differentiator — they are independently keyed and never read each other's window.
- [ ] Apply the same `trim().toLowerCase()` normalization at the signup limiter (Task 4.5), forgot/reset-password limiters, and any future `email`-keyed rate-limit site. Centralise via a `normalizeEmail(input: string): string` helper in `server/lib/emailNormalize.ts` if more than three call sites accumulate.

### Task 4.7 — windowSec encoded in rate-limit key (spec-reviewer recommendation)

- [ ] Open `server/lib/inboundRateLimiter.ts`. Add a JSDoc note clarifying the convention:

```typescript
/**
 * Sliding-window rate limit. Idempotency posture: state-based — every call
 * increments the bucket regardless of allowed/denied (deferred PR #234 F6 doc fix).
 *
 * IMPORTANT: callers MUST encode the window size in the key namespace when
 * the same key prefix is reused with multiple windowSec values. Two buckets
 * with the same `key` but different `windowSec` will corrupt each other's
 * sliding-window read. See spec-review log 2026-04-29 for the contract.
 *
 * Convention: `<feature>:<windowName>:<keyParts>` where windowName encodes
 * the window size (e.g. 'login:short:ip:email' for 60s, 'login:long:ip:email'
 * for 3600s).
 */
export async function check(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  // ...
}
```

- [ ] Create `server/lib/__tests__/inboundRateLimiterPure.test.ts` for the pure sliding-window math (`computeEffectiveCount` and the windowSec-in-key contract). This is the per-helper test gate from Phase 1 spec-reviewer's reduced surface; the broader concurrent-increment race + TTL cleanup tests stay deferred per the framing-deviation acknowledgement.

### Task 4.8 — Verification commands + commit

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build:server`
- [ ] `npm run db:generate` — confirm 0282 (and 0283 if applicable) appear
- [ ] `npx vitest run server/lib/__tests__/inboundRateLimiterPure.test.ts`

```bash
git add migrations/0282_phase2_indexes_and_processes_notnull.sql \
        migrations/0282_phase2_indexes_and_processes_notnull.down.sql \
        migrations/0283_refresh_token_rotation.sql \
        migrations/0283_refresh_token_rotation.down.sql \
        server/db/schema.ts \
        server/db/schema/agentTriggers.ts \
        server/db/schema/processConnectionMappings.ts \
        server/db/schema/processedResources.ts \
        server/db/schema/reviewItems.ts \
        server/db/schema/processes.ts \
        server/lib/ghlOAuthStateStore.ts \
        server/lib/inboundRateLimiter.ts \
        server/lib/__tests__/inboundRateLimiterPure.test.ts \
        server/middleware/auth.ts \
        server/routes/auth.ts \
        server/services/oauthIntegrationService.ts
git commit -m "schema+auth lifecycle: org indexes (#12), processes.org NOT NULL (#6), OAuth window 5min, refresh-token rotation OR JWT password-change revocation, signup email dim, login dual-bucket + ordering"
```

### Acceptance criteria

- `EXPLAIN SELECT * FROM agent_triggers WHERE organisation_id = ?` reports an index scan on `idx_agent_triggers_org`.
- Inserting a row into `processes` without `organisation_id` raises `23502 not_null_violation`.
- An OAuth state nonce older than 5 minutes is rejected with `invalid_or_expired_state`.
- Changing a user's password invalidates every JWT issued before the change — verified by issuing a JWT, changing the password, retrying with the old JWT → 401 `token_revoked`.
- Signup rate-limit: 11 signups from the same IP using 11 different emails are all allowed (per-(IP, email) bucket); 11 signups from the same IP+email pair → 429 on the 11th.
- Login: a rate-limit hit on the 60s bucket returns `rate_limited / short_window`; a hit on the 3600s bucket returns `rate_limited / long_window`.

---

## 7. Chunk 5 — Customer Correctness P1s (deferred from Phase 1)

**Items:** C-P0-4 (thread context injection at run start + resume), C-P0-5 (email tile config UI), C-P0-7 (AgentMailbox + AgentCalendar shape fixes — D7/D8/D9 from agent-as-employee deferred), C-P0-8 (conditional "Onboard to workplace" CTA — D10 from agent-as-employee deferred). Plus the related "agent-as-employee" deferrals D11 (signature template config), D14 (revoke confirm name source), D15 (workspace-actor-coverage CI wiring) where they share the same surface.

**Source IDs:** Phase 1 plan §"Chunk 4 — Customer-Facing P0s" lines 462-696 (the items explicitly labelled "Files (4b)" — not implemented in Phase 1). Phase 1 handoff: "C-P0-4/5/7/8 are the remaining items deferred to a follow-up branch per the plan exit gate." todo.md "Deferred from spec-conformance review — agent-as-employee" D7-D11, D14, D15.

**Dependencies:** Chunk 1 (axios timeout) so any new fetch calls get the new 15s default. Chunk 2 (audit-log) so config-change events on emails / signatures emit `data.config_changed` audit events. Chunk 4 (`agent_runs.thread_context_version` column added by migration 0282) — Task 5.1 piggy-backs on that migration. If Chunk 4 has not yet shipped when Chunk 5 starts, add the column in a separate additive migration claimed at the next free integer.
**Target:** 1 PR, 3-4 days.

### Files
- Modify: agent run orchestrator (find via `grep -rn "buildSystemPrompt" server/services/`) — thread-context injection at run start, version-pinned snapshot
- Modify: run-resume entry point — re-inject the same versioned snapshot
- Modify: `client/src/components/EmailChannelTile.tsx` — three-state render (no email channel → null, channel without config → setup card, channel with config → editor)
- Create or modify: `client/src/components/EmailConfigSetupCard.tsx` and `EmailConfigEditor.tsx`
- Modify: `client/src/pages/AgentMailboxPage.tsx` — align Message shape to `toAddresses: string[]`, `receivedAt: string | null` per spec § agent-as-employee D7
- Modify: `client/src/pages/AgentCalendarPage.tsx` — align CalendarEvent shape to `{ id, startsAt, endsAt, attendeeEmails, organiserEmail }` per D8
- Modify: `client/src/pages/SubaccountAgentsPage.tsx` (or wherever the "Onboard to workplace" CTA lives) — gate on `link.workspaceIdentityStatus === null` per D10
- Modify: `client/src/components/OnboardAgentModal.tsx` — navigate to `?tab=identity&newlyOnboarded=1` on success per D9
- Modify: `server/routes/subaccounts.ts` `/api/subaccounts/:saId/agents` response — include `workspaceIdentityStatus` per row
- Modify: `server/services/connectorConfigService.ts` (or create) — add `getWorkspaceTenantConfig(orgId, subaccountId)` per D11
- Modify: `server/services/workspace/workspaceMail.ts:127-133` — use `getWorkspaceTenantConfig` for signature/disclosure per D11
- Modify: `server/routes/workspace.ts:285-296` — clarify revoke confirm-name source (mockup 13) per D14
- Create: `.github/workflows/workspace-actor-coverage.yml` if Phase 1 didn't ship it (per D15) — verify in pre-flight; if shipped, skip
- Create: `client/src/services/__tests__/threadContextInjectionPure.test.ts`

---

### Task 5.1 — Thread context injection at run start + resume (C-P0-4)

The Phase 1 plan provided pseudocode for this; this chunk implements it surgically. The hazard: re-reading thread context at resume time produces prompt drift if context was edited mid-run. Pin the version at run-start and re-inject the same snapshot on resume.

- [ ] Identify the prompt builder. Run `grep -rn "buildSystemPrompt\\|getBaseSystemPrompt" server/services/`. Most likely `server/services/agentExecutionService.ts` or `server/services/promptBuilderService.ts`.
- [ ] In the builder, add thread-context injection. Capture `snapshot.version` on the run row so resume reads the same version:

```typescript
import { threadContextService } from './threadContextService';

async function buildSystemPrompt(runCtx: RunContext): Promise<{ prompt: string; threadContextVersion: number | null }> {
  const base = getBaseSystemPrompt(runCtx.agent);
  const snapshot = await threadContextService.getContextSnapshot(
    runCtx.taskId,
    runCtx.organisationId,
    runCtx.threadContextVersion ?? null, // null on first call; explicit version on resume
  );

  // Fail-fast on snapshot/version drift.
  // If runCtx is asking for a SPECIFIC version (resume path) and the snapshot is missing,
  // the version was deleted or compacted between run-start and resume. Returning the base
  // prompt would silently regenerate a different system prompt and produce model output
  // that doesn't match the original turn — exactly the "prompt drift" we are guarding against.
  // Throw so the resume aborts cleanly and surfaces the issue, rather than continuing on
  // a degraded prompt.
  if (!snapshot && runCtx.threadContextVersion != null) {
    throw Object.assign(
      new Error('thread_context_missing_for_version'),
      {
        statusCode: 500,
        code: 'thread_context_missing_for_version',
        meta: {
          taskId: runCtx.taskId,
          organisationId: runCtx.organisationId,
          requestedVersion: runCtx.threadContextVersion,
        },
      },
    );
  }

  if (!snapshot) {
    // First-call path (no prior version pinned): no context to inject.
    return { prompt: base, threadContextVersion: null };
  }
  const ctxBlock = formatContextBlock(snapshot);
  return {
    prompt: `${base}\n\n## Current task context\n${ctxBlock}`,
    threadContextVersion: snapshot.version,
  };
}
```

- [ ] At run start: persist `threadContextVersion` onto the `agent_runs` row (add column if missing — see migration note below). At resume: read `threadContextVersion` from the row and pass it back into `buildSystemPrompt`.
- [ ] If `agent_runs.thread_context_version` does not exist, add to migration 0282 from Chunk 4:

```sql
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS thread_context_version integer;
```

- [ ] Verify `threadContextService.getContextSnapshot` accepts an optional version parameter and returns the matching row when provided. If the function does not, add the parameter — when version is non-null, fetch by `(taskId, version)`; when null, fetch the current version.
- [ ] Extract `formatContextBlock` into `threadContextInjectionPure.ts` (pure, no DB) and test it. Cover: empty snapshot → placeholder string; snapshot with 1 entry → formatted; snapshot with 50 entries → truncated to N with a "… and X more" footer.

### Task 5.2 — Email tile config UI (C-P0-5)

- [ ] Open `client/src/components/EmailChannelTile.tsx`. Apply the three-state render per the Phase 1 pseudocode:

```tsx
if (!agent.channels?.includes('email')) return null;
if (!agent.emailConfig) {
  return <EmailConfigSetupCard agentId={agent.id} subaccountId={agent.subaccountId} />;
}
return <EmailConfigEditor config={agent.emailConfig} agentId={agent.id} />;
```

- [ ] Create or update `EmailConfigSetupCard.tsx` — a small card with one primary action ("Set up email channel") that opens `EmailConfigEditor` in a new mode. Per Frontend Design Principles rule 3 (one primary action per screen), keep this minimal.
- [ ] `EmailConfigEditor.tsx` — form for the existing `emailConfig` shape. Save via `PATCH /api/agents/:agentId/channels/email`.
- [ ] On save success, emit a `data.config_changed` security audit event from the server route (uses Chunk 2 primitive). meta should include the agentId and `field: 'emailConfig'` — never the email value itself.
- [ ] Test: render with `channels: ['email']` + no config → setup card; with config → editor; no email channel → null.

### Task 5.3 — AgentMailboxPage shape fix (C-P0-7 / D7)

- [ ] Open `client/src/pages/AgentMailboxPage.tsx`. The page expects `toAddress: string` and `receivedAt: string` but the route returns `toAddresses: string[]` and `receivedAt: string | null`.
- [ ] Update Message type:

```typescript
interface Message {
  id: string;
  fromAddress: string;
  toAddresses: string[];
  subject: string;
  receivedAt: string | null;
  sentAt: string | null;
  // ...
}
```

- [ ] In the row render, compute display values:

```tsx
const displayedAt = message.receivedAt ?? message.sentAt;
const displayedTo = message.toAddresses[0] ?? '(no recipient)';
const additionalRecipients = message.toAddresses.length > 1 ? ` +${message.toAddresses.length - 1}` : '';
```

- [ ] Test: mock API response with `toAddresses: ['a@b.com', 'c@d.com']` + `receivedAt: null` + `sentAt: '2026-...'`; assert page renders `a@b.com +1` and the sentAt timestamp.

### Task 5.4 — AgentCalendarPage shape fix (D8)

- [ ] Open `client/src/pages/AgentCalendarPage.tsx`. Realign event shape to the canonical `workspace_calendar_events` row:

```typescript
interface CalendarEvent {
  id: string;
  externalEventId: string | null;
  startsAt: string;
  endsAt: string;
  organiserEmail: string;
  attendeeEmails: string[];
  // ...
}
```

- [ ] Update field references in render (`event.startAt` → `event.startsAt`, `event.attendees` → `event.attendeeEmails`, etc.).
- [ ] Open the corresponding route. Confirm it returns the canonical row shape (it should — the deferred D8 entry says the route returns `{externalEventId, ...}` already; the page is the wrong side).

### Task 5.5 — Conditional "Onboard to workplace" CTA (C-P0-8 / D10)

- [ ] Open `server/routes/subaccounts.ts`. Find the `GET /api/subaccounts/:saId/agents` handler. Add `workspaceIdentityStatus: link.workspaceIdentityStatus ?? null` to each row in the response.
- [ ] Open `client/src/pages/SubaccountAgentsPage.tsx`. Find the "Onboard to workplace" Button. Wrap:

```tsx
{row.workspaceIdentityStatus === null ? (
  <Button onClick={() => handleOnboard(row)}>Onboard to workplace</Button>
) : (
  <Badge>Identity: {row.workspaceIdentityStatus}</Badge>
)}
```

- [ ] Per Frontend Design Principles rule 4 (inline state beats dashboards), the badge replaces the redundant CTA — operator sees status without an extra navigate.

### Task 5.6 — OnboardAgentModal navigation (D9)

- [ ] Open `client/src/components/OnboardAgentModal.tsx`. On success, navigate the parent page:

```tsx
const handleSuccess = (linkId: string) => {
  navigate(`/admin/subaccounts/${subaccountId}/agents/${linkId}/manage?tab=identity&newlyOnboarded=1`);
  onClose();
};
```

- [ ] In `client/src/pages/SubaccountAgentEditPage.tsx`, honour `newlyOnboarded=1` by defaulting the active tab to `identity` regardless of `?tab=` (or as a tiebreaker). Show a one-time inline banner: "Identity provisioned. Confirm signature and channel preferences below."

### Task 5.7 — Signature template config (D11)

- [ ] Create or extend `server/services/connectorConfigService.ts`:

```typescript
export interface WorkspaceTenantConfig {
  defaultSignatureTemplate: string;
  discloseAsAgent: boolean;
  vanityDomain?: string;
}

export async function getWorkspaceTenantConfig(
  organisationId: string,
  subaccountId: string,
): Promise<WorkspaceTenantConfig> {
  // Read from connector_configs or workspace_configs (whichever exists).
  // Fall back to platform defaults if not set.
  const [config] = await db
    .select()
    .from(connectorConfigs)
    .where(and(
      eq(connectorConfigs.organisationId, organisationId),
      eq(connectorConfigs.subaccountId, subaccountId),
      eq(connectorConfigs.connectorType, 'workspace'),
    ))
    .limit(1);
  return {
    defaultSignatureTemplate: config?.defaultSignatureTemplate ?? PLATFORM_DEFAULT_SIGNATURE,
    discloseAsAgent: config?.discloseAsAgent ?? true,
    vanityDomain: config?.vanityDomain,
  };
}
```

- [ ] Open `server/services/workspace/workspaceMail.ts:127-133`. Replace the hard-coded `subaccountName: subaccountId` and `discloseAsAgent: false` with the real lookup:

```typescript
const tenantConfig = await getWorkspaceTenantConfig(organisationId, subaccountId);
const signatureContext = {
  signatureTemplate: identity.metadata?.signature ?? tenantConfig.defaultSignatureTemplate,
  discloseAsAgent: tenantConfig.discloseAsAgent,
  subaccountName: await getSubaccountName(subaccountId),
};
```

### Task 5.8 — Revoke confirm name (D14)

- [ ] Open `client/src/components/RevokeAgentDialog.tsx` (or wherever mockup 13 lives). Confirm what name the dialog asks the operator to type. The deferred entry says the prompt says "type the agent's name to confirm."
- [ ] Decision: align the comparison source to whatever the prompt says. If the prompt says "agent's name", compare against `agents.name`. If the prompt says "workspace display name", compare against `workspace_actors.displayName` (current behaviour).
- [ ] Update either the prompt or the comparison so they match. Update `server/routes/workspace.ts:285-296` accordingly.

### Task 5.9 — Workspace-actor-coverage CI (D15)

- [ ] Phase 1 plan listed this as O-P0-1 (CI verifier wiring). Verify it shipped: `cat .github/workflows/workspace-actor-coverage.yml` — if absent, ship it now per the Phase 1 task description (workflow file + test against fixture). If present, this task is a no-op.

### Task 5.10 — Verification commands + commit

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build:client`
- [ ] `npm run build:server`
- [ ] `npx vitest run client/src/services/__tests__/threadContextInjectionPure.test.ts`

```bash
git add server/services/agentExecutionService.ts \
        server/services/threadContextInjectionPure.ts \
        client/src/services/__tests__/threadContextInjectionPure.test.ts \
        client/src/components/EmailChannelTile.tsx \
        client/src/components/EmailConfigSetupCard.tsx \
        client/src/components/EmailConfigEditor.tsx \
        client/src/pages/AgentMailboxPage.tsx \
        client/src/pages/AgentCalendarPage.tsx \
        client/src/pages/SubaccountAgentsPage.tsx \
        client/src/pages/SubaccountAgentEditPage.tsx \
        client/src/components/OnboardAgentModal.tsx \
        client/src/components/RevokeAgentDialog.tsx \
        server/routes/subaccounts.ts \
        server/routes/workspace.ts \
        server/services/connectorConfigService.ts \
        server/services/workspace/workspaceMail.ts \
        .github/workflows/workspace-actor-coverage.yml
git commit -m "customer-correctness P1s: thread-context version-pinned injection (C-P0-4); email tile three-state (C-P0-5); mailbox/calendar shape fixes (C-P0-7); conditional onboard CTA + identity badge (C-P0-8); signature template config + revoke confirm-name + onboarded modal navigation"
```

### Acceptance criteria

- A run that reads thread context at start, persists `thread_context_version`, and resumes after pause → re-injects the same version's snapshot, not the latest.
- A resume call that pins a `thread_context_version` whose snapshot has been deleted/compacted throws `thread_context_missing_for_version` (`statusCode: 500`) at the prompt-build boundary — the run does NOT proceed on a degraded prompt. Verified by deleting the snapshot row mid-run and asserting the resume call throws.
- An agent without an email channel renders nothing in the email tile slot.
- An agent with email channel + no config renders the setup card.
- An agent with email channel + config renders the editor.
- AgentMailboxPage renders correctly with `toAddresses` array.
- AgentCalendarPage renders correctly with `startsAt`/`endsAt`.
- A row with `workspaceIdentityStatus: 'active'` shows the badge, NO onboard CTA.
- A row with `workspaceIdentityStatus: null` shows the onboard CTA, NO badge.
- After a successful onboard, the page navigates to `?tab=identity&newlyOnboarded=1` and the identity tab is the default-active tab.
- Signature template comes from `getWorkspaceTenantConfig`, not a hard-coded literal.

---

## 8. Chunk 6 — Maintenance Job RLS Contract + Execution-Path Correctness

**Items:** B10-MAINT-RLS — three maintenance jobs need admin/org tx contract (`ruleAutoDeprecateJob`, `fastPathDecisionsPruneJob`, `fastPathRecalibrateJob`); C4b-INVAL-RACE (re-check invalidation after I/O in `workflowEngineService.ts` tick switch); W1-43 (defence-in-depth at dispatcher boundary in `invokeAutomationStepService.ts`); W1-44 (pre-dispatch credential resolution); W1-38 (close §5.7 error vocabulary); HERMES-S1 (thread `errorMessage` from `preFinalizeMetadata` into `extractRunInsights`); H3-PARTIAL-COUPLING (decouple `runResultStatus='partial'` from summary presence); C4a-6-RETSHAPE (skill error envelope — operator-locked: grandfather flat-string per § 12).

**Source IDs:** consolidated spec § 4 (Phase 3 — Maintenance-Job RLS Contract), § 6 (Phase 5 — Execution-Path Correctness), invariants doc §§ 1.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 6.3.

**Dependencies:** Chunk 2 (audit-log primitive — maintenance-job partial-failure events emit structured audit rows). Chunk 4 (`agent_runs.thread_context_version` column referenced by some execution-path tests).
**Target:** 1 PR (split into 6a maintenance jobs + 6b execution-path correctness if reviewer asks for finer grain), 4-5 days.

### Files (6a — maintenance jobs)
- Modify: `server/jobs/ruleAutoDeprecateJob.ts` — adopt admin/org tx contract from `memoryDedupJob.ts`
- Modify: `server/jobs/fastPathDecisionsPruneJob.ts` — same
- Modify: `server/jobs/fastPathRecalibrateJob.ts` — same
- Create: `server/jobs/__tests__/ruleAutoDeprecateJobPure.test.ts`
- Create: `server/jobs/__tests__/fastPathDecisionsPruneJobPure.test.ts`
- Create: `server/jobs/__tests__/fastPathRecalibrateJobPure.test.ts`

### Files (6b — execution-path correctness)
- Modify: `server/services/workflowEngineService.ts` — add invalidation re-check wrapper to four `*Internal` helpers (`action_call`, `agent_call`, `prompt`, `invoke_automation`)
- Modify: `server/services/invokeAutomationStepService.ts:165-166` — defence-in-depth single-webhook assertion
- Modify: `server/services/invokeAutomationStepService.ts` — pre-dispatch `required_connections` resolution
- Modify: `server/services/agentExecutionService.ts:1350-1368` — thread `errorMessage` into `extractRunInsights`
- Modify: `server/services/agentExecutionServicePure.ts` — `computeRunResultStatus` decouples summary presence from `partial` (H3 fix)
- Update: `shared/runStatus.ts` if any new vocabulary entries are added (closed status set)
- Modify: spec doc `docs/pre-launch-hardening-spec.md` § 6.5.1 to reflect the C4a-6-RETSHAPE decision (grandfather)
- Create: `server/services/__tests__/computeRunResultStatusPure.test.ts`
- Create: `server/services/__tests__/invalidationRecheckPure.test.ts`
- Create: `server/services/__tests__/dispatcherDefenceInDepthPure.test.ts`

---

### Task 6a.1 — `ruleAutoDeprecateJob` admin/org tx contract

The canonical pattern is `server/jobs/memoryDedupJob.ts`. Read it before writing the mirror.

- [ ] Open `server/jobs/ruleAutoDeprecateJob.ts`. Identify:
  - The org enumeration (currently likely `db.select(...).from(organisations)`).
  - The per-org work (decay computation + UPDATE on rule rows).
- [ ] Refactor:

```typescript
import { withAdminConnection } from '../lib/adminDbConnection';
import { withOrgTx } from '../lib/orgScopedDb';
import { acquireAdvisoryLock, releaseAdvisoryLock } from '../lib/advisoryLock';

const LOCK_KEY = 'rule_auto_deprecate';

export async function ruleAutoDeprecateJob(): Promise<{ orgsProcessed: number; orgsFailed: number; orgFailures: Array<{ organisationId: string; error: string }> }> {
  return withAdminConnection({ source: 'ruleAutoDeprecateJob' }, async (adminDb) => {
    const lock = await acquireAdvisoryLock(adminDb, LOCK_KEY);
    if (!lock.acquired) return { orgsProcessed: 0, orgsFailed: 0, orgFailures: [] };

    try {
      const orgs = await adminDb.select({ id: organisations.id }).from(organisations).where(isNull(organisations.deletedAt));
      let processed = 0;
      let failed = 0;
      const failures: Array<{ organisationId: string; error: string }> = [];

      // Sequential per-org per invariant 1.5 — never one shared admin tx across all orgs
      for (const org of orgs) {
        try {
          await withOrgTx({ organisationId: org.id, source: 'ruleAutoDeprecateJob' }, async (tx) => {
            await deprecateRulesForOrg(tx, org.id);
          });
          processed += 1;
        } catch (err) {
          // Per-org isolation: one org's failure must not abort the rest
          failed += 1;
          failures.push({ organisationId: org.id, error: err instanceof Error ? err.message : String(err) });
          await recordSecurityEvent({
            organisationId: org.id,
            eventType: 'job.partial_failure' as const, // add to SecurityEventType union
            meta: { job: 'ruleAutoDeprecate', error: failures[failures.length - 1].error },
          });
        }
      }

      // Terminal observability event per invariant 7.7 — exactly one
      const terminalStatus = failed === 0 ? 'success' : (processed === 0 ? 'failed' : 'partial');
      logger.info({
        job: 'ruleAutoDeprecate',
        status: terminalStatus,
        orgsProcessed: processed,
        orgsFailed: failed,
      }, 'rule_auto_deprecate.completed');

      return { orgsProcessed: processed, orgsFailed: failed, orgFailures: failures };
    } finally {
      await releaseAdvisoryLock(adminDb, LOCK_KEY);
    }
  });
}

async function deprecateRulesForOrg(tx: TransactionDb, organisationId: string): Promise<void> {
  // Pure deprecation logic: update rules where (org=org) AND (lastUsedAt < now() - 30d)
  // Use sql`now()` for DB time per invariant 1.
  await tx
    .update(rules)
    .set({ deprecatedAt: sql`now()`, status: 'deprecated' })
    .where(and(
      eq(rules.organisationId, organisationId),
      eq(rules.status, 'active'),
      lt(rules.lastUsedAt, sql`now() - interval '30 days'`),
    ));
}
```

- [ ] Add a pure test for `deprecateRulesForOrg` (extract the WHERE-clause-builder into a pure function and test the predicate composition). The pure module name follows the `*Pure.ts` convention — DEVELOPMENT_GUIDELINES § 7.

### Task 6a.2 — `fastPathDecisionsPruneJob` admin/org tx contract

- [ ] Same pattern as 6a.1 applied to `server/jobs/fastPathDecisionsPruneJob.ts`. Lock key: `fast_path_decisions_prune`. Per-org work: DELETE old fast-path-decision rows older than retention.
- [ ] Pure test asserting prune predicate matches expected rows.

### Task 6a.3 — `fastPathRecalibrateJob` admin/org tx contract

- [ ] Same pattern applied to `server/jobs/fastPathRecalibrateJob.ts`. Lock key: `fast_path_recalibrate`. Per-org work: recompute and write fast-path calibration metrics.
- [ ] Pure test for recalibration math (input array of decisions → expected calibration vector).

### Task 6b.1 — Invalidation re-check before AND after I/O (C4b-INVAL-RACE)

The `workflowEngineService.ts` tick switch dispatches `action_call`, `agent_call`, `prompt`, and `invoke_automation` step types. Each `*Internal` helper awaits external I/O and then writes the step status. Two race windows exist:

1. **Pre-call window:** an invalidate that lands between dispatch decision and the external call still reaches the external system (irreversible side effect on a step the user has already cancelled).
2. **Post-call window:** an invalidate that lands between the external call and the local write produces a stale "completed" status on a step that was supposed to discard.

Both windows must be closed. Re-check invalidation **before** the external call (defence against pre-call window) AND **after** the external call (defence against post-call window).

- [ ] Open `server/services/workflowEngineService.ts`. For each of the four `*Internal` helpers (`actionCallInternal`, `agentCallInternal`, `promptInternal`, `invokeAutomationInternal`), bracket the external call with the invalidation re-read on both sides:

```typescript
import { shouldDiscardWriteForInvalidation } from './workflowEngineServicePure';

async function actionCallInternal(stepRunId: string, ...): Promise<void> {
  // PRE-CALL guard — short-circuit before any external side effect (invariant 3.1)
  const preCheck = await db
    .select({ status: workflowStepRuns.status })
    .from(workflowStepRuns)
    .where(eq(workflowStepRuns.id, stepRunId));
  if (shouldDiscardWriteForInvalidation(preCheck[0]?.status ?? '')) {
    logger.info({ stepRunId, preCallInvalidated: true }, 'workflowEngine.invalidated_before_dispatch');
    return; // hard discard — do NOT make the external call
  }

  // External I/O
  const externalResult = await someExternalCall(...);

  // POST-CALL guard — re-check invalidation after every await (invariant 3.1)
  const current = await db
    .select({ status: workflowStepRuns.status })
    .from(workflowStepRuns)
    .where(eq(workflowStepRuns.id, stepRunId))
    .for('update');
  if (shouldDiscardWriteForInvalidation(current[0]?.status ?? '')) {
    logger.info({ stepRunId, lateExternalResult: true }, 'workflowEngine.invalidated_during_dispatch');
    return; // hard discard — do NOT write the result
  }

  await writeStepRunSuccess(stepRunId, externalResult);
}
```

- [ ] Extract the predicate (`status === 'invalidated'`) into `workflowEngineServicePure.ts` for testability:

```typescript
export function shouldDiscardWriteForInvalidation(currentStatus: string): boolean {
  return currentStatus === 'invalidated' || currentStatus === 'cancelled';
}
```

- [ ] Test in `server/services/__tests__/invalidationRecheckPure.test.ts`:

```typescript
import { shouldDiscardWriteForInvalidation } from '../workflowEngineServicePure';

describe('shouldDiscardWriteForInvalidation', () => {
  it.each([
    ['invalidated', true],
    ['cancelled', true],
    ['running', false],
    ['completed', false],
    ['pending', false],
  ])('status=%s → discard=%s', (status, expected) => {
    expect(shouldDiscardWriteForInvalidation(status)).toBe(expected);
  });
});
```

### Task 6b.2 — Dispatcher defence-in-depth (W1-43)

Per spec § 5.10a rule 4, an `invoke_automation` step that resolves to multiple webhooks is invalid (one outbound webhook per step). Today the dispatcher trusts the resolution; add a pure-function assertion.

- [ ] Open `server/services/invokeAutomationStepService.ts:165-166`. Inside `resolveDispatch`, add:

```typescript
import { assertSingleWebhookComposition } from './invokeAutomationStepServicePure';

const dispatch = computeDispatch(automationRow, ...);
const compositionCheck = assertSingleWebhookComposition(dispatch);
if (!compositionCheck.ok) {
  return {
    status: 'automation_composition_invalid' as const,
    errorCode: 'automation_composition_invalid',
    reason: compositionCheck.reason,
  };
}
```

- [ ] Create the pure assertion in `invokeAutomationStepServicePure.ts`:

```typescript
export interface DispatchPlan { webhooks: Array<{ url: string; method: string }>; /* ... */ }

export function assertSingleWebhookComposition(plan: DispatchPlan):
  | { ok: true }
  | { ok: false; reason: string } {
  if (plan.webhooks.length === 0) return { ok: false, reason: 'no_webhooks' };
  if (plan.webhooks.length > 1) return { ok: false, reason: `${plan.webhooks.length}_webhooks` };
  return { ok: true };
}
```

- [ ] Test in `dispatcherDefenceInDepthPure.test.ts`: 0 webhooks → fail; 1 webhook → ok; 2 webhooks → fail with reason.

### Task 6b.3 — Pre-dispatch credential resolution (W1-44)

The dispatcher today fires the webhook and discovers missing credentials at the provider edge. Move that resolution to dispatch time.

- [ ] In `invokeAutomationStepService.ts`, before invoking the provider:

```typescript
const required = automation.requiredConnections ?? [];
const missing = await resolveMissingConnections({
  organisationId,
  subaccountId,
  requiredConnections: required,
});
if (missing.length > 0) {
  return {
    status: 'automation_missing_connection' as const,
    errorCode: 'automation_missing_connection',
    missing,
  };
}
```

- [ ] `resolveMissingConnections` is a small new helper in `connectorConfigService.ts` (or wherever connection lookup lives) — accepts a list of connection slugs and returns the subset not present for the (org, subaccount) pair.

### Task 6b.4 — §5.7 error vocabulary closure (W1-38)

- [ ] Audit `server/services/invokeAutomationStepService.ts:95` for the value emitted as `automation_execution_error`. Per the spec deferred entry, choose: introduce `automation_engine_unavailable`, OR re-use `automation_not_found`, OR re-use `automation_missing_connection`.
- [ ] Recommendation: introduce `automation_engine_unavailable` because it surfaces the operational failure mode distinctly. Update the spec § 5.7 vocabulary list in the same commit.
- [ ] Add a CI grep guard (Chunk 7 covers the new gate) that verifies `errorCode:` literals in execution code intersect the canonical vocabulary set.

### Task 6b.5 — HERMES-S1 errorMessage threading

- [ ] Open `server/services/agentExecutionService.ts:1350-1368`. The current call to `extractRunInsights` passes `errorMessage: null` even when the run terminated via the normal path (no thrown exception) but with `derivedRunResultStatus === 'failed'`.
- [ ] Thread `errorMessage` from `preFinalizeMetadata`:

```typescript
const errorMessage = derivedRunResultStatus === 'failed'
  ? (preFinalizeMetadata?.errorMessage ?? null)
  : null;

await extractRunInsights({
  // ... existing args
  errorMessage,
});
```

- [ ] Pure test asserting that for `derivedRunResultStatus === 'failed'` and a non-null `preFinalizeMetadata.errorMessage`, the threaded value matches.

### Task 6b.6 — H3-PARTIAL-COUPLING fix

Per invariants doc § 3.5: a semantically-successful run with no summary is `success`, NOT `partial`. The H3 architect resolution chose Option B (separate `summaryMissing` side channel).

- [ ] Open `server/services/agentExecutionServicePure.ts`. Find `computeRunResultStatus(finalStatus, hasError, hadUncertainty, hasSummary)`.
- [ ] Decouple `hasSummary` from `partial`:

```typescript
export function computeRunResultStatus(
  finalStatus: string,
  hasError: boolean,
  hadUncertainty: boolean,
  // hasSummary intentionally REMOVED from inputs — it does not affect runResultStatus
): 'success' | 'partial' | 'failed' | 'cancelled' {
  if (finalStatus === 'cancelled') return 'cancelled';
  if (hasError) return 'failed';
  if (hadUncertainty) return 'partial';
  return 'success';
}

// Caller should compute summaryMissing as a separate side channel:
export function computeSummaryMissing(loopResult: LoopResult): boolean {
  return !loopResult.summary || loopResult.summary.length < 100;
}
```

- [ ] Update every caller of `computeRunResultStatus` to drop the `hasSummary` argument and instead call `computeSummaryMissing` separately. Persist `summaryMissing` to a side channel (existing `runMetadata.summaryMissing` jsonb field, or a dedicated column if the schema allows).
- [ ] Test in `computeRunResultStatusPure.test.ts`:

```typescript
describe('computeRunResultStatus', () => {
  it.each([
    ['completed', false, false, 'success'],
    ['completed', false, true,  'partial'],
    ['completed', true,  false, 'failed'],
    ['cancelled', false, false, 'cancelled'],
  ])('finalStatus=%s hasError=%s hadUncertainty=%s → %s',
    (finalStatus, hasError, hadUncertainty, expected) => {
      expect(computeRunResultStatus(finalStatus, hasError, hadUncertainty)).toBe(expected);
  });

  it('does not demote success to partial on missing summary (H3 decoupling)', () => {
    expect(computeRunResultStatus('completed', false, false)).toBe('success');
    // summary absence is now a side channel, not an input
  });
});
```

### Task 6b.7 — C4a-6-RETSHAPE: grandfather flat-string (operator-locked)

Decision locked per § 12 decision 4: **grandfather the flat-string error pattern**. Migration to the `{code, message, context}` envelope across ~40 skills is deferred to Phase 3, conditional on a UI consumer requiring the structured shape.

- [ ] In a single commit, update `docs/pre-launch-hardening-spec.md` § 6.4.3 to record: "Phase 2 grandfathers the flat-string `error: <code-string>` shape across all skill handlers. Migration to `{code, message, context}` envelope is deferred — open a new spec when a UI consumer needs the structured shape."
- [ ] Add a CI grep gate (Chunk 7) that asserts every skill handler return shape matches the flat-string pattern (no mixed shapes — invariant 2.4 closure).

### Task 6.8 — Verification commands + commit

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build:server`
- [ ] `npx vitest run server/jobs/__tests__/ruleAutoDeprecateJobPure.test.ts`
- [ ] `npx vitest run server/jobs/__tests__/fastPathDecisionsPruneJobPure.test.ts`
- [ ] `npx vitest run server/jobs/__tests__/fastPathRecalibrateJobPure.test.ts`
- [ ] `npx vitest run server/services/__tests__/computeRunResultStatusPure.test.ts`
- [ ] `npx vitest run server/services/__tests__/invalidationRecheckPure.test.ts`
- [ ] `npx vitest run server/services/__tests__/dispatcherDefenceInDepthPure.test.ts`

```bash
git add server/jobs/ruleAutoDeprecateJob.ts \
        server/jobs/fastPathDecisionsPruneJob.ts \
        server/jobs/fastPathRecalibrateJob.ts \
        server/jobs/__tests__/ \
        server/services/workflowEngineService.ts \
        server/services/workflowEngineServicePure.ts \
        server/services/invokeAutomationStepService.ts \
        server/services/invokeAutomationStepServicePure.ts \
        server/services/agentExecutionService.ts \
        server/services/agentExecutionServicePure.ts \
        server/services/__tests__/ \
        server/services/connectorConfigService.ts \
        docs/pre-launch-hardening-spec.md
git commit -m "maintenance + execution: B10-MAINT-RLS for 3 jobs; C4b invalidation re-check; W1-43 dispatcher single-webhook assertion; W1-44 pre-dispatch credential resolution; W1-38 vocabulary closure; HERMES-S1 errorMessage threading; H3-PARTIAL-COUPLING decoupled; C4a-6-RETSHAPE grandfather"
```

### Acceptance criteria

- All three maintenance jobs run their per-org work under `withOrgTx` (admin tx for enumeration, per-org tx for writes); a forced failure for one org does not abort the rest, and the failure surfaces as a `job.partial_failure` security audit event.
- `workflowEngineService` tick switch: a step run that is invalidated mid-dispatch hard-discards on the post-await re-check; verify by injecting a UPDATE between the await resolution and the write, then asserting the step's status remains `invalidated` and `outputJson` is null.
- `invokeAutomationStepService` rejects a multi-webhook composition with `automation_composition_invalid`.
- `invokeAutomationStepService` rejects missing `required_connections` at dispatch with `automation_missing_connection` — no provider call attempted.
- `extractRunInsights` is invoked with a non-null `errorMessage` for failed-without-throw runs.
- `computeRunResultStatus(completed, false, false)` returns `success` (decoupled from summary).
- Skill handler return shapes uniformly flat-string (CI grep gate green).

---

## 9. Chunk 7 — Compliance Runbooks + Gate Hygiene

**Items:** Security-incident runbook, P3-H4 (`actionCallAllowlist.ts`), P3-H5 (`measureInterventionOutcomeJob` canonicalAccounts via service), P3-H6 (`referenceDocumentService` direct anthropic adapter), P3-H7 / S-2 (PrincipalContext propagation through 5 callers), P3-M10..M16 (skill visibility drift, missing YAML frontmatter on 5 workflow skills, `verify-integration-reference.mjs` yaml dep, missing canonical dictionary entries, `docs/capabilities.md` editorial rule violation), P3-L1 (explicit package.json deps), S2-SKILL-MD (skill `.md` definitions for `ask_clarifying_questions` and `challenge_assumptions`), S3-CONFLICT-TESTS (rule-conflict parser tests), S5-PURE-TEST (`saveSkillVersion` pure unit test), SC-COVERAGE-BASELINE (capture pre-Phase-3 baseline counts), RLS-CONTRACT-IMPORT (gate skips `import type` lines), pre-existing soft-delete unique index gap on revoked-then-recreated rows (DEVELOPMENT_GUIDELINES § 3 third bullet — verify across all soft-deletable tables).

**Source IDs:** consolidated spec § 5 (Phase 4 — Gate Hygiene Cleanup) — every item explicitly named there. Mini-spec § Chunk 6.

**Dependencies:** Chunks 1-6 must land first — Chunk 7 is cleanup riding alongside the substantive changes. Items in this chunk are individually small (one-line code edits, missing-file fixes, doc updates, gate tweaks). They bundle together because each on its own is too small to PR.
**Target:** 1 PR, 2 days.

### Files
- Create: `docs/runbooks/security-incident.md`
- Create: `server/config/actionCallAllowlist.ts` (P3-H4) — single-source list of action call names admitted by the runtime gate
- Modify: `server/jobs/measureInterventionOutcomeJob.ts` — move `canonicalAccounts` query into `canonicalDataService` (P3-H5)
- Modify: `server/services/referenceDocumentService.ts` — replace direct `anthropicAdapter` with `llmRouter.routeCall` (P3-H6)
- Modify: 5 callers of `canonicalDataService` (P3-H7 / S-2) — accept `PrincipalContext`, pass it through; default to `fromOrgId(orgId)` for legacy contexts
- Create: `server/skills/ask_clarifying_questions.md` (S2-SKILL-MD)
- Create: `server/skills/challenge_assumptions.md` (S2-SKILL-MD)
- Modify: 5 workflow skill `.md` files — add YAML frontmatter (P3-M11)
- Modify: `scripts/verify-integration-reference.mjs` — explicit `yaml` dep import (P3-M12)
- Modify: `package.json` — explicit `yaml` and any other transitive-required deps (P3-L1, P3-M12)
- Update: `shared/canonicalDictionary.ts` (or wherever the canonical dictionary lives) — add missing entries flagged by P3-M14
- Update: `docs/capabilities.md` — fix editorial-rule violation flagged by P3-M16
- Update: `client/src/components/skill-picker/...` (or wherever skill visibility is drift-detected) — fix P3-M10 visibility drift
- Modify: `scripts/verify-rls-contract-compliance.sh` — pipe through `grep -v "import type"` per RLS-CONTRACT-IMPORT
- Modify: `scripts/verify-skill-read-paths.sh` (or whichever advisory-runner gate captures output) — append `|| true` per gate-authoring rule
- Update: `tasks/builds/pre-launch-hardening-specs/progress.md` — record SC-COVERAGE-BASELINE numbers (warning counts of `verify-input-validation.sh` and `verify-permission-scope.sh` at the time Chunk 7 PR is opened — these come from the LAST CI run, not a local invocation)
- Create: `server/services/__tests__/saveSkillVersionPure.test.ts` (S5-PURE-TEST)
- Update: `server/services/__tests__/ruleConflictParserPure.test.ts` (S3-CONFLICT-TESTS) — strengthen with adjacency / overlap fixtures

---

### Task 7.1 — Security-incident runbook

- [ ] Create `docs/runbooks/security-incident.md` with sections:

```markdown
# Security incident runbook

**Audience:** on-call engineer + security lead.
**Trigger:** any of: cross-org access alert, mass auth failure spike, credential leak suspected, unauthorised data export attempt, RLS bypass detection.

## Triage (first 5 minutes)
1. Is the incident in-progress? Check `security_audit_events` for the matching event_type within the last hour.
2. Identify scope: single org, multiple orgs, system-wide.
3. Decide containment: rate-limit, IP block, account suspension, or full read-only mode.

## Containment levers
- **IP block.** Add to denylist in `server/middleware/auth.ts` (env var `IP_DENYLIST`). Effective immediately on next request.
- **User account suspension.** `UPDATE users SET status = 'suspended', password_changed_at = sql now()` (forces JWT revocation per Phase 2 Chunk 4).
- **Org freeze (read-only).** Set the `org_status` column to `frozen`; routes that gate on org_status return 423 Locked.
- **System-wide read-only.** Flip `READ_ONLY_MODE=true` env var; mutating routes return 503.

## Investigation
1. Query `security_audit_events` filtered to (org, time-window) for the affected scope.
2. Pull related `webhook_audit_log` and `audit_events` rows.
3. Check `system_incidents` for related fingerprints.
4. Build the timeline: first observation → containment → escalation → root cause.

## Communication
- **Internal:** post to #incidents Slack channel within 10 min of containment decision.
- **External (if customer data affected):** decision tree — see "External notification matrix" below.

## Post-incident
- Write a post-mortem within 48h.
- File any new fixed-class items in `tasks/todo.md`.
- Update KNOWLEDGE.md with the lesson.
- Update this runbook if the response process surfaced a gap.

## External notification matrix
- **Cross-tenant data exposure (any customer's data visible to another tenant):** notify within 72h per GDPR.
- **Auth/credential exposure (creds visible in logs / external):** notify affected users within 24h.
- **No customer data exposed (e.g. internal DB metric scrape):** internal post-mortem only; no customer notification required.

## On-call rota
[fill in after Phase 2 ships]
```

### Task 7.2 — `actionCallAllowlist.ts` (P3-H4)

- [ ] Create `server/config/actionCallAllowlist.ts`:

```typescript
/**
 * Single source of truth for action call names admitted by the runtime gate.
 * Keep alphabetised. Adding an entry must be paired with a registration in
 * server/config/actionRegistry.ts and a SKILL_HANDLERS entry in skillExecutor.ts
 * (DEVELOPMENT_GUIDELINES § 8.23).
 */
export const ACTION_CALL_ALLOWLIST: ReadonlySet<string> = new Set([
  // populated by enumerating the current ACTION_REGISTRY at PR time
]);

export function isActionCallAllowed(name: string): boolean {
  return ACTION_CALL_ALLOWLIST.has(name);
}
```

- [ ] Wire `isActionCallAllowed` at the runtime gate (find via grep for the existing inline check). Replace the inline list with the import.
- [ ] CI gate update: `scripts/verify-action-call-allowlist.sh` reads from this file (or the file is already its source of truth — verify). If the gate reads from `actionRegistry.ts` directly, no script change needed.

### Task 7.3 — `measureInterventionOutcomeJob` canonical service (P3-H5)

- [ ] Open `server/jobs/measureInterventionOutcomeJob.ts`. Find any direct `db.select(...).from(canonicalAccounts)` query.
- [ ] Move the read into `server/services/canonicalDataService.ts` as a new method (or use an existing one if already present). The job calls the service.
- [ ] Confirm the service call passes a `PrincipalContext` per DEVELOPMENT_GUIDELINES § 4. Use `fromOrgId(orgId)` from the job context.

### Task 7.4 — `referenceDocumentService` no direct anthropic (P3-H6)

- [ ] Open `server/services/referenceDocumentService.ts`. Find any `import ... from '../adapters/anthropicAdapter'` or direct `countTokens(...)` calls.
- [ ] Replace with `llmRouter.routeCall(...)` per DEVELOPMENT_GUIDELINES § 4.
- [ ] CI gate `verify-no-direct-adapter-calls.sh` should already detect violations — running it locally is forbidden, but a clean PR diff (no anthropicAdapter imports under `server/services/`) is the static check.

### Task 7.5 — PrincipalContext propagation (P3-H7 / S-2)

- [ ] Identify the 5 `canonicalDataService` callers that don't pass `PrincipalContext` (consolidated spec § 5.2 names them or grep for `canonicalDataService\\.` in callers).
- [ ] For each caller, accept a `PrincipalContext` parameter and forward it. Where the caller does not have a `PrincipalContext` in scope (e.g. a job context), construct via `fromOrgId(orgId, subaccountId?)` per DEVELOPMENT_GUIDELINES § 4.
- [ ] CI gate `verify-principal-context-propagation.sh` should be green after this — same as 7.4, the static check is the clean diff.

### Task 7.6 — Missing skill `.md` definitions (S2-SKILL-MD)

- [ ] Create `server/skills/ask_clarifying_questions.md` and `server/skills/challenge_assumptions.md`. Each follows the existing skill-definition schema (look at any existing skill `.md` for the YAML frontmatter shape and body structure).
- [ ] Verify the gate that detects undefined skills (`verify-skill-read-paths.sh`) is happy with the additions.

### Task 7.7 — YAML frontmatter on 5 workflow skills (P3-M11)

- [ ] Identify the 5 workflow skill `.md` files missing frontmatter. Either via the gate's output or `grep -L "^---" server/skills/workflow/`.
- [ ] Add the standard YAML frontmatter to each.

### Task 7.8 — Explicit yaml dep + verify-integration-reference.mjs (P3-M12, P3-L1)

- [ ] Open `scripts/verify-integration-reference.mjs`. If it relies on `yaml` package via transitive dep, add an explicit `import yaml from 'yaml'`.
- [ ] Open `package.json`. Add `"yaml": "^2.x"` to `dependencies` (or move from a transitive dep). Add any other transitive-required deps surfaced by P3-L1.
- [ ] Run `npm install` and confirm `package-lock.json` updates correctly.

### Task 7.9 — Canonical dictionary entries (P3-M14)

- [ ] Identify the missing entries flagged by P3-M14 (consolidated spec § 5.2.x will name them, or grep for the gate's output pattern).
- [ ] Add the missing entries to `shared/canonicalDictionary.ts`.

### Task 7.10 — capabilities.md editorial rule violation (P3-M16)

- [ ] Identify the violating section in `docs/capabilities.md`. Per CLAUDE.md's user-facing doc style and the editorial rules in capabilities.md, vendor names and internal technical jargon are forbidden in user-facing copy.
- [ ] Rewrite the offending paragraph(s).

### Task 7.11 — Skill visibility drift (P3-M10)

- [ ] Identify the drift between the skill picker UI's visible list and the registered skills. Likely a UI-side filter that excludes a registered skill.
- [ ] Update either the registry or the UI filter so the visible list matches the registered set.

### Task 7.12 — RLS-CONTRACT-IMPORT gate update

- [ ] Open `scripts/verify-rls-contract-compliance.sh`. Find the grep that detects `import { db } from`. Pipe through `grep -v "import type"` so type-only imports are not flagged.
- [ ] Add a fixture test: a new file in `scripts/__fixtures__/rls-contract/` containing both a runtime `import { db }` and an `import type { db }`. Document that only the runtime import should trigger the gate.

### Task 7.13 — Advisory gate runner `|| true` (gate authoring rule)

- [ ] Audit any script in `scripts/` that captures advisory gate output via `OUTPUT="$(bash gate.sh 2>&1)"` under `set -euo pipefail`. Append `|| true`.
- [ ] Reference DEVELOPMENT_GUIDELINES § 5 "Advisory gate runners must use `|| true`" inline.

### Task 7.14 — SC-COVERAGE-BASELINE record

- [ ] Read the most recent CI run's output for `verify-input-validation.sh` and `verify-permission-scope.sh`. The warning-level counts at the time Chunk 7 PR is opened are the Phase 3 baseline.
- [ ] Update `tasks/builds/pre-launch-hardening-specs/progress.md` with the recorded numbers and date.
- [ ] Cite the baseline in the Chunk 7 PR description.

### Task 7.15 — Soft-delete unique index audit

- [ ] DEVELOPMENT_GUIDELINES § 3 third bullet: partial unique indexes on soft-deletable tables must include `AND deleted_at IS NULL`. Audit existing soft-deletable tables for partial unique indexes that omit the predicate.
- [ ] For each violation, write a corrective migration (claim next free integer; e.g. 0284). Drop the old index, create the new one with the predicate.
- [ ] If the audit surfaces > 3 violations, this becomes its own chunk in Phase 3 — defer with a note. If ≤ 3, ship in this PR.

### Task 7.16a — Audit-stream split grep gate

Closes the Chunk 2 invariant: `auditService.log` is forbidden for any event whose action/eventType starts with `auth.` or `oauth.`.

- [ ] Add a grep gate to `scripts/verify-audit-stream-split.sh`:

```bash
#!/usr/bin/env bash
# Enforce the Phase 2 audit-stream split: auth.* and oauth.* events go through
# securityAuditService exclusively. auditService.log for those prefixes is forbidden.
set -euo pipefail

VIOLATIONS=$(grep -RnE "auditService\.log\([^)]*['\"](auth|oauth)\." server/ || true)
if [ -n "$VIOLATIONS" ]; then
  echo "Audit-stream split violation: auth.* / oauth.* events must use securityAuditService, not auditService.log"
  echo "$VIOLATIONS"
  exit 1
fi
echo "audit-stream split gate: clean"
```

- [ ] Wire into the `gates` CI job alongside the existing RLS / soft-delete gates. Hard-block (not advisory).
- [ ] Add a fixture to `scripts/__fixtures__/audit-stream-split/`: one file using `auditService.log({ action: 'auth.login.failure', ... })` (must trip the gate) and one using `securityAuditService.record({ eventType: 'auth.login.failure', ... })` (must pass).

### Task 7.16 — S5-PURE-TEST: `saveSkillVersion`

- [ ] Extract the version-bump computation from `saveSkillVersion` into a pure function in `skillVersioningPure.ts`.
- [ ] Test cover: first version (no prior) → 1; nth version → n+1; concurrent writes resolve via the version-predicate UPDATE elsewhere — that part is integration, not pure.

### Task 7.17 — S3-CONFLICT-TESTS: rule-conflict parser strengthening

- [ ] Open the existing `ruleConflictParserPure.test.ts`. Add fixtures covering: adjacent rules with overlapping conditions, rules with subset/superset condition overlap, contradictory rules with the same trigger. Each case should assert the parser returns the expected `conflictType` value.

### Task 7.18 — Verification commands + commit

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build:server`
- [ ] `npm run build:client` (if client files changed)
- [ ] `npx vitest run server/services/__tests__/saveSkillVersionPure.test.ts`
- [ ] `npx vitest run server/services/__tests__/ruleConflictParserPure.test.ts` (existing — verify it still passes after fixture additions)

```bash
git add docs/runbooks/security-incident.md \
        server/config/actionCallAllowlist.ts \
        server/jobs/measureInterventionOutcomeJob.ts \
        server/services/referenceDocumentService.ts \
        server/services/canonicalDataService.ts \
        server/skills/ask_clarifying_questions.md \
        server/skills/challenge_assumptions.md \
        server/skills/workflow/ \
        scripts/verify-integration-reference.mjs \
        scripts/verify-rls-contract-compliance.sh \
        scripts/verify-audit-stream-split.sh \
        scripts/__fixtures__/rls-contract/ \
        scripts/__fixtures__/audit-stream-split/ \
        package.json \
        package-lock.json \
        shared/canonicalDictionary.ts \
        docs/capabilities.md \
        client/src/components/skill-picker/ \
        server/services/__tests__/saveSkillVersionPure.test.ts \
        server/services/__tests__/ruleConflictParserPure.test.ts \
        tasks/builds/pre-launch-hardening-specs/progress.md
git commit -m "compliance + gate hygiene: security-incident runbook; actionCallAllowlist; canonicalDataService PrincipalContext; referenceDocumentService llmRouter; missing skill .md; YAML frontmatter; explicit yaml dep; canonical dictionary entries; capabilities.md editorial; RLS-CONTRACT-IMPORT gate type-import filter; advisory gate ||true; soft-delete unique index audit; baseline coverage record"
```

### Acceptance criteria

- `docs/runbooks/security-incident.md` is published with all sections filled.
- Grep for `import .* anthropicAdapter` in `server/services/` returns zero matches.
- The 5 callers of `canonicalDataService` accept and forward `PrincipalContext`.
- `server/skills/ask_clarifying_questions.md` and `challenge_assumptions.md` exist with valid frontmatter.
- 5 workflow skills now have YAML frontmatter — verified by grep.
- `package.json` declares `yaml` explicitly; `npm ci` from a clean clone succeeds.
- `docs/capabilities.md` editorial sweep complete — vendor names + internal jargon removed from the flagged section.
- `verify-rls-contract-compliance.sh` no longer flags `import type { db }`.
- `tasks/builds/pre-launch-hardening-specs/progress.md` records the baseline counts with date.
- `scripts/verify-audit-stream-split.sh` exists, is wired into the `gates` CI job as hard-block, and trips on the fixture violation (Task 7.16a).
- **Gate hygiene meta-rule:** every invariant introduced or referenced by Phase 2 is enforceable by EITHER (a) a grep gate in `scripts/verify-*.sh`, OR (b) a pure-function test under `**/__tests__/*Pure.test.ts`. Manual-only invariants are not accepted in Phase 2 — if a new rule cannot be expressed by grep or pure test, it must be reformulated, deferred, or rejected. Verified by listing every invariant cited in chunk-acceptance criteria and pointing to its enforcement artefact in the Phase 2 PR description.

---

## 10. Phase 2 Exit Gate Checklist

Before merging `claude/pre-launch-phase-2` to main and starting Phase 3:

**Static checks (all must be clean)**
- [ ] `npm run lint` — zero errors
- [ ] `npm run typecheck` — zero errors
- [ ] `npm run build:server` — clean
- [ ] `npm run build:client` — clean

**Review pass**
- [ ] `spec-conformance` — returns CONFORMANT against `tasks/builds/pre-launch-hardening/spec.md` for the Phase 2 surface (consolidated spec § 2.2 truly-open items closed by this branch)
- [ ] `pr-reviewer` — no must-fix findings
- [ ] `adversarial-reviewer` — no P0 findings (P1 / worth-confirming routed to `tasks/todo.md` and CC'd to Phase 3)
- [ ] `chatgpt-pr-review` — APPROVED with deferrals routed to `tasks/todo.md`

**Client foundation tests**
- [ ] Render an intentional error inside an org-admin route → app boundary catches; auth boundary unaffected (no full-page blank).
- [ ] Trigger a 429 from any rate-limited endpoint → axios interceptor exposes `error.retryAfterSec`.
- [ ] Boot the server in production with `TOKEN_ENCRYPTION_KEY` unset → process exits with the named fatal error.
- [ ] OrgAdminGuard with non-admin user → redirect to `/`, no fetch of admin routes attempted.
- [ ] Grep `client/src` for `.catch(() => {})` → 0 matches.

**Audit log + webhook tests**
- [ ] Failed login → `security_audit_events` row appears with `event_type='auth.login.failure'` and redacted meta.
- [ ] Permission-denied 403 → `security_audit_events` row with `event_type='auth.permission_denied'`.
- [ ] Force a slack-webhook-handler 500 → incident store has a `webhook:slack:handler_failed` fingerprint row.
- [ ] OAuth callback with `pending_run_id` → exactly one `RESUME_RUN_JOB` enqueued.
- [ ] Grep `withOrgTx({ tx: db,` in `server/routes/oauthIntegrations.ts` → 0 matches.
- [ ] `bash scripts/verify-audit-stream-split.sh` → exits 0 against the live tree; exits 1 against the `auditService.log({ action: 'auth.*' })` fixture (Task 7.16a).

**Soft-delete + RLS tests**
- [ ] Soft-delete an agent; query `subaccountAgentService.getTree(subaccountId)` → deleted agent excluded.
- [ ] Soft-delete an agent; dispatch a routing decision via `hierarchyRouteResolverService` → deleted agent not selected.
- [ ] Call `skillService.getSkill('id-from-org-A')` from org-B context → returns null.
- [ ] Force `reviewService` partial-failure → zero changes in `actions` and `reviewItems`.
- [ ] Insert a `task` via `taskService.createTask` from a per-org tx → row visible in same tx, row scoped to the supplied org under FORCE RLS.
- [ ] Soft-delete an `agents` row, then call `taskService.createTask({ assignedAgentId: <deletedId> })` → throws `EntityNotActiveError` with `statusCode 410`. Same against `workflowRunService` start-path and `subaccountAgentService` routing assignment.

**Schema + auth lifecycle tests**
- [ ] `EXPLAIN SELECT * FROM agent_triggers WHERE organisation_id = ?` → uses `idx_agent_triggers_org`.
- [ ] Insert `processes` without `organisation_id` → `23502 not_null_violation`.
- [ ] Migration 0282 against a DB seeded with one `processes` row whose `organisation_id IS NULL` → migration aborts with the `RAISE EXCEPTION` text "manual backfill required"; constraint NOT applied; rollback clean.
- [ ] OAuth nonce older than 5 minutes → rejected.
- [ ] Issue JWT, change password, retry with old JWT → 401 `token_revoked`.
- [ ] 11 signups from same IP + 11 different emails → all allowed; 11 signups from same (IP, email) → 11th returns 429.
- [ ] 11 logins on the short bucket → 11th returns 429 with `reason='short_window'`.
- [ ] 51 logins on the long bucket (spread out) → 51st returns 429 with `reason='long_window'`.

**Customer-correctness tests**
- [ ] Run that pauses + resumes → `agent_runs.thread_context_version` matches across both, system prompt re-injected with the same snapshot version.
- [ ] Run that pauses, snapshot row for the pinned version is deleted, run resumes → `buildSystemPrompt` throws `thread_context_missing_for_version` (statusCode 500); resume aborts cleanly without invoking the model.
- [ ] EmailChannelTile for agent without email channel → renders nothing.
- [ ] EmailChannelTile for agent with channel + no config → renders setup card.
- [ ] AgentMailboxPage renders `toAddresses[0] +N` correctly.
- [ ] AgentCalendarPage renders with `startsAt` / `endsAt`.
- [ ] SubaccountAgentsPage row with `workspaceIdentityStatus: 'active'` → badge, no CTA.

**Maintenance + execution-path tests**
- [ ] All three maintenance jobs run; force one org's update to throw → other orgs' work completes; failure surfaces as `job.partial_failure` audit event with the failing org named.
- [ ] Deep-recursion run at depth 10 (Phase 1 D-P0-7 pattern) — verify Phase 1 fail-fast still holds for the new `*Internal` helpers in `workflowEngineService` (the helpers run inside the same depth-guarded entry).
- [ ] Inject a UPDATE on a workflow_step_run between the dispatcher's `await` resolution and the post-await write → step status remains `invalidated`, no result row written.
- [ ] Inject a UPDATE on a workflow_step_run between the dispatcher's pre-call read and the external call → external call NEVER fires (assert via mock external client received zero invocations); step status remains `invalidated`.
- [ ] Multi-webhook resolution → `automation_composition_invalid` returned.
- [ ] Missing required connection → `automation_missing_connection` returned, no provider call.
- [ ] Failed run via normal terminal path with non-null `errorMessage` → `extractRunInsights` invoked with the threaded value.
- [ ] `computeRunResultStatus(completed, false, false)` → `success` (decoupled from summary).
- [ ] Skill handler return shapes uniformly flat-string (CI grep gate green).
- [ ] Login flow: a request with `email = "  TEST@EXAMPLE.com  "` and a request with `email = "test@example.com"` share the same rate-limit bucket (asserted by exhausting the short-window via one casing then verifying the other casing also receives 429).

**Idempotency replay tests** (Phase 1 pattern; Phase 2 surfaces only)
- [ ] Replay a `recordSecurityEvent` call twice → two events recorded (intentional non-idempotent — events are observations).
- [ ] Replay a Slack webhook 5xx twice with the same payload → exactly one `system_incidents` row (key-based via `fingerprintOverride`).
- [ ] Replay an OAuth callback with `pending_run_id` twice → first enqueues resume, second returns 400 `invalid_or_expired_state` (nonce consumed).

**Multi-node simulation (lightweight)**
- [ ] Two concurrent maintenance-job invocations of `ruleAutoDeprecateJob` → exactly one acquires the advisory lock; the other returns `{ orgsProcessed: 0 }` without writing.
- [ ] Two concurrent token-refresh attempts with the same refresh token → first rotates, second is rejected with `auth.token_replay` audit event and revokes the token chain.

**Smoke test (on staging)**
- [ ] Full onboarding flow from Phase 1 + new audit emissions visible in `security_audit_events`.
- [ ] Operator triggers an intentional render error in the app surface → ErrorBoundary catches, POSTs to `/api/client-errors`, server logs the structured event.
- [ ] Force a 5xx on `slackWebhookHandler` → `system_incidents` row appears within seconds.

---

## 11. Executor notes

- **Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**
- Each chunk's "Verification commands" section lists ONLY lint, typecheck, build:server/client (when relevant), and targeted unit tests for that chunk. CI runs the full gate suite as a pre-merge gate.
- Every chunk's commit message follows the Phase 1 convention: lower-case scope, items list in the message body, mention of the source IDs.
- After a chunk lands, run `pr-reviewer` against just that chunk's diff. After all chunks land, run `pr-reviewer` + `adversarial-reviewer` + `chatgpt-pr-review` against the cumulative branch diff per the Phase 1 review pipeline.
- Migration numbers (0281, 0282, 0283) are operator-locked per § 12 decision 6 — confirm next-free integer at build start in case F3 sub-stream B has already merged with its renumbered 0280-0282 reservation.
- Chunk 5 references several deferred items from "agent-as-employee" review (D7-D11, D14, D15). Verify their current open/closed state before implementing — apply the spec-authoring-checklist § 0 verification pass for each cited item.
- The `c4a-6-RETSHAPE` grandfather decision is operator-locked per § 12 decision 4. Do not migrate to the nested envelope in Phase 2.
- Audit emission for the soft-delete sweep (Chunk 3 Tier B `data.scope_drift_detected` events) is operator-locked per § 12 decision 5 — ships for the rollout window only; Phase 3 cleanup removes if no signal materialises.

---

## 12. What comes next

After Phase 2 exit gate passes, write the **Phase 3 plan** using consolidated spec § 6.4 (the few remaining P2 items + post-Phase-2 cleanup). Phase 3 runs on `claude/pre-launch-phase-3`. Expected scope (~7 P2 items):

- Soft-delete `data.scope_drift_detected` audit emission removal (Chunk 3 follow-up if no signal observed).
- C4a-6-RETSHAPE migration to nested envelope IF a UI consumer landed during Phase 2 that requires the structured shape (otherwise stay grandfathered).
- DR2 — Conversation follow-ups re-invoke fast-path/Orchestrator (architectural decision required first).
- DR3 — `BriefApprovalCard` approve/reject buttons end-to-end (Phase 1 stubbed; Phase 3 wires the conversation-follow-up path that makes them meaningful).
- C4a-REVIEWED-DISP — review-gated `invoke_automation` post-approval resume path (depends on the C4a state machine work in Chunk 6 landing first).
- Per-row-tx+lock throughput optimisation on `intervention_outcomes` (CHATGPT-PR203-R2 — own spec).
- Cross-job `JobResult` union type (CHATGPT-PR203-BONUS — own spec).

Phase 3 P2 items are deferrable to immediately post-launch if calendar pressure forces a cut.

---

## Deferred Items

- **Refresh-token rotation only if `refresh_tokens` table is missing at build time.** Chunk 4 Task 4.3 verifies the table exists; if absent the executor escalates (operator-locked decision assumed it exists). `password_changed_at` revocation always ships in 4.4 as defence-in-depth.
- **Soft-delete unique-index audit beyond ≤ 3 violations.** Chunk 7 Task 7.15 ships fixes for ≤ 3 violations; > 3 becomes its own Phase 3 chunk.
- **`taskService` module-level `db` migration across remaining call sites.** Chunk 3 ships `taskService.createTask` and `taskActivities` insert via `getOrgScopedDb`. Other taskService methods that still use module-level `db` are deferred to a wider service-layer migration spec.
- **C4a-6-RETSHAPE migration to nested envelope.** Operator-locked grandfather decision (§ 12.4). Migration deferred to Phase 3 only if a UI consumer requires the structured shape.
- **Per-row-tx+lock throughput optimisation (CHATGPT-PR203-R2).** Own spec, own PR — out of scope for Phase 2 (per mini-spec § "Explicitly out of scope").
- **Cross-job `JobResult` union (CHATGPT-PR203-BONUS).** Same.
- **DR2 (conversation follow-ups re-invoke fast-path).** Architectural decision required first; deferred to Phase 3.
- **AGENT-RUNS-SPLIT.** Reviewer said don't preempt; revisit on trigger.
- **All RILEY-* / HD-* feature extensions.** Out of scope per mini-spec.
- **Long-term observability (LAEL-P2, LAEL-P3, METRICS-PANEL/BADGES, TELEMETRY-SINK, INC-SLA, HD-VIOL-SAMPLING).** Out of scope per mini-spec.

---

## Decisions locked in (operator-approved 2026-05-05)

These were surfaced as HITL decisions in the architect draft. Operator approved every recommendation as written. Each is now binding on the executor; the per-task notes throughout the plan reference the decision number below.

1. **Refresh-token model (Chunk 4 Task 4.3).** DB-backed refresh tokens + stateless access JWT. Ship migration 0283 with rotation columns. Build-time verification step in Task 4.3 confirms `refresh_tokens` table exists; if absent the executor escalates rather than silently falling back. `password_changed_at` revocation (Task 4.4) ships in parallel as defence-in-depth.
2. **Login rate-limit dual-bucket sizing (Chunk 4 Task 4.6).** Short bucket 10/60s, long bucket 50/3600s. Tightening reserved for post-launch when real auth-failure rates are visible.
3. **Security audit table (Chunk 2 Task 2.1).** Dedicated `security_audit_events` table. `audit_events` already carries unrelated event categories; a smaller heap keeps security queries fast.
4. **C4a-6-RETSHAPE (Chunk 6 Task 6b.7).** Grandfather the flat-string error pattern across all skill handlers. No UI consumer for the nested envelope ships in Phase 2; migration to `{code, message, context}` is deferred to Phase 3 conditional on a UI consumer needing it.
5. **Soft-delete `data.scope_drift_detected` audit emission (Chunk 3 Tier B).** Ships for the rollout window only. Phase 3 cleanup removes the emission if no signal materialises.
6. **Migration numbering ceiling (Pre-flight).** Claim 0281+ for Phase 2. F3 sub-stream B reserved 0280-0282 (post-Phase-1 renumber); if F3 has merged before Phase 2 starts, claim the next free integer above F3's last migration.


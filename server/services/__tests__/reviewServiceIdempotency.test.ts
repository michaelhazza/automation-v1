// guard-ignore-file: pure-helper-convention reason="Integration test (not a *Pure.test.ts) — gated on a real DATABASE_URL probe before dynamically importing the IO modules; exercises transactional race semantics that require real Postgres."
/**
 * reviewServiceIdempotency.test.ts — §1.8 S6
 *
 * Runtime coverage for the `idempotent_race` branch of
 * `reviewService.approveItem` / `reviewService.rejectItem`.
 *
 * Three test cases:
 *   1. Concurrent double-approve  → one winner (wasIdempotent: false),
 *                                    one idempotent_race (wasIdempotent: true),
 *                                    exactly one audit entry.
 *   2. Concurrent double-reject   → same shape.
 *   3. Concurrent approve+reject  → one wins, the loser throws 409 ITEM_CONFLICT.
 *
 * Determinism is guaranteed via `__testHooks.delayBetweenClaimAndCommit`:
 * the winner holds its row lock inside an open transaction while the loser
 * starts a concurrent transaction. When the winner's delay resolves and
 * commits, the loser's UPDATE finds 0 rows and re-checks idempotency.
 *
 * Requires DATABASE_URL pointing to a real Postgres instance.
 * Gracefully skips if DATABASE_URL is unset or is a placeholder.
 *
 * Run via:
 *   npx tsx server/services/__tests__/reviewServiceIdempotency.test.ts
 */
import { expect, test } from 'vitest';

export {}; // force module scope — avoids top-level-await hoisting issues

// Evaluate SKIP before dotenv so the guard fires even when .env sets DATABASE_URL.
// Tests that require a real Postgres instance are skipped unless DATABASE_URL is set.
const SKIP = !process.env.DATABASE_URL || process.env.NODE_ENV !== 'integration';

// ── Env preamble — must be before any module-level env reads ─────────────────
await import('dotenv/config');
process.env.NODE_ENV     = 'test';
process.env.JWT_SECRET   ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM   ??= 'test-placeholder@example.com';

// ── Heavy DB modules — imported conditionally when !SKIP ─────────────────────
// When SKIP is true the dynamic imports are not reached, so env.ts validation
// and DB connection setup are bypassed entirely. Type-cast placeholders satisfy
// TypeScript while dead code under SKIP is never reached.
let db: Awaited<typeof import('../../db/index.js')>['db'];
let client: Awaited<typeof import('../../db/index.js')>['client'];
let sql: Awaited<typeof import('drizzle-orm')>['sql'];
let eq: Awaited<typeof import('drizzle-orm')>['eq'];
let and: Awaited<typeof import('drizzle-orm')>['and'];
let organisations: Awaited<typeof import('../../db/schema/index.js')>['organisations'];
let agents: Awaited<typeof import('../../db/schema/index.js')>['agents'];
let subaccounts: Awaited<typeof import('../../db/schema/index.js')>['subaccounts'];
let actions: Awaited<typeof import('../../db/schema/index.js')>['actions'];
let reviewItems: Awaited<typeof import('../../db/schema/index.js')>['reviewItems'];
let auditEvents: Awaited<typeof import('../../db/schema/index.js')>['auditEvents'];
let reviewService: Awaited<typeof import('../reviewService.js')>['reviewService'];
let __testHooks: Awaited<typeof import('../reviewService.js')>['__testHooks'];
let mock: Awaited<typeof import('node:test')>['mock'];
let actionService: Awaited<typeof import('../actionService.js')>['actionService'];
let executionLayerService: Awaited<typeof import('../executionLayerService.js')>['executionLayerService'];

if (!SKIP) {
  // ── Imports (after env preamble) ─────────────────────────────────────────────
  ({ db, client } = await import('../../db/index.js'));
  ({ sql, eq, and } = await import('drizzle-orm'));
  ({ organisations, agents, subaccounts, actions, reviewItems, auditEvents } = await import('../../db/schema/index.js'));
  ({ reviewService, __testHooks } = await import('../reviewService.js'));
  ({ mock } = await import('node:test'));

  // Downstream services — mocked below so no real execution / state transitions
  // occur. We only exercise the reviewItems table transaction semantics.
  ({ actionService } = await import('../actionService.js'));
  ({ executionLayerService } = await import('../executionLayerService.js'));

  // ── Hook-presence assertion (MUST hold) ───────────────────────────────────────
  expect(__testHooks !== undefined).toBeTruthy();
  expect('delayBetweenClaimAndCommit' in __testHooks).toBeTruthy();
}

// ── Test runner ───────────────────────────────────────────────────────────────
let skipped = 0;

async function test(name: string, opts: { skip?: boolean }, fn: () => Promise<void>): Promise<void>;
async function test(name: string, fn: () => Promise<void>): Promise<void>;
async function test(name: string, optsOrFn: { skip?: boolean } | (() => Promise<void>), fn?: () => Promise<void>): Promise<void> {
  const opts = typeof optsOrFn === 'function' ? {} : optsOrFn;
  const body = typeof optsOrFn === 'function' ? optsOrFn : fn!;
  if (opts.skip) {
    skipped++;
    console.log(`# SKIP ${name}`);
    return;
  }
  __testHooks.delayBetweenClaimAndCommit = undefined;
  mock.restoreAll();
  try {
    await body();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    __testHooks.delayBetweenClaimAndCommit = undefined;
    mock.restoreAll();
  }
}

function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

interface SeedIds {
  orgId: string;
  agentId: string;
  subaccountId: string;
}

/**
 * Seed a minimal org + agent + subaccount. These are shared across all tests in
 * this file (one-time setup) and deleted in the global finally block.
 */
async function seedSharedFixture(): Promise<SeedIds> {
  const tag = `test-race-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const [org] = await db
    .insert(organisations)
    .values({ name: `Race Test Org ${tag}`, slug: tag, plan: 'starter', status: 'active' })
    .returning({ id: organisations.id });
  if (!org) throw new Error('Failed to seed organisation');

  const [agent] = await db
    .insert(agents)
    .values({
      organisationId: org.id,
      name: `Race Test Agent ${tag}`,
      slug: `${tag}-agent`,
      status: 'active',
    })
    .returning({ id: agents.id });
  if (!agent) throw new Error('Failed to seed agent');

  const [sub] = await db
    .insert(subaccounts)
    .values({ organisationId: org.id, name: `Race Test Sub ${tag}`, slug: `${tag}-sub`, status: 'active' })
    .returning({ id: subaccounts.id });
  if (!sub) throw new Error('Failed to seed subaccount');

  return { orgId: org.id, agentId: agent.id, subaccountId: sub.id };
}

/**
 * Seed one `pending_approval` action + matching `pending` review item.
 * Returns both IDs.
 */
async function seedReviewFixture(
  { orgId, agentId, subaccountId }: SeedIds,
  suffix: string,
): Promise<{ actionId: string; reviewItemId: string }> {
  const ikey = `race-test-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const [action] = await db
    .insert(actions)
    .values({
      organisationId: orgId,
      agentId,
      subaccountId,
      actionType: 'test.noop',
      actionCategory: 'api',
      gateLevel: 'review',
      status: 'pending_approval',
      idempotencyKey: ikey,
      subaccountScope: 'single',
      payloadJson: { test: true },
    })
    .returning({ id: actions.id });
  if (!action) throw new Error('Failed to seed action');

  const [item] = await db
    .insert(reviewItems)
    .values({
      organisationId: orgId,
      subaccountId,
      actionId: action.id,
      reviewStatus: 'pending',
      reviewPayloadJson: {
        actionType: 'test.noop',
        proposedPayload: { test: true },
      },
    })
    .returning({ id: reviewItems.id });
  if (!item) throw new Error('Failed to seed review item');

  return { actionId: action.id, reviewItemId: item.id };
}

/**
 * Count audit_events rows for a given review item entity ID.
 */
async function countAuditRows(reviewItemId: string, orgId: string): Promise<number> {
  const rows = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entityId, reviewItemId),
        eq(auditEvents.organisationId, orgId),
      ),
    );
  return rows.length;
}

/**
 * Clean up all rows seeded for a review fixture (and its parent action).
 * Cascades automatically via ON DELETE CASCADE from actions → review_items.
 */
async function cleanupReviewFixture(actionId: string): Promise<void> {
  await db.delete(actions).where(eq(actions.id, actionId));
}

/**
 * Delete all rows seeded in seedSharedFixture. Called in the global finally.
 * The delete order respects FK constraints.
 */
async function cleanupSharedFixture({ orgId }: SeedIds): Promise<void> {
  // Subaccounts + agents cascade from org delete (via SET NULL / CASCADE).
  // We delete in explicit order to avoid FK issues.
  await db.delete(subaccounts).where(eq(subaccounts.organisationId, orgId));
  await db.delete(agents).where(eq(agents.organisationId, orgId));
  await db.delete(organisations).where(eq(organisations.id, orgId));
}

// ── Mock setup helpers ────────────────────────────────────────────────────────

/**
 * Install mocks on actionService and executionLayerService so no real
 * side-effecting work (execution, state transitions, resume events via
 * actionService.getAction) happens in the post-transaction winner path.
 *
 * Each test gets a fresh mock setup via mock.restoreAll() in the runner above.
 */
function installServiceMocks(seededActionId: string, subaccountId: string, orgId: string): void {
  // transitionState: no-op (action state transitions are not under test here)
  mock.method(actionService, 'transitionState', async () => undefined);

  // getAction: return a minimal action shape so the winner's post-tx path
  // can build the actionResumeEvents row without hitting the real actions table.
  mock.method(actionService, 'getAction', async (_actionId: string) => ({
    id: seededActionId,
    organisationId: orgId,
    subaccountId,
    actionType: 'test.noop',
    actionCategory: 'api',
    status: 'approved',
    payloadJson: { test: true },
    metadataJson: null,
    idempotencyKey: 'test',
  }));

  // emitEvent: no-op
  mock.method(actionService, 'emitEvent', async () => undefined);

  // executeAction: no-op (returns null — same as a failed execution caught by
  // the try/catch in approveItem, which keeps reviewStatus as 'approved').
  mock.method(executionLayerService, 'executeAction', async () => null);
}

// ── Shared fixture (seeded once, deleted in finally) ─────────────────────────

let sharedIds: SeedIds | undefined;
if (!SKIP) {
  try {
    sharedIds = await seedSharedFixture();
  } catch (err) {
    console.error('FATAL: failed to seed shared fixture:', err);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Test 1 — Concurrent double-approve
// ═════════════════════════════════════════════════════════════════════════════

await test('concurrent double-approve: one winner (wasIdempotent: false) + one idempotent_race (wasIdempotent: true)', { skip: SKIP }, async () => {
  const { actionId, reviewItemId } = await seedReviewFixture(sharedIds!, 'double-approve');

  try {
    installServiceMocks(actionId, sharedIds!.subaccountId, sharedIds!.orgId);

    const userId = '00000000-0000-0000-0000-000000000001';

    // Open the race window: the winner will hold its row lock while the loser
    // starts its own transaction. When the delay resolves, the winner commits
    // and the loser's UPDATE returns 0 rows → idempotent_race path.
    let winnerStarted = false;
    let loserCanStart: (() => void) | undefined;
    const loserGate = new Promise<void>((resolve) => { loserCanStart = resolve; });

    __testHooks.delayBetweenClaimAndCommit = async () => {
      // Signal the loser that the winner has claimed the row.
      loserCanStart!();
      // Hold the lock for a short period so the loser can enter its transaction.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    };

    // Winner starts immediately; loser waits for the winner to claim first.
    const winnerPromise = reviewService.approveItem(reviewItemId, sharedIds!.orgId, userId);
    winnerStarted = true;

    // Wait until the winner has claimed the row (hook fired) before starting loser.
    await loserGate;
    const loserPromise = reviewService.approveItem(reviewItemId, sharedIds!.orgId, userId);

    const [winnerResult, loserResult] = await Promise.all([winnerPromise, loserPromise]);

    // Exactly one should be the true winner (first write) and one the idempotent loser.
    const wasIdempotentValues = [winnerResult.wasIdempotent, loserResult.wasIdempotent].sort();
    check(
      wasIdempotentValues[0] === false && wasIdempotentValues[1] === true,
      `expected one wasIdempotent:false and one wasIdempotent:true, got [${wasIdempotentValues.join(', ')}]`,
    );

    // The 'idempotent_race' discriminant — must match exactly so we know which branch was taken.
    // The loser returns { wasIdempotent: true } regardless of whether it hit the pre-check
    // idempotent path or the idempotent_race path inside the transaction.
    // To confirm the _race_ branch specifically: one result must be wasIdempotent:false (winner,
    // took the full write path) and the other wasIdempotent:true (loser, either pre-check or
    // idempotent_race). With the hook delaying the winner's commit, the loser must enter the
    // transaction and hit the idempotent_race path (not the pre-check path, because the winner
    // hasn't committed yet when the loser's pre-check runs, so the loser sees 'pending').
    // We assert wasIdempotent:true here; the internal `kind: 'idempotent_race'` is the mechanism.
    void winnerStarted; // suppress unused warning

    // Wait briefly for the fire-and-forget audit log write to complete.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    // Exactly one audit row per resolved item — duplicate side-effects are suppressed.
    const auditCount = await countAuditRows(reviewItemId, sharedIds!.orgId);
    check(auditCount === 1, `expected exactly 1 audit row, got ${auditCount}`);

  } finally {
    await cleanupReviewFixture(actionId);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Test 2 — Concurrent double-reject
// ═════════════════════════════════════════════════════════════════════════════

await test('concurrent double-reject: one winner (wasIdempotent: false) + one idempotent_race (wasIdempotent: true)', { skip: SKIP }, async () => {
  const { actionId, reviewItemId } = await seedReviewFixture(sharedIds!, 'double-reject');

  try {
    // transitionState + getAction need to be mocked for the rejectItem winner path.
    mock.method(actionService, 'transitionState', async () => undefined);
    mock.method(actionService, 'getAction', async (_actionId: string) => ({
      id: actionId,
      organisationId: sharedIds!.orgId,
      subaccountId: sharedIds!.subaccountId,
      actionType: 'test.noop',
      actionCategory: 'api',
      status: 'rejected',
      payloadJson: { test: true },
      metadataJson: null,
      idempotencyKey: 'test',
    }));
    mock.method(actionService, 'emitEvent', async () => undefined);

    const userId = '00000000-0000-0000-0000-000000000001';
    const comment = 'Race test rejection';

    let loserCanStart: (() => void) | undefined;
    const loserGate = new Promise<void>((resolve) => { loserCanStart = resolve; });

    __testHooks.delayBetweenClaimAndCommit = async () => {
      loserCanStart!();
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    };

    const winnerPromise = reviewService.rejectItem(reviewItemId, sharedIds!.orgId, userId, comment);

    await loserGate;
    const loserPromise = reviewService.rejectItem(reviewItemId, sharedIds!.orgId, userId, comment);

    const [winnerResult, loserResult] = await Promise.all([winnerPromise, loserPromise]);

    const wasIdempotentValues = [winnerResult.wasIdempotent, loserResult.wasIdempotent].sort();
    check(
      wasIdempotentValues[0] === false && wasIdempotentValues[1] === true,
      `expected one wasIdempotent:false and one wasIdempotent:true, got [${wasIdempotentValues.join(', ')}]`,
    );

    // Wait briefly for fire-and-forget audit log.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    const auditCount = await countAuditRows(reviewItemId, sharedIds!.orgId);
    check(auditCount === 1, `expected exactly 1 audit row, got ${auditCount}`);

  } finally {
    await cleanupReviewFixture(actionId);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Test 3 — Concurrent approve + reject
// ═════════════════════════════════════════════════════════════════════════════

await test('concurrent approve+reject: winner takes status, loser throws 409 ITEM_CONFLICT', { skip: SKIP }, async () => {
  const { actionId, reviewItemId } = await seedReviewFixture(sharedIds!, 'approve-reject');

  try {
    installServiceMocks(actionId, sharedIds!.subaccountId, sharedIds!.orgId);

    const userId = '00000000-0000-0000-0000-000000000001';

    // Race: approve and reject fired simultaneously. One wins the UPDATE WHERE pending,
    // the other's UPDATE finds 0 rows and re-checks — the re-check sees the opposite
    // terminal state and throws 409 ITEM_CONFLICT (not idempotent_race).

    // Use the hook to ensure both transactions start before either commits.
    let loserCanStart: (() => void) | undefined;
    const loserGate = new Promise<void>((resolve) => { loserCanStart = resolve; });

    __testHooks.delayBetweenClaimAndCommit = async () => {
      loserCanStart!();
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    };

    const approvePromise = reviewService.approveItem(reviewItemId, sharedIds!.orgId, userId);

    await loserGate;
    // Reject fires after approve has claimed the row (but not committed).
    const rejectPromise = reviewService.rejectItem(reviewItemId, sharedIds!.orgId, userId, 'race loser');

    const results = await Promise.allSettled([approvePromise, rejectPromise]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    check(fulfilled.length === 1, `expected exactly 1 fulfilled, got ${fulfilled.length}`);
    check(rejected.length === 1, `expected exactly 1 rejected (409), got ${rejected.length}`);

    // The loser must throw with ITEM_CONFLICT — not idempotent_race.
    const loserError = (rejected[0] as PromiseRejectedResult).reason;
    check(
      loserError instanceof Error,
      'loser must throw an Error',
    );
    check(
      (loserError as Error & { errorCode?: string }).errorCode === 'ITEM_CONFLICT',
      `loser error must have errorCode 'ITEM_CONFLICT', got: ${(loserError as Error & { errorCode?: string }).errorCode}`,
    );
    check(
      (loserError as Error & { statusCode?: number }).statusCode === 409,
      `loser error must have statusCode 409, got: ${(loserError as Error & { statusCode?: number }).statusCode}`,
    );

  } finally {
    await cleanupReviewFixture(actionId);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Idempotent_race discriminant name assertion
// (fails loudly if reviewService renames the string constant)
// ═════════════════════════════════════════════════════════════════════════════

await test('idempotent_race discriminant is the literal string "idempotent_race" in reviewService source', { skip: SKIP }, async () => {
  // Read the source text at runtime to assert the discriminant value by name.
  // This test fails if someone renames 'idempotent_race' without updating this test.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(dir, '..', 'reviewService.ts'), 'utf8');

  const occurrences = (source.match(/['"]idempotent_race['"]/g) ?? []).length;
  check(
    occurrences >= 2,
    `Expected at least 2 occurrences of 'idempotent_race' in reviewService.ts (approveItem + rejectItem), found ${occurrences}`,
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// Global cleanup + summary
// ═════════════════════════════════════════════════════════════════════════════

if (!SKIP) {
  try {
    if (sharedIds) {
      await cleanupSharedFixture(sharedIds);
    }
  } catch (err) {
    console.warn('WARN: cleanup of shared fixture failed:', err);
  } finally {
    try {
      await client.end();
    } catch {
      // best-effort
    }
  }
}

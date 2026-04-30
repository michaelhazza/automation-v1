// guard-ignore-file: pure-helper-convention reason="Integration test — gated on a real DATABASE_URL probe before dynamically importing the IO modules; exercises transactional race semantics that require real Postgres."
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
 * Skips gracefully without DATABASE_URL or NODE_ENV !== 'integration'.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const SKIP = !process.env.DATABASE_URL || process.env.NODE_ENV !== 'integration';

interface SeedIds {
  orgId: string;
  agentId: string;
  subaccountId: string;
}

describe.skipIf(SKIP)('reviewService idempotent_race branch', () => {
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

  let sharedIds: SeedIds;

  beforeAll(async () => {
    ({ db, client } = await import('../../db/index.js'));
    ({ sql, eq, and } = await import('drizzle-orm'));
    ({ organisations, agents, subaccounts, actions, reviewItems, auditEvents } = await import('../../db/schema/index.js'));
    ({ reviewService, __testHooks } = await import('../reviewService.js'));
    ({ mock } = await import('node:test'));
    ({ actionService } = await import('../actionService.js'));
    ({ executionLayerService } = await import('../executionLayerService.js'));

    expect(__testHooks).toBeDefined();
    expect('delayBetweenClaimAndCommit' in __testHooks).toBeTruthy();

    sharedIds = await seedSharedFixture();
  });

  afterAll(async () => {
    try {
      if (sharedIds) {
        await cleanupSharedFixture(sharedIds);
      }
    } finally {
      if (client) {
        await client.end();
      }
    }
  });

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

  async function seedReviewFixture(
    ids: SeedIds,
    suffix: string,
  ): Promise<{ actionId: string; reviewItemId: string }> {
    const ikey = `race-test-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const [action] = await db
      .insert(actions)
      .values({
        organisationId: ids.orgId,
        agentId: ids.agentId,
        subaccountId: ids.subaccountId,
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
        organisationId: ids.orgId,
        subaccountId: ids.subaccountId,
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

  async function cleanupReviewFixture(actionId: string): Promise<void> {
    await db.delete(actions).where(eq(actions.id, actionId));
  }

  async function cleanupSharedFixture(ids: SeedIds): Promise<void> {
    await db.delete(subaccounts).where(eq(subaccounts.organisationId, ids.orgId));
    await db.delete(agents).where(eq(agents.organisationId, ids.orgId));
    await db.delete(organisations).where(eq(organisations.id, ids.orgId));
  }

  function installServiceMocks(seededActionId: string, subaccountId: string, orgId: string): void {
    mock.method(actionService, 'transitionState', async () => undefined);
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
    mock.method(actionService, 'emitEvent', async () => undefined);
    mock.method(executionLayerService, 'executeAction', async () => null);
  }

  test('concurrent double-approve: one winner (wasIdempotent: false) + one idempotent_race (wasIdempotent: true)', async () => {
    const { actionId, reviewItemId } = await seedReviewFixture(sharedIds, 'double-approve');

    try {
      installServiceMocks(actionId, sharedIds.subaccountId, sharedIds.orgId);

      const userId = '00000000-0000-0000-0000-000000000001';

      let loserCanStart: (() => void) | undefined;
      const loserGate = new Promise<void>((resolve) => { loserCanStart = resolve; });

      __testHooks.delayBetweenClaimAndCommit = async () => {
        loserCanStart!();
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      };

      const winnerPromise = reviewService.approveItem(reviewItemId, sharedIds.orgId, userId);

      await loserGate;
      const loserPromise = reviewService.approveItem(reviewItemId, sharedIds.orgId, userId);

      const [winnerResult, loserResult] = await Promise.all([winnerPromise, loserPromise]);

      const wasIdempotentValues = [winnerResult.wasIdempotent, loserResult.wasIdempotent].sort();
      expect(wasIdempotentValues[0]).toBe(false);
      expect(wasIdempotentValues[1]).toBe(true);

      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const auditCount = await countAuditRows(reviewItemId, sharedIds.orgId);
      expect(auditCount).toBe(1);
    } finally {
      await cleanupReviewFixture(actionId);
    }
  });

  test('concurrent double-reject: one winner (wasIdempotent: false) + one idempotent_race (wasIdempotent: true)', async () => {
    const { actionId, reviewItemId } = await seedReviewFixture(sharedIds, 'double-reject');

    try {
      mock.method(actionService, 'transitionState', async () => undefined);
      mock.method(actionService, 'getAction', async (_actionId: string) => ({
        id: actionId,
        organisationId: sharedIds.orgId,
        subaccountId: sharedIds.subaccountId,
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

      const winnerPromise = reviewService.rejectItem(reviewItemId, sharedIds.orgId, userId, comment);

      await loserGate;
      const loserPromise = reviewService.rejectItem(reviewItemId, sharedIds.orgId, userId, comment);

      const [winnerResult, loserResult] = await Promise.all([winnerPromise, loserPromise]);

      const wasIdempotentValues = [winnerResult.wasIdempotent, loserResult.wasIdempotent].sort();
      expect(wasIdempotentValues[0]).toBe(false);
      expect(wasIdempotentValues[1]).toBe(true);

      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const auditCount = await countAuditRows(reviewItemId, sharedIds.orgId);
      expect(auditCount).toBe(1);
    } finally {
      await cleanupReviewFixture(actionId);
    }
  });

  test('concurrent approve+reject: winner takes status, loser throws 409 ITEM_CONFLICT', async () => {
    const { actionId, reviewItemId } = await seedReviewFixture(sharedIds, 'approve-reject');

    try {
      installServiceMocks(actionId, sharedIds.subaccountId, sharedIds.orgId);

      const userId = '00000000-0000-0000-0000-000000000001';

      let loserCanStart: (() => void) | undefined;
      const loserGate = new Promise<void>((resolve) => { loserCanStart = resolve; });

      __testHooks.delayBetweenClaimAndCommit = async () => {
        loserCanStart!();
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      };

      const approvePromise = reviewService.approveItem(reviewItemId, sharedIds.orgId, userId);

      await loserGate;
      const rejectPromise = reviewService.rejectItem(reviewItemId, sharedIds.orgId, userId, 'race loser');

      const results = await Promise.allSettled([approvePromise, rejectPromise]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const loserError = (rejected[0] as PromiseRejectedResult).reason;
      expect(loserError instanceof Error).toBe(true);
      expect((loserError as Error & { errorCode?: string }).errorCode).toBe('ITEM_CONFLICT');
      expect((loserError as Error & { statusCode?: number }).statusCode).toBe(409);
    } finally {
      await cleanupReviewFixture(actionId);
    }
  });

  test('idempotent_race discriminant is the literal string "idempotent_race" in reviewService source', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(dir, '..', 'reviewService.ts'), 'utf8');

    const occurrences = (source.match(/['"]idempotent_race['"]/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

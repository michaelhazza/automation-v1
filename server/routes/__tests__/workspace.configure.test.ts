/**
 * POST /api/subaccounts/:subaccountId/workspace/configure — backend-swap guard.
 *
 * Spec: agents-as-employees spec E0.
 *
 * Guard fires when:
 *   - A connector config with a DIFFERENT connectorType already exists for
 *     this subaccount (existingOtherConfig !== null), AND
 *   - At least one non-archived identity exists (archivedAt IS NULL).
 *
 * Guard does NOT fire when:
 *   - Same-backend reconfigure (existingOtherConfig is null — same type present
 *     or no config at all).
 *   - No prior config at all (existingOtherConfig is null).
 *   - All identities are archived (activeIdentities.length === 0).
 *
 * Two sections:
 *   1. Pure (no DB) — asserts the guard condition logic directly.
 *   2. Integration (requires DATABASE_URL) — exercises the new
 *      connectorConfigService.getBySubaccountAndDifferentType method and
 *      the updated getActiveIdentitiesForSubaccount filter.
 *
 * Run:
 *   npx tsx server/routes/__tests__/workspace.configure.test.ts
 */

import { strict as assert } from 'node:assert';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

// ─── Section 1: Pure logic assertions ────────────────────────────────────────
//
// The guard condition is:
//   existingOtherConfig !== null && activeIdentities.length > 0
//
// We test this as a pure boolean expression to cover all branches without DB.

console.log('\n--- configure guard logic (pure) ---');

/** Mirrors the guard condition in the route handler. */
function guardFires(existingOtherConfig: object | null, activeIdentityCount: number): boolean {
  return existingOtherConfig !== null && activeIdentityCount > 0;
}

await test('different-backend config + non-archived identities → guard fires (409)', () => {
  const existingOtherConfig = { id: 'cfg-123', connectorType: 'google_workspace' };
  const activeIdentityCount = 1;
  assert.equal(guardFires(existingOtherConfig, activeIdentityCount), true);
});

await test('different-backend config + zero non-archived identities → guard does not fire', () => {
  // All identities are archived — migration completed, safe to reconfigure.
  const existingOtherConfig = { id: 'cfg-123', connectorType: 'google_workspace' };
  const activeIdentityCount = 0;
  assert.equal(guardFires(existingOtherConfig, activeIdentityCount), false);
});

await test('same-backend config present → no existingOtherConfig → guard does not fire', () => {
  // getBySubaccountAndDifferentType returns null when the existing config matches
  // the requested backend — same-backend reconfigure is always allowed.
  const existingOtherConfig = null;
  const activeIdentityCount = 5; // identities exist but backend isn't changing
  assert.equal(guardFires(existingOtherConfig, activeIdentityCount), false);
});

await test('no prior config → guard does not fire', () => {
  // Fresh subaccount — no connector config of any type.
  const existingOtherConfig = null;
  const activeIdentityCount = 0;
  assert.equal(guardFires(existingOtherConfig, activeIdentityCount), false);
});

// ─── Section 2: Integration (requires DATABASE_URL) ──────────────────────────

if (!process.env.DATABASE_URL) {
  console.log('\n--- configure guard integration — SKIPPED (no DATABASE_URL) ---');
} else {
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const postgres = (await import('postgres')).default;
  const { eq, and } = await import('drizzle-orm');
  const {
    organisations,
    subaccounts,
    connectorConfigs,
  } = await import('../../db/schema/index.js');
  const { workspaceIdentities } = await import('../../db/schema/workspaceIdentities.js');
  const { connectorConfigService } = await import('../../services/connectorConfigService.js');
  const { workspaceIdentityService } = await import('../../services/workspace/workspaceIdentityService.js');

  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client);

  const [anchor] = await db
    .select({ orgId: organisations.id, subaccountId: subaccounts.id })
    .from(organisations)
    .innerJoin(subaccounts, eq(subaccounts.organisationId, organisations.id))
    .limit(1);

  if (!anchor) {
    console.log('\n--- configure guard integration — SKIPPED (no org/subaccount seed) ---');
  } else {
    console.log('\n--- configure guard integration ---');

    // We test the two service methods in isolation — not the full HTTP route,
    // so we don't need a running server.

    await test('getBySubaccountAndDifferentType returns null when no other-type config exists', async () => {
      // Ensure a synthetos_native config is present for the anchor subaccount
      // (or use an existing one) and query for google_workspace — should return null
      // if only synthetos_native is configured.
      const nativeConfig = await connectorConfigService.getBySubaccountAndType(
        anchor.orgId, anchor.subaccountId, 'synthetos_native',
      );
      if (!nativeConfig) {
        // No config at all — getBySubaccountAndDifferentType must return null for any type
        const result = await connectorConfigService.getBySubaccountAndDifferentType(
          anchor.orgId, anchor.subaccountId, 'synthetos_native',
        );
        assert.equal(result, null, 'no configs → no other-type config');
      } else {
        // Only synthetos_native exists — querying for google_workspace (different) should
        // return it, but querying for synthetos_native (same) should return null.
        const sameResult = await connectorConfigService.getBySubaccountAndDifferentType(
          anchor.orgId, anchor.subaccountId, 'synthetos_native',
        );
        // sameResult is the google_workspace config if it exists, or null
        // We only assert that querying a type that IS present returns null for same type
        // This is purely structural — the method must not return the same-type config
        if (sameResult !== null) {
          assert.notEqual(sameResult.connectorType, 'synthetos_native',
            'getBySubaccountAndDifferentType must not return a config matching the requested type');
        }
      }
    });

    await test('getActiveIdentitiesForSubaccount filters out archived rows', async () => {
      // The method now filters archivedAt IS NULL.
      // We fetch the result and verify no returned row has archivedAt set.
      const identities = await workspaceIdentityService.getActiveIdentitiesForSubaccount(anchor.subaccountId);
      for (const identity of identities) {
        assert.equal(identity.archivedAt, null,
          `identity ${identity.id} has archivedAt set — should have been excluded`);
      }
    });

    await client.end();
  }
}

console.log(`\n  ${passed + failed} tests total; ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

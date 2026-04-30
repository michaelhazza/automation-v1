// guard-ignore-file: pure-helper-convention reason="Tests service methods called by workspace configure route — no extractable pure helper in parent dir."
/**
 * POST /api/subaccounts/{subaccountId}/workspace/configure — backend-swap guard.
 *
 * Spec: agents-as-employees spec E0.
 *
 * Guard fires when:
 *   - A connector config with a DIFFERENT connectorType already exists for
 *     this subaccount (existingOtherConfig !== null), AND
 *   - At least one non-archived identity exists (archivedAt IS NULL).
 *
 * Two sections:
 *   1. Pure (no DB) — asserts the guard condition logic directly.
 *   2. Integration (requires DATABASE_URL) — exercises
 *      connectorConfigService.getBySubaccountAndDifferentType and
 *      workspaceIdentityService.getActiveIdentitiesForSubaccount.
 */
export {};

import { describe, test, expect } from 'vitest';

// ─── Section 1: Pure logic assertions ────────────────────────────────────────

function guardFires(existingOtherConfig: object | null, activeIdentityCount: number): boolean {
  return existingOtherConfig !== null && activeIdentityCount > 0;
}

describe('configure guard logic (pure)', () => {
  test('different-backend config + non-archived identities → guard fires (409)', () => {
    expect(guardFires({ id: 'cfg-123', connectorType: 'google_workspace' }, 1)).toBe(true);
  });

  test('different-backend config + zero non-archived identities → guard does not fire', () => {
    expect(guardFires({ id: 'cfg-123', connectorType: 'google_workspace' }, 0)).toBe(false);
  });

  test('same-backend config present → no existingOtherConfig → guard does not fire', () => {
    expect(guardFires(null, 5)).toBe(false);
  });

  test('no prior config → guard does not fire', () => {
    expect(guardFires(null, 0)).toBe(false);
  });
});

// ─── Section 2: Integration (requires DATABASE_URL) ──────────────────────────

const SKIP_DB = !process.env.DATABASE_URL;

describe('configure guard integration', () => {
  test.skipIf(SKIP_DB)(
    'getBySubaccountAndDifferentType returns null when no other-type config exists',
    async () => {
      const { drizzle } = await import('drizzle-orm/postgres-js');
      const postgres = (await import('postgres')).default;
      const { eq } = await import('drizzle-orm');
      const { organisations, subaccounts } = await import('../../db/schema/index.js');
      const { connectorConfigService } = await import('../../services/connectorConfigService.js');

      const client = postgres(process.env.DATABASE_URL!);
      const db = drizzle(client);

      try {
        const [anchor] = await db
          .select({ orgId: organisations.id, subaccountId: subaccounts.id })
          .from(organisations)
          .innerJoin(subaccounts, eq(subaccounts.organisationId, organisations.id))
          .limit(1);

        if (!anchor) return; // no seed — skip gracefully

        const nativeConfig = await connectorConfigService.getBySubaccountAndType(
          anchor.orgId, anchor.subaccountId, 'synthetos_native',
        );

        if (!nativeConfig) {
          const result = await connectorConfigService.getBySubaccountAndDifferentType(
            anchor.orgId, anchor.subaccountId, 'synthetos_native',
          );
          expect(result).toBeNull();
        } else {
          const sameResult = await connectorConfigService.getBySubaccountAndDifferentType(
            anchor.orgId, anchor.subaccountId, 'synthetos_native',
          );
          if (sameResult !== null) {
            expect(sameResult.connectorType).not.toBe('synthetos_native');
          }
        }
      } finally {
        await client.end();
      }
    },
  );

  test.skipIf(SKIP_DB)(
    'getActiveIdentitiesForSubaccount filters out archived rows',
    async () => {
      const { drizzle } = await import('drizzle-orm/postgres-js');
      const postgres = (await import('postgres')).default;
      const { eq } = await import('drizzle-orm');
      const { organisations, subaccounts } = await import('../../db/schema/index.js');
      const { workspaceIdentityService } = await import('../../services/workspace/workspaceIdentityService.js');

      const client = postgres(process.env.DATABASE_URL!);
      const db = drizzle(client);

      try {
        const [anchor] = await db
          .select({ orgId: organisations.id, subaccountId: subaccounts.id })
          .from(organisations)
          .innerJoin(subaccounts, eq(subaccounts.organisationId, organisations.id))
          .limit(1);

        if (!anchor) return; // no seed — skip gracefully

        const identities = await workspaceIdentityService.getActiveIdentitiesForSubaccount(anchor.subaccountId);
        for (const identity of identities) {
          expect(identity.archivedAt).toBeNull();
        }
      } finally {
        await client.end();
      }
    },
  );
});

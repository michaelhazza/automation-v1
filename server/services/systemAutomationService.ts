/**
 * systemAutomationService — CRUD for system-scoped automations.
 *
 * All queries run through withAdminConnection because system automations
 * are cross-org (organisationId = null) and bypass per-org RLS.
 * This service is ONLY for system_admin routes — do NOT call from org-scoped paths.
 */

import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { withAdminConnection } from '../lib/adminDbConnection.js';
import { automations } from '../db/schema/index.js';
import type { OrgScopedTx } from '../db/index.js';

const SOURCE = 'systemAutomationService';

async function adminTx<T>(fn: (tx: OrgScopedTx) => Promise<T>): Promise<T> {
  return withAdminConnection({ source: SOURCE }, async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE admin_role`);
    return fn(tx);
  });
}

export const systemAutomationService = {
  async list() {
    return adminTx((tx) =>
      tx.select()
        .from(automations)
        .where(and(eq(automations.scope, 'system'), isNull(automations.deletedAt)))
        .orderBy(desc(automations.createdAt)),
    );
  },

  async create(data: {
    name: string;
    description?: string | null;
    webhookPath: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
    configSchema?: unknown;
    defaultConfig?: unknown;
    requiredConnections?: unknown;
    automationEngineId?: string | null;
  }) {
    return adminTx(async (tx) => {
      const [row] = await tx.insert(automations).values({
        automationEngineId: data.automationEngineId ?? null,
        name: data.name,
        description: data.description ?? null,
        webhookPath: data.webhookPath,
        inputSchema: data.inputSchema != null ? String(data.inputSchema) : null,
        outputSchema: data.outputSchema != null ? String(data.outputSchema) : null,
        configSchema: data.configSchema != null ? String(data.configSchema) : null,
        defaultConfig: (data.defaultConfig ?? null) as Record<string, unknown> | null,
        requiredConnections: (data.requiredConnections ?? null) as Array<{ key: string; provider: string; required: boolean }> | null,
        scope: 'system',
        isEditable: false,
        status: 'draft',
      }).returning();
      return row;
    });
  },

  async getById(id: string) {
    return adminTx(async (tx) => {
      const [row] = await tx.select()
        .from(automations)
        .where(and(eq(automations.id, id), eq(automations.scope, 'system'), isNull(automations.deletedAt)));
      return row ?? null;
    });
  },

  async update(id: string, updates: Record<string, unknown>) {
    return adminTx(async (tx) => {
      const [existing] = await tx.select()
        .from(automations)
        .where(and(eq(automations.id, id), eq(automations.scope, 'system'), isNull(automations.deletedAt)));
      if (!existing) return null;

      const allowed = ['name', 'description', 'webhookPath', 'inputSchema', 'outputSchema', 'configSchema', 'defaultConfig', 'requiredConnections', 'automationEngineId'] as const;
      const set: Record<string, unknown> = { updatedAt: new Date() };
      for (const key of allowed) {
        if (updates[key] !== undefined) set[key] = updates[key];
      }

      const [updated] = await tx.update(automations)
        .set(set)
        .where(eq(automations.id, id))
        .returning();
      return updated;
    });
  },

  async softDelete(id: string) {
    return adminTx(async (tx) => {
      const [existing] = await tx.select()
        .from(automations)
        .where(and(eq(automations.id, id), eq(automations.scope, 'system'), isNull(automations.deletedAt)));
      if (!existing) return false;

      await tx.update(automations)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(automations.id, id));
      return true;
    });
  },

  async setStatus(id: string, status: 'active' | 'inactive') {
    return adminTx(async (tx) => {
      const [existing] = await tx.select()
        .from(automations)
        .where(and(eq(automations.id, id), eq(automations.scope, 'system'), isNull(automations.deletedAt)));
      if (!existing) return null;

      const [updated] = await tx.update(automations)
        .set({ status, updatedAt: new Date() })
        .where(eq(automations.id, id))
        .returning();
      return updated;
    });
  },
};

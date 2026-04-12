import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organisations } from '../db/schema/index.js';
import { auditService } from './auditService.js';
import { logger } from '../lib/logger.js';

export const orgSettingsService = {
  async getExecutionEnabled(orgId: string): Promise<boolean> {
    const [org] = await db
      .select({ orgExecutionEnabled: organisations.orgExecutionEnabled })
      .from(organisations)
      .where(eq(organisations.id, orgId));
    return org?.orgExecutionEnabled ?? true;
  },

  async setExecutionEnabled(
    orgId: string,
    enabled: boolean,
    actorId: string,
    reason?: string,
  ): Promise<void> {
    await db
      .update(organisations)
      .set({ orgExecutionEnabled: enabled, updatedAt: new Date() })
      .where(eq(organisations.id, orgId));

    try {
      await auditService.log({
        organisationId: orgId,
        actorId,
        actorType: 'user',
        action: enabled ? 'org_execution_enabled' : 'org_execution_disabled',
        entityType: 'organisation',
        entityId: orgId,
        metadata: { reason: reason ?? null },
      });
    } catch (err) {
      logger.warn('org_settings.audit_log_failed', {
        orgId,
        action: enabled ? 'org_execution_enabled' : 'org_execution_disabled',
        err: err instanceof Error ? err.message : String(err),
      });
    }
  },
};

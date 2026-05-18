import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { auditEvents } from '../db/schema/index.js';

export const auditService = {
  async log(params: {
    organisationId?: string;
    actorId?: string;
    actorType: 'user' | 'system' | 'agent';
    action: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  }): Promise<void> {
    try {
      await getOrgScopedDb('auditService.log').insert(auditEvents).values({ ...params, createdAt: new Date() });
    } catch (err) {
      console.error('[AuditService] Failed to write audit event:', err);
    }
  },
};

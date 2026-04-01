import { db } from '../db/index.js';
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
      await db.insert(auditEvents).values({ ...params, createdAt: new Date() });
    } catch (err) {
      console.error('[AuditService] Failed to write audit event:', err);
    }
  },
};

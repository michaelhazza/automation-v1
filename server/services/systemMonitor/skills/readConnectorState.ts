import { eq } from 'drizzle-orm';
import { withAdminConnectionGuarded } from '../../../lib/rlsBoundaryGuard.js';
import { connectorConfigs } from '../../../db/schema/connectorConfigs.js';
import type { SkillExecutionContext } from '../../skillExecutor.js';

export async function executeReadConnectorState(
  input: Record<string, unknown>,
  _context: SkillExecutionContext,
): Promise<unknown> {
  const connectorId = input.connectorId as string | undefined;
  if (!connectorId) return { success: false, error: 'connectorId is required' };

  try {
    return await withAdminConnectionGuarded(
      {
        source: 'system_monitor_skill_read_connector_state',
        reason: 'cross-tenant read for system-monitor connector diagnosis',
        allowRlsBypass: true, // allowRlsBypass: cross-tenant connector state read for system monitor diagnosis
      },
      async (tx) => {
        const rows = await tx
          .select({
            id: connectorConfigs.id,
            organisationId: connectorConfigs.organisationId,
            connectorType: connectorConfigs.connectorType,
            status: connectorConfigs.status,
            lastSyncAt: connectorConfigs.lastSyncAt,
            lastSyncStatus: connectorConfigs.lastSyncStatus,
            lastSyncError: connectorConfigs.lastSyncError,
            pollIntervalMinutes: connectorConfigs.pollIntervalMinutes,
            syncPhase: connectorConfigs.syncPhase,
            updatedAt: connectorConfigs.updatedAt,
          })
          .from(connectorConfigs)
          .where(eq(connectorConfigs.id, connectorId))
          .limit(1);

        if (rows.length === 0) return { success: false, error: `Connector ${connectorId} not found` };
        return { success: true, connector: rows[0] };
      },
    );
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export const READ_CONNECTOR_STATE_DEFINITION = {
  name: 'read_connector_state',
  description: 'Read connector configuration and current sync state for diagnosis.',
  input_schema: {
    type: 'object' as const,
    properties: {
      connectorId: { type: 'string', description: 'UUID of the connector_configs row.' },
    },
    required: ['connectorId'],
  },
};

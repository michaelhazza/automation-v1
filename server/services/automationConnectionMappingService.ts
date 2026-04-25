import { eq, and, or, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { automationConnectionMappings, integrationConnections, automations } from '../db/schema/index.js';

export const automationConnectionMappingService = {
  async getConnectionMappings(subaccountId: string, automationId: string) {
    return db.select()
      .from(automationConnectionMappings)
      .where(and(
        eq(automationConnectionMappings.subaccountId, subaccountId),
        eq(automationConnectionMappings.processId, automationId),
      ));
  },

  async setConnectionMappings(
    orgId: string,
    subaccountId: string,
    automationId: string,
    mappings: Array<{ connectionKey: string; connectionId: string }>,
  ) {
    for (const m of mappings) {
      const [conn] = await db.select()
        .from(integrationConnections)
        .where(and(
          eq(integrationConnections.id, m.connectionId),
          eq(integrationConnections.organisationId, orgId),
          or(
            eq(integrationConnections.subaccountId, subaccountId),
            isNull(integrationConnections.subaccountId),
          ),
        ));
      if (!conn) {
        throw { statusCode: 400, message: `Connection ${m.connectionId} not found in this subaccount or organisation` };
      }
      if (conn.connectionStatus !== 'active') {
        throw { statusCode: 400, message: `Connection ${m.connectionId} is not active (status: ${conn.connectionStatus})` };
      }
    }

    await db.delete(automationConnectionMappings)
      .where(and(
        eq(automationConnectionMappings.subaccountId, subaccountId),
        eq(automationConnectionMappings.processId, automationId),
      ));

    if (mappings.length > 0) {
      await db.insert(automationConnectionMappings).values(
        mappings.map(m => ({
          organisationId: orgId,
          subaccountId,
          processId: automationId,
          connectionKey: m.connectionKey,
          connectionId: m.connectionId,
        })),
      );
    }

    return db.select()
      .from(automationConnectionMappings)
      .where(and(
        eq(automationConnectionMappings.subaccountId, subaccountId),
        eq(automationConnectionMappings.processId, automationId),
      ));
  },

  async cloneAutomationToSubaccount(
    orgId: string,
    subaccountId: string,
    sourceId: string,
    name?: string,
  ) {
    const [source] = await db.select()
      .from(automations)
      .where(and(eq(automations.id, sourceId), isNull(automations.deletedAt)));

    if (!source) throw { statusCode: 404, message: 'Source process not found' };

    if (source.scope !== 'system' && source.organisationId !== orgId) {
      throw { statusCode: 403, message: 'Cannot clone automations from another organisation' };
    }

    const [cloned] = await db.insert(automations).values({
      organisationId: orgId,
      automationEngineId: null,
      name: name || `${source.name} (Clone)`,
      description: source.description,
      webhookPath: source.webhookPath,
      inputSchema: source.inputSchema,
      outputSchema: source.outputSchema,
      configSchema: source.configSchema,
      defaultConfig: source.defaultConfig,
      requiredConnections: source.requiredConnections,
      scope: 'subaccount',
      isEditable: true,
      parentAutomationId: source.id,
      subaccountId,
      status: 'draft',
    }).returning();

    return cloned;
  },
};

import { eq, and, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { processedResources } from '../db/schema/index.js';

// ---------------------------------------------------------------------------
// Processed Resource Service — deduplication for external inputs
// ---------------------------------------------------------------------------

export const processedResourceService = {
  /**
   * Check whether a specific external resource has already been processed.
   */
  async hasBeenProcessed(
    subaccountId: string,
    integrationType: string,
    resourceType: string,
    externalId: string
  ): Promise<boolean> {
    const [row] = await db
      .select({ id: processedResources.id })
      .from(processedResources)
      .where(
        and(
          eq(processedResources.subaccountId, subaccountId),
          eq(processedResources.integrationType, integrationType),
          eq(processedResources.resourceType, resourceType),
          eq(processedResources.externalId, externalId)
        )
      )
      .limit(1);

    return !!row;
  },

  /**
   * Mark a single external resource as processed (upsert — idempotent).
   */
  async markProcessed(
    orgId: string,
    subaccountId: string,
    integrationType: string,
    resourceType: string,
    externalId: string,
    agentId?: string
  ): Promise<void> {
    await db
      .insert(processedResources)
      .values({
        organisationId: orgId,
        subaccountId,
        integrationType,
        resourceType,
        externalId,
        agentId: agentId ?? null,
      })
      .onConflictDoUpdate({
        target: [
          processedResources.subaccountId,
          processedResources.integrationType,
          processedResources.resourceType,
          processedResources.externalId,
        ],
        set: {
          processedAt: new Date(),
          agentId: agentId ?? sql`${processedResources.agentId}`,
        },
      });
  },

  /**
   * Mark multiple external resources as processed in a single batch (upsert).
   */
  async markBulkProcessed(
    orgId: string,
    subaccountId: string,
    items: Array<{
      integrationType: string;
      resourceType: string;
      externalId: string;
      agentId?: string;
    }>
  ): Promise<void> {
    if (items.length === 0) return;

    const values = items.map((item) => ({
      organisationId: orgId,
      subaccountId,
      integrationType: item.integrationType,
      resourceType: item.resourceType,
      externalId: item.externalId,
      agentId: item.agentId ?? null,
    }));

    await db
      .insert(processedResources)
      .values(values)
      .onConflictDoUpdate({
        target: [
          processedResources.subaccountId,
          processedResources.integrationType,
          processedResources.resourceType,
          processedResources.externalId,
        ],
        set: {
          processedAt: new Date(),
        },
      });
  },

  /**
   * Get all processed external IDs for a given subaccount/integration/resource
   * combination, optionally filtered to those processed since a given date.
   */
  async getProcessedIds(
    subaccountId: string,
    integrationType: string,
    resourceType: string,
    since?: Date
  ): Promise<string[]> {
    const conditions = [
      eq(processedResources.subaccountId, subaccountId),
      eq(processedResources.integrationType, integrationType),
      eq(processedResources.resourceType, resourceType),
    ];

    if (since) {
      conditions.push(gte(processedResources.processedAt, since));
    }

    const rows = await db
      .select({ externalId: processedResources.externalId })
      .from(processedResources)
      .where(and(...conditions));

    return rows.map((r) => r.externalId);
  },
};

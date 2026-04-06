import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { metricDefinitions, type NewMetricDefinition, type MetricDefinition } from '../db/schema/index.js';

// ---------------------------------------------------------------------------
// Metric Registry Service — soft validation layer for adapter-defined metrics
// ---------------------------------------------------------------------------

export const metricRegistryService = {
  async register(def: NewMetricDefinition): Promise<MetricDefinition> {
    const [result] = await db
      .insert(metricDefinitions)
      .values(def)
      .onConflictDoUpdate({
        target: [metricDefinitions.connectorType, metricDefinitions.metricSlug],
        set: {
          label: def.label,
          unit: def.unit,
          valueType: def.valueType,
          defaultPeriodType: def.defaultPeriodType,
          defaultAggregationType: def.defaultAggregationType,
          dependsOn: def.dependsOn,
          description: def.description,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  },

  async registerBatch(defs: NewMetricDefinition[]): Promise<void> {
    if (defs.length === 0) return;
    for (const def of defs) {
      await this.register(def);
    }
  },

  async getByConnectorType(connectorType: string): Promise<MetricDefinition[]> {
    return db
      .select()
      .from(metricDefinitions)
      .where(eq(metricDefinitions.connectorType, connectorType));
  },

  async getBySlug(connectorType: string, metricSlug: string): Promise<MetricDefinition | null> {
    const [result] = await db
      .select()
      .from(metricDefinitions)
      .where(and(
        eq(metricDefinitions.connectorType, connectorType),
        eq(metricDefinitions.metricSlug, metricSlug),
      ));
    return result ?? null;
  },

  async validateMetricSlugs(
    connectorType: string,
    slugs: string[]
  ): Promise<{ valid: string[]; missing: string[]; deprecated: string[] }> {
    if (slugs.length === 0) return { valid: [], missing: [], deprecated: [] };

    const definitions = await db
      .select()
      .from(metricDefinitions)
      .where(and(
        eq(metricDefinitions.connectorType, connectorType),
        inArray(metricDefinitions.metricSlug, slugs),
      ));

    const defMap = new Map(definitions.map(d => [d.metricSlug, d]));
    const valid: string[] = [];
    const missing: string[] = [];
    const deprecated: string[] = [];

    for (const slug of slugs) {
      const def = defMap.get(slug);
      if (!def) {
        missing.push(slug);
      } else if (def.status === 'deprecated') {
        deprecated.push(slug);
        valid.push(slug); // still usable, just warned
      } else if (def.status === 'removed') {
        missing.push(slug); // treat removed as missing
      } else {
        valid.push(slug);
      }
    }

    return { valid, missing, deprecated };
  },

  async bumpVersion(connectorType: string, metricSlug: string): Promise<void> {
    await db
      .update(metricDefinitions)
      .set({
        version: sql`${metricDefinitions.version} + 1`,
        updatedAt: new Date(),
      } as Record<string, unknown>)
      .where(and(
        eq(metricDefinitions.connectorType, connectorType),
        eq(metricDefinitions.metricSlug, metricSlug),
      ));
  },

  async getVersion(connectorType: string, metricSlug: string): Promise<number> {
    const def = await this.getBySlug(connectorType, metricSlug);
    return def?.version ?? 1;
  },
};

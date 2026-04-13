import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { geoAudits, type NewGeoAudit, type GeoAudit, type GeoDimension, type GeoDimensionScore } from '../db/schema/geoAudits.js';

// ---------------------------------------------------------------------------
// GEO Audit Service — score computation, storage, and history
// ---------------------------------------------------------------------------

/** Default dimension weights (from geo-seo-claude methodology) */
export const DEFAULT_GEO_WEIGHTS: Record<GeoDimension, number> = {
  ai_citability: 0.25,
  brand_authority: 0.20,
  content_quality: 0.20,
  technical_infrastructure: 0.15,
  structured_data: 0.10,
  platform_specific: 0.10,
};

/** Compute weighted composite score from dimension scores */
export function computeCompositeScore(
  dimensionScores: GeoDimensionScore[],
): number {
  let composite = 0;
  for (const dim of dimensionScores) {
    composite += dim.score * dim.weight;
  }
  return Math.round(Math.max(0, Math.min(100, composite)) * 10) / 10;
}

export const geoAuditService = {
  /** Store a completed GEO audit result */
  async saveAudit(data: Omit<NewGeoAudit, 'id' | 'createdAt'>): Promise<GeoAudit> {
    const [audit] = await db
      .insert(geoAudits)
      .values({
        ...data,
        createdAt: new Date(),
      })
      .returning();
    return audit;
  },

  /** Get a single audit by ID, scoped to org */
  async getAudit(id: string, organisationId: string): Promise<GeoAudit> {
    const [audit] = await db
      .select()
      .from(geoAudits)
      .where(and(eq(geoAudits.id, id), eq(geoAudits.organisationId, organisationId)));

    if (!audit) throw { statusCode: 404, message: 'GEO audit not found' };
    return audit;
  },

  /** List audits for a subaccount (most recent first) */
  async listBySubaccount(
    organisationId: string,
    subaccountId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<GeoAudit[]> {
    return db
      .select()
      .from(geoAudits)
      .where(
        and(
          eq(geoAudits.organisationId, organisationId),
          eq(geoAudits.subaccountId, subaccountId),
        ),
      )
      .orderBy(desc(geoAudits.createdAt))
      .limit(opts.limit ?? 20)
      .offset(opts.offset ?? 0);
  },

  /** List audits for a URL across time (trend tracking) */
  async listByUrl(
    organisationId: string,
    url: string,
    opts: { limit?: number } = {},
  ): Promise<GeoAudit[]> {
    return db
      .select()
      .from(geoAudits)
      .where(
        and(
          eq(geoAudits.organisationId, organisationId),
          eq(geoAudits.url, url),
        ),
      )
      .orderBy(desc(geoAudits.createdAt))
      .limit(opts.limit ?? 50);
  },

  /** List all audits for an org (portfolio view, most recent first) */
  async listByOrg(
    organisationId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<GeoAudit[]> {
    return db
      .select()
      .from(geoAudits)
      .where(eq(geoAudits.organisationId, organisationId))
      .orderBy(desc(geoAudits.createdAt))
      .limit(opts.limit ?? 50)
      .offset(opts.offset ?? 0);
  },

  /** Get the latest audit for a URL (used by agents for continuity) */
  async getLatestForUrl(
    organisationId: string,
    url: string,
  ): Promise<GeoAudit | null> {
    const [audit] = await db
      .select()
      .from(geoAudits)
      .where(
        and(
          eq(geoAudits.organisationId, organisationId),
          eq(geoAudits.url, url),
        ),
      )
      .orderBy(desc(geoAudits.createdAt))
      .limit(1);

    return audit ?? null;
  },
};

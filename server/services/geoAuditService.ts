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

/**
 * Normalise a URL for consistent storage and lookup.
 * Lowercases the hostname and strips trailing slashes from the pathname.
 * Query params are preserved — they may be meaningful for audited pages.
 * Falls back to the raw string if parsing fails.
 */
export function normalizeAuditUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname !== '/') {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    return u.toString();
  } catch {
    return raw;
  }
}

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
    const url = normalizeAuditUrl(data.url);

    // Deduplicate: if this agentRunId has already produced an audit for this URL, return it
    if (data.agentRunId) {
      const [existing] = await db
        .select()
        .from(geoAudits)
        .where(
          and(
            eq(geoAudits.organisationId, data.organisationId),
            eq(geoAudits.agentRunId, data.agentRunId),
            eq(geoAudits.url, url),
          ),
        )
        .limit(1);
      if (existing) return existing;
    }

    const [audit] = await db
      .insert(geoAudits)
      .values({
        ...data,
        url,
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
          eq(geoAudits.url, normalizeAuditUrl(url)),
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
          eq(geoAudits.url, normalizeAuditUrl(url)),
        ),
      )
      .orderBy(desc(geoAudits.createdAt))
      .limit(1);

    return audit ?? null;
  },
};

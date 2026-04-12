import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { orgMemories, orgMemoryEntries } from '../db/schema/index.js';
import {
  RRF_K, RRF_MIN_SCORE, MAX_MEMORY_SCAN, MAX_QUERY_TEXT_CHARS,
  VECTOR_SEARCH_RECENCY_DAYS, RRF_WEIGHTS,
} from '../config/limits.js';

// Re-use scoring from workspace memory
const VALID_ENTRY_TYPES = ['observation', 'decision', 'preference', 'issue', 'pattern'];

function scoreMemoryEntry(content: string, entryType: string): number {
  if (content.length < 40) return 0;

  const completeness = Math.min(content.length / 200, 1.0);
  const typeBoosts: Record<string, number> = { preference: 1.0, pattern: 0.9, decision: 0.85, issue: 0.8, observation: 0.6 };
  const relevance = typeBoosts[entryType] ?? 0.5;

  let specificitySignals = 0;
  if (/\d/.test(content)) specificitySignals++;
  if (/[A-Z][a-z]/.test(content)) specificitySignals++;
  if (/"[^"]+"/.test(content)) specificitySignals++;
  if (/\d{4}-\d{2}/.test(content)) specificitySignals++;
  if (/\$\d/.test(content)) specificitySignals++;
  const specificity = Math.min(specificitySignals / 5, 1.0);

  const actionability = /should|must|always|never|prefers?|requires?|wants?|needs?|avoid/i.test(content) ? 0.9 : 0.4;

  return (completeness + relevance + specificity + actionability) / 4;
}

/**
 * @deprecated — Data migrated to workspace memory via migration 0106.
 * No new reads or writes should go through this service.
 * Kept during Phase 1 transition (in case rollback is needed).
 * Will be deleted in Phase 2 cleanup.
 * See: docs/org-subaccount-refactor-spec.md §10d
 */
export const orgMemoryService = {
  async getOrCreateMemory(organisationId: string) {
    const [existing] = await db
      .select()
      .from(orgMemories)
      .where(eq(orgMemories.organisationId, organisationId));

    if (existing) return existing;

    const [created] = await db
      .insert(orgMemories)
      .values({ organisationId })
      .returning();
    return created;
  },

  async getMemory(organisationId: string) {
    return this.getOrCreateMemory(organisationId);
  },

  async updateSummary(organisationId: string, summary: string) {
    await db
      .update(orgMemories)
      .set({ summary, summaryGeneratedAt: new Date(), updatedAt: new Date() })
      .where(eq(orgMemories.organisationId, organisationId));
  },

  async listEntries(organisationId: string, filters?: {
    entryType?: string;
    scopeTagKey?: string;
    scopeTagValue?: string;
    limit?: number;
  }) {
    let query = db
      .select()
      .from(orgMemoryEntries)
      .where(eq(orgMemoryEntries.organisationId, organisationId))
      .orderBy(desc(orgMemoryEntries.createdAt))
      .limit(filters?.limit ?? 50);

    // Additional filtering would require dynamic conditions
    // For now, fetch and filter in-memory for simplicity
    const entries = await query;

    let filtered = entries;
    if (filters?.entryType) {
      filtered = filtered.filter(e => e.entryType === filters.entryType);
    }
    if (filters?.scopeTagKey) {
      filtered = filtered.filter(e => {
        const tags = e.scopeTags as Record<string, string> | null;
        if (!tags) return false;
        if (filters.scopeTagValue) return tags[filters.scopeTagKey!] === filters.scopeTagValue;
        return filters.scopeTagKey! in tags;
      });
    }

    return filtered;
  },

  async createEntry(organisationId: string, data: {
    content: string;
    entryType: string;
    scopeTags?: Record<string, string>;
    sourceSubaccountIds?: string[];
    evidenceCount?: number;
    agentRunId?: string;
    agentId?: string;
  }) {
    const qualityScore = scoreMemoryEntry(data.content, data.entryType);

    const [entry] = await db
      .insert(orgMemoryEntries)
      .values({
        organisationId,
        content: data.content,
        entryType: data.entryType as 'observation' | 'decision' | 'preference' | 'issue' | 'pattern',
        scopeTags: data.scopeTags ?? null,
        sourceSubaccountIds: data.sourceSubaccountIds ?? null,
        evidenceCount: data.evidenceCount ?? 1,
        qualityScore,
        agentRunId: data.agentRunId ?? null,
        agentId: data.agentId ?? null,
      })
      .returning();

    // Async embedding generation (same infrastructure as workspace memory)
    this.generateEmbedding(entry.id, data.content).catch(err => {
      console.error(`[OrgMemory] Embedding generation failed for entry ${entry.id}:`, err);
    });

    // Increment runs_since_summary
    await db
      .update(orgMemories)
      .set({
        runsSinceSummary: sql`${orgMemories.runsSinceSummary} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(orgMemories.organisationId, organisationId));

    return entry;
  },

  async deleteEntry(entryId: string, organisationId: string) {
    await db
      .delete(orgMemoryEntries)
      .where(and(eq(orgMemoryEntries.id, entryId), eq(orgMemoryEntries.organisationId, organisationId)));
  },

  /**
   * Get org memory formatted for injection into agent system prompt.
   */
  async getInsightsForPrompt(organisationId: string): Promise<string | null> {
    const memory = await this.getOrCreateMemory(organisationId);
    if (!memory.summary) return null;

    const recentEntries = await db
      .select()
      .from(orgMemoryEntries)
      .where(and(
        eq(orgMemoryEntries.organisationId, organisationId),
        eq(orgMemoryEntries.includedInSummary, false)
      ))
      .orderBy(desc(orgMemoryEntries.qualityScore))
      .limit(5);

    const parts: string[] = [];
    parts.push('<org-memory-data>');
    parts.push(memory.summary);

    if (recentEntries.length > 0) {
      parts.push('\n\nRecent insights (not yet in summary):');
      for (const entry of recentEntries) {
        const tags = entry.scopeTags ? ` [${Object.entries(entry.scopeTags as Record<string, string>).map(([k, v]) => `${k}=${v}`).join(', ')}]` : '';
        parts.push(`- [${entry.entryType}]${tags} ${entry.content}`);
      }
    }
    parts.push('</org-memory-data>');

    return parts.join('\n');
  },

  /** Generate embedding for a memory entry (async, non-blocking) */
  async generateEmbedding(entryId: string, content: string) {
    try {
      const { generateEmbedding } = await import('../lib/embeddings.js');
      const embedding = await generateEmbedding(content);
      if (embedding) {
        await db.execute(
          sql`UPDATE org_memory_entries SET embedding = ${embedding}::vector WHERE id = ${entryId}`
        );
      }
    } catch (err) {
      console.error(`[OrgMemory] Embedding generation failed for entry ${entryId}:`, err instanceof Error ? err.message : err);
    }
  },

  /**
   * Hybrid search across org memory entries using RRF (Phase B2).
   */
  async getRelevantInsights(
    organisationId: string,
    queryEmbedding: number[],
    queryText?: string,
    scopeTags?: Record<string, string>,
    limit = 5
  ) {
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;
    const safeQueryText = (queryText ?? '').slice(0, MAX_QUERY_TEXT_CHARS);
    const weights = RRF_WEIGHTS.general;
    const overRetrieveLimit = limit * 4;

    // Check for valid tsquery
    let hasValidTsquery = false;
    if (safeQueryText) {
      const tsqCheck = await db.execute<{ q: string }>(
        sql`SELECT plainto_tsquery('english', ${safeQueryText})::text AS q`
      );
      hasValidTsquery = !!(tsqCheck as unknown as Array<{ q: string }>)[0]?.q?.trim();
    }

    const fullTextCte = hasValidTsquery
      ? sql`
        , fulltext AS (
          SELECT id, 1.0 / (${RRF_K} + ROW_NUMBER() OVER (
            ORDER BY ts_rank_cd(tsv, plainto_tsquery('english', ${safeQueryText})) DESC
          )) AS rrf_component
          FROM candidate_pool
          WHERE tsv @@ plainto_tsquery('english', ${safeQueryText})
          LIMIT ${overRetrieveLimit}
        )`
      : sql``;

    const fullTextUnion = hasValidTsquery
      ? sql`UNION ALL SELECT id, rrf_component FROM fulltext`
      : sql``;

    const results = await db.execute(sql`
      WITH candidate_pool AS (
        SELECT id, content, entry_type, scope_tags, quality_score, evidence_count,
               created_at, last_accessed_at, embedding, tsv
        FROM org_memory_entries
        WHERE organisation_id = ${organisationId}
          AND created_at >= NOW() - INTERVAL '${VECTOR_SEARCH_RECENCY_DAYS} days'
        ORDER BY GREATEST(created_at, COALESCE(last_accessed_at, created_at)) DESC
        LIMIT ${MAX_MEMORY_SCAN}
      ),
      semantic AS (
        SELECT id, 1.0 / (${RRF_K} + ROW_NUMBER() OVER (
          ORDER BY embedding <=> ${vectorLiteral}::vector
        )) AS rrf_component
        FROM candidate_pool
        WHERE embedding IS NOT NULL
        LIMIT ${overRetrieveLimit}
      )
      ${fullTextCte}
      , rrf_scores AS (
        SELECT id, rrf_component FROM semantic
        ${fullTextUnion}
      ),
      fused AS (
        SELECT r.id, SUM(r.rrf_component) AS rrf_score, COUNT(*) AS source_count
        FROM rrf_scores r GROUP BY r.id
      )
      SELECT
        f.id, cp.content, cp.entry_type, cp.scope_tags, cp.quality_score,
        cp.evidence_count, cp.created_at, f.rrf_score, f.source_count,
        f.rrf_score * ${weights.rrf}
          + COALESCE(cp.quality_score, 0.5) * ${weights.quality}
          + (1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - GREATEST(
              cp.created_at, COALESCE(cp.last_accessed_at, cp.created_at)
            ))) / 86400.0 / 30.0)) * ${weights.recency} AS combined_score
      FROM fused f
      JOIN candidate_pool cp ON cp.id = f.id
      WHERE f.rrf_score >= ${RRF_MIN_SCORE}
      ORDER BY combined_score DESC
      LIMIT ${limit}
    `);

    // Bump access counters asynchronously
    const ids = (results as unknown as Array<{ id: string }>).map(r => r.id);
    if (ids.length > 0) {
      db.execute(sql`
        UPDATE org_memory_entries SET access_count = access_count + 1, last_accessed_at = now()
        WHERE id = ANY(${ids}::uuid[])
      `).catch((err) => {
        console.error('[OrgMemory] Access counter update failed:', err instanceof Error ? err.message : err);
      });
    }

    // Filter by scope tags if provided
    let rows = results as unknown as Array<Record<string, unknown>>;
    if (scopeTags && Object.keys(scopeTags).length > 0) {
      rows = rows.filter(r => {
        const tags = r.scope_tags as Record<string, string> | null;
        if (!tags) return false;
        return Object.entries(scopeTags).every(([k, v]) => tags[k] === v);
      });
    }

    return rows;
  },
};

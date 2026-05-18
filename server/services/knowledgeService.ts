/**
 * knowledgeService — Phase D1 of docs/onboarding-playbooks-spec.md (§7.3).
 *
 * Backs the Unified Knowledge page (References tab + Memory Blocks tab).
 * The CRUD for each store continues to live in the existing services
 * (workspaceMemoryService, memoryBlockService); what this file adds is the
 * promote/demote flow that bridges the two stores while preserving
 * provenance and logging Config History on both sides of the mutation.
 *
 * Contracts (spec §7.3):
 *   promoteReferenceToBlock — creates a memory_blocks row with
 *     sourceReferenceId pointing at the original Reference. The Reference
 *     is NOT deleted (promotion is non-destructive, per spec).
 *   demoteBlockToReference — creates a workspace_memory_entries row and
 *     soft-deletes the source block. Both entities log Config History.
 */

import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import sanitizeHtml from 'sanitize-html';
import { db } from '../db/index.js'; // retained for db.transaction fallback in overrideEntry (non-HTTP callers)
import { agentRuns, agents, memoryBlocks, memoryBlockVersions, workspaceMemoryEntries } from '../db/schema/index.js';
import { getOrgScopedDb, peekOrgTxContext } from '../lib/orgScopedDb.js';
import type { OrgScopedTx } from '../db/index.js';
import { configHistoryService } from './configHistoryService.js';
import {
  canonicaliseBody,
  hashBody,
  dbStatusToContract,
  dbConfidenceToContract,
  isOverrideAllowed,
  type DbStatus,
  type ContractStatus,
} from './knowledgeOverridePure.js';

/**
 * Phase D1 / §7 G6.2 — sanitise Tiptap HTML before persisting a Reference
 * note. Keeps the narrow set of tags Tiptap's StarterKit produces and
 * strips everything else (scripts, handlers, iframes, styles, classes).
 */
const REFERENCE_HTML_MAX_BYTES = 64 * 1024; // 64KB — generous for long-form notes
export function sanitizeReferenceHtml(html: string): string {
  if (Buffer.byteLength(html, 'utf8') > REFERENCE_HTML_MAX_BYTES) {
    throw { statusCode: 413, message: 'Reference content exceeds maximum size of 64KB' };
  }
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'blockquote',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'a', 'hr',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    },
  });
}

type ReferenceEntryType = 'observation' | 'decision' | 'preference' | 'issue' | 'pattern';

// ---------------------------------------------------------------------------
// §7 G6.1 / G6.3 — References vs Insights split
//
// Both live in workspace_memory_entries. A row is a Reference when it was
// manually authored (agent_run_id IS NULL) or created by demoting a Memory
// Block. It is an Insight when an agent run captured it automatically
// (agent_run_id IS NOT NULL). The split lets the Knowledge page show three
// tabs with different affordances: References (Tiptap edit), Insights
// (filter + promote-to-reference), Memory Blocks (hot-path facts).
// ---------------------------------------------------------------------------

export async function listReferences(subaccountId: string, organisationId: string) {
  return getOrgScopedDb('knowledgeService.listReferences')
    .select()
    .from(workspaceMemoryEntries)
    .where(
      and(
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        eq(workspaceMemoryEntries.organisationId, organisationId),
        isNull(workspaceMemoryEntries.agentRunId),
        isNull(workspaceMemoryEntries.deletedAt),
      ),
    )
    .orderBy(desc(workspaceMemoryEntries.createdAt))
    .limit(500);
}

export interface InsightFilters {
  domain?: string;
  topic?: string;
  entryType?: ReferenceEntryType;
  taskSlug?: string;
}

export async function listInsights(
  subaccountId: string,
  organisationId: string,
  filters: InsightFilters = {},
) {
  const conditions = [
    eq(workspaceMemoryEntries.subaccountId, subaccountId),
    eq(workspaceMemoryEntries.organisationId, organisationId),
    isNotNull(workspaceMemoryEntries.agentRunId),
    isNull(workspaceMemoryEntries.deletedAt),
  ];
  if (filters.domain) conditions.push(eq(workspaceMemoryEntries.domain, filters.domain));
  if (filters.topic) conditions.push(eq(workspaceMemoryEntries.topic, filters.topic));
  if (filters.entryType) conditions.push(eq(workspaceMemoryEntries.entryType, filters.entryType));
  if (filters.taskSlug) conditions.push(eq(workspaceMemoryEntries.taskSlug, filters.taskSlug));

  return getOrgScopedDb('knowledgeService.listInsights')
    .select({
      id: workspaceMemoryEntries.id,
      content: workspaceMemoryEntries.content,
      entryType: workspaceMemoryEntries.entryType,
      domain: workspaceMemoryEntries.domain,
      topic: workspaceMemoryEntries.topic,
      taskSlug: workspaceMemoryEntries.taskSlug,
      qualityScore: workspaceMemoryEntries.qualityScore,
      createdAt: workspaceMemoryEntries.createdAt,
      agentRunId: workspaceMemoryEntries.agentRunId,
      agentId: workspaceMemoryEntries.agentId,
      agentName: agents.name,
      runStatus: agentRuns.status,
      runStartedAt: agentRuns.startedAt,
    })
    .from(workspaceMemoryEntries)
    .leftJoin(agents, and(eq(agents.id, workspaceMemoryEntries.agentId), isNull(agents.deletedAt)))
    .leftJoin(agentRuns, eq(agentRuns.id, workspaceMemoryEntries.agentRunId))
    .where(and(...conditions))
    .orderBy(desc(workspaceMemoryEntries.createdAt))
    .limit(500);
}

/**
 * Return the distinct facet values an Insight filter would offer for a
 * given sub-account. The UI renders these as <select> options.
 */
export async function listInsightFacets(subaccountId: string, organisationId: string) {
  const rows = await getOrgScopedDb('knowledgeService.listInsightFacets')
    .select({
      domain: workspaceMemoryEntries.domain,
      topic: workspaceMemoryEntries.topic,
      entryType: workspaceMemoryEntries.entryType,
      taskSlug: workspaceMemoryEntries.taskSlug,
    })
    .from(workspaceMemoryEntries)
    .where(
      and(
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        eq(workspaceMemoryEntries.organisationId, organisationId),
        isNotNull(workspaceMemoryEntries.agentRunId),
        isNull(workspaceMemoryEntries.deletedAt),
      ),
    );
  const uniq = (values: Array<string | null | undefined>) =>
    [...new Set(values.filter((v): v is string => !!v))].sort();
  return {
    domains: uniq(rows.map((r) => r.domain)),
    topics: uniq(rows.map((r) => r.topic)),
    entryTypes: uniq(rows.map((r) => r.entryType)),
    taskSlugs: uniq(rows.map((r) => r.taskSlug)),
  };
}

export interface PromoteInsightParams {
  insightId: string;
  subaccountId: string;
  organisationId: string;
  actorUserId: string | null;
}

/**
 * §7 G6.4 — promote an auto-captured Insight into a curated Reference
 * note, preserving a back-link (`promoted_from_entry_id`) to the source
 * row. The Reference is a new row (References have the agent_run_id =
 * NULL shape) so that subsequent edits don't touch the immutable Insight.
 */
export async function promoteInsightToReference(
  params: PromoteInsightParams,
): Promise<{ referenceId: string }> {
  const { insightId, subaccountId, organisationId, actorUserId } = params;

  const promoteInsightScopedDb = getOrgScopedDb('knowledgeService.promoteInsightToReference');
  const [insight] = await promoteInsightScopedDb
    .select()
    .from(workspaceMemoryEntries)
    .where(
      and(
        eq(workspaceMemoryEntries.id, insightId),
        eq(workspaceMemoryEntries.organisationId, organisationId),
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        isNotNull(workspaceMemoryEntries.agentRunId),
        isNull(workspaceMemoryEntries.deletedAt),
      ),
    );
  if (!insight) {
    throw { statusCode: 404, message: 'Insight not found' };
  }

  // The Reference is a fresh row — editing it later must not mutate the
  // immutable Insight. Wrap the copied content in a <p> if it looked like
  // plain text so the Tiptap editor renders it as a paragraph.
  const content = /<[a-z][^>]*>/i.test(insight.content)
    ? insight.content
    : `<p>${insight.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;

  const [created] = await promoteInsightScopedDb
    .insert(workspaceMemoryEntries)
    .values({
      organisationId,
      subaccountId,
      agentRunId: null,
      agentId: null,
      content: sanitizeReferenceHtml(content),
      entryType: insight.entryType,
      promotedFromEntryId: insight.id,
    })
    .returning({ id: workspaceMemoryEntries.id });

  await configHistoryService.recordHistory({
    entityType: 'reference_entry',
    entityId: created.id,
    organisationId,
    snapshot: {
      content,
      subaccountId,
      createdByInsightPromotion: true,
      promotedFromEntryId: insight.id,
    },
    changedBy: actorUserId,
    changeSource: 'ui',
    changeSummary: `Created by promoting Insight ${insight.id}`,
  });

  return { referenceId: created.id };
}

export interface CreateReferenceParams {
  subaccountId: string;
  organisationId: string;
  content: string;
  entryType?: ReferenceEntryType;
}

/**
 * Create a manually-authored Reference (spec §7.2). Routes must not touch the
 * DB directly — the RLS contract gate fails closed on raw `db` imports outside
 * server/services/**.
 *
 * Content is Tiptap HTML for UI-authored notes; the sanitiser strips anything
 * outside the StarterKit allowlist. The service accepts plain text too — if
 * the string contains no tags, sanitize-html returns it unchanged.
 */
export async function createReference(params: CreateReferenceParams) {
  const { subaccountId, organisationId, content, entryType } = params;
  const [created] = await getOrgScopedDb('knowledgeService.createReference')
    .insert(workspaceMemoryEntries)
    .values({
      organisationId,
      subaccountId,
      agentRunId: null,
      agentId: null,
      content: sanitizeReferenceHtml(content),
      entryType: entryType ?? 'observation',
    })
    .returning();
  return created;
}

export interface UpdateReferenceParams {
  referenceId: string;
  subaccountId: string;
  organisationId: string;
  content: string;
}

export async function updateReference(params: UpdateReferenceParams) {
  const { referenceId, subaccountId, organisationId, content } = params;
  const [updated] = await getOrgScopedDb('knowledgeService.updateReference')
    .update(workspaceMemoryEntries)
    .set({ content: sanitizeReferenceHtml(content) })
    .where(
      and(
        eq(workspaceMemoryEntries.id, referenceId),
        eq(workspaceMemoryEntries.organisationId, organisationId),
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
        // §7 G6.2 — archived References are immutable from the edit path;
        // restoring one requires a separate un-archive action.
        isNull(workspaceMemoryEntries.deletedAt),
      ),
    )
    .returning();
  return updated ?? null;
}

export interface WriteReferenceFromBindingParams {
  subaccountId: string;
  organisationId: string;
  /** The Reference note title — rendered as a leading `# name` heading. */
  name: string;
  /** The resolved form-field value being bound. */
  value: string;
  /** Optional entry type; defaults to `observation`. */
  entryType?: ReferenceEntryType;
}

/**
 * Append a Reference note created by a `referenceBinding` on a `user_input`
 * step (spec §G8). References are append-only, so this always creates a
 * new row. The note content takes the shape `# <name>\n\n<value>` so the
 * Knowledge tab's first-line-as-title renderer picks up the supplied label.
 */
export async function writeReferenceFromBinding(params: WriteReferenceFromBindingParams) {
  const { subaccountId, organisationId, name, value, entryType } = params;
  const trimmedName = name.trim();
  const trimmedValue = value.trim();
  const content = trimmedName.length > 0
    ? `# ${trimmedName}\n\n${trimmedValue}`
    : trimmedValue;
  const [created] = await getOrgScopedDb('knowledgeService.writeReferenceFromBinding')
    .insert(workspaceMemoryEntries)
    .values({
      organisationId,
      subaccountId,
      agentRunId: null,
      agentId: null,
      content,
      entryType: entryType ?? 'observation',
    })
    .returning({ id: workspaceMemoryEntries.id });
  return created;
}

/** Max label length for a Memory Block, matching spec §7.3 (80 chars). */
export const MEMORY_BLOCK_LABEL_MAX = 80;

/** Max content length for a Memory Block, matching spec §7.5 (2000 chars). */
export const MEMORY_BLOCK_CONTENT_MAX = 2000;

export interface PromoteReferenceParams {
  referenceId: string;
  subaccountId: string;
  organisationId: string;
  label: string;
  content: string;
  actorUserId: string | null;
  /**
   * Phase G / §7.4 / G7.1 — when true, the promoted block is created with
   * `autoAttach=true` and materialises read-only attachments for every
   * currently-linked agent in the sub-account.
   */
  autoAttach?: boolean;
}

export async function promoteReferenceToBlock(
  params: PromoteReferenceParams,
): Promise<{ blockId: string }> {
  const { referenceId, subaccountId, organisationId, label, content, actorUserId } = params;
  const autoAttach = params.autoAttach === true;

  if (!label || label.length > MEMORY_BLOCK_LABEL_MAX) {
    throw { statusCode: 400, message: `Label must be 1–${MEMORY_BLOCK_LABEL_MAX} characters` };
  }
  if (!content || content.length > MEMORY_BLOCK_CONTENT_MAX) {
    throw { statusCode: 400, message: `Content must be 1–${MEMORY_BLOCK_CONTENT_MAX} characters` };
  }

  // Verify the Reference exists and belongs to the subaccount + org.
  const promoteRefScopedDb = getOrgScopedDb('knowledgeService.promoteReferenceToBlock');
  const [ref] = await promoteRefScopedDb
    .select({ id: workspaceMemoryEntries.id })
    .from(workspaceMemoryEntries)
    .where(
      and(
        eq(workspaceMemoryEntries.id, referenceId),
        eq(workspaceMemoryEntries.organisationId, organisationId),
        eq(workspaceMemoryEntries.subaccountId, subaccountId),
      ),
    );
  if (!ref) {
    throw { statusCode: 404, message: 'Reference not found' };
  }

  // Reject duplicate labels within the subaccount (spec §7.5 — unique per
  // sub-account). The existing DB constraint is org-scoped on `name`; we
  // narrow to subaccount here at the service layer until a future migration
  // introduces the stricter partial unique index.
  const [dupe] = await promoteRefScopedDb
    .select({ id: memoryBlocks.id })
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.organisationId, organisationId),
        eq(memoryBlocks.subaccountId, subaccountId),
        eq(memoryBlocks.name, label),
        isNull(memoryBlocks.deletedAt),
      ),
    );
  if (dupe) {
    throw { statusCode: 409, message: `A Memory Block labelled "${label}" already exists for this sub-account` };
  }

  const [created] = await promoteRefScopedDb
    .insert(memoryBlocks)
    .values({
      organisationId,
      subaccountId,
      name: label,
      content,
      sourceReferenceId: referenceId,
      isReadOnly: false,
      autoAttach,
    })
    .returning();

  // Phase G / §7.4 / G7.1 — materialise attachments for every linked agent
  // in the sub-account. Imports from memoryBlockService lazily to avoid
  // cycling on startup.
  if (autoAttach) {
    const { materialiseAutoAttachForBlock } = await import('./memoryBlockService.js');
    await materialiseAutoAttachForBlock(created.id, subaccountId, organisationId);
  }

  await configHistoryService.recordHistory({
    entityType: 'memory_block',
    entityId: created.id,
    organisationId,
    snapshot: {
      name: created.name,
      content: created.content,
      subaccountId: created.subaccountId,
      sourceReferenceId: created.sourceReferenceId,
      promotedFromReferenceId: referenceId,
      autoAttach,
    },
    changedBy: actorUserId,
    changeSource: 'ui',
    changeSummary: `Promoted from Reference ${referenceId}`,
  });

  return { blockId: created.id };
}

export interface DemoteBlockParams {
  blockId: string;
  subaccountId: string;
  organisationId: string;
  /** Optional content override — defaults to the block's current content. */
  content?: string;
  actorUserId: string | null;
}

export async function demoteBlockToReference(
  params: DemoteBlockParams,
): Promise<{ referenceId: string }> {
  const { blockId, subaccountId, organisationId, content, actorUserId } = params;

  const demoteScopedDb = getOrgScopedDb('knowledgeService.demoteBlockToReference');
  const [block] = await demoteScopedDb
    .select()
    .from(memoryBlocks)
    .where(
      and(
        eq(memoryBlocks.id, blockId),
        eq(memoryBlocks.organisationId, organisationId),
        eq(memoryBlocks.subaccountId, subaccountId),
        isNull(memoryBlocks.deletedAt),
      ),
    );
  if (!block) {
    throw { statusCode: 404, message: 'Memory block not found' };
  }

  const referenceContent = content ?? block.content;
  if (!referenceContent) {
    throw { statusCode: 400, message: 'Reference content cannot be empty' };
  }

  // Create the Reference. `agentRunId` and `agentId` are nullable post-0118;
  // a demoted block has no source agent run.
  const [createdRef] = await demoteScopedDb
    .insert(workspaceMemoryEntries)
    .values({
      organisationId,
      subaccountId,
      agentRunId: null,
      agentId: null,
      content: referenceContent,
      entryType: 'observation',
    })
    .returning({ id: workspaceMemoryEntries.id });

  // Soft-delete the block.
  await demoteScopedDb
    .update(memoryBlocks)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(memoryBlocks.id, blockId));

  // Log Config History for both sides of the mutation.
  await configHistoryService.recordHistory({
    entityType: 'memory_block',
    entityId: block.id,
    organisationId,
    snapshot: {
      name: block.name,
      content: block.content,
      subaccountId: block.subaccountId,
      deletedAt: new Date().toISOString(),
      demotedToReferenceId: createdRef.id,
    },
    changedBy: actorUserId,
    changeSource: 'ui',
    changeSummary: `Demoted to Reference ${createdRef.id}`,
  });

  await configHistoryService.recordHistory({
    entityType: 'reference_entry',
    entityId: createdRef.id,
    organisationId,
    snapshot: {
      content: referenceContent,
      subaccountId,
      createdByDemotion: true,
      demotedFromBlockId: block.id,
    },
    changedBy: actorUserId,
    changeSource: 'ui',
    changeSummary: `Created by demoting Memory Block ${block.id}`,
  });

  return { referenceId: createdRef.id };
}

// ---------------------------------------------------------------------------
// Govern — Knowledge list + approve/reject/override (spec §4, §6)
// ---------------------------------------------------------------------------

export interface ListEntriesQuery {
  organisationId: string;
  scope: 'workspace' | 'org';
  subaccountId?: string;
  status?: ContractStatus[];
  autoUpdateDisabled?: boolean;
  q?: string;
  cursor?: string | null;
  limit: number;
  sortKey: 'createdAt' | 'updatedAt' | 'confidence' | 'sourceAgent' | 'kind' | 'status';
  sortDir: 'asc' | 'desc';
  /** Source provenance filter — spec §13.4. */
  source?: 'all' | 'corrections' | 'manual' | 'auto';
}

export interface KnowledgeEntryRow {
  id: string;
  kind: 'belief' | 'fact' | 'observation' | 'preference' | 'issue';
  body: string;
  confidence: number;
  status: ContractStatus;
  source: { runId: string; agentName: string; extractedAt: string };
  subaccount: { id: string; name: string } | null;
  autoUpdateDisabled: boolean;
  lastEditedBy: { kind: 'auto' | 'manual'; userId: string | null; at: string } | null;
  etag: string;
  capturedVia: string;
  capturedAt: string;
}

export interface ListEntriesResult {
  rows: KnowledgeEntryRow[];
  cursor: string | null;
  filterOptions: Record<string, Array<{ value: string; label: string; count: number }>>;
}

function contractStatusToDb(cs: ContractStatus): DbStatus[] {
  switch (cs) {
    case 'in_use': return ['active'];
    case 'pending_review': return ['draft', 'pending_review'];
    case 'ignored': return ['rejected'];
  }
}

export async function listEntries(query: ListEntriesQuery): Promise<ListEntriesResult> {
  const limit = Math.min(query.limit, 50);

  const dbStatuses: DbStatus[] | undefined = query.status?.length
    ? query.status.flatMap(contractStatusToDb)
    : undefined;

  let cursorPrimary: string | null = null;
  let cursorId: string | null = null;
  if (query.cursor) {
    try {
      const decoded = JSON.parse(
        Buffer.from(query.cursor, 'base64url').toString('utf8'),
      ) as { primary: string; id: string };
      cursorPrimary = decoded.primary;
      cursorId = decoded.id;
    } catch {
      // invalid cursor; start from beginning
    }
  }

  const sortColMap: Record<ListEntriesQuery['sortKey'], string> = {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    confidence: 'confidence',
    sourceAgent: 'created_at',
    kind: 'created_at',
    status: 'status',
  };
  const sortCol = sortColMap[query.sortKey];
  const dir = query.sortDir === 'asc' ? 'ASC' : 'DESC';

  const resultRows = await getOrgScopedDb('knowledgeService.listEntries').execute(sql`
    WITH base AS (
      SELECT
        mb.id::text AS id,
        mb.content AS body,
        mb.status,
        mb.confidence,
        mb.auto_update_disabled,
        mb.updated_at,
        mb.created_at,
        mb.subaccount_id::text AS subaccount_id,
        sa.name AS subaccount_name,
        mb.last_edited_by_agent_id::text AS last_edited_agent_id,
        mb.source_run_id::text AS source_run_id,
        mb.captured_via,
        mb.created_at AS captured_at
      FROM memory_blocks mb
      LEFT JOIN subaccounts sa ON sa.id = mb.subaccount_id AND sa.deleted_at IS NULL
      WHERE mb.organisation_id = ${query.organisationId}::uuid
        AND mb.deleted_at IS NULL
        ${query.scope === 'workspace' && query.subaccountId
          ? sql`AND mb.subaccount_id = ${query.subaccountId}::uuid`
          : sql``}
        ${dbStatuses?.length
          ? sql`AND mb.status = ANY(${dbStatuses}::text[])`
          : sql``}
        ${query.autoUpdateDisabled !== undefined
          ? sql`AND mb.auto_update_disabled = ${query.autoUpdateDisabled}`
          : sql``}
        ${query.q
          ? sql`AND mb.content ILIKE ${'%' + query.q + '%'}`
          : sql``}
        ${query.source === 'corrections'
          ? sql`AND mb.captured_via = 'operator_correction'`
          : query.source === 'manual'
          ? sql`AND mb.captured_via = 'manual_edit'`
          : query.source === 'auto'
          ? sql`AND mb.captured_via = 'auto_synthesised'`
          : sql``}
    ),
    ordered AS (
      SELECT * FROM base
      ${cursorPrimary !== null && cursorId !== null
        ? sql`WHERE (${sql.raw(sortCol)}, id) ${sql.raw(query.sortDir === 'asc' ? '>' : '<')} (${cursorPrimary}, ${cursorId})`
        : sql``}
      ORDER BY ${sql.raw(sortCol)} ${sql.raw(dir)}, id ${sql.raw(dir)}
      LIMIT ${limit + 1}
    ),
    status_options AS (
      SELECT status AS value, status AS label, COUNT(*)::int AS count
      FROM base
      GROUP BY status
      ORDER BY count DESC, value ASC
    )
    SELECT
      (SELECT json_agg(row_to_json(ordered.*)) FROM ordered) AS rows,
      (SELECT json_agg(row_to_json(status_options.*)) FROM status_options) AS status_options
  `);

  const raw = (resultRows as unknown as Array<Record<string, unknown>>)[0] as {
    rows: Array<{
      id: string; body: string; status: string; confidence: string | null;
      auto_update_disabled: boolean; updated_at: string; created_at: string;
      subaccount_id: string | null; subaccount_name: string | null;
      last_edited_agent_id: string | null;
      source_run_id: string | null;
      captured_via: string | null;
      captured_at: string;
    }> | null;
    status_options: Array<{ value: string; label: string; count: number }> | null;
  };

  const allRows = raw.rows ?? [];
  const hasMore = allRows.length > limit;
  const pageRows = hasMore ? allRows.slice(0, limit) : allRows;

  const lastRow = hasMore ? allRows[limit - 1] : null;
  const nextCursor = lastRow
    ? Buffer.from(
        JSON.stringify({
          primary: (lastRow as Record<string, unknown>)[sortCol] ?? lastRow.created_at,
          id: lastRow.id,
        }),
        'utf8',
      ).toString('base64url')
    : null;

  const rows: KnowledgeEntryRow[] = pageRows.map((r) => ({
    id: r.id,
    kind: 'observation' as const,
    body: r.body,
    confidence: dbConfidenceToContract(r.confidence as 'low' | 'normal' | null),
    status: (() => {
      try { return dbStatusToContract(r.status as DbStatus); }
      catch { return 'pending_review' as ContractStatus; }
    })(),
    source: { runId: r.source_run_id ?? '', agentName: r.last_edited_agent_id ?? 'system', extractedAt: r.created_at },
    subaccount: r.subaccount_id ? { id: r.subaccount_id, name: r.subaccount_name ?? r.subaccount_id } : null,
    autoUpdateDisabled: r.auto_update_disabled,
    lastEditedBy: null,
    etag: r.updated_at,
    capturedVia: r.captured_via ?? 'manual_edit',
    capturedAt: r.captured_at,
  }));

  const rawStatusOpts = raw.status_options ?? [];
  const statusOpts = rawStatusOpts.map((o) => {
    let contractVal: ContractStatus;
    try { contractVal = dbStatusToContract(o.value as DbStatus); }
    catch { return null; }
    return { value: contractVal, label: contractVal, count: o.count };
  }).filter((o): o is NonNullable<typeof o> => o !== null);

  return {
    rows,
    cursor: nextCursor,
    filterOptions: { status: statusOpts },
  };
}

export async function approveEntry(opts: {
  organisationId: string;
  blockId: string;
  actorUserId: string | null;
}): Promise<{ alreadyApplied: boolean }> {
  const updated = await getOrgScopedDb('knowledgeService.approveEntry')
    .update(memoryBlocks)
    .set({ status: 'active', updatedAt: new Date() })
    .where(and(
      eq(memoryBlocks.id, opts.blockId),
      eq(memoryBlocks.organisationId, opts.organisationId),
      inArray(memoryBlocks.status, ['draft', 'pending_review']),
      isNull(memoryBlocks.deletedAt),
    ))
    .returning({ id: memoryBlocks.id });
  return { alreadyApplied: updated.length === 0 };
}

export async function rejectEntry(opts: {
  organisationId: string;
  blockId: string;
  actorUserId: string | null;
}): Promise<{ alreadyApplied: boolean }> {
  const updated = await getOrgScopedDb('knowledgeService.rejectEntry')
    .update(memoryBlocks)
    .set({ status: 'rejected', updatedAt: new Date() })
    .where(and(
      eq(memoryBlocks.id, opts.blockId),
      eq(memoryBlocks.organisationId, opts.organisationId),
      sql`${memoryBlocks.status} <> 'rejected'`,
      isNull(memoryBlocks.deletedAt),
    ))
    .returning({ id: memoryBlocks.id });
  return { alreadyApplied: updated.length === 0 };
}

export async function overrideEntry(opts: {
  organisationId: string;
  blockId: string;
  body: string;
  expectedEtag: string;
  actorUserId: string | null;
}): Promise<
  | { ok: true; status: 'in_use'; etag: string; created: boolean }
  | { ok: false; reason: 'state'; currentStatus: ContractStatus }
  | { ok: false; reason: 'etag_mismatch'; currentEtag: string }
  | { ok: false; reason: 'not_found' }
> {
  const canonical = canonicaliseBody(opts.body);
  const bodyHash = hashBody(canonical);

  // PTH-CGT-F1 defence-in-depth: ensure overrideEntry's advisory lock + version
  // read + version insert + memory-block update all execute on the same real
  // transaction handle. The advisory lock is acquired with pg_advisory_xact_lock
  // (transaction-scoped, auto-released on commit/rollback) — but that semantic
  // ONLY holds when the lock is acquired inside a real transaction. If a
  // future caller invokes overrideEntry outside withOrgTx, getOrgScopedDb()
  // would throw missing_org_context (safe failure mode), but the conditional
  // here is an extra safety net: if ALS is established (the HTTP path),
  // reuse the existing tx so we don't create a redundant savepoint; if ALS
  // is absent (any non-HTTP caller), open our own db.transaction + set the
  // GUC + run the override flow inside it. Either path satisfies the spec
  // §V2 same-transaction requirement.
  // PTH-CGT-R3-F2: use truthy check (matches deliveryService + scheduledTaskService).
  // peekOrgTxContext() returns OrgTxContext | undefined in production but tests
  // sometimes mock it as () => null. `!== undefined` would treat null as "ctx present"
  // and incorrectly route to getOrgScopedDb (which throws missing_org_context). A
  // truthy check treats both undefined and null as "no ctx".
  const existingCtx = peekOrgTxContext();
  return existingCtx
    ? runOverrideInTx(getOrgScopedDb('knowledgeService.overrideEntry'), opts, canonical, bodyHash)
    : db.transaction(async (innerTx) => {
        await innerTx.execute(sql`SELECT set_config('app.organisation_id', ${opts.organisationId}, true)`);
        return runOverrideInTx(innerTx, opts, canonical, bodyHash);
      });
}

async function runOverrideInTx(
  tx: OrgScopedTx,
  opts: { organisationId: string; blockId: string; expectedEtag: string; actorUserId: string | null },
  canonical: string,
  bodyHash: string,
): Promise<
  | { ok: true; status: 'in_use'; etag: string; created: boolean }
  | { ok: false; reason: 'state'; currentStatus: ContractStatus }
  | { ok: false; reason: 'etag_mismatch'; currentEtag: string }
  | { ok: false; reason: 'not_found' }
> {
  // Serialise concurrent overrides on the same block via a per-block
  // transaction-scoped advisory lock. hashtextextended maps blockId → int8
  // deterministically; locks on distinct blockIds do NOT serialise each other.
  // pg_advisory_xact_lock (NOT pg_advisory_lock) — released automatically on
  // transaction commit/rollback, never leaks to the connection pool.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${opts.blockId}::text, 0))`);

  const rows = await tx
    .select({
      id: memoryBlocks.id,
      status: memoryBlocks.status,
      updatedAt: memoryBlocks.updatedAt,
    })
    .from(memoryBlocks)
    .where(and(
      eq(memoryBlocks.id, opts.blockId),
      eq(memoryBlocks.organisationId, opts.organisationId),
      isNull(memoryBlocks.deletedAt),
    ));
  if (rows.length === 0) return { ok: false, reason: 'not_found' as const };

  const row = rows[0];

  if (!isOverrideAllowed(row.status as DbStatus)) {
    return {
      ok: false, reason: 'state' as const,
      currentStatus: dbStatusToContract(row.status as DbStatus),
    };
  }

  // INVARIANT I3: ETag mismatch → 412, not 409
  const currentEtag = row.updatedAt.toISOString();
  if (currentEtag !== opts.expectedEtag) {
    return { ok: false, reason: 'etag_mismatch' as const, currentEtag };
  }

  // Insert version row; idempotent via partial unique index on (memory_block_id, body_hash).
  // With the advisory lock held, concurrent overrides on the same block are serialised so the
  // (memory_block_id, version) unique constraint is never violated by racing MAX(version) reads.
  const inserted = await tx
    .insert(memoryBlockVersions)
    .values({
      memoryBlockId: opts.blockId,
      content: canonical,
      version: sql`(COALESCE((SELECT MAX(version) FROM memory_block_versions WHERE memory_block_id = ${opts.blockId}::uuid), 0) + 1)`,
      createdByUserId: opts.actorUserId,
      changeSource: 'manual_edit',
      bodyHash,
    })
    .onConflictDoNothing({ target: [memoryBlockVersions.memoryBlockId, memoryBlockVersions.bodyHash] })
    .returning({ id: memoryBlockVersions.id });

  const created = inserted.length > 0;

  // Defence-in-depth: filter UPDATE on (id, organisationId) even though the SELECT above
  // already verified the org. Belt-and-braces per DEVELOPMENT_GUIDELINES §1.
  const [updated] = created
    ? await tx
        .update(memoryBlocks)
        .set({ content: canonical, autoUpdateDisabled: true, updatedAt: new Date() })
        .where(and(
          eq(memoryBlocks.id, opts.blockId),
          eq(memoryBlocks.organisationId, opts.organisationId),
        ))
        .returning({ updatedAt: memoryBlocks.updatedAt })
    : await tx
        .update(memoryBlocks)
        .set({ autoUpdateDisabled: true, updatedAt: new Date() })
        .where(and(
          eq(memoryBlocks.id, opts.blockId),
          eq(memoryBlocks.organisationId, opts.organisationId),
        ))
        .returning({ updatedAt: memoryBlocks.updatedAt });

  return {
    ok: true as const,
    status: 'in_use' as const,
    etag: updated.updatedAt.toISOString(),
    created,
  };
}

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

import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import sanitizeHtml from 'sanitize-html';
import { db } from '../db/index.js';
import { agentRuns, agents, memoryBlocks, workspaceMemoryEntries } from '../db/schema/index.js';
import { configHistoryService } from './configHistoryService.js';

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
  return db
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

  return db
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
    .leftJoin(agents, eq(agents.id, workspaceMemoryEntries.agentId))
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
  const rows = await db
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

  const [insight] = await db
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

  const [created] = await db
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
  const [created] = await db
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
  const [updated] = await db
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
  const [created] = await db
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
  const [ref] = await db
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
  const [dupe] = await db
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

  const [created] = await db
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
    await materialiseAutoAttachForBlock(created.id, subaccountId);
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

  const [block] = await db
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
  const [createdRef] = await db
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
  await db
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

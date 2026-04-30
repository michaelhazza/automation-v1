import { eq, and, or, isNull } from 'drizzle-orm';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { scheduledTasks, referenceDocuments, documentBundleAttachments, documentBundleMembers, agentDataSources, documentFetchEvents } from '../db/schema/index.js';
import {
  fetchDataSourcesByScope,
  type LoadedDataSource,
  type DataSourceScope,
} from './agentService.js';
import { loadTaskAttachmentsAsContext } from './taskAttachmentContextService.js';
import { assertScopeSingle } from '../lib/scopeAssertion.js';
import {
  processContextPool,
  rankContextPoolByRelevance,
  resolveScheduledTaskId as resolveScheduledTaskIdPure,
  type ProcessedContextPool,
  mergeAndOrderReferences,
  enforceRunBudget,
  applyFailurePolicy,
  smallDocumentFragmentationWarning,
  type MergedReference,
} from './runContextLoaderPure.js';
import { generateEmbedding } from '../lib/embeddings.js';
import { externalDocumentResolverService } from './externalDocumentResolverService.js';
import { buildProvenanceHeader, countTokensApprox, truncateContentToTokenBudget } from './externalDocumentResolverPure.js';
import { externalDocFlags } from '../lib/featureFlags.js';
import { EXTERNAL_DOC_MAX_REFS_PER_RUN, EXTERNAL_DOC_MAX_TOTAL_RESOLVER_MS } from '../lib/constants.js';
import type { ResolvedDocument } from './externalDocumentResolverTypes.js';

// Re-export the pure helpers for callers and tests
export { processContextPool };

// ---------------------------------------------------------------------------
// Skill-typed scheduled task run instructions
//
// When a scheduled task brief contains `"type": "<skill>_run"`, this function
// loads the corresponding skill markdown file and extracts the
// `## Scheduled Run Instructions` section to prepend to taskInstructions.
//
// Phase 4 scope: currently handles `monitor_webpage_run`.
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILLS_DIR = resolve(__dirname, '../skills');
const SCHEDULED_RUN_SECTION_HEADER = '## Scheduled Run Instructions';

/**
 * Extract `## Scheduled Run Instructions` from a skill markdown file.
 * Returns null if the section is not present or the skill file doesn't exist.
 */
async function loadSkillRunInstructions(skillSlug: string): Promise<string | null> {
  try {
    const filePath = resolve(SKILLS_DIR, `${skillSlug}.md`);
    const content = await readFile(filePath, 'utf8');
    const headerIdx = content.indexOf(SCHEDULED_RUN_SECTION_HEADER);
    if (headerIdx === -1) return null;

    // Extract from the header to the next `##` section or end of file
    const afterHeader = content.slice(headerIdx + SCHEDULED_RUN_SECTION_HEADER.length);
    const nextSection = afterHeader.search(/\n##\s/);
    const sectionContent = nextSection === -1 ? afterHeader : afterHeader.slice(0, nextSection);

    return `${SCHEDULED_RUN_SECTION_HEADER}\n${sectionContent.trim()}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Run Context Loader (spec §7.1)
//
// Single entry point for assembling the context data pool that an agent run
// will see. Merges four scopes — agent / subaccount / scheduled_task /
// task_instance — resolves same-name overrides, enforces the eager budget,
// caps the lazy manifest, and exposes the scheduled task's instructions as
// a dedicated system prompt layer.
//
// Returns a RunContextData blob that:
//   - `eager`              — full list of eager sources (filter by includedInPrompt)
//   - `manifest`           — full list of lazy sources (used by read_data_source)
//   - `manifestForPrompt`  — capped subset rendered into the system prompt
//   - `manifestElidedCount`— count of lazy entries omitted from the prompt
//   - `suppressed`         — override losers (snapshot only)
//   - `taskInstructions`   — scheduled task description, if applicable
// ---------------------------------------------------------------------------

/**
 * Minimal subset of the agent run request that the loader needs.
 * Avoids importing the full AgentRunRequest type (which causes circular
 * imports with agentExecutionService) while staying strictly typed.
 */
export interface RunContextLoadRequest {
  agentId: string;
  organisationId: string;
  subaccountAgentId?: string | null;
  taskId?: string | null;
  triggerContext?: unknown;
  runId?: string | null;
  subaccountId?: string | null;
  tokenBudget?: number;
}

export interface RunContextData {
  /** Eager sources, full list. Filter by `includedInPrompt` to get the render set. */
  eager: LoadedDataSource[];
  /** Lazy sources, full list. Used by the read_data_source skill handler. */
  manifest: LoadedDataSource[];
  /** Capped subset of the manifest rendered into the system prompt. */
  manifestForPrompt: LoadedDataSource[];
  /** How many manifest entries were omitted from the prompt (for the elision note). */
  manifestElidedCount: number;
  /** Sources suppressed by same-name override — snapshot only. */
  suppressed: LoadedDataSource[];
  /** Scheduled task description, when the run was fired by a scheduled task. */
  taskInstructions: string | null;
  /** Assembled external document blocks for injection into the prompt. */
  externalDocumentBlocks: string[];
}

// ---------------------------------------------------------------------------
// External document reference helpers — private to this module
// ---------------------------------------------------------------------------

interface GDriveRefRow {
  kind: 'reference_document' | 'agent_data_source';
  id: string;
  attachmentOrder: number;
  createdAt: string;
  connectionId: string;
  fileId: string;
  mimeType: string;
  name: string;
  fetchFailurePolicy: 'tolerant' | 'strict' | 'best_effort';
}

/**
 * Query agent_data_sources for google_drive source_type rows matching the
 * same scope conditions as fetchDataSourcesByScope. Returns GDriveRefRow[]
 * so they can be merged with reference_documents in loadExternalDocumentBlocks.
 */
async function queryGoogleDriveAgentSources(scope: DataSourceScope, organisationId: string): Promise<GDriveRefRow[]> {
  const db = getOrgScopedDb('runContextLoader.queryGoogleDriveAgentSources');
  const scopeConditions = [
    and(
      eq(agentDataSources.agentId, scope.agentId),
      isNull(agentDataSources.subaccountAgentId),
      isNull(agentDataSources.scheduledTaskId),
    ),
  ];
  if (scope.subaccountAgentId) {
    scopeConditions.push(
      and(
        eq(agentDataSources.agentId, scope.agentId),
        eq(agentDataSources.subaccountAgentId, scope.subaccountAgentId),
      )
    );
  }
  if (scope.scheduledTaskId) {
    scopeConditions.push(eq(agentDataSources.scheduledTaskId, scope.scheduledTaskId));
  }

  const rows = await db
    .select({
      id: agentDataSources.id,
      connectionId: agentDataSources.connectionId,
      fileId: agentDataSources.sourcePath,
      mimeType: agentDataSources.contentType,
      name: agentDataSources.name,
      priority: agentDataSources.priority,
      createdAt: agentDataSources.createdAt,
    })
    .from(agentDataSources)
    .where(and(eq(agentDataSources.sourceType, 'google_drive'), or(...scopeConditions)));

  return rows.map((r) => ({
    kind: 'agent_data_source' as const,
    id: r.id,
    attachmentOrder: r.priority,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    connectionId: r.connectionId ?? '',
    fileId: r.fileId ?? '',
    mimeType: r.mimeType ?? '',
    name: r.name ?? '',
    fetchFailurePolicy: 'tolerant' as const,
  }));
}

/**
 * Load task-scoped external document references from reference_documents
 * via bundle joins for a specific task id.
 */
async function loadTaskExternalRefs(taskId: string, organisationId: string): Promise<GDriveRefRow[]> {
  const db = getOrgScopedDb('runContextLoader.loadTaskExternalRefs');
  const rows = await db
    .select({
      id: referenceDocuments.id,
      connectionId: referenceDocuments.externalConnectionId,
      fileId: referenceDocuments.externalFileId,
      mimeType: referenceDocuments.externalFileMimeType,
      name: referenceDocuments.externalFileName,
      attachmentOrder: referenceDocuments.attachmentOrder,
      createdAt: referenceDocuments.createdAt,
      fetchFailurePolicy: documentBundleAttachments.fetchFailurePolicy,
    })
    .from(documentBundleAttachments)
    .innerJoin(
      documentBundleMembers,
      and(
        eq(documentBundleMembers.bundleId, documentBundleAttachments.bundleId),
        isNull(documentBundleMembers.deletedAt),
      ),
    )
    .innerJoin(
      referenceDocuments,
      and(
        eq(referenceDocuments.id, documentBundleMembers.documentId),
        eq(referenceDocuments.organisationId, organisationId),
        eq(referenceDocuments.sourceType, 'google_drive'),
        isNull(referenceDocuments.deletedAt),
      ),
    )
    .where(
      and(
        eq(documentBundleAttachments.subjectType, 'task'),
        eq(documentBundleAttachments.subjectId, taskId),
        isNull(documentBundleAttachments.deletedAt),
      ),
    );

  return rows.map((r) => ({
    kind: 'reference_document' as const,
    id: r.id,
    attachmentOrder: r.attachmentOrder ?? 0,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    connectionId: r.connectionId ?? '',
    fileId: r.fileId ?? '',
    mimeType: r.mimeType ?? '',
    name: r.name ?? '',
    fetchFailurePolicy: (r.fetchFailurePolicy ?? 'tolerant') as 'tolerant' | 'strict' | 'best_effort',
  }));
}

/**
 * Resolve external document blocks for injection into the agent run prompt.
 * Implements kill-switch, resolution flag, dedup, quota cap, wall-clock
 * budget enforcement, per-doc token cap, and failure policy routing.
 */
async function loadExternalDocumentBlocks(
  agentSourceRows: GDriveRefRow[],
  request: RunContextLoadRequest,
): Promise<string[]> {
  // Kill switch
  if (externalDocFlags.systemDisabled) return [];
  // Resolution flag
  if (!externalDocFlags.resolutionEnabled) return [];
  // Subaccount guard — document_cache requires non-null subaccount_id
  if (!request.subaccountId) return [];

  // Merge agent sources with task-scoped reference docs
  let allRefs: GDriveRefRow[] = [...agentSourceRows];
  if (request.taskId) {
    const taskRefs = await loadTaskExternalRefs(request.taskId, request.organisationId);
    allRefs = [...allRefs, ...taskRefs];
  }

  // Combine into MergedReference list and sort
  const mergedInput: (MergedReference & { meta: GDriveRefRow })[] = allRefs.map((r) => ({
    kind: r.kind,
    id: r.id,
    attachmentOrder: r.attachmentOrder,
    createdAt: r.createdAt,
    meta: r,
  }));

  const ordered = mergeAndOrderReferences(mergedInput) as (MergedReference & { meta: GDriveRefRow })[];

  if (ordered.length === 0) return [];

  // Dedup on google_drive:fileId:connectionId
  const seen = new Map<string, true>();
  const deduped: (MergedReference & { meta: GDriveRefRow })[] = [];
  for (const ref of ordered) {
    const key = `google_drive:${ref.meta.fileId}:${ref.meta.connectionId}`;
    if (seen.has(key)) continue;
    seen.set(key, true);
    deduped.push(ref);
  }

  // Cap at EXTERNAL_DOC_MAX_REFS_PER_RUN
  const withinQuota = deduped.slice(0, EXTERNAL_DOC_MAX_REFS_PER_RUN);
  const overQuota = deduped.slice(EXTERNAL_DOC_MAX_REFS_PER_RUN);

  const perDocTokenBudget = request.tokenBudget != null
    ? Math.floor(request.tokenBudget * 0.3)
    : undefined;

  const blocks: string[] = [];
  const resolvedLite: { id: string; tokensUsed: number; failureReason: null }[] = [];
  const wallClockStart = Date.now();

  for (const ref of withinQuota) {
    const meta = ref.meta;

    // Wall-clock budget check — §17.5 no-silent-partial-success: write audit row
    if (Date.now() - wallClockStart >= EXTERNAL_DOC_MAX_TOTAL_RESOLVER_MS) {
      blocks.push(`[External reference unavailable — budget_exceeded. This document was attached but could not be fetched.]`);
      // Fire-and-forget: failure to write the audit row must not break the run.
      // Skipped if subaccountId is absent (the subaccount column is NOT NULL).
      if (request.subaccountId) {
        getOrgScopedDb('runContextLoader.loadExternalDocumentBlocks.budgetExceeded')
          .insert(documentFetchEvents).values({
            organisationId: request.organisationId,
            subaccountId: request.subaccountId,
            referenceId: meta.id,
            referenceType: meta.kind === 'reference_document' ? 'reference_document' : 'agent_data_source',
            runId: request.runId ?? null,
            cacheHit: false,
            provider: 'google_drive',
            docName: meta.name,
            revisionId: null,
            tokensUsed: 0,
            failureReason: 'budget_exceeded',
            resolverVersion: 1,
          }).catch((err: unknown) => {
            console.error('[runContextLoader] Failed to write budget_exceeded fetch event', err);
          });
      }
      continue;
    }

    let resolved: ResolvedDocument;
    try {
      resolved = await externalDocumentResolverService.resolve({
        referenceId: meta.id,
        referenceType: meta.kind,
        organisationId: request.organisationId,
        subaccountId: request.subaccountId,
        connectionId: meta.connectionId,
        fileId: meta.fileId,
        expectedMimeType: meta.mimeType,
        docName: meta.name,
        runId: request.runId ?? null,
      });
    } catch {
      blocks.push(`[External document "${meta.name}" could not be resolved]`);
      continue;
    }

    // Determine effective failure policy
    const effectivePolicy: 'tolerant' | 'strict' | 'best_effort' =
      externalDocFlags.failurePoliciesEnabled ? meta.fetchFailurePolicy : 'tolerant';

    // Derive state from resolved document
    const state: 'active' | 'degraded' | 'broken' =
      resolved.failureReason === null
        ? 'active'
        : resolved.content.length > 0
          ? 'degraded'
          : 'broken';

    const policyAction = applyFailurePolicy(effectivePolicy, { state });

    if (policyAction.action === 'block_run') {
      throw new Error(
        `External document "${meta.name}" fetch failed with policy "${effectivePolicy}": ${resolved.failureReason}`
      );
    }

    if (policyAction.action === 'skip_reference') {
      blocks.push(`[External reference unavailable — ${resolved.failureReason}. This document was attached but could not be fetched.]`);
      continue;
    }

    // inject_active, serve_stale_with_warning, serve_stale_silent — inject content
    let content = resolved.content;

    // Per-doc token cap (30% of tokenBudget)
    if (perDocTokenBudget != null) {
      const tokens = countTokensApprox(content);
      if (tokens > perDocTokenBudget) {
        content = truncateContentToTokenBudget(content, perDocTokenBudget).content;
      }
    }

    const header = buildProvenanceHeader({
      docName: resolved.provenance.docName,
      fetchedAt: resolved.provenance.fetchedAt,
      revisionId: resolved.provenance.revisionId,
      isStale: resolved.provenance.isStale,
    });

    blocks.push(`${header}\n${content}`);
    resolvedLite.push({ id: meta.id, tokensUsed: countTokensApprox(content), failureReason: null });
  }

  // Quota-exceeded placeholder blocks
  for (const ref of overQuota) {
    blocks.push(`[External document "${ref.meta.name}" skipped: quota exceeded (max ${EXTERNAL_DOC_MAX_REFS_PER_RUN} per run)]`);
  }

  // Informational run-budget enforcement (does not mutate blocks)
  if (request.tokenBudget != null) {
    enforceRunBudget(resolvedLite, request.tokenBudget);
  }

  // Fragmentation warning
  const warning = smallDocumentFragmentationWarning(resolvedLite);
  if (warning) {
    console.warn(`[runContextLoader] External doc fragmentation: ${warning.message}`);
  }

  return blocks;
}

export async function loadRunContextData(
  request: RunContextLoadRequest
): Promise<RunContextData> {
  const pool: LoadedDataSource[] = [];

  // 1. Load agent_data_sources across all applicable scopes
  const triggerScheduledTaskId = resolveScheduledTaskIdPure(request.triggerContext);
  const scope: DataSourceScope = {
    agentId: request.agentId,
    subaccountAgentId: request.subaccountAgentId ?? null,
    scheduledTaskId: triggerScheduledTaskId,
  };

  // Pre-load google_drive agent sources — these are handled by the external
  // document resolver pipeline and must be excluded from the regular pool.
  const googleDriveSourceRows = await queryGoogleDriveAgentSources(scope, request.organisationId);
  const googleDriveIds = new Set(googleDriveSourceRows.map((r) => r.id));

  const scopedSources = await fetchDataSourcesByScope(scope);
  // Filter out google_drive sources — they flow through the resolver pipeline
  pool.push(...scopedSources.filter((s) => !googleDriveIds.has(s.id)));

  // 2. Load task instance attachments if the run targets a specific task
  if (request.taskId) {
    const taskAtts = await loadTaskAttachmentsAsContext(
      request.taskId,
      request.organisationId,
    );
    pool.push(...taskAtts);
  }

  // 3. Resolve scheduled task instructions (the "Task Instructions" layer)
  let taskInstructions: string | null = null;
  if (triggerScheduledTaskId) {
    const [rawSt] = await getOrgScopedDb('runContextLoader.loadRunContextData.scheduledTask')
      .select({
        description: scheduledTasks.description,
        brief: scheduledTasks.brief,
        organisationId: scheduledTasks.organisationId,
      })
      .from(scheduledTasks)
      .where(
        and(
          eq(scheduledTasks.id, triggerScheduledTaskId),
          // Defense-in-depth: scheduledTaskId is sourced from caller-supplied
          // triggerContext, so we must scope by the run's own organisationId
          // rather than trust the id in isolation.
          eq(scheduledTasks.organisationId, request.organisationId),
        )
      );
    // P1.1 Layer 2 scope assertion — belt-and-suspenders on the scheduled
    // task description that will land in the LLM system prompt window.
    const st = assertScopeSingle(
      rawSt ?? null,
      { organisationId: request.organisationId },
      'runContextLoader.loadRunContextData.scheduledTask',
    );
    if (st?.description && st.description.trim().length > 0) {
      taskInstructions = st.description.trim();
    }

    // Inject skill-typed run protocol from skill markdown file.
    // If the brief is a JSON string with "type": "<skill>_run", load the
    // corresponding skill file's ## Scheduled Run Instructions section.
    if (st) {
      const brief = st.brief;
      if (brief && typeof brief === 'string') {
        try {
          const parsed = JSON.parse(brief) as Record<string, unknown>;
          const briefType = typeof parsed.type === 'string' ? parsed.type : null;
          const typeMatch = briefType?.match(/^([a-z_]+)_run$/);
          if (typeMatch) {
            const skillSlug = typeMatch[1]; // e.g. "monitor_webpage"
            const runInstructions = await loadSkillRunInstructions(skillSlug);
            if (runInstructions) {
              taskInstructions = taskInstructions
                ? `${taskInstructions}\n\n${runInstructions}`
                : runInstructions;
            }
          }
        } catch {
          // brief is not valid JSON — skip skill-typed injection
        }
      }
    }
  }

  // Phase 1D: Compute task embedding for relevance ranking
  if (taskInstructions) {
    const taskEmbedding = await generateEmbedding(taskInstructions);
    if (taskEmbedding) {
      // Compute content embeddings for eager sources (on-the-fly)
      const eagerSources = pool.filter(s => s.loadingMode === 'eager');
      const embeddingPromises = eagerSources.slice(0, 20).map(async (source) => {
        if (source.content) {
          const emb = await generateEmbedding(source.content.slice(0, 2000));
          if (emb) {
            (source as LoadedDataSource & { embedding?: number[] }).embedding = emb;
          }
        }
      });
      await Promise.all(embeddingPromises);
      rankContextPoolByRelevance(pool, taskEmbedding);
    }
  }

  // Steps 4-9 — pure post-fetch processing
  const processed: ProcessedContextPool = processContextPool(pool);

  // Phase 5: Resolve external document references
  const externalDocumentBlocks = await loadExternalDocumentBlocks(googleDriveSourceRows, request);

  return {
    ...processed,
    taskInstructions,
    externalDocumentBlocks,
  };
}

import { eq, and, isNull, asc, desc, inArray, ne, sql as drizzleSql } from 'drizzle-orm';
import * as fs from 'node:fs';
import { db } from '../db/index.js';
import { agents, agentDataSources, users, agentPromptRevisions, scheduledTasks, agentTriggers as agentTriggersTable, agentRuns, skills, subaccountAgents } from '../db/schema/index.js';
import { computeAgentEtag } from '../lib/agentEtag.js';
import { diffByIdentityKey } from '../lib/identityKeyDiff.js';
import { auditService } from './auditService.js';
import { connectionTokenService } from './connectionTokenService.js';
import { getS3Client, getBucketName } from '../lib/storage.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { approxTokens } from './llmService.js';
import { v4 as uuidv4 } from 'uuid';

import type { AgentPersonality, AgentFull } from './agentService/types.js';
export type { AgentPersonality, AgentRunPreview, AgentFull, DataSourceScope, LoadedDataSource } from './agentService/types.js';

import { dataSourceCache, lastGoodContentCache, setCachedContent } from './agentService/caches.js';

import { dataSyncScheduler } from './agentService/scheduler.js';
export { dataSyncScheduler };

export { loadSourceContent } from './agentService/externalFetchers.js';
import { fetchSourceContent, formatContent, loadSourceContent } from './agentService/externalFetchers.js';
import { fetchDataSourcesByScope, fetchAgentDataSources } from './agentService/dataSourceScope.js';
export { fetchDataSourcesByScope, fetchAgentDataSources } from './agentService/dataSourceScope.js';

import * as crudMethods from './agentService/crud.js';
import { makeSlug, _assertNotSystemManaged, _assertEtag } from './agentService/helpers.js';
import { agentDataSourcesMethods } from './agentService/agentDataSources.js';

export const agentService = {
  ...crudMethods,
  _assertNotSystemManaged,
  _assertEtag,

  ...agentDataSourcesMethods,

  fetchAgentDataSources,
  fetchDataSourcesByScope,
  loadSourceContent,

  // ─── Scheduled task data sources (spec §6.4) ──────────────────────────────
  //
  // These methods mirror the agent-level CRUD but scope attachments to a
  // specific scheduled task. They all verify that the scheduled task belongs
  // to `organisationId` before any read or write to guard against cross-org
  // tampering via guessed ids.

  /**
   * Helper: load a scheduled task and verify org ownership.
   * Throws 404 if the task does not exist or belongs to a different org.
   */
  async _getScheduledTaskOrThrow(scheduledTaskId: string, organisationId: string) {
    const [st] = await db
      .select()
      .from(scheduledTasks)
      .where(
        and(
          eq(scheduledTasks.id, scheduledTaskId),
          eq(scheduledTasks.organisationId, organisationId),
        )
      );
    if (!st) throw { statusCode: 404, message: 'Scheduled task not found' };
    return st;
  },

  async listScheduledTaskDataSources(scheduledTaskId: string, organisationId: string) {
    await this._getScheduledTaskOrThrow(scheduledTaskId, organisationId);
    return db
      .select()
      .from(agentDataSources)
      .where(eq(agentDataSources.scheduledTaskId, scheduledTaskId))
      .orderBy(asc(agentDataSources.priority));
  },

  async addScheduledTaskDataSource(
    scheduledTaskId: string,
    organisationId: string,
    data: {
      name: string;
      description?: string;
      sourceType: 'r2' | 's3' | 'http_url' | 'google_docs' | 'dropbox' | 'file_upload' | 'google_drive';
      sourcePath?: string;
      sourceHeaders?: Record<string, string>;
      contentType?: 'json' | 'csv' | 'markdown' | 'text' | 'auto';
      syncMode?: 'lazy' | 'proactive';
      priority?: number;
      maxTokenBudget?: number;
      cacheMinutes?: number;
      connectionId?: string;
    },
    actorUserId?: string
  ) {
    const st = await this._getScheduledTaskOrThrow(scheduledTaskId, organisationId);

    // file_upload is always static — force lazy and ignore any syncMode provided
    const syncMode = data.sourceType === 'file_upload' ? 'lazy' : (data.syncMode ?? 'lazy');

    const [source] = await db
      .insert(agentDataSources)
      .values({
        agentId: st.assignedAgentId,
        scheduledTaskId,
        name: data.name,
        description: data.description,
        sourceType: data.sourceType,
        sourcePath: data.sourcePath ?? '',
        sourceHeaders: data.sourceHeaders ? connectionTokenService.encryptToken(JSON.stringify(data.sourceHeaders)) : undefined,
        contentType: data.contentType ?? 'auto',
        syncMode,
        priority: data.priority ?? 0,
        maxTokenBudget: data.maxTokenBudget ?? 8000,
        cacheMinutes: data.cacheMinutes ?? 60,
        connectionId: data.connectionId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    if (source.syncMode === 'proactive') {
      dataSyncScheduler.schedule(source.id, source.cacheMinutes * 60 * 1000);
    }

    // Audit event (spec §10.5 / pr-reviewer Blocker 3)
    await auditService.log({
      organisationId,
      actorId: actorUserId,
      actorType: actorUserId ? 'user' : 'system',
      action: 'scheduled_task.data_source.created',
      entityType: 'scheduled_task_data_source',
      entityId: source.id,
      metadata: {
        scheduledTaskId,
        name: source.name,
        sourceType: source.sourceType,
      },
    });

    return source;
  },

  async updateScheduledTaskDataSource(
    sourceId: string,
    scheduledTaskId: string,
    organisationId: string,
    data: Partial<{
      name: string;
      description: string | null;
      sourcePath: string;
      sourceHeaders?: Record<string, string> | null;
      contentType: 'json' | 'csv' | 'markdown' | 'text' | 'auto';
      syncMode: 'lazy' | 'proactive';
      priority: number;
      maxTokenBudget: number;
      cacheMinutes: number;
    }>,
    actorUserId?: string
  ) {
    await this._getScheduledTaskOrThrow(scheduledTaskId, organisationId);

    const [existing] = await db
      .select()
      .from(agentDataSources)
      .where(
        and(
          eq(agentDataSources.id, sourceId),
          eq(agentDataSources.scheduledTaskId, scheduledTaskId),
        )
      );
    if (!existing) throw { statusCode: 404, message: 'Data source not found' };

    // Build the update payload as a properly-typed Drizzle partial.
    // (pr-reviewer Major 1: previously cast to `never` which bypassed
    // Drizzle's column type checking entirely.)
    const update: Partial<typeof agentDataSources.$inferInsert> = { updatedAt: new Date() };
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.sourcePath !== undefined) update.sourcePath = data.sourcePath;
    if (data.sourceHeaders !== undefined) update.sourceHeaders = data.sourceHeaders ? connectionTokenService.encryptToken(JSON.stringify(data.sourceHeaders)) : null;
    if (data.contentType !== undefined) update.contentType = data.contentType;
    if (data.priority !== undefined) update.priority = data.priority;
    if (data.maxTokenBudget !== undefined) update.maxTokenBudget = data.maxTokenBudget;
    if (data.cacheMinutes !== undefined) update.cacheMinutes = data.cacheMinutes;
    if (data.syncMode !== undefined && existing.sourceType !== 'file_upload') {
      update.syncMode = data.syncMode;
    }

    if (data.sourcePath !== undefined) {
      dataSourceCache.delete(sourceId);
      lastGoodContentCache.delete(sourceId);
    }

    const [updated] = await db
      .update(agentDataSources)
      .set(update)
      .where(
        and(
          eq(agentDataSources.id, sourceId),
          // Re-assert the scheduled-task ownership in the UPDATE itself.
          // The earlier select() proved ownership at read time, but a
          // concurrent request targeting the same sourceId could otherwise
          // race past it. The composite WHERE makes the UPDATE a no-op
          // unless the row still belongs to this scheduled task.
          eq(agentDataSources.scheduledTaskId, scheduledTaskId),
        )
      )
      .returning();
    if (!updated) throw { statusCode: 404, message: 'Data source not found' };

    if (updated.syncMode === 'proactive') {
      dataSyncScheduler.schedule(updated.id, updated.cacheMinutes * 60 * 1000);
    } else {
      dataSyncScheduler.cancel(updated.id);
    }

    // Audit event (spec §10.5 / pr-reviewer Blocker 3)
    await auditService.log({
      organisationId,
      actorId: actorUserId,
      actorType: actorUserId ? 'user' : 'system',
      action: 'scheduled_task.data_source.updated',
      entityType: 'scheduled_task_data_source',
      entityId: updated.id,
      metadata: {
        scheduledTaskId,
        name: updated.name,
        changedFields: Object.keys(data),
      },
    });

    return updated;
  },

  async deleteScheduledTaskDataSource(
    sourceId: string,
    scheduledTaskId: string,
    organisationId: string,
    actorUserId?: string
  ) {
    await this._getScheduledTaskOrThrow(scheduledTaskId, organisationId);

    const [existing] = await db
      .select()
      .from(agentDataSources)
      .where(
        and(
          eq(agentDataSources.id, sourceId),
          eq(agentDataSources.scheduledTaskId, scheduledTaskId),
        )
      );
    if (!existing) throw { statusCode: 404, message: 'Data source not found' };

    dataSyncScheduler.cancel(sourceId);
    dataSourceCache.delete(sourceId);
    lastGoodContentCache.delete(sourceId);
    await db
      .delete(agentDataSources)
      .where(
        and(
          eq(agentDataSources.id, sourceId),
          // Reassert scheduled-task ownership in the DELETE statement to
          // close the TOCTOU window between the existence check above and
          // the destructive write below.
          eq(agentDataSources.scheduledTaskId, scheduledTaskId),
        )
      );

    // Audit event (spec §10.5 / pr-reviewer Blocker 3)
    await auditService.log({
      organisationId,
      actorId: actorUserId,
      actorType: actorUserId ? 'user' : 'system',
      action: 'scheduled_task.data_source.deleted',
      entityType: 'scheduled_task_data_source',
      entityId: sourceId,
      metadata: {
        scheduledTaskId,
        name: existing.name,
        sourceType: existing.sourceType,
      },
    });

    return { message: 'Data source removed' };
  },

  async testScheduledTaskDataSource(
    sourceId: string,
    scheduledTaskId: string,
    organisationId: string
  ) {
    await this._getScheduledTaskOrThrow(scheduledTaskId, organisationId);

    const [source] = await db
      .select()
      .from(agentDataSources)
      .where(
        and(
          eq(agentDataSources.id, sourceId),
          eq(agentDataSources.scheduledTaskId, scheduledTaskId),
        )
      );
    if (!source) throw { statusCode: 404, message: 'Data source not found' };

    dataSourceCache.delete(sourceId);

    try {
      const raw = await fetchSourceContent(source);
      const content = formatContent(raw, source.contentType);
      const tokenCount = approxTokens(content);

      lastGoodContentCache.set(sourceId, content);
      setCachedContent(sourceId, content, source.cacheMinutes);
      await db.update(agentDataSources)
        .set({ lastFetchedAt: new Date(), lastFetchStatus: 'ok', lastFetchError: null, updatedAt: new Date() })
        .where(eq(agentDataSources.id, sourceId));

      return {
        ok: true,
        tokenCount,
        preview: content.slice(0, 500) + (content.length > 500 ? '...' : ''),
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      await db.update(agentDataSources)
        .set({ lastFetchedAt: new Date(), lastFetchStatus: 'error', lastFetchError: errMsg, updatedAt: new Date() })
        .where(eq(agentDataSources.id, sourceId));
      return { ok: false, error: errMsg };
    }
  },

  /**
   * Upload a file AND create the data source row in a single atomic call.
   * Previously the route called this and then made a second request to
   * `addScheduledTaskDataSource` — if the second request failed, the file
   * would orphan in S3 indefinitely. Combining the two into one service
   * method ensures that if the DB insert fails after the upload, we
   * best-effort clean up the S3 object before propagating the error.
   * (pr-reviewer Major 4.)
   *
   * Caller passes display metadata (name / description / contentType /
   * priority) so the row matches what the operator intended in the upload form.
   */
  async uploadScheduledTaskDataSourceFile(
    scheduledTaskId: string,
    organisationId: string,
    file: Express.Multer.File,
    metadata: {
      name: string;
      description?: string;
      contentType?: 'json' | 'csv' | 'markdown' | 'text' | 'auto';
      priority?: number;
      maxTokenBudget?: number;
    },
    actorUserId?: string
  ) {
    const st = await this._getScheduledTaskOrThrow(scheduledTaskId, organisationId);

    const fileId = uuidv4();
    const storagePath = `scheduled-task-data-sources/${scheduledTaskId}/${fileId}-${file.originalname}`;

    // `validateMultipart` uses `multer.diskStorage` (spec §6.1) so files arrive
    // on disk at `file.path`, not in `file.buffer`. Stream from disk.
    const s3 = getS3Client();
    await s3.send(new PutObjectCommand({
      Bucket: getBucketName(),
      Key: storagePath,
      Body: fs.createReadStream(file.path),
      ContentLength: file.size,
      ContentType: file.mimetype,
    }));

    // From here on, if anything fails we must best-effort delete the
    // uploaded object so it doesn't orphan.
    try {
      const [source] = await db
        .insert(agentDataSources)
        .values({
          agentId: st.assignedAgentId,
          scheduledTaskId,
          name: metadata.name,
          description: metadata.description,
          sourceType: 'file_upload',
          sourcePath: storagePath,
          contentType: metadata.contentType ?? 'auto',
          syncMode: 'lazy', // file_upload is always static
          priority: metadata.priority ?? 0,
          maxTokenBudget: metadata.maxTokenBudget ?? 8000,
          cacheMinutes: 60,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      await auditService.log({
        organisationId,
        actorId: actorUserId,
        actorType: actorUserId ? 'user' : 'system',
        action: 'scheduled_task.data_source.created',
        entityType: 'scheduled_task_data_source',
        entityId: source.id,
        metadata: {
          scheduledTaskId,
          name: source.name,
          sourceType: 'file_upload',
          fileName: file.originalname,
          fileSizeBytes: file.size,
        },
      });

      return source;
    } catch (err) {
      // Best-effort cleanup — we don't want to fail the original error if
      // the cleanup itself fails, so swallow any cleanup error and log it.
      try {
        const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
        await s3.send(new DeleteObjectCommand({ Bucket: getBucketName(), Key: storagePath }));
      } catch (cleanupErr) {
        console.error(
          '[agentService] Failed to clean up orphaned upload after insert error:',
          { storagePath, cleanupErr }
        );
      }
      throw err;
    }
  },

  // Note: previewScheduledTaskReassignment was removed in the pr-reviewer
  // hardening pass. The cascade itself in scheduledTaskService.update is
  // implemented and transactional, but the UI flow that would have called
  // this preview endpoint was deferred — there's no agent picker in the
  // ScheduledTaskDetailPage edit form yet. When the agent reassignment UI
  // lands, restore this method (it was a pure read with no side effects)
  // and re-add the GET /reassignment-preview route in scheduledTasks.ts.

  // ---------------------------------------------------------------------------
  // Consolidation Build — C1: Full agent payload + tab-scoped writes
  // ---------------------------------------------------------------------------

  /**
   * Retrieve the full agent payload used by the Build tab-editor UI.
   * All arrays are ordered per INVARIANT-Q1-A (createdAt ASC, id ASC) to
   * ensure deterministic ETag computation.
   */
  async getFull(agentId: string, orgId: string): Promise<AgentFull> {
    const agentDataSourcesTable = agentDataSources;

    const [rawAgent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.organisationId, orgId), isNull(agents.deletedAt)));

    if (!rawAgent) throw { statusCode: 404, message: 'Agent not found', errorCode: 'AGENT_NOT_FOUND' };

    // ── Skills (from defaultSkillSlugs joined to skills table) ──────────────
    const slugs: string[] = (rawAgent.defaultSkillSlugs ?? []) as string[];
    let skillRows: Array<{ id: string; key: string; name: string; configJson: unknown; status: 'enabled' | 'disabled' }> = [];
    if (slugs.length > 0) {
      const rows = await db
        .select({ id: skills.id, slug: skills.slug, name: skills.name, isActive: skills.isActive, createdAt: skills.createdAt })
        .from(skills)
        .where(inArray(skills.slug, slugs))
        .orderBy(asc(skills.createdAt), asc(skills.id));
      skillRows = rows.map((s) => ({
        id: s.id,
        key: s.slug,
        name: s.name,
        configJson: {},
        status: s.isActive ? 'enabled' as const : 'disabled' as const,
      }));
    }

    // ── Data Sources (org-level only: subaccountAgentId IS NULL, scheduledTaskId IS NULL) ─
    const dataSources = await db
      .select()
      .from(agentDataSourcesTable)
      .where(
        and(
          eq(agentDataSourcesTable.agentId, agentId),
          drizzleSql`${agentDataSourcesTable.subaccountAgentId} IS NULL`,
          drizzleSql`${agentDataSourcesTable.scheduledTaskId} IS NULL`,
        )
      )
      .orderBy(asc(agentDataSourcesTable.createdAt), asc(agentDataSourcesTable.id));

    // ── Triggers ─────────────────────────────────────────────────────────────
    // agentTriggers has no direct agentId FK — triggers link to agents through
    // subaccountAgents. We do a two-step query: find subaccountAgent IDs for
    // this org-level agent, then fetch triggers scoped to those IDs.
    const subaccountAgentRows = await db
      .select({ id: subaccountAgents.id })
      .from(subaccountAgents)
      .where(and(eq(subaccountAgents.agentId, agentId), eq(subaccountAgents.organisationId, orgId)));

    const saIds = subaccountAgentRows.map((sa) => sa.id);

    const triggers = saIds.length > 0
      ? await db
          .select()
          .from(agentTriggersTable)
          .where(
            and(
              inArray(agentTriggersTable.subaccountAgentId, saIds),
              isNull(agentTriggersTable.deletedAt),
            )
          )
          .orderBy(asc(agentTriggersTable.createdAt), asc(agentTriggersTable.id))
      : [];

    // ── Last 5 runs + 30d stats ───────────────────────────────────────────────
    const last5Runs = await db
      .select({
        id: agentRuns.id,
        status: agentRuns.status,
        startedAt: agentRuns.startedAt,
        completedAt: agentRuns.completedAt,
        durationMs: agentRuns.durationMs,
        inputTokens: agentRuns.inputTokens,
        outputTokens: agentRuns.outputTokens,
      })
      .from(agentRuns)
      .where(and(eq(agentRuns.agentId, agentId), eq(agentRuns.organisationId, orgId)))
      .orderBy(desc(agentRuns.startedAt), desc(agentRuns.id))
      .limit(5);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [stats30d] = await db
      .select({
        total: drizzleSql<number>`CAST(COUNT(*) AS INT)`,
        costUsd: drizzleSql<number>`COALESCE(SUM((${agentRuns.inputTokens} + ${agentRuns.outputTokens})::numeric / 1000000 * 3), 0)`,
      })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.agentId, agentId),
          eq(agentRuns.organisationId, orgId),
          drizzleSql`${agentRuns.createdAt} >= ${thirtyDaysAgo.toISOString()}`,
        )
      );

    // ── Budget ────────────────────────────────────────────────────────────────
    // Phase 1: agent LLM budget caps have no backing schema yet. These fields
    // are returned as null/zero and writes are accepted but not persisted.
    // Budget cap enforcement is a Phase 2 feature. The spendingBudgets table
    // is for agentic commerce spend (not LLM cost caps) and must not be
    // misread as dailyCapUsd / monthlyCapUsd values.
    const budget = {
      dailyCapUsd: null as number | null,
      monthlyCapUsd: null as number | null,
      warnThresholdPct: 0,
    };

    // ── Revision stats ────────────────────────────────────────────────────────
    const revisionStats = await db
      .select({
        count: drizzleSql<number>`COUNT(*)::int`,
        lastEditedAt: drizzleSql<string>`MAX(${agentPromptRevisions.createdAt})`,
        lastAuthorId: drizzleSql<string>`(ARRAY_AGG(${agentPromptRevisions.changedBy} ORDER BY ${agentPromptRevisions.createdAt} DESC))[1]`,
      })
      .from(agentPromptRevisions)
      .where(and(eq(agentPromptRevisions.agentId, agentId), eq(agentPromptRevisions.organisationId, orgId)));

    const revStat = revisionStats[0];
    let revisionAuthor: string | null = null;
    if (revStat?.lastAuthorId) {
      const authorRows = await db
        .select({ firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.id, revStat.lastAuthorId))
        .limit(1);
      revisionAuthor = authorRows.map(u => `${u.firstName} ${u.lastName}`.trim())[0] ?? null;
    }

    // ── Personality ───────────────────────────────────────────────────────────
    const rawPersonality = (rawAgent as unknown as { personality?: unknown }).personality;
    const personality: AgentPersonality = rawPersonality && typeof rawPersonality === 'object'
      ? rawPersonality as AgentPersonality
      : { traits: [], tone: '', description: '', enabled: false };

    const configure = {
      name: rawAgent.name,
      description: rawAgent.description ?? '',
      roleTitle: rawAgent.agentTitle ?? '',
      parentAgentId: rawAgent.parentAgentId ?? null,
      model: rawAgent.modelId,
      outputSize: (['compact', 'standard', 'extended'].includes(rawAgent.outputSize) ? rawAgent.outputSize : 'standard') as 'compact' | 'standard' | 'extended',
      allowSubaccountModelOverride: rawAgent.allowModelOverride,
      responseMode: rawAgent.responseMode as 'balanced' | 'expressive' | 'precise' | 'highly_creative',
    };

    const behaviour = {
      briefingTemplate: rawAgent.additionalPrompt ?? '',
      constraints: [] as string[],
    };

    const etagPayload = {
      configure,
      behaviour,
      personality,
      skills: skillRows.map((s) => ({ id: s.id, key: s.key, configJson: s.configJson, status: s.status })),
      dataSources: dataSources.map((d) => ({ id: d.id, kind: d.sourceType, ref: d.sourcePath, status: d.lastFetchStatus === 'ok' ? 'connected' as const : d.lastFetchStatus === 'error' ? 'error' as const : 'disconnected' as const })),
      triggers: triggers.map((t) => ({ id: t.id, kind: 'event' as const, spec: t.eventFilter ?? {}, status: t.isActive ? 'active' as const : 'paused' as const })),
      budget,
    };

    const etag = computeAgentEtag(etagPayload);

    return {
      id: rawAgent.id,
      etag,
      isSystemManaged: rawAgent.isSystemManaged,
      configure,
      behaviour,
      personality,
      skills: skillRows,
      dataSources: dataSources.map((d) => ({
        id: d.id,
        kind: d.sourceType,
        ref: d.sourcePath,
        status: d.lastFetchStatus === 'ok' ? 'connected' as const : d.lastFetchStatus === 'error' ? 'error' as const : 'disconnected' as const,
      })),
      triggers: triggers.map((t) => ({
        id: t.id,
        kind: 'event' as const,
        spec: t.eventFilter ?? {},
        status: t.isActive ? 'active' as const : 'paused' as const,
      })),
      budget,
      runs: {
        last5: last5Runs.map((r) => ({
          id: r.id,
          status: r.status,
          startedAt: r.startedAt?.toISOString() ?? '',
          completedAt: r.completedAt?.toISOString() ?? null,
          durationMs: r.durationMs ?? null,
          costUsd: ((r.inputTokens + r.outputTokens) / 1_000_000) * 3,
        })),
        total30d: Number(stats30d?.total ?? 0),
        cost30d: Number(stats30d?.costUsd ?? 0),
      },
      agentRevisionCount: revStat?.count ?? 1,
      lastRevisionEditedAt: revStat?.lastEditedAt ?? null,
      lastRevisionAuthor: revisionAuthor,
    };
  },

  async patchConfigure(
    agentId: string,
    orgId: string,
    expectedEtag: string,
    patch: Partial<AgentFull['configure']>,
    actor: { role?: string },
  ): Promise<AgentFull> {
    const current = await agentService.getFull(agentId, orgId);
    agentService._assertNotSystemManaged(current, actor.role);
    agentService._assertEtag(current, expectedEtag);

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) {
      const trimmedName = patch.name.trim();
      update.name = trimmedName;
      // Slug update: derive new slug from name (idempotent within org)
      const newSlug = makeSlug(trimmedName);
      // Check for slug conflict (excluding current agent)
      const [conflict] = await db
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(
            eq(agents.organisationId, orgId),
            eq(agents.slug, newSlug),
            ne(agents.id, agentId),
            isNull(agents.deletedAt),
          )
        );
      if (conflict) {
        throw { statusCode: 409, message: `An agent with slug "${newSlug}" already exists`, errorCode: 'SLUG_CONFLICT' };
      }
      update.slug = newSlug;
    }
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.roleTitle !== undefined) update.agentTitle = patch.roleTitle;
    if (patch.parentAgentId !== undefined) update.parentAgentId = patch.parentAgentId;
    if (patch.model !== undefined) update.modelId = patch.model;
    if (patch.outputSize !== undefined) update.outputSize = patch.outputSize;
    if (patch.allowSubaccountModelOverride !== undefined) update.allowModelOverride = patch.allowSubaccountModelOverride;
    if (patch.responseMode !== undefined) update.responseMode = patch.responseMode;

    await db.transaction(async (tx) => {
      await tx.update(agents).set(update).where(and(eq(agents.id, agentId), eq(agents.organisationId, orgId)));
    });

    return agentService.getFull(agentId, orgId);
  },

  async patchBehaviour(
    agentId: string,
    orgId: string,
    expectedEtag: string,
    patch: Partial<AgentFull['behaviour']>,
    actor: { role?: string },
  ): Promise<AgentFull> {
    const current = await agentService.getFull(agentId, orgId);
    agentService._assertNotSystemManaged(current, actor.role);
    agentService._assertEtag(current, expectedEtag);

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.briefingTemplate !== undefined) update.additionalPrompt = patch.briefingTemplate;
    // Phase 1: constraints are not persisted (additionalPrompt is a single text field).
    // If constraints are provided, they are accepted but not stored.
    // Frontend sends only briefingTemplate in Phase 1.

    await db.transaction(async (tx) => {
      await tx.update(agents).set(update).where(and(eq(agents.id, agentId), eq(agents.organisationId, orgId)));
    });

    return agentService.getFull(agentId, orgId);
  },

  async patchPersonality(
    agentId: string,
    orgId: string,
    expectedEtag: string,
    patch: Partial<AgentPersonality>,
    actor: { role?: string },
  ): Promise<AgentFull> {
    const current = await agentService.getFull(agentId, orgId);
    agentService._assertNotSystemManaged(current, actor.role);
    agentService._assertEtag(current, expectedEtag);

    const merged: AgentPersonality = {
      ...current.personality,
      ...patch,
    };

    await db.transaction(async (tx) => {
      // personality column is added by migration 0286
      await tx.execute(
        drizzleSql`
          UPDATE agents
          SET personality = ${JSON.stringify(merged)}::jsonb, updated_at = NOW()
          WHERE id = ${agentId} AND organisation_id = ${orgId}
        `
      );
    });

    return agentService.getFull(agentId, orgId);
  },

  async replaceSkills(
    agentId: string,
    orgId: string,
    expectedEtag: string,
    incoming: Array<{ id: string; key: string; name: string; configJson: unknown; status: 'enabled' | 'disabled' }>,
    options: { force?: boolean },
    actor: { role?: string },
  ): Promise<AgentFull> {
    const current = await agentService.getFull(agentId, orgId);
    agentService._assertNotSystemManaged(current, actor.role);
    agentService._assertEtag(current, expectedEtag);

    const diff = diffByIdentityKey(current.skills, incoming, (s) => s.id);

    if (!options.force && diff.silentlyRemoved.length > 0) {
      throw {
        statusCode: 409,
        message: 'Some skills would be removed. Pass force=true to confirm deletion.',
        errorCode: 'IDENTITY_KEY_DELETION_BLOCKED',
        removedIds: diff.silentlyRemoved.map((s) => s.id),
      };
    }

    // Audit: log identity-key removals if force=true (spec §4.2 identity-key safeguard + DEVELOPMENT_GUIDELINES §8.20)
    if (options.force && diff.silentlyRemoved.length > 0) {
      await auditService.log({
        action: 'agent_skills_removed_by_identity_key',
        organisationId: orgId,
        entityType: 'agent',
        entityId: agentId,
        actorType: 'system',
        metadata: {
          removedCount: diff.silentlyRemoved.length,
          removedSkillIds: diff.silentlyRemoved.map((s) => s.id),
          beforeCount: current.skills.length,
          afterCount: incoming.length,
        },
      });
    }

    // Derive new slugs list from incoming (added + updated = all that remain)
    const finalSlugs = incoming.map((s) => s.key);

    await db.transaction(async (tx) => {
      await tx.update(agents)
        .set({ defaultSkillSlugs: finalSlugs, updatedAt: new Date() })
        .where(and(eq(agents.id, agentId), eq(agents.organisationId, orgId)));
    });

    return agentService.getFull(agentId, orgId);
  },

  async replaceDataSources(
    agentId: string,
    orgId: string,
    expectedEtag: string,
    incoming: Array<{ id: string; kind: string; ref: string; status: 'connected' | 'disconnected' | 'error' }>,
    options: { force?: boolean },
    actor: { role?: string },
  ): Promise<AgentFull> {
    const agentDataSourcesTable = agentDataSources;

    const current = await agentService.getFull(agentId, orgId);
    agentService._assertNotSystemManaged(current, actor.role);
    agentService._assertEtag(current, expectedEtag);

    const diff = diffByIdentityKey(current.dataSources, incoming, (d) => d.id);

    if (!options.force && diff.silentlyRemoved.length > 0) {
      throw {
        statusCode: 409,
        message: 'Some data sources would be removed. Pass force=true to confirm deletion.',
        errorCode: 'IDENTITY_KEY_DELETION_BLOCKED',
        removedIds: diff.silentlyRemoved.map((d) => d.id),
      };
    }

    // Audit: log identity-key removals if force=true (spec §4.2 identity-key safeguard + DEVELOPMENT_GUIDELINES §8.20)
    if (options.force && diff.silentlyRemoved.length > 0) {
      await auditService.log({
        action: 'agent_data_sources_removed_by_identity_key',
        organisationId: orgId,
        entityType: 'agent',
        entityId: agentId,
        actorType: 'system',
        metadata: {
          removedCount: diff.silentlyRemoved.length,
          removedDataSourceIds: diff.silentlyRemoved.map((d) => d.id),
          beforeCount: current.dataSources.length,
          afterCount: incoming.length,
        },
      });
    }

    await db.transaction(async (tx) => {
      // Delete removed sources
      const toRemove = diff.silentlyRemoved.map((d) => d.id);
      if (toRemove.length > 0) {
        await tx.delete(agentDataSourcesTable).where(
          and(
            inArray(agentDataSourcesTable.id, toRemove),
            eq(agentDataSourcesTable.agentId, agentId),
          )
        );
      }
      // Update existing rows (sourcePath / sourceType)
      for (const d of diff.updated) {
        await tx.update(agentDataSourcesTable)
          .set({ sourcePath: d.ref, sourceType: d.kind as 'r2' | 's3' | 'http_url' | 'google_docs' | 'dropbox' | 'file_upload' | 'google_drive', updatedAt: new Date() })
          .where(and(eq(agentDataSourcesTable.id, d.id), eq(agentDataSourcesTable.agentId, agentId)));
      }
      // Insert new sources
      for (const d of diff.added) {
        await tx.insert(agentDataSourcesTable).values({
          id: uuidv4(),
          agentId,
          name: d.ref,
          sourceType: d.kind as 'r2' | 's3' | 'http_url' | 'google_docs' | 'dropbox' | 'file_upload' | 'google_drive',
          sourcePath: d.ref,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    });

    return agentService.getFull(agentId, orgId);
  },

  async replaceTriggers(
    agentId: string,
    orgId: string,
    expectedEtag: string,
    incoming: Array<{ id: string; kind: 'schedule' | 'event' | 'manual'; spec: unknown; status: 'active' | 'paused' }>,
    options: { force?: boolean },
    actor: { role?: string },
  ): Promise<AgentFull> {
    const current = await agentService.getFull(agentId, orgId);
    agentService._assertNotSystemManaged(current, actor.role);
    agentService._assertEtag(current, expectedEtag);

    const diff = diffByIdentityKey(current.triggers, incoming, (t) => t.id);

    if (!options.force && diff.silentlyRemoved.length > 0) {
      throw {
        statusCode: 409,
        message: 'Some triggers would be removed. Pass force=true to confirm deletion.',
        errorCode: 'IDENTITY_KEY_DELETION_BLOCKED',
        removedIds: diff.silentlyRemoved.map((t) => t.id),
      };
    }

    // Audit: log identity-key removals if force=true (spec §4.2 identity-key safeguard + DEVELOPMENT_GUIDELINES §8.20)
    if (options.force && diff.silentlyRemoved.length > 0) {
      await auditService.log({
        action: 'agent_triggers_removed_by_identity_key',
        organisationId: orgId,
        entityType: 'agent',
        entityId: agentId,
        actorType: 'system',
        metadata: {
          removedCount: diff.silentlyRemoved.length,
          removedTriggerIds: diff.silentlyRemoved.map((t) => t.id),
          beforeCount: current.triggers.length,
          afterCount: incoming.length,
        },
      });
    }

    await db.transaction(async (tx) => {
      // Soft-delete removed triggers
      const toRemove = diff.silentlyRemoved.map((t) => t.id);
      if (toRemove.length > 0) {
        await tx.update(agentTriggersTable)
          .set({ deletedAt: new Date() })
          .where(
            and(
              inArray(agentTriggersTable.id, toRemove),
              eq(agentTriggersTable.organisationId, orgId),
            )
          );
      }
      // Update existing
      for (const t of diff.updated) {
        await tx.update(agentTriggersTable)
          .set({
            isActive: t.status === 'active',
            eventFilter: t.spec as Record<string, unknown>,
            updatedAt: new Date(),
          })
          .where(and(eq(agentTriggersTable.id, t.id), eq(agentTriggersTable.organisationId, orgId)));
      }
      // Phase 1: trigger creation is not supported at the org level. Triggers are
      // subaccount-scoped (linked via subaccountAgentId, not agentId), so a trigger
      // inserted here would be orphaned — it would not appear in getFull (which
      // filters by subaccountAgentId) and would not fire (the trigger service fires
      // by subaccountId). Until the Schedule tab is wired through the subaccount
      // route, reject add operations with a clear error.
      // See migration-gaps.md § "Triggers schema — no direct agentId column".
      if (diff.added.length > 0) {
        throw {
          statusCode: 501,
          message: 'Adding triggers via the org-level agent endpoint is not supported in Phase 1. Use the subaccount-scoped trigger routes.',
          errorCode: 'TRIGGER_ADD_NOT_SUPPORTED',
        };
      }
    });

    return agentService.getFull(agentId, orgId);
  },

  async patchBudget(
    agentId: string,
    orgId: string,
    expectedEtag: string,
    patch: Partial<{ dailyCapUsd: number | null; monthlyCapUsd: number | null; warnThresholdPct: number }>,
    actor: { role?: string },
  ): Promise<AgentFull> {
    // Phase 1: agent LLM budget caps have no backing schema yet.
    // Patches are accepted (ETag / permission checks still apply) but not persisted.
    // Phase 2 should add daily_cap_usd, monthly_cap_usd, warn_threshold_pct columns
    // to agents and implement the read/write path.
    void patch; // intentional no-op

    const current = await agentService.getFull(agentId, orgId);
    agentService._assertNotSystemManaged(current, actor.role);
    agentService._assertEtag(current, expectedEtag);

    return agentService.getFull(agentId, orgId);
  },
};

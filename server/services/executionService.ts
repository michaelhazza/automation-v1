import { eq, and, isNull, gte, lte, desc, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { executions, executionFiles, executionPayloads, automations, automationEngines, organisations, users } from '../db/schema/index.js';
import { queueService } from './queueService.js';
import { emitSubaccountUpdate } from '../websocket/emitters.js';
import type { Execution } from '../db/schema/executions.js';

function mapExecution(e: Execution, viewFullAudit: boolean) {
  return {
    id: e.id,
    processId: e.processId,
    triggeredByUserId: e.triggeredByUserId,
    subaccountId: e.subaccountId,
    status: e.status,
    inputData: e.inputData,
    outputData: e.outputData,
    errorMessage: e.errorMessage,
    isTestExecution: e.isTestExecution,
    triggerType: e.triggerType,
    triggerSourceId: e.triggerSourceId,
    resolvedConnections: e.resolvedConnections,
    resolvedConfig: e.resolvedConfig,
    engineId: e.engineId,
    startedAt: e.startedAt,
    completedAt: e.completedAt,
    durationMs: e.durationMs,
    createdAt: e.createdAt,
    ...(viewFullAudit
      ? {
          errorDetail: e.errorDetail,
          returnWebhookUrl: e.returnWebhookUrl,
          callbackReceivedAt: e.callbackReceivedAt,
          queuedAt: e.queuedAt,
          // outboundPayload and callbackPayload moved to execution_payloads (H-5)
        }
      : {}),
  };
}

export class ExecutionService {
  /**
   * List executions for an org.
   * viewAll=true  → admin: show all executions in org
   * viewAll=false → user: show only their own executions
   */
  async listExecutions(
    userId: string,
    organisationId: string,
    viewAll: boolean,
    viewFullAudit: boolean,
    params: { processId?: string; userId?: string; status?: string; from?: string; to?: string; limit?: number; offset?: number }
  ) {

    const conditions = [eq(executions.organisationId, organisationId)];
    if (!viewAll) conditions.push(eq(executions.triggeredByUserId, userId));
    if (params.processId) conditions.push(eq(executions.processId, params.processId));
    if (params.userId) conditions.push(eq(executions.triggeredByUserId, params.userId));
    if (params.status) conditions.push(eq(executions.status, params.status as 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'));
    if (params.from) conditions.push(gte(executions.createdAt, new Date(params.from)));
    if (params.to) conditions.push(lte(executions.createdAt, new Date(params.to)));

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const scopedDb = getOrgScopedDb('executionService.listExecutions');
    const rows = await scopedDb
      .select()
      .from(executions)
      .where(and(...conditions))
      .orderBy(desc(executions.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((e) => mapExecution(e, viewFullAudit));
  }

  async createExecution(
    userId: string | null,
    organisationId: string,
    data: {
      processId: string;
      inputData?: unknown;
      notifyOnComplete?: boolean;
      subaccountId?: string;
      triggerType?: 'manual' | 'agent' | 'scheduled' | 'webhook';
      triggerSourceId?: string;
      configOverrides?: Record<string, unknown>;
    }
  ) {
    const scopedDb2 = getOrgScopedDb('executionService.createExecution');
    // Load process — support system automations (no organisationId) and org/subaccount automations
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="automation lookup is by processId, org check applied after; system automations have no organisationId"
    const [process] = await db
      .select()
      .from(automations)
      .where(and(eq(automations.id, data.processId), isNull(automations.deletedAt)));

    if (!process) throw { statusCode: 404, message: 'Process not found or not accessible' };
    // For org/subaccount automations, verify org ownership
    if (process.organisationId && process.organisationId !== organisationId) {
      throw { statusCode: 404, message: 'Process not found or not accessible' };
    }
    if (process.status !== 'active') throw { statusCode: 400, message: 'Process is not active' };

    // Duplicate prevention: 5-minute cooldown per user per process (skip for agent/scheduled triggers)
    if (userId && (!data.triggerType || data.triggerType === 'manual')) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const recentExec = await scopedDb2
        .select()
        .from(executions)
        .where(and(
          eq(executions.triggeredByUserId, userId),
          eq(executions.processId, data.processId),
          gte(executions.createdAt, fiveMinutesAgo)
        ));

      const nonTestRecent = recentExec.filter((e) => !e.isTestExecution);
      if (nonTestRecent.length > 0) {
        const oldest = nonTestRecent.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
        const waitSec = Math.ceil((oldest.createdAt.getTime() + 5 * 60 * 1000 - Date.now()) / 1000);
        throw { statusCode: 429, message: `Duplicate execution: this process was already triggered recently. Please wait ${waitSec} seconds before retrying.` };
      }
    }

    const [execution] = await scopedDb2
      .insert(executions)
      .values({
        organisationId,
        processId: data.processId,
        triggeredByUserId: userId,
        subaccountId: data.subaccountId ?? null,
        status: 'pending',
        inputData: data.inputData ?? null,
        engineType: '', // will be resolved by queue worker
        isTestExecution: false,
        notifyOnComplete: data.notifyOnComplete ?? false,
        triggerType: data.triggerType ?? 'manual',
        triggerSourceId: data.triggerSourceId ?? null,
        resolvedConfig: data.configOverrides ?? null,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // H-5: store process snapshot in execution_payloads (keeps executions lean)
    await scopedDb2.insert(executionPayloads)
      .values({ executionId: execution.id, processSnapshot: process as unknown as Record<string, unknown> })
      .onConflictDoNothing();

    try {
      await queueService.enqueueExecution(execution.id);
    } catch {
      // Queue failure should not fail the API response
    }

    // Emit new execution to subaccount listeners (dashboard, history pages)
    if (data.subaccountId) {
      emitSubaccountUpdate(data.subaccountId, 'execution:new', {
        executionId: execution.id, status: execution.status, processId: execution.processId,
      });
    }

    return { id: execution.id, status: execution.status, processId: execution.processId };
  }

  async getExecution(id: string, userId: string, organisationId: string, canViewAll: boolean, viewFullAudit: boolean) {
    const scopedDb = getOrgScopedDb('executionService.getExecution');
    const [execution] = await scopedDb
      .select()
      .from(executions)
      .where(and(eq(executions.id, id), eq(executions.organisationId, organisationId)));

    if (!execution) throw { statusCode: 404, message: 'Execution not found or not accessible' };

    // Users without view-all permission can only see their own executions
    if (!canViewAll && execution.triggeredByUserId !== userId) {
      throw { statusCode: 404, message: 'Execution not found or not accessible' };
    }

    return mapExecution(execution, viewFullAudit);
  }

  async listExecutionFiles(executionId: string, userId: string, organisationId: string, canViewAll: boolean) {
    const scopedDb = getOrgScopedDb('executionService.listExecutionFiles');
    const [execution] = await scopedDb
      .select()
      .from(executions)
      .where(and(eq(executions.id, executionId), eq(executions.organisationId, organisationId)));

    if (!execution) throw { statusCode: 404, message: 'Execution not found or not accessible' };

    if (!canViewAll && execution.triggeredByUserId !== userId) {
      throw { statusCode: 404, message: 'Execution not found or not accessible' };
    }

    const files = await scopedDb
      .select()
      .from(executionFiles)
      .where(eq(executionFiles.executionId, executionId));

    return files.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      fileType: f.fileType,
      mimeType: f.mimeType,
      fileSizeBytes: f.fileSizeBytes,
      expiresAt: f.expiresAt,
      createdAt: f.createdAt,
    }));
  }

  async exportExecutions(
    organisationId: string,
    params: { from?: string; to?: string; processId?: string; userId?: string }
  ) {
    const conditions = [eq(executions.organisationId, organisationId)];
    if (params.processId) conditions.push(eq(executions.processId, params.processId));
    if (params.userId) conditions.push(eq(executions.triggeredByUserId, params.userId));
    if (params.from) conditions.push(gte(executions.createdAt, new Date(params.from)));
    if (params.to) conditions.push(lte(executions.createdAt, new Date(params.to)));

    const scopedDb = getOrgScopedDb('executionService.exportExecutions');
    const rows = await scopedDb
      .select()
      .from(executions)
      .where(and(...conditions))
      .orderBy(desc(executions.createdAt));

    const headers = ['id', 'processId', 'triggeredByUserId', 'subaccountId', 'status', 'engineType', 'isTestExecution', 'retryCount', 'durationMs', 'startedAt', 'completedAt', 'createdAt'];
    const csvRows = rows.map((e) =>
      [e.id, e.processId, e.triggeredByUserId, e.subaccountId, e.status, e.engineType, e.isTestExecution, e.retryCount, e.durationMs, e.startedAt, e.completedAt, e.createdAt]
        .map((v) => (v === null || v === undefined ? '' : String(v)))
        .join(',')
    );

    const csv = [headers.join(','), ...csvRows].join('\n');
    return { contentType: 'text/csv', filename: `executions-${Date.now()}.csv`, data: csv };
  }

  /**
   * Create a portal execution for a subaccount member.
   * Fetches the process and engine, enforces the 5-minute duplicate guard,
   * then atomically inserts the execution + process snapshot payload.
   */
  async createPortalExecution(
    userId: string,
    orgId: string,
    subaccountId: string,
    processId: string,
    inputData?: unknown,
    notifyOnComplete?: boolean,
  ) {
    const scopedDb3 = getOrgScopedDb('executionService.createPortalExecution');
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="automation lookup is by processId, org check applied after; system automations have no organisationId"
    const [process] = await db
      .select()
      .from(automations)
      .where(and(eq(automations.id, processId), eq(automations.status, 'active'), isNull(automations.deletedAt)));

    if (!process || !process.automationEngineId) {
      throw { statusCode: 400, message: 'Process not available' };
    }

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="automation lookup is by processId, org check applied after; system automations have no organisationId"
    const [engine] = await db
      .select()
      .from(automationEngines)
      .where(eq(automationEngines.id, process.automationEngineId));

    if (!engine) {
      throw { statusCode: 400, message: 'Workflow engine not found' };
    }

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentExec = await scopedDb3
      .select({ id: executions.id, createdAt: executions.createdAt, isTestExecution: executions.isTestExecution })
      .from(executions)
      .where(
        and(
          eq(executions.triggeredByUserId, userId),
          eq(executions.processId, processId),
          gte(executions.createdAt, fiveMinutesAgo),
        ),
      );

    const nonTestRecent = recentExec.filter((e) => !e.isTestExecution);
    if (nonTestRecent.length > 0) {
      const oldest = nonTestRecent.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
      const waitSec = Math.ceil((oldest.createdAt.getTime() + 5 * 60 * 1000 - Date.now()) / 1000);
      throw {
        statusCode: 429,
        message: `Duplicate execution: this process was already triggered recently. Please wait ${waitSec} seconds before retrying.`,
      };
    }

    const [execution] = await scopedDb3.transaction(async (tx) => {
      const [exec] = await tx
        .insert(executions)
        .values({
          organisationId: process.organisationId ?? orgId,
          processId,
          triggeredByUserId: userId,
          subaccountId,
          status: 'pending',
          inputData: inputData ?? null,
          engineType: engine.engineType,
          isTestExecution: false,
          notifyOnComplete: notifyOnComplete ?? false,
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      await tx
        .insert(executionPayloads)
        .values({ executionId: exec.id, processSnapshot: process as unknown as Record<string, unknown> })
        .onConflictDoNothing();
      return [exec];
    });

    try {
      await queueService.enqueueExecution(execution.id);
    } catch {
      // Queue failure should not fail the API response
    }

    return { id: execution.id, status: execution.status, processId: execution.processId };
  }

  /**
   * List executions for a subaccount member.
   * If canViewAll is false, results are limited to the caller's own executions.
   */
  async listPortalExecutions(
    subaccountId: string,
    userId: string,
    canViewAll: boolean,
    params: { processId?: string; from?: string; to?: string; limit?: number; offset?: number },
  ) {
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;

    const conditions = [eq(executions.subaccountId, subaccountId)];
    if (!canViewAll) conditions.push(eq(executions.triggeredByUserId, userId));
    if (params.processId) conditions.push(eq(executions.processId, params.processId));
    if (params.from) conditions.push(gte(executions.createdAt, new Date(params.from)));
    if (params.to) conditions.push(lte(executions.createdAt, new Date(params.to)));

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="called within withOrgTx context from route handler — orgId in ALS"
    const rows = await db
      .select()
      .from(executions)
      .where(and(...conditions))
      .orderBy(desc(executions.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((e) => ({
      id: e.id,
      processId: e.processId,
      status: e.status,
      inputData: e.inputData,
      outputData: e.outputData,
      errorMessage: e.errorMessage,
      isTestExecution: e.isTestExecution,
      startedAt: e.startedAt,
      completedAt: e.completedAt,
      durationMs: e.durationMs,
      createdAt: e.createdAt,
    }));
  }

  /**
   * System-admin: list executions across all organisations with diagnostic fields.
   */
  async listSystemExecutions(params: {
    organisationId?: string;
    status?: string;
    engineType?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const conditions: SQL[] = [];
    if (params.organisationId) conditions.push(eq(executions.organisationId, params.organisationId));
    if (params.status) conditions.push(eq(executions.status, params.status as 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'));
    if (params.engineType) conditions.push(eq(executions.engineType, params.engineType));
    if (params.from) conditions.push(gte(executions.createdAt, new Date(params.from)));
    if (params.to) conditions.push(lte(executions.createdAt, new Date(params.to)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="cross-tenant/admin operation — system admin list spans all orgs"
    return db
      .select({
        id: executions.id,
        status: executions.status,
        engineType: executions.engineType,
        isTestExecution: executions.isTestExecution,
        retryCount: executions.retryCount,
        errorMessage: executions.errorMessage,
        errorDetail: executions.errorDetail,
        returnWebhookUrl: executions.returnWebhookUrl,
        outboundPayload: executionPayloads.outboundPayload,
        callbackReceivedAt: executions.callbackReceivedAt,
        callbackPayload: executionPayloads.callbackPayload,
        queuedAt: executions.queuedAt,
        startedAt: executions.startedAt,
        completedAt: executions.completedAt,
        durationMs: executions.durationMs,
        createdAt: executions.createdAt,
        organisationId: executions.organisationId,
        processId: executions.processId,
        triggeredByUserId: executions.triggeredByUserId,
        subaccountId: executions.subaccountId,
        notifyOnComplete: executions.notifyOnComplete,
        organisationName: organisations.name,
        processName: automations.name,
        userEmail: users.email,
        userFirstName: users.firstName,
        userLastName: users.lastName,
      })
      .from(executions)
      .leftJoin(executionPayloads, eq(executions.id, executionPayloads.executionId))
      .leftJoin(organisations, eq(executions.organisationId, organisations.id))
      .leftJoin(automations, eq(executions.processId, automations.id))
      .leftJoin(users, eq(executions.triggeredByUserId, users.id))
      .where(whereClause)
      .orderBy(desc(executions.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * System-admin: full diagnostic detail for a single execution.
   */
  async getSystemExecution(id: string) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="cross-tenant/admin operation — system admin diagnostic detail spans all orgs"
    const [row] = await db
      .select({
        id: executions.id,
        status: executions.status,
        engineType: executions.engineType,
        isTestExecution: executions.isTestExecution,
        retryCount: executions.retryCount,
        inputData: executions.inputData,
        outputData: executions.outputData,
        errorMessage: executions.errorMessage,
        errorDetail: executions.errorDetail,
        returnWebhookUrl: executions.returnWebhookUrl,
        outboundPayload: executionPayloads.outboundPayload,
        callbackReceivedAt: executions.callbackReceivedAt,
        callbackPayload: executionPayloads.callbackPayload,
        queuedAt: executions.queuedAt,
        startedAt: executions.startedAt,
        completedAt: executions.completedAt,
        durationMs: executions.durationMs,
        createdAt: executions.createdAt,
        notifyOnComplete: executions.notifyOnComplete,
        organisationId: executions.organisationId,
        processId: executions.processId,
        triggeredByUserId: executions.triggeredByUserId,
        subaccountId: executions.subaccountId,
        processSnapshot: executionPayloads.processSnapshot,
        organisationName: organisations.name,
        processName: automations.name,
        userEmail: users.email,
        userFirstName: users.firstName,
        userLastName: users.lastName,
      })
      .from(executions)
      .leftJoin(executionPayloads, eq(executions.id, executionPayloads.executionId))
      .leftJoin(organisations, eq(executions.organisationId, organisations.id))
      .leftJoin(automations, eq(executions.processId, automations.id))
      .leftJoin(users, eq(executions.triggeredByUserId, users.id))
      .where(eq(executions.id, id));

    return row ?? null;
  }

  /**
   * Get a single execution for a subaccount member.
   * If canViewAll is false, only the caller's own execution is returned.
   */
  async getPortalExecution(
    executionId: string,
    subaccountId: string,
    userId: string,
    canViewAll: boolean,
  ) {
    // guard-ignore-next-line: with-org-tx-or-scoped-db reason="called within withOrgTx context from portal route handler — orgId in ALS"
    const [execution] = await db
      .select()
      .from(executions)
      .where(
        and(
          eq(executions.id, executionId),
          eq(executions.subaccountId, subaccountId),
        ),
      );

    if (!execution) throw { statusCode: 404, message: 'Execution not found' };

    if (execution.triggeredByUserId !== userId && !canViewAll) {
      throw { statusCode: 404, message: 'Execution not found' };
    }

    return {
      id: execution.id,
      processId: execution.processId,
      status: execution.status,
      inputData: execution.inputData,
      outputData: execution.outputData,
      errorMessage: execution.errorMessage,
      isTestExecution: execution.isTestExecution,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      durationMs: execution.durationMs,
      createdAt: execution.createdAt,
    };
  }
}

export const executionService = new ExecutionService();

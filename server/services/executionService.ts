import { eq, and, isNull, gte, lte, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { executions, executionFiles, processes } from '../db/schema/index.js';
import { queueService } from './queueService.js';
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
    startedAt: e.startedAt,
    completedAt: e.completedAt,
    durationMs: e.durationMs,
    createdAt: e.createdAt,
    ...(viewFullAudit
      ? {
          errorDetail: e.errorDetail,
          returnWebhookUrl: e.returnWebhookUrl,
          outboundPayload: e.outboundPayload,
          callbackReceivedAt: e.callbackReceivedAt,
          callbackPayload: e.callbackPayload,
          queuedAt: e.queuedAt,
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

    const rows = await db
      .select()
      .from(executions)
      .where(and(...conditions))
      .orderBy(desc(executions.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((e) => mapExecution(e, viewFullAudit));
  }

  async createExecution(
    userId: string,
    organisationId: string,
    data: { processId: string; inputData?: unknown; notifyOnComplete?: boolean; subaccountId?: string }
  ) {
    const [process] = await db
      .select()
      .from(processes)
      .where(and(eq(processes.id, data.processId), eq(processes.organisationId, organisationId), isNull(processes.deletedAt)));

    if (!process) throw { statusCode: 404, message: 'Process not found or not accessible' };
    if (process.status !== 'active') throw { statusCode: 400, message: 'Process is not active' };

    // Duplicate prevention: 5-minute cooldown per user per process
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentExec = await db
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

    const [execution] = await db
      .insert(executions)
      .values({
        organisationId,
        processId: data.processId,
        triggeredByUserId: userId,
        subaccountId: data.subaccountId ?? null,
        status: 'pending',
        inputData: data.inputData ?? null,
        engineType: '', // will be resolved by queue worker from process snapshot
        processSnapshot: process as unknown as Record<string, unknown>,
        isTestExecution: false,
        notifyOnComplete: data.notifyOnComplete ?? false,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    try {
      await queueService.enqueueExecution(execution.id);
    } catch {
      // Queue failure should not fail the API response
    }

    return { id: execution.id, status: execution.status, processId: execution.processId };
  }

  async getExecution(id: string, userId: string, organisationId: string, canViewAll: boolean, viewFullAudit: boolean) {
    const [execution] = await db
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
    const [execution] = await db
      .select()
      .from(executions)
      .where(and(eq(executions.id, executionId), eq(executions.organisationId, organisationId)));

    if (!execution) throw { statusCode: 404, message: 'Execution not found or not accessible' };

    if (!canViewAll && execution.triggeredByUserId !== userId) {
      throw { statusCode: 404, message: 'Execution not found or not accessible' };
    }

    const files = await db
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

    const rows = await db
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
}

export const executionService = new ExecutionService();

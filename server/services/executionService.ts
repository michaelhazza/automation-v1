import { eq, and, isNull, gte, lte, desc, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { executions, executionFiles, tasks, users, permissionGroupMembers, permissionGroupCategories } from '../db/schema/index.js';
import { queueService } from './queueService.js';
import type { Execution } from '../db/schema/executions.js';

function mapExecution(e: Execution, role: string) {
  return {
    id: e.id,
    taskId: e.taskId,
    userId: e.userId,
    status: e.status,
    inputData: e.inputData,
    outputData: e.outputData,
    errorMessage: e.errorMessage,
    isTestExecution: e.isTestExecution,
    startedAt: e.startedAt,
    completedAt: e.completedAt,
    durationMs: e.durationMs,
    createdAt: e.createdAt,
    // Admin-only audit fields
    ...(role === 'org_admin' || role === 'system_admin'
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
  async listExecutions(
    userId: string,
    organisationId: string,
    role: string,
    params: { taskId?: string; userId?: string; status?: string; from?: string; to?: string; limit?: number; offset?: number }
  ) {
    // Build DB-level conditions for scalar filters
    const conditions = [eq(executions.organisationId, organisationId)];
    if (role === 'user') conditions.push(eq(executions.userId, userId));
    if (params.taskId) conditions.push(eq(executions.taskId, params.taskId));
    if (params.userId) conditions.push(eq(executions.userId, params.userId));
    if (params.status) conditions.push(eq(executions.status, params.status as 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'));
    if (params.from) conditions.push(gte(executions.createdAt, new Date(params.from)));
    if (params.to) conditions.push(lte(executions.createdAt, new Date(params.to)));

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    // Manager role requires additional in-memory filtering based on accessible task categories.
    // All other roles use DB-level pagination directly.
    if (role === 'manager') {
      const allRows = await db
        .select()
        .from(executions)
        .where(and(...conditions))
        .orderBy(desc(executions.createdAt));

      const memberGroups = await db
        .select({ permissionGroupId: permissionGroupMembers.permissionGroupId })
        .from(permissionGroupMembers)
        .where(eq(permissionGroupMembers.userId, userId));

      const groupIds = memberGroups.map((m) => m.permissionGroupId);
      let accessibleCategoryIds: string[] = [];

      if (groupIds.length > 0) {
        const categoryAccess = await db
          .select({ categoryId: permissionGroupCategories.categoryId })
          .from(permissionGroupCategories)
          .where(inArray(permissionGroupCategories.permissionGroupId, groupIds));
        accessibleCategoryIds = [...new Set(categoryAccess.map((c) => c.categoryId))];
      }

      const accessibleTasks = await db
        .select({ id: tasks.id, categoryId: tasks.categoryId })
        .from(tasks)
        .where(and(eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

      const accessibleTaskIds = accessibleTasks
        .filter((t) => t.categoryId === null || accessibleCategoryIds.includes(t.categoryId))
        .map((t) => t.id);

      const rows = allRows
        .filter((e) => accessibleTaskIds.includes(e.taskId))
        .slice(offset, offset + limit);

      return rows.map((e) => mapExecution(e, role));
    }

    // For all other roles (user, org_admin, system_admin): DB-level pagination
    const rows = await db
      .select()
      .from(executions)
      .where(and(...conditions))
      .orderBy(desc(executions.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((e) => mapExecution(e, role));
  }

  async createExecution(
    userId: string,
    organisationId: string,
    data: { taskId: string; inputData?: unknown }
  ) {
    // Verify task is accessible and active
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, data.taskId), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

    if (!task) {
      throw { statusCode: 404, message: 'Task not found or not accessible' };
    }

    if (task.status !== 'active') {
      throw { statusCode: 400, message: 'Task is not active' };
    }

    // Duplicate prevention: 5-minute cooldown per user per task
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentExec = await db
      .select()
      .from(executions)
      .where(and(eq(executions.userId, userId), eq(executions.taskId, data.taskId), gte(executions.createdAt, fiveMinutesAgo)));

    const nonTestRecent = recentExec.filter((e) => !e.isTestExecution);
    if (nonTestRecent.length > 0) {
      const oldest = nonTestRecent.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
      const waitMs = oldest.createdAt.getTime() + 5 * 60 * 1000 - Date.now();
      const waitSec = Math.ceil(waitMs / 1000);
      throw {
        statusCode: 429,
        message: `Duplicate execution: this task was already triggered recently. Please wait ${waitSec} seconds before retrying.`,
      };
    }

    const [execution] = await db
      .insert(executions)
      .values({
        organisationId,
        taskId: data.taskId,
        userId,
        status: 'pending',
        inputData: data.inputData ?? null,
        engineType: task.engineType,
        taskSnapshot: task as unknown as Record<string, unknown>,
        isTestExecution: false,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Enqueue background job (stamps queuedAt and dispatches processing)
    try {
      await queueService.enqueueExecution(execution.id);
    } catch {
      // Queue failure should not fail the API response
    }

    return {
      id: execution.id,
      status: execution.status,
      taskId: execution.taskId,
    };
  }

  async getExecution(id: string, userId: string, organisationId: string, role: string) {
    const [execution] = await db
      .select()
      .from(executions)
      .where(and(eq(executions.id, id), eq(executions.organisationId, organisationId)));

    if (!execution) {
      throw { statusCode: 404, message: 'Execution not found or not accessible' };
    }

    // User can only see own executions
    if (role === 'user' && execution.userId !== userId) {
      throw { statusCode: 404, message: 'Execution not found or not accessible' };
    }

    return {
      id: execution.id,
      taskId: execution.taskId,
      status: execution.status,
      inputData: execution.inputData,
      outputData: execution.outputData,
      errorMessage: execution.errorMessage,
      isTestExecution: execution.isTestExecution,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      durationMs: execution.durationMs,
      createdAt: execution.createdAt,
      // Admin-only audit fields
      ...(role === 'org_admin' || role === 'system_admin'
        ? {
            errorDetail: execution.errorDetail,
            returnWebhookUrl: execution.returnWebhookUrl,
            outboundPayload: execution.outboundPayload,
            callbackReceivedAt: execution.callbackReceivedAt,
            callbackPayload: execution.callbackPayload,
            queuedAt: execution.queuedAt,
          }
        : {}),
    };
  }

  async listExecutionFiles(executionId: string, userId: string, organisationId: string, role: string) {
    const [execution] = await db
      .select()
      .from(executions)
      .where(and(eq(executions.id, executionId), eq(executions.organisationId, organisationId)));

    if (!execution) {
      throw { statusCode: 404, message: 'Execution not found or not accessible' };
    }

    if (role === 'user' && execution.userId !== userId) {
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
    params: { from?: string; to?: string; taskId?: string; userId?: string }
  ) {
    const exportConditions = [eq(executions.organisationId, organisationId)];
    if (params.taskId) exportConditions.push(eq(executions.taskId, params.taskId));
    if (params.userId) exportConditions.push(eq(executions.userId, params.userId));
    if (params.from) exportConditions.push(gte(executions.createdAt, new Date(params.from)));
    if (params.to) exportConditions.push(lte(executions.createdAt, new Date(params.to)));

    const rows = await db
      .select()
      .from(executions)
      .where(and(...exportConditions))
      .orderBy(desc(executions.createdAt));

    const headers = ['id', 'taskId', 'userId', 'status', 'engineType', 'isTestExecution', 'retryCount', 'durationMs', 'startedAt', 'completedAt', 'createdAt'];
    const csvRows = rows.map((e) =>
      [e.id, e.taskId, e.userId, e.status, e.engineType, e.isTestExecution, e.retryCount, e.durationMs, e.startedAt, e.completedAt, e.createdAt]
        .map((v) => (v === null || v === undefined ? '' : String(v)))
        .join(',')
    );

    const csv = [headers.join(','), ...csvRows].join('\n');
    return { contentType: 'text/csv', filename: `executions-${Date.now()}.csv`, data: csv };
  }
}

export const executionService = new ExecutionService();

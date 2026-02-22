import { eq, and, isNull, ilike, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks, workflowEngines, permissionGroupMembers, permissionGroupCategories, permissionGroups, executions } from '../db/schema/index.js';
import { env } from '../lib/env.js';

export class TaskService {
  async listTasks(
    userId: string,
    organisationId: string,
    role: string,
    params: { categoryId?: string; status?: string; search?: string; limit?: number; offset?: number }
  ) {
    // Build DB-level conditions
    const conditions = [eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)];
    if (role === 'manager' || role === 'user') {
      // Non-admin roles can only see active tasks
      conditions.push(eq(tasks.status, 'active'));
    } else if (params.status) {
      conditions.push(eq(tasks.status, params.status as 'draft' | 'active' | 'inactive'));
    }
    if (params.categoryId) conditions.push(eq(tasks.categoryId, params.categoryId));
    if (params.search) conditions.push(ilike(tasks.name, `%${params.search}%`));

    let rows = await db
      .select()
      .from(tasks)
      .where(and(...conditions));

    // For non-admin roles, further filter by permission group category access
    if (role === 'manager' || role === 'user') {
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

      rows = rows.filter((t) => t.categoryId === null || accessibleCategoryIds.includes(t.categoryId));
    }

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    return rows.slice(offset, offset + limit).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      categoryId: t.categoryId,
      status: t.status,
      inputGuidance: t.inputGuidance,
      expectedOutput: t.expectedOutput,
      timeoutSeconds: t.timeoutSeconds,
      // Strip engine details from non-admin view
      ...(role === 'org_admin' || role === 'system_admin'
        ? { workflowEngineId: t.workflowEngineId, engineType: t.engineType, endpointUrl: t.endpointUrl, httpMethod: t.httpMethod }
        : {}),
      createdAt: t.createdAt,
    }));
  }

  async createTask(
    organisationId: string,
    data: {
      name: string;
      description?: string;
      workflowEngineId: string;
      categoryId?: string;
      endpointUrl: string;
      httpMethod: string;
      inputGuidance?: string;
      expectedOutput?: string;
      timeoutSeconds?: number;
    }
  ) {
    const [engine] = await db
      .select()
      .from(workflowEngines)
      .where(and(eq(workflowEngines.id, data.workflowEngineId), eq(workflowEngines.organisationId, organisationId), isNull(workflowEngines.deletedAt)));

    if (!engine || engine.status !== 'active') {
      throw { statusCode: 404, message: 'Workflow engine not found or inactive' };
    }

    const [task] = await db
      .insert(tasks)
      .values({
        organisationId,
        workflowEngineId: data.workflowEngineId,
        categoryId: data.categoryId ?? null,
        name: data.name,
        description: data.description,
        status: 'draft',
        endpointUrl: data.endpointUrl,
        httpMethod: data.httpMethod as 'GET' | 'POST' | 'PUT' | 'PATCH',
        inputGuidance: data.inputGuidance,
        expectedOutput: data.expectedOutput,
        timeoutSeconds: data.timeoutSeconds ?? env.EXECUTION_TIMEOUT_DEFAULT_SECONDS,
        engineType: engine.engineType,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return {
      id: task.id,
      name: task.name,
      status: task.status,
    };
  }

  async getTask(id: string, organisationId: string, role: string) {
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

    if (!task) {
      throw { statusCode: 404, message: 'Task not found or not accessible' };
    }

    if ((role === 'manager' || role === 'user') && task.status !== 'active') {
      throw { statusCode: 404, message: 'Task not found or not accessible' };
    }

    return {
      id: task.id,
      name: task.name,
      description: task.description,
      categoryId: task.categoryId,
      status: task.status,
      inputGuidance: task.inputGuidance,
      expectedOutput: task.expectedOutput,
      timeoutSeconds: task.timeoutSeconds,
      ...(role === 'org_admin' || role === 'system_admin'
        ? { workflowEngineId: task.workflowEngineId, engineType: task.engineType, endpointUrl: task.endpointUrl, httpMethod: task.httpMethod }
        : {}),
    };
  }

  async updateTask(
    id: string,
    organisationId: string,
    data: {
      name?: string;
      description?: string;
      categoryId?: string;
      endpointUrl?: string;
      httpMethod?: string;
      inputGuidance?: string;
      expectedOutput?: string;
      timeoutSeconds?: number;
    }
  ) {
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

    if (!task) {
      throw { statusCode: 404, message: 'Task not found' };
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.categoryId !== undefined) update.categoryId = data.categoryId;
    if (data.endpointUrl !== undefined) update.endpointUrl = data.endpointUrl;
    if (data.httpMethod !== undefined) update.httpMethod = data.httpMethod;
    if (data.inputGuidance !== undefined) update.inputGuidance = data.inputGuidance;
    if (data.expectedOutput !== undefined) update.expectedOutput = data.expectedOutput;
    if (data.timeoutSeconds !== undefined) update.timeoutSeconds = data.timeoutSeconds;

    const [updated] = await db
      .update(tasks)
      .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
      .where(eq(tasks.id, id))
      .returning();

    return {
      id: updated.id,
      name: updated.name,
      status: updated.status,
    };
  }

  async deleteTask(id: string, organisationId: string) {
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

    if (!task) {
      throw { statusCode: 404, message: 'Task not found' };
    }

    const now = new Date();
    await db.update(tasks).set({ deletedAt: now, updatedAt: now }).where(eq(tasks.id, id));

    return { message: 'Task deleted successfully' };
  }

  async activateTask(id: string, organisationId: string) {
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

    if (!task) {
      throw { statusCode: 404, message: 'Task not found' };
    }

    const [engine] = await db
      .select()
      .from(workflowEngines)
      .where(and(eq(workflowEngines.id, task.workflowEngineId), isNull(workflowEngines.deletedAt)));

    if (!engine || engine.status !== 'active') {
      throw { statusCode: 400, message: 'Task cannot be activated: engine is inactive' };
    }

    const [updated] = await db
      .update(tasks)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();

    return { id: updated.id, status: updated.status };
  }

  async deactivateTask(id: string, organisationId: string) {
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

    if (!task) {
      throw { statusCode: 404, message: 'Task not found' };
    }

    const [updated] = await db
      .update(tasks)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();

    return { id: updated.id, status: updated.status };
  }

  async testTask(id: string, organisationId: string, userId: string, inputData?: unknown) {
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

    if (!task) {
      throw { statusCode: 404, message: 'Task not found' };
    }

    const [engine] = await db
      .select()
      .from(workflowEngines)
      .where(eq(workflowEngines.id, task.workflowEngineId));

    if (!engine) {
      throw { statusCode: 503, message: 'Engine execution failed' };
    }

    const start = Date.now();
    const [execution] = await db
      .insert(executions)
      .values({
        organisationId,
        taskId: id,
        userId,
        status: 'running',
        inputData: inputData ?? null,
        engineType: task.engineType,
        taskSnapshot: task as unknown as Record<string, unknown>,
        isTestExecution: true,
        retryCount: 0,
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    try {
      const response = await fetch(task.endpointUrl, {
        method: task.httpMethod,
        headers: {
          'Content-Type': 'application/json',
          ...(engine.apiKey ? { 'X-N8N-API-KEY': engine.apiKey } : {}),
        },
        body: inputData ? JSON.stringify(inputData) : undefined,
        signal: AbortSignal.timeout(task.timeoutSeconds * 1000),
      });

      const durationMs = Date.now() - start;
      let outputData: unknown = null;
      try {
        outputData = await response.json();
      } catch {
        outputData = { status: response.statusText };
      }

      await db
        .update(executions)
        .set({ status: 'completed', outputData, completedAt: new Date(), durationMs, updatedAt: new Date() })
        .where(eq(executions.id, execution.id));

      return {
        executionId: execution.id,
        status: 'completed',
        outputData,
        errorMessage: null,
        durationMs,
        isTestExecution: true,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const errorMessage = err instanceof Error ? err.message : 'Engine execution failed';

      await db
        .update(executions)
        .set({ status: 'failed', errorMessage, completedAt: new Date(), durationMs, updatedAt: new Date() })
        .where(eq(executions.id, execution.id));

      return {
        executionId: execution.id,
        status: 'failed',
        outputData: null,
        errorMessage,
        durationMs,
        isTestExecution: true,
      };
    }
  }
}

export const taskService = new TaskService();

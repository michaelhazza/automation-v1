import { eq, and, isNull, ilike } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks, workflowEngines, executions } from '../db/schema/index.js';
import { webhookService } from './webhookService.js';
import { buildEngineAuthHeaders } from '../lib/engineAuth.js';

const DEFAULT_TIMEOUT_SECONDS = 300;

export class TaskService {
  /**
   * List org-level tasks. For non-admin users only active tasks are returned.
   */
  async listTasks(
    userId: string,
    organisationId: string,
    role: string,
    params: { categoryId?: string; status?: string; search?: string; limit?: number; offset?: number }
  ) {
    const isAdmin = role === 'system_admin' || role === 'org_admin';
    const conditions = [eq(tasks.organisationId, organisationId), isNull(tasks.subaccountId), isNull(tasks.deletedAt)];

    if (!isAdmin) {
      conditions.push(eq(tasks.status, 'active'));
    } else if (params.status) {
      conditions.push(eq(tasks.status, params.status as 'draft' | 'active' | 'inactive'));
    }

    if (params.categoryId) conditions.push(eq(tasks.orgCategoryId, params.categoryId));
    if (params.search) conditions.push(ilike(tasks.name, `%${params.search}%`));

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const rows = await db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);

    return rows.map((t) => this._mapTask(t, isAdmin));
  }

  async createTask(
    organisationId: string,
    data: {
      name: string;
      description?: string;
      workflowEngineId: string;
      orgCategoryId?: string;
      webhookPath: string;
      inputSchema?: string;
      outputSchema?: string;
      subaccountId?: string;
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
        orgCategoryId: data.orgCategoryId ?? null,
        name: data.name,
        description: data.description,
        status: 'draft',
        webhookPath: data.webhookPath,
        inputSchema: data.inputSchema,
        outputSchema: data.outputSchema,
        subaccountId: data.subaccountId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return { id: task.id, name: task.name, status: task.status };
  }

  async getTask(id: string, organisationId: string, role: string) {
    const isAdmin = role === 'system_admin' || role === 'org_admin';

    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.subaccountId), isNull(tasks.deletedAt)));

    if (!task) throw { statusCode: 404, message: 'Task not found or not accessible' };
    if (!isAdmin && task.status !== 'active') throw { statusCode: 404, message: 'Task not found or not accessible' };

    return this._mapTask(task, isAdmin);
  }

  async updateTask(
    id: string,
    organisationId: string,
    data: {
      name?: string;
      description?: string;
      orgCategoryId?: string | null;
      webhookPath?: string;
      inputSchema?: string;
      outputSchema?: string;
      subaccountId?: string | null;
    }
  ) {
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.subaccountId), isNull(tasks.deletedAt)));

    if (!task) throw { statusCode: 404, message: 'Task not found' };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.orgCategoryId !== undefined) update.orgCategoryId = data.orgCategoryId;
    if (data.webhookPath !== undefined) update.webhookPath = data.webhookPath;
    if (data.inputSchema !== undefined) update.inputSchema = data.inputSchema;
    if (data.outputSchema !== undefined) update.outputSchema = data.outputSchema;
    if (data.subaccountId !== undefined) update.subaccountId = data.subaccountId;

    const [updated] = await db
      .update(tasks)
      .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
      .where(eq(tasks.id, id))
      .returning();

    return { id: updated.id, name: updated.name, status: updated.status };
  }

  async deleteTask(id: string, organisationId: string) {
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.subaccountId), isNull(tasks.deletedAt)));

    if (!task) throw { statusCode: 404, message: 'Task not found' };

    const now = new Date();
    await db.update(tasks).set({ deletedAt: now, updatedAt: now }).where(eq(tasks.id, id));
    return { message: 'Task deleted successfully' };
  }

  async activateTask(id: string, organisationId: string) {
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.subaccountId), isNull(tasks.deletedAt)));

    if (!task) throw { statusCode: 404, message: 'Task not found' };

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
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.subaccountId), isNull(tasks.deletedAt)));

    if (!task) throw { statusCode: 404, message: 'Task not found' };

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
      .where(and(eq(tasks.id, id), eq(tasks.organisationId, organisationId), isNull(tasks.subaccountId), isNull(tasks.deletedAt)));

    if (!task) throw { statusCode: 404, message: 'Task not found' };

    const [engine] = await db
      .select()
      .from(workflowEngines)
      .where(eq(workflowEngines.id, task.workflowEngineId));

    if (!engine) throw { statusCode: 503, message: 'Engine not found' };

    // Full URL = engine base URL + task webhook path
    const fullEndpointUrl = `${engine.baseUrl.replace(/\/$/, '')}${task.webhookPath}`;

    const start = Date.now();
    const [execution] = await db
      .insert(executions)
      .values({
        organisationId,
        taskId: id,
        triggeredByUserId: userId,
        status: 'running',
        inputData: inputData ?? null,
        engineType: engine.engineType,
        taskSnapshot: task as unknown as Record<string, unknown>,
        isTestExecution: true,
        retryCount: 0,
        startedAt: new Date(),
        queuedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const returnWebhookUrl = webhookService.buildReturnUrl(execution.id);
    const outboundPayload = await webhookService.buildOutboundPayload(
      execution.id,
      inputData ?? null,
      returnWebhookUrl
    );

    await db
      .update(executions)
      .set({
        returnWebhookUrl,
        outboundPayload: outboundPayload as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(executions.id, execution.id));

    const authHeaders = buildEngineAuthHeaders(engine.engineType, engine.apiKey ?? undefined);

    try {
      const response = await fetch(fullEndpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(outboundPayload),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_SECONDS * 1000),
      });

      const durationMs = Date.now() - start;
      let outputData: unknown = null;
      try { outputData = await response.json(); } catch { outputData = { status: response.statusText }; }

      await db
        .update(executions)
        .set({ status: 'completed', outputData, completedAt: new Date(), durationMs, updatedAt: new Date() })
        .where(eq(executions.id, execution.id));

      return { executionId: execution.id, status: 'completed', outputData, errorMessage: null, durationMs, isTestExecution: true };
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const errorMessage = err instanceof Error ? err.message : 'Engine execution failed';

      await db
        .update(executions)
        .set({ status: 'failed', errorMessage, completedAt: new Date(), durationMs, updatedAt: new Date() })
        .where(eq(executions.id, execution.id));

      return { executionId: execution.id, status: 'failed', outputData: null, errorMessage, durationMs, isTestExecution: true };
    }
  }

  private _mapTask(t: typeof tasks.$inferSelect, includeAdmin: boolean) {
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      orgCategoryId: t.orgCategoryId,
      subaccountId: t.subaccountId,
      subaccountCategoryId: t.subaccountCategoryId,
      status: t.status,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
      createdAt: t.createdAt,
      ...(includeAdmin ? { workflowEngineId: t.workflowEngineId, webhookPath: t.webhookPath } : {}),
    };
  }
}

export const taskService = new TaskService();

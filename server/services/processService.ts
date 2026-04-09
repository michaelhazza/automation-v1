import { eq, and, isNull, ilike } from 'drizzle-orm';
import { db } from '../db/index.js';
import { processes, workflowEngines, executions, executionPayloads } from '../db/schema/index.js';
import { webhookService } from './webhookService.js';
import { buildEngineAuthHeaders } from '../lib/engineAuth.js';

const DEFAULT_TIMEOUT_SECONDS = 300;

export class ProcessService {
  /**
   * List org-level processes. For non-admin users only active processes are returned.
   */
  async listProcesses(
    userId: string,
    organisationId: string,
    role: string,
    params: { categoryId?: string; status?: string; search?: string; limit?: number; offset?: number }
  ) {
    const isAdmin = role === 'system_admin' || role === 'org_admin';
    const conditions = [eq(processes.organisationId, organisationId), isNull(processes.deletedAt)];

    if (!isAdmin) {
      conditions.push(eq(processes.status, 'active'));
    } else if (params.status) {
      conditions.push(eq(processes.status, params.status as 'draft' | 'active' | 'inactive'));
    }

    if (params.categoryId) conditions.push(eq(processes.orgCategoryId, params.categoryId));
    if (params.search) conditions.push(ilike(processes.name, `%${params.search}%`));

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const rows = await db
      .select()
      .from(processes)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);

    return rows.map((t) => this._mapProcess(t, isAdmin));
  }

  async createProcess(
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

    const [process] = await db
      .insert(processes)
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

    return { id: process.id, name: process.name, status: process.status };
  }

  async getProcess(id: string, organisationId: string, role: string) {
    const isAdmin = role === 'system_admin' || role === 'org_admin';

    const [process] = await db
      .select()
      .from(processes)
      .where(and(eq(processes.id, id), eq(processes.organisationId, organisationId), isNull(processes.deletedAt)));

    if (!process) throw { statusCode: 404, message: 'Process not found or not accessible' };
    if (!isAdmin && process.status !== 'active') throw { statusCode: 404, message: 'Process not found or not accessible' };

    return this._mapProcess(process, isAdmin);
  }

  async updateProcess(
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
    const [process] = await db
      .select()
      .from(processes)
      .where(and(eq(processes.id, id), eq(processes.organisationId, organisationId), isNull(processes.deletedAt)));

    if (!process) throw { statusCode: 404, message: 'Process not found' };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.orgCategoryId !== undefined) update.orgCategoryId = data.orgCategoryId;
    if (data.webhookPath !== undefined) update.webhookPath = data.webhookPath;
    if (data.inputSchema !== undefined) update.inputSchema = data.inputSchema;
    if (data.outputSchema !== undefined) update.outputSchema = data.outputSchema;
    if (data.subaccountId !== undefined) update.subaccountId = data.subaccountId;

    const [updated] = await db
      .update(processes)
      .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
      .where(and(eq(processes.id, id), eq(processes.organisationId, organisationId)))
      .returning();

    return { id: updated.id, name: updated.name, status: updated.status };
  }

  async deleteProcess(id: string, organisationId: string) {
    const [process] = await db
      .select()
      .from(processes)
      .where(and(eq(processes.id, id), eq(processes.organisationId, organisationId), isNull(processes.deletedAt)));

    if (!process) throw { statusCode: 404, message: 'Process not found' };

    const now = new Date();
    await db.update(processes).set({ deletedAt: now, updatedAt: now }).where(and(eq(processes.id, id), eq(processes.organisationId, organisationId)));
    return { message: 'Process deleted successfully' };
  }

  async activateProcess(id: string, organisationId: string) {
    const [process] = await db
      .select()
      .from(processes)
      .where(and(eq(processes.id, id), eq(processes.organisationId, organisationId), isNull(processes.deletedAt)));

    if (!process) throw { statusCode: 404, message: 'Process not found' };

    const workflowEngineId = process.workflowEngineId;
    if (!workflowEngineId) throw { statusCode: 400, message: 'Process has no workflow engine configured' };

    const [engine] = await db
      .select()
      .from(workflowEngines)
      .where(and(eq(workflowEngines.id, workflowEngineId), eq(workflowEngines.organisationId, organisationId), isNull(workflowEngines.deletedAt)));

    if (!engine || engine.status !== 'active') {
      throw { statusCode: 400, message: 'Process cannot be activated: engine is inactive' };
    }

    const [updated] = await db
      .update(processes)
      .set({ status: 'active', updatedAt: new Date() })
      .where(and(eq(processes.id, id), eq(processes.organisationId, organisationId)))
      .returning();

    return { id: updated.id, status: updated.status };
  }

  async deactivateProcess(id: string, organisationId: string) {
    const [process] = await db
      .select()
      .from(processes)
      .where(and(eq(processes.id, id), eq(processes.organisationId, organisationId), isNull(processes.deletedAt)));

    if (!process) throw { statusCode: 404, message: 'Process not found' };
    if (!process.workflowEngineId) throw { statusCode: 400, message: 'Process has no workflow engine configured' };

    const [updated] = await db
      .update(processes)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(and(eq(processes.id, id), eq(processes.organisationId, organisationId)))
      .returning();

    return { id: updated.id, status: updated.status };
  }

  async testProcess(id: string, organisationId: string, userId: string, inputData?: unknown) {
    const [process] = await db
      .select()
      .from(processes)
      .where(and(eq(processes.id, id), eq(processes.organisationId, organisationId), isNull(processes.deletedAt)));

    if (!process) throw { statusCode: 404, message: 'Process not found' };

    const workflowEngineId = process.workflowEngineId;
    if (!workflowEngineId) throw { statusCode: 400, message: 'Process has no workflow engine configured' };

    const [engine] = await db
      .select()
      .from(workflowEngines)
      .where(and(eq(workflowEngines.id, workflowEngineId), eq(workflowEngines.organisationId, organisationId), isNull(workflowEngines.deletedAt)));

    if (!engine) throw { statusCode: 503, message: 'Engine not found' };

    // Full URL = engine base URL + process webhook path
    const fullEndpointUrl = `${engine.baseUrl.replace(/\/$/, '')}${process.webhookPath}`;

    const start = Date.now();
    const [execution] = await db
      .insert(executions)
      .values({
        organisationId,
        processId: id,
        triggeredByUserId: userId,
        status: 'running',
        inputData: inputData ?? null,
        engineType: engine.engineType,
        isTestExecution: true,
        retryCount: 0,
        startedAt: new Date(),
        queuedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // H-5: store process snapshot in execution_payloads
    await db.insert(executionPayloads)
      .values({ executionId: execution.id, processSnapshot: process as unknown as Record<string, unknown> })
      .onConflictDoNothing();

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
        updatedAt: new Date(),
      })
      .where(eq(executions.id, execution.id));

    // H-5: store outbound payload in execution_payloads
    await db.insert(executionPayloads)
      .values({ executionId: execution.id, outboundPayload: outboundPayload as unknown as Record<string, unknown> })
      .onConflictDoUpdate({
        target: executionPayloads.executionId,
        set: { outboundPayload: outboundPayload as unknown as Record<string, unknown> },
      });

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

  private _mapProcess(t: typeof processes.$inferSelect, includeAdmin: boolean) {
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

export const processService = new ProcessService();

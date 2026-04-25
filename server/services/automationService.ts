import { eq, and, isNull, ilike, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { automations, automationEngines, executions, executionPayloads } from '../db/schema/index.js';
import { webhookService } from './webhookService.js';
import { buildEngineAuthHeaders } from '../lib/engineAuth.js';

const DEFAULT_TIMEOUT_SECONDS = 300;

export class AutomationService {
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
    const conditions = [eq(automations.organisationId, organisationId), isNull(automations.deletedAt)];

    if (!isAdmin) {
      conditions.push(eq(automations.status, 'active'));
    } else if (params.status) {
      conditions.push(eq(automations.status, params.status as 'draft' | 'active' | 'inactive'));
    }

    if (params.categoryId) conditions.push(eq(automations.orgCategoryId, params.categoryId));
    if (params.search) conditions.push(ilike(automations.name, `%${params.search}%`));

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const rows = await db
      .select()
      .from(automations)
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
      automationEngineId: string;
      orgCategoryId?: string;
      webhookPath: string;
      inputSchema?: string;
      outputSchema?: string;
      subaccountId?: string;
    }
  ) {
    const [engine] = await db
      .select()
      .from(automationEngines)
      .where(and(eq(automationEngines.id, data.automationEngineId), eq(automationEngines.organisationId, organisationId), isNull(automationEngines.deletedAt)));

    if (!engine || engine.status !== 'active') {
      throw { statusCode: 404, message: 'Workflow engine not found or inactive' };
    }

    const [process] = await db
      .insert(automations)
      .values({
        organisationId,
        automationEngineId: data.automationEngineId,
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
      .from(automations)
      .where(and(eq(automations.id, id), eq(automations.organisationId, organisationId), isNull(automations.deletedAt)));

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
      .from(automations)
      .where(and(eq(automations.id, id), eq(automations.organisationId, organisationId), isNull(automations.deletedAt)));

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
      .update(automations)
      .set(update as Parameters<typeof db.update>[0] extends unknown ? never : never)
      .where(and(eq(automations.id, id), eq(automations.organisationId, organisationId)))
      .returning();

    return { id: updated.id, name: updated.name, status: updated.status };
  }

  async deleteProcess(id: string, organisationId: string) {
    const [process] = await db
      .select()
      .from(automations)
      .where(and(eq(automations.id, id), eq(automations.organisationId, organisationId), isNull(automations.deletedAt)));

    if (!process) throw { statusCode: 404, message: 'Process not found' };

    const now = new Date();
    await db.update(automations).set({ deletedAt: now, updatedAt: now }).where(and(eq(automations.id, id), eq(automations.organisationId, organisationId)));
    return { message: 'Process deleted successfully' };
  }

  async activateProcess(id: string, organisationId: string) {
    const [process] = await db
      .select()
      .from(automations)
      .where(and(eq(automations.id, id), eq(automations.organisationId, organisationId), isNull(automations.deletedAt)));

    if (!process) throw { statusCode: 404, message: 'Process not found' };

    const automationEngineId = process.automationEngineId;
    if (!automationEngineId) throw { statusCode: 400, message: 'Process has no workflow engine configured' };

    const [engine] = await db
      .select()
      .from(automationEngines)
      .where(and(eq(automationEngines.id, automationEngineId), eq(automationEngines.organisationId, organisationId), isNull(automationEngines.deletedAt)));

    if (!engine || engine.status !== 'active') {
      throw { statusCode: 400, message: 'Process cannot be activated: engine is inactive' };
    }

    const [updated] = await db
      .update(automations)
      .set({ status: 'active', updatedAt: new Date() })
      .where(and(eq(automations.id, id), eq(automations.organisationId, organisationId)))
      .returning();

    return { id: updated.id, status: updated.status };
  }

  async deactivateProcess(id: string, organisationId: string) {
    const [process] = await db
      .select()
      .from(automations)
      .where(and(eq(automations.id, id), eq(automations.organisationId, organisationId), isNull(automations.deletedAt)));

    if (!process) throw { statusCode: 404, message: 'Process not found' };
    if (!process.automationEngineId) throw { statusCode: 400, message: 'Process has no workflow engine configured' };

    const [updated] = await db
      .update(automations)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(and(eq(automations.id, id), eq(automations.organisationId, organisationId)))
      .returning();

    return { id: updated.id, status: updated.status };
  }

  async testProcess(id: string, organisationId: string, userId: string, inputData?: unknown) {
    const [process] = await db
      .select()
      .from(automations)
      .where(and(eq(automations.id, id), eq(automations.organisationId, organisationId), isNull(automations.deletedAt)));

    if (!process) throw { statusCode: 404, message: 'Process not found' };

    const automationEngineId = process.automationEngineId;
    if (!automationEngineId) throw { statusCode: 400, message: 'Process has no workflow engine configured' };

    const [engine] = await db
      .select()
      .from(automationEngines)
      .where(and(eq(automationEngines.id, automationEngineId), eq(automationEngines.organisationId, organisationId), isNull(automationEngines.deletedAt)));

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

  async listSystemAutomations() {
    return db.select()
      .from(automations)
      .where(and(eq(automations.scope, 'system'), eq(automations.status, 'active'), isNull(automations.deletedAt)))
      .orderBy(desc(automations.createdAt));
  }

  async linkSystemAutomation(
    orgId: string,
    systemAutomationId: string,
    data: { name?: string; description?: string; defaultConfig?: unknown },
  ) {
    const [systemProcess] = await db.select()
      .from(automations)
      .where(and(eq(automations.id, systemAutomationId), eq(automations.scope, 'system'), isNull(automations.deletedAt)));

    if (!systemProcess) throw { statusCode: 404, message: 'System process not found' };
    if (systemProcess.status !== 'active') {
      throw { statusCode: 400, message: 'Cannot link an inactive system process' };
    }

    const [existing] = await db.select()
      .from(automations)
      .where(and(eq(automations.organisationId, orgId), eq(automations.systemAutomationId, systemProcess.id), isNull(automations.deletedAt)));
    if (existing) {
      throw { statusCode: 409, message: 'This system process is already linked to your organisation' };
    }

    const [linked] = await db.insert(automations).values({
      organisationId: orgId,
      automationEngineId: null,
      name: data.name || systemProcess.name,
      description: data.description ?? systemProcess.description,
      webhookPath: '',
      scope: 'organisation',
      isEditable: true,
      isSystemManaged: true,
      systemAutomationId: systemProcess.id,
      defaultConfig: (data.defaultConfig as Record<string, unknown> | null | undefined) ?? null,
      status: 'active',
    }).returning();

    return linked;
  }

  async cloneAutomation(orgId: string, sourceId: string, name?: string) {
    const [source] = await db.select()
      .from(automations)
      .where(and(eq(automations.id, sourceId), isNull(automations.deletedAt)));

    if (!source) throw { statusCode: 404, message: 'Source process not found' };

    if (source.scope !== 'system' && source.organisationId !== orgId) {
      throw { statusCode: 403, message: 'Cannot clone automations from another organisation' };
    }

    const [cloned] = await db.insert(automations).values({
      organisationId: orgId,
      automationEngineId: null,
      name: name || `${source.name} (Clone)`,
      description: source.description,
      webhookPath: source.webhookPath,
      inputSchema: source.inputSchema,
      outputSchema: source.outputSchema,
      configSchema: source.configSchema,
      defaultConfig: source.defaultConfig,
      requiredConnections: source.requiredConnections,
      scope: 'organisation',
      isEditable: true,
      parentAutomationId: source.id,
      status: 'draft',
    }).returning();

    return cloned;
  }

  private _mapProcess(t: typeof automations.$inferSelect, includeAdmin: boolean) {
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
      ...(includeAdmin ? { automationEngineId: t.automationEngineId, webhookPath: t.webhookPath } : {}),
    };
  }
}

export const automationService = new AutomationService();

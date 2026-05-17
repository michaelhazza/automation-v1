import crypto from 'crypto';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { automationEngines } from '../db/schema/index.js';
import { connectionTokenService } from './connectionTokenService.js';

type EngineRow = typeof automationEngines.$inferSelect;

function sanitizeEngine(engine: EngineRow) {
  const { hmacSecret: _hmacSecret, apiKey: _apiKey, ...rest } = engine;
  return rest;
}

export class EngineService {
  async listEngines(organisationId: string, params: { status?: string }) {
    const rows = await getOrgScopedDb('engineService.listEngines')
      .select()
      .from(automationEngines)
      .where(and(eq(automationEngines.organisationId, organisationId), isNull(automationEngines.deletedAt)));

    let result = rows;
    if (params.status) result = result.filter((e) => e.status === params.status);

    return result.map((e) => ({
      id: e.id,
      name: e.name,
      engineType: e.engineType,
      status: e.status,
      lastTestedAt: e.lastTestedAt,
      lastTestStatus: e.lastTestStatus,
    }));
  }

  async createEngine(
    organisationId: string,
    data: { name: string; engineType: string; baseUrl: string; apiKey?: string }
  ) {
    const hmacSecret = crypto.randomBytes(32).toString('hex');

    const [engine] = await getOrgScopedDb('engineService.createEngine')
      .insert(automationEngines)
      .values({
        organisationId,
        name: data.name,
        engineType: data.engineType as 'n8n',
        baseUrl: data.baseUrl,
        apiKey: data.apiKey ? connectionTokenService.encryptToken(data.apiKey) : undefined,
        scope: 'organisation',
        hmacSecret,
        status: 'inactive',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return {
      id: engine.id,
      name: engine.name,
      engineType: engine.engineType,
      status: engine.status,
    };
  }

  async getEngine(id: string, organisationId: string) {
    const [engine] = await getOrgScopedDb('engineService.getEngine')
      .select()
      .from(automationEngines)
      .where(and(eq(automationEngines.id, id), eq(automationEngines.organisationId, organisationId), isNull(automationEngines.deletedAt)));

    if (!engine) {
      throw { statusCode: 404, message: 'Workflow engine not found' };
    }

    return {
      id: engine.id,
      name: engine.name,
      engineType: engine.engineType,
      baseUrl: engine.baseUrl,
      status: engine.status,
      lastTestedAt: engine.lastTestedAt,
      lastTestStatus: engine.lastTestStatus,
    };
  }

  async updateEngine(
    id: string,
    organisationId: string,
    data: { name?: string; baseUrl?: string; apiKey?: string; status?: string }
  ) {
    const updateEngineScopedDb = getOrgScopedDb('engineService.updateEngine');
    const [engine] = await updateEngineScopedDb
      .select()
      .from(automationEngines)
      .where(and(eq(automationEngines.id, id), eq(automationEngines.organisationId, organisationId), isNull(automationEngines.deletedAt)));

    if (!engine) {
      throw { statusCode: 404, message: 'Workflow engine not found' };
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) update.name = data.name;
    if (data.baseUrl !== undefined) update.baseUrl = data.baseUrl;
    if (data.apiKey !== undefined) update.apiKey = data.apiKey ? connectionTokenService.encryptToken(data.apiKey) : null;
    if (data.status !== undefined) update.status = data.status;

    const [updated] = await updateEngineScopedDb
      .update(automationEngines)
      .set(update)
      .where(and(eq(automationEngines.id, id), eq(automationEngines.organisationId, organisationId)))
      .returning();

    return {
      id: updated.id,
      name: updated.name,
      status: updated.status,
    };
  }

  async deleteEngine(id: string, organisationId: string) {
    const deleteEngineScopedDb = getOrgScopedDb('engineService.deleteEngine');
    const [engine] = await deleteEngineScopedDb
      .select()
      .from(automationEngines)
      .where(and(eq(automationEngines.id, id), eq(automationEngines.organisationId, organisationId), isNull(automationEngines.deletedAt)));

    if (!engine) {
      throw { statusCode: 404, message: 'Workflow engine not found' };
    }

    const now = new Date();
    await deleteEngineScopedDb.update(automationEngines).set({ deletedAt: now, updatedAt: now }).where(and(eq(automationEngines.id, id), eq(automationEngines.organisationId, organisationId)));

    return { message: 'Workflow engine deleted successfully' };
  }

  // ---------------------------------------------------------------------------
  // System-engine methods (global scope — no orgId, filtered by scope='system')
  // ---------------------------------------------------------------------------

  /**
   * Returns all active system engines.
   * System engines are global (scope='system') and have no organisationId.
   * hmacSecret and apiKey are stripped from the response.
   */
  async listSystemEngines() {
    const rows = await getOrgScopedDb('engineService.listSystemEngines')
      .select()
      .from(automationEngines)
      .where(and(eq(automationEngines.scope, 'system'), isNull(automationEngines.deletedAt)))
      .orderBy(desc(automationEngines.createdAt));

    return rows.map(sanitizeEngine);
  }

  /**
   * Creates a new system engine (scope='system', no organisationId).
   * Generates a fresh hmacSecret; apiKey stored as-is (plain) for system engines.
   */
  async createSystemEngine(data: {
    name: string;
    engineType: string;
    baseUrl: string;
    apiKey?: string;
  }) {
    const hmacSecret = crypto.randomBytes(32).toString('hex');

    const [engine] = await getOrgScopedDb('engineService.createSystemEngine')
      .insert(automationEngines)
      .values({
        organisationId: null,
        name: data.name,
        engineType: data.engineType as 'n8n',
        baseUrl: data.baseUrl,
        apiKey: data.apiKey ?? null,
        scope: 'system',
        subaccountId: null,
        hmacSecret,
        status: 'inactive',
      })
      .returning();

    return sanitizeEngine(engine);
  }

  /**
   * Fetches a single system engine by id (scope='system', not deleted).
   * Throws 404 if not found.
   */
  async getSystemEngineById(id: string) {
    const [engine] = await getOrgScopedDb('engineService.getSystemEngineById')
      .select()
      .from(automationEngines)
      .where(and(eq(automationEngines.id, id), eq(automationEngines.scope, 'system'), isNull(automationEngines.deletedAt)));

    if (!engine) throw { statusCode: 404, message: 'System engine not found' };

    return sanitizeEngine(engine);
  }

  /**
   * Updates a system engine by id.
   * Throws 404 if not found.
   */
  async updateSystemEngine(
    id: string,
    data: { name?: string; engineType?: string; baseUrl?: string; apiKey?: string; status?: string; metadata?: unknown }
  ) {
    const updateSystemScopedDb = getOrgScopedDb('engineService.updateSystemEngine');
    const [existing] = await updateSystemScopedDb
      .select()
      .from(automationEngines)
      .where(and(eq(automationEngines.id, id), eq(automationEngines.scope, 'system'), isNull(automationEngines.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'System engine not found' };

    const allowed = ['name', 'engineType', 'baseUrl', 'apiKey', 'status', 'metadata'] as const;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of allowed) {
      if (data[key] !== undefined) updates[key] = data[key];
    }

    const [updated] = await updateSystemScopedDb
      .update(automationEngines)
      .set(updates)
      .where(eq(automationEngines.id, id))
      .returning();

    return sanitizeEngine(updated);
  }

  /**
   * Soft-deletes a system engine by setting deletedAt.
   * Throws 404 if not found.
   */
  async deleteSystemEngine(id: string): Promise<void> {
    const deleteSystemScopedDb = getOrgScopedDb('engineService.deleteSystemEngine');
    const [existing] = await deleteSystemScopedDb
      .select()
      .from(automationEngines)
      .where(and(eq(automationEngines.id, id), eq(automationEngines.scope, 'system'), isNull(automationEngines.deletedAt)));

    if (!existing) throw { statusCode: 404, message: 'System engine not found' };

    await deleteSystemScopedDb
      .update(automationEngines)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(automationEngines.id, id));
  }

  // ---------------------------------------------------------------------------
  // Subaccount-engine methods (scope='subaccount', filtered by subaccountId)
  // ---------------------------------------------------------------------------

  async listSubaccountEngines(subaccountId: string) {
    const rows = await getOrgScopedDb('engineService.listSubaccountEngines')
      .select()
      .from(automationEngines)
      .where(and(
        eq(automationEngines.subaccountId, subaccountId),
        eq(automationEngines.scope, 'subaccount'),
        isNull(automationEngines.deletedAt)
      ))
      .orderBy(desc(automationEngines.createdAt));

    return rows.map(sanitizeEngine);
  }

  async createSubaccountEngine(
    organisationId: string,
    subaccountId: string,
    data: { name: string; engineType: string; baseUrl: string; apiKey?: string | null }
  ) {
    const hmacSecret = crypto.randomBytes(32).toString('hex');

    const [engine] = await getOrgScopedDb('engineService.createSubaccountEngine')
      .insert(automationEngines)
      .values({
        organisationId,
        name: data.name,
        engineType: data.engineType as 'n8n',
        baseUrl: data.baseUrl,
        apiKey: data.apiKey ?? null,
        scope: 'subaccount',
        subaccountId,
        hmacSecret,
        status: 'inactive',
      })
      .returning();

    return sanitizeEngine(engine);
  }

  async updateSubaccountEngine(
    id: string,
    subaccountId: string,
    data: { name?: string; engineType?: string; baseUrl?: string; apiKey?: string | null; status?: string; metadata?: unknown }
  ) {
    const updateSubaccountEngineScopedDb = getOrgScopedDb('engineService.updateSubaccountEngine');
    const [existing] = await updateSubaccountEngineScopedDb
      .select()
      .from(automationEngines)
      .where(and(
        eq(automationEngines.id, id),
        eq(automationEngines.subaccountId, subaccountId),
        isNull(automationEngines.deletedAt)
      ));

    if (!existing) throw { statusCode: 404, message: 'Engine not found' };

    const allowed = ['name', 'engineType', 'baseUrl', 'apiKey', 'status', 'metadata'] as const;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of allowed) {
      if (data[key] !== undefined) updates[key] = data[key];
    }

    const [updated] = await updateSubaccountEngineScopedDb
      .update(automationEngines)
      .set(updates)
      .where(eq(automationEngines.id, id))
      .returning();

    return sanitizeEngine(updated);
  }

  async deleteSubaccountEngine(id: string, subaccountId: string): Promise<void> {
    const deleteSubaccountEngineScopedDb = getOrgScopedDb('engineService.deleteSubaccountEngine');
    const [existing] = await deleteSubaccountEngineScopedDb
      .select()
      .from(automationEngines)
      .where(and(
        eq(automationEngines.id, id),
        eq(automationEngines.subaccountId, subaccountId),
        isNull(automationEngines.deletedAt)
      ));

    if (!existing) throw { statusCode: 404, message: 'Engine not found' };

    await deleteSubaccountEngineScopedDb
      .update(automationEngines)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(automationEngines.id, id));
  }

  async testEngineConnection(id: string, organisationId: string) {
    const testConnScopedDb = getOrgScopedDb('engineService.testEngineConnection');
    const [engine] = await testConnScopedDb
      .select()
      .from(automationEngines)
      .where(and(eq(automationEngines.id, id), eq(automationEngines.organisationId, organisationId), isNull(automationEngines.deletedAt)));

    if (!engine) {
      throw { statusCode: 404, message: 'Workflow engine not found' };
    }

    const start = Date.now();
    try {
      const response = await fetch(engine.baseUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
        headers: engine.apiKey ? { 'X-N8N-API-KEY': connectionTokenService.decryptToken(engine.apiKey) } : {},
      });
      const responseTimeMs = Date.now() - start;
      const success = response.ok || response.status < 500;

      await testConnScopedDb
        .update(automationEngines)
        .set({
          lastTestedAt: new Date(),
          lastTestStatus: success ? 'success' : 'failed',
          status: success ? 'active' : engine.status,
          updatedAt: new Date(),
        })
        .where(and(eq(automationEngines.id, id), eq(automationEngines.organisationId, organisationId)));

      return {
        success,
        responseTimeMs,
        message: success ? 'Connection successful' : `Connection failed with status ${response.status}`,
      };
    } catch (err: unknown) {
      const responseTimeMs = Date.now() - start;
      await testConnScopedDb
        .update(automationEngines)
        .set({ lastTestedAt: new Date(), lastTestStatus: 'failed', updatedAt: new Date() })
        .where(and(eq(automationEngines.id, id), eq(automationEngines.organisationId, organisationId)));

      const message = err instanceof Error ? err.message : 'Connection failed';
      throw { statusCode: 503, message: `Engine connection test failed: ${message}` };
    }
  }
}

export const engineService = new EngineService();

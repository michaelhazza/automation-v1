import crypto from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { automationEngines } from '../db/schema/index.js';
import { connectionTokenService } from './connectionTokenService.js';

export class EngineService {
  async listEngines(organisationId: string, params: { status?: string }) {
    const rows = await db
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

    const [engine] = await db
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
    const [engine] = await db
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
    const [engine] = await db
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

    const [updated] = await db
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
    const [engine] = await db
      .select()
      .from(automationEngines)
      .where(and(eq(automationEngines.id, id), eq(automationEngines.organisationId, organisationId), isNull(automationEngines.deletedAt)));

    if (!engine) {
      throw { statusCode: 404, message: 'Workflow engine not found' };
    }

    const now = new Date();
    await db.update(automationEngines).set({ deletedAt: now, updatedAt: now }).where(and(eq(automationEngines.id, id), eq(automationEngines.organisationId, organisationId)));

    return { message: 'Workflow engine deleted successfully' };
  }

  async testEngineConnection(id: string, organisationId: string) {
    const [engine] = await db
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

      await db
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
      await db
        .update(automationEngines)
        .set({ lastTestedAt: new Date(), lastTestStatus: 'failed', updatedAt: new Date() })
        .where(and(eq(automationEngines.id, id), eq(automationEngines.organisationId, organisationId)));

      const message = err instanceof Error ? err.message : 'Connection failed';
      throw { statusCode: 503, message: `Engine connection test failed: ${message}` };
    }
  }
}

export const engineService = new EngineService();

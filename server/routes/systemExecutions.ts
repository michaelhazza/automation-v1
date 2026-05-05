import { Router } from 'express';
import { authenticate, requireSystemAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { db } from '../db/index.js';
import { executions, executionPayloads, organisations, automations, users } from '../db/schema/index.js';
import { eq, and, gte, lte, desc, SQL } from 'drizzle-orm';
import { parsePositiveInt } from '../middleware/validate.js';

const router = Router();

/**
 * GET /api/system/executions
 * System-admin-only: list executions across ALL organisations with diagnostic fields.
 */
router.get('/api/system/executions', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
  const {
    organisationId,
    status,
    engineType,
    from,
    to,
    limit: limitRaw,
    offset: offsetRaw,
  } = req.query;

  const limit = parsePositiveInt(limitRaw) ?? 50;
  const offset = parsePositiveInt(offsetRaw) ?? 0;

  const conditions: SQL[] = [];
  if (organisationId) conditions.push(eq(executions.organisationId, organisationId as string));
  if (status) conditions.push(eq(executions.status, status as 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'));
  if (engineType) conditions.push(eq(executions.engineType, engineType as string));
  if (from) conditions.push(gte(executions.createdAt, new Date(from as string)));
  if (to) conditions.push(lte(executions.createdAt, new Date(to as string)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
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

  res.json(rows);
}));

/**
 * GET /api/system/executions/:id
 * System-admin-only: full diagnostic detail for a single execution.
 */
router.get('/api/system/executions/:id', authenticate, requireSystemAdmin, asyncHandler(async (req, res) => {
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
    .where(eq(executions.id, req.params.id));

  if (!row) {
    res.status(404).json({ error: 'Execution not found' });
    return;
  }

  res.json(row);
}));

export default router;

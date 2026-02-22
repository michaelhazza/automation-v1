import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { executions, organisations, tasks, users } from '../db/schema/index.js';
import { eq, and, gte, lte, desc, ilike, SQL } from 'drizzle-orm';
import { parsePositiveInt } from '../middleware/validate.js';

const router = Router();

/**
 * GET /api/system/executions
 * System-admin-only: list executions across ALL organisations with diagnostic fields.
 * Supports filters: organisationId, status, engineType, taskName, userId, from, to
 */
router.get('/api/system/executions', authenticate, requireRole('system_admin'), async (req, res) => {
  try {
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
        // Execution core fields
        id: executions.id,
        status: executions.status,
        engineType: executions.engineType,
        isTestExecution: executions.isTestExecution,
        retryCount: executions.retryCount,
        errorMessage: executions.errorMessage,
        errorDetail: executions.errorDetail,
        // Diagnostic / webhook fields
        returnWebhookUrl: executions.returnWebhookUrl,
        outboundPayload: executions.outboundPayload,
        callbackReceivedAt: executions.callbackReceivedAt,
        callbackPayload: executions.callbackPayload,
        // Timing
        queuedAt: executions.queuedAt,
        startedAt: executions.startedAt,
        completedAt: executions.completedAt,
        durationMs: executions.durationMs,
        createdAt: executions.createdAt,
        // FK ids for joins
        organisationId: executions.organisationId,
        taskId: executions.taskId,
        userId: executions.userId,
        // Notify flag
        notifyOnComplete: executions.notifyOnComplete,
        // Task snapshot for task name
        taskSnapshot: executions.taskSnapshot,
        // Joined: org name
        organisationName: organisations.name,
        // Joined: task name (live)
        taskName: tasks.name,
        // Joined: user email / name
        userEmail: users.email,
        userFirstName: users.firstName,
        userLastName: users.lastName,
      })
      .from(executions)
      .leftJoin(organisations, eq(executions.organisationId, organisations.id))
      .leftJoin(tasks, eq(executions.taskId, tasks.id))
      .leftJoin(users, eq(executions.userId, users.id))
      .where(whereClause)
      .orderBy(desc(executions.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(rows);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

/**
 * GET /api/system/executions/:id
 * System-admin-only: full diagnostic detail for a single execution.
 */
router.get('/api/system/executions/:id', authenticate, requireRole('system_admin'), async (req, res) => {
  try {
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
        outboundPayload: executions.outboundPayload,
        callbackReceivedAt: executions.callbackReceivedAt,
        callbackPayload: executions.callbackPayload,
        queuedAt: executions.queuedAt,
        startedAt: executions.startedAt,
        completedAt: executions.completedAt,
        durationMs: executions.durationMs,
        createdAt: executions.createdAt,
        notifyOnComplete: executions.notifyOnComplete,
        taskSnapshot: executions.taskSnapshot,
        organisationId: executions.organisationId,
        taskId: executions.taskId,
        userId: executions.userId,
        organisationName: organisations.name,
        taskName: tasks.name,
        userEmail: users.email,
        userFirstName: users.firstName,
        userLastName: users.lastName,
      })
      .from(executions)
      .leftJoin(organisations, eq(executions.organisationId, organisations.id))
      .leftJoin(tasks, eq(executions.taskId, tasks.id))
      .leftJoin(users, eq(executions.userId, users.id))
      .where(eq(executions.id, req.params.id));

    if (!row) {
      res.status(404).json({ error: 'Execution not found' });
      return;
    }

    res.json(row);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e.statusCode ?? 500).json({ error: e.message ?? 'Internal server error' });
  }
});

export default router;

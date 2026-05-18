import { Router } from 'express';
import { authenticate, requireOrgPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { createTaskIntake, getTaskArtefacts, getTaskMeta } from '../services/taskCreationService.js';
import { decodeCursor } from '../services/taskArtefactCursorPure.js';
import { handleConversationFollowUp } from '../services/taskConversationService.js';
import { decideTaskApproval } from '../services/taskApprovalService.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { parseDueDate, DueDateParseError } from '../lib/dates.js';
import { logger } from '../lib/logger.js';
import { tasks, agentRuns } from '../db/schema/index.js';
import { eq, and, inArray, asc } from 'drizzle-orm';
import type { TaskCreatedResponse, TaskUiContext } from '../../shared/types/taskFastPath.js';

const taskIntakeRouter = Router();

// POST /api/task-intake — create a Task from the new-task modal or global ask bar
taskIntakeRouter.post(
  '/api/task-intake',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.TASKS_WRITE),
  asyncHandler(async (req, res) => {
    const {
      instructions, title, source, uiContext, subaccountId,
      assignedAgentId, dueDate, priority,
    } = req.body as {
      instructions?: string;
      title?: string;
      source?: 'new_task_modal' | 'global_ask_bar' | 'programmatic';
      uiContext?: Partial<TaskUiContext>;
      subaccountId?: string;
      assignedAgentId?: string;
      dueDate?: string;
      priority?: 'low' | 'normal' | 'high' | 'urgent';
    };

    if (!instructions?.trim()) {
      res.status(400).json({ message: 'instructions is required' });
      return;
    }

    if (source !== undefined && source !== 'new_task_modal' && source !== 'global_ask_bar' && source !== 'programmatic') {
      res.status(400).json({ message: 'source must be one of: new_task_modal, global_ask_bar, programmatic' });
      return;
    }

    // Cross-entity verification (DEVELOPMENT_GUIDELINES §9): when a
    // subaccountId is supplied, confirm it belongs to req.orgId before any
    // write. resolveSubaccount throws { statusCode: 404 } on mismatch —
    // asyncHandler maps that to a 404 response.
    const effectiveSubaccountId = subaccountId ?? uiContext?.currentSubaccountId;
    if (effectiveSubaccountId) {
      await resolveSubaccount(effectiveSubaccountId, req.orgId!);
    }

    let parsedDueDate: Date | undefined;
    if (dueDate) {
      try {
        // Subaccounts do not store a timezone field; fall back to UTC-midnight.
        parsedDueDate = parseDueDate(dueDate, null);
      } catch (err) {
        if (err instanceof DueDateParseError) {
          res.status(400).json({ message: `Invalid dueDate: ${err.message}` });
          return;
        }
        throw err;
      }
    }

    const context: TaskUiContext = {
      surface: uiContext?.surface ?? 'task_intake_chat',
      currentOrgId: req.orgId!,
      currentSubaccountId: effectiveSubaccountId,
      userPermissions: new Set<string>(),
    };

    const result = await createTaskIntake({
      organisationId: req.orgId!,
      subaccountId: effectiveSubaccountId,
      submittedByUserId: req.user!.id,
      instructions: instructions.trim(),
      title: title?.trim() || undefined,
      source: source ?? 'global_ask_bar',
      uiContext: context,
      assignedAgentId,
      dueDate: parsedDueDate,
      priority,
    });

    const envelope: TaskCreatedResponse = {
      type: 'task_created',
      taskId: result.taskId,
      conversationId: result.conversationId,
      fastPathDecision: result.fastPathDecision,
      organisationId: req.orgId!,
      subaccountId: effectiveSubaccountId ?? null,
      organisationName: null,
      subaccountName: null,
    };
    res.status(201).json(envelope);
  }),
);

// GET /api/task-intake/:taskId — Task metadata + its conversationId
taskIntakeRouter.get(
  '/api/task-intake/:taskId',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_READ),
  asyncHandler(async (req, res) => {
    const { taskId } = req.params;

    const meta = await getTaskMeta(taskId, req.orgId!);
    if (!meta) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    res.json(meta);
  }),
);

// GET /api/task-intake/:taskId/active-run — runId of the current in-flight agent run
taskIntakeRouter.get(
  '/api/task-intake/:taskId/active-run',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_READ),
  asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const tx = getOrgScopedDb('taskIntake.active_run');

    const [run] = await tx
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.taskId, taskId),
          eq(agentRuns.organisationId, req.orgId!),
          inArray(agentRuns.status, ['running', 'delegated', 'cancelling']),
        ),
      )
      .orderBy(asc(agentRuns.createdAt))
      .limit(1);

    res.json({ runId: run?.id ?? null });
  }),
);

// GET /api/task-intake/:taskId/artefacts — paginated artefact list for a Task
taskIntakeRouter.get(
  '/api/task-intake/:taskId/artefacts',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.BRIEFS_READ),
  asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const rawLimit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const limit = rawLimit !== undefined && Number.isFinite(rawLimit) ? rawLimit : 50;
    if (req.query.limit !== undefined && (rawLimit === undefined || !Number.isFinite(rawLimit))) {
      logger.info('task_intake_artefacts.limit_invalid', { taskId, raw: req.query.limit });
    }
    const cursor = typeof req.query.cursor === 'string'
      ? decodeCursor(req.query.cursor)
      : null;

    const result = await getTaskArtefacts(taskId, req.orgId!, { limit, cursor });
    res.json(result);
  }),
);

// POST /api/task-intake/:taskId/messages — add a follow-up user message to a Task
taskIntakeRouter.post(
  '/api/task-intake/:taskId/messages',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.TASKS_WRITE),
  asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const { content, conversationId, uiContext, subaccountId } = req.body as {
      content?: string;
      conversationId?: string;
      uiContext?: Partial<TaskUiContext>;
      subaccountId?: string;
    };

    if (!content?.trim()) {
      res.status(400).json({ message: 'content is required' });
      return;
    }
    if (!conversationId) {
      res.status(400).json({ message: 'conversationId is required' });
      return;
    }

    // Derive the canonical subaccountId from the task row itself rather than
    // trusting the client payload.
    const tx = getOrgScopedDb('taskIntake.followup');
    const [taskRow] = await tx
      .select({ subaccountId: tasks.subaccountId })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, req.orgId!)))
      .limit(1);

    if (!taskRow) {
      res.status(404).json({ message: 'Task not found' });
      return;
    }

    const canonicalSubaccountId = taskRow.subaccountId ?? subaccountId ?? uiContext?.currentSubaccountId;

    const context: TaskUiContext = {
      surface: uiContext?.surface ?? 'task_intake_chat',
      currentOrgId: req.orgId!,
      currentSubaccountId: canonicalSubaccountId ?? undefined,
      userPermissions: new Set<string>(),
    };

    const result = await handleConversationFollowUp({
      conversationId,
      taskId,
      organisationId: req.orgId!,
      subaccountId: canonicalSubaccountId ?? undefined,
      text: content.trim(),
      uiContext: context,
      senderUserId: req.user!.id,
    });

    res.status(201).json(result);
  }),
);

// POST /api/task-intake/:taskId/approvals/:artefactId/decision — approve or reject an approval card
taskIntakeRouter.post(
  '/api/task-intake/:taskId/approvals/:artefactId/decision',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.TASKS_WRITE),
  asyncHandler(async (req, res) => {
    const { taskId, artefactId } = req.params;
    const { decision, reason, conversationId, subaccountId } = req.body as {
      decision?: 'approve' | 'reject';
      reason?: string;
      conversationId?: string;
      subaccountId?: string;
    };

    if (decision !== 'approve' && decision !== 'reject') {
      res.status(400).json({ status: 'failed', error: 'decision must be approve or reject' });
      return;
    }
    if (!conversationId) {
      res.status(400).json({ status: 'failed', error: 'conversationId is required' });
      return;
    }

    const result = await decideTaskApproval({
      artefactId,
      decision,
      reason,
      conversationId,
      taskId,
      organisationId: req.orgId!,
      subaccountId,
      userId: req.user!.id,
    });

    if (result.status === 'failed') {
      if (result.error === 'artefact_not_found') { res.status(404).json(result); return; }
      if (result.error === 'artefact_not_approval') { res.status(422).json(result); return; }
      if (result.error === 'artefact_stale') { res.status(410).json(result); return; }
      if (result.error === 'approval_already_decided') { res.status(409).json(result); return; }
    }

    res.status(200).json(result);
  }),
);

export default taskIntakeRouter;

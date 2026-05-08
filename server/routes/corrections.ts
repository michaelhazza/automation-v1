// server/routes/corrections.ts
// Operator correction capture endpoint.
// Trust & Verification Layer spec §13.2, §9 (cross-entity guard).

import { Router } from 'express';
import {
  authenticate,
  hasOrgPermission,
  hasSubaccountPermission,
} from '../middleware/auth.js';
import { SUBACCOUNT_PERMISSIONS, ORG_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { create, verifyEventBelongsToRun } from '../services/correctionCaptureService.js';
import { correctionPayloadValidator } from '../../shared/types/correction.js';
import { validateEventIdShape } from './correctionsRoutePure.js';
import type { CorrectionDialogPayload } from '../../shared/types/correction.js';
import { agentRuns } from '../db/schema/index.js';
import { db } from '../db/index.js';
import { eq, and } from 'drizzle-orm';

const router = Router();

// ── POST /api/runs/:runId/steps/:eventId/correct ──────────────────────────────
//
// Permission model (spec §13.2):
//   • Subaccount-scoped runs: subaccount.corrections.create
//   • Org-scope runs (no subaccountId): org.observability.view
// We authenticate first, then do a fine-grained permission check inline since
// the run's scope (subaccount vs org) determines which guard applies.

router.post(
  '/api/runs/:runId/steps/:eventId/correct',
  authenticate,
  asyncHandler(async (req, res) => {
    const { runId, eventId } = req.params;
    const orgId = req.orgId!;

    // Step 1: resolve the run and verify org ownership.
    const [run] = await db
      .select({
        id: agentRuns.id,
        subaccountId: agentRuns.subaccountId,
        agentId: agentRuns.agentId,
      })
      .from(agentRuns)
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.organisationId, orgId)))
      .limit(1);

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    // Step 2: permission gate — subaccount-scoped vs org-scope.
    // Use the run's subaccountId rather than req.params (the route only carries
    // runId / eventId in its params; requireSubaccountPermission middleware
    // would 400 on the missing param). hasSubaccountPermission is the
    // programmatic equivalent that accepts the subaccount id directly.
    if (run.subaccountId) {
      const canCorrect = await hasSubaccountPermission(
        req,
        run.subaccountId,
        SUBACCOUNT_PERMISSIONS.CORRECTIONS_CREATE,
      );
      if (!canCorrect) {
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }
    } else {
      // Org-scope run — require org.observability.view.
      const canView = await hasOrgPermission(req, ORG_PERMISSIONS.ORG_OBSERVABILITY_VIEW);
      if (!canView) {
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }
    }

    // Step 3: cross-entity guard — eventId MUST be a real
    // agent_execution_events.id that belongs to runId AND organisationId
    // (spec §9). The trace-events route enriches each tool-call with its
    // canonical event id, so the UI always has a real id to send. Reject
    // any request that lacks one (placeholder or stale-client) so we never
    // persist a memory_block carrying a non-existent sourceEventId.
    const eventIdVerdict = validateEventIdShape(eventId, runId);
    if (eventIdVerdict !== 'ok') {
      res.status(400).json({
        error: 'eventId is required and must reference a real run step',
        code: 'EVENT_ID_REQUIRED',
      });
      return;
    }
    const eventBelongs = await verifyEventBelongsToRun(eventId, runId, orgId);
    if (!eventBelongs) {
      res.status(404).json({ error: 'Step not found' });
      return;
    }

    // Step 4: parse and validate body.
    const body = req.body as Partial<CorrectionDialogPayload>;
    const { editedOutput, reason = null } = body;

    if (typeof editedOutput !== 'string') {
      res.status(422).json({ error: 'editedOutput is required' });
      return;
    }

    const validationError = correctionPayloadValidator({ editedOutput, reason: reason ?? null });
    if (validationError === 'EDITED_OUTPUT_EMPTY') {
      res.status(422).json({ error: 'Edited output cannot be empty', code: validationError });
      return;
    }
    if (validationError === 'EDITED_OUTPUT_TOO_LARGE') {
      res.status(422).json({ error: 'Edited output exceeds 50KB limit', code: validationError });
      return;
    }
    if (validationError === 'REASON_TOO_LONG') {
      res.status(422).json({ error: 'Reason exceeds 500 character limit', code: validationError });
      return;
    }

    const { skillSlug, originalOutput = '' } = body;
    if (typeof skillSlug !== 'string' || !skillSlug) {
      res.status(422).json({ error: 'skillSlug is required' });
      return;
    }

    const payload: CorrectionDialogPayload = {
      runId,
      eventId,
      agentId: run.agentId,
      skillSlug,
      originalOutput: typeof originalOutput === 'string' ? originalOutput : '',
      editedOutput,
      reason: reason ?? null,
    };

    // Step 5: capture.
    const result = await create(payload, orgId, run.subaccountId);
    res.status(201).json(result);
  }),
);

export default router;

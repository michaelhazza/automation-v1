// ---------------------------------------------------------------------------
// Schedule Calendar Routes
// ---------------------------------------------------------------------------
//
// Feature 1 (docs/routines-response-dev-spec.md §3.3 / §4.2)
//
//   - GET /api/subaccounts/:subaccountId/schedule-calendar
//     Subaccount-scoped calendar. Gated by `subaccount.workspace.view` so the
//     main Schedule tab and the client-portal card both resolve via a single
//     route. The portal card path is additionally gated by
//     `subaccount.schedule.view_calendar` at the UI level.
//
//   - GET /api/org/schedule-calendar
//     Org-wide rollup. Gated by `org.agents.view` — callers with this read
//     permission already see every subaccount's agent config, so the
//     projected calendar adds no new disclosure.
//
// Query params (both routes):
//   start:        ISO 8601 timestamp (required)
//   end:          ISO 8601 timestamp (required)
//   subaccountId: optional filter on the org route
//
// Responses conform to `ScheduleCalendarResponse` in the service module.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { authenticate, requireOrgPermission, requireSubaccountPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { listScheduleCalendar } from '../services/scheduleCalendarService.js';

const router = Router();

router.get(
  '/api/subaccounts/:subaccountId/schedule-calendar',
  authenticate,
  requireSubaccountPermission(SUBACCOUNT_PERMISSIONS.WORKSPACE_VIEW),
  asyncHandler(async (req, res) => {
    await resolveSubaccount(req.params.subaccountId, req.orgId!);
    const { start, end } = req.query as { start?: string; end?: string };
    if (!start || !end) {
      res.status(400).json({ error: 'start and end query params are required' });
      return;
    }
    const payload = await listScheduleCalendar(req.orgId!, {
      subaccountId: req.params.subaccountId,
      startISO: start,
      endISO: end,
    });
    res.json(payload);
  })
);

router.get(
  '/api/org/schedule-calendar',
  authenticate,
  requireOrgPermission(ORG_PERMISSIONS.AGENTS_VIEW),
  asyncHandler(async (req, res) => {
    const { start, end, subaccountId } = req.query as {
      start?: string;
      end?: string;
      subaccountId?: string;
    };
    if (!start || !end) {
      res.status(400).json({ error: 'start and end query params are required' });
      return;
    }
    const payload = await listScheduleCalendar(req.orgId!, {
      subaccountId: subaccountId || undefined,
      startISO: start,
      endISO: end,
    });
    res.json(payload);
  })
);

export default router;

// ---------------------------------------------------------------------------
// Schedule Calendar Routes
// ---------------------------------------------------------------------------
//
// Feature 1 (docs/routines-response-dev-spec.md §3.3 / §4.2)
//
//   - GET /api/subaccounts/:subaccountId/schedule-calendar
//     Subaccount-scoped calendar. Accessible to any caller with either:
//       - `subaccount.workspace.view`  (org admins, the Schedule tab UX)
//       - `subaccount.schedule.view_calendar`  (client_user portal card)
//     The dedicated permission was added in Feature 1 so the portal card
//     works without granting the broader workspace.view.
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
import { authenticate, requireOrgPermission, hasSubaccountPermission } from '../middleware/auth.js';
import { ORG_PERMISSIONS, SUBACCOUNT_PERMISSIONS } from '../lib/permissions.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { resolveSubaccount } from '../lib/resolveSubaccount.js';
import { listScheduleCalendar } from '../services/scheduleCalendarService.js';

const router = Router();

router.get(
  '/api/subaccounts/:subaccountId/schedule-calendar',
  authenticate,
  asyncHandler(async (req, res) => {
    // Accept either workspace.view (org admins) or schedule.view_calendar
    // (client_user portal card). The narrower permission was added specifically
    // for the portal surface so it works without the broader workspace.view.
    const canView =
      (await hasSubaccountPermission(req, req.params.subaccountId, SUBACCOUNT_PERMISSIONS.WORKSPACE_VIEW)) ||
      (await hasSubaccountPermission(req, req.params.subaccountId, SUBACCOUNT_PERMISSIONS.SCHEDULE_VIEW_CALENDAR));
    if (!canView) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
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

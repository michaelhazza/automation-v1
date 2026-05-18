// client/src/config/routes.ts
//
// Typed route registry.  Every pattern navigated to inside the app MUST be
// listed here so the type system can guard against free-form strings leaking
// into <Link to=> / <NavItem to=> props.
//
// Parametric patterns use the :paramName notation recognised by react-router.

export const APP_ROUTE_PATTERNS = [
  // Root
  '/',
  // User settings
  '/settings',
  // Govern surface
  '/knowledge',
  '/spending',
  '/connections',
  '/quality',
  '/quality/scorecards/create',
  '/quality/bench',
  // Workspace-context routes
  '/automations',
  '/workflows',
  '/org-chart',
  '/clientpulse',
  '/clientpulse/settings',
  '/reports',
  // Parametric project / agent detail
  '/projects/:id',
  '/agents/:agentId',
  '/agents/:id/edit',
  '/portal/:clientId',
  // Parametric subaccount workspace routes
  '/admin/subaccounts/:subaccountId/workspace',
  '/admin/subaccounts/:subaccountId/schedule-calendar',
  '/admin/subaccounts/:subaccountId/page-projects',
  '/admin/subaccounts/:subaccountId/actions',
  '/admin/subaccounts/:subaccountId/goals',
  '/admin/subaccounts/:subaccountId/team',
  '/admin/subaccounts/:subaccountId',
  '/admin/subaccounts/:subaccountId/agents/:agentSubaccountId/manage',
  '/admin/subaccounts/:subaccountId/spend-ledger',
  '/admin/subaccounts/:subaccountId/usage',
  // Org-admin routes (no subaccount param)
  '/admin/subaccounts',
  '/admin/schedule-calendar',
  '/admin/automations',
  '/admin/users',
  '/admin/teams',
  '/admin/health-findings',
  '/admin/org-settings',
  '/admin/spending-budgets',
  '/admin/tasks/:taskId',
  // Consolidated build routes
  '/agents',
  '/recurring-tasks',
  // System-admin routes
  '/system/organisations',
  '/system/skills',
  '/system/workflow-studio',
  '/system/automations',
  '/system/activity',
  '/system/incidents',
  '/system/task-queue',
  '/system/job-queues',
  '/system/llm-pnl',
  '/system/settings',
  // Operate stream — canonical routes (wired in C8)
  '/inbox',
  '/activity',
  '/run-trace/:id',
  // Support Desk canonical substrate (C13)
  '/support/tickets',
  '/support/tickets/:id',
  '/support/drafts',
  '/support/drafts/:id',
  '/support/inboxes',
  '/integrations/support-desk/setup',
  // Personal assistant (personal-assistant-v1)
  '/personal/setup',
  '/personal/:agentId',
  '/personal/:agentId/setup',
] as const;

export type AppRoutePattern = (typeof APP_ROUTE_PATTERNS)[number];

/**
 * A concrete URL produced by buildRoute or staticRoute.
 * The brand prevents free-form strings from leaking past the type system.
 */
export type AppRoute = string & { readonly __brand: 'AppRoute' };

/**
 * Build a concrete URL from a parametric pattern.
 * Each :paramName in the pattern is replaced by the corresponding value from
 * the params map (URI-encoded).  In dev mode an unresolved :param segment
 * triggers a console.warn.
 */
export function buildRoute<P extends AppRoutePattern>(
  pattern: P,
  params?: Record<string, string>,
): AppRoute {
  let out: string = pattern;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      out = out.replace(new RegExp(`:${k}(?![A-Za-z0-9_])`, 'g'), encodeURIComponent(v));
    }
  }
  // Dev-only guard: surface unresolved `:param` segments early.
  if (process.env.NODE_ENV !== 'production' && /(?:^|\/):[A-Za-z_][A-Za-z0-9_]*/.test(out)) {
    console.warn('buildRoute: unresolved params in pattern', { pattern, params, result: out });
  }
  return out as AppRoute;
}

/**
 * Static routes (no `:` segments) cast directly.
 * The conditional type rejects parametric patterns at compile time.
 */
export function staticRoute<P extends AppRoutePattern>(
  pattern: P & (P extends `${string}:${string}` ? never : P),
): AppRoute {
  return pattern as AppRoute;
}

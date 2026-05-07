/**
 * useViewModePure.ts
 *
 * Pure, framework-free derivation helpers for ViewMode.
 * No React imports, no localStorage reads — all inputs are injected via
 * ViewModeContext so these functions are fully unit-testable with npx tsx.
 *
 * Consumers: useViewMode.ts (React wrapper).
 * Tests:     __tests__/useViewModePure.test.ts.
 */

export type ViewMode = 'workspace' | 'org' | 'system';

/** All context needed to derive view mode — injected by useViewMode. */
export interface ViewModeContext {
  hasActiveClient: boolean;
  hasSystemOverride: boolean;
  isOrgAdmin: boolean;
  isSystemAdmin: boolean;
}

/**
 * Derive the current ViewMode from identity context.
 *
 * Priority order (highest wins):
 *   1. System override active AND user is currently a system admin → 'system'
 *   2. No active client AND user is org admin → 'org'
 *   3. Otherwise → 'workspace'
 *
 * The `isSystemAdmin` guard on rule 1 prevents a stale `systemAdminOrgOverride`
 * flag in localStorage from putting a downgraded user into a 'system' mode that
 * `deriveAvailableModes` excludes — that combination produces a sidebar with no
 * active switcher segment and hidden workspace items.
 */
export function deriveViewMode(ctx: ViewModeContext): ViewMode {
  if (ctx.hasSystemOverride && ctx.isSystemAdmin) return 'system';
  if (!ctx.hasActiveClient && ctx.isOrgAdmin) return 'org';
  return 'workspace';
}

/**
 * Derive the set of modes available to this user.
 *
 * - workspace-only user → ['workspace']
 * - org admin (not system admin) → ['workspace', 'org']
 * - system admin → ['workspace', 'org', 'system']
 */
export function deriveAvailableModes(ctx: ViewModeContext): ReadonlyArray<ViewMode> {
  if (ctx.isSystemAdmin) return ['workspace', 'org', 'system'];
  if (ctx.isOrgAdmin) return ['workspace', 'org'];
  return ['workspace'];
}

/**
 * Determine whether a mode transition is legal given current context.
 *
 * Implements the full transition table from spec §4.6:
 *
 * | To         | Condition                   | Legal? |
 * |------------|-----------------------------|--------|
 * | 'org'      | isOrgAdmin                  | true   |
 * | 'org'      | !isOrgAdmin                 | false  |
 * | 'workspace'| hasActiveClient             | true   |
 * | 'workspace'| !hasActiveClient            | false  |
 * | 'system'   | isSystemAdmin               | true   |
 * | 'system'   | !isSystemAdmin              | false  |
 *
 * from === to is always legal (idempotent no-op).
 */
export function isLegalTransition(
  from: ViewMode,
  to: ViewMode,
  ctx: ViewModeContext,
): boolean {
  // Idempotent: same-to-same is always legal
  if (from === to) return true;

  switch (to) {
    case 'org':
      return ctx.isOrgAdmin;
    case 'workspace':
      return ctx.hasActiveClient;
    case 'system':
      return ctx.isSystemAdmin;
    default: {
      // Exhaustive guard — TypeScript will error if ViewMode gains a new member
      const _exhaustive: never = to;
      return _exhaustive;
    }
  }
}

// operatorRouteActorRulePure.ts — pure actor-rule evaluation for operator task routes.
//
// Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §6.5b
//
// Actor rules for operator task routes:
//   - retry-chain-failure + extend-budget: assigned user OR manager+
//   - fresh-profile-restart + refresh-credential + extend-debug-retention: org_admin only

export type ActorRoleLevel = 'org_admin' | 'manager' | 'user' | 'client_user' | 'system_admin';

export interface RouteActorRuleInput {
  actorUserId: string;
  actorRole: ActorRoleLevel;
  assignedUserId: string | null;
  routeRequiresAdmin: boolean;
}

export interface RouteActorRuleResult {
  allowed: boolean;
  reason?: string;
}

const MANAGER_OR_ABOVE: ReadonlySet<ActorRoleLevel> = new Set([
  'org_admin',
  'manager',
  'system_admin',
]);

/**
 * Evaluates whether the actor is permitted to perform an operator task route action.
 *
 * Admin-only routes (fresh-profile-restart, refresh-credential, extend-debug-retention):
 *   org_admin or system_admin only.
 *
 * Manager-or-assigned routes (retry-chain-failure, extend-budget):
 *   - manager+ always allowed
 *   - user/client_user allowed only if they are the assigned user
 */
export function evaluateRouteActorRule(
  input: RouteActorRuleInput,
): RouteActorRuleResult {
  if (input.routeRequiresAdmin) {
    if (input.actorRole === 'org_admin' || input.actorRole === 'system_admin') {
      return { allowed: true };
    }
    return { allowed: false, reason: 'REQUIRES_ORG_ADMIN' };
  }

  if (MANAGER_OR_ABOVE.has(input.actorRole)) {
    return { allowed: true };
  }

  if (
    input.assignedUserId !== null &&
    input.actorUserId === input.assignedUserId
  ) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'REQUIRES_MANAGER_OR_ASSIGNED_USER' };
}

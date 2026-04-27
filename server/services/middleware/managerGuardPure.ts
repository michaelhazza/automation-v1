import type { ActionDefinition } from '../../config/actionRegistry.js';

export type ManagerGuardResult =
  | { allowed: true }
  | { allowed: false; reason: 'manager_role_violation' | 'manager_direct_external_side_effect' | 'manager_indirect_side_effect_class' };

/**
 * Three-condition deny composition for the manager-role guard (spec §9.4).
 *
 * Precedence: allowlist membership checked first — if the skill is not on the
 * allowlist at all, reason is 'manager_role_violation' regardless of other flags.
 * Only if allowed does the guard check directExternalSideEffect and sideEffectClass.
 *
 * The third check blocks `sideEffectClass === 'write'` only — managers can run
 * domain reads they explicitly declare (read_revenue, read_crm, read_codebase
 * per spec §10.1.2/4/1). The §9.4 indirect-write protection is preserved because
 * `'write'` covers the only path that actually mutates external state from a
 * "safe" allowlisted skill. External-API reads are still blocked by the
 * directExternalSideEffect check above.
 */
export function isManagerAllowlisted(
  def: ActionDefinition | undefined,
  agentRole: string | null,
  perManagerDeclaredSlugs: string[],
  toolSlug: string,
): ManagerGuardResult {
  if (agentRole !== 'manager') return { allowed: true };

  const onAllowlist =
    def?.managerAllowlistMember === true ||
    perManagerDeclaredSlugs.includes(toolSlug);

  if (!onAllowlist) {
    return { allowed: false, reason: 'manager_role_violation' };
  }
  if (def?.directExternalSideEffect === true) {
    return { allowed: false, reason: 'manager_direct_external_side_effect' };
  }
  if (def?.sideEffectClass === 'write') {
    return { allowed: false, reason: 'manager_indirect_side_effect_class' };
  }
  return { allowed: true };
}

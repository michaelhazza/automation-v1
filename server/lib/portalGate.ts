/**
 * portalGate — canRenderPortalFeature() helper
 *
 * Determines whether a given portal feature is accessible for a subaccount.
 * Used by both the server (route guards) and the client (via API) to gate
 * feature visibility in the client portal.
 *
 * Resolution order (§6.1):
 *   1. If `portalMode < feature.minimumMode` → false (mode blocks the feature)
 *   2. If `portalFeatures[featureKey] === false` → false (org explicitly disabled)
 *   3. Otherwise → true
 *
 * Phase 1 note: the `portalFeatures` JSONB column on subaccounts (migration 0132)
 * is a Phase 4 addition. Until then, the per-feature override map defaults to
 * `{}` (empty — no overrides). The mode check is the effective gate in Phase 1.
 *
 * Security contract:
 *   - This function is the SINGLE enforcement point for portal feature visibility.
 *   - Routes and UI that render portal features MUST call this function.
 *   - There is NO bypass path — a feature that returns false here is not
 *     accessible, regardless of how the request is constructed.
 *   - Callers supply the resolved `portalMode` and `portalFeatures` from the
 *     database; this function makes no DB calls itself (pure + testable).
 *
 * Spec: docs/memory-and-briefings-spec.md §6.1 (S15)
 */

import type { PortalMode } from '../db/schema/subaccounts.js';
import type { PortalFeatureKey } from '../config/portalFeatureRegistry.js';
import {
  PORTAL_FEATURE_BY_KEY,
  portalModeTier,
} from '../config/portalFeatureRegistry.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true when the feature is accessible given the subaccount's current
 * portal mode and any per-feature overrides.
 *
 * @param portalMode       The subaccount's `portal_mode` column value
 * @param featureKey       The feature to check
 * @param portalFeatures   Per-feature overrides from the `portal_features` JSONB
 *                         column (Phase 4). Pass `{}` or `undefined` in Phase 1
 *                         — all overrides default to enabled when absent.
 */
export function canRenderPortalFeature(
  portalMode: PortalMode,
  featureKey: PortalFeatureKey,
  portalFeatures?: Record<string, boolean> | null,
): boolean {
  const definition = PORTAL_FEATURE_BY_KEY.get(featureKey);

  // Unknown feature key — deny by default (fail-closed security posture)
  if (!definition) {
    return false;
  }

  // Mode check: current mode must be at least the feature's minimum
  const currentTier = portalModeTier(portalMode);
  const requiredTier = portalModeTier(definition.minimumMode);

  if (currentTier < requiredTier) {
    return false;
  }

  // Per-feature override: explicit false disables the feature regardless of mode.
  // Absent key or explicit true both resolve to "enabled".
  // Phase 4 will populate this from the `portal_features` JSONB column.
  const overrides = portalFeatures ?? {};
  if (overrides[featureKey] === false) {
    return false;
  }

  return true;
}

/**
 * Returns a map of all known feature keys → their visibility for the given
 * portal mode and overrides. Useful for a single GET endpoint that returns
 * all feature gates for the portal UI.
 */
export function resolveAllPortalFeatures(
  portalMode: PortalMode,
  portalFeatures?: Record<string, boolean> | null,
): Record<PortalFeatureKey, boolean> {
  return {
    dropZone:             canRenderPortalFeature(portalMode, 'dropZone', portalFeatures),
    clarificationRouting: canRenderPortalFeature(portalMode, 'clarificationRouting', portalFeatures),
    taskRequests:         canRenderPortalFeature(portalMode, 'taskRequests', portalFeatures),
    memoryInspector:      canRenderPortalFeature(portalMode, 'memoryInspector', portalFeatures),
    healthDigest:         canRenderPortalFeature(portalMode, 'healthDigest', portalFeatures),
  };
}

// ---------------------------------------------------------------------------
// Phase 4: live subaccount-bound helper — reads the subaccount row and applies
// the pure gate. The single authoritative server-side check.
// ---------------------------------------------------------------------------

/**
 * Subaccount-bound portal gate — reads `portalMode` + `portalFeatures` from
 * the `subaccounts` row and applies `canRenderPortalFeature`.
 *
 * Invariant: routes that serve portal-scoped data MUST call this helper. A
 * feature that returns false here is not accessible via any code path.
 */
export async function canRenderPortalFeatureForSubaccount(
  subaccountId: string,
  organisationId: string,
  featureKey: PortalFeatureKey,
): Promise<boolean> {
  // Dynamic import to keep the pure entry point of portalGate free of DB deps
  const { db } = await import('../db/index.js');
  const { subaccounts } = await import('../db/schema/index.js');
  const { eq, and, isNull } = await import('drizzle-orm');

  const [sa] = await db
    .select({
      portalMode: subaccounts.portalMode,
      portalFeatures: subaccounts.portalFeatures,
    })
    .from(subaccounts)
    .where(
      and(
        eq(subaccounts.id, subaccountId),
        eq(subaccounts.organisationId, organisationId),
        isNull(subaccounts.deletedAt),
      ),
    )
    .limit(1);

  if (!sa) return false; // subaccount not found → fail-closed

  return canRenderPortalFeature(
    (sa.portalMode as PortalMode) ?? 'hidden',
    featureKey,
    (sa.portalFeatures as Record<string, boolean> | null | undefined) ?? undefined,
  );
}

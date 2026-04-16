/**
 * portalFeatureRegistry — static registry of portal feature keys and their
 * minimum required portal mode.
 *
 * Each entry maps a feature key to the minimum `portalMode` a subaccount must
 * have for the feature to be visible to client contacts. The registry is the
 * source of truth for which features require which portal tier.
 *
 * `portalGate.ts` reads this registry at runtime to resolve feature visibility.
 * Org admins can further restrict (but not expand) feature access via the
 * per-subaccount `portal_features` JSONB column (migration 0132, Phase 4).
 *
 * Spec: docs/memory-and-briefings-spec.md §6.1 (S15, S17)
 */

import type { PortalMode } from '../db/schema/subaccounts.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PortalFeatureKey =
  | 'dropZone'
  | 'clarificationRouting'
  | 'taskRequests'
  | 'memoryInspector'
  | 'healthDigest';

export interface PortalFeatureDefinition {
  /** The feature key used in portalGate checks and the JSONB override column */
  key: PortalFeatureKey;
  /** Minimum portal mode required for this feature to be visible */
  minimumMode: PortalMode;
  /** Human-readable label for the UI */
  label: string;
  /** Short description for the Knowledge page affordance */
  description: string;
}

// ---------------------------------------------------------------------------
// Mode ordering — used for tier comparison in portalGate.ts
// ---------------------------------------------------------------------------

export const PORTAL_MODE_ORDER: ReadonlyArray<PortalMode> = [
  'hidden',
  'transparency',
  'collaborative',
] as const;

/**
 * Returns the numeric tier of a portal mode. Higher = more permissive.
 * 'hidden' = 0, 'transparency' = 1, 'collaborative' = 2.
 */
export function portalModeTier(mode: PortalMode): number {
  return PORTAL_MODE_ORDER.indexOf(mode);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const PORTAL_FEATURE_REGISTRY: ReadonlyArray<PortalFeatureDefinition> = [
  {
    key: 'dropZone',
    minimumMode: 'collaborative',
    label: 'Client File Upload',
    description:
      'Allows client contacts to upload files directly into the workspace via the portal.',
  },
  {
    key: 'clarificationRouting',
    minimumMode: 'collaborative',
    label: 'Client Clarification Requests',
    description:
      'Allows the system to route clarification questions to client contacts when a client-domain question arises.',
  },
  {
    key: 'taskRequests',
    minimumMode: 'collaborative',
    label: 'Client Task Requests',
    description:
      'Allows client contacts to submit new task requests through the portal.',
  },
  {
    key: 'memoryInspector',
    minimumMode: 'transparency',
    label: 'Memory Transparency View',
    description:
      'Shows client contacts a read-only view of what the system knows about their workspace.',
  },
  {
    key: 'healthDigest',
    minimumMode: 'transparency',
    label: 'Health Digest',
    description:
      'Publishes the weekly workspace health summary to the client portal.',
  },
];

/** Fast lookup map: key → definition */
export const PORTAL_FEATURE_BY_KEY: ReadonlyMap<PortalFeatureKey, PortalFeatureDefinition> =
  new Map(PORTAL_FEATURE_REGISTRY.map((f) => [f.key, f]));

// Shared types for Controller Style (spec §4.1.5).
// Pure types only — no DB access, no service imports.

export const CONTROLLER_STYLES = ['native', 'operator'] as const;

export type ControllerStyle = (typeof CONTROLLER_STYLES)[number];

// Per-controller runtime limit table (spec §4.1.5).
// Canonical values live in server/config/controllerLimits.ts (chunk 3);
// this interface is the consumer contract shared between client and server.
export interface ControllerLimits {
  maxLoopIterations: number;
  defaultTokenBudgetMultiplier: number;
  maxToolCallsPerRun: number;
  approvalDefault: 'auto' | 'review' | 'block';
}

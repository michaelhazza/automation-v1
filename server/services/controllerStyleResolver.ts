import type { ControllerStyle } from '../../shared/types/controllerStyle.js';

export class ControllerStyleNotAllowedForAgentError extends Error {
  readonly statusCode = 422;
  readonly errorCode = 'controller_style_not_allowed_for_agent' as const;
  constructor() {
    super('Controller style operator is not allowed for this agent');
    this.name = 'ControllerStyleNotAllowedForAgentError';
  }
}

export type ControllerStyleSource =
  | 'explicit_override'
  | 'execution_mode_default'
  | 'subaccount_constraint_downgrade';

export interface DeriveControllerStyleResult {
  controllerStyle: ControllerStyle;
  source: ControllerStyleSource;
}

/**
 * Derive the effective controller style for a run.
 *
 * Precedence (spec §4.1.6):
 * 1. Explicit override — if provided and allowed by controllerStyleAllowed.
 *    Throws ControllerStyleNotAllowedForAgentError if override='operator' but
 *    controllerStyleAllowed='native_only'.
 * 2. executionMode default — operator execution modes map to 'operator';
 *    everything else maps to 'native'.
 * 3. Subaccount-constraint downgrade — if controllerStyleAllowed='native_only'
 *    and derived style would be 'operator', downgrade to 'native'.
 */
export function deriveControllerStyle(
  executionMode: string,
  controllerStyleAllowed: string,
  override?: string,
): DeriveControllerStyleResult {
  if (override !== undefined) {
    if (override === 'operator' && controllerStyleAllowed === 'native_only') {
      throw new ControllerStyleNotAllowedForAgentError();
    }
    return {
      controllerStyle: override === 'operator' ? 'operator' : 'native',
      source: 'explicit_override',
    };
  }

  const modeDefault: ControllerStyle =
    executionMode === 'iee_browser' || executionMode === 'iee_dev' ? 'operator' : 'native';

  if (modeDefault === 'operator' && controllerStyleAllowed === 'native_only') {
    return { controllerStyle: 'native', source: 'subaccount_constraint_downgrade' };
  }

  return { controllerStyle: modeDefault, source: 'execution_mode_default' };
}

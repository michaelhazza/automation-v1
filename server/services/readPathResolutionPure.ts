import type { ActionDefinition } from '../config/actionRegistry.js';

export type ReadPathResolution = {
  source: 'canonical' | 'liveFetch' | 'none';
  rationale?: string;
};

/**
 * Resolve the data read-path for an action.
 *
 * Returns the declared readPath from the ActionDefinition, plus the
 * liveFetchRationale when the path is 'liveFetch'.
 */
export function resolveReadPath(action: ActionDefinition): ReadPathResolution {
  if (!action.readPath) {
    return { source: 'none' };
  }
  if (action.readPath === 'liveFetch') {
    return {
      source: 'liveFetch',
      rationale: action.liveFetchRationale ?? undefined,
    };
  }
  return { source: action.readPath };
}

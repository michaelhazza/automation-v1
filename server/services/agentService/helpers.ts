import type { AgentFull } from './types.js';

export function makeSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Guard: throws 403 if agent is system-managed and actor is not system_admin. */
export function _assertNotSystemManaged(agent: AgentFull, actorRole: string | undefined): void {
  if (agent.isSystemManaged && actorRole !== 'system_admin') {
    throw { statusCode: 403, message: 'System agent is read-only', errorCode: 'SYSTEM_AGENT_READ_ONLY' };
  }
}

/** Guard: throws 409 if ETag doesn't match. */
export function _assertEtag(current: AgentFull, expectedEtag: string): void {
  if (current.etag !== expectedEtag) {
    throw { statusCode: 409, message: 'Agent has been modified since you last fetched it. Reload and retry.', errorCode: 'ETAG_MISMATCH', currentEtag: current.etag };
  }
}

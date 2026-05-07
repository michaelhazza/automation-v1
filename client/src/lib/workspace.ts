// client/src/lib/workspace.ts

import { setActiveClient } from './auth';

/**
 * Switches the active workspace.
 *
 * INVARIANT: this is the ONLY allowed `window.location.reload()` call site for the
 * workspace-switch case. DO NOT call `window.location.reload()` anywhere else in the
 * codebase for workspace changes. Verified by the C2 pre-commit grep check.
 *
 * TEMPORARY: relies on a hard reload because Phase 0 does not yet have router-level
 * state refresh. A later phase replaces the reload with a targeted invalidation.
 */
export function switchWorkspace(clientId: string, clientName: string): void {
  if (!clientId) return; // defensive guard: no-op on empty id
  setActiveClient(clientId, clientName);
  window.location.reload();
}

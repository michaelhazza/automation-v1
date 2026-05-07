/**
 * useViewMode.ts
 *
 * Derives the current ViewMode discriminated union from existing identity state
 * and exposes a setViewMode function that enforces the transition table from
 * spec §4.6.
 *
 * ViewMode is DERIVED state — never persisted independently. The source of
 * truth is the combination of:
 *   - getUserRole()              → isSystemAdmin / isOrgAdmin
 *   - getActiveClientId()        → hasActiveClient
 *   - getSystemAdminOrgOverride() → hasSystemOverride
 *
 * Side effects (localStorage mutations) are performed by this hook only —
 * consumers never touch identity state directly to change the mode.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  getUserRole,
  getActiveClientId,
  removeActiveClient,
  getSystemAdminOrgOverride,
  setSystemAdminOrgOverride,
} from '../lib/auth.js';
import {
  deriveViewMode,
  deriveAvailableModes,
  isLegalTransition,
} from './useViewModePure.js';
import type { ViewMode, ViewModeContext } from './useViewModePure.js';

export type { ViewMode };

export interface UseViewModeReturn {
  viewMode: ViewMode;
  availableModes: ReadonlyArray<ViewMode>;
  /** Attempt a mode transition. Returns true on success, false on rejection.
   *  When returning false due to a missing activeClient, invokes
   *  options.onRequireClientSelection if provided. */
  setViewMode: (next: ViewMode) => boolean;
}

export interface UseViewModeOptions {
  /** Called when setViewMode('workspace') is attempted with no activeClient.
   *  Layout wires this to its existing client-picker open flow. */
  onRequireClientSelection?: () => void;
}

/** Build a ViewModeContext snapshot from current localStorage state. */
function readContext(): ViewModeContext {
  const role = getUserRole();
  return {
    hasActiveClient: !!getActiveClientId(),
    hasSystemOverride: getSystemAdminOrgOverride(),
    isOrgAdmin: role === 'org_admin' || role === 'system_admin',
    isSystemAdmin: role === 'system_admin',
  };
}

/**
 * useViewMode — derive view mode from identity state and expose a
 * transition-validated setViewMode.
 *
 * The hook holds a re-render counter that forces React to recompute the derived
 * values after each successful setViewMode call. Identity state lives in
 * localStorage, not React state, so we need a lightweight signal to trigger
 * re-derivation.
 */
export function useViewMode(options?: UseViewModeOptions): UseViewModeReturn {
  // Tick is a counter used solely to force re-renders after localStorage mutations.
  const [tick, setTick] = useState(0);

  // Derive current mode from identity state on every render.
  const ctx = readContext();
  const viewMode = deriveViewMode(ctx);
  const availableModes = deriveAvailableModes(ctx);

  // Store options in a ref so setViewMode's useCallback dep list never includes
  // the options object itself. Without this, callers that pass an inline object
  // literal would cause a new setViewMode on every parent render.
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

  const setViewMode = useCallback(
    (next: ViewMode): boolean => {
      // Read a fresh context at call time (not the closure-captured one)
      const currentCtx = readContext();
      const currentMode = deriveViewMode(currentCtx);

      // Idempotent: no-op if already in the target mode
      if (currentMode === next) return true;

      if (!isLegalTransition(currentMode, next, currentCtx)) {
        // Special case: setViewMode('workspace') with no active client triggers
        // the client-selection callback as the signalling channel to the consumer.
        if (next === 'workspace' && !currentCtx.hasActiveClient) {
          optionsRef.current?.onRequireClientSelection?.();
        }
        return false;
      }

      // Apply side effects per the spec §4.6 transition table
      switch (next) {
        case 'org':
          // Clear active client; disable system override if set
          removeActiveClient();
          if (currentCtx.hasSystemOverride) {
            setSystemAdminOrgOverride(false);
          }
          break;
        case 'workspace':
          // No identity mutation needed — activeClient is already set (legality guard above)
          break;
        case 'system':
          // Enable system override
          setSystemAdminOrgOverride(true);
          break;
      }

      // Force a re-render so the derived values update
      setTick((t) => t + 1);
      return true;
    },
    [],
  );

  return { viewMode, availableModes, setViewMode };
}

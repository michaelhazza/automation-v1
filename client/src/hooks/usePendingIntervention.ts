/**
 * usePendingIntervention — React hook for approving / rejecting a review item.
 *
 * Wraps `createPendingInterventionActions` (pure logic, unit-tested separately)
 * with React useState. No react-query — plain api + useState per project
 * convention.
 *
 * HTTP contract (depends on Task 1.1 backend — idempotent approve/reject):
 *   POST /api/review-items/:id/approve
 *   POST /api/review-items/:id/reject   { comment }
 *
 *   200 → success (including idempotent replay)
 *   409 + errorCode ITEM_CONFLICT → true conflict
 *   412 + errorCode MAJOR_ACK_REQUIRED → acknowledgement required
 *   other errors → generic error
 */

import { useState, useCallback } from 'react';
import api from '../lib/api';
import {
  createPendingInterventionActions,
  type PendingInterventionOptions,
} from './usePendingInterventionPure';

export interface UsePendingInterventionOptions extends PendingInterventionOptions {}

export interface UsePendingInterventionApi {
  approve: (reviewItemId: string) => Promise<void>;
  reject: (reviewItemId: string, comment: string) => Promise<void>;
  isPending: boolean;
  conflict: boolean;
  error: string | null;
}

export function usePendingIntervention(
  options?: UsePendingInterventionOptions,
): UsePendingInterventionApi {
  const [isPending, setIsPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable reference — options is spread via stable setters so we don't need
  // the options object itself in the dependency array.
  const approve = useCallback(
    (reviewItemId: string) => {
      const actions = createPendingInterventionActions({
        api,
        getIsPending: () => isPending,
        setIsPending,
        setConflict,
        setError,
        options: options ?? {},
      });
      return actions.approve(reviewItemId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isPending, options],
  );

  const reject = useCallback(
    (reviewItemId: string, comment: string) => {
      const actions = createPendingInterventionActions({
        api,
        getIsPending: () => isPending,
        setIsPending,
        setConflict,
        setError,
        options: options ?? {},
      });
      return actions.reject(reviewItemId, comment);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isPending, options],
  );

  return { approve, reject, isPending, conflict, error };
}

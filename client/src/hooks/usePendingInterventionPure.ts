/**
 * usePendingInterventionPure.ts
 *
 * Pure factory for the approve/reject action logic used by
 * `usePendingIntervention`. Separated so it can be unit-tested without a
 * React runtime or HTTP.
 *
 * Consumers: `usePendingIntervention.ts` (React wrapper).
 * Tests:     `__tests__/usePendingIntervention.test.ts`.
 */

export interface PendingInterventionOptions {
  onApproved?: () => void;
  onRejected?: () => void;
  onConflict?: () => void;
}

/**
 * Minimal API surface the factory needs — matches Axios's api.post signature
 * so the real `api` instance satisfies this type directly.
 */
export interface ApiClient {
  post(url: string, body?: unknown): Promise<{ status: number; data: unknown }>;
}

export interface PendingInterventionActionsInput {
  api: ApiClient;
  getIsPending: () => boolean;
  setIsPending: (v: boolean) => void;
  setConflict: (v: boolean) => void;
  setError: (v: string | null) => void;
  options: PendingInterventionOptions;
}

export interface PendingInterventionActions {
  approve: (reviewItemId: string) => Promise<void>;
  reject: (reviewItemId: string, comment: string) => Promise<void>;
}

/**
 * Extracts the HTTP error code from an Axios-shaped rejection, if present.
 * Reads the canonical asyncHandler shape `{ error: { code } }` first, then
 * falls back to the legacy top-level `errorCode` for handlers that haven't
 * been migrated yet.
 */
function extractErrorCode(err: unknown): string | undefined {
  const data = (err as { response?: { data?: { error?: { code?: string }; errorCode?: string } } })
    ?.response?.data;
  return data?.error?.code ?? data?.errorCode;
}

function extractHttpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

function extractMessage(err: unknown): string {
  return (err as { message?: string })?.message ?? 'Unknown error';
}

/**
 * Creates the approve/reject action functions with their full error-handling
 * logic. The state setters are injected so the factory never touches React
 * state directly — the hook wrapper owns that.
 */
export function createPendingInterventionActions(
  input: PendingInterventionActionsInput,
): PendingInterventionActions {
  const { api, getIsPending, setIsPending, setConflict, setError, options } = input;

  async function approve(reviewItemId: string): Promise<void> {
    // Re-entry guard — synchronous check before any async work.
    if (getIsPending()) return;

    setIsPending(true);
    try {
      await api.post(`/api/review-items/${reviewItemId}/approve`);
      setError(null);
      setConflict(false);
      options.onApproved?.();
    } catch (err: unknown) {
      const status = extractHttpStatus(err);
      const code = extractErrorCode(err);

      if (status === 409 && code === 'ITEM_CONFLICT') {
        setConflict(true);
        options.onConflict?.();
      } else if (status === 412 && code === 'MAJOR_ACK_REQUIRED') {
        setError('Major acknowledgement required');
      } else {
        setError(extractMessage(err));
      }
    } finally {
      setIsPending(false);
    }
  }

  async function reject(reviewItemId: string, comment: string): Promise<void> {
    // Synchronous validation — throw before any state mutation.
    if (!comment) throw new Error('Comment is required');

    // Re-entry guard.
    if (getIsPending()) return;

    setIsPending(true);
    try {
      await api.post(`/api/review-items/${reviewItemId}/reject`, { comment });
      setError(null);
      setConflict(false);
      options.onRejected?.();
    } catch (err: unknown) {
      const status = extractHttpStatus(err);
      const code = extractErrorCode(err);

      if (status === 409 && code === 'ITEM_CONFLICT') {
        setConflict(true);
        options.onConflict?.();
      } else if (status === 412 && code === 'MAJOR_ACK_REQUIRED') {
        setError('Major acknowledgement required');
      } else {
        setError(extractMessage(err));
      }
    } finally {
      setIsPending(false);
    }
  }

  return { approve, reject };
}

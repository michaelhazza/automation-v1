/**
 * askFormSubmissionServicePure.ts — pure helpers for Ask form submission.
 *
 * Decides the 200/400/403/404/409 outcome before any DB writes.
 * No side effects. Fully testable.
 *
 * Spec: docs/workflows-dev-spec.md §11.
 */

export type AskIntent = 'submit' | 'skip';

export interface DecideAskSubmissionInput {
  gateExists: boolean;
  callerInPool: boolean;
  allowSkip: boolean;
  currentStatus: string | null;
  intent: AskIntent;
}

export type AskSubmissionOutcome =
  | { proceed: true }
  | { proceed: false; statusCode: 404; errorCode: 'ask_not_found' }
  | { proceed: false; statusCode: 403; errorCode: 'not_in_submitter_pool' }
  | { proceed: false; statusCode: 400; errorCode: 'skip_not_allowed' }
  | { proceed: false; statusCode: 409; errorCode: 'already_submitted'; currentStatus: string }
  | { proceed: false; statusCode: 409; errorCode: 'already_resolved'; currentStatus: string };

/**
 * Pure decision function. All DB queries have already been performed;
 * the caller passes the relevant flags derived from those queries.
 */
export function decideAskSubmissionOutcome(
  input: DecideAskSubmissionInput,
): AskSubmissionOutcome {
  const { gateExists, callerInPool, allowSkip, currentStatus, intent } = input;

  if (!gateExists) {
    return { proceed: false, statusCode: 404, errorCode: 'ask_not_found' };
  }

  if (!callerInPool) {
    return { proceed: false, statusCode: 403, errorCode: 'not_in_submitter_pool' };
  }

  if (intent === 'skip' && !allowSkip) {
    return { proceed: false, statusCode: 400, errorCode: 'skip_not_allowed' };
  }

  // If step run status is not 'awaiting_input', it was already resolved
  if (currentStatus !== null && currentStatus !== 'awaiting_input') {
    if (intent === 'submit') {
      return {
        proceed: false,
        statusCode: 409,
        errorCode: 'already_submitted',
        currentStatus: currentStatus,
      };
    }
    return {
      proceed: false,
      statusCode: 409,
      errorCode: 'already_resolved',
      currentStatus: currentStatus,
    };
  }

  return { proceed: true };
}

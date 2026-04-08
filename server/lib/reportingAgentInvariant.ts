/**
 * Reporting Agent end-of-run invariant — T25.
 *
 * Spec: docs/reporting-agent-paywall-workflow-spec.md §8.4.2 / T25.
 *
 * Before any agent run for the Reporting Agent flips to status='completed',
 * this invariant runs. If any expected output of a successful run is
 * missing, the run is rejected via failure('internal_error',
 * 'incomplete_run_state', { missing }).
 *
 * The check is non-bypassable from inside the LLM execution loop because
 * it runs in agentExecutionService, not in skillExecutor.
 *
 * Two paths: a "happy" path (default) which requires every output, and a
 * "no_new_content" short-circuit which only requires that the fingerprint
 * was actually consulted.
 */

import { failure, FailureError } from '../../shared/iee/failure.js';

export type ReportingAgentTerminationResult = 'success' | 'no_new_content';

export interface ReportingAgentRunState {
  /** Set when transcription completed successfully (artifact id). */
  transcriptArtifactId: string | null;
  /** Set when the report skill returned a non-empty markdown. */
  reportMarkdownDeliverableId: string | null;
  /** Set when send_to_slack returned a permalink. */
  slackPost: { messageTs: string; permalink: string } | null;
  /** Set when the fingerprint was advanced (or when no_new_content was confirmed). */
  fingerprintWritten: boolean;
  /** Set when the fingerprint cache was consulted (always required). */
  fingerprintRead: boolean;
  /** What kind of termination this run resolved to. */
  terminationResult: ReportingAgentTerminationResult;
}

/**
 * Assert that all expected outputs are present for a successful Reporting
 * Agent run. Throws FailureError on any missing piece.
 *
 * Call this in agentExecutionService BEFORE persisting status='completed'.
 */
export function assertReportingAgentRunComplete(state: ReportingAgentRunState): void {
  const missing: string[] = [];

  if (state.terminationResult === 'no_new_content') {
    // Short-circuit: this run terminated early because the fingerprint
    // matched. We only require that the fingerprint cache was actually
    // consulted — the rest of the workflow steps are by design absent.
    if (!state.fingerprintRead) missing.push('fingerprint_read');
    if (missing.length) {
      throw new FailureError(
        failure('internal_error', 'incomplete_run_state', { missing, terminationResult: state.terminationResult }),
      );
    }
    return;
  }

  // Happy path — every output must be present.
  if (!state.transcriptArtifactId) missing.push('transcript');
  if (!state.reportMarkdownDeliverableId) missing.push('report_deliverable');
  if (!state.slackPost) missing.push('slack_post');
  if (!state.fingerprintWritten) missing.push('fingerprint_write');

  if (missing.length) {
    throw new FailureError(
      failure('internal_error', 'incomplete_run_state', { missing, terminationResult: state.terminationResult }),
    );
  }
}

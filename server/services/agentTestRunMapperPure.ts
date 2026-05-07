import type { AgentRun } from '../db/schema/agentRuns.js';

export interface AgentTestResult {
  runId: string;
  status: 'running' | 'completed' | 'failed';
  durationMs: number | null;
  resultPreview: string | null;
  traceUrl: string | null;
}

export function mapAgentRunToTestResult(
  run: Pick<AgentRun, 'id' | 'status' | 'startedAt' | 'completedAt' | 'summary'>,
): AgentTestResult {
  const mappedStatus: AgentTestResult['status'] =
    run.status === 'completed' ? 'completed' :
    (run.status === 'failed' || run.status === 'timeout' || run.status === 'budget_exceeded' ||
     run.status === 'cancelled' || run.status === 'loop_detected' || run.status === 'completed_with_uncertainty' ||
     run.status === 'awaiting_clarification' || run.status === 'waiting_on_clarification') ? 'failed' :
    'running';

  const durationMs =
    run.completedAt && run.startedAt
      ? run.completedAt.getTime() - run.startedAt.getTime()
      : null;

  const resultPreview = run.summary ? run.summary.slice(0, 200) : null;
  const traceUrl = run.startedAt ? `/run-trace/${run.id}` : null;

  return { runId: run.id, status: mappedStatus, durationMs, resultPreview, traceUrl };
}

import { describe, it, expect } from 'vitest';
import { mapAgentRunToTestResult } from '../agentTestRunMapperPure.js';

const BASE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeRun(overrides: Partial<{
  id: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  summary: string | null;
}> = {}) {
  return {
    id: BASE_ID,
    status: 'running' as string,
    startedAt: new Date('2024-01-01T00:00:00.000Z'),
    completedAt: null as Date | null,
    summary: null as string | null,
    ...overrides,
  } as Parameters<typeof mapAgentRunToTestResult>[0];
}

describe('mapAgentRunToTestResult', () => {
  it('in-flight run (status=running) maps to running with null durationMs, null resultPreview, traceUrl set', () => {
    const result = mapAgentRunToTestResult(makeRun({ status: 'running' }));
    expect(result).toEqual({
      runId: BASE_ID,
      status: 'running',
      durationMs: null,
      resultPreview: null,
      traceUrl: `/run-trace/${BASE_ID}`,
    });
  });

  it('completed run maps correctly with durationMs, resultPreview, and traceUrl', () => {
    const startedAt = new Date('2024-01-01T00:00:00.000Z');
    const completedAt = new Date('2024-01-01T00:00:05.000Z');
    const result = mapAgentRunToTestResult(makeRun({
      status: 'completed',
      startedAt,
      completedAt,
      summary: 'Agent completed the task successfully.',
    }));
    expect(result).toEqual({
      runId: BASE_ID,
      status: 'completed',
      durationMs: 5000,
      resultPreview: 'Agent completed the task successfully.',
      traceUrl: `/run-trace/${BASE_ID}`,
    });
  });

  it('failed run maps to failed status with correct durationMs and traceUrl', () => {
    const startedAt = new Date('2024-01-01T00:00:00.000Z');
    const completedAt = new Date('2024-01-01T00:00:03.000Z');
    const result = mapAgentRunToTestResult(makeRun({
      status: 'failed',
      startedAt,
      completedAt,
      summary: 'Something went wrong.',
    }));
    expect(result.status).toBe('failed');
    expect(result.durationMs).toBe(3000);
    expect(result.traceUrl).toBe(`/run-trace/${BASE_ID}`);
  });

  it('timeout status maps to failed', () => {
    const result = mapAgentRunToTestResult(makeRun({ status: 'timeout' }));
    expect(result.status).toBe('failed');
  });

  it('budget_exceeded status maps to failed', () => {
    const result = mapAgentRunToTestResult(makeRun({ status: 'budget_exceeded' }));
    expect(result.status).toBe('failed');
  });

  it('cancelled status maps to failed', () => {
    const result = mapAgentRunToTestResult(makeRun({ status: 'cancelled' }));
    expect(result.status).toBe('failed');
  });

  it('loop_detected status maps to failed', () => {
    const result = mapAgentRunToTestResult(makeRun({ status: 'loop_detected' }));
    expect(result.status).toBe('failed');
  });

  it('completed_with_uncertainty status maps to failed', () => {
    const result = mapAgentRunToTestResult(makeRun({ status: 'completed_with_uncertainty' }));
    expect(result.status).toBe('failed');
  });

  it('missing completedAt yields durationMs: null', () => {
    const result = mapAgentRunToTestResult(makeRun({
      status: 'completed',
      completedAt: null,
    }));
    expect(result.durationMs).toBeNull();
  });

  it('missing summary yields resultPreview: null', () => {
    const result = mapAgentRunToTestResult(makeRun({
      status: 'completed',
      summary: null,
    }));
    expect(result.resultPreview).toBeNull();
  });

  it('summary longer than 200 chars is truncated to 200 chars in resultPreview', () => {
    const longSummary = 'A'.repeat(250);
    const result = mapAgentRunToTestResult(makeRun({ summary: longSummary }));
    expect(result.resultPreview).toHaveLength(200);
    expect(result.resultPreview).toBe('A'.repeat(200));
  });

  it('missing startedAt yields traceUrl: null', () => {
    const result = mapAgentRunToTestResult(makeRun({ startedAt: null }));
    expect(result.traceUrl).toBeNull();
  });
});

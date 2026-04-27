import { readLinesForCorrelationId } from '../logBuffer.js';
import type { SkillExecutionContext } from '../../skillExecutor.js';

const MAX_LINES = 200;
const MAX_BYTES = 100_000;

export async function executeReadLogsForCorrelationId(
  input: Record<string, unknown>,
  _context: SkillExecutionContext,
): Promise<unknown> {
  const correlationId = input.correlationId as string | undefined;
  if (!correlationId) return { success: false, error: 'correlationId is required' };

  try {
    const lines = readLinesForCorrelationId(correlationId, MAX_LINES);

    // Enforce 100 KB byte cap.
    let totalBytes = 0;
    const cappedLines = [];
    for (const line of lines) {
      const lineBytes = JSON.stringify(line).length;
      if (totalBytes + lineBytes > MAX_BYTES) break;
      cappedLines.push(line);
      totalBytes += lineBytes;
    }

    const truncated = cappedLines.length < lines.length;
    return {
      success: true,
      correlationId,
      lineCount: cappedLines.length,
      truncated,
      lines: cappedLines,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export const READ_LOGS_FOR_CORRELATION_ID_DEFINITION = {
  name: 'read_logs_for_correlation_id',
  description: 'Read process-local log lines for a correlation ID. Capped at 200 lines or 100 KB. Only includes lines from the current process lifetime.',
  input_schema: {
    type: 'object' as const,
    properties: {
      correlationId: { type: 'string', description: 'Correlation ID to look up log lines for.' },
    },
    required: ['correlationId'],
  },
};

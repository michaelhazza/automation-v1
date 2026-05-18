import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeInvocations, addValidatorSpanAttributes } from '../validatorAuditService.js';
import type { NewValidatorInvocation } from '../../db/schema/validatorInvocations.js';
import type { DB } from '../../db/index.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../instrumentation.js', () => ({
  getTraceContext: vi.fn(),
}));

// Dynamic import mock for the schema (used inside writeInvocations)
vi.mock('../../db/schema/validatorInvocations.js', () => ({
  validatorInvocations: { _tableName: 'validator_invocations' },
}));

import { getTraceContext } from '../../instrumentation.js';

const mockGetTraceContext = vi.mocked(getTraceContext);

// ---------------------------------------------------------------------------
// Helper: build a minimal NewValidatorInvocation DTO
// ---------------------------------------------------------------------------

function makeInvocation(overrides: Partial<NewValidatorInvocation> = {}): NewValidatorInvocation {
  return {
    verdictId: '00000000-0000-0000-0000-000000000001',
    validatorSlug: 'test_validator',
    validatorVersion: '1.0.0',
    evaluationMethod: 'deterministic',
    latencyMs: 5,
    externalCallCount: 0,
    resultPassed: true,
    resultScore: '1.000',
    evidenceJson: { checked: true },
    traceId: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// writeInvocations
// ---------------------------------------------------------------------------

describe('writeInvocations', () => {
  beforeEach(() => {
    mockGetTraceContext.mockReturnValue(undefined);
  });

  it('no-ops when invocations array is empty', async () => {
    const mockDb = { insert: vi.fn() };
    await writeInvocations([], mockDb as unknown as DB);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('writes rows to validator_invocations', async () => {
    const mockValues = vi.fn().mockResolvedValue([]);
    const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
    const mockDb = { insert: mockInsert };

    const inv = makeInvocation();
    await writeInvocations([inv], mockDb as unknown as DB);

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockValues).toHaveBeenCalledOnce();
    const writtenRows = mockValues.mock.calls[0]![0] as NewValidatorInvocation[];
    expect(writtenRows).toHaveLength(1);
    expect(writtenRows[0]!.validatorSlug).toBe('test_validator');
  });

  it('8 KB hard-stop: replaces oversized evidence with redacted placeholder', async () => {
    const mockValues = vi.fn().mockResolvedValue([]);
    const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
    const mockDb = { insert: mockInsert };

    // Build evidence that exceeds 8192 bytes
    const largeEvidence = { data: 'x'.repeat(9000) };
    const inv = makeInvocation({ evidenceJson: largeEvidence });

    await writeInvocations([inv], mockDb as unknown as DB);

    const writtenRows = mockValues.mock.calls[0]![0] as NewValidatorInvocation[];
    expect(writtenRows[0]!.evidenceJson).toMatchObject({ _hardStop: true });
    expect((writtenRows[0]!.evidenceJson as { originalSize: number }).originalSize).toBeGreaterThan(8192);
  });

  it('happy-path: preserves evidence shape when within 8 KB', async () => {
    const mockValues = vi.fn().mockResolvedValue([]);
    const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
    const mockDb = { insert: mockInsert };

    const evidence = { matched: false, patternCount: 3 };
    const inv = makeInvocation({ evidenceJson: evidence });

    await writeInvocations([inv], mockDb as unknown as DB);

    const writtenRows = mockValues.mock.calls[0]![0] as NewValidatorInvocation[];
    expect(writtenRows[0]!.evidenceJson).toEqual(evidence);
  });

  it('swallows DB write failure and does not throw', async () => {
    const mockValues = vi.fn().mockRejectedValue(new Error('DB error'));
    const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
    const mockDb = { insert: mockInsert };

    const inv = makeInvocation();
    await expect(
      writeInvocations([inv], mockDb as unknown as DB),
    ).resolves.toBeUndefined();
  });

  it('populates trace_id from active trace context when missing on row', async () => {
    const mockTrace = { id: 'trace-abc-123' };
    mockGetTraceContext.mockReturnValue({ trace: mockTrace } as ReturnType<typeof getTraceContext>);

    const mockValues = vi.fn().mockResolvedValue([]);
    const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
    const mockDb = { insert: mockInsert };

    const inv = makeInvocation({ traceId: undefined });
    await writeInvocations([inv], mockDb as unknown as DB);

    const writtenRows = mockValues.mock.calls[0]![0] as NewValidatorInvocation[];
    expect(writtenRows[0]!.traceId).toBe('trace-abc-123');
  });

  it('does not override trace_id already set on row', async () => {
    const mockTrace = { id: 'trace-from-context' };
    mockGetTraceContext.mockReturnValue({ trace: mockTrace } as ReturnType<typeof getTraceContext>);

    const mockValues = vi.fn().mockResolvedValue([]);
    const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
    const mockDb = { insert: mockInsert };

    const inv = makeInvocation({ traceId: 'trace-already-set' });
    await writeInvocations([inv], mockDb as unknown as DB);

    const writtenRows = mockValues.mock.calls[0]![0] as NewValidatorInvocation[];
    expect(writtenRows[0]!.traceId).toBe('trace-already-set');
  });
});

// ---------------------------------------------------------------------------
// addValidatorSpanAttributes
// ---------------------------------------------------------------------------

describe('addValidatorSpanAttributes', () => {
  beforeEach(() => {
    mockGetTraceContext.mockReturnValue(undefined);
  });

  it('no-ops silently when no trace is active', () => {
    expect(() =>
      addValidatorSpanAttributes({
        slug: 'test_validator',
        version: '1.0.0',
        latencyMs: 3,
        evaluationMethod: 'deterministic',
      }),
    ).not.toThrow();
  });

  it('calls trace.update with synthetos.validator.* attributes when trace is active', () => {
    const mockUpdate = vi.fn();
    mockGetTraceContext.mockReturnValue({
      trace: { update: mockUpdate },
    } as unknown as ReturnType<typeof getTraceContext>);

    addValidatorSpanAttributes({
      slug: 'output_non_empty',
      version: '1.0.0',
      latencyMs: 7,
      evaluationMethod: 'deterministic',
    });

    expect(mockUpdate).toHaveBeenCalledOnce();
    const callArg = mockUpdate.mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(callArg.metadata['synthetos.validator.slug']).toBe('output_non_empty');
    expect(callArg.metadata['synthetos.validator.version']).toBe('1.0.0');
    expect(callArg.metadata['synthetos.validator.latency_ms']).toBe(7);
    expect(callArg.metadata['synthetos.validator.evaluation_method']).toBe('deterministic');
  });

  it('swallows errors from trace.update without throwing', () => {
    const mockUpdate = vi.fn().mockImplementation(() => { throw new Error('trace error'); });
    mockGetTraceContext.mockReturnValue({
      trace: { update: mockUpdate },
    } as unknown as ReturnType<typeof getTraceContext>);

    expect(() =>
      addValidatorSpanAttributes({
        slug: 'test_validator',
        version: '1.0.0',
        latencyMs: 5,
        evaluationMethod: 'deterministic',
      }),
    ).not.toThrow();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { asyncHandler } from '../../../../server/lib/asyncHandler.js';
import type { Request, Response, NextFunction } from 'express';

function createMockReqRes() {
  const req = {
    correlationId: 'test-correlation-123',
    path: '/api/test',
    method: 'GET',
  } as unknown as Request;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  const next = vi.fn() as NextFunction;

  return { req, res, next };
}

describe('asyncHandler', () => {
  it('calls the handler function', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = asyncHandler(handler);
    const { req, res, next } = createMockReqRes();

    wrapped(req, res, next);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(req, res, next));
  });

  it('returns structured error when handler throws { statusCode, message }', async () => {
    const handler = vi.fn().mockRejectedValue({ statusCode: 404, message: 'Not found' });
    const wrapped = asyncHandler(handler);
    const { req, res, next } = createMockReqRes();

    wrapped(req, res, next);

    await vi.waitFor(() => {
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: { code: 'request_error', message: 'Not found' },
        correlationId: 'test-correlation-123',
      });
    });
  });

  it('returns 500 for unknown errors', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Unexpected'));
    const wrapped = asyncHandler(handler);
    const { req, res, next } = createMockReqRes();

    wrapped(req, res, next);

    await vi.waitFor(() => {
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'internal_error' }),
        })
      );
    });
  });

  it('uses errorCode from thrown error when provided', async () => {
    const handler = vi.fn().mockRejectedValue({
      statusCode: 429,
      message: 'Rate limited',
      errorCode: 'rate_limit_exceeded',
    });
    const wrapped = asyncHandler(handler);
    const { req, res, next } = createMockReqRes();

    wrapped(req, res, next);

    await vi.waitFor(() => {
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'rate_limit_exceeded' }),
        })
      );
    });
  });
});

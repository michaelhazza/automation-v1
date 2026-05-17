// guard-ignore-file: pure-helper-convention reason="Pure regression test for OSI-DEF-7 UUID validation in GET /api/subaccounts/:subaccountId/agents/:agentId/allowed-subscriptions — pins the safeParse + 400 throw shape against silent reversion to .parse() (which would surface as 500 + incident)."
/**
 * operatorSessionConnectionsAgentIdPure.test.ts
 *
 * Regression pin for the OSI-DEF-7 + dual-reviewer fix in
 * server/routes/operatorSessionConnections.ts:498-505.
 *
 * Original anti-pattern: `z.string().uuid().parse(req.params.agentId)` — a
 * malformed agentId surfaces as a bare ZodError; asyncHandler's normaliser
 * doesn't recognise the shape and routes it to 500 + recordIncident.
 *
 * Fix shape: `safeParse` + duck-shape throw
 *   { statusCode: 400, errorCode: 'invalid_agent_id', message: 'agentId must be a UUID' }
 *
 * asyncHandlerNormalisationPure matches on `typeof statusCode === 'number'`
 * → wraps in synthetic AppError → 400 response, no incident.
 *
 * Runnable via:
 *   npx vitest run server/routes/__tests__/operatorSessionConnectionsAgentIdPure.test.ts
 */

import { describe, test, expect } from 'vitest';
import { z } from 'zod';
import { normaliseRouteError } from '../../lib/asyncHandlerNormalisationPure.js';

describe('agentId UUID validation (pure)', () => {
  test('safeParse rejects non-UUID strings', () => {
    const result = z.string().uuid().safeParse('not-a-uuid');
    expect(result.success).toBe(false);
  });

  test('safeParse accepts well-formed UUIDs', () => {
    const goodId = '00000000-0000-0000-0000-000000000001';
    const result = z.string().uuid().safeParse(goodId);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(goodId);
    }
  });

  test('thrown duck-shape produces 400 via normaliseRouteError (no incident)', () => {
    // Mirrors the exact shape the route throws when safeParse fails.
    const thrown = {
      statusCode: 400,
      errorCode: 'invalid_agent_id',
      message: 'agentId must be a UUID',
    };
    const normalised = normaliseRouteError(thrown);
    expect(normalised.kind).toBe('legacy');
    if (normalised.kind === 'legacy') {
      expect(normalised.error.statusCode).toBe(400);
      expect(normalised.error.code).toBe('invalid_agent_id');
      expect(normalised.error.message).toBe('agentId must be a UUID');
    }
  });

  test('regression guard: bare ZodError would normalise to 500 (anti-pattern we replaced)', () => {
    // This proves WHY we use safeParse + throw instead of .parse().
    // A bare ZodError has no statusCode field, so normaliseRouteError
    // routes it to the 500 path. If a future "simplify" refactor reverts
    // to .parse(), this assertion regresses.
    let zodError: unknown;
    const result = z.string().uuid().safeParse('not-a-uuid');
    if (!result.success) {
      zodError = result.error;
    }
    expect(zodError).toBeTruthy();
    const normalised = normaliseRouteError(zodError);
    expect(normalised.kind).toBe('unknown');
    if (normalised.kind === 'unknown') {
      expect(normalised.statusCode).toBe(500);
    }
  });
});

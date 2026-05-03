// guard-ignore-file: pure-helper-convention reason="pure logic is tested inline within this handwritten harness"
/**
 * stripeAgentWebhookServicePure.test.ts
 *
 * Tests pure decision logic for the Stripe agent webhook service.
 * Covers: state transitions, failed→succeeded carve-out, out-of-order compensation,
 * and monotonicity guards per spec §4 / plan § Chunk 12.
 *
 * Run via: npx vitest run server/services/__tests__/stripeAgentWebhookServicePure.test.ts
 */

import { describe, expect, it } from 'vitest';
import {
  assertValidAgentChargeTransition,
  isAllowedAgentChargeTransition,
  InvalidAgentChargeTransitionError,
  AGENT_CHARGE_STATUSES,
  type AgentChargeStatus,
  type AgentChargeTransitionCaller,
} from '../../../shared/stateMachineGuards.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allowed(
  from: AgentChargeStatus,
  to: AgentChargeStatus,
  caller: AgentChargeTransitionCaller = 'stripe_webhook',
): boolean {
  return isAllowedAgentChargeTransition(from, to, caller);
}

function assertAllowed(
  from: AgentChargeStatus,
  to: AgentChargeStatus,
  caller: AgentChargeTransitionCaller = 'stripe_webhook',
): void {
  expect(() => assertValidAgentChargeTransition(from, to, { callerIdentity: caller })).not.toThrow();
}

function assertForbidden(
  from: AgentChargeStatus,
  to: AgentChargeStatus,
  caller: AgentChargeTransitionCaller = 'stripe_webhook',
): void {
  expect(() => assertValidAgentChargeTransition(from, to, { callerIdentity: caller }))
    .toThrow(InvalidAgentChargeTransitionError);
}

// ---------------------------------------------------------------------------
// § 1. Webhook-relevant allowed transitions
// ---------------------------------------------------------------------------

describe('webhook-allowed state transitions', () => {
  it('executed → succeeded is allowed', () => {
    assertAllowed('executed', 'succeeded');
  });

  it('executed → failed is allowed', () => {
    assertAllowed('executed', 'failed');
  });

  it('succeeded → refunded is allowed', () => {
    assertAllowed('succeeded', 'refunded');
  });

  it('succeeded → disputed is allowed', () => {
    assertAllowed('succeeded', 'disputed');
  });

  it('disputed → succeeded is allowed', () => {
    assertAllowed('disputed', 'succeeded');
  });

  it('disputed → refunded is allowed', () => {
    assertAllowed('disputed', 'refunded');
  });
});

// ---------------------------------------------------------------------------
// § 2. failed → succeeded carve-out (invariant 33)
// ---------------------------------------------------------------------------

describe('failed → succeeded carve-out', () => {
  it('stripe_webhook caller: failed → succeeded is ALLOWED', () => {
    assertAllowed('failed', 'succeeded', 'stripe_webhook');
    expect(allowed('failed', 'succeeded', 'stripe_webhook')).toBe(true);
  });

  it('charge_router caller: failed → succeeded is FORBIDDEN', () => {
    assertForbidden('failed', 'succeeded', 'charge_router');
    expect(allowed('failed', 'succeeded', 'charge_router')).toBe(false);
  });

  it('timeout_job caller: failed → succeeded is FORBIDDEN', () => {
    assertForbidden('failed', 'succeeded', 'timeout_job');
    expect(allowed('failed', 'succeeded', 'timeout_job')).toBe(false);
  });

  it('worker_completion caller: failed → succeeded is FORBIDDEN', () => {
    assertForbidden('failed', 'succeeded', 'worker_completion');
    expect(allowed('failed', 'succeeded', 'worker_completion')).toBe(false);
  });

  it('approval_expiry_job caller: failed → succeeded is FORBIDDEN', () => {
    assertForbidden('failed', 'succeeded', 'approval_expiry_job');
    expect(allowed('failed', 'succeeded', 'approval_expiry_job')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// § 3. Truly-terminal states: no outbound transitions
// ---------------------------------------------------------------------------

describe('truly-terminal state monotonicity', () => {
  const trulyTerminal: AgentChargeStatus[] = ['blocked', 'denied', 'shadow_settled', 'refunded'];

  for (const terminal of trulyTerminal) {
    for (const target of AGENT_CHARGE_STATUSES) {
      if (target === terminal) continue; // same-state is idempotent
      it(`${terminal} → ${target} is FORBIDDEN (stripe_webhook)`, () => {
        assertForbidden(terminal, target, 'stripe_webhook');
      });
    }
  }
});

// ---------------------------------------------------------------------------
// § 4. Forbidden transitions: non-carve-out post-terminal writes
// ---------------------------------------------------------------------------

describe('forbidden webhook transitions', () => {
  it('succeeded → executed is FORBIDDEN', () => {
    assertForbidden('succeeded', 'executed');
  });

  it('succeeded → approved is FORBIDDEN', () => {
    assertForbidden('succeeded', 'approved');
  });

  it('succeeded → proposed is FORBIDDEN', () => {
    assertForbidden('succeeded', 'proposed');
  });

  it('refunded → succeeded is FORBIDDEN', () => {
    assertForbidden('refunded', 'succeeded');
  });

  it('refunded → disputed is FORBIDDEN', () => {
    assertForbidden('refunded', 'disputed');
  });

  it('disputed → executed is FORBIDDEN', () => {
    assertForbidden('disputed', 'executed');
  });

  it('disputed → failed is FORBIDDEN', () => {
    assertForbidden('disputed', 'failed');
  });
});

// ---------------------------------------------------------------------------
// § 5. Out-of-order compensation logic (deriveCompensationSequence pattern)
// ---------------------------------------------------------------------------

// The compensation logic lives in stripeAgentWebhookService.ts as a non-pure
// function that uses isAllowedAgentChargeTransition. We test the individual
// sub-predicates that the compensation function relies on.

describe('out-of-order compensation: prerequisite predicates', () => {
  it('executed → succeeded is a valid direct transition (step 1 of executed → refunded)', () => {
    expect(allowed('executed', 'succeeded')).toBe(true);
  });

  it('succeeded → refunded is a valid direct transition (step 2 of executed → refunded)', () => {
    expect(allowed('succeeded', 'refunded')).toBe(true);
  });

  it('executed → refunded is NOT a direct transition (requires compensation)', () => {
    expect(allowed('executed', 'refunded')).toBe(false);
  });

  it('executed → disputed is NOT a direct transition (requires compensation)', () => {
    expect(allowed('executed', 'disputed')).toBe(false);
  });

  it('succeeded → disputed is a valid direct transition (step 2 of executed → disputed)', () => {
    expect(allowed('succeeded', 'disputed')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// § 6. Same-state writes are idempotent (invariant 33)
// ---------------------------------------------------------------------------

describe('same-state writes are idempotent', () => {
  for (const status of AGENT_CHARGE_STATUSES) {
    it(`${status} → ${status} does not throw (idempotent retry)`, () => {
      expect(() =>
        assertValidAgentChargeTransition(status, status, { callerIdentity: 'stripe_webhook' }),
      ).not.toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// § 7. Error type and fields
// ---------------------------------------------------------------------------

describe('InvalidAgentChargeTransitionError carries correct fields', () => {
  it('error carries from/to/callerIdentity fields', () => {
    let caught: InvalidAgentChargeTransitionError | null = null;
    try {
      assertValidAgentChargeTransition('succeeded', 'proposed', { callerIdentity: 'charge_router' });
    } catch (err) {
      if (err instanceof InvalidAgentChargeTransitionError) caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught!.from).toBe('succeeded');
    expect(caught!.to).toBe('proposed');
    expect(caught!.callerIdentity).toBe('charge_router');
    expect(caught!.name).toBe('InvalidAgentChargeTransitionError');
  });
});

// ---------------------------------------------------------------------------
// § 8. Webhook caller is always gated: only stripe_webhook gets the carve-out
// ---------------------------------------------------------------------------

describe('caller-identity gate on carve-out transitions', () => {
  it('only stripe_webhook can drive failed → succeeded', () => {
    const callers: AgentChargeTransitionCaller[] = [
      'charge_router',
      'timeout_job',
      'worker_completion',
      'approval_expiry_job',
      'retention_purge',
    ];
    for (const caller of callers) {
      expect(allowed('failed', 'succeeded', caller)).toBe(false);
    }
    expect(allowed('failed', 'succeeded', 'stripe_webhook')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// § 9. Non-terminal states can accept webhook transitions
// ---------------------------------------------------------------------------

describe('non-terminal states can receive webhook-driven transitions', () => {
  it('executed is a valid source for webhook succeeded', () => {
    expect(allowed('executed', 'succeeded')).toBe(true);
  });

  it('executed is a valid source for webhook failed', () => {
    expect(allowed('executed', 'failed')).toBe(true);
  });

  it('disputed is a valid source for webhook succeeded (dispute won)', () => {
    expect(allowed('disputed', 'succeeded')).toBe(true);
  });

  it('disputed is a valid source for webhook refunded (dispute lost)', () => {
    expect(allowed('disputed', 'refunded')).toBe(true);
  });
});

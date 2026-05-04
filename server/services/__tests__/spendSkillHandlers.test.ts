// ---------------------------------------------------------------------------
// spendSkillHandlers — unit tests
//
// Verifies each spend skill handler input → proposeCharge payload mapping.
// Stubs chargeRouterService.proposeCharge and the DB queries so tests run
// without a live database.
//
// Spec:  tasks/builds/agentic-commerce/spec.md §7.1, §8.1-8.2
// Plan:  tasks/builds/agentic-commerce/plan.md §Chunk 6
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normaliseMerchantDescriptor } from '../chargeRouterServicePure.js';

// ---------------------------------------------------------------------------
// Module-level mocks — must be hoisted before imports of the tested module.
// ---------------------------------------------------------------------------

vi.mock('../chargeRouterService.js', () => ({
  proposeCharge: vi.fn(),
}));

// `spendSkillHandlers.resolveSpendingContext` reads via `getOrgScopedDb()`,
// not the raw `db` import. Mock the org-scoped accessor so each call returns
// a fresh chainable handle the test can configure per-call. Without this, the
// production guard in `getOrgScopedDb` throws `missing_org_context` because
// these unit tests don't run inside a `withOrgTx(...)` block.
vi.mock('../../lib/orgScopedDb.js', () => ({
  getOrgScopedDb: vi.fn(),
  getOrgScopedOrgId: vi.fn(),
  peekOrgTxContext: vi.fn(() => null),
}));

// After hoisting, import the modules under test.
import * as chargeRouterService from '../chargeRouterService.js';
import { getOrgScopedDb } from '../../lib/orgScopedDb.js';
import {
  executePayInvoice,
  executePurchaseResource,
  executeSubscribeToService,
  executeTopUpBalance,
  executeIssueRefund,
} from '../spendSkillHandlers.js';
import type { SkillExecutionContext } from '../skillExecutor.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<SkillExecutionContext> = {}): SkillExecutionContext {
  return {
    runId: 'run-aaaa-1111-aaaa-111111111111',
    organisationId: 'org-1111-2222-3333-444444444444',
    subaccountId: 'sub-1111-2222-3333-444444444444',
    agentId: 'agent-111-2222-3333-444444444444',
    orgProcesses: [],
    toolCallId: 'tc-1111-2222-3333-444444444444',
    ...overrides,
  };
}

const MOCK_SPENDING_CONTEXT = {
  spendingBudgetId: 'budget-111-2222-3333-444444444444',
  spendingPolicyId: 'policy-11-2222-3333-444444444444',
  mode: 'live' as const,
};

// MOCK_BLOCKED_RESPONSE not used — blocked path is exercised via no_active_spending_budget and validation.

const MOCK_EXECUTED_RESPONSE = {
  outcome: 'executed' as const,
  chargeId: 'charge-exec-id',
  providerChargeId: 'pi_test_12345',
  executionPath: 'main_app_stripe' as const,
};

const MOCK_SHADOW_RESPONSE = {
  outcome: 'shadow_settled' as const,
  chargeId: 'charge-shadow-id',
};

/**
 * Setup the org-scoped-DB mock to return spending context (budget + policy).
 * Each `getOrgScopedDb()` call gets a fresh chain whose `.select().from().where().limit()`
 * resolves to the budget query result on call 1, the policy query result on call 2.
 */
function mockSpendingContextResolution() {
  let callCount = 0;
  const makeChain = () => {
    callCount++;
    return {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(
              callCount === 1
                ? [{ id: MOCK_SPENDING_CONTEXT.spendingBudgetId, subaccountId: 'sub-1111-2222-3333-444444444444', agentId: null }]
                : [{ id: MOCK_SPENDING_CONTEXT.spendingPolicyId, mode: MOCK_SPENDING_CONTEXT.mode }],
            ),
          }),
        }),
      }),
    };
  };

  // resolveSpendingContext calls getOrgScopedDb() twice — once for the budget
  // lookup and once for the policy lookup. Both return chainable handles whose
  // terminal `.limit()` resolves to the respective row set.
  vi.mocked(getOrgScopedDb).mockImplementation(() => makeChain() as unknown as ReturnType<typeof getOrgScopedDb>);
}

/** Merchant input used across tests. */
const MERCHANT_INPUT = {
  id: 'merch_12345',
  descriptor: '  Acme Corp  ',
};

const NORMALISED_MERCHANT = {
  id: 'merch_12345',
  descriptor: normaliseMerchantDescriptor('  Acme Corp  '),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// pay_invoice
// ---------------------------------------------------------------------------

describe('executePayInvoice', () => {
  it('maps input to proposeCharge with chargeType=invoice_payment and executionPath=main_app_stripe', async () => {
    mockSpendingContextResolution();
    vi.mocked(chargeRouterService.proposeCharge).mockResolvedValueOnce(MOCK_EXECUTED_RESPONSE);

    const input = {
      invoiceId: 'inv_001',
      amount: 1999,
      currency: 'USD',
      merchant: MERCHANT_INPUT,
      intent: 'Pay invoice INV-001',
    };

    const result = await executePayInvoice(input, makeContext());

    expect(chargeRouterService.proposeCharge).toHaveBeenCalledOnce();
    const call = vi.mocked(chargeRouterService.proposeCharge).mock.calls[0][0];
    expect(call.chargeType).toBe('invoice_payment');
    expect(call.executionPath).toBe('main_app_stripe');
    expect(call.amountMinor).toBe(1999);
    expect(call.currency).toBe('USD');
    expect(call.merchant).toEqual(NORMALISED_MERCHANT);
    expect(call.args['invoiceId']).toBe('inv_001');
    expect(call.parentChargeId).toBeNull();
    expect(result.outcome).toBe('executed');
  });

  it('returns blocked when no active spending budget exists', async () => {
    // org-scoped-DB returns empty array for the budget query — exercises the
    // resolveSpendingContext "no_active_spending_budget" branch.
    vi.mocked(getOrgScopedDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getOrgScopedDb>);

    const input = {
      invoiceId: 'inv_002',
      amount: 500,
      currency: 'USD',
      merchant: MERCHANT_INPUT,
      intent: 'Pay invoice INV-002',
    };

    const result = await executePayInvoice(input, makeContext());

    expect(chargeRouterService.proposeCharge).not.toHaveBeenCalled();
    expect(result.outcome).toBe('blocked');
    expect(result.reason).toBe('no_active_spending_budget');
  });

  it('returns blocked when input fails Zod validation', async () => {
    const result = await executePayInvoice(
      { invoiceId: 'inv_003', amount: -50, currency: 'USD', merchant: MERCHANT_INPUT, intent: 'test' },
      makeContext(),
    );

    expect(chargeRouterService.proposeCharge).not.toHaveBeenCalled();
    expect(result.outcome).toBe('blocked');
    expect(result.reason).toContain('invalid_skill_args');
  });
});

// ---------------------------------------------------------------------------
// purchase_resource
// ---------------------------------------------------------------------------

describe('executePurchaseResource', () => {
  it('maps input to proposeCharge with chargeType=purchase and executionPath=worker_hosted_form', async () => {
    mockSpendingContextResolution();
    vi.mocked(chargeRouterService.proposeCharge).mockResolvedValueOnce(MOCK_EXECUTED_RESPONSE);

    const input = {
      resourceId: 'resource_abc',
      amount: 4999,
      currency: 'USD',
      merchant: MERCHANT_INPUT,
      intent: 'Purchase domain example.com',
    };

    const result = await executePurchaseResource(input, makeContext());

    expect(chargeRouterService.proposeCharge).toHaveBeenCalledOnce();
    const call = vi.mocked(chargeRouterService.proposeCharge).mock.calls[0][0];
    expect(call.chargeType).toBe('purchase');
    expect(call.executionPath).toBe('worker_hosted_form');
    expect(call.amountMinor).toBe(4999);
    expect(call.args['resourceId']).toBe('resource_abc');
    expect(call.parentChargeId).toBeNull();
    expect(result.outcome).toBe('executed');
  });

  it('propagates shadow_settled response', async () => {
    mockSpendingContextResolution();
    vi.mocked(chargeRouterService.proposeCharge).mockResolvedValueOnce(MOCK_SHADOW_RESPONSE);

    const result = await executePurchaseResource(
      { resourceId: 'r1', amount: 100, currency: 'USD', merchant: MERCHANT_INPUT, intent: 'test' },
      makeContext(),
    );

    expect(result.outcome).toBe('shadow_settled');
    expect(result.chargeId).toBe('charge-shadow-id');
  });
});

// ---------------------------------------------------------------------------
// subscribe_to_service
// ---------------------------------------------------------------------------

describe('executeSubscribeToService', () => {
  it('maps input to proposeCharge with chargeType=subscription and executionPath=worker_hosted_form', async () => {
    mockSpendingContextResolution();
    vi.mocked(chargeRouterService.proposeCharge).mockResolvedValueOnce(MOCK_EXECUTED_RESPONSE);

    const input = {
      serviceId: 'svc_pro_plan',
      amount: 2999,
      currency: 'USD',
      merchant: MERCHANT_INPUT,
      intent: 'Subscribe to Pro plan',
    };

    const result = await executeSubscribeToService(input, makeContext());

    expect(chargeRouterService.proposeCharge).toHaveBeenCalledOnce();
    const call = vi.mocked(chargeRouterService.proposeCharge).mock.calls[0][0];
    expect(call.chargeType).toBe('subscription');
    expect(call.executionPath).toBe('worker_hosted_form');
    expect(call.amountMinor).toBe(2999);
    expect(call.args['serviceId']).toBe('svc_pro_plan');
    expect(result.outcome).toBe('executed');
  });
});

// ---------------------------------------------------------------------------
// top_up_balance
// ---------------------------------------------------------------------------

describe('executeTopUpBalance', () => {
  it('maps input to proposeCharge with chargeType=top_up and executionPath=worker_hosted_form', async () => {
    mockSpendingContextResolution();
    vi.mocked(chargeRouterService.proposeCharge).mockResolvedValueOnce(MOCK_EXECUTED_RESPONSE);

    const input = {
      accountId: 'acc_sms_wallet',
      amount: 10000,
      currency: 'USD',
      merchant: MERCHANT_INPUT,
      intent: 'Top up SMS balance',
    };

    const result = await executeTopUpBalance(input, makeContext());

    expect(chargeRouterService.proposeCharge).toHaveBeenCalledOnce();
    const call = vi.mocked(chargeRouterService.proposeCharge).mock.calls[0][0];
    expect(call.chargeType).toBe('top_up');
    expect(call.executionPath).toBe('worker_hosted_form');
    expect(call.amountMinor).toBe(10000);
    expect(call.args['accountId']).toBe('acc_sms_wallet');
    expect(result.outcome).toBe('executed');
  });
});

// ---------------------------------------------------------------------------
// issue_refund
// ---------------------------------------------------------------------------

describe('executeIssueRefund', () => {
  it('maps input to proposeCharge with chargeType=refund, executionPath=main_app_stripe, parentChargeId set', async () => {
    mockSpendingContextResolution();
    vi.mocked(chargeRouterService.proposeCharge).mockResolvedValueOnce(MOCK_EXECUTED_RESPONSE);

    const parentId = '11111111-1111-1111-1111-222222222222';
    const input = {
      parentChargeId: parentId,
      amount: 1999,
      currency: 'USD',
      merchant: MERCHANT_INPUT,
      intent: 'Refund duplicate payment',
    };

    const result = await executeIssueRefund(input, makeContext());

    expect(chargeRouterService.proposeCharge).toHaveBeenCalledOnce();
    const call = vi.mocked(chargeRouterService.proposeCharge).mock.calls[0][0];
    expect(call.chargeType).toBe('refund');
    expect(call.executionPath).toBe('main_app_stripe');
    expect(call.parentChargeId).toBe(parentId);
    expect(call.amountMinor).toBe(1999);
    expect(call.merchant).toEqual(NORMALISED_MERCHANT);
    expect(result.outcome).toBe('executed');
  });

  it('returns blocked when parentChargeId is missing (invariant 41 guard)', async () => {
    const result = await executeIssueRefund(
      { amount: 500, currency: 'USD', merchant: MERCHANT_INPUT, intent: 'test refund' },
      makeContext(),
    );

    expect(chargeRouterService.proposeCharge).not.toHaveBeenCalled();
    expect(result.outcome).toBe('blocked');
    expect(result.reason).toContain('parentChargeId is required');
  });

  it('does NOT call UPDATE agent_charges SET status refunded — only calls proposeCharge', async () => {
    mockSpendingContextResolution();
    vi.mocked(chargeRouterService.proposeCharge).mockResolvedValueOnce(MOCK_EXECUTED_RESPONSE);

    const parentId2 = '33333333-3333-3333-3333-444444444444';
    const input = {
      parentChargeId: parentId2,
      amount: 100,
      currency: 'USD',
      merchant: MERCHANT_INPUT,
      intent: 'test refund invariant 41',
    };

    await executeIssueRefund(input, makeContext());

    // Only proposeCharge should have been called — no direct DB mutation.
    expect(chargeRouterService.proposeCharge).toHaveBeenCalledOnce();
    // Verify the call uses inbound_refund semantics (parentChargeId set, chargeType=refund).
    const call = vi.mocked(chargeRouterService.proposeCharge).mock.calls[0][0];
    expect(call.parentChargeId).toBe(parentId2);
    expect(call.chargeType).toBe('refund');
  });

  it('normalises merchant descriptor before passing to proposeCharge (invariant 21)', async () => {
    mockSpendingContextResolution();
    vi.mocked(chargeRouterService.proposeCharge).mockResolvedValueOnce(MOCK_EXECUTED_RESPONSE);

    const input = {
      parentChargeId: '55555555-5555-5555-5555-666666666666',
      amount: 500,
      currency: 'USD',
      merchant: { id: null, descriptor: '  stripe  inc  ' },
      intent: 'refund test normalisation',
    };

    await executeIssueRefund(input, makeContext());

    const call = vi.mocked(chargeRouterService.proposeCharge).mock.calls[0][0];
    // Descriptor must be normalised: trimmed, collapsed whitespace, uppercased, punctuation stripped.
    expect(call.merchant.descriptor).toBe(normaliseMerchantDescriptor('  stripe  inc  '));
    expect(call.merchant.descriptor).toBe('STRIPE INC');
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: merchant normalisation applied to all spend skills
// ---------------------------------------------------------------------------

describe('merchant normalisation (invariant 21)', () => {
  it('pay_invoice normalises descriptor before idempotency key is built', async () => {
    mockSpendingContextResolution();
    vi.mocked(chargeRouterService.proposeCharge).mockResolvedValueOnce(MOCK_EXECUTED_RESPONSE);

    await executePayInvoice(
      { invoiceId: 'inv_norm', amount: 100, currency: 'USD', merchant: { id: null, descriptor: 'ACME  Corp.' }, intent: 'test' },
      makeContext(),
    );

    const call = vi.mocked(chargeRouterService.proposeCharge).mock.calls[0][0];
    expect(call.merchant.descriptor).toBe(normaliseMerchantDescriptor('ACME  Corp.'));
  });
});

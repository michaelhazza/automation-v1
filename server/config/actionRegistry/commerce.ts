import { z } from 'zod';
import type { ActionDefinition } from './types.js';
import { defineSpendWrite } from './factories.js';

export const commerceActions: Record<string, ActionDefinition> = {
  // ── Agentic Commerce — Spend Skills (Chunk 6) ────────────────────────────
  // All five entries: actionCategory 'api', directExternalSideEffect true,
  // idempotencyStrategy 'locked', requiredIntegration 'stripe_agent',
  // defaultGateLevel 'review', spendsMoney true.
  // executionPath per spec §7.1: pay_invoice and issue_refund → main_app_stripe;
  // purchase_resource, subscribe_to_service, top_up_balance → worker_hosted_form.
  // Spec: tasks/builds/agentic-commerce/spec.md §7.1
  // Plan: tasks/builds/agentic-commerce/plan.md §Chunk 6
  pay_invoice: defineSpendWrite({
    slug: 'pay_invoice',
    description:
      'Pay an outstanding invoice via the configured payment integration. ' +
      'Feeder skill for process_bill. Routes through charge policy engine; ' +
      'may auto-approve, require operator approval, or be blocked by policy.',
    payloadFields: ['invoiceId', 'amount', 'currency', 'merchant', 'intent'],
    parameterSchema: z.object({
      invoiceId: z.string().min(1).describe('Invoice identifier issued by the vendor or payment provider'),
      amount: z.number().int().positive().describe('Amount in currency minor units (e.g. 1999 = $19.99 USD)'),
      currency: z.string().length(3).describe('ISO 4217 three-letter currency code (e.g. "USD")'),
      merchant: z.object({
        id: z.string().nullable().describe('Payment provider merchant identifier; null to fall back to descriptor matching'),
        descriptor: z.string().min(1).describe('Human-readable merchant name'),
      }).describe('Merchant identity for allowlist matching and ledger record'),
      intent: z.string().min(1).max(500).describe('Human-readable description of the payment purpose'),
    }),
    executionPath: 'main_app_stripe',
    // Trust & Verification Layer §6.1 — review-gated charge: HITL approval is the
    // verification boundary; actionService wrapper has no comparable post-check shape.
    verify: null,
    verifyActionNoun: 'charge',
  }),

  purchase_resource: defineSpendWrite({
    slug: 'purchase_resource',
    description:
      'Complete a one-shot purchase against a vendor\'s hosted checkout form. ' +
      'Routes through charge policy engine; worker fills the merchant form after authorisation.',
    payloadFields: ['resourceId', 'amount', 'currency', 'merchant', 'intent'],
    parameterSchema: z.object({
      resourceId: z.string().min(1).describe('Identifier of the resource to purchase (domain, licence, digital product, etc.)'),
      amount: z.number().int().positive().describe('Amount in currency minor units (e.g. 4999 = $49.99 USD)'),
      currency: z.string().length(3).describe('ISO 4217 three-letter currency code (e.g. "USD")'),
      merchant: z.object({
        id: z.string().nullable().describe('Payment provider merchant identifier; null to fall back to descriptor matching'),
        descriptor: z.string().min(1).describe('Human-readable merchant name'),
      }).describe('Merchant identity for allowlist matching and ledger record'),
      intent: z.string().min(1).max(500).describe('Human-readable description of what is being purchased'),
    }),
    executionPath: 'worker_hosted_form',
  }),

  subscribe_to_service: defineSpendWrite({
    slug: 'subscribe_to_service',
    description:
      'Complete a vendor signup and subscription against a hosted payment form. ' +
      'Read mirror: track_subscriptions. Routes through charge policy engine; ' +
      'worker fills the vendor form after authorisation.',
    payloadFields: ['serviceId', 'amount', 'currency', 'merchant', 'intent'],
    parameterSchema: z.object({
      serviceId: z.string().min(1).describe('Identifier of the subscription or service tier to activate'),
      amount: z.number().int().positive().describe('Initial or recurring charge amount in currency minor units'),
      currency: z.string().length(3).describe('ISO 4217 three-letter currency code (e.g. "USD")'),
      merchant: z.object({
        id: z.string().nullable().describe('Payment provider merchant identifier; null to fall back to descriptor matching'),
        descriptor: z.string().min(1).describe('Human-readable vendor name'),
      }).describe('Merchant identity for allowlist matching and ledger record'),
      intent: z.string().min(1).max(500).describe('Human-readable description of the subscription purpose'),
    }),
    executionPath: 'worker_hosted_form',
  }),

  top_up_balance: defineSpendWrite({
    slug: 'top_up_balance',
    description:
      'Top up a prepaid balance or credits account via a vendor\'s hosted top-up form. ' +
      'Distinct from ad-platform budget top-ups. Routes through charge policy engine; ' +
      'worker fills the vendor form after authorisation.',
    payloadFields: ['accountId', 'amount', 'currency', 'merchant', 'intent'],
    parameterSchema: z.object({
      accountId: z.string().min(1).describe('Identifier of the prepaid balance or credits account to top up'),
      amount: z.number().int().positive().describe('Amount to add in currency minor units (e.g. 10000 = $100.00 USD)'),
      currency: z.string().length(3).describe('ISO 4217 three-letter currency code (e.g. "USD")'),
      merchant: z.object({
        id: z.string().nullable().describe('Payment provider merchant identifier; null to fall back to descriptor matching'),
        descriptor: z.string().min(1).describe('Human-readable vendor name'),
      }).describe('Merchant identity for allowlist matching and ledger record'),
      intent: z.string().min(1).max(500).describe('Human-readable description of the top-up purpose'),
    }),
    executionPath: 'worker_hosted_form',
  }),

  issue_refund: defineSpendWrite({
    slug: 'issue_refund',
    description:
      'Issue a refund against a prior charge. Creates a new inbound-refund ledger row ' +
      '(kind: inbound_refund, direction: subtract); does NOT mutate the original charge record. ' +
      'Routes through charge policy engine. See plan invariant 41.',
    payloadFields: ['parentChargeId', 'amount', 'currency', 'merchant', 'intent'],
    parameterSchema: z.object({
      parentChargeId: z.string().uuid().describe('UUID of the original agent_charges row to refund against; must be in succeeded status'),
      amount: z.number().int().positive().describe('Amount to refund in currency minor units; must not exceed the original charge'),
      currency: z.string().length(3).describe('ISO 4217 three-letter currency code; must match the original charge currency'),
      merchant: z.object({
        id: z.string().nullable().describe('Payment provider merchant identifier; null to fall back to descriptor matching'),
        descriptor: z.string().min(1).describe('Human-readable merchant name matching the original charge'),
      }).describe('Merchant identity for allowlist matching and ledger record'),
      intent: z.string().min(1).max(500).describe('Human-readable description of the refund reason'),
    }),
    executionPath: 'main_app_stripe',
  }),

  // ── Shadow-to-live promotion (HITL meta-action — no money movement) ──────
  // Spec: tasks/builds/agentic-commerce/spec.md §14 Shadow-to-Live Promotion.
  // Created by spendingBudgetService.requestPromotion when an operator asks to
  // flip a spending_policies row from mode='shadow' to mode='live'. Routes
  // through HITL review; on approval, policy.mode is updated under advisory
  // lock and approval channels notified. Does NOT move money — spendsMoney is
  // false, no Stripe involvement, no charge ledger row.
  promote_spending_policy_to_live: {
    actionType: 'promote_spending_policy_to_live',
    description:
      'Request shadow-to-live promotion of a spending policy. Routes through ' +
      'the HITL review queue; on approval, the spending_policies row flips from ' +
      "mode='shadow' to mode='live'. System-initiated; no money movement.",
    actionCategory: 'api',
    isExternal: false,
    readPath: 'none',
    defaultGateLevel: 'review',
    riskTier: 3,
    createsBoardTask: false,
    payloadFields: ['spendingBudgetId', 'requesterId'],
    parameterSchema: z.object({
      spendingBudgetId: z.string().uuid().describe('UUID of the spending budget whose policy is being promoted'),
      requesterId: z.string().describe('User ID of the operator requesting the promotion'),
    }),
    retryPolicy: {
      maxRetries: 0,
      strategy: 'none',
      retryOn: [],
      doNotRetryOn: [],
    },
    idempotencyStrategy: 'keyed_write',
    directExternalSideEffect: false,
    spendsMoney: false,
  },
};

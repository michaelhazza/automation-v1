import { describe, test, expect } from 'vitest';
import {
  defineCanonicalRead,
  defineInternalRead,
  defineExternalRead,
  defineInternalStateWrite,
  defineExternalWrite,
  defineCustomerMessagingWrite,
  defineConfigWrite,
  defineSpendWrite,
  defineMethodologySkill,
} from '../factories.js';
import { z } from 'zod';

// ── Shared minimal schemas ────────────────────────────────────────────────────

const emptySchema = z.object({});
const basicSchema = z.object({ id: z.string() });

// ── 1. defineCanonicalRead ────────────────────────────────────────────────────

describe('defineCanonicalRead', () => {
  test('smoke: minimal args produce a valid ActionDefinition', () => {
    const def = defineCanonicalRead({
      slug: 'test.canonical_read',
      description: 'Test canonical read',
      riskTier: 0,
      payloadFields: ['id'],
      parameterSchema: basicSchema,
    });
    expect(def.actionType).toBe('test.canonical_read');
    expect(def.actionCategory).toBe('worker');
    expect(def.readPath).toBe('canonical');
    expect(def.isExternal).toBe(false);
    expect(def.idempotencyStrategy).toBe('read_only');
  });

  test('defaults: verify and verifyNullJustification are undefined (IIFE-safe)', () => {
    const def = defineCanonicalRead({
      slug: 'test.canonical_read2',
      description: 'Test',
      riskTier: 0,
      payloadFields: [],
      parameterSchema: emptySchema,
    });
    expect(def.verify).toBeUndefined();
    expect(def.verifyNullJustification).toBeUndefined();
  });

  test('defaults: mcp.annotations.readOnlyHint=true, openWorldHint=false', () => {
    const def = defineCanonicalRead({
      slug: 'test.cr3',
      description: 'Test',
      riskTier: 1,
      payloadFields: [],
      parameterSchema: emptySchema,
    });
    expect(def.mcp?.annotations.readOnlyHint).toBe(true);
    expect(def.mcp?.annotations.openWorldHint).toBe(false);
    expect(def.mcp?.annotations.destructiveHint).toBe(false);
  });

  test('topics propagates', () => {
    const def = defineCanonicalRead({
      slug: 'test.cr4',
      description: 'Test',
      topics: ['support'],
      riskTier: 0,
      payloadFields: [],
      parameterSchema: emptySchema,
    });
    expect(def.topics).toEqual(['support']);
  });

  test('retryPolicy override works', () => {
    const custom = { maxRetries: 2, strategy: 'exponential_backoff' as const, retryOn: ['timeout'], doNotRetryOn: [] };
    const def = defineCanonicalRead({
      slug: 'test.cr5',
      description: 'Test',
      riskTier: 0,
      payloadFields: [],
      parameterSchema: emptySchema,
      retryPolicy: custom,
    });
    expect(def.retryPolicy).toEqual(custom);
  });
});

// ── 2. defineInternalRead ─────────────────────────────────────────────────────

describe('defineInternalRead', () => {
  test('smoke: readPath canonical', () => {
    const def = defineInternalRead({
      slug: 'test.internal_read',
      description: 'Test',
      readPath: 'canonical',
      riskTier: 0,
      payloadFields: [],
      parameterSchema: emptySchema,
    });
    expect(def.actionType).toBe('test.internal_read');
    expect(def.readPath).toBe('canonical');
    expect(def.actionCategory).toBe('worker');
    expect(def.idempotencyStrategy).toBe('read_only');
  });

  test('smoke: readPath none', () => {
    const def = defineInternalRead({
      slug: 'test.ir2',
      description: 'Test',
      readPath: 'none',
      riskTier: 0,
      payloadFields: [],
      parameterSchema: emptySchema,
    });
    expect(def.readPath).toBe('none');
  });

  test('defaults: verify and verifyNullJustification are undefined (IIFE-safe)', () => {
    const def = defineInternalRead({
      slug: 'test.ir3',
      description: 'Test',
      readPath: 'none',
      riskTier: 0,
      payloadFields: [],
      parameterSchema: emptySchema,
    });
    expect(def.verify).toBeUndefined();
    expect(def.verifyNullJustification).toBeUndefined();
  });

  test('isUniversal propagates', () => {
    const def = defineInternalRead({
      slug: 'test.ir4',
      description: 'Test',
      readPath: 'canonical',
      riskTier: 0,
      payloadFields: [],
      parameterSchema: emptySchema,
      isUniversal: true,
    });
    expect(def.isUniversal).toBe(true);
  });
});

// ── 3. defineExternalRead ─────────────────────────────────────────────────────

describe('defineExternalRead', () => {
  test('smoke: minimal args', () => {
    const def = defineExternalRead({
      slug: 'test.external_read',
      description: 'Test',
      riskTier: 2,
      payloadFields: ['url'],
      parameterSchema: basicSchema,
      liveFetchRationale: 'Provider API — not yet migrated to canonical',
    });
    expect(def.actionType).toBe('test.external_read');
    expect(def.actionCategory).toBe('api');
    expect(def.isExternal).toBe(true);
    expect(def.readPath).toBe('liveFetch');
    expect(def.liveFetchRationale).toBe('Provider API — not yet migrated to canonical');
    expect(def.idempotencyStrategy).toBe('read_only');
  });

  test('defaults: verify and verifyNullJustification are undefined (IIFE-safe)', () => {
    const def = defineExternalRead({
      slug: 'test.er2',
      description: 'Test',
      riskTier: 2,
      payloadFields: [],
      parameterSchema: emptySchema,
      liveFetchRationale: 'Provider API',
    });
    expect(def.verify).toBeUndefined();
    expect(def.verifyNullJustification).toBeUndefined();
  });

  test('defaults: mcp.annotations.openWorldHint=true', () => {
    const def = defineExternalRead({
      slug: 'test.er3',
      description: 'Test',
      riskTier: 2,
      payloadFields: [],
      parameterSchema: emptySchema,
      liveFetchRationale: 'Provider API',
    });
    expect(def.mcp?.annotations.openWorldHint).toBe(true);
    expect(def.mcp?.annotations.readOnlyHint).toBe(true);
  });
});

// ── 4. defineInternalStateWrite ───────────────────────────────────────────────

describe('defineInternalStateWrite', () => {
  test('smoke: minimal args', () => {
    const def = defineInternalStateWrite({
      slug: 'test.internal_write',
      description: 'Test',
      riskTier: 2,
      payloadFields: ['task_id'],
      parameterSchema: basicSchema,
    });
    expect(def.actionType).toBe('test.internal_write');
    expect(def.actionCategory).toBe('worker');
    expect(def.isExternal).toBe(false);
    expect(def.readPath).toBe('none');
    expect(def.idempotencyStrategy).toBe('state_based');
  });

  test('defaults: verify and verifyNullJustification are undefined (IIFE-safe)', () => {
    const def = defineInternalStateWrite({
      slug: 'test.iw2',
      description: 'Test',
      riskTier: 2,
      payloadFields: [],
      parameterSchema: emptySchema,
    });
    expect(def.verify).toBeUndefined();
    expect(def.verifyNullJustification).toBeUndefined();
  });

  test('idempotencyStrategy override to keyed_write', () => {
    const def = defineInternalStateWrite({
      slug: 'test.iw3',
      description: 'Test',
      riskTier: 2,
      payloadFields: [],
      parameterSchema: emptySchema,
      idempotencyStrategy: 'keyed_write',
    });
    expect(def.idempotencyStrategy).toBe('keyed_write');
  });

  test('defaultGateLevel override to review', () => {
    const def = defineInternalStateWrite({
      slug: 'test.iw4',
      description: 'Test',
      riskTier: 3,
      payloadFields: [],
      parameterSchema: emptySchema,
      defaultGateLevel: 'review',
    });
    expect(def.defaultGateLevel).toBe('review');
  });
});

// ── 5. defineExternalWrite ────────────────────────────────────────────────────

describe('defineExternalWrite', () => {
  test('smoke: minimal args', () => {
    const def = defineExternalWrite({
      slug: 'test.external_write',
      description: 'Test',
      riskTier: 3,
      payloadFields: ['record_id'],
      parameterSchema: basicSchema,
    });
    expect(def.actionType).toBe('test.external_write');
    expect(def.actionCategory).toBe('api');
    expect(def.isExternal).toBe(true);
    expect(def.defaultGateLevel).toBe('review');
    expect(def.idempotencyStrategy).toBe('keyed_write');
  });

  test('defaults: verify and verifyNullJustification are undefined (IIFE-safe)', () => {
    const def = defineExternalWrite({
      slug: 'test.ew2',
      description: 'Test',
      riskTier: 3,
      payloadFields: [],
      parameterSchema: emptySchema,
    });
    expect(def.verify).toBeUndefined();
    expect(def.verifyNullJustification).toBeUndefined();
  });

  test('idempotencyStrategy override to locked', () => {
    const def = defineExternalWrite({
      slug: 'test.ew3',
      description: 'Test',
      riskTier: 3,
      payloadFields: [],
      parameterSchema: emptySchema,
      idempotencyStrategy: 'locked',
    });
    expect(def.idempotencyStrategy).toBe('locked');
  });
});

// ── 6. defineCustomerMessagingWrite ──────────────────────────────────────────

describe('defineCustomerMessagingWrite', () => {
  test('smoke: minimal args', () => {
    const def = defineCustomerMessagingWrite({
      slug: 'send_email',
      description: 'Send an email via a connected email provider.',
      topics: ['email'],
      riskTier: 6,
      verifyActionNoun: 'send',
      payloadFields: ['to', 'subject', 'body'],
      parameterSchema: basicSchema,
    });
    expect(def.actionType).toBe('send_email');
    expect(def.actionCategory).toBe('api');
    expect(def.verify).toBe(null);
    expect(def.reversible).toBe(false);
    expect(def.blastRadius).toBe('external');
    expect(def.defaultGateLevel).toBe('review');
  });

  test('verifyNullJustification matches exact source string for send_email (verifyActionNoun=send)', () => {
    const def = defineCustomerMessagingWrite({
      slug: 'send_email',
      description: 'Test',
      topics: ['email'],
      riskTier: 6,
      verifyActionNoun: 'send',
      payloadFields: [],
      parameterSchema: emptySchema,
    });
    expect(def.verifyNullJustification).toBe(
      'Review-gated send: HITL approval is the verification boundary; actionService wrapper has no comparable post-check shape',
    );
  });

  test('verifyNullJustification template works for CRM trigger noun', () => {
    const def = defineCustomerMessagingWrite({
      slug: 'crm.fire_automation',
      description: 'Test',
      topics: ['crm'],
      riskTier: 6,
      verifyActionNoun: 'CRM trigger',
      payloadFields: [],
      parameterSchema: emptySchema,
    });
    expect(def.verifyNullJustification).toBe(
      'Review-gated CRM trigger: HITL approval is the verification boundary; actionService wrapper has no comparable post-check shape',
    );
  });

  test('verifyNullJustification template works for CRM email noun', () => {
    const def = defineCustomerMessagingWrite({
      slug: 'crm.send_email',
      description: 'Test',
      topics: ['crm'],
      riskTier: 6,
      verifyActionNoun: 'CRM email',
      payloadFields: [],
      parameterSchema: emptySchema,
    });
    expect(def.verifyNullJustification).toBe(
      'Review-gated CRM email: HITL approval is the verification boundary; actionService wrapper has no comparable post-check shape',
    );
  });

  test('verifyNullJustification template works for CRM SMS noun', () => {
    const def = defineCustomerMessagingWrite({
      slug: 'crm.send_sms',
      description: 'Test',
      topics: ['crm'],
      riskTier: 6,
      verifyActionNoun: 'CRM SMS',
      payloadFields: [],
      parameterSchema: emptySchema,
    });
    expect(def.verifyNullJustification).toBe(
      'Review-gated CRM SMS: HITL approval is the verification boundary; actionService wrapper has no comparable post-check shape',
    );
  });

  test('verifyNullJustification template works for CRM task noun', () => {
    const def = defineCustomerMessagingWrite({
      slug: 'crm.create_task',
      description: 'Test',
      topics: ['crm'],
      riskTier: 6,
      verifyActionNoun: 'CRM task',
      payloadFields: [],
      parameterSchema: emptySchema,
    });
    expect(def.verifyNullJustification).toBe(
      'Review-gated CRM task: HITL approval is the verification boundary; actionService wrapper has no comparable post-check shape',
    );
  });

  test('verifyNullJustification template works for alert noun (notify_operator)', () => {
    const def = defineCustomerMessagingWrite({
      slug: 'notify_operator',
      description: 'Test',
      topics: ['clientpulse'],
      riskTier: 3,
      verifyActionNoun: 'alert',
      payloadFields: [],
      parameterSchema: emptySchema,
    });
    expect(def.verifyNullJustification).toBe(
      'Review-gated alert: HITL approval is the verification boundary; actionService wrapper has no comparable post-check shape',
    );
  });

  test('actionCategory defaults to api but can be overridden to worker', () => {
    const def = defineCustomerMessagingWrite({
      slug: 'test.cmw',
      description: 'Test',
      topics: ['test'],
      riskTier: 6,
      verifyActionNoun: 'send',
      payloadFields: [],
      parameterSchema: emptySchema,
      actionCategory: 'worker',
    });
    expect(def.actionCategory).toBe('worker');
  });

  test('idempotencyStrategy defaults to keyed_write and can be overridden to locked', () => {
    const def = defineCustomerMessagingWrite({
      slug: 'test.cmw2',
      description: 'Test',
      topics: ['test'],
      riskTier: 6,
      verifyActionNoun: 'send',
      payloadFields: [],
      parameterSchema: emptySchema,
      idempotencyStrategy: 'locked',
    });
    expect(def.idempotencyStrategy).toBe('locked');
  });
});

// ── 7. defineConfigWrite ─────────────────────────────────────────────────────

describe('defineConfigWrite', () => {
  test('smoke: minimal args, defaults to riskTier 3', () => {
    const def = defineConfigWrite({
      slug: 'config_create_agent',
      description: 'Create a new agent',
      parameterSchema: basicSchema,
    });
    expect(def.actionType).toBe('config_create_agent');
    expect(def.riskTier).toBe(3);
    expect(def.actionCategory).toBe('api');
    expect(def.topics).toEqual(['configuration']);
    expect(def.defaultGateLevel).toBe('review');
    expect(def.idempotencyStrategy).toBe('keyed_write');
    expect(def.isExternal).toBe(false);
    expect(def.readPath).toBe('none');
  });

  test('defaults: verify and verifyNullJustification are undefined (IIFE-safe)', () => {
    const def = defineConfigWrite({
      slug: 'config_test',
      description: 'Test',
      parameterSchema: emptySchema,
    });
    expect(def.verify).toBeUndefined();
    expect(def.verifyNullJustification).toBeUndefined();
  });

  test('riskTier: 3 is default', () => {
    const def = defineConfigWrite({
      slug: 'config_a',
      description: 'Test',
      parameterSchema: emptySchema,
    });
    expect(def.riskTier).toBe(3);
  });

  test('riskTier: 2 override works', () => {
    const def = defineConfigWrite({
      slug: 'config_set_link_instructions',
      description: 'Test',
      parameterSchema: emptySchema,
      riskTier: 2,
    });
    expect(def.riskTier).toBe(2);
  });

  test('retry policy matches config_update_agent source (exponential_backoff, 2 retries)', () => {
    const def = defineConfigWrite({
      slug: 'config_update_agent',
      description: 'Test',
      parameterSchema: emptySchema,
    });
    expect(def.retryPolicy.maxRetries).toBe(2);
    expect(def.retryPolicy.strategy).toBe('exponential_backoff');
    expect(def.retryPolicy.retryOn).toContain('timeout');
    expect(def.retryPolicy.retryOn).toContain('network_error');
    expect(def.retryPolicy.doNotRetryOn).toContain('validation_error');
    expect(def.retryPolicy.doNotRetryOn).toContain('auth_error');
  });

  test('mcp is undefined by default (source entries omit mcp; IIFE uses absence to classify as config write)', () => {
    const def = defineConfigWrite({
      slug: 'config_c',
      description: 'Test',
      parameterSchema: emptySchema,
    });
    expect(def.mcp).toBeUndefined();
  });
});

// ── 8. defineSpendWrite ───────────────────────────────────────────────────────

describe('defineSpendWrite', () => {
  test('smoke: minimal args produce a valid spend ActionDefinition', () => {
    const def = defineSpendWrite({
      slug: 'pay_invoice',
      description: 'Pay an outstanding invoice',
      payloadFields: ['invoiceId', 'amount', 'currency'],
      parameterSchema: basicSchema,
      executionPath: 'main_app_stripe',
    });
    expect(def.actionType).toBe('pay_invoice');
    expect(def.actionCategory).toBe('api');
    expect(def.riskTier).toBe(6);
    expect(def.defaultGateLevel).toBe('review');
    expect(def.idempotencyStrategy).toBe('locked');
    expect(def.directExternalSideEffect).toBe(true);
    expect(def.requiredIntegration).toBe('stripe_agent');
    expect(def.spendsMoney).toBe(true);
    expect(def.reversible).toBe(false);
    expect(def.blastRadius).toBe('external');
  });

  test('default verify matches purchase_resource/subscribe_to_service/top_up_balance shape', () => {
    const def = defineSpendWrite({
      slug: 'purchase_resource',
      description: 'Test',
      payloadFields: [],
      parameterSchema: emptySchema,
      executionPath: 'worker_hosted_form',
    });
    expect(def.verify).toEqual({
      kind: 'external_returns',
      provider: 'stripe',
      expectedField: 'id',
    });
    expect(def.verifyNullJustification).toBeUndefined();
  });

  test('verify: null override works (pay_invoice pattern)', () => {
    const def = defineSpendWrite({
      slug: 'pay_invoice',
      description: 'Test',
      payloadFields: [],
      parameterSchema: emptySchema,
      executionPath: 'main_app_stripe',
      verify: null,
      verifyActionNoun: 'charge',
    });
    expect(def.verify).toBe(null);
    expect(def.verifyNullJustification).toBe(
      'Review-gated charge: HITL approval is the verification boundary; actionService wrapper has no comparable post-check shape',
    );
  });

  test('explicit verify shape override works', () => {
    const customVerify = { kind: 'external_returns' as const, provider: 'stripe', expectedField: 'status' };
    const def = defineSpendWrite({
      slug: 'test.spend',
      description: 'Test',
      payloadFields: [],
      parameterSchema: emptySchema,
      executionPath: 'worker_hosted_form',
      verify: customVerify,
    });
    expect(def.verify).toEqual(customVerify);
  });

  test('mcp.annotations: destructiveHint=true, idempotentHint=true, openWorldHint=true', () => {
    const def = defineSpendWrite({
      slug: 'test.sw',
      description: 'Test',
      payloadFields: [],
      parameterSchema: emptySchema,
      executionPath: 'worker_hosted_form',
    });
    expect(def.mcp?.annotations.destructiveHint).toBe(true);
    expect(def.mcp?.annotations.idempotentHint).toBe(true);
    expect(def.mcp?.annotations.openWorldHint).toBe(true);
    expect(def.mcp?.annotations.readOnlyHint).toBe(false);
  });
});

// ── 9. defineMethodologySkill ─────────────────────────────────────────────────

describe('defineMethodologySkill', () => {
  test('smoke: minimal args', () => {
    const def = defineMethodologySkill({
      slug: 'draft_architecture_plan',
      description: 'Draft an architecture plan',
      topics: ['dev'],
    });
    expect(def.actionType).toBe('draft_architecture_plan');
    expect(def.actionCategory).toBe('worker');
    expect(def.isMethodology).toBe(true);
    expect(def.isExternal).toBe(false);
    expect(def.readPath).toBe('none');
    expect(def.riskTier).toBe(0);
    expect(def.defaultGateLevel).toBe('auto');
    expect(def.idempotencyStrategy).toBe('read_only');
  });

  test('isMethodology is true', () => {
    const def = defineMethodologySkill({
      slug: 'test.methodology',
      description: 'Test',
      topics: ['test'],
    });
    expect(def.isMethodology).toBe(true);
  });

  test('parameterSchema is the empty z.object({})', () => {
    const def = defineMethodologySkill({
      slug: 'test.ms2',
      description: 'Test',
      topics: ['test'],
    });
    // Confirm empty shape: ZodObject with no keys
    const shape = (def.parameterSchema as ReturnType<typeof z.object>)._def.shape();
    expect(Object.keys(shape)).toHaveLength(0);
  });

  test('topics propagates', () => {
    const def = defineMethodologySkill({
      slug: 'test.ms3',
      description: 'Test',
      topics: ['marketing', 'strategy'],
    });
    expect(def.topics).toEqual(['marketing', 'strategy']);
  });

  test('defaults: verify and verifyNullJustification are undefined (IIFE will set them)', () => {
    const def = defineMethodologySkill({
      slug: 'test.ms4',
      description: 'Test',
      topics: [],
    });
    expect(def.verify).toBeUndefined();
    expect(def.verifyNullJustification).toBeUndefined();
  });

  test('mcp.annotations: readOnlyHint=true, openWorldHint=false', () => {
    const def = defineMethodologySkill({
      slug: 'test.ms5',
      description: 'Test',
      topics: [],
    });
    expect(def.mcp?.annotations.readOnlyHint).toBe(true);
    expect(def.mcp?.annotations.openWorldHint).toBe(false);
    expect(def.mcp?.annotations.destructiveHint).toBe(false);
    expect(def.mcp?.annotations.idempotentHint).toBe(true);
  });

  test('retryPolicy is RETRY_NONE', () => {
    const def = defineMethodologySkill({
      slug: 'test.ms6',
      description: 'Test',
      topics: [],
    });
    expect(def.retryPolicy.maxRetries).toBe(0);
    expect(def.retryPolicy.strategy).toBe('none');
    expect(def.retryPolicy.retryOn).toEqual([]);
    expect(def.retryPolicy.doNotRetryOn).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { assertSingleWebhookComposition } from '../invokeAutomationStepServicePure.js';

describe('assertSingleWebhookComposition', () => {
  it('null webhookPath → fails with no_webhooks', () => {
    expect(assertSingleWebhookComposition({ webhookPath: null })).toEqual({ ok: false, reason: 'no_webhooks' });
  });
  it('empty webhookPath → fails with no_webhooks', () => {
    expect(assertSingleWebhookComposition({ webhookPath: '' })).toEqual({ ok: false, reason: 'no_webhooks' });
  });
  it('valid webhookPath → ok', () => {
    expect(assertSingleWebhookComposition({ webhookPath: '/webhook/path' })).toEqual({ ok: true });
  });
});

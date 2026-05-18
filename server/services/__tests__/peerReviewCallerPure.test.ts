// server/services/__tests__/peerReviewCallerPure.test.ts
// Pure unit tests for peerReviewCaller parser and exhaustion classifier.
// Closed-Loop Skill Improvement spec §9.1 step 10, §15.3 (Chunk 4).

import { describe, it, expect } from 'vitest';
import {
  parsePeerReviewResponse,
  classifyRouterExhaustionReason,
} from '../peerReviewCaller.js';
import { ProviderTimeoutError } from '../llmRouter.js';

// ── parsePeerReviewResponse ───────────────────────────────────────────────────

describe('parsePeerReviewResponse', () => {
  it('accepts valid addresses_root_cause response', () => {
    const raw = JSON.stringify({ verdict: 'addresses_root_cause', reasoning: 'Targets the exact root cause.' });
    const result = parsePeerReviewResponse(raw);
    expect(result).toEqual({ verdict: 'addresses_root_cause', reasoning: 'Targets the exact root cause.' });
  });

  it('accepts valid does_not_address response', () => {
    const raw = JSON.stringify({ verdict: 'does_not_address', reasoning: 'Off-topic amendment.' });
    const result = parsePeerReviewResponse(raw);
    expect(result).toEqual({ verdict: 'does_not_address', reasoning: 'Off-topic amendment.' });
  });

  it('accepts response with extra unknown fields', () => {
    const raw = JSON.stringify({ verdict: 'addresses_root_cause', reasoning: 'Good.', confidence: 0.9 });
    const result = parsePeerReviewResponse(raw);
    expect(result).not.toBeNull();
    expect(result?.verdict).toBe('addresses_root_cause');
  });

  it('rejects response missing verdict field', () => {
    const raw = JSON.stringify({ reasoning: 'Some reasoning.' });
    expect(parsePeerReviewResponse(raw)).toBeNull();
  });

  it('rejects response with invalid verdict value', () => {
    const raw = JSON.stringify({ verdict: 'maybe', reasoning: 'Some reasoning.' });
    expect(parsePeerReviewResponse(raw)).toBeNull();
  });

  it('rejects response where reasoning is not a string', () => {
    const raw = JSON.stringify({ verdict: 'addresses_root_cause', reasoning: 42 });
    expect(parsePeerReviewResponse(raw)).toBeNull();
  });

  it('rejects response missing reasoning field', () => {
    const raw = JSON.stringify({ verdict: 'addresses_root_cause' });
    expect(parsePeerReviewResponse(raw)).toBeNull();
  });

  it('rejects a non-JSON string', () => {
    expect(parsePeerReviewResponse('not json at all')).toBeNull();
  });

  it('rejects a JSON array', () => {
    expect(parsePeerReviewResponse('["addresses_root_cause"]')).toBeNull();
  });

  it('rejects a JSON null', () => {
    expect(parsePeerReviewResponse('null')).toBeNull();
  });

  it('handles leading/trailing whitespace in the raw string', () => {
    const raw = `  ${JSON.stringify({ verdict: 'does_not_address', reasoning: 'Irrelevant.' })}  `;
    const result = parsePeerReviewResponse(raw);
    expect(result?.verdict).toBe('does_not_address');
  });
});

// ── classifyRouterExhaustionReason ────────────────────────────────────────────

describe('classifyRouterExhaustionReason', () => {
  it('classifies ProviderTimeoutError as timeout', () => {
    const err = new ProviderTimeoutError(30000, 'peer_review');
    const result = classifyRouterExhaustionReason(err);
    expect(result).toEqual({ status: 'router_exhausted', reason: 'timeout' });
  });

  it('classifies PROVIDER_UNAVAILABLE code as all_providers_unavailable', () => {
    const err = Object.assign(new Error('unavailable'), { code: 'PROVIDER_UNAVAILABLE' });
    const result = classifyRouterExhaustionReason(err);
    expect(result).toEqual({ status: 'router_exhausted', reason: 'all_providers_unavailable' });
  });

  it('classifies PROVIDER_NOT_CONFIGURED code as all_providers_unavailable', () => {
    const err = Object.assign(new Error('not configured'), { code: 'PROVIDER_NOT_CONFIGURED' });
    const result = classifyRouterExhaustionReason(err);
    expect(result).toEqual({ status: 'router_exhausted', reason: 'all_providers_unavailable' });
  });

  it('classifies ComputeBudgetExceededError as circuit_breaker_open', () => {
    const err = Object.assign(new Error('budget exceeded'), { name: 'ComputeBudgetExceededError' });
    const result = classifyRouterExhaustionReason(err);
    expect(result).toEqual({ status: 'router_exhausted', reason: 'circuit_breaker_open' });
  });

  it('classifies RateLimitError as retry_budget_exhausted', () => {
    const err = Object.assign(new Error('rate limited'), { name: 'RateLimitError' });
    const result = classifyRouterExhaustionReason(err);
    expect(result).toEqual({ status: 'router_exhausted', reason: 'retry_budget_exhausted' });
  });

  it('returns null for a generic Error (caller should rethrow)', () => {
    const err = new Error('some unexpected error');
    expect(classifyRouterExhaustionReason(err)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(classifyRouterExhaustionReason(null)).toBeNull();
  });

  it('returns null for a string error', () => {
    expect(classifyRouterExhaustionReason('string error')).toBeNull();
  });
});

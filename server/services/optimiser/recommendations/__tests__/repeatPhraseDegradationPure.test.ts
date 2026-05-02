/**
 * server/services/optimiser/recommendations/__tests__/repeatPhraseDegradationPure.test.ts
 *
 * Pure tests for the F1-degradation logic in repeatPhrase.ts.
 *
 * Tests lookupBrandVoiceBlock by mocking db.execute to simulate:
 *   - F1 present + block found (returns row)
 *   - F1 merged but no block (returns empty)
 *   - F1 not merged (throws with code 42703)
 *
 * Spec: docs/sub-account-optimiser-spec.md §12 graceful degradation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB mock ────────────────────────────────────────────────────────────────────

const mockDbExecute = vi.fn();

vi.mock('../../../../db/index.js', () => ({
  db: {
    execute: (...args: unknown[]) => mockDbExecute(...args),
  },
}));

// Mock logger to suppress noise
vi.mock('../../../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { lookupBrandVoiceBlock, buildRepeatPhraseActionHint } from '../repeatPhrase.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('repeatPhrase F1 degradation — action_hint construction', () => {
  const subaccountId = '11111111-1111-1111-1111-111111111111';
  const phrase = 'guarantee';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── lookupBrandVoiceBlock ──────────────────────────────────────────────────

  it('F1 merged + brand-voice block exists => { exists: true }', async () => {
    mockDbExecute.mockResolvedValueOnce([{ id: 'block-uuid' }]);
    const result = await lookupBrandVoiceBlock(subaccountId);
    expect(result).toEqual({ exists: true });
  });

  it('F1 merged but no brand-voice block => { exists: false }', async () => {
    mockDbExecute.mockResolvedValueOnce([]);
    const result = await lookupBrandVoiceBlock(subaccountId);
    expect(result).toEqual({ exists: false });
  });

  it('42703 error (column "tier" missing) => { degraded: true }', async () => {
    mockDbExecute.mockRejectedValueOnce(
      Object.assign(new Error('column "tier" does not exist'), { code: '42703' }),
    );
    const result = await lookupBrandVoiceBlock(subaccountId);
    expect(result).toEqual({ degraded: true });
  });

  it('non-42703 DB error re-throws', async () => {
    mockDbExecute.mockRejectedValueOnce(
      Object.assign(new Error('connection refused'), { code: '57P01' }),
    );
    await expect(lookupBrandVoiceBlock(subaccountId)).rejects.toThrow('connection refused');
  });

  // ── buildRepeatPhraseActionHint ────────────────────────────────────────────

  it('F1 present + brand-voice block exists => full action_hint with phrase param', async () => {
    mockDbExecute.mockResolvedValueOnce([{ id: 'block-uuid' }]);
    const hint = await buildRepeatPhraseActionHint(phrase, subaccountId);
    expect(hint).toBe(
      `configuration-assistant://brand-voice/${subaccountId}?phrase=${encodeURIComponent(phrase)}`,
    );
  });

  it('F1 merged but no brand-voice block => degraded action_hint (no phrase param)', async () => {
    mockDbExecute.mockResolvedValueOnce([]);
    const hint = await buildRepeatPhraseActionHint(phrase, subaccountId);
    expect(hint).toBe(
      `configuration-assistant://subaccount/${subaccountId}?focus=brand-voice`,
    );
    expect(hint).not.toContain('phrase=');
  });

  it('F1 not yet merged (42703) => degraded action_hint (no phrase param)', async () => {
    mockDbExecute.mockRejectedValueOnce(
      Object.assign(new Error('column "tier" does not exist'), { code: '42703' }),
    );
    const hint = await buildRepeatPhraseActionHint(phrase, subaccountId);
    expect(hint).toBe(
      `configuration-assistant://subaccount/${subaccountId}?focus=brand-voice`,
    );
  });

  it('phrase with special characters is properly encoded in full action_hint', async () => {
    mockDbExecute.mockResolvedValueOnce([{ id: 'block-uuid' }]);
    const specialPhrase = 'guarantee & refund';
    const hint = await buildRepeatPhraseActionHint(specialPhrase, subaccountId);
    expect(hint).toContain(`?phrase=${encodeURIComponent(specialPhrase)}`);
    expect(hint).toContain('configuration-assistant://brand-voice/');
  });
});

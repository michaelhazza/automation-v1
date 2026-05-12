import { describe, it, expect } from 'vitest';
import { distilFeatures, shouldRefresh, canTransitionState } from '../voiceProfileServicePure.js';

describe('distilFeatures', () => {
  it('returns empty features for empty samples', () => {
    const f = distilFeatures([]);
    expect(f.averageSentenceLength).toBe(0);
    expect(f.commonPhrases).toEqual([]);
  });

  it('is deterministic regardless of input order', () => {
    const s1 = { text: 'Hi team. Thanks for the update.', source: 'gmail', sampledAt: '2026-01-01T00:00:00Z' };
    const s2 = { text: 'Hello there. Best regards.', source: 'gmail', sampledAt: '2026-01-02T00:00:00Z' };
    const f1 = distilFeatures([s1, s2]);
    const f2 = distilFeatures([s2, s1]);
    expect(f1).toEqual(f2);
  });

  it('captures greeting frequency', () => {
    const samples = [
      { text: 'Hi there.', source: 'gmail', sampledAt: '2026-01-01T00:00:00Z' },
      { text: 'Hi everyone.', source: 'gmail', sampledAt: '2026-01-02T00:00:00Z' },
    ];
    const f = distilFeatures(samples);
    expect(f.greetingFrequency['Hi']).toBeCloseTo(1.0);
  });
});

describe('shouldRefresh', () => {
  const now = new Date('2026-05-12T00:00:00Z');

  it('manual never refreshes', () => {
    expect(shouldRefresh({ refreshPolicy: 'manual', refreshConfig: null, lastDerivedAt: new Date('2020-01-01'), now })).toBe(false);
  });

  it('on_send_count never refreshes in V1', () => {
    expect(shouldRefresh({ refreshPolicy: 'on_send_count', refreshConfig: null, lastDerivedAt: null, now })).toBe(false);
  });

  it('periodic refreshes when threshold exceeded', () => {
    const lastDerived = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    expect(shouldRefresh({ refreshPolicy: 'periodic', refreshConfig: { days: 30 }, lastDerivedAt: lastDerived, now })).toBe(true);
  });

  it('periodic does not refresh within window', () => {
    const lastDerived = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    expect(shouldRefresh({ refreshPolicy: 'periodic', refreshConfig: { days: 30 }, lastDerivedAt: lastDerived, now })).toBe(false);
  });

  it('periodic refreshes when lastDerivedAt is null', () => {
    expect(shouldRefresh({ refreshPolicy: 'periodic', refreshConfig: { days: 30 }, lastDerivedAt: null, now })).toBe(true);
  });
});

describe('canTransitionState', () => {
  it('pending -> deriving allowed', () => expect(canTransitionState('pending', 'deriving')).toBe(true));
  it('deriving -> ready allowed', () => expect(canTransitionState('deriving', 'ready')).toBe(true));
  it('deriving -> failed allowed', () => expect(canTransitionState('deriving', 'failed')).toBe(true));
  it('ready -> deriving allowed (refresh)', () => expect(canTransitionState('ready', 'deriving')).toBe(true));
  it('failed -> pending allowed (manual retry)', () => expect(canTransitionState('failed', 'pending')).toBe(true));
  it('pending -> ready forbidden', () => expect(canTransitionState('pending', 'ready')).toBe(false));
  it('ready -> failed forbidden', () => expect(canTransitionState('ready', 'failed')).toBe(false));
});

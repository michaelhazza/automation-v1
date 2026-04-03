import { describe, it, expect } from 'vitest';
import { TripWire } from '../../../../server/lib/tripwire.js';

describe('TripWire', () => {
  it('extends Error', () => {
    const tw = new TripWire('Budget exceeded');
    expect(tw).toBeInstanceOf(Error);
  });

  it('has name set to TripWire', () => {
    const tw = new TripWire('test');
    expect(tw.name).toBe('TripWire');
  });

  it('stores the reason as both reason property and message', () => {
    const tw = new TripWire('Rate limit hit');
    expect(tw.reason).toBe('Rate limit hit');
    expect(tw.message).toBe('Rate limit hit');
  });

  it('defaults to retry: false when no options provided', () => {
    const tw = new TripWire('fatal error');
    expect(tw.options.retry).toBe(false);
  });

  it('accepts retry: true for soft abort', () => {
    const tw = new TripWire('Rate limit hit, back off', { retry: true });
    expect(tw.options.retry).toBe(true);
  });

  it('accepts retry: false for fatal halt', () => {
    const tw = new TripWire('Budget exceeded', { retry: false });
    expect(tw.options.retry).toBe(false);
  });

  it('stores optional error code', () => {
    const tw = new TripWire('Budget exceeded', { retry: false, code: 'BUDGET_LIMIT' });
    expect(tw.options.code).toBe('BUDGET_LIMIT');
  });

  it('code is undefined when not provided', () => {
    const tw = new TripWire('error', { retry: true });
    expect(tw.options.code).toBeUndefined();
  });

  it('can be caught as an Error in try-catch', () => {
    try {
      throw new TripWire('test throw', { retry: false });
    } catch (err) {
      expect(err).toBeInstanceOf(TripWire);
      expect(err).toBeInstanceOf(Error);
      expect((err as TripWire).reason).toBe('test throw');
    }
  });

  it('distinguishes retryable from fatal via options.retry', () => {
    const soft = new TripWire('soft', { retry: true });
    const fatal = new TripWire('fatal', { retry: false });

    expect(soft.options.retry).not.toBe(fatal.options.retry);
  });
});

import { describe, it, expect } from 'vitest';
import {
  getOperatorStatusPillColour,
  formatChainLinkRunning,
  formatChainLinkTerminal,
} from '../_shared';

describe('getOperatorStatusPillColour', () => {
  it('returns green for delegated', () => {
    const c = getOperatorStatusPillColour('delegated');
    expect(c.bg).toBe('bg-green-100');
    expect(c.text).toBe('text-green-700');
  });

  it('returns amber for paused_chain_failure', () => {
    const c = getOperatorStatusPillColour('paused_chain_failure');
    expect(c.bg).toBe('bg-amber-100');
  });

  it('returns amber for paused_budget_exceeded', () => {
    const c = getOperatorStatusPillColour('paused_budget_exceeded');
    expect(c.bg).toBe('bg-amber-100');
  });

  it('returns indigo for completed', () => {
    const c = getOperatorStatusPillColour('completed');
    expect(c.bg).toBe('bg-indigo-100');
    expect(c.text).toBe('text-indigo-700');
  });

  it('returns red for failed', () => {
    const c = getOperatorStatusPillColour('failed');
    expect(c.bg).toBe('bg-red-100');
  });

  it('returns slate for cancelled', () => {
    const c = getOperatorStatusPillColour('cancelled');
    expect(c.bg).toBe('bg-slate-100');
  });

  it('falls back to slate for unknown status', () => {
    const c = getOperatorStatusPillColour('some_future_status');
    expect(c.bg).toBe('bg-slate-100');
  });
});

describe('formatChainLinkRunning', () => {
  it('shows known estimate with tilde', () => {
    expect(formatChainLinkRunning({ chainSeq: 3, estimatedTotalLinks: 12 })).toBe('link 3 of ~12');
  });

  it('shows em-dash when estimate is null', () => {
    expect(formatChainLinkRunning({ chainSeq: 3, estimatedTotalLinks: null })).toBe('link 3 of —');
  });

  it('handles link 1 with known estimate', () => {
    expect(formatChainLinkRunning({ chainSeq: 1, estimatedTotalLinks: 5 })).toBe('link 1 of ~5');
  });
});

describe('formatChainLinkTerminal', () => {
  it('formats hours and minutes correctly', () => {
    expect(
      formatChainLinkTerminal({ totalLinks: 6, totalElapsedMs: 12 * 60 * 60_000 + 4 * 60_000 }),
    ).toBe('6 sessions, 12h 4m total');
  });

  it('uses minutes only when under one hour', () => {
    expect(
      formatChainLinkTerminal({ totalLinks: 1, totalElapsedMs: 45 * 60_000 }),
    ).toBe('1 session, 45m total');
  });

  it('uses singular "session" for a single link', () => {
    const result = formatChainLinkTerminal({ totalLinks: 1, totalElapsedMs: 90 * 60_000 });
    expect(result).toContain('1 session,');
  });

  it('uses plural "sessions" for multiple links', () => {
    const result = formatChainLinkTerminal({ totalLinks: 3, totalElapsedMs: 3 * 60 * 60_000 });
    expect(result).toContain('3 sessions,');
  });
});

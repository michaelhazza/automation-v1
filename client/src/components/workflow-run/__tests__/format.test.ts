import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatDuration } from '../format';

describe('formatDuration', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns sub-second duration as Nms', () => {
    expect(formatDuration('2026-05-15T00:00:00.000Z', '2026-05-15T00:00:00.045Z')).toBe('45ms');
  });

  it('returns sub-minute duration as N.Ns', () => {
    expect(formatDuration('2026-05-15T00:00:00.000Z', '2026-05-15T00:00:02.300Z')).toBe('2.3s');
  });

  it('returns multi-minute duration as Nm Ns', () => {
    expect(formatDuration('2026-05-15T00:00:00.000Z', '2026-05-15T00:01:23.000Z')).toBe('1m 23s');
  });

  it('returns null when startedAt is null', () => {
    expect(formatDuration(null, '2026-05-15T00:00:00.000Z')).toBeNull();
  });

  it('uses Date.now() when completedAt is null (running step)', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-05-15T00:00:02.300Z');
    expect(formatDuration('2026-05-15T00:00:00.000Z', null)).toBe('2.3s');
  });
});

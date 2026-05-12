import { describe, it, expect } from 'vitest';
import { computeRetentionCutoff } from '../sandboxRetentionPure.js';

const NOW = new Date('2026-05-11T10:00:00.000Z');

describe('computeRetentionCutoff', () => {
  describe('90-day window (telemetry + logs)', () => {
    it('returns a date exactly 90 UTC days before now', () => {
      const cutoff = computeRetentionCutoff(NOW, 90);
      const expectedMs = NOW.getTime() - 90 * 24 * 60 * 60 * 1000;
      expect(cutoff.getTime()).toBe(expectedMs);
    });

    it('cutoff is strictly before now', () => {
      const cutoff = computeRetentionCutoff(NOW, 90);
      expect(cutoff.getTime()).toBeLessThan(NOW.getTime());
    });

    it('a row created 91 days ago is eligible for deletion', () => {
      const cutoff = computeRetentionCutoff(NOW, 90);
      const rowTs = new Date(NOW.getTime() - 91 * 24 * 60 * 60 * 1000);
      expect(rowTs.getTime()).toBeLessThan(cutoff.getTime());
    });

    it('a row created exactly at cutoff is NOT deleted (strict less-than boundary)', () => {
      const cutoff = computeRetentionCutoff(NOW, 90);
      // Row timestamp equal to cutoff is NOT < cutoff — kept.
      expect(cutoff.getTime()).not.toBeLessThan(cutoff.getTime());
    });

    it('a row created 89 days ago is NOT eligible for deletion', () => {
      const cutoff = computeRetentionCutoff(NOW, 90);
      const rowTs = new Date(NOW.getTime() - 89 * 24 * 60 * 60 * 1000);
      expect(rowTs.getTime()).toBeGreaterThanOrEqual(cutoff.getTime());
    });
  });

  describe('180-day window (egress audit)', () => {
    it('returns a date exactly 180 UTC days before now', () => {
      const cutoff = computeRetentionCutoff(NOW, 180);
      const expectedMs = NOW.getTime() - 180 * 24 * 60 * 60 * 1000;
      expect(cutoff.getTime()).toBe(expectedMs);
    });

    it('cutoff is 90 days earlier than the 90-day cutoff', () => {
      const cutoff90 = computeRetentionCutoff(NOW, 90);
      const cutoff180 = computeRetentionCutoff(NOW, 180);
      const diffDays = (cutoff90.getTime() - cutoff180.getTime()) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBe(90);
    });

    it('a row created 181 days ago is eligible for deletion', () => {
      const cutoff = computeRetentionCutoff(NOW, 180);
      const rowTs = new Date(NOW.getTime() - 181 * 24 * 60 * 60 * 1000);
      expect(rowTs.getTime()).toBeLessThan(cutoff.getTime());
    });

    it('a row created 179 days ago is NOT eligible for deletion', () => {
      const cutoff = computeRetentionCutoff(NOW, 180);
      const rowTs = new Date(NOW.getTime() - 179 * 24 * 60 * 60 * 1000);
      expect(rowTs.getTime()).toBeGreaterThanOrEqual(cutoff.getTime());
    });
  });

  describe('does not mutate the input date', () => {
    it('now is unchanged after computing the cutoff', () => {
      const nowCopy = new Date(NOW.getTime());
      computeRetentionCutoff(NOW, 90);
      expect(NOW.getTime()).toBe(nowCopy.getTime());
    });
  });

  describe('idempotency: same inputs produce same cutoff', () => {
    it('two calls with the same now + retentionDays return equal timestamps', () => {
      const a = computeRetentionCutoff(NOW, 90);
      const b = computeRetentionCutoff(NOW, 90);
      expect(a.getTime()).toBe(b.getTime());
    });
  });
});

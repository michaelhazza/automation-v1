import { describe, it, expect } from 'vitest';
import {
  encodeCursor, decodeCursor,
  amountMinorToCostUsd, sumCostUsd,
  chargeTypeToContractType,
  type DbChargeType,
} from '../spendLedgerServicePure.js';

describe('spendLedgerServicePure', () => {
  describe('encodeCursor / decodeCursor', () => {
    it('round-trips a cursor payload', () => {
      const payload = { primary: '2026-05-07T12:00:00.000Z', id: 'abc-123' };
      expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
    });

    it('returns null on garbage input', () => {
      expect(decodeCursor('not-base64')).toBeNull();
      expect(decodeCursor('')).toBeNull();
    });
  });

  describe('amountMinorToCostUsd', () => {
    it('converts 12345 cents to 123.45 USD', () => {
      expect(amountMinorToCostUsd(12345)).toBe(123.45);
    });
    it('handles bigint input', () => {
      expect(amountMinorToCostUsd(12345n)).toBe(123.45);
    });
  });

  describe('sumCostUsd', () => {
    it('sums integer cents without float drift', () => {
      // 0.10 + 0.20 in dollars is 0.30000000000000004 via float, but 10+20 cents = 30 = 0.30 exactly
      expect(sumCostUsd([10n, 20n])).toBe(0.3);
      expect(sumCostUsd([10, 20, 30])).toBe(0.6);
    });
  });

  describe('chargeTypeToContractType', () => {
    it('maps all known charge types to other', () => {
      expect(chargeTypeToContractType('purchase')).toBe('other');
      expect(chargeTypeToContractType('subscription')).toBe('other');
      expect(chargeTypeToContractType('top_up')).toBe('other');
      expect(chargeTypeToContractType('invoice_payment')).toBe('other');
      expect(chargeTypeToContractType('refund')).toBe('other');
    });

    it('throws on unknown DB charge type (INVARIANT I2)', () => {
      expect(() => chargeTypeToContractType('chargeback' as DbChargeType)).toThrow(/UnknownEnumValue/);
    });
  });
});

import { expect, test } from 'vitest';
import { formatSpendCardPure } from '../../spend/formatSpendCardPure.js';

test('USD: 100 minor units → $1.00', () => {
  const result = formatSpendCardPure({ amountMinor: 100, currency: 'USD', merchantId: null, merchantDescriptor: 'Acme Corp' });
  expect(result.amountDisplay).toBe('$1.00');
  expect(result.currencyCode).toBe('USD');
});

test('USD: 999 minor units → $9.99', () => {
  const result = formatSpendCardPure({ amountMinor: 999, currency: 'USD', merchantId: null, merchantDescriptor: 'Acme' });
  expect(result.amountDisplay).toBe('$9.99');
});

test('JPY: 100 minor units → ¥100 (0 decimals)', () => {
  const result = formatSpendCardPure({ amountMinor: 100, currency: 'JPY', merchantId: null, merchantDescriptor: 'Tokyo Vendor' });
  expect(result.amountDisplay).toBe('¥100');
  expect(result.currencyCode).toBe('JPY');
});

test('BHD: 1000 minor units → 1.000 BD (3 decimals)', () => {
  const result = formatSpendCardPure({ amountMinor: 1000, currency: 'BHD', merchantId: null, merchantDescriptor: 'Bahrain Merchant' });
  expect(result.amountDisplay).toBe('1.000 BD');
  expect(result.currencyCode).toBe('BHD');
});

test('EUR: 999 minor units → €9.99', () => {
  const result = formatSpendCardPure({ amountMinor: 999, currency: 'EUR', merchantId: null, merchantDescriptor: 'EU Vendor' });
  expect(result.amountDisplay).toBe('€9.99');
  expect(result.currencyCode).toBe('EUR');
});

test('Unknown currency: 100 minor units → "1.00 XYZ" (no crash)', () => {
  const result = formatSpendCardPure({ amountMinor: 100, currency: 'XYZ', merchantId: null, merchantDescriptor: 'Unknown' });
  expect(result.amountDisplay).toBe('1.00 XYZ');
  expect(result.currencyCode).toBe('XYZ');
});

test('merchantDisplay includes id when present', () => {
  const result = formatSpendCardPure({ amountMinor: 100, currency: 'USD', merchantId: 'merch_123', merchantDescriptor: 'Acme' });
  expect(result.merchantDisplay).toBe('Acme (merch_123)');
});

test('merchantDisplay omits id when null', () => {
  const result = formatSpendCardPure({ amountMinor: 100, currency: 'USD', merchantId: null, merchantDescriptor: 'Acme' });
  expect(result.merchantDisplay).toBe('Acme');
});

test('lowercase currency code is normalised', () => {
  const result = formatSpendCardPure({ amountMinor: 100, currency: 'usd', merchantId: null, merchantDescriptor: 'Acme' });
  expect(result.amountDisplay).toBe('$1.00');
  expect(result.currencyCode).toBe('USD');
});

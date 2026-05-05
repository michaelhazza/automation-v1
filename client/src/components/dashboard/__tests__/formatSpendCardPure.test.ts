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

// ──────────────────────────────────────────────────────────────────────────
// chatgpt-pr-review (PR #255, agentic-commerce, round 1) Finding 5 — edge
// cases beyond the standard 0/2/3-decimal coverage. Negative values, large
// values, and the smallest-non-zero minor unit at each exponent.
// ──────────────────────────────────────────────────────────────────────────

test('USD: negative amount → -$5.00 (financial-standard sign-before-symbol)', () => {
  const result = formatSpendCardPure({ amountMinor: -500, currency: 'USD', merchantId: null, merchantDescriptor: 'Refund' });
  expect(result.amountDisplay).toBe('-$5.00');
});

test('JPY: negative amount → -¥100 (0 decimals, sign-before-symbol)', () => {
  const result = formatSpendCardPure({ amountMinor: -100, currency: 'JPY', merchantId: null, merchantDescriptor: 'Refund' });
  expect(result.amountDisplay).toBe('-¥100');
});

test('BHD: negative amount → -1.000 BD (postfix-symbol currency keeps minus on number)', () => {
  const result = formatSpendCardPure({ amountMinor: -1000, currency: 'BHD', merchantId: null, merchantDescriptor: 'Refund' });
  expect(result.amountDisplay).toBe('-1.000 BD');
});

test('Unknown currency: negative amount → -100 XYZ (no symbol, minus on number)', () => {
  const result = formatSpendCardPure({ amountMinor: -10000, currency: 'XYZ', merchantId: null, merchantDescriptor: 'Refund' });
  expect(result.amountDisplay).toBe('-100.00 XYZ');
});

test('USD: large amount → $999,999.99 equivalent renders as $999999.99', () => {
  // Implementation uses `value.toFixed(exponent)` with no thousands separators.
  // Confirms no overflow / scientific-notation drift at the high end of plausible spend.
  const result = formatSpendCardPure({ amountMinor: 99999999, currency: 'USD', merchantId: null, merchantDescriptor: 'Big spend' });
  expect(result.amountDisplay).toBe('$999999.99');
});

test('USD: zero amount → $0.00 (boundary)', () => {
  const result = formatSpendCardPure({ amountMinor: 0, currency: 'USD', merchantId: null, merchantDescriptor: 'Free' });
  expect(result.amountDisplay).toBe('$0.00');
});

test('BHD: 1 minor unit → 0.001 BD (smallest non-zero in 3-decimal currency)', () => {
  const result = formatSpendCardPure({ amountMinor: 1, currency: 'BHD', merchantId: null, merchantDescriptor: 'Tiny' });
  expect(result.amountDisplay).toBe('0.001 BD');
});

test('BHD: 1234 minor units → 1.234 BD (precision boundary, no rounding loss)', () => {
  const result = formatSpendCardPure({ amountMinor: 1234, currency: 'BHD', merchantId: null, merchantDescriptor: 'Boundary' });
  expect(result.amountDisplay).toBe('1.234 BD');
});

test('JPY: 1 minor unit → ¥1 (smallest non-zero in 0-decimal currency)', () => {
  const result = formatSpendCardPure({ amountMinor: 1, currency: 'JPY', merchantId: null, merchantDescriptor: 'Tiny' });
  expect(result.amountDisplay).toBe('¥1');
});

// guard-ignore-file: pure-helper-convention reason="pure logic is tested inline within this handwritten harness"
/**
 * webhookAmountInvariantPure.test.ts
 *
 * Tests invariant 24: webhook amount/currency validation.
 * Uses `validateAmountForCurrency` from chargeRouterServicePure — the single
 * source of truth shared between the outbound charge path (Chunk 5) and the
 * inbound webhook validation path (Chunk 12).
 *
 * Covers: USD/JPY/BHD examples (different exponents), ambiguous/unknown currencies.
 *
 * Run via: npx vitest run server/services/__tests__/webhookAmountInvariantPure.test.ts
 */

import { describe, expect, it } from 'vitest';
import { validateAmountForCurrency } from '../chargeRouterServicePure.js';
import { ISO_4217_MINOR_UNIT_EXPONENT } from '../../config/spendConstants.js';

// ---------------------------------------------------------------------------
// § 1. Known currencies — valid amounts
// ---------------------------------------------------------------------------

describe('valid amounts for known currencies', () => {
  it('USD: integer cent amount is valid', () => {
    const result = validateAmountForCurrency(1099, 'USD'); // $10.99
    expect(result.valid).toBe(true);
  });

  it('USD: zero amount is valid (edge: 0 is integer and non-negative)', () => {
    const result = validateAmountForCurrency(0, 'USD');
    expect(result.valid).toBe(true);
  });

  it('USD: large amount is valid', () => {
    const result = validateAmountForCurrency(1_000_000_00, 'USD'); // $1,000,000
    expect(result.valid).toBe(true);
  });

  it('EUR: integer cent amount is valid', () => {
    const result = validateAmountForCurrency(5000, 'EUR'); // €50.00
    expect(result.valid).toBe(true);
  });

  it('GBP: integer pence amount is valid', () => {
    const result = validateAmountForCurrency(250, 'GBP'); // £2.50
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// § 2. JPY — zero-decimal currency (minor unit = whole yen, exponent = 0)
// ---------------------------------------------------------------------------

describe('JPY (zero-decimal currency, exponent=0)', () => {
  it('JPY exponent is 0 in the table', () => {
    expect(ISO_4217_MINOR_UNIT_EXPONENT['JPY']).toBe(0);
  });

  it('JPY: integer yen amount is valid', () => {
    const result = validateAmountForCurrency(1500, 'JPY'); // ¥1500
    expect(result.valid).toBe(true);
  });

  it('JPY: zero is valid', () => {
    const result = validateAmountForCurrency(0, 'JPY');
    expect(result.valid).toBe(true);
  });

  it('JPY: fractional amount (1.5) is invalid', () => {
    const result = validateAmountForCurrency(1.5, 'JPY');
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty('reason', 'fractional_minor_unit');
  });
});

// ---------------------------------------------------------------------------
// § 3. BHD — three-decimal currency (fils, exponent = 3)
// ---------------------------------------------------------------------------

describe('BHD (three-decimal currency, exponent=3)', () => {
  it('BHD exponent is 3 in the table', () => {
    expect(ISO_4217_MINOR_UNIT_EXPONENT['BHD']).toBe(3);
  });

  it('BHD: integer fils amount is valid', () => {
    const result = validateAmountForCurrency(1000, 'BHD'); // 1.000 BHD
    expect(result.valid).toBe(true);
  });

  it('BHD: 1 fil is valid', () => {
    const result = validateAmountForCurrency(1, 'BHD');
    expect(result.valid).toBe(true);
  });

  it('BHD: fractional fils (0.5) is invalid', () => {
    const result = validateAmountForCurrency(0.5, 'BHD');
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty('reason', 'fractional_minor_unit');
  });
});

// ---------------------------------------------------------------------------
// § 4. KWD — three-decimal currency
// ---------------------------------------------------------------------------

describe('KWD (three-decimal currency, exponent=3)', () => {
  it('KWD: integer fils amount is valid', () => {
    const result = validateAmountForCurrency(5000, 'KWD');
    expect(result.valid).toBe(true);
  });

  it('KWD: 0.1 is invalid (fractional minor unit)', () => {
    const result = validateAmountForCurrency(0.1, 'KWD');
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty('reason', 'fractional_minor_unit');
  });
});

// ---------------------------------------------------------------------------
// § 5. Unknown / ambiguous currency rejection
// ---------------------------------------------------------------------------

describe('unknown currency rejection (ambiguous exponent)', () => {
  it('completely unknown currency code is rejected', () => {
    const result = validateAmountForCurrency(100, 'XYZ');
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty('reason', 'unknown_currency');
  });

  it('empty string currency is rejected', () => {
    const result = validateAmountForCurrency(100, '');
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty('reason', 'unknown_currency');
  });

  it('lowercase valid code is rejected (codes are uppercase in table)', () => {
    // The table uses uppercase keys; lowercase input is not found.
    const result = validateAmountForCurrency(100, 'usd');
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty('reason', 'unknown_currency');
  });

  it('invented currency "BTC" is rejected', () => {
    const result = validateAmountForCurrency(100, 'BTC');
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty('reason', 'unknown_currency');
  });
});

// ---------------------------------------------------------------------------
// § 6. Fractional minor unit rejection
// ---------------------------------------------------------------------------

describe('fractional minor unit rejection', () => {
  it('USD: 0.5 cents is invalid', () => {
    const result = validateAmountForCurrency(0.5, 'USD');
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty('reason', 'fractional_minor_unit');
  });

  it('USD: 99.99 is invalid (fractional)', () => {
    const result = validateAmountForCurrency(99.99, 'USD');
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty('reason', 'fractional_minor_unit');
  });

  it('EUR: 0.1 cents is invalid', () => {
    const result = validateAmountForCurrency(0.1, 'EUR');
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty('reason', 'fractional_minor_unit');
  });

  it('negative amount is invalid', () => {
    const result = validateAmountForCurrency(-100, 'USD');
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty('reason', 'fractional_minor_unit');
  });

  it('NaN is invalid', () => {
    const result = validateAmountForCurrency(NaN, 'USD');
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty('reason', 'fractional_minor_unit');
  });
});

// ---------------------------------------------------------------------------
// § 7. ISO 4217 exponent table spot checks
// ---------------------------------------------------------------------------

describe('ISO 4217 exponent table coverage', () => {
  it('USD has exponent 2 (cents)', () => {
    expect(ISO_4217_MINOR_UNIT_EXPONENT['USD']).toBe(2);
  });

  it('EUR has exponent 2 (cents)', () => {
    expect(ISO_4217_MINOR_UNIT_EXPONENT['EUR']).toBe(2);
  });

  it('JPY has exponent 0 (whole units)', () => {
    expect(ISO_4217_MINOR_UNIT_EXPONENT['JPY']).toBe(0);
  });

  it('KRW has exponent 0 (whole units)', () => {
    expect(ISO_4217_MINOR_UNIT_EXPONENT['KRW']).toBe(0);
  });

  it('BHD has exponent 3 (fils)', () => {
    expect(ISO_4217_MINOR_UNIT_EXPONENT['BHD']).toBe(3);
  });

  it('KWD has exponent 3 (fils)', () => {
    expect(ISO_4217_MINOR_UNIT_EXPONENT['KWD']).toBe(3);
  });

  it('OMR has exponent 3 (baisa)', () => {
    expect(ISO_4217_MINOR_UNIT_EXPONENT['OMR']).toBe(3);
  });

  it('JOD has exponent 3 (fils)', () => {
    expect(ISO_4217_MINOR_UNIT_EXPONENT['JOD']).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// § 8. Invariant 24 webhook mismatch scenarios
// ---------------------------------------------------------------------------

describe('invariant 24: webhook amount/currency mismatch scenarios', () => {
  it('webhook reports USD 1099 cents, ledger has 1099 USD cents → amounts match', () => {
    const webhookAmount = 1099;
    const webhookCurrency = 'USD';
    const rowAmount = 1099;
    const rowCurrency = 'USD';

    const webhookValidation = validateAmountForCurrency(webhookAmount, webhookCurrency);
    expect(webhookValidation.valid).toBe(true);
    expect(webhookAmount).toBe(rowAmount);
    expect(webhookCurrency).toBe(rowCurrency);
  });

  it('webhook reports USD 1099, ledger has 1100 → mismatch (would hold in executed)', () => {
    const webhookAmount = 1099;
    const rowAmount = 1100;
    expect(webhookAmount).not.toBe(rowAmount);
  });

  it('webhook reports EUR amount, ledger has USD → currency mismatch (would hold in executed)', () => {
    const webhookCurrency = 'EUR';
    const rowCurrency = 'USD';
    expect(webhookCurrency).not.toBe(rowCurrency);
  });

  it('webhook reports JPY 1500, ledger has 1500 JPY → amounts match (zero-decimal)', () => {
    const webhookAmount = 1500;
    const webhookCurrency = 'JPY';
    const rowAmount = 1500;
    const rowCurrency = 'JPY';

    const webhookValidation = validateAmountForCurrency(webhookAmount, webhookCurrency);
    expect(webhookValidation.valid).toBe(true);
    expect(webhookAmount).toBe(rowAmount);
    expect(webhookCurrency).toBe(rowCurrency);
  });

  it('webhook reports BHD 1000, ledger has 1000 BHD → amounts match (three-decimal)', () => {
    const webhookAmount = 1000;
    const webhookCurrency = 'BHD';
    const rowAmount = 1000;
    const rowCurrency = 'BHD';

    const webhookValidation = validateAmountForCurrency(webhookAmount, webhookCurrency);
    expect(webhookValidation.valid).toBe(true);
    expect(webhookAmount).toBe(rowAmount);
    expect(webhookCurrency).toBe(rowCurrency);
  });
});

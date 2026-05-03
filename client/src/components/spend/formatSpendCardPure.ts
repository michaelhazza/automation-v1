// Pure helper — no React, no DOM, no network. Converts raw spend-action
// fields into display strings for the ReviewQueuePage spend renderer.
// Unit-tested in dashboard/__tests__/formatSpendCardPure.test.ts.
//
// ISO 4217 minor-unit exponents used here:
//   0 decimals: JPY, KRW, VND, BIF, CLP, GNF, ISK, MGA, PYG, RWF, UGX, XAF, XOF, XPF
//   3 decimals: BHD, IQD, JOD, KWD, LYD, OMR, TND
//   All others: 2 decimals (standard)

const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'GNF', 'ISK', 'JPY', 'KRW', 'MGA', 'PYG',
  'RWF', 'UGX', 'VND', 'XAF', 'XOF', 'XPF',
]);

const THREE_DECIMAL_CURRENCIES = new Set([
  'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND',
]);

// Currency symbols for common ISO 4217 codes.
const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CAD: 'CA$', AUD: 'A$',
  CHF: 'CHF', CNY: '¥', HKD: 'HK$', SGD: 'S$', NZD: 'NZ$',
  SEK: 'kr', NOK: 'kr', DKK: 'kr', MXN: 'MX$', BRL: 'R$',
  INR: '₹', KRW: '₩', ZAR: 'R', TRY: '₺', THB: '฿',
  IDR: 'Rp', MYR: 'RM', PHP: '₱', VND: '₫', EGP: 'EGP',
  BHD: 'BD', KWD: 'KD', OMR: 'OMR', JOD: 'JD',
};

export interface FormatSpendCardInput {
  amountMinor: number;
  currency: string;
  merchantId: string | null;
  merchantDescriptor: string;
}

export interface FormatSpendCardResult {
  amountDisplay: string;
  merchantDisplay: string;
  currencyCode: string;
}

function getExponent(currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.has(currency)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(currency)) return 3;
  return 2;
}

/**
 * Format a spend card's display fields from raw minor-unit integers.
 *
 * Returns deterministic strings regardless of locale so unit tests
 * produce consistent results across environments.
 *
 * Negative-sign placement follows financial-display convention:
 *   - Prefix-symbol currencies: `-$5.00` (minus before the symbol)
 *   - Postfix-symbol currencies: `-1.000 BD` (minus on the number)
 *   - Unknown currencies:        `-100 XYZ`
 */
export function formatSpendCardPure(input: FormatSpendCardInput): FormatSpendCardResult {
  const { amountMinor, currency, merchantId, merchantDescriptor } = input;
  const code = currency.toUpperCase();
  const exponent = getExponent(code);
  const divisor = Math.pow(10, exponent);
  const isNegative = amountMinor < 0;
  const absValue = Math.abs(amountMinor) / divisor;
  const sign = isNegative ? '-' : '';

  let amountDisplay: string;
  const sym = CURRENCY_SYMBOL[code];
  const formattedAbs = absValue.toFixed(exponent);

  if (sym) {
    // Symbols that are not standard prefix ($, €, etc.) go after:
    // BHD → "1.000 BD", KWD → "1.000 KD"
    const postfixSymbols = new Set(['BD', 'KD', 'OMR', 'JD']);
    if (postfixSymbols.has(sym)) {
      amountDisplay = `${sign}${formattedAbs} ${sym}`;
    } else {
      // Standard financial format: minus precedes the currency symbol.
      amountDisplay = `${sign}${sym}${formattedAbs}`;
    }
  } else {
    // Unknown currency: render as "100 XYZ" rather than crashing
    amountDisplay = `${sign}${formattedAbs} ${code}`;
  }

  const merchantDisplay = merchantId
    ? `${merchantDescriptor} (${merchantId})`
    : merchantDescriptor;

  return { amountDisplay, merchantDisplay, currencyCode: code };
}

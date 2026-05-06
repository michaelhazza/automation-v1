// ---------------------------------------------------------------------------
// Client-side money formatting — consistent UX across calendar, trace, and
// playbook surfaces. Values are in **whole dollars** (fractional), not cents.
// The naming `cents` that existed in older callers was a misnomer; prefer
// `dollars` going forward.
//
// Default: 2 decimal places, matching standard invoice presentation. The
// `micro` opt-in flag renders sub-cent values at 4dp so a < $0.01 cost is
// not shown as "$0.00".
//
// ISO 4217 exponent map (used when `currency` opt is supplied):
//   0 dp: JPY, KRW and other zero-decimal currencies
//   3 dp: BHD, KWD, OMR and other three-decimal currencies
//   2 dp: all others (USD, EUR, GBP, etc.)
// ---------------------------------------------------------------------------

// ISO 4217 zero-decimal currencies
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'GNF', 'ISK', 'JPY', 'KRW', 'MGA', 'PYG',
  'RWF', 'UGX', 'VND', 'XAF', 'XOF', 'XPF',
]);

// ISO 4217 three-decimal currencies
const THREE_DECIMAL_CURRENCIES = new Set([
  'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND',
]);

export function isoExponent(currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

export interface FormatMoneyOpts {
  /** When true, render sub-cent values with 4dp precision. */
  micro?: boolean;
  /** Override currency symbol. Default `$`. */
  symbol?: string;
  /**
   * ISO 4217 currency code (e.g. "USD", "JPY", "BHD").
   * When provided, decimal places are determined by the ISO 4217 exponent
   * map rather than the default 2dp. Takes precedence over `micro`.
   */
  currency?: string;
}

export function formatMoney(dollars: number | null | undefined, opts: FormatMoneyOpts = {}): string {
  if (dollars === null || dollars === undefined) return '—';
  const sym = opts.symbol ?? '$';

  if (opts.currency) {
    const dp = isoExponent(opts.currency);
    if (dollars === 0) return `${sym}${'0'.padEnd(dp > 0 ? dp + 2 : 1, '0').slice(0, dp > 0 ? dp + 2 : 1)}`;
    const abs = Math.abs(dollars);
    return `${dollars < 0 ? '-' : ''}${sym}${abs.toFixed(dp)}`;
  }

  if (dollars === 0) return `${sym}0.00`;
  const abs = Math.abs(dollars);
  if (opts.micro && abs < 0.01) {
    return `${dollars < 0 ? '-' : ''}${sym}${abs.toFixed(4)}`;
  }
  return `${dollars < 0 ? '-' : ''}${sym}${abs.toFixed(2)}`;
}

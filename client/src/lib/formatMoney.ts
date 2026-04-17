// ---------------------------------------------------------------------------
// Client-side money formatting — consistent UX across calendar, trace, and
// playbook surfaces. Values are in **whole dollars** (fractional), not cents.
// The naming `cents` that existed in older callers was a misnomer; prefer
// `dollars` going forward.
//
// Default: 2 decimal places, matching standard invoice presentation. The
// `micro` opt-in flag renders sub-cent values at 4dp so a < $0.01 cost is
// not shown as "$0.00".
// ---------------------------------------------------------------------------

export interface FormatMoneyOpts {
  /** When true, render sub-cent values with 4dp precision. */
  micro?: boolean;
  /** Override currency symbol. Default `$`. */
  symbol?: string;
}

export function formatMoney(dollars: number | null | undefined, opts: FormatMoneyOpts = {}): string {
  if (dollars === null || dollars === undefined) return '—';
  const sym = opts.symbol ?? '$';
  if (dollars === 0) return `${sym}0.00`;
  const abs = Math.abs(dollars);
  if (opts.micro && abs < 0.01) {
    return `${dollars < 0 ? '-' : ''}${sym}${abs.toFixed(4)}`;
  }
  return `${dollars < 0 ? '-' : ''}${sym}${abs.toFixed(2)}`;
}

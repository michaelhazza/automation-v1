/**
 * spendLedgerServicePure — pure helpers for the Ledger list endpoint.
 * Spec: §4.0, §4.2, §6.
 */

export type LedgerSortKey = 'timestamp' | 'workspace' | 'agent' | 'type' | 'tokens' | 'cost';
export type SortDir = 'asc' | 'desc';

export interface CursorPayload {
  primary: string;
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(input: string): CursorPayload | null {
  try {
    const json = Buffer.from(input, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === 'object' && parsed !== null &&
      'primary' in parsed && 'id' in parsed &&
      typeof (parsed as CursorPayload).primary === 'string' &&
      typeof (parsed as CursorPayload).id === 'string'
    ) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Project amount_minor (cents) to dollars.
 * Spec §6 Gap 2: reality uses cents (not microcents). Divide by 100.
 */
export function amountMinorToCostUsd(amountMinor: bigint | number): number {
  const n = typeof amountMinor === 'bigint' ? Number(amountMinor) : amountMinor;
  return n / 100;
}

/**
 * Sum integer-cent amounts and return USD. Sums in integer cents to avoid float drift.
 */
export function sumCostUsd(amountsMinor: ReadonlyArray<bigint | number>): number {
  let sum = 0n;
  for (const a of amountsMinor) {
    sum += typeof a === 'bigint' ? a : BigInt(Math.round(a));
  }
  return Number(sum) / 100;
}

export type DbChargeType =
  'purchase' | 'subscription' | 'top_up' | 'invoice_payment' | 'refund';

/**
 * Map agent_charges.charge_type to contract LedgerRow.type.
 * INVARIANT I2: throws on unknown DB values (fail closed, no silent widening).
 * Current values all map to 'other' (placeholder mapping — see plan §3 Gap R3).
 */
export function chargeTypeToContractType(
  db: DbChargeType,
): 'llm' | 'embedding' | 'tool_call' | 'storage' | 'other' {
  switch (db) {
    case 'purchase':
    case 'subscription':
    case 'top_up':
    case 'invoice_payment':
    case 'refund':
      return 'other';
    default: {
      const _exhaustive: never = db;
      throw new Error(`UnknownEnumValue: agent_charges.charge_type=${_exhaustive as string}`);
    }
  }
}

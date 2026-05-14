/**
 * subaccountMultipleRootsPure.ts — Pure helper for the subaccountMultipleRoots detector.
 *
 * No database access. Takes pre-fetched (subaccountId, count) pairs and returns
 * only those where count > 1.
 */

export interface SubaccountRootCountRow {
  subaccountId: string;
  count: number;
}

/**
 * Filter rows to those where count > 1 (multiple active root agents).
 */
export function findSubaccountsWithMultipleRoots(
  rows: SubaccountRootCountRow[],
): SubaccountRootCountRow[] {
  return rows.filter((r) => r.count > 1);
}

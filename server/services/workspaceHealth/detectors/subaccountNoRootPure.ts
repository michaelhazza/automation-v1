/**
 * subaccountNoRootPure.ts — Pure helper for the subaccountNoRoot detector.
 *
 * No database access. Takes the full set of subaccount IDs for the org and
 * the subset that have at least one active root agent, and returns the IDs
 * that are missing a root.
 */

/**
 * Returns subaccount IDs present in `allSubaccountIds` but absent from
 * `subaccountsWithRoot`.
 */
export function findSubaccountsWithNoRoot(
  allSubaccountIds: string[],
  subaccountsWithRoot: string[],
): string[] {
  const rootSet = new Set(subaccountsWithRoot);
  return allSubaccountIds.filter((id) => !rootSet.has(id));
}

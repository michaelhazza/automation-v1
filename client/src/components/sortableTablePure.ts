/**
 * sortableTablePure — pure helpers for SortableTable.
 *
 * All functions here are side-effect-free and fully testable in isolation.
 * The SortableTable component imports from here; test coverage lives in
 * __tests__/sortableTablePure.test.ts.
 *
 * Run tests via:
 *   npx tsx client/src/components/__tests__/sortableTablePure.test.ts
 */

// ---------------------------------------------------------------------------
// Types (re-exported so consumers import from one place)
// ---------------------------------------------------------------------------

export interface ColumnDef<Row> {
  key: string;
  label: string;
  sortable?: boolean;
  filterable?: boolean;
  width?: string;
  align?: 'left' | 'right' | 'center';
  getValue?: (row: Row) => string | number | null;
  render?: (row: Row) => unknown; // React.ReactNode — typed as unknown to keep this file React-free
  getFilterOptions?: (rows: Row[]) => Array<{ value: string; label: string }>;
}

// ---------------------------------------------------------------------------
// compareForSort
// ---------------------------------------------------------------------------

/**
 * Compare two values for sort ordering.
 *
 * Hint semantics:
 *   'number'  — Number(a) - Number(b); NaN falls back to localeCompare(String(a), String(b)).
 *   'string'  — localeCompare with sensitivity:'base'.
 *   'mixed'   — String(a) vs String(b), then localeCompare.
 *
 * null / undefined handling: callers in applySortAndFilters handle null/undefined BEFORE
 * calling compareForSort, so this function should never receive them in practice. If it
 * does receive them, it treats them as the string 'null'/'undefined' — callers bear
 * responsibility for the null-to-bottom invariant.
 */
export function compareForSort(
  a: unknown,
  b: unknown,
  hint: 'string' | 'number' | 'mixed',
): number {
  if (hint === 'number') {
    const na = Number(a);
    const nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) {
      return na - nb;
    }
    // NaN guard: fall through to localeCompare
    return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
  }

  if (hint === 'string') {
    return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
  }

  // 'mixed'
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
}

// ---------------------------------------------------------------------------
// deriveFilterKey
// ---------------------------------------------------------------------------

/**
 * Derive the string key used for filter identity matching.
 *
 * null and undefined produce a sentinel so they can be included/excluded
 * as an explicit filter option rather than being silently dropped.
 *
 * The sentinel format `__NULL__::<columnKey>` is column-scoped so that two
 * filterable columns that both have null rows produce distinct filter entries.
 */
export function deriveFilterKey(value: unknown, columnKey: string): string {
  if (value === null || value === undefined) {
    return `__NULL__::${columnKey}`;
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// applySortAndFilters
// ---------------------------------------------------------------------------

/**
 * Apply active sort and filter state to a row array.
 *
 * INVARIANT: relies on V8 stable sort (Node >= 12 / modern browsers). Any future
 * change to the sort implementation MUST preserve sort stability — equal-key rows
 * MUST retain insertion order across sort flips. Verified by sortableTablePure.test.ts.
 *
 * Steps:
 *   1. Filter: a row passes a column's filter iff the Set is empty (no filter
 *      active) OR contains deriveFilterKey(getValue(row), columnKey).
 *   2. Stable sort: Array.prototype.sort (stable on V8 since 7.0).
 *      Direction is applied by negating the comparator for 'desc'.
 *      null/undefined are placed at the bottom regardless of direction —
 *      they bypass direction negation so desc does not move them to the top.
 *   3. Returns a new array; input is not mutated.
 */
export function applySortAndFilters<Row>(
  rows: Row[],
  sort: { key: string; dir: 'asc' | 'desc' } | null,
  filters: Record<string, Set<string>>,
  columns: ColumnDef<Row>[],
): Row[] {
  // Step 1 — filter
  let result = rows;

  const activeFilters = Object.entries(filters).filter(([, set]) => set.size > 0);
  if (activeFilters.length > 0) {
    result = result.filter((row) => {
      return activeFilters.every(([colKey, set]) => {
        const col = columns.find((c) => c.key === colKey);
        const rawValue = col?.getValue ? col.getValue(row) : undefined;
        const fk = deriveFilterKey(rawValue, colKey);
        return set.has(fk);
      });
    });
  }

  // Step 2 — sort
  if (sort !== null) {
    const col = columns.find((c) => c.key === sort.key);
    if (col) {
      const dir = sort.dir;

      // Derive a type hint from the first non-null value in the column
      let hint: 'string' | 'number' | 'mixed' = 'mixed';
      if (col.getValue) {
        for (const row of rows) {
          const v = col.getValue(row);
          if (v !== null && v !== undefined) {
            hint = typeof v === 'number' ? 'number' : 'string';
            break;
          }
        }
      }

      result = [...result].sort((a, b) => {
        const aVal = col.getValue ? col.getValue(a) : undefined;
        const bVal = col.getValue ? col.getValue(b) : undefined;

        // Null-to-bottom: bypass direction negation so nulls stay at bottom in
        // both asc and desc. This is the only correct pattern — if we returned
        // a large positive and then negated for desc, nulls would move to the top.
        const aIsNull = aVal === null || aVal === undefined;
        const bIsNull = bVal === null || bVal === undefined;
        if (aIsNull && bIsNull) return 0;
        if (aIsNull) return 1;  // null always to bottom
        if (bIsNull) return -1; // null always to bottom

        const raw = compareForSort(aVal, bVal, hint);
        return dir === 'desc' ? -raw : raw;
      });
    }
    // If sort.key doesn't match any column: silently ignore (no sort applied, no throw).
  }

  return result;
}

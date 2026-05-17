/**
 * SortableTable — generic sortable + filterable table primitive.
 *
 * The only generic sortable + filterable table in the codebase. Consumers
 * must not duplicate sort/filter logic — use this component or extract shared
 * logic from sortableTablePure.ts instead.
 *
 * Spec: §4.3 (SortableTable contract + sort comparator semantics + filter-value
 * identity + persistKey namespacing + stability contract).
 *
 * Pure logic (comparator, filter, sort): sortableTablePure.ts.
 * Tests: __tests__/sortableTablePure.test.ts.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import { applySortAndFilters, deriveFilterKey, type ColumnDef } from './sortableTablePure';

// ---------------------------------------------------------------------------
// Re-export the ColumnDef so consumers import from one place
// ---------------------------------------------------------------------------

export type { ColumnDef };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SortableTableProps<Row> {
  rows: Row[];
  columns: ColumnDef<Row>[];
  rowKey: (row: Row) => string;
  /**
   * Initial sort state. Silently ignored if the key does not match any column.
   * When `persistKey` is set and persisted state exists, persisted state takes
   * precedence over `initialSort`.
   */
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  /** Rendered when the filtered row list is empty. */
  emptyState?: ReactNode;
  onRowClick?: (row: Row) => void;
  /**
   * Unique identifier for localStorage persistence of sort and filter state.
   *
   * INVARIANT: must be globally unique per table usage. Two distinct tables that
   * share the same `persistKey` will silently corrupt each other's state. The
   * recommended pattern is `<page>-<table-purpose>`, e.g. 'spending-ledger',
   * 'agents-list', 'subaccount-tasks'.
   *
   * The component owns the `table:v1:` prefix; callers pass the unprefixed
   * identifier. localStorage key format: `table:v1:<persistKey>`.
   */
  persistKey?: string;
  /**
   * When true (default), renders a "Clear filters" button above the table
   * whenever any column filter is active. Clicking resets all filters without
   * touching sort state. Set to false to suppress the control entirely.
   */
  showClearFilters?: boolean;
}

// ---------------------------------------------------------------------------
// Persisted shape
// ---------------------------------------------------------------------------

interface PersistedState {
  sort: { key: string; dir: 'asc' | 'desc' } | null;
  filters: Record<string, string[]>;
}

function storageKey(persistKey: string): string {
  return `table:v1:${persistKey}`;
}

function readPersistedState(persistKey: string): PersistedState | null {
  try {
    const raw = localStorage.getItem(storageKey(persistKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as PersistedState;
  } catch {
    // JSON.parse failure or localStorage unavailable — treat as absent, don't throw.
    return null;
  }
}

function writePersistedState(persistKey: string, state: PersistedState): void {
  try {
    localStorage.setItem(storageKey(persistKey), JSON.stringify(state));
  } catch {
    // localStorage unavailable (private mode, storage quota, etc.) — silently ignore.
  }
}

// ---------------------------------------------------------------------------
// Filter dropdown
// ---------------------------------------------------------------------------

interface FilterDropdownProps {
  columnKey: string;
  options: Array<{ value: string; label: string }>;
  active: Set<string>;
  onApply: (selected: Set<string>) => void;
  isFiltered: boolean;
}

function FilterDropdown({ columnKey, options, active, onApply, isFiltered }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  // Snapshot of state when dropdown opens — used by Cancel to restore.
  const [pending, setPending] = useState<Set<string>>(new Set(active));
  const snapshotRef = useRef<Set<string>>(new Set(active));
  const containerRef = useRef<HTMLDivElement>(null);

  const handleOpen = useCallback(() => {
    const snap = new Set(active);
    snapshotRef.current = snap;
    setPending(new Set(active));
    setOpen(true);
  }, [active]);

  const handleApply = useCallback(() => {
    // Normalise "all selected" to an empty Set — the canonical no-filter
    // representation. Storing every current option as the filter would (a)
    // silently exclude any new value that appears later, (b) cause the caret
    // (size < options.length) and the Clear-filters button (size > 0) to
    // disagree about whether a filter is active, and (c) re-apply the same
    // exclusion after a persisted-state reload against changed rows.
    const allSelected =
      options.length > 0 &&
      pending.size === options.length &&
      options.every((o) => pending.has(o.value));
    onApply(allSelected ? new Set<string>() : new Set(pending));
    setOpen(false);
  }, [onApply, pending, options]);

  const handleCancel = useCallback(() => {
    setPending(new Set(snapshotRef.current));
    setOpen(false);
  }, []);

  // Esc closes without applying
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, handleCancel]);

  // Outside-click closes without applying
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleCancel();
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, handleCancel]);

  const allChecked = options.length > 0 && options.every((o) => pending.has(o.value));
  const anyUnchecked = options.some((o) => !pending.has(o.value));

  const handleSelectAll = () => {
    if (anyUnchecked) {
      // Any unchecked → check all
      setPending(new Set(options.map((o) => o.value)));
    } else {
      // All checked → uncheck all
      setPending(new Set());
    }
  };

  const handleToggle = (value: string) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  // Caret button colour: filtered → indigo-500, hover → slate-700, default → slate-400
  const caretClass = isFiltered
    ? 'text-indigo-500'
    : 'text-slate-400 hover:text-slate-700';

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        className={`sf-caret-btn ml-1 inline-flex items-center focus:outline-none ${caretClass}`}
        aria-label="Filter"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={open ? handleCancel : handleOpen}
      >
        {/* Material-style funnel SVG per spec §4.3 */}
        <svg
          viewBox="0 0 16 16"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 3h12l-4.5 6v4l-3 1.5V9z" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-52 rounded border border-slate-200 bg-white shadow-lg"
          role="dialog"
          aria-label={`Filter by ${columnKey}`}
        >
          <div className="p-2 border-b border-slate-100">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = !allChecked && options.some((o) => pending.has(o.value));
                }}
                onChange={handleSelectAll}
                className="rounded"
              />
              Select all
            </label>
          </div>

          <div className="max-h-48 overflow-y-auto p-1">
            {options.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 cursor-pointer px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 rounded"
              >
                <input
                  type="checkbox"
                  checked={pending.has(opt.value)}
                  onChange={() => handleToggle(opt.value)}
                  className="rounded"
                />
                {opt.label}
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-2 p-2 border-t border-slate-100">
            <button
              type="button"
              className="px-3 py-1 text-xs text-slate-600 hover:text-slate-900 rounded"
              onClick={handleCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-3 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
              onClick={handleApply}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SortIndicator
// ---------------------------------------------------------------------------

interface SortIndicatorProps {
  colKey: string;
  sort: { key: string; dir: 'asc' | 'desc' } | null;
}

function SortIndicator({ colKey, sort }: SortIndicatorProps) {
  if (sort?.key !== colKey) {
    return <span className="ml-1 text-slate-300 text-xs">⇅</span>;
  }
  return (
    <span className="ml-1 text-slate-600 text-xs">
      {sort.dir === 'asc' ? '↑' : '↓'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// SortableTable
// ---------------------------------------------------------------------------

export function SortableTable<Row>({
  rows,
  columns,
  rowKey,
  initialSort,
  emptyState,
  onRowClick,
  persistKey,
  showClearFilters = true,
}: SortableTableProps<Row>): React.ReactElement {
  // -- State initialisation --
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(() => {
    if (persistKey) {
      const persisted = readPersistedState(persistKey);
      if (persisted?.sort !== undefined) return persisted.sort;
    }
    return initialSort ?? null;
  });

  const [filters, setFilters] = useState<Record<string, Set<string>>>(() => {
    if (persistKey) {
      const persisted = readPersistedState(persistKey);
      if (persisted?.filters) {
        const result: Record<string, Set<string>> = {};
        for (const [k, v] of Object.entries(persisted.filters)) {
          result[k] = new Set(v);
        }
        return result;
      }
    }
    return {};
  });

  // -- Persistence --
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep a ref to the latest sort/filters so the unmount flush reads current state,
  // not stale closure values from mount time.
  const pendingFlushRef = useRef<{ sort: typeof sort; filters: typeof filters }>({ sort, filters });
  pendingFlushRef.current = { sort, filters };

  const schedulePersist = useCallback(
    (nextSort: typeof sort, nextFilters: typeof filters) => {
      if (!persistKey) return;
      if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        const serialised: PersistedState = {
          sort: nextSort,
          filters: Object.fromEntries(
            Object.entries(nextFilters).map(([k, s]) => [k, Array.from(s)]),
          ),
        };
        writePersistedState(persistKey, serialised);
        persistTimerRef.current = null;
      }, 200);
    },
    [persistKey],
  );

  // Flush on unmount — reads from ref to avoid stale closure over sort/filters.
  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        clearTimeout(persistTimerRef.current);
        if (persistKey) {
          const { sort: latestSort, filters: latestFilters } = pendingFlushRef.current;
          const serialised: PersistedState = {
            sort: latestSort,
            filters: Object.fromEntries(
              Object.entries(latestFilters).map(([k, s]) => [k, Array.from(s)]),
            ),
          };
          writePersistedState(persistKey, serialised);
        }
      }
    };
  }, [persistKey]);

  // -- Sort handler --
  const handleSortClick = (colKey: string) => {
    setSort((prev) => {
      const next =
        prev?.key === colKey
          ? { key: colKey, dir: prev.dir === 'asc' ? ('desc' as const) : ('asc' as const) }
          : { key: colKey, dir: 'asc' as const };
      schedulePersist(next, filters);
      return next;
    });
  };

  // -- Filter handler --
  const handleFilterApply = (colKey: string, selected: Set<string>) => {
    setFilters((prev) => {
      const next = { ...prev, [colKey]: selected };
      schedulePersist(sort, next);
      return next;
    });
  };

  // -- Clear all filters handler --
  const handleClearAllFilters = useCallback(() => {
    setFilters((prev) => {
      const next: Record<string, Set<string>> = {};
      for (const k of Object.keys(prev)) {
        next[k] = new Set<string>();
      }
      schedulePersist(sort, next);
      return next;
    });
  }, [sort, schedulePersist]);

  // -- Derive active filter columns (non-empty Sets) --
  const activeFilterColumns = Object.entries(filters)
    .filter(([, s]) => s.size > 0)
    .map(([k]) => k);

  // -- Derive displayed rows --
  const displayedRows = applySortAndFilters(rows, sort, filters, columns);

  // Track which column indices are filtered so we can place AND tags between them
  const filteredColIndexSet = new Set(activeFilterColumns);

  return (
    <>
      {showClearFilters && activeFilterColumns.length > 0 && (
        <div className="flex items-center justify-end mb-1">
          <button
            type="button"
            className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none"
            onClick={handleClearAllFilters}
          >
            Clear filters
          </button>
        </div>
      )}
      <div className="w-full overflow-x-auto">
        <table className="w-full text-sm text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200">
              {columns.map((col, colIdx) => {
                // Compute filter options for filterable columns
                const filterOptions =
                  col.filterable && col.getValue
                    ? col.getFilterOptions
                      ? col.getFilterOptions(rows)
                      : Array.from(
                          new Map(
                            rows.map((r) => {
                              const raw = col.getValue!(r);
                              const fk = deriveFilterKey(raw, col.key);
                              const label = raw === null || raw === undefined ? '(empty)' : String(raw);
                              return [fk, { value: fk, label }] as const;
                            }),
                          ).values(),
                        ).sort((a, b) => a.label.localeCompare(b.label))
                    : [];

                const activeFilter = filters[col.key] ?? new Set<string>();
                const isFiltered = activeFilter.size > 0 && activeFilter.size < filterOptions.length;

                // AND tag: show after a filtered column when another filtered column follows
                const isThisColFiltered = filteredColIndexSet.has(col.key);
                const hasNextFilteredCol =
                  activeFilterColumns.length > 1 &&
                  isThisColFiltered &&
                  columns
                    .slice(colIdx + 1)
                    .some((c) => filteredColIndexSet.has(c.key));

                return (
                  <th
                    key={col.key}
                    className={`px-3 py-2 font-medium text-slate-600 whitespace-nowrap ${
                      col.align === 'right'
                        ? 'text-right'
                        : col.align === 'center'
                          ? 'text-center'
                          : 'text-left'
                    }`}
                    style={col.width ? { width: col.width } : undefined}
                  >
                    <div className="inline-flex items-center gap-0.5">
                      {col.sortable ? (
                        <button
                          type="button"
                          className="inline-flex items-center hover:text-slate-900 focus:outline-none"
                          onClick={() => handleSortClick(col.key)}
                        >
                          {col.label}
                          <SortIndicator colKey={col.key} sort={sort} />
                        </button>
                      ) : (
                        <span>{col.label}</span>
                      )}

                      {col.filterable && filterOptions.length > 0 && (
                        <FilterDropdown
                          columnKey={col.key}
                          options={filterOptions}
                          active={activeFilter}
                          onApply={(selected) => handleFilterApply(col.key, selected)}
                          isFiltered={isFiltered}
                        />
                      )}

                      {hasNextFilteredCol && (
                        <span className="text-xs text-slate-400 mx-1">AND</span>
                      )}
                    </div>
                  </th>
                );
              })}
          </tr>
        </thead>
        <tbody>
          {displayedRows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-8 text-center text-slate-500"
              >
                {emptyState ?? 'No results'}
              </td>
            </tr>
          ) : (
            displayedRows.map((row) => (
              <tr
                key={rowKey(row)}
                className={`border-b border-slate-100 ${
                  onRowClick
                    ? 'cursor-pointer hover:bg-slate-50'
                    : ''
                }`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-3 py-2 text-slate-700 ${
                      col.align === 'right'
                        ? 'text-right'
                        : col.align === 'center'
                          ? 'text-center'
                          : 'text-left'
                    }`}
                  >
                    {col.render
                      ? (col.render(row) as ReactNode)
                      : col.getValue
                        ? (() => {
                            const v = col.getValue!(row);
                            return v === null || v === undefined ? '' : String(v);
                          })()
                        : null}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
    </>
  );
}

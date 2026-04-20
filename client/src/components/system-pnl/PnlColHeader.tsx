import { useEffect, useRef, useState } from 'react';

export type PnlSortDir = 'asc' | 'desc';
export interface PnlSortState<K extends string = string> { key: K; dir: PnlSortDir }

interface Props<K extends string> {
  label:       string;
  colKey:      K;
  sort:        PnlSortState<K> | null;
  onSort:      (key: K, dir: PnlSortDir) => void;
  align?:      'left' | 'right';
  ascLabel?:   string;
  descLabel?:  string;
}

// Sort-only column header — MVP per spec §11.4 table UX note. Filter
// dropdowns can be layered in later; this keeps the surface minimal for
// P&L where every numeric column is continuous (no finite value set to
// filter by).
export default function PnlColHeader<K extends string>({
  label, colKey, sort, onSort, align = 'left', ascLabel, descLabel,
}: Props<K>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLTableCellElement>(null);
  const isSorted = sort?.key === colKey;
  const dir = isSorted ? sort.dir : null;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const asc  = ascLabel  ?? 'A → Z';
  const desc = descLabel ?? 'Z → A';
  const isRight = align === 'right';

  return (
    <th ref={ref} className={`px-4 py-0 relative ${isRight ? 'text-right' : 'text-left'}`} style={{ userSelect: 'none' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 w-full py-3 bg-transparent border-0 cursor-pointer text-xs font-medium uppercase tracking-wide transition-colors ${open ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-700'} ${isRight ? 'justify-end' : ''}`}
      >
        <span>{label}</span>
        {dir && <span className="text-indigo-500 text-[11px]">{dir === 'asc' ? '↑' : '↓'}</span>}
        <svg
          className={`w-3 h-3 transition-transform ${open ? 'rotate-180 text-indigo-500' : 'text-slate-400'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className={`absolute top-full z-50 min-w-[160px] bg-white border border-slate-200 rounded-lg shadow-lg py-1 mt-0.5 ${isRight ? 'right-0' : 'left-0'}`}>
          <div className="px-2 pt-1 pb-1">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold px-2 py-1">Sort</div>
            <button
              onClick={() => { onSort(colKey, 'asc'); setOpen(false); }}
              className={`flex items-center gap-2 w-full px-2 py-1.5 text-[12px] rounded-md border-0 cursor-pointer transition-colors text-left normal-case ${isSorted && dir === 'asc' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'bg-transparent text-slate-700 hover:bg-slate-50'}`}
            >
              <span className="text-[11px] w-3">↑</span> {asc}
              {isSorted && dir === 'asc' && <span className="ml-auto text-indigo-500">✓</span>}
            </button>
            <button
              onClick={() => { onSort(colKey, 'desc'); setOpen(false); }}
              className={`flex items-center gap-2 w-full px-2 py-1.5 text-[12px] rounded-md border-0 cursor-pointer transition-colors text-left normal-case ${isSorted && dir === 'desc' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'bg-transparent text-slate-700 hover:bg-slate-50'}`}
            >
              <span className="text-[11px] w-3">↓</span> {desc}
              {isSorted && dir === 'desc' && <span className="ml-auto text-indigo-500">✓</span>}
            </button>
          </div>
        </div>
      )}
    </th>
  );
}

import { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// ArrayEditor — reusable add/remove/reorder primitive consumed by the typed
// Settings editors (spec §11.2.2). Accepts a rowRenderer + newRowFactory.
// ---------------------------------------------------------------------------

interface Props<T> {
  items: T[];
  onChange: (items: T[]) => void;
  renderRow: (item: T, index: number, onPatch: (patch: Partial<T>) => void) => ReactNode;
  newRow: () => T;
  addLabel?: string;
  emptyLabel?: string;
  allowReorder?: boolean;
}

export default function ArrayEditor<T>({ items, onChange, renderRow, newRow, addLabel = '+ Add row', emptyLabel = 'No rows yet.', allowReorder = false }: Props<T>) {
  const patchAt = (i: number, patch: Partial<T>) => {
    onChange(items.map((t, ix) => (ix === i ? { ...t, ...patch } : t)));
  };
  const remove = (i: number) => onChange(items.filter((_, ix) => ix !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {items.length === 0 && <p className="text-[12px] text-slate-500">{emptyLabel}</p>}
      {items.map((item, i) => (
        <div key={i} className="rounded-md border border-slate-200 bg-white p-3">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">{renderRow(item, i, (patch) => patchAt(i, patch))}</div>
            <div className="flex flex-col gap-1 shrink-0">
              {allowReorder && (
                <>
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="text-[11px] text-slate-500 hover:text-slate-700 disabled:opacity-30">↑</button>
                  <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="text-[11px] text-slate-500 hover:text-slate-700 disabled:opacity-30">↓</button>
                </>
              )}
              <button onClick={() => remove(i)} className="text-[11px] text-red-600 hover:underline">×</button>
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, newRow()])}
        className="text-[12px] font-semibold text-indigo-600 hover:underline"
      >
        {addLabel}
      </button>
    </div>
  );
}

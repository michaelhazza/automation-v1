import { useState } from 'react';

export interface BoardColumn {
  key: string;
  label: string;
  colour: string;
  description: string;
  locked: boolean;
}

interface Props {
  columns: BoardColumn[];
  onChange: (columns: BoardColumn[]) => void;
  readOnly?: boolean;
}

export default function BoardColumnEditor({ columns, onChange, readOnly }: Props) {
  const [newCol, setNewCol] = useState({ key: '', label: '', colour: '#6366f1', description: '' });
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const handleAdd = () => {
    if (!newCol.key || !newCol.label) return;
    if (columns.some(c => c.key === newCol.key)) return;
    if (!/^[a-z][a-z0-9_]*$/.test(newCol.key)) return;
    onChange([...columns, { ...newCol, locked: false }]);
    setNewCol({ key: '', label: '', colour: '#6366f1', description: '' });
  };

  const handleRemove = (key: string) => {
    const col = columns.find(c => c.key === key);
    if (col?.locked) return;
    onChange(columns.filter(c => c.key !== key));
  };

  const handleUpdate = (idx: number, field: keyof BoardColumn, value: string) => {
    const updated = [...columns];
    updated[idx] = { ...updated[idx], [field]: value };
    onChange(updated);
  };

  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const updated = [...columns];
    const [moved] = updated.splice(dragIdx, 1);
    updated.splice(idx, 0, moved);
    onChange(updated);
    setDragIdx(idx);
  };
  const handleDragEnd = () => setDragIdx(null);

  return (
    <div>
      <div className="flex flex-col gap-2">
        {columns.map((col, idx) => (
          <div
            key={col.key}
            draggable={!readOnly}
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDragEnd={handleDragEnd}
            className={`flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg transition-opacity ${
              readOnly ? 'cursor-default' : 'cursor-grab'
            } ${dragIdx === idx ? 'bg-indigo-50 opacity-60' : 'bg-slate-50'}`}
          >
            {!readOnly && (
              <span className="text-slate-400 cursor-grab text-sm">⠿</span>
            )}
            <input
              type="color"
              value={col.colour}
              disabled={readOnly}
              onChange={(e) => handleUpdate(idx, 'colour', e.target.value)}
              className="w-7 h-7 border-0 bg-transparent cursor-pointer p-0"
            />
            <div className="flex-1 flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <input
                  value={col.label}
                  disabled={readOnly}
                  onChange={(e) => handleUpdate(idx, 'label', e.target.value)}
                  className="text-sm font-semibold border-0 bg-transparent outline-none px-1 py-0.5 rounded w-[140px]"
                  placeholder="Label"
                />
                <span className="text-[11px] text-slate-400 font-mono">{col.key}</span>
                {col.locked && (
                  <span className="text-[10px] text-slate-500 bg-slate-200 px-1.5 py-px rounded">
                    locked
                  </span>
                )}
              </div>
              <input
                value={col.description}
                disabled={readOnly}
                onChange={(e) => handleUpdate(idx, 'description', e.target.value)}
                className="text-xs text-slate-500 border-0 bg-transparent outline-none px-1 py-0.5"
                placeholder="Description"
              />
            </div>
            {!readOnly && !col.locked && (
              <button
                onClick={() => handleRemove(col.key)}
                className="bg-transparent border-0 text-red-500 cursor-pointer text-base px-2 py-1"
                title="Remove column"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {!readOnly && (
        <div className="mt-4 p-3 bg-slate-50 border border-dashed border-slate-300 rounded-lg flex gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-slate-500 font-semibold">Key</label>
            <input
              value={newCol.key}
              onChange={(e) => setNewCol({ ...newCol, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
              placeholder="e.g. qa_check"
              className="px-2 py-1.5 border border-gray-300 rounded-md text-[13px] w-[120px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-slate-500 font-semibold">Label</label>
            <input
              value={newCol.label}
              onChange={(e) => setNewCol({ ...newCol, label: e.target.value })}
              placeholder="e.g. QA Check"
              className="px-2 py-1.5 border border-gray-300 rounded-md text-[13px] w-[140px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-slate-500 font-semibold">Colour</label>
            <input
              type="color"
              value={newCol.colour}
              onChange={(e) => setNewCol({ ...newCol, colour: e.target.value })}
              className="w-9 h-8 border border-gray-300 rounded-md p-0.5"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={!newCol.key || !newCol.label}
            className={`px-4 py-1.5 border-0 rounded-md text-[13px] font-semibold transition-colors ${
              newCol.key && newCol.label
                ? 'bg-indigo-500 text-white cursor-pointer hover:bg-indigo-600'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            Add Column
          </button>
        </div>
      )}
    </div>
  );
}

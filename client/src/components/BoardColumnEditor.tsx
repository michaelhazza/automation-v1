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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {columns.map((col, idx) => (
          <div
            key={col.key}
            draggable={!readOnly}
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDragEnd={handleDragEnd}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              background: dragIdx === idx ? '#f0f0ff' : '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              cursor: readOnly ? 'default' : 'grab',
              opacity: dragIdx === idx ? 0.6 : 1,
            }}
          >
            {!readOnly && (
              <span style={{ color: '#94a3b8', cursor: 'grab', fontSize: 14 }}>⠿</span>
            )}
            <input
              type="color"
              value={col.colour}
              disabled={readOnly}
              onChange={(e) => handleUpdate(idx, 'colour', e.target.value)}
              style={{ width: 28, height: 28, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
            />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  value={col.label}
                  disabled={readOnly}
                  onChange={(e) => handleUpdate(idx, 'label', e.target.value)}
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    border: 'none',
                    background: 'transparent',
                    outline: 'none',
                    padding: '2px 4px',
                    borderRadius: 4,
                    width: 140,
                  }}
                  placeholder="Label"
                />
                <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{col.key}</span>
                {col.locked && (
                  <span style={{ fontSize: 10, color: '#64748b', background: '#e2e8f0', padding: '1px 6px', borderRadius: 4 }}>
                    locked
                  </span>
                )}
              </div>
              <input
                value={col.description}
                disabled={readOnly}
                onChange={(e) => handleUpdate(idx, 'description', e.target.value)}
                style={{
                  fontSize: 12,
                  color: '#64748b',
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                  padding: '2px 4px',
                }}
                placeholder="Description"
              />
            </div>
            {!readOnly && !col.locked && (
              <button
                onClick={() => handleRemove(col.key)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#ef4444',
                  cursor: 'pointer',
                  fontSize: 16,
                  padding: '4px 8px',
                }}
                title="Remove column"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {!readOnly && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: '#f8fafc',
            border: '1px dashed #cbd5e1',
            borderRadius: 8,
            display: 'flex',
            gap: 8,
            alignItems: 'flex-end',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Key</label>
            <input
              value={newCol.key}
              onChange={(e) => setNewCol({ ...newCol, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
              placeholder="e.g. qa_check"
              style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, width: 120 }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Label</label>
            <input
              value={newCol.label}
              onChange={(e) => setNewCol({ ...newCol, label: e.target.value })}
              placeholder="e.g. QA Check"
              style={{ padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, width: 140 }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Colour</label>
            <input
              type="color"
              value={newCol.colour}
              onChange={(e) => setNewCol({ ...newCol, colour: e.target.value })}
              style={{ width: 36, height: 32, border: '1px solid #d1d5db', borderRadius: 6, padding: 2 }}
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={!newCol.key || !newCol.label}
            style={{
              padding: '6px 16px',
              background: newCol.key && newCol.label ? '#6366f1' : '#e2e8f0',
              color: newCol.key && newCol.label ? '#fff' : '#94a3b8',
              border: 'none',
              borderRadius: 6,
              cursor: newCol.key && newCol.label ? 'pointer' : 'not-allowed',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Add Column
          </button>
        </div>
      )}
    </div>
  );
}

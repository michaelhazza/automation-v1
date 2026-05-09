import React, { useState } from 'react';
import type { AgentFull, DataSourceBindingPayload } from '../../../../../../shared/types/build';
import { DataSourcePickerModal } from '../DataSourcePickerModal';

interface DataSourcesTabProps {
  data: AgentFull['dataSources'];
  onChange: (sources: DataSourceBindingPayload[]) => void;
  pending: DataSourceBindingPayload[] | undefined;
  agentId: string;
  readOnly: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  connected: 'bg-green-100 text-green-700',
  disconnected: 'bg-slate-100 text-slate-500',
  error: 'bg-red-100 text-red-700',
};

export default function DataSourcesTab({ data, onChange, pending, agentId: _agentId, readOnly }: DataSourcesTabProps) {
  const [showPicker, setShowPicker] = useState(false);

  const sources: DataSourceBindingPayload[] = pending ?? data.map(s => ({
    id: s.id,
    kind: s.kind,
    ref: s.ref,
    status: s.status,
  }));

  const handleRemove = (id: string) => {
    onChange(sources.filter(s => s.id !== id));
  };

  const handleAdd = (source: DataSourceBindingPayload) => {
    if (!sources.find(s => s.id === source.id)) {
      onChange([...sources, source]);
    }
    setShowPicker(false);
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Data sources ({sources.length})</h2>
        {!readOnly && (
          <button
            className="btn btn-secondary text-sm"
            onClick={() => setShowPicker(true)}
          >
            Add data source
          </button>
        )}
      </div>

      {sources.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg">
          No data sources connected. Add a data source to give this agent access to external knowledge.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
          {sources.map(source => (
            <li key={source.id} className="flex items-center gap-3 px-4 py-3 bg-white">
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-slate-800 truncate block">{source.ref}</span>
                <span className="text-xs text-slate-500">{source.kind}</span>
              </div>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[source.status ?? 'connected']}`}>
                {source.status ?? 'connected'}
              </span>
              {!readOnly && (
                <button
                  className="text-xs text-red-500 hover:text-red-700 ml-2 flex-shrink-0"
                  onClick={() => handleRemove(source.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {showPicker && (
        <DataSourcePickerModal
          onSelect={handleAdd}
          onClose={() => setShowPicker(false)}
          existingIds={sources.map(s => s.id)}
        />
      )}
    </div>
  );
}

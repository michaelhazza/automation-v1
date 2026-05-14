import { useState } from 'react';
import { InlineDiff } from './InlineDiff';
import { SHORT_FIELDS, type FieldKey } from './format';

interface ColumnProps {
  field: FieldKey;
  current: string;
  incoming: string;
  recommended: string;
  onRecommendedChange: (next: string) => void;
  definitionError?: string | null;
}

export function FieldRow({ field, current, incoming, recommended, onRecommendedChange, definitionError }: ColumnProps) {
  const [activeTab, setActiveTab] = useState<'current' | 'incoming' | 'recommended'>('recommended');
  const isShort = SHORT_FIELDS.includes(field);

  // The Recommended column is editable. For short fields it's a single-line
  // input, for long fields it's a textarea. The diff highlight is rendered
  // OVER the baseline (Current) in a read-only preview row above the input.

  function renderReadOnly(value: string) {
    if (isShort) {
      return <div className="text-sm text-slate-700 break-words">{value || <span className="italic text-slate-300">empty</span>}</div>;
    }
    return (
      <pre className="text-xs text-slate-700 whitespace-pre-wrap break-words font-mono">
        {value || <span className="italic text-slate-300">empty</span>}
      </pre>
    );
  }

  function renderRecommended() {
    if (isShort) {
      return (
        <input
          type="text"
          value={recommended}
          onChange={(e) => onRecommendedChange(e.target.value)}
          className="w-full text-sm border border-emerald-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400"
        />
      );
    }
    return (
      <textarea
        value={recommended}
        onChange={(e) => onRecommendedChange(e.target.value)}
        className="w-full text-xs border border-emerald-300 rounded px-2 py-1 font-mono bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400 min-h-[120px]"
        rows={Math.min(20, Math.max(4, recommended.split('\n').length + 1))}
      />
    );
  }

  // The diff overlay is read-only — it's the visual the reviewer reads.
  function renderRecommendedDiff() {
    return (
      <div className="text-xs text-slate-700 whitespace-pre-wrap break-words font-mono mb-2 p-2 bg-emerald-50/30 border border-emerald-100 rounded">
        <InlineDiff baseline={current} value={recommended} />
      </div>
    );
  }

  return (
    <div className="border-t border-slate-100 pt-3 mt-3 first:border-t-0 first:pt-0 first:mt-0">
      <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-2 font-medium">{field}</div>

      {/* Wide layout: three columns side-by-side */}
      <div className="hidden xl:grid xl:grid-cols-3 xl:gap-3">
        <div>
          <div className="text-[10px] text-slate-500 mb-1">Current (library)</div>
          {renderReadOnly(current)}
        </div>
        <div>
          <div className="text-[10px] text-slate-500 mb-1">Incoming</div>
          {renderReadOnly(incoming)}
        </div>
        <div>
          <div className="text-[10px] text-emerald-700 mb-1 font-semibold">★ Recommended (editable)</div>
          {renderRecommendedDiff()}
          {renderRecommended()}
          {definitionError && field === 'definition' && (
            <p className="mt-1 text-[10px] text-red-600">{definitionError}</p>
          )}
        </div>
      </div>

      {/* Narrow layout: tab strip with Recommended active by default */}
      <div className="xl:hidden">
        <div className="flex gap-1 mb-2 text-[11px]">
          <button
            type="button"
            onClick={() => setActiveTab('current')}
            className={`px-2 py-1 rounded ${activeTab === 'current' ? 'bg-slate-200 text-slate-800' : 'bg-white text-slate-500 border border-slate-200'}`}
          >
            Current
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('incoming')}
            className={`px-2 py-1 rounded ${activeTab === 'incoming' ? 'bg-slate-200 text-slate-800' : 'bg-white text-slate-500 border border-slate-200'}`}
          >
            Incoming
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('recommended')}
            className={`px-2 py-1 rounded ${activeTab === 'recommended' ? 'bg-emerald-100 text-emerald-800 font-semibold' : 'bg-white text-slate-500 border border-slate-200'}`}
          >
            ★ Recommended
          </button>
        </div>
        {activeTab === 'current' && renderReadOnly(current)}
        {activeTab === 'incoming' && renderReadOnly(incoming)}
        {activeTab === 'recommended' && (
          <>
            {renderRecommendedDiff()}
            {renderRecommended()}
            {definitionError && field === 'definition' && (
              <p className="mt-1 text-[10px] text-red-600">{definitionError}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

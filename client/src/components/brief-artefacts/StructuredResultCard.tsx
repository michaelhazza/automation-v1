import type { BriefStructuredResult } from '../../../../shared/types/briefResultContract.js';
import { ConfidenceBadge } from './ConfidenceBadge.js';
import { BudgetContextStrip } from './BudgetContextStrip.js';

interface StructuredResultCardProps {
  artefact: BriefStructuredResult;
  isSuperseded?: boolean;
  onSuggestionClick?: (intent: string) => void;
}

export function StructuredResultCard({ artefact, isSuperseded, onSuggestionClick }: StructuredResultCardProps) {
  const columns = artefact.columns ?? (artefact.rows[0] ? Object.keys(artefact.rows[0]).map(k => ({ key: k, label: k })) : []);

  return (
    <div className={`rounded-lg border bg-white p-4 ${isSuperseded ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className="text-sm font-medium text-gray-900">{artefact.summary}</p>
        <div className="flex items-center gap-1 shrink-0">
          {artefact.confidence !== undefined && <ConfidenceBadge confidence={artefact.confidence} />}
        </div>
      </div>

      {artefact.filtersApplied.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {artefact.filtersApplied.map((f, i) => (
            <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700 border border-indigo-100">
              {f.humanLabel}
            </span>
          ))}
        </div>
      )}

      {artefact.rows.length > 0 && (
        <div className="overflow-x-auto rounded border border-gray-100 mb-3">
          <table className="min-w-full divide-y divide-gray-100 text-xs">
            <thead className="bg-gray-50">
              <tr>
                {columns.map(col => (
                  <th key={col.key} className="px-3 py-1.5 text-left font-medium text-gray-500 uppercase tracking-wider">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {artefact.rows.map((row, i) => (
                <tr key={i}>
                  {columns.map(col => (
                    <td key={col.key} className="px-3 py-1.5 text-gray-700 whitespace-nowrap">
                      {String(row[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {artefact.truncated && (
            <p className="px-3 py-1.5 text-xs text-gray-400 border-t border-gray-100">
              Showing {artefact.rows.length} of {artefact.rowCount} results
            </p>
          )}
        </div>
      )}

      {artefact.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {artefact.suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => onSuggestionClick?.(s.intent)}
              className="inline-flex items-center px-2 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50 text-gray-600"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <BudgetContextStrip costCents={artefact.costCents} source={artefact.source} freshnessMs={artefact.freshnessMs} />
    </div>
  );
}

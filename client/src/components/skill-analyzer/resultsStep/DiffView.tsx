import type { AnalysisResult } from '../types';

export default function DiffView({ result }: { result: AnalysisResult }) {
  if (!result.diffSummary) return null;
  const { addedFields, removedFields, changedFields } = result.diffSummary;
  if (addedFields.length === 0 && removedFields.length === 0 && changedFields.length === 0) return null;

  return (
    <div className="mt-3 p-3 bg-white border border-slate-200 rounded-lg text-xs">
      <p className="font-medium text-slate-600 mb-2">Field differences:</p>
      <div className="space-y-1">
        {addedFields.map((f) => (
          <span key={f} className="inline-flex items-center gap-1 mr-2 px-2 py-0.5 bg-green-50 text-green-700 rounded">
            + {f}
          </span>
        ))}
        {removedFields.map((f) => (
          <span key={f} className="inline-flex items-center gap-1 mr-2 px-2 py-0.5 bg-red-50 text-red-700 rounded">
            − {f}
          </span>
        ))}
        {changedFields.map((f) => (
          <span key={f} className="inline-flex items-center gap-1 mr-2 px-2 py-0.5 bg-amber-50 text-amber-700 rounded">
            ~ {f}
          </span>
        ))}
      </div>
    </div>
  );
}

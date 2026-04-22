import type { RuleConflict, RuleConflictReport } from '../../../../shared/types/briefRules.js';

interface RuleConflictResolutionDialogProps {
  conflictReport: RuleConflictReport;
  newRuleText: string;
  onProceed: () => void;
  onCancel: () => void;
}

const CONFLICT_KIND_LABEL: Record<RuleConflict['conflictKind'], string> = {
  direct_contradiction: 'Direct contradiction',
  scope_overlap: 'Scope overlap',
  subset: 'Subset',
  superset: 'Superset',
};

const RESOLUTION_LABEL: Record<RuleConflict['suggestedResolution'], string> = {
  keep_new: 'Keep new rule',
  keep_existing: 'Keep existing rule',
  keep_both_with_priorities: 'Keep both (adjust priority)',
  user_decides: 'You decide',
};

export function RuleConflictResolutionDialog({
  conflictReport,
  newRuleText,
  onProceed,
  onCancel,
}: RuleConflictResolutionDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Potential conflicts detected</h2>
        <p className="text-sm text-gray-500 mb-4">
          The rule you're saving may overlap with existing rules. Review the conflicts below.
        </p>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-sm text-gray-800 mb-4">
          <strong>New rule:</strong> {newRuleText}
        </div>

        <ul className="space-y-3 mb-6">
          {conflictReport.conflicts.map((c, i) => (
            <li key={i} className="border border-gray-200 rounded-lg p-3 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded">
                  {CONFLICT_KIND_LABEL[c.conflictKind]}
                </span>
                <span className="text-xs text-gray-400">{Math.round(c.confidence * 100)}% confidence</span>
              </div>
              <p className="text-gray-700 mb-1">{c.existingText}</p>
              <p className="text-xs text-gray-500">
                Suggested: {RESOLUTION_LABEL[c.suggestedResolution]}
              </p>
            </li>
          ))}
        </ul>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onProceed}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Save anyway
          </button>
        </div>
      </div>
    </div>
  );
}

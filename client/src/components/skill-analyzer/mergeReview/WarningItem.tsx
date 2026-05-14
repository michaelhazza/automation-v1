import {
  warningLabel,
  warningBadgeClass,
  parseDemotedFields,
  parseDemotedFieldStatuses,
  type MergeWarning,
  type MergeWarningCode,
  type WarningResolutionKind,
} from '../mergeTypes';
import { parseNameMismatchDetail } from './format';
import { CriticalPhraseInput } from './CriticalPhraseInput';

export function WarningItem({
  warning,
  isLocked,
  isResolved,
  onResolve,
  criticalPhrase,
}: {
  warning: MergeWarning;
  isLocked: boolean;
  isResolved: (code: MergeWarningCode, field?: string) => WarningResolutionKind | null;
  onResolve: (
    code: MergeWarningCode,
    resolution: WarningResolutionKind,
    details?: { field?: string; disambiguationNote?: string; collidingSkillId?: string },
  ) => Promise<void>;
  criticalPhrase: string;
}) {
  const disabled = isLocked;
  const label = warningLabel(warning.code);
  const badge = warningBadgeClass(warning.code);

  const header = (
    <div className="flex items-start gap-2 mb-1">
      <span className={`mt-[1px] px-1.5 py-0.5 rounded text-[10px] font-medium ${badge}`}>
        {label}
      </span>
      <span className="text-slate-800 flex-1">{warning.message}</span>
    </div>
  );

  if (warning.code === 'REQUIRED_FIELD_DEMOTED') {
    const fields = parseDemotedFields(warning.detail);
    // v6 Fix 3: per-field status gives the reviewer the context to know
    // whether a field was deleted entirely, made optional (still in schema),
    // or possibly replaced by a similarly-named property.
    const statuses = parseDemotedFieldStatuses(warning.detail);
    return (
      <div className="mb-2">
        {header}
        <ul className="ml-4 space-y-1">
          {fields.map((field) => {
            const current = isResolved('REQUIRED_FIELD_DEMOTED', field);
            const fieldStatus = statuses[field];
            let statusLabel: string | null = null;
            let acceptText = 'Accept removal';
            if (fieldStatus?.status === 'made_optional') {
              statusLabel = 'made optional — still in schema';
              acceptText = 'Accept optional';
            } else if (fieldStatus?.status === 'replaced_by') {
              statusLabel = `possibly replaced by ${fieldStatus.replacement}`;
            } else if (fieldStatus?.status === 'removed_entirely') {
              statusLabel = 'removed from schema';
            }
            return (
              <li key={field} className="flex flex-wrap items-center gap-2 text-[11px]">
                <code className="text-slate-600">{field}</code>
                {statusLabel && (
                  <span className="text-slate-500 italic">{statusLabel}</span>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onResolve('REQUIRED_FIELD_DEMOTED', 'accept_removal', { field })}
                  className={`px-2 py-0.5 rounded border ${current === 'accept_removal' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-700 border-slate-300 hover:border-slate-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  {acceptText}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onResolve('REQUIRED_FIELD_DEMOTED', 'restore_required', { field })}
                  className={`px-2 py-0.5 rounded border ${current === 'restore_required' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-700 border-indigo-300 hover:border-indigo-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  Restore required
                </button>
                {current && <span className="text-emerald-700">✓</span>}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (warning.code === 'NAME_MISMATCH') {
    const parsed = parseNameMismatchDetail(warning.detail);
    const current = isResolved('NAME_MISMATCH');
    return (
      <div className="mb-2">
        {header}
        <div className="ml-4 mt-1 text-[11px] text-slate-600">
          <p>Library name: <code className="text-slate-800">{parsed.schemaName ?? '(none)'}</code></p>
          <p>Incoming name: <code className="text-slate-800">{parsed.topLevel || '(none)'}</code></p>
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onResolve('NAME_MISMATCH', 'use_library_name')}
              className={`px-2 py-0.5 rounded border ${current === 'use_library_name' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-700 border-indigo-300 hover:border-indigo-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              Use library name throughout
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onResolve('NAME_MISMATCH', 'use_incoming_name')}
              className={`px-2 py-0.5 rounded border ${current === 'use_incoming_name' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-700 border-indigo-300 hover:border-indigo-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              Use incoming name throughout
            </button>
            {current && <span className="text-emerald-700 self-center">✓</span>}
          </div>
        </div>
      </div>
    );
  }

  if (warning.code === 'SKILL_GRAPH_COLLISION') {
    const current = isResolved('SKILL_GRAPH_COLLISION');
    return (
      <div className="mb-2">
        {header}
        <div className="ml-4 mt-1 flex gap-2 text-[11px]">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onResolve('SKILL_GRAPH_COLLISION', 'scope_down')}
            className={`px-2 py-0.5 rounded border ${current === 'scope_down' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-700 border-indigo-300 hover:border-indigo-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Scope down this merge
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onResolve('SKILL_GRAPH_COLLISION', 'flag_other')}
            className={`px-2 py-0.5 rounded border ${current === 'flag_other' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-amber-700 border-amber-300 hover:border-amber-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Flag other skill
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const note = window.prompt('Disambiguation note (required):');
              if (note && note.trim().length > 0) {
                onResolve('SKILL_GRAPH_COLLISION', 'accept_overlap', { disambiguationNote: note.trim() });
              }
            }}
            className={`px-2 py-0.5 rounded border ${current === 'accept_overlap' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-700 border-slate-300 hover:border-slate-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Accept overlap
          </button>
          {current && <span className="text-emerald-700 self-center">✓</span>}
        </div>
      </div>
    );
  }

  if (warning.code === 'CLASSIFIER_FALLBACK') {
    const current = isResolved('CLASSIFIER_FALLBACK');
    return (
      <div className="mb-2">
        {header}
        <div className="ml-4 mt-1 text-[11px]">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              disabled={disabled}
              checked={current === 'acknowledge_low_confidence'}
              onChange={(e) => {
                if (e.target.checked) onResolve('CLASSIFIER_FALLBACK', 'acknowledge_low_confidence');
              }}
            />
            <span>I have reviewed the rule-based merge and accept the low-confidence state.</span>
          </label>
        </div>
      </div>
    );
  }

  if (warning.code === 'SCOPE_EXPANSION_CRITICAL') {
    // Critical-tier: require typing the configurable confirmation phrase.
    const current = isResolved('SCOPE_EXPANSION_CRITICAL');
    return (
      <div className="mb-2">
        {header}
        <div className="ml-4 mt-1 text-[11px]">
          <p className="text-slate-600 mb-1">
            To approve with critical scope expansion, either edit the merge below the threshold OR type the confirmation phrase exactly.
          </p>
          <CriticalPhraseInput
            current={current}
            disabled={disabled}
            expectedPhrase={criticalPhrase}
            onConfirm={() => onResolve('SCOPE_EXPANSION_CRITICAL', 'confirm_critical_phrase')}
          />
        </div>
      </div>
    );
  }

  if (warning.code === 'INVOCATION_LOST'
    || warning.code === 'HITL_LOST'
    || warning.code === 'SCOPE_EXPANSION'
    || warning.code === 'CAPABILITY_OVERLAP') {
    const current = isResolved(warning.code);
    return (
      <div className="mb-2">
        {header}
        <div className="ml-4 mt-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onResolve(warning.code, 'acknowledge_warning')}
            className={`px-2 py-0.5 rounded border text-[11px] ${current === 'acknowledge_warning' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-700 border-slate-300 hover:border-slate-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Acknowledge
          </button>
          {current && <span className="ml-2 text-emerald-700 text-[11px]">✓</span>}
        </div>
      </div>
    );
  }

  // Informational tier: no resolution control; just show the detail.
  return (
    <div className="mb-2">
      {header}
      {warning.detail && <div className="ml-4 text-slate-500 text-[10px]">{warning.detail}</div>}
    </div>
  );
}

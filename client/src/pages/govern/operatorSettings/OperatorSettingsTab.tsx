import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  getOperatorSettings,
  updateOperatorSettings,
  type OperatorSettings,
} from '../../../api/operatorBackendApi';
import { NumberField } from './_fields';

interface Props {
  subaccountId: string;
  canEdit: boolean;
}

interface Draft {
  sessionSoftCapMinutes: number;
  autoExtendGraceMinutes: number;
  maxChainLength: number;
  maxWallClockPerTaskDays: number;
  perTaskBudgetCapMinutes: number;
  concurrentOperatorSessionsCap: number;
}

function toDraft(s: OperatorSettings): Draft {
  return {
    sessionSoftCapMinutes: s.sessionSoftCapMinutes,
    autoExtendGraceMinutes: s.autoExtendGraceMinutes,
    maxChainLength: s.maxChainLength,
    maxWallClockPerTaskDays: s.maxWallClockPerTaskDays,
    perTaskBudgetCapMinutes: s.perTaskBudgetCapMinutes,
    concurrentOperatorSessionsCap: s.concurrentOperatorSessionsCap,
  };
}

export default function OperatorSettingsTab({ subaccountId, canEdit }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [etag, setEtag] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoadError(null);
    const result = await getOperatorSettings(subaccountId);
    if (!result.ok) {
      setLoadError('Failed to load operator settings');
      return;
    }
    setDraft(toDraft(result.data.settings));
    setEtag(result.data.etag);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subaccountId]);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    const result = await updateOperatorSettings(subaccountId, draft, etag);
    setSaving(false);
    if (!result.ok) {
      if (result.error.code === 'OPERATOR_SETTINGS_CONFLICT' || result.error.status === 409) {
        await load();
        toast.error('Settings changed by another admin, please review and re-apply your changes.');
      } else {
        toast.error('Failed to save operator settings');
      }
      return;
    }
    setDraft(toDraft(result.data.settings));
    setEtag(result.data.etag);
    toast.success('Operator settings saved');
  };

  const set = (key: keyof Draft) => (value: number) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  if (loadError) {
    return <div className="py-8 text-sm text-red-600">{loadError}</div>;
  }
  if (!draft) {
    return <div className="py-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <div className="max-w-[680px]">
      {/* Section: Session limits */}
      <div className="bg-white border border-slate-200 rounded-xl mb-5 overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-100">
          <span className="text-[14px] font-bold text-slate-800">Session limits</span>
        </div>
        <div>
          <NumberField
            label="Soft session cap"
            helpText="How long one operator session can run before it wraps up and hands off. Shorter sessions keep costs predictable."
            unit="minutes"
            value={draft.sessionSoftCapMinutes}
            min={30}
            max={240}
            disabled={!canEdit}
            onChange={set('sessionSoftCapMinutes')}
          />
          <NumberField
            label="Auto-extend grace"
            helpText="If the operator is mid-step when the soft cap hits, it gets this extra time to finish the current step before stopping."
            unit="minutes"
            value={draft.autoExtendGraceMinutes}
            min={0}
            max={60}
            disabled={!canEdit}
            onChange={set('autoExtendGraceMinutes')}
          />
          <NumberField
            label="Concurrent operator sessions"
            helpText="How many operator runs can be active at the same time across this subaccount. Lowering this protects compute budget."
            unit="max 25"
            value={draft.concurrentOperatorSessionsCap}
            min={1}
            max={25}
            disabled={!canEdit}
            onChange={set('concurrentOperatorSessionsCap')}
          />
        </div>
      </div>

      {/* Section: Task limits */}
      <div className="bg-white border border-slate-200 rounded-xl mb-5 overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-100">
          <span className="text-[14px] font-bold text-slate-800">Task limits</span>
        </div>
        <div>
          <NumberField
            label="Max chain length"
            helpText="A long task may run across multiple chained sessions. This caps how many sessions can chain before the task pauses for a human check-in."
            unit="sessions"
            value={draft.maxChainLength}
            min={1}
            max={500}
            disabled={!canEdit}
            onChange={set('maxChainLength')}
          />
          <NumberField
            label="Max wall-clock per task"
            helpText="A task that has been running (including pauses between sessions) for longer than this will pause for review, even if it has not used its session budget."
            unit="days"
            value={draft.maxWallClockPerTaskDays}
            min={1}
            max={365}
            disabled={!canEdit}
            onChange={set('maxWallClockPerTaskDays')}
          />
          <NumberField
            label="Per-task budget cap"
            helpText="Tasks pause for review when they use this many operator session minutes in total. About 50 sessions of 120 minutes at the default."
            unit="minutes"
            value={draft.perTaskBudgetCapMinutes}
            min={60}
            max={60000}
            disabled={!canEdit}
            onChange={set('perTaskBudgetCapMinutes')}
          />
        </div>
      </div>

      {/* Save footer */}
      <div className="flex items-center justify-end gap-3 pt-1 pb-4">
        <span className="text-[12px] text-slate-400">
          Changes apply to new sessions only. In-progress sessions are not affected.
        </span>
        {canEdit && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary"
          >
            {saving ? 'Saving...' : 'Save settings'}
          </button>
        )}
      </div>
    </div>
  );
}

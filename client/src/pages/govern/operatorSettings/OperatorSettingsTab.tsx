import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  getOperatorSettings,
  updateOperatorSettings,
  type OperatorSettings,
} from '../../../api/operatorBackendApi';
import {
  getIeeBrowserSettings,
  updateIeeBrowserSettings,
} from '../../../api/ieeBrowserSettingsApi';
import { NumberField, ToggleField, CurrencyField } from './_fields';

interface Props {
  subaccountId: string;
  canEdit: boolean;
}

interface Draft {
  sessionSoftCapMinutes: number;
  autoExtendGraceMinutes: number;
  concurrentOperatorSessionsCap: number;
}

interface IeeDraft {
  status: 'on' | 'off';
  browserProfileRetentionDays: number;
  perTaskCostCeilingCents: number;
  perSubaccountDailyCostCeilingCents: number;
}

function toDraft(s: OperatorSettings): Draft {
  return {
    sessionSoftCapMinutes: s.sessionSoftCapMinutes,
    autoExtendGraceMinutes: s.autoExtendGraceMinutes,
    concurrentOperatorSessionsCap: s.concurrentOperatorSessionsCap,
  };
}

export default function OperatorSettingsTab({ subaccountId, canEdit }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [etag, setEtag] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [ieeDraft, setIeeDraft] = useState<IeeDraft | null>(null);
  const [ieeEtag, setIeeEtag] = useState('');
  const [ieeSaving, setIeeSaving] = useState(false);
  const [ieeLoadError, setIeeLoadError] = useState<string | null>(null);

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

  const loadIee = async () => {
    setIeeLoadError(null);
    const result = await getIeeBrowserSettings(subaccountId);
    if (!result.ok) {
      setIeeLoadError('Failed to load IEE browser settings');
      return;
    }
    const s = result.data;
    setIeeDraft({
      status: s.status,
      browserProfileRetentionDays: s.browserProfileRetentionDays,
      perTaskCostCeilingCents: s.perTaskCostCeilingCents,
      perSubaccountDailyCostCeilingCents: s.perSubaccountDailyCostCeilingCents,
    });
    setIeeEtag(String(s.settingsVersion));
  };

  useEffect(() => {
    void load();
    void loadIee();
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

  const handleIeeSave = async () => {
    if (!ieeDraft) return;
    setIeeSaving(true);
    const result = await updateIeeBrowserSettings(subaccountId, {
      ...ieeDraft,
      expectedSettingsVersion: Number(ieeEtag),
    });
    setIeeSaving(false);
    if (!result.ok) {
      if (result.error.status === 409) {
        await loadIee();
        toast.error('Settings were changed by another admin; reload to see latest.');
      } else {
        toast.error('Failed to save IEE browser settings');
      }
      return;
    }
    const s = result.data;
    setIeeDraft({
      status: s.status,
      browserProfileRetentionDays: s.browserProfileRetentionDays,
      perTaskCostCeilingCents: s.perTaskCostCeilingCents,
      perSubaccountDailyCostCeilingCents: s.perSubaccountDailyCostCeilingCents,
    });
    setIeeEtag(String(s.settingsVersion));
    toast.success('IEE browser settings saved');
  };

  const set = (key: keyof Draft) => (value: number) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const setIee = (key: keyof IeeDraft) => (value: number | ('on' | 'off')) => {
    setIeeDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
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

      {/* Section: IEE browser */}
      <div className="bg-white border border-slate-200 rounded-xl mb-5 overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-100">
          <span className="text-[14px] font-bold text-slate-800">IEE browser</span>
        </div>
        {ieeLoadError ? (
          <div className="py-4 px-5 text-sm text-red-600">{ieeLoadError}</div>
        ) : !ieeDraft ? (
          <div className="py-4 px-5 text-sm text-slate-500">Loading...</div>
        ) : (
          <div>
            <ToggleField
              label="IEE browser status"
              helpText="Enable or disable IEE browser sessions for this subaccount."
              value={ieeDraft.status}
              onChange={setIee('status') as (v: 'on' | 'off') => void}
              disabled={!canEdit}
            />
            <NumberField
              label="Browser profile retention"
              helpText="How long to keep browser profiles before they expire."
              unit="days"
              value={ieeDraft.browserProfileRetentionDays}
              min={7}
              max={90}
              disabled={!canEdit}
              onChange={setIee('browserProfileRetentionDays') as (v: number) => void}
            />
            <CurrencyField
              label="Per-task cost ceiling"
              helpText="Tasks will be paused for review if their browser compute cost exceeds this amount."
              valueCents={ieeDraft.perTaskCostCeilingCents}
              onChangeCents={setIee('perTaskCostCeilingCents') as (v: number) => void}
              minCents={1}
              maxCents={10000}
              disabled={!canEdit}
            />
            <CurrencyField
              label="Per-subaccount daily cost ceiling"
              helpText="A cost alarm fires when the subaccount's daily browser compute spend exceeds this amount."
              valueCents={ieeDraft.perSubaccountDailyCostCeilingCents}
              onChangeCents={setIee('perSubaccountDailyCostCeilingCents') as (v: number) => void}
              minCents={1}
              maxCents={100000}
              disabled={!canEdit}
            />
          </div>
        )}
      </div>

      {/* IEE browser save footer */}
      {ieeDraft && !ieeLoadError && canEdit && (
        <div className="flex items-center justify-end gap-3 pt-1 pb-4">
          <button
            onClick={handleIeeSave}
            disabled={ieeSaving}
            className="btn btn-primary"
          >
            {ieeSaving ? 'Saving...' : 'Save IEE settings'}
          </button>
        </div>
      )}
    </div>
  );
}

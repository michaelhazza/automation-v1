import { useState, useEffect } from 'react';
import api from '../../lib/api';
import type { User } from '../../lib/auth';
import type { Subaccount, SettingsForm } from './types';
import { DevContextConfig } from './DevContextConfig';
import { ManualBaselineForm } from '../baseline/ManualBaselineForm';
import { AdminBaselineResetButton } from '../baseline/AdminBaselineResetButton';

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

interface AdminTabProps {
  subaccountId: string;
  user: User;
  subaccount: Subaccount;
  baselineStatus: { status: string; confidence?: string } | null;
  onSubaccountChanged: () => void;
  onBaselineSaved: () => void;
}

export function AdminTab({ subaccountId, user, subaccount, baselineStatus, onSubaccountChanged, onBaselineSaved }: AdminTabProps) {
  const [settingsForm, setSettingsForm] = useState<SettingsForm>({
    name: subaccount.name,
    slug: subaccount.slug,
    status: subaccount.status,
    timezone: subaccount.settings?.timezone ?? 'UTC',
    includeInOrgInbox: subaccount.includeInOrgInbox ?? true,
    runRetentionDays: subaccount.runRetentionDays != null ? String(subaccount.runRetentionDays) : '',
  });
  const [settingsSaved, setSettingsSaved] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setSettingsForm({
      name: subaccount.name,
      slug: subaccount.slug,
      status: subaccount.status,
      timezone: subaccount.settings?.timezone ?? 'UTC',
      includeInOrgInbox: subaccount.includeInOrgInbox ?? true,
      runRetentionDays: subaccount.runRetentionDays != null ? String(subaccount.runRetentionDays) : '',
    });
  }, [subaccount]);

  const handleSaveSettings = async () => {
    setError(''); setSettingsSaved('');
    try {
      const { timezone, includeInOrgInbox, runRetentionDays, ...rest } = settingsForm;
      const retentionVal = runRetentionDays ? parseInt(runRetentionDays, 10) : null;
      await api.patch(`/api/subaccounts/${subaccountId}`, { ...rest, includeInOrgInbox, runRetentionDays: retentionVal, settings: { timezone } });
      setSettingsSaved('Saved successfully'); onSubaccountChanged();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to save settings');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-[480px]">
        <h2 className="text-[18px] font-semibold text-slate-800 mb-5">Company settings</h2>
        {error && <div className="text-[13px] text-red-600 mb-4">{error}</div>}
        {settingsSaved && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 mb-4 text-[13px] text-green-700">{settingsSaved}</div>
        )}
        <div className="grid gap-4 mb-5">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name</label>
            <input value={settingsForm.name} onChange={(e) => setSettingsForm({ ...settingsForm, name: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Slug</label>
            <input value={settingsForm.slug} onChange={(e) => setSettingsForm({ ...settingsForm, slug: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Status</label>
            <select value={settingsForm.status} onChange={(e) => setSettingsForm({ ...settingsForm, status: e.target.value })} className={inputCls}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Timezone</label>
            <p className="text-[12px] text-slate-400 mb-1.5">Agent heartbeat schedules run in this timezone.</p>
            <select value={settingsForm.timezone} onChange={(e) => setSettingsForm({ ...settingsForm, timezone: e.target.value })} className={inputCls}>
              {[
                'UTC',
                'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
                'America/Toronto', 'America/Vancouver', 'America/Sao_Paulo',
                'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Amsterdam',
                'Europe/Stockholm', 'Europe/Warsaw', 'Europe/Istanbul',
                'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Shanghai',
                'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland',
              ].map((tz) => (
                <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Run retention (days)</label>
            <p className="text-[12px] text-slate-400 mb-1.5">Override the default retention period for agent run data. Leave blank to use the organisation default.</p>
            <input
              type="number"
              min="7"
              max="3650"
              placeholder="Org default"
              value={settingsForm.runRetentionDays}
              onChange={(e) => setSettingsForm({ ...settingsForm, runRetentionDays: e.target.value })}
              className={`${inputCls} max-w-[180px]`}
            />
          </div>
          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <button
                type="button"
                role="switch"
                aria-checked={settingsForm.includeInOrgInbox}
                onClick={() => setSettingsForm({ ...settingsForm, includeInOrgInbox: !settingsForm.includeInOrgInbox })}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${settingsForm.includeInOrgInbox ? 'bg-indigo-600' : 'bg-slate-200'}`}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${settingsForm.includeInOrgInbox ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
              <span className="text-[13px] font-medium text-slate-700">Include in Organisation Inbox</span>
            </label>
            <p className="text-[12px] text-slate-400 mt-1.5 ml-14">When enabled, inbox items from this subaccount (tasks, reviews, failed runs) will appear in the org-wide inbox. When disabled, they are only visible in this subaccount's inbox.</p>
          </div>
        </div>
        <button onClick={handleSaveSettings} className="btn btn-primary">
          Save changes
        </button>
      </div>

      {/* Dev Execution Context */}
      <DevContextConfig subaccountId={subaccountId} />

      {/* Baseline metrics manual entry */}
      {baselineStatus && (
        baselineStatus.status === 'failed' ||
        (baselineStatus.status === 'captured' && baselineStatus.confidence === 'partial')
      ) && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-[640px]">
          <h2 className="text-[18px] font-semibold text-slate-800 mb-2">Baseline metrics</h2>
          <p className="text-[13px] text-slate-500 mb-5">
            {baselineStatus.status === 'failed'
              ? "We couldn't capture the baseline automatically. You can enter values manually."
              : "Some metrics weren't available. Add them manually below."}
          </p>
          <ManualBaselineForm subaccountId={subaccountId} onSaved={onBaselineSaved} />
        </div>
      )}

      {/* Admin baseline reset */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-[480px]">
        <h2 className="text-[18px] font-semibold text-slate-800 mb-2">Baseline reset</h2>
        <p className="text-[13px] text-slate-500 mb-4">
          Reset the baseline to allow a fresh automatic capture. Sysadmin only.
        </p>
        <AdminBaselineResetButton subaccountId={subaccountId} user={user} onReset={onBaselineSaved} />
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { Section } from './Section';
import type { LinkDetail } from './types';

const inputCls = 'w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white';
const labelCls = 'block text-[13px] font-medium text-slate-700 mb-1.5';

interface SchedulingTabProps {
  link: LinkDetail;
  onSaved(): Promise<void>;
}

export function SchedulingTab({ link, onSaved }: SchedulingTabProps) {
  const [scheduling, setScheduling] = useState({
    scheduleCron: link.scheduleCron ?? '',
    scheduleEnabled: link.scheduleEnabled,
    scheduleTimezone: link.scheduleTimezone,
    concurrencyPolicy: link.concurrencyPolicy,
    catchUpPolicy: link.catchUpPolicy,
    catchUpCap: link.catchUpCap,
    maxConcurrentRuns: link.maxConcurrentRuns,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setScheduling({
      scheduleCron: link.scheduleCron ?? '',
      scheduleEnabled: link.scheduleEnabled,
      scheduleTimezone: link.scheduleTimezone,
      concurrencyPolicy: link.concurrencyPolicy,
      catchUpPolicy: link.catchUpPolicy,
      catchUpCap: link.catchUpCap,
      maxConcurrentRuns: link.maxConcurrentRuns,
    });
  }, [link]);

  async function save() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await api.patch(`/api/subaccounts/${link.subaccountId}/agents/${link.id}`, {
        scheduleCron: scheduling.scheduleCron || null,
        scheduleEnabled: scheduling.scheduleEnabled,
        scheduleTimezone: scheduling.scheduleTimezone,
        concurrencyPolicy: scheduling.concurrencyPolicy,
        catchUpPolicy: scheduling.catchUpPolicy,
        catchUpCap: Number(scheduling.catchUpCap),
        maxConcurrentRuns: Number(scheduling.maxConcurrentRuns),
      });
      await onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } | string } }; message?: string };
      const apiErr = err.response?.data?.error;
      const msg = typeof apiErr === 'string' ? apiErr : apiErr?.message;
      setSaveError(msg ?? err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {saveError && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">{saveError}</div>
      )}
      <Section title="Schedule">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className={labelCls}>Cron expression</label>
            <input
              type="text"
              value={scheduling.scheduleCron}
              onChange={e => setScheduling(s => ({ ...s, scheduleCron: e.target.value }))}
              placeholder="e.g. 0 9 * * 1  (Monday 9 AM)"
              className={`${inputCls} font-mono`}
            />
            <div className="text-[11px] text-slate-400 mt-1">Standard cron syntax. Leave blank to disable scheduling.</div>
          </div>
          <div>
            <label className={labelCls}>Timezone</label>
            <input
              type="text"
              value={scheduling.scheduleTimezone}
              onChange={e => setScheduling(s => ({ ...s, scheduleTimezone: e.target.value }))}
              placeholder="UTC"
              className={inputCls}
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              id="scheduleEnabled"
              checked={scheduling.scheduleEnabled}
              onChange={e => setScheduling(s => ({ ...s, scheduleEnabled: e.target.checked }))}
              className="w-4 h-4 rounded"
            />
            <label htmlFor="scheduleEnabled" className="text-[13px] text-slate-700 cursor-pointer">Enable schedule</label>
          </div>
        </div>
      </Section>

      <Section title="Concurrency">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Concurrency policy</label>
            <select
              value={scheduling.concurrencyPolicy}
              onChange={e => setScheduling(s => ({ ...s, concurrencyPolicy: e.target.value as LinkDetail['concurrencyPolicy'] }))}
              className={inputCls}
            >
              <option value="skip_if_active">Skip if active</option>
              <option value="coalesce_if_active">Coalesce if active</option>
              <option value="always_enqueue">Always enqueue</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Max concurrent runs</label>
            <input
              type="number"
              min={1}
              value={scheduling.maxConcurrentRuns}
              onChange={e => setScheduling(s => ({ ...s, maxConcurrentRuns: Number(e.target.value) }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Catch-up policy</label>
            <select
              value={scheduling.catchUpPolicy}
              onChange={e => setScheduling(s => ({ ...s, catchUpPolicy: e.target.value as LinkDetail['catchUpPolicy'] }))}
              className={inputCls}
            >
              <option value="skip_missed">Skip missed</option>
              <option value="enqueue_missed_with_cap">Enqueue missed (with cap)</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Catch-up cap</label>
            <input
              type="number"
              min={1}
              value={scheduling.catchUpCap}
              onChange={e => setScheduling(s => ({ ...s, catchUpCap: Number(e.target.value) }))}
              className={inputCls}
            />
          </div>
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="btn btn-primary disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Scheduling'}
        </button>
        {saved && <span className="text-[13px] text-green-600 font-medium">Saved</span>}
      </div>
    </div>
  );
}

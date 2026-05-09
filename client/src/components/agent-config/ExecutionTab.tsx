import { useState } from 'react';

const inputCls = 'w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white';
const labelCls = 'block text-[13px] font-medium text-slate-700 mb-1.5';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-[10px] border border-slate-200 mb-5">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="m-0 text-[15px] font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export type AllowedEnvironment = 'api_tool' | 'headless' | 'browser' | 'terminal_repo';

export interface ExecutionTabProps {
  controllerStyleAllowed: 'native_only' | 'operator_allowed';
  allowedEnvironments: AllowedEnvironment[];
  isSystemAgent: boolean;
  scheduling: {
    scheduleCron: string;
    scheduleEnabled: boolean;
    scheduleTimezone: string;
    concurrencyPolicy: 'skip_if_active' | 'coalesce_if_active' | 'always_enqueue';
    catchUpPolicy: 'skip_missed' | 'enqueue_missed_with_cap';
    catchUpCap: number;
    maxConcurrentRuns: number;
  };
  saving: boolean;
  saved: boolean;
  onControllerStyleChange: (value: 'native_only' | 'operator_allowed') => void;
  onAllowedEnvironmentsChange: (value: AllowedEnvironment[]) => void;
  onSchedulingChange: (value: ExecutionTabProps['scheduling']) => void;
  onSave: () => void;
}

const ENVIRONMENT_OPTIONS: { value: AllowedEnvironment; label: string; systemAgentOnly?: boolean; comingSoon?: string }[] = [
  { value: 'api_tool', label: 'API and Tool' },
  { value: 'headless', label: 'Headless' },
  { value: 'browser', label: 'Browser' },
  { value: 'terminal_repo', label: 'Terminal and Repo', systemAgentOnly: true },
];

const SANDBOX_PLACEHOLDER = { label: 'Sandbox', comingSoon: 'Phase 2 — coming soon' };

export default function ExecutionTab({
  controllerStyleAllowed,
  allowedEnvironments,
  isSystemAgent,
  scheduling,
  saving,
  saved,
  onControllerStyleChange,
  onAllowedEnvironmentsChange,
  onSchedulingChange,
  onSave,
}: ExecutionTabProps) {
  const [scheduleOpen, setScheduleOpen] = useState(false);

  function toggleEnvironment(env: AllowedEnvironment, checked: boolean) {
    if (checked) {
      onAllowedEnvironmentsChange([...allowedEnvironments, env]);
    } else {
      onAllowedEnvironmentsChange(allowedEnvironments.filter(e => e !== env));
    }
  }

  return (
    <div>
      <Section title="Controller Mode">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="operatorModeEnabled"
            checked={controllerStyleAllowed === 'operator_allowed'}
            onChange={e => onControllerStyleChange(e.target.checked ? 'operator_allowed' : 'native_only')}
            className="w-4 h-4 rounded mt-0.5"
          />
          <div>
            <label htmlFor="operatorModeEnabled" className="text-[13px] font-medium text-slate-700 cursor-pointer">
              Allow Operator mode for this agent
            </label>
            <div className="text-[11px] text-slate-400 mt-0.5">
              When enabled, the agent can run in Operator mode with elevated tool access. Use with caution.
            </div>
          </div>
        </div>
      </Section>

      <Section title="Allowed Execution Environments">
        <div className="space-y-3">
          {ENVIRONMENT_OPTIONS.map(opt => {
            if (opt.systemAgentOnly && !isSystemAgent) return null;
            return (
              <div key={opt.value} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id={`env-${opt.value}`}
                  checked={allowedEnvironments.includes(opt.value)}
                  onChange={e => toggleEnvironment(opt.value, e.target.checked)}
                  className="w-4 h-4 rounded mt-0.5"
                />
                <label htmlFor={`env-${opt.value}`} className="text-[13px] text-slate-700 cursor-pointer">
                  {opt.label}
                </label>
              </div>
            );
          })}
          <div className="flex items-start gap-3 opacity-40 cursor-not-allowed">
            <input type="checkbox" disabled className="w-4 h-4 rounded mt-0.5" />
            <div>
              <span className="text-[13px] text-slate-700">{SANDBOX_PLACEHOLDER.label}</span>
              <span className="ml-2 text-[11px] text-slate-400">{SANDBOX_PLACEHOLDER.comingSoon}</span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Advanced Scheduling">
        <button
          type="button"
          onClick={() => setScheduleOpen(v => !v)}
          className="flex items-center gap-2 text-[13px] text-indigo-600 hover:text-indigo-800 bg-transparent border-0 cursor-pointer p-0 font-medium"
        >
          <span>{scheduleOpen ? '▾' : '▸'}</span>
          <span>{scheduleOpen ? 'Hide scheduling options' : 'Show scheduling options'}</span>
        </button>

        {scheduleOpen && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className={labelCls}>Cron expression</label>
                <input
                  type="text"
                  value={scheduling.scheduleCron}
                  onChange={e => onSchedulingChange({ ...scheduling, scheduleCron: e.target.value })}
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
                  onChange={e => onSchedulingChange({ ...scheduling, scheduleTimezone: e.target.value })}
                  placeholder="UTC"
                  className={inputCls}
                />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input
                  type="checkbox"
                  id="scheduleEnabled"
                  checked={scheduling.scheduleEnabled}
                  onChange={e => onSchedulingChange({ ...scheduling, scheduleEnabled: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="scheduleEnabled" className="text-[13px] text-slate-700 cursor-pointer">Enable schedule</label>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <div className="text-[13px] font-medium text-slate-700 mb-3">Concurrency</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Concurrency policy</label>
                  <select
                    value={scheduling.concurrencyPolicy}
                    onChange={e => onSchedulingChange({ ...scheduling, concurrencyPolicy: e.target.value as ExecutionTabProps['scheduling']['concurrencyPolicy'] })}
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
                    onChange={e => onSchedulingChange({ ...scheduling, maxConcurrentRuns: Number(e.target.value) })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Catch-up policy</label>
                  <select
                    value={scheduling.catchUpPolicy}
                    onChange={e => onSchedulingChange({ ...scheduling, catchUpPolicy: e.target.value as ExecutionTabProps['scheduling']['catchUpPolicy'] })}
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
                    onChange={e => onSchedulingChange({ ...scheduling, catchUpCap: Number(e.target.value) })}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </Section>

      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="btn btn-primary disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Execution Settings'}
        </button>
        {saved && <span className="text-[13px] text-green-600 font-medium">Saved</span>}
      </div>
    </div>
  );
}

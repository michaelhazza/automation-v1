import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import Modal from '../components/Modal';
import RecurrencePicker, { type RecurrenceValue } from '../components/RecurrencePicker';
import SchedulePicker, {
  type SchedulePickerValue,
  schedulePickerValueToRrule,
} from '../components/SchedulePicker';
import ConfirmDialog from '../components/ConfirmDialog';
import { toast } from 'sonner';

interface ScheduledTask {
  id: string;
  title: string;
  rrule: string;
  timezone: string;
  scheduleTime: string;
  isActive: boolean;
  assignedAgentName: string | null;
  assignedAgentId: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  totalRuns: number;
  totalFailures: number;
  consecutiveFailures: number;
  priority: string;
}

interface Agent { id: string; name: string; }

const INITIAL_FORM = {
  title: '', description: '', brief: '', priority: 'normal',
  assignedAgentId: '', rrule: 'FREQ=WEEKLY;INTERVAL=1', timezone: 'UTC', scheduleTime: '09:00',
  endsAt: null as string | null, endsAfterRuns: null as number | null,
};

// The scheduled task `description` field is the full instructions /
// briefing document that gets injected into the agent's system prompt
// as the "Task Instructions" layer (see spec §7.2). The `brief` field
// is a short summary shown in the task list and board card.

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function ScheduledTasksPage({ user: _user }: { user: { id: string; role: string } }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [items, setItems] = useState<ScheduledTask[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...INITIAL_FORM });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  // Spec §5.6 — default to the universal SchedulePicker; keep the legacy
  // RecurrencePicker accessible via "Advanced recurrence" for the rare
  // non-standard cadence the simple picker cannot express.
  const [useSchedulePicker, setUseSchedulePicker] = useState(true);
  const [scheduleValue, setScheduleValue] = useState<SchedulePickerValue | null>(null);
  // §G4.3 — the simple picker blocks client-side on invalid combinations
  // (past first-run, bad day-of-month, etc) and pushes validity here so
  // Create stays disabled until the user fixes the inline error.
  const [scheduleValid, setScheduleValid] = useState(true);

  useEffect(() => { load(); }, [subaccountId]);

  async function load() {
    try {
      setLoading(true);
      const [stRes, agentsRes] = await Promise.all([
        api.get(`/api/subaccounts/${subaccountId}/scheduled-tasks`),
        api.get(`/api/subaccounts/${subaccountId}/agents`),
      ]);
      setItems(stRes.data);
      setAgents(agentsRes.data?.agents ?? agentsRes.data ?? []);
    } catch { setError('Failed to load'); } finally { setLoading(false); }
  }

  async function handleCreate() {
    try {
      const payload: Record<string, unknown> = { ...form };
      if (!payload.endsAt) delete payload.endsAt;
      if (!payload.endsAfterRuns) delete payload.endsAfterRuns;
      // When the simple picker is active, its value wins over the form's
      // rrule/scheduleTime/timezone fields so the universal pattern is
      // actually exercised end-to-end.
      if (useSchedulePicker && scheduleValue) {
        const bridged = schedulePickerValueToRrule(scheduleValue, form.timezone);
        payload.rrule = bridged.rrule;
        payload.scheduleTime = bridged.scheduleTime;
        payload.timezone = bridged.timezone;
        payload.runNow = scheduleValue.runNow;
      }
      await api.post(`/api/subaccounts/${subaccountId}/scheduled-tasks`, payload);
      setShowForm(false); setForm({ ...INITIAL_FORM }); setScheduleValue(null); await load();
    } catch { setError('Failed to create'); }
  }

  async function handleToggle(id: string, isActive: boolean) {
    try { await api.post(`/api/subaccounts/${subaccountId}/scheduled-tasks/${id}/toggle`, { isActive }); await load(); }
    catch { setError('Failed to toggle'); }
  }

  async function handleConfirmDelete() {
    if (!deleteId) return;
    try {
      await api.delete(`/api/subaccounts/${subaccountId}/scheduled-tasks/${deleteId}`);
      toast.success('Scheduled task deleted');
      await load();
    } catch {
      toast.error('Failed to delete scheduled task');
    } finally {
      setDeleteId(null);
    }
  }

  async function handleRunNow(id: string) {
    try { await api.post(`/api/subaccounts/${subaccountId}/scheduled-tasks/${id}/run-now`); await load(); }
    catch { setError('Failed to trigger'); }
  }

  if (loading) return (
    <div className="p-8">
      <div className="h-48 rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
    </div>
  );

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="mb-6">
        <Link to={`/admin/subaccounts/${subaccountId}`} className="text-[14px] text-indigo-600 hover:text-indigo-700 no-underline">&larr; Back</Link>
        <div className="flex justify-between items-center mt-2">
          <div>
            <h1 className="text-[24px] font-bold text-slate-900 m-0">Scheduled Tasks</h1>
            <p className="text-[14px] text-slate-500 mt-1 m-0">Recurring tasks that fire on a schedule and wake agents automatically.</p>
          </div>
          <button onClick={() => setShowForm(true)} className="btn btn-primary">
            + New Schedule
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg mb-4 text-[14px] flex justify-between items-center">
          {error}
          <button onClick={() => setError('')} className="bg-transparent border-0 cursor-pointer text-red-700 text-lg">&times;</button>
        </div>
      )}

      {showForm && (
        <Modal title="New Scheduled Task" onClose={() => setShowForm(false)} maxWidth={520}>
          <div className="flex flex-col gap-3.5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Title *</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} placeholder="e.g. Weekly Competitor Review" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Agent *</label>
              <select value={form.assignedAgentId} onChange={(e) => setForm({ ...form, assignedAgentId: e.target.value })} className={inputCls}>
                <option value="">Select agent...</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Brief</label>
              <textarea
                value={form.brief}
                onChange={(e) => setForm({ ...form, brief: e.target.value })}
                rows={2}
                className={`${inputCls} resize-vertical`}
                placeholder="Short summary shown in the task list"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1">Instructions</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={8}
                className={`${inputCls} resize-vertical font-mono text-[12px]`}
                placeholder="Detailed instructions the agent follows every time this task runs. Paste the full briefing, steps, and any context the agent needs. This content is injected into the agent's system prompt at run time."
              />
              <div className="text-[11px] text-slate-500 mt-1">
                This becomes the agent's <strong>Task Instructions</strong> layer in the system prompt — treat it like the "project instructions" of a Claude Project.
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[13px] font-medium text-slate-700">Schedule</label>
                <button
                  type="button"
                  onClick={() => setUseSchedulePicker((v) => !v)}
                  className="text-[12px] text-indigo-600 hover:text-indigo-700 cursor-pointer"
                >
                  {useSchedulePicker ? 'Advanced recurrence →' : '← Simple picker'}
                </button>
              </div>
              {useSchedulePicker ? (
                <>
                  <SchedulePicker
                    value={scheduleValue}
                    onChange={setScheduleValue}
                    subaccountTimezone={form.timezone}
                    onValidityChange={setScheduleValid}
                  />
                  <div className="mt-3">
                    <label className="block text-[13px] font-medium text-slate-700 mb-1">Timezone</label>
                    <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className={inputCls}>
                      <option value="UTC">UTC</option>
                      <option value="Pacific/Auckland">NZ (Auckland)</option>
                      <option value="Australia/Sydney">AU (Sydney)</option>
                      <option value="America/New_York">US East</option>
                      <option value="America/Los_Angeles">US West</option>
                      <option value="Europe/London">UK (London)</option>
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <RecurrencePicker
                    value={{ rrule: form.rrule, endsAt: form.endsAt, endsAfterRuns: form.endsAfterRuns }}
                    onChange={(rv: RecurrenceValue) => setForm({ ...form, rrule: rv.rrule, endsAt: rv.endsAt ?? null, endsAfterRuns: rv.endsAfterRuns ?? null })}
                  />
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="block text-[13px] font-medium text-slate-700 mb-1">Time</label>
                      <input type="time" value={form.scheduleTime} onChange={(e) => setForm({ ...form, scheduleTime: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-slate-700 mb-1">Timezone</label>
                      <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className={inputCls}>
                        <option value="UTC">UTC</option>
                        <option value="Pacific/Auckland">NZ (Auckland)</option>
                        <option value="Australia/Sydney">AU (Sydney)</option>
                        <option value="America/New_York">US East</option>
                        <option value="America/Los_Angeles">US West</option>
                        <option value="Europe/London">UK (London)</option>
                      </select>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setShowForm(false)} className="btn btn-secondary">Cancel</button>
              <button
                onClick={handleCreate}
                disabled={
                  !form.title ||
                  !form.assignedAgentId ||
                  (useSchedulePicker && !scheduleValid)
                }
                className="btn btn-primary"
              >
                Create
              </button>
            </div>
          </div>
        </Modal>
      )}

      {items.length === 0 ? (
        <div className="py-16 text-center text-slate-400">
          <p className="text-[16px] mb-2">No scheduled tasks yet</p>
          <p className="text-[14px]">Create one to start automating recurring work.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['Task', 'Agent', 'Schedule', 'Next Run', 'Runs', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="text-left px-3 py-2.5 text-[12px] font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-3 py-3">
                    <Link to={`/admin/subaccounts/${subaccountId}/scheduled-tasks/${item.id}`} className="text-slate-800 no-underline font-medium hover:text-indigo-600">{item.title}</Link>
                  </td>
                  <td className="px-3 py-3 text-[14px] text-slate-600">{item.assignedAgentName ?? '—'}</td>
                  <td className="px-3 py-3 text-[13px] text-slate-600 font-mono">{item.scheduleTime} {item.timezone}</td>
                  <td className="px-3 py-3 text-[13px] text-slate-600">{item.nextRunAt ? new Date(item.nextRunAt).toLocaleString() : '—'}</td>
                  <td className="px-3 py-3 text-[13px]">
                    <span className="text-slate-800">{item.totalRuns}</span>
                    {item.totalFailures > 0 && <span className="text-red-600 ml-1">({item.totalFailures} failed)</span>}
                  </td>
                  <td className="px-3 py-3">
                    {item.isActive ? (
                      <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded text-[12px] font-semibold">Active</span>
                    ) : item.consecutiveFailures >= 3 ? (
                      <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded text-[12px] font-semibold">Auto-Paused</span>
                    ) : (
                      <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[12px] font-semibold">Paused</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1.5">
                      <button onClick={() => handleToggle(item.id, !item.isActive)} className="btn btn-xs btn-secondary">{item.isActive ? 'Pause' : 'Resume'}</button>
                      <button onClick={() => handleRunNow(item.id)} className="btn btn-xs btn-secondary">Run Now</button>
                      <button onClick={() => setDeleteId(item.id)} className="btn btn-xs btn-danger">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Scheduled Task"
          message="Are you sure? This cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}

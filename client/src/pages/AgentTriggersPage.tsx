import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';

interface Trigger {
  id: string;
  name: string;
  eventType: string;
  agentId: string;
  agentName?: string;
  enabled: boolean;
  filterExpression: string | null;
  cooldownMinutes: number | null;
  createdAt: string;
}

export default function AgentTriggersPage() {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', eventType: '', agentId: '', filterExpression: '', cooldownMinutes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, [subaccountId]);

  async function load() {
    try {
      setLoading(true);
      const res = await api.get(`/api/subaccounts/${subaccountId}/triggers`);
      setTriggers(res.data);
    } catch { setError('Failed to load triggers'); }
    finally { setLoading(false); }
  }

  async function handleCreate() {
    if (!form.name.trim() || !form.eventType.trim() || !form.agentId.trim()) return;
    try {
      setSaving(true);
      await api.post(`/api/subaccounts/${subaccountId}/triggers`, {
        name: form.name,
        eventType: form.eventType,
        agentId: form.agentId,
        filterExpression: form.filterExpression || null,
        cooldownMinutes: form.cooldownMinutes ? parseInt(form.cooldownMinutes) : null,
      });
      setShowCreate(false);
      setForm({ name: '', eventType: '', agentId: '', filterExpression: '', cooldownMinutes: '' });
      await load();
    } catch { setError('Failed to create trigger'); }
    finally { setSaving(false); }
  }

  async function handleToggle(trigger: Trigger) {
    try {
      await api.patch(`/api/subaccounts/${subaccountId}/triggers/${trigger.id}`, { enabled: !trigger.enabled });
      await load();
    } catch { setError('Failed to update trigger'); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this trigger?')) return;
    try {
      await api.delete(`/api/subaccounts/${subaccountId}/triggers/${id}`);
      setTriggers(triggers.filter(t => t.id !== id));
    } catch { setError('Failed to delete trigger'); }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="h-6 w-48 rounded mb-4 bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
      </div>
    );
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="mb-2">
        <Link to={`/admin/subaccounts/${subaccountId}`} className="text-[14px] text-indigo-600 hover:text-indigo-700 no-underline">&larr; Back to Company</Link>
      </div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-[24px] font-bold text-slate-900 mt-2 mb-1">Agent Triggers</h1>
          <p className="text-[14px] text-slate-500 m-0">Event-based triggers that automatically run agents when specific events occur.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[13px] cursor-pointer font-semibold">
          New Trigger
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg mb-4 text-[14px] flex justify-between items-center">
          {error}
          <button onClick={() => setError('')} className="bg-transparent border-0 cursor-pointer text-red-700 text-lg">&times;</button>
        </div>
      )}

      {showCreate && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <h3 className="text-[15px] font-semibold text-slate-800 mb-4 mt-0">Create Trigger</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[12px] text-slate-500 font-medium mb-1">Name</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. New task trigger" />
            </div>
            <div>
              <label className="block text-[12px] text-slate-500 font-medium mb-1">Event Type</label>
              <input type="text" value={form.eventType} onChange={e => setForm({ ...form, eventType: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. task.created" />
            </div>
            <div>
              <label className="block text-[12px] text-slate-500 font-medium mb-1">Agent ID</label>
              <input type="text" value={form.agentId} onChange={e => setForm({ ...form, agentId: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Agent UUID" />
            </div>
            <div>
              <label className="block text-[12px] text-slate-500 font-medium mb-1">Cooldown (minutes)</label>
              <input type="number" value={form.cooldownMinutes} onChange={e => setForm({ ...form, cooldownMinutes: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Optional" />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-[12px] text-slate-500 font-medium mb-1">Filter Expression (optional)</label>
            <input type="text" value={form.filterExpression} onChange={e => setForm({ ...form, filterExpression: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. data.priority == 'high'" />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg text-[13px] text-slate-600 cursor-pointer">Cancel</button>
            <button onClick={handleCreate} disabled={saving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white border-0 rounded-lg text-[13px] cursor-pointer font-semibold">{saving ? 'Creating...' : 'Create'}</button>
          </div>
        </div>
      )}

      {triggers.length === 0 ? (
        <div className="py-10 text-center text-[14px] text-slate-400">No triggers configured. Create one to automatically run agents on events.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {triggers.map(trigger => (
            <div key={trigger.id} className="px-5 py-4 bg-white border border-slate-200 rounded-xl flex items-center gap-4">
              <button
                onClick={() => handleToggle(trigger)}
                className={`w-10 h-5 rounded-full relative cursor-pointer border-0 transition-colors ${trigger.enabled ? 'bg-green-500' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${trigger.enabled ? 'left-5' : 'left-0.5'}`} />
              </button>
              <div className="flex-1">
                <div className="font-semibold text-[14px] text-slate-800">{trigger.name}</div>
                <div className="text-[12px] text-slate-500 flex gap-3 mt-0.5">
                  <span>Event: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">{trigger.eventType}</code></span>
                  {trigger.cooldownMinutes && <span>Cooldown: {trigger.cooldownMinutes}m</span>}
                  {trigger.filterExpression && <span>Filter: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">{trigger.filterExpression}</code></span>}
                </div>
              </div>
              <button onClick={() => handleDelete(trigger.id)} className="bg-transparent border-0 text-slate-300 hover:text-red-400 cursor-pointer text-lg px-2">&times;</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

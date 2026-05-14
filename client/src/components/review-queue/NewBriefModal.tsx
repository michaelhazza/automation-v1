import { useState } from 'react';
import api from '../../lib/api';

interface SubaccountAgent {
  id: string;
  agentId: string;
  agentRole: string | null;
  parentSubaccountAgentId: string | null;
  agent: { name: string; icon: string | null };
}

interface Props {
  subaccountId: string;
  agents: SubaccountAgent[];
  onCreated: () => void;
  onClose: () => void;
}

export function NewBriefModal({
  subaccountId,
  agents,
  onCreated,
  onClose,
}: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Pick the top-level agent (no parent) — this is whichever agent sits at the
  // root of the subaccount hierarchy (e.g. CEO, Orchestrator, etc.)
  const defaultAgent =
    agents.find((a) => !a.parentSubaccountAgentId) ??
    agents[0] ??
    null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required'); return; }
    setSaving(true); setError('');
    try {
      await api.post(`/api/subaccounts/${subaccountId}/tasks`, {
        title: title.trim(),
        description: description.trim() || undefined,
        status: 'inbox',
        priority,
        assignedAgentId: defaultAgent?.agentId ?? undefined,
      });
      onCreated();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Failed to create brief');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out_both]">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-[17px] font-bold text-slate-900 m-0">New Brief</h2>
          <button onClick={onClose} className="bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          {defaultAgent && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-[13px] text-amber-800">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a5 5 0 1 0 0 10A5 5 0 0 0 12 2z"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
              Will be assigned to <strong>{defaultAgent.agent.name}</strong>
              {defaultAgent.agentRole && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold capitalize">{defaultAgent.agentRole}</span>}
            </div>
          )}

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Title</label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Description <span className="text-slate-400 font-normal">(optional)</span></label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add more context..."
              rows={4}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          {error && <p className="text-[13px] text-red-600 m-0">{error}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={saving || !title.trim()} className="btn btn-primary">
              {saving ? 'Creating...' : 'Create Brief'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import api from '../lib/api';
import Modal from './Modal';

interface Agent {
  id: string;
  name: string;
  slug: string;
}

interface Activity {
  id: string;
  activityType: string;
  message: string;
  createdAt: string;
  agentId?: string;
}

interface Deliverable {
  id: string;
  deliverableType: string;
  title: string;
  path?: string;
  description?: string;
  createdAt: string;
}

interface TaskData {
  id: string;
  title: string;
  description: string | null;
  brief: string | null;
  status: string;
  priority: string;
  assignedAgentIds: string[];
  assignedAgents: Agent[];
  dueDate: string | null;
  activities: Activity[];
  deliverables: Deliverable[];
}

interface Props {
  subaccountId: string;
  itemId: string;
  agents: Agent[];
  columns: Array<{ key: string; label: string }>;
  onClose: () => void;
  onSaved: () => void;
}

const activityIcons: Record<string, string> = {
  created: '➕',
  assigned: '👤',
  status_changed: '↔',
  progress: '📝',
  completed: '✅',
  note: '💬',
  blocked: '🚫',
};

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-[13px] outline-none w-full';
const labelCls = 'text-xs font-semibold text-slate-500';

export default function TaskModal({ subaccountId, itemId, agents, columns, onClose, onSaved }: Props) {
  const [task, setTask] = useState<TaskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'details' | 'activity' | 'deliverables'>('details');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Edit form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [brief, setBrief] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('normal');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');

  // Activity form
  const [noteMessage, setNoteMessage] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/api/subaccounts/${subaccountId}/tasks/${itemId}`);
      setTask(data);
      setTitle(data.title);
      setDescription(data.description ?? '');
      setBrief(data.brief ?? '');
      setStatus(data.status);
      setPriority(data.priority);
      // Prefer the new assignedAgentIds array; fall back to legacy singular
      const ids: string[] = data.assignedAgentIds?.length
        ? data.assignedAgentIds
        : data.assignedAgentId
          ? [data.assignedAgentId]
          : [];
      setSelectedAgentIds(ids);
      setDueDate(data.dueDate ? data.dueDate.slice(0, 10) : '');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [itemId]);

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds(prev =>
      prev.includes(agentId) ? prev.filter(id => id !== agentId) : [...prev, agentId]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await api.patch(`/api/subaccounts/${subaccountId}/tasks/${itemId}`, {
        title,
        description: description || null,
        brief: brief || null,
        status,
        priority,
        assignedAgentIds: selectedAgentIds,
        dueDate: dueDate || null,
      });
      onSaved();
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleAddNote = async () => {
    if (!noteMessage.trim()) return;
    try {
      await api.post(`/api/subaccounts/${subaccountId}/tasks/${itemId}/activities`, {
        activityType: 'note',
        message: noteMessage,
      });
      setNoteMessage('');
      load();
    } catch {
      // ignore
    }
  };

  if (loading) return <Modal title="Loading..." onClose={onClose}><div className="p-5">Loading...</div></Modal>;
  if (!task) return null;

  const tabs = [
    { key: 'details', label: 'Details' },
    { key: 'activity', label: `Activity (${task.activities.length})` },
    { key: 'deliverables', label: `Deliverables (${task.deliverables.length})` },
  ];

  return (
    <Modal title={task.title} onClose={onClose} maxWidth={640}>
      <div className="flex border-b border-slate-200 mb-4 -mt-1">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={`px-4 py-2 border-0 bg-transparent cursor-pointer text-[13px] border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-indigo-500 text-indigo-500 font-semibold'
                : 'border-transparent text-slate-500 font-normal hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <div className="flex flex-col gap-3 px-1">
          {error && <div className="text-red-500 text-[13px]">{error}</div>}

          <div className="flex flex-col gap-1">
            <label className={labelCls}>Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} />
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls}>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={`${inputCls} resize-y`} />
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls}>Brief</label>
            <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={4} className={`${inputCls} resize-y`} />
          </div>

          <div className="flex gap-3">
            <div className="flex-1 flex flex-col gap-1">
              <label className={labelCls}>Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls}>
                {columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>

            <div className="flex-1 flex flex-col gap-1">
              <label className={labelCls}>Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)} className={inputCls}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls}>
              Assigned Agents
              {selectedAgentIds.length > 0 && (
                <span className="ml-1.5 text-[11px] text-indigo-500 font-normal">
                  {selectedAgentIds.length} selected
                </span>
              )}
            </label>
            {agents.length === 0 ? (
              <div className="text-xs text-slate-400 italic">No agents available</div>
            ) : (
              <div className="border border-gray-300 rounded-lg max-h-40 overflow-y-auto">
                {agents.map((a, i) => (
                  <label
                    key={a.id}
                    className={`flex items-center gap-2 px-3 py-[7px] cursor-pointer text-[13px] text-slate-800 ${
                      i < agents.length - 1 ? 'border-b border-slate-100' : ''
                    } ${selectedAgentIds.includes(a.id) ? 'bg-violet-50' : 'bg-transparent'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedAgentIds.includes(a.id)}
                      onChange={() => toggleAgent(a.id)}
                      className="accent-indigo-500"
                    />
                    {a.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls}>Due Date</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
          </div>

          <button
            onClick={handleSave}
            disabled={saving || !title}
            className={`mt-2 px-5 py-2.5 bg-indigo-500 text-white border-0 rounded-lg cursor-pointer text-sm font-semibold transition-opacity ${saving ? 'opacity-60' : 'hover:bg-indigo-600'} disabled:cursor-not-allowed`}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}

      {tab === 'activity' && (
        <div className="flex flex-col gap-3 px-1">
          <div className="flex gap-2">
            <input
              value={noteMessage}
              onChange={e => setNoteMessage(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddNote()}
              placeholder="Add a note..."
              className={`${inputCls} flex-1`}
            />
            <button
              onClick={handleAddNote}
              disabled={!noteMessage.trim()}
              className={`px-4 py-2 border-0 rounded-lg text-[13px] font-semibold transition-colors ${
                noteMessage.trim()
                  ? 'bg-indigo-500 text-white cursor-pointer hover:bg-indigo-600'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              Add
            </button>
          </div>

          <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
            {task.activities.length === 0 && <div className="text-slate-400 text-[13px] italic">No activity yet</div>}
            {task.activities.map(a => (
              <div key={a.id} className="flex gap-2 py-1.5 border-b border-slate-100">
                <span className="text-sm">{activityIcons[a.activityType] ?? '•'}</span>
                <div className="flex-1">
                  <div className="text-[13px] text-slate-800">{a.message}</div>
                  <div className="text-[11px] text-slate-400">{new Date(a.createdAt).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'deliverables' && (
        <div className="flex flex-col gap-2 px-1">
          {task.deliverables.length === 0 && <div className="text-slate-400 text-[13px] italic">No deliverables yet</div>}
          {task.deliverables.map(d => (
            <div key={d.id} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="text-[13px] font-semibold text-slate-800">{d.title}</span>
                <span className="text-[10px] text-slate-400 bg-slate-200 px-1.5 py-px rounded">{d.deliverableType}</span>
              </div>
              {d.description && <div className="text-xs text-slate-500 mt-1">{d.description}</div>}
              {d.path && (
                <a href={d.path} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 mt-1 block">
                  {d.path}
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

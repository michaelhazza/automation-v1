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

  if (loading) return <Modal title="Loading..." onClose={onClose}><div style={{ padding: 20 }}>Loading...</div></Modal>;
  if (!task) return null;

  const tabs = [
    { key: 'details', label: 'Details' },
    { key: 'activity', label: `Activity (${task.activities.length})` },
    { key: 'deliverables', label: `Deliverables (${task.deliverables.length})` },
  ];

  return (
    <Modal title={task.title} onClose={onClose} maxWidth={640}>
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', marginBottom: 16 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            style={{
              padding: '8px 16px',
              border: 'none',
              background: 'none',
              borderBottom: tab === t.key ? '2px solid #6366f1' : '2px solid transparent',
              color: tab === t.key ? '#6366f1' : '#64748b',
              fontWeight: tab === t.key ? 600 : 400,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 4px' }}>
          {error && <div style={{ color: '#ef4444', fontSize: 13 }}>{error}</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={labelStyle}>Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={labelStyle}>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' as const }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={labelStyle}>Brief</label>
            <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={4} style={{ ...inputStyle, resize: 'vertical' as const }} />
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={labelStyle}>Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
                {columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={labelStyle}>Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)} style={inputStyle}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={labelStyle}>
              Assigned Agents
              {selectedAgentIds.length > 0 && (
                <span style={{ marginLeft: 6, fontSize: 11, color: '#6366f1', fontWeight: 400 }}>
                  {selectedAgentIds.length} selected
                </span>
              )}
            </label>
            {agents.length === 0 ? (
              <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>No agents available</div>
            ) : (
              <div style={{
                border: '1px solid #d1d5db',
                borderRadius: 8,
                maxHeight: 160,
                overflowY: 'auto' as const,
              }}>
                {agents.map((a, i) => (
                  <label
                    key={a.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 12px',
                      cursor: 'pointer',
                      borderBottom: i < agents.length - 1 ? '1px solid #f1f5f9' : 'none',
                      background: selectedAgentIds.includes(a.id) ? '#f5f3ff' : 'transparent',
                      fontSize: 13,
                      color: '#1e293b',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedAgentIds.includes(a.id)}
                      onChange={() => toggleAgent(a.id)}
                      style={{ accentColor: '#6366f1' }}
                    />
                    {a.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={labelStyle}>Due Date</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inputStyle} />
          </div>

          <button
            onClick={handleSave}
            disabled={saving || !title}
            style={{
              marginTop: 8,
              padding: '10px 20px',
              background: '#6366f1',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}

      {tab === 'activity' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 4px' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={noteMessage}
              onChange={e => setNoteMessage(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddNote()}
              placeholder="Add a note..."
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={handleAddNote}
              disabled={!noteMessage.trim()}
              style={{
                padding: '8px 16px',
                background: noteMessage.trim() ? '#6366f1' : '#e2e8f0',
                color: noteMessage.trim() ? '#fff' : '#94a3b8',
                border: 'none',
                borderRadius: 8,
                cursor: noteMessage.trim() ? 'pointer' : 'not-allowed',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Add
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' as const }}>
            {task.activities.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13, fontStyle: 'italic' }}>No activity yet</div>}
            {task.activities.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ fontSize: 14 }}>{activityIcons[a.activityType] ?? '•'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: '#1e293b' }}>{a.message}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(a.createdAt).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'deliverables' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 4px' }}>
          {task.deliverables.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13, fontStyle: 'italic' }}>No deliverables yet</div>}
          {task.deliverables.map(d => (
            <div key={d.id} style={{ padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{d.title}</span>
                <span style={{ fontSize: 10, color: '#94a3b8', background: '#e2e8f0', padding: '1px 6px', borderRadius: 4 }}>{d.deliverableType}</span>
              </div>
              {d.description && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{d.description}</div>}
              {d.path && (
                <a href={d.path} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#6366f1', marginTop: 4, display: 'block' }}>
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

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#475569',
};

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 13,
  outline: 'none',
};

import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import TaskCard from '../components/TaskCard';
import TaskModal from '../components/TaskModal';
import Modal from '../components/Modal';
import { type User } from '../lib/auth';

interface BoardColumn {
  key: string;
  label: string;
  colour: string;
  description: string;
  locked: boolean;
}

interface Agent {
  id: string;
  name: string;
  slug: string;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  position: number;
  assignedAgent: { id: string; name: string; slug: string } | null;
  assignedAgentId: string | null;
  dueDate: string | null;
  createdAt: string;
}

export default function WorkspaceBoardPage({ user }: { user: User }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [subaccountName, setSubaccountName] = useState('');

  // Create form
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState('normal');
  const [newStatus, setNewStatus] = useState('inbox');
  const [newAgentId, setNewAgentId] = useState('');

  // Drag state
  const [dragItem, setDragItem] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!subaccountId) return;
    setLoading(true);
    try {
      const [configRes, tasksRes, agentsRes, saRes] = await Promise.all([
        api.get(`/api/subaccounts/${subaccountId}/board-config`).catch((err) => {
          console.error('[WorkspaceBoardPage] board-config fetch failed:', err.response?.status, err.response?.data);
          return { data: null };
        }),
        api.get(`/api/subaccounts/${subaccountId}/tasks`),
        api.get('/api/agents'),
        api.get(`/api/subaccounts/${subaccountId}`),
      ]);
      console.log('[WorkspaceBoardPage] board-config response:', configRes.data ? { id: configRes.data.id, columnsCount: configRes.data.columns?.length } : null);
      setColumns(configRes.data?.columns ?? []);
      setTasks(tasksRes.data);
      setAgents(agentsRes.data.filter((a: { status: string }) => a.status === 'active'));
      setSubaccountName(saRes.data.name);
    } finally {
      setLoading(false);
    }
  }, [subaccountId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newTitle.trim() || !subaccountId) return;
    try {
      await api.post(`/api/subaccounts/${subaccountId}/tasks`, {
        title: newTitle,
        priority: newPriority,
        status: newStatus,
        assignedAgentId: newAgentId || undefined,
      });
      setShowCreateForm(false);
      setNewTitle('');
      setNewPriority('normal');
      setNewStatus('inbox');
      setNewAgentId('');
      load();
    } catch {
      // ignore
    }
  };

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDragItem(itemId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    if (!dragItem || !subaccountId) return;

    const task = tasks.find(i => i.id === dragItem);
    if (!task || task.status === targetStatus) {
      setDragItem(null);
      return;
    }

    // Optimistic update
    setTasks(prev => prev.map(i => i.id === dragItem ? { ...i, status: targetStatus } : i));
    setDragItem(null);

    // Calculate position (append to end)
    const columnTasks = tasks.filter(i => i.status === targetStatus);
    const maxPos = columnTasks.reduce((max, i) => Math.max(max, i.position), 0);
    const newPosition = maxPos + 1000;

    try {
      await api.patch(`/api/subaccounts/${subaccountId}/tasks/${dragItem}/move`, {
        status: targetStatus,
        position: newPosition,
      });
      load();
    } catch {
      load(); // Revert on failure
    }
  };

  if (loading) return <div style={{ padding: 40 }}>Loading...</div>;

  if (columns.length === 0) {
    return (
      <div style={{ padding: 40 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>Workspace Board</h1>
        <p style={{ color: '#64748b' }}>
          This subaccount has no board configuration yet.{' '}
          <Link to={`/admin/subaccounts/${subaccountId}`} style={{ color: '#6366f1' }}>
            Go to subaccount settings
          </Link>{' '}
          to initialise the board, or configure the{' '}
          <Link to="/admin/settings" style={{ color: '#6366f1' }}>
            organisation board
          </Link>{' '}
          first.
        </p>
      </div>
    );
  }

  const getColumnTasks = (key: string) =>
    tasks.filter(i => i.status === key).sort((a, b) => a.position - b.position);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', margin: 0 }}>
            {subaccountName} — Workspace
          </h1>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
            {tasks.length} task{tasks.length !== 1 ? 's' : ''} across {columns.length} columns
          </div>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          style={{ padding: '10px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
        >
          + New Task
        </button>
      </div>

      {/* Board — fills width on desktop, horizontal scroll on mobile */}
      <div
        className="board-scroll"
        style={{
          display: 'flex',
          gap: 12,
          flex: 1,
          overflowX: 'auto',
          paddingBottom: 16,
          minHeight: 0,
        }}
      >
        {columns.map(col => {
          const colTasks = getColumnTasks(col.key);
          return (
            <div
              key={col.key}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, col.key)}
              style={{
                flex: '1 1 0',
                minWidth: 240,
                maxWidth: columns.length <= 4 ? undefined : 320,
                display: 'flex',
                flexDirection: 'column',
                background: '#f8fafc',
                borderRadius: 12,
                border: '1px solid #e2e8f0',
                minHeight: 200,
              }}
            >
              {/* Column header */}
              <div
                style={{
                  padding: '10px 14px',
                  borderBottom: `3px solid ${col.colour}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{col.label}</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: col.colour,
                      background: col.colour + '20',
                      padding: '1px 7px',
                      borderRadius: 10,
                    }}
                  >
                    {colTasks.length}
                  </span>
                </div>
              </div>

              {/* Cards */}
              <div style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
                {colTasks.map(task => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    style={{ opacity: dragItem === task.id ? 0.4 : 1 }}
                  >
                    <TaskCard
                      item={task}
                      onClick={() => setSelectedItemId(task.id)}
                    />
                  </div>
                ))}
                {colTasks.length === 0 && (
                  <div style={{ padding: '20px 0', textAlign: 'center', color: '#cbd5e1', fontSize: 12, fontStyle: 'italic' }}>
                    Drop tasks here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Task detail modal */}
      {selectedItemId && subaccountId && (
        <TaskModal
          subaccountId={subaccountId}
          itemId={selectedItemId}
          agents={agents}
          columns={columns}
          onClose={() => setSelectedItemId(null)}
          onSaved={load}
        />
      )}

      {/* Create form modal */}
      {showCreateForm && (
        <Modal title="New Task" onClose={() => setShowCreateForm(false)} maxWidth={480}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Title *</label>
              <input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="What needs to be done?"
                autoFocus
                style={inputStyle}
              />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Column</label>
                <select value={newStatus} onChange={e => setNewStatus(e.target.value)} style={inputStyle}>
                  {columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Priority</label>
                <select value={newPriority} onChange={e => setNewPriority(e.target.value)} style={inputStyle}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Assign Agent</label>
              <select value={newAgentId} onChange={e => setNewAgentId(e.target.value)} style={inputStyle}>
                <option value="">Unassigned</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>

            <button
              onClick={handleCreate}
              disabled={!newTitle.trim()}
              style={{
                marginTop: 8,
                padding: '10px 20px',
                background: newTitle.trim() ? '#6366f1' : '#e2e8f0',
                color: newTitle.trim() ? '#fff' : '#94a3b8',
                border: 'none',
                borderRadius: 8,
                cursor: newTitle.trim() ? 'pointer' : 'not-allowed',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Create Task
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 13,
  outline: 'none',
};

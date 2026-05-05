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
  assignedAgents: Array<{ id: string; name: string | null; slug: string | null }>;
  assignedAgent: { id: string; name: string | null; slug: string | null } | null;
  assignedAgentId: string | null;
  dueDate: string | null;
  createdAt: string;
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px] outline-none bg-white focus:ring-2 focus:ring-indigo-500';

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
      const safeFetch = (url: string, fallback: any = null) =>
        api.get(url).catch((err) => {
          console.error(`[WorkspaceBoardPage] ${url} failed:`, err.response?.status, err.response?.data);
          return { data: fallback };
        });

      const [configRes, tasksRes, agentsRes, saRes] = await Promise.all([
        safeFetch(`/api/subaccounts/${subaccountId}/board-config`),
        safeFetch(`/api/subaccounts/${subaccountId}/tasks`, []),
        safeFetch('/api/agents', []),
        safeFetch(`/api/subaccounts/${subaccountId}`, { name: '' }),
      ]);
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

  if (loading) return <div className="p-10">Loading...</div>;

  if (columns.length === 0) {
    return (
      <div className="p-10">
        <h1 className="text-[28px] font-bold text-slate-800 mb-2">Workspace Board</h1>
        <p className="text-slate-500">
          This subaccount has no board configuration yet.{' '}
          <Link to={`/admin/subaccounts/${subaccountId}?tab=board`} className="text-indigo-500 no-underline hover:underline">
            Go to subaccount settings
          </Link>{' '}
          to initialise the board, or configure the{' '}
          <Link to="/admin/settings" className="text-indigo-500 no-underline hover:underline">
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
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 m-0">
            {subaccountName} — Workspace
          </h1>
          <div className="text-[13px] text-slate-400 mt-0.5">
            {tasks.length} task{tasks.length !== 1 ? 's' : ''} across {columns.length} columns
          </div>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-5 py-2.5 bg-indigo-500 text-white border-0 rounded-lg cursor-pointer text-[14px] font-semibold hover:bg-indigo-600 transition-colors"
        >
          + New Task
        </button>
      </div>

      {/* Board — fills width on desktop, horizontal scroll on mobile */}
      <div className="flex gap-3 flex-1 overflow-x-auto pb-4 min-h-0 [scrollbar-width:thin]">
        {columns.map(col => {
          const colTasks = getColumnTasks(col.key);
          return (
            <div
              key={col.key}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, col.key)}
              className={`flex-1 min-w-[240px] flex flex-col bg-slate-50 rounded-xl border border-slate-200 min-h-[200px] ${columns.length > 4 ? 'max-w-[320px]' : ''}`}
            >
              {/* Column header */}
              <div
                className="px-3.5 py-2.5 flex justify-between items-center"
                style={{ borderBottom: `3px solid ${col.colour}` }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-slate-800">{col.label}</span>
                  <span
                    className="text-[11px] font-bold px-[7px] py-px rounded-[10px]"
                    style={{ color: col.colour, background: col.colour + '20' }}
                  >
                    {colTasks.length}
                  </span>
                </div>
              </div>

              {/* Cards */}
              <div className="flex-1 p-2 flex flex-col gap-2 overflow-y-auto">
                {colTasks.map(task => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    className={dragItem === task.id ? 'opacity-40' : ''}
                  >
                    <TaskCard
                      item={task}
                      onClick={() => setSelectedItemId(task.id)}
                    />
                  </div>
                ))}
                {colTasks.length === 0 && (
                  <div className="py-5 text-center text-slate-300 text-[12px] italic">
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
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-semibold text-slate-600">Title *</label>
              <input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="What needs to be done?"
                autoFocus
                className={inputCls}
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-[12px] font-semibold text-slate-600">Column</label>
                <select value={newStatus} onChange={e => setNewStatus(e.target.value)} className={inputCls}>
                  {columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-[12px] font-semibold text-slate-600">Priority</label>
                <select value={newPriority} onChange={e => setNewPriority(e.target.value)} className={inputCls}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-semibold text-slate-600">Assign Agent</label>
              <select value={newAgentId} onChange={e => setNewAgentId(e.target.value)} className={inputCls}>
                <option value="">Unassigned</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>

            <button
              onClick={handleCreate}
              disabled={!newTitle.trim()}
              className={`mt-2 px-5 py-2.5 border-0 rounded-lg text-[14px] font-semibold transition-colors ${newTitle.trim() ? 'bg-indigo-500 hover:bg-indigo-600 text-white cursor-pointer' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
            >
              Create Task
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

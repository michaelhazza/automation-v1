import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User, getActiveClientId } from '../lib/auth';
import ConfirmDialog from '../components/ConfirmDialog';

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  color: string;
  targetDate: string | null;
  budgetCents: number | null;
  budgetWarningPercent: number | null;
  createdAt: string;
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
}

export default function ProjectDetailPage({ user: _user }: { user: User }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const activeClientId = getActiveClientId();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDelete, setShowDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTargetDate, setEditTargetDate] = useState('');
  const [editBudget, setEditBudget] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id || !activeClientId) return;
    setLoading(true);
    Promise.all([
      api.get(`/api/subaccounts/${activeClientId}/projects/${id}`),
      api.get(`/api/subaccounts/${activeClientId}/tasks`, { params: { projectId: id } }).catch((err) => { console.error('[ProjectDetail] Failed to fetch tasks:', err); return { data: [] }; }),
    ]).then(([pRes, tRes]) => {
      setProject(pRes.data);
      setTasks(tRes.data);
      setEditName(pRes.data.name);
      setEditDescription(pRes.data.description ?? '');
      setEditTargetDate(pRes.data.targetDate ? pRes.data.targetDate.split('T')[0] : '');
      setEditBudget(pRes.data.budgetCents != null ? String(pRes.data.budgetCents / 100) : '');
    }).catch((err) => {
      console.error('[ProjectDetail] Failed to load project:', err);
      navigate('/');
    }).finally(() => setLoading(false));
  }, [id, activeClientId]);

  const handleDelete = async () => {
    if (!id || !activeClientId) return;
    await api.delete(`/api/subaccounts/${activeClientId}/projects/${id}`);
    navigate('/');
  };

  const handleSave = async () => {
    if (!id || !activeClientId) return;
    setSaving(true);
    try {
      const { data } = await api.patch(`/api/subaccounts/${activeClientId}/projects/${id}`, {
        name: editName.trim(),
        description: editDescription.trim() || null,
        targetDate: editTargetDate || null,
        budgetCents: editBudget ? Math.round(parseFloat(editBudget) * 100) : null,
      });
      setProject(data);
      setEditing(false);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  if (loading) return <div className="p-12 text-center text-sm text-slate-500">Loading...</div>;
  if (!project) return <div className="p-12 text-center text-sm text-slate-500">Project not found</div>;

  const STATUS_CLS: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    completed: 'bg-blue-100 text-blue-800',
    archived: 'bg-slate-100 text-slate-600',
  };

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both] max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className="w-4 h-4 rounded-full shrink-0" style={{ background: project.color }} />
          {editing ? (
            <div className="flex flex-col gap-2">
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="text-[24px] font-bold text-slate-900 border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Add a description..."
                rows={2}
                className="text-[14px] text-slate-600 border border-slate-200 rounded-lg px-2 py-1.5 resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500 w-[400px]"
              />
              <div className="flex gap-3 mt-1">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-slate-500 font-medium">Target Date</label>
                  <input type="date" value={editTargetDate} onChange={(e) => setEditTargetDate(e.target.value)} className="text-[13px] border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-slate-500 font-medium">Budget ($/mo)</label>
                  <input type="number" step="0.01" min="0" value={editBudget} onChange={(e) => setEditBudget(e.target.value)} placeholder="No limit" className="text-[13px] border border-slate-200 rounded-lg px-2 py-1.5 w-[120px] focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[13px] font-medium cursor-pointer">{saving ? 'Saving...' : 'Save'}</button>
                <button onClick={() => setEditing(false)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-lg text-[13px] font-medium cursor-pointer">Cancel</button>
              </div>
            </div>
          ) : (
            <div>
              <h1 className="text-[24px] font-bold text-slate-900 m-0">{project.name}</h1>
              {project.description && <p className="text-[14px] text-slate-500 mt-1 m-0">{project.description}</p>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize ${STATUS_CLS[project.status] ?? STATUS_CLS.active}`}>
            {project.status}
          </span>
          {!editing && (
            <>
              <button onClick={() => setEditing(true)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-[13px] font-medium cursor-pointer transition-colors">Edit</button>
              <button onClick={() => setShowDelete(true)} className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-lg text-[13px] font-medium cursor-pointer transition-colors">Delete</button>
            </>
          )}
        </div>
      </div>

      {/* Project metadata */}
      <div className="flex gap-4 mb-4 text-[13px] text-slate-500">
        {project.targetDate && (
          <span>Target: {new Date(project.targetDate).toLocaleDateString()}</span>
        )}
        {project.budgetCents != null && (
          <span>Budget: ${(project.budgetCents / 100).toFixed(2)}/mo</span>
        )}
      </div>

      {/* Tasks in this project */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
          <h2 className="text-[14px] font-semibold text-slate-700 m-0">Tasks ({tasks.length})</h2>
        </div>
        {tasks.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-slate-500">
            No tasks in this project yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {tasks.map((task) => (
              <div key={task.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div>
                  <div className="font-medium text-[14px] text-slate-800">{task.title}</div>
                  <div className="text-[12px] text-slate-400 mt-0.5">{new Date(task.createdAt).toLocaleDateString()}</div>
                </div>
                <span className="text-[12px] capitalize px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{task.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showDelete && (
        <ConfirmDialog
          title="Delete project"
          message={`Delete "${project.name}"? Tasks will be unlinked but not deleted.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}

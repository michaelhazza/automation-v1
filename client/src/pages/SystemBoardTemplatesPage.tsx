import { useEffect, useState } from 'react';
import api from '../lib/api';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import BoardColumnEditor, { type BoardColumn } from '../components/BoardColumnEditor';
import { type User } from '../lib/auth';

interface BoardTemplate {
  id: string;
  name: string;
  description: string | null;
  columns: BoardColumn[];
  isDefault: boolean;
  createdAt: string;
}

const defaultColumns: BoardColumn[] = [
  { key: 'inbox', label: 'Inbox', colour: '#6366f1', description: 'New items awaiting triage', locked: true },
  { key: 'todo', label: 'To Do', colour: '#8b5cf6', description: 'Ready to be worked on', locked: false },
  { key: 'in_progress', label: 'In Progress', colour: '#3b82f6', description: 'Currently being worked on', locked: false },
  { key: 'done', label: 'Done', colour: '#22c55e', description: 'Completed', locked: true },
];

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function SystemBoardTemplatesPage({ user: _user }: { user: User }) {
  const [templates, setTemplates] = useState<BoardTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [columns, setColumns] = useState<BoardColumn[]>(defaultColumns);
  const [isDefault, setIsDefault] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/system/board-templates');
      setTemplates(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setName('');
    setDescription('');
    setColumns(defaultColumns);
    setIsDefault(false);
    setEditId(null);
    setError('');
  };

  const openEdit = (t: BoardTemplate) => {
    setName(t.name);
    setDescription(t.description ?? '');
    setColumns(t.columns);
    setIsDefault(t.isDefault);
    setEditId(t.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    setError('');
    try {
      if (editId) {
        await api.patch(`/api/system/board-templates/${editId}`, { name, description, columns, isDefault });
      } else {
        await api.post('/api/system/board-templates', { name, description, columns, isDefault });
      }
      setShowForm(false);
      resetForm();
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to save');
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/system/board-templates/${deleteId}`);
      setDeleteId(null);
      load();
    } catch {
      // ignore
    }
  };

  if (loading) return <div className="p-10 text-sm text-slate-500">Loading...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-[28px] font-bold text-slate-800 m-0">Board Templates</h1>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg cursor-pointer text-[14px] font-semibold transition-colors"
        >
          + New Template
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {templates.length === 0 && (
          <div className="text-slate-400 italic">No templates yet. Create one to get started.</div>
        )}
        {templates.map(t => (
          <div key={t.id} className="p-4 bg-white border border-slate-200 rounded-xl">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[16px] font-semibold text-slate-800">{t.name}</span>
                {t.isDefault && (
                  <span className="text-[11px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Default</span>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(t)} className="bg-transparent border-0 text-indigo-600 cursor-pointer text-[13px] font-semibold hover:text-indigo-800 transition-colors">Edit</button>
                <button onClick={() => setDeleteId(t.id)} className="bg-transparent border-0 text-red-500 cursor-pointer text-[13px] font-semibold hover:text-red-700 transition-colors">Delete</button>
              </div>
            </div>
            {t.description && <div className="text-[13px] text-slate-500 mb-2">{t.description}</div>}
            <div className="flex gap-1.5 flex-wrap">
              {t.columns.map(c => (
                <span
                  key={c.key}
                  className="text-[11px] px-2.5 py-0.5 rounded font-semibold"
                  style={{ background: `${c.colour}20`, color: c.colour }}
                >
                  {c.label}{c.locked ? ' 🔒' : ''}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <Modal title={editId ? 'Edit Template' : 'New Template'} onClose={() => { setShowForm(false); resetForm(); }} maxWidth={560}>
          <div className="flex flex-col gap-3">
            {error && <div className="text-red-500 text-[13px]">{error}</div>}
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Template name" className={inputCls} />
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description" rows={2} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[14px] bg-white resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <label className="flex items-center gap-2 text-[13px] text-slate-600 cursor-pointer">
              <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} /> Set as default template
            </label>
            <div className="mt-2">
              <div className="text-[13px] font-semibold text-slate-600 mb-2">Columns</div>
              <BoardColumnEditor columns={columns} onChange={setColumns} />
            </div>
            <button
              onClick={handleSave}
              disabled={!name || columns.length === 0}
              className="mt-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white border-0 rounded-lg cursor-pointer text-[14px] font-semibold transition-colors"
            >
              {editId ? 'Save Changes' : 'Create Template'}
            </button>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Template"
          message="Are you sure you want to delete this board template?"
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}

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

  if (loading) return <div style={{ padding: 40 }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>Board Templates</h1>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          style={{ padding: '10px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
        >
          + New Template
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {templates.length === 0 && <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>No templates yet. Create one to get started.</div>}
        {templates.map(t => (
          <div key={t.id} style={{ padding: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <span style={{ fontSize: 16, fontWeight: 600, color: '#1e293b' }}>{t.name}</span>
                {t.isDefault && (
                  <span style={{ marginLeft: 8, fontSize: 11, background: '#dbeafe', color: '#2563eb', padding: '2px 8px', borderRadius: 4 }}>
                    Default
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => openEdit(t)} style={linkBtnStyle}>Edit</button>
                <button onClick={() => setDeleteId(t.id)} style={{ ...linkBtnStyle, color: '#ef4444' }}>Delete</button>
              </div>
            </div>
            {t.description && <div style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>{t.description}</div>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
              {t.columns.map(c => (
                <span key={c.key} style={{ fontSize: 11, padding: '3px 10px', background: c.colour + '20', color: c.colour, borderRadius: 4, fontWeight: 600 }}>
                  {c.label}{c.locked ? ' 🔒' : ''}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <Modal title={editId ? 'Edit Template' : 'New Template'} onClose={() => { setShowForm(false); resetForm(); }} maxWidth={560}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {error && <div style={{ color: '#ef4444', fontSize: 13 }}>{error}</div>}
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Template name" style={inputStyle} />
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description" rows={2} style={{ ...inputStyle, resize: 'vertical' as const }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569' }}>
              <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} /> Set as default template
            </label>
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 8 }}>Columns</div>
              <BoardColumnEditor columns={columns} onChange={setColumns} />
            </div>
            <button
              onClick={handleSave}
              disabled={!name || columns.length === 0}
              style={{ marginTop: 8, padding: '10px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
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

const inputStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 };
const linkBtnStyle: React.CSSProperties = { background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 13, fontWeight: 600 };

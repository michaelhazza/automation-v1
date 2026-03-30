import { useEffect, useState } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface Permission { key: string; description: string; groupName: string; }
interface PermissionSet { id: string; name: string; description: string | null; isDefault: boolean; permissionKeys: string[]; }

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function AdminPermissionSetsPage({ user: _user }: { user: User }) {
  const [sets, setSets] = useState<PermissionSet[]>([]);
  const [allPerms, setAllPerms] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [editSet, setEditSet] = useState<PermissionSet | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    try {
      const [setsRes, permsRes] = await Promise.all([
        api.get('/api/permission-sets'),
        api.get('/api/permissions'),
      ]);
      setSets(setsRes.data);
      setAllPerms(permsRes.data);
    } catch {
      // Permission denied
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setError('');
    try {
      await api.post('/api/permission-sets', createForm);
      setShowCreateForm(false); setCreateForm({ name: '', description: '' }); load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to create permission set');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/permission-sets/${deleteId}`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to delete permission set');
    }
    setDeleteId(null); load();
  };

  const handleSaveKeys = async (setId: string, keys: string[]) => {
    setError(''); setSuccess('');
    try {
      await api.put(`/api/permission-sets/${setId}/items`, { permissionKeys: keys });
      setSuccess('Permission set updated'); load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to update permission keys');
    }
  };

  const permsByGroup = allPerms.reduce<Record<string, Permission[]>>((acc, p) => {
    if (!acc[p.groupName]) acc[p.groupName] = [];
    acc[p.groupName].push(p);
    return acc;
  }, {});

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  return (
    <div className="page-enter">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">Permission Sets</h1>
          <p className="text-sm text-slate-500 mt-2">Define reusable bundles of permissions for org users and subaccount members</p>
        </div>
        <button
          onClick={() => { setShowCreateForm(true); setError(''); }}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          + New set
        </button>
      </div>

      {error && <div className="text-[13px] text-red-600 mb-4">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 mb-4 text-[13px] text-green-700">{success}</div>}

      {showCreateForm && (
        <Modal title="New permission set" onClose={() => setShowCreateForm(false)} maxWidth={400}>
          <div className="grid gap-3.5 mb-5">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name *</label>
              <input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Description</label>
              <textarea value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} rows={2} className={`${inputCls} resize-vertical`} />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleCreate} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors">Create</button>
            <button onClick={() => setShowCreateForm(false)} className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px] font-medium rounded-lg transition-colors">Cancel</button>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog title="Delete permission set" message="Delete this permission set? Users assigned to it will lose their permissions." confirmLabel="Delete" onConfirm={handleDeleteConfirm} onCancel={() => setDeleteId(null)} />
      )}

      {editSet && (
        <PermissionSetEditor
          set={editSet}
          permsByGroup={permsByGroup}
          onSave={(keys) => { handleSaveKeys(editSet.id, keys); setEditSet(null); }}
          onClose={() => setEditSet(null)}
        />
      )}

      <div className="flex flex-col gap-3">
        {sets.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl py-12 text-center text-sm text-slate-500">
            No permission sets yet.
          </div>
        ) : sets.map((ps) => (
          <div key={ps.id} className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-1">
                <span className="font-semibold text-[15px] text-slate-800">{ps.name}</span>
                {ps.isDefault && (
                  <span className="text-[11px] bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 font-medium">default</span>
                )}
              </div>
              {ps.description && <div className="text-[13px] text-slate-500 mb-1.5">{ps.description}</div>}
              <div className="text-xs text-slate-400">{ps.permissionKeys.length} permission{ps.permissionKeys.length !== 1 ? 's' : ''}</div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setEditSet(ps)}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[13px] font-medium transition-colors"
              >
                Edit permissions
              </button>
              {!ps.isDefault && (
                <button
                  onClick={() => setDeleteId(ps.id)}
                  className="px-3.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-[13px] font-medium transition-colors"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PermissionSetEditor({
  set, permsByGroup, onSave, onClose,
}: {
  set: PermissionSet;
  permsByGroup: Record<string, Permission[]>;
  onSave: (keys: string[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(set.permissionKeys));

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleGroup = (keys: string[]) => {
    const allSelected = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });
  };

  return (
    <Modal title={`Edit: ${set.name}`} onClose={onClose} maxWidth={560}>
      <div className="max-h-[400px] overflow-y-auto mb-5">
        {Object.entries(permsByGroup).map(([group, perms]) => {
          const groupKeys = perms.map((p) => p.key);
          const allGroupSelected = groupKeys.every((k) => selected.has(k));
          return (
            <div key={group} className="mb-4">
              <div
                className="flex items-center gap-2 mb-1.5 cursor-pointer"
                onClick={() => toggleGroup(groupKeys)}
              >
                <input type="checkbox" readOnly checked={allGroupSelected} className="cursor-pointer" />
                <span className="text-[12px] font-bold text-slate-600 uppercase tracking-wider">{group}</span>
              </div>
              <div className="pl-5">
                {perms.map((p) => (
                  <label key={p.key} className="flex items-center gap-2 mb-1 cursor-pointer">
                    <input type="checkbox" checked={selected.has(p.key)} onChange={() => toggle(p.key)} className="cursor-pointer" />
                    <span className="text-[13px] text-slate-700">{p.description}</span>
                    <span className="text-[11px] text-slate-400 font-mono">({p.key})</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-3">
        <button onClick={() => onSave([...selected])} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors">
          Save ({selected.size} selected)
        </button>
        <button onClick={onClose} className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px] font-medium rounded-lg transition-colors">Cancel</button>
      </div>
    </Modal>
  );
}

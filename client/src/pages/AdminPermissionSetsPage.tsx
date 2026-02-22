import { useEffect, useState } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface Permission {
  key: string;
  description: string;
  groupName: string;
}

interface PermissionSet {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  permissionKeys: string[];
}

export default function AdminPermissionSetsPage({ user }: { user: User }) {
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
      // Permission denied — user doesn't have org.permission_sets.manage
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setError('');
    try {
      await api.post('/api/permission-sets', createForm);
      setShowCreateForm(false);
      setCreateForm({ name: '', description: '' });
      load();
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
    setDeleteId(null);
    load();
  };

  const handleSaveKeys = async (setId: string, keys: string[]) => {
    setError('');
    setSuccess('');
    try {
      await api.put(`/api/permission-sets/${setId}/items`, { permissionKeys: keys });
      setSuccess('Permission set updated');
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to update permission keys');
    }
  };

  // Group permissions by groupName for the editor UI
  const permsByGroup = allPerms.reduce<Record<string, Permission[]>>((acc, p) => {
    const g = p.groupName;
    if (!acc[g]) acc[g] = [];
    acc[g].push(p);
    return acc;
  }, {});

  if (loading) return <div>Loading...</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>Permission Sets</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0' }}>Define reusable bundles of permissions for org users and subaccount members</p>
        </div>
        <button
          onClick={() => { setShowCreateForm(true); setError(''); }}
          style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}
        >
          + New set
        </button>
      </div>

      {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 16 }}>{error}</div>}
      {success && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#16a34a', fontSize: 13 }}>{success}</div>}

      {showCreateForm && (
        <Modal title="New permission set" onClose={() => setShowCreateForm(false)} maxWidth={400}>
          <div style={{ display: 'grid', gap: 14, marginBottom: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Name *</label>
              <input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Description</label>
              <textarea value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} rows={2} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleCreate} style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Create</button>
            <button onClick={() => setShowCreateForm(false)} style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </Modal>
      )}

      {deleteId && (
        <ConfirmDialog title="Delete permission set" message="Delete this permission set? Users assigned to it will lose their permissions." confirmLabel="Delete" onConfirm={handleDeleteConfirm} onCancel={() => setDeleteId(null)} />
      )}

      {/* Edit modal */}
      {editSet && (
        <PermissionSetEditor
          set={editSet}
          permsByGroup={permsByGroup}
          onSave={(keys) => { handleSaveKeys(editSet.id, keys); setEditSet(null); }}
          onClose={() => setEditSet(null)}
        />
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {sets.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: 48, textAlign: 'center', color: '#64748b' }}>
            No permission sets yet.
          </div>
        ) : (
          sets.map((ps) => (
            <div key={ps.id} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '16px 20px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 15, color: '#1e293b' }}>{ps.name}</span>
                  {ps.isDefault && <span style={{ fontSize: 11, background: '#dbeafe', color: '#1d4ed8', borderRadius: 4, padding: '2px 6px', fontWeight: 500 }}>default</span>}
                </div>
                {ps.description && <div style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>{ps.description}</div>}
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{ps.permissionKeys.length} permission{ps.permissionKeys.length !== 1 ? 's' : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => setEditSet(ps)}
                  style={{ padding: '6px 14px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
                >
                  Edit permissions
                </button>
                {!ps.isDefault && (
                  <button
                    onClick={() => setDeleteId(ps.id)}
                    style={{ padding: '6px 14px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ─── Permission set editor modal ──────────────────────────────────────────────

function PermissionSetEditor({
  set,
  permsByGroup,
  onSave,
  onClose,
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
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
      <div style={{ maxHeight: 400, overflowY: 'auto', marginBottom: 20 }}>
        {Object.entries(permsByGroup).map(([group, perms]) => {
          const groupKeys = perms.map((p) => p.key);
          const allGroupSelected = groupKeys.every((k) => selected.has(k));
          return (
            <div key={group} style={{ marginBottom: 16 }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}
                onClick={() => toggleGroup(groupKeys)}
              >
                <input type="checkbox" readOnly checked={allGroupSelected} style={{ cursor: 'pointer' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{group}</span>
              </div>
              <div style={{ paddingLeft: 20 }}>
                {perms.map((p) => (
                  <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, cursor: 'pointer' }}>
                    <input type="checkbox" checked={selected.has(p.key)} onChange={() => toggle(p.key)} style={{ cursor: 'pointer' }} />
                    <span style={{ fontSize: 13, color: '#374151' }}>{p.description}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>({p.key})</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={() => onSave([...selected])} style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
          Save ({selected.size} selected)
        </button>
        <button onClick={onClose} style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
      </div>
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

interface Member {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

interface CategoryAccess {
  id: string;
  categoryId: string;
  name: string;
  colour: string | null;
}

interface Group {
  id: string;
  name: string;
  description: string | null;
  members: Member[];
  categories: CategoryAccess[];
}

export default function AdminPermissionGroupDetailPage({ user }: { user: User }) {
  const { id } = useParams<{ id: string }>();
  const [group, setGroup] = useState<Group | null>(null);
  const [allUsers, setAllUsers] = useState<{ id: string; firstName: string; lastName: string; email: string }[]>([]);
  const [allCategories, setAllCategories] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);
  const [removeCategoryId, setRemoveCategoryId] = useState<string | null>(null);

  const load = async () => {
    const [groupRes, usersRes, catRes] = await Promise.all([
      api.get(`/api/permission-groups/${id}`),
      api.get('/api/users'),
      api.get('/api/categories'),
    ]);
    setGroup(groupRes.data);
    setAllUsers(usersRes.data);
    setAllCategories(catRes.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const handleAddMember = async () => {
    if (!selectedUser) return;
    try {
      await api.post(`/api/permission-groups/${id}/members`, { userId: selectedUser });
      setSelectedUser('');
      load();
    } catch { /* ignore duplicate etc */ }
  };

  const handleRemoveMemberConfirm = async () => {
    if (!removeMemberId) return;
    await api.delete(`/api/permission-groups/${id}/members/${removeMemberId}`);
    setRemoveMemberId(null);
    load();
  };

  const handleAddCategory = async () => {
    if (!selectedCategory) return;
    try {
      await api.post(`/api/permission-groups/${id}/categories`, { categoryId: selectedCategory });
      setSelectedCategory('');
      load();
    } catch { /* ignore */ }
  };

  const handleRemoveCategoryConfirm = async () => {
    if (!removeCategoryId) return;
    await api.delete(`/api/permission-groups/${id}/categories/${removeCategoryId}`);
    setRemoveCategoryId(null);
    load();
  };

  const handleSaveEdit = async () => {
    await api.patch(`/api/permission-groups/${id}`, { name: editName, description: editDesc });
    setEditMode(false);
    load();
  };

  if (loading || !group) return <div>Loading...</div>;

  const memberUserIds = new Set(group.members.map((m) => m.userId));
  const memberCategoryIds = new Set(group.categories.map((c) => c.categoryId));
  const availableUsers = allUsers.filter((u) => !memberUserIds.has(u.id));
  const availableCategories = allCategories.filter((c) => !memberCategoryIds.has(c.id));

  const removeMemberName = removeMemberId
    ? group.members.find((m) => m.userId === removeMemberId)
    : null;
  const removeCategoryName = removeCategoryId
    ? group.categories.find((c) => c.categoryId === removeCategoryId)
    : null;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Link to="/admin/permission-groups" style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none' }}>← Back to groups</Link>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', margin: 0 }}>{group.name}</h1>
          {group.description && <p style={{ color: '#64748b', marginTop: 4 }}>{group.description}</p>}
        </div>
        <button onClick={() => { setEditName(group.name); setEditDesc(group.description ?? ''); setEditMode(true); }} style={{ padding: '8px 16px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', marginLeft: 16 }}>
          Edit
        </button>
      </div>

      {editMode && (
        <Modal title="Edit permission group" onClose={() => setEditMode(false)} maxWidth={480}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Name</label>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ width: '100%', fontSize: 14, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Description</label>
            <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} style={{ width: '100%', fontSize: 14, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, boxSizing: 'border-box' }} placeholder="Description" />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handleSaveEdit} style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>Save</button>
            <button onClick={() => setEditMode(false)} style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </Modal>
      )}

      {removeMemberId && (
        <ConfirmDialog
          title="Remove member"
          message={`Remove ${removeMemberName ? `${removeMemberName.firstName} ${removeMemberName.lastName}` : 'this member'} from the group?`}
          confirmLabel="Remove"
          onConfirm={handleRemoveMemberConfirm}
          onCancel={() => setRemoveMemberId(null)}
        />
      )}

      {removeCategoryId && (
        <ConfirmDialog
          title="Remove category access"
          message={`Remove access to "${removeCategoryName?.name ?? 'this category'}" from the group?`}
          confirmLabel="Remove"
          onConfirm={handleRemoveCategoryConfirm}
          onCancel={() => setRemoveCategoryId(null)}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Members */}
        <div style={{ background: '#fff', borderRadius: 10, padding: 24, border: '1px solid #e2e8f0' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', marginBottom: 16 }}>Members ({group.members.length})</h2>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} style={{ flex: 1, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}>
              <option value="">Add member...</option>
              {availableUsers.map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.email})</option>)}
            </select>
            <button onClick={handleAddMember} style={{ padding: '8px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Add</button>
          </div>
          {group.members.length === 0 ? (
            <div style={{ fontSize: 13, color: '#94a3b8' }}>No members yet</div>
          ) : group.members.map((member) => (
            <div key={member.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#1e293b' }}>{member.firstName} {member.lastName}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{member.email} · {member.role}</div>
              </div>
              <button onClick={() => setRemoveMemberId(member.userId)} style={{ padding: '3px 10px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Remove</button>
            </div>
          ))}
        </div>

        {/* Categories */}
        <div style={{ background: '#fff', borderRadius: 10, padding: 24, border: '1px solid #e2e8f0' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', marginBottom: 16 }}>Category Access ({group.categories.length})</h2>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} style={{ flex: 1, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}>
              <option value="">Add category...</option>
              {availableCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={handleAddCategory} style={{ padding: '8px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Add</button>
          </div>
          {group.categories.length === 0 ? (
            <div style={{ fontSize: 13, color: '#94a3b8' }}>No categories granted</div>
          ) : group.categories.map((cat) => (
            <div key={cat.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {cat.colour && <span style={{ width: 10, height: 10, borderRadius: '50%', background: cat.colour }} />}
                <span style={{ fontSize: 13, fontWeight: 500, color: '#1e293b' }}>{cat.name}</span>
              </div>
              <button onClick={() => setRemoveCategoryId(cat.categoryId)} style={{ padding: '3px 10px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Remove</button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Category {
  id: string;
  name: string;
  description: string | null;
  colour: string | null;
}

export default function AdminCategoriesPage({ user }: { user: User }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', colour: '#6366f1' });
  const [error, setError] = useState('');

  const load = async () => {
    const { data } = await api.get('/api/categories');
    setCategories(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setError('');
    try {
      if (editId) {
        await api.patch(`/api/categories/${editId}`, form);
      } else {
        await api.post('/api/categories', form);
      }
      setShowForm(false);
      setEditId(null);
      setForm({ name: '', description: '', colour: '#6366f1' });
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Save failed');
    }
  };

  const handleEdit = (cat: Category) => {
    setEditId(cat.id);
    setForm({ name: cat.name, description: cat.description ?? '', colour: cat.colour ?? '#6366f1' });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this category?')) return;
    await api.delete(`/api/categories/${id}`);
    load();
  };

  if (loading) return <Layout user={user}><div>Loading...</div></Layout>;

  return (
    <Layout user={user}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', margin: 0 }}>Task Categories</h1>
          <p style={{ color: '#64748b', margin: '8px 0 0' }}>Organise tasks and control access via categories</p>
        </div>
        <button onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', description: '', colour: '#6366f1' }); }} style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500 }}>
          + Add category
        </button>
      </div>

      {showForm && (
        <div style={{ background: '#fff', borderRadius: 10, padding: 24, border: '1px solid #e2e8f0', marginBottom: 24, maxWidth: 500 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>{editId ? 'Edit category' : 'New category'}</h2>
          {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Colour</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="color" value={form.colour} onChange={(e) => setForm({ ...form, colour: e.target.value })} style={{ width: 40, height: 32, border: 'none', cursor: 'pointer' }} />
              <span style={{ fontSize: 13, color: '#64748b' }}>{form.colour}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={handleSave} style={{ padding: '8px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Save</button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {categories.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 10, padding: '48px', textAlign: 'center', color: '#64748b', border: '1px solid #e2e8f0', gridColumn: '1 / -1' }}>
            No categories yet.
          </div>
        ) : categories.map((cat) => (
          <div key={cat.id} style={{ background: '#fff', borderRadius: 10, padding: '20px 24px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              {cat.colour && <span style={{ width: 14, height: 14, borderRadius: '50%', background: cat.colour, flexShrink: 0 }} />}
              <div style={{ fontWeight: 600, color: '#1e293b' }}>{cat.name}</div>
            </div>
            {cat.description && <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>{cat.description}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => handleEdit(cat)} style={{ padding: '4px 12px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Edit</button>
              <button onClick={() => handleDelete(cat.id)} style={{ padding: '4px 12px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}

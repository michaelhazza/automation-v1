import { useEffect, useState } from 'react';
import api from '../lib/api';
import BoardColumnEditor, { type BoardColumn } from '../components/BoardColumnEditor';
import { type User } from '../lib/auth';

interface BoardConfig {
  id: string;
  columns: BoardColumn[];
  sourceTemplateId: string | null;
}

interface BoardTemplate {
  id: string;
  name: string;
  description: string | null;
  columns: BoardColumn[];
  isDefault: boolean;
}

export default function AdminBoardConfigPage({ user: _user }: { user: User }) {
  const [config, setConfig] = useState<BoardConfig | null>(null);
  const [templates, setTemplates] = useState<BoardTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [configRes, templatesRes] = await Promise.all([
        api.get('/api/board-config'),
        api.get('/api/board-templates'),
      ]);
      setConfig(configRes.data);
      setTemplates(templatesRes.data);
      if (configRes.data) {
        setColumns(configRes.data.columns);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleInit = async (templateId: string) => {
    setError('');
    try {
      await api.post('/api/board-config/init', { templateId });
      setSuccess('Board configuration initialised from template');
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to initialise');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api.patch('/api/board-config', { columns });
      setSuccess('Board configuration saved');
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 40 }}>Loading...</div>;

  // No config yet — show template picker
  if (!config) {
    return (
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>Board Configuration</h1>
        <p style={{ color: '#64748b', marginBottom: 24 }}>
          Select a board template to initialise your organisation's board. This defines the default columns for all new subaccounts.
        </p>

        {error && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{error}</div>}

        {templates.length === 0 ? (
          <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>No templates available. Ask your system administrator to create one.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {templates.map(t => (
              <div key={t.id} style={{ padding: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: 16, fontWeight: 600 }}>{t.name}</span>
                    {t.isDefault && <span style={{ marginLeft: 8, fontSize: 11, background: '#dbeafe', color: '#2563eb', padding: '2px 8px', borderRadius: 4 }}>Default</span>}
                  </div>
                  <button
                    onClick={() => handleInit(t.id)}
                    style={{ padding: '8px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                  >
                    Use This Template
                  </button>
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
        )}
      </div>
    );
  }

  // Config exists — show editor
  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>Board Configuration</h1>
      <p style={{ color: '#64748b', marginBottom: 24 }}>
        Customise your organisation's board columns. Locked columns cannot be removed. Changes here do not automatically apply to existing subaccounts — use "Push to Subaccounts" for that.
      </p>

      {error && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {success && <div style={{ color: '#22c55e', fontSize: 13, marginBottom: 12 }}>{success}</div>}

      <BoardColumnEditor columns={columns} onChange={setColumns} />

      <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ padding: '10px 24px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

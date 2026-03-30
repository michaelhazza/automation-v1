import { useEffect, useState } from 'react';
import api from '../lib/api';
import BoardColumnEditor, { type BoardColumn } from '../components/BoardColumnEditor';
import { type User } from '../lib/auth';

interface BoardConfig { id: string; columns: BoardColumn[]; sourceTemplateId: string | null; }
interface BoardTemplate { id: string; name: string; description: string | null; columns: BoardColumn[]; isDefault: boolean; }

export default function AdminBoardConfigPage({ user: _user, embedded }: { user: User; embedded?: boolean }) {
  const [config, setConfig] = useState<BoardConfig | null>(null);
  const [templates, setTemplates] = useState<BoardTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
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
      if (configRes.data) setColumns(configRes.data.columns);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleInit = async (templateId: string) => {
    setError('');
    try {
      await api.post('/api/board-config/init', { templateId });
      setSuccess('Board configuration initialised from template'); load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to initialise');
    }
  };

  const handleSave = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      await api.patch('/api/board-config', { columns });
      setSuccess('Board configuration saved'); load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to save');
    } finally { setSaving(false); }
  };

  const handlePushAll = async () => {
    setPushing(true); setError(''); setSuccess('');
    try {
      const { data } = await api.post('/api/board-config/push-all');
      setSuccess(`Board config pushed to ${data.pushed} client${data.pushed !== 1 ? 's' : ''}`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to push');
    } finally { setPushing(false); }
  };

  if (loading) return <div className="p-10 text-sm text-slate-500">Loading...</div>;

  if (!config) {
    return (
      <div>
        {!embedded && (
          <>
            <h1 className="text-[28px] font-bold text-slate-800 mb-2">Board Configuration</h1>
            <p className="text-sm text-slate-500 mb-6">
              Select a board template to initialise your organisation's board. This defines the default columns for all new subaccounts.
            </p>
          </>
        )}

        {error && <div className="text-[13px] text-red-500 mb-3">{error}</div>}

        {templates.length === 0 ? (
          <div className="text-sm text-slate-400 italic">No templates available. Ask your system administrator to create one.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {templates.map((t) => (
              <div key={t.id} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[16px] font-semibold text-slate-800">{t.name}</span>
                    {t.isDefault && <span className="text-[11px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium">Default</span>}
                  </div>
                  <button
                    onClick={() => handleInit(t.id)}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-lg transition-colors"
                  >
                    Use This Template
                  </button>
                </div>
                {t.description && <div className="text-[13px] text-slate-500 mb-2">{t.description}</div>}
                <div className="flex gap-1.5 flex-wrap">
                  {t.columns.map((c) => (
                    <span key={c.key} className="text-[11px] px-2.5 py-1 rounded font-semibold" style={{ background: `${c.colour}20`, color: c.colour }}>
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

  return (
    <div>
      {!embedded && (
        <>
          <h1 className="text-[28px] font-bold text-slate-800 mb-2">Board Configuration</h1>
          <p className="text-sm text-slate-500 mb-6">
            Customise your organisation's board columns. Locked columns cannot be removed. Changes here do not automatically apply to existing subaccounts — use "Push to Subaccounts" for that.
          </p>
        </>
      )}

      {error && <div className="text-[13px] text-red-500 mb-3">{error}</div>}
      {success && <div className="text-[13px] text-green-600 mb-3">{success}</div>}

      <BoardColumnEditor columns={columns} onChange={setColumns} />

      <div className="mt-5 flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        <button
          onClick={handlePushAll}
          disabled={pushing}
          className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-sm font-medium rounded-lg transition-colors"
        >
          {pushing ? 'Pushing...' : 'Push to All Clients'}
        </button>
      </div>
    </div>
  );
}

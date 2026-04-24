import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Process {
  id: string;
  name: string;
  description: string;
  status: string;
  orgCategoryId: string | null;
  workflowEngineId: string;
  webhookPath: string;
  inputSchema: string | null;
  outputSchema: string | null;
}

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function AdminAutomationEditPage({ user: _user }: { user: User }) {
  const { id } = useParams<{ id: string }>();
  const [process, setProcess] = useState<Process | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<unknown>(null);
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [processRes, catRes] = await Promise.all([
        api.get(`/api/automations/${id}`),
        api.get('/api/categories'),
      ]);
      setProcess(processRes.data);
      setCategories(catRes.data);
      setLoading(false);
    };
    load();
  }, [id]);

  const handleSave = async () => {
    setError(''); setSuccess(''); setSaving(true);
    try {
      await api.patch(`/api/automations/${id}`, process);
      setSuccess('Automation saved successfully');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Save failed');
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTestResult(null); setTestLoading(true);
    try {
      let parsedInput: unknown = undefined;
      if (testInput.trim()) {
        try { parsedInput = JSON.parse(testInput); } catch { parsedInput = { text: testInput }; }
      }
      const form = new FormData();
      if (parsedInput !== undefined) form.append('inputData', JSON.stringify(parsedInput));
      const { data } = await api.post(`/api/automations/${id}/test`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setTestResult(data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: unknown } };
      setTestResult({ error: e.response?.data });
    } finally { setTestLoading(false); }
  };

  if (loading || !process) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="mb-4">
        <Link to="/admin/automations" className="text-[13px] text-indigo-600 hover:text-indigo-700 no-underline">
          ← Back to automations
        </Link>
      </div>
      <h1 className="text-[26px] font-bold text-slate-800 mb-6">Edit Automation: {process.name}</h1>

      <div className="grid gap-6 [grid-template-columns:1fr_380px]">
        {/* Edit form */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          {success && <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 mb-4 text-[13px] text-green-700">{success}</div>}
          {error && <div className="text-[13px] text-red-600 mb-3">{error}</div>}
          <div className="grid gap-4">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Name</label>
              <input type="text" value={process.name ?? ''} onChange={(e) => setProcess({ ...process, name: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Webhook path</label>
              <input type="text" value={process.webhookPath ?? ''} onChange={(e) => setProcess({ ...process, webhookPath: e.target.value })} placeholder="/webhook/my-workflow-id" className={inputCls} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Category</label>
              <select value={process.orgCategoryId ?? ''} onChange={(e) => setProcess({ ...process, orgCategoryId: e.target.value || null })} className={inputCls}>
                <option value="">No category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Description</label>
              <textarea value={process.description ?? ''} onChange={(e) => setProcess({ ...process, description: e.target.value })} rows={3} className={`${inputCls} resize-vertical`} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Input schema / guidance</label>
              <textarea value={process.inputSchema ?? ''} onChange={(e) => setProcess({ ...process, inputSchema: e.target.value })} rows={2} className={`${inputCls} resize-vertical`} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Output schema / description</label>
              <textarea value={process.outputSchema ?? ''} onChange={(e) => setProcess({ ...process, outputSchema: e.target.value })} rows={2} className={`${inputCls} resize-vertical`} />
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-5 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>

        {/* Test panel */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 self-start">
          <h2 className="text-[16px] font-semibold text-slate-800 mb-4">Test mode</h2>
          <div className="mb-3">
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Test input (JSON)</label>
            <textarea
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[12px] font-mono bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 resize-vertical"
              placeholder='{ "key": "value" }'
            />
          </div>
          <button
            onClick={handleTest}
            disabled={testLoading}
            className="w-full py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg transition-colors"
          >
            {testLoading ? 'Running...' : 'Run test'}
          </button>
          {testResult !== null && (
            <div className="mt-4">
              <div className="text-[12px] font-semibold text-slate-700 mb-1.5">Result</div>
              <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[11px] overflow-auto whitespace-pre-wrap break-words text-slate-800 m-0">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

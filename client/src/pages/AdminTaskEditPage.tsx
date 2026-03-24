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

export default function AdminTaskEditPage({ user }: { user: User }) {
  const { id } = useParams<{ id: string }>();
  const [process, setProcess] = useState<Process | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [engines, setEngines] = useState<{ id: string; name: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<unknown>(null);
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [processRes, catRes, engRes] = await Promise.all([
        api.get(`/api/processes/${id}`),
        api.get('/api/categories'),
        api.get('/api/engines'),
      ]);
      setProcess(processRes.data);
      setCategories(catRes.data);
      setEngines(engRes.data);
      setLoading(false);
    };
    load();
  }, [id]);

  const handleSave = async () => {
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api.patch(`/api/processes/${id}`, process);
      setSuccess('Process saved successfully');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTestResult(null);
    setTestLoading(true);
    try {
      let parsedInput: unknown = undefined;
      if (testInput.trim()) {
        try { parsedInput = JSON.parse(testInput); } catch { parsedInput = { text: testInput }; }
      }
      const form = new FormData();
      if (parsedInput !== undefined) form.append('inputData', JSON.stringify(parsedInput));
      const { data } = await api.post(`/api/processes/${id}/test`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setTestResult(data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: unknown } };
      setTestResult({ error: e.response?.data });
    } finally {
      setTestLoading(false);
    }
  };

  if (loading || !process) return <div>Loading...</div>;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Link to="/admin/processes" style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none' }}>← Back to processes</Link>
      </div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', marginBottom: 24 }}>Edit Process: {process.name}</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24 }}>
        {/* Edit form */}
        <div style={{ background: '#fff', borderRadius: 10, padding: 24, border: '1px solid #e2e8f0' }}>
          {success && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#16a34a', fontSize: 13 }}>{success}</div>}
          {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <div style={{ display: 'grid', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Name</label>
              <input type="text" value={process.name ?? ''} onChange={(e) => setProcess({ ...process, name: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Webhook path</label>
              <input type="text" value={process.webhookPath ?? ''} onChange={(e) => setProcess({ ...process, webhookPath: e.target.value })} placeholder="/webhook/my-workflow-id" style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Category</label>
              <select value={process.orgCategoryId ?? ''} onChange={(e) => setProcess({ ...process, orgCategoryId: e.target.value || null })} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}>
                <option value="">No category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Description</label>
              <textarea value={process.description ?? ''} onChange={(e) => setProcess({ ...process, description: e.target.value })} rows={3} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Input schema / guidance</label>
              <textarea value={process.inputSchema ?? ''} onChange={(e) => setProcess({ ...process, inputSchema: e.target.value })} rows={2} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Output schema / description</label>
              <textarea value={process.outputSchema ?? ''} onChange={(e) => setProcess({ ...process, outputSchema: e.target.value })} rows={2} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }} />
            </div>
          </div>
          <button onClick={handleSave} disabled={saving} style={{ marginTop: 20, padding: '10px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>

        {/* Test panel */}
        <div style={{ background: '#fff', borderRadius: 10, padding: 24, border: '1px solid #e2e8f0', alignSelf: 'start' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: '#1e293b' }}>Test mode</h2>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Test input (JSON)</label>
            <textarea value={testInput} onChange={(e) => setTestInput(e.target.value)} rows={4} style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 12, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }} placeholder='{ "key": "value" }' />
          </div>
          <button onClick={handleTest} disabled={testLoading} style={{ width: '100%', padding: '9px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: testLoading ? 'not-allowed' : 'pointer', opacity: testLoading ? 0.7 : 1 }}>
            {testLoading ? 'Running...' : 'Run test'}
          </button>
          {testResult !== null && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Result</div>
              <pre style={{ background: '#f8fafc', padding: 12, borderRadius: 8, fontSize: 11, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#1e293b', border: '1px solid #e2e8f0', margin: 0 }}>
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Task {
  id: string;
  name: string;
  description: string;
  inputGuidance: string | null;
  expectedOutput: string | null;
  timeoutSeconds: number;
}

interface Execution {
  id: string;
  status: string;
  outputData: unknown;
  errorMessage: string | null;
  durationMs: number | null;
  isTestExecution: boolean;
}

interface ExecFile {
  id: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number | null;
}

const STATUS_COLOR: Record<string, string> = {
  completed: '#16a34a',
  failed: '#dc2626',
  running: '#2563eb',
  pending: '#d97706',
  timeout: '#ea580c',
};

export default function TaskExecutionPage({ user }: { user: User }) {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [inputData, setInputData] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [execFiles, setExecFiles] = useState<ExecFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.get(`/api/tasks/${id}`).then(({ data }) => setTask(data)).finally(() => setLoading(false));
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [id]);

  const pollExecution = (execId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/api/executions/${execId}`);
        setExecution(data);
        if (['completed', 'failed', 'timeout', 'cancelled'].includes(data.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          if (data.status === 'completed') {
            const { data: files } = await api.get(`/api/executions/${execId}/files`);
            setExecFiles(files);
          }
        }
      } catch { /* ignore poll errors */ }
    }, 2000);
  };

  const handleSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      let parsedInput: unknown = undefined;
      if (inputData.trim()) {
        try {
          parsedInput = JSON.parse(inputData);
        } catch {
          parsedInput = { text: inputData };
        }
      }

      const formData = new FormData();
      formData.append('taskId', id!);
      if (parsedInput !== undefined) formData.append('inputData', JSON.stringify(parsedInput));
      if (file) formData.append('file', file);

      const { data } = await api.post('/api/executions', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setExecution({ id: data.id, status: data.status, outputData: null, errorMessage: null, durationMs: null, isTestExecution: false });
      pollExecution(data.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to submit task');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = async (fileId: string) => {
    const { data } = await api.get(`/api/files/${fileId}/download`);
    window.open(data.downloadUrl, '_blank');
  };

  if (loading) return <div>Loading...</div>;
  if (!task) return <div style={{ color: '#dc2626' }}>Task not found</div>;

  return (
    <>
      <div style={{ maxWidth: 760 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>{task.name}</h1>
        {task.description && <p style={{ color: '#64748b', marginBottom: 24 }}>{task.description}</p>}

        {task.expectedOutput && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#166534' }}>
            <strong>Expected output:</strong> {task.expectedOutput}
          </div>
        )}

        {task.inputGuidance && (
          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#0c4a6e' }}>
            <strong>Input guidance:</strong> {task.inputGuidance}
          </div>
        )}

        {/* Input form */}
        {!execution && (
          <div style={{ background: '#fff', borderRadius: 10, padding: 24, border: '1px solid #e2e8f0', marginBottom: 24 }}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Input Data (JSON or plain text)</label>
              <textarea
                value={inputData}
                onChange={(e) => setInputData(e.target.value)}
                placeholder='{ "key": "value" } or plain text'
                rows={5}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Attach file (optional)</label>
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
            </div>
            {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 16 }}>{error}</div>}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{ padding: '10px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? 'Submitting...' : 'Run Task'}
            </button>
          </div>
        )}

        {/* Execution result */}
        {execution && (
          <div style={{ background: '#fff', borderRadius: 10, padding: 24, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 16 }}>Execution status: </span>
                <span style={{ color: STATUS_COLOR[execution.status] ?? '#6b7280', fontWeight: 700 }}>{execution.status}</span>
              </div>
              {execution.durationMs != null && (
                <span style={{ fontSize: 13, color: '#64748b' }}>{(execution.durationMs / 1000).toFixed(1)}s</span>
              )}
            </div>

            {['pending', 'running'].includes(execution.status) && (
              <div style={{ color: '#64748b', fontSize: 13 }}>Processing... (auto-refreshing)</div>
            )}

            {execution.status === 'completed' && execution.outputData != null && (
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: '#374151' }}>Output</div>
                <pre style={{ background: '#f8fafc', padding: 16, borderRadius: 8, fontSize: 12, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#1e293b', border: '1px solid #e2e8f0' }}>
                  {JSON.stringify(execution.outputData, null, 2)}
                </pre>
              </div>
            )}

            {execution.errorMessage && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', color: '#dc2626', fontSize: 13 }}>
                {execution.errorMessage}
              </div>
            )}

            {execFiles.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: '#374151' }}>Output files</div>
                {execFiles.map((f) => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <span style={{ fontSize: 13, color: '#1e293b', flex: 1 }}>{f.fileName}</span>
                    {f.fileSizeBytes != null && <span style={{ fontSize: 12, color: '#64748b' }}>{Math.round(f.fileSizeBytes / 1024)}KB</span>}
                    <button onClick={() => handleDownload(f.id)} style={{ padding: '4px 12px', background: '#dbeafe', color: '#1d4ed8', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>
                      Download
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => { setExecution(null); setInputData(''); setFile(null); setExecFiles([]); if (pollRef.current) clearInterval(pollRef.current); }}
              style={{ marginTop: 16, padding: '8px 16px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}
            >
              Run again
            </button>
          </div>
        )}
      </div>
    </>
  );
}

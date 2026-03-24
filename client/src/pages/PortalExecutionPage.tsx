/**
 * PortalExecutionPage — subaccount member's process execution page.
 *
 * Mirrors TaskExecutionPage but uses the portal API endpoints
 * (/api/portal/:subaccountId/executions) and reads the subaccountId from params.
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Process {
  id: string;
  name: string;
  description: string | null;
  inputSchema: string | null;
  outputSchema: string | null;
}

interface Execution {
  id: string;
  status: string;
  outputData: unknown;
  errorMessage: string | null;
  durationMs: number | null;
}

interface StagedFile {
  file: File;
  id: string;
  error?: string;
}

const STATUS_COLOR: Record<string, string> = {
  completed: '#16a34a',
  failed: '#dc2626',
  running: '#2563eb',
  pending: '#d97706',
  timeout: '#ea580c',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const spinnerStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  border: '3px solid #e2e8f0',
  borderTopColor: '#2563eb',
  borderRadius: '50%',
  animation: 'spin 0.8s linear infinite',
  flexShrink: 0,
};

export default function PortalExecutionPage({ user }: { user: User }) {
  const { subaccountId, processId } = useParams<{ subaccountId: string; processId: string }>();
  const [process, setProcess] = useState<Process | null>(null);
  const [inputData, setInputData] = useState('');
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [error, setError] = useState('');
  const [maxUploadSizeMb, setMaxUploadSizeMb] = useState(200);
  const [dragOver, setDragOver] = useState(false);
  const [notifyOnComplete, setNotifyOnComplete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!subaccountId) return;
    Promise.all([
      api.get(`/api/portal/${subaccountId}/processes`),
      api.get('/api/settings/upload').catch(() => ({ data: { maxUploadSizeMb: 200 } })),
    ]).then(([portalRes, settingsRes]) => {
      const found = (portalRes.data.processes as Process[]).find((t: Process) => t.id === processId);
      setProcess(found ?? null);
      setMaxUploadSizeMb(settingsRes.data.maxUploadSizeMb ?? 200);
    }).finally(() => setLoading(false));

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [subaccountId, processId]);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const maxBytes = maxUploadSizeMb * 1024 * 1024;
    const toAdd: StagedFile[] = Array.from(newFiles).map((file) => ({
      file,
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
      error: file.size > maxBytes ? `Exceeds ${maxUploadSizeMb} MB limit` : undefined,
    }));
    setStagedFiles((prev) => [...prev, ...toAdd]);
  }, [maxUploadSizeMb]);

  const removeFile = (fileId: string) => setStagedFiles((prev) => prev.filter((f) => f.id !== fileId));

  const pollExecution = (execId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/api/portal/${subaccountId}/executions/${execId}`);
        setExecution(data);
        if (['completed', 'failed', 'timeout', 'cancelled'].includes(data.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch { /* ignore poll errors */ }
    }, 2000);
  };

  const handleSubmit = async () => {
    setError('');
    const invalidFiles = stagedFiles.filter((f) => f.error);
    if (invalidFiles.length > 0) {
      setError('Remove files that exceed the size limit before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      let parsedInput: unknown = undefined;
      if (inputData.trim()) {
        try { parsedInput = JSON.parse(inputData); } catch { parsedInput = { text: inputData }; }
      }

      const { data: execData } = await api.post(`/api/portal/${subaccountId}/executions`, {
        processId,
        ...(parsedInput !== undefined ? { inputData: parsedInput } : {}),
        notifyOnComplete,
      });

      const execId = execData.id;
      setExecution({ id: execId, status: execData.status, outputData: null, errorMessage: null, durationMs: null });

      // Upload staged files
      for (let i = 0; i < stagedFiles.length; i++) {
        const { file } = stagedFiles[i];
        setUploadProgress(`Uploading file ${i + 1} of ${stagedFiles.length}: ${file.name}`);
        const formData = new FormData();
        formData.append('executionId', execId);
        formData.append('file', file);
        await api.post('/api/files/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      setUploadProgress('');

      pollExecution(execId);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to submit process');
      setUploadProgress('');
      setSubmitting(false);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (!process) return <div style={{ color: '#dc2626', padding: 32 }}>Process not found</div>;

  const hasInvalidFiles = stagedFiles.some((f) => f.error);
  const isExecuting = execution && ['pending', 'running'].includes(execution.status);

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ marginBottom: 16 }}>
        <Link to={`/portal/${subaccountId}`} style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none' }}>← Back to processes</Link>
      </div>
      <div style={{ maxWidth: 760 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>{process.name}</h1>
        {process.description && <p style={{ color: '#64748b', marginBottom: 24 }}>{process.description}</p>}

        {process.outputSchema && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#166534' }}>
            <strong>Expected output:</strong> {process.outputSchema}
          </div>
        )}

        {process.inputSchema && (
          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#0c4a6e' }}>
            <strong>Input guidance:</strong> {process.inputSchema}
          </div>
        )}

        {!execution && (
          <div style={{ background: '#fff', borderRadius: 10, padding: 24, border: '1px solid #e2e8f0', marginBottom: 24 }}>
            <div style={{ marginBottom: 20 }}>
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
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Attach files (optional)</label>
              <input ref={fileInputRef} type="file" multiple onChange={(e) => { if (e.target.files) { addFiles(e.target.files); e.target.value = ''; } }} style={{ display: 'none' }} />
              <div
                ref={dropZoneRef}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={(e) => { if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) setDragOver(false); }}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files); }}
                onClick={() => fileInputRef.current?.click()}
                style={{ border: `2px dashed ${dragOver ? '#2563eb' : '#d1d5db'}`, borderRadius: 10, padding: '28px 20px', textAlign: 'center', cursor: 'pointer', background: dragOver ? '#eff6ff' : '#fafafa' }}
              >
                <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
                <div style={{ fontSize: 14, fontWeight: 500, color: dragOver ? '#2563eb' : '#374151', marginBottom: 4 }}>
                  {dragOver ? 'Drop files here' : 'Drag & drop files here, or click to browse'}
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>Max {maxUploadSizeMb} MB per file</div>
              </div>
              {stagedFiles.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {stagedFiles.map((sf) => (
                    <div key={sf.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: sf.error ? '#fef2f2' : '#f8fafc', border: `1px solid ${sf.error ? '#fecaca' : '#e2e8f0'}`, borderRadius: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sf.file.name}</div>
                        <div style={{ fontSize: 11, color: sf.error ? '#dc2626' : '#64748b' }}>{sf.error ?? formatBytes(sf.file.size)}</div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); removeFile(sf.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18 }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 20 }}>
              <input type="checkbox" checked={notifyOnComplete} onChange={(e) => setNotifyOnComplete(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#2563eb' }} />
              <span style={{ fontSize: 13, color: '#374151' }}>Email me when this process completes</span>
            </label>

            {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 16 }}>{error}</div>}
            {uploadProgress && <div style={{ fontSize: 13, color: '#2563eb', marginBottom: 16 }}>{uploadProgress}</div>}

            <button
              onClick={handleSubmit}
              disabled={submitting || hasInvalidFiles}
              style={{ padding: '10px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: (submitting || hasInvalidFiles) ? 'not-allowed' : 'pointer', opacity: (submitting || hasInvalidFiles) ? 0.7 : 1 }}
            >
              {submitting ? (uploadProgress ? 'Uploading...' : 'Submitting...') : 'Run Process'}
            </button>
          </div>
        )}

        {isExecuting && (
          <div style={{ background: '#fff', borderRadius: 10, padding: '32px 24px', border: '1px solid #e2e8f0', marginBottom: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
            <div style={spinnerStyle} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', marginBottom: 6 }}>Executing... please wait</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>
                Status: <span style={{ color: STATUS_COLOR[execution.status] ?? '#6b7280', fontWeight: 600 }}>{execution.status}</span>
              </div>
            </div>
          </div>
        )}

        {execution && !isExecuting && (
          <div style={{ background: '#fff', borderRadius: 10, padding: 24, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 16 }}>Execution status: </span>
                <span style={{ color: STATUS_COLOR[execution.status] ?? '#6b7280', fontWeight: 700 }}>{execution.status}</span>
              </div>
              {execution.durationMs != null && <span style={{ fontSize: 13, color: '#64748b' }}>{(execution.durationMs / 1000).toFixed(1)}s</span>}
            </div>

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

            <button
              onClick={() => { setExecution(null); setInputData(''); setStagedFiles([]); setNotifyOnComplete(false); if (pollRef.current) clearInterval(pollRef.current); }}
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

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Process {
  id: string;
  name: string;
  description: string;
  inputSchema: string | null;
  outputSchema: string | null;
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

interface StagedFile {
  file: File;
  id: string;
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mimeType: string): string {
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType === 'application/pdf') return '📄';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📑';
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('gzip') || mimeType.includes('7z')) return '🗜️';
  if (mimeType.startsWith('text/')) return '📃';
  return '📎';
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}><span className="badge-dot" />{status}</span>;
}

export default function TaskExecutionPage({ user }: { user: User }) {
  const { id } = useParams<{ id: string }>();
  const [process, setProcess] = useState<Process | null>(null);
  const [inputData, setInputData] = useState('');
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [execFiles, setExecFiles] = useState<ExecFile[]>([]);
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
    Promise.all([
      api.get(`/api/processes/${id}`),
      api.get('/api/settings/upload').catch(() => ({ data: { maxUploadSizeMb: 200 } })),
    ]).then(([processRes, settingsRes]) => {
      setProcess(processRes.data);
      setMaxUploadSizeMb(settingsRes.data.maxUploadSizeMb ?? 200);
    }).finally(() => setLoading(false));

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [id]);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const maxBytes = maxUploadSizeMb * 1024 * 1024;
    const toAdd: StagedFile[] = Array.from(newFiles).map((file) => ({
      file, id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
      error: file.size > maxBytes ? `Exceeds ${maxUploadSizeMb} MB limit` : undefined,
    }));
    setStagedFiles((prev) => [...prev, ...toAdd]);
  }, [maxUploadSizeMb]);

  const removeFile = (fileId: string) => setStagedFiles((prev) => prev.filter((f) => f.id !== fileId));

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

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
    if (stagedFiles.some((f) => f.error)) {
      setError('Remove files that exceed the size limit before submitting.');
      return;
    }
    setSubmitting(true);
    try {
      let parsedInput: unknown = undefined;
      if (inputData.trim()) {
        try { parsedInput = JSON.parse(inputData); }
        catch { parsedInput = { text: inputData }; }
      }

      const { data: execData } = await api.post('/api/executions', {
        processId: id,
        ...(parsedInput !== undefined ? { inputData: JSON.stringify(parsedInput) } : {}),
        notifyOnComplete,
      });

      const execId = execData.id;
      setExecution({ id: execId, status: execData.status, outputData: null, errorMessage: null, durationMs: null, isTestExecution: false });

      for (let i = 0; i < stagedFiles.length; i++) {
        const { file } = stagedFiles[i];
        setUploadProgress(`Uploading file ${i + 1} of ${stagedFiles.length}: ${file.name}`);
        const formData = new FormData();
        formData.append('executionId', execId);
        formData.append('file', file);
        await api.post('/api/files/upload', formData);
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

  const handleDownload = async (fileId: string) => {
    const { data } = await api.get(`/api/files/${fileId}/download`);
    window.open(data.downloadUrl, '_blank');
  };

  const handleReset = () => {
    setExecution(null); setInputData(''); setStagedFiles([]);
    setExecFiles([]); setNotifyOnComplete(false);
    if (pollRef.current) clearInterval(pollRef.current);
  };

  if (loading) {
    return (
      <div className="page-enter" style={{ maxWidth: 760 }}>
        <div className="skeleton" style={{ height: 28, width: 320, marginBottom: 10 }} />
        <div className="skeleton" style={{ height: 18, width: 480, marginBottom: 28 }} />
        <div className="skeleton" style={{ height: 280, borderRadius: 14 }} />
      </div>
    );
  }

  if (!process) {
    return (
      <div className="card empty-state" style={{ maxWidth: 480, margin: '0 auto' }}>
        <p style={{ fontWeight: 700, fontSize: 16, color: '#dc2626' }}>Process not found</p>
        <Link to="/processes" className="btn btn-secondary" style={{ textDecoration: 'none', marginTop: 12 }}>
          Back to Processes
        </Link>
      </div>
    );
  }

  const hasInvalidFiles = stagedFiles.some((f) => f.error);
  const isExecuting = execution && ['pending', 'running'].includes(execution.status);
  const isTerminal = execution && !isExecuting;

  return (
    <div className="page-enter" style={{ maxWidth: 780 }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, fontSize: 13 }}>
        <Link to="/processes" style={{ color: '#6366f1', textDecoration: 'none', fontWeight: 500 }}>Processes</Link>
        <span style={{ color: '#94a3b8' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
        <span style={{ color: '#64748b', fontWeight: 500 }}>{process.name}</span>
      </div>

      {/* Process header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', margin: '0 0 8px', letterSpacing: '-0.03em' }}>
          {process.name}
        </h1>
        {process.description && (
          <p style={{ color: '#64748b', margin: 0, fontSize: 14, lineHeight: 1.6 }}>{process.description}</p>
        )}
      </div>

      {/* Schema hints */}
      {(process.inputSchema || process.outputSchema) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {process.inputSchema && (
            <div style={{
              background: '#f0f9ff', border: '1px solid #bae6fd',
              borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#0369a1',
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div><strong>Input guidance:</strong> {process.inputSchema}</div>
            </div>
          )}
          {process.outputSchema && (
            <div style={{
              background: '#f0fdf4', border: '1px solid #bbf7d0',
              borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#166534',
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <div><strong>Expected output:</strong> {process.outputSchema}</div>
            </div>
          )}
        </div>
      )}

      {/* ── Input form ───────────────────────────────────────────────────── */}
      {!execution && (
        <div className="card" style={{ padding: 28, marginBottom: 20, animation: 'fadeIn 0.2s ease-out both' }}>
          <h3 style={{ margin: '0 0 20px', fontSize: 15, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em' }}>
            Process Input
          </h3>

          {/* Input data */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 7 }}>
              Input Data
              <span style={{ fontSize: 11.5, fontWeight: 400, color: '#94a3b8', marginLeft: 8 }}>JSON or plain text</span>
            </label>
            <textarea
              value={inputData}
              onChange={(e) => setInputData(e.target.value)}
              placeholder={'{ "key": "value" } or plain text'}
              rows={5}
              className="form-input"
              style={{ fontFamily: 'ui-monospace, monospace', resize: 'vertical', fontSize: 13 }}
            />
          </div>

          {/* File upload */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 7 }}>
              Attachments
              <span style={{ fontSize: 11.5, fontWeight: 400, color: '#94a3b8', marginLeft: 8 }}>optional · max {maxUploadSizeMb} MB each</span>
            </label>
            <input ref={fileInputRef} type="file" multiple onChange={(e) => { if (e.target.files?.length) { addFiles(e.target.files); e.target.value = ''; } }} style={{ display: 'none' }} />
            <div
              ref={dropZoneRef}
              className={`drop-zone${dragOver ? ' drag-over' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 10, margin: '0 auto 12px',
                background: dragOver ? '#ede9fe' : '#f5f3ff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.15s',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={dragOver ? '#8b5cf6' : '#a78bfa'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: dragOver ? '#7c3aed' : '#374151', marginBottom: 4 }}>
                {dragOver ? 'Drop files here' : 'Drag & drop files, or click to browse'}
              </div>
              <div style={{ fontSize: 12.5, color: '#94a3b8' }}>
                Audio, video, documents, PDFs, images and more
              </div>
            </div>

            {stagedFiles.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stagedFiles.map((sf) => (
                  <div key={sf.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    background: sf.error ? '#fef2f2' : '#f8fafc',
                    border: `1px solid ${sf.error ? '#fecaca' : '#e2e8f0'}`,
                    borderRadius: 9,
                  }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{fileIcon(sf.file.type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sf.file.name}
                      </div>
                      <div style={{ fontSize: 11.5, color: sf.error ? '#dc2626' : '#94a3b8', marginTop: 1 }}>
                        {sf.error ?? formatBytes(sf.file.size)}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFile(sf.id); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 20, padding: '0 4px', lineHeight: 1, flexShrink: 0, transition: 'color 0.1s' }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notify opt-in */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 24, userSelect: 'none' }}>
            <div style={{
              width: 18, height: 18, borderRadius: 5, flexShrink: 0,
              border: `2px solid ${notifyOnComplete ? '#6366f1' : '#d1d5db'}`,
              background: notifyOnComplete ? '#6366f1' : '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}>
              {notifyOnComplete && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
            <input type="checkbox" checked={notifyOnComplete} onChange={(e) => setNotifyOnComplete(e.target.checked)} style={{ display: 'none' }} />
            <span style={{ fontSize: 13.5, color: '#374151', fontWeight: 500 }}>
              Email me when this process completes
            </span>
          </label>

          {error && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 9,
              padding: '11px 14px', marginBottom: 16,
              display: 'flex', alignItems: 'center', gap: 8,
              animation: 'fadeIn 0.15s ease-out',
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span style={{ color: '#dc2626', fontSize: 13 }}>{error}</span>
            </div>
          )}
          {uploadProgress && (
            <div style={{ fontSize: 13, color: '#6366f1', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 14, height: 14, border: '2px solid #c7d2fe', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              {uploadProgress}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || hasInvalidFiles}
            className="btn btn-primary"
            style={{ fontSize: 14, padding: '11px 24px' }}
          >
            {submitting ? (
              <>
                <div style={{ width: 15, height: 15, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                {uploadProgress ? 'Uploading…' : 'Submitting…'}
              </>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Run Process
              </>
            )}
          </button>
        </div>
      )}

      {/* ── Executing state ──────────────────────────────────────────────── */}
      {isExecuting && (
        <div className="card" style={{
          padding: '40px 28px', marginBottom: 20,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
          textAlign: 'center', animation: 'fadeIn 0.2s ease-out both',
        }}>
          {/* Animated spinner ring */}
          <div style={{ position: 'relative', width: 60, height: 60 }}>
            <div style={{
              width: 60, height: 60,
              border: '3px solid #e2e8f0',
              borderTopColor: '#6366f1',
              borderRadius: '50%',
              animation: 'spin 0.9s linear infinite',
            }} />
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', marginBottom: 8, letterSpacing: '-0.01em' }}>
              Executing process…
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#64748b' }}>Status:</span>
              <StatusBadge status={execution.status} />
            </div>
            {notifyOnComplete && (
              <div style={{ marginTop: 12, fontSize: 12.5, color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
                </svg>
                You'll receive an email when complete
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Result state ─────────────────────────────────────────────────── */}
      {isTerminal && (
        <div className="card" style={{ padding: 28, animation: 'fadeIn 0.25s ease-out both' }}>
          {/* Result header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: execution.status === 'completed' ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #ef4444, #dc2626)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  {execution.status === 'completed' ? (
                    <polyline points="20 6 9 17 4 12" />
                  ) : (
                    <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>
                  )}
                </svg>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#0f172a', letterSpacing: '-0.01em' }}>
                  Execution {execution.status === 'completed' ? 'completed' : execution.status}
                </div>
                <div style={{ marginTop: 2 }}>
                  <StatusBadge status={execution.status} />
                </div>
              </div>
            </div>
            {execution.durationMs != null && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em' }}>
                  {(execution.durationMs / 1000).toFixed(1)}s
                </div>
                <div style={{ fontSize: 11.5, color: '#94a3b8' }}>duration</div>
              </div>
            )}
          </div>

          {/* Output data */}
          {execution.status === 'completed' && execution.outputData != null && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Output
              </div>
              <pre style={{
                background: '#0f172a', color: '#e2e8f0',
                padding: '16px 20px', borderRadius: 10,
                fontSize: 12.5, overflow: 'auto',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                lineHeight: 1.6, margin: 0,
                fontFamily: 'ui-monospace, monospace',
                border: '1px solid #1e293b',
                maxHeight: 400,
              }}>
                {JSON.stringify(execution.outputData, null, 2)}
              </pre>
            </div>
          )}

          {/* Error message */}
          {execution.errorMessage && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: 10, padding: '14px 16px', marginBottom: 16,
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span style={{ color: '#dc2626', fontSize: 13, lineHeight: 1.5 }}>{execution.errorMessage}</span>
            </div>
          )}

          {/* Output files */}
          {execFiles.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Output Files ({execFiles.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {execFiles.map((f) => (
                  <div key={f.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', background: '#fafbff',
                    border: '1px solid #e8ecf7', borderRadius: 9,
                  }}>
                    <span style={{ fontSize: 20 }}>{fileIcon(f.fileType)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.fileName}
                      </div>
                      {f.fileSizeBytes != null && (
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 1 }}>
                          {formatBytes(f.fileSizeBytes)}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDownload(f.id)}
                      className="btn btn-primary"
                      style={{ padding: '6px 14px', fontSize: 12.5 }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Download
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Run again */}
          <button onClick={handleReset} className="btn btn-secondary" style={{ fontSize: 13 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-3.51" />
            </svg>
            Run again
          </button>
        </div>
      )}
    </div>
  );
}

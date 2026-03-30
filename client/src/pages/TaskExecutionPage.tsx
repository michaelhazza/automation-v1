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

const STATUS_BADGE: Record<string, string> = {
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  running:   'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  failed:    'bg-red-50 text-red-700 border-red-200',
  timeout:   'bg-orange-50 text-orange-700 border-orange-200',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] ?? 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {status}
    </span>
  );
}

export default function TaskExecutionPage({ user: _user }: { user: User }) {
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
  const handleDragLeave = (e: React.DragEvent) => { if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) setDragOver(false); };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files); };

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
    if (stagedFiles.some((f) => f.error)) { setError('Remove files that exceed the size limit before submitting.'); return; }
    setSubmitting(true);
    try {
      let parsedInput: unknown = undefined;
      if (inputData.trim()) {
        try { parsedInput = JSON.parse(inputData); } catch { parsedInput = { text: inputData }; }
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
      setUploadProgress(''); setSubmitting(false);
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
      <div className="animate-[fadeIn_0.2s_ease-out_both] max-w-[760px]">
        <div className="h-7 w-80 mb-2.5 rounded bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
        <div className="h-5 w-[480px] mb-7 rounded bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
        <div className="h-72 rounded-2xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
      </div>
    );
  }

  if (!process) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl py-14 px-8 flex flex-col items-center text-center max-w-[480px] mx-auto">
        <p className="font-bold text-[16px] text-red-600 mb-3">Automation not found</p>
        <Link to="/processes" className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm no-underline transition-colors">
          Back to Automations
        </Link>
      </div>
    );
  }

  const hasInvalidFiles = stagedFiles.some((f) => f.error);
  const isExecuting = execution && ['pending', 'running'].includes(execution.status);
  const isTerminal = execution && !isExecuting;

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both] max-w-[780px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-5 text-[13px]">
        <Link to="/processes" className="text-indigo-600 hover:text-indigo-700 no-underline font-medium">Automations</Link>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="text-slate-500 font-medium">{process.name}</span>
      </div>

      <div className="mb-6">
        <h1 className="text-[26px] font-extrabold text-slate-900 tracking-tight mb-2">{process.name}</h1>
        {process.description && <p className="text-[14px] text-slate-500 leading-relaxed">{process.description}</p>}
      </div>

      {(process.inputSchema || process.outputSchema) && (
        <div className="flex flex-col gap-2.5 mb-6">
          {process.inputSchema && (
            <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3 text-[13px] text-sky-700 flex gap-2.5 items-start">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div><strong>Input guidance:</strong> {process.inputSchema}</div>
            </div>
          )}
          {process.outputSchema && (
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-[13px] text-green-700 flex gap-2.5 items-start">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <div><strong>Expected output:</strong> {process.outputSchema}</div>
            </div>
          )}
        </div>
      )}

      {/* Input form */}
      {!execution && (
        <div className="bg-white border border-slate-200 rounded-xl p-7 mb-5">
          <h3 className="text-[15px] font-bold text-slate-900 tracking-tight mb-5">Automation Input</h3>

          <div className="mb-5">
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
              Input Data <span className="text-[11.5px] font-normal text-slate-400 ml-2">JSON or plain text</span>
            </label>
            <textarea
              value={inputData}
              onChange={(e) => setInputData(e.target.value)}
              placeholder={'{ "key": "value" } or plain text'}
              rows={5}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] font-mono bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-vertical"
            />
          </div>

          <div className="mb-5">
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
              Attachments <span className="text-[11.5px] font-normal text-slate-400 ml-2">optional · max {maxUploadSizeMb} MB each</span>
            </label>
            <input ref={fileInputRef} type="file" multiple onChange={(e) => { if (e.target.files?.length) { addFiles(e.target.files); e.target.value = ''; } }} className="hidden" />
            <div
              ref={dropZoneRef}
              className={`border-2 border-dashed rounded-xl py-8 px-6 text-center cursor-pointer transition-colors ${dragOver ? 'border-violet-400 bg-violet-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className={`w-10 h-10 rounded-xl mx-auto mb-3 flex items-center justify-center transition-colors ${dragOver ? 'bg-violet-100' : 'bg-violet-50'}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={dragOver ? '#8b5cf6' : '#a78bfa'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className={`text-[14px] font-semibold mb-1 ${dragOver ? 'text-violet-700' : 'text-slate-700'}`}>
                {dragOver ? 'Drop files here' : 'Drag & drop files, or click to browse'}
              </div>
              <div className="text-[12.5px] text-slate-400">Audio, video, documents, PDFs, images and more</div>
            </div>

            {stagedFiles.length > 0 && (
              <div className="mt-2.5 flex flex-col gap-1.5">
                {stagedFiles.map((sf) => (
                  <div key={sf.id} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border ${sf.error ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                    <span className="text-lg shrink-0">{fileIcon(sf.file.type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-slate-800 truncate">{sf.file.name}</div>
                      <div className={`text-[11.5px] mt-0.5 ${sf.error ? 'text-red-600' : 'text-slate-400'}`}>{sf.error ?? formatBytes(sf.file.size)}</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); removeFile(sf.id); }} className="bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-600 text-xl px-1 leading-none shrink-0 transition-colors">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer mb-6 select-none">
            <div
              className={`w-[18px] h-[18px] rounded-[5px] shrink-0 border-2 flex items-center justify-center transition-all ${notifyOnComplete ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300'}`}
              onClick={() => setNotifyOnComplete(!notifyOnComplete)}
            >
              {notifyOnComplete && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
            <input type="checkbox" checked={notifyOnComplete} onChange={(e) => setNotifyOnComplete(e.target.checked)} className="hidden" />
            <span className="text-[13.5px] text-slate-700 font-medium">Email me when this process completes</span>
          </label>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5 mb-4 flex items-center gap-2">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="text-red-600 text-[13px]">{error}</span>
            </div>
          )}
          {uploadProgress && (
            <div className="flex items-center gap-2 text-[13px] text-indigo-600 mb-4">
              <div className="w-3.5 h-3.5 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
              {uploadProgress}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || hasInvalidFiles}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white text-[14px] font-semibold rounded-xl transition-colors"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {uploadProgress ? 'Uploading…' : 'Submitting…'}
              </>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Run Automation
              </>
            )}
          </button>
        </div>
      )}

      {/* Executing state */}
      {isExecuting && (
        <div className="bg-white border border-slate-200 rounded-xl py-10 px-7 mb-5 flex flex-col items-center gap-5 text-center">
          <div className="relative w-14 h-14">
            <div className="w-14 h-14 border-[3px] border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
          </div>
          <div>
            <div className="text-[17px] font-bold text-slate-900 tracking-tight mb-2">Executing process…</div>
            <div className="flex items-center justify-center gap-2">
              <span className="text-[13px] text-slate-500">Status:</span>
              <StatusBadge status={execution.status} />
            </div>
            {notifyOnComplete && (
              <div className="mt-3 text-[12.5px] text-slate-500 flex items-center justify-center gap-1.5">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
                </svg>
                You'll receive an email when complete
              </div>
            )}
          </div>
        </div>
      )}

      {/* Result state */}
      {isTerminal && (
        <div className="bg-white border border-slate-200 rounded-xl p-7">
          <div className="flex justify-between items-center mb-5 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center ${execution.status === 'completed' ? 'bg-gradient-to-br from-emerald-400 to-emerald-600' : 'bg-gradient-to-br from-red-400 to-red-600'}`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  {execution.status === 'completed' ? <polyline points="20 6 9 17 4 12" /> : <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>}
                </svg>
              </div>
              <div>
                <div className="font-bold text-[16px] text-slate-900 tracking-tight">
                  Execution {execution.status === 'completed' ? 'completed' : execution.status}
                </div>
                <div className="mt-0.5"><StatusBadge status={execution.status} /></div>
              </div>
            </div>
            {execution.durationMs != null && (
              <div className="text-right">
                <div className="text-[20px] font-bold text-slate-900 tracking-tight">{(execution.durationMs / 1000).toFixed(1)}s</div>
                <div className="text-[11.5px] text-slate-400">duration</div>
              </div>
            )}
          </div>

          {execution.status === 'completed' && execution.outputData != null && (
            <div className="mb-5">
              <div className="font-bold text-[13px] mb-2.5 text-slate-700 flex items-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                Output
              </div>
              <pre className="bg-slate-900 text-slate-200 px-5 py-4 rounded-xl text-[12.5px] overflow-auto whitespace-pre-wrap break-words leading-relaxed m-0 font-mono border border-slate-800 max-h-[400px]">
                {JSON.stringify(execution.outputData, null, 2)}
              </pre>
            </div>
          )}

          {execution.errorMessage && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3.5 mb-4 flex gap-2.5 items-start">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="text-red-600 text-[13px] leading-relaxed">{execution.errorMessage}</span>
            </div>
          )}

          {execFiles.length > 0 && (
            <div className="mb-5">
              <div className="font-bold text-[13px] mb-2.5 text-slate-700 flex items-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Output Files ({execFiles.length})
              </div>
              <div className="flex flex-col gap-2">
                {execFiles.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 px-3.5 py-2.5 bg-indigo-50 border border-indigo-100 rounded-xl">
                    <span className="text-xl">{fileIcon(f.fileType)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-semibold text-slate-800 truncate">{f.fileName}</div>
                      {f.fileSizeBytes != null && <div className="text-[12px] text-slate-400 mt-0.5">{formatBytes(f.fileSizeBytes)}</div>}
                    </div>
                    <button onClick={() => handleDownload(f.id)} className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[12.5px] font-medium transition-colors">
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

          <button onClick={handleReset} className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[13px] font-medium transition-colors">
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

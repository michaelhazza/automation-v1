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
import { useSocketRoom } from '../hooks/useSocket';

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

const STATUS_CLS: Record<string, string> = {
  completed: 'text-green-600',
  failed: 'text-red-600',
  running: 'text-blue-600',
  pending: 'text-amber-600',
  timeout: 'text-orange-600',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const dropZoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!subaccountId) return;
    Promise.all([
      api.get(`/api/portal/${subaccountId}/automations`),
      api.get('/api/settings/upload').catch((err) => { console.error('[PortalExecution] Failed to fetch upload settings:', err); return { data: { maxUploadSizeMb: 200 } }; }),
    ]).then(([portalRes, settingsRes]) => {
      const found = (portalRes.data.automations as Process[]).find((t: Process) => t.id === processId);
      setProcess(found ?? null);
      setMaxUploadSizeMb(settingsRes.data.maxUploadSizeMb ?? 200);
    }).finally(() => setLoading(false));
  }, [subaccountId, processId]);

  // WebSocket: listen for execution status updates
  // On reconnect, re-fetch current execution state from REST
  const executionId = execution?.id ?? null;
  const resyncExecution = useCallback(() => {
    if (!executionId || !subaccountId) return;
    api.get(`/api/portal/${subaccountId}/executions/${executionId}`).then(({ data }) => {
      setExecution(data);
    }).catch((err) => console.error('[PortalExecution] Failed to resync execution:', err));
  }, [executionId, subaccountId]);

  useSocketRoom('execution', executionId, {
    'execution:status': (data: unknown) => {
      const d = data as { status: string; outputData?: unknown; errorMessage?: string | null; durationMs?: number | null };
      setExecution(prev => prev ? { ...prev, status: d.status, outputData: d.outputData ?? prev.outputData, errorMessage: d.errorMessage ?? prev.errorMessage, durationMs: d.durationMs ?? prev.durationMs } : prev);
    },
  }, resyncExecution);

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

      for (let i = 0; i < stagedFiles.length; i++) {
        const { file } = stagedFiles[i];
        setUploadProgress(`Uploading file ${i + 1} of ${stagedFiles.length}: ${file.name}`);
        const formData = new FormData();
        formData.append('executionId', execId);
        formData.append('file', file);
        await api.post('/api/files/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      setUploadProgress('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to submit process');
      setUploadProgress('');
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  if (!process) return <div className="text-red-600 p-8">Automation not found</div>;

  const hasInvalidFiles = stagedFiles.some((f) => f.error);
  const isExecuting = execution && ['pending', 'running'].includes(execution.status);

  return (
    <>
      <div className="mb-4">
        <Link to={`/portal/${subaccountId}`} className="text-blue-600 text-[13px] no-underline">← Back to automations</Link>
      </div>
      <div className="max-w-[760px]">
        <h1 className="text-[26px] font-bold text-slate-800 mb-2">{process.name}</h1>
        {process.description && <p className="text-slate-500 mb-6">{process.description}</p>}

        {process.outputSchema && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-5 text-[13px] text-green-800">
            <strong>Expected output:</strong> {process.outputSchema}
          </div>
        )}

        {process.inputSchema && (
          <div className="bg-sky-50 border border-sky-200 rounded-lg px-4 py-3 mb-5 text-[13px] text-sky-800">
            <strong>Input guidance:</strong> {process.inputSchema}
          </div>
        )}

        {!execution && (
          <div className="bg-white rounded-xl p-6 border border-slate-200 mb-6">
            <div className="mb-5">
              <label className="block text-[13px] font-semibold text-slate-700 mb-2">Input Data (JSON or plain text)</label>
              <textarea
                value={inputData}
                onChange={(e) => setInputData(e.target.value)}
                placeholder='{ "key": "value" } or plain text'
                rows={5}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[13px] font-mono resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="mb-5">
              <label className="block text-[13px] font-semibold text-slate-700 mb-2">Attach files (optional)</label>
              <input ref={fileInputRef} type="file" multiple onChange={(e) => { if (e.target.files) { addFiles(e.target.files); e.target.value = ''; } }} className="hidden" />
              <div
                ref={dropZoneRef}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={(e) => { if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) setDragOver(false); }}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files); }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl py-8 px-6 text-center cursor-pointer transition-colors ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'}`}
              >
                <div className="text-3xl mb-2">📁</div>
                <div className={`text-[14px] font-medium mb-1 ${dragOver ? 'text-blue-600' : 'text-slate-700'}`}>
                  {dragOver ? 'Drop files here' : 'Drag & drop files here, or click to browse'}
                </div>
                <div className="text-[12px] text-slate-400">Max {maxUploadSizeMb} MB per file</div>
              </div>
              {stagedFiles.length > 0 && (
                <div className="mt-2.5 flex flex-col gap-1.5">
                  {stagedFiles.map((sf) => (
                    <div key={sf.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${sf.error ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-slate-800 truncate">{sf.file.name}</div>
                        <div className={`text-[11px] ${sf.error ? 'text-red-600' : 'text-slate-500'}`}>{sf.error ?? formatBytes(sf.file.size)}</div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); removeFile(sf.id); }} className="bg-transparent border-0 cursor-pointer text-slate-400 hover:text-red-400 text-lg leading-none transition-colors">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer mb-5">
              <input type="checkbox" checked={notifyOnComplete} onChange={(e) => setNotifyOnComplete(e.target.checked)} className="w-4 h-4 cursor-pointer accent-blue-600" />
              <span className="text-[13px] text-slate-700">Email me when this process completes</span>
            </label>

            {error && <div className="text-red-600 text-[13px] mb-4">{error}</div>}
            {uploadProgress && <div className="text-blue-600 text-[13px] mb-4">{uploadProgress}</div>}

            <button
              onClick={handleSubmit}
              disabled={submitting || hasInvalidFiles}
              className={`px-6 py-2.5 text-white text-[14px] font-semibold rounded-lg border-0 transition-colors ${submitting || hasInvalidFiles ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 cursor-pointer'}`}
            >
              {submitting ? (uploadProgress ? 'Uploading...' : 'Submitting...') : 'Run Automation'}
            </button>
          </div>
        )}

        {isExecuting && (
          <div className="bg-white rounded-xl px-6 py-8 border border-slate-200 mb-6 flex flex-col items-center gap-4 text-center">
            <div className="w-9 h-9 rounded-full border-[3px] border-slate-200 border-t-blue-600 animate-spin shrink-0" />
            <div>
              <div className="text-[16px] font-semibold text-slate-800 mb-1.5">Executing... please wait</div>
              <div className="text-[13px] text-slate-500">
                Status: <span className={`font-semibold ${STATUS_CLS[execution.status] ?? 'text-slate-500'}`}>{execution.status}</span>
              </div>
            </div>
          </div>
        )}

        {execution && !isExecuting && (
          <div className="bg-white rounded-xl p-6 border border-slate-200">
            <div className="flex justify-between items-center mb-4">
              <div>
                <span className="font-semibold text-[16px]">Execution status: </span>
                <span className={`font-bold ${STATUS_CLS[execution.status] ?? 'text-slate-500'}`}>{execution.status}</span>
              </div>
              {execution.durationMs != null && <span className="text-[13px] text-slate-500">{(execution.durationMs / 1000).toFixed(1)}s</span>}
            </div>

            {execution.status === 'completed' && execution.outputData != null && (
              <div className="mb-4">
                <div className="font-semibold text-[13px] text-slate-700 mb-2">Output</div>
                <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-[12px] overflow-auto whitespace-pre-wrap break-words text-slate-800">
                  {JSON.stringify(execution.outputData, null, 2)}
                </pre>
              </div>
            )}

            {execution.errorMessage && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-600 text-[13px] mb-4">
                {execution.errorMessage}
              </div>
            )}

            <button
              onClick={() => { setExecution(null); setInputData(''); setStagedFiles([]); setNotifyOnComplete(false); }}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border-0 rounded-lg text-[13px] cursor-pointer transition-colors"
            >
              Run again
            </button>
          </div>
        )}
      </div>
    </>
  );
}

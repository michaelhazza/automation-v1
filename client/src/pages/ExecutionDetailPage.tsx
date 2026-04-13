import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Execution {
  id: string;
  processId: string;
  status: string;
  inputData: unknown;
  outputData: unknown;
  errorMessage: string | null;
  errorDetail: unknown;
  isTestExecution: boolean;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
}

interface ExecFile {
  id: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number | null;
  expiresAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'text-green-600',
  failed:    'text-red-600',
  running:   'text-blue-600',
  pending:   'text-amber-600',
  timeout:   'text-orange-600',
  cancelled: 'text-slate-500',
};

export default function ExecutionDetailPage({ user }: { user: User }) {
  const { id } = useParams<{ id: string }>();
  const [execution, setExecution] = useState<Execution | null>(null);
  const [files, setFiles] = useState<ExecFile[]>([]);
  const [loading, setLoading] = useState(true);
  const isAdmin = user.role === 'org_admin' || user.role === 'system_admin';

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get(`/api/executions/${id}`);
        setExecution(data);
        const { data: f } = await api.get(`/api/executions/${id}/files`);
        setFiles(f);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const handleDownload = async (fileId: string) => {
    const { data } = await api.get(`/api/files/${fileId}/download`);
    window.open(data.downloadUrl, '_blank');
  };

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  if (!execution) return <div className="p-8 text-sm text-red-600">Execution not found</div>;

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="mb-4">
        <Link to="/admin/activity" className="text-[13px] text-indigo-600 hover:text-indigo-700 no-underline">
          ← Back to activity
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-slate-800 mb-1">Execution Detail</h1>
      <div className="font-mono text-xs text-slate-400 mb-6">{execution.id}</div>

      {/* Stats grid */}
      <div className="grid gap-4 mb-6 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
        {[
          {
            label: 'Status',
            value: <span className={`font-bold capitalize ${STATUS_STYLES[execution.status] ?? 'text-slate-500'}`}>{execution.status}</span>,
          },
          {
            label: 'Duration',
            value: execution.durationMs != null ? `${(execution.durationMs / 1000).toFixed(2)}s` : '—',
          },
          {
            label: 'Started',
            value: execution.startedAt ? new Date(execution.startedAt).toLocaleString() : '—',
          },
          {
            label: 'Completed',
            value: execution.completedAt ? new Date(execution.completedAt).toLocaleString() : '—',
          },
          {
            label: 'Type',
            value: execution.isTestExecution ? (
              <span className="text-sky-600 font-semibold">Test</span>
            ) : 'Production',
          },
        ].map((item) => (
          <div key={item.label} className="bg-white border border-slate-200 rounded-xl px-5 py-4">
            <div className="text-xs text-slate-500 mb-1.5">{item.label}</div>
            <div className="text-[15px] font-semibold text-slate-800">{item.value}</div>
          </div>
        ))}
      </div>

      {/* Input Data */}
      {execution.inputData != null && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
          <h2 className="text-[15px] font-semibold text-slate-700 mb-3">Input Data</h2>
          <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs overflow-auto whitespace-pre-wrap break-words text-slate-800 m-0">
            {JSON.stringify(execution.inputData, null, 2)}
          </pre>
        </div>
      )}

      {/* Output Data */}
      {execution.outputData != null && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
          <h2 className="text-[15px] font-semibold text-slate-700 mb-3">Output Data</h2>
          <pre className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs overflow-auto whitespace-pre-wrap break-words text-slate-800 m-0">
            {JSON.stringify(execution.outputData, null, 2)}
          </pre>
        </div>
      )}

      {/* Error */}
      {execution.errorMessage && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-4">
          <h2 className="text-[15px] font-semibold text-red-700 mb-2">Error</h2>
          <p className="text-sm text-red-600 m-0">{execution.errorMessage}</p>
          {isAdmin && execution.errorDetail != null && (
            <pre className="bg-white rounded-lg p-3 text-[11px] overflow-auto mt-3 text-red-900 m-0">
              {JSON.stringify(execution.errorDetail, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Files */}
      {files.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-[15px] font-semibold text-slate-700 mb-3">Files</h2>
          <div className="divide-y divide-slate-100">
            {files.map((f) => (
              <div key={f.id} className="flex items-center gap-3 py-2.5">
                <span className="flex-1 text-[13px] text-slate-800">{f.fileName}</span>
                <span className="text-[11px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded">{f.fileType}</span>
                {f.fileSizeBytes != null && (
                  <span className="text-xs text-slate-500">{Math.round(f.fileSizeBytes / 1024)}KB</span>
                )}
                <button
                  onClick={() => handleDownload(f.id)}
                  className="px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold transition-colors"
                >
                  Download
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

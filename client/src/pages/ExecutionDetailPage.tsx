import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Execution {
  id: string;
  taskId: string;
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

const STATUS_COLORS: Record<string, string> = {
  completed: '#16a34a',
  failed: '#dc2626',
  running: '#2563eb',
  pending: '#d97706',
  timeout: '#ea580c',
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

  if (loading) return <div>Loading...</div>;
  if (!execution) return <div style={{ color: '#dc2626' }}>Execution not found</div>;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Link to="/executions" style={{ color: '#2563eb', fontSize: 13, textDecoration: 'none' }}>← Back to executions</Link>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>Execution Detail</h1>
      <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b', marginBottom: 24 }}>{execution.id}</div>

      {/* Status card */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Status', value: <span style={{ color: STATUS_COLORS[execution.status] ?? '#6b7280', fontWeight: 700 }}>{execution.status}</span> },
          { label: 'Duration', value: execution.durationMs != null ? `${(execution.durationMs / 1000).toFixed(2)}s` : '-' },
          { label: 'Started', value: execution.startedAt ? new Date(execution.startedAt).toLocaleString() : '-' },
          { label: 'Completed', value: execution.completedAt ? new Date(execution.completedAt).toLocaleString() : '-' },
          { label: 'Type', value: execution.isTestExecution ? 'Test' : 'Production' },
        ].map((item) => (
          <div key={item.label} style={{ background: '#fff', borderRadius: 10, padding: '16px 20px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{item.label}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b' }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Input Data */}
      {execution.inputData != null && (
        <div style={{ background: '#fff', borderRadius: 10, padding: 20, border: '1px solid #e2e8f0', marginBottom: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#374151', margin: '0 0 12px' }}>Input Data</h2>
          <pre style={{ background: '#f8fafc', padding: 16, borderRadius: 8, fontSize: 12, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#1e293b', border: '1px solid #e2e8f0', margin: 0 }}>
            {JSON.stringify(execution.inputData, null, 2)}
          </pre>
        </div>
      )}

      {/* Output Data */}
      {execution.outputData != null && (
        <div style={{ background: '#fff', borderRadius: 10, padding: 20, border: '1px solid #e2e8f0', marginBottom: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#374151', margin: '0 0 12px' }}>Output Data</h2>
          <pre style={{ background: '#f8fafc', padding: 16, borderRadius: 8, fontSize: 12, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#1e293b', border: '1px solid #e2e8f0', margin: 0 }}>
            {JSON.stringify(execution.outputData, null, 2)}
          </pre>
        </div>
      )}

      {/* Error */}
      {execution.errorMessage && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 20, marginBottom: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#dc2626', margin: '0 0 8px' }}>Error</h2>
          <p style={{ margin: 0, color: '#dc2626', fontSize: 14 }}>{execution.errorMessage}</p>
          {isAdmin && execution.errorDetail != null && (
            <pre style={{ background: '#fff', padding: 12, borderRadius: 8, fontSize: 11, overflow: 'auto', marginTop: 12, color: '#7f1d1d' }}>
              {JSON.stringify(execution.errorDetail, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Files */}
      {files.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 10, padding: 20, border: '1px solid #e2e8f0' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#374151', margin: '0 0 12px' }}>Files</h2>
          {files.map((f) => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ flex: 1, fontSize: 13, color: '#1e293b' }}>{f.fileName}</span>
              <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: 4 }}>{f.fileType}</span>
              {f.fileSizeBytes != null && <span style={{ fontSize: 12, color: '#64748b' }}>{Math.round(f.fileSizeBytes / 1024)}KB</span>}
              <button onClick={() => handleDownload(f.id)} style={{ padding: '4px 12px', background: '#dbeafe', color: '#1d4ed8', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                Download
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

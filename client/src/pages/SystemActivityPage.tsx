import { useEffect, useState } from 'react';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Execution {
  id: string;
  processName: string | null;
  organisationName: string | null;
  userEmail: string | null;
  status: string;
  engineType: string | null;
  durationMs: number | null;
  createdAt: string;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}><span className="badge-dot" />{status}</span>;
}

export default function SystemActivityPage({ user }: { user: User }) {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterEngineType, setFilterEngineType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: String(limit), offset: String(offset) };
      if (filterStatus) params.status = filterStatus;
      if (filterEngineType) params.engineType = filterEngineType;
      if (from) params.from = from;
      if (to) params.to = to;
      const { data } = await api.get('/api/system/executions', { params });
      setExecutions(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [offset]);

  const handleClearFilters = () => {
    setFilterStatus(''); setFilterEngineType(''); setFrom(''); setTo('');
    setOffset(0);
  };

  const hasFilters = filterStatus || filterEngineType || from || to;
  const statuses = ['pending', 'running', 'completed', 'failed', 'timeout', 'cancelled'];
  const engineTypes = ['n8n', 'ghl', 'make', 'zapier', 'custom_webhook'];

  return (
    <div className="page-enter">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.03em' }}>
          Platform Activity
        </h1>
        <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>
          Execution activity across all organisations and clients
        </p>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 160px', minWidth: 140 }}>
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
              Status
            </label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="form-select">
              <option value="">All statuses</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div style={{ flex: '1 1 160px', minWidth: 140 }}>
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
              Engine
            </label>
            <select value={filterEngineType} onChange={(e) => setFilterEngineType(e.target.value)} className="form-select">
              <option value="">All engines</option>
              {engineTypes.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>

          <div style={{ flex: '1 1 148px', minWidth: 130 }}>
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
              From
            </label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="form-input" style={{ fontSize: 13 }} />
          </div>

          <div style={{ flex: '1 1 148px', minWidth: 130 }}>
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
              To
            </label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="form-input" style={{ fontSize: 13 }} />
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button onClick={() => { setOffset(0); load(); }} className="btn btn-primary" style={{ fontSize: 13.5 }}>
              Apply
            </button>
            {hasFilters && (
              <button onClick={handleClearFilters} className="btn btn-ghost" style={{ fontSize: 13 }}>Clear</button>
            )}
          </div>
        </div>
      </div>

      {/* Results summary */}
      {!loading && (
        <div style={{ marginBottom: 12, fontSize: 13, color: '#64748b' }}>
          <strong style={{ color: '#0f172a' }}>{executions.length}</strong> execution{executions.length !== 1 ? 's' : ''} shown
          {hasFilters && <span style={{ marginLeft: 8, fontSize: 12, color: '#6366f1', fontWeight: 500 }}>(filtered)</span>}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton" style={{ height: 52, borderRadius: 8 }} />
          ))}
        </div>
      ) : executions.length === 0 ? (
        <div className="card empty-state">
          <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 16, color: '#0f172a' }}>No executions found</p>
          <p style={{ margin: 0, fontSize: 13.5, color: '#64748b' }}>
            {hasFilters ? 'Try adjusting your filters.' : 'No automation activity recorded yet.'}
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Organisation</th>
                <th>Automation</th>
                <th>User</th>
                <th>Engine</th>
                <th>Status</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((exec) => (
                <tr key={exec.id}>
                  <td style={{ color: '#64748b', fontSize: 13, whiteSpace: 'nowrap' }}>
                    {new Date(exec.createdAt).toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td style={{ color: '#374151', fontSize: 13.5, fontWeight: 500 }}>
                    {exec.organisationName ?? '—'}
                  </td>
                  <td style={{ color: '#374151', fontSize: 13.5, fontWeight: 500 }}>
                    {exec.processName ?? <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Unknown</span>}
                  </td>
                  <td style={{ color: '#64748b', fontSize: 13 }}>
                    {exec.userEmail ?? '—'}
                  </td>
                  <td>
                    {exec.engineType ? (
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px',
                        borderRadius: 9999, background: '#f1f5f9', color: '#475569',
                      }}>
                        {exec.engineType}
                      </span>
                    ) : '—'}
                  </td>
                  <td><StatusBadge status={exec.status} /></td>
                  <td style={{ color: '#64748b', fontSize: 13 }}>
                    {exec.durationMs != null ? (
                      <span style={{ fontWeight: 500 }}>{(exec.durationMs / 1000).toFixed(1)}s</span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!loading && executions.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="btn btn-secondary"
            style={{ fontSize: 13 }}
          >
            Previous
          </button>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={executions.length < limit}
            className="btn btn-secondary"
            style={{ fontSize: 13 }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

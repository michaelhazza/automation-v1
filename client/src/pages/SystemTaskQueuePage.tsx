import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface ExecutionRow {
  id: string;
  status: string;
  engineType: string;
  isTestExecution: boolean;
  retryCount: number;
  errorMessage: string | null;
  errorDetail: unknown;
  returnWebhookUrl: string | null;
  outboundPayload: unknown;
  callbackReceivedAt: string | null;
  callbackPayload: unknown;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  notifyOnComplete: boolean;
  processSnapshot: unknown;
  organisationId: string;
  processId: string;
  userId: string;
  organisationName: string | null;
  processName: string | null;
  userEmail: string | null;
  userFirstName: string | null;
  userLastName: string | null;
}

interface Organisation {
  id: string;
  name: string;
}

const STATUS_COLOR: Record<string, string> = {
  completed: '#16a34a',
  failed: '#dc2626',
  running: '#2563eb',
  pending: '#d97706',
  timeout: '#ea580c',
  cancelled: '#6b7280',
};

const STATUS_BG: Record<string, string> = {
  completed: '#f0fdf4',
  failed: '#fef2f2',
  running: '#eff6ff',
  pending: '#fffbeb',
  timeout: '#fff7ed',
  cancelled: '#f9fafb',
};

const ENGINE_COLORS: Record<string, string> = {
  n8n: '#ea580c',
  ghl: '#7c3aed',
  make: '#0891b2',
  zapier: '#f97316',
  custom_webhook: '#6b7280',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function JsonBlock({ data, label }: { data: unknown; label: string }) {
  const [open, setOpen] = useState(false);
  if (data == null) return <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>;
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#2563eb', fontSize: 12, textDecoration: 'underline' }}
      >
        {open ? 'Hide' : 'View'} {label}
      </button>
      {open && (
        <pre style={{
          marginTop: 6,
          background: '#0f172a',
          color: '#e2e8f0',
          padding: '10px 12px',
          borderRadius: 6,
          fontSize: 11,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: 300,
        }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function DiagnosticPanel({ row, onClose }: { row: ExecutionRow; onClose: () => void }) {
  const issues: { label: string; desc: string; severity: 'error' | 'warn' | 'ok' }[] = [];

  // Check for callback not received
  if (['completed', 'failed', 'timeout'].includes(row.status)) {
    if (!row.callbackReceivedAt && row.returnWebhookUrl) {
      issues.push({ label: 'Callback not received', desc: 'The engine was called but no callback was received at the return webhook URL. This may indicate an n8n workflow error or misconfigured callback URL.', severity: 'warn' });
    }
  }

  // Check for error message
  if (row.errorMessage) {
    issues.push({ label: 'Execution error', desc: row.errorMessage, severity: 'error' });
  }

  // Check retries
  if (row.retryCount > 0) {
    issues.push({ label: `Retried ${row.retryCount} time(s)`, desc: 'The engine call was retried due to network errors.', severity: 'warn' });
  }

  // Check timeout
  if (row.status === 'timeout') {
    issues.push({ label: 'Execution timed out', desc: 'The process did not complete within the configured timeout window.', severity: 'error' });
  }

  // No issues
  if (issues.length === 0 && row.status === 'completed') {
    issues.push({ label: 'No issues detected', desc: 'Execution completed successfully with no diagnostic concerns.', severity: 'ok' });
  }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 16px', overflowY: 'auto',
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, width: '100%', maxWidth: 780,
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        marginBottom: 40,
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, color: '#1e293b', marginBottom: 4 }}>
              Execution Diagnostics
            </div>
            <div style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>{row.id}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Overview */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Organisation', value: row.organisationName ?? row.organisationId },
              { label: 'Process', value: row.processName ?? row.processId },
              { label: 'User', value: row.userEmail ?? row.userId },
              { label: 'Engine', value: row.engineType },
              { label: 'Status', value: row.status },
              { label: 'Duration', value: formatDuration(row.durationMs) },
              { label: 'Queued at', value: formatDate(row.queuedAt) },
              { label: 'Started at', value: formatDate(row.startedAt) },
              { label: 'Completed at', value: formatDate(row.completedAt) },
              { label: 'Retries', value: String(row.retryCount) },
              { label: 'Test execution', value: row.isTestExecution ? 'Yes' : 'No' },
              { label: 'Notify on complete', value: row.notifyOnComplete ? 'Yes' : 'No' },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                <div style={{ fontSize: 13, color: '#1e293b', fontWeight: 500, wordBreak: 'break-all' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Diagnostic issues */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#1e293b', marginBottom: 10 }}>Diagnostics</div>
            {issues.map((issue, i) => (
              <div key={i} style={{
                display: 'flex', gap: 12, alignItems: 'flex-start',
                padding: '10px 14px', borderRadius: 8, marginBottom: 8,
                background: issue.severity === 'error' ? '#fef2f2' : issue.severity === 'warn' ? '#fffbeb' : '#f0fdf4',
                border: `1px solid ${issue.severity === 'error' ? '#fecaca' : issue.severity === 'warn' ? '#fde68a' : '#bbf7d0'}`,
              }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>
                  {issue.severity === 'error' ? '❌' : issue.severity === 'warn' ? '⚠️' : '✅'}
                </span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b', marginBottom: 2 }}>{issue.label}</div>
                  <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>{issue.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Webhook / callback URLs */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#1e293b', marginBottom: 10 }}>Webhook & Callback</div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Return webhook URL (sent to engine)</div>
              {row.returnWebhookUrl ? (
                <code style={{ fontSize: 12, background: '#f1f5f9', padding: '6px 10px', borderRadius: 6, display: 'block', wordBreak: 'break-all', color: '#0f172a' }}>
                  {row.returnWebhookUrl}
                </code>
              ) : (
                <span style={{ color: '#94a3b8', fontSize: 12 }}>Not set</span>
              )}
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Callback received at</div>
              <div style={{ fontSize: 13, color: '#1e293b' }}>
                {row.callbackReceivedAt
                  ? formatDate(row.callbackReceivedAt)
                  : <span style={{ color: '#dc2626', fontWeight: 500 }}>No callback received</span>
                }
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <JsonBlock data={row.outboundPayload} label="outbound payload (sent to engine)" />
              <JsonBlock data={row.callbackPayload} label="callback payload (received from engine)" />
              <JsonBlock data={row.errorDetail} label="error detail" />
            </div>
          </div>

          {/* Process snapshot */}
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#1e293b', marginBottom: 10 }}>Process Snapshot</div>
            <JsonBlock data={row.processSnapshot} label="process configuration at time of execution" />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

const STATUSES = ['', 'pending', 'running', 'completed', 'failed', 'timeout', 'cancelled'];
const ENGINE_TYPES = ['', 'n8n', 'ghl', 'make', 'zapier', 'custom_webhook'];

export default function SystemProcessQueuePage({ user }: { user: User }) {
  const [rows, setRows] = useState<ExecutionRow[]>([]);
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ExecutionRow | null>(null);

  // Filters
  const [filterOrg, setFilterOrg] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterEngine, setFilterEngine] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const fetchOrgs = useCallback(async () => {
    try {
      const { data } = await api.get('/api/organisations');
      setOrgs(data);
    } catch {
      // orgs list is non-critical
    }
  }, []);

  const fetchExecutions = useCallback(async (off = 0) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filterOrg) params.set('organisationId', filterOrg);
      if (filterStatus) params.set('status', filterStatus);
      if (filterEngine) params.set('engineType', filterEngine);
      if (filterFrom) params.set('from', new Date(filterFrom).toISOString());
      if (filterTo) params.set('to', new Date(filterTo).toISOString());
      params.set('limit', String(LIMIT));
      params.set('offset', String(off));

      const { data } = await api.get(`/api/system/executions?${params.toString()}`);
      setRows(data);
      setOffset(off);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to load executions');
    } finally {
      setLoading(false);
    }
  }, [filterOrg, filterStatus, filterEngine, filterFrom, filterTo]);

  useEffect(() => {
    fetchOrgs();
    fetchExecutions(0);
  }, []);

  const handleSearch = () => fetchExecutions(0);
  const handlePrev = () => fetchExecutions(Math.max(0, offset - LIMIT));
  const handleNext = () => fetchExecutions(offset + LIMIT);

  const selectStyle: React.CSSProperties = {
    padding: '7px 10px',
    border: '1px solid #d1d5db',
    borderRadius: 7,
    fontSize: 13,
    background: '#fff',
    color: '#1e293b',
    cursor: 'pointer',
  };

  const inputStyle: React.CSSProperties = {
    padding: '7px 10px',
    border: '1px solid #d1d5db',
    borderRadius: 7,
    fontSize: 13,
    color: '#1e293b',
    background: '#fff',
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>System Task Queue</h1>
        <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>
          All process executions across every organisation. Use diagnostic tools to investigate failures.
        </p>
      </div>

      {/* Filters */}
      <div style={{
        background: '#fff', borderRadius: 10, padding: '16px 20px',
        border: '1px solid #e2e8f0', marginBottom: 20,
        display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end',
      }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4, fontWeight: 500 }}>Organisation</label>
          <select value={filterOrg} onChange={(e) => setFilterOrg(e.target.value)} style={{ ...selectStyle, minWidth: 160 }}>
            <option value="">All organisations</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4, fontWeight: 500 }}>Status</label>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={selectStyle}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s || 'All statuses'}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4, fontWeight: 500 }}>Engine</label>
          <select value={filterEngine} onChange={(e) => setFilterEngine(e.target.value)} style={selectStyle}>
            {ENGINE_TYPES.map((e) => (
              <option key={e} value={e}>{e || 'All engines'}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4, fontWeight: 500 }}>From</label>
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} style={inputStyle} />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4, fontWeight: 500 }}>To</label>
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} style={inputStyle} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleSearch}
            style={{ padding: '7px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Search
          </button>
          <button
            onClick={() => { setFilterOrg(''); setFilterStatus(''); setFilterEngine(''); setFilterFrom(''); setFilterTo(''); }}
            style={{ padding: '7px 14px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}
          >
            Reset
          </button>
          <button
            onClick={() => fetchExecutions(offset)}
            style={{ padding: '7px 14px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}
            title="Refresh"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', color: '#dc2626', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 14 }}>Loading...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 14 }}>No executions found for the selected filters.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  {['Created', 'Organisation', 'Process', 'User', 'Engine', 'Status', 'Duration', 'Retries', 'Callback', 'Actions'].map((h) => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const callbackMissing = ['completed', 'failed', 'timeout'].includes(row.status) && !row.callbackReceivedAt && !!row.returnWebhookUrl;
                  return (
                    <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#64748b', fontSize: 12 }}>
                        {formatDate(row.createdAt)}
                      </td>
                      <td style={{ padding: '10px 14px', maxWidth: 140 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1e293b', fontWeight: 500 }} title={row.organisationName ?? row.organisationId}>
                          {row.organisationName ?? <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 11 }}>{row.organisationId.slice(0, 8)}</span>}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', maxWidth: 160 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1e293b' }} title={row.processName ?? row.processId}>
                          {row.processName ?? <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 11 }}>{row.processId.slice(0, 8)}</span>}
                          {row.isTestExecution && (
                            <span style={{ marginLeft: 6, fontSize: 10, background: '#e0e7ff', color: '#3730a3', padding: '1px 5px', borderRadius: 4, fontWeight: 600 }}>TEST</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', maxWidth: 160 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#475569', fontSize: 12 }} title={row.userEmail ?? ''}>
                          {row.userEmail ?? '—'}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                          fontSize: 11, fontWeight: 600,
                          background: `${ENGINE_COLORS[row.engineType] ?? '#6b7280'}22`,
                          color: ENGINE_COLORS[row.engineType] ?? '#6b7280',
                        }}>
                          {row.engineType}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 9px', borderRadius: 5,
                          fontSize: 11, fontWeight: 700,
                          background: STATUS_BG[row.status] ?? '#f9fafb',
                          color: STATUS_COLOR[row.status] ?? '#6b7280',
                          border: `1px solid ${STATUS_COLOR[row.status] ?? '#e2e8f0'}44`,
                        }}>
                          {row.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#64748b', fontSize: 12 }}>
                        {formatDuration(row.durationMs)}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'center', color: row.retryCount > 0 ? '#ea580c' : '#64748b', fontWeight: row.retryCount > 0 ? 700 : 400 }}>
                        {row.retryCount}
                      </td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        {callbackMissing ? (
                          <span style={{ color: '#dc2626', fontSize: 12, fontWeight: 600 }}>⚠ Missing</span>
                        ) : row.callbackReceivedAt ? (
                          <span style={{ color: '#16a34a', fontSize: 12 }}>Received</span>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => setSelected(row)}
                          style={{
                            padding: '4px 12px', background: '#eff6ff', color: '#2563eb',
                            border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 12,
                            cursor: 'pointer', fontWeight: 500,
                          }}
                        >
                          Diagnose
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && rows.length > 0 && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              Showing {offset + 1}–{offset + rows.length}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handlePrev}
                disabled={offset === 0}
                style={{ padding: '5px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, cursor: offset === 0 ? 'not-allowed' : 'pointer', opacity: offset === 0 ? 0.5 : 1 }}
              >
                Previous
              </button>
              <button
                onClick={handleNext}
                disabled={rows.length < LIMIT}
                style={{ padding: '5px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, cursor: rows.length < LIMIT ? 'not-allowed' : 'pointer', opacity: rows.length < LIMIT ? 0.5 : 1 }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Diagnostic panel modal */}
      {selected && <DiagnosticPanel row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

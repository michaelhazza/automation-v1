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

const STATUS_CLS: Record<string, string> = {
  completed: 'bg-green-50 text-green-700 border-green-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  running: 'bg-blue-50 text-blue-700 border-blue-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  timeout: 'bg-orange-50 text-orange-700 border-orange-200',
  cancelled: 'bg-slate-50 text-slate-600 border-slate-200',
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
  return new Date(iso).toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function JsonBlock({ data, label }: { data: unknown; label: string }) {
  const [open, setOpen] = useState(false);
  if (data == null) return <span className="text-slate-400 text-[12px]">—</span>;
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="bg-transparent border-0 p-0 cursor-pointer text-blue-600 text-[12px] underline"
      >
        {open ? 'Hide' : 'View'} {label}
      </button>
      {open && (
        <pre className="mt-1.5 bg-slate-900 text-slate-200 px-3 py-2.5 rounded-md text-[11px] overflow-auto whitespace-pre-wrap break-all max-h-[300px]">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function DiagnosticPanel({ row, onClose }: { row: ExecutionRow; onClose: () => void }) {
  const issues: { label: string; desc: string; severity: 'error' | 'warn' | 'ok' }[] = [];

  if (['completed', 'failed', 'timeout'].includes(row.status)) {
    if (!row.callbackReceivedAt && row.returnWebhookUrl) {
      issues.push({ label: 'Callback not received', desc: 'The engine was called but no callback was received at the return webhook URL. This may indicate an n8n workflow error or misconfigured callback URL.', severity: 'warn' });
    }
  }
  if (row.errorMessage) {
    issues.push({ label: 'Execution error', desc: row.errorMessage, severity: 'error' });
  }
  if (row.retryCount > 0) {
    issues.push({ label: `Retried ${row.retryCount} time(s)`, desc: 'The engine call was retried due to network errors.', severity: 'warn' });
  }
  if (row.status === 'timeout') {
    issues.push({ label: 'Execution timed out', desc: 'The process did not complete within the configured timeout window.', severity: 'error' });
  }
  if (issues.length === 0 && row.status === 'completed') {
    issues.push({ label: 'No issues detected', desc: 'Execution completed successfully with no diagnostic concerns.', severity: 'ok' });
  }

  const issueCls = (sev: 'error' | 'warn' | 'ok') => {
    if (sev === 'error') return 'bg-red-50 border border-red-200';
    if (sev === 'warn') return 'bg-amber-50 border border-amber-200';
    return 'bg-green-50 border border-green-200';
  };

  return createPortal(
    <div className="fixed inset-0 z-[1000] bg-black/50 flex items-start justify-center px-4 py-10 overflow-y-auto">
      <div className="bg-white rounded-xl w-full max-w-[780px] shadow-2xl mb-10">
        <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-start">
          <div>
            <div className="font-bold text-[17px] text-slate-800 mb-1">Execution Diagnostics</div>
            <div className="text-[12px] text-slate-500 font-mono">{row.id}</div>
          </div>
          <button onClick={onClose} className="bg-transparent border-0 text-[22px] cursor-pointer text-slate-400 hover:text-slate-600 leading-none px-1">×</button>
        </div>

        <div className="p-6">
          {/* Overview */}
          <div className="grid grid-cols-2 gap-3 mb-5">
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
              <div key={label} className="bg-slate-50 rounded-lg px-3.5 py-2.5">
                <div className="text-[11px] text-slate-500 mb-0.5 uppercase tracking-wider">{label}</div>
                <div className="text-[13px] text-slate-800 font-medium break-all">{value}</div>
              </div>
            ))}
          </div>

          {/* Diagnostic issues */}
          <div className="mb-5">
            <div className="font-semibold text-[14px] text-slate-800 mb-2.5">Diagnostics</div>
            {issues.map((issue, i) => (
              <div key={i} className={`flex gap-3 items-start px-3.5 py-2.5 rounded-lg mb-2 ${issueCls(issue.severity)}`}>
                <span className="text-[16px] shrink-0">
                  {issue.severity === 'error' ? '❌' : issue.severity === 'warn' ? '⚠️' : '✅'}
                </span>
                <div>
                  <div className="font-semibold text-[13px] text-slate-800 mb-0.5">{issue.label}</div>
                  <div className="text-[12px] text-slate-600 leading-relaxed">{issue.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Webhook & Callback */}
          <div className="mb-5">
            <div className="font-semibold text-[14px] text-slate-800 mb-2.5">Webhook & Callback</div>
            <div className="mb-2.5">
              <div className="text-[12px] text-slate-500 mb-1">Return webhook URL (sent to engine)</div>
              {row.returnWebhookUrl ? (
                <code className="text-[12px] bg-slate-100 px-2.5 py-1.5 rounded-md block break-all text-slate-900">
                  {row.returnWebhookUrl}
                </code>
              ) : (
                <span className="text-slate-400 text-[12px]">Not set</span>
              )}
            </div>
            <div className="mb-2.5">
              <div className="text-[12px] text-slate-500 mb-1">Callback received at</div>
              <div className="text-[13px] text-slate-800">
                {row.callbackReceivedAt
                  ? formatDate(row.callbackReceivedAt)
                  : <span className="text-red-600 font-medium">No callback received</span>
                }
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <JsonBlock data={row.outboundPayload} label="outbound payload (sent to engine)" />
              <JsonBlock data={row.callbackPayload} label="callback payload (received from engine)" />
              <JsonBlock data={row.errorDetail} label="error detail" />
            </div>
          </div>

          {/* Process snapshot */}
          <div>
            <div className="font-semibold text-[14px] text-slate-800 mb-2.5">Process Snapshot</div>
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

const filterInputCls = 'px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function SystemProcessQueuePage({ user }: { user: User }) {
  const [rows, setRows] = useState<ExecutionRow[]>([]);
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ExecutionRow | null>(null);

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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[24px] font-bold text-slate-800 mb-1">System Task Queue</h1>
        <p className="text-[14px] text-slate-500 m-0">
          All process executions across every organisation. Use diagnostic tools to investigate failures.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl px-5 py-4 border border-slate-200 mb-5 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-[12px] text-slate-500 mb-1 font-medium">Organisation</label>
          <select value={filterOrg} onChange={(e) => setFilterOrg(e.target.value)} className={`${filterInputCls} min-w-[160px]`}>
            <option value="">All organisations</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[12px] text-slate-500 mb-1 font-medium">Status</label>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={filterInputCls}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s || 'All statuses'}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[12px] text-slate-500 mb-1 font-medium">Engine</label>
          <select value={filterEngine} onChange={(e) => setFilterEngine(e.target.value)} className={filterInputCls}>
            {ENGINE_TYPES.map((e) => (
              <option key={e} value={e}>{e || 'All engines'}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[12px] text-slate-500 mb-1 font-medium">From</label>
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className={filterInputCls} />
        </div>

        <div>
          <label className="block text-[12px] text-slate-500 mb-1 font-medium">To</label>
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className={filterInputCls} />
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSearch}
            className="btn btn-sm btn-primary"
          >
            Search
          </button>
          <button
            onClick={() => { setFilterOrg(''); setFilterStatus(''); setFilterEngine(''); setFilterFrom(''); setFilterTo(''); }}
            className="btn btn-sm btn-secondary"
          >
            Reset
          </button>
          <button
            onClick={() => fetchExecutions(offset)}
            className="btn btn-sm btn-secondary"
            title="Refresh"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-600 text-[13px] mb-4">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="py-10 text-center text-slate-500 text-[14px]">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-slate-500 text-[14px]">No executions found for the selected filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Created', 'Organisation', 'Process', 'User', 'Engine', 'Status', 'Duration', 'Retries', 'Callback', 'Actions'].map((h) => (
                    <th key={h} className="px-3.5 py-2.5 text-left font-semibold text-slate-600 whitespace-nowrap text-[11px] uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const callbackMissing = ['completed', 'failed', 'timeout'].includes(row.status) && !row.callbackReceivedAt && !!row.returnWebhookUrl;
                  const engineColor = ENGINE_COLORS[row.engineType] ?? '#6b7280';
                  return (
                    <tr key={row.id} className={`border-b border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                      <td className="px-3.5 py-2.5 whitespace-nowrap text-slate-500 text-[12px]">
                        {formatDate(row.createdAt)}
                      </td>
                      <td className="px-3.5 py-2.5 max-w-[140px]">
                        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-slate-800 font-medium" title={row.organisationName ?? row.organisationId}>
                          {row.organisationName ?? <span className="text-slate-400 font-mono text-[11px]">{row.organisationId.slice(0, 8)}</span>}
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5 max-w-[160px]">
                        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-slate-800" title={row.processName ?? row.processId}>
                          {row.processName ?? <span className="text-slate-400 font-mono text-[11px]">{row.processId.slice(0, 8)}</span>}
                          {row.isTestExecution && (
                            <span className="ml-1.5 text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-semibold">TEST</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5 max-w-[160px]">
                        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-slate-500 text-[12px]" title={row.userEmail ?? ''}>
                          {row.userEmail ?? '—'}
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold" style={{ background: `${engineColor}22`, color: engineColor }}>
                          {row.engineType}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        <span className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-bold border ${STATUS_CLS[row.status] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap text-slate-500 text-[12px]">
                        {formatDuration(row.durationMs)}
                      </td>
                      <td className={`px-3.5 py-2.5 text-center ${row.retryCount > 0 ? 'text-orange-600 font-bold' : 'text-slate-500'}`}>
                        {row.retryCount}
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        {callbackMissing ? (
                          <span className="text-red-600 text-[12px] font-semibold">⚠ Missing</span>
                        ) : row.callbackReceivedAt ? (
                          <span className="text-green-600 text-[12px]">Received</span>
                        ) : (
                          <span className="text-slate-400 text-[12px]">—</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        <button
                          onClick={() => setSelected(row)}
                          className="btn btn-xs btn-secondary"
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
          <div className="px-5 py-3 border-t border-slate-100 flex gap-2 items-center justify-between">
            <span className="text-[12px] text-slate-500">
              Showing {offset + 1}–{offset + rows.length}
            </span>
            <div className="flex gap-2">
              <button
                onClick={handlePrev}
                disabled={offset === 0}
                className="btn btn-sm btn-secondary disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={handleNext}
                disabled={rows.length < LIMIT}
                className="btn btn-sm btn-secondary disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {selected && <DiagnosticPanel row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

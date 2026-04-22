import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface HistoryRecord {
  id: string;
  entityType: string;
  entityId: string;
  version: number;
  snapshot: Record<string, unknown>;
  changedBy: string | null;
  changeSource: string;
  changeSummary: string | null;
  changedAt: string;
}

interface GroupedRecords {
  entityType: string;
  records: HistoryRecord[];
}

const ENTITY_LABELS: Record<string, string> = {
  agent: 'Agents',
  subaccount_agent: 'Agent Links',
  scheduled_task: 'Scheduled Tasks',
  agent_data_source: 'Data Sources',
  skill: 'Skills',
  subaccount: 'Subaccounts',
  policy_rule: 'Policy Rules',
  permission_set: 'Permission Sets',
  workspace_limits: 'Workspace Limits',
  org_budget: 'Org Budget',
  mcp_server_config: 'MCP Servers',
  agent_trigger: 'Agent Triggers',
  connector_config: 'Connector Configs',
  integration_connection: 'Integration Connections',
};

const SOURCE_STYLES: Record<string, string> = {
  config_agent: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  ui: 'bg-slate-50 text-slate-600 border-slate-200',
  api: 'bg-blue-50 text-blue-700 border-blue-200',
  restore: 'bg-amber-50 text-amber-700 border-amber-200',
  system_sync: 'bg-green-50 text-green-700 border-green-200',
};

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function groupByEntityType(records: HistoryRecord[]): GroupedRecords[] {
  const map = new Map<string, HistoryRecord[]>();
  for (const r of records) {
    const existing = map.get(r.entityType);
    if (existing) existing.push(r);
    else map.set(r.entityType, [r]);
  }
  return Array.from(map.entries()).map(([entityType, recs]) => ({
    entityType,
    records: recs.sort((a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime()),
  }));
}

function snapshotName(snapshot: Record<string, unknown>): string {
  return (snapshot.name as string) ?? (snapshot.slug as string) ?? '';
}

export default function ConfigSessionHistoryPage({ user: _user }: { user: User }) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    api.get(`/api/org/config-history/session/${sessionId}`)
      .then((res) => setRecords(res.data.records ?? []))
      .catch(() => setError('Failed to load session history.'))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)]">
        <div className="px-6 py-3 border-b border-slate-200">
          <div className="h-5 w-48 rounded bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-[3px] border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const groups = groupByEntityType(records);

  return (
    <div className="flex flex-col bg-slate-50 min-h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="flex items-center gap-3.5 px-6 py-3.5 bg-white border-b border-slate-200 shrink-0">
        <Link to="/admin/config-assistant" className="inline-flex items-center gap-1 text-indigo-600 no-underline text-[13px] font-semibold px-2.5 py-1.5 rounded-lg bg-violet-50 border border-indigo-200 shrink-0 transition-colors hover:bg-violet-100">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          Configuration Assistant
        </Link>
        <div className="w-px h-5 bg-slate-200 shrink-0" />
        <div className="font-bold text-[16px] text-slate-900 tracking-tight">Session History</div>
        <span className="text-[12px] text-slate-400 font-mono">{sessionId}</span>
        <span className="text-[12px] text-slate-400 ml-auto">{records.length} change{records.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-5 max-w-[900px] mx-auto w-full">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-600 mb-4">{error}</div>
        )}

        {records.length === 0 && !error ? (
          <div className="bg-white border border-slate-200 rounded-xl py-14 px-8 text-center">
            <p className="text-[15px] font-semibold text-slate-700 mb-1">No changes found</p>
            <p className="text-[13px] text-slate-400">This session has no recorded configuration history entries.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <div key={group.entityType} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                  <div className="font-semibold text-[13px] text-slate-700">
                    {ENTITY_LABELS[group.entityType] ?? group.entityType}
                  </div>
                  <span className="text-[11px] text-slate-400">{group.records.length} change{group.records.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {group.records.map((rec) => {
                    const isExpanded = expandedId === rec.id;
                    return (
                      <div key={rec.id}>
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 bg-transparent border-0 cursor-pointer text-left hover:bg-slate-50 transition-colors"
                        >
                          <span className="text-[12px] font-mono text-slate-400 shrink-0">v{rec.version}</span>
                          <span className="text-[13px] text-slate-800 flex-1 min-w-0 truncate">
                            {rec.changeSummary ?? snapshotName(rec.snapshot) ?? rec.entityId}
                          </span>
                          <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${SOURCE_STYLES[rec.changeSource] ?? SOURCE_STYLES.ui}`}>
                            {rec.changeSource.replace('_', ' ')}
                          </span>
                          <span className="text-[11px] text-slate-400 shrink-0">{formatTimestamp(rec.changedAt)}</span>
                          <svg
                            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            className={`shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                        {isExpanded && (
                          <div className="px-4 pb-3">
                            <pre className="bg-slate-900 text-slate-200 px-4 py-3 rounded-lg text-[12px] overflow-auto whitespace-pre-wrap break-words font-mono max-h-[300px] border border-slate-800">
                              {JSON.stringify(rec.snapshot, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

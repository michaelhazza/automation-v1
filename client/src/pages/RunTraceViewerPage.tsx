import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import TraceChainSidebar from '../components/TraceChainSidebar';
import TraceChainTimeline from '../components/TraceChainTimeline';

interface ToolCallEntry {
  tool?: string;
  name?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  durationMs?: number;
  actionId?: string;
}

interface ContextSourceSnapshotEntry {
  id: string;
  scope: 'agent' | 'subaccount' | 'scheduled_task' | 'task_instance';
  name: string;
  description: string | null;
  contentType: string;
  loadingMode: 'eager' | 'lazy';
  sizeBytes: number;
  tokenCount: number;
  fetchOk: boolean;
  orderIndex: number;
  includedInPrompt: boolean;
  truncated: boolean;
  suppressedByOverride: boolean;
  suppressedBy?: string;
  exclusionReason: 'budget_exceeded' | 'override_suppressed' | 'lazy_not_rendered' | null;
}

interface RunDetail {
  id: string;
  organisationId: string;
  subaccountId: string;
  agentId: string;
  subaccountAgentId: string;
  agentName: string | null;
  agentSlug: string | null;
  subaccountName: string | null;
  runType: string;
  executionMode: string;
  status: string;
  triggerContext: Record<string, unknown> | null;
  taskId: string | null;
  systemPromptSnapshot: string | null;
  skillsUsed: string[] | null;
  toolCallsLog: ToolCallEntry[] | null;
  totalToolCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenBudget: number;
  errorMessage: string | null;
  errorDetail: Record<string, unknown> | null;
  tasksCreated: number;
  tasksUpdated: number;
  deliverablesCreated: number;
  memoryStateAtStart: string | null;
  summary: string | null;
  systemPromptTokens: number;
  handoffDepth: number;
  parentRunId: string | null;
  isSubAgent: number;
  parentSpawnRunId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
  contextSourcesSnapshot: ContextSourceSnapshotEntry[] | null;
}

const STATUS_BADGE: Record<string, string> = {
  completed:       'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed:          'bg-red-50 text-red-700 border-red-200',
  running:         'bg-blue-50 text-blue-700 border-blue-200',
  pending:         'bg-slate-100 text-slate-600 border-slate-200',
  timeout:         'bg-amber-50 text-amber-700 border-amber-200',
  cancelled:       'bg-slate-100 text-slate-400 border-slate-200',
  loop_detected:   'bg-amber-100 text-amber-800 border-amber-200',
  budget_exceeded: 'bg-amber-100 text-amber-800 border-amber-200',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] ?? STATUS_BADGE.pending;
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[12px] font-semibold border ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '--';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '--';
  return new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function CollapsibleSection({ title, defaultOpen = false, children, badge }: { title: string; defaultOpen?: boolean; children: React.ReactNode; badge?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-xl border border-slate-200 mb-4 overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3.5 border-0 bg-transparent cursor-pointer text-[14px] font-bold text-slate-900 text-left">
        <span className="flex items-center gap-2">
          <span className={`inline-block w-4 text-center text-[12px] text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}>&#9654;</span>
          {title}
          {badge}
        </span>
      </button>
      {open && <div className="px-4 pb-4 border-t border-slate-50">{children}</div>}
    </div>
  );
}

// Mask API keys, bearer tokens, JWTs, and secret-looking values from displayed text.
// Masking is on by default; users can toggle to reveal.
const SECRET_PATTERNS: Array<[RegExp, (m: string, p1: string, p2: string) => string]> = [
  // Anthropic / OpenAI style keys: sk-..., pk-...
  [/(sk-[A-Za-z0-9]{6})[A-Za-z0-9-_]{10,}/g,
   (_, p1) => `${p1}${'*'.repeat(16)}`],
  [/(pk-[A-Za-z0-9]{6})[A-Za-z0-9-_]{10,}/g,
   (_, p1) => `${p1}${'*'.repeat(16)}`],
  // JSON field: "api_key": "value", "secret": "value", etc.
  [/("(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|secret|password|authorization|x-api-key)"\s*:\s*")([^"]{6,})/gi,
   (_, p1, p2) => `${p1}${'*'.repeat(Math.min(p2.length, 16))}`],
  // URL query params: api_key=xxx, token=xxx
  [/((?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|secret|password)=)([^&\s"]{6,})/gi,
   (_, p1, p2) => `${p1}${'*'.repeat(Math.min(p2.length, 16))}`],
  // Bearer tokens
  [/(Bearer\s+)([A-Za-z0-9._\-+/]{20,})/gi,
   (_, p1, p2) => `${p1}${'*'.repeat(Math.min(p2.length, 20))}`],
  // JWTs: three base64url segments separated by dots (eyX...eyX...xxx)
  [/(ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.)[A-Za-z0-9_-]{10,}/g,
   (_, header_payload) => `${header_payload}${'*'.repeat(16)}`],
];

function maskSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacer] of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    out = out.replace(pattern, replacer as Parameters<typeof out.replace>[1]);
  }
  return out;
}

function JsonBlock({ data, maxHeight = 300 }: { data: unknown; maxHeight?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [masked, setMasked] = useState(true);
  const rawText = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const text = masked ? maskSecrets(rawText) : rawText;
  const isLong = text.length > 500;
  const hasMaskedContent = maskSecrets(rawText) !== rawText;

  return (
    <div>
      {hasMaskedContent && (
        <div className="flex items-center justify-end mb-1">
          <button
            onClick={() => setMasked(m => !m)}
            className="flex items-center gap-1 border-0 bg-transparent text-[11px] text-slate-400 hover:text-slate-600 cursor-pointer font-medium p-0"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {masked
                ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>
                : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
              }
            </svg>
            {masked ? 'Show secrets' : 'Mask secrets'}
          </button>
        </div>
      )}
      <pre
        className={`bg-slate-50 border border-slate-200 rounded-lg p-3 text-[12px] font-mono text-slate-700 overflow-x-auto whitespace-pre-wrap break-words m-0 ${expanded ? 'overflow-auto' : 'overflow-hidden'}`}
        style={{ maxHeight: expanded ? undefined : maxHeight }}
      >
        {text}
      </pre>
      {isLong && (
        <button onClick={() => setExpanded(!expanded)} className="mt-1 border-0 bg-transparent text-indigo-600 text-[12px] cursor-pointer font-semibold p-0">
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

export default function RunTraceViewerPage({ user: _user }: { user: User }) {
  const { subaccountId, runId: routeRunId } = useParams<{ subaccountId: string; runId: string }>();
  const navigate = useNavigate();
  const [activeRunId, setActiveRunId] = useState(routeRunId ?? '');
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chainRuns, setChainRuns] = useState<Array<{ id: string; agentName: string; isSubAgent: boolean; runSource: string; status: string; startedAt: string | null; completedAt: string | null; durationMs: number | null; totalTokens: number | null }>>([]);

  // Keep activeRunId in sync with route
  useEffect(() => { if (routeRunId) setActiveRunId(routeRunId); }, [routeRunId]);

  const runId = activeRunId || routeRunId;

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    api.get(`/api/agent-runs/${runId}`)
      .then(({ data }) => setRun(data))
      .catch((err) => setError(err.response?.data?.error ?? 'Failed to load run'))
      .finally(() => setLoading(false));
    // Fetch chain for timeline (non-blocking)
    api.get(`/api/agent-runs/${runId}/chain`)
      .then(({ data }) => setChainRuns(data.runs ?? []))
      .catch(() => setChainRuns([]));
  }, [runId]);

  const handleSelectRun = useCallback((id: string) => {
    setActiveRunId(id);
    // Update URL without full page reload
    if (subaccountId) {
      navigate(`/admin/subaccounts/${subaccountId}/runs/${id}`, { replace: true });
    }
  }, [navigate, subaccountId]);

  if (loading) {
    return (
      <div className="animate-[fadeIn_0.2s_ease-out_both]">
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />)}
        </div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="animate-[fadeIn_0.2s_ease-out_both]">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700 text-[14px]">{error ?? 'Run not found'}</div>
      </div>
    );
  }

  const budgetPct = run.tokenBudget > 0 ? Math.min(100, Math.round((run.totalTokens / run.tokenBudget) * 100)) : 0;
  const toolCalls: ToolCallEntry[] = Array.isArray(run.toolCallsLog) ? run.toolCallsLog : [];

  return (
    <div className="flex animate-[fadeIn_0.2s_ease-out_both]">
      <TraceChainSidebar runId={runId!} onSelectRun={handleSelectRun} />
      <div className="flex-1 max-w-[960px] mx-auto">
      <div className="mb-4 text-[13px] text-slate-500 flex items-center gap-1.5">
        <Link to={`/admin/subaccounts/${run.subaccountId}/workspace`} className="text-indigo-600 hover:text-indigo-700 no-underline font-medium">
          {run.subaccountName ?? 'Workspace'}
        </Link>
        <span>/</span>
        <span>Run Trace</span>
      </div>

      {chainRuns.length > 1 && (
        <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 mb-4">
          <h3 className="text-[13px] font-semibold text-slate-500 uppercase tracking-wider mb-3 mt-0">Chain Timeline</h3>
          <TraceChainTimeline runs={chainRuns} selectedRunId={runId!} onSelectRun={handleSelectRun} />
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 px-6 py-5 mb-4">
        <div className="flex justify-between items-start flex-wrap gap-3">
          <div>
            <h1 className="text-[22px] font-extrabold text-slate-900 tracking-tight mb-1.5">{run.agentName ?? 'Agent Run'}</h1>
            <div className="flex gap-2.5 items-center flex-wrap text-[13px] text-slate-500">
              <StatusBadge status={run.status} />
              <span className="bg-slate-100 px-2 py-0.5 rounded text-[11.5px] font-semibold text-slate-600">{run.runType}</span>
              {run.executionMode !== 'api' && <span className="bg-violet-50 px-2 py-0.5 rounded text-[11.5px] font-semibold text-violet-700">{run.executionMode}</span>}
              {run.isSubAgent === 1 && <span className="bg-emerald-50 px-2 py-0.5 rounded text-[11.5px] font-semibold text-emerald-700">sub-agent</span>}
            </div>
          </div>
          <div className="text-right text-[13px] text-slate-500 leading-7">
            <div><strong>Duration:</strong> {formatDuration(run.durationMs)}</div>
            <div><strong>Started:</strong> {formatTimestamp(run.startedAt)}</div>
            <div><strong>Completed:</strong> {formatTimestamp(run.completedAt)}</div>
          </div>
        </div>
        <div className="mt-2 text-[12px] text-slate-400 font-mono">ID: {run.id}</div>
      </div>

      <div className="grid gap-3 mb-4 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
        {[
          { label: 'Input Tokens', value: run.inputTokens.toLocaleString() },
          { label: 'Output Tokens', value: run.outputTokens.toLocaleString() },
          { label: 'Total Tokens', value: run.totalTokens.toLocaleString() },
          { label: 'Budget Used', value: `${budgetPct}%` },
          { label: 'Tool Calls', value: run.totalToolCalls.toString() },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 py-3.5 px-4 text-center">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</div>
            <div className="text-[20px] font-extrabold text-slate-900">{value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 mb-4">
        <div className="flex justify-between text-[12px] text-slate-500 mb-1.5">
          <span>Token Budget</span>
          <span>{run.totalTokens.toLocaleString()} / {run.tokenBudget.toLocaleString()}</span>
        </div>
        <div className="bg-slate-100 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${budgetPct >= 90 ? 'bg-red-500' : budgetPct >= 70 ? 'bg-amber-400' : 'bg-green-500'}`}
            style={{ width: `${budgetPct}%` }}
          />
        </div>
      </div>

      {run.summary && (
        <CollapsibleSection title="Run Summary" defaultOpen>
          <p className="mt-3 text-[14px] text-slate-700 leading-relaxed">{run.summary}</p>
        </CollapsibleSection>
      )}

      {run.systemPromptSnapshot && (
        <CollapsibleSection
          title="System Prompt Snapshot"
          badge={<span className="text-[11px] font-medium text-slate-400 ml-2">~{run.systemPromptTokens.toLocaleString()} tokens</span>}
        >
          <div className="mt-3"><JsonBlock data={run.systemPromptSnapshot} maxHeight={400} /></div>
        </CollapsibleSection>
      )}

      {run.contextSourcesSnapshot && run.contextSourcesSnapshot.length > 0 && (
        <ContextSourcesPanel snapshot={run.contextSourcesSnapshot} />
      )}

      {run.memoryStateAtStart && (
        <CollapsibleSection title="Memory State at Start">
          <div className="mt-3"><JsonBlock data={run.memoryStateAtStart} maxHeight={300} /></div>
        </CollapsibleSection>
      )}

      {toolCalls.length > 0 && (
        <CollapsibleSection
          title="Tool Calls Timeline"
          defaultOpen
          badge={<span className="text-[11px] font-semibold text-white bg-indigo-600 px-2 py-0.5 rounded-full ml-2">{toolCalls.length}</span>}
        >
          <div className="mt-3 flex flex-col gap-2.5">
            {toolCalls.map((tc, i) => (
              <ToolCallCard key={i} index={i} toolName={tc.tool ?? tc.name ?? 'unknown'} entry={tc} subaccountId={run.subaccountId} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {(run.status === 'failed' || run.errorMessage) && (
        <CollapsibleSection title="Error Details" defaultOpen>
          <div className="mt-3">
            {run.errorMessage && <div className="bg-red-50 border border-red-200 rounded-lg p-3.5 text-[13px] text-red-700 font-medium mb-2.5">{run.errorMessage}</div>}
            {run.errorDetail && <JsonBlock data={run.errorDetail} />}
          </div>
        </CollapsibleSection>
      )}

      {(run.tasksCreated > 0 || run.tasksUpdated > 0 || run.deliverablesCreated > 0) && (
        <CollapsibleSection title="Impact Summary" defaultOpen>
          <div className="mt-3 flex gap-4 flex-wrap">
            {[
              { label: 'Tasks Created', value: run.tasksCreated, cls: 'text-emerald-700' },
              { label: 'Tasks Updated', value: run.tasksUpdated, cls: 'text-blue-700' },
              { label: 'Deliverables Created', value: run.deliverablesCreated, cls: 'text-violet-700' },
            ].filter((x) => x.value > 0).map(({ label, value, cls }) => (
              <div key={label} className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</div>
                <div className={`text-[22px] font-extrabold ${cls}`}>{value}</div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {run.skillsUsed && (run.skillsUsed as string[]).length > 0 && (
        <CollapsibleSection title="Skills Used">
          <div className="mt-3 flex gap-1.5 flex-wrap">
            {(run.skillsUsed as string[]).map((slug, i) => (
              <span key={i} className="bg-violet-50 text-violet-700 border border-violet-200 px-2.5 py-0.5 rounded text-[12px] font-semibold">{slug}</span>
            ))}
          </div>
        </CollapsibleSection>
      )}

      <div className="h-10" />
      </div>
    </div>
  );
}

function ToolCallCard({ index, toolName, entry, subaccountId }: { index: number; toolName: string; entry: ToolCallEntry; subaccountId: string }) {
  const [showInput, setShowInput] = useState(false);
  const [showOutput, setShowOutput] = useState(false);

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-3">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="w-[22px] h-[22px] rounded-md bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
            {index + 1}
          </span>
          <span className="font-bold text-[13px] text-slate-900 font-mono">{toolName}</span>
        </div>
        <div className="flex items-center gap-2">
          {entry.durationMs != null && <span className="text-[11.5px] text-slate-500 font-medium">{formatDuration(entry.durationMs)}</span>}
          {entry.actionId && (
            <Link to={`/admin/subaccounts/${subaccountId}/workspace`} className="text-[11px] text-indigo-600 font-semibold no-underline bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">action</Link>
          )}
        </div>
      </div>
      <div className="mt-2 flex gap-1.5">
        {entry.input != null && (
          <button onClick={() => setShowInput(!showInput)} className={`border rounded-md px-2.5 py-0.5 text-[11.5px] font-semibold cursor-pointer transition-colors ${showInput ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>Input</button>
        )}
        {entry.output != null && (
          <button onClick={() => setShowOutput(!showOutput)} className={`border rounded-md px-2.5 py-0.5 text-[11.5px] font-semibold cursor-pointer transition-colors ${showOutput ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>Output</button>
        )}
      </div>
      {showInput && entry.input != null && <div className="mt-2"><JsonBlock data={entry.input} maxHeight={200} /></div>}
      {showOutput && entry.output != null && <div className="mt-2"><JsonBlock data={entry.output} maxHeight={200} /></div>}
    </div>
  );
}

// ─── Context Sources Panel (spec §11.5) ────────────────────────────────────
// Reads the frozen snapshot persisted by loadRunContextData at run start and
// shows which data sources were considered, which were included in the prompt,
// which were excluded by budget, and which were suppressed by same-name
// override. Coloured rows give operators a single-glance view.

const SCOPE_BADGE: Record<string, string> = {
  task_instance:  'bg-purple-100 text-purple-800',
  scheduled_task: 'bg-indigo-100 text-indigo-800',
  subaccount:     'bg-blue-100  text-blue-800',
  agent:          'bg-slate-100 text-slate-700',
};

const SCOPE_LABEL: Record<string, string> = {
  task_instance:  'Task attachment',
  scheduled_task: 'Scheduled task',
  subaccount:     'Subaccount',
  agent:          'Agent',
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '—';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function rowBgClass(s: ContextSourceSnapshotEntry): string {
  if (s.suppressedByOverride) return 'bg-amber-50';
  if (s.loadingMode === 'eager' && !s.includedInPrompt) return 'bg-red-50';
  if (s.truncated) return 'bg-yellow-50';
  return '';
}

function statusLabel(s: ContextSourceSnapshotEntry) {
  if (s.suppressedByOverride) {
    return <span className="text-amber-700">overridden</span>;
  }
  if (!s.fetchOk) {
    return <span className="text-red-600">failed / binary</span>;
  }
  if (s.loadingMode === 'eager' && !s.includedInPrompt) {
    return (
      <span className="text-red-700" title={s.exclusionReason ?? 'budget exceeded'}>
        excluded (budget)
      </span>
    );
  }
  if (s.loadingMode === 'lazy') {
    return <span className="text-slate-600">manifest (lazy)</span>;
  }
  if (s.truncated) {
    return <span className="text-amber-700">truncated</span>;
  }
  return <span className="text-green-700">in prompt</span>;
}

function ContextSourcesPanel({ snapshot }: { snapshot: ContextSourceSnapshotEntry[] }) {
  const sorted = [...snapshot].sort((a, b) => a.orderIndex - b.orderIndex);
  const includedCount = sorted.filter(s => s.includedInPrompt && !s.suppressedByOverride).length;
  const excludedCount = sorted.filter(
    s => s.loadingMode === 'eager' && !s.includedInPrompt && !s.suppressedByOverride
  ).length;
  const suppressedCount = sorted.filter(s => s.suppressedByOverride).length;

  return (
    <CollapsibleSection
      title="Context Sources"
      badge={
        <span className="text-[11px] font-medium text-slate-500 ml-2">
          {includedCount} in prompt · {excludedCount} excluded · {suppressedCount} overridden
        </span>
      }
    >
      <div className="mt-3 bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase">#</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase">Name</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase">Scope</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase">Mode</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase">Size</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase">Tokens</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((s) => (
              <tr key={`${s.id}-${s.orderIndex}`} className={`${rowBgClass(s)} hover:bg-slate-50`}>
                <td className="px-3 py-2 text-[11px] text-slate-400 font-mono">
                  {/* orderIndex is guaranteed present on snapshot entries (§7.1 step 5) */}
                  {s.orderIndex + 1}
                </td>
                <td className="px-3 py-2 text-[12px] text-slate-700">
                  {s.name}
                  {s.suppressedBy && (
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      overridden by <code>{s.suppressedBy.slice(0, 8)}</code>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${SCOPE_BADGE[s.scope] ?? SCOPE_BADGE.agent}`}>
                    {SCOPE_LABEL[s.scope] ?? s.scope}
                  </span>
                </td>
                <td className="px-3 py-2 text-[11px] text-slate-600">{s.loadingMode}</td>
                <td className="px-3 py-2 text-[11px] text-slate-600">{formatBytes(s.sizeBytes)}</td>
                <td className="px-3 py-2 text-[11px] text-slate-600">
                  {s.tokenCount > 0 ? `~${s.tokenCount.toLocaleString()}` : '—'}
                </td>
                <td className="px-3 py-2 text-[11px]">{statusLabel(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}

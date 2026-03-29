import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolCallEntry {
  tool?: string;
  name?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  durationMs?: number;
  actionId?: string;
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string; border: string }> = {
    completed: { bg: '#ecfdf5', fg: '#059669', border: '#a7f3d0' },
    failed: { bg: '#fef2f2', fg: '#dc2626', border: '#fecaca' },
    running: { bg: '#eff6ff', fg: '#2563eb', border: '#bfdbfe' },
    pending: { bg: '#f8fafc', fg: '#64748b', border: '#e2e8f0' },
    timeout: { bg: '#fffbeb', fg: '#d97706', border: '#fde68a' },
    cancelled: { bg: '#f8fafc', fg: '#94a3b8', border: '#e2e8f0' },
    loop_detected: { bg: '#fef3c7', fg: '#b45309', border: '#fde68a' },
    budget_exceeded: { bg: '#fef3c7', fg: '#b45309', border: '#fde68a' },
  };
  const c = colors[status] ?? colors.pending;
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 9999,
      fontSize: 12, fontWeight: 600, background: c.bg, color: c.fg,
      border: `1px solid ${c.border}`,
    }}>
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
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

function CollapsibleSection({
  title, defaultOpen = false, children, badge,
}: {
  title: string; defaultOpen?: boolean; children: React.ReactNode; badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
      marginBottom: 16, overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', border: 'none', background: 'none', cursor: 'pointer',
          fontSize: 14, fontWeight: 700, color: '#0f172a', textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-block', width: 18, textAlign: 'center',
            transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            fontSize: 12, color: '#94a3b8',
          }}>&#9654;</span>
          {title}
          {badge}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 18px 16px', borderTop: '1px solid #f1f5f9' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible JSON block
// ---------------------------------------------------------------------------

function JsonBlock({ data, maxHeight = 300 }: { data: unknown; maxHeight?: number }) {
  const [expanded, setExpanded] = useState(false);
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const isLong = text.length > 500;
  return (
    <div>
      <pre style={{
        background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6,
        padding: 12, fontSize: 12, fontFamily: 'ui-monospace, monospace',
        color: '#334155', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        maxHeight: expanded ? 'none' : maxHeight, overflow: 'hidden',
        margin: 0,
      }}>
        {text}
      </pre>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: 4, border: 'none', background: 'none', color: '#6366f1',
            fontSize: 12, cursor: 'pointer', fontWeight: 600, padding: 0,
          }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function RunTraceViewerPage({ user }: { user: User }) {
  const { runId } = useParams<{ subaccountId: string; runId: string }>();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    api.get(`/api/agent-runs/${runId}`)
      .then(({ data }) => setRun(data))
      .catch((err) => setError(err.response?.data?.error ?? 'Failed to load run'))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading) {
    return (
      <div className="page-enter" style={{ padding: 32 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton" style={{ height: 48, borderRadius: 8 }} />
          ))}
        </div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="page-enter" style={{ padding: 32 }}>
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10,
          padding: 24, color: '#dc2626', fontSize: 14,
        }}>
          {error ?? 'Run not found'}
        </div>
      </div>
    );
  }

  const budgetPct = run.tokenBudget > 0
    ? Math.min(100, Math.round((run.totalTokens / run.tokenBudget) * 100))
    : 0;

  const toolCalls: ToolCallEntry[] = Array.isArray(run.toolCallsLog) ? run.toolCallsLog : [];

  return (
    <div className="page-enter" style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 16, fontSize: 13, color: '#64748b' }}>
        <Link to={`/admin/subaccounts/${run.subaccountId}/workspace`} style={{ color: '#6366f1', textDecoration: 'none', fontWeight: 500 }}>
          {run.subaccountName ?? 'Workspace'}
        </Link>
        <span style={{ margin: '0 6px' }}>/</span>
        <span>Run Trace</span>
      </div>

      {/* ── Run header ──────────────────────────────────────────────── */}
      <div style={{
        background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0',
        padding: '20px 24px', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
              {run.agentName ?? 'Agent Run'}
            </h1>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: '#64748b' }}>
              <StatusBadge status={run.status} />
              <span style={{
                background: '#f1f5f9', padding: '2px 8px', borderRadius: 6,
                fontSize: 11.5, fontWeight: 600, color: '#475569',
              }}>
                {run.runType}
              </span>
              {run.executionMode !== 'api' && (
                <span style={{
                  background: '#f5f3ff', padding: '2px 8px', borderRadius: 6,
                  fontSize: 11.5, fontWeight: 600, color: '#7c3aed',
                }}>
                  {run.executionMode}
                </span>
              )}
              {run.isSubAgent === 1 && (
                <span style={{
                  background: '#ecfdf5', padding: '2px 8px', borderRadius: 6,
                  fontSize: 11.5, fontWeight: 600, color: '#059669',
                }}>
                  sub-agent
                </span>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 13, color: '#64748b', lineHeight: 1.8 }}>
            <div><strong>Duration:</strong> {formatDuration(run.durationMs)}</div>
            <div><strong>Started:</strong> {formatTimestamp(run.startedAt)}</div>
            <div><strong>Completed:</strong> {formatTimestamp(run.completedAt)}</div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8', fontFamily: 'ui-monospace, monospace' }}>
          ID: {run.id}
        </div>
      </div>

      {/* ── Token summary ───────────────────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 12, marginBottom: 16,
      }}>
        {[
          { label: 'Input Tokens', value: run.inputTokens.toLocaleString() },
          { label: 'Output Tokens', value: run.outputTokens.toLocaleString() },
          { label: 'Total Tokens', value: run.totalTokens.toLocaleString() },
          { label: 'Budget Used', value: `${budgetPct}%` },
          { label: 'Tool Calls', value: run.totalToolCalls.toString() },
        ].map(({ label, value }) => (
          <div key={label} style={{
            background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
            padding: '14px 16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              {label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Budget bar ──────────────────────────────────────────────── */}
      <div style={{
        background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
        padding: '12px 16px', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', marginBottom: 6 }}>
          <span>Token Budget</span>
          <span>{run.totalTokens.toLocaleString()} / {run.tokenBudget.toLocaleString()}</span>
        </div>
        <div style={{ background: '#f1f5f9', borderRadius: 999, height: 8, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 999,
            width: `${budgetPct}%`,
            background: budgetPct >= 90 ? '#ef4444' : budgetPct >= 70 ? '#f59e0b' : '#22c55e',
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* ── Summary ─────────────────────────────────────────────────── */}
      {run.summary && (
        <CollapsibleSection title="Run Summary" defaultOpen>
          <p style={{ margin: '12px 0 0', fontSize: 14, color: '#334155', lineHeight: 1.7 }}>
            {run.summary}
          </p>
        </CollapsibleSection>
      )}

      {/* ── System prompt snapshot ──────────────────────────────────── */}
      {run.systemPromptSnapshot && (
        <CollapsibleSection
          title="System Prompt Snapshot"
          badge={
            <span style={{ fontSize: 11, fontWeight: 500, color: '#94a3b8', marginLeft: 8 }}>
              ~{run.systemPromptTokens.toLocaleString()} tokens
            </span>
          }
        >
          <div style={{ marginTop: 12 }}>
            <JsonBlock data={run.systemPromptSnapshot} maxHeight={400} />
          </div>
        </CollapsibleSection>
      )}

      {/* ── Memory state at start ───────────────────────────────────── */}
      {run.memoryStateAtStart && (
        <CollapsibleSection title="Memory State at Start">
          <div style={{ marginTop: 12 }}>
            <JsonBlock data={run.memoryStateAtStart} maxHeight={300} />
          </div>
        </CollapsibleSection>
      )}

      {/* ── Tool calls timeline ─────────────────────────────────────── */}
      {toolCalls.length > 0 && (
        <CollapsibleSection
          title="Tool Calls Timeline"
          defaultOpen
          badge={
            <span style={{
              fontSize: 11, fontWeight: 600, color: '#fff', background: '#6366f1',
              padding: '2px 8px', borderRadius: 999, marginLeft: 8,
            }}>
              {toolCalls.length}
            </span>
          }
        >
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {toolCalls.map((tc, i) => {
              const toolName = tc.tool ?? tc.name ?? 'unknown';
              return (
                <ToolCallCard key={i} index={i} toolName={toolName} entry={tc} subaccountId={run.subaccountId} />
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* ── Error section ───────────────────────────────────────────── */}
      {(run.status === 'failed' || run.errorMessage) && (
        <CollapsibleSection title="Error Details" defaultOpen>
          <div style={{ marginTop: 12 }}>
            {run.errorMessage && (
              <div style={{
                background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
                padding: 14, fontSize: 13, color: '#dc2626', marginBottom: 10,
                fontWeight: 500,
              }}>
                {run.errorMessage}
              </div>
            )}
            {run.errorDetail && (
              <JsonBlock data={run.errorDetail} />
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* ── Impact summary ──────────────────────────────────────────── */}
      {(run.tasksCreated > 0 || run.tasksUpdated > 0 || run.deliverablesCreated > 0) && (
        <CollapsibleSection title="Impact Summary" defaultOpen>
          <div style={{ marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'Tasks Created', value: run.tasksCreated, color: '#059669' },
              { label: 'Tasks Updated', value: run.tasksUpdated, color: '#2563eb' },
              { label: 'Deliverables Created', value: run.deliverablesCreated, color: '#7c3aed' },
            ].filter(x => x.value > 0).map(({ label, value, color }) => (
              <div key={label} style={{
                background: '#f8fafc', borderRadius: 8, padding: '10px 16px',
                border: '1px solid #e2e8f0',
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* ── Skills used ─────────────────────────────────────────────── */}
      {run.skillsUsed && (run.skillsUsed as string[]).length > 0 && (
        <CollapsibleSection title="Skills Used">
          <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(run.skillsUsed as string[]).map((slug, i) => (
              <span key={i} style={{
                background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe',
                padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              }}>
                {slug}
              </span>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Bottom spacer */}
      <div style={{ height: 40 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool call card sub-component
// ---------------------------------------------------------------------------

function ToolCallCard({
  index, toolName, entry, subaccountId,
}: {
  index: number; toolName: string; entry: ToolCallEntry; subaccountId: string;
}) {
  const [showInput, setShowInput] = useState(false);
  const [showOutput, setShowOutput] = useState(false);

  return (
    <div style={{
      background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
      padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 22, height: 22, borderRadius: 6, background: '#6366f1',
            color: '#fff', fontSize: 11, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {index + 1}
          </span>
          <span style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', fontFamily: 'ui-monospace, monospace' }}>
            {toolName}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {entry.durationMs != null && (
            <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 500 }}>
              {formatDuration(entry.durationMs)}
            </span>
          )}
          {entry.actionId && (
            <Link
              to={`/admin/subaccounts/${subaccountId}/workspace`}
              style={{
                fontSize: 11, color: '#6366f1', fontWeight: 600,
                textDecoration: 'none', background: '#ede9fe',
                padding: '2px 7px', borderRadius: 4,
              }}
            >
              action
            </Link>
          )}
        </div>
      </div>

      {/* Toggle buttons */}
      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
        {entry.input != null && (
          <button
            onClick={() => setShowInput(!showInput)}
            style={{
              border: '1px solid #e2e8f0', borderRadius: 5, padding: '3px 10px',
              fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
              background: showInput ? '#6366f1' : '#fff',
              color: showInput ? '#fff' : '#64748b',
            }}
          >
            Input
          </button>
        )}
        {entry.output != null && (
          <button
            onClick={() => setShowOutput(!showOutput)}
            style={{
              border: '1px solid #e2e8f0', borderRadius: 5, padding: '3px 10px',
              fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
              background: showOutput ? '#6366f1' : '#fff',
              color: showOutput ? '#fff' : '#64748b',
            }}
          >
            Output
          </button>
        )}
      </div>

      {showInput && entry.input != null && (
        <div style={{ marginTop: 8 }}>
          <JsonBlock data={entry.input} maxHeight={200} />
        </div>
      )}
      {showOutput && entry.output != null && (
        <div style={{ marginTop: 8 }}>
          <JsonBlock data={entry.output} maxHeight={200} />
        </div>
      )}
    </div>
  );
}

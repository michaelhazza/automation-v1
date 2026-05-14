import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import Modal from '../Modal';
import ConfirmDialog from '../ConfirmDialog';
import AgentRunCancelButton from '../AgentRunCancelButton';
import { toast } from 'sonner';
import type { OrgAgent, LinkedAgent, Template, AgentRunRecord } from './types';

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
const btnPrimary = 'btn btn-primary';
const btnSecondary = 'btn btn-secondary';

export function AgentsTab({ subaccountId }: { subaccountId: string }) {
  const [linked, setLinked] = useState<LinkedAgent[]>([]);
  const [orgAgents, setOrgAgents] = useState<OrgAgent[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [applyingTemplate, setApplyingTemplate] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Run state
  const [runningAgentId, setRunningAgentId] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<Record<string, AgentRunRecord[]>>({});
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [showRunResult, setShowRunResult] = useState<AgentRunRecord | null>(null);
  const [claudeCodeAvailable, setClaudeCodeAvailable] = useState<boolean | null>(null);
  const [unlinkAgentId, setUnlinkAgentId] = useState<string | null>(null);

  const load = async () => {
    try {
      const [linkedRes, agentsRes, templatesRes, ccStatus] = await Promise.all([
        api.get(`/api/subaccounts/${subaccountId}/agents`),
        api.get('/api/agents').catch(() => ({ data: [] })),
        api.get('/api/hierarchy-templates').catch(() => ({ data: [] })),
        api.get(`/api/subaccounts/${subaccountId}/claude-code-status`).catch(() => ({ data: { available: false } })),
      ]);
      setLinked(linkedRes.data);
      setOrgAgents(agentsRes.data);
      setTemplates(templatesRes.data);
      setClaudeCodeAvailable(ccStatus.data.available);
    } catch { setError('Failed to load agents'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [subaccountId]);

  const linkedIds = new Set(linked.map(l => l.agentId));
  const availableAgents = orgAgents.filter(a => !linkedIds.has(a.id) && a.status === 'active');

  const handleLink = async () => {
    if (!selectedAgentId) return;
    setError(''); setMsg('');
    try {
      await api.post(`/api/subaccounts/${subaccountId}/agents`, { agentId: selectedAgentId });
      setShowLinkForm(false); setSelectedAgentId('');
      setMsg('Agent linked successfully');
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to link agent');
    }
  };

  const handleUnlink = async (agentId: string) => {
    setError(''); setMsg('');
    try {
      await api.delete(`/api/subaccounts/${subaccountId}/agents/${agentId}`);
      toast.success('Agent unlinked');
      load();
    } catch {
      toast.error('Failed to unlink agent');
    } finally {
      setUnlinkAgentId(null);
    }
  };

  const handleApplyTemplate = async (templateId: string) => {
    setApplyingTemplate(templateId);
    setError(''); setMsg('');
    try {
      const { data } = await api.post(`/api/hierarchy-templates/${templateId}/apply`, {
        subaccountId,
        mode: 'merge',
      });
      const s = data.summary;
      setMsg(`Template applied: ${s.agentsLinked} linked, ${s.agentsCreated} created, ${s.hierarchyUpdated} hierarchy relationships set`);
      setShowTemplates(false);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to apply template');
    } finally { setApplyingTemplate(null); }
  };

  const handleRunAgent = async (agentId: string, mode: 'api' | 'claude-code') => {
    setRunningAgentId(agentId);
    setError(''); setMsg('');
    try {
      const { data } = await api.post(`/api/subaccounts/${subaccountId}/agents/${agentId}/run`, {
        executionMode: mode,
      });
      setMsg(`Agent run ${data.status}: ${data.summary?.slice(0, 200) ?? 'No summary'} (${data.totalTokens} tokens, ${Math.round((data.durationMs ?? 0) / 1000)}s)`);
      // Refresh history for this agent
      loadRunHistory(agentId);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to run agent');
    } finally { setRunningAgentId(null); }
  };

  const loadRunHistory = async (agentId: string) => {
    try {
      const { data } = await api.get(`/api/subaccounts/${subaccountId}/agents/${agentId}/runs?limit=10`);
      setRunHistory(prev => ({ ...prev, [agentId]: data }));
    } catch { /* ignore */ }
  };

  const toggleExpand = (agentId: string) => {
    if (expandedAgent === agentId) {
      setExpandedAgent(null);
    } else {
      setExpandedAgent(agentId);
      if (!runHistory[agentId]) loadRunHistory(agentId);
    }
  };

  const STATUS_BADGE: Record<string, string> = {
    completed: 'bg-green-100 text-green-700',
    running: 'bg-blue-100 text-blue-700',
    timeout: 'bg-amber-100 text-amber-700',
    budget_exceeded: 'bg-orange-100 text-orange-700',
    loop_detected: 'bg-purple-100 text-purple-700',
    pending: 'bg-slate-100 text-slate-600',
    cancelling: 'bg-slate-200 text-slate-700',
    cancelled: 'bg-slate-100 text-slate-500',
  };

  if (loading) return <div className="py-8 text-sm text-slate-500">Loading agents...</div>;

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-[18px] font-semibold text-slate-800 m-0">Linked Agents</h2>
          {claudeCodeAvailable !== null && (
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${claudeCodeAvailable ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
              Claude Code {claudeCodeAvailable ? 'Available' : 'Not Found'}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowTemplates(true)} className="btn btn-sm btn-secondary">
            Load Team Template
          </button>
          <button onClick={() => setShowLinkForm(true)} className="btn btn-sm btn-primary">
            + Link Agent
          </button>
        </div>
      </div>

      {msg && <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 mb-4 text-[13px] text-green-700">{msg}</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 mb-4 text-[13px] text-red-600">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {linked.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">No agents linked yet. Link an org agent or load a team template to get started.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {linked.map((l) => (
              <div key={l.id}>
                <div className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {l.agent.icon && <span className="text-lg shrink-0">{l.agent.icon}</span>}
                    <div className="min-w-0">
                      <Link to={`/admin/subaccounts/${subaccountId}/agents/${l.id}/manage`} className="font-medium text-slate-800 hover:text-indigo-600 no-underline transition-colors text-[14px]">{l.agent.name}</Link>
                      {l.agent.description && <div className="text-[12px] text-slate-400 mt-0.5 truncate">{l.agent.description}</div>}
                    </div>
                    {l.agentRole && <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full shrink-0">{l.agentRole}</span>}
                    <span className={`text-[11px] font-semibold capitalize px-2 py-0.5 rounded-full shrink-0 ${l.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                      {l.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <Link
                      to={`/admin/subaccounts/${subaccountId}/agents/${l.id}/manage`}
                      className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-md text-[12px] font-medium transition-colors no-underline"
                    >
                      Manage
                    </Link>
                    <button
                      onClick={() => handleRunAgent(l.agentId, 'api')}
                      disabled={runningAgentId === l.agentId}
                      className="btn btn-xs btn-ghost text-indigo-700 hover:bg-indigo-50"
                      title="Run via Anthropic API"
                    >
                      {runningAgentId === l.agentId ? 'Running...' : 'Run (API)'}
                    </button>
                    {claudeCodeAvailable && (
                      <button
                        onClick={() => handleRunAgent(l.agentId, 'claude-code')}
                        disabled={runningAgentId === l.agentId}
                        className="btn btn-xs btn-ghost text-emerald-700 hover:bg-emerald-50"
                        title="Run via Claude Code CLI (uses Max plan)"
                      >
                        {runningAgentId === l.agentId ? 'Running...' : 'Run (Claude Code)'}
                      </button>
                    )}
                    <button
                      onClick={() => toggleExpand(l.agentId)}
                      className="btn btn-xs btn-ghost"
                    >
                      {expandedAgent === l.agentId ? 'Hide' : 'History'}
                    </button>
                    <button onClick={() => setUnlinkAgentId(l.agentId)} className="btn btn-xs btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700">
                      Unlink
                    </button>
                  </div>
                </div>

                {/* Expandable run history */}
                {expandedAgent === l.agentId && (
                  <div className="bg-slate-50 border-t border-slate-100 px-4 py-3">
                    <div className="text-[12px] font-semibold text-slate-600 mb-2">Recent Runs</div>
                    {!runHistory[l.agentId] ? (
                      <div className="text-[12px] text-slate-400">Loading...</div>
                    ) : runHistory[l.agentId].length === 0 ? (
                      <div className="text-[12px] text-slate-400">No runs yet</div>
                    ) : (
                      <div className="space-y-1.5">
                        {runHistory[l.agentId].map((r) => (
                          <div
                            key={r.id}
                            onClick={() => setShowRunResult(r)}
                            className="flex items-center gap-3 p-2 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-indigo-200 transition-colors"
                          >
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[r.status] ?? 'bg-slate-100 text-slate-500'}`}>
                              {r.status}
                            </span>
                            <span className="text-[11px] text-slate-500">{r.executionMode === 'claude-code' ? 'Claude Code' : 'API'}</span>
                            <span className="text-[12px] text-slate-700 truncate flex-1">{r.summary?.slice(0, 100) ?? r.errorMessage?.slice(0, 100) ?? 'No summary'}</span>
                            <span className="text-[11px] text-slate-400 shrink-0">
                              {r.totalTokens > 0 && `${r.totalTokens} tok`}
                              {r.durationMs && ` · ${Math.round(r.durationMs / 1000)}s`}
                            </span>
                            <span className="text-[11px] text-slate-400 shrink-0">{new Date(r.createdAt).toLocaleString()}</span>
                            <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                              <AgentRunCancelButton
                                runId={r.id}
                                status={r.status}
                                variant="inline"
                                onCancelled={() => loadRunHistory(l.agentId)}
                              />
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Run result detail modal */}
      {showRunResult && (
        <Modal title={`Run: ${showRunResult.status}`} onClose={() => setShowRunResult(null)} maxWidth={640}>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-[20px] font-bold text-slate-800">{showRunResult.totalTokens.toLocaleString()}</div>
              <div className="text-[11px] text-slate-500">Tokens</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-[20px] font-bold text-slate-800">{showRunResult.totalToolCalls}</div>
              <div className="text-[11px] text-slate-500">Tool Calls</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-[20px] font-bold text-slate-800">{showRunResult.durationMs ? `${Math.round(showRunResult.durationMs / 1000)}s` : '—'}</div>
              <div className="text-[11px] text-slate-500">Duration</div>
            </div>
          </div>
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[showRunResult.status] ?? 'bg-slate-100 text-slate-500'}`}>
                {showRunResult.status}
              </span>
              <span className="text-[11px] text-slate-500">{showRunResult.executionMode === 'claude-code' ? 'Claude Code' : 'API'} · {showRunResult.runType}</span>
              <span className="text-[11px] text-slate-400">{new Date(showRunResult.createdAt).toLocaleString()}</span>
            </div>
          </div>
          {showRunResult.summary && (
            <div className="mb-3">
              <div className="text-[12px] font-semibold text-slate-600 mb-1">Summary</div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[13px] text-slate-700 whitespace-pre-wrap max-h-[300px] overflow-auto">{showRunResult.summary}</div>
            </div>
          )}
          {showRunResult.errorMessage && (
            <div>
              <div className="text-[12px] font-semibold text-red-600 mb-1">Error</div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-[13px] text-red-700 whitespace-pre-wrap">{showRunResult.errorMessage}</div>
            </div>
          )}
        </Modal>
      )}

      {/* Link Agent modal */}
      {showLinkForm && (
        <Modal title="Link Org Agent" onClose={() => setShowLinkForm(false)} maxWidth={400}>
          {availableAgents.length === 0 ? (
            <div className="text-[13px] text-slate-500 mb-4">All org agents are already linked to this company, or no agents exist at the org level yet.</div>
          ) : (
            <div className="mb-5">
              <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Select agent</label>
              <select value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)} className={inputCls}>
                <option value="">Choose an agent...</option>
                {availableAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.icon ?? ''} {a.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-3">
            {availableAgents.length > 0 && <button onClick={handleLink} disabled={!selectedAgentId} className={btnPrimary}>Link</button>}
            <button onClick={() => setShowLinkForm(false)} className={btnSecondary}>Cancel</button>
          </div>
        </Modal>
      )}

      {unlinkAgentId && (
        <ConfirmDialog
          title="Unlink Agent"
          message="Unlink this agent from this company?"
          confirmLabel="Unlink"
          onConfirm={() => handleUnlink(unlinkAgentId)}
          onCancel={() => setUnlinkAgentId(null)}
        />
      )}

      {/* Team Templates modal */}
      {showTemplates && (
        <Modal title="Load Team Template" onClose={() => setShowTemplates(false)} maxWidth={500}>
          {templates.length === 0 ? (
            <div className="text-[13px] text-slate-500 mb-4">No team templates available. Create templates from the organisation Agents page.</div>
          ) : (
            <div className="flex flex-col gap-2 mb-4">
              {templates.map((t) => (
                <div key={t.id} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div>
                    <div className="text-[14px] font-semibold text-slate-800">{t.name}</div>
                    <div className="text-[12px] text-slate-500">{t.slotCount} agents &middot; v{t.version} &middot; {t.sourceType}</div>
                    {t.description && <div className="text-[12px] text-slate-400 mt-0.5">{t.description}</div>}
                  </div>
                  <button
                    onClick={() => handleApplyTemplate(t.id)}
                    disabled={applyingTemplate === t.id}
                    className="btn btn-sm btn-primary shrink-0"
                  >
                    {applyingTemplate === t.id ? 'Applying...' : 'Apply'}
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={() => setShowTemplates(false)} className={btnSecondary}>Close</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// client/src/pages/govern/components/TestWebLoginModal.tsx
// Spec: tasks/builds/operator-session-identity/spec.md §5.5, §8.13, Chunk 9

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../../../components/Modal';
import api from '../../../lib/api';
import type { WebLoginConnection } from './WebLoginsTab';

interface Props {
  open: boolean;
  subaccountId: string;
  connection: WebLoginConnection;
  onClose: () => void;
}

interface AgentOption {
  id: string;
  agentId: string;
  name: string;
}

export function TestWebLoginModal({ open: _open, subaccountId, connection, onClose }: Props) {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [selectedSubaccountAgentId, setSelectedSubaccountAgentId] = useState('');
  const [firing, setFiring] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

  useEffect(() => {
    setAgentsLoading(true);
    setBannerError(null);
    api.get(`/api/subaccounts/${subaccountId}/web-login-connections/test-eligible-agents`)
      .then((res) => {
        const rows: AgentOption[] = (Array.isArray(res.data) ? res.data : []).map((r: {
          id: string;
          agentId: string;
          name?: string;
        }) => ({
          id: r.id,
          agentId: r.agentId,
          name: r.name ?? 'Unnamed agent',
        }));
        setAgents(rows);
        if (rows.length === 1) setSelectedSubaccountAgentId(rows[0].id);
      })
      .catch((e: unknown) => {
        const msg = (e as { response?: { data?: { error?: string; message?: string } } })
          .response?.data?.error
          ?? (e as { response?: { data?: { message?: string } } }).response?.data?.message
          ?? 'Failed to load agents.';
        setBannerError(msg);
      })
      .finally(() => setAgentsLoading(false));
  }, [subaccountId, connection.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRun() {
    const agent = agents.find((a) => a.id === selectedSubaccountAgentId);
    if (!agent) {
      setBannerError('Select an agent to attribute the test run to.');
      return;
    }
    setFiring(true);
    setBannerError(null);
    try {
      // V1: row status dot does not auto-update after the test completes; user refreshes to see the result. Deferred — depends on a canonical streaming run-trace primitive (see tasks/todo.md).
      const res = await api.post(
        `/api/subaccounts/${subaccountId}/web-login-connections/${connection.id}/test`,
        { agentId: agent.agentId, subaccountAgentId: agent.id },
      );
      const data = res.data as { agentRunId: string };
      onClose();
      navigate(`/admin/subaccounts/${subaccountId}/runs/${data.agentRunId}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string; message?: string } } })
        .response?.data?.error
        ?? (e as { response?: { data?: { message?: string } } }).response?.data?.message
        ?? 'Failed to start test. Please try again.';
      setBannerError(msg);
      setFiring(false);
    }
  }

  const title = `Test connection: ${connection.label ?? connection.config?.loginUrl ?? 'Web Login'}`;

  return (
    <Modal title={title} onClose={onClose} maxWidth={480}>
      <div className="space-y-4">
        <p className="text-[12.5px] text-slate-500 leading-relaxed">
          Fires a browser task that logs in with this connection's credentials and verifies success.
          You can follow progress in the agent run detail page after starting the test.
        </p>

        {bannerError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-[12.5px] text-red-700">
            {bannerError}
          </div>
        )}

        <div>
          <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
            Attribute run to agent
          </label>
          {agentsLoading ? (
            <div className="text-[12.5px] text-slate-400">Loading agents...</div>
          ) : agents.length === 0 ? (
            <div className="text-[12.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              No agents available in this workspace. Assign at least one agent before testing.
            </div>
          ) : (
            <select
              value={selectedSubaccountAgentId}
              onChange={(e) => { setSelectedSubaccountAgentId(e.target.value); setBannerError(null); }}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-700 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-[inherit] bg-white"
            >
              <option value="">Select an agent...</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
        </div>

        {firing && (
          <div className="flex items-center gap-2 p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-[12.5px] text-indigo-700">
            <svg className="animate-spin flex-shrink-0" width="14" height="14" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Test in progress...
          </div>
        )}

        <div className="flex justify-between pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[13px] font-medium rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer font-[inherit]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={firing || agentsLoading || !selectedSubaccountAgentId || agents.length === 0}
            className="px-4 py-2 text-[13px] font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white border-0 cursor-pointer font-[inherit] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {firing ? 'Starting...' : 'Run test'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

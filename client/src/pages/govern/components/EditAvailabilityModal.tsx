// client/src/pages/govern/components/EditAvailabilityModal.tsx
// Spec: tasks/builds/operator-session-identity/spec.md §Chunk 7
// Agent allowlist editor: "All agents" / "Specific agents" radio.
// When "Specific agents": multi-select from the connection's existing allowedAgentIds.
// Note: a full agents API is not yet available; specific-agent mode preserves
// the existing allowedAgentIds and allows adding/removing by ID until agents
// listing ships in a later chunk.

import { useState } from 'react';
import Modal from '../../../components/Modal';
import type { AiSubscriptionConnection } from '../../../../../shared/types/govern.js';
import { editAiSubscriptionAvailability } from '../../../api/governApi';

interface Props {
  subaccountId: string;
  connection: AiSubscriptionConnection;
  onClose: () => void;
  onSaved: () => void;
}

export function EditAvailabilityModal({ subaccountId, connection, onClose, onSaved }: Props) {
  const [scope, setScope] = useState<'all_agents' | 'specific_agents'>(connection.availabilityScope);
  const [agentIds, setAgentIds] = useState<string[]>(connection.allowedAgentIds ?? []);
  const [newAgentId, setNewAgentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = connection.label ?? `${connection.provider} ${connection.planTier}`;

  function addAgent() {
    const id = newAgentId.trim();
    if (!id || agentIds.includes(id)) return;
    setAgentIds([...agentIds, id]);
    setNewAgentId('');
  }

  function removeAgent(id: string) {
    setAgentIds(agentIds.filter((a) => a !== id));
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await editAiSubscriptionAvailability(subaccountId, connection.id, {
        availabilityScope: scope,
        allowedAgentIds: scope === 'all_agents' ? null : agentIds,
      });
      onSaved();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      setError(msg ?? (e instanceof Error ? e.message : 'Save failed. Please try again.'));
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit availability" onClose={onClose} maxWidth={560}>
      {/* Subscription identity strip */}
      <div className="flex items-center gap-3 p-3.5 bg-white border border-slate-200 rounded-lg mb-5 shadow-sm">
        <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
          <svg width="17" height="17" fill="none" stroke="#047857" strokeWidth="1.8" viewBox="0 0 24 24">
            <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        </div>
        <div>
          <div className="text-[14px] font-semibold text-slate-900">{label}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded border capitalize bg-indigo-50 text-indigo-700 border-indigo-200`}>
              {connection.planTier}
            </span>
          </div>
        </div>
      </div>

      <p className="text-[13px] text-slate-500 mb-4 leading-relaxed">
        Choose which agents can use this AI Subscription. Takes effect when autonomous agents run.
      </p>

      {/* Radio: All agents */}
      <label
        className={`flex items-start gap-3 p-3.5 rounded-lg border-2 cursor-pointer mb-2.5 transition-colors ${
          scope === 'all_agents' ? 'border-indigo-500 bg-indigo-50/60' : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50'
        }`}
      >
        <input
          type="radio"
          name="availability"
          value="all_agents"
          checked={scope === 'all_agents'}
          onChange={() => setScope('all_agents')}
          className="mt-0.5 accent-indigo-600 flex-shrink-0"
        />
        <div>
          <div className="text-[13.5px] font-semibold text-slate-900">All agents in this workspace</div>
          <div className="text-[12px] text-slate-500 mt-0.5">Any agent can use this subscription when it runs.</div>
        </div>
      </label>

      {/* Radio: Specific agents */}
      <label
        className={`flex items-start gap-3 p-3.5 rounded-lg border-2 cursor-pointer mb-3 transition-colors ${
          scope === 'specific_agents' ? 'border-indigo-500 bg-indigo-50/60' : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50'
        }`}
      >
        <input
          type="radio"
          name="availability"
          value="specific_agents"
          checked={scope === 'specific_agents'}
          onChange={() => setScope('specific_agents')}
          className="mt-0.5 accent-indigo-600 flex-shrink-0"
        />
        <div>
          <div className="text-[13.5px] font-semibold text-slate-900">Specific agents only</div>
          <div className="text-[12px] text-slate-500 mt-0.5">Only listed agents can use this subscription.</div>
        </div>
      </label>

      {/* Agent list (shown when specific_agents) */}
      {scope === 'specific_agents' && (
        <div className="border border-slate-200 rounded-lg overflow-hidden mb-3">
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-[12px] text-slate-500">
            <strong className="text-slate-700">Selected agents</strong>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-indigo-600 text-white px-2 py-0.5 rounded-full">
              {agentIds.length} selected
            </span>
          </div>

          {agentIds.length > 0 ? (
            agentIds.map((id) => (
              <div key={id} className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 last:border-b-0">
                <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0 text-indigo-600 text-sm">
                  &#129302;
                </div>
                <span className="flex-1 text-[13px] text-slate-700 font-medium">{id}</span>
                <button
                  type="button"
                  onClick={() => removeAgent(id)}
                  className="text-[11px] text-red-500 hover:text-red-700 bg-transparent border-0 cursor-pointer font-[inherit]"
                >
                  Remove
                </button>
              </div>
            ))
          ) : (
            <div className="px-4 py-3 text-[12.5px] text-slate-400 italic">
              No agents selected. Add agent IDs below.
            </div>
          )}

          {/* Add agent input */}
          <div className="flex gap-2 px-4 py-3 bg-slate-50 border-t border-slate-200">
            <input
              type="text"
              value={newAgentId}
              onChange={(e) => setNewAgentId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addAgent(); }}
              placeholder="Agent ID"
              className="flex-1 px-2.5 py-1.5 text-[12.5px] border border-slate-200 rounded-md focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-[inherit]"
            />
            <button
              type="button"
              onClick={addAgent}
              className="px-3 py-1.5 text-[12px] font-semibold rounded-md bg-indigo-600 hover:bg-indigo-700 text-white border-0 cursor-pointer font-[inherit] transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-[12px] text-red-600 mb-3">{error}</p>}

      <div className="flex justify-end gap-2.5 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-[13px] font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer font-[inherit]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => { void handleSave(); }}
          disabled={busy || (scope === 'specific_agents' && agentIds.length === 0)}
          className="px-5 py-2 text-[13px] font-semibold rounded-lg border-0 bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer font-[inherit] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Saving...' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

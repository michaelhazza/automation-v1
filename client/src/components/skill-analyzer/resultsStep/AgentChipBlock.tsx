import { useState, useMemo } from 'react';
import api from '../../../lib/api';
import type { AnalysisResult, AgentProposal, AvailableSystemAgent } from '../types';

/** Minimum cosine similarity score to display an existing-agent proposal chip.
 *  Below this threshold scores are noise — they signal "no match found" rather
 *  than a useful recommendation. Raised from 0.30 to 0.45 so only genuinely
 *  informative suggestions are shown (v4 Fix 5). */
const AGENT_SCORE_DISPLAY_THRESHOLD = 0.45;

/** Agent chip block on a DISTINCT card. Renders one chip per agentProposals
 *  entry — pre-checked when proposal.selected is true, click toggles selection
 *  via PATCH. Includes an "Add another system agent..." combobox populated
 *  from job.availableSystemAgents (filtered to agents not already in
 *  agentProposals). See spec §7.1 New Skill cards. */
export default function AgentChipBlock({
  result,
  jobId,
  availableSystemAgents,
  onProposalsUpdated,
}: {
  result: AnalysisResult;
  jobId: string;
  availableSystemAgents: AvailableSystemAgent[];
  onProposalsUpdated: (resultId: string, proposals: AgentProposal[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [selectedToAdd, setSelectedToAdd] = useState<string>('');
  const allProposals = result.agentProposals ?? [];
  // Filter out existing-agent proposals below the display threshold — they
  // signal "no match" rather than a real recommendation and add noise.
  // Proposed-new-agent entries always show regardless of score.
  // Selected proposals ALSO always show regardless of score: once a user
  // (or auto-selection) has picked an agent it must remain visible so the
  // user can see the current selection and deselect it if they change their
  // mind. Hiding a selected-but-low-score proposal silently traps the
  // selection with no UI to undo it.
  // Sort selected proposals to the top so the user's current selection is
  // always the first chip they see — helpful when a block has many below-
  // threshold proposals that are only visible because they're selected.
  // Array.prototype.sort is stable in ES2019+, so the relative order of
  // unselected proposals is preserved from allProposals (which is already
  // score-ranked upstream).
  const proposals = allProposals
    .filter(
      (p) => p.selected || p.isProposedNewAgent || p.score >= AGENT_SCORE_DISPLAY_THRESHOLD,
    )
    .sort((a, b) => Number(b.selected) - Number(a.selected));
  // Agents not already in agentProposals — eligible for the manual-add
  // combobox. Pure derivation, no state.
  const addableAgents = useMemo(() => {
    const inProposals = new Set(allProposals.map((p) => p.systemAgentId));
    return availableSystemAgents.filter((a) => !inProposals.has(a.systemAgentId));
  }, [allProposals, availableSystemAgents]);

  async function patchProposal(body: {
    systemAgentId: string;
    selected?: boolean;
    remove?: boolean;
    addIfMissing?: boolean;
  }) {
    setError(null);
    try {
      const { data } = await api.patch<AnalysisResult>(
        `/api/system/skill-analyser/jobs/${jobId}/results/${result.id}/agents`,
        body,
      );
      // The PATCH endpoint returns the freshly enriched result row with
      // the updated agentProposals array. Push it back to the parent.
      onProposalsUpdated(result.id, data.agentProposals ?? []);
    } catch (err) {
      const e = err as { response?: { data?: { error?: unknown } }; message?: string };
      const errBody = e?.response?.data?.error;
      const msg = (typeof errBody === 'string' ? errBody : (errBody as { message?: string } | null)?.message) ?? e?.message ?? 'Failed to update agent proposal.';
      console.error('[SkillAnalyzer] Failed to PATCH agent proposal:', err);
      setError(msg);
    }
  }

  async function toggleSelected(proposal: AgentProposal) {
    if (!proposal.systemAgentId) return;    // retro-injected proposed-new-agent; no backing agent yet
    await patchProposal({
      systemAgentId: proposal.systemAgentId,
      selected: !proposal.selected,
    });
  }

  async function removeProposal(proposal: AgentProposal) {
    if (!proposal.systemAgentId) return;
    await patchProposal({ systemAgentId: proposal.systemAgentId, remove: true });
  }

  async function addAgent() {
    if (!selectedToAdd) return;
    await patchProposal({ systemAgentId: selectedToAdd, addIfMissing: true });
    setSelectedToAdd('');
  }

  return (
    <div className="mt-3 p-3 bg-white border border-slate-200 rounded-lg text-xs">
      <p className="font-medium text-slate-600 mb-2">Assign to system agents:</p>
      {allProposals.length === 0 && availableSystemAgents.length === 0 && (
        <p className="text-slate-400 italic">No system agents available.</p>
      )}
      {allProposals.length === 0 && availableSystemAgents.length > 0 && (
        <p className="text-slate-400 italic mb-2">No suggested agents — add one below.</p>
      )}
      {proposals.length === 0 && allProposals.length > 0 && (
        <p className="text-slate-400 italic mb-2 text-[11px]">
          No existing agent has strong overlap with this skill. Consider assigning to the proposed Growth Marketing Agent (if available) or creating a new agent.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {proposals.map((proposal) => (
          <span
            key={proposal.systemAgentId ?? `proposed:${proposal.proposedAgentIndex ?? 0}`}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border transition-colors ${
              proposal.selected
                ? proposal.isProposedNewAgent
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-emerald-600 border-emerald-600 text-white'
                : 'bg-slate-100 border-slate-200 text-slate-500'
            }`}
          >
            <button
              type="button"
              onClick={() => toggleSelected(proposal)}
              className="flex items-center gap-1"
              aria-label={proposal.selected ? 'Deselect' : 'Select'}
            >
              <span className="font-medium">{proposal.nameSnapshot}</span>
              {proposal.isProposedNewAgent && (
                <span className="text-[9px] font-normal px-1 py-[1px] rounded bg-indigo-200 text-indigo-900">
                  Proposed (not yet created)
                </span>
              )}
              {!proposal.isProposedNewAgent && (
                <span className={`text-[10px] ${proposal.selected ? 'opacity-80' : 'opacity-60'}`}>{Math.round(proposal.score * 100)}%</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => removeProposal(proposal)}
              className={`ml-0.5 ${proposal.selected ? 'text-emerald-200 hover:text-white' : 'text-slate-400 hover:text-red-600'}`}
              aria-label="Remove proposal"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {addableAgents.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={selectedToAdd}
            onChange={(e) => setSelectedToAdd(e.target.value)}
            className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-700"
          >
            <option value="">+ Add another system agent…</option>
            {addableAgents.map((a) => (
              <option key={a.systemAgentId} value={a.systemAgentId}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addAgent}
            disabled={!selectedToAdd}
            className="text-xs px-2 py-1 rounded border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-red-600">{error}</p>}
    </div>
  );
}


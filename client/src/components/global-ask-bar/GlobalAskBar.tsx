// client/src/components/global-ask-bar/GlobalAskBar.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api.js';
import { isValidBriefText, type ScopeCandidate, type SessionMessageResponse } from './GlobalAskBarPure.js';
import { getActiveOrgId, getActiveOrgName, getActiveClientId, setActiveOrg, setActiveClient, removeActiveClient } from '../../lib/auth.js';

type DisambiguationState = {
  candidates: ScopeCandidate[];
  question: string;
  remainder: string | null;
};

interface GlobalAskBarProps {
  placeholder?: string;
}

export default function GlobalAskBar({ placeholder }: GlobalAskBarProps) {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [disambiguation, setDisambiguation] = useState<DisambiguationState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleResponse = (data: SessionMessageResponse) => {
    if (data.type === 'error') {
      setError(data.message);
      return;
    }
    if (data.type === 'disambiguation') {
      setDisambiguation({ candidates: data.candidates, question: data.question, remainder: data.remainder });
      return;
    }
    // context_switch and brief_created both carry resolved context — apply it.
    // organisationId is the source of truth; organisationName may be omitted when
    // the server already knows context did not change (path-C brief_created).
    // Falling back to the stored name keeps the id update deterministic instead
    // of silently skipping it on a missing name and leaving the next request
    // pinned to the old org.
    //
    // Subaccount clearing is unconditional on response.subaccountId === null —
    // server response is authoritative, so a same-org context switch (or stale
    // subaccount drop) that returns no subaccount must clear localStorage too.
    // Gating on orgChanged left a stale subaccount visible when the user moved
    // back to org-level inside their existing org.
    if (data.organisationId) {
      setActiveOrg(data.organisationId, data.organisationName ?? getActiveOrgName() ?? '');
      if (!data.subaccountId) {
        removeActiveClient();
      }
    }
    if (data.subaccountId && data.subaccountName) {
      setActiveClient(data.subaccountId, data.subaccountName);
    }
    setText('');
    setDisambiguation(null);
    setError(null);
    if (data.type === 'brief_created') {
      navigate(`/admin/briefs/${data.briefId}`);
    }
  };

  const post = async (payload: Record<string, unknown>) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<SessionMessageResponse>('/api/session/message', {
        sessionContext: {
          activeOrganisationId: getActiveOrgId(),
          activeSubaccountId: getActiveClientId(),
        },
        ...payload,
      });
      handleResponse(data);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidBriefText(text) || isSubmitting) return;
    void post({ text: text.trim() });
  };

  const handleCandidateSelect = (candidate: ScopeCandidate) => {
    void post({
      selectedCandidateId: candidate.id,
      selectedCandidateName: candidate.name,
      selectedCandidateType: candidate.type,
      pendingRemainder: disambiguation?.remainder ?? null,
    });
  };

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => { setText(e.target.value); setDisambiguation(null); setError(null); }}
          placeholder={placeholder ?? 'Ask anything…'}
          disabled={isSubmitting}
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!isValidBriefText(text) || isSubmitting}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40"
        >
          {isSubmitting ? '…' : 'Send'}
        </button>
      </form>

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      {disambiguation && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm text-gray-700 mb-2">{disambiguation.question}</p>
          <div className="flex flex-wrap gap-2">
            {disambiguation.candidates.map((c) => (
              <button
                key={`${c.type}:${c.id}`}
                onClick={() => handleCandidateSelect(c)}
                disabled={isSubmitting}
                className="px-3 py-1.5 text-sm rounded-md border border-indigo-300 text-indigo-700 bg-white hover:bg-indigo-50 disabled:opacity-40"
              >
                {c.name}
                <span className="ml-1.5 text-xs text-gray-400">
                  ({c.type === 'org' ? 'org' : `subaccount${c.orgName ? ` — ${c.orgName}` : ''}`})
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import api from '../../lib/api.js';
import { RuleCaptureDialog } from '../rules/RuleCaptureDialog.js';
import type { RuleScope, SaveRuleResult } from '../../../../shared/types/briefRules.js';

interface CandidateRule {
  text: string;
  category: string;
  suggestedScope: RuleScope;
  confidence: number;
}

interface ApprovalSuggestionPanelProps {
  artefactId: string;
  briefId: string;
  wasApproved: boolean;
  onDismiss: () => void;
}

export function ApprovalSuggestionPanel({
  artefactId,
  briefId,
  wasApproved,
  onDismiss,
}: ApprovalSuggestionPanelProps) {
  const [candidates, setCandidates] = useState<CandidateRule[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateRule | null>(null);
  const [saved, setSaved] = useState(false);

  async function loadCandidates() {
    setLoading(true);
    try {
      const result = await api.post<{ candidates: CandidateRule[] }>(
        '/api/rules/draft-candidates',
        { artefactId, wasApproved },
      );
      setCandidates(result.candidates);
    } catch {
      onDismiss();
    } finally {
      setLoading(false);
    }
  }

  function handleSaved(_result: SaveRuleResult) {
    setSaved(true);
    setSelectedCandidate(null);
    setTimeout(onDismiss, 1500);
  }

  if (saved) {
    return (
      <div className="mt-3 border-t border-gray-100 pt-3">
        <p className="text-xs text-green-600 font-medium">Rule saved. The system will remember this.</p>
      </div>
    );
  }

  if (candidates === null && !loading) {
    return (
      <div className="mt-3 border-t border-gray-100 pt-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            {wasApproved ? 'Teach the system this preference?' : 'Should the system avoid this in future?'}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={loadCandidates}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Yes, suggest a rule
            </button>
            <button
              onClick={onDismiss}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mt-3 border-t border-gray-100 pt-3">
        <p className="text-xs text-gray-400">Drafting suggestions…</p>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="text-xs font-medium text-gray-700 mb-2">Pick a rule to save:</p>
      <ul className="space-y-1.5 mb-2">
        {(candidates ?? []).map((c, i) => (
          <li key={i}>
            <button
              onClick={() => setSelectedCandidate(c)}
              className="w-full text-left text-xs px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 rounded-lg border border-indigo-100"
            >
              {c.text}
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={onDismiss}
        className="text-xs text-gray-400 hover:text-gray-600"
      >
        Not now
      </button>

      {selectedCandidate && (
        <RuleCaptureDialog
          initialText={selectedCandidate.text}
          defaultScope={selectedCandidate.suggestedScope}
          originatingArtefactId={artefactId}
          originatingBriefId={briefId}
          onSaved={handleSaved}
          onClose={() => setSelectedCandidate(null)}
        />
      )}
    </div>
  );
}

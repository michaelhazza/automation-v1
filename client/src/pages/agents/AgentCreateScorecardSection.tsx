// client/src/pages/agents/AgentCreateScorecardSection.tsx
// Scorecard section shown on the agent create flow.
// Trust & Verification Layer spec §12.2, §14.
//
// Shows suggested scorecards from the org library so the operator never
// lands on a blank tab. Default suggestion state: nothing pre-selected.

import React, { useEffect, useState } from 'react';
import { ScorecardSourcePill } from '../../components/scorecard/ScorecardSourcePill';
import { listScorecards, type ScorecardWithPill } from '../../lib/api/scorecards';
import { getUserRole } from '../../lib/auth';

const FREQUENCY_OPTIONS: Array<{ value: 'off' | 'q1' | 'q2' | 'q3'; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'q1', label: '25%' },
  { value: 'q2', label: '50%' },
  { value: 'q3', label: '75%' },
];

export interface ScorecardSelection {
  scorecardId: string;
  gradingFrequency: 'off' | 'q1' | 'q2' | 'q3';
}

interface AgentCreateScorecardSectionProps {
  value: ScorecardSelection[];
  onChange: (selections: ScorecardSelection[]) => void;
}

export function AgentCreateScorecardSection({
  value,
  onChange,
}: AgentCreateScorecardSectionProps) {
  const isStaff = getUserRole() === 'system_admin';
  const [cards, setCards] = useState<ScorecardWithPill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listScorecards()
      .then(setCards)
      .catch(() => setCards([]))
      .finally(() => setLoading(false));
  }, []);

  function isSelected(id: string): boolean {
    return value.some((s) => s.scorecardId === id);
  }

  function getFrequency(id: string): 'off' | 'q1' | 'q2' | 'q3' {
    return value.find((s) => s.scorecardId === id)?.gradingFrequency ?? 'q2';
  }

  function toggle(id: string) {
    if (isSelected(id)) {
      onChange(value.filter((s) => s.scorecardId !== id));
    } else {
      onChange([...value, { scorecardId: id, gradingFrequency: 'q2' }]);
    }
  }

  function updateFrequency(id: string, freq: 'off' | 'q1' | 'q2' | 'q3') {
    onChange(value.map((s) => s.scorecardId === id ? { ...s, gradingFrequency: freq } : s));
  }

  if (loading) {
    return <div className="text-sm text-slate-400">Loading scorecards...</div>;
  }

  if (cards.length === 0) {
    return (
      <div className="text-sm text-slate-400">
        No scorecards available. Create one in the Quality section first.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Select scorecards to attach to this agent.</p>
      {cards.map((card) => {
        const selected = isSelected(card.id);
        return (
          <div
            key={card.id}
            className={`flex items-center gap-3 px-3 py-2 rounded border transition-colors ${
              selected ? 'border-indigo-200 bg-indigo-50' : 'border-slate-100 hover:border-slate-200'
            }`}
          >
            <input
              type="checkbox"
              id={`sc-${card.id}`}
              checked={selected}
              onChange={() => toggle(card.id)}
              className="rounded border-slate-300"
            />
            <label htmlFor={`sc-${card.id}`} className="flex-1 min-w-0 cursor-pointer">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-slate-800">{card.name}</span>
                {card.sourcePill && (
                  <ScorecardSourcePill
                    scope={card.scopeType}
                    viewerScope="org_admin"
                    precomputed={card.sourcePill}
                  />
                )}
                {isStaff && card.qualityChecks.some((qc) => qc.kind && qc.kind !== 'semantic') && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600">
                    Validator checks
                  </span>
                )}
              </div>
            </label>
            {selected && (
              <select
                value={getFrequency(card.id)}
                onChange={(e) => updateFrequency(card.id, e.target.value as 'off' | 'q1' | 'q2' | 'q3')}
                className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                onClick={(e) => e.stopPropagation()}
              >
                {FREQUENCY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}

// client/src/pages/agents/AgentEditScorecardTab.tsx
// Scorecard tab within the Agent Edit page.
// Trust & Verification Layer spec §12.2, §12.5, §14.
//
// Authority rendering:
//   system_mandatory / org_mandatory → lock icon, "Required" label, caret-expandable, read-only at subaccount scope
//   suggested → fully editable (frequency selector, detach button)

import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { ScorecardSourcePill } from '../../components/scorecard/ScorecardSourcePill';
import {
  listAgentScorecards,
  attachScorecard,
  detachScorecard,
  listScorecards,
  type AgentScorecardAttachment,
  type ScorecardWithPill,
} from '../../lib/api/scorecards';
import { getUserRole } from '../../lib/auth';

const FREQUENCY_OPTIONS: Array<{ value: 'off' | 'q1' | 'q2' | 'q3'; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'q1', label: '25%' },
  { value: 'q2', label: '50%' },
  { value: 'q3', label: '75%' },
];

interface AgentEditScorecardTabProps {
  agentId: string;
  /** Viewer scope determines lock-icon and read-only behaviour at subaccount level (§12.5). */
  viewerScope: 'org_admin' | 'subaccount';
  canManage: boolean;
}

export function AgentEditScorecardTab({
  agentId,
  viewerScope,
  canManage,
}: AgentEditScorecardTabProps) {
  const isStaff = getUserRole() === 'system_admin';
  const [attachments, setAttachments] = useState<AgentScorecardAttachment[] | null>(null);
  const [library, setLibrary] = useState<ScorecardWithPill[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [detaching, setDetaching] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError(null);
    try {
      const [atts, cards] = await Promise.all([
        listAgentScorecards(agentId),
        canManage ? listScorecards() : Promise.resolve([]),
      ]);
      setAttachments(atts);
      setLibrary(cards);
    } catch (e: unknown) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [agentId, canManage]);

  useEffect(() => { void load(); }, [load]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleDetach(scorecardId: string) {
    setDetaching(scorecardId);
    try {
      await detachScorecard(agentId, scorecardId);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setDetaching(null);
    }
  }

  async function handleAttach(scorecardId: string) {
    setAttaching(true);
    try {
      await attachScorecard(agentId, scorecardId, 'q2');
      setShowPicker(false);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setAttaching(false);
    }
  }

  if (error) {
    return <ErrorState error={error} retry={() => { setError(null); void load(); }} />;
  }

  if (attachments === null) {
    return <div className="text-sm text-slate-500 py-6">Loading...</div>;
  }

  const attachedIds = new Set(attachments.map((a) => a.scorecardId));
  const unattached = library.filter((c) => !attachedIds.has(c.id));

  return (
    <div className="space-y-4">
      {attachments.length === 0 ? (
        <EmptyState
          title="No scorecards attached"
          body="Attach a scorecard to start evaluating this agent's quality."
          primaryAction={canManage ? { label: 'Attach scorecard', onClick: () => setShowPicker(true) } : undefined}
        />
      ) : (
        <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
          {attachments.map((att) => {
            const isRequired = att.attachAuthority === 'system_mandatory' || att.attachAuthority === 'org_mandatory';
            const isReadOnly = isRequired && viewerScope === 'subaccount';
            const isExpanded = expandedIds.has(att.id);

            return (
              <div key={att.id} className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {isRequired && (
                      <svg className="w-4 h-4 text-slate-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                      </svg>
                    )}
                    <span className="text-sm font-medium text-slate-900 truncate">
                      {att.scorecard?.name ?? att.scorecardId}
                    </span>
                    {isRequired && (
                      <span className="text-xs text-slate-500">Required</span>
                    )}
                    {att.scorecard && (
                      <ScorecardSourcePill
                        scope={att.scorecard.scopeType}
                        viewerScope={viewerScope}
                        precomputed={att.scorecard.sourcePill}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {isRequired && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(att.id)}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    )}
                    {!isReadOnly && canManage && (
                      <>
                        <select
                          value={att.gradingFrequency}
                          onChange={async (e) => {
                            // Frequency update: detach + re-attach with new frequency
                            const freq = e.target.value as 'off' | 'q1' | 'q2' | 'q3';
                            try {
                              await detachScorecard(agentId, att.scorecardId);
                              await attachScorecard(agentId, att.scorecardId, freq);
                              await load();
                            } catch {
                              await load();
                            }
                          }}
                          className="text-xs border border-slate-200 rounded px-2 py-1 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        >
                          {FREQUENCY_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {!isRequired && (
                          <button
                            type="button"
                            onClick={() => handleDetach(att.scorecardId)}
                            disabled={detaching === att.scorecardId}
                            className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
                          >
                            Remove
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {isExpanded && att.scorecard && (
                  <div className="mt-3 pl-6 text-sm text-slate-500 space-y-1">
                    {att.scorecard.description && <p>{att.scorecard.description}</p>}
                    {att.scorecard.qualityChecks.length > 0 && (
                      <ul className="list-disc list-inside text-xs text-slate-400 space-y-0.5">
                        {att.scorecard.qualityChecks.map((qc) => (
                          <li key={qc.slug}>
                            {qc.name}
                            {isStaff && qc.kind && qc.kind !== 'semantic' && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 font-medium">
                                {qc.kind}{qc.validatorSlug ? `: ${qc.validatorSlug}` : ''}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canManage && !showPicker && attachments.length > 0 && (
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
        >
          + Attach scorecard
        </button>
      )}

      {showPicker && (
        <div className="border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Select scorecard</span>
            <button
              type="button"
              onClick={() => setShowPicker(false)}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Cancel
            </button>
          </div>
          {unattached.length === 0 ? (
            <p className="text-sm text-slate-400">All scorecards are already attached.</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {unattached.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  disabled={attaching}
                  onClick={() => handleAttach(card.id)}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 rounded hover:bg-slate-50 disabled:opacity-40"
                >
                  <span className="text-sm text-slate-800">{card.name}</span>
                  {card.sourcePill && (
                    <ScorecardSourcePill
                      scope={card.scopeType}
                      viewerScope="org_admin"
                      precomputed={card.sourcePill}
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

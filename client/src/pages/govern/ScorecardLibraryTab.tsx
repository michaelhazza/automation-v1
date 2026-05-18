// client/src/pages/govern/ScorecardLibraryTab.tsx
// Scorecard library tab within QualityPage.
// Trust & Verification Layer spec §12.1, §14.

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { ScorecardSourcePill } from '../../components/scorecard/ScorecardSourcePill';
import { listScorecards, type ScorecardWithPill } from '../../lib/api/scorecards';
import { getUserRole } from '../../lib/auth';

function canManageScorecards(): boolean {
  const role = getUserRole();
  return role === 'org_admin' || role === 'system_admin';
}

export function ScorecardLibraryTab() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<ScorecardWithPill[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const canManage = canManageScorecards();
  const isStaff = getUserRole() === 'system_admin';

  useEffect(() => {
    setCards(null);
    setError(null);
    listScorecards()
      .then(setCards)
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, []);

  if (error) {
    return <ErrorState error={error} retry={() => setError(null)} />;
  }

  if (cards === null) {
    return <div className="text-sm text-slate-500 py-8 px-6">Loading...</div>;
  }

  if (cards.length === 0) {
    return (
      <EmptyState
        title="No scorecards yet"
        body="Create a scorecard to start evaluating agent quality."
        primaryAction={
          canManage
            ? { label: 'Create scorecard', onClick: () => navigate('/quality/scorecards/create') }
            : undefined
        }
      />
    );
  }

  return (
    <div className="divide-y divide-slate-100">
      {canManage && (
        <div className="px-6 py-3 flex justify-end">
          <button
            type="button"
            onClick={() => navigate('/quality/scorecards/create')}
            className="bg-indigo-600 text-white px-3 py-1.5 rounded text-sm hover:bg-indigo-700 transition-colors"
          >
            Create scorecard
          </button>
        </div>
      )}
      {cards.map((card) => (
        <div key={card.id} className="px-6 py-4 flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-slate-900 truncate">{card.name}</span>
              <ScorecardSourcePill
                scope={card.scopeType}
                viewerScope="org_admin"
                precomputed={card.sourcePill}
              />
              {card.shareWithSubaccounts && (
                <span className="text-xs text-slate-500">Shared with workspaces</span>
              )}
            </div>
            {card.description && (
              <p className="text-sm text-slate-500 mt-0.5 truncate">{card.description}</p>
            )}
            <p className="text-xs text-slate-400 mt-1">
              {card.qualityChecks.length} quality check{card.qualityChecks.length !== 1 ? 's' : ''}
              {isStaff && card.qualityChecks.some((qc) => qc.kind && qc.kind !== 'semantic') && (
                <span className="ml-2 px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 font-medium">
                  {card.qualityChecks.filter((qc) => qc.kind && qc.kind !== 'semantic').length} validator{card.qualityChecks.filter((qc) => qc.kind && qc.kind !== 'semantic').length !== 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

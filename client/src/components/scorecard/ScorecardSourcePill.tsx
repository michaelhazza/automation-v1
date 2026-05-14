// client/src/components/scorecard/ScorecardSourcePill.tsx
// Compressed source-pill label for a scorecard.
// Trust & Verification Layer spec §6.8, §12.1, §14.

import React from 'react';

// Mirror of server scorecardServicePure.compressSourcePill — kept client-side
// so the component renders without a round-trip and is deterministic for tests.
function compressSourcePill(
  scope: 'system' | 'org' | 'subaccount',
  viewerScope: 'org_admin' | 'subaccount',
): 'system' | 'organisation' | 'this_subaccount' | 'platform' | 'custom' {
  if (scope === 'subaccount') return 'this_subaccount';
  if (scope === 'system') return viewerScope === 'org_admin' ? 'system' : 'platform';
  return viewerScope === 'org_admin' ? 'organisation' : 'custom';
}

const PILL_LABEL: Record<string, string> = {
  system:          'System',
  organisation:    'Organisation',
  this_subaccount: 'This workspace',
  platform:        'Platform',
  custom:          'Custom',
};

const PILL_CLASS: Record<string, string> = {
  system:          'bg-violet-100 text-violet-700',
  organisation:    'bg-blue-100 text-blue-700',
  this_subaccount: 'bg-slate-100 text-slate-600',
  platform:        'bg-indigo-100 text-indigo-700',
  custom:          'bg-teal-100 text-teal-700',
};

interface ScorecardSourcePillProps {
  /** The scorecard's scope_type column value. */
  scope: 'system' | 'org' | 'subaccount';
  /** The current viewer's scope. */
  viewerScope: 'org_admin' | 'subaccount';
  /** If provided, shown in tooltip as "Created by <ownerName>". */
  ownerName?: string;
  /** Pre-computed pill value from the server (skips client-side compression). */
  precomputed?: 'system' | 'organisation' | 'this_subaccount' | 'platform' | 'custom';
}

export function ScorecardSourcePill({
  scope,
  viewerScope,
  ownerName,
  precomputed,
}: ScorecardSourcePillProps) {
  const pill = precomputed ?? compressSourcePill(scope, viewerScope);
  const label = PILL_LABEL[pill] ?? pill;
  const cls = PILL_CLASS[pill] ?? 'bg-slate-100 text-slate-600';
  const tooltip = ownerName
    ? pill === 'this_subaccount'
      ? 'Created in this workspace'
      : `Created by ${ownerName}`
    : undefined;

  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}
      title={tooltip}
    >
      {label}
    </span>
  );
}

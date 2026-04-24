/**
 * NeedsAttentionRow.tsx
 *
 * Pure presentational row for the Needs Attention list in ClientPulse.
 * Spec: ClientPulse UI simplification §3.2, §3.6, §3.7
 *
 * No state, no effects, no data fetching.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import SparklineChart from './SparklineChart';

// Mirror of server/services/clientPulseHighRiskService.ts ClientRow.
// Kept intentionally inline so this component has zero server imports.
type ApiBand = 'critical' | 'at_risk' | 'watch' | 'healthy';

interface ClientRow {
  subaccountId: string;
  subaccountName: string;
  healthScore: number;
  healthBand: ApiBand;
  healthScoreDelta7d: number;
  sparklineWeekly: number[];
  lastActionText: string | null;
  hasPendingIntervention: boolean;
  drilldownUrl: string;
}

export interface NeedsAttentionRowProps {
  client: ClientRow;
}

// §3.7 — Tailwind class mappings, no literal hex/rgb values
const BAND_COLOURS: Record<ApiBand, string> = {
  critical: 'text-red-600',
  at_risk:  'text-rose-500',
  watch:    'text-amber-500',
  healthy:  'text-emerald-500',
};

const BAND_DOT_BG: Record<ApiBand, string> = {
  critical: 'bg-red-600',
  at_risk:  'bg-rose-500',
  watch:    'bg-amber-500',
  healthy:  'bg-emerald-500',
};

export function NeedsAttentionRow({ client }: NeedsAttentionRowProps): React.ReactElement {
  const colour = BAND_COLOURS[client.healthBand];
  const dotBg  = BAND_DOT_BG[client.healthBand];

  const delta = client.healthScoreDelta7d;
  const deltaArrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '—';
  const deltaDisplay = delta !== 0
    ? `${deltaArrow}${Math.abs(delta)} / 7d`
    : `${deltaArrow} / 7d`;

  return (
    <Link
      to={client.drilldownUrl}
      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors no-underline text-inherit"
    >
      {/* Dot */}
      <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${dotBg}`} aria-hidden="true" />

      {/* Name + PENDING chip */}
      <span className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-[14px] font-medium text-slate-800 truncate">
          {client.subaccountName}
        </span>
        {client.hasPendingIntervention && (
          <span
            aria-label="Pending intervention"
            className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-100 text-rose-700 leading-none"
          >
            ⚑ PENDING
          </span>
        )}
      </span>

      {/* Sparkline */}
      <span className="shrink-0">
        <SparklineChart values={client.sparklineWeekly} colour={colour} />
      </span>

      {/* Score + delta */}
      <span className="shrink-0 flex flex-col items-end w-16">
        <span className={`text-[20px] font-bold leading-none ${colour}`}>
          {client.healthScore}
        </span>
        <span className={`text-[11px] leading-none mt-0.5 ${colour}`}>
          {deltaDisplay}
        </span>
      </span>

      {/* Last action */}
      <span className="shrink-0 text-[12px] text-slate-500 w-40 text-right truncate">
        {client.lastActionText ?? '—'}
      </span>

      {/* Chevron */}
      <span className="shrink-0 text-slate-400" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </Link>
  );
}

export default NeedsAttentionRow;

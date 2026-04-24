import OutcomeBadge, { type OutcomeBadge as OutcomeBadgeShape } from './OutcomeBadge';

// Client-side derivation mirror of server/services/drilldownOutcomeBadgePure.ts.
// Kept in sync manually — the server route returns raw (status, actionType, outcome);
// the client derives the badge shape. Pure test in server-side already covers the rules.
const BAND_ORDER: Record<string, number> = { healthy: 0, watch: 1, atRisk: 2, critical: 3 };

function deriveBadge(
  action: { status: string; actionType: string },
  outcome: { bandBefore: string | null; bandAfter: string | null; scoreDelta: number | null; executionFailed: boolean } | null,
): OutcomeBadgeShape {
  if (action.status === 'failed' || action.status === 'rejected' || action.status === 'blocked') return { kind: 'failed' };
  if (outcome?.executionFailed) return { kind: 'failed' };
  if (!outcome) {
    if (action.status === 'proposed' || action.status === 'pending_approval' || action.status === 'approved' || action.status === 'executing') {
      return { kind: 'pending', reason: 'window_open' };
    }
    if (action.actionType === 'notify_operator') return { kind: 'pending', reason: 'operator_alert_no_signal' };
    return { kind: 'pending', reason: 'no_snapshot' };
  }
  const fromBand = outcome.bandBefore;
  const toBand = outcome.bandAfter;
  if (fromBand && toBand && fromBand !== toBand) {
    const fromRank = BAND_ORDER[fromBand] ?? 0;
    const toRank = BAND_ORDER[toBand] ?? 0;
    if (toRank < fromRank) return { kind: 'band_improved', fromBand, toBand };
    if (toRank > fromRank) return { kind: 'band_worsened', fromBand, toBand };
  }
  const delta = outcome.scoreDelta ?? 0;
  if (delta > 0) return { kind: 'score_improved', delta };
  if (delta < 0) return { kind: 'score_worsened', delta };
  return { kind: 'neutral' };
}

export interface InterventionRow {
  actionId: string;
  actionType: string;
  proposedAt: string;
  executedAt: string | null;
  status: string;
  outcome: {
    bandBefore: string | null;
    bandAfter: string | null;
    scoreDelta: number | null;
    executionFailed: boolean;
  } | null;
}

export default function InterventionHistoryTable({ rows, onRowClick }: { rows: InterventionRow[]; onRowClick?: (row: InterventionRow) => void }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-[13px] font-bold uppercase text-slate-500 mb-3">Intervention history</h3>
      {rows.length === 0 ? (
        <p className="text-[13px] text-slate-500">No interventions proposed yet for this client.</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase text-slate-400">
              <th className="pb-2">Proposed</th>
              <th className="pb-2">Type</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.actionId}
                onClick={() => onRowClick?.(r)}
                className={`border-t border-slate-100 ${onRowClick ? 'hover:bg-slate-50 cursor-pointer' : ''}`}
              >
                <td className="py-1.5 text-slate-600">{new Date(r.proposedAt).toLocaleString()}</td>
                <td className="py-1.5 font-mono text-[12px] text-slate-700">{r.actionType}</td>
                <td className="py-1.5">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-600">{r.status}</span>
                </td>
                <td className="py-1.5"><OutcomeBadge badge={deriveBadge(r, r.outcome)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

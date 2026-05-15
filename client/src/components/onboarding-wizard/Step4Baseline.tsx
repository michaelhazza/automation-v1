import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { logAndSwallow } from '../../lib/silentCatchHelper';
import { isWizardCompletable } from '../../../../shared/schemas/subaccount';
import { ArtefactStatusDot } from './atoms/ArtefactStatusDot';
import type { SubaccountRow, SubaccountBaselineState } from './types';

export function Step4Baseline({ onComplete }: { onComplete: () => void }) {
  const [rows, setRows] = useState<SubaccountBaselineState[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { data } = await api.get<{ id: string; name: string }[]>('/api/subaccounts');
        const subs: SubaccountRow[] = Array.isArray(data) ? data : [];

        const states: SubaccountBaselineState[] = subs.map((s) => ({
          subaccountId: s.id,
          name: s.name,
          artefactStatus: null,
          runId: null,
          loading: true,
        }));
        if (!cancelled) setRows(states);

        // Fetch artefact status + active run for each subaccount in parallel
        await Promise.all(
          subs.map(async (sub, idx) => {
            try {
              const [statusRes, runsRes] = await Promise.all([
                api.get<{ status: import('../../../../shared/schemas/subaccount').BaselineArtefactsStatus }>(`/api/subaccounts/${sub.id}/baseline-artefacts-status`),
                api.get<{ runs: { id: string; workflowSlug?: string | null; status: string }[] }>(
                  `/api/subaccounts/${sub.id}/workflow-runs`,
                ),
              ]);
              const artefactStatus = statusRes.data.status;
              // Find the most recent non-terminal baseline-artefacts-capture run
              const ACTIVE_STATUSES = ['pending', 'running', 'awaiting_input', 'awaiting_approval'];
              const activeRun = runsRes.data.runs?.find(
                (r) => r.workflowSlug === 'baseline-artefacts-capture' && ACTIVE_STATUSES.includes(r.status),
              ) ?? null;
              if (!cancelled) {
                setRows((prev) => {
                  const next = [...prev];
                  next[idx] = { ...next[idx], artefactStatus, runId: activeRun?.id ?? null, loading: false };
                  return next;
                });
              }
            } catch {
              if (!cancelled) {
                setRows((prev) => {
                  const next = [...prev];
                  next[idx] = { ...next[idx], loading: false };
                  return next;
                });
              }
            }
          }),
        );
      } catch {
        // Non-blocking: let the user still proceed
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const allCompletable = rows.length > 0 && rows.every((r) => {
    if (!r.artefactStatus) return false;
    return isWizardCompletable(r.artefactStatus);
  });

  if (loading && rows.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-2">Tell us about your clients</h2>
      <p className="text-slate-500 text-[14px] mb-6 leading-relaxed">
        A few details help our agents personalise every response. Fill in what you can now, and skip what you can do later.
      </p>

      <div className="space-y-3 mb-6">
        {rows.map((row) => {
          const t1 = row.artefactStatus?.tier1;
          const t2 = row.artefactStatus?.tier2;
          const t3 = row.artefactStatus?.tier3;
          const runHref = row.runId ? `/sub/${row.subaccountId}/runs/${row.runId}` : null;

          return (
            <div key={row.subaccountId} className="border border-slate-200 rounded-xl px-5 py-4 bg-white">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[13.5px] font-semibold text-slate-900 truncate">{row.name}</p>
                {runHref ? (
                  <a
                    href={runHref}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] text-indigo-600 hover:text-indigo-800 font-medium shrink-0 ml-3"
                    onClick={() => {
                      // Emit started telemetry for the first incomplete artefact
                      const firstIncomplete =
                        t1?.brand_identity.status !== 'completed' ? 'brand_identity'
                        : t1?.voice_tone.status !== 'completed' ? 'voice_tone'
                        : t2?.offer_positioning.status !== 'completed' ? 'offer_positioning'
                        : t2?.audience_icp.status !== 'completed' ? 'audience_icp'
                        : t3?.operating_constraints.status !== 'completed' ? 'operating_constraints'
                        : 'proof_library';
                      api.post(`/api/subaccounts/${row.subaccountId}/baseline-artefacts/started`, { slug: `baseline.${firstIncomplete}` }).catch(logAndSwallow('OnboardingWizardPage: baseline artefact started telemetry', { severity: 'critical' }));
                    }}
                  >
                    Start capture
                  </a>
                ) : (
                  <span className="text-[12px] text-slate-400 shrink-0 ml-3">No active run</span>
                )}
              </div>

              {row.loading ? (
                <div className="h-4 w-32 rounded bg-slate-100 animate-pulse" />
              ) : row.artefactStatus ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <ArtefactStatusDot status={t1?.brand_identity.status ?? 'not_started'} />
                    <span className="text-[11px] text-slate-500">Brand</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ArtefactStatusDot status={t1?.voice_tone.status ?? 'not_started'} />
                    <span className="text-[11px] text-slate-500">Voice</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ArtefactStatusDot status={t2?.offer_positioning.status ?? 'not_started'} />
                    <span className="text-[11px] text-slate-500">Offer</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ArtefactStatusDot status={t2?.audience_icp.status ?? 'not_started'} />
                    <span className="text-[11px] text-slate-500">Audience</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ArtefactStatusDot status={t3?.operating_constraints.status ?? 'not_started'} />
                    <span className="text-[11px] text-slate-400">Constraints</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ArtefactStatusDot status={t3?.proof_library.status ?? 'not_started'} />
                    <span className="text-[11px] text-slate-400">Proof</span>
                  </div>
                </div>
              ) : (
                <p className="text-[12px] text-slate-400">Could not load status.</p>
              )}
            </div>
          );
        })}

        {rows.length === 0 && !loading && (
          <p className="text-[13px] text-slate-400 text-center py-4">No clients found. Add clients in the previous step.</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setRefreshKey((k) => k + 1)}
        className="text-[12px] text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer mb-5 block"
      >
        Refresh status
      </button>

      <button
        onClick={onComplete}
        disabled={!allCompletable}
        className="w-full flex items-center justify-center gap-2 px-5 py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-[15px] font-semibold rounded-xl transition-colors"
      >
        Continue to done
      </button>

      {!allCompletable && (
        <p className="text-[12px] text-slate-400 text-center mt-3">
          Complete Brand, Voice, Offer, and Audience for all clients to continue.
        </p>
      )}

    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { toast } from 'sonner';
import type { OwedOnboardingRow } from './types';

const ONBOARDING_STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  pending: { dot: 'bg-slate-400', label: 'Pending' },
  running: { dot: 'bg-indigo-500 animate-pulse', label: 'Running' },
  awaiting_input: { dot: 'bg-amber-500', label: 'Awaiting input' },
  awaiting_approval: { dot: 'bg-amber-500', label: 'Awaiting approval' },
  completed: { dot: 'bg-emerald-500', label: 'Completed' },
  completed_with_errors: { dot: 'bg-yellow-500', label: 'Completed with errors' },
  failed: { dot: 'bg-red-500', label: 'Failed' },
  cancelling: { dot: 'bg-slate-400', label: 'Cancelling' },
  cancelled: { dot: 'bg-slate-400', label: 'Cancelled' },
  partial: { dot: 'bg-yellow-500', label: 'Partial' },
};

export function OnboardingTab({ subaccountId }: { subaccountId: string }) {
  const [rows, setRows] = useState<OwedOnboardingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [startingSlug, setStartingSlug] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.get<{ owed: OwedOnboardingRow[] }>(
        `/api/subaccounts/${subaccountId}/onboarding/owed`,
      );
      setRows(res.data.owed);
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? e?.message ?? 'Failed to load onboarding workflows');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // reason: `load` is an inline async function that closes over state setters; only the trigger key (subaccountId) should re-run this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subaccountId]);

  const handleStart = async (slug: string) => {
    setStartingSlug(slug);
    try {
      const res = await api.post<{ runId: string }>(
        `/api/subaccounts/${subaccountId}/onboarding/start`,
        { slug, runMode: 'supervised' },
      );
      toast.success(`Started ${slug}`);
      // Navigate to the new run's modal page.
      window.location.href = `/sub/${subaccountId}/runs/${res.data.runId}`;
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to start run');
    } finally {
      setStartingSlug(null);
    }
  };

  if (loading) {
    return <div className="py-8 text-sm text-slate-500">Loading onboarding workflows...</div>;
  }
  if (err) {
    return <div className="py-4 text-sm text-red-600">{err}</div>;
  }

  const completedCount = rows.filter((r) => r.latestRun?.status === 'completed').length;

  return (
    <div className="space-y-5 max-w-[720px]">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[18px] font-semibold text-slate-800 m-0">Onboarding</h2>
        <div className="text-[13px] text-slate-500">
          Status: <span className="font-medium text-slate-700">{completedCount} of {rows.length} workflows complete</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-10 text-center text-sm text-slate-500">
          No onboarding workflows configured for this sub-account's module set.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {rows.map((row, idx) => {
            const status = row.latestRun?.status ?? null;
            const style = status ? ONBOARDING_STATUS_STYLES[status] : null;
            const terminal = status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'completed_with_errors';
            return (
              <div
                key={row.slug}
                className={`flex items-center justify-between gap-4 px-4 py-3.5 ${
                  idx > 0 ? 'border-t border-slate-100' : ''
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                      style?.dot ?? 'bg-slate-300'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-slate-800 truncate">{row.slug}</div>
                    <div className="text-[12px] text-slate-500">
                      {style?.label ?? 'Not started'}
                    </div>
                  </div>
                </div>
                <div className="flex-shrink-0">
                  {row.latestRun ? (
                    <Link
                      to={`/sub/${subaccountId}/runs/${row.latestRun.id}`}
                      className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[13px] font-medium rounded-lg transition-colors inline-block"
                    >
                      {terminal ? 'Open run' : 'Open run'}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleStart(row.slug)}
                      disabled={startingSlug === row.slug}
                      className="btn btn-sm btn-primary"
                    >
                      {startingSlug === row.slug ? 'Starting...' : 'Start now'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-[13px] text-slate-600 leading-relaxed">
        <div className="font-semibold text-slate-700 mb-1">About onboarding workflows</div>
        onboarding workflows are the templates the agency runs the first time a sub-account is set up.
        They capture baseline facts, configure recurring schedules, and leave behind Memory Blocks the
        rest of the system reads. Edit the set per module on the Modules admin page.
      </div>
    </div>
  );
}

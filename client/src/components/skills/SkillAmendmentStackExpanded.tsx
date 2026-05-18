import { useState, useEffect } from 'react';
import api from '../../lib/api.js';
import type { AmendmentSkillDetail } from '../../../../shared/types/skillAmendments.js';
import { useListFreezes, useFreezesMutations } from '../../hooks/useSkillAmendmentFreezes.js';
import { SkillFreezeSwitch } from './SkillFreezeSwitch.js';
import { SkillStackHealthBadge } from './SkillStackHealthBadge.js';

// ── Kind tag ──────────────────────────────────────────────────────────────────

function KindTag({ kind }: { kind: AmendmentSkillDetail['kind'] }) {
  const styles: Record<string, string> = {
    instruction_extension: 'bg-green-50 text-green-700',
    example:               'bg-blue-50 text-blue-700',
    guardrail:             'bg-red-50 text-red-700',
    context_fact:          'bg-amber-50 text-amber-700',
    exception:             'bg-slate-100 text-slate-600',
  };
  const labels: Record<string, string> = {
    instruction_extension: 'Add context',
    example:               'Add example',
    guardrail:             'Guardrail',
    context_fact:          'Context',
    exception:             'Exception',
  };
  return (
    <span
      className={`inline-flex items-center shrink-0 px-2 py-0.5 rounded-md text-[11px] font-semibold ${styles[kind] ?? 'bg-slate-100 text-slate-600'}`}
    >
      {labels[kind] ?? kind}
    </span>
  );
}

// ── Amendment item ────────────────────────────────────────────────────────────

function AmendmentItem({
  amendment,
  subaccountId,
  onRetired,
}: {
  amendment: AmendmentSkillDetail;
  subaccountId: string;
  onRetired: () => void;
}) {
  const [retiring, setRetiring] = useState(false);

  const handleRetire = async () => {
    if (retiring) return;
    setRetiring(true);
    try {
      await api.post(
        `/api/subaccounts/${subaccountId}/skill-amendments/${amendment.id}/retire`,
        { retirementReason: 'graceful' },
      );
      onRetired();
    } catch {
      // noop — user can retry
    } finally {
      setRetiring(false);
    }
  };

  const addedBy = amendment.source === 'operator_manual' ? 'you' : 'agent';
  const addedAt = amendment.activatedAt
    ? new Date(amendment.activatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : new Date(amendment.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="flex items-start gap-2.5 py-2.5 border-b border-slate-50 last:border-0">
      <KindTag kind={amendment.kind} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-slate-700 leading-snug">
          {amendment.body.slice(0, 200)}
          {amendment.body.length > 200 && '…'}
        </div>
        <div className="text-[11.5px] text-slate-400 mt-1">
          Added by {addedBy} · {addedAt}
        </div>
      </div>
      {amendment.status === 'accepted' && (
        <button
          type="button"
          disabled={retiring}
          onClick={handleRetire}
          className="shrink-0 text-[11px] text-slate-400 hover:text-red-600 bg-transparent border-0 cursor-pointer disabled:cursor-not-allowed px-0"
        >
          Retire
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface SkillAmendmentStackExpandedProps {
  skillId: string;
  subaccountId: string;
  isCustom: boolean;
  skillBody?: string | null;
}

export function SkillAmendmentStackExpanded({
  skillId,
  subaccountId,
  isCustom,
  skillBody,
}: SkillAmendmentStackExpandedProps) {
  const [amendments, setAmendments] = useState<AmendmentSkillDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const { freezes, refetch: refetchFreezes } = useListFreezes(subaccountId);
  const mutations = useFreezesMutations(subaccountId, refetchFreezes);

  const fetchAmendments = () => {
    if (isCustom) return;
    setLoading(true);
    setError(null);
    let cancelled = false;
    api
      .get<AmendmentSkillDetail[]>(
        `/api/subaccounts/${subaccountId}/skills/${skillId}/amendments`,
      )
      .then(({ data }) => {
        if (!cancelled) setAmendments(data.filter((a) => a.status === 'accepted'));
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load improvements');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  };

  useEffect(() => {
    const cleanup = fetchAmendments();
    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillId, subaccountId, isCustom]);

  // ── Custom skill — no amendments panel ───────────────────────────────────

  if (isCustom) {
    return (
      <div className="px-6 py-5 bg-slate-50 border-t border-slate-100">
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full bg-green-50 text-green-700">
            Subaccount
          </span>
          <span className="text-[12.5px] text-slate-500">This skill belongs to this workspace. Edit it directly.</span>
        </div>
        {skillBody !== undefined && (
          <>
            <div className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Instructions
            </div>
            <textarea
              readOnly
              className="w-full min-h-[90px] px-3 py-2.5 border border-slate-200 rounded-lg text-[13px] text-slate-700 leading-relaxed resize-y bg-white focus:outline-none"
              defaultValue={skillBody ?? ''}
            />
          </>
        )}
        <p className="text-[11.5px] text-slate-400 mt-3 mb-0">
          Custom skills are edited directly. Automatic improvement suggestions apply only to inherited skills.
        </p>
      </div>
    );
  }

  // ── Inherited skill — amendment stack ────────────────────────────────────

  const PREVIEW_COUNT = 5;
  const visibleAmendments = showAll ? amendments : amendments.slice(0, PREVIEW_COUNT);
  const agentCount = amendments.filter((a) => a.source === 'agent_proposed_from_failure').length;
  const operatorCount = amendments.filter((a) => a.source === 'operator_manual').length;

  return (
    <div className="px-6 py-5 bg-slate-50 border-t border-slate-100">

      {/* Active improvements summary */}
      <div className="flex items-center justify-between mb-2.5">
        <div>
          <div className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
            Active improvements
          </div>
          {amendments.length > 0 && (
            <div className="text-[12.5px] text-slate-500">
              {agentCount > 0 && `${agentCount} added by the agent`}
              {agentCount > 0 && operatorCount > 0 && ', '}
              {operatorCount > 0 && `${operatorCount} added by you`}
            </div>
          )}
        </div>
      </div>

      {/* Amendment list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="text-[12.5px] text-red-600">{error}</div>
      ) : amendments.length === 0 ? (
        <div className="text-[13px] text-slate-400 py-2">
          No active improvements for this skill.
        </div>
      ) : (
        <>
          <div className="bg-white border border-slate-100 rounded-lg px-3 py-1">
            {visibleAmendments.map((a) => (
              <AmendmentItem
                key={a.id}
                amendment={a}
                subaccountId={subaccountId}
                onRetired={fetchAmendments}
              />
            ))}
          </div>
          {amendments.length > PREVIEW_COUNT && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-2 text-[12px] text-indigo-600 hover:text-indigo-800 bg-transparent border-0 cursor-pointer px-0"
            >
              {showAll
                ? 'Show fewer'
                : `Show all ${amendments.length} improvements`}
            </button>
          )}
        </>
      )}

      <hr className="border-slate-100 my-4" />

      {/* Pause toggle */}
      <SkillFreezeSwitch
        skillId={skillId}
        freezes={freezes}
        mutations={mutations}
      />

      <SkillStackHealthBadge subaccountId={subaccountId} skillId={skillId} />
    </div>
  );
}

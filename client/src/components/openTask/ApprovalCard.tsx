import { useEffect, useState } from 'react';
import api from '../../lib/api';
import type { ApprovalGateProjection } from '../../../../shared/types/taskProjection';

interface ApprovalCardProps { gate: ApprovalGateProjection; taskId: string }

export function ApprovalCard({ gate, taskId }: ApprovalCardProps) {
  const [poolMembers, setPoolMembers] = useState<string[] | null>(null);

  useEffect(() => {
    if (!gate.poolFingerprint || gate.status === 'decided') return;
    let cancelled = false;
    void api.get(`/api/tasks/${taskId}/gates/${gate.gateId}`)
      .then(({ data }: { data: { approverPool?: string[] } }) => {
        if (cancelled) return;
        setPoolMembers(data.approverPool ?? []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn('ApprovalCard.pool_fetch_failed', {
          taskId,
          gateId: gate.gateId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => { cancelled = true; };
  }, [gate.poolFingerprint, gate.gateId, taskId, gate.status]);

  const displayCount = poolMembers !== null ? poolMembers.length : gate.poolSize;

  return (
    <div className={`rounded-lg border px-4 py-3 mb-2 ${gate.status === 'decided' ? 'border-slate-200 bg-slate-50' : 'border-amber-300 bg-amber-50'}`}>
      <p className="text-[13px] font-semibold text-slate-800">
        {gate.status === 'decided' ? `Approval ${gate.decision}` : 'Awaiting approval'}
      </p>
      {gate.status === 'decided' && gate.decidedBy && (
        <p className="text-[11px] text-slate-500 mt-0.5">By {gate.decidedBy.slice(0, 8)}</p>
      )}
      <p className="text-[11px] text-slate-400 mt-0.5">Pool: {displayCount} reviewer{displayCount !== 1 ? 's' : ''}</p>
    </div>
  );
}

import { useEffect, useState } from 'react';
import api from '../../lib/api';
import type { ApprovalGateProjection } from '../../../../shared/types/taskProjection';

interface ApprovalCardProps { gate: ApprovalGateProjection; taskId: string }

export function ApprovalCard({ gate, taskId }: ApprovalCardProps) {
  const [poolMembers, setPoolMembers] = useState<string[] | null>(null);

  useEffect(() => {
    if (!gate.poolFingerprint || gate.status === 'decided') return;
    // TODO: B4 - gate snapshot endpoint needed (GET /api/tasks/:taskId/gates/:gateId)
    // No snapshot endpoint exists yet; rendering poolSize count only.
    void api.get(`/api/tasks/${taskId}/gates/${gate.gateId}`)
      .then(({ data }: { data: { approverPool?: string[] } }) => setPoolMembers(data.approverPool ?? []))
      .catch(() => {});
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

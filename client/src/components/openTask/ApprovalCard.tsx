import type { ApprovalGateProjection } from '../../../../shared/types/taskProjection';

interface ApprovalCardProps { gate: ApprovalGateProjection; taskId: string }

export function ApprovalCard({ gate }: ApprovalCardProps) {
  return (
    <div className={`rounded-lg border px-4 py-3 mb-2 ${gate.status === 'decided' ? 'border-slate-200 bg-slate-50' : 'border-amber-300 bg-amber-50'}`}>
      <p className="text-[13px] font-semibold text-slate-800">
        {gate.status === 'decided' ? `Approval ${gate.decision}` : 'Awaiting approval'}
      </p>
      {gate.status === 'decided' && gate.decidedBy && (
        <p className="text-[11px] text-slate-500 mt-0.5">By {gate.decidedBy.slice(0, 8)}</p>
      )}
      <p className="text-[11px] text-slate-400 mt-0.5">Pool: {gate.poolSize} reviewer{gate.poolSize !== 1 ? 's' : ''}</p>
    </div>
  );
}

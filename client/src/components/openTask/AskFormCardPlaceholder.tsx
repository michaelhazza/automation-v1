import type { AskGateProjection } from '../../../../shared/types/taskProjection';

export function AskFormCardPlaceholder({ gate }: { gate: AskGateProjection }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-[13px] font-semibold text-amber-800">Input required</p>
      <p className="text-[12px] text-amber-700 mt-1">{gate.prompt}</p>
    </div>
  );
}

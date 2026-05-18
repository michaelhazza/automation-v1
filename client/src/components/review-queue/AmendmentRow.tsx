import type { AmendmentListItem, BlastRadius, AmendmentKind } from '../../../../shared/types/skillAmendments.js';

interface Props {
  item: AmendmentListItem;
  onClick: () => void;
}

const BLAST_RADIUS_CLS: Record<BlastRadius, string> = {
  low:    'bg-green-100 text-green-700',
  medium: 'bg-amber-100 text-amber-700',
  high:   'bg-red-100 text-red-700',
};

const KIND_LABEL: Record<AmendmentKind, string> = {
  instruction_extension: 'Instruction',
  example:               'Example',
  guardrail:             'Guardrail',
  context_fact:          'Context',
  exception:             'Exception',
};

export function AmendmentRow({ item, onClick }: Props) {
  const proposed = new Date(item.createdAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className="px-4 py-3.5 bg-white border border-slate-200 rounded-[10px] mb-2 cursor-pointer transition-colors hover:border-violet-300 hover:shadow-sm"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-[13.5px] font-bold text-slate-900">{item.skillSlug}</span>
            <span className="inline-block px-2 py-0.5 rounded text-[11.5px] font-semibold bg-violet-100 text-violet-700">
              {KIND_LABEL[item.kind] ?? item.kind}
            </span>
          </div>
          {item.failureMode && (
            <p className="text-[13px] text-slate-600 m-0 leading-snug mb-1.5">{item.failureMode}</p>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${BLAST_RADIUS_CLS[item.blastRadiusEstimate]}`}>
              {item.blastRadiusEstimate} impact
            </span>
            <span className="text-[11.5px] text-slate-400">{proposed}</span>
          </div>
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#94a3b8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="flex-shrink-0 mt-1"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </div>
  );
}

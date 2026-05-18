import { Link } from 'react-router-dom';

interface RunTraceImprovementEventProps {
  skillSlug: string;
  kind: string;
  subaccountId?: string | null;
}

export function RunTraceImprovementEvent({
  skillSlug,
  kind,
  subaccountId,
}: RunTraceImprovementEventProps) {
  const reviewQueueHref = subaccountId
    ? `/admin/subaccounts/${subaccountId}/review-queue`
    : null;

  return (
    <div className="flex items-center justify-between gap-2.5 px-3.5 py-3 bg-violet-50 border border-violet-200 rounded-lg text-[12.5px] text-violet-900 leading-snug">
      <div className="flex-1">
        Agent proposed an improvement to the{' '}
        <strong>{skillSlug}</strong> skill
        {kind ? `: ${kindLabel(kind)}` : ''}.
      </div>
      {reviewQueueHref && (
        <Link
          to={reviewQueueHref}
          className="shrink-0 inline-flex items-center gap-1 font-semibold text-violet-700 px-3 py-1.5 rounded-lg border border-violet-200 bg-white hover:bg-violet-50 transition-colors no-underline text-[12.5px]"
        >
          Review
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6m0 0v6m0-6L10 14" />
          </svg>
        </Link>
      )}
    </div>
  );
}

function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    instruction_extension: 'add context',
    example:               'add example',
    guardrail:             'add guardrail',
    context_fact:          'add context fact',
    exception:             'add exception',
  };
  return labels[kind] ?? kind;
}

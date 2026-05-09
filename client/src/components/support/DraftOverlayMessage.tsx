interface DraftOverlayMessageProps {
  status: string;
  proposedBodyText: string;
  createdAt: string;
}

export default function DraftOverlayMessage({ status, proposedBodyText, createdAt }: DraftOverlayMessageProps) {
  let indicator: React.ReactNode = null;

  if (status === 'dispatching') {
    indicator = (
      <span className="inline-flex items-center gap-1 text-xs text-indigo-600 font-medium">
        <span className="w-3 h-3 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
        Sending...
      </span>
    );
  } else if (status === 'needs_reconciliation') {
    indicator = (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        Needs reconciliation
      </span>
    );
  } else if (status === 'manually_marked_sent') {
    indicator = (
      <span className="inline-flex items-center gap-1 text-xs text-slate-500 font-medium">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Awaiting back-link
      </span>
    );
  }

  return (
    <div className="ml-8 rounded-lg border border-indigo-200 bg-indigo-50 p-3 mb-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-indigo-700">Draft reply</span>
        <div className="flex items-center gap-2">
          {indicator}
          <span className="text-xs text-slate-400">{new Date(createdAt).toLocaleString()}</span>
        </div>
      </div>
      <p className="text-sm text-slate-800 whitespace-pre-wrap">{proposedBodyText}</p>
    </div>
  );
}

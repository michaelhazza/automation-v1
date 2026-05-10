interface CollisionCalloutProps {
  message?: string;
  onOverride?: () => void;
  overriding?: boolean;
}

export default function CollisionCallout({ message, onOverride, overriding }: CollisionCalloutProps) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 mb-3">
      <div className="flex items-start gap-2">
        <svg className="w-4 h-4 mt-0.5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-red-700">Human collision detected</p>
          <p className="text-xs text-red-600 mt-0.5">{message ?? 'A human agent may have replied to this ticket. Review before sending.'}</p>
          {onOverride && (
            <button
              onClick={onOverride}
              disabled={overriding}
              className="mt-2 text-xs font-medium text-red-700 underline disabled:opacity-50"
            >
              {overriding ? 'Overriding...' : 'Override and approve anyway'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

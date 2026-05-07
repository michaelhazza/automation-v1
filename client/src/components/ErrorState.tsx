/**
 * ErrorState — inline error placeholder with optional retry action.
 *
 * Shows error.message as body in development only. In production, falls back
 * to the `body` prop or generic text to avoid leaking internals.
 *
 * Usage:
 *   <ErrorState error={err} retry={() => refetch()} />
 *   <ErrorState title="Failed to load" body="Check your connection and try again." />
 */

interface ErrorStateProps {
  title?: string;
  body?: string;
  error?: Error | null;
  retry?: () => void;
}

const ExclamationCircleIcon = () => (
  <svg
    className="h-12 w-12 text-red-400"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path strokeLinecap="round" d="M12 8v4M12 16h.01" />
  </svg>
);

export function ErrorState({
  title = 'Something went wrong',
  body,
  error,
  retry,
}: ErrorStateProps) {
  const isDev = import.meta.env.DEV;
  const displayBody = body ?? (isDev && error?.message ? error.message : undefined);

  return (
    <div className="text-center py-12 px-4">
      <div className="mx-auto mb-4 h-12 w-12 flex items-center justify-center">
        <ExclamationCircleIcon />
      </div>

      <h3 className="text-base font-medium text-slate-900 mb-1">{title}</h3>

      {displayBody && <p className="text-sm text-slate-500 mb-4">{displayBody}</p>}

      {retry && (
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={retry}
            className="bg-indigo-600 text-white px-4 py-2 rounded text-sm hover:bg-indigo-700 transition-colors"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

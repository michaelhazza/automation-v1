import { failedSourceNames } from './dashboardErrorBannerPure.js';

interface Props {
  errors: Record<string, boolean>;
  onRetry: () => void;
}

export function DashboardErrorBanner({ errors, onRetry }: Props) {
  const failed = failedSourceNames(errors);
  if (failed.length === 0) return null;
  return (
    <div role="alert" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="text-amber-800">Some data couldn't load: {failed.join(', ')}.</p>
      <button onClick={onRetry} className="mt-1 text-amber-700 underline text-sm">
        Retry
      </button>
    </div>
  );
}

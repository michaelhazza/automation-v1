// Modal shown when the operator session is unavailable and fallback is also
// absent (mockup r9). Two status cards; primary action: Add fallback API key.

interface OperatorUnavailableModalProps {
  hasSubscription: boolean;
  hasFallback: boolean;
  onAddFallback: () => void;
  onClose: () => void;
}

function StatusCard({
  ok,
  label,
  description,
}: {
  ok: boolean;
  label: string;
  description: string;
}) {
  return (
    <div
      className={`flex items-start gap-3 px-3 py-3 rounded-lg border ${
        ok
          ? 'bg-green-50 border-green-200'
          : 'bg-red-50 border-red-200'
      }`}
    >
      <span className={`mt-0.5 shrink-0 text-[14px] ${ok ? 'text-green-600' : 'text-red-500'}`}>
        {ok ? '✓' : '✗'}
      </span>
      <div>
        <div className={`text-[13px] font-semibold ${ok ? 'text-green-800' : 'text-red-800'}`}>
          {label}
        </div>
        <div className={`text-[12px] mt-0.5 ${ok ? 'text-green-700' : 'text-red-700'}`}>
          {description}
        </div>
      </div>
    </div>
  );
}

export function OperatorUnavailableModal({
  hasSubscription,
  hasFallback,
  onAddFallback,
  onClose,
}: OperatorUnavailableModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-semibold text-slate-900">Operator session unavailable</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer text-xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <p className="text-[13px] text-slate-600 mb-4">
          This task cannot run right now. Check the status of your connections below.
        </p>

        <div className="flex flex-col gap-2 mb-5">
          <StatusCard
            ok={hasSubscription}
            label="AI Subscription"
            description={
              hasSubscription
                ? 'Connected and usable.'
                : 'No usable AI Subscription connected to this workspace.'
            }
          />
          <StatusCard
            ok={hasFallback}
            label="Fallback API key"
            description={
              hasFallback
                ? 'Fallback key available.'
                : 'No fallback API key configured.'
            }
          />
        </div>

        {!hasFallback && (
          <button
            onClick={onAddFallback}
            className="w-full px-4 py-2 text-[13px] font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 cursor-pointer border-0 mb-2"
          >
            Add fallback API key
          </button>
        )}

        <button
          onClick={onClose}
          className="w-full px-4 py-2 text-[13px] font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer bg-white"
        >
          Close
        </button>
      </div>
    </div>
  );
}

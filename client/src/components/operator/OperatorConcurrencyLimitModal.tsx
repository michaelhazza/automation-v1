// Modal shown when the concurrency cap is reached (mockup r8).
// Lists the active sessions; each row has a Cancel button.

interface ActiveSession {
  agentRunId: string;
  taskTitle: string;
  startedAt: string | null;
}

interface OperatorConcurrencyLimitModalProps {
  cap: number;
  activeSessions: ActiveSession[];
  onCancel: (agentRunId: string) => void;
  onClose: () => void;
}

export function OperatorConcurrencyLimitModal({
  cap,
  activeSessions,
  onCancel,
  onClose,
}: OperatorConcurrencyLimitModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-semibold text-slate-900">Concurrency limit reached</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer text-xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <p className="text-[13px] text-slate-600 mb-4">
          Your workspace is running {activeSessions.length} of {cap} allowed concurrent operator
          sessions. Cancel one to start a new task.
        </p>

        <div className="flex flex-col gap-2 mb-5">
          {activeSessions.map((s) => (
            <div
              key={s.agentRunId}
              className="flex items-center justify-between px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-slate-800 truncate">{s.taskTitle}</div>
                {s.startedAt && (
                  <div className="text-[11px] text-slate-400">
                    Started {new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
              <button
                onClick={() => onCancel(s.agentRunId)}
                className="ml-3 shrink-0 px-3 py-1 text-[12px] border border-red-200 text-red-600 rounded hover:bg-red-50 cursor-pointer bg-transparent"
              >
                Cancel
              </button>
            </div>
          ))}
        </div>

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

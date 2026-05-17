import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RunRow, StepRun } from './types';
import { TERMINAL_RUN_STATUSES, STATUS_COLORS } from './types';
import ConfirmDialog from '../ConfirmDialog';
import { HelpHint } from '../ui/HelpHint';

interface RunHeaderProps {
  run: RunRow;
  definition: {
    slug?: string;
    name?: string;
    version?: number;
    steps?: { id: string }[];
  } | null;
  stepRuns: StepRun[];
  socketConnected: boolean;
  subaccountId: string;
  onCancel(): void | Promise<void>;
  onReplay(): void | Promise<void>;
  onPortalToggle(): void | Promise<void>;
}

export default function RunHeader({
  run,
  definition,
  stepRuns,
  socketConnected,
  subaccountId,
  onCancel,
  onReplay,
  onPortalToggle,
}: RunHeaderProps) {
  const [kebabOpen, setKebabOpen] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showReplayConfirm, setShowReplayConfirm] = useState(false);

  useEffect(() => {
    if (!kebabOpen) return;
    const close = () => setKebabOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [kebabOpen]);

  const WorkflowName = definition?.name ?? run.WorkflowSlug ?? 'Workflow run';
  const WorkflowVersion = definition?.version;
  const totalSteps = definition?.steps?.length ?? stepRuns.length;
  const completedSteps = stepRuns.filter((s) => s.status === 'completed').length;
  const runIsTerminal = TERMINAL_RUN_STATUSES.includes(run.status);
  const cancellable = !runIsTerminal && run.status !== 'cancelling';

  return (
    <header className="border-b border-slate-200 bg-white px-6 py-4">
      <Link
        to={subaccountId ? `/admin/subaccounts/${subaccountId}` : '/'}
        className="text-xs text-blue-600 hover:underline"
      >
        ← Back to subaccount
      </Link>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{WorkflowName}</h1>
            {WorkflowVersion !== undefined && (
              <span className="text-xs text-slate-400 font-mono">
                v{WorkflowVersion}
              </span>
            )}
            {run.isOnboardingRun && (
              <span className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                onboarding
              </span>
            )}
            {run.isPortalVisible && (
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                portal-visible
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            {completedSteps} / {totalSteps} steps · mode {run.runMode}
            {run.startedAt && (
              <>
                {' · started '}
                {new Date(run.startedAt).toLocaleString()}
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3 relative">
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              STATUS_COLORS[run.status] ?? 'bg-slate-100 text-slate-700'
            }`}
          >
            {run.status}
          </span>
          {!socketConnected && !runIsTerminal && (
            <span
              className="text-xs text-amber-700"
              title="Live updates disconnected — polling every 12 s"
            >
              ⚠ polling
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setKebabOpen((v) => !v);
            }}
            aria-haspopup="menu"
            aria-expanded={kebabOpen}
            className="w-8 h-8 rounded hover:bg-slate-100 flex items-center justify-center text-slate-500"
            title="More actions"
          >
            ⋮
          </button>
          {kebabOpen && (
            <div
              role="menu"
              className="absolute right-0 top-10 w-56 rounded-md border border-slate-200 bg-white shadow-lg z-10 text-sm"
              onClick={(e) => e.stopPropagation()}
            >
              {cancellable && (
                <button
                  role="menuitem"
                  onClick={() => {
                    setKebabOpen(false);
                    setShowCancelConfirm(true);
                  }}
                  className="block w-full text-left px-3 py-2 hover:bg-slate-50"
                >
                  Cancel run
                </button>
              )}
              <button
                role="menuitem"
                onClick={() => {
                  setKebabOpen(false);
                  setShowReplayConfirm(true);
                }}
                className="block w-full text-left px-3 py-2 hover:bg-slate-50"
              >
                Replay run
              </button>
              <div
                role="menuitem"
                className="flex items-center justify-between px-3 py-2 hover:bg-slate-50"
              >
                <button
                  type="button"
                  onClick={async () => {
                    setKebabOpen(false);
                    await onPortalToggle();
                  }}
                  className="flex-1 text-left bg-transparent border-0 cursor-pointer text-[13px] text-slate-800 p-0"
                >
                  {run.isPortalVisible ? 'Hide from portal' : 'Show on portal'}
                </button>
                {/* §G5.4 — HelpHint on the portal-visibility toggle, one
                    of the three surfaces this spec creates. Explains what
                    "portal-visible" means for end-client viewers. */}
                <HelpHint
                  text="When on, this run appears on the sub-account portal so your client can watch progress, approve steps, and see results. Turn off to keep an internal-only run."
                />
              </div>
              {definition?.slug && (
                <Link
                  role="menuitem"
                  to={`/system/workflow-studio?slug=${encodeURIComponent(definition.slug)}`}
                  className="block w-full text-left px-3 py-2 hover:bg-slate-50 border-t border-slate-100"
                  onClick={() => setKebabOpen(false)}
                >
                  Edit template in Studio
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
      {run.error && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {run.error}
          {run.failedDueToStepId && (
            <span className="text-red-600">
              {' — root cause: '}
              <code>{run.failedDueToStepId}</code>
            </span>
          )}
        </div>
      )}

      {showCancelConfirm && (
        <ConfirmDialog
          title="Cancel run"
          message="Cancel this Workflow run? In-flight steps will settle before the run moves to cancelled."
          confirmLabel="Cancel run"
          onConfirm={async () => {
            setShowCancelConfirm(false);
            await onCancel();
          }}
          onCancel={() => setShowCancelConfirm(false)}
        />
      )}
      {showReplayConfirm && (
        <ConfirmDialog
          title="Replay run"
          message="Start a fresh run using the same template version and inputs? Side-effecting steps marked irreversible will be skipped on replay."
          confirmLabel="Replay"
          onConfirm={async () => {
            setShowReplayConfirm(false);
            await onReplay();
          }}
          onCancel={() => setShowReplayConfirm(false)}
        />
      )}
    </header>
  );
}

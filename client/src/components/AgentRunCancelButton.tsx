// ---------------------------------------------------------------------------
// AgentRunCancelButton — best-effort stop for an in-flight agent run.
// ---------------------------------------------------------------------------
//
// Hides itself when the run is already terminal or already in 'cancelling'
// state. Server-side authorisation is enforced by requireOrgPermission
// (org.agents.edit) — the button only filters by run status, not by role,
// so all three role surfaces (system_admin, org_admin, subaccount admin)
// share the same component.
//
// POSTs to /api/agent-runs/:runId/cancel and notifies the parent via
// onCancelled() so the page can refetch.

import { useState } from 'react';
import { toast } from 'sonner';
import api from '../lib/api';
import {
  isTerminalRunStatus,
  type AgentRunStatus,
} from '../lib/runStatus';
import ConfirmDialog from './ConfirmDialog';

interface Props {
  runId: string;
  status: AgentRunStatus | string;
  onCancelled?: () => void;
  /** Visual variant — `inline` for table rows, `prominent` for page headers. */
  variant?: 'inline' | 'prominent';
}

export default function AgentRunCancelButton({
  runId,
  status,
  onCancelled,
  variant = 'prominent',
}: Props) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (isTerminalRunStatus(status) || status === 'cancelling') return null;

  const buttonClass =
    variant === 'inline'
      ? 'text-xs text-rose-700 hover:text-rose-900 hover:underline disabled:opacity-50'
      : 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 disabled:opacity-50';

  async function confirm() {
    setSubmitting(true);
    try {
      await api.post(`/api/agent-runs/${runId}/cancel`);
      toast.success('Cancel requested — run will stop at the next safe checkpoint');
      onCancelled?.();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.error ??
        (err instanceof Error ? err.message : 'Failed to cancel run');
      toast.error(msg);
    } finally {
      setSubmitting(false);
      setOpen(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={submitting}
        className={buttonClass}
      >
        {submitting ? 'Cancelling…' : 'Cancel run'}
      </button>
      {open && (
        <ConfirmDialog
          title="Cancel agent run"
          message="The run will stop at its next safe checkpoint. Any side-effects already executed are not rolled back."
          confirmLabel="Cancel run"
          onConfirm={confirm}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}

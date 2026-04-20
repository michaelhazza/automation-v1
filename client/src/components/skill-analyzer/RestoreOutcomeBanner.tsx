import type { RestoreOutcome, RestoreResult } from './RestoreBackupControl';

function formatCounts(r: RestoreResult): string {
  const parts: string[] = [];
  if (r.skillsReverted > 0) parts.push(`${r.skillsReverted} skill${r.skillsReverted === 1 ? '' : 's'} reverted`);
  if (r.skillsDeactivated > 0) parts.push(`${r.skillsDeactivated} new skill${r.skillsDeactivated === 1 ? '' : 's'} deactivated`);
  if (r.agentsReverted > 0) parts.push(`${r.agentsReverted} agent${r.agentsReverted === 1 ? '' : 's'} reverted`);
  if (r.agentsSoftDeleted > 0) parts.push(`${r.agentsSoftDeleted} agent${r.agentsSoftDeleted === 1 ? '' : 's'} soft-deleted`);
  if (parts.length === 0) return 'No changes needed.';
  return parts.join(', ') + '.';
}

interface Props {
  outcome: RestoreOutcome;
  onDismiss: () => void;
}

/** Sticky post-restore banner owned by the Wizard (not RestoreBackupControl)
 *  so it survives the parent gate's `backup.status === 'active'` flip to
 *  'restored' that unmounts the control itself. Rendered by both the Results
 *  and Execute steps. Explicit close — no auto-dismiss — to avoid yanking the
 *  confirmation out from under a slower reader. */
export default function RestoreOutcomeBanner({ outcome, onDismiss }: Props) {
  if (outcome.status === 'success') {
    return (
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-800 mb-1">Changes reverted</p>
          <p className="text-xs text-amber-700">{formatCounts(outcome.counts)}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-amber-600 hover:text-amber-800 text-sm leading-none shrink-0"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
      <p className="flex-1 text-sm text-amber-800">This backup has already been restored.</p>
      <button
        type="button"
        onClick={onDismiss}
        className="text-amber-600 hover:text-amber-800 text-sm leading-none shrink-0"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

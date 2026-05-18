// client/src/pages/operate/components/InboxItemCard.tsx
//
// Renders one InboxItem card with:
// - Top-right action buttons (approve / reject / archive) derived from item.kind
//   (server is source of truth per plan §C6: review_item and approval → approve+reject;
//   approval does NOT support archive; agent_run and task → archive only)
// - Inline reject reason textarea (NOT a modal) shown when reject is in progress
// - Bottom-right date label: "Added: <date>" or "Triggered: <date>"
// - Action buttons hidden when user lacks write permission (role check)
// - On action success: item removed from the band via onRemove callback
// - On alreadyApplied: silent success (no spinner, no error)
//
// Spec §4.2 (consumer side), §4.6, §4.10

import React, { useState } from 'react';
import type { InboxItem, InboxItemKind } from '../../../../../shared/types/operate';
import type { User } from '../../../lib/auth';
import { inboxApprove, inboxReject, inboxArchive } from '../../../lib/api';
import { relativeTime } from '../../../lib/relativeTime';
import { VerdictDrillIn, type VerdictDrillInProps } from '../../../components/verdicts/VerdictDrillIn';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the actions supported by a given kind.
 * Server is the source of truth; this mirrors the C2 server-side rules:
 * - review_item: approve, reject, archive
 * - approval: approve, reject (NOT archive — server returns 400)
 * - agent_run: archive only
 * - task: archive only
 */
function getActionsForKind(kind: InboxItemKind): Array<'approve' | 'reject' | 'archive'> {
  switch (kind) {
    case 'review_item':
      return ['approve', 'reject', 'archive'];
    case 'approval':
      return ['approve', 'reject'];
    case 'agent_run':
    case 'task':
    default:
      return ['archive'];
  }
}

/**
 * Returns true if the user has inbox-write permission.
 * Manager, org_admin, and system_admin can act on inbox items.
 */
function canWriteInbox(user: User): boolean {
  return (
    user.role === 'org_admin' ||
    user.role === 'system_admin' ||
    user.role === 'manager'
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ActionButtonProps {
  label: string;
  onClick: () => void;
  disabled: boolean;
  variant: 'approve' | 'reject' | 'archive';
}

function ActionButton({ label, onClick, disabled, variant }: ActionButtonProps) {
  const styles: Record<string, string> = {
    approve: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50',
    reject: 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50',
    archive: 'border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1 rounded text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${styles[variant]}`}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// InboxItemCard
// ---------------------------------------------------------------------------

export interface InboxItemCardProps {
  item: InboxItem;
  user: User;
  /** Called when the item is successfully actioned and should be removed from the band. */
  onRemove: (entityId: string) => void;
}

export function InboxItemCard({ item, user, onRemove }: InboxItemCardProps): React.ReactElement {
  const availableActions = getActionsForKind(item.kind);
  const userCanWrite = canWriteInbox(user);

  // Reject flow state
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Loading/error state per action
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Action handlers
  // ---------------------------------------------------------------------------

  async function handleApprove() {
    setActionLoading('approve');
    setActionError(null);
    try {
      const result = await inboxApprove(item.entityId, item.kind);
      // alreadyApplied → silent success
      if (result.ok || result.alreadyApplied) {
        onRemove(item.entityId);
      }
    } catch (err) {
      console.error('[InboxItemCard] approve error:', err);
      setActionError('Failed to approve. Please try again.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject() {
    // Called from the "Confirm reject" button (rejectOpen is always true at this point).
    setActionLoading('reject');
    setActionError(null);
    try {
      const result = await inboxReject(item.entityId, item.kind, rejectReason || undefined);
      if (result.ok || result.alreadyApplied) {
        onRemove(item.entityId);
      }
    } catch (err) {
      console.error('[InboxItemCard] reject error:', err);
      setActionError('Failed to reject. Please try again.');
    } finally {
      setActionLoading(null);
      setRejectOpen(false);
      setRejectReason('');
    }
  }

  async function handleArchive() {
    // No confirmation dialog per spec §4.10
    setActionLoading('archive');
    setActionError(null);
    try {
      const result = await inboxArchive(item.entityId, item.kind);
      if (result.ok || result.alreadyApplied) {
        onRemove(item.entityId);
      }
    } catch (err) {
      console.error('[InboxItemCard] archive error:', err);
      setActionError('Failed to archive. Please try again.');
    } finally {
      setActionLoading(null);
    }
  }

  function handleCancelReject() {
    setRejectOpen(false);
    setRejectReason('');
    setActionError(null);
  }

  const isActing = actionLoading !== null;

  // ---------------------------------------------------------------------------
  // Date label (bottom-right)
  // Prefer dueAt ("Triggered"), fall back to updatedAt ("Added")
  // ---------------------------------------------------------------------------
  const dateLabel = item.dueAt
    ? `Triggered: ${formatDate(item.dueAt)}`
    : `Added: ${formatDate(item.updatedAt)}`;

  // ---------------------------------------------------------------------------
  // Severity indicator
  // ---------------------------------------------------------------------------
  const severityDotColor: Record<string, string> = {
    critical: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-3 shadow-sm">
      {/* Header row: title + actions */}
      <div className="flex items-start justify-between gap-3">
        {/* Left: severity dot + title + status */}
        <div className="flex items-start gap-2 min-w-0">
          {item.severity && (
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: severityDotColor[item.severity] ?? '#94a3b8',
                flexShrink: 0,
                marginTop: 5,
              }}
              aria-hidden="true"
              title={item.severity}
            />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 leading-snug break-words">
              {item.title}
            </p>
            {item.status && (
              <p className="text-xs text-slate-500 mt-0.5 capitalize">
                {item.status.replace(/_/g, ' ')}
              </p>
            )}
          </div>
        </div>

        {/* Right: action buttons (only when user has write permission) */}
        {userCanWrite && availableActions.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            {availableActions.includes('approve') && (
              <ActionButton
                label="Approve"
                onClick={handleApprove}
                disabled={isActing}
                variant="approve"
              />
            )}
            {availableActions.includes('reject') && !rejectOpen && (
              <ActionButton
                label="Reject"
                onClick={() => setRejectOpen(true)}
                disabled={isActing}
                variant="reject"
              />
            )}
            {availableActions.includes('archive') && (
              <ActionButton
                label="Archive"
                onClick={handleArchive}
                disabled={isActing}
                variant="archive"
              />
            )}
          </div>
        )}
      </div>

      {/* Inline reject reason input — NOT a modal (spec §4.10) */}
      {rejectOpen && (
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
          <label className="text-xs font-medium text-slate-700" htmlFor={`reject-reason-${item.entityId}`}>
            Reason for rejection (optional)
          </label>
          <textarea
            id={`reject-reason-${item.entityId}`}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Briefly explain why this is being rejected..."
            rows={3}
            disabled={isActing}
            className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400 disabled:opacity-50"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReject}
              disabled={isActing}
              className="px-3 py-1 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              {actionLoading === 'reject' ? 'Rejecting...' : 'Confirm reject'}
            </button>
            <button
              type="button"
              onClick={handleCancelReject}
              disabled={isActing}
              className="px-3 py-1 rounded text-xs font-medium border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {actionError}
        </p>
      )}

      {/* Verdict drill-in: rendered when item carries evaluationMethod metadata */}
      {typeof item.meta?.evaluationMethod === 'string' && (
        <VerdictDrillIn
          evaluationMethod={item.meta.evaluationMethod as VerdictDrillInProps['evaluationMethod']}
          validatorSlug={typeof item.meta.validatorSlug === 'string' ? item.meta.validatorSlug : undefined}
          validatorVersion={typeof item.meta.validatorVersion === 'string' ? item.meta.validatorVersion : undefined}
          evidence={item.meta.evidence as VerdictDrillInProps['evidence']}
          reasoning={typeof item.meta.reasoning === 'string' ? item.meta.reasoning : ''}
          gateEvidence={item.meta.gateEvidence as VerdictDrillInProps['gateEvidence']}
        />
      )}

      {/* Footer row: date label */}
      <div className="flex justify-end">
        <span
          className="text-xs text-slate-400"
          title={item.dueAt ?? item.updatedAt}
        >
          {dateLabel}
        </span>
      </div>
    </div>
  );
}

export default InboxItemCard;

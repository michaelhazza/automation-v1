// client/src/pages/operate/components/ActivityDetailModal.tsx
//
// Modal view for an ActivityItem. Opened from the Home widget "Recent Activity"
// entry path (ActivityItem prop). Spec §4.4 defines the source-of-truth payload.
// Contains a run-id affordance that opens <RunTraceModal> stacked above (zIndex=1010).

import React, { useState } from 'react';
import type { ActivityItem } from '../../../../../shared/types/operate';
import Modal from '../../../components/Modal';
import RunTraceModal from './RunTraceModal';
import { StatusDot, SeverityDot, TypeTag, formatType } from './ActivityRow';
import { WorkspaceBadge } from '../../../components/WorkspaceBadge';
import { relativeTime } from '../../../lib/relativeTime';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ActivityDetailModalProps {
  item: ActivityItem;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// DetailRow — key/value pair in the detail list
// ---------------------------------------------------------------------------

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0">
      <span className="w-32 shrink-0 text-xs font-medium text-slate-500 pt-0.5">{label}</span>
      <span className="flex-1 text-sm text-slate-800">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActivityDetailModal
// ---------------------------------------------------------------------------

export function ActivityDetailModal({ item, onClose }: ActivityDetailModalProps): React.ReactElement {
  const [traceRunId, setTraceRunId] = useState<string | null>(null);

  return (
    <>
      <Modal
        title="Activity Detail"
        onClose={onClose}
        size="md"
      >
        <div className="flex flex-col gap-1">
          {/* Subject heading */}
          <h3 className="text-sm font-semibold text-slate-900 mb-3 leading-snug">{item.subject}</h3>

          {/* Detail rows — spec §4.4 payload */}
          <DetailRow label="Type">
            <TypeTag type={item.type} />
          </DetailRow>

          <DetailRow label="Status">
            <StatusDot status={item.status} />
          </DetailRow>

          <DetailRow label="Severity">
            <SeverityDot severity={item.severity} />
          </DetailRow>

          <DetailRow label="Actor">
            {item.actor || <span className="text-slate-400">—</span>}
          </DetailRow>

          {item.subaccountId && item.subaccountName && (
            <DetailRow label="Workspace">
              <WorkspaceBadge
                clientId={item.subaccountId}
                clientName={item.subaccountName}
              />
            </DetailRow>
          )}

          <DetailRow label="Trigger">
            <span className="capitalize">{formatType(item.triggerSource)}</span>
            {item.triggerType && item.triggerType !== item.triggerSource && (
              <span className="text-slate-400 ml-1 text-xs">({item.triggerType})</span>
            )}
          </DetailRow>

          {item.triggeredByUserName && (
            <DetailRow label="Triggered by">
              {item.triggeredByUserName}
            </DetailRow>
          )}

          <DetailRow label="Created">
            <span title={new Date(item.createdAt).toLocaleString()}>
              {relativeTime(item.createdAt)}
            </span>
          </DetailRow>

          {item.updatedAt && item.updatedAt !== item.createdAt && (
            <DetailRow label="Updated">
              <span title={new Date(item.updatedAt).toLocaleString()}>
                {relativeTime(item.updatedAt)}
              </span>
            </DetailRow>
          )}

          {item.durationMs !== null && item.durationMs !== undefined && (
            <DetailRow label="Duration">
              {item.durationMs < 1000
                ? `${item.durationMs}ms`
                : `${(item.durationMs / 1000).toFixed(1)}s`}
            </DetailRow>
          )}

          {item.agentName && (
            <DetailRow label="Agent">
              {item.agentName}
            </DetailRow>
          )}

          {/* Run ID affordance */}
          {item.runId && (
            <DetailRow label="Run ID">
              <button
                type="button"
                onClick={() => setTraceRunId(item.runId)}
                className="font-mono text-xs text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none"
                title="View run trace"
              >
                {item.runId}
              </button>
            </DetailRow>
          )}

          {/* External detail link */}
          {item.detailUrl && (
            <div className="mt-4">
              <a
                href={item.detailUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-indigo-600 hover:text-indigo-800 hover:underline"
              >
                View full detail
              </a>
            </div>
          )}
        </div>
      </Modal>

      {/* RunTraceModal stacked above (zIndex=1010) */}
      {traceRunId && (
        <RunTraceModal runId={traceRunId} onClose={() => setTraceRunId(null)} />
      )}
    </>
  );
}

export default ActivityDetailModal;

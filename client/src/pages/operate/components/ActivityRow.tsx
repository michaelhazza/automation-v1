// client/src/pages/operate/components/ActivityRow.tsx
//
// Row renderer for ActivityItem. Used by ActivityPage (table) and HomeRecentActivity (C7).
// The trigger handler is passed in by the parent (`onOpen`) so the row stays
// trigger-agnostic — row click in table opens a Drawer; in HomeRecentActivity it
// may open a modal. The run-id link is only rendered when `embedded !== true`.

import React, { useState } from 'react';
import type { ActivityItem } from '../../../../../shared/types/operate';
import { WorkspaceBadge } from '../../../components/WorkspaceBadge';
import { relativeTime } from '../../../lib/relativeTime';
import RunTraceModal from './RunTraceModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatType(type: string): string {
  if (type.includes('.')) {
    return type
      .split('.')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ');
  }
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  active:           { dot: '#3b82f6', label: 'Active' },
  attention_needed: { dot: '#f59e0b', label: 'Attention needed' },
  completed:        { dot: '#10b981', label: 'Completed' },
  failed:           { dot: '#ef4444', label: 'Failed' },
  cancelled:        { dot: '#94a3b8', label: 'Cancelled' },
};

const SEVERITY_STYLES: Record<string, { dot: string; label: string }> = {
  critical: { dot: '#ef4444', label: 'Critical' },
  warning:  { dot: '#f59e0b', label: 'Warning' },
  info:     { dot: '#3b82f6', label: 'Info' },
};

const TYPE_TAG_COLORS: Record<string, { bg: string; text: string }> = {
  agent_run:          { bg: '#e0e7ff', text: '#3730a3' },
  review_item:        { bg: '#fef3c7', text: '#92400e' },
  health_finding:     { bg: '#fee2e2', text: '#991b1b' },
  inbox_item:         { bg: '#f1f5f9', text: '#334155' },
  workflow_run:       { bg: '#d1fae5', text: '#065f46' },
  workflow_execution: { bg: '#d1fae5', text: '#065f46' },
};

function typeTagStyle(type: string): { bg: string; text: string } {
  // Use prefix match for dot-separated types (e.g., 'email.sent')
  const prefix = type.split('.')[0];
  return TYPE_TAG_COLORS[type] ?? TYPE_TAG_COLORS[prefix] ?? { bg: '#f1f5f9', text: '#334155' };
}

// ---------------------------------------------------------------------------
// StatusDot
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: string }) {
  const style = STATUS_STYLES[status];
  return (
    <span title={style?.label ?? status} className="inline-flex items-center gap-1">
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: style?.dot ?? '#94a3b8',
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
      <span className="text-slate-600 text-xs">{style?.label ?? status}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// SeverityDot
// ---------------------------------------------------------------------------

function SeverityDot({ severity }: { severity: string | null }) {
  if (!severity) return <span className="text-slate-400 text-xs">—</span>;
  const style = SEVERITY_STYLES[severity];
  return (
    <span title={style?.label ?? severity} className="inline-flex items-center gap-1">
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: style?.dot ?? '#94a3b8',
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
      <span className="text-slate-600 text-xs">{style?.label ?? severity}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// TypeTag
// ---------------------------------------------------------------------------

function TypeTag({ type }: { type: string }) {
  const { bg, text } = typeTagStyle(type);
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 500,
        lineHeight: '18px',
        background: bg,
        color: text,
        whiteSpace: 'nowrap',
      }}
    >
      {formatType(type)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// RunIdLink
// ---------------------------------------------------------------------------

interface RunIdLinkProps {
  runId: string;
  embedded?: boolean;
}

function RunIdLink({ runId, embedded }: RunIdLinkProps) {
  const [open, setOpen] = useState(false);

  if (embedded) {
    return (
      <span className="font-mono text-xs text-slate-500">{runId.slice(0, 8)}&hellip;</span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Prevent the row click handler from firing (Drawer opening)
          e.stopPropagation();
          setOpen(true);
        }}
        className="font-mono text-xs text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none"
        title={`View run trace: ${runId}`}
      >
        {runId.slice(0, 8)}&hellip;
      </button>
      {open && (
        <RunTraceModal runId={runId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// ActivityRow
// ---------------------------------------------------------------------------

export interface ActivityRowProps {
  item: ActivityItem;
  /** Called when the row is activated (click or keyboard). Parent decides what to open. */
  onOpen: (item: ActivityItem) => void;
  /** When true, run-id renders as plain text instead of a clickable link. Used in embedded contexts. */
  embedded?: boolean;
}

/**
 * ActivityRow renders one ActivityItem as a set of cells.
 * It is NOT a `<tr>` — the parent table is responsible for the row wrapper.
 * The exported helpers (StatusDot, SeverityDot, TypeTag) are also re-exported
 * for use in detail views.
 */
export function ActivityRow({ item, onOpen, embedded }: ActivityRowProps): React.ReactElement {
  return (
    <>
      {/* Subject + run-id */}
      <td className="px-3 py-2 text-slate-900">
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => onOpen(item)}
            className="text-sm text-left hover:text-indigo-700 focus:outline-none focus:underline truncate max-w-xs"
            title={item.subject}
          >
            {item.subject}
          </button>
          {item.runId && (
            <RunIdLink runId={item.runId} embedded={embedded} />
          )}
        </div>
      </td>

      {/* Type */}
      <td className="px-3 py-2">
        <TypeTag type={item.type} />
      </td>

      {/* Status */}
      <td className="px-3 py-2">
        <StatusDot status={item.status} />
      </td>

      {/* Severity */}
      <td className="px-3 py-2">
        <SeverityDot severity={item.severity} />
      </td>

      {/* Actor */}
      <td className="px-3 py-2 text-sm text-slate-700 whitespace-nowrap">
        {item.actor || <span className="text-slate-400">—</span>}
      </td>

      {/* Workspace */}
      <td className="px-3 py-2">
        {item.subaccountId && item.subaccountName ? (
          <WorkspaceBadge
            clientId={item.subaccountId}
            clientName={item.subaccountName}
          />
        ) : (
          <span className="text-slate-400 text-sm">—</span>
        )}
      </td>

      {/* Trigger Source */}
      <td className="px-3 py-2 text-sm text-slate-600 whitespace-nowrap capitalize">
        {item.triggerSource}
      </td>

      {/* Timestamp */}
      <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
        <span title={new Date(item.createdAt).toLocaleString()}>
          {relativeTime(item.createdAt)}
        </span>
      </td>
    </>
  );
}

// Re-export helpers for detail views
export { StatusDot, SeverityDot, TypeTag, formatType };

export default ActivityRow;

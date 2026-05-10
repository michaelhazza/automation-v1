// client/src/components/run-trace/SupportEventRenderers.tsx
// Renderers for Support Agent Run Trace event types (spec §5.6.3).
// Note: phase1.support.eval_drift_detected is admin-only and NOT rendered here.

import type React from 'react';

// ── Shared primitives ─────────────────────────────────────────────────────────

type BadgeVariant = 'neutral' | 'green' | 'amber' | 'red';

const BADGE_STYLES: Record<BadgeVariant, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
};

function Badge({ label, variant }: { label: string; variant: BadgeVariant }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${BADGE_STYLES[variant]}`}>
      {label}
    </span>
  );
}

interface SupportEventProps {
  event: { payload?: Record<string, unknown>; eventType: string };
}

function EventRow({ badge, text }: { badge: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-[12px] text-slate-600">
      {badge}
      <span>{text}</span>
    </div>
  );
}

// ── Exported renderers ────────────────────────────────────────────────────────

// phase1.support.execution_loop_started
export function SupportExecutionLoopStartedRenderer({ event }: SupportEventProps) {
  const ticketCount = String(event.payload?.ticketCount ?? '?');
  return (
    <EventRow
      badge={<Badge label="Loop started" variant="neutral" />}
      text={`Inbox scan started, ${ticketCount} tickets`}
    />
  );
}

// phase1.support.collision_skipped
export function SupportCollisionSkippedRenderer({ event }: SupportEventProps) {
  const ticketId = String(event.payload?.ticketId ?? '?');
  const reason = String(event.payload?.reason ?? 'unknown reason');
  return (
    <EventRow
      badge={<Badge label="Skipped" variant="amber" />}
      text={`Ticket ${ticketId} skipped: ${reason}`}
    />
  );
}

// phase1.support.ticket_classified
export function SupportTicketClassifiedRenderer({ event }: SupportEventProps) {
  const intent = String(event.payload?.intent ?? '?');
  const urgency = String(event.payload?.urgency ?? '?');
  const confidence = event.payload?.confidence !== undefined
    ? `${Math.round(Number(event.payload.confidence) * 100)}%`
    : '?';
  return (
    <EventRow
      badge={<Badge label="Classified" variant="neutral" />}
      text={`Classified: ${intent} / ${urgency} (${confidence})`}
    />
  );
}

// phase1.support.draft_proposed
export function SupportDraftProposedRenderer({ event }: SupportEventProps) {
  const perTicketVerdict = String(event.payload?.perTicketVerdict ?? '');
  return (
    <EventRow
      badge={<Badge label="Draft proposed" variant="green" />}
      text={`Draft proposed${perTicketVerdict ? ` (${perTicketVerdict})` : ''}`}
    />
  );
}

// phase1.support.ticket_terminal
export function SupportTicketTerminalRenderer({ event }: SupportEventProps) {
  const perTicketVerdict = String(event.payload?.perTicketVerdict ?? '');
  const isEscalated = perTicketVerdict === 'escalated_to_human';
  return (
    <EventRow
      badge={<Badge label="Terminal" variant={isEscalated ? 'red' : 'neutral'} />}
      text={`Ticket resolved${perTicketVerdict ? `: ${perTicketVerdict}` : ''}`}
    />
  );
}

// phase1.support.execution_loop_completed
export function SupportExecutionLoopCompletedRenderer({ event }: SupportEventProps) {
  const ticketCount = String(event.payload?.ticketCount ?? '?');
  return (
    <EventRow
      badge={<Badge label="Loop complete" variant="neutral" />}
      text={`Scan complete, ${ticketCount} tickets processed`}
    />
  );
}

// phase1.support.classify_failed
export function SupportClassifyFailedRenderer({ event }: SupportEventProps) {
  const ticketId = String(event.payload?.ticketId ?? '?');
  return (
    <EventRow
      badge={<Badge label="Classify failed" variant="red" />}
      text={`Classification failed for ticket ${ticketId}`}
    />
  );
}

// ── Lookup function ───────────────────────────────────────────────────────────

type SupportEventRendererComponent = React.ComponentType<SupportEventProps>;

const SUPPORT_EVENT_RENDERERS: Record<string, SupportEventRendererComponent> = {
  'phase1.support.execution_loop_started': SupportExecutionLoopStartedRenderer,
  'phase1.support.collision_skipped': SupportCollisionSkippedRenderer,
  'phase1.support.ticket_classified': SupportTicketClassifiedRenderer,
  'phase1.support.draft_proposed': SupportDraftProposedRenderer,
  'phase1.support.ticket_terminal': SupportTicketTerminalRenderer,
  'phase1.support.execution_loop_completed': SupportExecutionLoopCompletedRenderer,
  'phase1.support.classify_failed': SupportClassifyFailedRenderer,
};

export function getSupportEventRenderer(eventType: string): SupportEventRendererComponent | null {
  return SUPPORT_EVENT_RENDERERS[eventType] ?? null;
}

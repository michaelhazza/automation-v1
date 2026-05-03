/**
 * ActivityPane — the collapsible activity log column.
 *
 * Shows all task events newest-at-bottom. Auto-scrolls unless the user
 * manually scrolled up; shows a "N new events" pill in that case.
 *
 * Layout: 22% expanded / 36px collapsed.
 * Spec: docs/workflows-dev-spec.md §9.3.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { ActivityFeedItem } from '../../hooks/useTaskProjectionPure.js';
import { shouldAutoScroll } from './openTaskViewPure.js';
import { relativeTime } from '../../lib/relativeTime.js';

interface ActivityPaneProps {
  activityFeed: ActivityFeedItem[];
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/** Human-readable label for each event kind */
function kindLabel(kind: string): string {
  switch (kind) {
    case 'task.created':             return 'Task created';
    case 'task.routed':              return 'Task routed';
    case 'step.queued':              return 'Step queued';
    case 'step.started':             return 'Step started';
    case 'step.completed':           return 'Step completed';
    case 'step.failed':              return 'Step failed';
    case 'step.branch_decided':      return 'Branch decided';
    case 'agent.delegation.opened':  return 'Agent delegated';
    case 'agent.delegation.closed':  return 'Agent done';
    case 'agent.milestone':          return 'Milestone';
    case 'thinking.changed':         return 'Thinking';
    case 'chat.message':             return 'Message';
    case 'approval.queued':          return 'Approval required';
    case 'approval.decided':         return 'Approval decision';
    case 'approval.pool_refreshed':  return 'Approver pool updated';
    case 'ask.queued':               return 'Input required';
    case 'ask.submitted':            return 'Input submitted';
    case 'ask.skipped':              return 'Input skipped';
    case 'file.created':             return 'File created';
    case 'file.edited':              return 'File edited';
    case 'run.paused.cost_ceiling':  return 'Paused: cost ceiling';
    case 'run.paused.wall_clock':    return 'Paused: time cap';
    case 'run.paused.by_user':       return 'Paused by user';
    case 'run.resumed':              return 'Run resumed';
    case 'run.stopped.by_user':      return 'Run stopped';
    case 'task.degraded':            return 'Stream degraded';
    default:                         return kind;
  }
}

/** Short body text for the event */
function bodyText(item: ActivityFeedItem): string {
  const p = item.payload as Record<string, unknown> | null;
  if (!p) return '';
  switch (item.kind) {
    case 'step.queued':
    case 'step.started':
    case 'step.completed':
    case 'step.failed':
      return String(p.stepId ?? '');
    case 'agent.delegation.opened':
      return `${p.parentAgentId ?? ''} → ${p.childAgentId ?? ''}`;
    case 'agent.milestone':
      return String(p.summary ?? '');
    case 'thinking.changed':
      return String(p.newText ?? '');
    case 'chat.message':
      return String(p.body ?? '');
    case 'step.branch_decided':
      return `${p.field ?? ''} = ${p.resolvedValue ?? ''}`;
    default:
      return '';
  }
}

export default function ActivityPane({ activityFeed, collapsed, onToggleCollapse }: ActivityPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lastUserScrollAt, setLastUserScrollAt] = useState<number | null>(null);
  const [newCount, setNewCount] = useState(0);
  const prevLengthRef = useRef(activityFeed.length);

  // Track user scroll — pause auto-scroll when user scrolls up
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    if (!atBottom) {
      setLastUserScrollAt(Date.now());
    } else {
      setLastUserScrollAt(null);
      setNewCount(0);
    }
  }, []);

  // Auto-scroll or count new events
  useEffect(() => {
    if (collapsed) return;
    const newItems = activityFeed.length - prevLengthRef.current;
    if (newItems <= 0) return;
    prevLengthRef.current = activityFeed.length;

    const autoScroll = shouldAutoScroll({ atBottom: true }, lastUserScrollAt);
    if (autoScroll) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      setNewCount(0);
    } else {
      setNewCount((n) => n + newItems);
    }
  }, [activityFeed.length, collapsed, lastUserScrollAt]);

  function jumpToBottom() {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setLastUserScrollAt(null);
    setNewCount(0);
  }

  if (collapsed) {
    return (
      <div
        className="w-9 flex-shrink-0 flex flex-col items-center justify-start pt-3 gap-2 cursor-pointer select-none bg-slate-800/40 border-r border-slate-700/40 hover:bg-slate-700/40 transition-colors"
        onClick={onToggleCollapse}
        title="Expand activity log"
      >
        {/* Chevron right */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {/* Rotated label */}
        <span className="text-[11px] text-slate-500 font-medium" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
          Activity
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-w-0 bg-slate-800/20 border-r border-slate-700/40">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/40">
        <span className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider">Activity</span>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="text-slate-500 hover:text-slate-300 transition-colors"
          title="Collapse activity log"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      {/* Scrollable feed */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0 space-y-px"
      >
        {activityFeed.length === 0 ? (
          <div className="flex items-center justify-center h-20">
            <p className="text-[12px] text-slate-600 italic">No events yet</p>
          </div>
        ) : (
          activityFeed.map((item, idx) => {
            const body = bodyText(item);
            return (
              <div key={idx} className="px-3 py-1.5 hover:bg-slate-700/20 transition-colors">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] font-medium text-slate-300 truncate">
                    {kindLabel(item.kind)}
                  </span>
                  <span className="text-[10px] text-slate-600 shrink-0">
                    {relativeTime(item.timestamp)}
                  </span>
                </div>
                {body && (
                  <p className="text-[11.5px] text-slate-500 truncate mt-0.5">{body}</p>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* "N new events" pill */}
      {newCount > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={jumpToBottom}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-1 text-[12px] font-medium text-white shadow-lg hover:bg-indigo-500 transition-colors z-10"
          >
            {newCount} new {newCount === 1 ? 'event' : 'events'}
          </button>
        </div>
      )}
    </div>
  );
}

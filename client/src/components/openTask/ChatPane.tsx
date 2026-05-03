/**
 * ChatPane — the left chat column in the open task view.
 *
 * Renders chat messages, milestone cards, approval cards, ask card placeholders,
 * pause cards, thinking box, and the composer.
 *
 * Spec: docs/workflows-dev-spec.md §9.2.
 */

import { useEffect, useRef, useState } from 'react';
import type { TaskProjection } from '../../hooks/useTaskProjectionPure.js';
import type { ActivityFeedItem } from '../../hooks/useTaskProjectionPure.js';
import { classifyChatVisibility } from './openTaskViewPure.js';
import ThinkingBox from './ThinkingBox.js';
import MilestoneCard from './MilestoneCard.js';
import ApprovalCard from './ApprovalCard.js';
import PauseCard from './PauseCard.js';
import api from '../../lib/api.js';
import type { TaskEvent } from '../../../../shared/types/taskEvent.js';

interface ChatPaneProps {
  taskId: string;
  projection: TaskProjection;
  currentUserId: string;
}

/** Items to render in chat: messages + milestone events + card events */
type ChatItem =
  | { type: 'message'; id: string; authorKind: 'user' | 'agent'; authorId: string; body: string; timestamp: string }
  | { type: 'milestone'; agentId: string; summary: string; linkRef?: { kind: string; id: string; label: string }; timestamp: string; key: string }
  | { type: 'approval'; gateId: string; stepId: string; seenConfidence: import('../../../../shared/types/taskEvent.js').SeenConfidence; approverPool: string[]; key: string }
  | { type: 'ask'; gateId: string; prompt: string; key: string }
  | { type: 'pause'; reason: 'cost_ceiling' | 'wall_clock' | 'by_user'; key: string };

function buildChatItems(
  projection: TaskProjection,
  activityFeed: ActivityFeedItem[],
): ChatItem[] {
  const items: ChatItem[] = [];

  // Add chat.message items from projection
  for (const msg of projection.chatMessages) {
    items.push({
      type: 'message',
      id: msg.id,
      authorKind: msg.authorKind,
      authorId: msg.authorId,
      body: msg.body,
      timestamp: msg.timestamp,
    });
  }

  // Add events that are visible in chat from the activity feed
  for (const entry of activityFeed) {
    const event = { kind: entry.kind, payload: entry.payload } as TaskEvent;
    const visibility = classifyChatVisibility(event);

    if (visibility === 'milestone' && entry.kind === 'agent.milestone') {
      const p = entry.payload as { agentId: string; summary: string; linkRef?: { kind: string; id: string; label: string } };
      items.push({
        type: 'milestone',
        agentId: p.agentId,
        summary: p.summary,
        linkRef: p.linkRef,
        timestamp: entry.timestamp,
        key: `milestone-${entry.taskSequence}-${entry.eventSubsequence}`,
      });
    } else if (entry.kind === 'approval.queued') {
      const p = entry.payload as { gateId: string; stepId: string; seenConfidence: import('../../../../shared/types/taskEvent.js').SeenConfidence; approverPool: string[] };
      // Only add if still open (not decided yet)
      const stillOpen = projection.openCards.some((c) => c.kind === 'approval' && c.gateId === p.gateId);
      if (stillOpen) {
        items.push({
          type: 'approval',
          gateId: p.gateId,
          stepId: p.stepId,
          seenConfidence: p.seenConfidence,
          approverPool: p.approverPool,
          key: `approval-${p.gateId}`,
        });
      }
    } else if (entry.kind === 'ask.queued') {
      const p = entry.payload as { gateId: string; prompt: string };
      const stillOpen = projection.openCards.some((c) => c.kind === 'ask' && c.gateId === p.gateId);
      if (stillOpen) {
        items.push({
          type: 'ask',
          gateId: p.gateId,
          prompt: p.prompt,
          key: `ask-${p.gateId}`,
        });
      }
    } else if (
      entry.kind === 'run.paused.cost_ceiling' ||
      entry.kind === 'run.paused.wall_clock' ||
      entry.kind === 'run.paused.by_user'
    ) {
      const stillPaused = projection.status === 'paused';
      if (stillPaused) {
        const reason = entry.kind === 'run.paused.cost_ceiling'
          ? 'cost_ceiling'
          : entry.kind === 'run.paused.wall_clock'
          ? 'wall_clock'
          : 'by_user';
        items.push({ type: 'pause', reason, key: `pause-${entry.taskSequence}` });
      }
    }
  }

  return items;
}

export default function ChatPane({ taskId, projection, currentUserId }: ChatPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const prevCountRef = useRef(0);

  // Deduplicate chat items built from chat messages + activity feed events
  const chatItems = buildChatItems(projection, projection.activityFeed);

  // Auto-scroll to bottom on new items
  useEffect(() => {
    const count = chatItems.length;
    if (count > prevCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevCountRef.current = count;
  }, [chatItems.length]);

  async function handleSend() {
    const body = composerText.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    try {
      // TODO: /api/tasks/:taskId/chat endpoint not yet implemented (Chunk 12+)
      await api.post(`/api/tasks/${taskId}/chat`, { body });
      setComposerText('');
    } catch (err: unknown) {
      setSendError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
          ?? 'Failed to send',
      );
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Scrollable chat area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 space-y-1">
        {chatItems.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[13px] text-slate-500 italic">No messages yet.</p>
          </div>
        ) : (
          chatItems.map((item, idx) => {
            if (item.type === 'message') {
              const isUser = item.authorKind === 'user';
              return (
                <div key={item.id ?? idx} className={`px-4 py-2 ${isUser ? '' : 'bg-slate-800/30'}`}>
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className={`text-[11px] font-semibold ${isUser ? 'text-indigo-400' : 'text-slate-400'}`}>
                      {isUser ? 'You' : 'Agent'}
                    </span>
                    <span className="text-[10px] text-slate-600">{relativeLabel(item.timestamp)}</span>
                  </div>
                  <p className="text-[13.5px] text-slate-200 leading-relaxed whitespace-pre-wrap">{item.body}</p>
                </div>
              );
            }

            if (item.type === 'milestone') {
              return (
                <MilestoneCard
                  key={item.key}
                  agentId={item.agentId}
                  summary={item.summary}
                  linkRef={item.linkRef}
                  timestamp={item.timestamp}
                />
              );
            }

            if (item.type === 'approval') {
              return (
                <ApprovalCard
                  key={item.key}
                  gateId={item.gateId}
                  stepId={item.stepId}
                  seenConfidence={item.seenConfidence}
                  approverPool={item.approverPool}
                  currentUserId={currentUserId}
                />
              );
            }

            if (item.type === 'ask') {
              // Placeholder — full Ask form card in Chunk 12
              return (
                <div key={item.key} className="mx-4 my-2 rounded-lg border border-slate-600 bg-slate-800/60 px-4 py-3">
                  <p className="text-[13.5px] font-medium text-slate-200 mb-1">Input required</p>
                  <p className="text-[13px] text-slate-400">{item.prompt}</p>
                  <p className="text-[11px] text-slate-600 mt-2">Ask form: full implementation in Chunk 12.</p>
                </div>
              );
            }

            if (item.type === 'pause') {
              return (
                <PauseCard
                  key={item.key}
                  reason={item.reason}
                  taskId={taskId}
                />
              );
            }

            return null;
          })
        )}
      </div>

      {/* Thinking box */}
      <ThinkingBox text={projection.thinking?.text ?? null} />

      {/* Composer */}
      <div className="border-t border-slate-700/50 px-3 py-2">
        {sendError && (
          <p className="text-[11.5px] text-red-400 mb-1">{sendError}</p>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            rows={2}
            className="flex-1 resize-none rounded-lg border border-slate-600 bg-slate-700/60 px-3 py-2 text-[13px] text-slate-200 placeholder-slate-500 outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || !composerText.trim()}
            className="shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-2 text-[13px] font-medium text-white transition-colors"
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function relativeLabel(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return '';
  }
}

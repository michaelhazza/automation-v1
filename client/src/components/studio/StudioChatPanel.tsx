/**
 * StudioChatPanel — docked chat pill + side-panel for Studio canvas.
 *
 * Spec: tasks/Workflows-spec.md §10.6.
 *
 * Default: collapsed pill ("Talk to the workflow editor") in bottom-left.
 * Expanded: side panel docked left of the canvas (~25% width).
 *   - Chat messages list (oldest top, newest bottom).
 *   - Chat input at the bottom.
 *   - Diff cards: structured messages with cardKind === 'studio_diff',
 *     rendered with Apply / Discard buttons.
 */

import React, { useState, useRef, useEffect } from 'react';
import type { CanvasStep } from './studioCanvasPure.js';

// ─── Message types ────────────────────────────────────────────────────────────

export interface StudioChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** When set and cardKind === 'studio_diff', render as a diff card. */
  cardKind?: 'studio_diff';
  /** Proposed canvas steps for a diff card. */
  cardPayload?: CanvasStep[];
  /** Whether this diff card has been acted on (applied or discarded). */
  cardResolved?: boolean;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface StudioChatPanelProps {
  messages: StudioChatMessage[];
  onSendMessage: (text: string) => void;
  onApplyDiff: (proposed: CanvasStep[]) => void;
  onDiscardDiff: (messageId: string) => void;
  sending?: boolean;
}

// ─── Diff card ────────────────────────────────────────────────────────────────

interface DiffCardProps {
  message: StudioChatMessage;
  onApply: () => void;
  onDiscard: () => void;
}

function DiffCard({ message, onApply, onDiscard }: DiffCardProps) {
  const proposed = message.cardPayload ?? [];
  const resolved = message.cardResolved === true;

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-semibold bg-indigo-200 text-indigo-800 px-1.5 py-0.5 rounded">
          Proposed change
        </span>
        {resolved && (
          <span className="text-[10px] text-slate-400">Applied or discarded</span>
        )}
      </div>

      <div className="text-slate-700 mb-2 text-xs leading-relaxed">
        {message.content}
      </div>

      <div className="text-[11px] text-slate-500 mb-2">
        {proposed.length} step{proposed.length !== 1 ? 's' : ''}:{' '}
        {proposed.map((s) => s.name).join(', ')}
      </div>

      {!resolved && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onApply}
            className="px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 focus:outline-none"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="px-3 py-1.5 rounded border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50 focus:outline-none"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: StudioChatMessage;
  onApplyDiff: (proposed: CanvasStep[]) => void;
  onDiscardDiff: (messageId: string) => void;
}

function MessageBubble({ message, onApplyDiff, onDiscardDiff }: MessageBubbleProps) {
  if (message.cardKind === 'studio_diff') {
    return (
      <DiffCard
        message={message}
        onApply={() => onApplyDiff(message.cardPayload ?? [])}
        onDiscard={() => onDiscardDiff(message.id)}
      />
    );
  }

  const isUser = message.role === 'user';
  return (
    <div className={['flex', isUser ? 'justify-end' : 'justify-start'].join(' ')}>
      <div
        className={[
          'max-w-[85%] rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-indigo-600 text-white'
            : 'bg-white border border-slate-200 text-slate-800',
        ].join(' ')}
      >
        {message.content}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StudioChatPanel({
  messages,
  onSendMessage,
  onApplyDiff,
  onDiscardDiff,
  sending = false,
}: StudioChatPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (expanded) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, expanded]);

  function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    onSendMessage(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── Collapsed pill ─────────────────────────────────────────────────────────
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="fixed bottom-4 left-4 z-10 flex items-center gap-2 px-4 py-2.5 rounded-full bg-white border border-slate-200 shadow-md text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />
        Talk to the workflow editor
      </button>
    );
  }

  // ── Expanded side panel ────────────────────────────────────────────────────
  return (
    <div
      className="fixed top-0 left-0 h-full z-20 bg-white border-r border-slate-200 shadow-md flex flex-col"
      style={{ width: '25%', minWidth: 280, maxWidth: 400 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-slate-200 bg-slate-50 flex-shrink-0">
        <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />
        <span className="text-sm font-semibold text-slate-800 flex-1">
          Workflow editor
        </span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-slate-400 hover:text-slate-700 text-lg leading-none px-1"
          aria-label="Collapse chat panel"
        >
          &times;
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-xs text-slate-400 text-center mt-4">
            Describe a workflow and the editor will draft it for you.
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onApplyDiff={onApplyDiff}
            onDiscardDiff={onDiscardDiff}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-slate-200 px-3 py-3 flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            rows={2}
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Describe a change..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-indigo-500 self-end"
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>
        <div className="text-[10px] text-slate-400 mt-1">
          Enter to send, Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}

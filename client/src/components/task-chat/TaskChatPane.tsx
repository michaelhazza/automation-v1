import { useState, useEffect, useRef } from 'react';
import { useConversation } from '../../hooks/useConversation.js';

interface TaskChatPaneProps {
  taskId: string;
}

/**
 * Phase 2 — conversation-scope chat pane embedded in task detail view.
 * Uses the polymorphic conversations table with scopeType='task'.
 */
export function TaskChatPane({ taskId }: TaskChatPaneProps) {
  const { messages, sending, assistantPending, send } = useConversation('task', taskId);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, assistantPending]);

  async function handleSend() {
    if (!input.trim() || sending) return;
    const text = input;
    setInput('');
    await send(text);
  }

  const visibleMessages = messages.filter((m) => m.role !== 'system');

  return (
    <div className="flex flex-col h-64 border border-gray-200 rounded-lg bg-white">
      <div className="px-3 py-2 border-b border-gray-100">
        <p className="text-xs font-medium text-gray-600">Ask about this brief</p>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {visibleMessages.length === 0 && !assistantPending && (
          <p className="text-xs text-gray-400 py-4 text-center">
            Ask a question or leave a note for your AI team.
          </p>
        )}
        {visibleMessages.map((msg) => (
          <div
            key={msg.id}
            className={`text-xs rounded-lg px-3 py-2 max-w-sm ${
              msg.role === 'user'
                ? 'ml-auto bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-800'
            }`}
          >
            {msg.content}
          </div>
        ))}
        {assistantPending && (
          <div
            aria-live="polite"
            className="text-xs rounded-lg px-3 py-2 max-w-sm bg-gray-100 text-gray-500 italic"
          >
            Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="px-3 py-2 border-t border-gray-100 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Ask a question…"
          className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        <button
          onClick={() => void handleSend()}
          disabled={!input.trim() || sending}
          className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}

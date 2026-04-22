import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api.js';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

interface TaskChatPaneProps {
  taskId: string;
}

/**
 * Phase 2 — conversation-scope chat pane embedded in task detail view.
 * Uses the polymorphic conversations table with scopeType='task'.
 */
export function TaskChatPane({ taskId }: TaskChatPaneProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api
      .get<{ conversationId: string; messages: ChatMessage[] }>(
        `/api/conversations/task/${taskId}`,
      )
      .then((res) => {
        setConversationId(res.conversationId);
        setMessages(res.messages);
      })
      .catch(() => {});
  }, [taskId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!input.trim() || !conversationId || sending) return;
    const text = input.trim();
    setInput('');
    setSending(true);

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await api.post<{ message: ChatMessage }>(
        `/api/conversations/${conversationId}/messages`,
        { content: text },
      );
      setMessages((prev) => [...prev, res.message]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-64 border border-gray-200 rounded-lg bg-white">
      <div className="px-3 py-2 border-b border-gray-100">
        <p className="text-xs font-medium text-gray-600">Ask about this brief</p>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.filter((m) => m.role !== 'system').length === 0 && (
          <p className="text-xs text-gray-400 py-4 text-center">
            Ask a question or leave a note for your AI team.
          </p>
        )}
        {messages
          .filter((m) => m.role !== 'system')
          .map((msg) => (
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
        <div ref={bottomRef} />
      </div>
      <div className="px-3 py-2 border-t border-gray-100 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ask a question…"
          className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        <button
          onClick={() => void send()}
          disabled={!input.trim() || sending}
          className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}

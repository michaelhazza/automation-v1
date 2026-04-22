import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api.js';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

interface AgentRunChatPaneProps {
  runId: string;
  organisationId: string;
}

/**
 * Phase 7 — conversation-scope chat pane for agent-run detail view.
 * Embeds into the existing agent-run detail view alongside the execution log.
 * Uses the polymorphic conversations table with scopeType='agent_run'.
 */
export function AgentRunChatPane({ runId, organisationId: _organisationId }: AgentRunChatPaneProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load or create conversation for this run
    void api
      .get<{ conversationId: string; messages: ChatMessage[] }>(
        `/api/conversations/agent-run/${runId}`,
      )
      .then((res) => {
        setConversationId(res.data.conversationId);
        setMessages(res.data.messages);
      })
      .catch(() => {});
  }, [runId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!input.trim() || !conversationId || sending) return;
    const text = input.trim();
    setInput('');
    setSending(true);

    const tempId = crypto.randomUUID();
    const userMsg: ChatMessage = {
      id: tempId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      // The write endpoint returns { messageId, artefactsAccepted, artefactsRejected }
      // — no assistant reply is echoed back. Replace the optimistic row's id with
      // the server-issued id so later websocket / refetch merges dedupe correctly.
      const res = await api.post<{ messageId: string }>(
        `/api/conversations/${conversationId}/messages`,
        { content: text },
      );
      const serverId = res.data.messageId;
      if (serverId) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, id: serverId } : m)),
        );
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-64 border border-gray-200 rounded-lg bg-white">
      <div className="px-3 py-2 border-b border-gray-100">
        <p className="text-xs font-medium text-gray-600">Ask about this run</p>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 py-4 text-center">
            Ask "Why did you do this?" or "Show me the rule that applied."
          </p>
        )}
        {messages.map((msg) => (
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
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
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

import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api.js';

export type ConversationScopeType = 'task' | 'agent_run' | 'brief' | 'agent';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

export interface UseConversationResult {
  conversationId: string | null;
  messages: ChatMessage[];
  sending: boolean;
  // Deterministic "Thinking…" signal. True from the moment a user message is
  // POSTed until either the next assistant message lands in `messages` or the
  // next user send clears it. Not a reliability guarantee — a fallback timer
  // clears it after PENDING_TIMEOUT_MS to avoid a stuck-forever state if no
  // assistant reply ever arrives.
  assistantPending: boolean;
  send: (content: string) => Promise<void>;
}

const SCOPE_URL_SEGMENT: Record<ConversationScopeType, string> = {
  task: 'task',
  agent_run: 'agent-run',
  brief: 'brief',
  agent: 'agent',
};

const PENDING_TIMEOUT_MS = 15_000;

/**
 * Shared conversation state for scope-bound chat panes.
 * Conversations are a transport primitive — consumers must not depend on the
 * conversation-table structure for domain logic (see `server/db/schema/conversations.ts`).
 */
export function useConversation(
  scopeType: ConversationScopeType,
  scopeId: string | null | undefined,
): UseConversationResult {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [assistantPending, setAssistantPending] = useState(false);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingTimer = useCallback(() => {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!scopeId) return;
    const segment = SCOPE_URL_SEGMENT[scopeType];
    void api
      .get<{ conversationId: string; messages: ChatMessage[] }>(
        `/api/conversations/${segment}/${scopeId}`,
      )
      .then((res) => {
        setConversationId(res.data.conversationId);
        setMessages(res.data.messages);
      })
      .catch(() => {});
  }, [scopeType, scopeId]);

  useEffect(() => {
    if (!assistantPending) return;
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (lastAssistant) {
      setAssistantPending(false);
      clearPendingTimer();
    }
  }, [messages, assistantPending, clearPendingTimer]);

  useEffect(() => clearPendingTimer, [clearPendingTimer]);

  const send = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!text || !conversationId || sending) return;

      setSending(true);
      clearPendingTimer();

      const tempId = crypto.randomUUID();
      const userMsg: ChatMessage = {
        id: tempId,
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);

      try {
        const res = await api.post<{ messageId: string; assistantPending?: boolean }>(
          `/api/conversations/${conversationId}/messages`,
          { content: text },
        );
        const serverId = res.data.messageId;
        if (serverId) {
          setMessages((prev) =>
            prev.map((m) => (m.id === tempId ? { ...m, id: serverId } : m)),
          );
        }
        if (res.data.assistantPending) {
          setAssistantPending(true);
          pendingTimerRef.current = setTimeout(() => {
            setAssistantPending(false);
            pendingTimerRef.current = null;
          }, PENDING_TIMEOUT_MS);
        }
      } finally {
        setSending(false);
      }
    },
    [conversationId, sending, clearPendingTimer],
  );

  return { conversationId, messages, sending, assistantPending, send };
}

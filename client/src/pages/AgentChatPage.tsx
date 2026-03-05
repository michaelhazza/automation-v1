import React, { useEffect, useState, useRef, useCallback, KeyboardEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Agent {
  id: string;
  name: string;
  description?: string;
  modelId: string;
  status: string;
}

interface Conversation {
  id: string;
  agentId: string;
  userId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'tool_result';
  content?: string;
  triggeredExecutionId?: string;
  createdAt: string;
}

// ── Simple markdown-like renderer ──────────────────────────────────────────
function renderAssistantContent(text: string): React.ReactNode[] {
  // Split on triple-backtick code blocks first
  const codeBlockRegex = /```[\s\S]*?```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) parts.push(...renderInlineMarkdown(before, keyIdx++));
    const code = match[0].replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
    parts.push(
      <pre key={`code-${keyIdx++}`} style={{
        background: '#0f172a', color: '#e2e8f0',
        padding: '12px 16px', borderRadius: 8, fontSize: 12.5,
        overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        lineHeight: 1.6, margin: '8px 0',
        fontFamily: 'ui-monospace, monospace',
        border: '1px solid #1e293b',
      }}>
        <code>{code}</code>
      </pre>
    );
    lastIndex = match.index + match[0].length;
  }
  const remaining = text.slice(lastIndex);
  if (remaining) parts.push(...renderInlineMarkdown(remaining, keyIdx++));
  return parts;
}

function renderInlineMarkdown(text: string, baseKey: number): React.ReactNode[] {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  let i = 0;
  let k = baseKey * 10000;

  while (i < lines.length) {
    const line = lines[i];

    // List items: lines starting with "- "
    if (line.match(/^- .+/)) {
      const listItems: React.ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^- .+/)) {
        listItems.push(
          <li key={`li-${k++}`} style={{ marginBottom: 2 }}>
            {renderBold(lines[i].slice(2), k++)}
          </li>
        );
        i++;
      }
      result.push(
        <ul key={`ul-${k++}`} style={{ margin: '4px 0', paddingLeft: 20 }}>
          {listItems}
        </ul>
      );
      continue;
    }

    // Empty line → spacer
    if (line.trim() === '') {
      result.push(<br key={`br-${k++}`} />);
      i++;
      continue;
    }

    // Regular line with possible bold
    result.push(
      <span key={`line-${k++}`}>
        {renderBold(line, k++)}
        {i < lines.length - 1 && lines[i + 1] !== '' && !lines[i + 1].match(/^- /) ? <br /> : null}
      </span>
    );
    i++;
  }

  return result;
}

function renderBold(text: string, baseKey: number): React.ReactNode[] {
  const boldRegex = /\*\*(.+?)\*\*/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let k = baseKey * 100;

  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`txt-${k++}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    parts.push(<strong key={`bold-${k++}`}>{match[1]}</strong>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`txt-${k++}`}>{text.slice(lastIndex)}</span>);
  }
  return parts.length ? parts : [<span key={`txt-${k++}`}>{text}</span>];
}

// ── Typing indicator ────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, alignSelf: 'flex-start' }}>
      <div style={{
        background: '#fff', color: '#1e293b',
        borderRadius: '18px 18px 18px 4px',
        padding: '12px 16px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        display: 'flex', gap: 5, alignItems: 'center',
      }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#94a3b8',
            display: 'inline-block',
            animation: `typingBounce 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
      <style>{`
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
          30% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── Format date ─────────────────────────────────────────────────────────────
function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatConvDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── STARTER PROMPTS ─────────────────────────────────────────────────────────
const STARTERS = [
  'What can you help me with?',
  'Show me a summary of recent data',
  'Help me analyze this situation',
];

// ── Main component ──────────────────────────────────────────────────────────
export default function AgentChatPage({ user }: { user: User }) {
  const { id: agentId } = useParams<{ id: string }>();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [error, setError] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isInitializing = useRef(false);

  // Scroll to bottom of messages
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
  }, [input]);

  // Initial load: fetch agent + conversations
  useEffect(() => {
    if (!agentId || isInitializing.current) return;
    isInitializing.current = true;

    const load = async () => {
      try {
        const [agentRes, convsRes] = await Promise.all([
          api.get(`/api/agents/${agentId}`),
          api.get(`/api/agents/${agentId}/conversations`),
        ]);
        setAgent(agentRes.data);
        const convs: Conversation[] = convsRes.data;
        setConversations(convs);

        if (convs.length > 0) {
          setActiveConvId(convs[0].id);
        } else {
          // Auto-create a conversation
          const { data: newConv } = await api.post(`/api/agents/${agentId}/conversations`);
          setConversations([newConv]);
          setActiveConvId(newConv.id);
        }
      } catch (err) {
        setError('Failed to load agent.');
      } finally {
        setLoading(false);
        isInitializing.current = false;
      }
    };
    load();
  }, [agentId]);

  // Load messages when active conversation changes
  useEffect(() => {
    if (!agentId || !activeConvId) return;
    setLoadingMessages(true);
    setMessages([]);
    api.get(`/api/agents/${agentId}/conversations/${activeConvId}`)
      .then((res) => {
        // The endpoint may return { messages: [...] } or just an array
        const data = res.data;
        setMessages(Array.isArray(data) ? data : (data.messages ?? []));
      })
      .catch(() => setMessages([]))
      .finally(() => setLoadingMessages(false));
  }, [agentId, activeConvId]);

  const handleNewConversation = async () => {
    if (!agentId) return;
    try {
      const { data } = await api.post(`/api/agents/${agentId}/conversations`);
      setConversations((prev) => [data, ...prev]);
      setActiveConvId(data.id);
      setMessages([]);
    } catch {
      setError('Failed to create conversation.');
    }
  };

  const handleDeleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!agentId) return;
    try {
      await api.delete(`/api/agents/${agentId}/conversations/${convId}`);
      const remaining = conversations.filter((c) => c.id !== convId);
      setConversations(remaining);
      if (activeConvId === convId) {
        if (remaining.length > 0) {
          setActiveConvId(remaining[0].id);
        } else {
          // Auto-create new one
          const { data } = await api.post(`/api/agents/${agentId}/conversations`);
          setConversations([data]);
          setActiveConvId(data.id);
          setMessages([]);
        }
      }
    } catch {
      setError('Failed to delete conversation.');
    }
  };

  const handleSend = async (content?: string) => {
    const text = (content ?? input).trim();
    if (!text || !agentId || !activeConvId || sending) return;

    setInput('');
    setSending(true);
    setError('');

    // Optimistic user message
    const optimisticMsg: Message = {
      id: `opt-${Date.now()}`,
      conversationId: activeConvId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const { data } = await api.post(
        `/api/agents/${agentId}/conversations/${activeConvId}/messages`,
        { content: text }
      );

      // Replace optimistic + add response
      // data may be { userMessage, assistantMessage } or just the assistant message
      const userMsg: Message | undefined = data.userMessage;
      const assistantMsg: Message | undefined = data.assistantMessage ?? (data.role === 'assistant' ? data : undefined);

      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== optimisticMsg.id);
        const next = [...filtered];
        if (userMsg) next.push(userMsg);
        else next.push(optimisticMsg); // keep optimistic if server didn't return it
        if (assistantMsg) next.push(assistantMsg);
        return next;
      });

      // Update conversation list (title may have been set)
      const { data: updatedConvs } = await api.get(`/api/agents/${agentId}/conversations`);
      setConversations(updatedConvs);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to send message.');
      // Revert optimistic message
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', gap: 0 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e8ecf7', display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="skeleton" style={{ height: 18, width: 80, borderRadius: 6 }} />
          <div className="skeleton" style={{ height: 22, width: 160, borderRadius: 6 }} />
          <div className="skeleton" style={{ height: 20, width: 60, borderRadius: 9999 }} />
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="card empty-state" style={{ maxWidth: 400, margin: '40px auto' }}>
        <p style={{ fontWeight: 700, fontSize: 16, color: '#dc2626' }}>Agent not found</p>
        <Link to="/agents" className="btn btn-secondary" style={{ textDecoration: 'none', marginTop: 12 }}>
          Back to Agents
        </Link>
      </div>
    );
  }

  const activeConv = conversations.find((c) => c.id === activeConvId);
  const visibleMessages = messages.filter((m) => m.role !== 'tool_result');

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 64px)',
      background: '#f8fafc',
      overflow: 'hidden',
    }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 20px',
        background: '#fff',
        borderBottom: '1px solid #e8ecf7',
        flexShrink: 0,
        zIndex: 10,
      }}>
        <Link
          to="/agents"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            color: '#6366f1', textDecoration: 'none',
            fontSize: 13, fontWeight: 600,
            padding: '5px 10px', borderRadius: 8,
            background: '#f5f3ff',
            border: '1px solid #c7d2fe',
            flexShrink: 0,
            transition: 'background 0.15s',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Agents
        </Link>

        <div style={{ width: 1, height: 22, background: '#e2e8f0', flexShrink: 0 }} />

        <div style={{ fontWeight: 700, fontSize: 16, color: '#0f172a', letterSpacing: '-0.01em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agent.name}
        </div>

        {/* Status pill */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '3px 9px', borderRadius: 9999,
          background: agent.status === 'active' ? '#f0fdf4' : '#f8fafc',
          border: `1px solid ${agent.status === 'active' ? '#bbf7d0' : '#e2e8f0'}`,
          fontSize: 11.5, fontWeight: 600,
          color: agent.status === 'active' ? '#15803d' : '#64748b',
          flexShrink: 0,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: agent.status === 'active' ? '#22c55e' : '#94a3b8',
          }} />
          {agent.status === 'active' ? 'Active' : agent.status}
        </span>

        {/* Model name */}
        <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'ui-monospace, monospace', flexShrink: 0 }}>
          {agent.modelId}
        </span>

        {/* Sidebar toggle (always visible, controls sidebar) */}
        <button
          onClick={() => setSidebarVisible((v) => !v)}
          title={sidebarVisible ? 'Hide conversations' : 'Show conversations'}
          style={{
            marginLeft: 'auto',
            background: sidebarVisible ? '#f5f3ff' : 'none',
            border: `1px solid ${sidebarVisible ? '#c7d2fe' : '#e2e8f0'}`,
            borderRadius: 8,
            cursor: 'pointer',
            color: sidebarVisible ? '#6366f1' : '#94a3b8',
            display: 'flex', alignItems: 'center', padding: '5px 8px',
            flexShrink: 0,
            transition: 'all 0.15s',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </button>
      </div>

      {/* ── Body: chat + sidebar ─────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* ── Chat area ─────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

          {/* Messages */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 0',
          }}>
            {loadingMessages ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <div style={{ width: 28, height: 28, border: '3px solid #e2e8f0', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              </div>
            ) : visibleMessages.length === 0 && !sending ? (
              // Empty state
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '100%', padding: '40px 24px',
                textAlign: 'center',
              }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 18, marginBottom: 20,
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                  </svg>
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 8 }}>
                  {agent.name}
                </div>
                <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 28px', maxWidth: 340 }}>
                  {agent.description ?? 'Start a conversation to get help from this AI employee.'}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 360 }}>
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleSend(s)}
                      style={{
                        background: '#fff',
                        border: '1px solid #e2e8f0',
                        borderRadius: 12,
                        padding: '11px 16px',
                        fontSize: 13.5,
                        color: '#374151',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontWeight: 500,
                        transition: 'border-color 0.15s, box-shadow 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.borderColor = '#a5b4fc';
                        (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 0 3px rgba(99,102,241,0.08)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.borderColor = '#e2e8f0';
                        (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 24px 8px' }}>
                {visibleMessages.map((msg) => (
                  <div key={msg.id} style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    gap: 4,
                  }}>
                    <div style={
                      msg.role === 'user'
                        ? {
                          background: '#6366f1', color: '#fff',
                          borderRadius: '18px 18px 4px 18px',
                          padding: '10px 14px', maxWidth: '70%',
                          alignSelf: 'flex-end',
                          fontSize: 14, lineHeight: 1.55,
                          wordBreak: 'break-word',
                        }
                        : {
                          background: '#fff', color: '#1e293b',
                          borderRadius: '18px 18px 18px 4px',
                          padding: '10px 14px', maxWidth: '75%',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                          alignSelf: 'flex-start',
                          fontSize: 14, lineHeight: 1.55,
                          wordBreak: 'break-word',
                        }
                    }>
                      {msg.role === 'user'
                        ? (msg.content ?? '').split('\n').map((line, i, arr) => (
                          <span key={i}>{line}{i < arr.length - 1 ? <br /> : null}</span>
                        ))
                        : renderAssistantContent(msg.content ?? '')
                      }
                    </div>

                    {/* Tool use indicator */}
                    {msg.triggeredExecutionId && (
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 7,
                        background: 'linear-gradient(135deg, #f0f9ff, #f5f3ff)',
                        border: '1px solid #c7d2fe',
                        borderRadius: 10,
                        padding: '7px 12px',
                        fontSize: 12, fontWeight: 600, color: '#4f46e5',
                        alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '75%',
                      }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                        Triggered automation · Execution {msg.triggeredExecutionId} queued
                      </div>
                    )}

                    {/* Timestamp */}
                    <div style={{
                      fontSize: 11, color: '#94a3b8',
                      paddingLeft: msg.role === 'user' ? 0 : 2,
                      paddingRight: msg.role === 'user' ? 2 : 0,
                      alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    }}>
                      {formatTime(msg.createdAt)}
                    </div>
                  </div>
                ))}

                {/* Typing indicator */}
                {sending && <TypingIndicator />}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Error banner */}
          {error && (
            <div style={{
              margin: '0 24px 8px',
              background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 9,
              padding: '9px 12px',
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#dc2626',
              flexShrink: 0,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
              <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 16, lineHeight: 1 }}>×</button>
            </div>
          )}

          {/* ── Input bar ─────────────────────────────────────────────────── */}
          <div style={{
            padding: '12px 20px 16px',
            background: '#fff',
            borderTop: '1px solid #e8ecf7',
            flexShrink: 0,
          }}>
            <div style={{
              display: 'flex', alignItems: 'flex-end', gap: 10,
              background: '#f8fafc',
              border: '1.5px solid #e2e8f0',
              borderRadius: 14,
              padding: '8px 8px 8px 14px',
              transition: 'border-color 0.15s',
            }}
              onFocus={() => {}}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
                disabled={sending || !activeConvId}
                rows={1}
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  resize: 'none',
                  fontSize: 14,
                  color: '#1e293b',
                  lineHeight: 1.55,
                  maxHeight: 150,
                  overflowY: 'auto',
                  padding: 0,
                  fontFamily: 'inherit',
                }}
              />
              <button
                onClick={() => handleSend()}
                disabled={sending || !input.trim() || !activeConvId}
                style={{
                  background: sending || !input.trim() ? '#c7d2fe' : '#6366f1',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  width: 38,
                  height: 38,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: sending || !input.trim() ? 'not-allowed' : 'pointer',
                  flexShrink: 0,
                  transition: 'background 0.15s',
                }}
              >
                {sending ? (
                  <div style={{ width: 15, height: 15, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ── Conversations sidebar ──────────────────────────────────────── */}
        {sidebarVisible && (
          <div style={{
            width: 220,
            flexShrink: 0,
            background: '#fff',
            borderLeft: '1px solid #e8ecf7',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {/* Sidebar header */}
            <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
              <button
                onClick={handleNewConversation}
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', fontSize: 12.5, padding: '8px 12px' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Conversation
              </button>
            </div>

            {/* Conversation list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
              {conversations.length === 0 ? (
                <div style={{ padding: '16px 8px', fontSize: 12.5, color: '#94a3b8', textAlign: 'center' }}>
                  No conversations yet
                </div>
              ) : (
                conversations.map((conv) => {
                  const isActive = conv.id === activeConvId;
                  return (
                    <div
                      key={conv.id}
                      onClick={() => setActiveConvId(conv.id)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 6,
                        padding: '8px 10px', borderRadius: 10, marginBottom: 2,
                        cursor: 'pointer',
                        background: isActive ? '#f5f3ff' : 'transparent',
                        border: `1px solid ${isActive ? '#c7d2fe' : 'transparent'}`,
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) (e.currentTarget as HTMLDivElement).style.background = '#f8fafc';
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12.5, fontWeight: isActive ? 700 : 500,
                          color: isActive ? '#4f46e5' : '#374151',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          lineHeight: 1.3, marginBottom: 2,
                        }}>
                          {conv.title ?? 'New conversation'}
                        </div>
                        <div style={{ fontSize: 10.5, color: '#94a3b8' }}>
                          {formatConvDate(conv.updatedAt ?? conv.createdAt)}
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDeleteConversation(conv.id, e)}
                        title="Delete conversation"
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: '#cbd5e1', fontSize: 16, lineHeight: 1,
                          padding: '0 2px', flexShrink: 0, marginTop: 1,
                          transition: 'color 0.1s',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#cbd5e1'; }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useEffect, useState, useRef, useCallback, KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import { useSocketRoom } from '../hooks/useSocket';
import ConfigPlanPreview, { type ConfigPlan } from '../components/ConfigPlanPreview';
import ConfigUpdateToolResult, {
  parseConfigUpdateToolResult,
} from '../components/config-assistant/toolResultRenderers/ConfigUpdateToolResult';

// ── Types ────────────────────────────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
  description?: string;
  modelId: string;
  status: string;
  isSystemManaged?: boolean;
  slug?: string;
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

// ── Simple markdown renderer (mirrors AgentChatPage) ─────────────────────────

function renderAssistantContent(text: string): React.ReactNode[] {
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
      <pre key={`code-${keyIdx++}`} className="bg-slate-900 text-slate-200 px-4 py-3 rounded-lg text-[12.5px] overflow-auto whitespace-pre-wrap break-words leading-relaxed my-2 font-mono border border-slate-800">
        <code>{code}</code>
      </pre>
    );
    lastIndex = match.index + match[0].length;
  }
  const remaining = text.slice(lastIndex);
  if (remaining) parts.push(...renderInlineMarkdown(remaining, keyIdx));
  return parts;
}

function renderInlineMarkdown(text: string, baseKey: number): React.ReactNode[] {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  let i = 0;
  let k = baseKey * 10000;

  while (i < lines.length) {
    const line = lines[i];
    if (line.match(/^- .+/)) {
      const listItems: React.ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^- .+/)) {
        listItems.push(<li key={`li-${k++}`} className="mb-0.5">{renderBold(lines[i].slice(2), k++)}</li>);
        i++;
      }
      result.push(<ul key={`ul-${k++}`} className="my-1 pl-5">{listItems}</ul>);
      continue;
    }
    if (line.trim() === '') { result.push(<br key={`br-${k++}`} />); i++; continue; }
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
    if (match.index > lastIndex) parts.push(<span key={`txt-${k++}`}>{text.slice(lastIndex, match.index)}</span>);
    parts.push(<strong key={`bold-${k++}`}>{match[1]}</strong>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(<span key={`txt-${k++}`}>{text.slice(lastIndex)}</span>);
  return parts.length ? parts : [<span key={`txt-${k}`}>{text}</span>];
}

// ── Typing indicator ─────────────────────────────────────────────────────────

const BOUNCE_DELAY_CLS = ['[animation-delay:0s]', '[animation-delay:0.2s]', '[animation-delay:0.4s]'];

function TypingIndicator() {
  return (
    <>
      <div className="flex items-end gap-2 self-start">
        <div className="bg-white text-slate-800 rounded-[18px_18px_18px_4px] px-4 py-3 shadow-sm flex gap-1.5 items-center">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`w-1.5 h-1.5 rounded-full bg-slate-400 inline-block [animation:typingBounce_1.2s_ease-in-out_infinite] ${BOUNCE_DELAY_CLS[i]}`} />
          ))}
        </div>
      </div>
      <style>{`
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
          30% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatConvDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Try to extract a JSON config plan from a code block in an assistant message. */
function extractPlan(content: string): ConfigPlan | null {
  // Only parse JSON from code blocks — avoids false positives on free-text JSON
  const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (!codeBlockMatch) return null;
  try {
    const parsed = JSON.parse(codeBlockMatch[1]);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.steps) && parsed.summary) {
      return parsed as ConfigPlan;
    }
  } catch {
    // Not valid JSON or not a plan
  }
  return null;
}

// ── Suggested actions ────────────────────────────────────────────────────────

const STARTERS = [
  'Set up a new client workspace',
  'Show me the current agent configuration',
  'Run a health check on my setup',
  'Help me configure reporting for a client',
];

// ── Component ────────────────────────────────────────────────────────────────

export default function ConfigAssistantPage({ user: _user }: { user: User }) {
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

  // Plan preview state
  const [activePlan, setActivePlan] = useState<ConfigPlan | null>(null);
  const [executingPlan, setExecutingPlan] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isInitializing = useRef(false);

  const agentId = agent?.id;

  const scrollToBottom = useCallback(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, []);
  useEffect(() => { scrollToBottom(); }, [messages, sending, scrollToBottom]);

  // WebSocket: listen for live conversation updates
  useSocketRoom('conversation', activeConvId, {
    'conversation:typing': (data: unknown) => {
      const d = data as { isTyping?: boolean };
      if (d.isTyping && !sending) setSending(true);
    },
    'conversation:message': (data: unknown) => {
      const d = data as { message?: Message };
      if (d.message) {
        setMessages(prev => {
          if (prev.some(m => m.id === d.message!.id)) return prev;
          return [...prev, d.message!];
        });
        setSending(false);
        // Check if the message contains a plan
        if (d.message.role === 'assistant' && d.message.content) {
          const plan = extractPlan(d.message.content);
          if (plan) setActivePlan(plan);
        }
      }
    },
    'conversation:tool_use': () => {
      // Keep typing indicator visible during tool execution
    },
  });

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
  }, [input]);

  // ── Initialisation: find config agent, load conversations ────────────────
  useEffect(() => {
    if (isInitializing.current) return;
    isInitializing.current = true;

    const load = async () => {
      try {
        // Find the Configuration Assistant agent by slug
        const { data: allAgents } = await api.get<Agent[]>('/api/agents');
        const configAgent = allAgents.find(
          (a) => a.isSystemManaged && a.slug === 'configuration-assistant'
        ) ?? allAgents.find(
          (a) => a.isSystemManaged && a.name === 'Configuration Assistant'
        );

        if (!configAgent) {
          setError('Configuration Assistant agent not found. Ensure the module is enabled.');
          setLoading(false);
          isInitializing.current = false;
          return;
        }

        setAgent(configAgent);

        // Spec contract (k) — when the page loads inside the popup iframe,
        // the popup appends `updatedAfter=<iso>` to enforce the 15-minute
        // resume window. Forward it to the listing endpoint; the full-page
        // route (no popup) omits it and sees all conversations as before.
        const urlParams = new URLSearchParams(window.location.search);
        const updatedAfter = urlParams.get('updatedAfter');
        const listUrl = updatedAfter
          ? `/api/agents/${configAgent.id}/conversations?updatedAfter=${encodeURIComponent(updatedAfter)}&order=updated_desc&limit=1`
          : `/api/agents/${configAgent.id}/conversations`;

        const { data: convs } = await api.get<Conversation[]>(listUrl);
        setConversations(convs);
        if (convs.length > 0) {
          setActiveConvId(convs[0].id);
        } else {
          const { data: newConv } = await api.post(`/api/agents/${configAgent.id}/conversations`);
          setConversations([newConv]);
          setActiveConvId(newConv.id);
        }
      } catch {
        setError('Failed to load Configuration Assistant.');
      } finally {
        setLoading(false);
        isInitializing.current = false;
      }
    };
    load();
  }, []);

  // Load messages when active conversation changes
  useEffect(() => {
    if (!agentId || !activeConvId) return;
    setLoadingMessages(true);
    setMessages([]);
    setActivePlan(null);
    api.get(`/api/agents/${agentId}/conversations/${activeConvId}`)
      .then((res) => {
        const data = res.data;
        setMessages(Array.isArray(data) ? data : (data.messages ?? []));
      })
      .catch(() => setMessages([]))
      .finally(() => setLoadingMessages(false));
  }, [agentId, activeConvId]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleNewConversation = async () => {
    if (!agentId) return;
    try {
      const { data } = await api.post(`/api/agents/${agentId}/conversations`);
      setConversations((prev) => [data, ...prev]);
      setActiveConvId(data.id);
      setMessages([]);
      setActivePlan(null);
    } catch { setError('Failed to create conversation.'); }
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
          const { data } = await api.post(`/api/agents/${agentId}/conversations`);
          setConversations([data]);
          setActiveConvId(data.id);
          setMessages([]);
        }
      }
    } catch { setError('Failed to delete conversation.'); }
  };

  const handleSend = async (content?: string) => {
    const text = (content ?? input).trim();
    if (!text || !agentId || !activeConvId || sending) return;
    setInput('');
    setSending(true);
    setError('');
    setActivePlan(null);

    const optimisticMsg: Message = {
      id: `opt-${Date.now()}`,
      conversationId: activeConvId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const { data } = await api.post(`/api/agents/${agentId}/conversations/${activeConvId}/messages`, { content: text });
      const userMsg: Message | undefined = data.userMessage;
      const assistantMsg: Message | undefined = data.assistantMessage ?? (data.role === 'assistant' ? data : undefined);
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== optimisticMsg.id);
        const next = [...filtered];
        if (userMsg) next.push(userMsg); else next.push(optimisticMsg);
        if (assistantMsg) next.push(assistantMsg);
        return next;
      });
      // Check for plan in response
      if (assistantMsg?.content) {
        const plan = extractPlan(assistantMsg.content);
        if (plan) setActivePlan(plan);
      }
      const { data: updatedConvs } = await api.get(`/api/agents/${agentId}/conversations`);
      setConversations(updatedConvs);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to send message.');
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
    } finally {
      setSending(false);
    }
  };

  const handleExecutePlan = async (approvedSteps: number[]) => {
    if (!agentId || !activeConvId || !activePlan) return;
    setExecutingPlan(true);
    const planDescription = `Execute the approved plan steps: ${approvedSteps.join(', ')} (out of ${activePlan.steps.length} total)`;
    await handleSend(planDescription);
    setExecutingPlan(false);
    setActivePlan(null);
  };

  const handleCancelPlan = () => {
    setActivePlan(null);
    // Only send cancel message if not currently mid-send (avoids silent no-op)
    if (!sending) {
      handleSend('Cancel the proposed plan.');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── Loading / error states ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)]">
        <div className="px-6 py-3 border-b border-slate-200 flex gap-3 items-center">
          <div className="h-[18px] w-20 rounded bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
          <div className="h-[22px] w-40 rounded bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-[3px] border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl py-14 px-8 flex flex-col items-center text-center max-w-[400px] mx-auto mt-10">
        <p className="font-bold text-[16px] text-red-600 mb-3">Configuration Assistant not available</p>
        <p className="text-[13px] text-slate-500 mb-4">{error || 'The Configuration Assistant module may not be enabled for this organisation.'}</p>
        <Link to="/" className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm no-underline transition-colors">Back to Dashboard</Link>
      </div>
    );
  }

  const visibleMessages = messages.filter((m) => m.role !== 'tool_result');

  // Session 2 §6.3 — surface the latest config_update_organisation_config
  // tool result inline with dual-path UX copy (applied inline vs queued for
  // review vs error). Non-matching tool_result shapes stay filtered.
  const latestConfigUpdateResult = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'tool_result' || !m.content) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(m.content);
      } catch {
        continue;
      }
      const kind = parseConfigUpdateToolResult(parsed).kind;
      if (kind !== 'unknown') return { id: m.id, result: parsed };
    }
    return null;
  })();

  return (
    <div className="flex flex-col bg-slate-50 overflow-hidden h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="flex items-center gap-3.5 px-5 py-3 bg-white border-b border-slate-200 shrink-0 z-10">
        <Link to="/" className="inline-flex items-center gap-1 text-indigo-600 no-underline text-[13px] font-semibold px-2.5 py-1.5 rounded-lg bg-violet-50 border border-indigo-200 shrink-0 transition-colors hover:bg-violet-100">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          Back
        </Link>
        <div className="w-px h-5.5 bg-slate-200 shrink-0" />
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </div>
        <div className="font-bold text-[16px] text-slate-900 tracking-tight">Configuration Assistant</div>
        <span className="text-[12px] text-slate-400 font-mono shrink-0">{agent.modelId}</span>
        <button
          onClick={() => setSidebarVisible((v) => !v)}
          title={sidebarVisible ? 'Hide conversations' : 'Show conversations'}
          className={`ml-auto flex items-center p-1.5 rounded-lg border cursor-pointer transition-colors shrink-0 ${sidebarVisible ? 'bg-violet-50 border-indigo-200 text-indigo-600' : 'bg-transparent border-slate-200 text-slate-400 hover:text-slate-600'}`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Conversations sidebar */}
        {sidebarVisible && (
          <div className="w-[220px] shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
            <div className="px-3.5 pt-3.5 pb-2.5 border-b border-slate-100 shrink-0">
              <button
                onClick={handleNewConversation}
                className="w-full btn btn-sm btn-primary"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Session
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {conversations.length === 0 ? (
                <div className="px-2 py-4 text-[12.5px] text-slate-400 text-center">No sessions yet</div>
              ) : (
                conversations.map((conv) => {
                  const isActive = conv.id === activeConvId;
                  return (
                    <div
                      key={conv.id}
                      onClick={() => setActiveConvId(conv.id)}
                      className={`flex items-start gap-1.5 px-2.5 py-2 rounded-xl mb-0.5 cursor-pointer border transition-colors ${isActive ? 'bg-violet-50 border-indigo-200' : 'bg-transparent border-transparent hover:bg-slate-50'}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className={`text-[12.5px] truncate leading-snug mb-0.5 ${isActive ? 'font-bold text-indigo-700' : 'font-medium text-slate-700'}`}>
                          {conv.title ?? 'New session'}
                        </div>
                        <div className="text-[10.5px] text-slate-400">{formatConvDate(conv.updatedAt ?? conv.createdAt)}</div>
                      </div>
                      <button
                        onClick={(e) => handleDeleteConversation(conv.id, e)}
                        title="Delete session"
                        className="bg-transparent border-0 cursor-pointer text-slate-300 hover:text-red-400 text-base leading-none px-0.5 shrink-0 mt-0.5 transition-colors"
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

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto py-5">
            {loadingMessages ? (
              <div className="flex justify-center p-10">
                <div className="w-7 h-7 border-[3px] border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
              </div>
            ) : visibleMessages.length === 0 && !sending ? (
              <div className="flex flex-col items-center justify-center h-full px-6 py-10 text-center">
                <div className="w-16 h-16 rounded-[18px] mb-5 flex items-center justify-center bg-gradient-to-br from-indigo-500 to-violet-500">
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </div>
                <div className="text-[22px] font-extrabold text-slate-900 tracking-tight mb-2">Configuration Assistant</div>
                <p className="text-[14px] text-slate-500 mb-7 max-w-[380px]">
                  Set up agents, configure schedules, manage data sources, and more — all through conversation.
                </p>
                <div className="flex flex-col gap-2 w-full max-w-[360px]">
                  {STARTERS.map((s) => (
                    <button key={s} onClick={() => handleSend(s)} className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-[13.5px] text-slate-700 cursor-pointer text-left font-medium transition-all hover:border-indigo-300 hover:shadow-sm">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 px-6 pb-2">
                {visibleMessages.map((msg) => (
                  <div key={msg.id} className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`text-[14px] leading-relaxed break-words max-w-[70%] px-3.5 py-2.5 ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white self-end rounded-[18px_18px_4px_18px]'
                          : 'bg-white text-slate-800 shadow-sm self-start rounded-[18px_18px_18px_4px]'
                      }`}
                    >
                      {msg.role === 'user'
                        ? (msg.content ?? '').split('\n').map((line, i, arr) => <span key={i}>{line}{i < arr.length - 1 ? <br /> : null}</span>)
                        : renderAssistantContent(msg.content ?? '')
                      }
                    </div>
                    <div className={`text-[11px] text-slate-400 ${msg.role === 'user' ? 'pr-0.5 self-end' : 'pl-0.5 self-start'}`}>
                      {formatTime(msg.createdAt)}
                    </div>
                  </div>
                ))}

                {/* Session 2 §6.3 — dual-path UX renderer for the latest
                    config_update_organisation_config tool result. */}
                {latestConfigUpdateResult && (
                  <div key={latestConfigUpdateResult.id} className="self-start max-w-[75%]">
                    <ConfigUpdateToolResult result={latestConfigUpdateResult.result} />
                  </div>
                )}

                {/* Plan preview overlay */}
                {activePlan && (
                  <div className="self-start">
                    <ConfigPlanPreview
                      plan={activePlan}
                      onExecute={handleExecutePlan}
                      onCancel={handleCancelPlan}
                      executing={executingPlan}
                    />
                  </div>
                )}

                {sending && <TypingIndicator />}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Error banner */}
          {error && (
            <div className="mx-6 mb-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 flex items-center gap-2 text-[13px] text-red-600 shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
              <button onClick={() => setError('')} className="ml-auto bg-transparent border-0 cursor-pointer text-red-600 text-lg leading-none">×</button>
            </div>
          )}

          {/* Input bar */}
          <div className="px-5 pt-3 pb-4 bg-white border-t border-slate-200 shrink-0">
            <div className="flex items-end gap-2.5 bg-slate-50 border-[1.5px] border-slate-200 rounded-2xl px-3.5 py-2 transition-colors focus-within:border-indigo-300">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe what you'd like to configure…"
                disabled={sending || !activeConvId}
                rows={1}
                className="flex-1 bg-transparent border-0 outline-none resize-none text-[14px] text-slate-800 leading-relaxed max-h-[150px] overflow-y-auto p-0 font-[inherit]"
              />
              <button
                onClick={() => handleSend()}
                disabled={sending || !input.trim() || !activeConvId}
                className={`btn-icon btn-primary shrink-0 ${sending || !input.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {sending ? (
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

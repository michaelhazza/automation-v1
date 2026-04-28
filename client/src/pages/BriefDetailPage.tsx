import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api.js';
import { useSocketRoom } from '../hooks/useSocket.js';
import { resolveLifecyclePure } from '../lib/briefArtefactLifecycle.js';
import type { BriefChatArtefact, BriefStructuredResult, BriefApprovalCard, BriefApprovalDecision, BriefErrorResult } from '../../../shared/types/briefResultContract.js';
import type { ArtefactChainState } from '../lib/briefArtefactLifecyclePure.js';
import { StructuredResultCard } from '../components/brief-artefacts/StructuredResultCard.js';
import { ApprovalCard } from '../components/brief-artefacts/ApprovalCard.js';
import { ErrorArtefactCard } from '../components/brief-artefacts/ErrorArtefactCard.js';
import { briefStatusLabel } from '../components/BriefLabel.js';
import DelegationGraphView from '../components/run-trace/DelegationGraphView.js';

interface BriefMeta {
  id: string;
  title: string;
  status: string;
  conversationId: string | null;
}

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  artefacts: BriefChatArtefact[];
  createdAt: string;
}

interface User {
  id: string;
  role: string;
}

interface BriefDetailPageProps {
  user: User;
}

/**
 * Merge a single artefact into a list, deduplicating by `artefactId`.
 *
 * Rationale: artefacts can arrive from up to two sources for the same logical
 * event — the optimistic POST-success path in `handleApprovalDecision`, and
 * the `brief-artefact:new` / `brief-artefact:updated` websocket events. Without
 * dedup the same `artefactId` can render twice (one optimistic, one WS-confirmed).
 *
 * Replace-or-append semantics: if the incoming artefact's id already exists in
 * the list, replace the entry in place; otherwise append. Replace-in-place is
 * the right policy because the WS-confirmed copy is authoritative — it carries
 * server-side fields (timestamps, derived state) that the optimistic copy
 * may not.
 *
 * Ordering: when the incoming artefact carries a server-stamped
 * `serverCreatedAt`, the merged list is re-sorted by that field so the
 * timeline reflects logical write order rather than WS arrival order. This
 * matters when distinct-artefactId events arrive out of order (delayed WS
 * delivery, multi-emitter race). Optimistic inserts that lack a server
 * timestamp skip the re-sort to avoid visible reflow before the
 * WS-confirmed copy lands. ISO-8601 lexicographic compare is correct
 * chronological order.
 */
function mergeArtefactById(
  prev: BriefChatArtefact[],
  incoming: BriefChatArtefact,
): BriefChatArtefact[] {
  const idx = prev.findIndex((a) => a.artefactId === incoming.artefactId);
  const merged = idx === -1
    ? [...prev, incoming]
    : (() => {
        const next = prev.slice();
        next[idx] = incoming;
        return next;
      })();

  if (!incoming.serverCreatedAt) return merged;

  return [...merged].sort((a, b) => {
    const ta = a.serverCreatedAt;
    const tb = b.serverCreatedAt;
    // Primary: server timestamp (chronological). When both present.
    if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
    // Tiebreak: artefactId lex order. Required to keep order STABLE across
    // multiple WS update rounds — without a deterministic secondary key,
    // entries with equal (or both-missing) timestamps can oscillate as
    // successive WS events trigger re-sort, producing visible flicker.
    // artefactId is unique per artefact and never changes after creation,
    // so it's the correct stable tiebreaker.
    if (ta && !tb) return -1;  // a stamped, b not → a first
    if (!ta && tb) return 1;   // b stamped, a not → b first
    return a.artefactId < b.artefactId ? -1 : a.artefactId > b.artefactId ? 1 : 0;
  });
}

function ArtefactItem({ artefact, isSuperseded, onSuggestionClick, onApprove, onReject }: {
  artefact: BriefChatArtefact;
  isSuperseded: boolean;
  onSuggestionClick: (intent: string) => void;
  onApprove?: (artefactId: string) => void;
  onReject?: (artefactId: string) => void;
}) {
  if (artefact.kind === 'structured') {
    return <StructuredResultCard artefact={artefact as BriefStructuredResult} isSuperseded={isSuperseded} onSuggestionClick={onSuggestionClick} />;
  }
  if (artefact.kind === 'approval') {
    return <ApprovalCard artefact={artefact as BriefApprovalCard} isSuperseded={isSuperseded} onApprove={onApprove} onReject={onReject} />;
  }
  if (artefact.kind === 'error') {
    return <ErrorArtefactCard artefact={artefact as BriefErrorResult} />;
  }
  return null;
}

export default function BriefDetailPage({ user: _user }: BriefDetailPageProps) {
  const { briefId } = useParams<{ briefId: string }>();
  const [brief, setBrief] = useState<BriefMeta | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [artefacts, setArtefacts] = useState<BriefChatArtefact[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [chainState, setChainState] = useState<ArtefactChainState>({ artefacts: [] });
  const [reply, setReply] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [showGraph, setShowGraph] = useState(true);
  // Ref avoids stale closure inside the polling timer callbacks
  const activeRunIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!briefId) return;
    try {
      const [briefRes, artefactsRes] = await Promise.all([
        api.get<BriefMeta>(`/api/briefs/${briefId}`),
        api.get<{ items: BriefChatArtefact[]; nextCursor: string | null }>(`/api/briefs/${briefId}/artefacts?limit=50`),
      ]);

      setBrief(briefRes.data);

      const fetchedArtefacts = artefactsRes.data.items ?? [];
      setNextCursor(artefactsRes.data.nextCursor ?? null);
      setArtefacts(fetchedArtefacts);
      setChainState({ artefacts: fetchedArtefacts });

      if (briefRes.data.conversationId) {
        const convRes = await api.get<{ conversation: { id: string }; messages: ConversationMessage[] }>(
          `/api/conversations/${briefRes.data.conversationId}`,
        );
        setMessages(convRes.data.messages ?? []);
      }
    } finally {
      setIsLoading(false);
    }
  }, [briefId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  useEffect(() => {
    if (!briefId) return;
    let cancelled = false;

    const fetchActiveRun = async () => {
      try {
        const { data } = await api.get<{ runId: string | null }>(
          `/api/briefs/${briefId}/active-run`,
        );
        if (!cancelled) setActiveRunId(data.runId);
      } catch {
        // non-fatal — graph panel stays hidden
      }
    };

    // Exponential backoff: first check at 500 ms, doubles each time up to 4 s max.
    // Gives fast perceived responsiveness without hammering the server.
    let delay = 500;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (cancelled || activeRunIdRef.current) return;
        await fetchActiveRun();
        delay = Math.min(delay * 2, 4000);
        schedule();
      }, delay);
    };
    void fetchActiveRun();
    schedule();

    return () => { cancelled = true; clearTimeout(timer); };
  }, [briefId]); // activeRunId intentionally omitted — read via ref to avoid timer restart

  useSocketRoom(
    'brief',
    briefId ?? null,
    {
      'brief-artefact:new': (data: unknown) => {
        const payload = data as { artefact?: BriefChatArtefact };
        if (payload.artefact) {
          const art = payload.artefact;
          setArtefacts((prev: BriefChatArtefact[]) => {
            const next = mergeArtefactById(prev, art);
            setChainState({ artefacts: next });
            return next;
          });
        }
      },
      'brief-artefact:updated': (data: unknown) => {
        const payload = data as { artefact?: BriefChatArtefact };
        if (payload.artefact) {
          const art = payload.artefact;
          setArtefacts((prev: BriefChatArtefact[]) => {
            const next = mergeArtefactById(prev, art);
            setChainState({ artefacts: next });
            return next;
          });
        }
      },
    },
    load,
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, artefacts]);

  const resolved = resolveLifecyclePure(chainState);
  const supersededIds = new Set<string>();
  for (const list of resolved.superseded.values()) {
    for (const a of list) supersededIds.add(a.artefactId);
  }

  const handleSuggestionClick = (intent: string): void => { setReply(intent); };

  const handleSendReply = async (e: { preventDefault: () => void }): Promise<void> => {
    e.preventDefault();
    if (!reply.trim() || isSending || !brief?.conversationId) return;
    setIsSending(true);
    try {
      await api.post(`/api/briefs/${briefId}/messages`, {
        content: reply.trim(),
        conversationId: brief.conversationId,
        uiContext: { surface: 'brief_chat' },
      });
      setReply('');
      await load();
    } finally {
      setIsSending(false);
    }
  };

  const handleApprovalDecision = async (artefactId: string, decision: 'approve' | 'reject'): Promise<void> => {
    if (!brief?.conversationId) return;
    try {
      const res = await api.post<{ status: string; artefact?: BriefApprovalDecision }>(
        `/api/briefs/${briefId}/approvals/${artefactId}/decision`,
        { decision, conversationId: brief.conversationId },
      );
      const decisionArtefact = res.data?.artefact;
      if (decisionArtefact) {
        setArtefacts((prev) => {
          const next = mergeArtefactById(prev, decisionArtefact);
          setChainState({ artefacts: next });
          return next;
        });
      }
    } catch {
      // Non-200 responses (409, 410, etc.) surface via WS brief-artefact:updated events
    }
  };

  const handleApprove = (artefactId: string): void => { void handleApprovalDecision(artefactId, 'approve'); };
  const handleReject = (artefactId: string): void => { void handleApprovalDecision(artefactId, 'reject'); };

  const handleLoadOlder = async (): Promise<void> => {
    if (!briefId || !nextCursor || isLoadingOlder) return;
    setIsLoadingOlder(true);
    try {
      const res = await api.get<{ items: BriefChatArtefact[]; nextCursor: string | null }>(
        `/api/briefs/${briefId}/artefacts?limit=50&cursor=${encodeURIComponent(nextCursor)}`,
      );
      const olderItems = res.data.items ?? [];
      setNextCursor(res.data.nextCursor ?? null);
      setArtefacts((prev) => {
        const next = [...olderItems, ...prev];
        setChainState({ artefacts: next });
        return next;
      });
    } finally {
      setIsLoadingOlder(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 text-sm">
        <Link to="/" className="text-gray-400 hover:text-gray-600">Briefs</Link>
        {brief?.title && <><span className="text-gray-300">/</span><span className="text-gray-600 truncate">{brief.title}</span></>}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left — chat panel */}
        <div className={`flex flex-col min-h-0 transition-all ${activeRunId && showGraph ? 'w-1/2 border-r border-gray-100' : 'w-full max-w-3xl mx-auto'}`}>
          <div className="px-4 pt-4 pb-2 shrink-0">
            <h1 className="text-lg font-semibold text-gray-900">{brief?.title ?? 'Brief'}</h1>
            {brief?.status && <span className="text-xs text-gray-500">{briefStatusLabel(brief.status)}</span>}
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
            {messages.map((msg: ConversationMessage) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xl rounded-lg px-4 py-2 text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
                  {msg.content}
                </div>
              </div>
            ))}

            {artefacts.length > 0 && (
              <div className="space-y-3">
                {nextCursor !== null && (
                  <div className="text-center py-2">
                    <button
                      onClick={() => { void handleLoadOlder(); }}
                      disabled={isLoadingOlder}
                      className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40"
                    >
                      {isLoadingOlder ? 'Loading…' : 'Load older artefacts'}
                    </button>
                  </div>
                )}
                {artefacts.map((a: BriefChatArtefact) => (
                  <ArtefactItem
                    key={a.artefactId}
                    artefact={a}
                    isSuperseded={supersededIds.has(a.artefactId)}
                    onSuggestionClick={handleSuggestionClick}
                    onApprove={handleApprove}
                    onReject={handleReject}
                  />
                ))}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSendReply} className="px-4 py-3 border-t border-gray-100 flex items-center gap-2 shrink-0">
            <input
              type="text"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Follow up…"
              disabled={isSending}
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!reply.trim() || isSending}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>

        {/* Right — live delegation graph */}
        {activeRunId && showGraph && (
          <div className="w-1/2 flex flex-col min-h-0 bg-gray-50">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Live View</span>
                <span className="flex items-center gap-1 text-xs text-indigo-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse inline-block" />
                  updating
                </span>
              </div>
              <button
                onClick={() => setShowGraph(false)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                aria-label="Close graph"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <DelegationGraphView runId={activeRunId} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

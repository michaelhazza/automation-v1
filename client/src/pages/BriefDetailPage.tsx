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
  const [chainState, setChainState] = useState<ArtefactChainState>({ artefacts: [] });
  const [reply, setReply] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!briefId) return;
    try {
      const [briefRes, artefactsRes] = await Promise.all([
        api.get<BriefMeta>(`/api/briefs/${briefId}`),
        api.get<BriefChatArtefact[]>(`/api/briefs/${briefId}/artefacts`),
      ]);

      setBrief(briefRes.data);

      const fetchedArtefacts = artefactsRes.data ?? [];
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

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-4">
        <Link to="/" className="text-sm text-gray-400 hover:text-gray-600">← Back</Link>
      </div>

      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">{brief?.title ?? 'Brief'}</h1>
        {brief?.status && (
          <span className="text-xs text-gray-500 mt-1">{briefStatusLabel(brief.status)}</span>
        )}
      </div>

      <div className="space-y-4 mb-6">
        {messages.map((msg: ConversationMessage) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-xl rounded-lg px-4 py-2 text-sm ${
              msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-900'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}

        {artefacts.length > 0 && (
          <div className="space-y-3">
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

      <form onSubmit={handleSendReply} className="flex items-center gap-2">
        <input
          type="text"
          value={reply}
          onChange={e => setReply(e.target.value)}
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
  );
}

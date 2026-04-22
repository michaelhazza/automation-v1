import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api.js';
import { useSocketRoom } from '../hooks/useSocket.js';
import { resolveLifecyclePure } from '../lib/briefArtefactLifecycle.js';
import type { BriefChatArtefact, BriefStructuredResult, BriefApprovalCard, BriefErrorResult } from '../../../shared/types/briefResultContract.js';
import type { ArtefactChainState } from '../lib/briefArtefactLifecyclePure.js';
import { StructuredResultCard } from '../components/brief-artefacts/StructuredResultCard.js';
import { ApprovalCard } from '../components/brief-artefacts/ApprovalCard.js';
import { ErrorArtefactCard } from '../components/brief-artefacts/ErrorArtefactCard.js';
import { briefStatusLabel } from '../components/BriefLabel.js';

interface BriefMeta {
  id: string;
  title: string;
  status: string;
  conversationId?: string;
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

function ArtefactItem({ artefact, isSuperseded, onSuggestionClick }: {
  artefact: BriefChatArtefact;
  isSuperseded: boolean;
  onSuggestionClick: (intent: string) => void;
}) {
  if (artefact.kind === 'structured') {
    return <StructuredResultCard artefact={artefact as BriefStructuredResult} isSuperseded={isSuperseded} onSuggestionClick={onSuggestionClick} />;
  }
  if (artefact.kind === 'approval') {
    return <ApprovalCard artefact={artefact as BriefApprovalCard} isSuperseded={isSuperseded} />;
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
      const [taskRes, artefactsRes] = await Promise.all([
        api.get<BriefMeta>(`/api/tasks/${briefId}`).catch(() => null),
        api.get<BriefChatArtefact[]>(`/api/briefs/${briefId}/artefacts`),
      ]);

      if (taskRes?.data) setBrief(taskRes.data);

      const fetchedArtefacts = artefactsRes.data ?? [];
      setArtefacts(fetchedArtefacts);
      setChainState({ artefacts: fetchedArtefacts });

      if (taskRes?.data?.conversationId) {
        const convRes = await api.get<{ conversation: { id: string }; messages: ConversationMessage[] }>(
          `/api/conversations/${taskRes.data.conversationId}`,
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
            const next = [...prev, art];
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
            const next = [...prev, art];
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
      await api.post(`/api/conversations/${brief.conversationId}/messages`, {
        content: reply.trim(),
        briefId,
      });
      setReply('');
      await load();
    } finally {
      setIsSending(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-4">
        <Link to="/admin/pulse" className="text-sm text-gray-400 hover:text-gray-600">← Back</Link>
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

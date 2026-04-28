/**
 * ClarificationInbox — real-time clarification inbox component
 *
 * Subscribes to the subaccount WebSocket room, renders pending clarification
 * requests with suggested-answer buttons + free-text reply. POSTs the reply
 * to POST /api/clarifications/:id/respond.
 *
 * Spec: docs/memory-and-briefings-spec.md §5.4 (S8)
 */

import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { useSocketRoom } from '../hooks/useSocket';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Urgency = 'blocking' | 'non_blocking';

interface ClarificationPayload {
  question: string;
  contextSnippet?: string | null;
  urgency: Urgency;
  suggestedAnswers?: string[];
  recipientRole?: string;
  activeRunId?: string | null;
  stepId?: string | null;
}

interface ClarificationItem {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  payload: ClarificationPayload;
}

interface ClarificationInboxProps {
  subaccountId: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClarificationInbox({ subaccountId }: ClarificationInboxProps) {
  const [items, setItems] = useState<ClarificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const loadPending = async () => {
    try {
      const res = await api.get<{ items: ClarificationItem[] }>(
        `/api/subaccounts/${subaccountId}/clarifications/pending`,
      );
      setItems(res.data.items ?? []);
      setError(null);
    } catch (err) {
      setError('Failed to load clarifications.');
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    loadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subaccountId]);

  // WebSocket subscriptions — refresh on any clarification lifecycle event
  // On reconnect, re-fetch baseline state via REST to catch any missed events
  useSocketRoom('subaccount', subaccountId, {
    'clarification:pending': () => loadPending(),
    'clarification:resolved': () => loadPending(),
    'clarification:expired': () => loadPending(),
  }, loadPending);

  // ──────────────────────────────────────────────────────────────────────────

  async function submitAnswer(item: ClarificationItem, answer: string, source: string) {
    if (!answer || answer.trim().length === 0) return;
    setSubmittingId(item.id);
    try {
      await api.post(`/api/clarifications/${item.id}/respond`, {
        answer,
        answerSource: source,
      });
      // Optimistically remove from list; refresh follows via WS
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } catch (err) {
      setError('Failed to send answer.');
    } finally {
      setSubmittingId(null);
    }
  }

  if (loading) {
    return <div className="text-sm text-slate-400 py-2">Loading clarifications…</div>;
  }

  if (error) {
    return <div className="text-sm text-red-500 py-2">{error}</div>;
  }

  if (items.length === 0) {
    return (
      <div className="text-sm text-slate-400 py-3 italic">
        No pending clarifications.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Pending Clarifications
      </p>

      {items.map((item) => (
        <ClarificationCard
          key={item.id}
          item={item}
          draft={drafts[item.id] ?? ''}
          submitting={submittingId === item.id}
          onDraftChange={(value) =>
            setDrafts((prev) => ({ ...prev, [item.id]: value }))
          }
          onSubmit={(answer, source) => submitAnswer(item, answer, source)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card subcomponent
// ---------------------------------------------------------------------------

interface ClarificationCardProps {
  item: ClarificationItem;
  draft: string;
  submitting: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: (answer: string, source: string) => void;
}

function ClarificationCard({
  item,
  draft,
  submitting,
  onDraftChange,
  onSubmit,
}: ClarificationCardProps) {
  const { question, contextSnippet, urgency, suggestedAnswers = [] } = item.payload;

  const expiresInMinutes = useMemo(() => {
    if (!item.expiresAt) return null;
    const diff = new Date(item.expiresAt).getTime() - Date.now();
    return Math.max(0, Math.round(diff / 60_000));
  }, [item.expiresAt]);

  const urgencyLabel = urgency === 'blocking' ? 'Blocking' : 'Non-blocking';
  const urgencyClass =
    urgency === 'blocking'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-slate-100 text-slate-600';

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-2">
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${urgencyClass}`}
        >
          {urgencyLabel}
        </span>
        {expiresInMinutes !== null && (
          <span className="text-xs text-slate-400">
            Expires in {expiresInMinutes} min
          </span>
        )}
      </div>

      <p className="text-sm text-slate-800 font-medium mb-2 whitespace-pre-wrap">
        {question}
      </p>

      {contextSnippet && (
        <p className="text-xs text-slate-500 italic mb-3">{contextSnippet}</p>
      )}

      {suggestedAnswers.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {suggestedAnswers.map((answer, idx) => (
            <button
              key={idx}
              type="button"
              disabled={submitting}
              onClick={() => onSubmit(answer, 'suggested_answer')}
              className="text-xs px-3 py-1.5 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {answer}
            </button>
          ))}
        </div>
      )}

      <textarea
        className="w-full border border-slate-200 rounded p-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        rows={2}
        placeholder="Or type a reply…"
        disabled={submitting}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
      />

      <div className="flex justify-end">
        <button
          type="button"
          disabled={submitting || draft.trim().length === 0}
          onClick={() => onSubmit(draft.trim(), 'free_text')}
          className="text-sm px-4 py-1.5 rounded-md bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Sending…' : 'Reply'}
        </button>
      </div>
    </div>
  );
}

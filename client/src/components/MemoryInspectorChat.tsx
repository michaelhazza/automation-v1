/**
 * MemoryInspectorChat — ask-the-inspector surface (S13)
 *
 * Agency-scoped default. Pass `audience="client_portal"` to render under the
 * client portal with the tier-filtered system prompt on the server side.
 *
 * Spec: docs/memory-and-briefings-spec.md §5.9 (S13)
 */

import { useState } from 'react';
import api from '../lib/api';

interface Citation {
  kind: 'memory_entry' | 'memory_block' | 'run';
  id: string;
  snippet: string;
}

interface Turn {
  question: string;
  answer?: string;
  citations?: Citation[];
  error?: string;
}

interface MemoryInspectorChatProps {
  subaccountId: string;
  audience?: 'agency' | 'client_portal';
}

export default function MemoryInspectorChat({
  subaccountId,
  audience = 'agency',
}: MemoryInspectorChatProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);

  async function ask() {
    if (!input.trim() || asking) return;
    const question = input.trim();
    setInput('');
    setTurns((prev) => [...prev, { question }]);
    setAsking(true);

    try {
      const res = await api.post<{ answer: string; citations: Citation[] }>(
        `/api/subaccounts/${subaccountId}/memory-inspector/ask`,
        { question, audience },
      );
      setTurns((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last) {
          last.answer = res.data.answer;
          last.citations = res.data.citations;
        }
        return updated;
      });
    } catch {
      setTurns((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last) last.error = 'Failed to answer — please try again.';
        return updated;
      });
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm max-w-2xl">
      <h3 className="text-sm font-semibold text-slate-800 mb-2">
        {audience === 'client_portal' ? 'Ask about your agent' : 'Memory Inspector'}
      </h3>

      <div className="flex flex-col gap-3 max-h-[420px] overflow-y-auto mb-3">
        {turns.map((t, i) => (
          <div key={i}>
            <p className="text-sm text-slate-800 font-medium">Q: {t.question}</p>
            {t.answer && (
              <p className="text-sm text-slate-700 whitespace-pre-wrap mt-1">{t.answer}</p>
            )}
            {t.error && <p className="text-sm text-red-600 mt-1">{t.error}</p>}
            {t.citations && t.citations.length > 0 && (
              <ul className="text-xs text-slate-500 mt-1 list-disc list-inside">
                {t.citations.slice(0, 5).map((c) => (
                  <li key={`${c.kind}-${c.id}`}>
                    <code>{c.kind}</code> · {c.snippet.slice(0, 100)}…
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {asking && <div className="text-sm text-slate-400">Thinking…</div>}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 border border-slate-200 rounded px-2 py-1 text-sm"
          placeholder={
            audience === 'client_portal'
              ? 'Ask what your agent knows…'
              : 'Ask why the agent did X, or what the system knows about Y'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
          disabled={asking}
        />
        <button
          type="button"
          onClick={ask}
          disabled={asking || input.trim().length === 0}
          className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          Ask
        </button>
      </div>
    </div>
  );
}

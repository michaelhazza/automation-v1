import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api.js';
import { isValidBriefText } from './GlobalAskBarPure.js';
import type { FastPathDecision } from '../../../../shared/types/briefFastPath.js';

interface CreateBriefResponse {
  briefId: string;
  conversationId: string;
  fastPathDecision: FastPathDecision;
}

interface GlobalAskBarProps {
  currentSubaccountId?: string;
  placeholder?: string;
}

export function GlobalAskBar({ currentSubaccountId, placeholder = 'Ask anything…' }: GlobalAskBarProps) {
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const canSubmit = isValidBriefText(text) && !isSubmitting;

  const handleSubmit = async (e: { preventDefault: () => void }): Promise<void> => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const { data } = await api.post<CreateBriefResponse>('/api/briefs', {
        text: text.trim(),
        source: 'global_ask_bar',
        subaccountId: currentSubaccountId,
        uiContext: {
          surface: 'global_ask_bar',
          currentSubaccountId,
        },
      });

      setText('');
      navigate(`/admin/briefs/${data.briefId}`);
    } catch {
      setError('Failed to submit. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 w-full max-w-xl">
      <div className="relative flex-1">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={placeholder}
          disabled={isSubmitting}
          className="w-full pl-3 pr-10 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-60 bg-white"
        />
        {isSubmitting && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">…</span>
        )}
      </div>
      <button
        type="submit"
        disabled={!canSubmit}
        className="px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
      >
        Ask
      </button>
      {error && <span className="text-xs text-red-600 ml-1">{error}</span>}
    </form>
  );
}

import React, { useState, useCallback, useEffect, useRef } from 'react';
import api from '../lib/api';
import { useNavigate } from 'react-router-dom';
import type { SuggestedAction, SuggestedActionKey } from '../../../shared/types/messageSuggestedActions';

interface Props {
  messageId: string;
  agentId: string;
  convId: string;
  chips: SuggestedAction[];
  onPromptFill: (prompt: string) => void;
  disabledKeys?: SuggestedActionKey[];
}

export default function SuggestedActionChips({ messageId, agentId, convId, chips, onPromptFill, disabledKeys = [] }: Props) {
  const navigate = useNavigate();
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const [pendingKey, setPendingKey] = useState<SuggestedActionKey | null>(null);
  const [doneKey, setDoneKey] = useState<SuggestedActionKey | null>(null);
  const [errorKey, setErrorKey] = useState<SuggestedActionKey | null>(null);

  const handleSystemClick = useCallback(async (actionKey: SuggestedActionKey) => {
    if (pendingKey !== null) return;
    setPendingKey(actionKey);
    setErrorKey(null);
    setDoneKey(null);
    try {
      const { data } = await api.post(
        `/api/agents/${agentId}/conversations/${convId}/messages/${messageId}/dispatch-action`,
        { actionKey },
      );
      if (data.redirectUrl) {
        navigate(data.redirectUrl);
        return;
      }
      // No redirect — show brief "Done" state, guarded against unmount.
      if (mountedRef.current) {
        setDoneKey(actionKey);
        setTimeout(() => { if (mountedRef.current) setDoneKey(null); }, 1500);
      }
    } catch {
      if (mountedRef.current) setErrorKey(actionKey);
    } finally {
      if (mountedRef.current) setPendingKey(null);
    }
  }, [pendingKey, agentId, convId, messageId, navigate]);

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 px-5 pb-2">
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip, i) => {
          if (chip.kind === 'prompt') {
            return (
              <button
                key={i}
                type="button"
                onClick={() => onPromptFill(chip.prompt)}
                className="inline-flex items-center px-2.5 py-1 rounded-full text-[12.5px] font-medium bg-white border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                {chip.label}
              </button>
            );
          }

          // system chip
          const isDisabled = disabledKeys.includes(chip.actionKey);
          const isPending = pendingKey === chip.actionKey;
          const isDone = doneKey === chip.actionKey;
          const hasError = errorKey === chip.actionKey;

          const baseClass = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12.5px] font-medium border transition-colors';
          const stateClass = isDisabled
            ? 'opacity-60 cursor-not-allowed pointer-events-none bg-indigo-50 border-indigo-200 text-indigo-700'
            : isDone
            ? 'bg-green-50 border-green-300 text-green-700 cursor-default'
            : hasError
            ? 'bg-red-50 border-red-200 text-red-600 cursor-pointer hover:bg-red-100'
            : isPending
            ? 'opacity-60 cursor-not-allowed bg-indigo-50 border-indigo-200 text-indigo-700'
            : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 cursor-pointer';

          return (
            <button
              key={i}
              type="button"
              disabled={isDisabled || isPending}
              onClick={() => void handleSystemClick(chip.actionKey)}
              className={`${baseClass} ${stateClass}`}
            >
              {isPending && (
                <span className="w-3 h-3 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
              )}
              {isDone ? 'Done' : hasError ? 'Failed — try again' : chip.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

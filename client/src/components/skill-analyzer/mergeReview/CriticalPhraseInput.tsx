import { useState } from 'react';
import type { WarningResolutionKind } from '../mergeTypes';

export function CriticalPhraseInput({
  current,
  disabled,
  expectedPhrase,
  onConfirm,
}: {
  current: WarningResolutionKind | null;
  disabled: boolean;
  expectedPhrase: string;
  onConfirm: () => void;
}) {
  const [phrase, setPhrase] = useState('');

  if (current === 'confirm_critical_phrase') {
    return <span className="text-emerald-700">Confirmation recorded ✓</span>;
  }

  const matches = phrase.trim() === expectedPhrase.trim();

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={phrase}
        disabled={disabled}
        onChange={(e) => setPhrase(e.target.value)}
        placeholder={`Type: ${expectedPhrase}`}
        className="flex-1 border border-slate-300 rounded px-2 py-0.5 text-[11px]"
      />
      <button
        type="button"
        disabled={disabled || !matches}
        onClick={onConfirm}
        className="px-2 py-0.5 rounded bg-red-600 text-white text-[11px] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Confirm critical
      </button>
    </div>
  );
}

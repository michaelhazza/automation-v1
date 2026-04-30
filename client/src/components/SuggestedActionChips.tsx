import React from 'react';
import type { SuggestedAction, SuggestedActionKey } from '../../../shared/types/messageSuggestedActions';

interface Props {
  chips: SuggestedAction[];
  onPromptFill: (prompt: string) => void;
  onSystemAction: (actionKey: SuggestedActionKey) => void;
}

export default function SuggestedActionChips({ chips, onPromptFill, onSystemAction }: Props) {
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-5 pb-2">
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
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSystemAction(chip.actionKey)}
            className="inline-flex items-center px-2.5 py-1 rounded-full text-[12.5px] font-medium bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 transition-colors cursor-pointer"
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

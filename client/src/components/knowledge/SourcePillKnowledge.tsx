// client/src/components/knowledge/SourcePillKnowledge.tsx
// Provenance source pill for the Knowledge page Source column.
// Trust & Verification Layer spec §13.4.

import React from 'react';

type PillKey = 'correction' | 'manual' | 'auto' | 'unknown';

function capturedViaToPill(capturedVia: string): PillKey {
  if (capturedVia === 'operator_correction') return 'correction';
  if (capturedVia === 'manual_edit') return 'manual';
  if (capturedVia === 'auto_synthesised') return 'auto';
  return 'unknown';
}

const PILL_LABEL: Record<PillKey, string> = {
  correction: 'Correction',
  manual:     'Manual',
  auto:       'Auto',
  unknown:    'Unknown',
};

const PILL_CLASS: Record<PillKey, string> = {
  correction: 'bg-amber-100 text-amber-700',
  manual:     'bg-slate-100 text-slate-600',
  auto:       'bg-blue-100 text-blue-700',
  unknown:    'bg-slate-50 text-slate-400',
};

interface SourcePillKnowledgeProps {
  capturedVia: string;
  /** When provided, clicking the pill invokes this callback (e.g. apply filter). */
  onClick?: () => void;
}

export function SourcePillKnowledge({ capturedVia, onClick }: SourcePillKnowledgeProps) {
  const key = capturedViaToPill(capturedVia);
  const label = PILL_LABEL[key];
  const cls = PILL_CLASS[key];

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium cursor-pointer hover:opacity-80 ${cls}`}
      >
        {label}
      </button>
    );
  }

  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

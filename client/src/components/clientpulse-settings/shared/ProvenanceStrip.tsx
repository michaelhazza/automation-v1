/**
 * ProvenanceStrip — top-of-page strip showing the adopted system template
 * + a summary of how many leaves differ from template defaults (spec §6.1).
 *
 * When `appliedSystemTemplateId === null` (legacy pre-Session-1 org), the
 * strip reads "Adopted template: none (legacy org)" and the global reset
 * affordance is disabled.
 */

import React from 'react';
import { useConfigAssistantPopup } from '../../../hooks/useConfigAssistantPopup';

interface Props {
  appliedSystemTemplateId: string | null;
  appliedSystemTemplateName: string | null;
  overriddenLeafCount: number;
  totalLeafCount: number;
}

export default function ProvenanceStrip({
  appliedSystemTemplateId,
  appliedSystemTemplateName,
  overriddenLeafCount,
  totalLeafCount,
}: Props) {
  const { openConfigAssistant } = useConfigAssistantPopup();

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 mb-4 bg-slate-50 border border-slate-200 rounded-lg text-[13px]">
      <div className="flex items-center gap-3 text-slate-700">
        <span className="font-semibold">Adopted template:</span>
        <span>
          {appliedSystemTemplateId
            ? (appliedSystemTemplateName ?? 'Unnamed template')
            : 'None (legacy org)'}
        </span>
        <span className="text-slate-300">·</span>
        <span className="text-slate-600">
          {overriddenLeafCount} of {totalLeafCount} leaves overridden
        </span>
      </div>
      <button
        type="button"
        onClick={() => openConfigAssistant()}
        className="px-3 py-1 rounded-md text-[12px] font-semibold bg-white border border-slate-300 text-slate-700 hover:border-slate-400 hover:bg-slate-50"
      >
        Open Configuration Assistant
      </button>
    </div>
  );
}

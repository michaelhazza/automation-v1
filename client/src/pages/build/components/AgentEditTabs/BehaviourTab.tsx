import React from 'react';
import type { AgentFull, AgentBehaviourPatch } from '../../../../../../shared/types/build';

interface BehaviourTabProps {
  data: AgentFull['behaviour'];
  onChange: (patch: AgentBehaviourPatch) => void;
  pending: AgentBehaviourPatch | undefined;
  readOnly: boolean;
}

export default function BehaviourTab({ data, onChange, pending, readOnly }: BehaviourTabProps) {
  const merged = { ...data, ...pending };

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Briefing template</label>
        <p className="text-xs text-slate-500 mb-2">
          The core instruction set given to this agent. Use clear directives about its role, goals, and operating boundaries.
        </p>
        <textarea
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md resize-y min-h-[320px] font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-400"
          value={merged.briefingTemplate}
          disabled={readOnly}
          placeholder="Enter the agent's briefing template..."
          onChange={e => onChange({ ...pending, briefingTemplate: e.target.value })}
        />
      </div>

      <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
        <p className="text-xs text-slate-500">
          Constraints are not supported in Phase 1. They will be available in a future release.
        </p>
      </div>
    </div>
  );
}

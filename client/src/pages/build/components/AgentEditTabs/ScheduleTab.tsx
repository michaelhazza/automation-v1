import React from 'react';
import type { AgentFull, TriggerBindingPayload } from '../../../../../../shared/types/build';

interface ScheduleTabProps {
  data: AgentFull['triggers'];
  onChange: (triggers: TriggerBindingPayload[]) => void;
  pending: TriggerBindingPayload[] | undefined;
  agentId: string;
  readOnly: boolean;
}

const KIND_STYLES: Record<string, string> = {
  schedule: 'bg-indigo-50 text-indigo-700',
  event: 'bg-purple-50 text-purple-700',
  manual: 'bg-slate-100 text-slate-600',
};

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
};

export default function ScheduleTab({ data, agentId: _agentId, readOnly: _readOnly }: ScheduleTabProps) {
  // Phase 1: read-only display. Trigger editing is via the existing trigger management UI.
  const triggers = data;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Triggers ({triggers.length})</h2>
      </div>

      <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
        <p className="text-xs text-amber-700">
          Trigger configuration is managed via the Triggers page. This view is read-only.
        </p>
      </div>

      {triggers.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg">
          No triggers configured for this agent.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
          {triggers.map(trigger => (
            <li key={trigger.id} className="flex items-center gap-3 px-4 py-3 bg-white">
              <div className="flex-1 min-w-0">
                <span className="text-xs text-slate-500 font-mono">{trigger.id}</span>
              </div>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${KIND_STYLES[trigger.kind] ?? KIND_STYLES.manual}`}>
                {trigger.kind}
              </span>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[trigger.status ?? 'active'] ?? STATUS_STYLES.active}`}>
                {trigger.status ?? 'active'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

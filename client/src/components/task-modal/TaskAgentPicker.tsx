import { useEffect, useState } from 'react';
import { defaultAgentId, type SubaccountAgent } from './TaskAgentPickerPure';

interface TaskAgentPickerProps {
  agents: SubaccountAgent[];
  variant: 'layout' | 'review-queue';
  value: string | null;
  onChange(value: string | null): void;
}

export function TaskAgentPicker({ agents, variant, value, onChange }: TaskAgentPickerProps) {
  const [initialised, setInitialised] = useState(false);

  useEffect(() => {
    if (!initialised) {
      setInitialised(true);
      const def = defaultAgentId(agents, variant);
      if (def !== value) onChange(def);
    }
  }, [initialised, agents, variant, value, onChange]);

  return (
    <div>
      <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Agent</label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <option value="">Unassigned</option>
        {agents.map((a) => (
          <option key={a.agentId} value={a.agentId}>
            {a.agent.name}
          </option>
        ))}
      </select>
    </div>
  );
}

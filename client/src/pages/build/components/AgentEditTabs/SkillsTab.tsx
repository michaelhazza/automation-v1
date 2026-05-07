import React, { useState } from 'react';
import type { AgentFull, SkillBindingPayload } from '../../../../../../shared/types/build';
import { SkillPickerModal } from '../SkillPickerModal';

interface SkillsTabProps {
  data: AgentFull['skills'];
  onChange: (skills: SkillBindingPayload[]) => void;
  pending: SkillBindingPayload[] | undefined;
  agentId: string;
  readOnly: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  enabled: 'bg-green-100 text-green-700',
  disabled: 'bg-slate-100 text-slate-500',
};

export default function SkillsTab({ data, onChange, pending, agentId: _agentId, readOnly }: SkillsTabProps) {
  const [showPicker, setShowPicker] = useState(false);

  // Use pending if set, else fall back to server data
  const skills: SkillBindingPayload[] = pending ?? data.map(s => ({
    id: s.id,
    key: s.key,
    name: s.name,
    configJson: s.configJson,
    status: s.status,
  }));

  const handleRemove = (id: string) => {
    onChange(skills.filter(s => s.id !== id));
  };

  const handleAdd = (skill: SkillBindingPayload) => {
    if (!skills.find(s => s.id === skill.id)) {
      onChange([...skills, skill]);
    }
    setShowPicker(false);
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Skills ({skills.length})</h2>
        {!readOnly && (
          <button
            className="btn btn-secondary text-sm"
            onClick={() => setShowPicker(true)}
          >
            Add skill
          </button>
        )}
      </div>

      {skills.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg">
          No skills assigned. Add a skill to extend this agent's capabilities.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
          {skills.map(skill => (
            <li key={skill.id} className="flex items-center gap-3 px-4 py-3 bg-white">
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-slate-800 truncate block">{skill.name}</span>
                <span className="text-xs text-slate-500">{skill.key}</span>
              </div>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[skill.status ?? 'enabled']}`}>
                {skill.status ?? 'enabled'}
              </span>
              {!readOnly && (
                <button
                  className="text-xs text-red-500 hover:text-red-700 ml-2 flex-shrink-0"
                  onClick={() => handleRemove(skill.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {showPicker && (
        <SkillPickerModal
          onSelect={handleAdd}
          onClose={() => setShowPicker(false)}
          existingIds={skills.map(s => s.id)}
        />
      )}
    </div>
  );
}

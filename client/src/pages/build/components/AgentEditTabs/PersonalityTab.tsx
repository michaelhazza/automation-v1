import React from 'react';
import type { AgentFull, AgentPersonalityPatch } from '../../../../../../shared/types/build';

interface PersonalityTabProps {
  data: AgentFull['personality'];
  onChange: (patch: AgentPersonalityPatch) => void;
  pending: AgentPersonalityPatch | undefined;
  readOnly: boolean;
}

const TONE_OPTIONS = [
  'professional',
  'friendly',
  'concise',
  'formal',
  'casual',
  'empathetic',
  'direct',
  'technical',
];

export default function PersonalityTab({ data, onChange, pending, readOnly }: PersonalityTabProps) {
  const merged = { ...data, ...pending };

  const field = <K extends keyof AgentPersonalityPatch>(key: K, value: AgentPersonalityPatch[K]) =>
    onChange({ ...pending, [key]: value });

  const traitsString = (merged.traits ?? []).join(', ');

  const handleTraitsChange = (raw: string) => {
    const traits = raw.split(',').map(t => t.trim()).filter(Boolean);
    field('traits', traits);
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="personalityEnabled"
          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-300"
          checked={merged.enabled ?? false}
          disabled={readOnly}
          onChange={e => field('enabled', e.target.checked)}
        />
        <label htmlFor="personalityEnabled" className="text-sm font-medium text-slate-700">
          Enable personality layer
        </label>
      </div>

      {merged.enabled && (
        <>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Traits</label>
            <p className="text-xs text-slate-500 mb-2">Comma-separated list of personality traits.</p>
            <input
              type="text"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-400"
              value={traitsString}
              disabled={readOnly}
              placeholder="e.g. analytical, detail-oriented, proactive"
              onChange={e => handleTraitsChange(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tone</label>
            <select
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-400"
              value={merged.tone ?? ''}
              disabled={readOnly}
              onChange={e => field('tone', e.target.value)}
            >
              <option value="">Select tone...</option>
              {TONE_OPTIONS.map(t => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md resize-y min-h-[120px] focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-400"
              value={merged.description ?? ''}
              disabled={readOnly}
              placeholder="Describe this agent's personality in a few sentences..."
              onChange={e => field('description', e.target.value)}
            />
          </div>
        </>
      )}
    </div>
  );
}

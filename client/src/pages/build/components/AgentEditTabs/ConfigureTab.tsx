import React from 'react';
import type { AgentFull, AgentConfigurePatch } from '../../../../../../shared/types/build';

interface ConfigureTabProps {
  data: AgentFull['configure'];
  onChange: (patch: AgentConfigurePatch) => void;
  pending: AgentConfigurePatch | undefined;
  readOnly: boolean;
}

const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

const OUTPUT_SIZE_OPTIONS = [
  { value: 'compact', label: 'Compact' },
  { value: 'standard', label: 'Standard' },
  { value: 'extended', label: 'Extended' },
];

const RESPONSE_MODE_OPTIONS = [
  { value: 'balanced', label: 'Balanced' },
  { value: 'expressive', label: 'Expressive' },
  { value: 'precise', label: 'Precise' },
  { value: 'highly_creative', label: 'Highly creative' },
];

export default function ConfigureTab({ data, onChange, pending, readOnly }: ConfigureTabProps) {
  const merged = { ...data, ...pending };

  const field = <K extends keyof AgentConfigurePatch>(key: K, value: AgentConfigurePatch[K]) =>
    onChange({ ...pending, [key]: value });

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
        <input
          type="text"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-400"
          value={merged.name}
          disabled={readOnly}
          onChange={e => field('name', e.target.value)}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
        <textarea
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-400"
          value={merged.description}
          disabled={readOnly}
          onChange={e => field('description', e.target.value)}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Role title</label>
        <input
          type="text"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-400"
          value={merged.roleTitle}
          disabled={readOnly}
          onChange={e => field('roleTitle', e.target.value)}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Parent agent ID</label>
        <input
          type="text"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-400"
          value={merged.parentAgentId ?? ''}
          disabled={readOnly}
          placeholder="None"
          onChange={e => field('parentAgentId', e.target.value || null)}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Model</label>
        <select
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-400"
          value={merged.model}
          disabled={readOnly}
          onChange={e => field('model', e.target.value)}
        >
          {MODEL_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Output size</label>
        <select
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-400"
          value={merged.outputSize}
          disabled={readOnly}
          onChange={e => field('outputSize', e.target.value as AgentConfigurePatch['outputSize'])}
        >
          {OUTPUT_SIZE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Response mode</label>
        <select
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-400"
          value={merged.responseMode}
          disabled={readOnly}
          onChange={e => field('responseMode', e.target.value as AgentConfigurePatch['responseMode'])}
        >
          {RESPONSE_MODE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="allowSubaccountModelOverride"
          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-300"
          checked={merged.allowSubaccountModelOverride}
          disabled={readOnly}
          onChange={e => field('allowSubaccountModelOverride', e.target.checked)}
        />
        <label htmlFor="allowSubaccountModelOverride" className="text-sm text-slate-700">
          Allow workspace model override
        </label>
      </div>
    </div>
  );
}

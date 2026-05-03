/**
 * AgentInspector — inspector panel for agent / agent_call steps.
 *
 * Spec: tasks/Workflows-spec.md §10.3 (four A's inspectors).
 *
 * Fields:
 *   - Agent ID (free-text, V1 — full agent picker is a V2 enhancement)
 *   - Prompt template editor (textarea)
 *   - Output schema (textarea, JSON)
 *   - Retry policy (maxAttempts, backoff strategy)
 *   - Cost estimate (read-only derived display)
 */

import React, { useState } from 'react';
import type { CanvasStep } from '../studioCanvasPure.js';

interface AgentInspectorProps {
  step: CanvasStep;
  onClose: () => void;
  onUpdate: (stepId: string, patch: Partial<CanvasStep>) => void;
}

type BackoffStrategy = 'exponential' | 'linear';

interface LocalState {
  agentId: string;
  promptTemplate: string;
  outputSchema: string;
  maxAttempts: number;
  backoffStrategy: BackoffStrategy;
}

function stateFromStep(step: CanvasStep): LocalState {
  const p = step.params ?? {};
  return {
    agentId: typeof p.agentId === 'string' ? p.agentId : '',
    promptTemplate: typeof p.promptTemplate === 'string' ? p.promptTemplate : '',
    outputSchema:
      typeof p.outputSchema === 'string'
        ? p.outputSchema
        : p.outputSchema != null
        ? JSON.stringify(p.outputSchema, null, 2)
        : '',
    maxAttempts:
      typeof p.maxAttempts === 'number' ? p.maxAttempts : 1,
    backoffStrategy:
      p.backoffStrategy === 'linear' ? 'linear' : 'exponential',
  };
}

export default function AgentInspector({ step, onClose, onUpdate }: AgentInspectorProps) {
  const [local, setLocal] = useState<LocalState>(() => stateFromStep(step));
  const [schemaError, setSchemaError] = useState<string | null>(null);

  function handleSave() {
    // Validate outputSchema if provided
    if (local.outputSchema.trim()) {
      try {
        JSON.parse(local.outputSchema);
      } catch {
        setSchemaError('Output schema is not valid JSON.');
        return;
      }
    }
    setSchemaError(null);

    const parsedSchema = local.outputSchema.trim()
      ? JSON.parse(local.outputSchema)
      : undefined;

    onUpdate(step.id, {
      params: {
        ...step.params,
        agentId: local.agentId || undefined,
        promptTemplate: local.promptTemplate || undefined,
        outputSchema: parsedSchema,
        maxAttempts: local.maxAttempts,
        backoffStrategy: local.backoffStrategy,
      },
    });
    onClose();
  }

  // Heuristic cost estimate: 50 cents base per agent step
  const costEstimateCents =
    typeof step.params?.estimatedCostCents === 'number'
      ? step.params.estimatedCostCents
      : 50;

  return (
    <div className="p-4 space-y-5">
      {/* Agent ID */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Agent ID
        </label>
        <input
          type="text"
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="e.g. my-agent-slug"
          value={local.agentId}
          onChange={(e) => setLocal((s) => ({ ...s, agentId: e.target.value }))}
        />
        <div className="text-[11px] text-slate-400 mt-0.5">
          Agent slug or ID resolved at run start.
        </div>
      </div>

      {/* Prompt template */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Prompt template
        </label>
        <textarea
          rows={5}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
          placeholder="Enter the prompt template. Use {{variable}} for interpolation."
          value={local.promptTemplate}
          onChange={(e) => setLocal((s) => ({ ...s, promptTemplate: e.target.value }))}
        />
      </div>

      {/* Output schema */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Output schema (JSON, optional)
        </label>
        <textarea
          rows={4}
          className={[
            'w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y',
            schemaError ? 'border-red-300' : 'border-slate-200',
          ].join(' ')}
          placeholder='{ "type": "object", "properties": { ... } }'
          value={local.outputSchema}
          onChange={(e) => {
            setLocal((s) => ({ ...s, outputSchema: e.target.value }));
            setSchemaError(null);
          }}
        />
        {schemaError && (
          <div className="text-[11px] text-red-600 mt-0.5">{schemaError}</div>
        )}
      </div>

      {/* Retry policy */}
      <div>
        <div className="text-xs font-semibold text-slate-700 mb-2">Retry policy</div>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-[11px] text-slate-500 mb-1">Max attempts</label>
            <input
              type="number"
              min={1}
              max={5}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={local.maxAttempts}
              onChange={(e) =>
                setLocal((s) => ({ ...s, maxAttempts: Math.max(1, parseInt(e.target.value, 10) || 1) }))
              }
            />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] text-slate-500 mb-1">Backoff strategy</label>
            <select
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={local.backoffStrategy}
              onChange={(e) =>
                setLocal((s) => ({ ...s, backoffStrategy: e.target.value as BackoffStrategy }))
              }
            >
              <option value="exponential">Exponential</option>
              <option value="linear">Linear</option>
            </select>
          </div>
        </div>
      </div>

      {/* Cost estimate (read-only) */}
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
        <div className="text-[11px] text-slate-500 mb-0.5">Estimated cost</div>
        <div className="text-sm font-semibold text-slate-800">
          ~{(costEstimateCents / 100).toFixed(2)} per run
        </div>
        <div className="text-[10px] text-slate-400 mt-0.5">
          Heuristic estimate. Override via params.estimatedCostCents.
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 focus:outline-none"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

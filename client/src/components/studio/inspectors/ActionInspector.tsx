/**
 * ActionInspector — inspector panel for action / action_call steps.
 *
 * Spec: tasks/Workflows-spec.md §10.3 (four A's inspectors).
 *
 * Fields:
 *   - Action type (free-text in V1; full action registry picker is V2)
 *   - Parameters (JSON textarea)
 *   - Idempotency key strategy (none / step_id / custom)
 */

import React, { useState } from 'react';
import type { CanvasStep } from '../studioCanvasPure.js';

interface ActionInspectorProps {
  step: CanvasStep;
  onClose: () => void;
  onUpdate: (stepId: string, patch: Partial<CanvasStep>) => void;
}

type IdempotencyStrategy = 'none' | 'step_id' | 'custom';

interface LocalState {
  actionType: string;
  parametersJson: string;
  idempotencyStrategy: IdempotencyStrategy;
  idempotencyKeyTemplate: string;
}

function stateFromStep(step: CanvasStep): LocalState {
  const p = step.params ?? {};
  return {
    actionType: typeof p.actionType === 'string' ? p.actionType : '',
    parametersJson:
      p.parameters != null ? JSON.stringify(p.parameters, null, 2) : '',
    idempotencyStrategy:
      p.idempotencyStrategy === 'step_id'
        ? 'step_id'
        : p.idempotencyStrategy === 'custom'
        ? 'custom'
        : 'none',
    idempotencyKeyTemplate:
      typeof p.idempotencyKeyTemplate === 'string' ? p.idempotencyKeyTemplate : '',
  };
}

export default function ActionInspector({ step, onClose, onUpdate }: ActionInspectorProps) {
  const [local, setLocal] = useState<LocalState>(() => stateFromStep(step));
  const [paramsError, setParamsError] = useState<string | null>(null);

  function handleSave() {
    let parsedParams: unknown = undefined;
    if (local.parametersJson.trim()) {
      try {
        parsedParams = JSON.parse(local.parametersJson);
      } catch {
        setParamsError('Parameters is not valid JSON.');
        return;
      }
    }
    setParamsError(null);

    onUpdate(step.id, {
      params: {
        ...step.params,
        actionType: local.actionType || undefined,
        parameters: parsedParams,
        idempotencyStrategy: local.idempotencyStrategy !== 'none' ? local.idempotencyStrategy : undefined,
        idempotencyKeyTemplate:
          local.idempotencyStrategy === 'custom' ? local.idempotencyKeyTemplate : undefined,
      },
    });
    onClose();
  }

  return (
    <div className="p-4 space-y-5">
      {/* Action type */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Action type
        </label>
        <input
          type="text"
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          placeholder="e.g. send_email, create_task"
          value={local.actionType}
          onChange={(e) => setLocal((s) => ({ ...s, actionType: e.target.value }))}
        />
        <div className="text-[11px] text-slate-400 mt-0.5">
          Action registry slug resolved at run time.
        </div>
      </div>

      {/* Parameters */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Parameters (JSON, optional)
        </label>
        <textarea
          rows={5}
          className={[
            'w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500 resize-y',
            paramsError ? 'border-red-300' : 'border-slate-200',
          ].join(' ')}
          placeholder='{ "to": "{{email}}", "subject": "Hello" }'
          value={local.parametersJson}
          onChange={(e) => {
            setLocal((s) => ({ ...s, parametersJson: e.target.value }));
            setParamsError(null);
          }}
        />
        {paramsError && (
          <div className="text-[11px] text-red-600 mt-0.5">{paramsError}</div>
        )}
      </div>

      {/* Idempotency key strategy */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Idempotency key strategy
        </label>
        <select
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          value={local.idempotencyStrategy}
          onChange={(e) =>
            setLocal((s) => ({ ...s, idempotencyStrategy: e.target.value as IdempotencyStrategy }))
          }
        >
          <option value="none">None</option>
          <option value="step_id">Step ID (auto-generated per run)</option>
          <option value="custom">Custom template</option>
        </select>

        {local.idempotencyStrategy === 'custom' && (
          <input
            type="text"
            className="mt-2 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
            placeholder="e.g. {{runId}}-{{stepId}}-{{input.email}}"
            value={local.idempotencyKeyTemplate}
            onChange={(e) => setLocal((s) => ({ ...s, idempotencyKeyTemplate: e.target.value }))}
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
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

/**
 * AskInspector — inspector panel for ask / user_input steps.
 *
 * Spec: tasks/Workflows-spec.md §10.3 (four A's), mock 09 (Ask inspector sub-states).
 *
 * Five sub-states:
 *   default        — main form (prompt, fields list, allowSkip, who-can-submit, auto-fill)
 *   who_can_submit — user picker for submit-permission pool
 *   auto_fill      — select none / last-successful-run auto-fill
 *   add_field      — pick field type
 *   edit_field     — edit field detail (key, label, required, options, min/max, description)
 */

import React, { useState } from 'react';
import type { CanvasStep } from '../studioCanvasPure.js';
import type {
  AskFormFieldDef,
  AskFormFieldType,
} from '../../../../../shared/types/askForm.js';

interface AskInspectorProps {
  step: CanvasStep;
  onClose: () => void;
  onUpdate: (stepId: string, patch: Partial<CanvasStep>) => void;
}

type SubState =
  | 'default'
  | 'who_can_submit'
  | 'auto_fill'
  | 'add_field'
  | 'edit_field';

type AutoFillMode = 'none' | 'last_successful_run';

interface LocalState {
  prompt: string;
  fields: AskFormFieldDef[];
  allowSkip: boolean;
  whoCanSubmit: string[]; // array of user IDs
  autoFill: AutoFillMode;
}

function stateFromStep(step: CanvasStep): LocalState {
  const p = step.params ?? {};
  return {
    prompt: typeof p.prompt === 'string' ? p.prompt : '',
    fields: Array.isArray(p.fields) ? (p.fields as AskFormFieldDef[]) : [],
    allowSkip: p.allowSkip === true,
    whoCanSubmit: Array.isArray(p.whoCanSubmit) ? (p.whoCanSubmit as string[]) : [],
    autoFill:
      p.autoFill === 'last_successful_run' ? 'last_successful_run' : 'none',
  };
}

const FIELD_TYPES: Array<{ value: AskFormFieldType; label: string }> = [
  { value: 'short_text', label: 'Short text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'select', label: 'Single select' },
  { value: 'multi_select', label: 'Multi select' },
  { value: 'date', label: 'Date' },
];

function emptyField(type: AskFormFieldType): AskFormFieldDef {
  return {
    key: '',
    label: '',
    type,
    required: false,
    description: '',
    options: type === 'select' || type === 'multi_select' ? [] : undefined,
    min: type === 'number' ? undefined : undefined,
    max: type === 'number' ? undefined : undefined,
  };
}

// ─── Edit-field-detail sub-state ─────────────────────────────────────────────

interface EditFieldPanelProps {
  field: AskFormFieldDef;
  onSave: (updated: AskFormFieldDef) => void;
  onCancel: () => void;
}

function EditFieldPanel({ field, onSave, onCancel }: EditFieldPanelProps) {
  const [local, setLocal] = useState<AskFormFieldDef>({ ...field });
  const [optionsText, setOptionsText] = useState<string>(
    local.options ? local.options.map((o) => o.value).join('\n') : ''
  );
  const [keyError, setKeyError] = useState<string | null>(null);

  function handleSave() {
    const trimKey = local.key.trim();
    if (!trimKey) {
      setKeyError('Field key is required.');
      return;
    }
    if (!/^[a-z0-9_]+$/.test(trimKey)) {
      setKeyError('Field key must be lowercase letters, digits, and underscores only.');
      return;
    }
    setKeyError(null);

    const updated: AskFormFieldDef = {
      ...local,
      key: trimKey,
      label: local.label.trim() || trimKey,
    };

    if (local.type === 'select' || local.type === 'multi_select') {
      updated.options = optionsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((v) => ({ value: v, label: v }));
    }

    onSave(updated);
  }

  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold text-slate-700">
        Edit field ({local.type})
      </div>

      {/* Key */}
      <div>
        <label className="block text-[11px] text-slate-500 mb-1">Field key</label>
        <input
          type="text"
          className={[
            'w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500',
            keyError ? 'border-red-300' : 'border-slate-200',
          ].join(' ')}
          placeholder="e.g. customer_name"
          value={local.key}
          onChange={(e) => {
            setLocal((s) => ({ ...s, key: e.target.value }));
            setKeyError(null);
          }}
        />
        {keyError && <div className="text-[11px] text-red-600 mt-0.5">{keyError}</div>}
      </div>

      {/* Label */}
      <div>
        <label className="block text-[11px] text-slate-500 mb-1">Label</label>
        <input
          type="text"
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          placeholder="Customer name"
          value={local.label}
          onChange={(e) => setLocal((s) => ({ ...s, label: e.target.value }))}
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-[11px] text-slate-500 mb-1">Description (optional)</label>
        <input
          type="text"
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          placeholder="Help text shown below the field"
          value={local.description ?? ''}
          onChange={(e) => setLocal((s) => ({ ...s, description: e.target.value }))}
        />
      </div>

      {/* Required */}
      <div className="flex items-center gap-2">
        <input
          id="ask-field-required"
          type="checkbox"
          className="rounded border-slate-300"
          checked={local.required}
          onChange={(e) => setLocal((s) => ({ ...s, required: e.target.checked }))}
        />
        <label htmlFor="ask-field-required" className="text-sm text-slate-700">
          Required
        </label>
      </div>

      {/* Options (select types) */}
      {(local.type === 'select' || local.type === 'multi_select') && (
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">
            Options (one per line)
          </label>
          <textarea
            rows={4}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500 resize-y"
            placeholder={"Option A\nOption B\nOption C"}
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
          />
        </div>
      )}

      {/* Min / Max (number) */}
      {local.type === 'number' && (
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-[11px] text-slate-500 mb-1">Min (optional)</label>
            <input
              type="number"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={local.min ?? ''}
              onChange={(e) =>
                setLocal((s) => ({
                  ...s,
                  min: e.target.value !== '' ? Number(e.target.value) : undefined,
                }))
              }
            />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] text-slate-500 mb-1">Max (optional)</label>
            <input
              type="number"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={local.max ?? ''}
              onChange={(e) =>
                setLocal((s) => ({
                  ...s,
                  max: e.target.value !== '' ? Number(e.target.value) : undefined,
                }))
              }
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          Save field
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 focus:outline-none"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AskInspector({ step, onClose, onUpdate }: AskInspectorProps) {
  const [local, setLocal] = useState<LocalState>(() => stateFromStep(step));
  const [subState, setSubState] = useState<SubState>('default');
  const [editingFieldIndex, setEditingFieldIndex] = useState<number | null>(null);
  const [newFieldType, setNewFieldType] = useState<AskFormFieldType | null>(null);

  function handleSaveMain() {
    onUpdate(step.id, {
      params: {
        ...step.params,
        prompt: local.prompt,
        fields: local.fields,
        allowSkip: local.allowSkip,
        whoCanSubmit: local.whoCanSubmit.length > 0 ? local.whoCanSubmit : undefined,
        autoFill: local.autoFill !== 'none' ? local.autoFill : undefined,
      },
    });
    onClose();
  }

  function handleFieldSave(updated: AskFormFieldDef) {
    if (editingFieldIndex !== null) {
      setLocal((s) => {
        const fields = [...s.fields];
        fields[editingFieldIndex] = updated;
        return { ...s, fields };
      });
    } else {
      // New field from add_field flow
      setLocal((s) => ({ ...s, fields: [...s.fields, updated] }));
    }
    setEditingFieldIndex(null);
    setNewFieldType(null);
    setSubState('default');
  }

  function handleFieldRemove(index: number) {
    setLocal((s) => ({
      ...s,
      fields: s.fields.filter((_, i) => i !== index),
    }));
  }

  // ── Sub-state: who_can_submit ──────────────────────────────────────────────
  if (subState === 'who_can_submit') {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            onClick={() => setSubState('default')}
            className="text-xs text-teal-600 hover:underline"
          >
            Back
          </button>
          <span className="text-sm font-semibold text-slate-800">Who can submit</span>
        </div>

        <div className="text-xs text-slate-500">
          Enter user IDs (one per line) who are allowed to submit this form.
          Leave empty to allow anyone.
        </div>

        <textarea
          rows={6}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500 resize-y"
          placeholder={"user-id-1\nuser-id-2"}
          value={local.whoCanSubmit.join('\n')}
          onChange={(e) =>
            setLocal((s) => ({
              ...s,
              whoCanSubmit: e.target.value
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean),
            }))
          }
        />

        <div className="text-[11px] text-slate-400">
          Full user picker (search by name) is available in V2.
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSubState('default')}
            className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // ── Sub-state: auto_fill ───────────────────────────────────────────────────
  if (subState === 'auto_fill') {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            onClick={() => setSubState('default')}
            className="text-xs text-teal-600 hover:underline"
          >
            Back
          </button>
          <span className="text-sm font-semibold text-slate-800">Auto-fill mode</span>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-3 cursor-pointer rounded-lg border p-3 hover:bg-slate-50">
            <input
              type="radio"
              name="autofill"
              value="none"
              checked={local.autoFill === 'none'}
              onChange={() => setLocal((s) => ({ ...s, autoFill: 'none' }))}
              className="accent-teal-600"
            />
            <div>
              <div className="text-sm font-medium text-slate-800">None</div>
              <div className="text-xs text-slate-500">No auto-fill. Submitter fills every field manually.</div>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer rounded-lg border p-3 hover:bg-slate-50">
            <input
              type="radio"
              name="autofill"
              value="last_successful_run"
              checked={local.autoFill === 'last_successful_run'}
              onChange={() => setLocal((s) => ({ ...s, autoFill: 'last_successful_run' }))}
              className="accent-teal-600"
            />
            <div>
              <div className="text-sm font-medium text-slate-800">Last successful run</div>
              <div className="text-xs text-slate-500">
                Pre-populate matching fields (by key + type) from the most recent completed run.
              </div>
            </div>
          </label>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSubState('default')}
            className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // ── Sub-state: add_field — pick field type ─────────────────────────────────
  if (subState === 'add_field') {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            onClick={() => setSubState('default')}
            className="text-xs text-teal-600 hover:underline"
          >
            Back
          </button>
          <span className="text-sm font-semibold text-slate-800">Add a field</span>
        </div>

        <div className="text-xs text-slate-500 mb-2">Choose field type:</div>

        <div className="grid grid-cols-2 gap-2">
          {FIELD_TYPES.map((ft) => (
            <button
              key={ft.value}
              type="button"
              onClick={() => {
                setNewFieldType(ft.value);
                setEditingFieldIndex(null);
                setSubState('edit_field');
              }}
              className="text-left px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-teal-50 hover:border-teal-300 focus:outline-none"
            >
              {ft.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Sub-state: edit_field ──────────────────────────────────────────────────
  if (subState === 'edit_field') {
    const fieldToEdit: AskFormFieldDef =
      editingFieldIndex !== null
        ? local.fields[editingFieldIndex]
        : emptyField(newFieldType ?? 'short_text');

    return (
      <div className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            onClick={() => {
              setSubState(editingFieldIndex !== null ? 'default' : 'add_field');
              setEditingFieldIndex(null);
              setNewFieldType(null);
            }}
            className="text-xs text-teal-600 hover:underline"
          >
            Back
          </button>
          <span className="text-sm font-semibold text-slate-800">
            {editingFieldIndex !== null ? 'Edit field' : 'New field'}
          </span>
        </div>
        <EditFieldPanel
          field={fieldToEdit}
          onSave={handleFieldSave}
          onCancel={() => {
            setSubState(editingFieldIndex !== null ? 'default' : 'add_field');
            setEditingFieldIndex(null);
            setNewFieldType(null);
          }}
        />
      </div>
    );
  }

  // ── Default state ─────────────────────────────────────────────────────────
  return (
    <div className="p-4 space-y-5">
      {/* Prompt */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Prompt
        </label>
        <textarea
          rows={3}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-y"
          placeholder="What do you need from the submitter?"
          value={local.prompt}
          onChange={(e) => setLocal((s) => ({ ...s, prompt: e.target.value }))}
        />
      </div>

      {/* Fields list */}
      <div>
        <div className="text-xs font-semibold text-slate-700 mb-2">Fields</div>
        {local.fields.length === 0 && (
          <div className="text-xs text-slate-400 mb-2">No fields added yet.</div>
        )}
        <div className="space-y-1.5 mb-2">
          {local.fields.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50"
            >
              <span className="text-[10px] bg-teal-100 text-teal-700 font-semibold px-1.5 py-0.5 rounded flex-shrink-0">
                {f.type}
              </span>
              <span className="text-sm text-slate-800 flex-1 truncate">
                {f.label || f.key}
              </span>
              {f.required && (
                <span className="text-[10px] text-red-500 flex-shrink-0">required</span>
              )}
              <button
                type="button"
                onClick={() => {
                  setEditingFieldIndex(i);
                  setSubState('edit_field');
                }}
                className="text-xs text-teal-600 hover:underline flex-shrink-0"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleFieldRemove(i)}
                className="text-xs text-red-500 hover:underline flex-shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSubState('add_field')}
          className="text-sm text-teal-600 hover:underline font-medium"
        >
          + Add a field
        </button>
      </div>

      {/* Allow skip */}
      <div className="flex items-center gap-2">
        <input
          id="ask-allow-skip"
          type="checkbox"
          className="rounded border-slate-300"
          checked={local.allowSkip}
          onChange={(e) => setLocal((s) => ({ ...s, allowSkip: e.target.checked }))}
        />
        <label htmlFor="ask-allow-skip" className="text-sm text-slate-700">
          Allow submitter to skip this step
        </label>
      </div>

      {/* Who can submit */}
      <div>
        <div className="text-xs font-semibold text-slate-700 mb-1">Who can submit</div>
        <button
          type="button"
          onClick={() => setSubState('who_can_submit')}
          className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 focus:outline-none"
        >
          {local.whoCanSubmit.length > 0
            ? `${local.whoCanSubmit.length} user${local.whoCanSubmit.length !== 1 ? 's' : ''} specified`
            : 'Anyone (no restriction)'}
          <span className="ml-1 text-slate-400 text-xs">Edit</span>
        </button>
      </div>

      {/* Auto-fill */}
      <div>
        <div className="text-xs font-semibold text-slate-700 mb-1">Auto-fill</div>
        <button
          type="button"
          onClick={() => setSubState('auto_fill')}
          className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 focus:outline-none"
        >
          {local.autoFill === 'last_successful_run'
            ? 'Last successful run (key + type match)'
            : 'None'}
          <span className="ml-1 text-slate-400 text-xs">Edit</span>
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleSaveMain}
          className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
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

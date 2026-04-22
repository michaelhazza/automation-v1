import { useState } from 'react';
import api from '../../lib/api.js';
import type { RuleCaptureRequest, RuleScope, SaveRuleResult } from '../../../../shared/types/briefRules.js';

interface RuleCaptureDialogProps {
  initialText?: string;
  defaultScope?: RuleScope;
  originatingBriefId?: string;
  originatingArtefactId?: string;
  onSaved?: (result: SaveRuleResult) => void;
  onClose: () => void;
}

export function RuleCaptureDialog({
  initialText = '',
  defaultScope = { kind: 'org' },
  originatingBriefId,
  originatingArtefactId,
  onSaved,
  onClose,
}: RuleCaptureDialogProps) {
  const [text, setText] = useState(initialText);
  const [scopeKind, setScopeKind] = useState<RuleScope['kind']>(defaultScope.kind);
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);

    // Defensive guard — the dropdown disables non-matching options, but if the
    // user somehow selected a non-org scope without a matching defaultScope
    // (browser dev-tools edit, stale state) refuse the save rather than
    // silently widening the rule to org.
    if (scopeKind !== 'org' && defaultScope.kind !== scopeKind) {
      setError(
        `Cannot save a ${scopeKind}-scoped rule from this dialog — open the capture flow from a ${scopeKind} context.`,
      );
      setSaving(false);
      return;
    }

    const scope: RuleScope = scopeKind === 'org' ? { kind: 'org' } : defaultScope;

    const body: RuleCaptureRequest = {
      text: text.trim(),
      scope,
      priority,
      originatingBriefId,
      originatingArtefactId,
    };

    try {
      const result = await api.post<SaveRuleResult>('/api/rules', body);
      if (result.data.saved) {
        onSaved?.(result.data);
        onClose();
      } else {
        setError('Conflicts detected — please resolve before saving.');
      }
    } catch {
      setError('Failed to save rule. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Save a rule</h2>
        <p className="text-sm text-gray-500 mb-4">
          Rules guide how the system acts for you. Keep them in plain English.
        </p>

        <label className="block text-sm font-medium text-gray-700 mb-1">Rule</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="e.g. Always exclude opted-out contacts from bulk emails"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
          autoFocus
        />

        <div className="flex gap-4 mb-6">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Scope</label>
            <select
              value={scopeKind}
              onChange={(e) => setScopeKind(e.target.value as RuleScope['kind'])}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="org">Entire organisation</option>
              {/*
                Non-org options are only selectable when the caller supplied a
                matching non-org defaultScope carrying the concrete id. Without
                that id the dialog cannot honour the selection and would
                silently save as org — see RuleCaptureDialog scope-fallback.
              */}
              <option value="subaccount" disabled={defaultScope.kind !== 'subaccount'}>
                This client{defaultScope.kind === 'subaccount' ? '' : ' (open from a client to save here)'}
              </option>
              <option value="agent" disabled={defaultScope.kind !== 'agent'}>
                Specific agent{defaultScope.kind === 'agent' ? '' : ' (open from an agent to save here)'}
              </option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Not now
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !text.trim()}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save rule'}
          </button>
        </div>
      </div>
    </div>
  );
}

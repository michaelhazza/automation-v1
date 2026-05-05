import { useState } from 'react';
import type { RuleRow, RulePatch } from '../../../../shared/types/briefRules.js';

interface RuleEditDialogProps {
  rule: RuleRow;
  onSave: (ruleId: string, patch: RulePatch) => Promise<void>;
  onClose: () => void;
}

export function RuleEditDialog({ rule, onSave, onClose }: RuleEditDialogProps) {
  const [text, setText] = useState(rule.text);
  const [priority, setPriority] = useState<RulePatch['priority']>(rule.priority);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(rule.id, { text, priority });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Edit rule</h2>

        <label className="block text-sm font-medium text-gray-700 mb-1">Rule text</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
        />

        <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as RulePatch['priority'])}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-6"
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !text.trim()}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

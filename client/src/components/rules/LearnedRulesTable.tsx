import { useState } from 'react';
import type { RuleRow, RulePatch } from '../../../../shared/types/briefRules.js';
import { RuleEditDialog } from './RuleEditDialog.js';

interface LearnedRulesTableProps {
  rules: RuleRow[];
  onPatch: (ruleId: string, patch: RulePatch) => Promise<void>;
  onDelete: (ruleId: string) => Promise<void>;
}

const PRIORITY_LABEL: Record<RuleRow['priority'], string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const SCOPE_LABEL = (rule: RuleRow): string => {
  switch (rule.scope.kind) {
    case 'org': return 'Org-wide';
    case 'subaccount': return 'Client';
    case 'agent': return 'Agent';
  }
};

const STATUS_STYLES: Record<RuleRow['status'], string> = {
  active: 'text-green-700 bg-green-50',
  paused: 'text-yellow-700 bg-yellow-50',
  deprecated: 'text-gray-500 bg-gray-100',
};

export function LearnedRulesTable({ rules, onPatch, onDelete }: LearnedRulesTableProps) {
  const [editing, setEditing] = useState<RuleRow | null>(null);

  if (rules.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-8 text-center">
        No rules yet. Use /remember in any Brief to teach the system your preferences.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead>
            <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-3 w-1/2">Rule</th>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rules.map((rule) => (
              <tr key={rule.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 max-w-xs">
                  <p className="text-gray-900 line-clamp-2">{rule.text}</p>
                  {rule.isAuthoritative && (
                    <span className="text-xs text-indigo-600 font-medium">Authoritative</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{SCOPE_LABEL(rule)}</td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{PRIORITY_LABEL[rule.priority]}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[rule.status]}`}>
                    {rule.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditing(rule)}
                      className="text-xs text-indigo-600 hover:text-indigo-800"
                    >
                      Edit
                    </button>
                    {rule.status === 'active' && (
                      <button
                        onClick={() => onPatch(rule.id, { status: 'paused' })}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        Pause
                      </button>
                    )}
                    {rule.status === 'paused' && (
                      <button
                        onClick={() => onPatch(rule.id, { status: 'active' })}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        Resume
                      </button>
                    )}
                    <button
                      onClick={() => onDelete(rule.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <RuleEditDialog
          rule={editing}
          onSave={onPatch}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

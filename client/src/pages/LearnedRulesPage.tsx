import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import api from '../lib/api.js';
import { LearnedRulesTable } from '../components/rules/LearnedRulesTable.js';
import { RuleCaptureDialog } from '../components/rules/RuleCaptureDialog.js';
import type { RuleRow, RuleListResult, RuleListFilter, RulePatch, RuleScope } from '../../../shared/types/briefRules.js';

interface LearnedRulesPageProps {
  user?: { organisationId?: string };
}

type StatusFilter = 'all' | 'active' | 'paused' | 'deprecated';
type ScopeFilter = 'all' | 'subaccount' | 'agent' | 'org';

export default function LearnedRulesPage({ user: _user }: LearnedRulesPageProps) {
  const [searchParams] = useSearchParams();
  // Mounted under two routes: `/rules` (org-wide) and `/subaccounts/:id/rules`
  // (scoped to a single client). Without reading `:id` the subaccount route
  // silently shows org-wide rules and any capture defaults to org scope.
  const { id: subaccountId } = useParams<{ id?: string }>();
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCapture, setShowCapture] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');

  // Pre-select from URL if navigated from provenance click
  const preselectedRuleId = searchParams.get('ruleId');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // When mounted on /subaccounts/:id/rules, force-pin the filter to that
      // subaccount regardless of the dropdown — the route itself names the
      // scope. On /rules the dropdown drives filtering.
      const filter: RuleListFilter = subaccountId
        ? {
            status: statusFilter === 'all' ? undefined : statusFilter,
            scopeType: 'subaccount',
            scopeId: subaccountId,
          }
        : {
            status: statusFilter === 'all' ? undefined : statusFilter,
            scopeType: scopeFilter === 'all' ? undefined : scopeFilter,
          };
      const params = new URLSearchParams();
      if (filter.status) params.set('status', filter.status);
      if (filter.scopeType) params.set('scopeType', filter.scopeType);
      if (filter.scopeId) params.set('scopeId', filter.scopeId);
      const result = await api.get<RuleListResult>(`/api/rules?${params}`);
      setRules(result.data.rules);
      setTotalCount(result.data.totalCount);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, scopeFilter, subaccountId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handlePatch(ruleId: string, patch: RulePatch) {
    await api.patch(`/api/rules/${ruleId}`, patch);
    await load();
  }

  async function handleDelete(ruleId: string) {
    await api.delete(`/api/rules/${ruleId}`);
    await load();
  }

  const filteredRules = preselectedRuleId
    ? rules
    : rules;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Learned Rules</h1>
          <p className="text-sm text-gray-500 mt-0.5">{totalCount} rule{totalCount !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowCapture(true)}
          className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          + Add rule
        </button>
      </div>

      <div className="flex gap-3 mb-4">
        <div>
          <label className="sr-only">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="deprecated">Deprecated</option>
          </select>
        </div>
        <div>
          <label className="sr-only">Scope</label>
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5"
          >
            <option value="all">All scopes</option>
            <option value="org">Org-wide</option>
            <option value="subaccount">Client</option>
            <option value="agent">Agent</option>
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
      ) : (
        <LearnedRulesTable
          rules={filteredRules}
          onPatch={handlePatch}
          onDelete={handleDelete}
        />
      )}

      {showCapture && (
        <RuleCaptureDialog
          defaultScope={
            subaccountId
              ? ({ kind: 'subaccount', subaccountId } as RuleScope)
              : ({ kind: 'org' } as RuleScope)
          }
          onSaved={() => { void load(); }}
          onClose={() => setShowCapture(false)}
        />
      )}
    </div>
  );
}

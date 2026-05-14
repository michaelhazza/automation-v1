import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { referencePreview } from './format';
import type { Insight, InsightFacets } from './types';

interface Props {
  subaccountId: string;
  search: string;
  onTabSwitchTo(next: 'references'): void;
  onPromotedToReference(): Promise<void>;
}

export function InsightsTab({ subaccountId, search, onTabSwitchTo, onPromotedToReference }: Props) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightFacets, setInsightFacets] = useState<InsightFacets>({
    domains: [],
    topics: [],
    entryTypes: [],
    taskSlugs: [],
  });
  const [insightFilters, setInsightFilters] = useState<{
    domain: string;
    topic: string;
    entryType: string;
    taskSlug: string;
  }>({ domain: '', topic: '', entryType: '', taskSlug: '' });
  const [insightsLoading, setInsightsLoading] = useState(false);

  useEffect(() => {
    loadInsights();
    // reason: `loadInsights` is an inline async function that closes over state setters; only the filter keys are the intended triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subaccountId, insightFilters]);

  async function loadInsights() {
    try {
      setInsightsLoading(true);
      const params = new URLSearchParams();
      if (insightFilters.domain) params.set('domain', insightFilters.domain);
      if (insightFilters.topic) params.set('topic', insightFilters.topic);
      if (insightFilters.entryType) params.set('entryType', insightFilters.entryType);
      if (insightFilters.taskSlug) params.set('taskSlug', insightFilters.taskSlug);
      const qs = params.toString();
      const res = await api.get(
        `/api/subaccounts/${subaccountId}/knowledge/insights${qs ? `?${qs}` : ''}`,
      );
      setInsights(res.data.insights ?? []);
      setInsightFacets(
        res.data.facets ?? { domains: [], topics: [], entryTypes: [], taskSlugs: [] },
      );
    } catch {
      toast.error('Failed to load insights');
    } finally {
      setInsightsLoading(false);
    }
  }

  async function handlePromoteInsight(insightId: string) {
    try {
      await api.post(
        `/api/subaccounts/${subaccountId}/knowledge/insights/${insightId}/promote-to-reference`,
        {},
      );
      toast.success('Insight promoted to Reference');
      await onPromotedToReference();
      onTabSwitchTo('references');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to promote';
      toast.error(msg);
    }
  }

  const filteredInsights = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return insights;
    return insights.filter((i) => i.content.toLowerCase().includes(q));
  }, [insights, search]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <InsightFilterSelect
          label="Domain"
          value={insightFilters.domain}
          options={insightFacets.domains}
          onChange={(v) => setInsightFilters((f) => ({ ...f, domain: v }))}
        />
        <InsightFilterSelect
          label="Topic"
          value={insightFilters.topic}
          options={insightFacets.topics}
          onChange={(v) => setInsightFilters((f) => ({ ...f, topic: v }))}
        />
        <InsightFilterSelect
          label="Type"
          value={insightFilters.entryType}
          options={insightFacets.entryTypes}
          onChange={(v) => setInsightFilters((f) => ({ ...f, entryType: v }))}
        />
        <InsightFilterSelect
          label="Task"
          value={insightFilters.taskSlug}
          options={insightFacets.taskSlugs}
          onChange={(v) => setInsightFilters((f) => ({ ...f, taskSlug: v }))}
        />
        {(insightFilters.domain ||
          insightFilters.topic ||
          insightFilters.entryType ||
          insightFilters.taskSlug) && (
          <button
            onClick={() =>
              setInsightFilters({ domain: '', topic: '', entryType: '', taskSlug: '' })
            }
            className="px-2.5 py-1 text-[12px] text-indigo-700 hover:text-indigo-900 cursor-pointer"
          >
            Clear filters
          </button>
        )}
      </div>

      <InsightsTable
        items={filteredInsights}
        loading={insightsLoading}
        onPromote={handlePromoteInsight}
      />
    </>
  );
}

function InsightFilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
      <span className="font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1 border border-slate-200 rounded text-[12px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <option value="">All</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Insights tab (spec §7 G6.3 / G6.4) — auto-captured workspace memory entries
 * (agentRunId IS NOT NULL). Each row offers a Promote-to-Reference button
 * that creates a new Reference with a promotedFromEntryId back-link.
 */
function InsightsTable({
  items,
  loading,
  onPromote,
}: {
  items: Insight[];
  loading: boolean;
  onPromote: (insightId: string) => void;
}) {
  if (loading) {
    return (
      <div className="py-12 text-center text-slate-400 text-[14px]">Loading insights…</div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="py-16 text-center text-slate-400">
        <p className="text-[16px] mb-2">No insights yet</p>
        <p className="text-[14px]">
          Insights are captured automatically from agent runs. Run an agent on this workspace to
          seed the list.
        </p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {['Insight', 'Type', 'Domain / Topic', 'Source', 'Quality', 'Captured', 'Actions'].map(
              (h) => (
                <th
                  key={h}
                  className="text-left px-3 py-2.5 text-[12px] font-semibold text-slate-500 uppercase tracking-wide"
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-slate-50 transition-colors align-top">
              <td className="px-3 py-3 text-[13px] text-slate-700 max-w-[480px]">
                <div className="line-clamp-2">{referencePreview(item.content)}</div>
              </td>
              <td className="px-3 py-3 text-[13px] text-slate-500">{item.entryType}</td>
              <td className="px-3 py-3 text-[12px]">
                <div className="flex flex-wrap gap-1">
                  {item.domain && (
                    <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded border border-indigo-100">
                      {item.domain}
                    </span>
                  )}
                  {item.topic && (
                    <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded border border-slate-200">
                      {item.topic}
                    </span>
                  )}
                  {!item.domain && !item.topic && (
                    <span className="text-slate-400">&mdash;</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-3 text-[13px] text-slate-500">
                <div className="flex flex-col">
                  <span className="truncate max-w-[160px]" title={item.agentName ?? ''}>
                    {item.agentName ?? '—'}
                  </span>
                  {item.taskSlug && (
                    <span className="text-[11px] text-slate-400">{item.taskSlug}</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-3 text-[13px] text-slate-500">
                {typeof item.qualityScore === 'number'
                  ? item.qualityScore.toFixed(2)
                  : '—'}
              </td>
              <td className="px-3 py-3 text-[13px] text-slate-500">
                {new Date(item.createdAt).toLocaleDateString()}
              </td>
              <td className="px-3 py-3">
                <button
                  onClick={() => onPromote(item.id)}
                  className="btn btn-xs btn-ghost text-indigo-700 hover:bg-indigo-50"
                >
                  Promote
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

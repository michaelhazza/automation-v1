import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { V1_BASELINE_METRICS } from '../../../../shared/constants/baselineMetrics';

interface MetricValue {
  numeric: number;
  currency?: string;
  unit: string;
}

interface BaselineMetricRow {
  metricSlug: string;
  value: MetricValue;
  source: string;
}

interface BaselineData {
  id: string;
  status: string;
  confidence?: string;
  metrics: BaselineMetricRow[];
}

interface MetricFormEntry {
  numeric: string;
  currency: string;
}

const LABEL: Record<string, string> = {
  pipeline_value: 'Pipeline value',
  open_opportunity_count: 'Open opportunities',
  lead_count: 'Lead count',
  conversation_engagement: 'Conversation engagement',
  revenue_last_30d: 'Revenue (last 30 days)',
  gmb_rank: 'Google Business Profile rank',
  review_count: 'Review count',
  review_avg_rating: 'Average review rating',
  mrr: 'Monthly recurring revenue',
  customer_count: 'Customer count',
  churn_rate: 'Churn rate',
};

const CURRENCIES = ['USD', 'GBP', 'EUR', 'AUD', 'CAD', 'NZD'];

export function ManualBaselineForm({
  subaccountId,
  onSaved,
}: {
  subaccountId: string;
  onSaved?: () => void;
}) {
  const [baseline, setBaseline] = useState<BaselineData | null>(null);
  const [form, setForm] = useState<Record<string, MetricFormEntry>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api
      .get<BaselineData>(`/api/subaccounts/${subaccountId}/baseline`)
      .then(({ data }) => {
        setBaseline(data);
        const initial: Record<string, MetricFormEntry> = {};
        for (const m of data.metrics) {
          // Server stores cents as integers — surface as dollars in the form so
          // operators don't enter "47000" expecting it to mean $470. Numeric
          // inputs for non-cents metrics keep their integer/percent representation.
          const meta = V1_BASELINE_METRICS.find((mm) => mm.slug === m.metricSlug);
          const stored = m.value.numeric;
          const display =
            stored == null
              ? ''
              : meta?.unit === 'cents'
                ? String(stored / 100)
                : String(stored);
          initial[m.metricSlug] = {
            numeric: display,
            currency: m.value.currency ?? 'USD',
          };
        }
        setForm(initial);
      })
      .catch(() => {
        setBaseline(null);
      })
      .finally(() => setLoading(false));
  }, [subaccountId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    const metrics: { slug: string; numeric: number; currency?: string }[] = [];
    for (const m of V1_BASELINE_METRICS) {
      const entry = form[m.slug];
      if (!entry || entry.numeric === '') continue;
      const parsed = parseFloat(entry.numeric);
      if (isNaN(parsed) || parsed < 0) continue;
      // Convert dollars-and-cents input to integer cents for cents-unit metrics
      // so the manual write matches the canonical-metric reader format which
      // stores cents directly. Math.round protects against float artifacts on
      // values like 47.55 * 100 = 4754.999...
      const numeric = m.unit === 'cents' ? Math.round(parsed * 100) : parsed;
      metrics.push({
        slug: m.slug,
        numeric,
        ...(m.unit === 'cents' ? { currency: entry.currency || 'USD' } : {}),
      });
    }

    if (metrics.length === 0) {
      setError('Enter at least one metric value.');
      setSaving(false);
      return;
    }

    try {
      await api.post(`/api/subaccounts/${subaccountId}/baseline/manual`, { metrics });
      toast.success('Baseline metrics saved.');
      onSaved?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string | { code?: string; message?: string } } } };
      const errBody = e.response?.data?.error;
      const message =
        typeof errBody === 'string'
          ? errBody
          : errBody?.message ?? 'Failed to save metrics';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-sm text-slate-500 py-4">Loading baseline...</div>;
  if (!baseline) return null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="text-[13px] text-red-600">{error}</div>}

      <div className="grid gap-3">
        {V1_BASELINE_METRICS.map((m) => {
          const entry = form[m.slug] ?? { numeric: '', currency: 'USD' };
          return (
            <div key={m.slug} className="flex items-center gap-3">
              <label className="w-52 shrink-0 text-[13px] font-medium text-slate-700">
                {LABEL[m.slug] ?? m.slug}
              </label>
              <input
                type="number"
                min="0"
                step={m.unit === 'cents' ? '0.01' : '1'}
                placeholder="—"
                value={entry.numeric}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    [m.slug]: { ...entry, numeric: e.target.value },
                  }))
                }
                className="w-36 px-3 py-1.5 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {m.unit === 'cents' && (
                <select
                  value={entry.currency}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      [m.slug]: { ...entry, currency: e.target.value },
                    }))
                  }
                  className="px-2 py-1.5 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
              <span className="text-[12px] text-slate-400">{m.source}</span>
            </div>
          );
        })}
      </div>

      <button
        type="submit"
        disabled={saving}
        className="btn btn-primary"
      >
        {saving ? 'Saving...' : 'Save metrics'}
      </button>
    </form>
  );
}

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { User } from '../lib/auth';
import { RunActivityChart } from '../components/ActivityCharts';
import { prevMonth, nextMonth } from '../components/usage/format';
import { SHIMMER_CLASS } from '../components/usage/constants';
import { RoutingTab } from '../components/usage/tabs/RoutingTab';
import { MonthNavigator } from '../components/usage/MonthNavigator';
import { SummaryCards } from '../components/usage/SummaryCards';
import { BudgetBars } from '../components/usage/BudgetBars';
import { TabBar } from '../components/usage/TabBar';
import { useUsageData } from '../hooks/useUsageData';
import { OverviewTab } from '../components/usage/tabs/OverviewTab';
import { AgentsTab } from '../components/usage/tabs/AgentsTab';
import { ModelsTab } from '../components/usage/tabs/ModelsTab';
import { RunsTab } from '../components/usage/tabs/RunsTab';
import { IeeTab } from '../components/usage/tabs/IeeTab';
import MemoryUtilityTab from './MemoryUtilityTab';

// ─── Main component ────────────────────────────────────────────────────────────

export default function UsagePage({ user: _user, embedded = false }: { user: User; embedded?: boolean }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();

  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [tab, setTab] = useState<import('../components/usage/types').Tab>('overview');

  const data = useUsageData(subaccountId, month);
  const { loadTab } = data;

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  const monthlySpent = data.summary?.monthly?.totalCostCents ?? 0;
  const todaySpent   = data.summary?.today?.totalCostCents ?? 0;
  const monthLimit   = data.summary?.limits?.monthlyCostLimitCents ?? null;
  const dailyLimit   = data.summary?.limits?.dailyCostLimitCents ?? null;

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both] max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        {!embedded && (
        <div>
          <h1 className="text-[26px] font-extrabold text-slate-900 tracking-tight m-0">Usage & Costs</h1>
          <p className="text-sm text-slate-500 mt-1">
            LLM spending, token usage, and budget tracking
            <span className="ml-2 text-[11px] text-slate-400 font-normal">(cost totals update within ~30s of activity)</span>
          </p>
        </div>
        )}

        <MonthNavigator
          month={month}
          thisMonth={thisMonth}
          onPrev={() => setMonth(m => prevMonth(m))}
          onNext={() => setMonth(m => nextMonth(m))}
        />
      </div>

      <SummaryCards summary={data.summary} loading={data.loading} />

      {!data.loading && (
        <BudgetBars
          monthlySpent={monthlySpent}
          todaySpent={todaySpent}
          monthLimit={monthLimit}
          dailyLimit={dailyLimit}
        />
      )}

      {/* Run activity chart */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-[14px] font-bold text-slate-900 m-0">Run Activity</h3>
            <p className="text-[11px] text-slate-400 mt-0.5 m-0">Rolling 14-day window — independent of the month selector above</p>
          </div>
          <span className="text-[12px] text-slate-400">
            {data.daily.reduce((s, d) => s + d.total, 0)} total runs
          </span>
        </div>
        {data.loading
          ? <div className={`h-[140px] w-full ${SHIMMER_CLASS}`} />
          : <RunActivityChart data={data.daily} />
        }
      </div>

      {/* Tabs */}
      <TabBar active={tab} onChange={setTab} />

      {/* Tab: Overview */}
      {tab === 'overview' && <OverviewTab month={month} summary={data.summary} />}

      {/* Tab: Agents */}
      {tab === 'agents' && <AgentsTab rows={data.agents} loading={data.tabLoading} />}

      {/* Tab: Models */}
      {tab === 'models' && <ModelsTab rows={data.models} loading={data.tabLoading} />}

      {/* Tab: Runs */}
      {tab === 'runs' && <RunsTab rows={data.runs} loading={data.tabLoading} subaccountId={subaccountId!} />}

      {/* Tab: Routing */}
      {tab === 'routing' && (
        <RoutingTab
          subaccountId={subaccountId!}
          month={month}
          distribution={data.routing.distribution}
          log={data.routing.log}
          nextCursor={data.routing.nextCursor}
          nextCursorId={data.routing.nextCursorId}
          loadingMore={data.routing.loadingMore}
          selectedRequest={data.routing.selectedRequest}
          filters={data.routing.filters}
          tabLoading={data.routing.tabLoading}
          onFilterChange={(f) => { data.setRoutingFilters(f); }}
          onLoadMore={data.routingLoadMore}
          onSelectRequest={data.selectRequest}
        />
      )}

      {/* Tab: IEE Execution (rev 6 §11.8) */}
      {tab === 'iee' && <IeeTab rows={data.iee.rows} summary={data.iee.summary} loading={data.iee.tabLoading} filters={data.iee.filters} onFilterChange={data.setIeeFilters} />}

      {/* Tab: Memory Utility */}
      {tab === 'memory_utility' && <MemoryUtilityTab />}
    </div>
  );
}


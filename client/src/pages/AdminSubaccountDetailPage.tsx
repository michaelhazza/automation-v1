import { useEffect, useState, lazy, Suspense } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import { WorkspaceTabContent } from '../components/workspace/WorkspaceTabContent';
import { BaselineStatusBadge } from '../components/baseline/BaselineStatusBadge';
import { AgentsTab } from '../components/admin-subaccount-detail/AgentsTab';
import { BeliefsTab } from '../components/admin-subaccount-detail/BeliefsTab';
import { OnboardingTab } from '../components/admin-subaccount-detail/OnboardingTab';
import { WorkflowsTab } from '../components/admin-subaccount-detail/WorkflowsTab';
import { CategoriesTab } from '../components/admin-subaccount-detail/CategoriesTab';
import { BoardConfigTab } from '../components/admin-subaccount-detail/BoardConfigTab';
import { AdminTab } from '../components/admin-subaccount-detail/AdminTab';
import OperatorSettingsTab from './govern/operatorSettings/OperatorSettingsTab';
import type { Subaccount, Category, ProcessLink, OrgProcess, ActiveTab } from '../components/admin-subaccount-detail/types';
import { TAB_LABELS } from '../components/admin-subaccount-detail/types';

const UsagePage = lazy(() => import('./UsagePage'));
const AdminEnginesPage = lazy(() => import('./AdminEnginesPage'));
const SubaccountTagsPage = lazy(() => import('./SubaccountTagsPage'));

export default function AdminSubaccountDetailPage({ user: _user, mode = 'admin' }: { user: User; mode?: 'client' | 'admin' }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [sa, setSa] = useState<Subaccount | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [linkedProcesses, setLinkedProcesses] = useState<ProcessLink[]>([]);
  const [orgProcesses, setOrgProcesses] = useState<OrgProcess[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchParams] = useSearchParams();
  const canSeeOperatorTab = mode === 'admin' && (
    _user.role === 'org_admin' || _user.role === 'manager' ||
    _user.role === 'subaccount_admin' || _user.role === 'system_admin'
  );
  const canEditOperatorSettings =
    _user.role === 'org_admin' || _user.role === 'subaccount_admin' || _user.role === 'system_admin';
  const adminTabs: ActiveTab[] = ['onboarding', 'engines', 'workflows', 'agents', 'beliefs', 'categories', 'tags', 'board'];
  if (canSeeOperatorTab) adminTabs.push('operator');
  adminTabs.push('usage', 'workspace', 'admin');
  const visibleTabs: ActiveTab[] = mode === 'client'
    ? ['board', 'categories']
    : adminTabs;
  const initialTab = (() => {
    const t = searchParams.get('tab') as ActiveTab | null;
    return t && visibleTabs.includes(t) ? t : visibleTabs[0];
  })();
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab);
  const [loadError, setLoadError] = useState('');

  const [baselineStatus, setBaselineStatus] = useState<{ status: string; confidence?: string } | null>(null);

  const load = async () => {
    if (!subaccountId) return;
    try {
      const [saRes, catRes, processRes, baselineRes] = await Promise.all([
        api.get(`/api/subaccounts/${subaccountId}`),
        api.get(`/api/subaccounts/${subaccountId}/categories`),
        api.get(`/api/subaccounts/${subaccountId}/automations`).catch((err) => { console.error('[AdminSubaccountDetail] Failed to fetch processes:', err); return { data: { linkedProcesses: [] } }; }),
        api.get(`/api/subaccounts/${subaccountId}/baseline`).catch(() => ({ data: null })),
      ]);
      setSa(saRes.data);
      setCategories(catRes.data);
      setLinkedProcesses(processRes.data.linkedProcesses ?? []);
      if (baselineRes?.data) setBaselineStatus({ status: baselineRes.data.status, confidence: baselineRes.data.confidence });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setLoadError(e.response?.data?.error ?? 'Failed to load subaccount');
    } finally {
      setLoading(false);
    }
  };

  const loadOrgData = async () => {
    const [processesRes] = await Promise.all([
      api.get('/api/automations').catch((err) => { console.error('[AdminSubaccountDetail] Failed to fetch processes:', err); return { data: [] }; }),
    ]);
    setOrgProcesses((processesRes.data as OrgProcess[]).filter(t => t.status === 'active'));
  };

  useEffect(() => { load(); loadOrgData(); }, [subaccountId]);

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  if (!sa) return <div className="p-8 text-sm text-red-600">{loadError || 'Subaccount not found'}</div>;

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      {mode === 'admin' && (
        <div className="mb-4">
          <Link to="/admin/subaccounts" className="text-[13px] text-indigo-600 hover:text-indigo-700 no-underline">
            ← Back to companies
          </Link>
        </div>
      )}

      <h1 className="text-[26px] font-bold text-slate-800 mb-1">
        {mode === 'client' ? `${sa.name} Settings` : sa.name}
      </h1>
      {mode === 'admin' && (
        <div className="flex items-center gap-3 mb-6">
          <span className="font-mono text-[13px] text-slate-400">{sa.slug}</span>
          {subaccountId && <BaselineStatusBadge subaccountId={subaccountId} />}
        </div>
      )}
      {mode === 'client' && <div className="text-[13px] text-slate-500 mb-6">Manage connections, board config, and categories</div>}

      {/* Tabs */}
      {visibleTabs.length > 1 && (
        <div className="border-b border-slate-200 mb-6 flex gap-1">
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-[14px] font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-indigo-600 text-indigo-600 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      )}

      {/* Workflows */}
      {activeTab === 'workflows' && (
        <WorkflowsTab subaccountId={subaccountId!} linkedProcesses={linkedProcesses} orgProcesses={orgProcesses} categories={categories} onChange={load} />
      )}

      {/* Board Config */}
      {activeTab === 'board' && (
        <BoardConfigTab subaccountId={subaccountId!} />
      )}

      {/* Categories */}
      {activeTab === 'categories' && (
        <CategoriesTab subaccountId={subaccountId!} categories={categories} onChange={load} />
      )}

      {/* Onboarding — spec §9.3: lists owed onboarding workflows per module set */}
      {activeTab === 'onboarding' && subaccountId && (
        <OnboardingTab subaccountId={subaccountId} />
      )}

      {/* Engines */}
      {activeTab === 'engines' && (
        <Suspense fallback={<div className="py-8 text-sm text-slate-500">Loading engines...</div>}>
          <AdminEnginesPage user={_user as any} embedded />
        </Suspense>
      )}

      {/* Agents — link/unlink org agents + load team templates */}
      {activeTab === 'agents' && subaccountId && (
        <AgentsTab subaccountId={subaccountId} />
      )}

      {/* Beliefs — per-agent discrete facts */}
      {activeTab === 'beliefs' && subaccountId && (
        <BeliefsTab subaccountId={subaccountId} />
      )}

      {/* Admin */}
      {activeTab === 'admin' && subaccountId && (
        <AdminTab subaccountId={subaccountId} user={_user} subaccount={sa} baselineStatus={baselineStatus} onSubaccountChanged={load} onBaselineSaved={load} />
      )}

      {/* Memory */}
      {activeTab === 'tags' && subaccountId && (
        <Suspense fallback={<div className="py-8 text-sm text-slate-500">Loading tags...</div>}>
          <SubaccountTagsPage />
        </Suspense>
      )}

      {/* Usage & Costs */}
      {activeTab === 'usage' && (
        <Suspense fallback={<div className="py-8 text-sm text-slate-500">Loading usage data...</div>}>
          <UsagePage user={_user as any} embedded />
        </Suspense>
      )}

      {/* Workspace */}
      {activeTab === 'workspace' && subaccountId && (
        <WorkspaceTabContent subaccountId={subaccountId} />
      )}

      {/* Operator Settings */}
      {activeTab === 'operator' && subaccountId && (
        <OperatorSettingsTab subaccountId={subaccountId} canEdit={canEditOperatorSettings} />
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import TestPanel from '../components/runs/TestPanel';
import type { AvailableSkill } from '../components/SkillPickerSection';
import AgentActivityTab from '../components/agent/AgentActivityTab';
import ModelsIdentityTab from '../components/agent-config/ModelsIdentityTab';
import IntegrationsTab from '../components/agent-config/IntegrationsTab';
import { ModelAccessSection } from './govern/components/ModelAccessSection';
import type { LinkDetail, Tab } from '../components/subaccount-agent-edit/types';
import { SkillsTab } from '../components/subaccount-agent-edit/SkillsTab';
import { InstructionsTab } from '../components/subaccount-agent-edit/InstructionsTab';
import { BudgetTab } from '../components/subaccount-agent-edit/BudgetTab';
import { SchedulingTab } from '../components/subaccount-agent-edit/SchedulingTab';
import { ExecutionTab } from '../components/subaccount-agent-edit/ExecutionTab';
import { GovernanceTab } from '../components/subaccount-agent-edit/GovernanceTab';
import { IdentityTab } from '../components/subaccount-agent-edit/IdentityTab';
import { BeliefsTab } from '../components/subaccount-agent-edit/BeliefsTab';

export default function SubaccountAgentEditPage({ user: _user }: { user: User }) {
  const { subaccountId, linkId } = useParams<{ subaccountId: string; linkId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [link, setLink] = useState<LinkDetail | null>(null);
  const [availableSkills, setAvailableSkills] = useState<AvailableSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialTab = (searchParams.get('tab') as Tab | null) ?? 'skills';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [showOnboardedBanner, setShowOnboardedBanner] = useState(
    searchParams.get('newlyOnboarded') === '1',
  );

  async function load() {
    try {
      const [linkRes, skillsRes] = await Promise.all([
        api.get(`/api/subaccounts/${subaccountId}/agents/${linkId}/detail`),
        api.get(`/api/subaccounts/${subaccountId}/skills`),
      ]);
      setLink(linkRes.data); setAvailableSkills(skillsRes.data ?? []);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } | string } }; message?: string };
      const apiErr = err.response?.data?.error;
      const msg = typeof apiErr === 'string' ? apiErr : apiErr?.message;
      setError(msg ?? err.message ?? 'Failed to load agent configuration');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [subaccountId, linkId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="p-8 text-[13px] text-slate-400">Loading…</div>;
  }
  if (error || !link) {
    return (
      <div className="p-8">
        <div className="text-red-600 text-[13px] mb-4">{error ?? 'Agent link not found'}</div>
        <button onClick={() => navigate(-1)} className="text-indigo-600 text-[13px] hover:underline bg-transparent border-0 cursor-pointer p-0">← Back</button>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'skills', label: 'Skills' },
    { id: 'instructions', label: 'Instructions' },
    { id: 'budget', label: 'Budget' },
    { id: 'scheduling', label: 'Scheduling' },
    { id: 'execution', label: 'Execution' },
    { id: 'governance', label: 'Governance' },
    { id: 'models_identity', label: 'Models and Identity' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'beliefs', label: 'Beliefs' },
    { id: 'identity', label: 'Identity' },
    { id: 'activity', label: 'Activity' },
  ];

  return (
    <div className="flex items-start gap-0 -mx-6 -my-7">
    <div className="flex-1 min-w-0 max-w-3xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <div className="text-[12px] text-slate-400 mb-5 flex items-center gap-1.5">
        <Link to="/admin/subaccounts" className="hover:text-slate-700 no-underline">Subaccounts</Link>
        <span>/</span>
        <Link to={`/admin/subaccounts/${subaccountId}`} className="hover:text-slate-700 no-underline">Subaccount</Link>
        <span>/</span>
        <span className="text-slate-600">Agent Config</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        {link.agent.icon && <span className="text-3xl">{link.agent.icon}</span>}
        <div>
          <h1 className="text-[22px] font-semibold text-slate-900 m-0">{link.agent.name}</h1>
          <div className="text-[13px] text-slate-500 mt-0.5">Subaccount configuration</div>
        </div>
        <span className={`ml-auto text-[11px] font-semibold capitalize px-2.5 py-1 rounded-full ${link.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
          {link.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      {/* Org agent context (read-only) */}
      <div className="bg-slate-50 border border-slate-200 rounded-[10px] p-4 mb-6 text-[13px]">
        <div className="font-medium text-slate-600 mb-2 text-[11px] uppercase tracking-wide">Org-level agent (read-only)</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="text-slate-400 text-[11px]">Model</span>
            <div className="text-slate-800 font-medium">{link.agent.modelId}</div>
          </div>
          <div>
            <span className="text-slate-400 text-[11px]">Status</span>
            <div className="text-slate-800 font-medium capitalize">{link.agent.status}</div>
          </div>
        </div>
        {link.agent.description && (
          <div className="mt-2 text-slate-500">{link.agent.description}</div>
        )}
        <div className="mt-2">
          <Link to={`/admin/agents/${link.agentId}`} className="text-indigo-500 text-[12px] hover:underline no-underline">
            Edit org-level agent →
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-6 gap-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors bg-transparent cursor-pointer font-[inherit] ${
              activeTab === t.id
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Skills tab ── */}
      {activeTab === 'skills' && (
        <SkillsTab link={link} availableSkills={availableSkills} onSaved={load} />
      )}

      {/* ── Instructions tab ── */}
      {activeTab === 'instructions' && (
        <InstructionsTab link={link} onSaved={load} />
      )}

      {/* ── Budget tab ── */}
      {activeTab === 'budget' && (
        <BudgetTab link={link} onSaved={load} />
      )}

      {/* ── Scheduling tab ── */}
      {activeTab === 'scheduling' && (
        <SchedulingTab link={link} onSaved={load} />
      )}

      {/* ── Execution tab ── */}
      {activeTab === 'execution' && (
        <ExecutionTab link={link} onSaved={load} />
      )}

      {/* ── Governance tab ── */}
      {activeTab === 'governance' && (
        <GovernanceTab link={link} onSaved={load} />
      )}

      {/* ── Models and Identity tab ── */}
      {activeTab === 'models_identity' && (
        <>
          {subaccountId && (
            <ModelAccessSection agentId={link.agentId} subaccountId={subaccountId} />
          )}
          <ModelsIdentityTab
            modelProvider={link.agent.modelProvider}
            modelId={link.agent.modelId}
          />
        </>
      )}

      {/* ── Integrations tab ── */}
      {activeTab === 'integrations' && subaccountId && (
        <IntegrationsTab subaccountId={subaccountId} />
      )}

      {/* ── Beliefs tab ── */}
      {activeTab === 'beliefs' && subaccountId && linkId && (
        <BeliefsTab subaccountId={subaccountId} linkId={linkId} />
      )}

      {/* ── Identity tab ── */}
      {activeTab === 'identity' && (
        <>
          {showOnboardedBanner && (
            <div className="flex items-start justify-between gap-3 mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-[13px] text-green-800">
              <span>Identity provisioned. Confirm signature and channel preferences below.</span>
              <button
                onClick={() => setShowOnboardedBanner(false)}
                className="flex-shrink-0 text-green-600 hover:text-green-900 bg-transparent border-0 cursor-pointer p-0 leading-none"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}
          <IdentityTab agentId={link.agentId} onActionCompleted={load} />
        </>
      )}

      {/* ── Activity tab ── */}
      {activeTab === 'activity' && (
        link?.agent.workspaceActorId && subaccountId
          ? (
            <AgentActivityTab
              agentId={link.agentId}
              actorId={link.agent.workspaceActorId}
              subaccountId={subaccountId}
              agentName={link.agent.name}
            />
          )
          : (
            <div className="text-[13px] text-slate-500">
              This agent has no workspace identity.
            </div>
          )
      )}
    </div>

    {/* Test panel (right-hand) */}
    {subaccountId && linkId && (
      <TestPanel
        panelKey={`test-panel:agent:${linkId}`}
        label="Test"
        testRunEndpoint={`/api/subaccounts/${subaccountId}/agents/${linkId}/test-run`}
        fixturesEndpoint={`/api/subaccounts/${subaccountId}/agents/${linkId}/test-fixtures`}
        saveFixtureEndpoint={`/api/subaccounts/${subaccountId}/agents/${linkId}/test-fixtures`}
        hasUnsavedChanges={false}
        traceViewerBasePath={`/admin/subaccounts/${subaccountId}/runs`}
      />
    )}
    </div>
  );
}

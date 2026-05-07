import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { buildApi, EtagMismatchError } from '../../lib/api/build';
import api from '../../lib/api';
import { getUserRole } from '../../lib/auth';
import { PageShell } from '../../components/PageShell';
import { FormFooter } from '../../components/FormFooter';
import type {
  AgentFull,
  AgentConfigurePatch,
  AgentBehaviourPatch,
  AgentPersonalityPatch,
  AgentBudgetPatch,
  SkillBindingPayload,
  DataSourceBindingPayload,
  TriggerBindingPayload,
} from '../../../../shared/types/build';
import ConfigureTab from './components/AgentEditTabs/ConfigureTab';
import BehaviourTab from './components/AgentEditTabs/BehaviourTab';
import PersonalityTab from './components/AgentEditTabs/PersonalityTab';
import SkillsTab from './components/AgentEditTabs/SkillsTab';
import DataSourcesTab from './components/AgentEditTabs/DataSourcesTab';
import ScheduleTab from './components/AgentEditTabs/ScheduleTab';
import BudgetTab from './components/AgentEditTabs/BudgetTab';
import RunsTab from './components/AgentEditTabs/RunsTab';
import AgentVersionChip from './components/AgentVersionChip';
import DeleteAgentDialog from './components/DeleteAgentDialog';
import { TestRunnerCard } from './components/TestRunnerCard';

type TabKey = 'configure' | 'behaviour' | 'personality' | 'skills' | 'data-sources' | 'schedule' | 'budget' | 'runs';

const TAB_ORDER: TabKey[] = ['configure', 'behaviour', 'personality', 'skills', 'data-sources', 'schedule', 'budget', 'runs'];
// Note: 'budget' excluded from WRITE_ORDER - Phase 1 budget schema gap (see migration-gaps.md)
// Note: 'schedule' excluded - org-level trigger editing not in Phase 1 scope (see spec §4.2 Q5)

/**
 * WRITE_ORDER defines the sequence of tab saves during agent patch operations.
 *
 * Contract: This array must remain append-only and maintain its relative ordering.
 * Rationale: Each PATCH generates a new ETag (sha256 of canonical agent JSON). Reordering
 * the save sequence breaks deterministic ETag chaining — concurrent requests may see
 * different ETags for the same agent state, causing spurious 409 Conflict errors.
 * Additionally, tab state is cumulative (each tab builds on the previous); reordering
 * breaks the invariant that later tabs never see stale data from earlier tabs.
 *
 * Risk if reordered: ETag churn (repeated 409s on retry), lost optimistic updates,
 * non-deterministic conflict detection, and potential data races if sibling saves
 * happen concurrently (e.g., skills saved before configure would have the old agent
 * name in the ETag hash).
 */
const WRITE_ORDER: TabKey[] = ['configure', 'behaviour', 'personality', 'skills', 'data-sources'];

const TAB_LABELS: Record<TabKey, string> = {
  configure: 'Configure',
  behaviour: 'Behaviour',
  personality: 'Personality',
  skills: 'Skills',
  'data-sources': 'Data sources',
  schedule: 'Schedule',
  budget: 'Budget',
  runs: 'Runs',
};

type TabPatchMap = {
  configure?: AgentConfigurePatch;
  behaviour?: AgentBehaviourPatch;
  personality?: AgentPersonalityPatch;
  skills?: SkillBindingPayload[];
  'data-sources'?: DataSourceBindingPayload[];
  schedule?: TriggerBindingPayload[];
  budget?: AgentBudgetPatch;
};

export default function AgentEditPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const activeTab = (searchParams.get('tab') ?? 'configure') as TabKey;

  const [data, setData] = useState<AgentFull | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [pendingPatches, setPendingPatches] = useState<TabPatchMap>({});
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [etagMismatch, setEtagMismatch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const userRole = getUserRole();
  const isOrgAdmin = userRole === 'admin' || userRole === 'system_admin';

  const loadAgent = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const agent = await buildApi.getAgentFull(id);
      setData(agent);
    } catch {
      setLoadError('Failed to load agent.');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => { void loadAgent(); }, [loadAgent]);

  const dirtyTabs = useMemo(() => new Set(Object.keys(pendingPatches) as TabKey[]), [pendingPatches]);

  const patchTab = useCallback(<K extends keyof TabPatchMap>(tab: K, patch: TabPatchMap[K]) => {
    setPendingPatches(prev => ({ ...prev, [tab]: patch }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!data || saving) return;
    setSaving(true);
    setSaveError(null);
    let etag = data.etag;

    for (const tab of WRITE_ORDER) {
      if (!dirtyTabs.has(tab)) continue;
      try {
        let updated: AgentFull;
        const patch = pendingPatches[tab as keyof TabPatchMap];
        switch (tab) {
          case 'configure':
            updated = await buildApi.patchAgentConfigure(id!, patch as AgentConfigurePatch, etag);
            break;
          case 'behaviour':
            updated = await buildApi.patchAgentBehaviour(id!, patch as AgentBehaviourPatch, etag);
            break;
          case 'personality':
            updated = await buildApi.patchAgentPersonality(id!, patch as AgentPersonalityPatch, etag);
            break;
          case 'skills':
            updated = await buildApi.putAgentSkills(id!, patch as SkillBindingPayload[], etag);
            break;
          case 'data-sources':
            updated = await buildApi.putAgentDataSources(id!, patch as DataSourceBindingPayload[], etag);
            break;
          case 'schedule':
            updated = await buildApi.putAgentTriggers(id!, patch as TriggerBindingPayload[], etag);
            break;
          case 'budget':
            updated = await buildApi.patchAgentBudget(id!, patch as AgentBudgetPatch, etag);
            break;
          default:
            continue;
        }
        etag = updated.etag;
        setPendingPatches(prev => {
          const next = { ...prev };
          delete next[tab as keyof TabPatchMap];
          return next;
        });
      } catch (err) {
        if (err instanceof EtagMismatchError) {
          // ETag 412 (Conflict) handling: tab-local rollback invariant
          // - Failed tab save must not dirty sibling tabs (each tab manages its own optimistic state)
          // - Stale optimistic updates rollback deterministically (clear local state via loadAgent, re-fetch AgentFull)
          // - Unsaved state ownership is tab-scoped; 412 does not cascade across tabs
          // This guard ensures that if Tab A fails with 412, Tab B's unsaved changes remain intact.
          setEtagMismatch(true);
          setSaving(false);
          return;
        }
        setSaveError('Save failed. Please try again.');
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    void loadAgent();
  }, [data, dirtyTabs, pendingPatches, id, loadAgent, saving]);

  const handleDiscard = useCallback(() => setPendingPatches({}), []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!id) return;
    try {
      await api.delete(`/api/agents/${id}`);
      navigate('/agents');
    } catch {
      setDeleteError('Failed to delete agent. Please try again.');
    }
  }, [id, navigate]);

  if (isLoading) {
    return (
      <PageShell>
        <div className="p-8 text-slate-400 text-sm">Loading...</div>
      </PageShell>
    );
  }

  if (loadError || !data) {
    return (
      <PageShell>
        <div className="p-8 text-red-500 text-sm">{loadError ?? 'Agent not found.'}</div>
      </PageShell>
    );
  }

  const isReadOnly = data.isSystemManaged;

  return (
    <PageShell
      header={
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <h1 className="text-lg font-semibold text-slate-800 truncate">{data.configure.name}</h1>
          <AgentVersionChip
            count={data.agentRevisionCount}
            editedAt={data.lastRevisionEditedAt}
            author={data.lastRevisionAuthor}
          />
          {isReadOnly && (
            <span className="text-xs text-slate-500 ml-2">System agent (read-only)</span>
          )}
        </div>
      }
      bottomPadding={isReadOnly ? 0 : 100}
    >
      {/* ETag mismatch banner */}
      {etagMismatch && (
        <div role="alert" className="m-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3 text-sm">
          <span className="text-amber-700">
            This agent was changed by someone else. Reload to get the latest version.
          </span>
          <button
            onClick={() => { setEtagMismatch(false); void loadAgent(); }}
            className="btn btn-secondary text-xs"
          >
            Reload
          </button>
          <button
            onClick={() => setEtagMismatch(false)}
            aria-label="Dismiss conflict warning"
            className="btn btn-ghost text-xs ml-auto"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Delete error banner */}
      {deleteError && (
        <div role="alert" className="m-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center">
          {deleteError}
          <button onClick={() => setDeleteError(null)} className="ml-auto text-xs underline">Dismiss</button>
        </div>
      )}

      {saveError && (
        <div className="mx-4 mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {saveError}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 px-6 pt-4 border-b border-slate-100 overflow-x-auto">
        {TAB_ORDER.map(tab => (
          <button
            key={tab}
            onClick={() => setSearchParams({ tab })}
            className={[
              'px-4 py-2 text-sm font-medium rounded-t transition-colors whitespace-nowrap',
              activeTab === tab
                ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50'
                : 'text-slate-500 hover:text-slate-700',
              dirtyTabs.has(tab) ? 'after:content-["•"] after:ml-1 after:text-amber-500' : '',
            ].join(' ')}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-6 py-4">
        {activeTab === 'configure' && (
          <ConfigureTab
            data={data.configure}
            onChange={p => patchTab('configure', p)}
            pending={pendingPatches.configure}
            readOnly={isReadOnly}
          />
        )}
        {activeTab === 'behaviour' && (
          <BehaviourTab
            data={data.behaviour}
            onChange={p => patchTab('behaviour', p)}
            pending={pendingPatches.behaviour}
            readOnly={isReadOnly}
          />
        )}
        {activeTab === 'personality' && (
          <PersonalityTab
            data={data.personality}
            onChange={p => patchTab('personality', p)}
            pending={pendingPatches.personality}
            readOnly={isReadOnly}
          />
        )}
        {activeTab === 'skills' && (
          <SkillsTab
            data={data.skills}
            onChange={p => patchTab('skills', p)}
            pending={pendingPatches.skills}
            agentId={id!}
            readOnly={isReadOnly}
            isOrgAdmin={isOrgAdmin}
          />
        )}
        {activeTab === 'data-sources' && (
          <DataSourcesTab
            data={data.dataSources}
            onChange={p => patchTab('data-sources', p)}
            pending={pendingPatches['data-sources']}
            agentId={id!}
            readOnly={isReadOnly}
          />
        )}
        {activeTab === 'schedule' && (
          <ScheduleTab
            data={data.triggers}
            agentId={id!}
            readOnly={true}
          />
        )}
        {activeTab === 'budget' && (
          <BudgetTab
            data={data.budget}
            readOnly={true}
          />
        )}
        {activeTab === 'runs' && (
          <RunsTab agentId={id!} runs={data.runs} />
        )}
      </div>

      {/* Inline Test runner card — always visible across tabs (spec §4.7) */}
      {!isReadOnly && (
        <div className="px-6 pb-6">
          <TestRunnerCard agentId={id!} />
        </div>
      )}

      {/* Footer */}
      {!isReadOnly && (
        <FormFooter>
          <button
            onClick={handleDiscard}
            disabled={dirtyTabs.size === 0}
            className="btn btn-secondary"
          >
            Discard
          </button>
          <button
            onClick={handleSave}
            disabled={dirtyTabs.size === 0 || saving}
            className="btn btn-primary"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
          {isOrgAdmin && (
            <button
              onClick={() => setShowDeleteDialog(true)}
              className="btn btn-danger ml-auto"
            >
              Delete agent
            </button>
          )}
        </FormFooter>
      )}

      {showDeleteDialog && (
        <DeleteAgentDialog
          agentId={id!}
          agentName={data.configure.name}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setShowDeleteDialog(false)}
        />
      )}
    </PageShell>
  );
}

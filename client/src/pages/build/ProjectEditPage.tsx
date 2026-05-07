import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { buildApi } from '../../lib/api/build';
import { PageShell } from '../../components/PageShell';
import { FormFooter } from '../../components/FormFooter';
import type { ApiProject, ProjectPatch } from '../../../../shared/types/build';
import MigratedFromGoalsBanner from './components/MigratedFromGoalsBanner';
import DeleteProjectDialog from './components/DeleteProjectDialog';

export default function ProjectEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ApiProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState<Partial<ProjectPatch>>({});
  const [saving, setSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    if (!id) return;
    buildApi.getProject(id)
      .then(p => { setProject(p); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading || !project) return <PageShell><div className="p-8 text-slate-400">Loading...</div></PageShell>;

  const val = <K extends keyof ProjectPatch & keyof ApiProject>(key: K): ProjectPatch[K] | ApiProject[K] =>
    (key in dirty ? dirty[key as keyof typeof dirty] : project[key]) as ProjectPatch[K] | ApiProject[K];

  const set = <K extends keyof ProjectPatch>(key: K, value: ProjectPatch[K]) =>
    setDirty(d => ({ ...d, [key]: value }));

  return (
    <PageShell
      header={
        <div className="px-6 py-4 border-b border-slate-100">
          <h1 className="text-lg font-semibold text-slate-800">Edit {project.name}</h1>
        </div>
      }
      bottomPadding={100}
    >
      {project.migratedFromGoalsAt && (
        <MigratedFromGoalsBanner migratedAt={project.migratedFromGoalsAt} />
      )}

      <div className="px-6 py-4 max-w-2xl space-y-6">
        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Identity</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
              <input
                type="text"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md"
                value={(val('name') as string) ?? ''}
                onChange={e => set('name', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Description</label>
              <textarea
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md resize-y min-h-[60px]"
                value={(val('description') as string) ?? ''}
                onChange={e => set('description', e.target.value)}
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Objective</h2>
          <textarea
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md resize-y min-h-[80px]"
            placeholder="Injected as runtime context to all agent prompts under this project."
            value={(val('objective') as string | null) ?? ''}
            onChange={e => set('objective', e.target.value || null)}
          />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Project management</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
              <select
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-white"
                value={(val('status') as string) ?? 'active'}
                onChange={e => set('status', e.target.value as ProjectPatch['status'])}
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Target date</label>
              <input
                type="date"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md"
                value={(val('targetDate') as string | null)?.split('T')[0] ?? ''}
                onChange={e => set('targetDate', e.target.value || null)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Budget (USD)</label>
              <input
                type="number"
                min="0"
                step="100"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md"
                value={(val('budgetUsd') as number | null) ?? ''}
                onChange={e => set('budgetUsd', e.target.value ? Number(e.target.value) : null)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Repository URL</label>
              <input
                type="url"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md"
                value={(val('repositoryUrl') as string | null) ?? ''}
                onChange={e => set('repositoryUrl', e.target.value || null)}
              />
            </div>
          </div>
        </section>
      </div>

      <FormFooter>
        <button
          onClick={() => setDirty({})}
          disabled={Object.keys(dirty).length === 0}
          className="btn btn-secondary"
        >
          Discard
        </button>
        <button
          onClick={async () => {
            if (!id || Object.keys(dirty).length === 0) return;
            setSaving(true);
            try {
              const updated = await buildApi.patchProject(id, dirty);
              setProject(updated);
              setDirty({});
            } finally {
              setSaving(false);
            }
          }}
          disabled={Object.keys(dirty).length === 0 || saving}
          className="btn btn-primary"
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>
        <button
          onClick={() => setShowDeleteDialog(true)}
          className="btn btn-danger ml-auto"
        >
          Delete project
        </button>
      </FormFooter>

      {showDeleteDialog && (
        <DeleteProjectDialog
          projectId={id!}
          projectName={project.name}
          linkedAgentCount={project.linkedAgents.length}
          onConfirm={() => navigate('/projects')}
          onCancel={() => setShowDeleteDialog(false)}
        />
      )}
    </PageShell>
  );
}
